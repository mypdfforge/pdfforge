/**
 * BatchToolPage.jsx — multi-file Split / Extract / Delete / Duplicate.
 * Built on BatchWorkspace (same dual-scroll, dropzone, colour-coding as Merge).
 *
 * State model (this is the two-way-sync fix):  ONE source of truth per file = the selected page Set (+ groups for Split).
 *   typing   → parseSpec() runs on every keystroke (no debounce) → Set → thumbnails highlight instantly
 *   clicking → Set changes → text is rewritten ("1,2,3" → "1-3")
 *   blur     → text is normalised. While you type, the text is never rewritten under your caret.
 */
import React, { useState, useReducer, useMemo, useRef, useEffect } from 'react'
import { RotateCw, ZoomIn, Check, X, Undo2, Copy, Scissors } from 'lucide-react'
import BatchLayout, { useBatchFiles, useBatchRun, BatchBar, ThumbCard, CardBtn, ZoomModal } from '../components/BatchWorkspace'
import { parseSpec, formatSpec, formatGroups, runsOf, toggleInGroups, presetSet, halves, partIndex } from '../utils/pageSpec'
import { runBatch, countOutputs, zipNameFor, isCoarse } from '../utils/batchClient'

const CFG = {
  split:     { title: 'Split PDF',      sub: 'Cut one or many PDFs into parts',      ring: 'var(--brand)', ph: 'e.g. 1-3, 5, 8-12', hint: 'Each comma = one new PDF', noun: 'Parts' },
  extract:   { title: 'Extract pages',  sub: 'Keep only the pages you pick',         ring: '#16a34a',      ph: 'e.g. 1-3, 5, 8',    hint: 'Selected pages are kept', noun: 'Extracted Files' },
  delete:    { title: 'Delete pages',   sub: 'Remove unwanted pages from many PDFs', ring: '#e5534b',      ph: 'e.g. 1, 4-6, last', hint: 'Selected pages are removed', noun: 'Cleaned Files' },
  duplicate: { title: 'Duplicate pages',sub: 'Insert copies of pages',               ring: '#16a34a',      ph: 'e.g. 1, 3-4',       hint: 'Selected pages get copies', noun: 'Updated Files' },
}
const CHIPS = [['first', 'First'], ['last', 'Last'], ['odd', 'Odd'], ['even', 'Even'], ['all', 'All'], ['invert', 'Invert'], ['none', 'Clear']]
const SPLIT_CHIPS = [['halves', 'Halves'], ['first', 'First'], ['last', 'Last'], ['odd', 'Odd'], ['even', 'Even'], ['none', 'Clear']]
const BLANK = Object.freeze({ sel: new Set(), groups: [], draft: '', issues: [], pending: false })

// ── selection reducer ────────────────────────────────────────────────────────
const fromGroups = (tool, groups) => {
  const set = new Set(groups.flat())
  return { sel: set, groups, draft: tool === 'split' ? formatGroups(groups) : formatSpec(set), issues: [], pending: false }
}
const fromSet = (tool, set) => fromGroups(tool, runsOf(set))
const clip = (groups, max) => groups.map(g => g.filter(n => n <= max)).filter(g => g.length)

