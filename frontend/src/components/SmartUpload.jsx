/**
 * SmartUpload.jsx
 * Enterprise SaaS Drop Zone with dynamic cursor-tracking spotlight motion.
 * Client-side analysis, instant tool recommendation, zero telemetry.
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
  FileCheck
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

  const handleFiles = useCallback(async (fileList) => {
    const arr = Array.from(fileList).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )
    if (!arr.length) return

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
      } else {
        const { suggestions: sugs, metadata: meta } = await analyzeFile(arr[0])
        setSuggestions(sugs)
        setMetadata(meta)
      }
    } catch (e) {
      console.warn('Analysis error', e)
    }
    setAnalyzing(false)

    // Pass files up so tool pages can receive them
    onFilesReady?.(arr)
  }, [onFilesReady])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleSuggestion = (sug) => {
    if (sug.isWorkflow) {
      onSelectTool?.(sug.id, 'enhance', files)
    } else {
      onSelectTool?.(sug.id, null, files)
    }
  }

  const clearFiles = (e) => {
    e.stopPropagation()
    setFiles([])
    setMetadata(null)
    setSuggestions([])
    onFilesReady?.([])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* ── Drop Zone Container with Cursor Spotlight ── */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onDragEnter={e => { e.preventDefault(); setDragging(true) }}
        onDragOver={e  => { e.preventDefault(); setDragging(true) }}
        onDragLeave={e => { e.preventDefault(); setDragging(false) }}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="saas-spotlight"
        style={{
          border: dragging
            ? '2px solid var(--brand)'
            : '1px solid var(--border)',
          borderRadius: '16px',
          padding: files.length > 0 ? '36px 28px' : '44px 32px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging
            ? 'var(--bg3)'
            : 'var(--bg2)',
          boxShadow: dragging
            ? '0 0 0 4px rgba(234,88,12,0.18), var(--shadow-lg)'
            : 'var(--shadow)',
          transform: dragging ? 'scale(1.008)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Dynamic Cursor-Tracking Ambient Spotlight */}
        <div
          className="saas-spotlight-layer"
          style={{
            opacity: mousePos.active || dragging ? 1 : 0,
            background: `radial-gradient(420px circle at ${mousePos.x}px ${mousePos.y}px, var(--spotlight), transparent 75%)`,
            transition: 'opacity 0.25s ease',
          }}
        />

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />

        {analyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', position: 'relative', zIndex: 2 }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Loader2 size={22} color="var(--brand)" className="spin" />
            </div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: 0 }}>
              Analyzing document structure…
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text3)', margin: 0 }}>
              Inspecting pages, text layers, and optimal tools client-side
            </p>
          </div>
        ) : files.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', position: 'relative', zIndex: 2 }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--brand)',
            }}>
              <FileCheck size={26} />
            </div>

            <div style={{ maxWidth: '90%' }}>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {files.length === 1 ? files[0].name : `${files.length} documents selected`}
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text3)', margin: '4px 0 0' }}>
                {(files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB total
              </p>
            </div>

            {metadata && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '2px' }}>
                {metadata.pageCount && (
                  <span className="badge">
                    <FileText size={11} /> {metadata.pageCount} {metadata.pageCount === 1 ? 'page' : 'pages'}
                  </span>
                )}
                {metadata.isResume && (
                  <span className="badge" style={{ color: 'var(--brand)', borderColor: 'var(--border2)' }}>
                    <Sparkles size={11} /> Resume
                  </span>
                )}
                {metadata.isScanned && (
                  <span className="badge" style={{ color: 'var(--gold)', borderColor: 'var(--border2)' }}>
                    <FileText size={11} /> Scanned
                  </span>
                )}
                {metadata.isInvoice && (
                  <span className="badge" style={{ color: 'var(--green)', borderColor: 'var(--border2)' }}>
                    <FileCheck size={11} /> Invoice
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text3)' }}>
                Click to choose another file, or
              </span>
              <button
                type="button"
                onClick={clearFiles}
                className="btn btn-ghost"
                style={{ height: '26px', padding: '0 8px', fontSize: '11px', gap: '4px' }}
              >
                <X size={12} /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--brand)',
              margin: '0 auto 14px',
              transition: 'transform 0.2s ease, border-color 0.2s ease',
            }}
            className={dragging ? 'scale-in' : ''}
            >
              <UploadCloud size={26} />
            </div>

            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
              {dragging ? 'Drop your PDF right here' : 'Drop your PDF here, or click to browse'}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '18px', maxWidth: '420px', margin: '0 auto 18px' }}>
              We'll inspect page count, text layers, and recommend the best tools automatically.
            </p>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {[
                { label: 'No account required', icon: Check },
                { label: 'Runs client-side in browser', icon: ShieldCheck },
                { label: 'Zero watermarks', icon: Sparkles },
              ].map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="badge"
                  style={{
                    background: 'var(--bg3)',
                    color: 'var(--text2)',
                    borderColor: 'var(--border)',
                    fontSize: '11px',
                    padding: '3px 10px',
                    height: 'auto',
                  }}
                >
                  <Icon size={12} color="var(--green)" /> {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Recommended Suggestions Bar ── */}
      {suggestions.length > 0 && !analyzing && (
        <div style={{ marginTop: '22px' }} className="fade-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
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
              padding: '3px 12px',
            }}>
              <Sparkles size={12} /> Recommended actions
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
