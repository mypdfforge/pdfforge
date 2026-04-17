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

export default function TopBar({ onBack, title, subtitle, dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch, extraRight }) {
  const searchRef = useRef(null)

  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const bg = dark ? 'rgba(13,13,20,0.97)' : 'rgba(245,245,250,0.97)'

  return (
    <header style={{ background:bg, backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50 }}>

      {/* ── Row 1: logo/back + right controls ── */}
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
        {extraRight && extraRight}
        <div style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', color:'#b0b0cc' }}>
          <Shield size={12} color="var(--green)"/> Files auto-deleted
        </div>
        <button onClick={onToggleTheme} title={dark?'Light mode':'Dark mode'}
          style={{ width:'34px', height:'34px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg3)', color:'#ffffff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          {dark ? <Sun size={15}/> : <Moon size={15}/>}
        </button>
      </div>

      {/* ── Row 2: categories + search (sticky, no overlap) ── */}
      {showCategories && (
        <div style={{ borderTop:'1px solid var(--border)', background:bg, padding:'0 16px', display:'flex', alignItems:'center', overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>

          <style>{`
            .topbar-scroll::-webkit-scrollbar { display:none }
            .cat-pill { background:none; border:none; border-bottom:2px solid transparent; padding:10px 14px; font-size:13px; font-weight:600; color:#b0b0cc; cursor:pointer; white-space:nowrap; flex-shrink:0; transition:color 0.15s, border-color 0.15s; }
            .cat-pill:hover { color:#ffffff; border-bottom-color:rgba(108,99,255,0.45); }
            .cat-pill.active { color:#ffffff; border-bottom-color:#6c63ff; }
            .search-box { background:transparent; border:1px solid transparent; border-radius:999px; padding:5px 28px 5px 30px; font-size:13px; font-weight:500; color:#ffffff; outline:none; width:190px; transition:all 0.18s; font-family:inherit; }
            .search-box::placeholder { color:#7070a0; }
            .search-box:hover { border-color:rgba(108,99,255,0.4); box-shadow:0 0 0 3px rgba(108,99,255,0.1); }
            .search-box:focus { border-color:#6c63ff; background:var(--bg3); box-shadow:0 0 0 3px rgba(108,99,255,0.2); }
          `}</style>

          {CATEGORIES.map(c => (
            <button key={c.id} className={`cat-pill${activeCategory===c.id?' active':''}`} onClick={() => onCategoryChange?.(c.id)}>
              {c.label}
            </button>
          ))}

          {/* Divider */}
          <div style={{ width:'1px', height:'18px', background:'var(--border)', flexShrink:0, margin:'0 8px' }}/>

          {/* Search — right next to last category */}
          <div style={{ position:'relative', display:'flex', alignItems:'center', flexShrink:0 }}>
            <Search size={13} color="#7070a0" style={{ position:'absolute', left:'11px', pointerEvents:'none' }}/>
            <input
              ref={searchRef}
              className="search-box"
              value={search||''}
              onChange={e => onSearch?.(e.target.value)}
              placeholder="Search tools…  Ctrl+K"
            />
            {search && (
              <button onClick={() => onSearch?.('')}
                style={{ position:'absolute', right:'10px', background:'none', border:'none', color:'#b0b0cc', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>×</button>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
