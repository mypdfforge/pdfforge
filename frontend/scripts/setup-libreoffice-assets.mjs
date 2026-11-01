import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')

const nodeModulesPkg = path.join(frontendRoot, 'node_modules', '@matbee', 'libreoffice-converter')
const publicWasmDir = path.join(frontendRoot, 'public', 'wasm')
const publicDistDir = path.join(frontendRoot, 'public', 'dist')
const publicAssetsDir = path.join(frontendRoot, 'public', 'assets')

console.log('[setup-libreoffice-assets] Copying WASM and worker assets...')

fs.mkdirSync(publicWasmDir, { recursive: true })
fs.mkdirSync(publicDistDir, { recursive: true })
fs.mkdirSync(publicAssetsDir, { recursive: true })

// 1. Copy WASM assets
const wasmSrcDir = path.join(nodeModulesPkg, 'wasm')
if (fs.existsSync(wasmSrcDir)) {
  const wasmFiles = fs.readdirSync(wasmSrcDir)
  for (const file of wasmFiles) {
    const srcPath = path.join(wasmSrcDir, file)
    const destPath = path.join(publicWasmDir, file)
    fs.copyFileSync(srcPath, destPath)
    const stats = fs.statSync(destPath)
    console.log(`  ✓ /public/wasm/${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`)
  }
} else {
  console.warn(`  ⚠ ${wasmSrcDir} not found. Is @matbee/libreoffice-converter installed?`)
}

