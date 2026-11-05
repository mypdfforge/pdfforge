import fs from 'node:fs';
import path from 'node:path';
import JSZip from '../frontend/node_modules/jszip/lib/index.js';

async function createStyledDocx() {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // styles.xml with inheritance:
  // - docDefaults: 11pt, space_after=160 twips (8pt)
  // - Normal: based on defaults
  // - Heading1: basedOn Normal, 18pt (sz=36), bold, centered, space_before=240 (12pt), space_after=120 (6pt)
  // - Heading2: basedOn Heading1, 14pt (sz=28), italic, left-aligned (overrides center)
  // - Emphasis: character style with bold and italic
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:sz w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="240" w:lineRule="auto"/>
        <w:jc w:val="left"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="240" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Heading1"/>
    <w:pPr>
      <w:jc w:val="left"/>
      <w:spacing w:before="180" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>

  <w:style w:type="character" w:styleId="Emphasis">
    <w:name w:val="Emphasis"/>
    <w:rPr>
      <w:b/>
      <w:i/>
    </w:rPr>
  </w:style>
</w:styles>`);

  // document.xml
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Quarterly Executive Summary</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Key Financial Highlights</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Revenue for the current period exceeded projections. The team achieved </w:t></w:r>
      <w:r>
        <w:rPr><w:rStyle w:val="Emphasis"/></w:rPr>
        <w:t>remarkable efficiency</w:t>
      </w:r>
      <w:r><w:t> across operations without increasing overall headcount.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading1"/>
        <w:jc w:val="right"/>
      </w:pPr>
      <w:r><w:t>Direct Override Right-Aligned Heading</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`);

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function run() {
  console.log('=== Generating test_styles_cascade.docx ===');
  const docx = await createStyledDocx();
  fs.writeFileSync('test_styles_cascade.docx', docx);
  console.log('  ✓ test_styles_cascade.docx created (' + docx.length + ' bytes)');

  console.log('\n=== Converting with docx2pdf WASM ===');
  const wasmModule = await import('./www/pkg/docx2pdf.js');
  const wasmBinary = fs.readFileSync('./www/pkg/docx2pdf_bg.wasm');
  await wasmModule.default({ module_or_path: wasmBinary });

  const converter = new wasmModule.Converter();
  converter.registerFont('Default', fs.readFileSync('C:\\Windows\\Fonts\\arial.ttf'));

  const t0 = performance.now();
  const pdfBytes = converter.convert(docx);
  const elapsed = performance.now() - t0;
  fs.writeFileSync('out_styles_cascade.pdf', Buffer.from(pdfBytes));
  console.log(`  ✓ Converted in ${elapsed.toFixed(2)} ms -> out_styles_cascade.pdf (${pdfBytes.length} bytes)`);

  // Validate parsed paragraphs & layout lines
  const { PDFDocument } = await import('../frontend/node_modules/@cantoo/pdf-lib/es/index.js');
  const doc = await PDFDocument.load(pdfBytes);
  console.log(`  ✓ Output PDF has ${doc.getPageCount()} page(s)`);

  const pdfjs = await import('../frontend/node_modules/pdfjs-dist/build/pdf.js');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true });
  const pDoc = await loadingTask.promise;
  const page1 = await pDoc.getPage(1);
  const textContent = await page1.getTextContent();
  console.log('\n=== Rendered Text Items & Positions in PDF ===');
  for (const item of textContent.items) {
    if (item.str.trim()) {
      const transform = item.transform; // [scaleX, skewY, skewX, scaleY, tx, ty]
      console.log(`  • "${item.str}" -> font size: ${transform[0]}pt, x: ${transform[4].toFixed(1)}pt, y: ${transform[5].toFixed(1)}pt`);
    }
  }
}

run().catch(console.error);
