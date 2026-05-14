const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { extractFieldsFromImage } = require('./ocr');
const { appendToSheet } = require('./sheets');

const SENDER_NUMBER = '918329526333@s.whatsapp.net'; // +91 8329526333

async function startBot() {
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

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n--- NEW QR CODE GENERATED ---');
      console.log('📢 Scan the QR code below to link WhatsApp:');
      qrcode.generate(qr, { small: true });
      
      // Backup: Provide a clickable link to see the QR
      const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
      console.log('🔗 OR click this link to see the QR code:');
      console.log(qrLink);
      
      console.log('--- END OF QR CODE ---\n');
    }

    if (connection === 'close') {
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      
      console.log('❌ Connection closed. Reason:', lastDisconnect?.error?.message || 'Unknown');
      
      if (shouldReconnect) {
        console.log('⏳ Reconnecting in 5 seconds...');
        setTimeout(() => startBot(), 5000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp Bot Connected!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        // Only process messages from the specific sender
        const sender = msg.key.remoteJid;
        // if (sender !== SENDER_NUMBER) continue;

        // Only process image messages
        const isImage =
          msg.message?.imageMessage ||
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

        const imageMessage = msg.message?.imageMessage;
        if (!imageMessage) continue;

        console.log(`\n📸 Image received from ${sender}`);

        // Download image
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const imgPath = path.join(__dirname, 'temp_screenshot.jpg');
        fs.writeFileSync(imgPath, buffer);
        console.log('💾 Image saved, running OCR...');

        // Run OCR and extract fields
        const fields = await extractFieldsFromImage(imgPath);

        if (!fields.beneficiaryId) {
          console.log('⚠️  Could not find Beneficiary ID in image. Skipping.');
          continue;
        }

        console.log('✅ Extracted fields:', fields);

        // Append to Google Sheet
        await appendToSheet(fields);
        console.log('📊 Data appended to Google Sheet!');

        // Optional: clean up temp file
        fs.unlinkSync(imgPath);

      } catch (err) {
        console.error('❌ Error processing message:', err);
      }
    }
  });
}

startBot();
