import React, { useRef } from 'react'
import { ArrowLeft, Shield, Moon, Sun, Search } from 'lucide-react'

export default function TopBar({ onBack, title, subtitle, dark, onToggleTheme, search, onSearch, showSearch = false }) {
  const searchRef = useRef(null)

  return (
    <header style={{
      height:'52px', padding:'0 24px', display:'flex', alignItems:'center', gap:'12px',
      borderBottom:'1px solid var(--border)', background: dark ? 'rgba(13,13,20,0.97)' : 'rgba(245,245,250,0.97)',
      backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50, flexShrink:0,
    }}>
      {/* Logo / Back */}
      {onBack ? (
        <>
          <button onClick={onBack} className="btn btn-ghost" style={{ padding:'5px 10px', fontSize:'13px' }}>
            <ArrowLeft size={13}/> Back
          </button>
          <div style={{ width:'1px', height:'16px', background:'var(--border)' }}/>
          <span style={{ fontWeight:700, color:'var(--text)' }}>{title}</span>
          {subtitle && <span style={{ color:'var(--text3)', fontSize:'13px' }}>{subtitle}</span>}
        </>
      ) : (
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <div style={{ width:'32px', height:'32px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' }}>✦</div>
          <span style={{ fontSize:'18px', fontWeight:800, color:'var(--text)', letterSpacing:'-0.02em', fontFamily:"'Syne', sans-serif" }}>PDFForge</span>
        </div>
      )}

      <div style={{ flex:1 }}/>

      {/* Search bar (dashboard only) */}
      {showSearch && (
        <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
          <Search size={13} color="var(--text3)" style={{ position:'absolute', left:'10px', pointerEvents:'none' }}/>
          <input
            ref={searchRef}
            value={search || ''}
            onChange={e => onSearch?.(e.target.value)}
            placeholder="Search tools… (Ctrl+K)"
            style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'8px', padding:'6px 32px 6px 30px', fontSize:'13px', color:'var(--text)', outline:'none', width:'220px' }}
            onFocus={e => e.target.style.borderColor='var(--accent)'}
            onBlur={e => e.target.style.borderColor='var(--border)'}
          />
          {search && (
            <button onClick={() => onSearch?.('')} style={{ position:'absolute', right:'8px', background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>×</button>
          )}
        </div>
      )}

      {/* Security note */}
      <div style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', color:'var(--text3)' }}>
        <Shield size={12} color="var(--green)"/> Files auto-deleted
      </div>

      {/* Dark/Light toggle */}
      <button onClick={onToggleTheme}
        style={{ width:'34px', height:'34px', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s', flexShrink:0 }}
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {dark ? <Sun size={15}/> : <Moon size={15}/>}
      </button>
    </header>
  )
}
