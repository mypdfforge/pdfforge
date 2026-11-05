import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from '../frontend/node_modules/archiver/index.js';
import * as pdfjsLib from '../frontend/node_modules/pdfjs-dist/build/pdf.js';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal PNG generator with CRC32
function createPng(width, height) {
    function crc32(buf) {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
            c ^= buf[i];
            for (let k = 0; k < 8; k++) {
                c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
            }
        }
        return (c ^ 0xffffffff) >>> 0;
    }

    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeAndData = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(typeAndData), 0);
        return Buffer.concat([len, typeAndData, crc]);
    }

    // Signature
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // IHDR: 13 bytes
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 2; // color type: RGB
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdr = chunk('IHDR', ihdrData);

    // IDAT: Scanlines (1 filter byte + width * 3 bytes per row)
    const stride = 1 + width * 3;
    const rawData = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const offset = y * stride;
        rawData[offset] = 0; // Filter: None
        for (let x = 0; x < width; x++) {
            const pxOffset = offset + 1 + x * 3;
            rawData[pxOffset] = Math.floor((x / width) * 255);     // Red gradient
            rawData[pxOffset + 1] = 120;                            // Green
            rawData[pxOffset + 2] = Math.floor((y / height) * 255); // Blue gradient
        }
    }
    const compressed = zlib.deflateSync(rawData);
    const idat = chunk('IDAT', compressed);

    // IEND
    const iend = chunk('IEND', Buffer.alloc(0));

    return Buffer.concat([sig, ihdr, idat, iend]);
}

async function createImagesDocx(filePath) {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const pngBytes = createPng(120, 80);

    await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        // [Content_Types].xml
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, { name: '[Content_Types].xml' });

        // _rels/.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });

        // word/_rels/document.xml.rels
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`, { name: 'word/_rels/document.xml.rels' });

        // word/media/image1.png
        archive.append(pngBytes, { name: 'word/media/image1.png' });

        // word/document.xml
        // 1905000 EMUs = 150 pt, 1270000 EMUs = 100 pt
        archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <!-- Heading -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
        <w:t>Visual Media Integration Report</w:t>
      </w:r>
    </w:p>

    <!-- Description -->
    <w:p>
      <w:r><w:t>Below is a raster PNG image embedded directly into the Word document package and rendered into the PDF as an XObject image stream:</w:t></w:r>
    </w:p>

    <!-- Drawing: 150pt x 100pt centered -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="1905000" cy="1270000"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:blipFill>
                    <a:blip r:embed="rIdImg1"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>

    <!-- Caption -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr><w:i/><w:sz w:val="20"/></w:rPr>
        <w:t>Figure 1: Dynamic raster gradient image rendered with PDF graphics transform matrix.</w:t>
      </w:r>
    </w:p>

    <!-- Followup body text -->
    <w:p>
      <w:r><w:t>Notice that text before and after the image maintains proper flow, typography, and page pagination.</w:t></w:r>
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
    const docxPath = path.join(__dirname, 'test_images.docx');
    console.log('1. Creating test DOCX with embedded PNG image...');
    await createImagesDocx(docxPath);
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

    const wasmPdfPath = path.join(__dirname, 'out_images_docx2pdf.pdf');
    fs.writeFileSync(wasmPdfPath, Buffer.from(pdfBytes));
    console.log(`   docx2pdf conversion: ${wasmTime} ms -> ${wasmPdfPath} (${pdfBytes.length} bytes)`);

    console.log('\n3. Converting with native LibreOffice engine...');
    const loPdfPath = path.resolve(__dirname, 'out_images_libreoffice.pdf');
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

    console.log('\n4. Inspecting extracted text, images, and operator lists in both PDFs...');
    async function inspectPdf(pdfPath, label) {
        const doc = await pdfjsLib.getDocument({
            data: new Uint8Array(fs.readFileSync(pdfPath)),
            useSystemFonts: true,
            disableFontFace: true
        }).promise;
        const page = await doc.getPage(1);
        const opList = await page.getOperatorList();
        const textContent = await page.getTextContent();
        console.log(`\n=== ${label} (Page 1 items: ${textContent.items.length}) ===`);

        // Check for image paint operator (paintImageXObject is operator 85 in pdfjs)
        const paintOps = opList.fnArray.filter(fn => fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject);
        console.log(`  Image paint operators found: ${paintOps.length}`);

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
