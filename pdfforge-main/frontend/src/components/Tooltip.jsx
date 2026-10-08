import React, { useState } from 'react'
import { Info, X } from 'lucide-react'

// Inline tooltip on hover
export function Tooltip({ text, children }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position:'relative', display:'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position:'absolute', bottom:'calc(100% + 6px)', left:'50%',
          transform:'translateX(-50%)',
          background:'#1e1e28', border:'1px solid var(--border2)',
          borderRadius:'8px', padding:'8px 12px',
          fontSize:'12px', color:'var(--text2)',
          whiteSpace:'nowrap', maxWidth:'260px', whiteSpace:'normal',
          zIndex:100, boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
          pointerEvents:'none', lineHeight:1.5,
        }}>
          {text}
          <div style={{ position:'absolute', bottom:'-5px', left:'50%', transform:'translateX(-50%)', width:'8px', height:'8px', background:'#1e1e28', border:'1px solid var(--border2)', borderTop:'none', borderLeft:'none', transform:'translateX(-50%) rotate(45deg)', bottom:'-4px' }}/>
        </div>
      )}
    </div>
  )
}

// Dismissible guide banner at top of tool page
export function ToolGuide({ title, steps, color = 'var(--accent)' }) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(`guide_${title}`) === 'true'
  )

  const dismiss = () => {
    localStorage.setItem(`guide_${title}`, 'true')
    setDismissed(true)
  }

  if (dismissed) return (
    <button onClick={() => setDismissed(false)}
      style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'var(--text3)', background:'none', border:'1px solid var(--border)', borderRadius:'8px', padding:'4px 12px', cursor:'pointer', marginBottom:'16px' }}>
      <Info size={12}/> Show guide
    </button>
  )

  return (
    <div style={{ background:`rgba(108,99,255,0.07)`, border:`1px solid rgba(108,99,255,0.25)`, borderRadius:'12px', padding:'16px 18px', marginBottom:'20px', position:'relative' }}>
      <button onClick={dismiss} style={{ position:'absolute', top:'10px', right:'12px', background:'none', border:'none', color:'var(--text3)', cursor:'pointer' }}>
        <X size={14}/>
      </button>
      <div style={{ display:'flex', alignItems:'center', gap:'7px', marginBottom:'10px' }}>
        <Info size={14} color="var(--accent2)"/>
        <span style={{ fontSize:'13px', fontWeight:600, color:'var(--accent2)' }}>How to use: {title}</span>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:'10px', fontSize:'12px', color:'var(--text2)' }}>
            <span style={{ width:'18px', height:'18px', borderRadius:'50%', background:'rgba(108,99,255,0.2)', color:'var(--accent2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:700, flexShrink:0, marginTop:'1px' }}>{i+1}</span>
            {step}
          </div>
        ))}
      </div>
    </div>
  )
}
