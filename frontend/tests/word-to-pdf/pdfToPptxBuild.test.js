import { describe, it, expect } from 'vitest'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { buildDocumentAst } from '../../src/utils/documentLayoutAnalysis.js'
import { exportAstToPptx } from '../../src/utils/pptxEmitter.js'
import { convertPdfToPptx } from '../../src/features/pdf-to-pptx/engine/engineHost.js'

describe('PDF to PowerPoint AST layout engine & engineHost', () => {
  it('builds an editable .pptx via buildDocumentAst + exportAstToPptx', async () => {
    const pagesData = [
      {
        pageWidth: 595.28,
        pageHeight: 841.89,
        items: [
          { str: 'Quarterly Report', x: 54, y: 760, w: 180, h: 20, size: 20, isBold: true },
          { str: 'Revenue increased 24% YoY.', x: 54, y: 720, w: 200, h: 11, size: 11, isBold: false },
        ],
        vectorGeometry: null,
      },
    ]

    const ast = buildDocumentAst(pagesData, { title: 'Quarterly Report' })
    const blob = await exportAstToPptx(ast, PptxGenJS)
    expect(blob.size).toBeGreaterThan(1000)

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const slide1Xml = await zip.file('ppt/slides/slide1.xml')?.async('string')
    expect(slide1Xml).toContain('Quarterly Report')
    expect(slide1Xml).toContain('Revenue increased 24% YoY.')
  })

  it('rejects invalid inputs and pre-aborted signals via engineHost', async () => {
    const badFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await expect(convertPdfToPptx(badFile)).rejects.toMatchObject({ code: 'INVALID_PDF' })

    const emptyPdf = new File([], 'empty.pdf', { type: 'application/pdf' })
    await expect(convertPdfToPptx(emptyPdf)).rejects.toMatchObject({ code: 'INVALID_PDF' })

    const ctl = new AbortController()
    ctl.abort()
    const validishPdf = new File(['%PDF-1.4'], 'deck.pdf', { type: 'application/pdf' })
    await expect(convertPdfToPptx(validishPdf, { signal: ctl.signal })).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
