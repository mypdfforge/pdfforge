import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, FileText, Search } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

const LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'rus', label: 'Russian' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
  { code: 'ara', label: 'Arabic' },
  { code: 'hin', label: 'Hindi' },
]

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {title && <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>{title}</p>}
      {children}
    </div>
  )
}

export default function OCRToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,       setFile]       = useState(null)
  const [language,   setLanguage]   = useState('eng')
  const [outputMode, setOutputMode] = useState('searchable') // 'searchable' | 'text'
  const [state,      setState]      = useState('idle')
  const [errMsg,     setErrMsg]     = useState('')
  const [extractedText, setExtractedText] = useState('')
  const [progress,   setProgress]   = useState(0)

  const onDrop = useCallback(a => { setFile(a[0]); setErrMsg(''); setExtractedText('') }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1,
  })

  const apply = async () => {
    if (!file) return
    setState('loading'); setErrMsg(''); setExtractedText(''); setProgress(0)

    // Simulate progress
    const interval = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 12, 88))
    }, 600)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('language', language)
      form.append('output_mode', outputMode)

      const response = await axios.post('/api/tools/ocr', form, {
        responseType: outputMode === 'text' ? 'json' : 'blob',
        validateStatus: null,
      })
      clearInterval(interval); setProgress(100)

      if (response.status !== 200) {
        const txt = outputMode === 'text' ? JSON.stringify(response.data) : await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(txt).detail || msg } catch {}
        setErrMsg(msg); setState('idle'); setProgress(0); return
      }

      if (outputMode === 'text') {
        setExtractedText(response.data.text || '')
        setState('done')
      } else {
        downloadBlob(response.data, 'ocr_searchable.pdf')
        setState('done')
      }
      setTimeout(() => { setState('idle'); setProgress(0) }, 4000)
    } catch (e) {
      clearInterval(interval)
      setErrMsg('OCR failed: ' + (e.response?.data?.detail || e.message))
      setState('idle'); setProgress(0)
    }
  }

  const copyText = () => { navigator.clipboard.writeText(extractedText) }
  const downloadText = () => {
    const blob = new Blob([extractedText], { type: 'text/plain' })
    downloadBlob(blob, 'extracted_text.txt', 'text/plain')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar onBack={onBack} title="⌕ OCR PDF" subtitle="Make scanned PDFs searchable or extract plain text"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch} />

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 52px)', overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{ width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* File */}
          {!file ? (
            <div {...getRootProps()} style={{ background: isDragActive ? 'rgba(108,99,255,0.08)' : 'var(--bg2)', border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '12px', padding: '30px 20px', textAlign: 'center', cursor: 'pointer' }}>
              <input {...getInputProps()} />
              <Upload size={20} color="var(--accent2)" style={{ margin: '0 auto 10px', display: 'block' }} />
              <p style={{ color: 'var(--text)', fontWeight: 500, fontSize: '14px' }}>Drop scanned PDF here</p>
              <p style={{ color: 'var(--text3)', fontSize: '12px', marginTop: '4px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: 'var(--text)' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setExtractedText('') }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '18px' }}>×</button>
            </div>
          )}

          {/* Output mode toggle */}
          <Section title="Output Mode">
            {[
              { id: 'searchable', icon: <Search size={14} />, label: 'Searchable PDF', desc: 'Keeps original layout, adds invisible text layer' },
              { id: 'text',       icon: <FileText size={14} />, label: 'Plain Text Extract', desc: 'Extracts all text, copy or download as .txt' },
            ].map(opt => (
              <button key={opt.id} onClick={() => setOutputMode(opt.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px',
                  borderRadius: '9px', textAlign: 'left', cursor: 'pointer',
                  border: `2px solid ${outputMode === opt.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: outputMode === opt.id ? 'rgba(108,99,255,0.1)' : 'var(--bg3)',
                }}>
                <span style={{ color: outputMode === opt.id ? 'var(--accent2)' : 'var(--text3)', marginTop: '1px', flexShrink: 0 }}>{opt.icon}</span>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: outputMode === opt.id ? 'var(--text)' : 'var(--text2)', marginBottom: '2px' }}>{opt.label}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4 }}>{opt.desc}</p>
                </div>
              </button>
            ))}
          </Section>

          {/* Language */}
          <Section title="Document Language">
            <select value={language} onChange={e => setLanguage(e.target.value)}
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', outline: 'none', appearance: 'none', cursor: 'pointer' }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <p style={{ fontSize: '11px', color: 'var(--text3)' }}>Select the primary language in the scanned document for best accuracy.</p>
          </Section>

          {errMsg && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'rgba(229,83,75,0.1)', border: '1px solid rgba(229,83,75,0.3)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: 'var(--red)', lineHeight: 1.5 }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {errMsg}
            </div>
          )}

          {/* Progress bar */}
          {state === 'loading' && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600 }}>Running OCR…</span>
                <span style={{ fontSize: '12px', color: 'var(--accent2)', fontWeight: 700 }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent2))', borderRadius: '3px', transition: 'width 0.5s ease' }} />
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '7px' }}>This may take a moment for large documents…</p>
            </div>
          )}

          <button onClick={apply} disabled={!file || state === 'loading'}
            style={{ padding: '12px', background: state === 'done' ? 'var(--green)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px', cursor: !file ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 16px rgba(108,99,255,0.25)', opacity: !file ? 0.5 : 1 }}>
            {state === 'loading' ? <><Loader2 size={15} className="spin" />Processing…</>
              : state === 'done' ? <><CheckCircle size={15} />{outputMode === 'text' ? 'Text Extracted!' : 'Downloaded!'}</>
              : <><Search size={15} />Run OCR</>}
          </button>
        </div>

        {/* ── Right Panel ── */}
        <div style={{ flex: 1, background: '#14141f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px', overflowY: 'auto' }}>
          {extractedText ? (
            <div style={{ width: '100%', maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '13px', color: 'var(--text2)', fontWeight: 600 }}>Extracted Text</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={copyText}
                    style={{ padding: '6px 14px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    Copy
                  </button>
                  <button onClick={downloadText}
                    style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    Download .txt
                  </button>
                </div>
              </div>
              <textarea readOnly value={extractedText}
                style={{ width: '100%', height: '60vh', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px', fontSize: '13px', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: 'monospace' }} />
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: '52px', marginBottom: '14px', opacity: 0.25 }}>⌕</div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text2)' }}>Upload a scanned PDF to get started</p>
              <p style={{ fontSize: '13px', marginTop: '6px' }}>OCR will make it searchable or extract all text</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
