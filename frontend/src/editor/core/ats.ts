// core/ats.ts
// Privacy-safe client-side ATS audit (zero network requests).
// Evaluates resume structure, columns, font compatibility, contact info, and parse risks.
import type { DocState } from './types.ts'
import type { Measurer } from './fonts.ts'
import { findFlowLanes } from './flow.ts'

export type AtsFinding = { id: string; severity: 'high' | 'medium' | 'low'; weight: number; message: string; fix: string; ids?: string[] }
export type AtsReport = { score: number; findings: AtsFinding[] }

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/
const SECTIONS: Array<[RegExp, string]> = [
  [/experience|employment|work history/i, 'Work Experience'],
  [/education|academic/i, 'Education'],
  [/skills|technologies|competencies/i, 'Skills'],
]

export function auditATS(doc: DocState, m: Measurer): AtsReport {
  const findings: AtsFinding[] = []
  const add = (f: AtsFinding) => findings.push(f)
  const els = doc.order.map((id) => doc.els[id]).filter((e) => !e.deleted)
  const text = els.map((e) => e.text).join('\n')

  // 1. Multi-column parsing risk (lanes with real text mass on any page).
  let cols = 0
  for (const pm of doc.pages) {
    const { lanes } = findFlowLanes(els.filter((e) => e.page === pm.index), pm)
    cols = Math.max(cols, lanes.length)
  }
  if (cols >= 2) add({ id: 'cols', severity: 'high', weight: 18,
    message: `${cols}-column layout detected. Many ATS parsers read straight across the page and interleave columns.`,
    fix: 'Use a single-column layout for the authoritative resume version.' })

  // 2. Locked text (XObjects / rotated / shared show-ops) is often invisible to parsers.
  const locked = els.filter((e) => e.locked)
  if (locked.length > Math.max(2, els.length * 0.15)) add({ id: 'locked', severity: 'high', weight: 16, ids: locked.map((e) => e.id),
    message: `${locked.length} text items are locked (form XObjects, rotated, or shared drawing ops) and may not parse.`,
    fix: 'Re-export the source PDF with plain text, or retype these items.' })

  // 3. Text trapped in images.
  for (const pm of doc.pages) {
    const pageChars = els.filter((e) => e.page === pm.index).reduce((s, e) => s + e.text.length, 0)
    if (pm.images > 0 && pageChars < 200) add({ id: `img${pm.index}`, severity: 'high', weight: 20,
      message: `Page ${pm.index + 1} has images but almost no extractable text — content may be rasterized.`,
      fix: 'Replace image-based sections with real text.' })
  }

  // 4. Glyph coverage: export-unsupported + private-use icon glyphs.
  const bad = new Map<string, string[]>()
  for (const e of els) {
    const b = m.canEncode(e.style.family, e.text)
    const icons = [...e.text].filter((c) => { const k = c.codePointAt(0)!; return k >= 0xE000 && k <= 0xF8FF })
    const all = [...b, ...icons]
    if (all.length) bad.set(e.id, all)
  }
  if (bad.size) add({ id: 'glyphs', severity: 'medium', weight: 12, ids: [...bad.keys()],
    message: `Unsupported/icon glyphs in ${bad.size} items: ${[...new Set([...bad.values()].flat())].slice(0, 12).join(' ')}`,
    fix: 'Replace icon-font glyphs (phone/envelope icons, custom bullets) with plain text or standard bullets.' })

  // 5. Font fidelity (subset fonts that cannot be re-embedded).
  const approx = els.filter((e) => e.fidelity !== 'exact')
  if (approx.length > els.length * 0.3) add({ id: 'fidelity', severity: 'low', weight: 6,
    message: `${approx.length} items use embedded subset fonts; edited text exports in the closest standard font.`,
    fix: 'Prefer standard fonts (Helvetica/Arial, Times, Calibri-like) in the source document.' })

  // 6. Contact info + standard section headings.
  if (!EMAIL.test(text)) add({ id: 'email', severity: 'medium', weight: 8, message: 'No parseable email address found.', fix: 'Add a plain-text email near the top.' })
  if (!PHONE.test(text)) add({ id: 'phone', severity: 'medium', weight: 6, message: 'No parseable phone number found.', fix: 'Add a plain-text phone number (digits, not icons).' })
  for (const [re, name] of SECTIONS) if (!re.test(text)) add({ id: `sec_${name}`, severity: 'low', weight: 4,
    message: `No "${name}" section heading recognized.`, fix: `Use a conventional "${name}" heading.` })

  // 7. Reading-order sanity: model order vs geometric order inversions.
  let inv = 0
  for (let i = 1; i < doc.order.length; i++) {
    const a = doc.els[doc.order[i - 1]], b = doc.els[doc.order[i]]
    if (a.page === b.page && b.origBaseline > a.origBaseline + a.style.size) inv++
  }
  if (inv > doc.order.length * 0.15) add({ id: 'order', severity: 'medium', weight: 8,
    message: 'Text drawing order frequently jumps back up the page; extraction order may scramble.',
    fix: 'Re-export with a logical reading order (single column helps most).' })

  // 8. Tiny fonts.
  const tiny = els.filter((e) => e.style.size < 9.5 && e.text.trim().length > 3)
  if (tiny.length) add({ id: 'tiny', severity: 'low', weight: 4, ids: tiny.map((e) => e.id),
    message: `${tiny.length} items below 9.5 pt hurt both human and OCR readability.`, fix: 'Use >= 10 pt for body text.' })

  const score = Math.max(0, Math.min(100, 100 - findings.reduce((s, f) => s + f.weight, 0)))
  return { score, findings: findings.sort((a, b) => b.weight - a.weight) }
}
