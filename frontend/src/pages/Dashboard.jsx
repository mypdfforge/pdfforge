import React, { useState } from 'react'
import { Search, LayoutGrid, List, ShieldCheck, Server, Clock } from 'lucide-react'
import TopBar from '../components/TopBar'
import SmartUpload from '../components/SmartUpload'
import { TOOLS, CATEGORIES, RUNS_LABEL } from '../utils/tools'

function ToolCard({ tool, onClick }) {
  const browser = tool.runs === 'browser'
  return (
    <button className="tool-card" onClick={() => onClick(tool.id, tool.category)}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <span className="tool-icon"><tool.icon size={17}/></span>
        <div className="tool-body" style={{ minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{tool.label}</div>
          <p className="tool-desc" style={{ fontSize:12, color:'var(--text3)', lineHeight:1.5, marginTop:2 }}>{tool.desc}</p>
        </div>
      </div>
      <span className={`badge ${browser ? 'badge-browser' : ''}`} style={{ alignSelf:'flex-start' }}>
        {browser ? <ShieldCheck size={11}/> : <Server size={11}/>} {RUNS_LABEL[tool.runs]}
      </span>
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
      <TopBar title="All tools" extraRight={
        <button className="btn btn-ghost" onClick={onHistory}><Clock size={14}/><span className="hide-sm">Recent files</span></button>
      }/>
      <div className="home">
        <h1 style={{ fontSize:28, fontWeight:700, letterSpacing:'-0.02em', lineHeight:1.2 }}>Everything you need to work with PDFs.</h1>
        <p style={{ fontSize:15, color:'var(--text3)', margin:'8px 0 20px', maxWidth:560, lineHeight:1.6 }}>
          Edit, organize, convert, and optimize your documents in one simple workspace.
        </p>

        <SmartUpload onSelectTool={onSelectTool}/>

        <p style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:13, color:'var(--text3)', margin:'16px 0 28px', lineHeight:1.6 }}>
          <ShieldCheck size={16} color="var(--green)" style={{ flexShrink:0, marginTop:2 }}/>
          <span><strong style={{ color:'var(--text2)' }}>{nBrowser} of {TOOLS.length} tools run entirely in your browser</strong> — the file never leaves your device. The rest upload the file to our server to process it (up to 50 MB). Each tool is labelled.</span>
        </p>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
          <div className="seg" role="group" aria-label="Filter by category">
            {CATEGORIES.map(c => <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</button>)}
          </div>
          <div style={{ flex:1 }}/>
          <button className="btn btn-ghost" aria-pressed={browserOnly} onClick={() => setBrowserOnly(b => !b)}
            style={browserOnly ? { borderColor:'var(--brand)', color:'var(--text)' } : undefined}>
            <ShieldCheck size={14}/> Browser only
          </button>
          <label style={{ position:'relative', display:'flex', alignItems:'center' }}>
            <Search size={14} color="var(--text3)" style={{ position:'absolute', left:10, pointerEvents:'none' }}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter tools…" aria-label="Filter tools"
              style={{ height:34, paddingLeft:30, width:180 }}/>
          </label>
          <div className="seg" role="group" aria-label="Layout">
            <button aria-pressed={!list} aria-label="Grid view" onClick={() => setList(false)}><LayoutGrid size={14}/></button>
            <button aria-pressed={list}  aria-label="List view" onClick={() => setList(true)}><List size={14}/></button>
          </div>
        </div>

        {shown.length === 0
          ? <p role="status" style={{ textAlign:'center', padding:'48px 0', color:'var(--text3)' }}>No tools match your filters.</p>
          : <div className={`tools-grid${list ? ' list' : ''}`}>
              {shown.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
            </div>}

        <p style={{ marginTop:48, paddingTop:20, borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text3)' }}>© PDFForge</p>
      </div>
    </>
  )
}
