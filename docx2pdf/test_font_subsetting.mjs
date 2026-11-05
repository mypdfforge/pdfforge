import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from '../frontend/node_modules/archiver/index.js';
import * as pdfjsLib from '../frontend/node_modules/pdfjs-dist/build/pdf.js';
import zlib from 'zlib';

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

        // word/styles.xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/>
        <w:sz w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
</w:styles>`, { name: 'word/styles.xml' });

        // word/document.xml with normal, bold, italic, and bold-italic
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
        <w:t>Font Subsetting Efficiency Test</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:t>This document contains text using Regular, </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Bold, </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>Italic, </w:t></w:r>
      <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>and Bold-Italic </w:t></w:r>
      <w:r><w:t>font variants. Without subsetting, embedding all four variants would bloat the PDF to over 400 KB. With TrueType font subsetting, only the referenced glyphs are included, producing an ultra-compact PDF under 20 KB.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Alphabet coverage check: The quick brown fox jumps over the lazy dog. 0123456789! Special characters: @#$%^&amp;*()_+-=[]{}|;:,.?</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`, { name: 'word/document.xml' });

        archive.finalize();
    });
}

async function run() {
    const docxPath = path.join(__dirname, 'test_subsetting.docx');
    console.log('1. Creating test DOCX with multiple font styles...');
    await createTestDocx(docxPath);
    console.log('   Created:', docxPath, `(${fs.statSync(docxPath).size} bytes)`);

    console.log('\n2. Converting with docx2pdf WASM (with TrueType Font Subsetting)...');
    const wasmPkg = await import('./www/pkg/docx2pdf.js');
    const wasmBinary = fs.readFileSync(path.join(__dirname, 'www/pkg/docx2pdf_bg.wasm'));
    await wasmPkg.default({ module_or_path: wasmBinary });

    const converter = new wasmPkg.Converter();
    const fontBase = path.join(__dirname, '../frontend/node_modules/pdfjs-dist/standard_fonts');
    const regBytes = fs.readFileSync(path.join(fontBase, 'LiberationSans-Regular.ttf'));
    const boldBytes = fs.readFileSync(path.join(fontBase, 'LiberationSans-Bold.ttf'));
    const italicBytes = fs.readFileSync(path.join(fontBase, 'LiberationSans-Italic.ttf'));
    const biBytes = fs.readFileSync(path.join(fontBase, 'LiberationSans-BoldItalic.ttf'));

    const rawTotalFontBytes = regBytes.length + boldBytes.length + italicBytes.length + biBytes.length;
    console.log(`   Total raw source font bytes (4 variants): ${(rawTotalFontBytes / 1024).toFixed(1)} KB (${rawTotalFontBytes} bytes)`);

    converter.registerFont('regular', regBytes);
    converter.registerFont('bold', boldBytes);
    converter.registerFont('italic', italicBytes);
    converter.registerFont('bold-italic', biBytes);

    const docxBytes = fs.readFileSync(docxPath);
    const t0 = performance.now();
    const pdfBytes = converter.convert(docxBytes);
    const wasmTime = (performance.now() - t0).toFixed(2);

    const wasmPdfPath = path.join(__dirname, 'out_subsetting_docx2pdf.pdf');
    fs.writeFileSync(wasmPdfPath, Buffer.from(pdfBytes));
    console.log(`   docx2pdf conversion: ${wasmTime} ms -> ${wasmPdfPath}`);
    console.log(`   >>> Output PDF size: ${(pdfBytes.length / 1024).toFixed(2)} KB (${pdfBytes.length} bytes) <<<`);

    console.log('\n3. Converting with native LibreOffice engine for reference...');
    const loPdfPath = path.resolve(__dirname, 'out_subsetting_libreoffice.pdf');
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

    console.log('\n4. Validating text extraction & rendering via pdfjs-dist...');
    const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(fs.readFileSync(wasmPdfPath)),
        useSystemFonts: true,
        disableFontFace: true
    }).promise;
    console.log(`   Total pages: ${doc.numPages}`);
    const page = await doc.getPage(1);
    const textContent = await page.getTextContent();
    console.log(`   Text items count: ${textContent.items.length}`);
    for (const item of textContent.items) {
        if (item.str && item.str.trim()) {
            console.log(`     [x=${item.transform[4].toFixed(1)}, y=${item.transform[5].toFixed(1)}] "${item.str}"`);
        }
    }

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