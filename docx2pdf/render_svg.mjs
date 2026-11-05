import fs from 'node:fs';
import { DOMParser, XMLSerializer } from '../frontend/node_modules/@xmldom/xmldom/lib/index.js';
import * as pdfjs from '../frontend/node_modules/pdfjs-dist/build/pdf.js';

// Polyfill minimal DOM for SVGGraphics in Node
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
globalThis.document = {
  createElementNS(ns, tag) {
    return new DOMParser().parseFromString(`<${tag} xmlns="${ns}"/>`, 'image/svg+xml').documentElement;
  }
};

async function renderPdfToSvg(pdfPath, svgPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });

  const opList = await page.getOperatorList();
  const svgGfx = new pdfjs.SVGGraphics(page.commonObjs, page.objs);
  const svg = await svgGfx.getSVG(opList, viewport);
  const xml = new XMLSerializer().serializeToString(svg);
  fs.writeFileSync(svgPath, xml);
  console.log(`  ✓ Rendered ${pdfPath} -> ${svgPath} (${xml.length} bytes)`);
}

async function run() {
  console.log('=== Rendering PDFs to SVG vector representations ===');
  await renderPdfToSvg('out_styles_cascade.pdf', 'out_styles_cascade.svg');
  await renderPdfToSvg('out_libreoffice.pdf', 'out_libreoffice.svg');
}

run().catch(console.error);
