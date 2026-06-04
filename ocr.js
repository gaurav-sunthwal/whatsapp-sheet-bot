const Tesseract = require('tesseract.js');

/**
 * Runs OCR on an image and extracts all relevant fields
 * from the Mahadiscom beneficiary screenshot.
 */
async function extractFieldsFromImage(imagePath, onProgress) {
  console.log('🔍 Running Tesseract OCR...');

  const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text') {
        const progress = Math.round(m.progress * 100);
        if (onProgress) onProgress(progress);
        process.stdout.write(`\r   OCR progress: ${progress}%`);
      }
    }
  });

  console.log('\n📄 Raw OCR Text:\n', text);

  return parseFields(text);
}

/**
 * Parses extracted text using regex patterns
 * based on the Mahadiscom screenshot format.
 */
function parseFields(text) {
  // Normalize text: collapse multiple spaces, fix common OCR errors
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');

  const fields = {
    receivedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  };

  // 1. Smart Beneficiary ID Extraction (with blacklist)
  const idMatch = normalized.match(/Beneficiary[.\s]*[Id]?\s*[.\-:]?\s*([A-Z0-9]{10,15})/i) || 
                  normalized.match(/\b([A-Z0-9]{10,15})\b/gi);
  
  const blacklist = ['MAHADISCOM', 'MAHADISCOMIN', 'BENEFICIARY', 'APPLICATION', 'DISTRICT', 'DIVISION', 'SELECTION'];
  fields.beneficiaryId = (idMatch || [])
    .map(m => m.replace(/Beneficiary[.\s]*[Id]?\s*[.\-:]?\s*/i, '').trim())
    .find(m => m && !blacklist.includes(m.toUpperCase()) && /[0-9]/.test(m)) || '';

  // 2. Other fields
  fields.district = extract(normalized, /District\s*[.\-:]\s*([A-Z\s]+?)(?:\n|Taluka)/i);
  fields.taluka = extract(normalized, /Taluka\s*[.\-:]\s*([A-Z\s]+?)(?:\n|Vi[nl]age)/i);
  fields.village = extract(normalized, /Vi[nl]age\s*[.\-:]\s*([A-Z\s]+?)(?:\n|Name of|Sub|Beneficiary)/i);
  fields.subDivision = extract(normalized, /Sub[.\-\s]*Division\s*[.\-:]\s*([A-Z0-9\s()\/]+?)(?:\n|Beneficiary Name)/i);
  fields.beneficiaryName = extract(normalized, /Beneficiary\s+Name\s*[.\-:]\s*([A-Z\s]+?)(?:\n|Mobile)/i)?.replace(/\sName\s/i, ' ');
  fields.mobile = extract(normalized, /Mobile\s*[.\-:]\s*([\dXx]+)/i);
  fields.applicationDate = extract(normalized, /Application\s*[.\-:]\s*([\d\w\-]+)/i);
  fields.currentStatus = extract(normalized, /Status\s*[.\-:]?\s*([A-Z\s]+?)(?:\n|Beneficiary Category)/i);
  fields.category = extract(normalized, /Category\s*[.\-:]?\s*([A-Z]+)/i);
  fields.pumpCapacity = extract(normalized, /Pump\s+Capacity[^:]*[.\-:]\s*([^\n]+)/i);
  fields.vendorName = extract(normalized, /Vendor\s*[.\-:]?\s*([A-Z0-9\s.]+?)(?:\n|Vendor Selection)/i);
  fields.vendorSelectionDate = extract(normalized, /Selection\s+Date\s*[.\-:]\s*([\d\w\-]+)/i);

  // Clean up each field
  for (const key of Object.keys(fields)) {
    if (typeof fields[key] === 'string') {
      fields[key] = fields[key].trim().replace(/\s+/g, ' ');
    }
  }

  return fields;
}

function extract(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

module.exports = { extractFieldsFromImage };
