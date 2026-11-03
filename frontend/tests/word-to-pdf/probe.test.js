import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { probeDocument } from '../../src/features/word-to-pdf/lib/probe.js'

function docx(xml, extra = {}) {
  const zipped = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(xml),
    ...extra,
  })
  return new File([zipped], 'a.docx')
}

describe('probeDocument', () => {
  it('rejects wrong extension', async () => {
    const r = await probeDocument(new File(['x'], 'a.pdf'))
    expect(r).toMatchObject({ ok: false, code: 'UNSUPPORTED' })
  })

  it('rejects empty file', async () => {
    const r = await probeDocument(new File([], 'a.docx'))
    expect(r).toMatchObject({ ok: false, code: 'EMPTY' })
  })

  it('rejects text renamed to .docx', async () => {
    const r = await probeDocument(new File(['hello world'], 'a.docx'))
    expect(r).toMatchObject({ ok: false, code: 'INVALID' })
  })

  it('rejects OLE file named .docx as password-protected', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    const r = await probeDocument(new File([ole], 'a.docx'))
    expect(r).toMatchObject({ ok: false, code: 'PROTECTED' })
  })

  it('accepts legacy .doc (OLE)', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    const r = await probeDocument(new File([ole], 'a.doc'))
    expect(r.ok).toBe(true)
  })

  it('rejects zip without word/document.xml', async () => {
    const zipped = zipSync({ 'readme.txt': strToU8('hi') })
    const r = await probeDocument(new File([zipped], 'a.docx'))
    expect(r).toMatchObject({ ok: false, code: 'INVALID' })
  })

  it('accepts plain docx and sees no CJK', async () => {
    const r = await probeDocument(docx('<w:t>Hello</w:t>'))
    expect(r).toEqual({ ok: true, hasCjk: false })
  })

  it('detects CJK in body', async () => {
    const r = await probeDocument(docx('<w:t>你好</w:t>'))
    expect(r).toEqual({ ok: true, hasCjk: true })
  })

  it('detects CJK in header only', async () => {
    const r = await probeDocument(docx('<w:t>Hi</w:t>', { 'word/header1.xml': strToU8('<w:t>こんにちは</w:t>') }))
    expect(r.hasCjk).toBe(true)
  })

  it('stays fast on a big nested-table-like document (no regex blowup)', async () => {
    const xml = '<w:tc>' + '<w:tbl><w:tr><w:tc>x'.repeat(20000)
    const t = performance.now()
    await probeDocument(docx(xml))
    expect(performance.now() - t).toBeLessThan(2000)
  })
})
