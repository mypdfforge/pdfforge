import test from 'node:test'
import assert from 'node:assert/strict'
import { open, fixture, L, pageTexts, loadPdfjs } from './helpers.ts'
import { PdfEngine, EngineError } from '../core/engine.ts'
import { extractDocument } from '../core/extract.ts'
import { Measurer } from '../core/fonts.ts'
import { buildPlan } from '../core/plan.ts'
import { parseContent, analyze, rewrite } from '../core/contentStream.ts'
import { metricsFor, readContent } from '../core/pdflibInfo.ts'
import { readFonts } from '../core/pdflibInfo.ts'
import { pdfToCss, cssToPdf, rectToCss } from '../core/geometry.ts'
import { wrapText } from '../core/layout.ts'
import { EditorStore } from '../core/store.ts'
import { reconstruct, layoutFlow } from '../core/reflow.ts'

const find = (doc: any, text: string) => Object.values<any>(doc.els).find((e) => e.text === text)
async function opsOf(bytes: Uint8Array, page: number) {
  const d = await L.PDFDocument.load(bytes), pg = d.getPage(page)
  return analyze(parseContent(readContent(L, d, pg)!), metricsFor(readFonts(L, d, pg)))
}

test('geometry: zoom never changes stored geometry; css<->pdf round trip', () => {
  const p = { x0: 0, y0: 0, width: 595, height: 842 }
  for (const z of [0.5, 1, 1.75, 3]) {
    const [cx, cy] = pdfToCss(p, z, 100, 700)
    const [x, y] = cssToPdf(p, z, cx, cy)
    assert.ok(Math.abs(x - 100) < 1e-9 && Math.abs(y - 700) < 1e-9)
  }
  const r = rectToCss(p, 2, { x: 10, y: 20, w: 30, h: 40 })
  assert.deepEqual(r, { left: 20, top: (842 - 60) * 2, width: 60, height: 80 })
  const off = { x0: 10, y0: 20, width: 100, height: 100 } // non-zero origin crop box
  const [ox, oy] = pdfToCss(off, 1, 10, 120)
  assert.deepEqual([ox, oy], [0, 0])
})

test('tokenizer: escapes, hex strings, arrays, comments, inline images', () => {
  const src = '% c\nBT /F1 12 Tf (a\\(b\\)\\101) Tj <4142> Tj [(x) -20 (y)] TJ ET\nq BI /W 1 /H 1 ID \x00EI\x01 EI Q (z) Tj'
  const ins = parseContent(src)
  assert.deepEqual(ins.map((i) => i.op), ['BT', 'Tf', 'Tj', 'Tj', 'TJ', 'ET', 'q', 'BI', 'Q', 'Tj'])
  assert.equal(ins[2].args[0].v, 'a(b)A')
  assert.equal(ins[3].args[0].v, 'AB')
  assert.equal(ins[9].args[0].v, 'z')
})

test('rewrite: only the targeted instruction changes; byte-exact elsewhere; move wraps with Td pair', () => {
  const src = 'BT /F1 10 Tf 1 0 0 1 50 700 Tm (keep) Tj 1 0 0 1 50 680 Tm (gone) Tj ET'
  const ins = parseContent(src)
  const out = rewrite(src, ins, [{ idx: 5, action: 'remove' }])
  assert.ok(out.includes('(keep) Tj') && !out.includes('gone'))
  const mv = rewrite(src, ins, [{ idx: 5, action: 'move', dy: -12.5 }])
  assert.ok(/0 -12.5 Td\n\(gone\) Tj\n0 12.5 Td/.test(mv))
})

