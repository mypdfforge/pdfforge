// Font mapping (original BaseFont -> exportable standard family) and exact-width measurement.
export type Family = 'Helvetica' | 'Times' | 'Courier'
export type Fidelity = 'exact' | 'metric-compatible' | 'substituted'
export type FontInfo = {
  baseFont: string; subtype: string; embedded: boolean
  flags: number; weight: number; italicAngle: number
  bytes: 1 | 2; widths: number[] | null; firstChar: number; missingWidth: number
  cidWidths: Array<[number, number, number]> | null; dw: number
}
export type Mapped = { family: Family; bold: boolean; italic: boolean; fidelity: Fidelity; note: string | null }

export const FAMILY_LABEL: Record<Family, string> = { Helvetica: 'Sans (Helvetica)', Times: 'Serif (Times)', Courier: 'Mono (Courier)' }
export const stripSubset = (n: string) => n.replace(/^[A-Z]{6}\+/, '')

export function mapFont(info: FontInfo | null): Mapped {
  const raw = stripSubset(info?.baseFont ?? '')
  const n = raw.toLowerCase().replace(/[\s_]/g, '')
  const flags = info?.flags ?? 0
  const bold = /bold|black|heavy|semibold|demi/.test(n) || (info?.weight ?? 0) >= 600 || !!(flags & (1 << 18))
  const italic = /italic|oblique/.test(n) || !!(flags & 64) || (info?.italicAngle ?? 0) !== 0
  let family: Family, std = false
  if (/^(arial|helvetica)/.test(n)) { family = 'Helvetica'; std = true }
  else if (/^(timesnewroman|times)/.test(n)) { family = 'Times'; std = true }
  else if (/^(couriernew|courier)/.test(n)) { family = 'Courier'; std = true }
  else family = flags & 1 ? 'Courier' : /mono|consolas|menlo|courier/.test(n) ? 'Courier' : flags & 2 || /serif$|georgia|garamond|palatino|cambria|book|minion/.test(n) && !/sans/.test(n) ? 'Times' : 'Helvetica'
  if (std) {
    const exact = /^(helvetica|times-|times$|courier)/.test(n) && !/newroman|mt$/.test(n)
    return { family, bold, italic, fidelity: exact && !info?.embedded ? 'exact' : 'metric-compatible', note: null }
  }
  const label = raw || 'unknown font'
  return { family, bold, italic, fidelity: 'substituted', note: `Original font "${label}" cannot be reproduced for new text; using ${FAMILY_LABEL[family]}. Unedited text keeps its original font.` }
}

export const standardName = (f: Family, bold: boolean, italic: boolean) => {
  if (f === 'Helvetica') return bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica'
  if (f === 'Times') return bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : italic ? 'Times-Italic' : 'Times-Roman'
  return bold ? (italic ? 'Courier-BoldOblique' : 'Courier-Bold') : italic ? 'Courier-Oblique' : 'Courier'
}

export type TextMetricsStyle = { family: Family; bold: boolean; italic: boolean; size: number; charSpacing: number; wordSpacing: number }

/** Un-kerned widths: exports emit plain Tj strings, so what we measure is exactly what viewers draw. */
export class Measurer {
  private fonts = new Map<string, any>()
  private cache = new Map<string, number>()
  private doc: any
  private constructor(doc: any) { this.doc = doc }
  static async create(PDFLib: any) { return new Measurer(await PDFLib.PDFDocument.create()) }
  private font(name: string) {
    let f = this.fonts.get(name)
    if (!f) { f = this.doc.embedStandardFont(name); this.fonts.set(name, f) }
    return f
  }
  private glyph(name: string, ch: string) {
    const k = name + '|' + ch
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    let w: number
    try { w = this.font(name).widthOfTextAtSize(ch, 1000) } catch { w = NaN }
    this.cache.set(k, w)
    return w
  }
  canEncode(family: Family, text: string): string[] {
    const bad = new Set<string>()
    for (const ch of text) if (ch !== '\n' && Number.isNaN(this.glyph(standardName(family, false, false), ch))) bad.add(ch)
    return [...bad]
  }
  width(text: string, s: TextMetricsStyle): number {
    const name = standardName(s.family, s.bold, s.italic)
    let w = 0, spaces = 0, n = 0
    for (const ch of text) {
      const g = this.glyph(name, ch)
      w += Number.isNaN(g) ? this.glyph(name, '?') : g
      n++; if (ch === ' ') spaces++
    }
    return (w / 1000) * s.size + s.charSpacing * n + s.wordSpacing * spaces
  }
}
