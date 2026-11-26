/**
 * v2Pipeline.js — Slide-First 2D Scene Graph + Hybrid Compositing orchestrator.
 * Runs per-page extraction, classification, T1/T2 background synthesis, and
 * emits a validated .pptx Blob via slideEmitter + ooxmlPatcher.
 */

import { CFG } from './config.js';
import { resolveSlideDims, makePageTransform } from './slideCoords.js';
import { Kind, makeNode, createScene, finalizeScene } from './sceneGraph.js';
import { probeOperatorIr } from './irProbe.js';
import { walkOperators } from './opWalk.js';
import { extractStyledSpans } from './textStateExtractor.js';
import { extractImages } from './imageExtractor.js';
import { detectTables } from './tableDetector.js';
import { clusterTextFrames } from './textFrameClusterer.js';
import { classify } from './opClassifier.js';
import { replayToCanvas, cropRegions, computeSafeDpi } from './backgroundRasterizer.js';
import { emitScenes } from './slideEmitter.js';
import * as U from '../pdfToWordUtils.js';

async function canvasToPngBytes(cv) {
  if (typeof cv.convertToBlob === 'function') {
    const blob = await cv.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  }
  const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  return blob.arrayBuffer();
}

async function renderGroundTruth(page, dpiScale, wIn, hIn) {
  const pxW = Math.max(1, Math.ceil(wIn * dpiScale));
  const pxH = Math.max(1, Math.ceil(hIn * dpiScale));
  const cv =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(pxW, pxH)
      : Object.assign(document.createElement('canvas'), { width: pxW, height: pxH });
  const ctx = cv.getContext('2d');
  const vp = page.getViewport({ scale: dpiScale / 72 });
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return cv;
}

/**
 * Builds a finalized 2D SlideScene for a single pdf.js page.
 */
export async function buildSceneForPage(
  page,
  pageIndex,
  sharedDims,
  { dpi = CFG.dpi.start, signal, opsOverride, canvasFactory, pathFactory } = {}
) {
  const pageTf = makePageTransform(page, sharedDims);
  const dims = pageTf.dims;
  const pageRect = { x: 0, y: 0, w: dims.w, h: dims.h };
  const scene = createScene(pageIndex, dims);

  const opList = await page.getOperatorList();
  const ir = probeOperatorIr(opsOverride, opList);
  if (!ir.ok) {
    scene.meta.decisions.push(`IR probe fallback (${ir.reason})`);
  }

  const events = ir.ok ? walkOperators(opList, pageTf, { opsOverride, signal }) : [];
  const spans = await extractStyledSpans(page, pageTf, events);
  const nativeImages = ir.ok ? await extractImages(page, events, pageTf) : [];
  const tables = detectTables(spans, events, { pageRect });
  const textFrames = await clusterTextFrames(spans, { pageRect, page });

  const { native, replay, rasterRegions } = classify(events, {
    pageRect,
    textFrames,
    tables,
    nativeImages,
    opsOverride,
  });

  // Add native nodes
  for (const n of native) {
    scene.nodes.push(n);
  }

  // T1 background replay (filtered operator stream)
  const safeDpi = computeSafeDpi(dims.w, dims.h, dpi);
  const dpiPxPerIn = safeDpi * 72;

  if (replay.length > 0 && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined' || canvasFactory)) {
    const t1Canvas = replayToCanvas(replay, pageTf, dpiPxPerIn, dims.w, dims.h, {
      opsOverride,
      canvasFactory,
      pathFactory,
    });
    const t1Bytes = await canvasToPngBytes(t1Canvas);
    scene.nodes.push(
      makeNode(Kind.RASTER, 0, pageRect, {
        data: t1Bytes,
        mime: 'image/png',
        reason: 't1-replay',
      })
    );
  }

  // T2 region crops for complex islands (if any)
  if (rasterRegions.length > 0 && typeof page.render === 'function') {
    const gtCanvas = await renderGroundTruth(page, dpiPxPerIn, dims.w, dims.h);
    const crops = await cropRegions(gtCanvas, rasterRegions, dpiPxPerIn, { canvasFactory });
    for (const c of crops) {
      scene.nodes.push(
        makeNode(Kind.RASTER, c.z, c.rect, {
          data: c.data,
          mime: c.mime,
          reason: c.reason,
        })
      );
    }
    scene.meta.decisions.push(`T2 crops: ${crops.length}`);
  }

  scene.meta.decisions.push(
    `Native: ${textFrames.length} text frames, ${tables.length} tables, ${nativeImages.length} images`
  );

  return finalizeScene(scene);
}

/**
 * Full client-side v2 conversion: PDF File/Blob -> .pptx Blob.
 */
export async function convertPdfToPptxV2(file, opts = {}) {
  const { slideLayout = 'auto', dpi = CFG.dpi.start, onProgress, signal } = opts;
  const warnings = [];
  const stats = { pages: 0, rich: 0, plain: 0, image: 0, failed: 0, images: 0, packMode: 'v2-scene', elapsedMs: 0 };
  const t0 = U.now();

  U.throwIfAborted(signal);
  const pdfjs = globalThis.pdfjsLib;
  if (!pdfjs?.getDocument) throw new U.ConversionError('NO_PDFJS', 'PDF engine (pdf.js) is not loaded.');

  onProgress?.({ percent: 2, stage: 'loading', message: 'Reading PDF (v2 engine)…' });
  const buf = new Uint8Array(await U.abortable(file.arrayBuffer(), signal));
  const task = pdfjs.getDocument({ data: buf, isEvalSupported: false });
  const pdf = await U.abortable(task.promise, signal);

  try {
    const n = pdf.numPages;
    stats.pages = n;
    if (!n) throw new U.ConversionError('EMPTY', 'This PDF has no pages.');

    const firstPage = await pdf.getPage(1);
    const sharedDims = resolveSlideDims(firstPage, slideLayout);
    try { firstPage.cleanup(); } catch { /* ignore */ }

    const scenes = [];
    for (let p = 1; p <= n; p++) {
      U.throwIfAborted(signal);
      onProgress?.({
        percent: Math.round(5 + 70 * ((p - 1) / n)),
        stage: 'analyze',
        message: `Analyzing slide ${p} of ${n}…`,
        page: p - 1,
        totalPages: n,
      });
      const page = await pdf.getPage(p);
      try {
        const scene = await buildSceneForPage(page, p - 1, sharedDims, { dpi, signal });
        scenes.push(scene);
        stats.rich++;
      } finally {
        try { page.cleanup(); } catch { /* ignore */ }
      }
      if (p % 10 === 0) {
        try { pdf.cleanup(); } catch { /* ignore */ }
      }
    }

    onProgress?.({ percent: 82, stage: 'build', message: 'Composing PowerPoint slides…', page: n, totalPages: n });
    const blob = await emitScenes(scenes, {
      signal,
      onProgress: (ev) => {
        if (ev.phase === 'package') {
          onProgress?.({
            percent: Math.round(90 + (ev.pct || 0) * 0.1),
            stage: 'pack',
            message: 'Packaging PowerPoint (.pptx)…',
            page: n,
            totalPages: n,
          });
        }
      },
    });

    stats.elapsedMs = Math.round(U.now() - t0);
    onProgress?.({ percent: 100, stage: 'done', message: 'Done', page: n, totalPages: n });
    return { blob, warnings, stats };
  } finally {
    try { await pdf.cleanup?.(); } catch { /* ignore */ }
    try { await task.destroy?.(); } catch { /* ignore */ }
  }
}
