/** Pack worker: accepts streamed pages OR a single-shot models array (legacy fallback). */
import { buildDocxBlob } from './docxBuild.js';
import { createSlicer } from './pdfToWordUtils.js';
import { stitchCrossPageTables } from './pdfTableMerge.js';

let models = [];
self.postMessage({ type: 'ready' });
const warn = (page, code, message, level) => self.postMessage({ type: 'warn', page, code, message, level });

/** Cross-page furniture: strip lines that repeat in the top/bottom band on >=60% of pages. */
function stripFurniture(ms) {
  const need = Math.max(2, Math.ceil(ms.length * 0.6));
  const counts = new Map();
  for (const m of ms) {
    const seen = new Set();
    for (const l of m.lines || []) {
      if (!l.furnKey || seen.has(l.furnKey)) continue;
      seen.add(l.furnKey); counts.set(l.furnKey, (counts.get(l.furnKey) || 0) + 1);
    }
  }
  const furn = new Set([...counts].filter(([, c]) => c >= need).map(([k]) => k));
  if (!furn.size) return 0;
  for (const m of ms) {
    m.lines = (m.lines || []).filter(l => !furn.has(l.furnKey));
    m.blocks = (m.blocks || []).filter(b => !(b.type === 'paragraph' && furn.has(b.line?.furnKey)));
  }
  return furn.size;
}

async function finalize({ title, bodySize }) {
  const removed = stripFurniture(models);
  if (removed) warn(null, 'FURNITURE', `${removed} running header/footer line(s) removed from body text.`, 'info');
  const stitched = stitchCrossPageTables(models);
  if (stitched) warn(null, 'TABLE_STITCHED', `${stitched} table(s) continued across pages were merged.`, 'info');
  const res = await buildDocxBlob(models, {
    bodySize, title, warn,
    onProgress: (i, n) => self.postMessage({ type: 'progress', i, n }),
    yieldFn: createSlicer(8),
  });
  self.postMessage({ type: 'done', blob: res.blob, packMode: res.packMode, modes: res.modes });
  models = [];
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  try {
    if (d.type === 'page') { models.push(d.model); return; }
    if (d.type === 'finalize') { await finalize(d); return; }
    if (d.models) { models = d.models; await finalize(d); return; }   // legacy single-shot
  } catch (e) {
    self.postMessage({ type: 'error', message: e?.message || String(e) });
  }
};
