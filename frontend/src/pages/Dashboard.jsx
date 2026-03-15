import React, { useState } from 'react'
import { ArrowRight, Zap, Shield, Star } from 'lucide-react'

const TOOLS = [
  // ── FEATURED ──
  {
    id:'editor', featured:true, tag:'★ MOST POPULAR',
    icon:'✦', label:'Resume Editor',
    desc:'Edit PDF text directly on the page. Preserves original fonts, spacing, bullets and layout. Click any text to edit it instantly.',
    color:'#6c63ff', bg:'rgba(108,99,255,0.12)', border:'rgba(108,99,255,0.4)',
    category:'all',
    perks:['Preserves original layout','Click any text to edit','AI-powered suggestions','Export instantly'],
  },
  // ── ORGANIZE ──
  { id:'merge',     icon:'⊕', label:'Merge PDF',       desc:'Combine multiple PDFs into one document.',                   color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'split',     icon:'⊘', label:'Split PDF',        desc:'Split by page range. Select pages visually.',               color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'extract',   icon:'⬡', label:'Extract Pages',    desc:'Pull specific pages out into a new PDF.',                   color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'rotate',    icon:'↻', label:'Rotate Pages',     desc:'Rotate one or all pages 90°, 180°, or 270°.',              color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'delete',    icon:'⊗', label:'Delete Pages',     desc:'Remove unwanted pages from your PDF.',                      color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'organize' },
  { id:'duplicate', icon:'⧉', label:'Duplicate Page',   desc:'Duplicate any page and insert it after the original.',     color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'crop',      icon:'⬚', label:'Crop PDF',          desc:'Trim margins from all pages.',                              color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  // ── CONVERT TO PDF ──
  { id:'image-to-pdf', icon:'📄', label:'Images → PDF',     desc:'Convert JPG/PNG images to a single PDF.',              color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'word-to-pdf',  icon:'📋', label:'Word → PDF',        desc:'Convert .docx documents to PDF.',                      color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'pptx-to-pdf',  icon:'📊', label:'PowerPoint → PDF',  desc:'Convert .pptx presentations to PDF.',                  color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'xlsx-to-pdf',  icon:'📈', label:'Excel → PDF',        desc:'Convert .xlsx spreadsheets to PDF.',                   color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'html-to-pdf',  icon:'🌐', label:'HTML → PDF',         desc:'Convert HTML web pages to PDF.',                       color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  // ── CONVERT FROM PDF ──
  { id:'images',      icon:'🖼', label:'PDF → Images',     desc:'Convert each page to PNG. Download as ZIP.',             color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-jpg',  icon:'🖼', label:'PDF → JPG',         desc:'Export PDF pages as JPG images (ZIP).',                  color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-word', icon:'📝', label:'PDF → Word',        desc:'Convert PDF text to an editable .docx file.',            color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pptx', icon:'📊', label:'PDF → PowerPoint',  desc:'Convert PDF pages to PowerPoint slides.',               color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-xlsx', icon:'📈', label:'PDF → Excel',        desc:'Extract PDF content into a spreadsheet.',               color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pdfa', icon:'📄', label:'PDF → PDF/A',        desc:'Convert to archive-standard PDF/A format.',             color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  // ── OPTIMIZE ──
  { id:'compress',  icon:'⬡', label:'Compress PDF',   desc:'Reduce file size while maintaining quality.',                 color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'repair',    icon:'⚙', label:'Repair PDF',     desc:'Fix corrupted or broken PDF files.',                          color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  // ── ENHANCE ──
  { id:'watermark',   icon:'◈', label:'Watermark',       desc:'Add text watermark with live preview.',                    color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'pagenums',    icon:'◎', label:'Page Numbers',    desc:'Add page numbers to every page.',                          color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'stamp',       icon:'◆', label:'Stamp',           desc:'Add APPROVED/DRAFT/CONFIDENTIAL stamps.',                  color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'findreplace', icon:'⌕', label:'Find & Replace',  desc:'Search and replace text across entire PDF.',               color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'enhance' },
  // ── SECURITY ──
  { id:'protect', icon:'🔐', label:'Protect PDF',  desc:'Add a password to your PDF.',                                    color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'unlock',  icon:'🔓', label:'Unlock PDF',   desc:'Remove password protection from PDF.',                           color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'redact',  icon:'⬛', label:'Redact Text',  desc:'Permanently black out sensitive text.',                          color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'security' },
]

const CATEGORIES = [
  { id:'all',      label:'All Tools' },
  { id:'organize', label:'Organize' },
  { id:'convert',  label:'Convert' },
  { id:'optimize', label:'Optimize' },
  { id:'enhance',  label:'Enhance' },
  { id:'security', label:'Security' },
]

function ToolCard({ tool, onClick }) {
  return (
    <div
      onClick={() => onClick(tool.id)}
      style={{
        background:   tool.featured
          ? 'linear-gradient(135deg, rgba(108,99,255,0.18), rgba(232,121,249,0.1))'
          : tool.bg,
        border:       `1px solid ${tool.border}`,
        borderRadius: '16px',
        padding:      tool.featured ? '26px' : '20px',
        cursor:       'pointer',
        transition:   'transform 0.15s, box-shadow 0.15s',
        position:     'relative',
        overflow:     'hidden',
        gridColumn:   tool.featured ? 'span 2' : 'span 1',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)' }}
      onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='' }}
    >
      {tool.featured && (
        <div style={{ position:'absolute', top:'-60px', right:'-60px', width:'200px', height:'200px', background:'radial-gradient(circle, rgba(108,99,255,0.15) 0%, transparent 70%)', pointerEvents:'none' }}/>
      )}

      {tool.tag && (
        <div style={{ display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'10px', fontWeight:700, letterSpacing:'.08em', color:'#fff', background:'linear-gradient(135deg,#6c63ff,#e879f9)', padding:'3px 10px', borderRadius:'999px', marginBottom:'12px' }}>
          {tool.tag}
        </div>
      )}

      <div style={{ display:'flex', alignItems:'flex-start', gap:'14px' }}>
        <div style={{ width:tool.featured?'46px':'38px', height:tool.featured?'46px':'38px', borderRadius:'11px', background:`rgba(108,99,255,0.1)`, border:`1px solid ${tool.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:tool.featured?'22px':'17px', flexShrink:0, color:tool.color }}>
          {tool.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'5px' }}>
            <h3 style={{ fontSize:tool.featured?'17px':'14px', fontWeight:700, color:'#eeeef5' }}>{tool.label}</h3>
            <ArrowRight size={13} color="#5a5a78"/>
          </div>
          <p style={{ fontSize:'12px', color:'#9898b8', lineHeight:1.6 }}>{tool.desc}</p>
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
      <span style={{ fontSize:'12px', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'#9898b8' }}>
        {label}
      </span>
      <div style={{ flex:1, height:'1px', background:'#252538' }}/>
    </div>
  )
}

export default function Dashboard({ onSelectTool }) {
  const [cat, setCat] = useState('all')

  const renderTools = () => {
    if (cat === 'convert') {
      const toTools   = TOOLS.filter(t => t.category === 'convert' && t.sub === 'to')
      const fromTools = TOOLS.filter(t => t.category === 'convert' && t.sub === 'from')
      return (
        <>
          <SectionHeading label="Convert to PDF" />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px', marginBottom:'32px' }}>
            {toTools.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
          </div>
          <SectionHeading label="Convert from PDF" />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
            {fromTools.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
          </div>
        </>
      )
    }

    const visible = cat === 'all'
      ? TOOLS
      : TOOLS.filter(t => t.featured || t.category === cat)

    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
        {visible.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool}/>)}
      </div>
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
        <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#5a5a78' }}>
          <Shield size={12} color="#3ecf8e"/> Files auto-deleted after processing
        </div>
      </header>

      <main style={{ maxWidth:'1200px', margin:'0 auto', padding:'56px 24px' }}>

        {/* ── Hero — keep from new theme ── */}
        <div style={{ textAlign:'center', marginBottom:'48px' }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:'7px', fontSize:'11px', letterSpacing:'.12em', textTransform:'uppercase', color:'#9d97ff', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.2)', padding:'5px 18px', borderRadius:'999px', marginBottom:'22px' }}>
            <Zap size={11}/> {TOOLS.length - 1} PDF Tools — All Free
          </div>
          <h1 style={{ fontSize:'54px', fontWeight:800, lineHeight:1.07, letterSpacing:'-0.03em', marginBottom:'16px', color:'#eeeef5', fontFamily:"'Syne', sans-serif" }}>
            All your PDF tools,<br/>
            <span style={{ background:'linear-gradient(135deg,#6c63ff,#e879f9)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              one place.
            </span>
          </h1>
          <p style={{ fontSize:'16px', color:'#9898b8', maxWidth:'500px', margin:'0 auto', lineHeight:1.75 }}>
            Edit, merge, split, compress, protect, watermark — and the best PDF resume editor on the web.
          </p>
        </div>

        {/* Category filter */}
        <div style={{ display:'flex', gap:'8px', justifyContent:'center', marginBottom:'40px', flexWrap:'wrap' }}>
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

        {/* Tool grid */}
        {renderTools()}

        {/* Stats */}
        <div style={{ display:'flex', gap:'48px', justifyContent:'center', marginTop:'60px', paddingTop:'40px', borderTop:'1px solid #252538', flexWrap:'wrap' }}>
          {[['29+','PDF Tools'],['100%','Free to use'],['50MB','Max file size'],['0','Data stored']].map(([n,l]) => (
            <div key={l} style={{ textAlign:'center' }}>
              <div style={{ fontSize:'32px', fontWeight:800, color:'#9d97ff', lineHeight:1, fontFamily:"'Syne',sans-serif" }}>{n}</div>
              <div style={{ fontSize:'13px', color:'#5a5a78', marginTop:'6px' }}>{l}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
