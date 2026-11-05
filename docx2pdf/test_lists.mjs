import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from '../frontend/node_modules/archiver/index.js';
import * as pdfjsLib from '../frontend/node_modules/pdfjs-dist/build/pdf.js';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createListsDocx(filePath) {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        // [Content_Types].xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`, { name: '[Content_Types].xml' });

        // _rels/.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });

        // word/_rels/document.xml.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`, { name: 'word/_rels/document.xml.rels' });

        // word/numbering.xml
        // abstractNum 1: Numbered list (Level 0: decimal "%1.", Level 1: lowerLetter "%2.")
        // abstractNum 2: Bulleted list (Level 0: bullet "•")
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <!-- Numbered Definition -->
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="%2."/>
      <w:pPr>
        <w:ind w:left="1440" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
  </w:abstractNum>

  <!-- Bullet Definition -->
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="-"/>
      <w:pPr>
        <w:ind w:left="1440" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
  </w:abstractNum>

  <w:num w:numId="1">
    <w:abstractNumId w:val="1"/>
  </w:num>
  <w:num w:numId="2">
    <w:abstractNumId w:val="2"/>
  </w:num>
</w:numbering>`, { name: 'word/numbering.xml' });

        // word/document.xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
        <w:t>Lists and Numbering Test</w:t>
      </w:r>
    </w:p>

    <!-- Numbered List (numId=1) -->
    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
      </w:pPr>
      <w:r><w:t>First ordered requirement item.</w:t></w:r>
    </w:p>

    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Second ordered item with extensive description text that deliberately spans across multiple lines so we can accurately test hanging indent alignment on all subsequent wrapped lines.</w:t></w:r>
    </w:p>

    <!-- Nested level 1 in ordered list -->
    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Sub-item under second requirement (lower letter a).</w:t></w:r>
    </w:p>

    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Another sub-item (lower letter b).</w:t></w:r>
    </w:p>

    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Third ordered item (should automatically continue numbering as 3).</w:t></w:r>
    </w:p>

    <!-- Bulleted List (numId=2) -->
    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Primary bullet feature point.</w:t></w:r>
    </w:p>

    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Second bullet feature with </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>bold styling</w:t></w:r>
      <w:r><w:t> and </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>italic styling</w:t></w:r>
      <w:r><w:t> inside the bullet paragraph.</w:t></w:r>
    </w:p>

    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Nested sub-bullet feature point.</w:t></w:r>
    </w:p>

    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/> <!-- Letter size: 612 x 792 pt -->
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/> <!-- 72 pt margins -->
    </w:sectPr>
  </w:body>
</w:document>`, { name: 'word/document.xml' });

        archive.finalize();
    });
}

async function run() {
    const docxPath = path.join(__dirname, 'test_lists.docx');
    console.log('1. Creating test DOCX with numbered and bulleted lists...');
    await createListsDocx(docxPath);
    console.log('   Created:', docxPath, `(${fs.statSync(docxPath).size} bytes)`);

    console.log('\n2. Converting with docx2pdf WASM...');
    const wasmPkg = await import('./www/pkg/docx2pdf.js');
    const wasmBinary = fs.readFileSync(path.join(__dirname, 'www/pkg/docx2pdf_bg.wasm'));
    await wasmPkg.default({ module_or_path: wasmBinary });

    const converter = new wasmPkg.Converter();
    const fontBase = path.join(__dirname, '../frontend/node_modules/pdfjs-dist/standard_fonts');
    converter.registerFont('regular', fs.readFileSync(path.join(fontBase, 'LiberationSans-Regular.ttf')));
    converter.registerFont('bold', fs.readFileSync(path.join(fontBase, 'LiberationSans-Bold.ttf')));
    converter.registerFont('italic', fs.readFileSync(path.join(fontBase, 'LiberationSans-Italic.ttf')));
    converter.registerFont('bold-italic', fs.readFileSync(path.join(fontBase, 'LiberationSans-BoldItalic.ttf')));

    const docxBytes = fs.readFileSync(docxPath);
    const t0 = performance.now();
    const pdfBytes = converter.convert(docxBytes);
    const wasmTime = (performance.now() - t0).toFixed(2);

    const wasmPdfPath = path.join(__dirname, 'out_lists_docx2pdf.pdf');
    fs.writeFileSync(wasmPdfPath, Buffer.from(pdfBytes));
    console.log(`   docx2pdf conversion: ${wasmTime} ms -> ${wasmPdfPath} (${pdfBytes.length} bytes)`);

    console.log('\n3. Converting with native LibreOffice engine...');
    const loPdfPath = path.resolve(__dirname, 'out_lists_libreoffice.pdf');
    if (fs.existsSync(loPdfPath)) fs.unlinkSync(loPdfPath);

    const { pathToFileURL } = await import('node:url');
    const loModuleUrl = pathToFileURL('C:\\Users\\nikhi\\AppData\\Local\\npm-cache\\_npx\\1e7f6d9597241db0\\node_modules\\@deepseek-ai\\libreoffice-kit\\lib\\index.js').href;
    const { createConverter } = await import(loModuleUrl);

    const tLo = performance.now();
    const loConverter = await createConverter();
    try {
        await loConverter.convert({
            inputPath: path.resolve(docxPath),
            outputPath: loPdfPath
        });
    } finally {
        await loConverter.dispose();
    }
    const loTime = (performance.now() - tLo).toFixed(2);
    console.log(`   LibreOffice conversion: ${loTime} ms -> ${loPdfPath} (${fs.statSync(loPdfPath).size} bytes)`);

    console.log('\n4. Inspecting extracted text and positions in both PDFs...');
    async function inspectPdf(pdfPath, label) {
        const doc = await pdfjsLib.getDocument({
            data: new Uint8Array(fs.readFileSync(pdfPath)),
            useSystemFonts: true,
            disableFontFace: true
        }).promise;
        const page = await doc.getPage(1);
        const textContent = await page.getTextContent();
        console.log(`\n=== ${label} (Page 1 items: ${textContent.items.length}) ===`);
        for (const item of textContent.items) {
            if (item.str && item.str.trim()) {
                const x = item.transform[4].toFixed(1);
                const y = item.transform[5].toFixed(1);
                console.log(`  [x=${x}, y=${y}] "${item.str}"`);
            }
        }
    }

    await inspectPdf(wasmPdfPath, 'docx2pdf Output');
    await inspectPdf(loPdfPath, 'LibreOffice Output');

    console.log('\n5. WASM Binary Metrics:');
    const wasmRaw = fs.readFileSync(path.join(__dirname, 'www/pkg/docx2pdf_bg.wasm'));
    const wasmGzip = zlib.gzipSync(wasmRaw);
    console.log(`   Raw WASM size:    ${(wasmRaw.length / 1024).toFixed(1)} KB (${wasmRaw.length} bytes)`);
    console.log(`   Gzipped WASM:     ${(wasmGzip.length / 1024).toFixed(1)} KB (${wasmGzip.length} bytes)`);
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