function applyPreset(tool, s, name, max, k) {
  if (tool === 'split' && name === 'halves') return fromGroups(tool, halves(max))
  return fromSet(tool, presetSet(name, max, s.sel, k))
}
function reducer(state, a) {
  const s = state.sels[a.id] || BLANK
  const put = (id, v, undo = state.undo) => ({ sels: { ...state.sels, [id]: v }, undo })
  switch (a.type) {
    case 'type': {
      const r = parseSpec(a.text, a.max)
      return put(a.id, { sel: r.set, groups: r.groups, draft: a.text, issues: r.issues, pending: r.pending })
    }
    case 'blur':
      return put(a.id, { ...s, draft: a.tool === 'split' ? formatGroups(s.groups) : formatSpec(s.sel), issues: [], pending: false })
    case 'toggle': {
      if (a.tool === 'split') return put(a.id, fromGroups('split', toggleInGroups(s.groups, a.n)))
      const set = new Set(s.sel); set.has(a.n) ? set.delete(a.n) : set.add(a.n)
      return put(a.id, fromSet(a.tool, set))
    }
    case 'range': {
      if (a.tool === 'split') return put(a.id, fromGroups('split', [...s.groups, Array.from({ length: a.b - a.a + 1 }, (_, i) => a.a + i)].sort((x, y) => x[0] - y[0])))
      const set = new Set(s.sel); for (let n = a.a; n <= a.b; n++) set.add(n)
      return put(a.id, fromSet(a.tool, set))
    }
    case 'preset':
      return put(a.id, applyPreset(a.tool, s, a.name, a.max, a.k), state.sels)
    case 'applyAll': {
      const sels = { ...state.sels }
      for (const [id, max] of Object.entries(a.counts)) sels[id] = applyPreset(a.tool, sels[id] || BLANK, a.name, max, a.k)
      return { sels, undo: state.sels }
    }
    case 'copyFrom': {
      const from = state.sels[a.from] || BLANK
      return put(a.id, fromGroups(a.tool, clip(from.groups, a.max)), state.sels)
    }
    case 'undo':
      return state.undo ? { sels: state.undo, undo: null } : state
    default: return state
  }
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function BatchToolPage(props) {
  const { toolId: tool, ...topProps } = props
  const cfg = CFG[tool]
  const batch = useBatchFiles()
  const { files, setErrs } = batch
  const run = useBatchRun(m => setErrs(e => [...e, m]))
  const [st, dispatch] = useReducer(reducer, { sels: {}, undo: null })
  const [rots, setRots] = useState({})
  const [zoom, setZoom] = useState(null)
  const [nVal, setNVal] = useState(3)
  const [copies, setCopies] = useState(1)
  const [place, setPlace] = useState('after')
  const [splitMode, setSplitMode] = useState('ranges')
  const [every, setEvery] = useState(2)
  const [rest, setRest] = useState(false)
  const last = useRef({})
  const coarse = isCoarse()

  const S = useMemo(() => Object.fromEntries(files.map(f => [f.id, st.sels[f.id] || BLANK])), [files, st.sels])
  const opts = { copies, place, splitMode, every, rest, rot: rots }
  const counts = useMemo(() => Object.fromEntries(files.map(f => [f.id, f.count])), [files])
  const parts = useMemo(() => {
    if (tool !== 'split') return null
    return Object.fromEntries(files.map(f => {
      if (splitMode === 'every') { const a = new Int32Array(f.count + 2), n = Math.max(1, every); for (let p = 1; p <= f.count; p++) a[p] = Math.ceil(p / n); return [f.id, a] }
      return [f.id, partIndex(S[f.id].groups, f.count)]
    }))
  }, [tool, files, S, splitMode, every])

  // Ctrl/Cmd+Z undoes the last "apply to all" / preset
  useEffect(() => {
    const k = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); dispatch({ type: 'undo' }) } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  const onPage = (f, n, e) => {
    if (tool === 'split' && splitMode === 'every') return
    const prev = last.current[f.id]
    if (e?.shiftKey && prev) dispatch({ type: 'range', tool, id: f.id, a: Math.min(prev, n), b: Math.max(prev, n) })
    else dispatch({ type: 'toggle', tool, id: f.id, n })
    last.current[f.id] = n
  }
  const rotate = (f, i) => setRots(r => { const k = `${f.id}:${i}`; return { ...r, [k]: ((r[k] || 0) + 90) % 360 } })
  const applyAll = name => dispatch({ type: 'applyAll', tool, name, k: nVal, counts })

  // ── counts / labels ───
  const nFiles = files.length
  const cFiles = countOutputs(tool, files, S, opts, 'files')
  const cMerged = countOutputs(tool, files, S, opts, 'merged')
  const cPages = countOutputs(tool, files, S, opts, 'pages')
  const picked = files.reduce((s, f) => s + S[f.id].sel.size, 0)
  const summaryText = !nFiles ? 'Add PDFs to start' : {
    delete:    `${picked} page${picked === 1 ? '' : 's'} removed → ${cFiles.pages} left in ${cFiles.files} file${cFiles.files === 1 ? '' : 's'}`,
    extract:   `${picked} page${picked === 1 ? '' : 's'} kept from ${cFiles.files} of ${nFiles} file${nFiles === 1 ? '' : 's'}`,
    duplicate: `${picked * copies} cop${picked * copies === 1 ? 'y' : 'ies'} added → ${cFiles.pages} pages total`,
    split:     `${cFiles.outputs} part${cFiles.outputs === 1 ? '' : 's'} from ${cFiles.files} of ${nFiles} file${nFiles === 1 ? '' : 's'}`,
  }[tool]
  const zipLabel = (c, noun) => c.outputs === 1 ? '📄 Download PDF (.pdf)'
    : coarse && c.outputs <= 3 ? `⬇ Download ${c.outputs} Files` : `📦 Download ${c.outputs} ${noun} (.zip)`
  const go = mode => run.run(
    ({ onProgress, shouldCancel }) => runBatch({ tool, mode, files, states: S, opts, onProgress, shouldCancel }),
    zipNameFor(tool, (mode === 'pages' ? cPages : cFiles).outputs))
  const busy = run.status === 'loading'
  const buttons = [{ label: zipLabel(cFiles, cfg.noun), primary: true, disabled: busy || !cFiles.outputs, onClick: () => go('files') }]
  if (tool !== 'split' && nFiles > 1) buttons.push({ label: '📄 Merge & Download (.pdf)', disabled: busy || !cMerged.outputs, onClick: () => go('merged') })
  if (tool === 'extract') buttons.push({
    label: cPages.outputs === 1 ? '📄 Page as own PDF (.pdf)' : `📦 Each page as own PDF (${cPages.outputs} files .zip)`,
    disabled: busy || !cPages.outputs, onClick: () => go('pages') })
  const note = tool === 'duplicate' && picked ? 'Merge keeps file order · originals never change' : cfg.hint

  // ── pieces ───
  const chips = tool === 'split' ? SPLIT_CHIPS : CHIPS
  const sideTop = (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg2)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ fontSize: 12, color: 'var(--text)' }}>Apply to all files</strong>
        <span style={{ flex: 1 }} />
        {st.undo && <button className="bw-chipbtn" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={11} style={{ verticalAlign: -1 }} /> Undo</button>}
      </div>
      {!(tool === 'split' && splitMode === 'every') && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {chips.map(([k, l]) => <button key={k} className="bw-chipbtn" onClick={() => applyAll(k)}>{l}</button>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <button className="bw-chipbtn" onClick={() => applyAll('firstN')}>First</button>
            <input type="number" min={1} value={nVal} aria-label="N pages" onChange={e => setNVal(Math.max(1, +e.target.value || 1))} style={{ width: 54, height: 26, fontSize: 12 }} />
            <button className="bw-chipbtn" onClick={() => applyAll('lastN')}>Last N pages</button>
          </div>
        </>
      )}
      {tool === 'duplicate' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)' }}>
          Copies <select value={copies} onChange={e => setCopies(+e.target.value)} style={{ height: 28 }}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select>
          <select value={place} onChange={e => setPlace(e.target.value)} style={{ height: 28 }}><option value="after">after each page</option><option value="end">at end of file</option></select>
        </div>
      )}
      {tool === 'split' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
          <div className="seg" role="group" aria-label="Split mode">
            <button aria-pressed={splitMode === 'ranges'} onClick={() => setSplitMode('ranges')}>By ranges</button>
            <button aria-pressed={splitMode === 'every'} onClick={() => setSplitMode('every')}>Every N pages</button>
          </div>
          {splitMode === 'every'
            ? <label>Every <input type="number" min={1} value={every} onChange={e => setEvery(Math.max(1, +e.target.value || 1))} style={{ width: 56, height: 28 }} /> page(s) → new PDF</label>
            : <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={rest} onChange={e => setRest(e.target.checked)} /> Put leftover pages in a last part</label>}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{cfg.hint}. Shift-click selects a range. Ctrl+Z undoes.</div>
    </div>
  )

  const renderSideBody = (f, n) => {
    const s = S[f.id]
    if (tool === 'split' && splitMode === 'every') {
      const p = Math.ceil(f.count / Math.max(1, every))
      return <div style={{ fontSize: 12, color: 'var(--text2)' }}>{f.count} pages → {p} part{p === 1 ? '' : 's'} of up to {every} page{every === 1 ? '' : 's'}.</div>
    }
    const bad = s.issues.some(i => i.kind === 'range' || i.kind === 'junk')
    return (
      <>
        <input value={s.draft} placeholder={cfg.ph} aria-label={`Pages for ${f.name}`} spellCheck={false}
          onChange={e => dispatch({ type: 'type', tool, id: f.id, text: e.target.value, max: f.count })}
          onBlur={() => dispatch({ type: 'blur', tool, id: f.id })}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          style={{ height: 34, borderColor: bad ? 'var(--red)' : undefined }} />
        <div aria-live="polite" style={{ fontSize: 11, color: bad ? 'var(--red)' : 'var(--text3)', minHeight: 14 }}>
          {s.issues.length ? s.issues.map(i => `${i.token}: ${i.hint}`).join(' · ')
            : s.pending ? 'finish the range…' : `${s.sel.size} of ${f.count} pages selected`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {chips.map(([k, l]) => <button key={k} className="bw-chipbtn" onClick={() => dispatch({ type: 'preset', tool, id: f.id, name: k, max: f.count, k: nVal })}>{l}</button>)}
          {n > 1 && files[0] && <button className="bw-chipbtn" onClick={() => dispatch({ type: 'copyFrom', tool, id: f.id, from: files[0].id, max: f.count })}>Same as Doc 1</button>}
        </div>
      </>
    )
  }
  const summary = f => {
    const s = S[f.id]
    if (tool === 'split') return splitMode === 'every' ? `${Math.ceil(f.count / Math.max(1, every))} parts` : `${s.groups.length} part${s.groups.length === 1 ? '' : 's'}`
    return `${s.sel.size} ${{ delete: 'to delete', extract: 'to keep', duplicate: 'to copy' }[tool]}`
  }
  const headerExtra = f => (tool === 'split' && splitMode === 'every') ? null : (
    <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{S[f.id].sel.size} of {f.count} selected</span>
      <button className="bw-chipbtn" onClick={() => dispatch({ type: 'preset', tool, id: f.id, name: 'all', max: f.count })}>All</button>
      <button className="bw-chipbtn" onClick={() => dispatch({ type: 'preset', tool, id: f.id, name: 'none', max: f.count })}>None</button>
    </span>
  )

  const renderCard = ({ f, n, i, thumb, color }) => {
    const s = S[f.id], page = i + 1, on = s.sel.has(page), rot = rots[`${f.id}:${i}`] || 0
    const part = parts?.[f.id]?.[page] || 0
    let overlay = null, label = null, dim = false, ring = on ? cfg.ring : null
    const badge = (bg, child) => <div style={{ position: 'absolute', top: 6, left: 6, minWidth: 22, height: 22, padding: '0 6px', borderRadius: 11, background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, zIndex: 2 }}>{child}</div>
    if (tool === 'delete' && on) {
      overlay = <div style={{ position: 'absolute', inset: 0, background: 'rgba(229,83,75,.38)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={44} color="#fff" strokeWidth={3} /></div>
      label = 'Will be deleted'
    } else if (tool === 'extract' && on) { overlay = badge('#16a34a', <Check size={13} strokeWidth={3} />); label = 'Kept' }
    else if (tool === 'duplicate' && on) { overlay = badge('#16a34a', <><Copy size={11} />&nbsp;+{copies}</>); label = `${copies} cop${copies === 1 ? 'y' : 'ies'}` }
    else if (tool === 'split' && part) { overlay = badge('var(--brand)', <><Scissors size={11} />&nbsp;{part}</>); label = `Part ${part}`; ring = 'var(--brand)' }
    if ((tool === 'extract' || tool === 'split') && s.sel.size && !on && !(tool === 'split' && splitMode === 'every')) dim = true
    return (
      <ThumbCard thumb={thumb} color={color} docN={n} page={page} label={label} ring={ring} dim={dim} overlay={overlay} rotation={rot}
        pressed={on} ariaLabel={`Document ${n}, page ${page}${on ? ', selected' : ''}`} onClick={e => onPage(f, page, e)}
        actions={<>
          <CardBtn title="Zoom" onClick={() => setZoom({ f, page, rot })}><ZoomIn size={13} /></CardBtn>
          <CardBtn title="Rotate 90° (applies to output)" onClick={() => rotate(f, i)} bg="rgba(234,88,12,.92)"><RotateCw size={13} /></CardBtn>
        </>} />
    )
  }

  return (
    <>
      <BatchLayout title={cfg.title} subtitle={cfg.sub} topProps={topProps} batch={batch}
        sideTop={sideTop} summary={summary} renderSideBody={renderSideBody} renderCard={renderCard} headerExtra={headerExtra}
        emptyHint={<div><p style={{ fontWeight: 600, color: 'var(--text2)' }}>{cfg.title} — batch mode</p><p style={{ marginTop: 4 }}>Drop one or many PDFs on the left. Click pages to select, or type ranges per file.</p></div>}
        footer={<BatchBar summary={summaryText} note={note} buttons={buttons} run={run} />} />
      {zoom && <ZoomModal file={zoom.f.file} pageNum={zoom.page} rotation={rots[`${zoom.f.id}:${zoom.page - 1}`] || 0} onClose={() => setZoom(null)} />}
    </>
  )
}
