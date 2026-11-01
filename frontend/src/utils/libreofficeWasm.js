/**
 * libreofficeWasm.js - Client-Side LibreOffice WASM Converter
 *
 * Runs headless LibreOffice inside a dedicated Web Worker, 100% on-device.
 * Engine files are downloaded as Brotli (see scripts/compress-engine.mjs) by the
 * patched worker (scripts/setup-libreoffice-assets.mjs).
 */

// Practical file size ceiling for browser WASM memory (prevents tab crashes)
export const MAX_DOCX_WASM_SIZE = 50 * 1024 * 1024; // 50 MB

// Engine progress is mapped into 8..88 %, leaving room for font loading before
// and the conversion itself (92..100 %) after.
const ENGINE_BASE = 8;
const ENGINE_SPAN = 80;

let loadPromise = null;      // in-flight or finished engine load (shared by warmEngine + convert)
let loadedWithCjk = false;   // whether the current/in-flight load includes the CJK font pack
let conversionLock = Promise.resolve();

// Everyone waiting on the engine gets progress, including a convert click that
// arrives while warmEngine() is mid-download.
const listeners = new Set();
let lastProgress = null;
const emit = (p) => {
  lastProgress = p;
  listeners.forEach((fn) => { try { fn(p); } catch { /* listener errors must not break loading */ } });
};

/**
 * Skip background warming on Data Saver, slow/cellular links or < 4 GB devices.
 */
export function canWarmEngine() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.connection?.saveData) return false;
  const effectiveType = navigator.connection?.effectiveType;
  if (effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g') return false;
  if (navigator.connection?.type === 'cellular') return false;
  if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory < 4) return false;
  return true;
}

/** WebAssembly threads need SharedArrayBuffer, which needs COOP/COEP isolation. */
export function isCrossOriginIsolated() {
  return typeof self !== 'undefined' && self.crossOriginIsolated === true;
}

