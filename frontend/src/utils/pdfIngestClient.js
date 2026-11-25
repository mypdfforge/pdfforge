/** Orchestrates ingest→pack relay. Main thread retains no page data. */
import * as U from './pdfToWordUtils.js';

export async function convertViaWorkers(file, { signal, onProgress, title, warn }) {
  const ingest = new Worker(new URL('./pdfIngestWorker.js', import.meta.url), { type: 'module' });
  const pack = new Worker(new URL('./pdfToWordBuildWorker.js', import.meta.url), { type: 'module' });
  const cleanup = () => { try { ingest.terminate(); } catch {} try { pack.terminate(); } catch {} };
  const abort = () => { try { ingest.postMessage({ type: 'abort' }); } catch {} cleanup(); };
  signal?.addEventListener('abort', abort, { once: true });
  U.throwIfAborted(signal);

  try {
    await ready(pack);
    const buffer = await file.arrayBuffer();
    const vel = U.makeVelocityTracker();
    let total = 0, done = 0, lastHist = [];

    const result = await new Promise((resolve, reject) => {
      const fail = (e) => reject(e instanceof Error ? e : new Error(String(e)));
      pack.onmessage = (ev) => {
        const d = ev.data || {};
        if (d.type === 'done') resolve({ blob: d.blob, packMode: d.packMode, modes: d.modes });
        else if (d.type === 'warn') warn?.(d.page, d.code, d.message, d.level);
        else if (d.type === 'error') fail(new Error(d.message));
      };
      pack.onerror = (e) => fail(new Error(e?.message || 'pack worker crashed'));
      ingest.onerror = (e) => fail(new Error(e?.message || 'ingest worker crashed'));
      ingest.onmessage = (ev) => {
        const d = ev.data || {};
        if (d.type === 'count') { total = d.n; onProgress?.({ percent: 2, stage: 'analyze', message: `Analyzing ${total} pages…`, totalPages: total }); }
        else if (d.type === 'page') {
          done++;
          if (d.hist) lastHist = d.hist;
          const v = vel.snapshot(done, total);
          onProgress?.({ percent: Math.round(2 + 68 * (done / Math.max(1, total))), stage: 'analyze',
            message: `Analyzing page ${done} of ${total}…`, page: done, totalPages: total,
            pagesPerSec: v.pagesPerSec, etaSec: v.etaSec ?? null });
          const transfer = [];
          for (const im of d.model.images || []) transfer.push(im.data.buffer);
          if (d.model.pageImage) transfer.push(d.model.pageImage.data.buffer);
          pack.postMessage({ type: 'page', model: d.model }, transfer);   // zero-copy relay
          d.model = null;
        }
        else if (d.type === 'analyzed') {
          onProgress?.({ percent: 72, stage: 'build', message: 'Building Word document…', page: total, totalPages: total });
          pack.postMessage({ type: 'finalize', title, bodySize: dominant(d.hist || lastHist) });
        }
        else if (d.type === 'error') fail(new Error(d.message));
      };
      ingest.postMessage({ type: 'start', buffer }, [buffer]);
    });
    onProgress?.({ percent: 100, stage: 'done', message: 'Done', page: total, totalPages: total });
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    cleanup();
  }
}
const dominant = (hist) => {
  let best = 11, n = -1;
  for (const [s, c] of hist || []) if (c > n) { best = s; n = c; }
  return best;
};
const ready = (w) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('worker start timeout')), 4000);
  w.onmessage = (e) => { if (e.data?.type === 'ready') { clearTimeout(t); res(); } };
  w.onerror = (e) => { clearTimeout(t); rej(new Error(e?.message || 'worker error')); };
});
