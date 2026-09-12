# Deployment Guide — WhatsApp Sheet Bot

This app is an **Electron desktop app** with a local **FastAPI OCR service**. Deploy it on a machine that stays online (laptop or VPS with a GUI/session, or headless with a virtual display if needed).

---

## 1. Requirements

- macOS, Windows, or Linux
- Node.js 18+ and npm (or pnpm)
- Python 3.9+
- System Tesseract OCR
  - macOS: `brew install tesseract`
  - Ubuntu: `sudo apt install tesseract-ocr`
  - Windows: install from https://github.com/UB-Mannheim/tesseract/wiki
- WhatsApp account (phone must stay linked)

---

## 2. Install + run (one command)

Clients only need:

```bash
cd whatsapp-sheet-bot
npm start
```

That script:

- installs npm packages if missing
- creates Python `.venv` + installs OCR deps if missing
- starts FastAPI OCR backend
- opens the Electron app

Prerequisites once: Node 18+, Python 3.9+, Tesseract (`brew install tesseract` on Mac).

Optional manual steps (not needed if using `npm start`):

```bash
npm install
npm run extractor:install
```

---

## 3. Run locally (same as above)

```bash
npm start
```

What starts:

1. Electron UI
2. WhatsApp bot (Baileys)
3. FastAPI extractor on `http://127.0.0.1:8765`

App-only (backend already running):

```bash
npm run start:app
```

Manual extractor only:

```bash
npm run extractor
```

---

## 4. First-time setup in the app

1. Scan the WhatsApp QR code
2. Open **Settings** → Load / Add groups → select groups to watch
3. Set CSV path in Settings if needed
4. On **Home**, use **Fetch Past** to pull older images for a group
5. New images are processed automatically while Connected

---

## 5. CSV file

- Rows are written to the path in Settings
- Default: `./beneficiaries.csv`
- Path is stored in `bot_config.json`

---

## 6. Package as a desktop app (recommended for others)

Install Electron Builder:

```bash
npm install --save-dev electron-builder
```

Add to `package.json`:

```json
{
  "main": "main.js",
  "scripts": {
    "dist": "electron-builder"
  },
  "build": {
    "appId": "com.autobot.whatsapp-sheet",
    "productName": "AutoBot Pro",
    "files": [
      "**/*",
      "!auth_info_v2/**",
      "!python/.venv/**",
      "!**/*.md"
    ],
    "extraResources": [
      {
        "from": "python",
        "to": "python",
        "filter": ["**/*", "!.venv/**"]
      }
    ],
    "mac": { "target": ["dmg"] },
    "win": { "target": ["nsis"] },
    "linux": { "target": ["AppImage"] }
  }
}
```

Build:

```bash
npm run dist
```

Installers appear under `dist/`.

> Note: the packaged app still needs **Python + Tesseract** on the target machine, or you must ship a bundled Python runtime and point `ocr.js` at it. For internal use, running from source with `npm start` is simplest.

---

## 7. Deploy on a always-on Mac / Linux machine

1. Clone/copy the project
2. Run `npm install` and `npm run extractor:install`
3. Start with a process manager so it restarts on reboot:

### macOS (launchd) — example

Create `~/Library/LaunchAgents/com.autobot.sheet.plist` that runs:

```bash
cd /path/to/whatsapp-sheet-bot && npm start
```

### Linux (systemd user service) — example

```ini
[Unit]
Description=WhatsApp Sheet Bot
After=network.target

[Service]
WorkingDirectory=/path/to/whatsapp-sheet-bot
ExecStart=/usr/bin/npm start
Restart=always
Environment=DISPLAY=:0

[Install]
WantedBy=default.target
```

Keep the machine awake and the WhatsApp phone online.

---

## 8. Security checklist

- Do not commit `auth_info_v2/` (WhatsApp session)
- Do not commit `.env` or credentials
- Prefer a dedicated WhatsApp number for the bot
- Back up `beneficiaries.csv` and `bot_config.json`

---

## 9. Troubleshooting

| Issue | Fix |
|------|-----|
| QR never appears | Delete `auth_info_v2/`, restart, scan again |
| Connection Terminated loop | Use Chrome browser fingerprint (already default); re-link QR |
| Fetch Past Data empty | Wait until Connected, open the group on phone once, retry |
| CSV not updating | Check **Save to CSV** is on; confirm path on Home / Settings |
| OCR fails | Ensure `tesseract` is installed; run `npm run extractor:install` |

---

## 10. Daily use

```bash
npm start
```

That’s enough for normal operation: UI + WhatsApp bot + OCR API.
