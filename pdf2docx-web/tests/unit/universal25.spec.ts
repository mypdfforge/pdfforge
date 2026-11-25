import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync } from 'fflate'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
import { convertPdfToDocx } from '../../src/../../frontend/src/utils/pdfToWordPipeline.js'
import { verifyDocxEntries } from '../../src/../../frontend/src/utils/docxVerify.js'

describe('Universal & 25-page structural regression gate', () => {
  it('reconstructs all tables, TOC entries 1-25, 8-col matrix, and native sub/superscripts without data loss', async () => {
    ;(globalThis as any).pdfjsLib = pdfjsLib
    const pdfPath = resolve(__dirname, '../../../test_25pages_output.pdf')
    const buf = readFileSync(pdfPath)
    const file = {
      name: 'test_25pages_output.pdf',
      size: buf.length,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }

    const res = await convertPdfToDocx(file as any, { useWorkers: false })
    const z = unzipSync(new Uint8Array(await res.blob.arrayBuffer()))
    const entries: Record<string, string> = {}
    const dec = new TextDecoder()
    for (const k of Object.keys(z)) {
      if (k.endsWith('.xml') || k.endsWith('.rels')) entries[k] = dec.decode(z[k])
    }

    const gate = verifyDocxEntries(entries)
    expect(gate.ok).toBe(true)

    const xml = entries['word/document.xml']
    expect((xml.match(/<w:txbxContent/g) || []).length).toBe(0)
    expect((xml.match(/<w:tbl>/g) || []).length).toBeGreaterThanOrEqual(18)

    // TOC stitched across pages 2-3 must retain entry 19 (never drop non-duplicate row 0)
    for (let n = 1; n <= 25; n++) {
      expect(xml).toContain(`${n}. `)
    }
    expect(xml).toContain('19. High-Severity Incident Response Timeline')

    // Section 10 8-column matrix must preserve Zone and Status columns
    expect(xml).toContain('zone-B')
    expect(xml).toContain('OPERATIONAL')
    expect(xml).toContain('WARNING')

    // Native sub/superscripts in Section 09
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>')
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>')

    // Canonical Arabic (no presentation forms U+FB50-U+FEFF)
    expect(/[\uFB50-\uFDFF\uFE70-\uFEFF]/.test(xml)).toBe(false)
  })
})
