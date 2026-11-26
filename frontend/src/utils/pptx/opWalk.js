/**
 * opWalk.js — Single-pass pdf.js operator-list walker.
 * Tracks full graphics state (CTM, Form XObjects, RGB/Gray/CMYK colors,
 * ExtGState alpha/blend/SMask, clip depth, and text state) to emit RawDrawEvent[].
 */

import { mulMatrix } from './slideCoords.js';

const ID = [1, 0, 0, 1, 0, 0];

const DEFAULT_OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 18,
  setLineCap: 19,
  setLineJoin: 20,
  setDash: 21,
  clip: 28,
  eoClip: 29,
  fill: 30,
  eoFill: 31,
  stroke: 32,
  fillStroke: 33,
  eoFillStroke: 34,
  closeStroke: 35,
  closeFillStroke: 36,
  closeEOFillStroke: 37,
  setFillRGBColor: 38,
  setStrokeRGBColor: 39,
  setFillGray: 36,
  setStrokeGray: 37,
  setFillCMYKColor: 40,
  setStrokeCMYKColor: 41,
  setGState: 42,
  setFillColorSpace: 43,
  setStrokeColorSpace: 44,
  setFillColor: 45,
  setStrokeColor: 46,
  beginText: 31,
  setFont: 37,
  setTextMatrix: 44,
  setCharSpacing: 45,
  setWordSpacing: 46,
  setHScale: 47,
  setLeading: 48,
  setTextRise: 49,
  setTextRenderingMode: 50,
  nextLine: 51,
  showText: 52,
  showSpacedText: 53,
  nextLineShowText: 54,
  nextLineSetSpacingShowText: 55,
  paintFormXObjectBegin: 80,
  paintFormXObjectEnd: 81,
  paintImageXObject: 85,
  paintJpegXObject: 82,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintSolidColorImageMask: 86,
  paintInlineImageXObject: 87,
  beginInlineImage: 88,
  shadingFill: 89,
  beginGroup: 90,
  constructPath: 91,
};

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

function normRgb(r, g, b) {
  // pdf.js 3.x emits RGB in 0..255; tolerate 0..1 normalized inputs as well.
  const scale = Math.max(r, g, b) <= 1 ? 255 : 1;
  return [clamp255(r * scale), clamp255(g * scale), clamp255(b * scale)];
}

function normGray(g) {
  const v = g <= 1 ? clamp255(g * 255) : clamp255(g);
  return [v, v, v];
}

function cmykToRgb(c, m, y, k) {
  return [
    clamp255(255 * (1 - Math.min(1, c * (1 - k) + k))),
    clamp255(255 * (1 - Math.min(1, m * (1 - k) + k))),
    clamp255(255 * (1 - Math.min(1, y * (1 - k) + k))),
  ];
}

function cloneState(s) {
  return {
    ctm: [...s.ctm],
    fill: [...s.fill],
    stroke: [...s.stroke],
    alphaF: s.alphaF,
    alphaS: s.alphaS,
    lineWidth: s.lineWidth,
    dash: [...s.dash],
    cap: s.cap,
    join: s.join,
    clipDepth: s.clipDepth,
    clipBox: s.clipBox ? { ...s.clipBox } : null,
    complexDepth: s.complexDepth,
    blend: s.blend,
    softMask: s.softMask,
    text: {
      ...s.text,
      m: [...s.text.m],
      lm: [...s.text.lm],
    },
  };
}

/**
 * Walks a pdf.js operatorList in a single pass and emits RawDrawEvent[].
 * @param {{ fnArray: number[], argsArray: any[] }} opList
 * @param {ReturnType<import('./slideCoords.js').makePageTransform>} pageTf
 * @param {object} [opts]
 * @param {object} [opts.opsOverride] - Custom OPS table (for tests)
 * @param {AbortSignal} [opts.signal] - Optional abort signal checked every 5k ops
 * @returns {Array<object>}
 */
