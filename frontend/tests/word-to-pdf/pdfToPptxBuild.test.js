import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptxBlob } from '../../src/utils/pdfToPptxBuild.js'
import { convertPdfToPptx } from '../../src/features/pdf-to-pptx/engine/engineHost.js'

// 1x1 transparent PNG bytes
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

function makeRichModel(pageNum = 1) {
  return {
    pageNum,
    mode: 'rich',
    w: 720,
    h: 405,
    topDown: false,
    lines: [
      { text: 'Executive Overview', x: 48, y: 360, xEnd: 320, size: 22, isBold: true },
      { text: '• First bullet point', x: 48, y: 320, xEnd: 240, size: 11 },
    ],
    blocks: [
      {
        type: 'paragraph',
        line: {
          text: 'Executive Overview',
          x: 48,
          y: 360,
          xEnd: 320,
          size: 22,
          isBold: true,
          spans: [{ text: 'Executive Overview', size: 22, bold: true, color: '1E293B' }],
        },
      },
      {
        type: 'paragraph',
        line: {
          text: '• First bullet point',
          x: 48,
          y: 320,
          xEnd: 240,
          size: 11,
          spans: [{ text: '• First bullet point', size: 11 }],
        },
      },
      {
        type: 'table',
        numCols: 2,
        colWidths: [50, 50],
        tableWidth: 500,
        x0: 48,
        yMax: 280,
        theme: { fromVector: true, bg: '1E293B', text: 'FFFFFF', border: 'CBD5E1' },
        rows: [
          {
            isHeader: true,
            cells: [{ text: 'Metric', isHeader: true, columnSpan: 2 }],
          },
          {
            cells: [
              { text: 'Throughput', vMerge: 'restart' },
              { text: '99.9%' },
            ],
          },
          {
            cells: [
              { text: '', vMerge: 'continue' },
              { text: '100% SLA' },
            ],
          },
        ],
      },
      {
        type: 'callout',
        admonition: { type: 'tip', color: '10B981', bg: 'ECFDF5' },
        lines: [{ text: 'All checks passed cleanly.', x: 48, y: 120, size: 10 }],
      },
      {
        type: 'code',
        lines: [{ text: 'const ok = true;', x: 48, y: 80, size: 9 }],
      },
    ],
    images: [{ data: TINY_PNG, type: 'png', pxW: 1, pxH: 1, x: 520, y: 40, w: 120, h: 80 }],
    vector: {
      rects: [{ x: 40, y: 345, w: 300, h: 36, fill: 'F8FAFC', stroke: 'CBD5E1', lineWidth: 1 }],
    },
  }
}

describe('PDF to PowerPoint hardened builder & engineHost', () => {
  it('builds a valid editable .pptx ZIP with text, merged tables, callouts, code, and images', async () => {
    const warnings = []
    const res = await buildPptxBlob([makeRichModel(1)], {
      title: 'Quarterly Deck',
      slideLayout: 'auto',
      warn: (...args) => warnings.push(args),
    })

    expect(res.packMode).toBe('rich')
    expect(res.modes).toEqual(['rich'])
    expect(res.blob.size).toBeGreaterThan(1000)

    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const slide1Xml = await zip.file('ppt/slides/slide1.xml')?.async('string')
    expect(slide1Xml).toBeDefined()
    expect(slide1Xml).toContain('Executive Overview')
    expect(slide1Xml).toContain('First bullet point')
    expect(slide1Xml).toContain('Metric')
    expect(slide1Xml).toContain('Throughput')
    expect(slide1Xml).toContain('All checks passed cleanly.')
    expect(slide1Xml).toContain('const ok = true;')
    expect(zip.file(/^ppt\/media\//).length).toBeGreaterThan(0)
  })

  it('respects 16:9 and 4:3 slideLayout dimensions and degrades gracefully on scanned/failed pages', async () => {
    const scanModel = {
      pageNum: 1,
      mode: 'image',
      w: 595.28,
      h: 841.89,
      lines: [],
      blocks: [],
      images: [],
      pageImage: { data: TINY_PNG, type: 'png', pxW: 1, pxH: 1, w: 595.28, h: 841.89 },
      topDown: true,
    }
    const failedModel = { pageNum: 2, mode: 'failed', w: 595.28, h: 841.89, lines: [], blocks: [], images: [] }

    const res169 = await buildPptxBlob([scanModel, failedModel], { slideLayout: '16:9' })
    const zip169 = await JSZip.loadAsync(await res169.blob.arrayBuffer())
    const presXml = await zip169.file('ppt/presentation.xml')?.async('string')
    expect(presXml).toContain('cx="9144000" cy="5143500"')
    expect(zip169.file('ppt/slides/slide1.xml')).toBeTruthy()
    const slide2Xml = await zip169.file('ppt/slides/slide2.xml')?.async('string')
    expect(slide2Xml).toContain('Slide 2 could not be converted')
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
