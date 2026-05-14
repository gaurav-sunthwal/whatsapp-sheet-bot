const fs = require('fs');
const path = require('path');

// The file will be created in the same folder as the bot
const CSV_FILE_PATH = path.join(__dirname, 'beneficiaries.csv');

/**
 * Appends a row to a local CSV file.
 */
async function appendToSheet(fields) {
  const row = [
    fields.receivedAt,
    `"${fields.beneficiaryId || ''}"`,   // Quoted to prevent formatting issues
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

  fs.appendFileSync(CSV_FILE_PATH, row + '\n');
  console.log(`✅ Row saved to CSV: ${fields.beneficiaryId}`);
}

/**
 * Creates header row in the CSV file.
 */
async function initSheetHeaders() {
  const headers = [
    'Received At', 'Beneficiary ID', 'Beneficiary Name', 'District',
    'Taluka', 'Village', 'Sub Division', 'Mobile', 'Application Date',
    'Current Status', 'Category', 'Pump Capacity', 'Vendor Name', 'Vendor Selection Date'
  ].join(',');

  fs.writeFileSync(CSV_FILE_PATH, headers + '\n');
  console.log('✅ CSV headers created in beneficiaries.csv!');
}

module.exports = { appendToSheet, initSheetHeaders };
