/**
 * batchClient.js — multi-file engines for Split / Extract / Delete / Duplicate / Crop. 100% in browser.
 * Reuses mergeClient.mergePages (pdf-lib) for every page-level job, so forms, rotation and copies behave exactly like Merge.
 *
 * File shape (same as Merge): { id, file, name, size, count }
 * Per-file selection `st`: { sel:Set<1-based page>, groups:number[][] }   (groups only matter for Split)
 * Output shape: { name, blob }
 */
import { mergePages, dropDoc } from './mergeClient'
import { clientCropVisual } from './editClient'
import { rangeName } from './pageSpec'
import { uniqueName } from './zipClient'

export const SUFFIX = { delete: 'cleaned', duplicate: 'updated', extract: 'extracted', split: 'split', crop: 'cropped' }

/** "Client Invoice.pdf" -> "Client Invoice". Strips only characters no OS allows in file names. */
export const baseName = (n) => (n || 'document').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'document'
const pad = (n, count) => String(n).padStart(Math.max(2, String(count).length), '0')
const tick = () => new Promise(r => setTimeout(r, 0))
const cancelled = () => new Error('cancelled')

/** merged-file name: one file -> "A_cleaned.pdf"; many -> "A_+3_cleaned_merged.pdf" */
export function mergedName(tool, files) {
  const b = baseName(files[0]?.name), s = SUFFIX[tool]
  return files.length > 1 ? `${b}_+${files.length - 1}_${s}_merged.pdf` : `${b}_${s}.pdf`
}
export const zipNameFor = (tool, n) => `PDFForge_${tool}_${n}file${n === 1 ? '' : 's'}.zip`

/** Is this a phone-like device? (used for the "direct download list" fallback) */
export const isCoarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// ── planning (pure) ──────────────────────────────────────────────────────────
/**
 * What does file `f` turn into?  Returns { jobs:[{ suffix?, pages:[pageObj] }], passthrough:boolean }
 * mode 'pages' (Extract only) = one 1-page job per selected page.
 * opts: { copies, place:'after'|'end', splitMode:'ranges'|'every', every, rest, rot:{ 'fileId:idx': deg } }
 */
export function planFile(tool, f, st, opts = {}, mode = 'files') {
  const sel = st?.sel ?? new Set()
  const rot = (i) => opts.rot?.[`${f.id}:${i}`] || 0
  const mk = (i, k = 0) => ({ id: k ? `${f.id}:${i}~${k}` : `${f.id}:${i}`, fileId: f.id, origIdx: i, rotation: rot(i), deleted: false })
  const all = Array.from({ length: f.count }, (_, i) => i)
  const picked = all.filter(i => sel.has(i + 1))
  const anyRot = all.some(i => rot(i))

  if (tool === 'delete') {
    const keep = all.filter(i => !sel.has(i + 1))
    return { jobs: keep.length ? [{ pages: keep.map(i => mk(i)) }] : [], passthrough: !picked.length && !anyRot }
  }
  if (tool === 'duplicate') {
    const copies = Math.max(1, opts.copies || 1), pages = []
    for (const i of all) {
      pages.push(mk(i))
      if (opts.place !== 'end' && sel.has(i + 1)) for (let k = 1; k <= copies; k++) pages.push(mk(i, k))
    }
    if (opts.place === 'end') for (const i of picked) for (let k = 1; k <= copies; k++) pages.push(mk(i, k))
    return { jobs: [{ pages }], passthrough: !picked.length && !anyRot }
  }
  if (tool === 'extract') {
    if (!picked.length) return { jobs: [], passthrough: false }
    if (mode === 'pages') return { jobs: picked.map(i => ({ suffix: `p${pad(i + 1, f.count)}`, pages: [mk(i)] })), passthrough: false }
    return { jobs: [{ pages: picked.map(i => mk(i)) }], passthrough: false }
  }
  if (tool === 'split') {
    let parts = []
    if (opts.splitMode === 'every') {
      const n = Math.max(1, opts.every || 1)
      for (let i = 0; i < f.count; i += n) parts.push(all.slice(i, i + n).map(x => x + 1))
    } else {
      parts = (st?.groups ?? []).filter(g => g.length)
      if (opts.rest) {
        const used = new Set(parts.flat()), left = all.map(i => i + 1).filter(n => !used.has(n))
        if (left.length && parts.length) parts = [...parts, left]
      }
    }
    return {
      jobs: parts.map((g, k) => ({ suffix: `part${k + 1}_p${rangeName(g)}`, pages: g.map(n => mk(n - 1)) })),
      passthrough: false,
    }
  }
  return { jobs: [], passthrough: false }
}

/** Cheap counts for the UI (no page objects). Returns { files, outputs, pages } for a mode. */
export function countOutputs(tool, files, states, opts = {}, mode = 'files') {
  let outFiles = 0, outputs = 0, pages = 0
  for (const f of files) {
    const st = states[f.id], k = st?.sel?.size ?? 0
    let n = 0, jobs = 0
    if (tool === 'delete')         { n = f.count - k; jobs = n > 0 ? 1 : 0 }
    else if (tool === 'duplicate') { n = f.count + k * Math.max(1, opts.copies || 1); jobs = 1 }
    else if (tool === 'extract')   { n = k; jobs = mode === 'pages' ? k : (k ? 1 : 0) }
    else if (tool === 'split') {
      if (opts.splitMode === 'every') { n = f.count; jobs = Math.ceil(f.count / Math.max(1, opts.every || 1)) }
      else {
        const g = (st?.groups ?? []).filter(x => x.length)
        n = g.reduce((s, x) => s + x.length, 0); jobs = g.length
        if (opts.rest && g.length) { const left = f.count - new Set(g.flat()).size; if (left > 0) { jobs++; n += left } }
      }
    }
    if (jobs) { outFiles++; outputs += jobs; pages += n }
  }
  if (mode === 'merged') outputs = pages ? 1 : 0
  return { files: outFiles, outputs, pages }
}

