import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import { Upload, Loader2, CheckCircle, AlertCircle, FileText, Search, X, Download, Copy, Eye } from 'lucide-react'
import { downloadBlob } from '../utils/api'
import {
  getPaddleOCREngine, packForLanguage, ocrRawLines, recoverLowConfidence,
  buildPageResult, buildSearchablePdf, buildSidecar, evaluateQualityGates, buildOcrDocxBlob,
  routeScriptPacks, recoverCodeClosers, recoverLeadingSymbols,
} from '../utils/paddleOcr'
import { extractNativeLines, isNativeGood, getPageImageRects } from '../utils/nativeText'
import { overlap } from '../utils/ocrPostProcess'
import { reconcileDocumentHeadersFooters } from '../utils/ocrLayoutAnalysis'

/**
 * 100% client-side. Per page:
 *  1. read native text layer (pdf.js). Good text and no images -> skip OCR for that page.
 *  2. else render at 2x, run PP-OCR, re-read weak lines at 2x crop.
 *  3. route native + OCR so each region has exactly one source, then layout + text.
 *  4. write invisible text layer only for OCR-sourced lines.
 */

const RENDER_SCALE = 2.0

// pack = recognizer pack from /models/ocr/<pack>/ ; missing pack falls back to default with a warning
const LANGUAGES = [
  { code: 'eng', label: 'English / Latin / Chinese (default model)' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'rus', label: 'Russian (Cyrillic pack)' },
  { code: 'ell', label: 'Greek (pack)' },
  { code: 'heb', label: 'Hebrew (pack)' },
  { code: 'ara', label: 'Arabic (pack)' },
  { code: 'hin', label: 'Hindi / Devanagari (pack)' },
  { code: 'jpn', label: 'Japanese (pack)' },
  { code: 'kor', label: 'Korean (pack)' },
  { code: 'tha', label: 'Thai (pack)' },
  { code: 'tam', label: 'Tamil (pack)' },
  { code: 'tel', label: 'Telugu (pack)' },
  { code: 'kan', label: 'Kannada (pack)' },
  { code: 'mal', label: 'Malayalam (pack)' },
]

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {title && <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)' }}>{title}</p>}
      {children}
    </div>
  )
}

function getPdfjs() {
  const lib = window.pdfjsLib
  if (!lib) throw new Error('pdf.js not loaded')
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
  return lib
}

const OptionButton = ({ active, onClick, icon, label, desc }) => (
  <button onClick={onClick}
    style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px',
      borderRadius: '9px', textAlign: 'left', cursor: 'pointer',
      border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'rgba(234,88,12,0.1)' : 'var(--bg3)',
    }}>
    <span style={{ color: active ? 'var(--accent2)' : 'var(--text3)', marginTop: '1px', flexShrink: 0 }}>{icon}</span>
    <div>
      <p style={{ fontSize: '13px', fontWeight: 600, color: active ? 'var(--text)' : 'var(--text2)', marginBottom: '2px' }}>{label}</p>
      <p style={{ fontSize: '11px', color: 'var(--text3)', lineHeight: 1.4 }}>{desc}</p>
    </div>
  </button>
)

const ghostBtn = { padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }

