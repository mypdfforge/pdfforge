import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from '../frontend/node_modules/archiver/index.js';
import { createRequire } from 'module';
import * as pdfjsLib from '../frontend/node_modules/pdfjs-dist/build/pdf.js';

const require = createRequire(import.meta.url);
const libreoffice = require('C:\\Users\\nikhi\\AppData\\Local\\npm-cache\\_npx\\1e7f6d9597241db0\\node_modules\\@deepseek-ai\\libreoffice-kit');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createTestDocx(filePath) {
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
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`, { name: '[Content_Types].xml' });

        // _rels/.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });

        // word/_rels/document.xml.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, { name: 'word/_rels/document.xml.rels' });

        // word/styles.xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Liberation Sans"/>
        <w:sz w:val="24"/> <!-- 12pt -->
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:styleId="BoldHeading">
    <w:name w:val="Bold Heading"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/> <!-- 16pt -->
    </w:rPr>
  </w:style>

  <w:style w:type="character" w:styleId="ItalicEm">
    <w:name w:val="Italic Emphasis"/>
    <w:rPr>
      <w:i/>
    </w:rPr>
  </w:style>
</w:styles>`, { name: 'word/styles.xml' });

        // word/document.xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <!-- Styled Bold Heading -->
    <w:p>
      <w:pPr><w:pStyle w:val="BoldHeading"/></w:pPr>
      <w:r><w:t>Font Variants Test Document</w:t></w:r>
    </w:p>

    <!-- Plain Regular Text -->
    <w:p>
      <w:r><w:t>This is normal regular body text rendered in Liberation Sans Regular.</w:t></w:r>
    </w:p>

    <!-- Pure Bold Paragraph -->
    <w:p>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>This paragraph is entirely formatted with bold weight.</w:t>
      </w:r>
    </w:p>

    <!-- Pure Italic Paragraph -->
    <w:p>
      <w:r>
        <w:rPr><w:i/></w:rPr>
        <w:t>This paragraph is entirely formatted in italic style.</w:t>
      </w:r>
    </w:p>

    <!-- Pure Bold-Italic Paragraph -->
    <w:p>
      <w:r>
        <w:rPr><w:b/><w:i/></w:rPr>
        <w:t>This paragraph is formatted in both bold and italic style simultaneously.</w:t>
      </w:r>
    </w:p>

    <!-- Mixed Runs in a single paragraph -->
    <w:p>
      <w:r><w:t>Here we mix </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>bold words</w:t></w:r>
      <w:r><w:t> with </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>italic words</w:t></w:r>
      <w:r><w:t> and </w:t></w:r>
      <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>bold italic phrases</w:t></w:r>
      <w:r><w:t> seamlessly on a single line.</w:t></w:r>
    </w:p>

    <!-- Heading with direct negation override -->
    <w:p>
      <w:pPr><w:pStyle w:val="BoldHeading"/></w:pPr>
      <w:r><w:t>Bold Style with </w:t></w:r>
      <w:r>
        <w:rPr><w:b w:val="0"/></w:rPr>
        <w:t>Unbold Override Word</w:t>
      </w:r>
    </w:p>

    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/> <!-- Letter size: 612 x 792 pt -->
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/> <!-- 1 inch = 72 pt -->
    </w:sectPr>
  </w:body>
</w:document>`, { name: 'word/document.xml' });

        archive.finalize();
    });
}

async function run() {
    const docxPath = path.join(__dirname, 'test_font_variants.docx');
    console.log('1. Creating test DOCX with bold/italic variants...');
    await createTestDocx(docxPath);
    console.log('   Created:', docxPath, `(${fs.statSync(docxPath).size} bytes)`);

    console.log('\n2. Converting with docx2pdf WASM...');
    const wasmPkg = await import('./www/pkg/docx2pdf.js');
    const wasmBinary = fs.readFileSync(path.join(__dirname, 'www/pkg/docx2pdf_bg.wasm'));
    await wasmPkg.default({ module_or_path: wasmBinary });

    const converter = new wasmPkg.Converter();
    
    // Register font variants from standard_fonts
    const fontBase = path.join(__dirname, '../frontend/node_modules/pdfjs-dist/standard_fonts');
    const regFont = fs.readFileSync(path.join(fontBase, 'LiberationSans-Regular.ttf'));
    const boldFont = fs.readFileSync(path.join(fontBase, 'LiberationSans-Bold.ttf'));
    const italicFont = fs.readFileSync(path.join(fontBase, 'LiberationSans-Italic.ttf'));
    const biFont = fs.readFileSync(path.join(fontBase, 'LiberationSans-BoldItalic.ttf'));

    converter.registerFont('regular', regFont);
    converter.registerFont('bold', boldFont);
    converter.registerFont('italic', italicFont);
    converter.registerFont('bold-italic', biFont);

    const docxBytes = fs.readFileSync(docxPath);
    const t0 = performance.now();
    const pdfBytes = converter.convert(docxBytes);
    const wasmTime = (performance.now() - t0).toFixed(2);
    
    const wasmPdfPath = path.join(__dirname, 'out_variants_docx2pdf.pdf');
    fs.writeFileSync(wasmPdfPath, Buffer.from(pdfBytes));
    console.log(`   docx2pdf conversion: ${wasmTime} ms -> ${wasmPdfPath} (${pdfBytes.length} bytes)`);

    console.log('\n3. Converting with native LibreOffice engine...');
    const loPdfPath = path.resolve(__dirname, 'out_variants_libreoffice.pdf');
    if (fs.existsSync(loPdfPath)) fs.unlinkSync(loPdfPath);
    const tLo = performance.now();
    const { pathToFileURL } = await import('node:url');
    const loModuleUrl = pathToFileURL('C:\\Users\\nikhi\\AppData\\Local\\npm-cache\\_npx\\1e7f6d9597241db0\\node_modules\\@deepseek-ai\\libreoffice-kit\\lib\\index.js').href;
    const { createConverter } = await import(loModuleUrl);
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
        const opList = await page.getOperatorList();
        console.log(`\n=== ${label} (Page 1 items: ${textContent.items.length}) ===`);
        const fontNames = new Set(Object.values(opList.argsArray.filter(args => args && args[0] && typeof args[0] === 'string' && args[0].startsWith('g_d')).map(a => a[0])));
        console.log(`  Embedded font objects used on page:`, [...new Set(textContent.items.map(i => i.fontName))]);
        for (const item of textContent.items) {
            if (item.str && item.str.trim()) {
                const x = item.transform[4].toFixed(1);
                const y = item.transform[5].toFixed(1);
                const fontName = item.fontName || '';
                console.log(`  [x=${x}, y=${y}, font=${fontName}] "${item.str}"`);
            }
        }
    }

    await inspectPdf(wasmPdfPath, 'docx2pdf Output');
    await inspectPdf(loPdfPath, 'LibreOffice Output');

    console.log('\n5. WASM Binary Metrics:');
    const zlib = await import('zlib');
    const wasmBytes = fs.readFileSync(path.join(__dirname, 'www/pkg/docx2pdf_bg.wasm'));
    const gzipBytes = zlib.gzipSync(wasmBytes);
    console.log(`   Raw WASM size:    ${(wasmBytes.length / 1024).toFixed(1)} KB (${wasmBytes.length} bytes)`);
    console.log(`   Gzipped WASM:     ${(gzipBytes.length / 1024).toFixed(1)} KB (${gzipBytes.length} bytes)`);
}

run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