test('extraction recovers original font family, size, weight, italic and colour', async () => {
  const { doc } = await open('resume.pdf')
  const h = find(doc, 'Jane Doe'), sub = find(doc, 'Software Developer'), it = find(doc, 'Backend engineer working on payments'), mono = find(doc, 'GPA 3.8 / 4.0')
  assert.deepEqual([h.style.family, h.style.bold, h.style.size], ['Helvetica', true, 24])
  assert.ok(Math.abs(h.style.color[2] - 0.5) < 0.01 && Math.abs(h.style.color[0] - 0.1) < 0.01)
  assert.deepEqual(sub.style.color.map((c: number) => +c.toFixed(2)), [0.3, 0.3, 0.3])
  assert.deepEqual([it.style.family, it.style.italic, it.style.bold], ['Times', true, false])
  assert.equal(mono.style.family, 'Courier')
  assert.equal(h.fidelity, 'exact')
  assert.equal(doc.pages.length, 2)
  assert.ok(doc.pages[0].images >= 1 && doc.pages[0].paints >= 1)
})

test('editing text preserves style/colour/position and is non-destructive (no white rectangle)', async () => {
  const { engine, doc, m } = await open('resume.pdf')
  const before = await opsOf(fixture('resume.pdf'), 0)
  const e = find(doc, 'Software Developer')
  e.text = 'Senior Software Developer'
  const { bytes, report } = await engine.build(buildPlan(doc, m))
  assert.equal(report.pageCount, 2)
  const texts = await pageTexts(bytes)
  assert.ok(texts[0].includes('Senior Software Developer'))
  assert.ok(!/\|Software Developer\|/.test(texts[0]), 'original text must be gone')
  for (const keep of ['Jane Doe', 'Experience', 'Acme Corp', 'BSc Computer Science, State University']) assert.ok(texts[0].includes(keep), keep)
  assert.ok(texts[1].includes('Python, JavaScript'))
  const after = await opsOf(bytes, 0)
  const nw = after.ops.find((o) => o.y.toFixed(1) === e.baseline.toFixed(1) && Math.abs(o.x - e.x) < 0.01 && o.size === 11 && o.idx > before.ops.length)!
  assert.ok(nw, 'new text drawn at original origin and size')
  assert.deepEqual(nw.color!.map((c) => +c.toFixed(2)), [0.3, 0.3, 0.3])
  // graphics untouched: same image + same fills count, and no extra filled rectangles were added
  assert.equal(after.images, before.images)
  assert.equal(after.paints, before.paints)
})

test('Design Lock: longer text is flagged (overflow), never silently clipped; wrap and shrink resolve it', async () => {
  const { doc, m, engine } = await open('resume.pdf')
  const store = new EditorStore(doc, m)
  const dates = find(doc, '2020 - 2023')
  store.setText(dates.id, '2020 - 2023 (present, ongoing contract role)')
  let rep = store.issues()
  assert.ok(rep.byId[dates.id]?.some((i) => i.kind === 'overflow' || i.kind === 'collision'))
  const acme = find(doc, 'Acme Corp')
  store.setText(acme.id, 'Acme Corporation International Holdings and Partners Worldwide Limited Group of Companies Europe')
  assert.ok(store.issues().byId[acme.id]?.some((i) => i.kind === 'overflow'), 'region ends before the date column, not at the page edge')
  assert.ok(store.doc.els[acme.id].maxW < 440)
  store.shrinkToFit(acme.id)
  store.setWrap(acme.id, true)
  const { bytes } = await engine.build(buildPlan(store.doc, m))
  assert.ok((await pageTexts(bytes))[0].includes('Acme Corporation'))
})

test('wrapping: width-correct lines, explicit breaks, long words broken', async () => {
  const m = await Measurer.create(L)
  const st: any = { family: 'Helvetica', bold: false, italic: false, size: 10, charSpacing: 0, wordSpacing: 0 }
  const lines = wrapText('one two three four five six seven eight nine ten\nsecond para', 80, st, m)
  for (const l of lines) assert.ok(m.width(l, st) <= 80.01, l)
  assert.ok(lines.includes('second para'))
  const long = wrapText('Supercalifragilisticexpialidocious', 50, st, m)
  assert.ok(long.length > 1 && long.every((l) => m.width(l, st) <= 50.01))
})