// ── execution ────────────────────────────────────────────────────────────────
/**
 * Run a batch. mode: 'files' (one PDF per source file; Split = parts) | 'merged' (1 PDF) | 'pages' (Extract: 1 PDF per page).
 * Files are processed ONE AT A TIME and their parsed docs are dropped right after, so memory stays ≈ one file.
 * Returns { outputs:[{name,blob}], skipped:[{name,reason}] }.  Throws Error('cancelled') if shouldCancel() flips.
 */
export async function runBatch({ tool, mode = 'files', files, states, opts = {}, onProgress, shouldCancel }) {
  const outputs = [], skipped = [], used = new Set()
  const check = () => { if (shouldCancel?.()) throw cancelled() }
  const keepForms = opts.keepForms !== false

  if (mode === 'merged') {
    const contrib = [], pages = []
    for (const f of files) {
      const plan = planFile(tool, f, states[f.id], opts, 'files')
      const ps = plan.jobs.flatMap(j => j.pages)
      if (!ps.length) { skipped.push({ name: f.name, reason: 'nothing left' }); continue }
      contrib.push(f); pages.push(...ps)
    }
    if (!pages.length) return { outputs, skipped }
    check()
    try {
      const blob = await mergePages(contrib, pages, p => onProgress?.({ done: p.done, total: p.total, label: 'Merging…' }), { keepForms })
      outputs.push({ name: mergedName(tool, contrib), blob })
    } finally { files.forEach(f => dropDoc(f.id)) }
    return { outputs, skipped }
  }

  const multi = files.length > 1, folders = new Map()
  for (let n = 0; n < files.length; n++) {
    check()
    const f = files[n], b = baseName(f.name)
    onProgress?.({ done: n, total: files.length, label: f.name })
    const plan = planFile(tool, f, states[f.id], opts, mode)
    const dup = (folders.get(b) || 0) + 1; folders.set(b, dup)
    const folder = dup > 1 ? `${b} (${dup})` : b                       // two files with the same name get separate folders
    if (!plan.jobs.length) { skipped.push({ name: f.name, reason: tool === 'delete' ? 'every page deleted' : 'nothing selected' }); continue }
    try {
      for (const job of plan.jobs) {
        check()
        const blob = plan.passthrough ? f.file : await mergePages([f], job.pages, null, { keepForms })
        const file = job.suffix ? `${b}_${job.suffix}.pdf` : `${b}_${SUFFIX[tool]}.pdf`
        const path = multi && (tool === 'split' || mode === 'pages') ? `${folder}/${file}` : file   // one folder per source file for multi-part outputs
        
        outputs.push({ name: uniqueName(path, used), blob })
        await tick()
      }
    } finally { dropDoc(f.id) }
  }
  onProgress?.({ done: files.length, total: files.length })
  return { outputs, skipped }
}

/**
 * Crop batch. `crops[fileId]` = { [pageNum]: { left, top, right, bottom } } as FRACTIONS of the visual page
 * (what clientCropVisual already expects), so mixed Letter / A4 / landscape pages are all trimmed proportionally.
 * mode 'files' -> one cropped PDF per file; 'merged' -> cropped PDFs combined (each page keeps its own size).
 */
export async function runCropBatch({ files, crops, mode = 'files', onProgress, shouldCancel, keepForms = true }) {
  const outputs = [], skipped = [], used = new Set(), cropped = []
  const check = () => { if (shouldCancel?.()) throw cancelled() }
  
  for (let n = 0; n < files.length; n++) {
    check()
    const f = files[n]
    onProgress?.({ done: n, total: files.length + (mode === 'merged' ? 1 : 0), label: f.name })
    const pc = crops[f.id] || {}
    const any = Object.values(pc).some(c => c.left > 0 || c.top > 0 || c.right > 0 || c.bottom > 0)
    let blob = f.file                                   // no crop on this file -> pass the original through untouched
    if (any) {
      const res = await clientCropVisual(f.file, pc, null)
      blob = res?.data ?? res
      if (!(blob instanceof Blob)) blob = new Blob([blob], { type: 'application/pdf' })
    }
    cropped.push({ f, blob })
    if (mode !== 'merged') outputs.push({ name: uniqueName(`${baseName(f.name)}_${SUFFIX.crop}.pdf`, used), blob })
    await tick()
  }
  if (mode === 'merged') {
    check()
    const wrapped = cropped.map(({ f, blob }) => ({ ...f, id: `c${f.id}`, file: blob }))
    const pages = wrapped.flatMap(w => Array.from({ length: w.count }, (_, i) => ({ id: `${w.id}:${i}`, fileId: w.id, origIdx: i, rotation: 0, deleted: false })))
    try {
      const blob = await mergePages(wrapped, pages, p => onProgress?.({ done: files.length + p.done / p.total, total: files.length + 1, label: 'Merging…' }), { keepForms })
      outputs.push({ name: mergedName('crop', files), blob })
    } finally { wrapped.forEach(w => dropDoc(w.id)) }
  }
  onProgress?.({ done: 1, total: 1 })
  return { outputs, skipped }
}

/** Share one blob with the OS share sheet (iOS/Android "Save to Files"). Returns false if unsupported. */
export async function shareBlob(name, blob) {
  try {
    const file = new File([blob], name, { type: blob.type || 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true }
  } catch (e) { if (e?.name === 'AbortError') return true }
  return false
}
