const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { extractFieldsFromImage } = require('./ocr');
const { appendToSheet, getExistingBeneficiaryIds } = require('./sheets');

// Fallback when live version fetch fails. Keep in sync with Baileys master Defaults.
const FALLBACK_WA_VERSION = [2, 3000, 1043857760];

const CONFIG_PATH = path.join(__dirname, 'bot_config.json');
const SEED_PATH = path.join(__dirname, 'message_seeds.json');
const HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_PAGES = 20;
const HISTORY_WAIT_MS = 45000;
const SEED_WAIT_MS = 35000;
const CONNECT_WAIT_MS = 60000;

// ── Config Management ──────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading config:', e.message);
  }
  return { selectedGroups: [] };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getSelectedGroups(config = loadConfig()) {
  return config.selectedGroups || (config.selectedGroup ? [config.selectedGroup] : []);
}

// ── Phone Number Resolution ────────────────────────────────────────
const AUTH_DIR = path.join(__dirname, 'auth_info_v2');

/**
 * Attempts to resolve a WhatsApp LID (Linked Identity) to an actual Phone Number.
 * Checks active socket's own session first, then falls back to local cache files in auth_info_v2.
 */
function getPNFromLID(jid) {
  if (!jid) return null;
  const cleanJid = jid.split('@')[0].split(':')[0]; // Extract the raw ID prefix

  // 1. Check if it matches active connection's own user LID
  if (activeSock?.user) {
    const ownLid = activeSock.user.lid ? activeSock.user.lid.split('@')[0].split(':')[0] : null;
    const ownPn = activeSock.user.id ? activeSock.user.id.split('@')[0].split(':')[0] : null;
    if (ownLid && ownPn && cleanJid === ownLid) {
      return ownPn;
    }
  }

  // 2. Check auth_info_v2 directory for lid-mapping reverse file
  try {
    const filePath = path.join(AUTH_DIR, `lid-mapping-${cleanJid}_reverse.json`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const pn = content.replace(/^"|"$/g, '');
      if (pn && /^\d+$/.test(pn)) {
        return pn;
      }
    }
  } catch (e) {
    // Silent ignore
  }

  return null;
}

/**
 * Resolves the actual phone number from WhatsApp's LID (Linked Identity) format.
 * WhatsApp now uses LID instead of phone numbers for remoteJid/participant.
 * This function checks multiple sources to find the real phone number.
 */
function resolvePhoneNumber(msg, sender, participant) {
  const extractNumber = (jid) => {
    if (!jid) return null;
    
    // Check if this JID is a LID or matches LID pattern
    if (jid.endsWith('@lid') || /^\d{14,15}$/.test(jid.split('@')[0])) {
      const resolvedPN = getPNFromLID(jid);
      if (resolvedPN) return resolvedPN;
    }

    const num = jid.split('@')[0].split(':')[0];
    // A valid phone number has 10 to 15 digits and is not a LID JID
    if (/^\d{10,15}$/.test(num) && !jid.endsWith('@lid')) {
      return num;
    }
    return null;
  };

  // Layer 1: Check msg.key.senderPn (WhatsApp's new field to map LID to real Phone Number)
  const fromSenderPn = extractNumber(msg.key?.senderPn);
  if (fromSenderPn) return fromSenderPn;

  // Layer 2: Check if participant itself is a phone number (non-LID) or maps to one
  const fromParticipant = extractNumber(participant);
  if (fromParticipant) return fromParticipant;

  // Layer 3: Check msg.key.participant for phone number format or mapping
  const fromKeyParticipant = extractNumber(msg.key?.participant);
  if (fromKeyParticipant) return fromKeyParticipant;

  // Layer 4: Check sender (remoteJid) for phone number format or mapping
  const fromSender = extractNumber(sender);
  if (fromSender) return fromSender;

  // Layer 5: If it is a group message, NEVER return the group ID as the sender number.
  // Instead, return the resolved participant's LID/number.
  if (sender && (sender.endsWith('@g.us') || sender.includes('-') || sender.split('@')[0].length > 15)) {
    if (participant) {
      const resolvedParticipant = getPNFromLID(participant);
      if (resolvedParticipant) return resolvedParticipant;
      return participant.split('@')[0].split(':')[0];
    }
  }

  // Fallback: return the resolved or raw JID prefix
  const resolvedSender = getPNFromLID(sender);
  if (resolvedSender) return resolvedSender;

  return sender?.split('@')[0].split(':')[0] || 'unknown';
}