export default function OCRToolPage({
  onBack, dark, onToggleTheme, onGoHome,
  showCategories, activeCategory, onCategoryChange, search, onSearch,
}) {
  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('eng')
  const [outputMode, setOutputMode] = useState('searchable')
  const [existingMode, setExistingMode] = useState('auto') // auto = hybrid, redo = ignore native text
  const [state, setState] = useState('idle')
  const [errMsg, setErrMsg] = useState('')
  const [warnings, setWarnings] = useState([])
  const [extractedText, setExtractedText] = useState('')
  const [sidecarJson, setSidecarJson] = useState('')
  const [summary, setSummary] = useState(null)
  const [searchablePdfUrl, setSearchablePdfUrl] = useState(null)
  const [searchablePdfBytes, setSearchablePdfBytes] = useState(null)
  const [activeTab, setActiveTab] = useState('text')
  const [docConfidence, setDocConfidence] = useState(null)
  const [progress, setProgress] = useState(0)
  const [progMsg, setProgMsg] = useState('')
  const abortRef = useRef(false)

  const clearResults = useCallback(() => {
    setSearchablePdfUrl(null)
    setSearchablePdfBytes(null)
    setExtractedText('')
    setSidecarJson('')
    setSummary(null)
    setWarnings([])
    setDocConfidence(null)
    setErrMsg('')
    setState('idle')
    setProgress(0)
    setProgMsg('')
  }, [])

  // revoke the blob URL whenever it is replaced or the page unmounts
  useEffect(() => () => { if (searchablePdfUrl) { try { URL.revokeObjectURL(searchablePdfUrl) } catch (e) { /* ignore */ } } }, [searchablePdfUrl])

  const onDrop = useCallback(a => { clearResults(); setFile(a[0]) }, [clearResults])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 })

  const baseName = () => (file ? file.name.replace(/\.pdf$/i, '') : 'ocr')

  const apply = async () => {
    if (!file) return
    abortRef.current = false
    clearResults()
    setState('loading')

    try {
      setProgMsg('Loading PDF in browser…')
      const pdfjs = getPdfjs()
      const originalPdfBytes = new Uint8Array(await file.arrayBuffer())
      // clone: PDF.js transfers (detaches) the buffer it receives
      const pdfDoc = await pdfjs.getDocument({ data: originalPdfBytes.slice() }).promise
      const totalPages = pdfDoc.numPages

      const warn = []
      let engineInfo = null
      const ensureEngine = async () => {
        if (!engineInfo) {
          setProgMsg('Initializing OCR engine…')
          engineInfo = await getPaddleOCREngine(p => {
            setProgMsg(p.label || 'Loading neural models…')
          }, packForLanguage(language))
          if (engineInfo.fallback) warn.push(`Model pack "${engineInfo.requested}" not found. Used default model; ${language} text may be wrong.`)
        }
        return engineInfo.engine
      }

      const pages = []
      const scriptReport = { rerouted: 0, suspect: 0, suppressed: 0 }
      const codeReport = { added: 0, inferred: 0, reevaluated: 0 }
      let nativeOnlyPages = 0

      for (let p = 1; p <= totalPages; p++) {
        if (abortRef.current) break
        setProgress(Math.round(((p - 1) / totalPages) * 90))
        setProgMsg(`Reading page ${p} of ${totalPages}…`)

        const page = await pdfDoc.getPage(p)
        const viewport = page.getViewport({ scale: RENDER_SCALE })
        const width = Math.floor(viewport.width)
        const height = Math.floor(viewport.height)

        let nativeLines = []
        let imageRects = []
        let useOcr = true
        if (existingMode === 'auto' || existingMode === 'reuse') {
          const nl = await extractNativeLines(page, viewport, pdfjs)
          if (isNativeGood(nl)) {
            nativeLines = nl
            if (existingMode === 'reuse') {
              useOcr = false
            } else {
              imageRects = await getPageImageRects(page, viewport, pdfjs)
              useOcr = imageRects.length > 0
            }
          }
        }

        let ocrLines = []
        let redoneImageBytes = null
        if (useOcr) {
          const engine = await ensureEngine()
          setProgMsg(`Running OCR on page ${p} of ${totalPages}…`)
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          await page.render({ canvasContext: ctx, viewport }).promise
          const basePack = engineInfo.fallback ? 'default' : engineInfo.pack
          const rawOcr = await ocrRawLines(engine, ctx.getImageData(0, 0, width, height), { pack: basePack })
          await recoverLowConfidence(engine, canvas, rawOcr)
          // Per-region script routing: re-read suspect lines with every installed script pack; unreadable
          // / unsupported-script crops are flagged and kept out of the text layer (never Latin gibberish).
          setProgMsg(`Checking scripts on page ${p} of ${totalPages}…`)
          const rep = await routeScriptPacks(canvas, rawOcr, {
            basePack,
            hintPacks: [packForLanguage(language)],
            getEngine: async pk => {
              const r = await getPaddleOCREngine(null, pk)
              return r.fallback ? null : r.engine
            },
          })
          scriptReport.rerouted += rep.rerouted
          scriptReport.suspect += rep.suspect
          scriptReport.suppressed += rep.suppressed
          recoverLeadingSymbols(canvas, rawOcr)
          const cl = await recoverCodeClosers(engine, canvas, rawOcr)
          codeReport.added += cl.added; codeReport.inferred += cl.inferred; codeReport.reevaluated += cl.reevaluated
          // In Smart Hybrid mode over native text, retain OCR ONLY inside actual raster image regions
          // so valid multilingual native text is never overwritten or duplicated.
          if (existingMode === 'auto' && nativeLines.length > 0 && imageRects.length > 0) {
            ocrLines = rawOcr.filter(o => {
              const xs = (o.box || []).map(pt => pt[0]), ys = (o.box || []).map(pt => pt[1])
              if (!xs.length) return false
              const b = { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) }
              return imageRects.some(ir => overlap(b, { xMin: ir.xMin - 8, yMin: ir.yMin - 8, xMax: ir.xMax + 8, yMax: ir.yMax + 8 }).coverA >= 0.45)
            })
          } else {
            ocrLines = rawOcr
          }
          if (existingMode === 'redo' && outputMode === 'searchable') {
            const jpgBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92))
            if (jpgBlob) redoneImageBytes = new Uint8Array(await jpgBlob.arrayBuffer())
          }
          canvas.width = 0 // release bitmap memory
          canvas.height = 0
        } else nativeOnlyPages++
        page.cleanup()

        const result = buildPageResult({
          nativeLines, ocrLines, width, height,
          viewportTransform: viewport.transform, ocrSkipped: !useOcr, pageNumber: p, redoneImageBytes,
        })
        pages.push(result)
        await new Promise(r => setTimeout(r, 10)) // let the UI breathe
      }
      await pdfDoc.destroy()

      if (abortRef.current) { clearResults(); return }

      // DEFECT 02 / 13: Reconcile running headers & footers across all pages before rendering
      reconcileDocumentHeadersFooters(pages)
      const textChunks = pages.map((r, i) => `--- Page ${i + 1} ---\n${(r.text || '').trim() || '(No text detected)'}`)

      setExtractedText(textChunks.join('\n\n'))
      const ocrPages = pages.filter(r => !r.ocrSkipped)
      setDocConfidence(ocrPages.length
        ? Math.round((ocrPages.reduce((s, r) => s + r.avgConfidence, 0) / ocrPages.length) * 10) / 10
        : null)
      const sidecar = buildSidecar(pages, { source: file.name, language, mode: existingMode })
      setSidecarJson(JSON.stringify(sidecar, null, 2))
      const gates = sidecar.qualityGates || evaluateQualityGates(pages)
      if (scriptReport.rerouted) warn.push(`${scriptReport.rerouted} line(s) were re-read with a matching script pack.`)
      if (scriptReport.suspect) warn.push(`${scriptReport.suspect} line(s) look like a script no installed model reads well (${scriptReport.suppressed} left out of the PDF text layer). See the review queue in the JSON sidecar.`)
      if (codeReport.added || codeReport.reevaluated) warn.push(`Code: recovered ${codeReport.added} missing closing bracket line(s) (${codeReport.inferred} inferred, flagged for review) and re-read ${codeReport.reevaluated} line(s) at high resolution.`)
      if (gates.unbalancedCodeCount > 0) {
        warn.push(`${gates.unbalancedCodeCount} code block(s) had bracket mismatches — added to review queue in JSON sidecar.`)
      }
      const sum = {
        pages: totalPages,
        nativeOnlyPages,
        lowConf: pages.reduce((s, r) => s + r.lowConfidenceCount, 0),
        tables: pages.reduce((s, r) => s + r.tables.length, 0),
        fields: pages.reduce((s, r) => s + r.formFields.length, 0),
        reviewItems: gates.reviewQueue?.length || 0,
        gatesPassed: gates.passed,
        pagesData: pages,
      }

      const needsWrite = pages.some(r => r.lines.some(l => l.source !== 'native'))
      if (outputMode === 'searchable' && needsWrite) {
        setProgMsg('Writing invisible text layer…')
        setProgress(95)
        const { bytes, stats } = await buildSearchablePdf(originalPdfBytes, pages, pr => { if (pr?.label) setProgMsg(pr.label) })
        if (stats.skippedChars > 0) warn.push(`${stats.skippedChars} character(s) have no glyph in the embedded fonts and were left out of the PDF text layer (kept in the text view).`)
        if (stats.unmappedSamples?.length) warn.push(`No font glyph for ${stats.unmappedSamples.join(', ')}; add a covering font under /public/wasm/docx2pdf/fonts/.`)
        if (stats.missingFonts.length) warn.push(`Optional font file(s) not found: ${stats.missingFonts.join(', ')}. Add them under /public/wasm/docx2pdf/fonts/ to cover those scripts.`)
        setSearchablePdfBytes(bytes)
        setSearchablePdfUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })))
        setActiveTab('pdf')
        setProgMsg('Searchable PDF ready.')
      } else {
        if (outputMode === 'searchable') warn.push('Every page already had a text layer. No OCR layer was added, so nothing is duplicated.')
        setActiveTab('text')
        setProgMsg('Text extracted.')
      }
      setWarnings(warn)
      setSummary(sum)
      setProgress(100)
      setState('done')
    } catch (e) {
      console.error('OCR Error:', e)
      setErrMsg('OCR processing error: ' + (e.message || String(e)))
      setState('idle'); setProgress(0); setProgMsg('')
    }
  }

  const copyText = () => navigator.clipboard.writeText(extractedText)
  const downloadText = () => downloadBlob(new Blob([extractedText], { type: 'text/plain' }), baseName() + '.txt', 'text/plain')
  const downloadMarkdown = () => downloadBlob(new Blob([extractedText], { type: 'text/markdown' }), baseName() + '.md', 'text/markdown')
  const downloadJson = () => downloadBlob(new Blob([sidecarJson], { type: 'application/json' }), baseName() + '_ocr.json', 'application/json')
  const downloadDocx = async () => {
    if (!summary?.pagesData?.length) return
    const blob = await buildOcrDocxBlob(summary.pagesData, baseName())
    downloadBlob(blob, baseName() + '_ocr.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  }
  const downloadSearchablePdf = () => {
    if (searchablePdfBytes) downloadBlob(searchablePdfBytes, baseName() + '_searchable.pdf', 'application/pdf')
  }

  const hasResult = !!(extractedText || searchablePdfUrl)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar onBack={onBack} title="⌕ OCR PDF"
        subtitle="Make scanned PDFs searchable or extract text — entirely in your browser"
        dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory}
        onCategoryChange={onCategoryChange} search={search} onSearch={onSearch} />

      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 52px)', overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{ width: '340px', flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {!file ? (
            <div {...getRootProps()} style={{ background: isDragActive ? 'rgba(234,88,12,0.08)' : 'var(--bg2)', border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '12px', padding: '30px 20px', textAlign: 'center', cursor: 'pointer' }}>
              <input {...getInputProps()} />
              <Upload size={20} color="var(--accent2)" style={{ margin: '0 auto 10px', display: 'block' }} />
              <p style={{ color: 'var(--text)', fontWeight: 500, fontSize: '14px' }}>Drop PDF here</p>
              <p style={{ color: 'var(--text3)', fontSize: '12px', marginTop: '4px' }}>or click to browse</p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 }}>
                <FileText size={14} color="var(--brand)" style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
              </span>
              <button onClick={() => { clearResults(); setFile(null) }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }} aria-label="Remove file"><X size={14} /></button>
            </div>
          )}

          <Section title="Output Mode">
            <OptionButton active={outputMode === 'searchable'} onClick={() => setOutputMode('searchable')} icon={<Search size={14} />}
              label="Searchable PDF" desc="Keeps original look, adds invisible text layer" />
            <OptionButton active={outputMode === 'text'} onClick={() => setOutputMode('text')} icon={<FileText size={14} />}
              label="Text / Markdown / JSON" desc="Tables, lists, code kept. JSON has boxes and confidence" />
          </Section>

          <Section title="Existing Text In PDF">
            <OptionButton active={existingMode === 'auto'} onClick={() => setExistingMode('auto')} icon={<CheckCircle size={14} />}
              label="Smart Hybrid (recommended)" desc="Keep valid text; OCR only graphic/scanned regions. Zero duplicates" />
            <OptionButton active={existingMode === 'reuse'} onClick={() => setExistingMode('reuse')} icon={<FileText size={14} />}
              label="Reuse Existing Text" desc="Skip OCR completely when valid selectable text exists" />
            <OptionButton active={existingMode === 'redo'} onClick={() => setExistingMode('redo')} icon={<Search size={14} />}
              label="Re-OCR Everything" desc="Ignore existing text. Old invisible OCR layers are replaced" />
          </Section>

          <Section title="Document Language">
            <select value={language} onChange={e => setLanguage(e.target.value)}
              style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', outline: 'none', appearance: 'none', cursor: 'pointer' }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <p style={{ fontSize: '11px', color: 'var(--text3)' }}>Picks the recognizer model. Scripts need their pack installed, else default is used and you get a warning.</p>
          </Section>

          {errMsg && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'rgba(229,83,75,0.1)', border: '1px solid rgba(229,83,75,0.3)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: 'var(--red)', lineHeight: 1.5 }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {errMsg}
            </div>
          )}

          {warnings.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5 }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {w}
            </div>
          ))}

          {state === 'loading' && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text2)', fontWeight: 600 }}>{progMsg || 'Running OCR…'}</span>
                <span style={{ fontSize: '12px', color: 'var(--accent2)', fontWeight: 700 }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg3)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent2))', borderRadius: '3px', transition: 'width 0.5s ease' }} />
              </div>
              <button onClick={() => { abortRef.current = true }} style={{ ...ghostBtn, marginTop: '10px' }}>Cancel</button>
              <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '7px' }}>Processed in your browser. Nothing is uploaded.</p>
            </div>
          )}

          <button
            onClick={state === 'done' ? (searchablePdfBytes && outputMode === 'searchable' ? downloadSearchablePdf : downloadText) : apply}
            disabled={!file || state === 'loading'}
            style={{
              padding: '12px', background: state === 'done' ? 'var(--green)' : 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '10px', cursor: !file ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: state === 'done' ? '0 4px 16px rgba(34,197,94,0.3)' : '0 4px 16px rgba(234,88,12,0.25)',
              opacity: !file ? 0.5 : 1,
            }}>
            {state === 'loading'
              ? <><Loader2 size={15} className="spin" />Processing…</>
              : state === 'done'
                ? <><Download size={15} />{searchablePdfBytes && outputMode === 'searchable' ? 'Download Searchable PDF' : 'Download .txt'}</>
                : <><Search size={15} />Run OCR</>}
          </button>
        </div>

        {/* ── Right Panel ── */}
        <div style={{ flex: 1, background: 'var(--bg3)', display: 'flex', flexDirection: 'column', padding: hasResult ? '18px 24px' : '32px', overflowY: 'auto' }}>
          {hasResult ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg2)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  {searchablePdfUrl && (
                    <button onClick={() => setActiveTab('pdf')}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', background: activeTab === 'pdf' ? 'var(--accent)' : 'transparent', color: activeTab === 'pdf' ? '#fff' : 'var(--text2)' }}>
                      <Eye size={13} /> Searchable PDF Preview
                    </button>
                  )}
                  <button onClick={() => setActiveTab('text')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', background: activeTab === 'text' ? 'var(--accent)' : 'transparent', color: activeTab === 'text' ? '#fff' : 'var(--text2)' }}>
                    <FileText size={13} /> Extracted Text View
                  </button>
                  {docConfidence != null && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '20px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>
                      <CheckCircle size={12} /> {docConfidence}% Confidence
                    </span>
                  )}
                  {summary && (
                    <span style={{ fontSize: '11px', color: 'var(--text3)', marginLeft: '10px', paddingRight: '8px' }}>
                      {summary.nativeOnlyPages > 0 && `${summary.nativeOnlyPages} page(s) had real text · `}
                      {summary.lowConf > 0 && `${summary.lowConf} low-confidence line(s) flagged · `}
                      {summary.tables} table(s) · {summary.fields} form field(s)
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {searchablePdfBytes && (
                    <button onClick={downloadSearchablePdf}
                      style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 8px rgba(234,88,12,0.25)' }}>
                      <Download size={14} /> Searchable PDF
                    </button>
                  )}
                  <button onClick={copyText} style={ghostBtn}><Copy size={13} /> Copy</button>
                  <button onClick={downloadText} style={ghostBtn}><Download size={13} /> .txt</button>
                  <button onClick={downloadMarkdown} style={ghostBtn}><Download size={13} /> .md</button>
                  <button onClick={downloadDocx} style={ghostBtn}><Download size={13} /> .docx</button>
                  <button onClick={downloadJson} style={ghostBtn}><Download size={13} /> .json</button>
                </div>
              </div>

              {activeTab === 'pdf' && searchablePdfUrl ? (
                <div style={{ flex: 1, minHeight: '520px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <iframe src={searchablePdfUrl} title="Searchable PDF Preview"
                    style={{ width: '100%', height: '100%', minHeight: 'calc(100vh - 160px)', border: 'none' }} />
                </div>
              ) : (
                <textarea readOnly value={extractedText}
                  style={{ flex: 1, minHeight: 'calc(100vh - 160px)', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px', fontSize: '13px', lineHeight: 1.7, resize: 'none', outline: 'none', fontFamily: 'monospace' }} />
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text3)', margin: 'auto' }}>
              <div style={{ fontSize: '52px', marginBottom: '14px', opacity: 0.25 }}>⌕</div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text2)' }}>Upload a PDF to get started</p>
              <p style={{ fontSize: '13px', marginTop: '6px' }}>OCR runs in your browser. Files never leave your device.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