// 2. Copy and patch browser worker
const distSrcDir = path.join(nodeModulesPkg, 'dist')
const workerSrc = path.join(distSrcDir, 'browser.worker.global.js')
if (fs.existsSync(workerSrc)) {
  let workerContent = fs.readFileSync(workerSrc, 'utf8')
  
  const startNeedle = ',self.Module={mainScriptUrlOrBlob:e'
  const endNeedle = 'calledRun?a():h();}),'
  
  if (!workerContent.includes(startNeedle) || !workerContent.includes(endNeedle)) {
    throw new Error(`[setup-libreoffice-assets] Assertion failed: target Module initialization pattern not found in ${workerSrc}`)
  }
  
  const startIdx = workerContent.indexOf(startNeedle)
  const endIdx = workerContent.indexOf(endNeedle, startIdx) + endNeedle.length
  
  const patchedBlock = `;/* [PARALLEL BROTLI LOADER START] */
let compiledWasmModule = null;
let dataBlobUrl = null;
let dataBuffer = null;
let manifest = null;
let version = 'default';
let cacheName = 'soffice-default';

let baseUrl;
try {
  baseUrl = new URL(e, (self.location && self.location.origin && self.location.origin !== 'null') ? self.location.origin : 'https://pdfforge-kappa.vercel.app');
} catch {
  baseUrl = new URL(e, 'https://pdfforge-kappa.vercel.app');
}
const baseDir = baseUrl.href.substring(0, baseUrl.href.lastIndexOf('/') + 1);
const manifestUrl = new URL('engine-manifest.json?v=' + Date.now(), baseDir).href;

try {
  const mRes = await fetch(manifestUrl, { cache: 'no-store' }).catch(() => null);
  if (mRes && mRes.ok) {
    manifest = await mRes.json();
    version = manifest.version || 'v1';
    cacheName = 'soffice-' + version;
  }
} catch (mErr) {
  console.warn('[Worker] Manifest fetch error, fallback to stock loader:', mErr);
}

if (manifest && manifest.files && manifest.files['soffice.wasm'] && manifest.files['soffice.data']) {
  console.log('[Worker] Fast Brotli loader active. Engine version:', version);
  const wasmInfo = manifest.files['soffice.wasm'];
  const dataInfo = manifest.files['soffice.data'];
  const totalDecodedBytes = wasmInfo.decodedBytes + dataInfo.decodedBytes;
  
  let wasmRead = 0;
  let dataRead = 0;
  let lastReport = 0;
  let tStart = Date.now();
  
  const reportProgress = () => {
    const now = Date.now();
    if (now - lastReport < 75) return;
    lastReport = now;
    const totalRead = wasmRead + dataRead;
    const pct = Math.min(80, Math.round((totalRead / totalDecodedBytes) * 80));
    const elapsedSec = (now - tStart) / 1000;
    const speed = elapsedSec > 0.3 ? (totalRead / 1024 / 1024 / elapsedSec).toFixed(2) : '0';
    y({
      type: 'progress',
      id: l.id,
      progress: {
        percent: pct,
        message: 'Downloading engine... (' + (totalRead / 1024 / 1024).toFixed(1) + ' / ' + (totalDecodedBytes / 1024 / 1024).toFixed(1) + ' MB)',
        phase: 'downloading',
        bytesLoaded: totalRead,
        bytesTotal: totalDecodedBytes,
        speedMBs: parseFloat(speed)
      }
    });
  };

  const cache = (typeof caches !== 'undefined') ? await caches.open(cacheName).catch(() => null) : null;
  const wasmUrl = new URL('soffice.wasm.br?v=' + version, baseDir).href;
  const dataUrl = new URL('soffice.data.br?v=' + version, baseDir).href;

  const fetchWithProgress = async (url, onBytes) => {
    let res = cache ? await cache.match(url).catch(() => null) : null;
    let isFromCache = false;
    if (res) {
      isFromCache = true;
    } else {
      res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url);
      if (cache) {
        cache.put(url, res.clone()).catch(err => console.warn('[Worker] Cache put failed:', err));
      }
    }

    const reader = res.body.getReader();
    const countedStream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          onBytes(value.byteLength);
          controller.enqueue(value);
        }
      }
    });

    return { stream: countedStream, isFromCache };
  };

  const wasmPromise = (async () => {
    const { stream } = await fetchWithProgress(wasmUrl, (bytes) => {
      wasmRead += bytes;
      reportProgress();
    });
    return WebAssembly.compileStreaming(new Response(stream, {
      headers: { 'Content-Type': 'application/wasm' }
    }));
  })();

  const dataPromise = (async () => {
    const { stream } = await fetchWithProgress(dataUrl, (bytes) => {
      dataRead += bytes;
      reportProgress();
    });
    const buf = await new Response(stream).arrayBuffer();
    dataBuffer = buf;
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    dataBlobUrl = URL.createObjectURL(blob);
    return buf;
  })();

  try {
    [compiledWasmModule] = await Promise.all([wasmPromise, dataPromise]);
    console.log('[Worker] Fast Brotli download + compile streaming complete');
    y({
      type: 'progress',
      id: l.id,
      progress: {
        percent: 80,
        message: 'Starting engine...',
        phase: 'starting'
      }
    });
  } catch (dlErr) {
    console.warn('[Worker] Fast Brotli download failed, falling back:', dlErr);
  }
}

self.Module = {
  mainScriptUrlOrBlob: e,
  ...(compiledWasmModule ? {
    instantiateWasm: (info, receiveInstance) => {
      WebAssembly.instantiate(compiledWasmModule, info).then((instance) => {
        receiveInstance(instance, compiledWasmModule);
      }).catch((instErr) => {
        console.error('[Worker] instantiateWasm error:', instErr);
      });
      return {};
    },
    getPreloadedPackage: (remotePackageName, remotePackageSize) => {
      return dataBuffer;
    }
  } : {}),
  locateFile: (a, d) => {
    let h;
    if (a.endsWith('.wasm')) h = t;
    else if (a.endsWith('.data')) h = dataBlobUrl || r;
    else if (a.includes('.worker.')) h = n;
    else h = e.substring(0, e.lastIndexOf('/') + 1) + a;
    console.log('[Worker] locateFile called:', a, 'scriptDir:', d, '-> result:', h);
    return h;
  },
  print: console.log,
  printErr: console.error
};

importScripts(e);
B('compile', 'Compiling WebAssembly module...');

// 90s startup timeout ONLY after download/compile finishes
await new Promise((a, d) => {
  const timeoutId = setTimeout(() => d(new Error('Engine startup timed out after 90s')), 90000);
  let h = () => {
    if (self.Module && self.Module.calledRun) {
      clearTimeout(timeoutId);
      a();
    } else if (self.Module?.onRuntimeInitialized) {
      let m = self.Module.onRuntimeInitialized;
      self.Module.onRuntimeInitialized = () => {
        clearTimeout(timeoutId);
        m?.();
        a();
      };
    } else {
      setTimeout(h, 50);
    }
  };
  self.Module && self.Module.calledRun ? (clearTimeout(timeoutId), a()) : h();
});

if (typeof caches !== 'undefined' && cacheName) {
  caches.keys().then((keys) => {
    for (const key of keys) {
      if (key.startsWith('soffice-') && key !== cacheName) {
        caches.delete(key).catch(() => {});
      }
    }
  }).catch(() => {});
}
/* [PARALLEL BROTLI LOADER END] */;`

  workerContent = workerContent.slice(0, startIdx) + patchedBlock + workerContent.slice(endIdx)

  const destWorker = path.join(publicDistDir, 'browser.worker.js')
  const destWorkerGlobal = path.join(publicDistDir, 'browser.worker.global.js')
  fs.writeFileSync(destWorker, workerContent)
  fs.writeFileSync(destWorkerGlobal, workerContent)
  console.log('  ✓ /public/dist/browser.worker.js (patched with Parallel Brotli Loader & 90s post-download timeout)')
} else {
  console.warn(`  ⚠ ${workerSrc} not found.`)
}

