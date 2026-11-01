import React, { useState, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import TopBar from '../components/TopBar'
import {
  Upload, Link, Globe, Monitor, Tablet, Smartphone,
  Download, Loader2, CheckCircle, AlertCircle, RefreshCw,
  ZoomIn, ZoomOut, FileCode, ArrowRight, ArrowLeft, X,
  FileText
} from 'lucide-react'
import { htmlToPdf } from '../utils/convertClient'
import { downloadBlob } from '../utils/api'

const VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1280, icon: Monitor },
  { id: 'tablet',  label: 'Tablet',  width: 768,  icon: Tablet },
  { id: 'mobile',  label: 'Mobile',  width: 375,  icon: Smartphone },
]

const FORMATS = [
  { id: 'a4',     label: 'A4',     desc: 'Standard (210×297mm)' },
  { id: 'letter', label: 'Letter', desc: 'US Letter (8.5×11in)' },
  { id: 'single', label: 'Single Page', desc: 'Continuous Full Webpage' },
]

const MARGINS = [
  { id: 0,  label: 'None',   val: 0 },
  { id: 10, label: 'Small',  val: 10 },
  { id: 15, label: 'Normal', val: 15 },
]

function Section({ title, children }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    }}>
      {title && (
        <p style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.07em',
          textTransform: 'uppercase',
          color: 'var(--text3)',
          margin: 0,
        }}>{title}</p>
      )}
      {children}
    </div>
  )
}

