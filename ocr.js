const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PYTHON_DIR = path.join(__dirname, 'python');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(PYTHON_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(PYTHON_DIR, '.venv', 'bin', 'python');
const API_HOST = process.env.EXTRACT_HOST || '127.0.0.1';
const API_PORT = Number(process.env.EXTRACT_PORT || 8765);
const API_BASE = `http://${API_HOST}:${API_PORT}`;
const EXTRACTOR_VERSION = '2026.09.12.3';

let apiProcess = null;
let startingPromise = null;

function pythonBin() {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function httpJson(method, urlPath, body, timeoutMs = 120000) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: API_HOST,
        port: API_PORT,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload
            ? { 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              const err = new Error(json.detail ? JSON.stringify(json.detail) : `HTTP ${res.statusCode}`);
              err.statusCode = res.statusCode;
              err.body = json;
              reject(err);
              return;
            }
            resolve(json);
          } catch (e) {
            reject(new Error(`Invalid JSON from extractor: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Extractor request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(retries = 40, delayMs = 250) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const health = await httpJson('GET', '/health', null, 2000);
      if (health?.ok && health.version === EXTRACTOR_VERSION) return health;
      if (health?.ok && health.version !== EXTRACTOR_VERSION) {
        return { ...health, stale: true };
      }
    } catch (_) {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

function killPortProcess() {
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${API_PORT}') do taskkill /F /PID %a`, {
        stdio: 'ignore',
        shell: 'cmd.exe',
      });
    } else {
      execSync(`lsof -ti:${API_PORT} | xargs kill -9`, { stdio: 'ignore' });
    }
  } catch (_) {
    // nothing listening
  }
}

function startExtractorApi() {
  if (startingPromise) return startingPromise;

  startingPromise = (async () => {
    const existing = await waitForHealth(1, 0);
    if (existing && !existing.stale) return true;
    if (existing?.stale) {
      console.log(`[extractor] stale API version ${existing.version} → restarting ${EXTRACTOR_VERSION}`);
      if (apiProcess && !apiProcess.killed) {
        try { apiProcess.kill(); } catch (_) { /* ignore */ }
      }
      killPortProcess();
      await new Promise((r) => setTimeout(r, 500));
    }

    const py = pythonBin();
    apiProcess = spawn(py, ['-m', 'uvicorn', 'api:app', '--host', API_HOST, '--port', String(API_PORT)], {
      cwd: PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        EXTRACT_HOST: API_HOST,
        EXTRACT_PORT: String(API_PORT),
        EXTRACT_WORKERS: process.env.EXTRACT_WORKERS || '4',
        EXTRACTOR_VERSION,
      },
    });

    apiProcess.stdout.on('data', (buf) => {
      const line = String(buf).trim();
      if (line) console.log(`[extractor] ${line}`);
    });
    apiProcess.stderr.on('data', (buf) => {
      const line = String(buf).trim();
      if (line) console.log(`[extractor] ${line}`);
    });
    apiProcess.on('exit', (code) => {
      console.log(`[extractor] exited with code ${code}`);
      apiProcess = null;
      startingPromise = null;
    });

    const ok = await waitForHealth();
    if (!ok || ok.stale) {
      throw new Error('FastAPI extractor failed to become healthy');
    }
    console.log(`[extractor] FastAPI ready at ${API_BASE} (v${EXTRACTOR_VERSION})`);
    return true;
  })().catch((err) => {
    startingPromise = null;
    throw err;
  });

  return startingPromise;
}

function stopExtractorApi() {
  if (apiProcess && !apiProcess.killed) {
    try { apiProcess.kill(); } catch (_) { /* ignore */ }
  }
  apiProcess = null;
  startingPromise = null;
}

/**
 * Runs OCR + field extraction via the FastAPI Python backend.
 * Falls back to local JS parseFields only if API is unreachable after start attempt.
 */
async function extractFieldsFromImage(imagePath, onProgress) {
  if (onProgress) onProgress(5);
  console.log('🔍 Running Python FastAPI extractor...');

  try {
    await startExtractorApi();
    if (onProgress) onProgress(20);

    const result = await httpJson('POST', '/extract', { path: path.resolve(imagePath) });
    if (onProgress) onProgress(100);

    if (result.ocrText) {
      console.log('\n📄 Raw OCR Text:\n', result.ocrText);
    }
    if (result.variant) {
      console.log(`   OCR variant: ${result.variant}`);
    }

    const fields = result.fields || {};
    // Ensure receivedAt exists for CSV
    if (!fields.receivedAt) {
      fields.receivedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    }
    return fields;
  } catch (err) {
    console.error('Python extractor failed, falling back to JS Tesseract:', err.message);
    return fallbackJsExtract(imagePath, onProgress);
  }
}

async function extractFieldsFromText(text) {
  await startExtractorApi();
  const result = await httpJson('POST', '/extract/text', { text });
  return result.fields || {};
}

async function extractBatch(imagePaths) {
  await startExtractorApi();
  return httpJson('POST', '/extract/batch', {
    paths: imagePaths.map((p) => path.resolve(p)),
  });
}

async function fallbackJsExtract(imagePath, onProgress) {
  const Tesseract = require('tesseract.js');
  const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        const progress = Math.round(m.progress * 100);
        if (onProgress) onProgress(progress);
      }
    },
  });
  console.log('\n📄 Raw OCR Text (JS fallback):\n', text);
  return parseFields(text);
}

/** Kept as emergency fallback + for unit-style use */
function parseFields(text) {
  const fields = {
    receivedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  };
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  const idLine = lines.find((l) => /benef|denef/i.test(l) && /[A-Z0-9]{8,}/i.test(l));
  if (idLine) {
    const m = idLine.match(/[A-Za-z0-9]{8,20}/);
    if (m) fields.beneficiaryId = m[0].toUpperCase();
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^benef|^denef/i.test(line) && !/\b(id|category)\b/i.test(line)) {
      const parts = [];
      const same = line.split(/[:.|]/).slice(1).join(' ').replace(/^(name|ame)\b/i, '').trim();
      if (same && /[A-Za-z]{3,}/.test(same) && !/^[A-Z0-9]{8,20}$/i.test(same.replace(/\s/g, ''))) {
        parts.push(same);
      }
      const nxt = lines[i + 1] || '';
      if (/^(name|ame)\b/i.test(nxt)) {
        parts.push(nxt.replace(/^(name|ame)\b[:.\-|"'*;\s]*/i, '').trim());
      }
      const name = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (name) fields.beneficiaryName = name.toUpperCase();
    }
    const kv = line.match(/^(District|Taluka|Village|Mobile)\s*[:.\-]\s*(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const map = { district: 'district', taluka: 'taluka', village: 'village', mobile: 'mobile' };
      if (map[key]) fields[map[key]] = kv[2].trim();
    }
  }

  return fields;
}

process.on('exit', stopExtractorApi);
process.on('SIGINT', () => { stopExtractorApi(); process.exit(0); });
process.on('SIGTERM', () => { stopExtractorApi(); process.exit(0); });

module.exports = {
  extractFieldsFromImage,
  extractFieldsFromText,
  extractBatch,
  parseFields,
  startExtractorApi,
  stopExtractorApi,
};
