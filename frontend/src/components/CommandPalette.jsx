import React, { useState, useEffect, useRef } from 'react'
import { TOOLS, RUNS_LABEL } from '../utils/tools'

export default function CommandPalette({ onClose, onSelect }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const ref = useRef()
  useEffect(() => { ref.current?.focus() }, [])
  const s = q.trim().toLowerCase()
  const list = (s ? TOOLS.filter(t => (t.label + ' ' + t.desc).toLowerCase().includes(s)) : TOOLS).slice(0, 12)
  const pick = (t) => { onSelect(t.id); onClose() }
  const onKey = (e) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setI(n => Math.min(n + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setI(n => Math.max(n - 1, 0)) }
    else if (e.key === 'Enter' && list[i]) pick(list[i])
  }
  return (
    <div className="cmdk-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search tools" onKeyDown={onKey}>
        <input ref={ref} value={q} onChange={e => { setQ(e.target.value); setI(0) }} placeholder="Search tools…"
          role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-label="Search tools"/>
        <div className="cmdk-list" id="cmdk-list" role="listbox">
          {list.length === 0 && <p style={{ padding:'20px', textAlign:'center', color:'var(--text3)', fontSize:13 }}>No tools match “{q}”.</p>}
          {list.map((t, n) => (
            <button key={t.id} role="option" aria-selected={n === i} className="cmdk-item"
              onMouseEnter={() => setI(n)} onClick={() => pick(t)}>
              <t.icon size={16} color="var(--brand)"/>
              <span style={{ flex:1 }}>{t.label}</span>
              <span style={{ fontSize:11, color:'var(--text3)' }}>{RUNS_LABEL[t.runs]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
