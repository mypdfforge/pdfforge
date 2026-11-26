/**
 * fontResolver.js — Inspects embedded PDF font bytes via `fontkit` when available,
 * falling back to font-name heuristics, and maps PDF font names to clean
 * cross-platform PowerPoint font families.
 */

import * as fontkit from 'fontkit';

const DEFAULT_METRICS = Object.freeze({
  unitsPerEm: 1000,
  ascent: 0.82,
  descent: 0.18,
  capHeight: 0.72,
  xHeight: 0.5,
  lineGap: 0.1,
});

const SUBSET_PREFIX_RE = /^[A-Z]{6}\+/;
const BOLD_RE = /(?:bold|black|heavy|semibold|demibold|demi|extrabold|ultrabold|(?:\b|_)[6-9]00(?:\b|_))/i;
const ITALIC_RE = /(?:italic|oblique|slant|ital(?:\b|_))/i;
const MONO_RE = /(?:mono|courier|consolas|menlo|monaco|fira\s*code|jetbrains|source\s*code|inconsolata|dejavu\s*sans\s*mono|liberation\s*mono|lucida\s*console|andale|nimbus\s*mono)/i;

/** @type {Array<[RegExp, string, boolean?]>} [pattern, pptFace, isMono] */
const FONT_MAP = [
  // Japanese
  [/(?:yu\s*mincho|ms\s*p?mincho|noto\s*serif\s*jp|ipaex?mincho)/i, 'Yu Mincho', false],
  [/(?:yu\s*gothic|yugothic|hiragino|meiryo|ms\s*p?gothic|noto\s*sans\s*(?:cjk\s*)?jp|ipaex?gothic|koz(?:go|uka))/i, 'Yu Gothic', false],
  // Simplified Chinese
  [/(?:simsun|nsimsun|songti|stsong|noto\s*serif\s*(?:cjk\s*)?sc)/i, 'SimSun', false],
  [/(?:microsoft\s*yahei|yahei|simhei|heiti|pingfang\s*sc|noto\s*sans\s*(?:cjk\s*)?sc)/i, 'Microsoft YaHei', false],
  // Traditional Chinese
  [/(?:mingliu|pmingliu)/i, 'PMingLiU', false],
  [/(?:microsoft\s*jhenghei|jhenghei|pingfang\s*tc|noto\s*sans\s*(?:cjk\s*)?tc)/i, 'Microsoft JhengHei', false],
  // Korean
  [/(?:malgun|gulim|dotum|batang|noto\s*sans\s*(?:cjk\s*)?kr)/i, 'Malgun Gothic', false],
  // Monospace
  [/consolas/i, 'Consolas', true],
  [/(?:courier|nimbus\s*mono)/i, 'Courier New', true],
  [MONO_RE, 'Consolas', true],
  // Serif
  [/(?:times\s*new\s*roman|timesnewroman|times\b|nimbus\s*rom|liberation\s*serif|pt\s*serif)/i, 'Times New Roman', false],
  [/georgia/i, 'Georgia', false],
  [/cambria/i, 'Cambria', false],
  [/garamond/i, 'Garamond', false],
  [/(?:palatino|book\s*antiqua)/i, 'Palatino Linotype', false],
  [/(?:serif|roman|baskerville|caslon|didot|bodoni|charter|century)/i, 'Times New Roman', false],
  // Sans-serif
  [/(?:calibri|carlito)/i, 'Calibri', false],
  [/segoe/i, 'Segoe UI', false],
  [/verdana/i, 'Verdana', false],
  [/tahoma/i, 'Tahoma', false],
  [/trebuchet/i, 'Trebuchet MS', false],
  [/(?:arial|helvetica|liberation\s*sans|nimbus\s*sans|swiss)/i, 'Arial', false],
  [/(?:roboto|open\s*sans|lato|inter|montserrat|noto\s*sans|source\s*sans|fira\s*sans|pt\s*sans|ubuntu|sans-serif|sans\b)/i, 'Arial', false],
];

const pageCache = new WeakMap();

function stripSubsetTag(name) {
  return (name || '').replace(SUBSET_PREFIX_RE, '').trim();
}

