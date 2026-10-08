import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

export default function PageSelector({ file, onChange, selectionMode = 'multiple' }) {
  const [thumbs,   setThumbs]   = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    if (!file) return
    setLoading(true)
    const form = new FormData()
    form.append('file', file)
    axios.post('/api/tools/thumbnails', form)
      .then(r => { setThumbs(r.data.thumbnails); setLoading(false) })
      .catch(() => setLoading(false))
  }, [file])

  const toggle = (n) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      const arr = [...next].sort((a,b)=>a-b)
      onChange(arr.join(','))
      return next
    })
  }

  const selectAll = () => {
    const all = new Set(thumbs.map(t => t.page))
    setSelected(all)
    onChange([...all].sort((a,b)=>a-b).join(','))
  }

  const selectNone = () => { setSelected(new Set()); onChange('') }

  const invert = () => {
    const all = new Set(thumbs.map(t => t.page))
    const inv = new Set([...all].filter(n => !selected.has(n)))
    setSelected(inv)
    onChange([...inv].sort((a,b)=>a-b).join(','))
  }

  if (!file) return null

  return (
    <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px', flexWrap:'wrap' }}>
        <span style={{ fontSize:'12px', color:'var(--text2)', fontWeight:500 }}>
          Pages: <span style={{ color:'var(--accent2)' }}>{selected.size > 0 ? [...selected].sort((a,b)=>a-b).join(', ') : 'none selected'}</span>
        </span>
        <div style={{ flex:1 }}/>
        {[['Select All', selectAll],['Select None', selectNone],['Invert', invert]].map(([label, fn]) => (
          <button key={label} onClick={fn} style={{ fontSize:'11px', color:'var(--text2)', background:'var(--bg4)', border:'1px solid var(--border)', borderRadius:'6px', padding:'4px 10px', cursor:'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'24px', color:'var(--text3)', fontSize:'13px' }}>
          Loading page previews…
        </div>
      ) : (
        <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', maxHeight:'320px', overflowY:'auto' }}>
          {thumbs.map(t => {
            const isSel = selected.has(t.page)
            return (
              <div key={t.page} onClick={() => toggle(t.page)}
                style={{ cursor:'pointer', position:'relative', flexShrink:0, width:'80px' }}>
                <div style={{ border:`2px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`, borderRadius:'8px', overflow:'hidden', transition:'all 0.15s', boxShadow: isSel ? '0 0 0 3px rgba(108,99,255,0.25)' : 'none', background: isSel ? 'rgba(108,99,255,0.08)' : 'transparent' }}>
                  <img src={t.img} alt={`Page ${t.page}`} style={{ width:'100%', display:'block' }}/>
                </div>
                {/* Checkbox overlay */}
                <div style={{ position:'absolute', top:'4px', right:'4px', width:'18px', height:'18px', borderRadius:'50%', background: isSel ? 'var(--accent)' : 'rgba(0,0,0,0.5)', border:'2px solid #fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', color:'#fff', fontWeight:700 }}>
                  {isSel ? '✓' : ''}
                </div>
                <div style={{ textAlign:'center', fontSize:'10px', color:'var(--text3)', marginTop:'4px' }}>p.{t.page}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
