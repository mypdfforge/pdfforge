/**
 * BatchWorkspace.jsx — the Merge-style multi-file workspace, shared by Split / Extract / Delete / Duplicate / Crop.
 *
 *   useBatchFiles()  files + errors + progressive thumbnails (ONE file rendered at a time) + dropzones
 *   BatchLayout      dual independent scroll · big dropzone → compact "+ add" · colour-coded files
 *                    · sectioned VIRTUAL page grid (only on-screen rows are in the DOM) · sticky file header
 *   ThumbCard        page card (file-colour border, "Doc N · p.X" chip, selection ring, hover actions)
 *   BatchBar         floating action bar: summary · output buttons · progress/cancel · mobile "direct download" list
 *   useBatchRun      run a job → deliver (1 file = .pdf, many = .zip, phone + ≤3 files = per-file list)
 *   ZoomModal        full-res page preview
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, useReducer } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, FileText, ChevronDown, ChevronRight, ShieldCheck, AlertCircle, Loader2, CheckCircle, Download, Share2 } from 'lucide-react'
import TopBar from './TopBar'
import { loadDoc, dropDoc } from '../utils/mergeClient'
import { getThumbnailsProgressive, thumbsDone, evictFromCache, getFullResPage } from '../utils/thumbCache'
import { makeZip } from '../utils/zipClient'
import { downloadBlob } from '../utils/api'
import { isCoarse, shareBlob } from '../utils/batchClient'

export const DOC_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16']
export const formatBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`

const W = 140, H = 180, CARD_W = 160, ROW_H = 252, HEAD_H = 44, SECTION_GAP = 12
const WARN_BYTES = 300 * 1048576
let seq = 0

// ── files + thumbnails ───────────────────────────────────────────────────────
export function useBatchFiles() {
  const [files, setFiles] = useState([])
  const [errs, setErrs] = useState([])
  const thumbs = useRef({}).current            // fileId -> [{img,w,h}|null]  (mutated in place, repainted via tick)
  const [, tick] = useReducer(x => x + 1, 0)
  const raf = useRef(0), alive = useRef(true), queue = useRef(Promise.resolve()), filesRef = useRef([])
  filesRef.current = files
  const bump = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; tick() }) }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelAnimationFrame(raf.current) } }, [])

  const onDrop = useCallback(async accepted => {
    for (const file of accepted) {                     // sequential: keeps drop order stable
      const id = `b${++seq}`, color = DOC_COLORS[(seq - 1) % DOC_COLORS.length]
      try {
        const count = (await loadDoc(id, file)).getPageCount()   // throws on encrypted files
        dropDoc(id)                                               // don't keep parsed docs around while browsing
        if (!alive.current) return
        thumbs[id] = new Array(count).fill(null)
        const total = filesRef.current.reduce((n, x) => n + x.size, file.size)
        if (total > WARN_BYTES) setErrs(e => e.includes(BIG_MSG) ? e : [...e, BIG_MSG])
        setFiles(f => [...f, { id, file, name: file.name, size: file.size, count, color }])
        // thumbnails: ONE file at a time (each getThumbnailsProgressive keeps rendering in idle time → wait for it)
        queue.current = queue.current.then(async () => {
          if (!thumbs[id]) return                          // removed meanwhile
          try {
            await getThumbnailsProgressive(file, (t, i) => { const a = thumbs[id]; if (a) { a[i] = { img: t.img, w: t.width, h: t.height }; bump() } }, 5)
            await thumbsDone(file)
          } catch { setErrs(x => [...x, `${file.name}: preview failed (export still works)`]) }
        })
      } catch (e) {
        setErrs(x => [...x, `${file.name}: ${/encrypt/i.test(e.message) ? 'password-protected, unlock it first' : 'could not read this PDF'}`])
      }
    }
  }, [bump, thumbs])
  const accept = { 'application/pdf': ['.pdf'] }
  const dz = useDropzone({ onDrop, accept })
  const canvasDz = useDropzone({ onDrop, accept, noClick: true, noKeyboard: true })

  const removeFile = useCallback(id => {
    const f = filesRef.current.find(x => x.id === id)
    if (f) evictFromCache(f.file)
    delete thumbs[id]; dropDoc(id)
    setFiles(fs => fs.filter(x => x.id !== id))
  }, [thumbs])
  const clearAll = useCallback(() => { filesRef.current.forEach(f => { evictFromCache(f.file); dropDoc(f.id); delete thumbs[f.id] }); setFiles([]) }, [thumbs])
  return { files, errs, setErrs, thumbs, dz, canvasDz, removeFile, clearAll }
}
const BIG_MSG = '⚠ Over 300 MB loaded. Everything stays in this tab\'s memory — export in smaller batches if the tab gets slow.'

// ── run + deliver ────────────────────────────────────────────────────────────
/** job({onProgress, shouldCancel}) -> {outputs, skipped}. Delivery: 1 output = .pdf · many = .zip · phone & ≤3 = list. */
export function useBatchRun(onError) {
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState(null)
  const [skipped, setSkipped] = useState([])
  const stop = useRef(false)
  const run = useCallback(async (job, zipName) => {
    stop.current = false; setStatus('loading'); setProgress({ done: 0, total: 1 }); setResults(null); setSkipped([])
    try {
      const { outputs, skipped: sk } = await job({ onProgress: setProgress, shouldCancel: () => stop.current })
      setSkipped(sk || [])
      if (!outputs.length) { onError('Nothing to download — select some pages first.'); setStatus('idle'); return }
      if (outputs.length === 1) downloadBlob(outputs[0].blob, outputs[0].name)
      else if (isCoarse() && outputs.length <= 3) setResults({ outputs, zipName })
      else downloadBlob(await makeZip(outputs, setProgress), zipName)
      setStatus('done'); setTimeout(() => setStatus('idle'), 2500)
    } catch (e) {
      setStatus('idle')
      if (e.message !== 'cancelled') onError(`Export failed: ${e.message}`)
    } finally { setProgress(null) }
  }, [onError])
  const zipResults = useCallback(async () => { if (results) downloadBlob(await makeZip(results.outputs), results.zipName) }, [results])
  return { status, progress, results, skipped, run, cancel: () => { stop.current = true }, closeResults: () => setResults(null), zipResults }
}