function getCommonFontObj(page, fontName) {
  if (!page?.commonObjs || !fontName) return null;
  try {
    if (typeof page.commonObjs.has === 'function' && !page.commonObjs.has(fontName)) {
      return null;
    }
    return page.commonObjs.get(fontName) || null;
  } catch {
    return null;
  }
}

function inspectFontBytes(data) {
  if (!data || !data.byteLength) return null;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const fk = fontkit.create(bytes);
    if (!fk) return null;

    const upm = fk.unitsPerEm || 1000;
    const os2 = fk['OS/2'];
    const post = fk.post;
    const fsSelection = os2?.fsSelection ?? 0;

    return {
      familyName: fk.familyName || fk.fullName || fk.postscriptName || '',
      postscriptName: fk.postscriptName || '',
      bold: (os2?.usWeightClass != null && os2.usWeightClass >= 600) || Boolean(fsSelection & 0x20),
      italic: Boolean(fsSelection & 0x01) || (post?.italicAngle != null && Math.abs(post.italicAngle) > 0.5),
      mono: Boolean(post?.isFixedPitch) || os2?.panose?.[3] === 9,
      metrics: {
        unitsPerEm: upm,
        ascent: (fk.ascent ?? 800) / upm,
        descent: Math.abs(fk.descent ?? -200) / upm,
        capHeight: (fk.capHeight ?? fk.ascent ?? 700) / upm,
        xHeight: (fk.xHeight ?? 500) / upm,
        lineGap: (fk.lineGap ?? 0) / upm,
      },
    };
  } catch {
    return null;
  }
}

function mapFontName(candidates) {
  for (const raw of candidates) {
    const clean = stripSubsetTag(raw);
    if (!clean) continue;
    for (const [re, face, isMono] of FONT_MAP) {
      if (re.test(clean)) {
        return { face, mono: Boolean(isMono) };
      }
    }
  }
  return { face: 'Arial', mono: false };
}

/**
 * Resolves a PDF font into a clean PowerPoint font descriptor and normalized metrics.
 * @param {object|null} page - pdf.js page object (optional)
 * @param {string} fontName - pdf.js internal fontName or PostScript font name
 * @param {object} [spanSample] - Optional sample span with `fontFamilyRaw`, `ascent`, `descent`
 * @returns {{ face: string, bold: boolean, italic: boolean, mono: boolean, metrics: object }}
 */
export function resolveFont(page, fontName, spanSample = null) {
  const cacheKey = `${fontName || ''}|${spanSample?.fontFamilyRaw || ''}`;
  if (page && typeof page === 'object') {
    let map = pageCache.get(page);
    if (!map) {
      map = new Map();
      pageCache.set(page, map);
    }
    if (map.has(cacheKey)) return map.get(cacheKey);
  }

  const fontObj = getCommonFontObj(page, fontName);
  const fkInfo = inspectFontBytes(fontObj?.data);

  const candidates = [
    fkInfo?.familyName,
    fkInfo?.postscriptName,
    fontObj?.name,
    spanSample?.fontFamilyRaw,
    fontName,
  ].filter(Boolean);

  const mapped = mapFontName(candidates);
  const joined = candidates.map(stripSubsetTag).join(' ');

  const bold = Boolean(fkInfo?.bold || fontObj?.bold || fontObj?.black || BOLD_RE.test(joined));
  const italic = Boolean(fkInfo?.italic || fontObj?.italic || ITALIC_RE.test(joined));
  const mono = Boolean(fkInfo?.mono || mapped.mono || MONO_RE.test(joined));

  const metrics = fkInfo?.metrics ?? {
    ...DEFAULT_METRICS,
    ascent: typeof spanSample?.ascent === 'number' && spanSample.ascent > 0 ? spanSample.ascent : DEFAULT_METRICS.ascent,
    descent: typeof spanSample?.descent === 'number' ? Math.abs(spanSample.descent) : DEFAULT_METRICS.descent,
  };

  const result = {
    face: mono && mapped.face === 'Arial' ? 'Consolas' : mapped.face,
    bold,
    italic,
    mono,
    metrics,
  };

  if (page && typeof page === 'object') {
    pageCache.get(page)?.set(cacheKey, result);
  }

  return result;
}
