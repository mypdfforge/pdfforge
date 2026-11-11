import { FontInfo } from '../core/pageir.js';

export function normalizeFontName(rawName: string): string {
  if (!rawName) return 'Calibri';
  // Strip 6-char subset tag e.g. "ABCDEF+Arial-Bold" -> "Arial-Bold"
  const stripped = rawName.replace(/^[A-Z]{6}\+/, '');
  return stripped.replace(/[,_]/g, '-');
}

export function parseFontDescriptor(rawName: string, flags: number = 0): FontInfo {
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
    /courier|mono|consolas|menlo|sourcecodepro/i.test(lower);

  const isSerif =
    Boolean(flags & (1 << 1)) ||
    /times|georgia|garamond|serif|cambria|minion/i.test(lower);

  const isSymbolic = Boolean(flags & (1 << 2)) || /symbol|wingdings|dingbats/i.test(lower);

  // Map standard font families
  let family = norm.split('-')[0].trim();
  if (/times|timesnewroman/i.test(family)) {
    family = 'Times New Roman';
  } else if (/courier|couriernew/i.test(family)) {
    family = 'Courier New';
  } else if (/arial|helvetica/i.test(family)) {
    family = 'Arial';
  } else if (!family) {
    family = 'Calibri';
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
