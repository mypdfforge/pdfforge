import { describe, it, expect } from 'vitest'
import { normalizeText, reorderVisualToLogical, shouldInsertSpace, subSupFlags } from '../../src/../../frontend/src/utils/pdfUnicode.js'
import { verifyDocxEntries } from '../../src/../../frontend/src/utils/docxVerify.js'

const mk = (s: string[]) => s.map((str, i) => ({ x: i * 100, str }))
const out = (s: string[]) => reorderVisualToLogical(mk(s)).map((i: any) => i.str)

describe('biDi L2', () => {
  it('LTR base keeps Arabic island', () => expect(out(['Report:', 'مرحبا بكم', '2026'])).toEqual(['Report:', 'مرحبا بكم', '2026']))
  it('RTL base reverses to logical', () => expect(out(['בדיקה', 'עומס', 'של'])).toEqual(['של', 'עומס', 'בדיקה']))
  it('digit island EN level 2', () => expect(out(['שנה', '2026', 'שלום'])).toEqual(['שלום', '2026', 'שנה']))
  it('Arabic comma neutral (regression)', () => expect(out(['text', 'مرحبا', '،', 'بكم', 'end'])).toEqual(['text', 'بكم', '،', 'مرحبا', 'end']))
  it('NFKC presentation forms', () => expect(normalizeText('ﻣﺮﺣﺒﺎ')).toBe('مرحبا'))
})

describe('spacing/subsup', () => {
  it('0.15em gap → no space', () => expect(shouldInsertSpace({ gapPt: 1.65, sizePt: 11 })).toBe(false))
  it('no space around sub', () => expect(shouldInsertSpace({ gapPt: 3, sizePt: 11, curSubSup: true })).toBe(false))
  it('sub detected', () => expect(subSupFlags(8, 11, 98.5, 100)).toBe('sub'))
})

describe('docx gate', () => {
  const CT = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  const d = (b: string) => ({ '[Content_Types].xml': CT, 'word/document.xml': `<w:document><w:body>${b}</w:body></w:document>` })
  it('clean passes', () => expect(verifyDocxEntries(d('<w:p><w:r><w:t>ok</w:t></w:r></w:p>')).ok).toBe(true))
  it('empty tc fails', () => expect(verifyDocxEntries(d('<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc/></w:tr></w:tbl>')).violations.some(v => v.code === 'V002')).toBe(true))
  it('markdown fails', () => expect(verifyDocxEntries(d('<w:p><w:r><w:t>| ---|---|</w:t></w:r></w:p>')).violations.some(v => v.code === 'V004')).toBe(true))
  it('textbox fails', () => expect(verifyDocxEntries(d('<w:txbxContent/>')).violations.some(v => v.code === 'V001')).toBe(true))
})