// ── Shared Socket / State ──────────────────────────────────────────
let activeSock = null;
let botUpdateFn = null;
let isBackfilling = false;
let isConnected = false;
let reconnectTimer = null;
let botGeneration = 0;

async function resolveWaVersion(log = emitLog) {
  try {
    const wa = await fetchLatestWaWebVersion();
    if (wa?.version?.length === 3 && !wa.error) {
      log(`Using WhatsApp Web version ${wa.version.join('.')}`, 'info');
      return wa.version;
    }
  } catch (_) {
    // fall through
  }

  try {
    const baileys = await fetchLatestBaileysVersion();
    if (baileys?.version?.length === 3 && !baileys.error) {
      log(`Using Baileys published version ${baileys.version.join('.')}`, 'info');
      return baileys.version;
    }
  } catch (_) {
    // fall through
  }

  log(`Using fallback WhatsApp version ${FALLBACK_WA_VERSION.join('.')}`, 'warn');
  return FALLBACK_WA_VERSION;
}

function endActiveSocket() {
  if (!activeSock) return;
  const sock = activeSock;
  activeSock = null;
  isConnected = false;
  try {
    sock.ev.removeAllListeners();
  } catch (_) {
    // ignore
  }
  try {
    sock.end(undefined);
  } catch (_) {
    // ignore
  }
}

/** @type {Map<string, Map<string, object>>} chatJid -> msgId -> message */
const messageCache = new Map();
/** @type {Set<string>} */
const processedMessageIds = new Set();
/** @type {Map<string, object>} chatJid -> lightweight seed { key, messageTimestamp } */
const seedByJid = new Map();

function emitLog(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  if (botUpdateFn) {
    botUpdateFn('log', { message, type });
  }
}

function loadSeedsFromDisk() {
  try {
    if (!fs.existsSync(SEED_PATH)) return;
    const data = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    for (const [jid, seed] of Object.entries(data || {})) {
      if (seed?.key?.id && seed?.messageTimestamp != null) {
        seedByJid.set(jid, seed);
      }
    }
  } catch (e) {
    console.error('Failed to load message seeds:', e.message);
  }
}

