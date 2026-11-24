import { describe, it, expect } from 'vitest'
import { reorderLinesByColumns, looksLikeTableBand } from '../../src/../../frontend/src/utils/pdfXyCut.js'
import { parseListMarker, levelTextForDepth, buildDocumentNumbering } from '../../src/../../frontend/src/utils/pdfNumbering.js'

const L = (tag: string, x: number, xe: number, y: number, txt = 'word word word word') =>
  ({ tag, x, xEnd: xe, y, size: 10, text: txt, items: [{ str: txt, x, y, w: xe - x, size: 10 }] }) as any

const mk = (p: any, items: any[]) => ({ ...p, items, tag: p.tag }) as any

describe('xy-cut', () => {
  it('spanning title then all left then all right', () => {
    const ls = [L('T', 50, 540, 760)]
    for (let i = 0; i < 6; i++) ls.push(L('L' + i, 50, 275, 730 - i * 14))
    for (let i = 0; i < 6; i++) ls.push(L('R' + i, 310, 540, 730 - i * 14))
    const out = reorderLinesByColumns(ls, { pageWidth: 595, pageHeight: 842, makeSubLine: mk })
    expect(out.map((l: any) => l.tag)).toEqual(['T', ...[0, 1, 2, 3, 4, 5].map(i => 'L' + i), ...[0, 1, 2, 3, 4, 5].map(i => 'R' + i)])
  })

  it('table band is guarded', () => {
    const segs = [{ x0: 50, text: 'node-01' }, { x0: 200, text: 'Storage Primary' }, { x0: 350, text: 'HEALTHY' }]
    expect(looksLikeTableBand([...segs, ...segs, ...segs], 3)).toBe(true)
  })
})

describe('numbering', () => {
  it('legal depth', () => expect(parseListMarker('1.2.1.a HPA metrics')!.level).toBe(3))
  it('lvlText', () => expect(levelTextForDepth(3, 'lowerLetter')).toBe('%1.%2.%3.%4'))
  it('restart creates a new instance', () => {
    const models = [{ lines: [{ text: '1. Alpha', x: 50 }, { text: '2. Beta', x: 50 }, { text: '1. Gamma', x: 50 }] }] as any
    expect(buildDocumentNumbering(models).config.length).toBe(2)
  })
})
