import React, { useState, useRef, useCallback } from 'react'
import { Search, LayoutGrid, List, ShieldCheck, Server, Clock, Sparkles, Zap, ArrowUpRight } from 'lucide-react'
import TopBar from '../components/TopBar'
import SmartUpload from '../components/SmartUpload'
import { TOOLS, CATEGORIES, RUNS_LABEL } from '../utils/tools'

function ToolCard({ tool, onClick }) {
  const browser = tool.runs === 'browser'
  const cardRef = useRef(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, hover: false })

  const handleMouseMove = useCallback((e) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      hover: true,
    })
  }, [])

  return (
    <button
      ref={cardRef}
      className="tool-card saas-spotlight"
      onClick={() => onClick(tool.id, tool.category)}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setMousePos(p => ({ ...p, hover: true }))}
      onMouseLeave={() => setMousePos(p => ({ ...p, hover: false }))}
    >
      {/* Interactive Cursor Spotlight Glow */}
      <div
        className="saas-spotlight-layer"
        style={{
          opacity: mousePos.hover ? 1 : 0,
          background: `radial-gradient(260px circle at ${mousePos.x}px ${mousePos.y}px, var(--spotlight), transparent 75%)`,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 2 }}>
        <span className="tool-icon">
          <tool.icon size={17} />
        </span>
        <div className="tool-body" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {tool.label}
              {tool.multi && <span className="badge" style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', verticalAlign: 'middle' }}>Batch</span>}
            </span>
            <ArrowUpRight size={13} color="var(--text3)" style={{ opacity: mousePos.hover ? 1 : 0, transition: 'opacity 0.15s ease' }} />
          </div>
          <p className="tool-desc" style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, marginTop: 2 }}>
            {tool.desc}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', position: 'relative', zIndex: 2 }}>
        <span className={`badge ${browser ? 'badge-browser' : ''}`}>
          {browser ? <ShieldCheck size={11} /> : <Server size={11} />} {RUNS_LABEL[tool.runs]}
        </span>
      </div>
    </button>
  )
}

export default function Dashboard({ onSelectTool, onHistory, onGoHome }) {
  const [cat,         setCat]         = useState('all')
  const [q,           setQ]           = useState('')
  const [list,        setList]        = useState(false)
  const [browserOnly, setBrowserOnly] = useState(false)

  const s = q.trim().toLowerCase()
  const shown = TOOLS.filter(t =>
    (cat === 'all' || t.category === cat) &&
    (!browserOnly || t.runs === 'browser') &&
    (!s || (t.label + ' ' + t.desc).toLowerCase().includes(s)))
  const nBrowser = TOOLS.filter(t => t.runs === 'browser').length

  return (
    <>
      <TopBar
        title="PDFForge Workspace"
        extraRight={
          <button className="btn btn-ghost" onClick={onHistory}>
            <Clock size={14} />
            <span className="hide-sm">Recent files</span>
          </button>
        }
      />
      <div className="home">
        {/* ── Enterprise SaaS Hero ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '999px', marginBottom: 14 }}>
            <span className="live-dot" />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', letterSpacing: '-0.01em' }}>
              PDFForge 5.0 · Private Client-Side PDF Engine
            </span>
          </div>

          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, color: 'var(--text)' }}>
            The intelligent document workspace.
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text3)', margin: '10px 0 0', maxWidth: 620, lineHeight: 1.6 }}>
            Edit, convert, organize, and sign documents directly in your browser.
            Zero cloud uploads required for local operations.
          </p>
        </div>

        {/* ── Spotlight Smart Drop Zone ── */}
        <SmartUpload onSelectTool={onSelectTool} />

        {/* ── Privacy & Trust Banner ── */}
        <div style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '12px 16px',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          margin: '20px 0 28px',
          boxShadow: 'var(--shadow)'
        }}>
          <ShieldCheck size={18} color="var(--green)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{nBrowser} of {TOOLS.length} tools operate 100% client-side</strong> — your documents never touch any server. Heavy conversion tools process files securely in temporary sandbox sessions with immediate deletion.
          </div>
        </div>

        {/* ── Search & Filter Controls ── */}
        <div className="filter-bar">
          <div className="seg seg-categories" role="group" aria-label="Filter by category">
            {CATEGORIES.map(c => (
              <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                {c.label}
              </button>
            ))}
          </div>

          <div className="filter-bar-spacer" />

          <div className="filter-bar-actions">
            <button
              className="btn btn-ghost"
              aria-pressed={browserOnly}
              onClick={() => setBrowserOnly(b => !b)}
              style={browserOnly ? { borderColor: 'var(--brand)', color: 'var(--text)', background: 'var(--bg3)' } : undefined}
            >
              <ShieldCheck size={14} color={browserOnly ? 'var(--brand)' : undefined} /> Browser only
            </button>

            <label className="filter-search-label" style={{ flex: 1, minWidth: 120 }}>
              <Search size={14} color="var(--text3)" style={{ position: 'absolute', left: 10, pointerEvents: 'none' }} />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Filter tools…"
                aria-label="Filter tools"
                style={{ height: 34, paddingLeft: 30, width: '100%' }}
              />
            </label>

            <div className="seg" role="group" aria-label="Layout">
              <button aria-pressed={!list} aria-label="Grid view" onClick={() => setList(false)}>
                <LayoutGrid size={14} />
              </button>
              <button aria-pressed={list} aria-label="List view" onClick={() => setList(true)}>
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Tools Grid / List ── */}
        {shown.length === 0 ? (
          <div role="status" style={{ textAlign: 'center', padding: '56px 0', color: 'var(--text3)' }}>
            <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>No tools found matching "{q}"</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Try searching for convert, merge, compress, or sign.</p>
          </div>
        ) : (
          <div className={`tools-grid${list ? ' list' : ''}`}>
            {shown.map(t => (
              <ToolCard key={t.id} tool={t} onClick={onSelectTool} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}>
          <span>© PDFForge · Enterprise Document Infrastructure</span>
          <span>WebAssembly & Client-Side PDF Engine</span>
        </div>
      </div>
    </>
  )
}
