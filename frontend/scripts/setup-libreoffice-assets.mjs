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

// 1. Copy WASM assets to both /public/wasm and /public/dist
const wasmSrcDir = path.join(nodeModulesPkg, 'wasm')
if (fs.existsSync(wasmSrcDir)) {
  const wasmFiles = fs.readdirSync(wasmSrcDir)
  for (const file of wasmFiles) {
    const srcPath = path.join(wasmSrcDir, file)
    const destWasmPath = path.join(publicWasmDir, file)
    const destDistPath = path.join(publicDistDir, file)
    fs.copyFileSync(srcPath, destWasmPath)
    fs.copyFileSync(srcPath, destDistPath)
    const stats = fs.statSync(destDistPath)
    console.log(`  ✓ /public/dist/${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`)
  }
} else {
  console.warn(`  ⚠ ${wasmSrcDir} not found. Is @matbee/libreoffice-converter installed?`)
}

// 2. Copy and patch browser worker
const distSrcDir = path.join(nodeModulesPkg, 'dist')
const workerSrc = path.join(distSrcDir, 'browser.worker.global.js')
if (fs.existsSync(workerSrc)) {
  let workerContent = fs.readFileSync(workerSrc, 'utf8')
  
  // The stock worker is minified. Every name we rely on is asserted so a package
  // upgrade fails the build loudly instead of silently shipping a broken loader.
  const startNeedle = ',self.Module={mainScriptUrlOrBlob:e'
  const endNeedle = 'calledRun?a():h();}),'
  const mustHave = [
    startNeedle,
    endNeedle,
    'var pe={"download-wasm":50,"download-data":30,',
    ',x={"download-wasm":0,"download-data":0,',
    ',ge=0,ee=0;',
    'function fe(){',
    'function ye(l){self.postMessage({type:"progress",id:ge,progress:l});}',
    'function B(l,e){',
    'B("download-wasm","Preparing to download WebAssembly...");try{',
  ]
  for (const needle of mustHave) {
    if (!workerContent.includes(needle)) {
      throw new Error(`[setup-libreoffice-assets] Stock worker changed, pattern not found: ${needle}\n  Pin @matbee/libreoffice-converter or update the patch.`)
    }
  }

  workerContent = workerContent.replace(
    'B("download-wasm","Preparing to download WebAssembly...");try{',
    'ye({percent:0,message:"Preparing to download WebAssembly...",phase:"download-wasm"});try{'
  )

  const startIdx = workerContent.indexOf(startNeedle)
  const endIdx = workerContent.indexOf(endNeedle, startIdx) + endNeedle.length

  // Replaces: Module setup + importScripts + startup wait (stock has a 120s timer that
  // also counts the download). New: parallel Brotli download, streaming WASM compile,
  // progress through the stock tracker (monotonic), 90s timer only for startup.
  const patchedBlock = String.raw`;/* [FAST LOADER START] */
let fastLoad=null,failStart=null;
try{
  const dir=new URL(e,self.location.href).href.replace(/[^/]*$/,"");
  const mRes=await fetch(dir+"engine-manifest.json",{cache:"no-store"});
  if(!mRes.ok)throw new Error("manifest HTTP "+mRes.status);
  const man=await mRes.json(),W=man.files["soffice.wasm"],D=man.files["soffice.data"];
  if(!W||!D)throw new Error("manifest incomplete");
  const cacheName="soffice-"+man.version;
  const cache=typeof caches!=="undefined"?await caches.open(cacheName).catch(()=>null):null;
  const bc=typeof BroadcastChannel!=="undefined"?new BroadcastChannel("soffice-progress"):null;
  const netTotal=W.encodedBytes+D.encodedBytes;
  let wRead=0,dRead=0,last=0;
  const mb=v=>(v/1048576).toFixed(1);
  const report=force=>{
    const now=Date.now();
    if(!force&&now-last<100)return;
    last=now;
    const w50=50*wRead/W.decodedBytes,d30=30*dRead/D.decodedBytes;
    if(w50>x["download-wasm"])x["download-wasm"]=w50;
    if(d30>x["download-data"])x["download-data"]=d30;
    const net=wRead*W.encodedBytes/W.decodedBytes+dRead*D.encodedBytes/D.decodedBytes;
    ye({percent:fe(),message:"Downloading engine... "+mb(net)+" / "+mb(netTotal)+" MB",phase:"download-wasm"});
    if(bc)bc.postMessage({bytesLoaded:net,bytesTotal:netTotal});
  };
  const open=async name=>{
    const url=dir+name+".br?v="+man.version;
    let res=cache?await cache.match(url).catch(()=>null):null;
    let putP=Promise.resolve();
    if(!res){
      res=await fetch(url);
      if(!res.ok)throw new Error("HTTP "+res.status+" for "+url);
      if(res.headers.get("content-encoding")!=="br")throw new Error("server did not send Content-Encoding: br for "+url);
      if(cache)putP=cache.put(url,res.clone()).catch(()=>{});
    }
    return{res,drop:()=>putP.then(()=>cache&&cache.delete(url)).catch(()=>{})};
  };
  const wasmP=(async()=>{
    const{res,drop}=await open("soffice.wasm");
    const buf=new Uint8Array(W.decodedBytes);
    let off=0;
    const rd=res.body.getReader();
    try{
      for(;;){
        const{done,value}=await rd.read();
        if(done)break;
        if(off+value.byteLength>buf.byteLength)throw new Error("wasm larger than manifest");
        buf.set(value,off);off+=value.byteLength;wRead=off;report();
      }
      if(wRead!==W.decodedBytes)throw new Error("wasm size mismatch");
      return await WebAssembly.compile(buf.buffer);
    }catch(er){drop();throw er}
  })();
  const dataP=(async()=>{
    const{res,drop}=await open("soffice.data");
    const buf=new Uint8Array(D.decodedBytes);
    let off=0;
    const rd=res.body.getReader();
    try{
      for(;;){
        const{done,value}=await rd.read();
        if(done)break;
        if(off+value.byteLength>buf.byteLength)throw new Error("data larger than manifest");
        buf.set(value,off);off+=value.byteLength;dRead=off;report();
      }
      if(off!==buf.byteLength)throw new Error("data size mismatch");
      return buf.buffer;
    }catch(er){drop();throw er}
  })();
  const[mod,data]=await Promise.all([wasmP,dataP]);
  report(true);
  if(bc)bc.close();
  fastLoad={mod,data,cacheName};
}catch(er){
  console.warn("[Worker] Fast loader failed, using stock download:",er);
  fastLoad=null;
  ye({percent:fe(),message:"Fast download unavailable, using standard download...",phase:"download-wasm"});
}
self.Module={mainScriptUrlOrBlob:e,
  ...(fastLoad?{
    instantiateWasm:(info,ok)=>{
      WebAssembly.instantiate(fastLoad.mod,info).then(i=>ok(i,fastLoad.mod),er=>{if(failStart)failStart(er)});
      return{};
    },
    getPreloadedPackage:()=>{const d=fastLoad.data;fastLoad.data=null;return d}
  }:{}),
  locateFile:(a,d)=>{let h;return a.endsWith(".wasm")?h=t:a.endsWith(".data")?h=r:a.includes(".worker.")?h=n:h=e.substring(0,e.lastIndexOf("/")+1)+a,console.log("[Worker] locateFile called:",a,"scriptDir:",d,"-> result:",h),h},
  print:console.log,printErr:console.error};
importScripts(e);
B("compile","Compiling WebAssembly module...");
await new Promise((a,d)=>{
  const ms=fastLoad?9e4:3e5;
  const tm=setTimeout(()=>d(new Error("Engine startup timed out after "+ms/1000+"s")),ms);
  const fin=()=>{clearTimeout(tm);a()};
  failStart=er=>{clearTimeout(tm);d(er)};
  const M=self.Module;
  if(M.calledRun)fin();
  else{const prev=M.onRuntimeInitialized;M.onRuntimeInitialized=()=>{if(prev)prev();fin()}}
});
if(fastLoad){
  delete self.Module.getPreloadedPackage;
  if(typeof caches!=="undefined")caches.keys().then(ks=>ks.forEach(k=>{if(k.startsWith("soffice-")&&k!==fastLoad.cacheName)caches.delete(k)})).catch(()=>{});
}
/* [FAST LOADER END] */;`

  workerContent = workerContent.slice(0, startIdx) + patchedBlock + workerContent.slice(endIdx)

  const destWorker = path.join(publicDistDir, 'browser.worker.js')
  const destWorkerGlobal = path.join(publicDistDir, 'browser.worker.global.js')
  fs.writeFileSync(destWorker, workerContent)
  fs.writeFileSync(destWorkerGlobal, workerContent)
  console.log('  ✓ /public/dist/browser.worker.js (patched: fast Brotli loader, 90s startup timeout)')
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

  // The engine ships NO fonts (verified: soffice.data has none). Vercel's Linux build box has none of
  // the Windows names above, so without this the zip is empty and LibreOffice can crash ("null function").
  // 1) any .ttf/.otf you drop into scripts/fonts/ (e.g. Liberation Sans/Serif for Arial/Times look-alikes)
  const localFontsDir = path.join(__dirname, 'fonts')
  if (fs.existsSync(localFontsDir)) {
    for (const f of fs.readdirSync(localFontsDir)) {
      if (/\.(ttf|otf)$/i.test(f)) { zip.file(f, fs.readFileSync(path.join(localFontsDir, f))); addedCount++ }
    }
  }
  // 2) still nothing: fetch Carlito (open-licence, metric-compatible with Calibri)
  if (addedCount === 0) {
    console.warn('  ⚠ No fonts found locally. Fetching Carlito (Calibri look-alike)...')
    const base = 'https://raw.githubusercontent.com/googlefonts/carlito/main/fonts/ttf/'
    for (const n of ['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'Carlito-Italic.ttf', 'Carlito-BoldItalic.ttf']) {
      try {
        const res = await fetch(base + n)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        zip.file(n, Buffer.from(await res.arrayBuffer()))
        addedCount++
      } catch (err) {
        console.warn(`  ⚠ Could not fetch ${n}: ${err.message}`)
      }
    }
  }
  if (addedCount === 0) {
    throw new Error('[setup-libreoffice-assets] No core fonts available: Accurate convert would crash. Add .ttf files to scripts/fonts/.')
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
