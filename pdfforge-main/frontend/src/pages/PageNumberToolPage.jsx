import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import {
  Upload, Loader2, CheckCircle, AlertCircle,
  Bold, Italic, ChevronDown, Hash
} from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

const FONTS = ['Helvetica', 'Times New Roman', 'Courier', 'Arial', 'Georgia']

const POSITIONS = [
  'top-left',    'top-center',    'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]
const POS_ICONS = {
  'top-left':'↖', 'top-center':'↑', 'top-right':'↗',
  'middle-left':'←', 'middle-center':'·', 'middle-right':'→',
  'bottom-left':'↙', 'bottom-center':'↓', 'bottom-right':'↘',
}

const PRESETS = [
  { label: '{n}',               title: 'Number only' },
  { label: 'Page {n}',         title: 'Page N' },
  { label: 'Page {n} of {total}', title: 'Page N of Total' },
  { label: '{n} / {total}',    title: 'N / Total' },
  { label: '– {n} –',          title: 'Dashes' },
]

/* ── Reusable atoms ───────────────────────────────────────────────────── */
function PositionGrid({ value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px' }}>
      {POSITIONS.map(pos => (
        <button
          key={pos}
          onClick={() => onChange(pos)}
          title={pos}
          style={{
            width: '30px', height: '30px', borderRadius: '6px',
            border: `1px solid ${value === pos ? 'var(--accent)' : 'var(--border)'}`,
            background: value === pos ? 'rgba(108,99,255,0.25)' : 'var(--bg3)',
            color: value === pos ? 'var(--accent2)' : 'var(--text3)',
            cursor: 'pointer', fontSize: '14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.12s',
          }}
        >{POS_ICONS[pos]}</button>
      ))}
    </div>
  )
}

function SliderRow({ label, value, min, max, step, onChange, fmt }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600 }}>{label}</label>
        <span style={{ fontSize: '12px', color: 'var(--accent2)', fontWeight: 600 }}>{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px',
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px',
    }}>
      {title && (
        <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>
          {title}
        </p>
      )}
      {children}
    </div>
  )
}

