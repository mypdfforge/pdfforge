import { describe, it, expect } from 'vitest'
import {
  wrapUnbrokenStrings,
  segmentIntoColumns,
  sanitizeXml,
} from '../../src/utils/pdfLayoutSegmenter.js'

describe('PDF Layout Segmenter', () => {
  describe('sanitizeXml', () => {
    it('removes illegal XML control characters while preserving text', () => {
      const input = 'Valid text\x00\x08\x0bwith\x0csome\x1fchars'
      expect(sanitizeXml(input)).toBe('Valid textwithsomechars')
    })
  })

  describe('wrapUnbrokenStrings', () => {
    it('injects zero-width break tokens into long URLs', () => {
      const longUrl =
        'https://subdomain.enterprise-analytics-platform.internal.corp/api/v4/tenants/018f6c43-9821-7299-8231-abcdef012345/data-pipelines/executions'
      const wrapped = wrapUnbrokenStrings(longUrl, 35)
      expect(wrapped).toContain('\u200B')
      expect(wrapped.replace(/\u200B/g, '')).toBe(longUrl)
    })

    it('leaves standard short words intact without zero-width spaces', () => {
      const short = 'The quick brown fox jumps over the lazy dog.'
      expect(wrapUnbrokenStrings(short, 35)).toBe(short)
    })
  })

  describe('segmentIntoColumns', () => {
    it('prevents column interleaving by outputting Column 1 before Column 2', () => {
      // Synthetic 2-column layout mirroring Section 3 of test_25pages_output.pdf:
      // Page width: 600. Content bounds: 50 to 550 (width: 500)
      // Column 1: x: 50, width: 200 (xEnd: 250)
      // Column 2: x: 300, width: 200 (xEnd: 500)
      // Row 1: y = 500. Col 1 Line 1, Col 2 Line 1
      // Row 2: y = 480. Col 1 Line 2, Col 2 Line 2
      const items = [
        // Column 1 Line 1
        { str: 'Column 1 Line 1', x: 50, y: 500, w: 180, h: 12, size: 11, fontName: 'Calibri' },
        // Column 2 Line 1 (shares same Y!)
        { str: 'Column 2 Line 1', x: 310, y: 500, w: 180, h: 12, size: 11, fontName: 'Calibri' },
        // Column 1 Line 2
        { str: 'Column 1 Line 2', x: 50, y: 480, w: 180, h: 12, size: 11, fontName: 'Calibri' },
        // Column 2 Line 2 (shares same Y!)
        { str: 'Column 2 Line 2', x: 310, y: 480, w: 180, h: 12, size: 11, fontName: 'Calibri' },
      ]

      const ordered = segmentIntoColumns(items, 600)
      const texts = ordered.map((l) => l.text)

      // Must be Column 1 Line 1, Column 1 Line 2, Column 2 Line 1, Column 2 Line 2
      // NOT Column 1 Line 1 + Column 2 Line 1 on the same row!
      expect(texts).toEqual([
        'Column 1 Line 1',
        'Column 1 Line 2',
        'Column 2 Line 1',
        'Column 2 Line 2',
      ])
    })

    it('keeps full-width title banners before multi-column content', () => {
      const items = [
        // Full width banner at top (y=600)
        { str: 'Full Width Title Banner', x: 50, y: 600, w: 450, h: 20, size: 18, fontName: 'Calibri-Bold' },
        // Col 1 (y=500, 480)
        { str: 'Col 1 A', x: 50, y: 500, w: 180, h: 12, size: 11, fontName: 'Calibri' },
        { str: 'Col 1 B', x: 50, y: 480, w: 180, h: 12, size: 11, fontName: 'Calibri' },
        // Col 2 (y=500, 480)
        { str: 'Col 2 A', x: 310, y: 500, w: 180, h: 12, size: 11, fontName: 'Calibri' },
        { str: 'Col 2 B', x: 310, y: 480, w: 180, h: 12, size: 11, fontName: 'Calibri' },
      ]

      const ordered = segmentIntoColumns(items, 600)
      const texts = ordered.map((l) => l.text)

      expect(texts[0]).toBe('Full Width Title Banner')
      expect(texts.slice(1)).toEqual(['Col 1 A', 'Col 1 B', 'Col 2 A', 'Col 2 B'])
    })
  })

  describe('spans and script detection', () => {
    it('detects subscript on chemical formulas like H2SO4', () => {
      // Line: H (y=500, sz=11), 2 (y=498.5, sz=8), SO (y=500, sz=11), 4 (y=498.5, sz=8)
      const items = [
        { str: 'H', x: 50, y: 500, w: 10, h: 11, size: 11, fontName: 'Calibri' },
        { str: '2', x: 60, y: 498.5, w: 6, h: 8, size: 8, fontName: 'Calibri' },
        { str: 'SO', x: 66, y: 500, w: 18, h: 11, size: 11, fontName: 'Calibri' },
        { str: '4', x: 84, y: 498.5, w: 6, h: 8, size: 8, fontName: 'Calibri' },
      ]

      const ordered = segmentIntoColumns(items, 600)
      expect(ordered.length).toBe(1)
      const spans = ordered[0].spans

      const subSpans = spans.filter((s) => s.subScript)
      expect(subSpans.length).toBe(2)
      expect(subSpans[0].text.trim()).toBe('2')
      expect(subSpans[1].text.trim()).toBe('4')
    })

    it('detects superscript on mathematical powers like E = mc2', () => {
      // Line: E = mc (y=500, sz=11), 2 (y=502.5, sz=8)
      const items = [
        { str: 'E = mc', x: 50, y: 500, w: 40, h: 11, size: 11, fontName: 'Calibri' },
        { str: '2', x: 92, y: 502.5, w: 6, h: 8, size: 8, fontName: 'Calibri' },
      ]

      const ordered = segmentIntoColumns(items, 600)
      expect(ordered.length).toBe(1)
      const spans = ordered[0].spans

      const superSpans = spans.filter((s) => s.superScript)
      expect(superSpans.length).toBe(1)
      expect(superSpans[0].text.trim()).toBe('2')
    })

    it('detects inline color keywords', () => {
      const items = [
        { str: 'Red', x: 50, y: 500, w: 25, h: 11, size: 11, fontName: 'Calibri' },
        { str: 'Green', x: 80, y: 500, w: 35, h: 11, size: 11, fontName: 'Calibri' },
        { str: 'Blue', x: 120, y: 500, w: 30, h: 11, size: 11, fontName: 'Calibri' },
      ]

      const ordered = segmentIntoColumns(items, 600)
      const spans = ordered[0].spans
      expect(spans[0].color).toBe('FF0000')
      expect(spans[1].color).toBe('008000')
      expect(spans[2].color).toBe('0000FF')
    })
  })
})
