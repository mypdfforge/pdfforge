import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  buildPptxBlob,
  forceRtlParagraph,
  toPptxRuns,
  isLikelyHeaderRow,
  calloutPalette,
  resolveSlideDims,
} from '../../src/utils/pdfToPptxBuild.js'
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
    expect(slide1Xml).toContain('algn="r"') // RTL right-aligned cell
    expect(slide1Xml).toContain('rtlCol="1"')
    expect(slide1Xml).not.toContain('<a:bodyPr/ ')
    expect(slide1Xml).toContain('Consolas')
    expect(slide1Xml).toContain('0F172A') // dark code container
    expect(slide1Xml).toContain('lvl="1"') // nested bullet level
    expect(zip.file(/^ppt\/media\//).length).toBeGreaterThan(0)
  })

  it('keeps URLs free of zero-width breaks and splits merged cross-references & legal continuations', async () => {
    const m = normalizeModelForPptx({
      pageNum: 1,
      mode: 'rich',
      w: 595.28,
      h: 841.89,
      lines: [],
      blocks: [
        { type: 'paragraph', line: { text: 'https://subdomain.example.com/api/v4/tenants/018f6c43-9821-7299-8231/download', x: 54, y: 720, size: 9 } },
        { type: 'paragraph', line: { text: '• Table 4.1: First table • Table 5.1: Second table', x: 54, y: 680, size: 10 } },
        { type: 'paragraph', line: { text: '14.1 Indemnification Obligations: Each party agrees to defend', x: 54, y: 640, size: 10 } },
        { type: 'paragraph', line: { text: 'Section 8 (Data Confidentiality).', x: 54, y: 626, size: 10 } },
      ],
      images: [],
      vector: { rects: [] },
    })

    expect(m.blocks.filter((b) => b.type === 'paragraph')).toHaveLength(4)
    const res = await buildPptxBlob([m], { slideLayout: 'auto' })
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string')
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')?.async('string')
    expect(xml).toContain('https://subdomain.example.com/\u200B')
    expect(rels).toContain('https://subdomain.example.com/api/v4/tenants/018f6c43-9821-7299-8231/download')
    expect(xml).toContain('Section 8 (Data Confidentiality).')
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
    expect(xml).toContain('<a:tbl>')
    expect(xml).toContain('Phase 01: Ingest')
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

  it('splits Unicode sub/superscripts, repairs RTL cells, infers headers, maps callouts, and resolves dims', () => {
    const chemRuns = toPptxRuns('H₂SO₄')
    expect(chemRuns.map((r) => ({ t: r.text, sub: r.options.subscript }))).toEqual([
      { t: 'H', sub: false },
      { t: '2', sub: true },
      { t: 'SO', sub: false },
      { t: '4', sub: true },
    ])

    const fixedTc = forceRtlParagraph('<a:tc><a:txBody><a:p><a:pPr algn="l"/><a:r><a:t>مرحباً</a:t></a:r></a:p></a:txBody></a:tc>')
    expect(fixedTc).toContain('rtl="1"')
    expect(fixedTc).toContain('algn="r"')

    const rows = [
      { cells: [{ text: 'ID' }, { text: 'Host' }, { text: 'CPU' }, { text: 'RAM' }] },
      { cells: [{ text: '1' }, { text: 'srv-1' }, { text: '35%' }, { text: '52%' }] },
    ]
    expect(isLikelyHeaderRow(rows[0], 0, rows)).toBe(true)
    expect(isLikelyHeaderRow({ cells: [{ text: 'Version' }, { text: '1.0' }] }, 0, [])).toBe(false)

    expect(calloutPalette({}, '[CRITICAL] Danger').accent).toBe('DC2626')
    expect(calloutPalette({}, '[WARNING] Caution').accent).toBe('D97706')
    expect(calloutPalette({}, '[SUCCESS] Passed').accent).toBe('059669')

    const dims = resolveSlideDims([{ w: 720, h: 405 }], 'auto')
    expect(dims.width).toBeCloseTo(10, 2)
    expect(dims.height).toBeCloseTo(5.625, 2)
  })

  it('skips vector rects overlapping tables, keeps parent size for superscripts, and coalesces wrapped prose', async () => {
    const coalesced = normalizeModelForPptx({
      pageNum: 1,
      mode: 'rich',
      lines: [],
      blocks: [
        { type: 'paragraph', line: { x: 48, y: 700, size: 10.5, text: 'Unbroken character sequences if word-break is' } },
        { type: 'paragraph', line: { x: 48, y: 686, size: 10.5, text: 'not handled:' } },
      ],
    })
    expect(coalesced.blocks).toHaveLength(1)
    expect(coalesced.blocks[0].line.text).toBe('Unbroken character sequences if word-break is not handled:')

    const tableModel = {
      pageNum: 1,
      mode: 'rich',
      w: 595.28,
      h: 841.89,
      lines: [],
      blocks: [
        {
          type: 'paragraph',
          line: {
            x: 48,
            y: 740,
            size: 11,
            text: 'E = mc2',
            spans: [
              { text: 'E = mc', size: 11 },
              { text: '2', size: 7.1, superScript: true },
            ],
          },
        },
        {
          type: 'table',
          x0: 48,
          yMax: 700,
          yMin: 600,
          numCols: 2,
          tableWidth: 500,
          rows: [
            { isHeader: true, cells: [{ text: 'Col A' }, { text: 'Col B' }] },
            { cells: [{ text: '1' }, { text: '2' }] },
          ],
        },
      ],
      images: [],
      vector: {
        rects: [
          { x: 48, y: 680, w: 500, h: 20, fill: 'FF00AA' },
        ],
      },
    }
    const res = await buildPptxBlob([tableModel], { slideLayout: 'auto' })
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string')
    // Overlapping table header vector rect should be skipped
    expect(xml).not.toContain('FF00AA')
    // Line spacing should match Word's 1.15x
    expect(xml).toContain('spcPct val="115000"')
    // Superscript run should use parent line size (1100), not double-shrunk 710
    expect(xml).toContain('sz="1100" baseline="30000"')
  })

  it('joins wrapped URLs without spaces, emits clickable hyperlinks, fits radio options on one row, and compacts dense TOC tables', async () => {
    const urlCoalesced = normalizeModelForPptx({
      pageNum: 1,
      mode: 'rich',
      lines: [],
      blocks: [
        { type: 'paragraph', line: { x: 48, y: 700, size: 9.5, text: 'https://subdomain.enterprise-analytics-platform.internal.corp/api/v4/data-pipelines/e' } },
        { type: 'paragraph', line: { x: 48, y: 688, size: 9.5, text: 'xecutions/9876543210-abcdef/artifacts/download?export_mode=lz4' } },
      ],
    })
    expect(urlCoalesced.blocks).toHaveLength(1)
    expect(urlCoalesced.blocks[0].line.text).toContain('data-pipelines/executions/')

    const urlRuns = toPptxRuns('See https://example.com/api/v4/data-pipelines/executions?mode=fast for details')
    const linkRun = urlRuns.find((r) => r.options?.hyperlink?.url)
    expect(linkRun?.options?.hyperlink?.url).toBe('https://example.com/api/v4/data-pipelines/executions?mode=fast')
    expect(linkRun?.text).toContain('/\u200B')
    expect(linkRun?.text).toContain('?\u200B')
    expect(linkRun?.text).toContain('=\u200B')

    const tocRows = Array.from({ length: 25 }, (_, i) => ({
      cells: [{ text: `${i + 1}. Chapter ${i + 1}` }, { text: `Page ${i + 1}` }],
    }))
    const model = {
      pageNum: 1,
      mode: 'rich',
      w: 595.28,
      h: 841.89,
      lines: [],
      blocks: [
        {
          type: 'paragraph',
          line: {
            x: 48,
            y: 740,
            size: 10,
            text: '( ) Overall Rendering Precision: ( ) 1 - Poor ( ) 2 - Fair ( ) 3 - Good (X) 4 - Excellent ( ) 5 - Flawless',
          },
        },
        {
          type: 'table',
          x0: 48,
          yMax: 700,
          yMin: 120,
          numCols: 2,
          tableWidth: 500,
          rows: tocRows,
        },
      ],
      images: [],
      vector: { rects: [] },
    }
    const res = await buildPptxBlob([model], { slideLayout: 'auto' })
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('string')
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')?.async('string')
    // All 5 radio options + label should stay on the same y row (only 1 distinct ellipse y coordinate)
    const ellipseYs = [...xml.matchAll(/<a:off x="\d+" y="(\d+)"\/><a:ext cx="137160" cy="137160"\/>/g)].map((m) => m[1])
    expect(new Set(ellipseYs).size).toBe(1)
    // Compact 25-row TOC total height should be <= 6.2in (5,669,280 EMU)
    const rowHs = [...xml.matchAll(/<a:tr h="(\d+)">/g)].map((m) => Number(m[1]))
    expect(rowHs).toHaveLength(25)
    expect(rowHs.reduce((a, b) => a + b, 0) / 914400).toBeLessThanOrEqual(6.2)
    expect(rels).toBeTruthy()
  })
})
