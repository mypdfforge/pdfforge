/** pdf.js + DLA inside a dedicated worker. No DOM. Native XObject images, no full-page raster. */
import { extractPageLayout, segmentIntoColumns, mergeParagraphBlocks } from './pdfLayoutSegmenter.js';
import { detectTableRegions } from './pdfTableDetector.js';
import { detectTableRegionsHybrid } from './pdfRuledTables.js';
import { extractVectorGeometry } from './pdfVectorExtractor.js';
import { decodePdfImage } from './pdfImageDecode.js';
import * as U from './pdfToWordUtils.js';

let pdfjs = null, task = null, cancelled = false;
const furnitureKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\d+/g, '#');

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import('pdfjs-dist/legacy/build/pdf.js');
  // Fake-worker mode: loading the worker entry into THIS worker sets globalThis.pdfjsWorker,
  // so pdf.js runs in-thread (no nested Worker → Safari-safe). Path may need adjusting per version.
  try { await import('pdfjs-dist/legacy/build/pdf.worker.js'); } catch { /* probe below */ }
  if (!globalThis.pdfjsWorker?.WorkerMessageHandler) throw new Error('pdf.js fake worker unavailable in Worker');
  lib.GlobalWorkerOptions.workerSrc = '';
  pdfjs = lib; return lib;
}
const getObj = (page, id) => new Promise((res) => {
  try { page.objs.get(id, (d) => res(d)); setTimeout(() => res(null), 3000); } catch { res(null); }
});

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.type === 'abort') { cancelled = true; try { await task?.destroy(); } catch {} return; }
  if (m.type !== 'start') return;
  try {
    const lib = await loadPdfjs();
    task = lib.getDocument({ data: new Uint8Array(m.buffer), isEvalSupported: false });
    const pdf = await task.promise;
    const n = pdf.numPages;
    self.postMessage({ type: 'count', n });
    const hist = new Map();
    const canCanvas = typeof OffscreenCanvas !== 'undefined';

    for (let p = 1; p <= n; p++) {
      if (cancelled) return;
      const model = await analyzePage(pdf, p, lib, hist, canCanvas);
      const transfer = [];
      for (const im of model.images || []) transfer.push(im.data.buffer);
      if (model.pageImage) transfer.push(model.pageImage.data.buffer);
      self.postMessage({ type: 'page', model, hist: [...hist] }, transfer);
      if (p % 10 === 0) { try { pdf.cleanup(); } catch {} }
    }
    self.postMessage({ type: 'analyzed', hist: [...hist] });
  } catch (e) {
    self.postMessage({ type: 'error', message: e?.message || String(e) });
  } finally {
    try { await task?.destroy(); } catch {}
  }
};

async function analyzePage(pdf, pageNum, lib, hist, canCanvas) {
  const page = await pdf.getPage(pageNum);
  const model = { pageNum, mode: 'rich', w: 595.28, h: 841.89, spaceW: 595.28, spaceH: 841.89,
                  lines: [], blocks: [], images: [], pageImage: null, vector: null, topDown: true };
  try {
    const vp = page.getViewport({ scale: 1 });
    model.w = vp.width; model.h = vp.height;
    let items = null;
    try { ({ items } = await extractPageLayout(page)); } catch { items = null; }
    if (!Array.isArray(items)) { model.mode = 'plain'; items = []; }
    U.addToHistogram(hist, items);

    model.vector = await extractVectorGeometry(page).catch(() => null);
    model.spaceW = model.vector?.space?.width ?? (page.view[2] - page.view[0]);
    model.spaceH = model.vector?.space?.height ?? (page.view[3] - page.view[1]);

    let lines = null;
    try { lines = segmentIntoColumns(items, model.spaceW); } catch { lines = null; }
    if (!lines) { lines = U.groupItemsIntoLines(items); model.mode = 'plain'; }
    items = null;                                   // release raw items immediately

    // Tag furniture candidates; the PACK worker strips them once it has seen every page.
    for (const l of lines) {
      l.text = U.cleanText(l.text);
      if (Array.isArray(l.spans)) l.spans = l.spans.map(s => ({ ...s, text: U.cleanText(s.text) }));
      const band = l.y >= model.spaceH * 0.92 ? 'header' : l.y <= model.spaceH * 0.08 ? 'footer' : null;
      l.band = band; l.furnKey = band ? band + '|' + furnitureKey(l.text) : null;
    }
    model.lines = lines;
    model.topDown = lines.length > 1 ? lines[0].y <= lines[lines.length - 1].y : true;

    if (model.mode === 'rich') {
      try {
        model.blocks = mergeParagraphBlocks(
          detectTableRegionsHybrid(lines, model.spaceW, model.vector, detectTableRegions));
      } catch { model.mode = 'plain'; }
    }
    if (model.mode !== 'rich') model.blocks = U.mergePlainLines(lines).map(line => ({ type: 'paragraph', line }));

    for (const l of lines) delete l.items;           // release raw items AFTER table detection

    // Native image extraction (WS1) — no full-page rasterization.
    if (canCanvas) {
      try { await extractImages(page, lib, model); } catch { /* images are optional */ }
    }
    // Prune vectors: only large filled/stroked rects are needed downstream (callout framing).
    if (model.vector?.rects) {
      model.vector = { rects: model.vector.rects.filter(r => (r.fill || r.stroke) && r.w > 60 && r.h > 20).slice(0, 40), lines: [] };
    }
    return model;
  } finally {
    try { page.cleanup(); } catch {}
  }
}

async function extractImages(page, lib, model) {
  const OPS = lib.OPS, ops = await page.getOperatorList();
  let ctm = U.IDENTITY.slice(); const stack = [];
  const placements = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || U.IDENTITY.slice();
    else if (fn === OPS.transform) ctm = U.mulMatrix(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a?.[0]) ctm = U.mulMatrix(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || U.IDENTITY.slice();
    else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) {
      const b = U.unitSquareBBox(ctm);   // unrotated user space, matches text
      if (b.w >= 18 && b.h >= 18) placements.push({ id: a[0], box: b, mask: fn === OPS.paintImageMaskXObject });
    }
  }
  for (const pl of placements.slice(0, 12)) {
    const img = pl.id ? await getObj(page, pl.id) : null;
    if (!img?.width) continue;
    const data = await decodePdfImage(img, { mask: pl.mask });
    model.images.push({ data, type: 'png', pxW: img.width, pxH: img.height,
                        x: pl.box.x, y: pl.box.y, w: pl.box.w, h: pl.box.h });
  }
}
