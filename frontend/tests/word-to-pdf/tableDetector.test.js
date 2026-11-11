import { describe, it, expect } from 'vitest'
import {
  clusterCoordinates,
  detectTableRegions,
} from '../../src/utils/pdfTableDetector.js'

describe('PDF Table Detector', () => {
  describe('clusterCoordinates', () => {
    it('clusters coordinates within tolerance into column centroids', () => {
      const xVals = [50, 52, 51, 150, 152, 300, 302, 301]
      const cols = clusterCoordinates(xVals, 15)
      expect(cols.length).toBe(3)
      expect(cols[0]).toBe(51)
      expect(cols[1]).toBe(151)
      expect(cols[2]).toBe(301)
    })
  })

  describe('detectTableRegions', () => {
    it('detects a 4-column cluster matrix with a merged header', () => {
      // Mirrors Section 4: Complex Nested Tables with Merged Cells
      const lines = [
        // Paragraph before table
        {
          text: 'Section 04: Complex Nested Tables with Merged Cells',
          size: 16,
          isBold: true,
          items: [{ str: 'Section 04: Complex Nested Tables with Merged Cells', x: 50, y: 700, w: 350, size: 16 }],
        },
        // Row 1: Merged Header
        {
          text: 'ENTERPRISE MULTI-TIER CLUSTER ALLOCATION MATRIX (MERGED HEADER)',
          size: 12,
          isBold: true,
          items: [{ str: 'ENTERPRISE MULTI-TIER CLUSTER ALLOCATION MATRIX (MERGED HEADER)', x: 50, y: 650, w: 480, size: 12 }],
        },
        // Row 2: Sub-headers
        {
          text: 'Cluster Node ID Primary Role vCPU / Memory Cluster State',
          size: 10,
          isBold: true,
          items: [
            { str: 'Cluster Node ID', x: 50, y: 630, w: 90, size: 10, isBold: true },
            { str: 'Primary Role', x: 180, y: 630, w: 80, size: 10, isBold: true },
            { str: 'vCPU / Memory', x: 320, y: 630, w: 80, size: 10, isBold: true },
            { str: 'Cluster State', x: 450, y: 630, w: 80, size: 10, isBold: true },
          ],
        },
        // Row 3: Data row 1
        {
          text: 'node-prod-east-01 Storage Ingestion Primary 64 vCPU / 256 GB RAM HEALTHY (ONLINE)',
          size: 10,
          isBold: false,
          items: [
            { str: 'node-prod-east-01', x: 50, y: 610, w: 90, size: 10 },
            { str: 'Storage Ingestion Primary', x: 180, y: 610, w: 100, size: 10 },
            { str: '64 vCPU / 256 GB RAM', x: 320, y: 610, w: 90, size: 10 },
            { str: 'HEALTHY (ONLINE)', x: 450, y: 610, w: 80, size: 10 },
          ],
        },
        // Row 4: Data row 2
        {
          text: 'node-prod-east-02 Compute Reflow Worker 128 vCPU / 512 GB RAM HEALTHY (ONLINE)',
          size: 10,
          isBold: false,
          items: [
            { str: 'node-prod-east-02', x: 50, y: 590, w: 90, size: 10 },
            { str: 'Compute Reflow Worker', x: 180, y: 590, w: 100, size: 10 },
            { str: '128 vCPU / 512 GB RAM', x: 320, y: 590, w: 90, size: 10 },
            { str: 'HEALTHY (ONLINE)', x: 450, y: 590, w: 80, size: 10 },
          ],
        },
      ]

      const blocks = detectTableRegions(lines, 600)

      expect(blocks.length).toBe(2)
      expect(blocks[0].type).toBe('paragraph')
      expect(blocks[1].type).toBe('table')

      const table = blocks[1]
      expect(table.numCols).toBe(4)
      expect(table.rows.length).toBe(4)

      // Row 0 is merged header
      expect(table.rows[0].cells.length).toBe(1)
      expect(table.rows[0].cells[0].columnSpan).toBe(4)
      expect(table.rows[0].cells[0].align).toBe('center')

      // Row 2 has 4 cells
      expect(table.rows[2].cells.length).toBe(4)
      expect(table.rows[2].cells[0].text).toBe('node-prod-east-01')
    })

    it('identifies multi-currency cells and applies right alignment', () => {
      // Mirrors Section 5: Financial Balance Sheet & Multi-Currency Ledger
      const lines = [
        {
          text: 'Reporting Category Q1 FY26 (USD) Q2 FY26 (EUR) Q3 FY26 (GBP) Variance YoY (%)',
          size: 10,
          isBold: true,
          items: [
            { str: 'Reporting Category', x: 50, y: 500, w: 90, size: 10 },
            { str: 'Q1 FY26 (USD)', x: 160, y: 500, w: 70, size: 10 },
            { str: 'Q2 FY26 (EUR)', x: 250, y: 500, w: 70, size: 10 },
            { str: 'Q3 FY26 (GBP)', x: 340, y: 500, w: 70, size: 10 },
            { str: 'Variance YoY (%)', x: 430, y: 500, w: 70, size: 10 },
          ],
        },
        {
          text: 'Gross SaaS Revenue $14,250,900.00 €12,980,450.00 £11,150,000.00 +34.8%',
          size: 10,
          isBold: false,
          items: [
            { str: 'Gross SaaS Revenue', x: 50, y: 480, w: 90, size: 10 },
            { str: '$14,250,900.00', x: 160, y: 480, w: 70, size: 10 },
            { str: '€12,980,450.00', x: 250, y: 480, w: 70, size: 10 },
            { str: '£11,150,000.00', x: 340, y: 480, w: 70, size: 10 },
            { str: '+34.8%', x: 430, y: 480, w: 40, size: 10 },
          ],
        },
        {
          text: 'Cost of Goods Sold ($3,420,100.00) (€3,120,000.00) (£2,680,200.00) +12.1%',
          size: 10,
          isBold: false,
          items: [
            { str: 'Cost of Goods Sold', x: 50, y: 460, w: 90, size: 10 },
            { str: '($3,420,100.00)', x: 160, y: 460, w: 70, size: 10 },
            { str: '(€3,120,000.00)', x: 250, y: 460, w: 70, size: 10 },
            { str: '(£2,680,200.00)', x: 340, y: 460, w: 70, size: 10 },
            { str: '+12.1%', x: 430, y: 460, w: 40, size: 10 },
          ],
        },
      ]

      const blocks = detectTableRegions(lines, 600)
      expect(blocks.length).toBe(1)
      expect(blocks[0].type).toBe('table')

      const dataRow1 = blocks[0].rows[1]
      // Cell 0 ("Gross SaaS Revenue") is text -> left aligned
      expect(dataRow1.cells[0].align).toBe('left')
      // Cell 1 ("$14,250,900.00") is currency -> right aligned
      expect(dataRow1.cells[1].align).toBe('right')
      // Cell 2 ("€12,980,450.00") is currency -> right aligned
      expect(dataRow1.cells[2].align).toBe('right')
      // Cell 4 ("+34.8%") is percentage -> right aligned
      expect(dataRow1.cells[4].align).toBe('right')

      const dataRow2 = blocks[0].rows[2]
      // Parenthesized negative currency: "($3,420,100.00)" -> right aligned
      expect(dataRow2.cells[1].align).toBe('right')
    })
  })
})
