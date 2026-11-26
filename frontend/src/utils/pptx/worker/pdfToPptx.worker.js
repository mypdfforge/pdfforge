/**
 * pdfToPptx.worker.js — Dedicated Web Worker for PDF -> SlideScene extraction
 * and T1/T2 OffscreenCanvas background compositing with zero-copy ArrayBuffer transfers.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { resolveSlideDims } from '../slideCoords.js';
import { buildSceneForPage } from '../v2Pipeline.js';

let activeController = null;

self.onmessage = async (event) => {
  const { type, fileBuffer, slideLayout = 'auto', dpi = 3 } = event.data || {};

  if (type === 'abort') {
    activeController?.abort();
    return;
  }
  if (type !== 'analyze') return;

  activeController = new AbortController();
  const { signal } = activeController;

  try {
    const task = pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer), isEvalSupported: false });
    const pdf = await task.promise;
    const n = pdf.numPages;

    const firstPage = await pdf.getPage(1);
    const sharedDims = resolveSlideDims(firstPage, slideLayout);
    try { firstPage.cleanup(); } catch { /* ignore */ }

    const scenes = [];
    const transfers = [];

    for (let p = 1; p <= n; p++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      self.postMessage({
        type: 'progress',
        stage: 'analyze',
        page: p - 1,
        totalPages: n,
        percent: Math.round(5 + 70 * ((p - 1) / n)),
      });

      const page = await pdf.getPage(p);
      try {
        const scene = await buildSceneForPage(page, p - 1, sharedDims, { dpi, signal });
        for (const node of scene.nodes) {
          if (node.data instanceof ArrayBuffer) transfers.push(node.data);
        }
        scenes.push(scene);
      } finally {
        try { page.cleanup(); } catch { /* ignore */ }
      }
    }

    self.postMessage({ type: 'done', scenes }, transfers);
    try { await pdf.cleanup?.(); } catch { /* ignore */ }
    try { await task.destroy?.(); } catch { /* ignore */ }
  } catch (err) {
    self.postMessage({
      type: 'error',
      name: err?.name || 'Error',
      message: err?.message || 'Worker failed',
    });
  } finally {
    activeController = null;
  }
};
