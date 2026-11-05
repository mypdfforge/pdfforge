import fs from 'node:fs';
import path from 'node:path';

async function compare() {
  const pdfjs = await import('../frontend/node_modules/pdfjs-dist/build/pdf.js');

  const loData = new Uint8Array(fs.readFileSync('out_libreoffice.pdf'));
  const wasmData = new Uint8Array(fs.readFileSync('out_styles_cascade.pdf'));

  const loDoc = await pdfjs.getDocument({ data: loData, useSystemFonts: true }).promise;
  const wasmDoc = await pdfjs.getDocument({ data: wasmData, useSystemFonts: true }).promise;

  console.log('=== Page Count Comparison ===');
  console.log(`  LibreOffice: ${loDoc.numPages} page(s)`);
  console.log(`  docx2pdf:    ${wasmDoc.numPages} page(s)`);

  const loPage = await loDoc.getPage(1);
  const wasmPage = await wasmDoc.getPage(1);

  const loText = await loPage.getTextContent();
  const wasmText = await wasmPage.getTextContent();

  console.log('\n=== LibreOffice Extracted Items ===');
  for (const it of loText.items) {
    if (it.str.trim()) {
      console.log(`  LO:   "${it.str}" | size: ${it.transform[0].toFixed(1)}pt | x: ${it.transform[4].toFixed(1)} | y: ${it.transform[5].toFixed(1)}`);
    }
  }

  console.log('\n=== docx2pdf Extracted Items ===');
  for (const it of wasmText.items) {
    if (it.str.trim()) {
      console.log(`  WASM: "${it.str}" | size: ${it.transform[0].toFixed(1)}pt | x: ${it.transform[4].toFixed(1)} | y: ${it.transform[5].toFixed(1)}`);
    }
  }
}

compare().catch(console.error);
