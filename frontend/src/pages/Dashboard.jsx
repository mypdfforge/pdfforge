import React, { useState, useEffect } from 'react'
import { ArrowRight, Zap, ChevronDown } from 'lucide-react'
import TopBar from '../components/TopBar'

export const TOOLS = [
  { id:'editor', featured:true, tag:'★ MOST POPULAR', icon:'✦', label:'Resume Editor',
    desc:'Edit PDF text directly on the page. Preserves original fonts, spacing, bullets and layout.',
    color:'#6c63ff', bg:'rgba(108,99,255,0.12)', border:'rgba(108,99,255,0.4)', category:'all',
    perks:['Preserves original layout','Click any text to edit','AI-powered suggestions','Export instantly'] },
  { id:'merge',     icon:'⊕', label:'Merge PDF',        desc:'Combine multiple PDFs into one document.',               color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'split',     icon:'⊘', label:'Split PDF',         desc:'Split by page range. Select pages visually.',           color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'extract',   icon:'⬡', label:'Extract Pages',     desc:'Pull specific pages out into a new PDF.',               color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'rotate',    icon:'↻', label:'Rotate Pages',      desc:'Rotate one or all pages 90°, 180°, or 270°.',          color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'delete',    icon:'⊗', label:'Delete Pages',      desc:'Remove unwanted pages from your PDF.',                  color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'organize' },
  { id:'duplicate', icon:'⧉', label:'Duplicate Page',    desc:'Duplicate any page and insert it after the original.', color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'crop',      icon:'⬚', label:'Crop PDF',           desc:'Trim margins from all pages.',                          color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'image-to-pdf', icon:'📄', label:'Images → PDF',  desc:'Convert JPG/PNG images to a single PDF.',              color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'word-to-pdf',  icon:'📋', label:'Word → PDF',     desc:'Convert .docx documents to PDF.',                      color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'pptx-to-pdf',  icon:'📊', label:'PowerPoint → PDF', desc:'Convert .pptx presentations to PDF.',               color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'xlsx-to-pdf',  icon:'📈', label:'Excel → PDF',    desc:'Convert .xlsx spreadsheets to PDF.',                   color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'html-to-pdf',  icon:'🌐', label:'HTML → PDF',     desc:'Convert HTML web pages to PDF.',                       color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'images',      icon:'🖼', label:'PDF → Images',    desc:'Convert each page to PNG. Download as ZIP.',            color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-jpg',  icon:'🖼', label:'PDF → JPG',        desc:'Export PDF pages as JPG images (ZIP).',               color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-word', icon:'📝', label:'PDF → Word',       desc:'Convert PDF text to an editable .docx file.',         color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pptx', icon:'📊', label:'PDF → PowerPoint', desc:'Convert PDF pages to PowerPoint slides.',             color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-xlsx', icon:'📈', label:'PDF → Excel',      desc:'Extract PDF content into a spreadsheet.',             color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pdfa', icon:'📄', label:'PDF → PDF/A',      desc:'Convert to archive-standard PDF/A format.',           color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'compress',    icon:'⬡', label:'Compress PDF',      desc:'Reduce file size while maintaining quality.',          color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'repair',      icon:'⚙', label:'Repair PDF',        desc:'Fix corrupted or broken PDF files.',                   color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'watermark',   icon:'◈', label:'Watermark',         desc:'Add text or image watermark with live preview.',       color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'pagenums',    icon:'◎', label:'Page Numbers',      desc:'Add page numbers to every page.',                      color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'stamp',       icon:'◆', label:'Stamp',             desc:'Add APPROVED/DRAFT/CONFIDENTIAL stamps.',              color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'findreplace', icon:'⌕', label:'Find & Replace',    desc:'Search and replace text across entire PDF.',           color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'enhance' },
  { id:'protect',     icon:'🔐', label:'Protect PDF',      desc:'Add a password to your PDF.',                          color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'unlock',      icon:'🔓', label:'Unlock PDF',       desc:'Remove password protection from PDF.',                 color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'redact',      icon:'⬛', label:'Redact Text',      desc:'Permanently black out sensitive text.',                color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'security' },
]

function ToolCard({ tool, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div onClick={() => onClick(tool.id, tool.category)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: tool.featured ? 'linear-gradient(135deg,rgba(108,99,255,0.18),rgba(232,121,249,0.1))' : tool.bg,
        border: `1px solid ${hov ? tool.color+'88' : tool.border}`,
        borderRadius:'16px', padding:tool.featured?'26px':'20px', cursor:'pointer',
        transition:'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        gridColumn: tool.featured ? 'span 2' : 'span 1',
        transform: hov ? 'translateY(-3px)' : '',
        boxShadow: hov ? '0 12px 36px rgba(0,0,0,0.25)' : 'none',
      }}>
      {tool.tag && (
        <div style={{ display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'10px', fontWeight:700, color:'#fff', background:'linear-gradient(135deg,#6c63ff,#e879f9)', padding:'3px 10px', borderRadius:'999px', marginBottom:'12px' }}>{tool.tag}</div>
      )}
      <div style={{ display:'flex', alignItems:'flex-start', gap:'14px' }}>
        <div style={{ width:tool.featured?'46px':'38px', height:tool.featured?'46px':'38px', borderRadius:'11px', background:'rgba(108,99,255,0.1)', border:`1px solid ${tool.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:tool.featured?'22px':'17px', flexShrink:0, color:tool.color }}>{tool.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'5px' }}>
            <h3 style={{ fontSize:tool.featured?'17px':'14px', fontWeight:700, color:'#ffffff' }}>{tool.label}</h3>
            <ArrowRight size={13} color="#b0b0cc"/>
          </div>
          <p style={{ fontSize:'12px', color:'#d0d0e8', lineHeight:1.6 }}>{tool.desc}</p>
        </div>
      </div>
      {tool.featured && tool.perks && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', marginTop:'18px', paddingTop:'16px', borderTop:'1px solid rgba(108,99,255,0.2)' }}>
          {tool.perks.map(p => <span key={p} style={{ fontSize:'11px', color:'var(--accent2)', display:'flex', alignItems:'center', gap:'4px' }}><span style={{ color:'var(--green)' }}>✓</span>{p}</span>)}
        </div>
      )}
    </div>
  )
}

function SectionHeading({ label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'16px', marginTop:'8px' }}>
      <span style={{ fontSize:'12px', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'#b0b0cc' }}>{label}</span>
      <div style={{ flex:1, height:'1px', background:'var(--border)' }}/>
    </div>
  )
}

export default function Dashboard({ onSelectTool, initialCategory='all', dark, onToggleTheme, onGoHome, showCategories, activeCategory, onCategoryChange, search, onSearch }) {
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [activeCategory, search])

  const filtered = search?.trim()
    ? TOOLS.filter(t => t.label.toLowerCase().includes(search.toLowerCase()) || t.desc.toLowerCase().includes(search.toLowerCase()))
    : null

  const renderTools = () => {
    if (filtered) {
      if (!filtered.length) return (
        <div style={{ textAlign:'center', padding:'60px 0' }}>
          <div style={{ fontSize:'36px', marginBottom:'12px' }}>🔍</div>
          <p style={{ fontSize:'15px', fontWeight:600, color:'#ffffff' }}>No tools found for "{search}"</p>
          <p style={{ fontSize:'13px', color:'#b0b0cc', marginTop:'6px' }}>Try a different keyword</p>
        </div>
      )
      return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))', gap:'14px' }}>{filtered.map(t=><ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}</div>
    }
    if (activeCategory === 'convert') {
      return (<>
        <SectionHeading label="Convert to PDF"/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))', gap:'14px', marginBottom:'32px' }}>{TOOLS.filter(t=>t.category==='convert'&&t.sub==='to').map(t=><ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}</div>
        <SectionHeading label="Convert from PDF"/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))', gap:'14px' }}>{TOOLS.filter(t=>t.category==='convert'&&t.sub==='from').map(t=><ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}</div>
      </>)
    }
    const visible   = activeCategory==='all' ? TOOLS : TOOLS.filter(t => t.featured || t.category === activeCategory)
    const displayed = activeCategory==='all' && !showAll ? visible.slice(0, 8) : visible
    const hasMore   = activeCategory==='all' && !showAll && visible.length > 8
    return (<>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))', gap:'14px' }}>{displayed.map(t=><ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}</div>
      {hasMore && (
        <div style={{ textAlign:'center', marginTop:'28px' }}>
          <button onClick={() => setShowAll(true)}
            style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'10px 28px', borderRadius:'999px', border:'1px solid var(--border)', background:'var(--bg2)', color:'#d0d0e8', fontSize:'13px', fontWeight:500, cursor:'pointer' }}>
            <ChevronDown size={14}/> Show all {visible.length} tools
          </button>
        </div>
      )}
    </>)
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
      <TopBar dark={dark} onToggleTheme={onToggleTheme} onGoHome={onGoHome}
        showCategories={showCategories} activeCategory={activeCategory} onCategoryChange={onCategoryChange}
        search={search} onSearch={onSearch}/>

      <main style={{ maxWidth:'1200px', margin:'0 auto', padding:'48px 24px' }}>
        {!search && (
          <div style={{ textAlign:'center', marginBottom:'48px' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'7px', fontSize:'11px', letterSpacing:'.12em', textTransform:'uppercase', color:'var(--accent2)', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.2)', padding:'5px 18px', borderRadius:'999px', marginBottom:'22px' }}>
              <Zap size={11}/> {TOOLS.length - 1} PDF Tools — All Free
            </div>
            <h1 style={{ fontSize:'54px', fontWeight:800, lineHeight:1.07, letterSpacing:'-0.03em', marginBottom:'16px', color:'#ffffff', fontFamily:"'Syne',sans-serif" }}>
              All your PDF tools,<br/>
              <span style={{ background:'linear-gradient(135deg,#6c63ff,#e879f9)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>one place.</span>
            </h1>
            <p style={{ fontSize:'16px', color:'#d0d0e8', maxWidth:'500px', margin:'0 auto', lineHeight:1.75 }}>
              Edit, merge, split, compress, protect, watermark — and the best PDF resume editor on the web.
            </p>
          </div>
        )}

        {renderTools()}

        {!search && (<>
          <div style={{ display:'flex', gap:'48px', justifyContent:'center', marginTop:'60px', paddingTop:'40px', borderTop:'1px solid var(--border)', flexWrap:'wrap' }}>
            {[['29+','PDF Tools'],['100%','Free to use'],['50MB','Max file size'],['0','Data stored']].map(([n,l]) => (
              <div key={l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:'32px', fontWeight:800, color:'var(--accent2)', lineHeight:1, fontFamily:"'Syne',sans-serif" }}>{n}</div>
                <div style={{ fontSize:'13px', color:'#d0d0e8', marginTop:'6px' }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:'60px', padding:'40px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'20px', textAlign:'center' }}>
            <h2 style={{ fontSize:'22px', fontWeight:800, color:'#ffffff', marginBottom:'10px' }}>Why Choose PDFForge?</h2>
            <p style={{ fontSize:'14px', color:'#b0b0cc', marginBottom:'32px' }}>Built for privacy, speed, and simplicity.</p>
            <div style={{ display:'flex', gap:'32px', justifyContent:'center', flexWrap:'wrap' }}>
              {[['🔒','Private by Default','Files deleted immediately after processing.'],['⚡','Fast Processing','Server-side for large files.'],['🆓','Always Free','No accounts, no subscriptions.'],['🌐','Works Everywhere','Any modern browser.']].map(([icon,title,desc]) => (
                <div key={title} style={{ maxWidth:'180px' }}>
                  <div style={{ fontSize:'28px', marginBottom:'10px' }}>{icon}</div>
                  <div style={{ fontSize:'14px', fontWeight:700, color:'#ffffff', marginBottom:'6px' }}>{title}</div>
                  <div style={{ fontSize:'12px', color:'#b0b0cc', lineHeight:1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </>)}
      </main>

      <footer style={{ borderTop:'1px solid var(--border)', padding:'28px 40px', background:'var(--bg)' }}>
        <div style={{ maxWidth:'1200px', margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ width:'24px', height:'24px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'6px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px' }}>✦</div>
            <span style={{ fontSize:'14px', fontWeight:700, color:'#ffffff' }}>PDFForge</span>
            <span style={{ fontSize:'12px', color:'#b0b0cc', marginLeft:'8px' }}>© 2025</span>
          </div>
          <div style={{ display:'flex', gap:'24px' }}>
            {['Privacy Policy','Terms of Use','Contact'].map(l => (
              <a key={l} href="#" style={{ fontSize:'12px', color:'#b0b0cc', textDecoration:'none' }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
