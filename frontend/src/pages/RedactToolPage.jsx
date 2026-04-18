import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Loader2, CheckCircle, AlertCircle,
  ChevronLeft, ChevronRight, Download,
  Plus, X, ShieldCheck, Eye, EyeOff
} from 'lucide-react'
import TopBar from '../components/TopBar'
import { downloadBlob } from '../utils/api'
import { getThumbnailsProgressive } from '../utils/thumbCache'
import { clientRedact } from '../utils/pdfClient'

/* ─── pdf.js helper ───────────────────────────────────────────────────── */
function getPdfjs() {
  const lib = window.pdfjsLib
  if (!lib) throw new Error('pdf.js not loaded')
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  return lib
}

/**
 * Render a PDF page at a given scale, then overlay solid boxes
 * wherever any of `terms` match in the pdf.js text layer.
 * Returns a dataURL (JPEG).
 */
async function renderPageWithRedactions(pdfDoc, pageNum, terms, fillColor, scale = 1.6) {
  const page     = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas   = document.createElement('canvas')
  canvas.width   = Math.floor(viewport.width)
  canvas.height  = Math.floor(viewport.height)
  const ctx      = canvas.getContext('2d')

  // 1. Render the actual page
  await page.render({ canvasContext: ctx, viewport }).promise

  // 2. Pull the text layer
  const { items } = await page.getTextContent()

  // 3. Draw a box over every matching text item
  const activeTerms = terms.filter(t => t.text.trim())
  if (activeTerms.length > 0) {
    const FILL_MAP = { black: '#000000', white: '#ffffff', grey: '#888888' }
    ctx.fillStyle = FILL_MAP[fillColor] || '#000000'

    for (const term of activeTerms) {
      const raw = term.text.trim()
      let pattern
      try {
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const wrapped = term.wholeWord ? `\\b${escaped}\\b` : escaped
        pattern = new RegExp(wrapped, term.caseSensitive ? 'g' : 'gi')
      } catch { continue }

      for (const item of items) {
        if (!item.str) continue
        pattern.lastIndex = 0
        if (!pattern.test(item.str)) continue

        // item.transform = [scaleX, skewX, skewY, scaleY, tx, ty]
        // PDF coords are bottom-left origin; canvas is top-left
        const [, , , sy, tx, ty] = item.transform
        const x  = tx * scale
        const y  = canvas.height - ty * scale
        const w  = Math.abs(item.width * scale)
        const h  = (Math.abs(sy) || 10) * scale * 1.25
        const pad = 2
        ctx.fillRect(x - pad, y - h - pad, w + pad * 2, h + pad * 2)
      }
    }
  }

  page.cleanup()
  return canvas.toDataURL('image/jpeg', 0.88)
}

/* ─── constants ──────────────────────────────────────────────────────── */
const BADGE_COLORS = [
  '#e53935', '#8e24aa', '#1e88e5', '#00897b',
  '#f4511e', '#6d4c41', '#039be5', '#43a047',
]

const FILL_OPTIONS = [
  { value: 'black', label: 'Black', swatch: '#111111' },
  { value: 'white', label: 'White', swatch: '#e8e8e8' },
  { value: 'grey',  label: 'Grey',  swatch: '#888888' },
]

