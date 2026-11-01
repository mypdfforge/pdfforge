import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');

const publicDistDir = path.join(frontendRoot, 'public', 'dist');
const publicWasmDir = path.join(frontendRoot, 'public', 'wasm');
const nodeModulesPkg = path.join(frontendRoot, 'node_modules', '@matbee', 'libreoffice-converter', 'wasm');

fs.mkdirSync(publicDistDir, { recursive: true });
fs.mkdirSync(publicWasmDir, { recursive: true });

function findFile(filename) {
  const candidates = [
    path.join(publicDistDir, filename),
    path.join(publicWasmDir, filename),
    path.join(nodeModulesPkg, filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const wasmPath = findFile('soffice.wasm');
const dataPath = findFile('soffice.data');
const jsPath = findFile('soffice.js');

if (!wasmPath || !dataPath) {
  console.error('[compress-engine] FATAL: Missing soffice.wasm or soffice.data.');
  console.error(`  WASM: ${wasmPath || 'NOT FOUND'}`);
  console.error(`  DATA: ${dataPath || 'NOT FOUND'}`);
  process.exit(1);
}

// Ensure originals exist in public/dist
const destWasm = path.join(publicDistDir, 'soffice.wasm');
const destData = path.join(publicDistDir, 'soffice.data');
const destJs = path.join(publicDistDir, 'soffice.js');

if (!fs.existsSync(destWasm) || fs.statSync(destWasm).size !== fs.statSync(wasmPath).size) {
  fs.copyFileSync(wasmPath, destWasm);
}
if (!fs.existsSync(destData) || fs.statSync(destData).size !== fs.statSync(dataPath).size) {
  fs.copyFileSync(dataPath, destData);
}
if (jsPath && (!fs.existsSync(destJs) || fs.statSync(destJs).size !== fs.statSync(jsPath).size)) {
  fs.copyFileSync(jsPath, destJs);
}

console.log('[compress-engine] Reading uncompressed engine assets...');
const wasmBuf = fs.readFileSync(destWasm);
const dataBuf = fs.readFileSync(destData);

console.log(`  soffice.wasm: ${(wasmBuf.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`  soffice.data: ${(dataBuf.length / 1024 / 1024).toFixed(2)} MB`);

// SHA256 version hash over both files
const sha256 = crypto.createHash('sha256');
sha256.update(wasmBuf);
sha256.update(dataBuf);
const version = sha256.digest('hex').slice(0, 8);
console.log(`[compress-engine] Engine version: ${version}`);

// Brotli compress quality 9 with size hint
console.log('[compress-engine] Compressing soffice.wasm with Brotli (q9)...');
const t0Wasm = Date.now();
const wasmBr = zlib.brotliCompressSync(wasmBuf, {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: wasmBuf.length,
  },
});
const wasmBrPath = path.join(publicDistDir, 'soffice.wasm.br');
fs.writeFileSync(wasmBrPath, wasmBr);
console.log(`  ✓ soffice.wasm.br: ${(wasmBr.length / 1024 / 1024).toFixed(2)} MB in ${((Date.now() - t0Wasm) / 1000).toFixed(1)}s`);

console.log('[compress-engine] Compressing soffice.data with Brotli (q9)...');
const t0Data = Date.now();
const dataBr = zlib.brotliCompressSync(dataBuf, {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: dataBuf.length,
  },
});
const dataBrPath = path.join(publicDistDir, 'soffice.data.br');
fs.writeFileSync(dataBrPath, dataBr);
console.log(`  ✓ soffice.data.br: ${(dataBr.length / 1024 / 1024).toFixed(2)} MB in ${((Date.now() - t0Data) / 1000).toFixed(1)}s`);

// Also mirror to public/wasm for backwards compatibility
fs.copyFileSync(wasmBrPath, path.join(publicWasmDir, 'soffice.wasm.br'));
fs.copyFileSync(dataBrPath, path.join(publicWasmDir, 'soffice.data.br'));

const manifest = {
  version,
  files: {
    'soffice.wasm': {
      decodedBytes: wasmBuf.length,
      encodedBytes: wasmBr.length,
    },
    'soffice.data': {
      decodedBytes: dataBuf.length,
      encodedBytes: dataBr.length,
    },
  },
};

const manifestPath = path.join(publicDistDir, 'engine-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.copyFileSync(manifestPath, path.join(publicWasmDir, 'engine-manifest.json'));

console.log(`  ✓ engine-manifest.json written (version: ${version})`);
console.log(`[compress-engine] Total compressed payload: ${((wasmBr.length + dataBr.length) / 1024 / 1024).toFixed(2)} MB (down from ${((wasmBuf.length + dataBuf.length) / 1024 / 1024).toFixed(2)} MB)`);