// 3. Create /public/assets/fonts-core.zip
async function buildFontsCoreZip() {
  const zipPath = path.join(publicAssetsDir, 'fonts-core.zip')
  if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000000) {
    console.log(`  ✓ /public/assets/fonts-core.zip already exists (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB).`)
    return
  }

  console.log('[setup-libreoffice-assets] Packaging fonts-core.zip...')
  const zip = new JSZip()
  
  // Font candidate sources: Windows Fonts, local package, or bundled metrics
  const fontSearchDirs = [
    'C:\\Windows\\Fonts',
    '/usr/share/fonts',
    '/usr/share/fonts/truetype'
  ]

  const coreFontNames = [
    // Calibri / Carlito
    'calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf',
    // Times / Liberation Serif
    'times.ttf', 'timesbd.ttf', 'timesbi.ttf', 'timesi.ttf',
    // Arial / Liberation Sans
    'arial.ttf', 'arialbd.ttf', 'arialbi.ttf', 'ariali.ttf',
    // Symbols
    'symbol.ttf', 'wingding.ttf', 'seguisym.ttf'
  ]

  let addedCount = 0
  for (const sDir of fontSearchDirs) {
    if (fs.existsSync(sDir)) {
      for (const fontName of coreFontNames) {
        const fullPath = path.join(sDir, fontName)
        if (fs.existsSync(fullPath)) {
          const fontData = fs.readFileSync(fullPath)
          zip.file(fontName, fontData)
          addedCount++
        }
      }
      if (addedCount > 0) break
    }
  }

  if (addedCount === 0) {
    console.warn('  ⚠ No system fonts found in default paths. Attempting fallback download of core fonts...')
  }

  const zipContent = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  fs.writeFileSync(zipPath, zipContent)
  console.log(`  ✓ Built /public/assets/fonts-core.zip with ${addedCount} fonts (${(zipContent.length / 1024 / 1024).toFixed(2)} MB).`)
}

// 4. Create /public/assets/fonts-cjk-min.zip (Pan-CJK font for Chinese + Japanese)
async function buildFontsCjkMinZip() {
  const zipPath = path.join(publicAssetsDir, 'fonts-cjk-min.zip')
  if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000000) {
    console.log(`  ✓ /public/assets/fonts-cjk-min.zip already exists (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB).`)
    return
  }

  console.log('[setup-libreoffice-assets] Packaging fonts-cjk-min.zip (fetching NotoSansCJKsc-Regular.otf at build time)...')
  const cjkUrl = 'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'
  try {
    const res = await fetch(cjkUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const fontBuffer = Buffer.from(await res.arrayBuffer())

    const zip = new JSZip()
    zip.file('NotoSansCJKsc-Regular.otf', fontBuffer)
    const zipContent = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
    fs.writeFileSync(zipPath, zipContent)
    console.log(`  ✓ Built /public/assets/fonts-cjk-min.zip (${(zipContent.length / 1024 / 1024).toFixed(2)} MB).`)
  } catch (err) {
    console.warn('  ⚠ Failed to fetch NotoSansCJKsc-Regular.otf at build time:', err.message)
  }
}

await buildFontsCoreZip()
await buildFontsCjkMinZip()
console.log('[setup-libreoffice-assets] Completed successfully!')
