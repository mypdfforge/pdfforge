import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, ArrowRight, Languages } from 'lucide-react'
import axios from 'axios'
import { downloadBlob } from '../utils/api'

const LANGUAGES = [
  { code: 'auto',  label: '🔍 Auto Detect' },
  { code: 'en',    label: '🇬🇧 English' },
  { code: 'fr',    label: '🇫🇷 French' },
  { code: 'de',    label: '🇩🇪 German' },
  { code: 'es',    label: '🇪🇸 Spanish' },
  { code: 'it',    label: '🇮🇹 Italian' },
  { code: 'pt',    label: '🇵🇹 Portuguese' },
  { code: 'ru',    label: '🇷🇺 Russian' },
  { code: 'zh',    label: '🇨🇳 Chinese' },
  { code: 'ja',    label: '🇯🇵 Japanese' },
  { code: 'ko',    label: '🇰🇷 Korean' },
  { code: 'ar',    label: '🇸🇦 Arabic' },
  { code: 'hi',    label: '🇮🇳 Hindi' },
  { code: 'nl',    label: '🇳🇱 Dutch' },
  { code: 'pl',    label: '🇵🇱 Polish' },
  { code: 'tr',    label: '🇹🇷 Turkish' },
  { code: 'sv',    label: '🇸🇪 Swedish' },
]

const TARGET_LANGS = LANGUAGES.filter(l => l.code !== 'auto')

const PROGRESS_MESSAGES = [
  'Extracting text from PDF…',
  'Detecting source language…',
  'Translating content…',
  'Preserving document layout…',
  'Rebuilding PDF structure…',
  'Finalizing document…',
]

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {title && <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>{title}</p>}
      {children}
    </div>
  )
}

function LangSelect({ value, onChange, options, label }) {
  return (
    <div style={{ flex: 1 }}>
      <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '9px', padding: '9px 12px', fontSize: '13px', outline: 'none', appearance: 'none', cursor: 'pointer', fontWeight: 500 }}>
          {options.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text3)', fontSize: '10px' }}>▼</span>
      </div>
    </div>
  )
}

