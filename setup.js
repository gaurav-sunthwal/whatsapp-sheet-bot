// Run this ONCE to create headers in your Google Sheet
// node setup.js

const { initSheetHeaders } = require('./sheets');

initSheetHeaders()
  .then(() => {
    console.log('🎉 Setup complete! Headers created in Google Sheet.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  });
