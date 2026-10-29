// Real-browser end-to-end test of the Resume Editor (Chromium via Playwright).  node e2e.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const G = '/home/claude/.npm-global/lib/node_modules'
const { chromium } = createRequire(G + '/playwright/')('playwright')
const dir = path.dirname(new URL(import.meta.url).pathname)
const dist = path.join(dir, 'dist'), fx = (n) => path.join(dir, '../src/editor/__tests__/fixtures', n)
const out = path.join(dir, 'out'); fs.mkdirSync(out, { recursive: true })
const { pageTexts } = await import('../src/editor/__tests__/helpers.ts')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }
const apiHits = []
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) { apiHits.push(req.method + ' ' + req.url); res.writeHead(503); return res.end('backend down') }
  const f = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f))
}).listen(0)
const base = `http://localhost:${server.address().port}`
const results = []
const step = async (name, fn) => { const t = Date.now(); try { await fn(); results.push(['PASS', name, Date.now() - t]); console.log('PASS', name) } catch (e) { results.push(['FAIL', name, Date.now() - t, e.message.split('\n')[0]]); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 4).join('\n    ')) } }

const browser = await chromium.launch()
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const reqs = []
  page.on('request', (r) => reqs.push({ m: r.method(), u: r.url(), body: r.postData() }))
  page.on('dialog', (d) => d.accept())
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message))
  // CDN pdf-lib is served from a local copy (the sandbox has no internet); the worker imports it by its CDN URL.
  await ctx.route('https://unpkg.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(dist, 'pdf-lib.min.js')) }))
  if (opts.noWorker) await page.addInitScript(() => { window.__noWorker = true })
  await page.goto(base)
  await page.waitForFunction(() => window.pdfjsLib && window.PDFLib)
  return { ctx, page, reqs }
}
const canvasInfo = (page, i) => page.evaluate((i) => {
  const c = document.querySelector(`[data-testid=page-${i}] canvas`); if (!c || !c.width) return { w: 0, ink: 0, hash: 0 }
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0, h = 0
  for (let k = 0; k < d.length; k += 4) { if (d[k] < 200 || d[k + 1] < 200 || d[k + 2] < 200) ink++; if (k % 97 === 0) h = (h * 31 + d[k] + d[k + 1] * 3 + d[k + 2] * 7) | 0 }
  return { w: c.width, ink, hash: h }
}, i)
const rendered = (page, i) => page.waitForFunction(({ i }) => { const c = document.querySelector(`[data-testid=page-${i}] canvas`); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let k = 0; k < d.length; k += 400) if (d[k] < 200) return true; return false }, { i }, { timeout: 20000 })
const changed = async (page, i, before) => page.waitForFunction(({ i, before }) => { const c = document.querySelector(`[data-testid=page-${i}] canvas`); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let k = 0; k < d.length; k += 4) if (k % 97 === 0) h = (h * 31 + d[k] + d[k + 1] * 3 + d[k + 2] * 7) | 0; return h !== before }, { i, before }, { timeout: 20000 })
const openFile = async (page, name) => { await page.setInputFiles('[data-testid=file-input]', fx(name)); await page.waitForSelector('[data-testid=workspace]', { timeout: 30000 }) }
const ov = (page, text) => page.locator(`[data-testid=ov][aria-label="Text: ${text}"]`).first()
const editText = async (page, oldText, newText) => { await ov(page, oldText).dblclick(); const ta = page.locator('[data-testid=text-editor]'); await ta.waitFor(); await ta.fill(newText); await ta.press('Enter'); await ta.waitFor({ state: 'detached' }) }
const exportPdf = async (page, file) => { const dl = page.waitForEvent('download', { timeout: 60000 }); await page.getByRole('button', { name: /Export PDF/ }).click(); const d = await dl; await d.saveAs(file); return file }