export default function TranslateToolPage({ onBack, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [file,       setFile]       = useState(null)
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('en')
  const [state,      setState]      = useState('idle')
  const [errMsg,     setErrMsg]     = useState('')
  const [progress,   setProgress]   = useState(0)
  const [progMsg,    setProgMsg]    = useState('')
  const [resultInfo, setResultInfo] = useState(null)

  const onDrop = useCallback(a => { setFile(a[0]); setErrMsg(''); setResultInfo(null) }, [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1,
  })

  const swapLangs = () => {
    if (sourceLang === 'auto') return
    const tmp = sourceLang; setSourceLang(targetLang); setTargetLang(tmp)
  }

  const apply = async () => {
    if (!file) return
    setState('loading'); setErrMsg(''); setProgress(0); setResultInfo(null)

    // Animated progress
    let msgIdx = 0
    setProgMsg(PROGRESS_MESSAGES[0])
    const interval = setInterval(() => {
      setProgress(p => {
        const next = Math.min(p + Math.random() * 10 + 3, 90)
        const newMsgIdx = Math.min(Math.floor(next / 17), PROGRESS_MESSAGES.length - 1)
        if (newMsgIdx !== msgIdx) { msgIdx = newMsgIdx; setProgMsg(PROGRESS_MESSAGES[newMsgIdx]) }
        return next
      })
    }, 700)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('source_lang', sourceLang)
      form.append('target_lang', targetLang)

      const response = await axios.post('/api/tools/translate', form, { responseType: 'blob', validateStatus: null })
      clearInterval(interval); setProgress(100); setProgMsg('Done!')

      if (response.status !== 200) {
        const txt = await response.data.text()
        let msg = `Server error ${response.status}`
        try { msg = JSON.parse(txt).detail || msg } catch {}
        setErrMsg(msg); setState('idle'); setProgress(0); return
      }

      const srcLabel = LANGUAGES.find(l => l.code === sourceLang)?.label || sourceLang
      const tgtLabel = TARGET_LANGS.find(l => l.code === targetLang)?.label || targetLang
      setResultInfo({ from: srcLabel, to: tgtLabel })

      downloadBlob(response.data, `translated_${targetLang}.pdf`)
      setState('done'); setTimeout(() => { setState('idle'); setProgress(0); setProgMsg('') }, 5000)
    } catch (e) {
      clearInterval(interval)
      setErrMsg('Translation failed: ' + (e.response?.data?.detail || e.message))
      setState('idle'); setProgress(0); setProgMsg('')
    }
  }

  const srcLabel = LANGUAGES.find(l => l.code === sourceLang)?.label?.replace(/^..\s/, '') || sourceLang
  const tgtLabel = TARGET_LANGS.find(l => l.code === targetLang)?.label?.replace(/^..\s/, '') || targetLang

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar onBack={onBack} title="⇄ Translate PDF" subtitle="Translate your PDF into any language"
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
              <p style={{ color: 'var(--text)', fontWeight: 500, fontSize: '14px' }}>Drop PDF here</p>
              <p style={{ color: 'var(--text3)', fontSize: '12px', marginTop: '4px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: 'var(--text)' }}>📄 {file.name}</span>
              <button onClick={() => { setFile(null); setResultInfo(null) }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '18px' }}>×</button>
            </div>
          )}

          {/* Language selector */}
          <Section title="Translation">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
              <LangSelect value={sourceLang} onChange={setSourceLang} options={LANGUAGES} label="From" />
              <button onClick={swapLangs}
                title="Swap languages"
                style={{
                  width: '34px', height: '34px', flexShrink: 0, borderRadius: '8px', marginBottom: '1px',
                  border: '1px solid var(--border)', background: sourceLang === 'auto' ? 'var(--bg3)' : 'var(--bg3)',
                  color: sourceLang === 'auto' ? 'var(--text3)' : 'var(--accent2)',
                  cursor: sourceLang === 'auto' ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
                  opacity: sourceLang === 'auto' ? 0.4 : 1,
                }}>⇄</button>
              <LangSelect value={targetLang} onChange={setTargetLang} options={TARGET_LANGS} label="To" />
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.5 }}>
              The translated PDF will preserve the original layout as closely as possible.
            </p>
          </Section>

          {/* Progress bar */}
          {state === 'loading' && (
            <Section>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600 }}>{progMsg}</span>
                <span style={{ fontSize: '12px', color: 'var(--accent2)', fontWeight: 700 }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--accent), #e879f9)', borderRadius: '3px', transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                {PROGRESS_MESSAGES.map((_, i) => (
                  <div key={i} style={{ flex: 1, height: '3px', borderRadius: '2px', background: progress >= (i + 1) * 17 ? 'var(--accent)' : 'var(--bg3)', transition: 'background 0.4s' }} />
                ))}
              </div>
            </Section>
          )}

          {errMsg && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'rgba(229,83,75,0.1)', border: '1px solid rgba(229,83,75,0.3)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: 'var(--red)', lineHeight: 1.5 }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {errMsg}
            </div>
          )}

          <button onClick={apply} disabled={!file || state === 'loading'}
            style={{ padding: '12px', background: state === 'done' ? 'var(--green)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: '10px', cursor: !file ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 16px rgba(108,99,255,0.25)', opacity: !file ? 0.5 : 1 }}>
            {state === 'loading' ? <><Loader2 size={15} className="spin" />Translating…</>
              : state === 'done' ? <><CheckCircle size={15} />Downloaded!</>
              : <><Languages size={15} />Translate PDF</>}
          </button>
        </div>

        {/* ── Right Info Panel ── */}
        <div style={{ flex: 1, background: '#14141f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', overflowY: 'auto' }}>
          {resultInfo ? (
            <div style={{ textAlign: 'center', maxWidth: '420px' }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>✓</div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>Translation Complete</h2>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
                <span style={{ fontSize: '15px', color: 'var(--text2)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 14px' }}>{resultInfo.from}</span>
                <ArrowRight size={16} color="var(--accent2)" />
                <span style={{ fontSize: '15px', color: 'var(--text)', background: 'rgba(108,99,255,0.15)', border: '1px solid var(--accent)', borderRadius: '8px', padding: '6px 14px', fontWeight: 600 }}>{resultInfo.to}</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text3)', lineHeight: 1.6 }}>Your translated PDF has been downloaded. The layout and formatting have been preserved as closely as possible.</p>
            </div>
          ) : (
            <div style={{ textAlign: 'center', maxWidth: '480px' }}>
              <div style={{ fontSize: '52px', marginBottom: '20px', opacity: 0.2 }}>⇄</div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text2)', marginBottom: '8px' }}>Upload a PDF and choose languages</p>
              <p style={{ fontSize: '13px', color: 'var(--text3)', lineHeight: 1.7, marginBottom: '32px' }}>
                The translation engine extracts text from each page, translates it, and rebuilds the PDF preserving the original structure.
              </p>
              {/* Language preview */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '16px 24px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '14px' }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '5px' }}>From</p>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text2)' }}>{srcLabel}</p>
                </div>
                <ArrowRight size={18} color="var(--accent)" />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '5px' }}>To</p>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent2)' }}>{tgtLabel}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