let _nextId = 1
function newTerm(text = '') {
  return { id: _nextId++, text, caseSensitive: false, wholeWord: false }
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function RedactToolPage({
  onBack, dark, onToggleTheme, onGoHome,
  showCategories, activeCategory, onCategoryChange,
  search, onSearch, initialFiles,
}) {
  const [file,         setFile]         = useState(initialFiles?.[0] ?? null)
  const [pages,        setPages]        = useState([])
  const [activePage,   setActivePage]   = useState(1)
  const [loading,      setLoading]      = useState(false)
  const [terms,        setTerms]        = useState([newTerm()])
  const [redactColor,  setRedactColor]  = useState('black')
  const [showPreview,  setShowPreview]  = useState(true)
  const [previewCache, setPreviewCache] = useState({})
  const [previewing,   setPreviewing]   = useState(false)
  const [status,       setStatus]       = useState('idle')
  const [errMsg,       setErrMsg]       = useState('')

  const pdfDocRef = useRef(null)   // holds the live pdf.js document
  const debRef    = useRef(null)

  /* ── file load ─────────────────────────────────────────────────────── */
  const loadFile = useCallback(async (f) => {
    setFile(f); setPages([]); setPreviewCache({}); setErrMsg(''); setLoading(true)
    try {
      const pdfjs    = getPdfjs()
      const arrayBuf = await f.arrayBuffer()
      pdfDocRef.current = await pdfjs.getDocument({ data: arrayBuf }).promise
    } catch (e) { console.error('pdf.js load error', e) }
    let first = true
    getThumbnailsProgressive(f, (t) => {
      if (first) { setLoading(false); first = false }
      if (t.img) setPages(p => [...p, t])
    }, 5)
  }, [])

  const onDrop = useCallback(accepted => { if (accepted[0]) loadFile(accepted[0]) }, [loadFile])
  const { getRootProps, getInputProps, isDragActive } =
    useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 })

  useEffect(() => { if (initialFiles?.[0] && !file) loadFile(initialFiles[0]) }, []) // eslint-disable-line

  /* ── pixel-accurate live preview ────────────────────────────────────── */
  useEffect(() => {
    if (!file || !showPreview || !pdfDocRef.current) return
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      setPreviewing(true)
      try {
        const dataUrl = await renderPageWithRedactions(
          pdfDocRef.current, activePage, terms, redactColor
        )
        setPreviewCache(c => ({ ...c, [activePage]: dataUrl }))
      } catch (e) { console.error('Preview error', e) }
      setPreviewing(false)
    }, 220)
    return () => clearTimeout(debRef.current)
  }, [activePage, terms, redactColor, showPreview, file])

  const activeThumb = pages.find(p => p.page === activePage)
  const previewSrc  = showPreview ? previewCache[activePage] : activeThumb?.img

  /* ── term management ─────────────────────────────────────────────────── */
  const addTerm    = ()           => setTerms(t => [...t, newTerm()])
  const removeTerm = id           => setTerms(t => t.filter(x => x.id !== id))
  const updateTerm = (id, patch)  => setTerms(t => t.map(x => x.id === id ? { ...x, ...patch } : x))
  const activeTerms = terms.filter(t => t.text.trim())

  /* ── apply / download ────────────────────────────────────────────────── */
  const apply = async () => {
    if (!file || !activeTerms.length) return
    setStatus('loading'); setErrMsg('')
    try {
      const { data } = await clientRedact(file, activeTerms, redactColor)
      downloadBlob(data, 'redacted.pdf')
      setStatus('done')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (e) {
      setErrMsg(e.message || 'Redaction failed')
      setStatus('idle')
    }
  }

  /* ════════════════════════════════════════════════════════════ render ══ */
  return (
    <div style={{ height: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <TopBar
        onBack={onBack} title="◆ Redact Text" subtitle="Permanently black out sensitive text"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}
      />

      {/* ── Drop zone ── */}
      {!file ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <div style={{ maxWidth: '460px', width: '100%' }}>
            <div
              {...getRootProps()}
              style={{ background: isDragActive ? 'rgba(229,57,53,0.08)' : 'var(--bg2)', border: `2px dashed ${isDragActive ? '#e53935' : 'var(--border)'}`, borderRadius: '16px', padding: '56px 40px', textAlign: 'center', cursor: 'pointer' }}
            >
              <input {...getInputProps()} />
              <div style={{ fontSize: '38px', marginBottom: '14px', opacity: 0.55 }}>🔒</div>
              <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '15px', marginBottom: '7px' }}>Drop your PDF here</p>
              <p style={{ color: 'var(--text3)', fontSize: '12px' }}>or click to browse</p>
            </div>
          </div>
        </div>

      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ════ Panel 1 — Settings ════ */}
          <div style={{ width: '265px', flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg2)' }}>

            {/* File chip */}
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setPages([]); pdfDocRef.current = null }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '15px' }}>×</button>
            </div>

            {/* ── Redact Terms ── */}
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)', margin: 0 }}>Redact Terms</p>
                <span style={{ fontSize: '10px', color: activeTerms.length ? '#e53935' : 'var(--text3)', fontWeight: 700 }}>{activeTerms.length} active</span>
              </div>

              {terms.map((term, idx) => {
                const col = BADGE_COLORS[idx % BADGE_COLORS.length]
                return (
                  <div key={term.id} style={{ display: 'flex', flexDirection: 'column', gap: '5px', background: 'var(--bg4)', border: `1px solid ${term.text.trim() ? col + '55' : 'var(--border)'}`, borderRadius: '8px', padding: '8px 9px', transition: 'border-color 0.15s' }}>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col, flexShrink: 0 }} />
                      <input
                        value={term.text}
                        onChange={e => updateTerm(term.id, { text: e.target.value })}
                        placeholder={`Term ${idx + 1}…`}
                        style={{ flex: 1, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '5px', padding: '5px 8px', fontSize: '11px', outline: 'none' }}
                      />
                      {terms.length > 1 && (
                        <button onClick={() => removeTerm(term.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', paddingLeft: '13px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px', color: 'var(--text3)' }}>
                        <input type="checkbox" checked={term.caseSensitive} onChange={e => updateTerm(term.id, { caseSensitive: e.target.checked })} style={{ accentColor: col, width: '11px', height: '11px' }} />
                        Aa case
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px', color: 'var(--text3)' }}>
                        <input type="checkbox" checked={term.wholeWord} onChange={e => updateTerm(term.id, { wholeWord: e.target.checked })} style={{ accentColor: col, width: '11px', height: '11px' }} />
                        Whole word
                      </label>
                    </div>
                  </div>
                )
              })}

              <button
                onClick={addTerm}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', width: '100%', padding: '7px', borderRadius: '7px', border: '1.5px dashed var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: '11px', fontWeight: 600, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#e53935'; e.currentTarget.style.color = '#e53935' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}
              >
                <Plus size={12} /> Add another term
              </button>

              {activeTerms.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {activeTerms.map(t => {
                    const termIdx = terms.findIndex(x => x.id === t.id)
                    const col = BADGE_COLORS[termIdx % BADGE_COLORS.length]
                    return (
                      <span key={t.id} style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: col + '22', color: col, border: `1px solid ${col}55` }}>
                        {t.text.length > 16 ? t.text.slice(0, 14) + '…' : t.text}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Fill colour ── */}
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)', margin: 0 }}>Redaction Fill</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {FILL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setRedactColor(opt.value)}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', padding: '7px 4px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${redactColor === opt.value ? '#e53935' : 'var(--border)'}`, background: redactColor === opt.value ? 'rgba(229,57,53,0.1)' : 'var(--bg4)', transition: 'all 0.12s' }}
                  >
                    <div style={{ width: '26px', height: '16px', borderRadius: '3px', background: opt.swatch, border: '1px solid rgba(128,128,128,0.25)' }} />
                    <span style={{ fontSize: '9px', color: redactColor === opt.value ? '#e53935' : 'var(--text3)', fontWeight: 700 }}>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Preview toggle ── */}
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text2)', fontWeight: 600 }}>Live Preview</span>
                <p style={{ fontSize: '9px', color: 'var(--text3)', margin: '2px 0 0' }}>Shows exact redaction boxes</p>
              </div>
              <button
                onClick={() => setShowPreview(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${showPreview ? '#e53935' : 'var(--border)'}`, background: showPreview ? 'rgba(229,57,53,0.12)' : 'var(--bg4)', color: showPreview ? '#e53935' : 'var(--text3)', cursor: 'pointer', fontSize: '10px', fontWeight: 700, transition: 'all 0.12s' }}
              >
                {showPreview ? <Eye size={11} /> : <EyeOff size={11} />}
                {showPreview ? 'On' : 'Off'}
              </button>
            </div>

            {/* ── Warning ── */}
            <div style={{ display: 'flex', gap: '7px', background: 'rgba(229,57,53,0.07)', border: '1px solid rgba(229,57,53,0.22)', borderRadius: '8px', padding: '9px 10px', fontSize: '10px', color: '#e57373' }}>
              <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>Redaction is <strong>permanent</strong> — text is removed from the PDF and cannot be recovered.</span>
            </div>

            {errMsg && (
              <div style={{ display: 'flex', gap: '6px', background: 'rgba(229,83,75,0.1)', border: '1px solid rgba(229,83,75,0.3)', borderRadius: '7px', padding: '8px 10px', fontSize: '10px', color: 'var(--red)' }}>
                <AlertCircle size={11} style={{ flexShrink: 0, marginTop: '1px' }} /> {errMsg}
              </div>
            )}
            <div style={{ height: '65px', flexShrink: 0 }} />
          </div>

          {/* ════ Panel 2 — Thumbnail strip ════ */}
          <div style={{ width: '110px', flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg2)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: '9px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
              Pages {loading && <Loader2 size={9} className="spin" />}
            </div>
            {pages.map(p => (
              <div key={p.page} onClick={() => setActivePage(p.page)} style={{ padding: '6px', cursor: 'pointer', background: activePage === p.page ? 'rgba(229,57,53,0.12)' : 'transparent', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}>
                <div style={{ border: `2px solid ${activePage === p.page ? '#e53935' : 'var(--border)'}`, borderRadius: '4px', overflow: 'hidden' }}>
                  <img src={p.img} alt={`p${p.page}`} style={{ width: '100%', display: 'block' }} />
                </div>
                <span style={{ fontSize: '9px', color: activePage === p.page ? '#e53935' : 'var(--text3)', display: 'block', textAlign: 'center', marginTop: '2px' }}>p.{p.page}</span>
              </div>
            ))}
          </div>

          {/* ════ Panel 3 — Preview workspace ════ */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#12121c' }}>

            {/* Header bar */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <span style={{ fontSize: '12px', color: 'var(--text)', fontWeight: 600 }}>Page {activePage} of {pages.length}</span>
              <span style={{ fontSize: '11px', color: activeTerms.length ? '#e53935' : 'var(--text3)' }}>
                {activeTerms.length ? `● ${activeTerms.length} term${activeTerms.length > 1 ? 's' : ''} queued` : '○ no terms set'}
              </span>
              {previewing && (
                <span style={{ fontSize: '11px', color: '#e53935', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Loader2 size={10} className="spin" /> rendering…
                </span>
              )}
              <div style={{ display: 'flex', gap: '5px', marginLeft: previewing ? '0' : 'auto' }}>
                <button onClick={() => setActivePage(p => Math.max(1, p - 1))} disabled={activePage <= 1} style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: activePage <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: activePage <= 1 ? 0.4 : 1 }}>
                  <ChevronLeft size={12} />
                </button>
                <button onClick={() => setActivePage(p => Math.min(pages.length, p + 1))} disabled={activePage >= pages.length} style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: activePage >= pages.length ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: activePage >= pages.length ? 0.4 : 1 }}>
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>

            {/* Preview area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', minHeight: 0 }}>
              {!pages.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: 'var(--text3)' }}>
                  <Loader2 size={26} color="#e53935" className="spin" style={{ marginBottom: '10px' }} />
                  <p style={{ fontSize: '12px' }}>Loading pages…</p>
                </div>
              ) : (
                <div style={{ textAlign: 'center', width: '100%' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '8px' }}>
                    {showPreview
                      ? 'Live preview — solid boxes show exact redaction positions'
                      : 'Preview off — showing original page'}
                  </p>

                  {/* Term legend */}
                  {activeTerms.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', justifyContent: 'center', marginBottom: '14px' }}>
                      {activeTerms.map(t => {
                        const termIdx = terms.findIndex(x => x.id === t.id)
                        const col = BADGE_COLORS[termIdx % BADGE_COLORS.length]
                        return (
                          <span key={t.id} style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', background: col + '22', color: col, border: `1px solid ${col}55` }}>
                            ■ "{t.text}"
                            {t.caseSensitive && <span style={{ opacity: 0.7 }}> Aa</span>}
                            {t.wholeWord     && <span style={{ opacity: 0.7 }}> W</span>}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* Page image */}
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={`page ${activePage} preview`}
                      style={{ maxWidth: '560px', maxHeight: 'calc(100vh - 230px)', width: '100%', objectFit: 'contain', boxShadow: '0 6px 40px rgba(0,0,0,0.65)', borderRadius: '4px', background: '#fff', display: 'block', margin: '0 auto' }}
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '60px', gap: '10px' }}>
                      <Loader2 size={22} className="spin" color="#e53935" style={{ opacity: 0.6 }} />
                      <p style={{ fontSize: '11px', color: 'var(--text3)' }}>Rendering preview…</p>
                    </div>
                  )}
                  <div style={{ height: '65px' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Floating download button ── */}
      {file && (
        <button
          onClick={apply}
          disabled={!file || status === 'loading' || activeTerms.length === 0}
          title={activeTerms.length === 0 ? 'Add at least one term to redact' : ''}
          style={{
            position: 'fixed', bottom: '20px', right: '20px', zIndex: 9000,
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '11px 22px', borderRadius: '50px', border: 'none',
            background:
              status === 'done'        ? 'var(--green)'  :
              status === 'loading'     ? 'var(--bg3)'    :
              activeTerms.length === 0 ? '#444'          : '#e53935',
            color:      status === 'loading' ? 'var(--text2)' : '#fff',
            fontWeight: 700, fontSize: '13px',
            cursor:  (activeTerms.length === 0 || status === 'loading') ? 'not-allowed' : 'pointer',
            boxShadow: activeTerms.length > 0 && status !== 'loading'
              ? '0 4px 20px rgba(229,57,53,0.45), 0 2px 6px rgba(0,0,0,0.4)'
              : 'none',
            opacity: activeTerms.length === 0 ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          {status === 'loading'
            ? <><Loader2 size={13} className="spin" /> Redacting…</>
            : status === 'done'
              ? <><CheckCircle size={13} /> Downloaded!</>
              : <><Download size={13} /> Redact &amp; Download</>}
        </button>
      )}
    </div>
  )
}
