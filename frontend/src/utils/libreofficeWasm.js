/**
 * libreofficeWasm.js - Client-Side LibreOffice WASM Converter
 *
 * Runs headless LibreOffice inside a dedicated Web Worker in the browser.
 * 100% on-device, zero network upload, MPL-2.0 license.
 */

// Practical file size ceiling for browser WASM memory (prevents tab crashes)
export const MAX_DOCX_WASM_SIZE = 50 * 1024 * 1024; // 50 MB

let converterSingleton = null;
let converterLoadedCjk = false;
let conversionLock = Promise.resolve();

/**
 * Checks whether the browser execution environment meets security requirements
 * for WebAssembly multithreading & SharedArrayBuffer (COOP/COEP isolation).
 */
export function isCrossOriginIsolated() {
  return typeof self !== 'undefined' && self.crossOriginIsolated === true;
}

/**
 * Checks if the ~240MB LibreOffice WASM engine is already cached in CacheStorage.
 * @returns {Promise<boolean>}
 */
export async function isWasmEngineCached() {
  if (typeof caches === 'undefined') return false;
  try {
    const keys = await caches.keys();
    for (const key of keys) {
      const cache = await caches.open(key);
      const match = await cache.match('/wasm/soffice.wasm');
      if (match) return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Lazy loads and initializes the LibreOffice WASM converter singleton.
 * Engine assets load ONLY when this function is invoked.
 * @param {object} [options]
 * @param {boolean} [options.needsCjk=false] Whether CJK font pack (/assets/fonts-cjk-min.zip) is required
 * @param {(progress: { percent: number, message: string }) => void} [options.onProgress]
 */
export async function getConverter(options = {}) {
  // Support either getConverter(onProgress) or getConverter({ needsCjk, onProgress })
  const opts = typeof options === 'function' ? { onProgress: options } : options;
  const { needsCjk = false, onProgress } = opts;

  if (converterSingleton) {
    if (needsCjk && !converterLoadedCjk) {
      // Re-initialize converter to inject CJK fonts into LibreOffice WASM virtual filesystem
      onProgress?.({ percent: 5, message: 'Re-initializing engine with CJK font support...' });
      try {
        await converterSingleton.destroy?.();
      } catch (err) {
        console.warn('[libreofficeWasm] Error destroying previous worker:', err);
      }
      converterSingleton = null;
      converterLoadedCjk = false;
    } else {
      return converterSingleton;
    }
  }

  if (!isCrossOriginIsolated()) {
    throw new Error(
      'Accurate conversion is unavailable: browser security headers (COOP/COEP) are not isolated. Please use Quick mode.'
    );
  }

  onProgress?.({ percent: 5, message: 'Loading LibreOffice WASM engine modules...' });

  const { WorkerBrowserConverter, createWasmPaths, loadFontsFromUrl } = await import(
    '@matbee/libreoffice-converter/browser'
  );

  onProgress?.({ percent: 12, message: 'Loading core typography fonts...' });

  let fonts = [];
  try {
    fonts = await loadFontsFromUrl('/assets/fonts-core.zip');
  } catch (fontErr) {
    console.warn('[libreofficeWasm] Core fonts load warning:', fontErr);
  }

  if (needsCjk) {
    onProgress?.({ percent: 20, message: 'Downloading font pack (~13 MB, cached for next time)...' });
    try {
      const cjkFonts = await loadFontsFromUrl('/assets/fonts-cjk-min.zip');
      if (Array.isArray(cjkFonts)) {
        fonts = [...fonts, ...cjkFonts];
      }
      converterLoadedCjk = true;
    } catch (cjkErr) {
      console.warn('[libreofficeWasm] CJK fonts load warning:', cjkErr);
    }
  } else {
    converterLoadedCjk = false;
  }

  onProgress?.({ percent: 25, message: 'Initializing LibreOffice WebAssembly worker...' });

  const wasmPaths = createWasmPaths('/wasm/');
  const converter = new WorkerBrowserConverter({
    ...wasmPaths,
    browserWorkerJs: '/dist/browser.worker.js',
    fonts,
    onProgress: (progressInfo) => {
      if (progressInfo && typeof progressInfo === 'object') {
        const pct = progressInfo.percent || 30;
        const msg = progressInfo.message || 'Loading engine files...';
        onProgress?.({ percent: Math.min(Math.max(pct, 25), 90), message: msg });
      }
    },
  });

  await converter.initialize();
  converterSingleton = converter;

  onProgress?.({ percent: 100, message: 'Engine ready.' });
  return converterSingleton;
}

/**
 * Converts a .docx file to a high-fidelity vector PDF via LibreOffice WASM.
 * @param {File|Blob} file
 * @param {(progress: { percent: number, message: string }) => void} [onProgress]
 * @param {object} [options]
 * @param {boolean} [options.needsCjk=false]
 * @returns {Promise<Blob>}
 */
export async function docxToPdfAccurate(file, onProgress, options = {}) {
  if (!file) {
    throw new Error('No input file provided.');
  }

  if (file.size > MAX_DOCX_WASM_SIZE) {
    throw new Error(
      `File exceeds the 50MB browser WASM limit (${(file.size / 1024 / 1024).toFixed(1)}MB). Please use Quick mode or split the file.`
    );
  }

  const { needsCjk = false } = options;

  // Ensure conversions run serially through a queue to prevent WASM thread collisions
  const runConversion = async () => {
    onProgress?.({ percent: 10, message: 'Preparing document in memory...' });
    const converter = await getConverter({ needsCjk, onProgress });

    onProgress?.({ percent: 92, message: 'Converting document layout via LibreOffice...' });
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Sanitize filename for privacy and safe filesystem handling
    const safeName = (file.name || 'document.docx').replace(/[^a-zA-Z0-9._-]/g, '_');

    const result = await converter.convert(
      uint8Array,
      { outputFormat: 'pdf' },
      safeName
    );

    if (!result || !result.data) {
      throw new Error('LibreOffice WASM engine produced an empty output.');
    }

    onProgress?.({ percent: 100, message: 'Document converted successfully.' });
    return new Blob([result.data], { type: 'application/pdf' });
  };

  const currentJob = conversionLock.then(runConversion);
  conversionLock = currentJob.catch(() => {});
  return currentJob;
}
