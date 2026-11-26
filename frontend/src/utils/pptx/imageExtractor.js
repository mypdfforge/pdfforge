/**
 * imageExtractor.js — Extracts native raster image nodes from opWalk() events
 * and pdf.js page objects, handling transform decomposition, clipBox cropping,
 * pixel format normalization, and content-hash deduplication.
 */

import { zlibSync } from 'fflate';
import { decompose } from './slideCoords.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// CRC32 table for PNG chunk encoding
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(12 + len);
  const view = new DataView(out.buffer);
  view.setUint32(0, len, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + len, crc32(out.subarray(4, 8 + len)), false);
  return out;
}

function encodeRgbaToPng(rgba, width, height) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0; // filter: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowOff + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlibSync(raw, { level: 3 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const c1 = pngChunk('IHDR', ihdr);
  const c2 = pngChunk('IDAT', idat);
  const c3 = pngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let off = 0;
  for (const part of [sig, c1, c2, c3]) {
    png.set(part, off);
    off += part.length;
  }
  return png;
}

function fnv1aHash(bytes, width, height, mime) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(width);
  mix(width >> 8);
  mix(height);
  mix(height >> 8);
  for (let i = 0; i < mime.length; i++) mix(mime.charCodeAt(i));
  for (let i = 0; i < bytes.length; i++) mix(bytes[i]);
  return h.toString(16).padStart(8, '0');
}

function resolveObj(page, name) {
  if (!page || !name) return null;
  const stores = [page.objs, page.commonObjs].filter(Boolean);
  for (const store of stores) {
    if (typeof store.has === 'function' && !store.has(name)) continue;
    try {
      const obj = typeof store.get === 'function' ? store.get(name) : store[name];
      if (obj) return obj;
    } catch {
      // Ignore unresolved object
    }
  }
  return null;
}

function sniffMime(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  return null;
}

function toRgba(data, width, height, kind) {
  const pxCount = width * height;
  const rgba = new Uint8ClampedArray(pxCount * 4);
  let hasAlpha = false;

  if (kind === 3) {
    // RGBA
    const len = Math.min(data.length, rgba.length);
    rgba.set(data.subarray(0, len));
    for (let i = 3; i < len; i += 4) {
      if (rgba[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
  } else if (kind === 2) {
    // RGB
    for (let i = 0, j = 0; i < pxCount && j + 2 < data.length; i++, j += 3) {
      const o = i * 4;
      rgba[o] = data[j];
      rgba[o + 1] = data[j + 1];
      rgba[o + 2] = data[j + 2];
      rgba[o + 3] = 255;
    }
  } else if (kind === 1) {
    // Grayscale (8-bit or 1-bpp packed)
    if (data.length >= pxCount) {
      for (let i = 0; i < pxCount; i++) {
        const v = data[i];
        const o = i * 4;
        rgba[o] = v;
        rgba[o + 1] = v;
        rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
    } else {
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = data[y * rowBytes + (x >> 3)] ?? 0;
          const bit = (byte >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const o = (y * width + x) * 4;
          rgba[o] = v;
          rgba[o + 1] = v;
          rgba[o + 2] = v;
          rgba[o + 3] = 255;
        }
      }
    }
  }

  return { rgba, hasAlpha };
}

function encodeBitmap(bitmap, width, height) {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      let hasAlpha = false;
      for (let i = 3; i < imgData.data.length; i += 4) {
        if (imgData.data[i] < 255) {
          hasAlpha = true;
          break;
        }
      }
      return {
        data: encodeRgbaToPng(imgData.data, width, height),
        mime: 'image/png',
        alpha: hasAlpha,
      };
    }
  }
  return null;
}

function extractImagePayload(obj) {
  const width = obj.width || obj.bitmap?.width || 0;
  const height = obj.height || obj.bitmap?.height || 0;
  if (!width || !height) return null;

  if (obj.bitmap) {
    const encoded = encodeBitmap(obj.bitmap, width, height);
    if (encoded) return { ...encoded, width, height };
  }

  const raw = obj.data;
  if (!raw) return null;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

  // Check if already encoded JPEG/PNG bytes (e.g. paintJpegXObject)
  const sniffed = obj.mime || sniffMime(bytes);
  if (sniffed && !obj.kind) {
    return {
      data: bytes,
      mime: sniffed,
      width,
      height,
      alpha: sniffed === 'image/png',
    };
  }

  const kind = obj.kind ?? (bytes.length === width * height * 4 ? 3 : bytes.length === width * height * 3 ? 2 : 1);
  const { rgba, hasAlpha } = toRgba(bytes, width, height, kind);
  const png = encodeRgbaToPng(rgba, width, height);

  return {
    data: png,
    mime: 'image/png',
    width,
    height,
    alpha: hasAlpha,
  };
}

/**
 * Extracts native ImageNode[] from opWalk() events and pdf.js page objects.
 *
 * @param {object} page - pdf.js page (with `objs` / `commonObjs`)
 * @param {Array<object>} events - RawDrawEvent[] from walkOperators()
 * @param {object} [pageTf] - Page transform from makePageTransform()
 * @returns {Array<object>} ImageNode[]
 */
export function extractImages(page, events, pageTf) {
  const out = [];

  for (const e of events || []) {
    if (e.type !== 'image' && e.type !== 'inlineImage') continue;
    if (!e.raw || !e.unit) continue;

    const d = decompose(e.raw);
    if (d.skewed) continue;

    const obj = e.type === 'inlineImage' ? e.img : resolveObj(page, e.name);
    if (!obj || obj.smask) continue;

    const payload = extractImagePayload(obj);
    if (!payload) continue;

    let rect = { ...e.unit };
    let crop = null;

    if (e.clipBox && rect.w > 1e-4 && rect.h > 1e-4) {
      const ix0 = Math.max(rect.x, e.clipBox.x);
      const iy0 = Math.max(rect.y, e.clipBox.y);
      const ix1 = Math.min(rect.x + rect.w, e.clipBox.x + e.clipBox.w);
      const iy1 = Math.min(rect.y + rect.h, e.clipBox.y + e.clipBox.h);

      if (ix1 <= ix0 + 1e-4 || iy1 <= iy0 + 1e-4) {
        continue; // completely clipped out
      }

      const l = clamp01((ix0 - rect.x) / rect.w);
      const t = clamp01((iy0 - rect.y) / rect.h);
      const r = clamp01((rect.x + rect.w - ix1) / rect.w);
      const b = clamp01((rect.y + rect.h - iy1) / rect.h);

      if (l > 1e-3 || t > 1e-3 || r > 1e-3 || b > 1e-3) {
        crop = { l, t, r, b };
        rect = { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 };
      }
    }

    const hash = fnv1aHash(payload.data, payload.width, payload.height, payload.mime);

    out.push({
      z: e.z,
      rect,
      rotate: d.rotate,
      flipH: d.flipH,
      flipV: d.flipV,
      data: payload.data,
      mime: payload.mime,
      width: payload.width,
      height: payload.height,
      alpha: payload.alpha || (e.alphaF ?? 1) < 1,
      crop,
      hash,
    });
  }

  return out;
}