function persistSeedsToDisk() {
  try {
    const out = {};
    for (const [jid, seed] of seedByJid.entries()) {
      out[jid] = seed;
    }
    fs.writeFileSync(SEED_PATH, JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Failed to save message seeds:', e.message);
  }
}

function rememberSeed(msg) {
  const jid = msg?.key?.remoteJid;
  const id = msg?.key?.id;
  if (!jid || !id || msg.messageTimestamp == null) return;

  const incoming = {
    key: {
      remoteJid: msg.key.remoteJid,
      id: msg.key.id,
      fromMe: Boolean(msg.key.fromMe),
      participant: msg.key.participant || undefined,
    },
    messageTimestamp: Number(msg.messageTimestamp),
  };

  const existing = seedByJid.get(jid);
  // Keep the oldest known seed — needed for fetchMessageHistory pagination
  if (!existing || Number(incoming.messageTimestamp) <= Number(existing.messageTimestamp)) {
    seedByJid.set(jid, incoming);
    persistSeedsToDisk();
  }
}

function injectSeedStub(jid) {
  const seed = seedByJid.get(jid);
  if (!seed?.key?.id) return null;
  const stub = {
    key: { ...seed.key },
    messageTimestamp: seed.messageTimestamp,
    message: null,
  };
  if (!messageCache.has(jid)) messageCache.set(jid, new Map());
  messageCache.get(jid).set(seed.key.id, stub);
  return stub;
}

function cacheMessage(msg) {
  const jid = msg?.key?.remoteJid;
  const id = msg?.key?.id;
  if (!jid || !id) return;
  if (!messageCache.has(jid)) messageCache.set(jid, new Map());
  messageCache.get(jid).set(id, msg);
  rememberSeed(msg);
}

function getCachedMessages(jid) {
  return [...(messageCache.get(jid)?.values() || [])];
}

function getOldestCachedMessage(jid) {
  const msgs = getCachedMessages(jid);
  if (!msgs.length) return null;
  return msgs.reduce((oldest, msg) =>
    Number(msg.messageTimestamp) < Number(oldest.messageTimestamp) ? msg : oldest
  );
}

function toTimestampMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  // WhatsApp messageTimestamp is usually seconds; HistorySyncOnDemand wants ms
  return n < 1e12 ? n * 1000 : n;
}

function hasImageMessage(msg) {
  return Boolean(msg?.message?.imageMessage);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilConnected(timeoutMs = CONNECT_WAIT_MS) {
  if (isConnected && activeSock) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isConnected && activeSock) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Make sure we have at least one message key for this group so
 * fetchMessageHistory can run. Uses memory cache, disk seeds, then waits for sync.
 */
async function ensureGroupSeed(groupJid, timeoutMs = SEED_WAIT_MS) {
  if (getOldestCachedMessage(groupJid)) return true;

  if (injectSeedStub(groupJid)) {
    emitLog(`Restored saved history seed for ${groupJid}`, 'info');
    return true;
  }

  emitLog(
    `Waiting up to ${Math.round(timeoutMs / 1000)}s for WhatsApp history sync for this group...`,
    'info'
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        activeSock?.ev.off('messaging-history.set', onHistory);
        activeSock?.ev.off('messages.upsert', onUpsert);
      } catch (_) {
        // ignore
      }
      resolve(ok);
    };

    const check = () => {
      if (getOldestCachedMessage(groupJid)) finish(true);
    };

    const onHistory = ({ messages }) => {
      for (const msg of messages || []) cacheMessage(msg);
      check();
    };
    const onUpsert = ({ messages }) => {
      for (const msg of messages || []) cacheMessage(msg);
      check();
    };

    if (activeSock) {
      activeSock.ev.on('messaging-history.set', onHistory);
      activeSock.ev.on('messages.upsert', onUpsert);
    }
    setTimeout(() => finish(Boolean(getOldestCachedMessage(groupJid))), timeoutMs);
  });
}

loadSeedsFromDisk();

/**
 * Fetches all groups the user is part of.
 * Returns an array of { id, name, participants } objects.
 */
async function getGroups() {
  if (!activeSock) return [];
  try {
    const groups = await activeSock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject || g.id,
      participantCount: g.participants?.length || 0,
    }));
  } catch (err) {
    console.error('Error fetching groups:', err.message);
    return [];
  }
}

/**
 * Downloads an image message, runs OCR, and appends to CSV.
 * Shared by live upserts and historical backfill.
 */