test('unsupported characters are reported, never silently dropped', async () => {
  const { doc, m, engine } = await open('resume.pdf')
  const s = new EditorStore(doc, m)
  const e = find(doc, 'Jane Doe')
  s.setText(e.id, 'Jane ✓ Doe')
  assert.ok(s.issues().byId[e.id].some((i) => i.kind === 'encoding'))
  const { report } = await engine.build(buildPlan(s.doc, m))
  assert.ok(report.warnings.length >= 1)
})

test('fonts that cannot be reproduced are labelled as substituted, with a note', async () => {
  const { doc } = await open('ttf.pdf')
  const e = Object.values<any>(doc.els)[0]
  assert.equal(e.fidelity, 'substituted')
  assert.match(e.fontNote, /cannot be reproduced/)
})

test('text in form XObjects is locked, not destroyed; explicit cover is opt-in', async () => {
  const { doc, m, engine } = await open('form.pdf')
  const f = find(doc, 'Inside a form xobject')
  assert.ok(f.locked)
  const s = new EditorStore(doc, m)
  s.setText(f.id, 'changed')
  assert.equal(s.doc.els[f.id].text, 'Inside a form xobject', 'locked text is not editable')
  assert.ok(find(doc, 'Plain text line').locked === null)
  s.coverLocked(f.id, [1, 1, 1]); s.setText(f.id, 'changed')
  const { bytes } = await engine.build(buildPlan(s.doc, m))
  assert.ok((await pageTexts(bytes))[0].includes('changed'))
})

test('rotated pages are read-only; scans and bad files fail gracefully', async () => {
  const r = await open('rotated.pdf')
  assert.ok(Object.values<any>(r.doc.els).filter((e) => e.page === 0).every((e) => e.locked), 'rotated page read-only')
  assert.ok(Object.values<any>(r.doc.els).filter((e) => e.page === 1).every((e) => !e.locked))
  const sc = await open('scan.pdf')
  assert.ok(sc.notes.some((n) => /No selectable text/.test(n)))
  const enc = new PdfEngine(L)
  await assert.rejects(() => enc.open(fixture('encrypted.pdf')), (e: any) => e instanceof EngineError && e.code === 'encrypted')
  const bad = new PdfEngine(L)
  await assert.rejects(() => bad.open(fixture('corrupt.pdf')), (e: any) => e instanceof EngineError && e.code === 'corrupt')
})

test('store: undo/redo restore exact state; Format Painter copies style only; global style ops', async () => {
  const { doc, m } = await open('resume.pdf')
  const s = new EditorStore(doc, m)
  const a = find(doc, 'Experience'), b = find(doc, 'BSc Computer Science, State University'), c = find(doc, 'Education')
  const original = JSON.stringify(s.doc)
  s.select({ kind: 'el', id: b.id }); s.setStyle({ bold: true, size: 13, color: [1, 0, 0], underline: true })
  assert.equal(s.doc.els[b.id].style.size, 13)
  s.undo(); assert.equal(JSON.stringify(s.doc), original); s.redo(); assert.equal(s.doc.els[b.id].style.size, 13)
  // painter: source = Experience heading
  s.select({ kind: 'el', id: a.id }); assert.ok(s.startPainter())
  const textBefore = s.doc.els[b.id].text, posBefore = [s.doc.els[b.id].x, s.doc.els[b.id].baseline]
  s.paintOn({ kind: 'el', id: b.id })
  assert.deepEqual(s.doc.els[b.id].style, a.style)
  assert.equal(s.doc.els[b.id].text, textBefore); assert.deepEqual([s.doc.els[b.id].x, s.doc.els[b.id].baseline], posBefore)
  s.undo(); assert.equal(s.doc.els[b.id].style.size, 13)
  // global: all headings matching "Experience" style -> navy to red, undoable
  s.select({ kind: 'el', id: a.id })
  const match = s.matchSelection(); assert.ok(match.els.includes(a.id) && match.els.includes(c.id))
  s.applyToAll(match, { color: [0.8, 0, 0] }, 'Colour'); assert.equal(s.doc.els[c.id].style.color[0], 0.8)
  assert.equal(s.doc.els[find(doc, 'Jane Doe').id].style.color[0], 0.1 , 'unrelated elements untouched')
  s.undo(); assert.equal(s.doc.els[c.id].style.color[0], a.style.color[0])
  assert.equal(s.findReplace('Acme', 'Globex'), 1); assert.equal(find(s.doc, 'Globex Corp') ? 1 : 0, 1)
  s.undo(); assert.ok(find(s.doc, 'Acme Corp'))
})

