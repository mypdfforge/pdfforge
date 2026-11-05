import fs from 'node:fs';
import path from 'node:path';
import JSZip from '../frontend/node_modules/jszip/lib/index.js';

// 1. Helper to generate a minimal valid .docx
async function makeDocx(paragraphs) {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  let bodyXml = '';
  for (const p of paragraphs) {
    const alignTag = p.align ? `<w:pPr><w:jc w:val="${p.align}"/></w:pPr>` : '';
    let runsXml = '';
    for (const r of p.runs) {
      const szTag = r.size ? `<w:sz w:val="${Math.round(r.size * 2)}"/>` : '';
      const bTag = r.bold ? '<w:b/>' : '';
      const iTag = r.italic ? '<w:i/>' : '';
      const rPr = (szTag || bTag || iTag) ? `<w:rPr>${szTag}${bTag}${iTag}</w:rPr>` : '';
      runsXml += `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
    }
    bodyXml += `<w:p>${alignTag}${runsXml}</w:p>`;
  }

  // Standard Letter size: 12240 x 15840 dxa (612 x 792 pt), 1 inch margins (1440 dxa / 72 pt)
  bodyXml += `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`;

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`);

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// 2. Main test runner
async function run() {
  console.log('=== Step 2: Creating Test Documents ===');
  
  // Test 1: Plain text (3 standard paragraphs)
  const docx1 = await makeDocx([
    { runs: [{ text: 'The Quick Brown Fox Jumps Over The Lazy Dog.', bold: true, size: 14 }] },
    { runs: [{ text: 'This is a sample paragraph of plain left-aligned body text in a Microsoft Word document. It contains multiple sentences to test text wrapping and line calculations accurately.' }] },
    { runs: [{ text: 'Another paragraph demonstrating standard paragraph spacing, run handling, and font advance measurements.' }] }
  ]);
  fs.writeFileSync('test1_plain.docx', docx1);
  console.log('  ✓ test1_plain.docx created (' + docx1.length + ' bytes)');

  // Test 2: Centered text
  const docx2 = await makeDocx([
    { align: 'center', runs: [{ text: 'ANNUAL FINANCIAL REPORT', bold: true, size: 18 }] },
    { align: 'center', runs: [{ text: 'Prepared for the Board of Directors', italic: true, size: 12 }] },
    { align: 'center', runs: [{ text: 'Confidential — All Rights Reserved 2026', size: 10 }] }
  ]);
  fs.writeFileSync('test2_centered.docx', docx2);
  console.log('  ✓ test2_centered.docx created (' + docx2.length + ' bytes)');

  // Test 3: Multi-page document (targeting exactly 3 pages)
  const p3List = [];
  p3List.push({ runs: [{ text: 'Three-Page Multi-Page Document Test', bold: true, size: 16 }] });
  for (let i = 1; i <= 48; i++) {
    p3List.push({
      runs: [
        { text: `Section ${i}: `, bold: true, size: 11 },
        { text: `This is paragraph number ${i} of our multi-page pagination test. It tests greedy line breaking, font advances, and automatic page break allocation across multiple page boundaries.`, size: 11 }
      ]
    });
  }
  const docx3 = await makeDocx(p3List);
  fs.writeFileSync('test3_3pages.docx', docx3);
  console.log('  ✓ test3_3pages.docx created (' + docx3.length + ' bytes)');

  // 3. Load font
  const fontPaths = [
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
    '../frontend/scripts/fonts/LiberationSans-Regular.ttf'
  ];
  let fontPath = fontPaths.find(p => fs.existsSync(p));
  if (!fontPath) {
    throw new Error('No TrueType font found to register.');
  }
  console.log(`\n=== Using Font: ${fontPath} ===`);
  const fontBytes = fs.readFileSync(fontPath);

  // 4. Initialize WASM module
  console.log('\n=== Loading WASM Module ===');
  const wasmModule = await import('./www/pkg/docx2pdf.js');
  const wasmBinary = fs.readFileSync('./www/pkg/docx2pdf_bg.wasm');
  await wasmModule.default({ module_or_path: wasmBinary });

  const converter = new wasmModule.Converter();
  converter.registerFont('Default', fontBytes);
  console.log('  ✓ Converter initialized and font registered.');

  // 5. Convert each document and benchmark speed
  console.log('\n=== Step 2 & 3: Running Conversions & Benchmarks ===');
  const tests = [
    { name: 'Plain Text', file: 'test1_plain.docx', out: 'out_plain.pdf' },
    { name: 'Centered Text', file: 'test2_centered.docx', out: 'out_centered.pdf' },
    { name: '3-Page Document', file: 'test3_3pages.docx', out: 'out_3pages.pdf' },
  ];

  for (const t of tests) {
    const docxBuf = fs.readFileSync(t.file);
    const t0 = performance.now();
    const pdfBytes = converter.convert(docxBuf);
    const elapsed = performance.now() - t0;
    fs.writeFileSync(t.out, Buffer.from(pdfBytes));

    console.log(`  ✓ ${t.name}:`);
    console.log(`     - Input docx: ${docxBuf.length} bytes`);
    console.log(`     - Output PDF: ${pdfBytes.length} bytes -> saved as ${t.out}`);
    console.log(`     - Conversion speed: ${elapsed.toFixed(2)} ms`);
  }

  // 6. Inspect PDF text selectability & page counts
  console.log('\n=== Validating PDF Text & Page Counts via @cantoo/pdf-lib ===');
  const { PDFDocument } = await import('../frontend/node_modules/@cantoo/pdf-lib/es/index.js');
  for (const t of tests) {
    const data = fs.readFileSync(t.out);
    const pdfDoc = await PDFDocument.load(data);
    const pageCount = pdfDoc.getPageCount();
    console.log(`  ✓ ${t.out}: valid PDF Document, exactly ${pageCount} page(s)`);
  }

  console.log('\n=== Extracting Text via pdfjs-dist ===');
  const pdfjs = await import('../frontend/node_modules/pdfjs-dist/build/pdf.js');
  for (const t of tests) {
    const data = new Uint8Array(fs.readFileSync(t.out));
    const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
    const doc = await loadingTask.promise;
    let fullText = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const textContent = await page.getTextContent();
      const pageStr = textContent.items.map(i => i.str).join(' ');
      fullText += `\n     [Page ${p}]: "${pageStr.substring(0, 100)}..."`;
    }
    console.log(`  ✓ ${t.out} (${doc.numPages} pages):${fullText}`);
  }
}

run().catch(err => {
  console.error('Test Runner Error:', err);
  process.exit(1);
});
