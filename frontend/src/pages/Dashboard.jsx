import React, { useState, useEffect, useRef } from 'react'
import { ArrowRight, Zap, Shield, Search, Moon, Sun, ChevronDown } from 'lucide-react'

const TOOLS = [
  { id:'editor', featured:true, tag:'★ MOST POPULAR', icon:'✦', label:'Resume Editor',
    desc:'Edit PDF text directly on the page. Preserves original fonts, spacing, bullets and layout. Click any text to edit it instantly.',
    color:'#6c63ff', bg:'rgba(108,99,255,0.12)', border:'rgba(108,99,255,0.4)', category:'all',
    perks:['Preserves original layout','Click any text to edit','AI-powered suggestions','Export instantly'] },
  { id:'merge',     icon:'⊕', label:'Merge PDF',        desc:'Combine multiple PDFs into one document.',                  color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'split',     icon:'⊘', label:'Split PDF',         desc:'Split by page range. Select pages visually.',              color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'extract',   icon:'⬡', label:'Extract Pages',     desc:'Pull specific pages out into a new PDF.',                  color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'rotate',    icon:'↻', label:'Rotate Pages',      desc:'Rotate one or all pages 90°, 180°, or 270°.',             color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'delete',    icon:'⊗', label:'Delete Pages',      desc:'Remove unwanted pages from your PDF.',                     color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'organize' },
  { id:'duplicate', icon:'⧉', label:'Duplicate Page',    desc:'Duplicate any page and insert it after the original.',    color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'crop',      icon:'⬚', label:'Crop PDF',           desc:'Trim margins from all pages.',                             color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'image-to-pdf', icon:'📄', label:'Images → PDF',  desc:'Convert JPG/PNG images to a single PDF.',                 color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'word-to-pdf',  icon:'📋', label:'Word → PDF',     desc:'Convert .docx documents to PDF.',                        color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'pptx-to-pdf',  icon:'📊', label:'PowerPoint → PDF', desc:'Convert .pptx presentations to PDF.',                 color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'xlsx-to-pdf',  icon:'📈', label:'Excel → PDF',    desc:'Convert .xlsx spreadsheets to PDF.',                     color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'html-to-pdf',  icon:'🌐', label:'HTML → PDF',     desc:'Convert HTML web pages to PDF.',                         color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'images',      icon:'🖼', label:'PDF → Images',    desc:'Convert each page to PNG. Download as ZIP.',              color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-jpg',  icon:'🖼', label:'PDF → JPG',        desc:'Export PDF pages as JPG images (ZIP).',                 color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-word', icon:'📝', label:'PDF → Word',       desc:'Convert PDF text to an editable .docx file.',           color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pptx', icon:'📊', label:'PDF → PowerPoint', desc:'Convert PDF pages to PowerPoint slides.',               color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-xlsx', icon:'📈', label:'PDF → Excel',      desc:'Extract PDF content into a spreadsheet.',               color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pdfa', icon:'📄', label:'PDF → PDF/A',      desc:'Convert to archive-standard PDF/A format.',             color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'compress',  icon:'⬡', label:'Compress PDF',    desc:'Reduce file size while maintaining quality.',               color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'repair',    icon:'⚙', label:'Repair PDF',      desc:'Fix corrupted or broken PDF files.',                        color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'watermark',   icon:'◈', label:'Watermark',       desc:'Add text or image watermark with live preview.',          color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'pagenums',    icon:'◎', label:'Page Numbers',    desc:'Add page numbers to every page.',                         color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'stamp',       icon:'◆', label:'Stamp',           desc:'Add APPROVED/DRAFT/CONFIDENTIAL stamps.',                 color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'findreplace', icon:'⌕', label:'Find & Replace',  desc:'Search and replace text across entire PDF.',              color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'enhance' },
  { id:'protect', icon:'🔐', label:'Protect PDF',  desc:'Add a password to your PDF.',                                   color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'unlock',  icon:'🔓', label:'Unlock PDF',   desc:'Remove password protection from PDF.',                          color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'redact',  icon:'⬛', label:'Redact Text',  desc:'Permanently black out sensitive text.',                         color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'security' },
]

const CATEGORIES = [
  { id:'all', label:'All Tools' },
  { id:'organize', label:'Organize' },
  { id:'convert',  label:'Convert' },
  { id:'optimize', label:'Optimize' },
  { id:'enhance',  label:'Enhance' },
  { id:'security', label:'Security' },
]

const TOP_TOOLS_COUNT = 8

function ToolCard({ tool, onClick, dark }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={() => onClick(tool.id, tool.category)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: tool.featured
          ? 'linear-gradient(135deg, rgba(108,99,255,0.18), rgba(232,121,249,0.1))'
          : tool.bg,
        border: `1px solid ${hovered ? tool.color + '66' : tool.border}`,
        borderRadius: '16px',
        padding: tool.featured ? '26px' : '20px',
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        position: 'relative',
        overflow: 'hidden',
        gridColumn: tool.featured ? 'span 2' : 'span 1',
        transform: hovered ? 'translateY(-3px)' : '',
        boxShadow: hovered ? '0 12px 36px rgba(0,0,0,0.3)' : 'none',
      }}
    >
      {tool.tag && (
        <div style={{ display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'10px', fontWeight:700, letterSpacing:'.08em', color:'#fff', background:'linear-gradient(135deg,#6c63ff,#e879f9)', padding:'3px 10px', borderRadius:'999px', marginBottom:'12px' }}>
          {tool.tag}
        </div>
      )}
      <div style={{ display:'flex', alignItems:'flex-start', gap:'14px' }}>
        <div style={{ width:tool.featured?'46px':'38px', height:tool.featured?'46px':'38px', borderRadius:'11px', background:'rgba(108,99,255,0.1)', border:`1px solid ${tool.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:tool.featured?'22px':'17px', flexShrink:0, color:tool.color }}>
          {tool.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'5px' }}>
            <h3 style={{ fontSize:tool.featured?'17px':'14px', fontWeight:700, color:'#eeeef5' }}>{tool.label}</h3>
            <ArrowRight size={13} color="#5a5a78"/>
          </div>
          <p style={{ fontSize:'12px', color:'#c8c8e0', lineHeight:1.6 }}>{tool.desc}</p>
        </div>
      </div>
      {tool.featured && tool.perks && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', marginTop:'18px', paddingTop:'16px', borderTop:'1px solid rgba(108,99,255,0.2)' }}>
          {tool.perks.map(p => (
            <span key={p} style={{ fontSize:'11px', color:'#9d97ff', display:'flex', alignItems:'center', gap:'4px' }}>
              <span style={{ color:'#3ecf8e' }}>✓</span> {p}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SectionHeading({ label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'16px', marginTop:'8px' }}>
      <span style={{ fontSize:'12px', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'#9898b8' }}>{label}</span>
      <div style={{ flex:1, height:'1px', background:'#252538' }}/>
    </div>
  )
}

export default function Dashboard({ onSelectTool, initialCategory = 'all' }) {
  const [cat,      setCat]      = useState(initialCategory)
  const [search,   setSearch]   = useState('')
  const [dark,     setDark]     = useState(true)
  const [showAll,  setShowAll]  = useState(false)
  const searchRef = useRef(null)

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Reset showAll when category or search changes
  useEffect(() => { setShowAll(false) }, [cat, search])

  const filtered = search.trim()
    ? TOOLS.filter(t => t.label.toLowerCase().includes(search.toLowerCase()) || t.desc.toLowerCase().includes(search.toLowerCase()))
    : null

  const renderTools = () => {
    // Search results
    if (filtered) {
      if (!filtered.length) return (
        <div style={{ textAlign:'center', padding:'60px 0', color:'#9898b8' }}>
          <div style={{ fontSize:'36px', marginBottom:'12px' }}>🔍</div>
          <p style={{ fontSize:'15px', fontWeight:600 }}>No tools found for "{search}"</p>
          <p style={{ fontSize:'13px', marginTop:'6px' }}>Try a different keyword</p>
        </div>
      )
      return (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
          {filtered.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
        </div>
      )
    }

    // Convert tab — split into to/from
    if (cat === 'convert') {
      const toTools   = TOOLS.filter(t => t.category === 'convert' && t.sub === 'to')
      const fromTools = TOOLS.filter(t => t.category === 'convert' && t.sub === 'from')
      return (
        <>
          <SectionHeading label="Convert to PDF"/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px', marginBottom:'32px' }}>
            {toTools.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
          </div>
          <SectionHeading label="Convert from PDF"/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
            {fromTools.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
          </div>
        </>
      )
    }

    const visible = cat === 'all'
      ? TOOLS
      : TOOLS.filter(t => t.featured || t.category === cat)

    const displayed = (cat === 'all' && !showAll) ? visible.slice(0, TOP_TOOLS_COUNT) : visible
    const hasMore   = cat === 'all' && !showAll && visible.length > TOP_TOOLS_COUNT

    return (
      <>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
          {displayed.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
        </div>
        {hasMore && (
          <div style={{ textAlign:'center', marginTop:'28px' }}>
            <button onClick={() => setShowAll(true)}
              style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'10px 28px', borderRadius:'999px', border:'1px solid #252538', background:'#13131e', color:'#9898b8', fontSize:'13px', fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#6c63ff'; e.currentTarget.style.color='#9d97ff' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='#252538'; e.currentTarget.style.color='#9898b8' }}>
              <ChevronDown size={14}/> Show all {visible.length} tools
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:'#0d0d14' }}>

      {/* Header */}
      <header style={{ borderBottom:'1px solid #252538', padding:'0 40px', height:'58px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(13,13,20,0.97)', backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <div style={{ width:'32px', height:'32px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' }}>✦</div>
          <span style={{ fontSize:'18px', fontWeight:800, color:'#eeeef5', letterSpacing:'-0.02em', fontFamily:"'Syne', sans-serif" }}>PDFForge</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          {/* Search bar */}
          <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
            <Search size={13} color="#5a5a78" style={{ position:'absolute', left:'10px', pointerEvents:'none' }}/>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tools… (Ctrl+K)"
              style={{ background:'#13131e', border:'1px solid #252538', borderRadius:'8px', padding:'6px 12px 6px 30px', fontSize:'13px', color:'#eeeef5', outline:'none', width:'220px', transition:'border-color 0.15s' }}
              onFocus={e => e.target.style.borderColor='#6c63ff'}
              onBlur={e => e.target.style.borderColor='#252538'}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position:'absolute', right:'8px', background:'none', border:'none', color:'#5a5a78', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>×</button>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#5a5a78' }}>
            <Shield size={12} color="#3ecf8e"/> Files auto-deleted
          </div>
        </div>
      </header>

      <main style={{ maxWidth:'1200px', margin:'0 auto', padding:'56px 24px' }}>

        {/* Hero */}
        {!search && (
          <div style={{ textAlign:'center', marginBottom:'48px' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'7px', fontSize:'11px', letterSpacing:'.12em', textTransform:'uppercase', color:'#9d97ff', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.2)', padding:'5px 18px', borderRadius:'999px', marginBottom:'22px' }}>
              <Zap size={11}/> {TOOLS.length - 1} PDF Tools — All Free
            </div>
            <h1 style={{ fontSize:'54px', fontWeight:800, lineHeight:1.07, letterSpacing:'-0.03em', marginBottom:'16px', color:'#eeeef5', fontFamily:"'Syne', sans-serif" }}>
              All your PDF tools,<br/>
              <span style={{ background:'linear-gradient(135deg,#6c63ff,#e879f9)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>one place.</span>
            </h1>
            <p style={{ fontSize:'16px', color:'#c8c8e0', maxWidth:'500px', margin:'0 auto', lineHeight:1.75 }}>
              Edit, merge, split, compress, protect, watermark — and the best PDF resume editor on the web.
            </p>
          </div>
        )}

        {/* Category filter — sticky */}
        {!search && (
          <div style={{ display:'flex', gap:'8px', justifyContent:'center', marginBottom:'40px', flexWrap:'wrap', position:'sticky', top:'58px', zIndex:40, background:'rgba(13,13,20,0.92)', backdropFilter:'blur(12px)', padding:'12px 0', margin:'0 -24px 40px', paddingLeft:'24px', paddingRight:'24px' }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{
                fontSize:'13px', fontWeight:500, padding:'7px 18px', borderRadius:'999px',
                border:`1px solid ${cat===c.id ? '#6c63ff' : '#252538'}`,
                background: cat===c.id ? 'rgba(108,99,255,0.15)' : '#13131e',
                color: cat===c.id ? '#9d97ff' : '#9898b8',
                cursor:'pointer', transition:'all 0.15s',
              }}>
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* Tool grid */}
        {renderTools()}

        {/* Stats */}
        {!search && (
          <div style={{ display:'flex', gap:'48px', justifyContent:'center', marginTop:'60px', paddingTop:'40px', borderTop:'1px solid #252538', flexWrap:'wrap' }}>
            {[['29+','PDF Tools'],['100%','Free to use'],['50MB','Max file size'],['0','Data stored']].map(([n,l]) => (
              <div key={l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:'32px', fontWeight:800, color:'#9d97ff', lineHeight:1, fontFamily:"'Syne',sans-serif" }}>{n}</div>
                <div style={{ fontSize:'13px', color:'#c8c8e0', marginTop:'6px' }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Trust section */}
        {!search && (
          <div style={{ marginTop:'60px', padding:'40px', background:'#13131e', border:'1px solid #252538', borderRadius:'20px', textAlign:'center' }}>
            <h2 style={{ fontSize:'22px', fontWeight:800, color:'#eeeef5', marginBottom:'10px' }}>Why Choose PDFForge?</h2>
            <p style={{ fontSize:'14px', color:'#9898b8', marginBottom:'32px' }}>Built for privacy, speed, and simplicity.</p>
            <div style={{ display:'flex', gap:'32px', justifyContent:'center', flexWrap:'wrap' }}>
              {[
                ['🔒', 'Private by Default', 'Files are deleted immediately after processing. Nothing is stored.'],
                ['⚡', 'Fast Processing',    'Server-side processing means no waiting for large files.'],
                ['🆓', 'Always Free',        'All tools are free. No accounts, no subscriptions, no tricks.'],
                ['🌐', 'Works Everywhere',   'No software to install. Works in any modern browser.'],
              ].map(([icon, title, desc]) => (
                <div key={title} style={{ maxWidth:'180px', textAlign:'center' }}>
                  <div style={{ fontSize:'28px', marginBottom:'10px' }}>{icon}</div>
                  <div style={{ fontSize:'14px', fontWeight:700, color:'#eeeef5', marginBottom:'6px' }}>{title}</div>
                  <div style={{ fontSize:'12px', color:'#9898b8', lineHeight:1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop:'1px solid #252538', padding:'32px 40px', background:'#0d0d14' }}>
        <div style={{ maxWidth:'1200px', margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ width:'24px', height:'24px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'6px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px' }}>✦</div>
            <span style={{ fontSize:'14px', fontWeight:700, color:'#eeeef5' }}>PDFForge</span>
            <span style={{ fontSize:'12px', color:'#5a5a78', marginLeft:'8px' }}>© 2025 — All rights reserved</span>
          </div>
          <div style={{ display:'flex', gap:'24px' }}>
            {['Privacy Policy', 'Terms of Use', 'Contact'].map(l => (
              <a key={l} href="#" style={{ fontSize:'12px', color:'#5a5a78', textDecoration:'none', transition:'color 0.15s' }}
                onMouseEnter={e => e.target.style.color='#9898b8'}
                onMouseLeave={e => e.target.style.color='#5a5a78'}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
