import { describe, it, expect } from 'vitest'
import { extractVectorGeometry } from '../../src/../../frontend/src/utils/pdfVectorExtractor.js'
import { parseNumericCell } from '../../src/../../frontend/src/utils/documentLayoutAnalysis.js'

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  constructPath: 91,
  stroke: 32,
  fill: 30,
  fillStroke: 33,
  setLineWidth: 18,
  setFillRGBColor: 38,
  setStrokeRGBColor: 39,
  setFillGray: 36,
  setStrokeGray: 37,
  setFillCMYKColor: 40,
  setStrokeCMYKColor: 41,
  setGState: 42,
  paintFormXObjectBegin: 80,
  paintFormXObjectEnd: 81,
}

const page = (fnArray: number[], argsArray: any[], view = [0, 0, 595, 842]) =>
  ({ view, rotate: 0, getOperatorList: async () => ({ fnArray, argsArray }) }) as any
const rectPath = (x: number, y: number, w: number, h: number) => [[19], [x, y, w, h]]

describe('Batch 5: Vector CTM/CropBox normalization and numeric cell parsing', () => {
  it('applies Form XObject CTM', async () => {
    const g = await extractVectorGeometry(
      page(
        [OPS.paintFormXObjectBegin, OPS.constructPath, OPS.stroke],
        [[[1, 0, 0, 1, 100, 50]], rectPath(0, 0, 200, 60), []]
      ),
      OPS
    )
    expect(g.rects[0]).toMatchObject({ x: 100, y: 50, w: 200, h: 60 })
  })

  it('subtracts CropBox origin', async () => {
    const g = await extractVectorGeometry(
      page([OPS.constructPath, OPS.stroke], [rectPath(150, 700, 200, 60), []], [100, 200, 695, 1042]),
      OPS
    )
    expect(g.rects[0]).toMatchObject({ x: 50, y: 500 })
    expect(g.space).toMatchObject({ width: 595, height: 842 })
  })

  it('captures gray + CMYK fills', async () => {
    const g = await extractVectorGeometry(
      page(
        [OPS.setFillGray, OPS.constructPath, OPS.fill, OPS.setFillCMYKColor, OPS.constructPath, OPS.fill],
        [[0.9], rectPath(0, 0, 10, 10), [], [0, 1, 1, 0], rectPath(20, 0, 10, 10), []]
      ),
      OPS
    )
    expect(g.rects.map((r) => r.fill)).toEqual(['E6E6E6', 'FF0000'])
  })

  it('parses accounting negatives', () => {
    expect(parseNumericCell('($3,420,100.00)')).toMatchObject({ isNumeric: true, rawValue: -3420100 })
    expect(parseNumericCell('+34.8%')).toMatchObject({ isNumeric: true, rawValue: 0.348 })
  })
})
