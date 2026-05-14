# 📲 WhatsApp → Google Sheet Bot
### Mahadiscom Beneficiary Screenshot Extractor

---

## What This Does
When a screenshot from p.mahadiscom.in is received on WhatsApp from +91 8329526333,
this bot will automatically:
1. Detect the image
2. Run OCR (Tesseract) to read all fields
3. Append a new row to your Google Sheet with:
   - Date & Time Received, Beneficiary ID, Name, District, Taluka, Village,
     Sub Division, Mobile, Application Date, Status, Category, Pump Capacity,
     Vendor Name, Vendor Selection Date

---

## 🛠️ STEP 1 — Prerequisites

- Node.js v18+ installed → https://nodejs.org
- A Google account
- The laptop must stay ON while the bot runs (or use a cheap VPS)

---

## 🛠️ STEP 2 — Install Dependencies

```bash
cd whatsapp-sheet-bot
npm install
```

---

## 🛠️ STEP 3 — Google Sheets Setup

### A. Create your Google Sheet
1. Go to https://sheets.google.com → New Sheet
2. Name it: `Mahadiscom Beneficiaries`
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**THIS_PART**/edit`

### B. Create a Google Service Account
1. Go to https://console.cloud.google.com
2. Create a new project (e.g. `whatsapp-bot`)
3. Go to **APIs & Services → Enable APIs**
   - Enable: **Google Sheets API**
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → Service Account**
   - Name: `whatsapp-bot`
   - Role: Editor
6. Click the service account → **Keys tab → Add Key → JSON**
7. Download the JSON file
8. Rename it to `credentials.json`
9. Place it in the `whatsapp-sheet-bot/` folder

### C. Share your Sheet with the Service Account
1. Open your Google Sheet
2. Click **Share**
3. Add the service account email (looks like: `whatsapp-bot@project-name.iam.gserviceaccount.com`)
   - This email is inside credentials.json under `"client_email"`
4. Give it **Editor** access

### D. Update sheets.js
Open `sheets.js` and replace:
```
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
```
with your actual Sheet ID.

### E. Initialize headers
```bash
node setup.js
```
This creates the header row in your sheet. Run once only.

---

## 🛠️ STEP 4 — Run the Bot

```bash
node index.js
```

First time: A **QR code** will appear in the terminal.
- Open WhatsApp on your friend's phone
- Go to **Linked Devices → Link a Device**
- Scan the QR code

✅ Bot is now connected! It will keep running and listening.

---

## 🛠️ STEP 5 — Test It

Send a Mahadiscom screenshot from +91 8329526333 to the linked WhatsApp.
Check your Google Sheet — a new row should appear within ~10 seconds!

---

## ⚙️ Keep Bot Running 24/7

### Option A: Simple (leave terminal open)
Just leave it running on the laptop.

### Option B: Background process (Mac/Linux)
```bash
npm install -g pm2
pm2 start index.js --name whatsapp-bot
pm2 save
pm2 startup
```

### Option C: Deploy to a free server
- Railway.app or Render.com (free tier)
- Upload project, set start command: `node index.js`
- Note: You'll need to scan QR once and commit the `auth_info/` folder

---

## 📁 Folder Structure

```
whatsapp-sheet-bot/
├── index.js          ← Main WhatsApp bot
├── ocr.js            ← Tesseract OCR + field parser
├── sheets.js         ← Google Sheets API
├── setup.js          ← One-time header setup
├── package.json
├── credentials.json  ← (You add this - Google Service Account)
├── auth_info/        ← (Auto-created after QR scan)
└── README.md
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---|---|
| QR not scanning | Restart `node index.js`, try again |
| Sheet not updating | Check `credentials.json` path & Sheet ID in sheets.js |
| Fields showing empty | OCR issue — ensure screenshot is clear and high-res |
| Bot disconnects | It auto-reconnects; use PM2 for reliability |
| `auth_info` error | Delete the `auth_info/` folder and re-scan QR |
# whatsapp-sheet-bot
