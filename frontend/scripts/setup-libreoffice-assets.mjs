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

// 2. Copy browser worker
const distSrcDir = path.join(nodeModulesPkg, 'dist')
const workerSrc = path.join(distSrcDir, 'browser.worker.global.js')
if (fs.existsSync(workerSrc)) {
  const destWorker = path.join(publicDistDir, 'browser.worker.js')
  const destWorkerGlobal = path.join(publicDistDir, 'browser.worker.global.js')
  fs.copyFileSync(workerSrc, destWorker)
  fs.copyFileSync(workerSrc, destWorkerGlobal)
  console.log('  ✓ /public/dist/browser.worker.js')
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