function PageRangeControl({ onChange }) {
  const [mode, setMode] = useState('all')
  const [custom, setCustom] = useState('')
  const handleMode = m => { setMode(m); onChange(m !== 'custom' ? m : custom) }
  const handleCustom = v => { setCustom(v); onChange(v) }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ display: 'flex', gap: '5px' }}>
        {['all', 'odd', 'even', 'custom'].map(o => (
          <button
            key={o}
            onClick={() => handleMode(o)}
            style={{
              flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: 600, borderRadius: '6px',
              border: `1px solid ${mode === o ? 'var(--accent)' : 'var(--border)'}`,
              background: mode === o ? 'rgba(108,99,255,0.15)' : 'var(--bg3)',
              color: mode === o ? 'var(--accent2)' : 'var(--text3)',
              cursor: 'pointer', textTransform: 'capitalize',
            }}
          >{o}</button>
        ))}
      </div>
      {mode === 'custom' && (
        <input
          value={custom}
          onChange={e => handleCustom(e.target.value)}
          placeholder="e.g. 1-3, 5, 8"
          style={{
            width: '100%', background: 'var(--bg3)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: '8px',
            padding: '7px 10px', fontSize: '12px', outline: 'none', boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────────────── */
export default function PageNumberToolPage({
  onBack, dark, onToggleTheme, onGoHome,
  showCategories, activeCategory, onCategoryChange, search, onSearch,
}) {
  // File
  const [file,       setFile]       = useState(null)

  // Number options
  const [template,   setTemplate]   = useState('Page {n} of {total}')
  const [firstNum,   setFirstNum]   = useState(1)
  const [rangeFrom,  setRangeFrom]  = useState(1)
  const [rangeTo,    setRangeTo]    = useState('')   // '' = last page

  // Layout
  const [position,   setPosition]   = useState('bottom-center')
  const [facingPages,setFacingPages]= useState(false)

  // Typography
  const [font,       setFont]       = useState('Helvetica')
  const [bold,       setBold]       = useState(false)
  const [italic,     setItalic]     = useState(false)
  const [color,      setColor]      = useState('#555555')
  const [fontSize,   setFontSize]   = useState(11)
  const [opacity,    setOpacity]    = useState(0.9)

  // Apply to
  const [pageRange,  setPageRange]  = useState('all')

  // Preview / state
  const [preview,    setPreview]    = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [state,      setState]      = useState('idle')
  const [errMsg,     setErrMsg]     = useState('')
  const debounceRef = useRef(null)

  const onDrop = useCallback(a => { setFile(a[0]); setPreview(null); setErrMsg('') }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1,
  })

  // Auto-preview on any setting change
  useEffect(() => {
    if (!file) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(getPreview, 700)
    return () => clearTimeout(debounceRef.current)
  }, [file, template, firstNum, rangeFrom, rangeTo, position, facingPages,
      font, bold, italic, color, fontSize, opacity, pageRange])

  const buildForm = () => {
    const form = new FormData()
    form.append('file', file)
    form.append('template', template)
    form.append('first_number', String(firstNum))
    form.append('range_from', String(rangeFrom))
    form.append('range_to', rangeTo === '' ? '' : String(rangeTo))
    form.append('position', position)
    form.append('facing_pages', String(facingPages))
    form.append('font', font)
    form.append('bold', String(bold))
    form.append('italic', String(italic))
    form.append('color', color)
    form.append('font_size', String(fontSize))
    form.append('opacity', String(opacity))
    form.append('page_range', pageRange)
    return form
  }

  const getPreview = async () => {
    if (!file) return
    setLoading(true)
    try {
      const { data } = await axios.post('/api/tools/page-numbers/preview', buildForm())
      setPreview(data.preview); setErrMsg('')
    } catch (e) {
      setErrMsg('Preview error: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!file) return
    setState('loading'); setErrMsg('')
    try {
      const response = await axios.post('/api/tools/page-numbers', buildForm(), {
        responseType: 'blob', validateStatus: null,
      })
      if (response.status !== 200) {
        const txt = await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(txt).detail || msg } catch {}
        setErrMsg(msg); setState('idle'); return
      }
      downloadBlob(response.data, 'numbered.pdf')
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch (e) {
      setErrMsg('Error: ' + (e.response?.data?.detail || e.message)); setState('idle')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        onBack={onBack} title="# Add Page Numbers"
        subtitle="Flexible page numbering with live preview"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch}
      />

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 52px)', overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{
          width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)',
          overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px',
        }}>

          {/* File drop / file pill */}
          {!file ? (
            <div
              {...getRootProps()}
              style={{
                background: isDragActive ? 'rgba(108,99,255,0.08)' : 'var(--bg2)',
                border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '12px', padding: '30px 20px', textAlign: 'center', cursor: 'pointer',
              }}
            >
              <input {...getInputProps()} />
              <Upload size={20} color="var(--accent2)" style={{ margin: '0 auto 10px', display: 'block' }} />
              <p style={{ color: 'var(--text)', fontWeight: 500, fontSize: '14px' }}>Drop PDF here</p>
              <p style={{ color: 'var(--text3)', fontSize: '12px', marginTop: '4px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '9px 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: '13px', color: 'var(--text)' }}>📄 {file.name}</span>
              <button
                onClick={() => { setFile(null); setPreview(null); setErrMsg('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '18px' }}
              >×</button>
            </div>
          )}

          {/* ── Page Number Options ── */}
          <Section title="Page Number Options">
            {/* Template / presets */}
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                Number Format
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setTemplate(p.label)}
                    title={p.title}
                    style={{
                      fontSize: '11px', padding: '3px 9px', borderRadius: '6px', fontFamily: 'monospace',
                      border: `1px solid ${template === p.label ? 'var(--accent)' : 'var(--border)'}`,
                      background: template === p.label ? 'rgba(108,99,255,0.15)' : 'var(--bg3)',
                      color: template === p.label ? 'var(--accent2)' : 'var(--text2)',
                      cursor: 'pointer',
                    }}
                  >{p.label}</button>
                ))}
              </div>
              <input
                value={template}
                onChange={e => setTemplate(e.target.value)}
                placeholder="e.g. Page {n} of {total}"
                style={{
                  width: '100%', background: 'var(--bg3)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  padding: '8px 12px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
              <div style={{ marginTop: '7px' }}>
                <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '5px' }}>Placeholders:</p>
                <div style={{ display: 'flex', gap: '5px' }}>
                  {[
                    ['{n}', 'Current page number'],
                    ['{total}', 'Total page count'],
                  ].map(([ph, tip]) => (
                    <button
                      key={ph}
                      onClick={() => setTemplate(t => t + ph)}
                      title={tip}
                      style={{
                        fontSize: '11px', padding: '3px 9px', borderRadius: '6px',
                        border: '1px solid var(--border)', background: 'var(--bg3)',
                        color: 'var(--accent2)', cursor: 'pointer', fontFamily: 'monospace',
                      }}
                    >{ph}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* First number + Range */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '5px' }}>
                  First Number
                </label>
                <input
                  type="number" min={0} value={firstNum}
                  onChange={e => setFirstNum(+e.target.value)}
                  style={{
                    width: '100%', background: 'var(--bg3)', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: '8px',
                    padding: '7px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '5px' }}>
                  From Page
                </label>
                <input
                  type="number" min={1} value={rangeFrom}
                  onChange={e => setRangeFrom(+e.target.value)}
                  style={{
                    width: '100%', background: 'var(--bg3)', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: '8px',
                    padding: '7px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '5px' }}>
                To Page <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(leave blank for last)</span>
              </label>
              <input
                type="number" min={1} value={rangeTo}
                onChange={e => setRangeTo(e.target.value)}
                placeholder="Last page"
                style={{
                  width: '100%', background: 'var(--bg3)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  padding: '7px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </Section>

          {/* ── Layout & Position ── */}
          <Section title="Layout & Position">
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, marginBottom: '7px' }}>Position</p>
                <PositionGrid value={position} onChange={setPosition} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '2px' }}>Page Mode</p>
                {[
                  ['single', 'Single Page'],
                  ['facing', 'Facing Pages'],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setFacingPages(val === 'facing')}
                    style={{
                      fontSize: '11px', padding: '7px 10px', borderRadius: '8px', textAlign: 'left',
                      border: `1px solid ${facingPages === (val === 'facing') ? 'var(--accent)' : 'var(--border)'}`,
                      background: facingPages === (val === 'facing') ? 'rgba(108,99,255,0.15)' : 'var(--bg3)',
                      color: facingPages === (val === 'facing') ? 'var(--accent2)' : 'var(--text3)',
                      cursor: 'pointer',
                    }}
                  >
                    {val === 'facing' ? '📖' : '📄'} {label}
                  </button>
                ))}
                {facingPages && (
                  <p style={{ fontSize: '10px', color: 'var(--text3)', lineHeight: 1.4 }}>
                    Odd pages → right side<br />Even pages → left side
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* ── Typography ── */}
          <Section title="Typography">
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600, display: 'block', marginBottom: '5px' }}>Font Family</label>
              <div style={{ position: 'relative' }}>
                <select
                  value={font} onChange={e => setFont(e.target.value)}
                  style={{
                    width: '100%', background: 'var(--bg3)', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: '8px',
                    padding: '7px 12px', fontSize: '13px', outline: 'none',
                    appearance: 'none', cursor: 'pointer',
                  }}
                >
                  {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <ChevronDown size={13} color="var(--text3)" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {[
                [bold, setBold, <Bold size={14} />, 'B'],
                [italic, setItalic, <Italic size={14} />, 'I'],
              ].map(([val, set, icon, key]) => (
                <button
                  key={key}
                  onClick={() => set(!val)}
                  style={{
                    width: '34px', height: '34px', borderRadius: '7px',
                    border: `1px solid ${val ? 'var(--accent)' : 'var(--border)'}`,
                    background: val ? 'rgba(108,99,255,0.2)' : 'var(--bg3)',
                    color: val ? 'var(--accent2)' : 'var(--text2)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >{icon}</button>
              ))}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', flex: 1,
                background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: '7px', padding: '0 10px', height: '34px',
              }}>
                <label style={{ fontSize: '12px', color: 'var(--text2)' }}>Color</label>
                <input
                  type="color" value={color} onChange={e => setColor(e.target.value)}
                  style={{ width: '26px', height: '20px', padding: 0, border: 'none', borderRadius: '3px', cursor: 'pointer', background: 'none' }}
                />
              </div>
            </div>

            <SliderRow label="Font Size" value={fontSize} min={6} max={36} step={1} onChange={setFontSize} fmt={v => `${v}pt`} />
          </Section>

          {/* ── Appearance ── */}
          <Section title="Appearance">
            <SliderRow label="Opacity" value={opacity} min={0.05} max={1} step={0.05} onChange={setOpacity} fmt={v => `${Math.round(v * 100)}%`} />
          </Section>

          {/* ── Apply to Pages ── */}
          <Section title="Apply to Pages">
            <PageRangeControl onChange={setPageRange} />
          </Section>

          {/* Error */}
          {errMsg && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              background: 'rgba(229,83,75,0.1)', border: '1px solid rgba(229,83,75,0.3)',
              borderRadius: '8px', padding: '10px 12px', fontSize: '12px',
              color: 'var(--red)', lineHeight: 1.5,
            }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {errMsg}
            </div>
          )}

          {/* Apply button */}
          <button
            onClick={apply}
            disabled={!file || state === 'loading'}
            style={{
              padding: '12px',
              background: state === 'done' ? 'var(--green)' : state === 'loading' ? 'var(--bg3)' : 'var(--accent)',
              color: state === 'loading' ? 'var(--text2)' : '#fff',
              border: 'none', borderRadius: '10px', cursor: 'pointer',
              fontWeight: 700, fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: '0 4px 16px rgba(108,99,255,0.25)', opacity: !file ? 0.5 : 1,
            }}
          >
            {state === 'loading'
              ? <><Loader2 size={15} className="spin" /> Adding page numbers…</>
              : state === 'done'
              ? <><CheckCircle size={15} /> Downloaded!</>
              : <><Hash size={15} /> Add Page Numbers</>}
          </button>
        </div>

        {/* ── Live Preview Panel ── */}
        <div style={{
          flex: 1, background: '#14141f',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px', overflowY: 'auto',
        }}>
          {!file ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: '52px', marginBottom: '14px', opacity: 0.25 }}>#</div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text2)' }}>Upload a PDF to see live preview</p>
              <p style={{ fontSize: '13px', marginTop: '6px' }}>Changes update automatically as you adjust settings</p>
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
              <Loader2 size={32} color="var(--accent)" className="spin" style={{ display: 'block', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '13px' }}>Generating preview…</p>
            </div>
          ) : preview ? (
            <div style={{ textAlign: 'center', width: '100%' }}>
              <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '14px' }}>
                Live preview (page 1) — updates automatically
              </p>
              <img
                src={preview}
                alt="Page number preview"
                style={{
                  maxWidth: '100%', maxHeight: '78vh',
                  boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
                  borderRadius: '4px', background: '#fff',
                }}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
              <Loader2 size={20} className="spin" style={{ display: 'block', margin: '0 auto 10px', opacity: 0.4 }} />
              <p style={{ fontSize: '13px' }}>Waiting for preview…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