async function getEngineVersion() {
  try {
    const res = await fetch('/dist/engine-manifest.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

/**
 * True only if the CURRENT engine version is fully in CacheStorage
 * (both files). A stale flag from an older deploy no longer counts.
 */
export async function isWasmEngineCached() {
  if (typeof caches === 'undefined') return false;
  try {
    const version = await getEngineVersion();
    if (!version) return false;
    const name = `soffice-${version}`;
    if (!(await caches.has(name))) return false;
    const cache = await caches.open(name);
    return (await cache.keys()).length >= 2;
  } catch {
    return false;
  }
}

async function loadEngine(needsCjk) {
  if (!isCrossOriginIsolated()) {
    throw new Error(
      'Accurate conversion is unavailable: browser security headers (COOP/COEP) are not isolated. Please use Quick mode.'
    );
  }

  emit({ percent: 2, message: 'Preparing engine...', phase: 'downloading' });

  const version = await getEngineVersion();

  const { WorkerBrowserConverter, createWasmPaths, loadFontsFromUrl } = await import(
    '@matbee/libreoffice-converter/browser'
  );

  emit({ percent: 4, message: 'Loading core typography fonts...', phase: 'downloading' });
  let fonts = [];
  try {
    fonts = await loadFontsFromUrl('/assets/fonts-core.zip');
  } catch (fontErr) {
    console.warn('[libreofficeWasm] Core fonts load warning:', fontErr);
  }

  if (needsCjk) {
    emit({ percent: 6, message: 'Downloading CJK font pack (~13 MB, cached for next time)...', phase: 'downloading' });
    try {
      const cjkFonts = await loadFontsFromUrl('/assets/fonts-cjk-min.zip');
      if (Array.isArray(cjkFonts)) fonts = [...fonts, ...cjkFonts];
    } catch (cjkErr) {
      console.warn('[libreofficeWasm] CJK fonts load warning:', cjkErr);
    }
  }

  // The library only forwards {percent, message} from the worker. Byte counts
  // arrive on a side channel so we can show MB and MB/s.
  let bytes = { bytesLoaded: 0, bytesTotal: 0 };
  let speed = 0;
  let lastT = Date.now();
  let lastB = 0;
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('soffice-progress') : null;
  if (bc) {
    bc.onmessage = ({ data }) => {
      if (!data || typeof data.bytesLoaded !== 'number') return;
      bytes = data;
      const now = Date.now();
      if (now - lastT >= 500) {
        const inst = (data.bytesLoaded - lastB) / 1048576 / ((now - lastT) / 1000);
        speed = speed ? speed * 0.6 + inst * 0.4 : inst; // smoothed
        lastT = now;
        lastB = data.bytesLoaded;
      }
    };
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const wasmPaths = createWasmPaths(`${origin}/dist/`);
  const converter = new WorkerBrowserConverter({
    ...wasmPaths,
    browserWorkerJs: `/dist/browser.worker.js?v=${version || Date.now()}`,
    fonts,
    onProgress: (info) => {
      if (!info || typeof info !== 'object') return;
      const message = info.message || 'Loading engine...';
      const downloading = /download/i.test(message);
      const percent = Math.min(88, ENGINE_BASE + Math.round(Math.min(100, info.percent || 0) * ENGINE_SPAN / 100));
      emit({
        percent,
        message: downloading ? message : message.replace(/\.\.\.$/, '...'),
        phase: downloading ? 'downloading' : 'starting',
        ...(downloading && bytes.bytesTotal
          ? { bytesLoaded: bytes.bytesLoaded, bytesTotal: bytes.bytesTotal, speedMBs: Number(speed.toFixed(1)) }
          : {}),
      });
    },
  });

  try {
    await converter.initialize();
  } catch (err) {
    try { await converter.destroy?.(); } catch { /* ignore */ }
    throw err;
  } finally {
    if (bc) bc.close();
  }

  loadedWithCjk = needsCjk;
  emit({ percent: 90, message: 'Engine ready.', phase: 'starting' });
  return converter;
}

/**
 * Shared engine loader. Safe to call many times: one load, many listeners.
 * @param {object|Function} [options] {needsCjk, onProgress} or just onProgress
 */
export async function getConverter(options = {}) {
  const opts = typeof options === 'function' ? { onProgress: options } : options;
  const { needsCjk = false, onProgress } = opts;

  if (onProgress) {
    listeners.add(onProgress);
    if (lastProgress) onProgress(lastProgress); // catch up if a warm-up is already running
  }

  try {
    // Engine was loaded without CJK fonts but this document needs them: rebuild once.
    if (loadPromise && needsCjk && !loadedWithCjk) {
      const old = await loadPromise.catch(() => null);
      try { await old?.destroy?.(); } catch { /* ignore */ }
      loadPromise = null;
    }

    if (!loadPromise) {
      lastProgress = null;
      const p = loadEngine(needsCjk);
      loadPromise = p;
      p.catch(() => { if (loadPromise === p) loadPromise = null; }); // allow retry after failure
    }
    return await loadPromise;
  } finally {
    if (onProgress) listeners.delete(onProgress);
  }
}

/**
 * Background pre-load. Never throws: a failed warm-up just means the real
 * convert click will try again (and show the real error).
 */
export function warmEngine(options = {}) {
  if (!canWarmEngine() || !isCrossOriginIsolated()) return Promise.resolve(null);
  return getConverter({ needsCjk: !!options.needsCjk }).catch((err) => {
    console.warn('[libreofficeWasm] warmEngine failed:', err);
    return null;
  });
}

/**
 * Converts a .docx file to a vector PDF via LibreOffice WASM.
 * @param {File|Blob} file
 * @param {(p: {percent:number,message:string,phase?:string,bytesLoaded?:number,bytesTotal?:number,speedMBs?:number}) => void} [onProgress]
 * @param {{needsCjk?: boolean}} [options]
 * @returns {Promise<Blob>}
 */
export async function docxToPdfAccurate(file, onProgress, options = {}) {
  if (!file) throw new Error('No input file provided.');

  if (file.size > MAX_DOCX_WASM_SIZE) {
    throw new Error(
      `File exceeds the 50MB browser WASM limit (${(file.size / 1024 / 1024).toFixed(1)}MB). Please use Quick mode or split the file.`
    );
  }

  const { needsCjk = false } = options;

  // Serial queue: LibreOffice WASM cannot run two conversions at once
  const runConversion = async () => {
    const converter = await getConverter({ needsCjk, onProgress });

    onProgress?.({ percent: 92, message: 'Converting document layout via LibreOffice...', phase: 'converting' });
    const uint8Array = new Uint8Array(await file.arrayBuffer());

    // Sanitize filename for safe filesystem handling
    const safeName = (file.name || 'document.docx').replace(/[^a-zA-Z0-9._-]/g, '_');

    const result = await converter.convert(uint8Array, { outputFormat: 'pdf' }, safeName);
    if (!result || !result.data) {
      throw new Error('LibreOffice WASM engine produced an empty output.');
    }

    onProgress?.({ percent: 100, message: 'Document converted successfully.', phase: 'complete' });
    return new Blob([result.data], { type: 'application/pdf' });
  };

  const currentJob = conversionLock.then(runConversion);
  conversionLock = currentJob.catch(() => {});
  return currentJob;
}
