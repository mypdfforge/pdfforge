import { describe, it, expect } from 'vitest'
import { reorderLinesByColumns, looksLikeTableBand } from '../../src/../../frontend/src/utils/pdfXyCut.js'
import { parseListMarker, levelTextForDepth, buildDocumentNumbering } from '../../src/../../frontend/src/utils/pdfNumbering.js'
import { makeAlignmentDetector } from '../../src/../../frontend/src/utils/pdfToWordUtils.js'
import { mergeParagraphBlocks } from '../../src/../../frontend/src/utils/pdfLayoutSegmenter.js'

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
  it('maps nested bullet blocks using inferred page minX', () => {
    const b0 = { type: 'paragraph', line: { text: '• Level 0', x: 54 } }
    const b3 = { type: 'paragraph', line: { text: '• Level 3', x: 108 } }
    const models = [{ lines: [{ x: 54, text: 'Heading' }], blocks: [b0, b3] }] as any
    const { map } = buildDocumentNumbering(models)
    expect(map.get(b0.line)?.level).toBe(0)
    expect(map.get(b3.line)?.level).toBe(3)
  })
  it('never center-aligns deeply indented bullet lines', () => {
    const lines = [
      { x: 54, xEnd: 540, size: 11, text: 'Normal body line spanning full width of page.' },
      { x: 180, xEnd: 414, size: 11, text: '• Ultrasonic leak detection sensors polling at 100Hz' },
    ] as any
    const alignOf = makeAlignmentDetector(lines, 11)
    expect(alignOf(lines[1])).toBe('left')
  })
  it('preserves yTop and yBot when merging multi-line paragraphs', () => {
    const l1 = { x: 54, xEnd: 520, width: 466, y: 700, size: 11, text: 'First line of a multi-line paragraph', spans: [{ text: 'First line of a multi-line paragraph', size: 11 }], items: [] }
    const l2 = { x: 54, xEnd: 480, width: 426, y: 685, size: 11, text: 'second line of the same paragraph.', spans: [{ text: 'second line of the same paragraph.', size: 11 }], items: [] }
    const l3 = { x: 54, xEnd: 300, width: 246, y: 670, size: 11, text: 'third line ending here.', spans: [{ text: 'third line ending here.', size: 11 }], items: [] }
    const merged = mergeParagraphBlocks([{ type: 'paragraph', line: l1 }, { type: 'paragraph', line: l2 }, { type: 'paragraph', line: l3 }])
    expect(merged.length).toBe(1)
    expect(merged[0].line.yTop).toBe(700)
    expect(merged[0].line.yBot).toBe(670)
  })
})