test('formatting reaches the exported PDF (bold, italic, size, colour, underline, highlight, spacing)', async () => {
  const { doc, m, engine } = await open('resume.pdf')
  const s = new EditorStore(doc, m)
  const t = find(doc, 'BSc Computer Science, State University')
  s.select({ kind: 'el', id: t.id })
  s.setStyle({ bold: true, italic: true, size: 14, color: [0, 0.5, 0], underline: true, strike: true, highlight: [1, 1, 0], charSpacing: 0.5 })
  const { bytes } = await engine.build(buildPlan(s.doc, m))
  const a = await opsOf(bytes, 0)
  const op = a.ops.find((o) => o.size === 14 && Math.abs(o.x - t.x) < 0.01 && Math.abs(o.y - t.baseline) < 0.01)!
  assert.ok(op); assert.deepEqual(op.color!.map((c) => +c.toFixed(1)), [0, 0.5, 0]); assert.equal(op.tc, 0.5)
  const d = await L.PDFDocument.load(bytes)
  const f = readFonts(L, d, d.getPage(0))
  assert.ok(Object.values<any>(f).some((x) => x.baseFont === 'Helvetica-BoldOblique'))
  assert.ok(a.paints >= (await opsOf(fixture('resume.pdf'), 0)).paints + 3, 'highlight + underline + strike drawn')
})

test('Document Reflow: unedited reconstruct is lossless; growth pushes content, followers travel; extra page generated', async () => {
  const { doc, m, engine } = await open('paragraphs.pdf')
  const s = new EditorStore(doc, m)
  const { notes } = s.setMode('reflow'); assert.ok(Array.isArray(notes))
  const blocks = s.doc.blocks!
  assert.ok(blocks.some((b) => b.role === 'heading') && blocks.some((b) => b.role === 'paragraph'))
  assert.ok(blocks.some((b) => b.followers.length), 'right-aligned dates are row followers')
  const plain = buildPlan(s.doc, m)
  assert.ok(plain.pages.every((p) => p.edits.length === 0 && p.draws.length === 0), 'no change => untouched output')
  const p0 = blocks.filter((b) => b.page === 0 && b.role === 'paragraph')[0]
  const orig = s.doc.blocks!.map((b) => b.top)
  s.setBlockText(p0.id, (p0.text + ' ').repeat(2) + 'ENDMARK')
  const f = layoutFlow(s.doc, m)
  assert.ok(f.placed.every((pb) => pb.lines.length > 0))
  const first = f.placed.find((x) => x.block.id === p0.id)!
  const nextBlock = f.placed.find((x) => x.block.id === blocks[blocks.indexOf(p0) + 1].id)!
  assert.ok(nextBlock.rect.top < blocks[blocks.indexOf(p0) + 1].top - 1 || nextBlock.page > 0, 'following block moved down / to next page')
  // grow enough to create an additional page
  s.setBlockText(p0.id, (p0.text + ' ').repeat(40) + 'ENDMARK')
  const rep = s.issues(); assert.ok(rep.pageCount > 2, 'additional pages generated')
  const { bytes, report } = await engine.build(buildPlan(s.doc, m))
  assert.equal(report.pageCount, rep.pageCount)
  const texts = await pageTexts(bytes)
  assert.ok(texts.join('').includes('ENDMARK'))
  // every original word still present exactly once for headings
  for (const h of ['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Company 1']) assert.equal((texts.join('|').match(new RegExp(h + '(?!\\d)', 'g')) ?? []).length, 1, h)
  // dates (followers) still next to their companies: appear once
  assert.equal((texts.join('|').match(/2012 - 2014/g) ?? []).length, 1)
  void orig; void first
  // no text is drawn below the content limit or off page
  for (let i = 0; i < report.pageCount; i++) {
    const a = await opsOf(bytes, i)
    for (const o of a.ops) assert.ok(o.y > 20 && o.y < 792, `baseline ${o.y} page ${i}`)
  }
})

