/**
 * mergeClient.js — page-level merge engine (pdf-lib, 100% in browser) + pure ordering helpers.
 * Page shape: { id, fileId, origIdx, rotation, thumb, deleted, blank? } (blank: origIdx -1, fileId of its neighbour)
 * File shape: { id, file, name, size, count }
 */
function lib() {
  const l = window.PDFLib
  if (!l) throw new Error('pdf-lib not loaded in index.html')
  return l
}

// Parsed PDFDocuments, keyed by file id. Reused by the merge so nothing is parsed twice.
const docCache = new Map()

export async function loadDoc(id, file) {
  if (docCache.has(id)) return docCache.get(id)
  const doc = await lib().PDFDocument.load(await file.arrayBuffer()) // throws on encrypted files
  docCache.set(id, doc)
  return doc
}
export const dropDoc = (id) => docCache.delete(id)

/** Move page `dragId` before/after page `targetId`. Returns same array if nothing to do. */
export function movePage(pages, dragId, targetId, after) {
  if (dragId === targetId) return pages
  const item = pages.find(p => p.id === dragId)
  const rest = pages.filter(p => p.id !== dragId)
  const i = rest.findIndex(p => p.id === targetId)
  if (!item || i < 0) return pages
  rest.splice(i + (after ? 1 : 0), 0, item)
  return rest
}

/** Move ALL pages of one file as a block next to another file's pages (used by file up/down/drag). */
export function moveFilePages(pages, fileId, targetFileId, after) {
  const group = pages.filter(p => p.fileId === fileId)
  const rest  = pages.filter(p => p.fileId !== fileId)
  const hits  = rest.flatMap((p, i) => p.fileId === targetFileId ? [i] : [])
  if (!group.length || !hits.length) return pages
  rest.splice(after ? hits[hits.length - 1] + 1 : hits[0], 0, ...group)
  return rest
}

/** Reset: file order, then original page order. Keeps rotation/deleted flags. */
export function byFileOrder(pages, files) {
  const rank = new Map(files.map((f, i) => [f.id, i]))
  return [...pages].sort((a, b) => rank.get(a.fileId) - rank.get(b.fileId) || a.origIdx - b.origIdx)
}

/** Consecutive pages from the same file form one section (one divider). */
export function sectionsOf(pages) {
  const out = []
  for (const p of pages) {
    const last = out[out.length - 1]
    if (last && last.fileId === p.fileId) last.pages.push(p)
    else out.push({ fileId: p.fileId, pages: [p] })
  }
  return out
}

/** [0,1,2,4] -> "1–3, 5" */
export function rangeLabel(idxs) {
  const s = [...new Set(idxs)].sort((a, b) => a - b).map(i => i + 1)
  const parts = []
  let a = s[0], b = a
  const push = () => parts.push(a === b ? `${a}` : `${a}–${b}`)
  for (const n of s.slice(1)) { if (n === b + 1) { b = n; continue } push(); a = b = n }
  push()
  return parts.join(', ')
}

// Forms: copyPages drops the AcroForm but keeps each widget's /Parent chain, so the field tree
// is copied along. We re-register each top-level field in the output form under a unique name.
// shortcut: the output form gets pdf-lib's default /DA, /DR (fonts), so editing text later may use Helvetica; upgrade by copying source /DR
async function flattenedCopy(file) {
  const doc = await lib().PDFDocument.load(await file.arrayBuffer()) // fresh: don't flatten the cached doc
  try { doc.getForm().flatten() } catch { /* ignore */ }
  return doc
}

function adoptFields(out, page, used, seen, fileNo) {
  const { PDFName, PDFDict, PDFRef, PDFString } = lib()
  const annots = page.node.Annots()
  if (!annots) return
  const form = out.getForm()
  const PARENT = PDFName.of('Parent'), T = PDFName.of('T')
  for (let i = 0; i < annots.size(); i++) {
    let ref = annots.get(i)
    let d = annots.lookup(i, PDFDict)
    if (!(ref instanceof PDFRef) || !d || String(d.lookup(PDFName.of('Subtype'))) !== '/Widget') continue
    for (let up = d.get(PARENT); up instanceof PDFRef; up = d.get(PARENT)) { // climb to the root field
      ref = up; d = out.context.lookup(up, PDFDict)
    }
    const key = ref.toString()
    if (seen.has(key)) continue
    seen.add(key)
    const t = d.lookup(T)
    if (!t) continue
    const base = t.decodeText()
    let name = base, k = fileNo
    while (used.has(name)) name = `${base}_${k++}`   // same field name in 2 files must not share a value
    used.add(name)
    if (name !== base) d.set(T, PDFString.of(name))
    form.acroForm.addField(ref)
  }
}

/** Build the merged PDF in final page order. Returns a Blob. opts.keepForms (default true) keeps forms fillable, false flattens them. */
export async function mergePages(files, pages, onProgress, { keepForms = true } = {}) {
  const { PDFDocument, degrees } = lib()
  const out  = await PDFDocument.create()
  const live = pages.filter(p => !p.deleted)
  const copied = new Map()
  let done = 0
  for (const [fi, f] of files.entries()) {
    const mine = live.filter(p => p.fileId === f.id && !p.blank)
    if (mine.length) {
      const cached = await loadDoc(f.id, f.file)
      const src = keepForms ? cached : await flattenedCopy(f.file)
      // a page object can only be added once, so a duplicated page needs its own copyPages round
      const rounds = [], count = new Map()
      for (const p of mine) { const n = count.get(p.origIdx) ?? 0; count.set(p.origIdx, n + 1); (rounds[n] ??= []).push(p) }
      for (const r of rounds) {
        const cp = await out.copyPages(src, r.map(p => p.origIdx))
        r.forEach((p, i) => copied.set(p.id, { page:cp[i], keep:keepForms, fileNo:fi + 1 }))
      }
    }
    onProgress?.({ done: ++done, total: files.length + 1 })
    await new Promise(r => setTimeout(r, 0)) // let the spinner paint
  }
  const used = new Set(), seen = new Set()
  let size = [595.28, 841.89] // shortcut: blank page copies the previous page's size (A4 if first), upgrade with a size picker
  for (const p of live) {
    const c = copied.get(p.id)
    const page = c ? (out.addPage(c.page), c.page) : out.addPage(size)
    size = [page.getWidth(), page.getHeight()]
    if (p.rotation) page.setRotation(degrees((((page.getRotation().angle + p.rotation) % 360) + 360) % 360))
    if (c?.keep) try { adoptFields(out, page, used, seen, c.fileNo) } catch { /* field stays inert */ }
  }
  const bytes = await out.save()
  onProgress?.({ done: files.length + 1, total: files.length + 1 })
  return new Blob([bytes], { type: 'application/pdf' })
}
