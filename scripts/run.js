#!/usr/bin/env node
/**
 * One-command bootstrap for clients:
 *   npm start
 *
 * Checks / installs Node + Python deps, starts FastAPI backend, then Electron app.
 */
const { spawn, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PYTHON_DIR = path.join(ROOT, 'python');
const IS_WIN = process.platform === 'win32';
const VENV_PYTHON = IS_WIN
  ? path.join(PYTHON_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(PYTHON_DIR, '.venv', 'bin', 'python');
const STAMP = path.join(PYTHON_DIR, '.venv', '.deps-ok');
const API_HOST = process.env.EXTRACT_HOST || '127.0.0.1';
const API_PORT = Number(process.env.EXTRACT_PORT || 8765);

let backendProc = null;
let appProc = null;
let shuttingDown = false;

function log(msg) {
  console.log(`\x1b[36m[setup]\x1b[0m ${msg}`);
}

function ok(msg) {
  console.log(`\x1b[32m[ok]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m[warn]\x1b[0m ${msg}`);
}

function fail(msg) {
  console.error(`\x1b[31m[error]\x1b[0m ${msg}`);
  process.exit(1);
}

function commandExists(cmd) {
  try {
    execSync(IS_WIN ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (result.status !== 0) {
    fail(`${cmd} failed (exit ${result.status})`);
  }
}

function needsNpmInstall() {
  const nm = path.join(ROOT, 'node_modules');
  const electron = path.join(nm, 'electron');
  const baileys = path.join(nm, '@whiskeysockets', 'baileys');
  if (!fs.existsSync(nm) || !fs.existsSync(electron) || !fs.existsSync(baileys)) {
    return true;
  }
  try {
    const pkgM = fs.statSync(path.join(ROOT, 'package.json')).mtimeMs;
    const lock = fs.existsSync(path.join(ROOT, 'package-lock.json'))
      ? path.join(ROOT, 'package-lock.json')
      : fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml'))
        ? path.join(ROOT, 'pnpm-lock.yaml')
        : null;
    const lockM = lock ? fs.statSync(lock).mtimeMs : 0;
    const stampFile = path.join(nm, '.install-stamp');
    if (!fs.existsSync(stampFile)) return true;
    const stampM = fs.statSync(stampFile).mtimeMs;
    return stampM < pkgM || (lockM && stampM < lockM);
  } catch (_) {
    return true;
  }
}

function ensureNodeDeps() {
  if (!commandExists('node')) {
    fail('Node.js is not installed. Download from https://nodejs.org (v18+)');
  }
  const ver = execSync('node -v', { encoding: 'utf8' }).trim();
  ok(`Node ${ver}`);

  if (!commandExists('npm')) {
    fail('npm is missing. Reinstall Node.js from https://nodejs.org');
  }

  if (needsNpmInstall()) {
    log('Installing npm packages (first time or after package changes)...');
    run('npm', ['install']);
    fs.writeFileSync(path.join(ROOT, 'node_modules', '.install-stamp'), String(Date.now()));
    ok('npm packages ready');
  } else {
    ok('npm packages already installed');
  }
}

function pythonCmd() {
  if (commandExists('python3')) return 'python3';
  if (commandExists('python')) return 'python';
  return null;
}

function needsPythonInstall() {
  if (!fs.existsSync(VENV_PYTHON)) return true;
  if (!fs.existsSync(STAMP)) return true;
  try {
    const reqM = fs.statSync(path.join(PYTHON_DIR, 'requirements.txt')).mtimeMs;
    const stampM = fs.statSync(STAMP).mtimeMs;
    return stampM < reqM;
  } catch (_) {
    return true;
  }
}

function ensurePythonDeps() {
  const py = pythonCmd();
  if (!py) {
    fail('Python 3 is not installed. Install from https://www.python.org (3.9+)');
  }
  try {
    const ver = execSync(`${py} --version`, { encoding: 'utf8' }).trim();
    ok(ver);
  } catch (_) {
    fail('Could not run Python');
  }

  if (needsPythonInstall()) {
    log('Setting up Python OCR backend (.venv + packages)...');
    if (!fs.existsSync(path.join(PYTHON_DIR, '.venv'))) {
      run(py, ['-m', 'venv', '.venv'], { cwd: PYTHON_DIR });
    }
    const pip = IS_WIN
      ? path.join(PYTHON_DIR, '.venv', 'Scripts', 'pip.exe')
      : path.join(PYTHON_DIR, '.venv', 'bin', 'pip');
    run(pip, ['install', '--upgrade', 'pip'], { cwd: PYTHON_DIR });
    run(pip, ['install', '-r', 'requirements.txt'], { cwd: PYTHON_DIR });
    fs.mkdirSync(path.dirname(STAMP), { recursive: true });
    fs.writeFileSync(STAMP, String(Date.now()));
    ok('Python backend ready');
  } else {
    ok('Python backend already installed');
  }
}

function ensureTesseract() {
  if (commandExists('tesseract')) {
    try {
      const ver = execSync('tesseract --version', { encoding: 'utf8' }).split('\n')[0];
      ok(ver);
    } catch (_) {
      ok('tesseract found');
    }
    return;
  }
  warn('Tesseract OCR is not installed — OCR may fail.');
  if (process.platform === 'darwin') {
    warn('Install with: brew install tesseract');
  } else if (IS_WIN) {
    warn('Install from: https://github.com/UB-Mannheim/tesseract/wiki');
  } else {
    warn('Install with: sudo apt install tesseract-ocr');
  }
}

function healthCheck(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`http://${API_HOST}:${API_PORT}/health`, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitHealthy(retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    const h = await healthCheck();
    if (h && h.ok) return h;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function startBackend() {
  const existing = await healthCheck();
  if (existing && existing.ok) {
    ok(`OCR backend already running on http://${API_HOST}:${API_PORT}`);
    return;
  }

  log('Starting OCR backend (FastAPI)...');
  backendProc = spawn(VENV_PYTHON, ['-m', 'uvicorn', 'api:app', '--host', API_HOST, '--port', String(API_PORT)], {
    cwd: PYTHON_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      EXTRACT_HOST: API_HOST,
      EXTRACT_PORT: String(API_PORT),
    },
  });

  backendProc.stdout.on('data', (buf) => {
    const line = String(buf).trim();
    if (line) console.log(`\x1b[35m[backend]\x1b[0m ${line}`);
  });
  backendProc.stderr.on('data', (buf) => {
    const line = String(buf).trim();
    if (line) console.log(`\x1b[35m[backend]\x1b[0m ${line}`);
  });
  backendProc.on('exit', (code) => {
    backendProc = null;
    if (!shuttingDown) warn(`OCR backend exited (code ${code})`);
  });

  const healthy = await waitHealthy();
  if (!healthy) {
    fail('OCR backend did not start. Check Python / Tesseract install.');
  }
  ok(`OCR backend ready → http://${API_HOST}:${API_PORT}`);
}

function startApp() {
  log('Starting AutoBot Pro (Electron)...');
  const electronBin = require(path.join(ROOT, 'node_modules', 'electron'));
  appProc = spawn(electronBin, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  appProc.on('exit', (code) => {
    appProc = null;
    shutdown(code || 0);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down...');
  if (backendProc && !backendProc.killed) {
    try {
      backendProc.kill();
    } catch (_) { /* ignore */ }
  }
  if (appProc && !appProc.killed) {
    try {
      appProc.kill();
    } catch (_) { /* ignore */ }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function ensureLocalConfig() {
  const cfg = path.join(ROOT, 'bot_config.json');
  const example = path.join(ROOT, 'bot_config.example.json');
  if (!fs.existsSync(cfg) && fs.existsSync(example)) {
    fs.copyFileSync(example, cfg);
    ok('Created bot_config.json from example');
  }
}

(async () => {
  console.log('\n=== AutoBot Pro — one-command start ===\n');
  ensureNodeDeps();
  ensurePythonDeps();
  ensureTesseract();
  ensureLocalConfig();
  await startBackend();
  startApp();
  console.log('\nApp + backend are running. Close the app window (or Ctrl+C) to stop.\n');
})().catch((err) => {
  fail(err.message || String(err));
});
