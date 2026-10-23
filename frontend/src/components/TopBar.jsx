import React from 'react'
import { ArrowLeft, Menu, Search, ShieldCheck, Server } from 'lucide-react'
import { toolById, RUNS_LABEL } from '../utils/tools'

// Slim page header used by every page inside the app shell.
// Sidebar, theme and search live in the shell (App.jsx); this only shows where you are.
export default function TopBar({ onBack, title, subtitle, extraRight }) {
  const id   = window.location.hash.replace(/^#\/?/, '')
  const tool = toolById(id)
  const open = (name) => window.dispatchEvent(new Event(name))
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={() => open('pdfforge:menu')} aria-label="Open menu"><Menu size={16}/></button>
      {onBack && <button className="btn btn-ghost" onClick={onBack} aria-label="Back to all tools"><ArrowLeft size={14}/><span className="hide-sm">All tools</span></button>}
      {title && <span className="topbar-title">{title.replace(/^[^\p{L}\p{N}]+/u, '')}</span>}
      {subtitle && <span className="topbar-sub">{subtitle}</span>}
      <div style={{ flex:1 }}/>
      {extraRight}
      {tool && (
        <span className={`badge hide-sm ${tool.runs === 'browser' ? 'badge-browser' : ''}`}>
          {tool.runs === 'browser' ? <ShieldCheck size={12}/> : <Server size={12}/>} {RUNS_LABEL[tool.runs]}
        </span>
      )}
      <button
        className="btn btn-ghost hide-sm"
        onClick={() => open('pdfforge:search')}
        aria-label="Search tools (Ctrl+K)"
        style={{ height: '30px', padding: '0 8px', fontSize: '12px', color: 'var(--text3)', gap: '6px' }}
      >
        <Search size={13}/>
        <span>Search</span>
        <kbd style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'inherit', color: 'var(--text3)' }}>Ctrl+K</kbd>
      </button>
      <button className="icon-btn menu-btn" onClick={() => open('pdfforge:search')} aria-label="Search tools (Ctrl+K)"><Search size={15}/></button>
    </header>
  )
}