// ── layout ───────────────────────────────────────────────────────────────────
function buildRows(files, cols) {
  const rows = []; let top = 0
  files.forEach((f, fi) => {
    rows.push({ kind: 'head', f, fi, top, h: HEAD_H }); top += HEAD_H
    for (let s = 0; s < f.count; s += cols) { rows.push({ kind: 'row', f, fi, start: s, top, h: ROW_H }); top += ROW_H }
    top += SECTION_GAP
  })
  return { rows, total: top }
}

function FileHead({ f, n, extra, sticky }) {
  return (
    <div className="bw-head" style={{ borderBottomColor: f.color, ...(sticky ? { boxShadow: '0 4px 14px rgba(0,0,0,.25)' } : null) }}>
      <FileText size={14} color={f.color} style={{ flexShrink: 0 }} />
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>Doc {n}</strong>
      <span title={f.name} className="bw-ellip" style={{ fontSize: 12, color: 'var(--text2)', minWidth: 0 }}>{f.name}</span>
      <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{f.count} pg</span>
      <span style={{ flex: 1 }} />
      {extra}
    </div>
  )
}

export default function BatchLayout({ title, subtitle, topProps, batch, sideTop, summary, renderSideBody, renderCard, headerExtra, footer, emptyHint }) {
  const { files, errs, setErrs, thumbs, dz, canvasDz, removeFile } = batch
  const scroller = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    const el = scroller.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const scrollRaf = useRef(0)
  const onScroll = e => { const t = e.currentTarget.scrollTop; if (scrollRaf.current) return; scrollRaf.current = requestAnimationFrame(() => { scrollRaf.current = 0; setScrollTop(t) }) }
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])
  useEffect(() => { if (files.length && !files.some(f => f.id === openId)) setOpenId(files[0].id); if (!files.length) setOpenId(null) }, [files, openId])

  const cols = Math.max(1, Math.floor(size.w / CARD_W))
  const { rows, total } = useMemo(() => buildRows(files, cols), [files, cols])
  const over = ROW_H * 2
  const visible = rows.filter(r => r.top + r.h > scrollTop - over && r.top < scrollTop + size.h + over)
  let active = null
  for (const r of rows) { if (r.kind === 'head' && r.top <= scrollTop + 2) active = r; else if (r.top > scrollTop) break }
  const scrollToFile = id => { const r = rows.find(x => x.kind === 'head' && x.f.id === id); if (r) scroller.current?.scrollTo({ top: r.top, behavior: 'smooth' }) }

  return (
    <div className="bw-root">
      <style>{CSS}</style>
      <TopBar {...topProps} title={title} subtitle={subtitle} />
      <div className="bw-wrap">
        <aside className="bw-side">
          <div className="bw-top">
            <div className="badge badge-browser" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>
              <ShieldCheck size={13} /> Runs 100% in your browser • Zero data uploaded
            </div>
            {files.length === 0 ? (
              <div {...dz.getRootProps()} className={`bw-drop${dz.isDragActive ? ' on' : ''}`}>
                <input {...dz.getInputProps()} />
                <Upload size={18} color="var(--brand)" style={{ display: 'block', margin: '0 auto 6px' }} />
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Drop PDFs or <span style={{ color: 'var(--brand)' }}>browse</span></p>
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Add as many as you like</p>
              </div>
            ) : (
              <div {...dz.getRootProps()} className={`bw-drop mini${dz.isDragActive ? ' on' : ''}`}>
                <input {...dz.getInputProps()} />
                <Upload size={14} color="var(--brand)" /> <span>+ Add more PDFs</span>
              </div>
            )}
            {errs.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--red)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>{errs.map((m, i) => <div key={i}>{m}</div>)}</div>
                <button aria-label="Dismiss" onClick={() => setErrs([])} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer' }}><X size={12} /></button>
              </div>
            )}
            {files.length > 0 && sideTop}
          </div>

          <div className="bw-list">
            {files.map((f, i) => {
              const open = openId === f.id, isActive = active?.f.id === f.id
              return (
                <div key={f.id} className="bw-file" style={{ borderLeftColor: f.color, borderColor: isActive ? f.color : undefined }}>
                  <div className="bw-file-head" role="button" tabIndex={0}
                    onClick={() => { setOpenId(open ? null : f.id); scrollToFile(f.id) }}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(open ? null : f.id), scrollToFile(f.id))}>
                    {open ? <ChevronDown size={14} color="var(--text3)" /> : <ChevronRight size={14} color="var(--text3)" />}
                    <FileText size={14} color={f.color} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div title={f.name} className="bw-ellip" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Doc {i + 1}: {f.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{f.count} pg • {formatBytes(f.size)}{summary ? ` • ${summary(f)}` : ''}</div>
                    </div>
                    <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={e => { e.stopPropagation(); removeFile(f.id) }} style={{ width: 24, height: 24 }}><X size={13} /></button>
                  </div>
                  {open && renderSideBody && <div className="bw-file-body">{renderSideBody(f, i + 1)}</div>}
                </div>
              )
            })}
          </div>
        </aside>

        <div {...canvasDz.getRootProps({ className: 'bw-canvaswrap' })} style={{ outline: canvasDz.isDragActive ? '2px dashed var(--brand)' : 'none', outlineOffset: -6 }}>
          <input {...canvasDz.getInputProps()} />
          <div ref={scroller} className="bw-canvas" onScroll={onScroll}>
            {!files.length ? (
              <div style={{ height: '100%', minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 14, textAlign: 'center' }}>{emptyHint}</div>
            ) : (
              <div style={{ height: total, position: 'relative' }}>
                {visible.map(r => r.kind === 'head' ? (
                  <div key={`h${r.f.id}`} style={{ position: 'absolute', top: r.top, left: 0, right: 0, height: r.h }}>
                    <FileHead f={r.f} n={r.fi + 1} extra={headerExtra?.(r.f)} />
                  </div>
                ) : (
                  <div key={`r${r.f.id}:${r.start}`} style={{ position: 'absolute', top: r.top, left: 0, right: 0, height: r.h, display: 'flex' }}>
                    {Array.from({ length: Math.min(cols, r.f.count - r.start) }, (_, k) => r.start + k).map(i => (
                      <React.Fragment key={`${r.f.id}:${i}`}>
                        {renderCard({ f: r.f, n: r.fi + 1, i, thumb: thumbs[r.f.id]?.[i], color: r.f.color })}
                      </React.Fragment>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* sticky header: shows which file you are in once its inline header scrolled away */}
          {active && scrollTop > active.top + 6 && (
            <div className="bw-sticky"><FileHead f={active.f} n={active.fi + 1} extra={headerExtra?.(active.f)} sticky /></div>
          )}
        </div>
      </div>
      {footer}
    </div>
  )
}

// ── page card ────────────────────────────────────────────────────────────────
export function ThumbCard({ thumb, color, docN, page, label, ring, dim, overlay, actions, rotation = 0, onClick, ariaLabel, pressed }) {
  const sideways = rotation % 180 !== 0
  return (
    <div className="bw-card" role="button" tabIndex={0} aria-label={ariaLabel} aria-pressed={pressed}
      onClick={onClick} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick?.(e))}
      style={{ width: CARD_W, height: ROW_H, opacity: dim ? 0.5 : 1 }}>
      <div className="bw-thumb" style={{ width: W, height: H, borderColor: color, boxShadow: ring ? `0 0 0 3px ${ring}` : '0 2px 8px rgba(0,0,0,.25)' }}>
        {thumb?.img
          ? <img src={thumb.img} alt={`Page ${page}`} draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `rotate(${rotation}deg)${sideways ? ' scale(.78)' : ''}`, transition: 'transform .2s' }} />
          : <div className="bw-skel" />}
        {overlay}
        {actions && <div className="bw-act">{actions}</div>}
      </div>
      <div style={{ textAlign: 'center', marginTop: 7 }}>
        <span className="bw-chip" style={{ background: color }}>Doc {docN} · p.{page}</span>
        {label && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3, fontWeight: 600 }}>{label}</div>}
      </div>
    </div>
  )
}
export function CardBtn({ title, onClick, children, bg = 'rgba(20,20,30,.88)' }) {
  return <button title={title} aria-label={title} onClick={e => { e.stopPropagation(); onClick(e) }}
    style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: bg, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</button>
}

