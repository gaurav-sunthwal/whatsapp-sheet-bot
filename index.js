const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { extractFieldsFromImage } = require('./ocr');
const { appendToSheet } = require('./sheets');

const CONFIG_PATH = path.join(__dirname, 'bot_config.json');

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

// ── Shared Socket Reference ────────────────────────────────────────
let activeSock = null;

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

// ── Bot Entry Point ────────────────────────────────────────────────
async function startBot(onUpdate) {
  const log = (message, type = 'info') => {
    console.log(`[${type.toUpperCase()}] ${message}`);
    if (onUpdate) {
      onUpdate('log', { message, type });
    }
  };

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_v2');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Mac OS', 'Chrome', '121.0.0'],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  activeSock = sock;

  sock.ev.on('creds.update', saveCreds);

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
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      
      log(`Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`, 'error');
      
      if (onUpdate) onUpdate('status', 'disconnected');

      if (shouldReconnect) {
        log('Reconnecting in 5 seconds...', 'info');
        setTimeout(() => startBot(onUpdate), 5000);
      }
    } else if (connection === 'open') {
      log('WhatsApp Bot Connected!', 'success');
      if (onUpdate) onUpdate('status', 'connected');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        const sender = msg.key.remoteJid;
        const participant = msg.key.participant || sender;

        // ── Load current config to check selected groups ──
        const config = loadConfig();
        const selectedGroups = config.selectedGroups || (config.selectedGroup ? [config.selectedGroup] : []);

        // If any groups are selected, only process images from those groups
        if (selectedGroups && selectedGroups.length > 0) {
          if (!selectedGroups.includes(sender)) continue;
        }

        // Check for image
        const imageMessage = msg.message?.imageMessage;
        if (!imageMessage) continue;

        log(`📸 Image received from group: ${sender}`, 'info');
        log(`   Participant: ${participant}`, 'info');

        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const imgPath = path.join(__dirname, 'temp_screenshot.jpg');
        fs.writeFileSync(imgPath, buffer);
        log('Image saved, running OCR...', 'info');

        const fields = await extractFieldsFromImage(imgPath, (progress) => {
          if (onUpdate && progress % 10 === 0) {
            onUpdate('log', { message: `OCR Progress: ${progress}%`, type: 'info' });
          }
        });

        // Resolve actual phone number
        const resolvedSender = resolvePhoneNumber(msg, sender, participant);
        fields.sender = resolvedSender;
        log(`Resolved sender: ${resolvedSender}`, 'info');

        if (!fields.beneficiaryId) {
          log('Could not find Beneficiary ID in image. Skipping.', 'warn');
          continue;
        }

        log(`Extracted fields: ${JSON.stringify(fields)}`, 'success');

        await appendToSheet(fields);
        log('Data appended to CSV!', 'success');

        fs.unlinkSync(imgPath);

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
  if (activeSock) {
    try {
      await activeSock.logout();
    } catch (e) {
      console.error('Error in socket logout:', e.message);
    }
    try {
      activeSock.end(undefined);
    } catch (e) {
      // Ignore
    }
    activeSock = null;
  }
}

// Export for Electron
module.exports = { startBot, getGroups, loadConfig, saveConfig, logoutBot };

// Run if directly called
if (require.main === module) {
  startBot();
}
