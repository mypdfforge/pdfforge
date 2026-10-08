import React, { useState, useRef, useEffect } from 'react'
import { Check, RotateCcw } from 'lucide-react'

const FONT_SIZES = [8,9,10,11,12,13,14,16,18,20,24,28,32,36]

export default function SectionCard({ section, onChange }) {
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState(section.text)
  const [bold,     setBold]     = useState(section.bold || false)
  const [fontSize, setFontSize] = useState(Math.round(section.fontSize) || 11)
  const textareaRef = useRef(null)
  const charLimit   = section.maxWidth
    ? Math.floor(section.maxWidth / (fontSize * 0.52))
    : 999

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current
      ta.style.height = 'auto'
      ta.style.height = ta.scrollHeight + 'px'
      ta.focus()
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    }
  }, [editing])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [draft, fontSize])

  const commit = () => {
    onChange({ ...section, text: draft, bold, fontSize, changed: draft !== section.original })
    setEditing(false)
  }

  const cancel = () => {
    setDraft(section.text); setBold(section.bold || false)
    setFontSize(Math.round(section.fontSize) || 11)
    setEditing(false)
  }

  const isChanged   = draft !== section.original
  const isOverLimit = charLimit < 999 && draft.replace(/\n/g,'').length > charLimit * 1.1
  const displaySize = section.fontSize >= 16 ? '16px'
                    : section.fontSize >= 13 ? '14px' : '12px'

  return (
    <div
      onClick={() => { if (!editing) setEditing(true) }}
      style={{
        background:   editing ? '#1e1e2e' : section.changed ? 'rgba(62,207,142,0.04)' : '#13131e',
        border:       `1px solid ${editing ? '#6c63ff' : section.changed ? 'rgba(62,207,142,0.4)' : '#252538'}`,
        borderLeft:   section.changed && !editing ? '3px solid #3ecf8e' : undefined,
        borderRadius: '10px',
        padding:      editing ? '12px 14px' : '9px 14px',
        cursor:       editing ? 'default' : 'pointer',
        transition:   'border-color 0.12s',
      }}
      onMouseEnter={e => { if (!editing) e.currentTarget.style.borderColor='#2e2e48' }}
      onMouseLeave={e => { if (!editing) e.currentTarget.style.borderColor=section.changed?'rgba(62,207,142,0.4)':'#252538' }}
    >
      {editing ? (
        <div onClick={e => e.stopPropagation()}>
          {/* Toolbar */}
          <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'10px', padding:'5px 8px', background:'#0d0d14', borderRadius:'8px', border:'1px solid #1e1e2e', flexWrap:'wrap' }}>
            <select value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}
              style={{ fontSize:'12px', background:'#13131e', color:'#eeeef5', border:'1px solid #252538', borderRadius:'6px', padding:'3px 6px', height:'28px', cursor:'pointer' }}>
              {FONT_SIZES.map(s => <option key={s} value={s}>{s}pt</option>)}
            </select>
            <div style={{ width:'1px', height:'18px', background:'#252538' }}/>
            <button onClick={()=>setBold(b=>!b)}
              style={{ width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'6px', border:'1px solid #252538', background:bold?'#6c63ff':'#1e1e2e', color:bold?'#fff':'#9898b8', cursor:'pointer', fontWeight:700, fontSize:'13px' }}>B</button>
            {['I','U'].map(icon=>(
              <button key={icon} title="Pro feature"
                style={{ width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'6px', border:'1px solid #1e1e2e', background:'#13131e', color:'#3a3a58', cursor:'not-allowed', fontSize:'12px' }}>{icon}</button>
            ))}
            <span style={{ fontSize:'9px', fontWeight:700, background:'linear-gradient(135deg,#f5a623,#e5534b)', color:'#fff', padding:'2px 5px', borderRadius:'4px' }}>PRO</span>
            <div style={{ flex:1 }}/>
            {/* Char counter */}
            {charLimit < 999 && (
              <span style={{ fontSize:'11px', color: isOverLimit ? '#e5534b' : '#5a5a78', fontFamily:'monospace' }}>
                {draft.replace(/\n/g,'').length}/{charLimit} chars
              </span>
            )}
            <button onClick={cancel}
              style={{ display:'flex', alignItems:'center', gap:'3px', fontSize:'12px', color:'#9898b8', background:'none', border:'1px solid #252538', borderRadius:'6px', padding:'4px 10px', cursor:'pointer' }}>
              <RotateCcw size={10}/> Cancel
            </button>
            <button onClick={commit}
              style={{ display:'flex', alignItems:'center', gap:'3px', fontSize:'12px', color:'#fff', background:'#6c63ff', border:'none', borderRadius:'6px', padding:'4px 12px', cursor:'pointer' }}>
              <Check size={10}/> Save
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key==='Escape') cancel() }}
            placeholder="Type your text here..."
            style={{
              width:'100%', fontSize:`${fontSize}px`, fontWeight:bold?700:400,
              fontFamily:'Calibri,"Segoe UI",Arial,sans-serif',
              color:'#eeeef5', background:'#0d0d14',
              border:`1px solid ${isOverLimit?'#e5534b':'#252538'}`,
              borderRadius:'7px', padding:'9px 12px',
              outline:'none', resize:'none', lineHeight:1.6,
              minHeight:'40px', overflow:'hidden',
              whiteSpace:'pre-wrap', wordBreak:'break-word',
            }}
          />

          {/* Hints */}
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:'5px' }}>
            <p style={{ fontSize:'11px', color:'#5a5a78' }}>
              <span style={{ color:'#9d97ff' }}>Enter</span> = new line &nbsp;·&nbsp;
              <span style={{ color:'#9d97ff' }}>Esc</span> = cancel
              {isChanged && <span style={{ color:'#f5a623', marginLeft:'8px' }}>● unsaved</span>}
            </p>
            {isOverLimit && (
              <p style={{ fontSize:'11px', color:'#e5534b' }}>⚠ May overflow line</p>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
          <p style={{ fontSize:displaySize, fontWeight:section.bold?700:400, color:'#eeeef5', flex:1, margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.6, fontFamily:'Calibri,"Segoe UI",Arial,sans-serif' }}>
            {section.text || <span style={{ color:'#5a5a78', fontStyle:'italic' }}>Empty</span>}
          </p>
          <span style={{ fontSize:'10px', color:'#5a5a78', whiteSpace:'nowrap', flexShrink:0 }}>
            {section.fontSize}pt
          </span>
        </div>
      )}
    </div>
  )
}