async function processImageMessage(msg, options = {}) {
  const { existingIds = null, source = 'live' } = options;
  const msgId = msg.key?.id;
  const sender = msg.key?.remoteJid;
  const participant = msg.key?.participant || sender;

  if (!hasImageMessage(msg)) {
    return { status: 'skipped', reason: 'not-image' };
  }
  if (msgId && processedMessageIds.has(msgId)) {
    return { status: 'skipped', reason: 'already-processed' };
  }

  emitLog(`📸 ${source === 'backfill' ? 'Backfill' : 'Live'} image from: ${sender}`, 'info');
  emitLog(`   Participant: ${participant}`, 'info');

  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  const imgPath = path.join(
    __dirname,
    `temp_screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  );

  try {
    fs.writeFileSync(imgPath, buffer);
    emitLog('Image saved, running OCR...', 'info');

    const fields = await extractFieldsFromImage(imgPath, (progress) => {
      if (botUpdateFn && progress % 10 === 0) {
        botUpdateFn('log', { message: `OCR Progress: ${progress}%`, type: 'info' });
      }
    });

    const resolvedSender = resolvePhoneNumber(msg, sender, participant);
    fields.sender = resolvedSender;
    emitLog(`Resolved sender: ${resolvedSender}`, 'info');

    if (!fields.beneficiaryId) {
      emitLog('Could not find Beneficiary ID in image. Skipping.', 'warn');
      if (msgId) processedMessageIds.add(msgId);
      return { status: 'skipped', reason: 'no-beneficiary-id' };
    }

    if (existingIds && existingIds.has(fields.beneficiaryId)) {
      emitLog(`Beneficiary ${fields.beneficiaryId} already in CSV. Skipping.`, 'info');
      if (msgId) processedMessageIds.add(msgId);
      return { status: 'skipped', reason: 'duplicate-beneficiary' };
    }

    const config = loadConfig();
    if (config.saveToCsv === false) {
      emitLog('Save to CSV is turned off — extracted fields were not written.', 'warn');
      if (msgId) processedMessageIds.add(msgId);
      return { status: 'skipped', reason: 'csv-disabled' };
    }

    emitLog(`Extracted fields: ${JSON.stringify(fields)}`, 'success');
    await appendToSheet(fields);
    if (existingIds) existingIds.add(fields.beneficiaryId);
    emitLog('Data appended to CSV!', 'success');

    if (msgId) processedMessageIds.add(msgId);
    return { status: 'processed', beneficiaryId: fields.beneficiaryId };
  } finally {
    try {
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    } catch (_) {
      // ignore cleanup errors
    }
  }
}

/**
 * Waits for an on-demand history chunk for a specific group.
 * Listener is registered before fetchMessageHistory is called by the caller.
 */
function waitForGroupHistory(groupJid, timeoutMs = HISTORY_WAIT_MS) {
  return new Promise((resolve) => {
    if (!activeSock) {
      resolve([]);
      return;
    }

    let settled = false;
    const finish = (messages) => {
      if (settled) return;
      settled = true;
      try {
        activeSock.ev.off('messaging-history.set', onHistory);
      } catch (_) {
        // ignore
      }
      resolve(messages);
    };

    const onHistory = ({ messages }) => {
      const batch = messages || [];
      for (const msg of batch) cacheMessage(msg);
      const forGroup = batch.filter((m) => m.key?.remoteJid === groupJid);
      if (forGroup.length > 0) {
        finish(forGroup);
      }
    };

    activeSock.ev.on('messaging-history.set', onHistory);
    setTimeout(() => finish([]), timeoutMs);
  });
}

/**
 * Pull older messages for one group and OCR every image found.
 */
async function backfillOneGroup(groupJid, existingIds) {
  const result = {
    groupJid,
    processed: 0,
    skipped: 0,
    errors: 0,
    pagesFetched: 0,
    message: null,
  };

  const processBatch = async (messages) => {
    const images = messages.filter(hasImageMessage);
    for (const msg of images) {
      try {
        const outcome = await processImageMessage(msg, {
          existingIds,
          source: 'backfill',
        });
        if (outcome.status === 'processed') result.processed += 1;
        else result.skipped += 1;
      } catch (err) {
        result.errors += 1;
        emitLog(`Error processing historical image: ${err.message}`, 'error');
      }
    }
  };

  // Cold start: wait for sync / restore disk seed before giving up
  const hasSeed = await ensureGroupSeed(groupJid, SEED_WAIT_MS);
  if (!hasSeed) {
    result.message =
      'No WhatsApp history seed for this group yet. Keep the bot online for ~30s after connect, open the group once on your phone, or send any message in the group, then try Fetch Previous Data again.';
    emitLog(result.message, 'warn');
    return result;
  }

  // 1) Process anything already cached for this group
  const cached = getCachedMessages(groupJid);
  emitLog(`Backfill ${groupJid}: ${cached.length} cached message(s)`, 'info');
  await processBatch(cached);

  // 2) Paginate older history via Baileys on-demand sync
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const oldest = getOldestCachedMessage(groupJid);
    if (!oldest?.key?.id) {
      result.message = 'No older seed available for further history.';
      emitLog(result.message, 'warn');
      break;
    }

    emitLog(
      `Requesting older history for ${groupJid} (page ${page + 1}, up to ${HISTORY_PAGE_SIZE})...`,
      'info'
    );

    const historyPromise = waitForGroupHistory(groupJid);
    try {
      await activeSock.fetchMessageHistory(
        HISTORY_PAGE_SIZE,
        oldest.key,
        toTimestampMs(oldest.messageTimestamp)
      );
    } catch (err) {
      result.message = `History request failed: ${err.message}`;
      emitLog(result.message, 'error');
      break;
    }

    const olderMessages = await historyPromise;
    result.pagesFetched += 1;

    if (!olderMessages.length) {
      result.message = result.message || 'No more historical messages returned for this group.';
      emitLog(result.message, 'info');
      break;
    }

    emitLog(`Received ${olderMessages.length} historical message(s) for ${groupJid}`, 'info');
    await processBatch(olderMessages);

    if (olderMessages.length < HISTORY_PAGE_SIZE) {
      result.message = 'Reached the end of available history for this group.';
      emitLog(result.message, 'info');
      break;
    }
  }

  return result;
}

/**
 * Backfill selected groups, or a specific subset if groupJids is provided.
 */
async function backfillSelectedGroups(groupJids) {
  if (!activeSock) {
    throw new Error('WhatsApp is not connected. Scan QR and wait until the bot is online.');
  }
  if (isBackfilling) {
    throw new Error('A backfill is already running. Please wait for it to finish.');
  }

  const selectedGroups = Array.isArray(groupJids) && groupJids.length
    ? groupJids
    : getSelectedGroups();
  if (!selectedGroups.length) {
    throw new Error('Select at least one group before fetching previous data.');
  }

  const connected = await waitUntilConnected(CONNECT_WAIT_MS);
  if (!connected) {
    throw new Error('WhatsApp is still connecting. Wait until status is Connected, then try again.');
  }

  isBackfilling = true;
  const existingIds = getExistingBeneficiaryIds();
  const summary = {
    ok: true,
    processed: 0,
    skipped: 0,
    errors: 0,
    groups: [],
  };

  try {
    emitLog(
      `Starting backfill for ${selectedGroups.length} selected group(s)...`,
      'info'
    );
    // Brief pause so RECENT history sync after connect can land first
    await sleep(1500);

    for (const groupJid of selectedGroups) {
      const groupResult = await backfillOneGroup(groupJid, existingIds);
      summary.groups.push(groupResult);
      summary.processed += groupResult.processed;
      summary.skipped += groupResult.skipped;
      summary.errors += groupResult.errors;
    }

    emitLog(
      `Backfill complete — processed ${summary.processed}, skipped ${summary.skipped}, errors ${summary.errors}.`,
      summary.errors ? 'warn' : 'success'
    );
    return summary;
  } catch (err) {
    emitLog(`Backfill failed: ${err.message}`, 'error');
    throw err;
  } finally {
    isBackfilling = false;
  }
}

// ── Bot Entry Point ────────────────────────────────────────────────
async function startBot(onUpdate) {
  botUpdateFn = onUpdate;
  const generation = ++botGeneration;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  endActiveSocket();

  const log = (message, type = 'info') => {
    emitLog(message, type);
  };

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_v2');
  const version = await resolveWaVersion(log);

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    // macOS Chrome fingerprint — WEB platform + stale version causes 405 before QR.
    browser: Browsers.macOS('Chrome'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: false,
  });

  if (generation !== botGeneration) {
    try {
      sock.end(undefined);
    } catch (_) {
      // superseded by a newer startBot call
    }
    return;
  }

  activeSock = sock;
  isConnected = false;

  sock.ev.on('creds.update', saveCreds);

  // Cache historical messages so backfill has a seed + images to process
  sock.ev.on('messaging-history.set', ({ messages }) => {
    const batch = messages || [];
    for (const msg of batch) cacheMessage(msg);
    if (batch.length) {
      const imageCount = batch.filter(hasImageMessage).length;
      const groupsHit = new Set(
        batch.map((m) => m.key?.remoteJid).filter((j) => j && j.endsWith('@g.us'))
      );
      log(
        `History sync: cached ${batch.length} message(s)` +
          (imageCount ? ` (${imageCount} image(s))` : '') +
          (groupsHit.size ? ` across ${groupsHit.size} group(s)` : ''),
        'info'
      );
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log('New QR code generated', 'qr-update');
      
      // For terminal
      qrcode.generate(qr, { small: true });
      
      // For Electron (Data URL)
      try {
        const qrDataURL = await QRCode.toDataURL(qr);
        if (onUpdate) {
          onUpdate('qr', qrDataURL);
        }
      } catch (err) {
        log('Failed to generate QR Data URL: ' + err.message, 'error');
      }
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      log(
        `Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}` +
          (statusCode ? ` (code ${statusCode})` : ''),
        'error'
      );

      if (statusCode === 405) {
        log(
          'WhatsApp rejected this client version (405). Will refetch a newer version and retry.',
          'warn'
        );
      }

      if (onUpdate) onUpdate('status', 'disconnected');

      if (shouldReconnect && generation === botGeneration) {
        // Avoid tight reconnect loops when WhatsApp drops the socket
        const delayMs = statusCode === DisconnectReason.restartRequired
          ? 2000
          : statusCode === 405
            ? 3000
            : 5000;
        log(`Reconnecting in ${delayMs / 1000} seconds...`, 'info');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startBot(onUpdate), delayMs);
      } else if (!shouldReconnect) {
        log('Logged out from WhatsApp. Scan a new QR code to continue.', 'warn');
        if (onUpdate) onUpdate('status', 'logged_out');
      }
    } else if (connection === 'open') {
      isConnected = true;
      log('WhatsApp Bot Connected!', 'success');
      if (onUpdate) onUpdate('status', 'connected');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        cacheMessage(msg);

        const sender = msg.key.remoteJid;
        const selectedGroups = getSelectedGroups();

        // If any groups are selected, only process images from those groups
        if (selectedGroups.length > 0 && !selectedGroups.includes(sender)) {
          continue;
        }

        if (!hasImageMessage(msg)) continue;

        // During backfill, live upserts are still allowed but shared processor dedupes by msg id
        await processImageMessage(msg, { source: 'live' });
      } catch (err) {
        log(`Error processing message: ${err.message}`, 'error');
      }
    }
  });
}

/**
 * Closes the active WhatsApp socket session cleanly to release file locks.
 */
async function logoutBot() {
  botGeneration += 1;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeSock) {
    try {
      await activeSock.logout();
    } catch (e) {
      console.error('Error in socket logout:', e.message);
    }
  }
  endActiveSocket();
}

// Export for Electron
module.exports = {
  startBot,
  getGroups,
  loadConfig,
  saveConfig,
  logoutBot,
  backfillSelectedGroups,
};

// Run if directly called
if (require.main === module) {
  startBot();
}
