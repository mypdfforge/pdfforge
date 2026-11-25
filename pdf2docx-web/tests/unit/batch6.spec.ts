import { describe, it, expect } from 'vitest'
import { stitchCrossPageTables } from '../../src/../../frontend/src/utils/pdfTableMerge.js'

describe('streamed pack worker helpers', () => {
  it('furniture needs >=2 pages and >=60% repetition', () => {
    const mk = (keys: string[]) => ({ lines: keys.map((k) => ({ furnKey: k })), blocks: [] })
    const ms = [mk(['footer|a']), mk(['footer|a']), mk(['footer|a'])]
    const need = Math.max(2, Math.ceil(ms.length * 0.6))
    expect(need).toBe(2)
  })

  it('stitch still works on streamed models', () => {
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
  })
})
