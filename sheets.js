const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'bot_config.json');
const DEFAULT_CSV_PATH = path.join(__dirname, 'beneficiaries.csv');

/**
 * Resolve the CSV file path from bot_config.json (csvPath).
 * Falls back to ./beneficiaries.csv when missing or invalid.
 */
function resolveCsvPath() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const configured = (config.csvPath || '').trim();
      if (configured) {
        const absolute = path.isAbsolute(configured)
          ? configured
          : path.join(__dirname, configured);
        const dir = path.dirname(absolute);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return absolute;
      }
    }
  } catch (e) {
    console.error('CSV path resolve error:', e.message);
  }
  return DEFAULT_CSV_PATH;
}

function getCsvPath() {
  return resolveCsvPath();
}

/**
 * Appends a row to the configured CSV file.
 */
async function appendToSheet(fields) {
  const csvPath = resolveCsvPath();
  if (!fs.existsSync(csvPath)) {
    await initSheetHeaders(csvPath);
  }
  const row = [
    `"${fields.receivedAt}"`,
    `"${fields.sender || ''}"`,
    `"${fields.beneficiaryId || ''}"`,
    `"${fields.beneficiaryName || ''}"`,
    `"${fields.district || ''}"`,
    `"${fields.taluka || ''}"`,
    `"${fields.village || ''}"`,
    `"${fields.subDivision || ''}"`,
    `"${fields.mobile || ''}"`,
    `"${fields.applicationDate || ''}"`,
    `"${fields.currentStatus || ''}"`,
    `"${fields.category || ''}"`,
    `"${fields.pumpCapacity || ''}"`,
    `"${fields.vendorName || ''}"`,
    `"${fields.vendorSelectionDate || ''}"`,
  ].join(',');

  fs.appendFileSync(csvPath, row + '\n');
  console.log(`✅ Row saved to CSV (${path.basename(csvPath)}): ${fields.beneficiaryId}`);
}

/**
 * Creates header row in the CSV file.
 */
async function initSheetHeaders(csvPath = resolveCsvPath()) {
  const headers = [
    'Received At', 'Sender Number', 'Beneficiary ID', 'Beneficiary Name', 'District',
    'Taluka', 'Village', 'Sub Division', 'Mobile', 'Application Date',
    'Current Status', 'Category', 'Pump Capacity', 'Vendor Name', 'Vendor Selection Date'
  ].join(',');

  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(csvPath, headers + '\n');
  console.log(`✅ CSV headers created in ${csvPath}`);
}

/**
 * Returns a Set of Beneficiary IDs already present in the CSV (for deduping backfill).
 */
function getExistingBeneficiaryIds() {
  const ids = new Set();
  const csvPath = resolveCsvPath();
  if (!fs.existsSync(csvPath)) return ids;

  const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^"[^"]*","[^"]*","([^"]*)"/);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function readCsvText() {
  const csvPath = resolveCsvPath();
  if (fs.existsSync(csvPath)) {
    return fs.readFileSync(csvPath, 'utf-8');
  }
  return '';
}

module.exports = {
  appendToSheet,
  initSheetHeaders,
  getExistingBeneficiaryIds,
  getCsvPath,
  resolveCsvPath,
  readCsvText,
  DEFAULT_CSV_PATH,
};
