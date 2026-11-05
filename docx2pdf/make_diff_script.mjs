import fs from 'node:fs';

const wasmB64 = fs.readFileSync('out_styles_cascade.pdf').toString('base64');
const loB64 = fs.readFileSync('out_libreoffice.pdf').toString('base64');

const script = `(async () => {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function b64ToUint8(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  async function renderToCanvas(b64) {
    const data = b64ToUint8(b64);
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { ctx, w: canvas.width, h: canvas.height };
  }
  const wasm = await renderToCanvas("${wasmB64}");
  const lo = await renderToCanvas("${loB64}");
  const w = Math.min(wasm.w, lo.w);
  const h = Math.min(wasm.h, lo.h);
  const wData = wasm.ctx.getImageData(0, 0, w, h).data;
  const lData = lo.ctx.getImageData(0, 0, w, h).data;
  let total = w * h, matching = 0, diff = 0;
  for (let i = 0; i < wData.length; i += 4) {
    const delta = (Math.abs(wData[i] - lData[i]) + Math.abs(wData[i+1] - lData[i+1]) + Math.abs(wData[i+2] - lData[i+2])) / 3;
    if (delta < 30) matching++; else diff++;
  }
  return {
    dimensions: w + "x" + h,
    totalPixels: total,
    matchingPixels: matching,
    diffPixels: diff,
    similarity: ((matching / total) * 100).toFixed(2) + "%"
  };
})()`;

fs.writeFileSync('render_script.js', script);
console.log('Script written');
