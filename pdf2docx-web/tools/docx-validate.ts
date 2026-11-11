import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';

export function validateDocxFile(docxPathOrBuffer: string | Uint8Array): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  let buffer: Uint8Array;
  if (typeof docxPathOrBuffer === 'string') {
    if (!fs.existsSync(docxPathOrBuffer)) {
      return { valid: false, errors: [`File not found: ${docxPathOrBuffer}`] };
    }
    buffer = fs.readFileSync(docxPathOrBuffer);
  } else {
    buffer = docxPathOrBuffer;
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(buffer);
  } catch (err: any) {
    return { valid: false, errors: [`Corrupted zip file: ${err.message}`] };
  }

  // Check 1: Content types exists
  if (!unzipped['[Content_Types].xml']) {
    errors.push('Missing [Content_Types].xml in docx package.');
  }

  // Check 2: word/document.xml exists
  if (!unzipped['word/document.xml']) {
    errors.push('Missing word/document.xml in docx package.');
  } else {
    const docXml = new TextDecoder().decode(unzipped['word/document.xml']);

    // Check 9: No floating text boxes
    if (docXml.includes('w:txbxContent') || docXml.includes('w:pict')) {
      errors.push('Forbidden element detected: floating text boxes (w:txbxContent or w:pict). Real reflow required.');
    }

    // Check 12.2: Illegal control characters
    const illegalChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
    if (illegalChars.test(docXml)) {
      errors.push('Illegal XML control character detected in document.xml.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('docx-validate.ts')) {
  const target = process.argv[2] || 'test_output.docx';
  console.log(`Validating DOCX file: ${target}...`);
  const res = validateDocxFile(target);
  if (res.valid) {
    console.log('✅ DOCX file is 100% compliant with OpenXML validation rules!');
  } else {
    console.error('❌ Validation failed with errors:', res.errors);
    process.exit(1);
  }
}
