// Reads page content streams and font dictionaries through pdf-lib (injected as `L`, i.e. window.PDFLib / npm module).
import type { FontInfo } from './fonts.ts'
import type { FontMetrics } from './contentStream.ts'

const bin = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return s }
export const toBytes = (s: string) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u }

/** Decoded page content as one binary string; null when a stream uses an unsupported filter. */
export function readContent(L: any, doc: any, page: any): string | null {
  try {
    const c = page.node.Contents()
    if (!c) return ''
    const refs = c instanceof L.PDFArray ? c.asArray() : [c]
    const parts: string[] = []
    for (const r of refs) {
      const st = doc.context.lookup(r)
      if (!(st instanceof L.PDFRawStream) && !st?.getContents) return null
      const bytes = st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getContents()
      parts.push(bin(bytes))
    }
    return parts.join('\n')
  } catch { return null }
}

export function readFonts(L: any, doc: any, page: any): Record<string, FontInfo> {
  const out: Record<string, FontInfo> = {}
  const N = (s: string) => L.PDFName.of(s)
  const num = (o: any, d = 0) => (o && typeof o.asNumber === 'function' ? o.asNumber() : d)
  try {
    const res = page.node.Resources()
    const fonts = res?.lookupMaybe(N('Font'), L.PDFDict)
    if (!fonts) return out
    for (const key of fonts.keys()) {
      const f = fonts.lookup(key, L.PDFDict)
      const sub = f.lookupMaybe(N('Subtype'), L.PDFName)?.decodeText() ?? ''
      let desc = f.lookupMaybe(N('FontDescriptor'), L.PDFDict)
      let cidFont: any = null
      if (sub === 'Type0') {
        const d = f.lookupMaybe(N('DescendantFonts'), L.PDFArray)
        cidFont = d ? d.lookup(0, L.PDFDict) : null
        desc = cidFont?.lookupMaybe(N('FontDescriptor'), L.PDFDict) ?? desc
      }
      const wArr = f.lookupMaybe(N('Widths'), L.PDFArray)
      let cidWidths: FontInfo['cidWidths'] = null
      if (cidFont) {
        const w = cidFont.lookupMaybe(N('W'), L.PDFArray)
        if (w) {
          cidWidths = []
          const items = w.asArray().map((x: any) => doc.context.lookup(x))
          for (let i = 0; i < items.length;) {
            const c0 = num(items[i])
            const nx = items[i + 1]
            if (nx instanceof L.PDFArray) { nx.asArray().forEach((x: any, k: number) => cidWidths!.push([c0 + k, c0 + k, num(doc.context.lookup(x))])); i += 2 }
            else { cidWidths.push([c0, num(nx), num(items[i + 2])]); i += 3 }
          }
        }
      }
      out[key.decodeText()] = {
        baseFont: f.lookupMaybe(N('BaseFont'), L.PDFName)?.decodeText() ?? '',
        subtype: sub,
        embedded: !!desc && (desc.has(N('FontFile')) || desc.has(N('FontFile2')) || desc.has(N('FontFile3'))),
        flags: num(desc?.get(N('Flags'))), weight: num(desc?.get(N('FontWeight'))), italicAngle: num(desc?.get(N('ItalicAngle'))),
        bytes: sub === 'Type0' ? 2 : 1,
        widths: wArr ? wArr.asArray().map((x: any) => num(doc.context.lookup(x))) : null,
        firstChar: num(f.get(N('FirstChar'))), missingWidth: num(desc?.get(N('MissingWidth'))),
        cidWidths, dw: cidFont ? num(cidFont.get(N('DW')), 1000) : 1000,
      }
    }
  } catch { /* unreadable resources: caller treats fonts as unknown */ }
  return out
}

export const metricsFor = (fonts: Record<string, FontInfo>) => (res: string): FontMetrics | null => {
  const f = fonts[res]
  if (!f) return null
  if (f.bytes === 2) return { bytes: 2, width: (c) => { const r = f.cidWidths?.find((x) => c >= x[0] && c <= x[1]); return r ? r[2] : f.dw } }
  return { bytes: 1, width: (c) => (f.widths && c >= f.firstChar && c - f.firstChar < f.widths.length ? f.widths[c - f.firstChar] : f.widths ? f.missingWidth : 500) }
}
