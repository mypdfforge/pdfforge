/**
 * SmartUpload.jsx
 * 21st.dev inspired Enterprise SaaS Drop Zone with dynamic cursor-tracking spotlight motion,
 * multi-file stacked card deck, client-side metadata analysis, and instant smart-routing.
 */
import React, { useState, useCallback, useRef } from 'react'
import {
  UploadCloud,
  FileText,
  Sparkles,
  ShieldCheck,
  Check,
  Loader2,
  Zap,
  ArrowRight,
  X,
  FileCheck,
  Plus,
  Trash2,
  Lock,
  Layers
} from 'lucide-react'
import { analyzeFile, analyzeMultipleFiles } from '../utils/fileAnalyzer'
import { toolById } from '../utils/tools'

export default function SmartUpload({ onSelectTool, onFilesReady }) {
  const [dragging,    setDragging]    = useState(false)
  const [analyzing,   setAnalyzing]   = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [metadata,    setMetadata]    = useState(null)
  const [files,       setFiles]       = useState([])
  const [mousePos,    setMousePos]    = useState({ x: -200, y: -200, active: false })
  const inputRef = useRef(null)
  const appendInputRef = useRef(null)
  const containerRef = useRef(null)

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMousePos(prev => ({ ...prev, active: false }))
  }, [])

  const processFiles = useCallback(async (arr) => {
    setFiles(arr)
    setAnalyzing(true)
    setSuggestions([])

    try {
      if (arr.length > 1) {
        const multiSug = analyzeMultipleFiles(arr)
        const { suggestions: singleSugs, metadata: meta } = await analyzeFile(arr[0])
        const all = multiSug ? [multiSug, ...singleSugs] : singleSugs
        setSuggestions(all.slice(0, 4))
        setMetadata(meta)
      } else if (arr.length === 1) {
        const { suggestions: sugs, metadata: meta } = await analyzeFile(arr[0])
        setSuggestions(sugs)
        setMetadata(meta)
      } else {
        setMetadata(null)
        setSuggestions([])
      }
    } catch (e) {
      console.warn('Analysis error', e)
    }
    setAnalyzing(false)

    // Pass files up so tool pages can receive them
    onFilesReady?.(arr)
  }, [onFilesReady])

  const handleInitialFiles = useCallback((fileList) => {
    const arr = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )
    if (!arr.length) return
    processFiles(arr)
  }, [processFiles])

  const handleAppendFiles = useCallback((fileList) => {
    const newArr = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )
    if (!newArr.length) return
    // Deduplicate by name and size
    const merged = [...files]
    for (const f of newArr) {
      if (!merged.some(existing => existing.name === f.name && existing.size === f.size)) {
        merged.push(f)
      }
    }
    processFiles(merged)
  }, [files, processFiles])

  const removeFile = useCallback((indexToRemove, e) => {
    e.stopPropagation()
    const nextFiles = files.filter((_, idx) => idx !== indexToRemove)
    if (nextFiles.length === 0) {
      clearFiles(e)
    } else {
      processFiles(nextFiles)
    }
  }, [files, processFiles])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    if (files.length > 0) {
      handleAppendFiles(e.dataTransfer.files)
    } else {
      handleInitialFiles(e.dataTransfer.files)
    }
  }, [files.length, handleAppendFiles, handleInitialFiles])

  const handleSuggestion = (sug) => {
    if (sug.isWorkflow) {
      onSelectTool?.(sug.id, 'enhance', files)
    } else {
      onSelectTool?.(sug.id, null, files)
    }
  }

  const clearFiles = (e) => {
    e?.stopPropagation()
    setFiles([])
    setMetadata(null)
    setSuggestions([])
    onFilesReady?.([])
    if (inputRef.current) inputRef.current.value = ''
    if (appendInputRef.current) appendInputRef.current.value = ''
  }

  const totalSizeMB = (files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* ── Drop Zone Container with Cursor Spotlight & 21st.dev Motion Border ── */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onDragEnter={e => { e.preventDefault(); setDragging(true) }}
        onDragOver={e  => { e.preventDefault(); setDragging(true) }}
        onDragLeave={e => { e.preventDefault(); setDragging(false) }}
        onDrop={onDrop}
        onClick={() => {
          if (files.length === 0) inputRef.current?.click()
        }}
        className="saas-spotlight"
        style={{
          border: dragging
            ? '2px dashed var(--brand)'
            : files.length > 0
              ? '1px solid var(--border2)'
              : '1px dashed var(--border2)',
          borderRadius: '20px',
          padding: files.length > 0 ? '30px 24px' : '48px 32px',
          textAlign: 'center',
          cursor: files.length === 0 ? 'pointer' : 'default',
          background: dragging
            ? 'var(--bg3)'
            : 'var(--bg2)',
          boxShadow: dragging
            ? '0 0 0 6px rgba(234,88,12,0.18), var(--shadow-lg)'
            : 'var(--shadow)',
          transform: dragging ? 'scale(1.008)' : 'none',
          transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Dynamic Cursor-Tracking Ambient Spotlight */}
        <div
          className="saas-spotlight-layer"
          style={{
            opacity: mousePos.active || dragging ? 1 : 0,
            background: `radial-gradient(460px circle at ${mousePos.x}px ${mousePos.y}px, var(--spotlight), transparent 75%)`,
            transition: 'opacity 0.25s ease',
          }}
        />

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleInitialFiles(e.target.files)}
        />

        <input
          ref={appendInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleAppendFiles(e.target.files)}
        />

        {analyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', position: 'relative', zIndex: 2, padding: '20px 0' }}>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Loader2 size={24} color="var(--brand)" className="spin" />
            </div>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                Inspecting document structure client-side…
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text3)', margin: '4px 0 0' }}>
                Analyzing text layers, encryption, pages, and workflow matches
              </p>
            </div>
          </div>
        ) : files.length > 0 ? (
          <div style={{ position: 'relative', zIndex: 2, textAlign: 'left' }}>
            {/* ── Multi-File Tray Header ── */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '14px',
              marginBottom: '16px',
              borderBottom: '1px solid var(--border)',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand)',
                }}>
                  {files.length > 1 ? <Layers size={18} /> : <FileCheck size={18} />}
                </span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
                    {files.length === 1 ? '1 Document Selected' : `${files.length} Documents in Deck`}
                  </h4>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text3)' }}>
                    {totalSizeMB} MB total • Processed 100% in browser
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => appendInputRef.current?.click()}
                  className="btn btn-secondary"
                  style={{
                    height: '30px',
                    padding: '0 12px',
                    fontSize: '12px',
                    gap: '5px',
                    borderRadius: '8px'
                  }}
                >
                  <Plus size={13} /> Add more
                </button>
                <button
                  type="button"
                  onClick={clearFiles}
                  className="btn btn-ghost"
                  style={{
                    height: '30px',
                    padding: '0 10px',
                    fontSize: '12px',
                    color: 'var(--red)',
                    gap: '5px',
                    borderRadius: '8px'
                  }}
                  title="Clear all files"
                >
                  <Trash2 size={13} /> Clear all
                </button>
              </div>
            </div>

            {/* ── 21st.dev Interactive File Deck Cards ── */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: files.length > 1 ? 'repeat(auto-fill, minmax(260px, 1fr))' : '1fr',
              gap: '10px',
              maxHeight: '260px',
              overflowY: 'auto',
              paddingRight: '4px',
            }}>
              {files.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    gap: '10px',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: 'var(--bg2)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--brand)',
                      flexShrink: 0
                    }}>
                      <FileText size={14} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{
                        margin: 0,
                        fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {file.name}
                      </p>
                      <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => removeFile(idx, e)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text3)',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                    title="Remove file"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* ── Metadata badges for single file inspection ── */}
            {metadata && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '14px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text3)', fontWeight: 500 }}>
                  Attributes:
                </span>
                {metadata.pageCount && (
                  <span className="badge">
                    <FileText size={11} /> {metadata.pageCount} {metadata.pageCount === 1 ? 'page' : 'pages'}
                  </span>
                )}
                {metadata.isResume && (
                  <span className="badge" style={{ color: 'var(--brand)', borderColor: 'var(--border2)' }}>
                    <Sparkles size={11} /> Resume Detected
                  </span>
                )}
                {metadata.isScanned && (
                  <span className="badge" style={{ color: 'var(--gold)', borderColor: 'var(--border2)' }}>
                    <FileText size={11} /> Scanned PDF
                  </span>
                )}
                {metadata.isInvoice && (
                  <span className="badge" style={{ color: 'var(--green)', borderColor: 'var(--border2)' }}>
                    <FileCheck size={11} /> Invoice Detected
                  </span>
                )}
                {metadata.isEncrypted && (
                  <span className="badge" style={{ color: 'var(--red)', borderColor: 'var(--border2)' }}>
                    <Lock size={11} /> Password Protected
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── Idle State (Hero Dropzone) ── */
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--brand)',
              margin: '0 auto 16px',
              transform: dragging ? 'scale(1.12)' : 'none',
              transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease',
              boxShadow: dragging ? '0 0 20px rgba(234,88,12,0.25)' : 'none',
            }}>
              <UploadCloud size={28} />
            </div>

            <p style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
              {dragging ? 'Release to drop your PDF right here' : 'Drop your PDF here, or click to browse'}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text3)', maxWidth: '440px', margin: '0 auto 20px', lineHeight: 1.5 }}>
              Batch selection supported. We automatically analyze page counts, text layers, and suggest the fastest workflows.
            </p>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {[
                { label: 'Client-side processing', icon: ShieldCheck },
                { label: 'Multi-file deck support', icon: Layers },
                { label: 'No watermark or limits', icon: Sparkles },
              ].map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="badge"
                  style={{
                    background: 'var(--bg3)',
                    color: 'var(--text2)',
                    borderColor: 'var(--border)',
                    fontSize: '11px',
                    padding: '4px 10px',
                    height: 'auto',
                    borderRadius: '8px'
                  }}
                >
                  <Icon size={12} color="var(--brand)" /> {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Recommended Suggestions Bar ── */}
      {suggestions.length > 0 && !analyzing && (
        <div style={{ marginTop: '24px' }} className="fade-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              color: 'var(--brand)',
              background: 'var(--bg3)',
              border: '1px solid var(--border2)',
              borderRadius: '999px',
              padding: '4px 12px',
            }}>
              <Sparkles size={12} /> Instant Recommended Actions
            </span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '12px',
          }}>
            {suggestions.map((sug, i) => (
              <SuggestionCard
                key={sug.id + i}
                sug={sug}
                onClick={() => handleSuggestion(sug)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ sug, onClick }) {
  const [coords, setCoords] = useState({ x: 0, y: 0, hover: false })
  const cardRef = useRef(null)
  const tool = toolById(sug.id)
  const IconComponent = tool?.icon || Sparkles

  const onMouseMove = (e) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      hover: true,
    })
  }

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setCoords(c => ({ ...c, hover: true }))}
      onMouseLeave={() => setCoords(c => ({ ...c, hover: false }))}
      className="saas-spotlight"
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
        transform: coords.hover ? 'translateY(-2px)' : 'none',
        boxShadow: coords.hover ? 'var(--shadow-lg)' : 'var(--shadow)',
        borderColor: coords.hover ? 'var(--border2)' : 'var(--border)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        className="saas-spotlight-layer"
        style={{
          opacity: coords.hover ? 1 : 0,
          background: `radial-gradient(220px circle at ${coords.x}px ${coords.y}px, var(--spotlight), transparent 75%)`,
        }}
      />

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span className="tool-icon" style={{ width: '30px', height: '30px', borderRadius: '7px' }}>
            <IconComponent size={15} />
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            {sug.title}
          </span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text3)', lineHeight: 1.5, margin: 0 }}>
          {sug.reason}
        </p>
      </div>

      <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
        {sug.isWorkflow ? (
          <span className="badge" style={{ color: 'var(--brand)', borderColor: 'var(--border2)', fontSize: '10px' }}>
            <Zap size={10} /> Fast workflow
          </span>
        ) : (
          <span />
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: 600, color: 'var(--brand)' }}>
          Launch <ArrowRight size={11} />
        </span>
      </div>
    </div>
  )
}