test('reflow edits are undoable and Design Lock switch restores the original model', async () => {
  const { doc, m } = await open('paragraphs.pdf')
  const s = new EditorStore(doc, m)
  const snapshot = JSON.stringify(s.doc)
  s.setMode('reflow')
  const b = s.doc.blocks!.find((x) => x.role === 'paragraph')!
  s.setBlockText(b.id, 'short'); assert.ok(s.doc.blocks!.find((x) => x.id === b.id)!.edited)
  s.setBlockText(b.id, b.text); assert.ok(!s.doc.blocks!.find((x) => x.id === b.id)!.edited, 'reverting text clears edited flag')
  s.undo(); s.undo(); s.undo()
  assert.equal(JSON.stringify(s.doc), snapshot)
})

test('preview of single pages matches the full export for those pages', async () => {
  const { doc, m, engine } = await open('resume.pdf')
  find(doc, 'Jane Doe').text = 'Janet Doe'
  const plan = buildPlan(doc, m)
  const full = await pageTexts((await engine.build(plan)).bytes)
  const prev = await pageTexts((await engine.build(plan, { only: [0] })).bytes)
  assert.equal(prev.length, 1); assert.equal(prev[0], full[0])
})

test('cancellation stops a build', async () => {
  const { doc, m, engine } = await open('many.pdf')
  await assert.rejects(() => engine.build(buildPlan(doc, m), { isCancelled: () => true }), (e: any) => e.code === 'cancelled')
})

test('large document (60 pages): extract + edit + export stays fast; untouched pages unchanged', async () => {
  const t0 = performance.now()
  const { doc, m, engine } = await open('many.pdf')
  const tOpen = performance.now() - t0
  find(doc, 'Page 30 line 5 lorem ipsum dolor sit amet consectetur').text = 'EDITED LINE'
  const t1 = performance.now()
  const { bytes, report } = await engine.build(buildPlan(doc, m))
  const tExport = performance.now() - t1
  assert.equal(report.pageCount, 60)
  const texts = await pageTexts(bytes)
  assert.ok(texts[29].includes('EDITED LINE') && !texts[29].includes('line 5 lorem'))
  assert.ok(texts[10].includes('Page 11 line 1 '))
  console.log(`  [perf] 60 pages: open+extract ${Math.round(tOpen)}ms, export ${Math.round(tExport)}ms`)
  assert.ok(tOpen < 15000 && tExport < 8000)
})

test('exported PDF reopens in a second parser and keeps document structure (page count, sizes)', async () => {
  const { doc, m, engine } = await open('resume.pdf')
  find(doc, 'Jane Doe').text = 'Janet Doe'
  const { bytes } = await engine.build(buildPlan(doc, m))
  const pdf = await loadPdfjs(bytes)
  assert.equal(pdf.numPages, 2)
  const vp = (await pdf.getPage(1)).getViewport({ scale: 1 })
  assert.ok(Math.abs(vp.width - 595.28) < 0.1)
  const re = await L.PDFDocument.load(bytes); assert.equal(re.getPageCount(), 2)
})

