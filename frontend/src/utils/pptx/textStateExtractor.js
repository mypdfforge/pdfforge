/**
 * textStateExtractor.js — Correlates pdf.js getTextContent() items with
 * operator-list text paint events (color, alpha, Tc, Tz, rise, renderMode, z-order).
 */

import { mulMatrix } from './slideCoords.js';

const PUA_BULLET_MAP = {
  '\uF0B7': '\u2022', // Symbol bullet
  '\uF0A7': '\u25AA', // Wingdings square
  '\uF0D8': '\u25B8', // arrow bullet
  '\uF0FC': '\u2713', // checkmark
  '\uF076': '\u25C6', // diamond
};

const LIGATURE_RE = /[\uFB00-\uFB06]/g;
const LIGATURE_MAP = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function rgbHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function normalizeAngle(deg) {
  let a = ((deg % 360) + 360) % 360;
  if (Math.abs(a - 360) < 1e-4) a = 0;
  return a;
}

/**
 * Normalizes extracted PDF text: NFC, Latin presentation ligatures,
 * PUA bullet mapping, and soft-hyphen removal, while preserving logical BiDi order.
 */
export function normalizeUnicode(str) {
  if (!str || typeof str !== 'string') return '';
  let out = str.normalize('NFC');
  out = out.replace(LIGATURE_RE, (ch) => LIGATURE_MAP[ch] || ch);
  out = out.replace(/[\uF0B7\uF0A7\uF0D8\uF0FC\uF076]/g, (ch) => PUA_BULLET_MAP[ch] || '\u2022');
  out = out.replace(/\u00AD/g, '');
  return out;
}

function bboxFromItem(slideMat, item, sizeIn, pageTf) {
  // item.transform is in PDF user space; width is in user-space units at scale=1.
  // Use pageTf.dims.scale / 72 to convert width to slide inches cleanly.
  const k = (pageTf.dims?.scale ?? 1) / 72;
  const wIn = Math.max(1e-4, Math.abs((item.width || 0) * k));
  const hIn = Math.max(1e-4, sizeIn);

  // slideMat[4], slideMat[5] is the baseline origin in top-down slide inches.
  const ascentRatio = 0.82;
  const descentRatio = 0.18;
  return {
    x: slideMat[4],
    y: slideMat[5] - hIn * ascentRatio,
    w: wIn,
    h: hIn * (ascentRatio + descentRatio),
  };
}

/**
 * Extracts StyledTextSpan[] by joining `page.getTextContent()` with `walkOperators()` events.
 * @param {object} page - pdf.js page (or null if `textContentOverride` is supplied)
 * @param {ReturnType<import('./slideCoords.js').makePageTransform>} pageTf
 * @param {Array<object>} events - Output from walkOperators()
 * @param {object} [opts]
 * @param {object} [opts.textContentOverride] - Pre-extracted getTextContent() result (for tests)
 * @returns {Promise<Array<object>>}
 */
export async function extractStyledSpans(page, pageTf, events, { textContentOverride } = {}) {
  const tc =
    textContentOverride ||
    (await page.getTextContent({ includeMarkedContent: false, disableNormalization: true }));

  const textEvents = (events || []).filter((e) => e.type === 'text');
  const spans = [];
  let ei = 0;

  for (const item of tc?.items || []) {
    if (!item.str) continue;

    // Correlate by monotonic content order + CTM*Tm origin proximity
    let best = -1;
    let bestD = Infinity;
    const tx = item.transform?.[4] ?? 0;
    const ty = item.transform?.[5] ?? 0;

    for (let j = ei; j < Math.min(textEvents.length, ei + 24); j++) {
      const ev = textEvents[j];
      const worldTm = mulMatrix(ev.ctm, ev.text.m);
      const d = Math.hypot(worldTm[4] - tx, worldTm[5] - ty);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
      if (d < 0.5) break;
    }

    const ev = best >= 0 && bestD < 8 ? textEvents[best] : null;
    if (best >= 0 && bestD < 8) {
      ei = best + (ev.text.glyphCount > 1 ? 0 : 1);
    }

    const m = pageTf.mat(item.transform || [1, 0, 0, 1, 0, 0]);
    const sizeIn = Math.hypot(m[2], m[3]) || 12 / 72;
    const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const style = tc.styles?.[item.fontName] || {};
    const rise = ev?.text?.rise ?? 0;
    const text = normalizeUnicode(item.str);
    if (!text) continue;

    const isRtl = item.dir === 'rtl' || RTL_RE.test(text);

    spans.push({
      z: ev?.z ?? 0,
      text,
      rect: bboxFromItem(m, item, sizeIn, pageTf),
      fontSizePt: sizeIn * 72,
      rotate: normalizeAngle(angle),
      color: ev ? rgbHex(ev.fill) : '000000',
      opacity: ev ? ev.alphaF : 1,
      renderMode: ev?.text?.mode ?? 0,
      charSpacingPt: (ev?.text?.tc ?? 0) * (sizeIn * 72),
      hScale: (ev?.text?.tz ?? 100) / 100,
      baseline: rise > 0.05 ? 'super' : rise < -0.05 ? 'sub' : null,
      dir: isRtl ? 'rtl' : 'ltr',
      fontName: item.fontName || '',
      fontFamilyRaw: style.fontFamily || '',
      vertical: !!style.vertical,
      ascent: style.ascent,
      descent: style.descent,
    });
  }

  return spans;
}
