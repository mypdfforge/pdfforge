import { describe, it, expect } from 'vitest'
import { extractSegments, detectRuledTables } from '../../src/../../frontend/src/utils/pdfRuledTables.js'
import { stitchCrossPageTables } from '../../src/../../frontend/src/utils/pdfTableMerge.js'

const V = (x: number, a: number, b: number) => ({ dir: 'v', p: x, a, b, w: 1, color: '#000' })
const H = (y: number, a: number, b: number) => ({ dir: 'h', p: y, a, b, w: 1, color: '#000' })
const line = (x: number, xe: number, y: number, text = 'cell') => ({ x, xEnd: xe, y, text, size: 10 }) as any
const mesh = (vs: number[][], hs: number[][]) => ({
  lines: [
    ...vs.map(([x, a, b]) => ({ x1: x, y1: a, x2: x, y2: b, lineWidth: 1, stroke: '#000' })),
    ...hs.map(([y, a, b]) => ({ x1: a, y1: y, x2: b, y2: y, lineWidth: 1, stroke: '#000' })),
  ],
  rects: [],
})

describe('Batch 4: Ruled tables & cross-page continuation', () => {
  it('2×2 grid → 4 cells, 2 cols', () => {
    const v = mesh(
      [[50, 620, 700], [200, 620, 700], [350, 620, 700]],
      [[700, 50, 350], [660, 50, 350], [620, 50, 350]]
    )
    const r = detectRuledTables(
      [line(60, 120, 680), line(210, 300, 680), line(60, 120, 640), line(210, 300, 640)],
      v
    )
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].block.numCols).toBe(2)
    expect(r[0].block.rows.length).toBe(2)
  })

  it('missing internal vertical → gridSpan 2', () => {
    const v = mesh(
      [[50, 590, 700], [350, 590, 700], [200, 590, 670]],
      [[700, 50, 350], [670, 50, 350], [630, 50, 350], [590, 50, 350]]
    )
    const r = detectRuledTables(
      [line(60, 300, 685, 'BANNER'), line(60, 120, 650), line(210, 300, 650)],
      v
    )
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].block.rows[0].cells[0].columnSpan).toBe(2)
    expect(
      r[0].block.rows.reduce(
        (a, row) => a + row.cells.reduce((s, c) => s + c.columnSpan, 0),
        0
      )
    ).toBe(2 * r[0].block.rows.length)
  })

  it('missing bottom border → vMerge restart/continue', () => {
    const v = mesh(
      [[50, 620, 700], [200, 620, 700], [350, 620, 700]],
      [[700, 50, 350], [660, 200, 350], [620, 50, 350]]
    )
    const r = detectRuledTables(
      [line(60, 120, 680), line(210, 300, 680), line(210, 300, 640)],
      v
    )
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].block.rows[0].cells[0].vMerge).toBe('restart')
    expect(r[0].block.rows[1].cells[0].vMerge).toBe('continue')
  })

  it('cross-page stitch drops repeated header', () => {
    const t = (yMin: number, yMax: number, rows: any[]) => ({
      type: 'table',
      numCols: 2,
      colWidths: [50, 50],
      yMin,
      yMax,
      rows,
    })
    const m = [
      { h: 800, blocks: [t(40, 700, [{ isHeader: true, cells: [{}, {}] }, { cells: [{}, {}] }])] },
      { h: 800, blocks: [t(100, 780, [{ isHeader: true, cells: [{}, {}] }, { cells: [{}, {}] }])] },
    ] as any
    expect(stitchCrossPageTables(m)).toBe(1)
    expect(m[0].blocks[0].rows.length).toBe(3)
    expect(m[1].blocks.length).toBe(0)
  })
})
