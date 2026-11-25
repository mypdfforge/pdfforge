/**
 * pdfImageDecode.js — Decodes pdf.js XObject image payloads to PNG Uint8Array using OffscreenCanvas.
 * Runs inside pdfIngestWorker.js without touching the DOM.
 */
export async function decodePdfImage(img, { mask = false } = {}) {
  const w = img.width | 0;
  const h = img.height | 0;
  if (w <= 0 || h <= 0) throw new Error('Invalid image dimensions');

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');

  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0, w, h);
  } else if (img.data) {
    const src = img.data;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const nPix = w * h;

    if (src.length === nPix * 4) {
      rgba.set(src);
    } else if (src.length === nPix * 3) {
      for (let i = 0, j = 0; i < nPix; i++, j += 3) {
        const o = i * 4;
        rgba[o] = src[j];
        rgba[o + 1] = src[j + 1];
        rgba[o + 2] = src[j + 2];
        rgba[o + 3] = 255;
      }
    } else if (src.length === nPix) {
      for (let i = 0; i < nPix; i++) {
        const o = i * 4;
        const v = src[i];
        rgba[o] = v;
        rgba[o + 1] = v;
        rgba[o + 2] = v;
        rgba[o + 3] = mask ? (v ? 0 : 255) : 255;
      }
    } else {
      // 1-bit packed mask/monochrome fallback
      const rowBytes = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const byte = src[y * rowBytes + (x >> 3)] || 0;
          const bit = (byte >> (7 - (x & 7))) & 1;
          const o = (y * w + x) * 4;
          const v = bit ? 255 : 0;
          rgba[o] = v;
          rgba[o + 1] = v;
          rgba[o + 2] = v;
          rgba[o + 3] = mask ? (bit ? 0 : 255) : 255;
        }
      }
    }
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  } else {
    throw new Error('Unsupported pdf.js image payload');
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
