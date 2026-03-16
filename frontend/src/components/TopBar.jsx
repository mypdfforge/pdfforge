import React, { useRef, useEffect } from 'react'
import { ArrowLeft, Shield, Moon, Sun, Search } from 'lucide-react'

const CATEGORIES = [
  { id:'all',      label:'All Tools' },
  { id:'organize', label:'Organize'  },
  { id:'convert',  label:'Convert'   },
  { id:'optimize', label:'Optimize'  },
  { id:'enhance',  label:'Enhance'   },
  { id:'security', label:'Security'  },
]

export default function TopBar({ onBack, title, subtitle, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const searchRef = useRef(null)
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const bg = dark ? 'rgba(13,13,20,0.97)' : 'rgba(245,245,250,0.97)'
  return (
    <header style={{ background:bg, backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50 }}>
      <div style={{ height:'52px', padding:'0 24px', display:'flex', alignItems:'center', gap:'12px' }}>
        {onBack ? (
          <>
            <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#ffffff', background:'none', border:'1px solid var(--border)', borderRadius:'8px', padding:'5px 12px', cursor:'pointer' }}>
              <ArrowLeft size={13}/> Back
            </button>
            <div style={{ width:'1px', height:'16px', background:'var(--border)' }}/>
            <span style={{ fontWeight:700, color:'#ffffff', fontSize:'15px' }}>{title}</span>
            {subtitle && <span style={{ color:'#b0b0cc', fontSize:'13px' }}>{subtitle}</span>}
          </>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer' }} onClick={onGoHome}>
            <div style={{ width:'32px', height:'32px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' }}>✦</div>
            <span style={{ fontSize:'18px', fontWeight:800, color:'#ffffff', letterSpacing:'-0.02em', fontFamily:"'Syne',sans-serif" }}>PDFForge</span>
          </div>
        )}
        <div style={{ flex:1 }}/>
        <div style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', color:'#b0b0cc' }}>
          <Shield size={12} color="var(--green)"/> Files auto-deleted
        </div>
        <button onClick={onToggleTheme} title={dark?'Light mode':'Dark mode'}
          style={{ width:'34px', height:'34px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg3)', color:'#ffffff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          {dark ? <Sun size={15}/> : <Moon size={15}/>}
        </button>
      </div>
      {showCategories && (
        <div style={{ borderTop:'1px solid var(--border)', background:bg, padding:'0 24px', display:'flex', alignItems:'center', gap:'4px', overflowX:'auto', scrollbarWidth:'none' }}>
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => onCategoryChange?.(c.id)}
              style={{ flexShrink:0, fontSize:'13px', fontWeight:600, padding:'10px 16px', background:'none', border:'none',
                borderBottom:`2px solid ${activeCategory===c.id ? '#6c63ff' : 'transparent'}`,
                color: activeCategory===c.id ? '#ffffff' : '#b0b0cc',
                cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap' }}>
              {c.label}
            </button>
          ))}
          <div style={{ width:'1px', height:'18px', background:'var(--border)', flexShrink:0, margin:'0 6px' }}/>
          <div style={{ position:'relative', display:'flex', alignItems:'center', flexShrink:0 }}>
            <Search size={13} color="#b0b0cc" style={{ position:'absolute', left:'10px', pointerEvents:'none' }}/>
            <input ref={searchRef} value={search||''} onChange={e=>onSearch?.(e.target.value)} placeholder="Search tools… (Ctrl+K)"
              style={{ background:'transparent', border:'1px solid transparent', borderRadius:'999px', padding:'6px 28px 6px 30px', fontSize:'13px', fontWeight:500, color:'#ffffff', outline:'none', width:'200px', transition:'all 0.15s' }}
              onFocus={e=>{e.target.style.borderColor='var(--accent)';e.target.style.background='var(--bg3)'}}
              onBlur={e=>{e.target.style.borderColor='transparent';e.target.style.background='transparent'}}/>
            {search && <button onClick={()=>onSearch?.('')} style={{ position:'absolute', right:'8px', background:'none', border:'none', color:'#b0b0cc', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>×</button>}
          </div>
        </div>
      )}
    </header>
  )
}
