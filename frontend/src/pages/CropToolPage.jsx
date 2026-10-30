/**
 * CropToolPage.jsx — multi-file Crop PDF on the shared BatchWorkspace.
 *
 * Crops are stored as FRACTIONS of the visual page {l,t,r,b}, never pixels. That is what makes
 * Letter + A4 + landscape files in one batch work: "trim 10% off the top" means the same thing on every page.
 * Precedence (most specific wins):  this PAGE  >  this FILE  >  ALL files.
 * Export uses the existing clientCropVisual(file, {pageNum:{left,top,right,bottom}}) → no new PDF maths.
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Scissors, X, ChevronLeft, ChevronRight, RotateCcw, Loader2 } from 'lucide-react'
import BatchLayout, { useBatchFiles, useBatchRun, BatchBar, ThumbCard } from '../components/BatchWorkspace'
import { runCropBatch, zipNameFor, isCoarse } from '../utils/batchClient'
import { getFullResPage } from '../utils/thumbCache'

const ZERO = Object.freeze({ l: 0, t: 0, r: 0, b: 0 })
const isCropped = m => !!m && (m.l > 0.002 || m.t > 0.002 || m.r > 0.002 || m.b > 0.002)
const near = (a, b) => Math.abs(a - b) < 8
function sizeLabel(t) {                      // thumbnails are rendered at scale 0.3 → points = px / 0.3
  if (!t) return null
  const w = t.w / 0.3, h = t.h / 0.3, s = Math.min(w, h), l = Math.max(w, h)
  const name = near(s, 595) && near(l, 842) ? 'A4' : near(s, 612) && near(l, 792) ? 'Letter' : near(s, 612) && near(l, 1008) ? 'Legal'
    : near(s, 420) && near(l, 595) ? 'A5' : near(s, 842) && near(l, 1191) ? 'A3' : `${Math.round(s / 72 * 25.4)}×${Math.round(l / 72 * 25.4)} mm`
  return `${name} · ${w > h ? 'Landscape' : 'Portrait'}`
}
const fracToBox = (f, W, H) => ({ x: f.l * W, y: f.t * H, w: W * (1 - f.l - f.r), h: H * (1 - f.t - f.b) })
const boxToFrac = (b, W, H) => ({ l: Math.max(0, b.x / W), t: Math.max(0, b.y / H), r: Math.max(0, (W - b.x - b.w) / W), b: Math.max(0, (H - b.y - b.h) / H) })
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' }

// ── interactive crop canvas (fractions in, fractions out) ────────────────────
function CropCanvas({ imgSrc, frac, onCommit }) {
  const cv = useRef(null), im = useRef(null), box = useRef(null), drag = useRef(null), raf = useRef(0), fr = useRef(frac)
  fr.current = frac
  const scale = () => { const c = cv.current, r = c.getBoundingClientRect(); return r.width ? c.width / r.width : 1 }
  const draw = useCallback(() => {
    const c = cv.current, i = im.current, b = box.current
    if (!c || !i || !b || !c.width) return
    const g = c.getContext('2d'), s = scale()
    g.clearRect(0, 0, c.width, c.height); g.drawImage(i, 0, 0, c.width, c.height)
    g.fillStyle = 'rgba(0,0,0,.55)'
    g.fillRect(0, 0, c.width, b.y); g.fillRect(0, b.y + b.h, c.width, c.height - b.y - b.h)
    g.fillRect(0, b.y, b.x, b.h); g.fillRect(b.x + b.w, b.y, c.width - b.x - b.w, b.h)
    g.strokeStyle = '#ea580c'; g.lineWidth = 2 * s; g.strokeRect(b.x, b.y, b.w, b.h)
    g.fillStyle = '#fff'
    for (const [, hx, hy] of handles(b)) { g.beginPath(); g.arc(hx, hy, 6 * s, 0, 7); g.fill(); g.stroke() }
  }, [])
  const sched = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(draw) }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const onLoad = () => { const c = cv.current, i = im.current; c.width = i.naturalWidth; c.height = i.naturalHeight; box.current = fracToBox(fr.current, c.width, c.height); draw() }
  useEffect(() => {                                     // frac changed from outside (Reset, Apply…)
    const c = cv.current
    if (!c || !c.width || drag.current) return
    box.current = fracToBox(frac, c.width, c.height); sched()
  }, [frac.l, frac.t, frac.r, frac.b])

  const handles = b => [['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y], ['e', b.x + b.w, b.y + b.h / 2],
    ['se', b.x + b.w, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['sw', b.x, b.y + b.h], ['w', b.x, b.y + b.h / 2]]
  const pos = e => { const c = cv.current, r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height } }
  const hit = p => {
    const b = box.current; if (!b) return null
    const t = 13 * scale()
    for (const [n, hx, hy] of handles(b)) if (Math.abs(p.x - hx) < t && Math.abs(p.y - hy) < t) return n
    return p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h ? 'move' : null
  }
  const down = e => {
    const p = pos(e), m = hit(p); if (!m) return
    cv.current.setPointerCapture(e.pointerId); drag.current = { m, p, o: { ...box.current } }
  }
  const move = e => {
    const c = cv.current, p = pos(e), d = drag.current
    if (!d) { c.style.cursor = CURSORS[hit(p)] || 'default'; return }
    const dx = p.x - d.p.x, dy = p.y - d.p.y, o = d.o, W = c.width, H = c.height, min = 30 * scale()
    let { x, y, w, h } = o
    if (d.m === 'move') { x = Math.min(Math.max(0, o.x + dx), W - o.w); y = Math.min(Math.max(0, o.y + dy), H - o.h) }
    else {
      if (d.m.includes('w')) { x = Math.min(Math.max(0, o.x + dx), o.x + o.w - min); w = o.x + o.w - x }
      if (d.m.includes('e')) w = Math.min(Math.max(min, o.w + dx), W - o.x)
      if (d.m.includes('n')) { y = Math.min(Math.max(0, o.y + dy), o.y + o.h - min); h = o.y + o.h - y }
      if (d.m.includes('s')) h = Math.min(Math.max(min, o.h + dy), H - o.y)
    }
    box.current = { x, y, w, h }; sched()
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    const c = cv.current; onCommit(boxToFrac(box.current, c.width, c.height))
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <img ref={im} src={imgSrc} onLoad={onLoad} alt="" style={{ display: 'none' }} />
      <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ maxWidth: '100%', maxHeight: '100%', touchAction: 'none', background: '#fff', borderRadius: 3 }} />
    </div>
  )
}

// ── modal ────────────────────────────────────────────────────────────────────
function CropModal({ files, thumbs, active, setActive, frac, onCommit, onApplyFile, onApplyAll, onReset, onClose }) {
  const fi = files.findIndex(f => f.id === active.fileId), f = files[fi]
  const [hi, setHi] = useState(null)
  useEffect(() => {
    let off = false; setHi(null)
    getFullResPage(f.file, active.idx + 1, 1.4).then(t => !off && setHi(t.img)).catch(() => {})
    return () => { off = true }
  }, [f.file, active.idx])
  const step = useCallback(d => {
    let nf = fi, ni = active.idx + d
    if (ni < 0) { nf = fi - 1; if (nf < 0) return; ni = files[nf].count - 1 }
    else if (ni >= f.count) { nf = fi + 1; if (nf >= files.length) return; ni = 0 }
    setActive({ fileId: files[nf].id, idx: ni })
  }, [fi, active.idx, f.count, files, setActive])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [step, onClose])
  const t = thumbs[f.id]?.[active.idx]
  const pct = v => `${Math.round(v * 100)}%`
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.88)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', flexWrap: 'wrap', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
        <button className="icon-btn" aria-label="Previous page" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, minWidth: 0 }} className="bw-ellip">
          <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: f.color, marginRight: 6 }} />
          Doc {fi + 1} · {f.name} · page {active.idx + 1}/{f.count}
        </div>
        <button className="icon-btn" aria-label="Next page" onClick={() => step(1)}><ChevronRight size={16} /></button>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>T {pct(frac.t)} · B {pct(frac.b)} · L {pct(frac.l)} · R {pct(frac.r)}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onReset} style={{ height: 32 }}><RotateCcw size={13} /> No crop on this page</button>
        <button className="btn btn-ghost" onClick={onApplyFile} style={{ height: 32 }}>Apply to this file</button>
        <button className="btn btn-primary" onClick={onApplyAll} style={{ height: 32 }}>Apply to all files</button>
        <button className="btn btn-ghost" onClick={onClose} style={{ height: 32 }}>Done</button>
      </div>
      <CropCanvas key={`${f.id}:${active.idx}`} imgSrc={hi || t?.img} frac={frac} onCommit={onCommit} />
      {!hi && <Loader2 size={16} className="spin" color="#fff" style={{ position: 'absolute', right: 20, bottom: 20 }} />}
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function CropToolPage(props) {
  const batch = useBatchFiles()
  const { files, thumbs, setErrs } = batch
  const run = useBatchRun(m => setErrs(e => [...e, m]))
  const [allBox, setAllBox] = useState(null)
  const [fileBoxes, setFileBoxes] = useState({})
  const [pageBoxes, setPageBoxes] = useState({})
  const [active, setActive] = useState(null)
  const coarse = isCoarse()

  const eff = (fid, i) => {
    const p = pageBoxes[`${fid}:${i}`]; if (p) return { box: p, src: 'page' }
    const f = fileBoxes[fid]; if (f) return { box: f, src: 'file' }
    return allBox ? { box: allBox, src: 'all' } : { box: ZERO, src: null }
  }
  const overrides = useMemo(() => { const m = {}; for (const k in pageBoxes) (m[k.split(':')[0]] ||= []).push(k); return m }, [pageBoxes])
  const croppedIn = f => {                       // how many pages of f end up cropped (cheap: no per-page loop)
    const base = isCropped(fileBoxes[f.id] || allBox) ? f.count : 0
    let n = base
    for (const k of overrides[f.id] || []) { const c = isCropped(pageBoxes[k]); if (base && !c) n--; else if (!base && c) n++ }
    return n
  }
  const totalPages = files.reduce((s, f) => s + croppedIn(f), 0)
  const filesWithCrop = files.filter(f => croppedIn(f) > 0).length
  const labels = new Set(files.map(f => sizeLabel(thumbs[f.id]?.[0])).filter(Boolean))   // cheap; thumbs arrive after first render

  const setPage = (fid, i, frac) => setPageBoxes(p => ({ ...p, [`${fid}:${i}`]: frac }))
  const applyFile = (fid, frac) => { setFileBoxes(b => ({ ...b, [fid]: frac })); setPageBoxes(p => Object.fromEntries(Object.entries(p).filter(([k]) => k.split(':')[0] !== fid))) }
  const applyAll = frac => { setAllBox(frac); setFileBoxes({}); setPageBoxes({}) }
  const clearAll = () => { setAllBox(null); setFileBoxes({}); setPageBoxes({}) }
  const clearFile = fid => { setFileBoxes(b => { const n = { ...b }; delete n[fid]; return n }); setPageBoxes(p => Object.fromEntries(Object.entries(p).filter(([k]) => k.split(':')[0] !== fid))) }
  const setMargin = (k, v) => setAllBox(b => ({ ...(b || ZERO), [k]: Math.min(45, Math.max(0, +v || 0)) / 100 }))

  const buildCrops = () => Object.fromEntries(files.map(f => {
    const o = {}
    for (let i = 0; i < f.count; i++) { const { box } = eff(f.id, i); o[i + 1] = { left: box.l, top: box.t, right: box.r, bottom: box.b } }
    return [f.id, o]
  }))
  const go = mode => run.run(({ onProgress, shouldCancel }) => runCropBatch({ files, crops: buildCrops(), mode, onProgress, shouldCancel }), zipNameFor('crop', files.length))
  const busy = run.status === 'loading'
  const n = files.length
  const buttons = [{
    label: n === 1 ? '📄 Download PDF (.pdf)' : coarse && n <= 3 ? `⬇ Download ${n} Files` : `📦 Download ${n} Cropped Files (.zip)`,
    primary: true, disabled: busy || !totalPages, onClick: () => go('files'),
  }]
  if (n > 1) buttons.push({ label: '📄 Merge & Download (.pdf)', disabled: busy || !totalPages, onClick: () => go('merged') })

  const m = allBox || ZERO
  const sideTop = (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg2)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <strong style={{ fontSize: 12, color: 'var(--text)' }}>Same margins for every file (%)</strong>
        <span style={{ flex: 1 }} />
        <button className="bw-chipbtn" onClick={clearAll}>Clear all</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
        {[['t', 'Top'], ['b', 'Bottom'], ['l', 'Left'], ['r', 'Right']].map(([k, l]) => (
          <label key={k} style={{ fontSize: 11, color: 'var(--text3)' }}>{l}
            <input type="number" min={0} max={45} value={Math.round(m[k] * 1000) / 10} onChange={e => setMargin(k, e.target.value)} style={{ width: '100%', height: 28, marginTop: 2 }} />
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
        Click any page to crop it by hand. Page crop beats file crop beats this global crop.
        {labels.size > 1 && <div style={{ color: 'var(--orange, #f59e0b)', marginTop: 4 }}>Mixed page sizes ({[...labels].join(', ')}). Crops are percentages, so every page is trimmed proportionally.</div>}
      </div>
    </div>
  )
  const renderSideBody = f => {
    const fb = fileBoxes[f.id], ov = (overrides[f.id] || []).length
    return (
      <>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {sizeLabel(thumbs[f.id]?.[0]) || 'Reading page size…'}<br />
          {ov ? `${ov} page${ov === 1 ? '' : 's'} with own crop · ` : ''}{fb ? 'file crop active' : allBox ? 'using global crop' : 'no crop yet'}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button className="bw-chipbtn" onClick={() => setActive({ fileId: f.id, idx: 0 })}><Scissors size={11} style={{ verticalAlign: -1 }} /> Crop this file…</button>
          {fb && <button className="bw-chipbtn" onClick={() => clearFile(f.id)}>Clear file crop</button>}
          {ov > 0 && <button className="bw-chipbtn" onClick={() => setPageBoxes(p => Object.fromEntries(Object.entries(p).filter(([k]) => k.split(':')[0] !== f.id)))}>Clear page crops</button>}
        </div>
      </>
    )
  }
  const renderCard = ({ f, n: docN, i, thumb, color }) => {
    const { box, src } = eff(f.id, i), on = isCropped(box)
    let overlay = null
    if (on && thumb?.w) {
      const sc = Math.min(134 / thumb.w, 174 / thumb.h), dw = thumb.w * sc, dh = thumb.h * sc
      const mask = { position: 'absolute', background: 'rgba(0,0,0,.5)' }
      overlay = (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ position: 'relative', width: dw, height: dh }}>
            <div style={{ ...mask, left: 0, right: 0, top: 0, height: `${box.t * 100}%` }} />
            <div style={{ ...mask, left: 0, right: 0, bottom: 0, height: `${box.b * 100}%` }} />
            <div style={{ ...mask, left: 0, width: `${box.l * 100}%`, top: `${box.t * 100}%`, bottom: `${box.b * 100}%` }} />
            <div style={{ ...mask, right: 0, width: `${box.r * 100}%`, top: `${box.t * 100}%`, bottom: `${box.b * 100}%` }} />
            <div style={{ position: 'absolute', left: `${box.l * 100}%`, right: `${box.r * 100}%`, top: `${box.t * 100}%`, bottom: `${box.b * 100}%`, border: '1.5px solid #ea580c' }} />
          </div>
        </div>
      )
    }
    return (
      <ThumbCard thumb={thumb} color={color} docN={docN} page={i + 1} overlay={overlay} ring={on ? '#ea580c' : null}
        label={on ? `✂ ${src === 'page' ? 'this page' : src === 'file' ? 'file crop' : 'all files'}` : 'click to crop'}
        ariaLabel={`Crop document ${docN}, page ${i + 1}`} onClick={() => setActive({ fileId: f.id, idx: i })} />
    )
  }
  const summary = f => { const c = croppedIn(f); return c ? `${c} cropped` : 'no crop' }
  const headerExtra = f => <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sizeLabel(thumbs[f.id]?.[0])}</span>

  const cur = active ? eff(active.fileId, active.idx).box : ZERO
  return (
    <>
      <BatchLayout title="Crop PDF" subtitle="Trim margins from one or many PDFs" topProps={props} batch={batch}
        sideTop={sideTop} summary={summary} renderSideBody={renderSideBody} renderCard={renderCard} headerExtra={headerExtra}
        emptyHint={<div><p style={{ fontWeight: 600, color: 'var(--text2)' }}>Crop PDF — batch mode</p><p style={{ marginTop: 4 }}>Drop PDFs, set one margin for all, or click a page to crop it by hand.</p></div>}
        footer={<BatchBar
          summary={!n ? 'Add PDFs to start' : totalPages ? `${totalPages} page${totalPages === 1 ? '' : 's'} cropped in ${filesWithCrop} of ${n} file${n === 1 ? '' : 's'}` : 'Nothing cropped yet'}
          note="Uncropped files are included unchanged · merged PDF keeps each page's own size" buttons={buttons} run={run} />} />
      {active && (
        <CropModal files={files} thumbs={thumbs} active={active} setActive={setActive} frac={cur}
          onCommit={fr => setPage(active.fileId, active.idx, fr)}
          onApplyFile={() => applyFile(active.fileId, cur)}
          onApplyAll={() => applyAll(cur)}
          onReset={() => setPage(active.fileId, active.idx, ZERO)}
          onClose={() => setActive(null)} />
      )}
    </>
  )
}