export function walkOperators(opList, pageTf, { opsOverride, signal } = {}) {
  const OPS = opsOverride || globalThis.pdfjsLib?.OPS || DEFAULT_OPS;
  const COMPLEX_OPS = new Set(
    [
      OPS.shadingFill,
      OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup,
      OPS.paintSolidColorImageMask,
      OPS.beginGroup,
      OPS.beginInlineImage,
    ].filter((v) => typeof v === 'number')
  );

  const events = [];
  let z = 0;
  let lastPathBbox = null;

  let s = {
    ctm: [...ID],
    fill: [0, 0, 0],
    stroke: [0, 0, 0],
    alphaF: 1,
    alphaS: 1,
    lineWidth: 1,
    dash: [],
    cap: 0,
    join: 0,
    clipDepth: 0,
    clipBox: null,
    complexDepth: 0,
    blend: 'normal',
    softMask: false,
    text: {
      m: [...ID],
      lm: [...ID],
      size: 0,
      tc: 0,
      tw: 0,
      tz: 100,
      leading: 0,
      rise: 0,
      mode: 0,
      font: null,
    },
  };
  const stack = [];

  const emit = (type, extra = {}) => {
    events.push({
      type,
      z: z++,
      ctm: [...s.ctm],
      fill: [...s.fill],
      stroke: [...s.stroke],
      alphaF: s.alphaF,
      alphaS: s.alphaS,
      lineWidth: s.lineWidth,
      dash: [...s.dash],
      cap: s.cap,
      join: s.join,
      clipDepth: s.clipDepth,
      clipBox: s.clipBox ? { ...s.clipBox } : null,
      complex: s.complexDepth > 0,
      blend: s.blend,
      softMask: s.softMask,
      ...extra,
    });
  };

  const fnArray = opList?.fnArray || [];
  const argsArray = opList?.argsArray || [];

  for (let i = 0; i < fnArray.length; i++) {
    if (signal && i > 0 && i % 5000 === 0 && signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      err.code = 'ABORTED';
      throw err;
    }

    const fn = fnArray[i];
    const a = argsArray[i];

    if (fn === OPS.save) {
      stack.push(cloneState(s));
    } else if (fn === OPS.restore) {
      const prevClip = s.clipDepth;
      s = stack.pop() ?? s;
      if (prevClip > s.clipDepth) {
        emit('restore', { restoredClips: prevClip - s.clipDepth });
      }
    } else if (fn === OPS.transform) {
      if (Array.isArray(a) && a.length >= 6) s.ctm = mulMatrix(s.ctm, a);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(cloneState(s));
      if (Array.isArray(a?.[0])) s.ctm = mulMatrix(s.ctm, a[0]);
      emit('formBegin', { bbox: a?.[1] || null });
    } else if (fn === OPS.paintFormXObjectEnd) {
      const prevClip = s.clipDepth;
      s = stack.pop() ?? s;
      if (prevClip > s.clipDepth) {
        emit('restore', { restoredClips: prevClip - s.clipDepth });
      }
      emit('formEnd');
    } else if (fn === OPS.setGState) {
      const pairs = Array.isArray(a?.[0]) ? a[0] : Object.entries(a?.[0] || {});
      for (const [k, v] of pairs) {
        if (k === 'CA') s.alphaS = v;
        else if (k === 'ca') s.alphaF = v;
        else if (k === 'LW') s.lineWidth = v;
        else if (k === 'BM') s.blend = Array.isArray(v) ? v[0] : String(v || 'normal');
        else if (k === 'SMask' && v && v !== 'None') s.softMask = true;
      }
      if (s.blend !== 'normal' && s.blend !== 'Normal') s.complexDepth++;
      if (s.softMask) s.complexDepth++;
    } else if (fn === OPS.setFillRGBColor) {
      s.fill = normRgb(a[0], a[1], a[2]);
    } else if (fn === OPS.setStrokeRGBColor) {
      s.stroke = normRgb(a[0], a[1], a[2]);
    } else if (fn === OPS.setFillGray) {
      s.fill = normGray(a[0]);
    } else if (fn === OPS.setStrokeGray) {
      s.stroke = normGray(a[0]);
    } else if (fn === OPS.setFillCMYKColor) {
      s.fill = cmykToRgb(a[0], a[1], a[2], a[3]);
    } else if (fn === OPS.setStrokeCMYKColor) {
      s.stroke = cmykToRgb(a[0], a[1], a[2], a[3]);
    } else if (fn === OPS.setFillColorSpace || fn === OPS.setStrokeColorSpace) {
      if (String(a?.[0] || '').includes('Pattern')) s.complexDepth++;
    } else if (fn === OPS.setFillColor || fn === OPS.setStrokeColor) {
      if (!Array.isArray(a?.[0]) && typeof a?.[0] === 'object' && a?.[0] !== null) {
        s.complexDepth++;
      }
    } else if (fn === OPS.setLineWidth) {
      s.lineWidth = Math.max(0, a[0] ?? 1);
    } else if (fn === OPS.setLineCap) {
      s.cap = a[0] ?? 0;
    } else if (fn === OPS.setLineJoin) {
      s.join = a[0] ?? 0;
    } else if (fn === OPS.setDash) {
      s.dash = Array.isArray(a?.[0]) ? [...a[0]] : [];
    } else if (fn === OPS.constructPath) {
      const [ops, coords, minX, minY, maxX, maxY] = a;
      lastPathBbox = pageTf.rect(s.ctm, minX, minY, maxX, maxY);
      emit('path', {
        ops: [...(ops || [])],
        coords: [...(coords || [])],
        bbox: lastPathBbox,
      });
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      emit('paint', { how: fn === OPS.fill ? 'fill' : 'eofill', bbox: lastPathBbox });
    } else if (fn === OPS.stroke) {
      emit('paint', { how: 'stroke', bbox: lastPathBbox });
    } else if (fn === OPS.closeStroke) {
      emit('paint', { how: 'stroke', close: true, bbox: lastPathBbox });
    } else if (fn === OPS.fillStroke) {
      emit('paint', { how: 'fill+stroke', bbox: lastPathBbox });
    } else if (fn === OPS.eoFillStroke) {
      emit('paint', { how: 'eofill+stroke', bbox: lastPathBbox });
    } else if (fn === OPS.closeFillStroke) {
      emit('paint', { how: 'fill+stroke', close: true, bbox: lastPathBbox });
    } else if (fn === OPS.closeEOFillStroke) {
      emit('paint', { how: 'eofill+stroke', close: true, bbox: lastPathBbox });
    } else if (fn === OPS.clip || fn === OPS.eoClip) {
      s.clipDepth++;
      s.clipBox = lastPathBbox;
      emit('clip', { eo: fn === OPS.eoClip, bbox: lastPathBbox });
    } else if (fn === OPS.beginText) {
      s.text.m = [...ID];
      s.text.lm = [...ID];
    } else if (fn === OPS.setFont) {
      s.text.font = a[0];
      s.text.size = a[1] ?? s.text.size;
    } else if (fn === OPS.setTextMatrix) {
      if (Array.isArray(a) && a.length >= 6) {
        s.text.m = [...a];
        s.text.lm = [...a];
      }
    } else if (fn === OPS.setCharSpacing) {
      s.text.tc = a[0] ?? 0;
    } else if (fn === OPS.setWordSpacing) {
      s.text.tw = a[0] ?? 0;
    } else if (fn === OPS.setHScale) {
      s.text.tz = a[0] ?? 100;
    } else if (fn === OPS.setLeading) {
      s.text.leading = a[0] ?? 0;
    } else if (fn === OPS.setTextRise) {
      s.text.rise = a[0] ?? 0;
    } else if (fn === OPS.setTextRenderingMode) {
      s.text.mode = a[0] ?? 0;
    } else if (fn === OPS.nextLine) {
      s.text.lm = mulMatrix(s.text.lm, [1, 0, 0, 1, 0, -s.text.leading]);
      s.text.m = [...s.text.lm];
    } else if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      const glyphCount = Array.isArray(a?.[0]) ? a[0].length : 1;
      emit('text', {
        text: {
          ...s.text,
          m: [...s.text.m],
          lm: [...s.text.lm],
          glyphCount,
        },
      });
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      emit('image', {
        name: a[0],
        unit: pageTf.rect(s.ctm, 0, 0, 1, 1),
        raw: pageTf.mat(mulMatrix(s.ctm, [1, 0, 0, -1, 0, 1])),
      });
    } else if (fn === OPS.paintInlineImageXObject) {
      emit('inlineImage', {
        img: a[0],
        unit: pageTf.rect(s.ctm, 0, 0, 1, 1),
        raw: pageTf.mat(mulMatrix(s.ctm, [1, 0, 0, -1, 0, 1])),
      });
    } else if (COMPLEX_OPS.has(fn)) {
      s.complexDepth++;
      emit('complex', { op: fn, args: a, complexRect: lastPathBbox });
    }
  }

  return events;
}