// ── floating action bar ──────────────────────────────────────────────────────
export function BatchBar({ summary, note, buttons, run }) {
  const { status, progress, results, skipped, cancel, closeResults, zipResults } = run
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0
  return (
    <div className="bw-bar">
      {results && (
        <div className="bw-results">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 13, color: 'var(--text)' }}>Your files are ready</strong>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={zipResults} style={{ height: 30 }}>Get all as .zip</button>
            <button className="icon-btn" aria-label="Close" onClick={closeResults}><X size={14} /></button>
          </div>
          {results.outputs.map(o => (
            <div key={o.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <CheckCircle size={14} color="var(--green)" />
              <span className="bw-ellip" style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{o.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{formatBytes(o.blob.size)}</span>
              <button className="btn btn-primary" style={{ height: 30 }} onClick={() => downloadBlob(o.blob, o.name)}><Download size={13} /> Save</button>
              {typeof navigator !== 'undefined' && navigator.canShare && <button className="btn btn-ghost" style={{ height: 30 }} onClick={() => shareBlob(o.name, o.blob)}><Share2 size={13} /> Share</button>}
            </div>
          ))}
        </div>
      )}
      <div className="bw-bar-row">
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{summary}</div>
          {skipped.length > 0 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Skipped: {skipped.map(s => `${s.name} (${s.reason})`).join(', ')}</div>}
          {note && !skipped.length && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{note}</div>}
        </div>
        {status === 'loading' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 260px' }}>
            <Loader2 size={15} className="spin" color="var(--brand)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bw-ellip" style={{ fontSize: 12, color: 'var(--text2)' }}>{progress?.label || 'Working…'} {pct}%</div>
              <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, marginTop: 4 }}><div style={{ height: 4, width: `${pct}%`, background: 'var(--brand)', borderRadius: 2, transition: 'width .2s' }} /></div>
            </div>
            <button className="btn btn-ghost" onClick={cancel} style={{ height: 34 }}>Cancel</button>
          </div>
        ) : (
          <div className="bw-bar-btns">
            {status === 'done' && <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--green)', fontSize: 13, fontWeight: 600 }}><CheckCircle size={14} /> Downloaded!</span>}
            {buttons.map(b => (
              <button key={b.label} className={`btn ${b.primary ? 'btn-primary' : 'btn-ghost'}`} disabled={b.disabled} onClick={b.onClick}>{b.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── zoom ─────────────────────────────────────────────────────────────────────
export function ZoomModal({ file, pageNum, rotation = 0, onClose }) {
  const [img, setImg] = useState(null)
  useEffect(() => {
    let off = false
    getFullResPage(file, pageNum, 1.6).then(t => !off && setImg(t.img)).catch(() => {})
    const k = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => { off = true; window.removeEventListener('keydown', k) }
  }, [file, pageNum, onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <button className="icon-btn" aria-label="Close" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16 }}><X size={18} /></button>
      {img ? <img src={img} alt={`Page ${pageNum}`} onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', background: '#fff', borderRadius: 3, transform: `rotate(${rotation}deg)` }} />
           : <Loader2 size={32} className="spin" color="#fff" />}
    </div>
  )
}

const CSS = `
.bw-root{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;background:var(--bg)}
.bw-wrap{flex:1;min-height:0;display:flex}
.bw-side{width:340px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg);overflow-y:auto;display:flex;flex-direction:column}
.bw-top{display:flex;flex-direction:column;gap:10px;padding:12px;flex-shrink:0}
.bw-list{display:flex;flex-direction:column;gap:8px;padding:0 12px 16px}
.bw-drop{border:1px dashed var(--border2);background:var(--bg2);border-radius:10px;padding:16px 12px;text-align:center;cursor:pointer}
.bw-drop.on{border-color:var(--brand)}
.bw-drop.mini{padding:9px 12px;display:flex;gap:8px;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:var(--brand)}
.bw-file{background:var(--bg2);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:8px;flex-shrink:0}
.bw-file-head{display:flex;align-items:center;gap:6px;padding:7px 8px;cursor:pointer}
.bw-file-body{padding:4px 10px 10px;display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border)}
.bw-ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bw-canvaswrap{flex:1;min-width:0;min-height:0;position:relative;display:flex}
.bw-canvas{flex:1;min-width:0;overflow-y:auto;padding:12px 16px 24px}
.bw-head{display:flex;align-items:center;gap:8px;height:${HEAD_H - 6}px;margin-top:0;padding:0 4px;border-bottom:2px solid var(--border);background:var(--bg)}
.bw-sticky{position:absolute;top:0;left:0;right:16px;padding:0 16px;z-index:5;background:var(--bg)}
.bw-card{position:relative;padding:0 10px;cursor:pointer;outline:none;flex-shrink:0;transition:opacity .15s}
.bw-card:focus-visible .bw-thumb{outline:2px solid var(--brand);outline-offset:3px}
.bw-thumb{position:relative;border:3px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg3);display:flex;align-items:center;justify-content:center;transition:transform .12s}
.bw-card:hover .bw-thumb{transform:translateY(-2px)}
.bw-act{position:absolute;top:6px;right:6px;display:flex;flex-direction:column;gap:5px;opacity:0;transition:opacity .12s;z-index:3}
.bw-card:hover .bw-act,.bw-card:focus-within .bw-act{opacity:1}
@media (pointer:coarse){.bw-act{opacity:1}}
.bw-chip{display:inline-block;font-size:10px;font-weight:700;color:#fff;border-radius:4px;padding:2px 6px}
.bw-skel{width:85%;height:90%;border-radius:4px;background:linear-gradient(90deg,var(--bg2) 25%,var(--bg3) 50%,var(--bg2) 75%);background-size:200% 100%;animation:bwShimmer 1.4s infinite}
@keyframes bwShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.bw-bar{flex-shrink:0;border-top:1px solid var(--border);background:var(--bg2);padding:10px 16px;box-shadow:0 -6px 20px rgba(0,0,0,.18);z-index:20}
.bw-bar-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between}
.bw-bar-btns{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bw-bar-btns .btn{height:40px}
.bw-results{margin-bottom:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}
.bw-chipbtn{height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--border);background:var(--bg);color:var(--text2);font-size:11px;font-weight:600;cursor:pointer}
.bw-chipbtn:hover{border-color:var(--brand);color:var(--text)}
@media (max-width:820px){
  .bw-root{height:auto;min-height:100vh;overflow:visible}
  .bw-wrap{flex-direction:column}
  .bw-side{width:auto;max-height:48vh;border-right:none;border-bottom:1px solid var(--border)}
  .bw-canvaswrap{height:62vh;flex:none}
  .bw-bar{position:sticky;bottom:0;padding:8px 12px max(8px,env(safe-area-inset-bottom))}
  .bw-bar-row{flex-direction:column;align-items:stretch;gap:8px}
  .bw-bar-btns{width:100%;display:flex;gap:6px;flex-wrap:nowrap}
  .bw-bar-btns .btn{
    flex:1 1 0;
    min-width:0;
    height:auto;
    min-height:42px;
    padding:4px 6px;
    font-size:11px;
    font-weight:600;
    text-align:center;
    display:flex;
    align-items:center;
    justify-content:center;
    white-space:normal;
    line-height:1.2;
  }
}
`
export { CSS as BATCH_CSS }
