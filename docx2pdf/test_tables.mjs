import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from '../frontend/node_modules/archiver/index.js';
import * as pdfjsLib from '../frontend/node_modules/pdfjs-dist/build/pdf.js';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createTableDocx(filePath) {
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
</Types>`, { name: '[Content_Types].xml' });

        // _rels/.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });

        // word/document.xml with Heading, Table (with shading and borders), and trailing paragraph
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <!-- Heading -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
        <w:t>Project Deliverables Matrix</w:t>
      </w:r>
    </w:p>

    <!-- Intro paragraph -->
    <w:p>
      <w:r><w:t>The table below summarizes core deliverables, current status, and technical details.</w:t></w:r>
    </w:p>

    <!-- Table: 3 columns: 2500 twips (125pt), 2000 twips (100pt), 4860 twips (243pt) -> total 9360 twips (468pt = 6.5 in) -->
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9360" w:type="dxa"/>
        <w:jc w:val="left"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="2500"/>
        <w:gridCol w:w="2000"/>
        <w:gridCol w:w="4860"/>
      </w:tblGrid>

      <!-- Row 1: Header Row with Background Shading -->
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2500" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/>
          </w:tcPr>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Deliverable</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2000" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/>
          </w:tcPr>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Status</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="4860" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/>
          </w:tcPr>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Technical Details</w:t></w:r></w:p>
        </w:tc>
      </w:tr>

      <!-- Row 2 -->
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Style Cascade</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Completed</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4860" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Full OOXML style inheritance and document defaults resolution.</w:t></w:r></w:p>
        </w:tc>
      </w:tr>

      <!-- Row 3 -->
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Font Variants</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Completed</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4860" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Multi-font embedding with bold, italic, and bold-italic true CID fonts.</w:t></w:r></w:p>
        </w:tc>
      </w:tr>

      <!-- Row 4 -->
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Table Engine</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Active</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4860" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Cell border vector strokes, background shading fills, and text wrapping.</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>

    <!-- Trailing Paragraph -->
    <w:p>
      <w:r><w:t>This concludes the deliverables table review.</w:t></w:r>
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
    const docxPath = path.join(__dirname, 'test_tables.docx');
    console.log('1. Creating test DOCX with table and shading...');
    await createTableDocx(docxPath);
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

    const wasmPdfPath = path.join(__dirname, 'out_tables_docx2pdf.pdf');
    fs.writeFileSync(wasmPdfPath, Buffer.from(pdfBytes));
    console.log(`   docx2pdf conversion: ${wasmTime} ms -> ${wasmPdfPath} (${pdfBytes.length} bytes)`);

    console.log('\n3. Converting with native LibreOffice engine...');
    const loPdfPath = path.resolve(__dirname, 'out_tables_libreoffice.pdf');
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