export default function HtmlToPdfPage({ tool, onBack, pendingFiles }) {
  // Navigation view: 'initial' | 'studio'
  const [viewMode, setViewMode] = useState('initial')

  // File upload state (Path A)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [fileConverting, setFileConverting] = useState(false)
  const [fileProgress, setFileProgress] = useState(0)
  const [fileDownloadResult, setFileDownloadResult] = useState(null)
  const [fileError, setFileError] = useState('')

  // URL state (Path B)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [studioUrlName, setStudioUrlName] = useState('webpage.pdf')

  // Studio Options
  const [viewport, setViewport]       = useState('desktop')
  const [format, setFormat]           = useState('a4')
  const [orientation, setOrientation] = useState('portrait')
  const [margin, setMargin]           = useState(0)
  const [mediaMode, setMediaMode]     = useState('screen')
  
  // Studio Preview state
  const [zoom, setZoom]                 = useState(0.8)
  const [studioFetching, setStudioFetching] = useState(false)
  const [studioConverting, setStudioConverting] = useState(false)
  const [studioProgress, setStudioProgress] = useState(0)
  const [studioError, setStudioError]   = useState('')
  const [studioSuccess, setStudioSuccess] = useState(false)
  const [previewKey, setPreviewKey]     = useState(0)

  const previewFrameRef = useRef(null)

  // Handle incoming pending files from Home
  useEffect(() => {
    if (pendingFiles && pendingFiles.length > 0) {
      const f = pendingFiles[0]
      if (f.name.match(/\.html?$/i) || f.type.includes('html')) {
        setUploadedFile(f)
        setViewMode('initial')
      }
    }
  }, [pendingFiles])

  // Dropzone for File Upload (Path A)
  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    accept: { 'text/html': ['.html', '.htm'] },
    multiple: false,
    noClick: false,
    onDrop: (accepted) => {
      if (accepted.length > 0) {
        setUploadedFile(accepted[0])
        setFileError('')
        setFileDownloadResult(null)
      }
    }
  })

  // Convert uploaded local HTML file directly (just like before)
  const handleConvertFile = async () => {
    if (!uploadedFile) return
    setFileConverting(true)
    setFileError('')
    setFileProgress(5)

    try {
      const outName = uploadedFile.name.replace(/\.html?$/i, '') + '.pdf'
      const res = await htmlToPdf(uploadedFile, (p) => {
        if (p && p.total) {
          setFileProgress(Math.round((p.done / p.total) * 100))
        }
      })

      if (res && res.data) {
        downloadBlob(res.data, outName)
        setFileDownloadResult({ blob: res.data, name: outName, originalSize: uploadedFile.size })
      } else {
        throw new Error('Conversion generated no output data.')
      }
    } catch (err) {
      console.error(err)
      setFileError(err.message || 'Failed to convert HTML file.')
    } finally {
      setFileConverting(false)
      setFileProgress(0)
    }
  }

  // Fetch URL and transition to Studio View (Path B)
  const handleConvertUrl = async (e) => {
    e?.preventDefault()
    let raw = urlInput.trim()
    if (!raw) {
      setUrlError('Please enter a valid URL.')
      return
    }
    if (!/^https?:\/\//i.test(raw)) {
      raw = 'https://' + raw
      setUrlInput(raw)
    }

    setUrlError('')
    setStudioFetching(true)
    setViewMode('studio')
    setStudioError('')

    try {
      let fetchedHtml = ''
      let finalUrl = raw

      // Direct fetch
      try {
        const res = await fetch(raw, { mode: 'cors' })
        if (res.ok) {
          const t = await res.text()
          if (t && t.length > 100) fetchedHtml = t
        }
      } catch (_) {}

      // CORS Proxies
      if (!fetchedHtml) {
        const proxies = [
          `https://api.allorigins.win/raw?url=${encodeURIComponent(raw)}`,
          `https://corsproxy.io/?url=${encodeURIComponent(raw)}`,
        ]

        for (const proxy of proxies) {
          try {
            const res = await fetch(proxy)
            if (res.ok) {
              const t = await res.text()
              if (t && t.length > 100) {
                fetchedHtml = t
                break
              }
            }
          } catch (_) {}
        }
      }

      if (!fetchedHtml) {
        throw new Error('Unable to retrieve webpage HTML. The server may require authentication or blocked requests.')
      }

      setHtmlContent(fetchedHtml)
      setLoadedUrl(finalUrl)

      try {
        const u = new URL(finalUrl)
        setStudioUrlName(`${u.hostname.replace(/[^a-z0-9]/gi, '_')}.pdf`)
      } catch (_) {
        setStudioUrlName('webpage.pdf')
      }

      setPreviewKey(k => k + 1)
    } catch (err) {
      setStudioError(err.message || 'Failed to load webpage.')
    } finally {
      setStudioFetching(false)
    }
  }

  // Update Studio Live Preview Frame
  const currentViewport = VIEWPORTS.find(v => v.id === viewport) || VIEWPORTS[0]
  const targetWidth = currentViewport.width

  useEffect(() => {
    if (viewMode !== 'studio' || !previewFrameRef.current || !htmlContent) return

    const iframe = previewFrameRef.current
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return

    let renderHtml = htmlContent
    const baseTag = loadedUrl ? `<base href="${loadedUrl}">` : ''
    const mediaCss = mediaMode === 'print'
      ? `@media screen { body { background: #fff !important; } }`
      : ''

    const previewResetCss = `
      <style id="pdfforge-preview-style">
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          width: ${targetWidth}px !important;
          overflow-x: hidden !important;
        }
        ${mediaCss}
      </style>
    `

    if (/<head[^>]*>/i.test(renderHtml)) {
      renderHtml = renderHtml.replace(/(<head[^>]*>)/i, `$1${baseTag}${previewResetCss}`)
    } else {
      renderHtml = `<head>${baseTag}${previewResetCss}</head>${renderHtml}`
    }

    doc.open()
    doc.write(renderHtml)
    doc.close()
  }, [viewMode, htmlContent, loadedUrl, targetWidth, mediaMode, previewKey])

  // Convert from Studio view
  const handleStudioConvert = async () => {
    if (!htmlContent) return
    setStudioConverting(true)
    setStudioError('')
    setStudioSuccess(false)
    setStudioProgress(5)

    try {
      const result = await htmlToPdf(
        htmlContent,
        (p) => {
          if (p && p.total) {
            setStudioProgress(Math.round((p.done / p.total) * 100))
          }
        },
        {
          viewportWidth: targetWidth,
          orientation,
          format,
          margin,
          mediaType: mediaMode,
          baseUrl: loadedUrl,
        }
      )

      if (result && result.data) {
        downloadBlob(result.data, studioUrlName)
        setStudioSuccess(true)
        setTimeout(() => setStudioSuccess(false), 4000)
      } else {
        throw new Error('PDF conversion returned no data.')
      }
    } catch (err) {
      console.error(err)
      setStudioError(err.message || 'Failed to convert HTML to PDF.')
    } finally {
      setStudioConverting(false)
      setStudioProgress(0)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW A: Success panel after file conversion (just like before)
  // ─────────────────────────────────────────────────────────────────────────────
  if (viewMode === 'initial' && fileDownloadResult) {
    const fmt = (b) => b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        <TopBar onBack={onBack} title={tool?.label || 'HTML to PDF'} subtitle={tool?.desc} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '16px', padding: '40px', maxWidth: '480px', width: '100%', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(21,128,61,0.12)', border: '2px solid var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <CheckCircle size={28} color="var(--green)" />
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>
              Done! File downloaded.
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '24px' }}>
              {fileDownloadResult.name} ({fmt(fileDownloadResult.blob.size)})
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => downloadBlob(fileDownloadResult.blob, fileDownloadResult.name)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: '9px', padding: '10px 20px', cursor: 'pointer' }}
              >
                <Download size={14} /> Download Again
              </button>
              <button
                onClick={() => {
                  setFileDownloadResult(null)
                  setUploadedFile(null)
                  setFileError('')
                }}
                style={{ fontSize: '13px', color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '9px', padding: '10px 20px', cursor: 'pointer' }}
              >
                Convert Another
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW B: Studio View (Live Preview on right + Options on left)
  // ─────────────────────────────────────────────────────────────────────────────
  if (viewMode === 'studio') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
        <TopBar
          title={tool?.label || 'HTML to PDF'}
          subtitle="Live Webpage Conversion Studio"
          onBack={() => setViewMode('initial')}
        />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          
          {/* ── Left Sidebar (Options & Conversion) ── */}
          <div style={{
            width: '350px',
            minWidth: '330px',
            background: 'var(--bg2)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px',
            gap: '12px',
            overflowY: 'auto',
          }}>
            {/* Back to main tool page */}
            <button
              onClick={() => setViewMode('initial')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                padding: '0 0 4px',
                fontWeight: 600,
              }}
            >
              <ArrowLeft size={14} /> Back to Upload
            </button>

            {/* Current URL Bar */}
            <form onSubmit={handleConvertUrl} style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com"
                style={{
                  flex: 1,
                  background: 'var(--bg3)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  padding: '7px 9px',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={studioFetching}
                style={{
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  padding: '0 10px',
                  cursor: 'pointer',
                  color: 'var(--text2)',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Reload URL"
              >
                {studioFetching ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
              </button>
            </form>

            {/* Viewport Selection */}
            <Section title="Screen Viewport">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {VIEWPORTS.map(vp => {
                  const Icon = vp.icon
                  const isSelected = viewport === vp.id
                  return (
                    <button
                      key={vp.id}
                      onClick={() => setViewport(vp.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '8px 4px',
                        borderRadius: '8px',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(234,88,12,0.15)' : 'var(--bg3)',
                        color: isSelected ? 'var(--accent2)' : 'var(--text2)',
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                      }}
                    >
                      <Icon size={15} />
                      <span style={{ fontSize: '11px', fontWeight: 700 }}>{vp.label}</span>
                      <span style={{ fontSize: '9px', color: 'var(--text3)' }}>{vp.width}px</span>
                    </button>
                  )
                })}
              </div>
            </Section>

            {/* Format & Orientation */}
            <Section title="Page Format">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {FORMATS.map(f => {
                  const isSelected = format === f.id
                  return (
                    <button
                      key={f.id}
                      onClick={() => setFormat(f.id)}
                      style={{
                        padding: '7px 4px',
                        borderRadius: '7px',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(234,88,12,0.15)' : 'var(--bg3)',
                        color: isSelected ? 'var(--accent2)' : 'var(--text2)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 700,
                        textAlign: 'center',
                      }}
                      title={f.desc}
                    >
                      {f.label}
                    </button>
                  )
                })}
              </div>

              {format !== 'single' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                  {['portrait', 'landscape'].map(o => (
                    <button
                      key={o}
                      onClick={() => setOrientation(o)}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        border: `1px solid ${orientation === o ? 'var(--accent)' : 'var(--border)'}`,
                        background: orientation === o ? 'rgba(234,88,12,0.15)' : 'var(--bg3)',
                        color: orientation === o ? 'var(--accent2)' : 'var(--text2)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'capitalize',
                      }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {/* Margins */}
            <Section title="Page Margins">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {MARGINS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMargin(m.val)}
                    style={{
                      padding: '6px 4px',
                      borderRadius: '6px',
                      border: `1px solid ${margin === m.val ? 'var(--accent)' : 'var(--border)'}`,
                      background: margin === m.val ? 'rgba(234,88,12,0.15)' : 'var(--bg3)',
                      color: margin === m.val ? 'var(--accent2)' : 'var(--text2)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {m.label} ({m.val}mm)
                  </button>
                ))}
              </div>
            </Section>

            {/* Media Mode */}
            <Section title="Rendering Style">
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { id: 'screen', label: 'Screen CSS' },
                  { id: 'print',  label: 'Print CSS' },
                ].map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => setMediaMode(mode.id)}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '6px',
                      border: `1px solid ${mediaMode === mode.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: mediaMode === mode.id ? 'rgba(234,88,12,0.15)' : 'var(--bg3)',
                      color: mediaMode === mode.id ? 'var(--accent2)' : 'var(--text2)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </Section>

            {/* Studio Error Message */}
            {studioError && (
              <div style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '11px',
                color: '#ef4444',
                display: 'flex',
                gap: '6px',
              }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{studioError}</span>
              </div>
            )}

            {/* Convert to PDF button */}
            <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
              <button
                onClick={handleStudioConvert}
                disabled={studioConverting || !htmlContent}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: studioSuccess ? 'var(--green)' : studioConverting ? 'var(--bg3)' : 'var(--accent)',
                  color: studioConverting ? 'var(--text2)' : '#fff',
                  border: 'none',
                  borderRadius: '9px',
                  cursor: studioConverting || !htmlContent ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: '13.5px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                  boxShadow: '0 4px 16px rgba(234,88,12,0.25)',
                  opacity: !htmlContent ? 0.5 : 1,
                }}
              >
                {studioConverting ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    Converting {studioProgress > 0 ? `${studioProgress}%` : '...'}
                  </>
                ) : studioSuccess ? (
                  <>
                    <CheckCircle size={15} /> Downloaded PDF!
                  </>
                ) : (
                  <>
                    <Download size={15} /> Convert to PDF
                  </>
                )}
              </button>
              <p style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text3)', margin: '5px 0 0' }}>
                100% on-device &bull; zero server upload
              </p>
            </div>
          </div>

          {/* ── Right Panel (Live Preview) ── */}
          <div style={{
            flex: 1,
            background: 'var(--bg3)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Preview Toolbar */}
            <div style={{
              height: '42px',
              background: 'var(--bg2)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text2)' }}>
                  Live Web Preview
                </span>
                {loadedUrl && (
                  <span style={{
                    fontSize: '10.5px',
                    color: 'var(--text3)',
                    background: 'var(--bg3)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    maxWidth: '300px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {loadedUrl}
                  </span>
                )}
              </div>

              {/* Zoom Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <button
                  onClick={() => setZoom(z => Math.max(0.3, Number((z - 0.1).toFixed(1))))}
                  style={{
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    borderRadius: '5px', padding: '3px 6px', cursor: 'pointer',
                    color: 'var(--text2)', display: 'flex', alignItems: 'center',
                  }}
                  title="Zoom Out"
                >
                  <ZoomOut size={12} />
                </button>
                <span style={{ fontSize: '11px', color: 'var(--text3)', width: '34px', textAlign: 'center', fontWeight: 600 }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(z => Math.min(1.5, Number((z + 0.1).toFixed(1))))}
                  style={{
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    borderRadius: '5px', padding: '3px 6px', cursor: 'pointer',
                    color: 'var(--text2)', display: 'flex', alignItems: 'center',
                  }}
                  title="Zoom In"
                >
                  <ZoomIn size={12} />
                </button>
                <button
                  onClick={() => setZoom(0.8)}
                  style={{
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    borderRadius: '5px', padding: '3px 7px', cursor: 'pointer',
                    color: 'var(--text3)', fontSize: '11px', fontWeight: 600,
                  }}
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Preview Frame Container */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              padding: '24px',
              overflow: 'auto',
            }}>
              {studioFetching ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text3)' }}>
                  <Loader2 size={32} color="var(--accent)" className="spin" style={{ margin: '0 auto 10px' }} />
                  <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text2)' }}>Loading webpage…</p>
                </div>
              ) : !htmlContent ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text3)' }}>
                  <Globe size={40} style={{ opacity: 0.25, margin: '0 auto 10px' }} />
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>Enter a URL to see the live preview</p>
                </div>
              ) : (
                <div style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.15s ease-out',
                  boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
                  borderRadius: '8px',
                  background: '#fff',
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  width: `${targetWidth}px`,
                }}>
                  {/* Browser Mockup Bar */}
                  <div style={{
                    height: '30px',
                    background: '#f1f5f9',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 10px',
                    gap: '5px',
                  }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444' }} />
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#f59e0b' }} />
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }} />
                    <div style={{
                      flex: 1,
                      background: '#fff',
                      borderRadius: '4px',
                      height: '18px',
                      margin: '0 8px',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 8px',
                      fontSize: '10px',
                      color: '#64748b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      border: '1px solid #e2e8f0',
                    }}>
                      {loadedUrl}
                    </div>
                  </div>

                  <iframe
                    ref={previewFrameRef}
                    title="Live Web Preview"
                    sandbox="allow-same-origin allow-scripts"
                    style={{
                      width: `${targetWidth}px`,
                      height: '840px',
                      border: 'none',
                      display: 'block',
                      background: '#fff',
                    }}
                  />
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW C: Initial Clean Tool View (Two options in middle, exactly as requested)
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        onBack={onBack}
        title={tool?.label || 'HTML to PDF'}
        subtitle={tool?.desc || 'Convert HTML file or webpage to PDF.'}
      />

      <div style={{
        maxWidth: '560px',
        margin: '36px auto',
        padding: '0 24px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}>

        {/* ── 1. Upload a File Section (Direct Convert just like before) ── */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCode size={18} color="var(--accent)" />
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              Convert Local HTML File
            </span>
          </div>

          <div
            {...getRootProps()}
            style={{
              background: isDragActive ? 'rgba(234,88,12,0.06)' : 'var(--bg3)',
              border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '10px',
              padding: '26px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={22} color="var(--accent)" style={{ display: 'block', margin: '0 auto 8px' }} />
            {isDragActive ? (
              <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '13px', margin: 0 }}>
                Drop the HTML file here!
              </p>
            ) : (
              <>
                <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '13px', margin: '0 0 4px' }}>
                  Drop an HTML file or <span style={{ color: 'var(--accent2)' }}>browse</span>
                </p>
                <p style={{ color: 'var(--text3)', fontSize: '11px', margin: 0 }}>
                  Supports .html and .htm files &bull; 100% on-device
                </p>
              </>
            )}
          </div>

          {/* Uploaded File Selected State */}
          {uploadedFile && (
            <div style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <FileText size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadedFile.name}</span>
                <span style={{ fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>({(uploadedFile.size / 1024).toFixed(0)} KB)</span>
              </span>
              <button
                onClick={() => setUploadedFile(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                title="Remove file"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {fileError && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#ef4444',
              display: 'flex',
              gap: '6px',
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{fileError}</span>
            </div>
          )}

          {/* Convert File Button */}
          {uploadedFile && (
            <button
              onClick={handleConvertFile}
              disabled={fileConverting}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: '9px',
                padding: '12px',
                fontSize: '13.5px',
                fontWeight: 700,
                cursor: fileConverting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 14px rgba(234,88,12,0.25)',
              }}
            >
              {fileConverting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Converting to PDF {fileProgress > 0 ? `(${fileProgress}%)` : '...'}
                </>
              ) : (
                <>
                  <Download size={16} />
                  Convert to PDF
                </>
              )}
            </button>
          )}
        </div>

        {/* ── Visual Divider ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '2px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            or
          </span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        </div>

        {/* ── 2. Paste a URL Section (Opens Studio View) ── */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={18} color="var(--accent)" />
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              Paste a Webpage URL
            </span>
          </div>

          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text3)', lineHeight: 1.45 }}>
            Convert any live webpage with interactive preview, viewport switching, margins, and paper sizing.
          </p>

          <form onSubmit={handleConvertUrl} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com/article"
                style={{
                  flex: 1,
                  background: 'var(--bg3)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '9px',
                  padding: '11px 12px',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9px',
                  padding: '0 18px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 14px rgba(234,88,12,0.25)',
                  whiteSpace: 'nowrap',
                }}
              >
                Convert URL <ArrowRight size={14} />
              </button>
            </div>
            {urlError && (
              <span style={{ fontSize: '11px', color: '#ef4444' }}>{urlError}</span>
            )}
          </form>
        </div>

      </div>
    </div>
  )
}
