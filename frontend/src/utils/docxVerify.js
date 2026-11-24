/**
 * docxVerify.js — post-pack OpenXML compliance gate. Worker-safe (no DOM).
 * Core is dependency-free; blob wrapper uses fflate (already a dependency).
 */
import { unzipSync } from 'fflate'

const TAG = /<[^>]+>|[^<]+/gs
const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** entries: { 'word/document.xml': string, ... } */
export function verifyDocxEntries(entries) {
  const V = []
  const stats = { paragraphs: 0, tables: 0, cells: 0, textboxes: 0 }
  const add = (code, detail) => V.push({ code, detail })
  const doc = entries['word/document.xml']
  if (doc == null) return { ok: false, violations: [{ code: 'V000', detail: 'missing word/document.xml' }], stats }
  if (!String(entries['[Content_Types].xml'] || '').includes('wordprocessingml.document.main')) add('V000', 'bad content type')
  if (CTRL.test(doc)) add('V005', 'illegal XML control char in document.xml')

  const stack = [], tbls = [], rows = [], cells = []
  let inT = false
  const text = []
  const nums = new Set(), rids = new Set()

  const closeEl = (local) => {
    if (local === 'tc') {
      const c = cells.pop()
      if (c && !c.hasP) add('V002', 'w:tc without direct w:p child')
    } else if (local === 'tr') {
      const r = rows.pop()
      const t = tbls[tbls.length - 1]
      if (r && t && t.grid > 0 && r.sum !== t.grid) add('V003', `row gridSpan sum ${r.sum} != tblGrid ${t.grid}`)
    } else if (local === 'tblGrid') { if (tbls.length) tbls[tbls.length - 1].inGrid = false }
    else if (local === 'tbl') {
      const t = tbls.pop()
      if (t && t.grid === 0) add('V008', 'w:tbl without w:tblGrid/gridCol')
    }
  }

  for (const tok of doc.match(TAG) || []) {
    if (tok[0] === '<') {
      if (tok.startsWith('<?') || tok.startsWith('<!')) continue
      if (tok.startsWith('</')) {
        const local = tok.slice(2, -1).trim().split(':').pop()
        if (local === 't') inT = false; else closeEl(local)
        stack.pop()
      } else {
        const sc = tok.endsWith('/>')
        const inner = sc ? tok.slice(1, -2) : tok.slice(1, -1)
        const sp = inner.search(/\s/)
        const name = sp < 0 ? inner : inner.slice(0, sp)
        const local = name.split(':').pop()
        const attrs = {}
        for (const m of (sp < 0 ? '' : inner.slice(sp)).matchAll(ATTR)) attrs[m[1]] = m[2]
        if (local === 'tbl') { tbls.push({ grid: 0, inGrid: false }); stats.tables++ }
        else if (local === 'tblGrid') { if (tbls.length) tbls[tbls.length - 1].inGrid = true }
        else if (local === 'gridCol') { const t = tbls[tbls.length - 1]; if (t && t.inGrid) t.grid++ }
        else if (local === 'tr') rows.push({ sum: 0 })
        else if (local === 'tc') { cells.push({ hasP: false }); stats.cells++; if (rows.length) rows[rows.length - 1].sum++ }
        else if (local === 'gridSpan') { if (rows.length) rows[rows.length - 1].sum += (parseInt(attrs['w:val'] || '1', 10) || 1) - 1 }
        else if (local === 'p') {
          stats.paragraphs++
          const parent = stack[stack.length - 1]
          if (cells.length && parent && parent.split(':').pop() === 'tc') cells[cells.length - 1].hasP = true
        }
        else if (local === 'txbxContent') { stats.textboxes++; add('V001', 'floating textbox found') }
        else if (local === 'numId') nums.add(attrs['w:val'])
        for (const k of ['r:embed', 'r:id', 'r:link']) if (attrs[k]) rids.add(attrs[k])
        if (local === 't') inT = true
        stack.push(name)
        if (sc) { if (local === 't') inT = false; else closeEl(local); stack.pop() }
      }
    } else if (inT) text.push(unesc(tok))
  }

  const joined = text.join('\n')
  if (/\|\s*:?-{3,}/.test(joined)) add('V004', 'markdown table separator leaked')
  if (/<\/?(td|tr|table|span|div|b|i|u|strike)\b[^>]*>/i.test(joined)) add('V004', 'HTML token leaked')
  if (/\*\*[^*\n]+\*\*/.test(joined)) add('V004', 'markdown bold leaked')
  if (/~~[^~\n]+~~/.test(joined)) add('V004', 'markdown strike leaked')
  if (joined.split('\n').some((l) => l.trim().startsWith('|') && l.trim().endsWith('|'))) add('V004', 'pipe-table row leaked')
  if (nums.size) {
    const defined = new Set([...String(entries['word/numbering.xml'] || '').matchAll(/<w:num\s[^>]*w:numId="(\d+)"/g)].map((m) => m[1]))
    for (const n of nums) if (!defined.has(n)) add('V006', `numId ${n} referenced but not defined`)
  }
  if (rids.size) {
    const defined = new Set([...String(entries['word/_rels/document.xml.rels'] || '').matchAll(/Id="([^"]+)"/g)].map((m) => m[1]))
    for (const r of rids) if (!defined.has(r)) add('V007', `relationship ${r} referenced but missing`)
  }
  return { ok: V.length === 0, violations: V, stats }
}

export async function verifyDocxBlob(blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const dec = new TextDecoder('utf-8', { fatal: false })
  const entries = {}
  for (const name of ['[Content_Types].xml', 'word/document.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels'])
    if (files[name]) entries[name] = dec.decode(files[name])
  return verifyDocxEntries(entries)
}