test('reflow geometry (read back with pdf.js): shrinking a paragraph moves later blocks up by the same amount, dates stay on their row', async () => {
  const { doc, m, engine, pdf } = await open('paragraphs.pdf')
  const s = new EditorStore(doc, m); s.setMode('reflow')
  const para = s.doc.blocks!.filter((b) => b.page === 0 && b.role === 'paragraph')[0]
  s.setBlockText(para.id, 'Short.')
  const { bytes } = await engine.build(buildPlan(s.doc, m))
  const items = async (b: Uint8Array | any, pg: number) => {
    const d = b instanceof Uint8Array ? await loadPdfjs(b) : b
    const tc = await (await d.getPage(pg + 1)).getTextContent()
    return tc.items.filter((i: any) => i.str.trim()).map((i: any) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
  }
  const o = await items(pdf, 0), n = await items(bytes, 0)
  const at = (arr: any[], t: string) => arr.find((i) => i.s === t)
  // heading before the edited paragraph is untouched
  assert.ok(Math.abs(at(o, 'Section 1').y - at(n, 'Section 1').y) < 0.01)
  // "Section 2" is after the edited paragraph in the same column => moved up
  const dy = at(n, 'Section 2').y - at(o, 'Section 2').y
  assert.ok(dy > 20, `expected Section 2 to move up, got ${dy}`)
  // every later item on the page moved by the same amount (rigid shift), including the dates
  for (const t of ['Company 2', '2012 - 2014']) assert.ok(Math.abs((at(n, t).y - at(o, t).y) - dy) < 0.05, t)
  assert.ok(Math.abs(at(n, 'Company 2').y - at(n, '2012 - 2014').y) < 0.05, 'date stays on its heading row')
  // x positions never change in reflow
  assert.ok(Math.abs(at(n, '2012 - 2014').x - at(o, '2012 - 2014').x) < 0.05)
  // the page header band etc. are not part of this fixture; all original lines of untouched paragraphs are still present
  const lorem = o.filter((i: any) => i.s.startsWith('Designed')).length
  assert.ok(n.filter((i: any) => i.s.startsWith('Designed')).length >= lorem - 3)
})

test('export validation reopens the PDF and confirms page count + edited content; catches a wrong export', async () => {
  const { validateExport } = await import('../core/validate.ts')
  const { getPdfjs } = await import('./helpers.ts')
  const pdfjs = await getPdfjs()
  const { doc, m, engine, bytes: src } = await open('resume.pdf')
  find(doc, 'Software Developer').text = 'Senior Software Developer'
  const plan = buildPlan(doc, m)
  const good = await validateExport(pdfjs, (await engine.build(plan)).bytes, doc, plan)
  assert.ok(good.ok, JSON.stringify(good)); assert.equal(good.checked, 1)
  // exporting the unmodified source while the model shows edits must be detected
  const bad = await validateExport(pdfjs, src, doc, plan)
  assert.ok(!bad.ok && bad.missing.length === 1)
  // a wrong plan (edit drawn but original not removed) is caught as a leftover
  const sloppy = { pages: plan.pages.map((p) => ({ ...p, edits: [] })) }
  const leak = await validateExport(pdfjs, (await engine.build(sloppy)).bytes, doc, plan)
  assert.ok(leak.leftovers.length === 1 && !leak.ok)
})

test('file validation: size limit, PDF signature, empty files', async () => {
  const { checkFile, LIMITS } = await import('../core/limits.ts')
  const head = fixture('resume.pdf').slice(0, 1024)
  assert.equal(checkFile('a.pdf', 1000, head).ok, true)
  assert.match((checkFile('a.pdf', 0, head) as any).error, /empty/)
  assert.match((checkFile('a.pdf', LIMITS.maxBytes + 1, head) as any).error, /supports up to 50 MB/)
  assert.match((checkFile('a.pdf', 10, new TextEncoder().encode('hello')) as any).error, /does not look like a PDF/)
})
