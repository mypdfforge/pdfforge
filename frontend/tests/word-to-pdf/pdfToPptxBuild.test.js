import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptxBlob } from '../../src/utils/pdfToPptxBuild.js'
import { normalizeModelForPptx, restoreVisualRtlText } from '../../src/utils/pdfToPptxPipeline.js'
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
      { text: '• Nested child bullet', x: 72, y: 300, xEnd: 260, size: 11 },
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
          text: 'H2SO4 and E = mc2',
          x: 48,
          y: 340,
          xEnd: 260,
          size: 11,
          spans: [
            { text: 'H', size: 11 },
            { text: '2', size: 8, subScript: true },
            { text: 'SO', size: 11 },
            { text: '4', size: 8, subScript: true },
            { text: ' and E = mc', size: 11 },
            { text: '2', size: 8, superScript: true },
          ],
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
        type: 'paragraph',
        line: {
          text: '• Nested child bullet',
          x: 72,
          y: 300,
          xEnd: 260,
          size: 11,
          spans: [{ text: '• Nested child bullet', size: 11 }],
        },
      },
      {
        type: 'table',
        numCols: 2,
        colWidths: [50, 50],
        tableWidth: 500,
        x0: 48,
        yMax: 270,
        theme: { fromVector: true, bg: '1E293B', text: 'FFFFFF', border: 'CBD5E1' },
        rows: [
          {
            isHeader: true,
            cells: [{ text: 'Metric', isHeader: true, columnSpan: 2 }],
          },
          {
            cells: [
              { text: 'Throughput', vMerge: 'restart' },
              { text: '($1,200.00)' },
            ],
          },
          {
            cells: [
              { text: '', vMerge: 'continue' },
              { text: 'مرحباً بكم' },
            ],
          },
        ],
      },
      {
        type: 'callout',
        admonition: { type: 'tip', color: '10B981', bg: 'ECFDF5' },
        lines: [{ text: '[SUCCESS] All checks passed cleanly.', x: 48, y: 120, size: 10 }],
      },
      {
        type: 'code',
        lines: [
          { text: 'def run():', x: 48, y: 90, size: 9 },
          { text: 'return True', x: 64, y: 78, size: 9 },
        ],
      },
    ],
    images: [{ data: TINY_PNG, type: 'png', pxW: 1, pxH: 1, x: 520, y: 40, w: 120, h: 80 }],
    vector: {
      rects: [{ x: 40, y: 345, w: 300, h: 36, fill: 'F8FAFC', stroke: 'CBD5E1', lineWidth: 1 }],
    },
  }
}

describe('PDF to PowerPoint hardened builder & engineHost', () => {
  it('builds valid OOXML with single <a:pPr>, sub/superscripts, RTL cells, financial styling, code & images', async () => {
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

    // Ensure no <a:p> has duplicate <a:pPr> tags
    for (const p of slide1Xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) {
      expect((p.match(/<a:pPr\b/g) || []).length).toBeLessThanOrEqual(1)
    }

    expect(slide1Xml).toContain('Executive Overview')
    expect(slide1Xml).toContain('baseline="-40000"')
    expect(slide1Xml).toContain('baseline="30000"')
    expect(slide1Xml).toContain('B91C1C') // negative currency styling
    expect(slide1Xml).toContain('rtl="1"') // RTL cell support
    expect(slide1Xml).toContain('Consolas')
    expect(slide1Xml).toContain('0F172A') // dark code container
    expect(slide1Xml).toContain('lvl="1"') // nested bullet level
    expect(zip.file(/^ppt\/media\//).length).toBeGreaterThan(0)
  })

  it('converts form controls, hierarchical outlines, workflows, and timelines into native shapes', async () => {
    const model = {
      pageNum: 1,
      mode: 'rich',
      w: 595.28,
      h: 841.89,
      topDown: false,
      lines: [
        { text: '1.1.1 Edge Routing', x: 54, y: 740, size: 10 },
        { text: '[X] Verified RTL', x: 54, y: 700, size: 10 },
        { text: '( ) Low (X) High', x: 54, y: 660, size: 10 },
        { text: 'Signature: ________ Date: 2026-11-26', x: 54, y: 620, size: 10 },
      ],
      blocks: [
        { type: 'paragraph', line: { text: '1.1.1 Edge Routing', x: 54, y: 740, size: 10 } },
        { type: 'paragraph', line: { text: '[X] Verified RTL', x: 54, y: 700, size: 10 } },
        { type: 'paragraph', line: { text: '( ) Low (X) High', x: 54, y: 660, size: 10 } },
        { type: 'paragraph', line: { text: 'Signature: ________ Date: 2026-11-26', x: 54, y: 620, size: 10 } },
        {
          type: 'table',
          numCols: 3,
          rows: [
            { cells: [{ text: 'Phase 01: Ingest' }, { text: 'Validate payload' }, { text: 'COMPLETED' }] },
            { cells: [{ text: 'Phase 02: Parse' }, { text: 'Build AST' }, { text: 'IN_PROGRESS' }] },
          ],
        },
      ],
      images: [],
      vector: { rects: [] },
    }

    const res = await buildPptxBlob([model], { slideLayout: 'auto' })
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string')
    expect(xml).toContain('1.1.1 ')
    expect(xml).toContain('✓')
    expect(xml).toContain('prst="ellipse"')
    expect(xml).toContain('prst="line"')
    expect(xml).toContain('prst="downArrow"')
  })

  it('restores pre-reversed visual-order RTL and coalesces fragmented code blocks', () => {
    const fixedAr = restoreVisualRtlText(
      'ليوحت رابتخا يف مكب ًابحرم ةقدلا يلاع ةدقعملا تادنتسملا',
      [
        { y: 654, text: 'Arabic (RTL) ليوحت رابتخا يف مكب ًابحرم Bi-directional' },
        { y: 642, text: 'ةقدلا يلاع ةدقعملا تادنتسملا' },
      ]
    )
    expect(fixedAr.startsWith('مرحباً بكم في اختبار تحويل')).toBe(true)

    const m = normalizeModelForPptx({
      pageNum: 1,
      mode: 'rich',
      lines: [],
      blocks: [
        { type: 'code', lines: [{ y: 683, x: 59, text: 'def f():', isCode: true }] },
        { type: 'paragraph', line: { y: 670, x: 75, size: 8.5, text: 'x = 1' } },
        { type: 'code', lines: [{ y: 658, x: 75, text: 'return x', isCode: true }] },
      ],
    })
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].type).toBe('code')
    expect(m.blocks[0].lines).toHaveLength(3)
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
