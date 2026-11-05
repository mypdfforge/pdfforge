import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from '../frontend/node_modules/archiver/index.js';
import * as pdfjsLib from '../frontend/node_modules/pdfjs-dist/build/pdf.js';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createHeaderFooterDocx(filePath) {
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
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`, { name: '[Content_Types].xml' });

        // _rels/.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });

        // word/_rels/document.xml.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`, { name: 'word/_rels/document.xml.rels' });

        // word/header1.xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r>
      <w:rPr><w:b/><w:sz w:val="18"/></w:rPr>
      <w:t>Confidential Report - Internal Use Only</w:t>
    </w:r>
  </w:p>
</w:hdr>`, { name: 'word/header1.xml' });

        // word/footer1.xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="right"/></w:pPr>
    <w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Page </w:t></w:r>
    <w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
    <w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r>
    <w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>2</w:t></w:r></w:fldSimple>
  </w:p>
</w:ftr>`, { name: 'word/footer1.xml' });

        // word/document.xml (generate ~30 paragraphs to span across 2 pages)
        let parasXml = '';
        parasXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Executive Summary</w:t></w:r></w:p>`;
        for (let i = 1; i <= 28; i++) {
            parasXml += `<w:p><w:r><w:t>Paragraph ${i}: This is a sample paragraph written to verify that headers and footers appear consistently across page breaks, displaying the proper dynamic page numbers and running titles on every page of the document.</w:t></w:r></w:p>`;
        }

        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${parasXml}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHeader1"/>
      <w:footerReference w:type="default" r:id="rIdFooter1"/>
      <w:pgSz w:w="11906" w:h="16838"/> <!-- A4: 595.3 x 841.9 pt -->
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/> <!-- 72pt margins, 36pt header/footer -->
    </w:sectPr>
  </w:body>
</w:document>`, { name: 'word/document.xml' });

        archive.finalize();
    });
}

async function run() {
    const docxPath = path.join(__dirname, 'test_headers_footers.docx');
    console.log('1. Creating test DOCX with header, footer, and page numbers...');
    await createHeaderFooterDocx(docxPath);
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

    const wasmPdfPath = path.join(__dirname, 'out_hf_docx2pdf.pdf');
    fs.writeFileSync(wasmPdfPath, Buffer.from(pdfBytes));
    console.log(`   docx2pdf conversion: ${wasmTime} ms -> ${wasmPdfPath} (${pdfBytes.length} bytes)`);

    console.log('\n3. Converting with native LibreOffice engine...');
    const loPdfPath = path.resolve(__dirname, 'out_hf_libreoffice.pdf');
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

    console.log('\n4. Inspecting pages, headers, footers, and coordinates in both PDFs...');
    async function inspectPdf(pdfPath, label) {
        const doc = await pdfjsLib.getDocument({
            data: new Uint8Array(fs.readFileSync(pdfPath)),
            useSystemFonts: true,
            disableFontFace: true
        }).promise;
        console.log(`\n=== ${label} (Total Pages: ${doc.numPages}) ===`);
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const textContent = await page.getTextContent();
            console.log(`--- Page ${p} ---`);
            for (const item of textContent.items) {
                if (item.str && item.str.trim()) {
                    const x = item.transform[4].toFixed(1);
                    const y = item.transform[5].toFixed(1);
                    // Print headers (top of page > 750 pt) and footers (bottom of page < 100 pt)
                    if (parseFloat(y) > 750 || parseFloat(y) < 100) {
                        console.log(`  [x=${x}, y=${y}] "${item.str}"`);
                    }
                }
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