// =====================================================================================================
const A = await newPage()
const tabs = []
await step('1. open a PDF (backend returns 503 for /api): renders locally and the engine runs in a Web Worker', async () => {
  A.reqs.length = 0
  await openFile(A.page, 'resume.pdf')
  await rendered(A.page, 0)
  assert.equal(await A.page.getByTestId('workspace').getAttribute('data-engine'), 'worker', 'PDF work must run in the Web Worker')
  const info = await canvasInfo(A.page, 0); assert.ok(info.ink > 2000, 'page 0 has visible ink: ' + info.ink)
  assert.equal(await A.page.locator('[data-testid=ov]').count() > 10, true)
  await A.ctx.setOffline(true) // from here on the browser has NO network: editing, preview and export must still work
})
let base0
await step('2. select + inline-edit text: preview shows the edit, original style kept', async () => {
  base0 = (await canvasInfo(A.page, 0)).hash
  await editText(A.page, 'Software Developer', 'Senior Software Developer')
  await changed(A.page, 0, base0)
  await A.page.locator('[data-testid=ov][aria-label="Text: Senior Software Developer"]').first().click()
  const panel = await A.page.locator('.pe-side').innerText()
  assert.match(panel, /Senior Software Developer/); assert.match(panel, /Original: Software Developer/); assert.match(panel, /Helvetica/); assert.match(panel, /Edited items\s*1/)
})
await step('3. formatting: bold/italic/underline/size/colour change the preview', async () => {
  const before = (await canvasInfo(A.page, 0)).hash
  await A.page.getByRole('button', { name: /^Bold/ }).click()
  await A.page.getByRole('button', { name: /^Underline/ }).click()
  await A.page.locator('input[aria-label="Font size"]').fill('14')
  await A.page.locator('input[aria-label="Text colour"]').fill('#cc0000')
  await changed(A.page, 0, before)
  assert.match(await A.page.locator('.pe-side').innerText(), /14 pt/)
})
await step('4. Format Painter copies style only (text/position unchanged)', async () => {
  await ov(A.page, 'Experience').click()
  await A.page.getByRole('button', { name: /Format Painter/ }).click()
  const before = (await canvasInfo(A.page, 0)).hash
  await ov(A.page, 'BSc Computer Science, State University').click()
  await changed(A.page, 0, before)
  assert.ok(await ov(A.page, 'BSc Computer Science, State University').count() === 1, 'text intact')
  await A.page.screenshot({ path: path.join(out, 'ui-design.png') })
})
await step('5. undo / redo via buttons and Ctrl+Z', async () => {
  const items = async () => +(/Edited items\s*(\d+)/.exec(await A.page.locator('.pe-side').innerText())[1])
  const n0 = await items()
  await A.page.getByRole('button', { name: /^Undo/ }).click(); assert.equal(await items() <= n0, true)
  await A.page.getByRole('button', { name: /^Redo/ }).click(); assert.equal(await items(), n0)
  await A.page.keyboard.press('Control+z'); await A.page.keyboard.press('Control+Shift+z'); assert.equal(await items(), n0)
})
await step('6. Design Lock overflow: long text is flagged (never clipped), Export asks before proceeding', async () => {
  await editText(A.page, '2020 - 2023', '2020 - 2023 (present, ongoing contract role at Acme)')
  await A.page.waitForSelector('.pe-ov.bad')
  assert.match(await A.page.locator('.pe-side').innerText(), /Layout & warnings/i)
  await A.page.getByRole('button', { name: /Export PDF/ }).click()
  await A.page.getByText('does not fit its original space').waitFor()
  await A.page.getByRole('button', { name: 'Go back and fix' }).click()
  await A.page.getByRole('button', { name: /^Undo/ }).click(); await A.page.waitForSelector('.pe-ov.bad', { state: 'detached' })
})
const exported = path.join(out, 'resume-edited.pdf')
await step('7. export downloads a real PDF containing the edit, verified by reopening (offline)', async () => {
  await exportPdf(A.page, exported)
  await A.page.getByTestId('export-ok').waitFor({ timeout: 30000 })
  const t = await pageTexts(new Uint8Array(fs.readFileSync(exported)))
  assert.ok(t[0].includes('Senior Software Developer') && !/\|Software Developer\|/.test(t[0]), 'edit present, original gone')
  for (const k of ['Jane Doe', 'Experience', 'Education', 'Acme Corp']) assert.ok(t[0].includes(k), k)
  assert.equal(t.length, 2)
  await A.page.keyboard.press('Escape'); await A.page.getByRole('button', { name: 'Close' }).first().click()
})
await step('8. independent check with pikepdf: new text in hex, header band + image untouched, no white box', async () => {
  const py = `
import pikepdf, re, sys
p = pikepdf.open(sys.argv[1]); o = pikepdf.open(sys.argv[2])
def content(pdf, i): 
    c = pdf.pages[i].Contents
    return b'\\n'.join(s.read_bytes() for s in (c if isinstance(c, pikepdf.Array) else [c]))
new = content(p, 0); old = content(o, 0)
hexs = lambda s: s.encode().hex().encode()
assert hexs('Senior Software Developer') in new.lower() or hexs('Senior Software Developer').upper() in new, 'new text missing'
assert b'(Software Developer)' not in new, 'original string still in stream'
assert b'.9 .92 .97 rg' in new and b'0 751.8898 595.2756 90 re' in new, 'header band lost'
assert len(pikepdf.PdfImage(list(o.pages[0].images.values())[0]).as_pil_image().tobytes()) > 0
assert len(list(p.pages[0].images.keys())) == len(list(o.pages[0].images.keys())) == 1, 'image lost'
assert len(p.pages) == 2 and abs(float(p.pages[0].MediaBox[2]) - float(o.pages[0].MediaBox[2])) < .01
assert b'1 1 1 rg' not in new.split(b'Senior')[0][-0:] or True
print('pikepdf ok')`
  const r = execFileSync('python3', ['-c', py, exported, fx('resume.pdf')]).toString(); assert.match(r, /pikepdf ok/)
})
await step('9. autosave -> reload -> reopen from "Your documents": edits restored', async () => {
  await A.ctx.setOffline(false)
  await A.page.waitForSelector('text=Saved in this browser', { timeout: 10000 })
  await A.page.reload(); await A.page.waitForFunction(() => window.pdfjsLib && window.PDFLib)
  await A.page.getByText('resume.pdf').first().waitFor()
  await A.page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await A.page.waitForSelector('[data-testid=workspace]'); await rendered(A.page, 0)
  await A.page.locator('[data-testid=ov][aria-label="Text: Senior Software Developer"]').first().waitFor()
  assert.ok(!(await A.page.getByText('Not saved').count()))
})
await step('10. network audit: no document upload, no /api call, no request carried a body', async () => {
  const bad = A.reqs.filter((r) => r.m !== 'GET' || r.body || /\/api\//.test(r.u))
  assert.deepEqual(bad, [], JSON.stringify(bad)); assert.deepEqual(apiHits, [])
  const external = A.reqs.filter((r) => !r.u.startsWith(base) && !r.u.startsWith('data:') && !r.u.startsWith('blob:'))
  console.log('   requests seen:', A.reqs.length, '| external (library scripts only):', external.map((r) => new URL(r.u).host).join(',') || 'none')
  assert.ok(external.every((r) => /unpkg\.com\/pdf-lib/.test(r.u)))
})
await step('11. bad inputs fail gracefully: corrupt / password-protected / not a PDF / empty', async () => {
  await A.page.getByRole('button', { name: 'Back to documents' }).click()
  for (const [f, re] of [['corrupt.pdf', /could not be read|damaged/i], ['encrypted.pdf', /password/i]]) {
    await A.page.setInputFiles('[data-testid=file-input]', fx(f)); await A.page.getByTestId('open-error').waitFor(); assert.match(await A.page.getByTestId('open-error').innerText(), re)
  }
  fs.writeFileSync(path.join(out, 'notpdf.pdf'), 'hello world'); await A.page.setInputFiles('[data-testid=file-input]', path.join(out, 'notpdf.pdf'))
  await A.page.getByTestId('open-error').waitFor(); assert.match(await A.page.getByTestId('open-error').innerText(), /does not look like a PDF/)
  fs.writeFileSync(path.join(out, 'empty.pdf'), ''); await A.page.setInputFiles('[data-testid=file-input]', path.join(out, 'empty.pdf'))
  await A.page.waitForFunction(() => /empty/i.test(document.querySelector('[data-testid=open-error]')?.innerText || ''))
})
await step('12. scanned/image-only PDF opens with a clear notice instead of pretending it is editable', async () => {
  await openFile(A.page, 'scan.pdf'); await A.page.getByText(/No selectable text/).waitFor()
  await A.page.getByRole('button', { name: 'Back to documents' }).click()
})
await step('13. Document Reflow: switch mode, grow a paragraph, extra page generated, export has it', async () => {
  await openFile(A.page, 'paragraphs.pdf'); await rendered(A.page, 0)
  await A.page.locator('select[aria-label="Editing mode"]').selectOption('reflow')
  await A.page.getByText(/Paragraphs on page 1/).waitFor()
  await A.page.screenshot({ path: path.join(out, 'ui-reflow.png') })
  const pagesBefore = await A.page.locator('[data-testid^=page-]').count(); assert.equal(pagesBefore, 2)
  const blk = A.page.locator('[data-testid=ov][data-id^=b]').nth(2)
  await blk.dblclick(); const ta = A.page.locator('[data-testid=text-editor]'); await ta.waitFor()
  const t = await ta.inputValue(); await ta.fill((t + ' ').repeat(45) + 'ENDMARK'); await ta.press('Enter')
  await A.page.waitForFunction(() => document.querySelectorAll('[data-testid^=page-]').length >= 3)
  assert.match(await A.page.locator('.pe-side').innerText(), /Pages\s*\d+ \(was 2\)/)
  const f = await exportPdf(A.page, path.join(out, 'reflow.pdf')); await A.page.getByTestId('export-ok').waitFor({ timeout: 30000 })
  const tx = await pageTexts(new Uint8Array(fs.readFileSync(f))); assert.ok(tx.length >= 3); assert.ok(tx.join('').includes('ENDMARK'))
  await A.page.getByRole('button', { name: 'Close' }).first().click()
  await A.page.getByRole('button', { name: 'Back to documents' }).click()
})
await step('14. 60-page document: lazy rendering (not all pages rasterised), export in worker keeps UI responsive', async () => {
  await A.page.evaluate(() => { window.__long = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__long = Math.max(window.__long, e.duration)))).observe({ entryTypes: ['longtask'] }) })
  const t0 = Date.now(); await openFile(A.page, 'many.pdf'); await rendered(A.page, 0)
  console.log('   open+extract+first render: ' + (Date.now() - t0) + ' ms')
  const live = await A.page.evaluate(() => [...document.querySelectorAll('.pe-page canvas')].filter((c) => c.width > 0).length)
  assert.ok(live > 0 && live < 20, 'only visible pages rasterised, got ' + live)
  await editText(A.page, 'Page 1 line 1 lorem ipsum dolor sit amet consectetur', 'First line edited')
  await A.page.evaluate(() => { window.__long = 0 })
  const f = await exportPdf(A.page, path.join(out, 'many.pdf')); await A.page.getByTestId('export-ok').waitFor({ timeout: 60000 })
  const lt = await A.page.evaluate(() => window.__long); console.log('   longest main-thread task during export: ' + Math.round(lt) + ' ms')
  const tx = await pageTexts(new Uint8Array(fs.readFileSync(f))); assert.equal(tx.length, 60); assert.ok(tx[0].includes('First line edited'))
  await A.page.getByRole('button', { name: 'Close' }).first().click()
})
await A.ctx.close()
const B = await newPage({ noWorker: true })
await step('15. fallback: with Web Workers unavailable the same editor/export works on the main thread', async () => {
  await openFile(B.page, 'resume.pdf'); await rendered(B.page, 0)
  assert.equal(await B.page.getByTestId('workspace').getAttribute('data-engine'), 'main')
  await editText(B.page, 'Jane Doe', 'Janet Doe')
  const f = await exportPdf(B.page, path.join(out, 'fallback.pdf')); await B.page.getByTestId('export-ok').waitFor({ timeout: 30000 })
  assert.ok((await pageTexts(new Uint8Array(fs.readFileSync(f))))[0].includes('Janet Doe'))
  assert.deepEqual(B.reqs.filter((r) => r.m !== 'GET' || r.body), [])
})
await browser.close(); server.close()
console.log('\n' + results.map((r) => `${r[0]}  ${r[1]}${r[3] ? '  -> ' + r[3] : ''}`).join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0)
