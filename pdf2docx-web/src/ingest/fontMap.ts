import { FontInfo } from '../core/pageir.js';

export function normalizeFontName(rawName: string): string {
  if (!rawName) return 'Calibri';
  // Strip 6-char subset tag e.g. "ABCDEF+Arial-Bold" -> "Arial-Bold"
  const stripped = rawName.replace(/^[A-Za-z]{6}\+/, '');
  return stripped.replace(/[,_]/g, '-');
}

export const FONT_FALLBACK_TABLE: Record<string, string> = {
  helvetica: 'Arial',
  arial: 'Arial',
  liberationsans: 'Arial',
  customfont: 'Arial',
  'sans-serif': 'Arial',
  times: 'Times New Roman',
  timesnewroman: 'Times New Roman',
  liberationserif: 'Times New Roman',
  serif: 'Times New Roman',
  courier: 'Courier New',
  couriernew: 'Courier New',
  liberationmono: 'Courier New',
  consolas: 'Courier New',
  monospace: 'Courier New',
  calibri: 'Calibri',
};

export function parseFontDescriptor(
  rawName: string,
  flags: number = 0,
  fallbackHint?: string
): FontInfo {
  const norm = normalizeFontName(rawName);
  const lower = norm.toLowerCase();

  const isBold =
    Boolean(flags & (1 << 18)) || // FontDescriptor ForceBold flag
    /bold|black|heavy|semibold|demibold|medium/i.test(lower);

  const isItalic =
    Boolean(flags & (1 << 6)) || // FontDescriptor Italic flag
    /italic|oblique|slanted/i.test(lower);

  const isMono =
    Boolean(flags & (1 << 0)) || // FixedPitch flag
    /courier|mono|consolas|menlo|sourcecodepro/i.test(lower) ||
    /monospace/i.test(fallbackHint || '');

  const isSans = /sans|arial|helvetica/i.test(lower) || /sans/i.test(fallbackHint || '');

  const isSerif =
    !isSans && (
      Boolean(flags & (1 << 1)) ||
      /times|georgia|garamond|cambria|minion/i.test(lower) ||
      /(?<!sans[-\s])serif/i.test(lower) ||
      /(?<!sans[-\s])serif/i.test(fallbackHint || '')
    );

  const isSymbolic = Boolean(flags & (1 << 2)) || /symbol|wingdings|dingbats/i.test(lower);

  // Map standard font families
  const basePart = norm.split('-')[0].trim();
  const cleanBase = basePart.toLowerCase().replace(/[\s-_]/g, '');

  let family = 'Arial'; // Safe modern default
  if (/times/i.test(cleanBase) || (isSerif && !/sans/i.test(cleanBase))) {
    family = 'Times New Roman';
  } else if (/courier|mono|consolas|menlo/i.test(cleanBase) || isMono) {
    family = 'Courier New';
  } else if (/calibri/i.test(cleanBase)) {
    family = 'Calibri';
  } else if (/arial|helvetica|liberationsans/i.test(cleanBase) || cleanBase.startsWith('customfont')) {
    family = 'Arial';
  } else if (cleanBase.startsWith('customfallback')) {
    family = isMono ? 'Courier New' : 'Arial';
  } else if (FONT_FALLBACK_TABLE[cleanBase]) {
    family = FONT_FALLBACK_TABLE[cleanBase];
  } else if (basePart && basePart.length > 2 && !/^g[_\d]/i.test(basePart)) {
    family = basePart;
  }

  return {
    key: norm,
    pdfName: rawName,
    family,
    bold: isBold,
    italic: isItalic,
    mono: isMono,
    serif: isSerif,
    symbolic: isSymbolic,
  };
}

export function resolveFontDescriptor(
  fontId: string,
  commonObjs?: any,
  styles?: Record<string, any>,
  flags: number = 0
): FontInfo {
  let realName = fontId;
  let fallbackHint: string | undefined;

  if (commonObjs && typeof commonObjs.has === 'function' && commonObjs.has(fontId)) {
    try {
      const obj = commonObjs.get(fontId);
      if (obj) {
        realName = obj.name || obj.loadedName || realName;
        fallbackHint = obj.fallbackName || fallbackHint;
      }
    } catch {
      // Fallback gracefully
    }
  }

  if (styles && styles[fontId]) {
    const s = styles[fontId];
    if (s.fontFamily && !fallbackHint) {
      fallbackHint = s.fontFamily;
    }
    if ((!realName || /^g[_\d]/i.test(realName)) && s.fontFamily) {
      realName = s.fontFamily;
    }
  }

  return parseFontDescriptor(realName, flags, fallbackHint);
}
