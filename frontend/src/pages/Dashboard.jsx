import React, { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowRight, Zap, Shield, Search, X, ChevronDown, Moon, Sun, Lock, Trash2, Smartphone, Globe } from 'lucide-react'

const TOOLS = [
  { id:'editor', featured:true, tag:'★ MOST POPULAR', icon:'✦', label:'Resume Editor', desc:'Edit PDF text directly on the page. Preserves original fonts, spacing, bullets and layout. Click any text to edit it instantly.', color:'#6c63ff', bg:'rgba(108,99,255,0.12)', border:'rgba(108,99,255,0.4)', category:'all', perks:['Preserves original layout','Click any text to edit','AI-powered suggestions','Export instantly'] },
  { id:'merge',        icon:'⊕', label:'Merge PDF',        desc:'Combine multiple PDFs into one document.',                  color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'split',        icon:'⊘', label:'Split PDF',         desc:'Split by page range. Select pages visually.',              color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'extract',      icon:'⬡', label:'Extract Pages',     desc:'Pull specific pages out into a new PDF.',                  color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'rotate',       icon:'↻', label:'Rotate Pages',      desc:'Rotate one or all pages 90°, 180°, or 270°.',             color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'delete',       icon:'⊗', label:'Delete Pages',      desc:'Remove unwanted pages from your PDF.',                     color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'organize' },
  { id:'duplicate',    icon:'⧉', label:'Duplicate Page',    desc:'Duplicate any page and insert it after the original.',    color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'crop',         icon:'⬚', label:'Crop PDF',           desc:'Trim margins from all pages.',                             color:'#3ecf8e', bg:'rgba(62,207,142,0.08)',  border:'rgba(62,207,142,0.25)',  category:'organize' },
  { id:'image-to-pdf', icon:'📄', label:'Images → PDF',     desc:'Convert JPG/PNG images to a single PDF.',                 color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'word-to-pdf',  icon:'📋', label:'Word → PDF',        desc:'Convert .docx documents to PDF.',                         color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'pptx-to-pdf',  icon:'📊', label:'PowerPoint → PDF',  desc:'Convert .pptx presentations to PDF.',                    color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'xlsx-to-pdf',  icon:'📈', label:'Excel → PDF',        desc:'Convert .xlsx spreadsheets to PDF.',                     color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'html-to-pdf',  icon:'🌐', label:'HTML → PDF',         desc:'Convert HTML web pages to PDF.',                         color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'convert', sub:'to' },
  { id:'images',       icon:'🖼', label:'PDF → Images',      desc:'Convert each page to PNG. Download as ZIP.',              color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-jpg',   icon:'🖼', label:'PDF → JPG',          desc:'Export PDF pages as JPG images (ZIP).',                   color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-word',  icon:'📝', label:'PDF → Word',         desc:'Convert PDF text to an editable .docx file.',             color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pptx',  icon:'📊', label:'PDF → PowerPoint',   desc:'Convert PDF pages to PowerPoint slides.',                color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-xlsx',  icon:'📈', label:'PDF → Excel',         desc:'Extract PDF content into a spreadsheet.',                color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'pdf-to-pdfa',  icon:'📄', label:'PDF → PDF/A',         desc:'Convert to archive-standard PDF/A format.',              color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'convert', sub:'from' },
  { id:'compress',     icon:'⬡', label:'Compress PDF',        desc:'Reduce file size while maintaining quality.',              color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'repair',       icon:'⚙', label:'Repair PDF',          desc:'Fix corrupted or broken PDF files.',                      color:'#f5a623', bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.25)',  category:'optimize' },
  { id:'watermark',    icon:'◈', label:'Watermark',            desc:'Add text watermark with live preview.',                   color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'pagenums',     icon:'◎', label:'Page Numbers',         desc:'Add page numbers to every page.',                         color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'stamp',        icon:'◆', label:'Stamp',                desc:'Add APPROVED/DRAFT/CONFIDENTIAL stamps.',                 color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'enhance' },
  { id:'findreplace',  icon:'⌕', label:'Find & Replace',       desc:'Search and replace text across entire PDF.',              color:'#9d97ff', bg:'rgba(157,151,255,0.08)', border:'rgba(157,151,255,0.25)', category:'enhance' },
  { id:'protect',      icon:'🔐', label:'Protect PDF',          desc:'Add a password to your PDF.',                             color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'unlock',       icon:'🔓', label:'Unlock PDF',           desc:'Remove password protection from PDF.',                    color:'#e879f9', bg:'rgba(232,121,249,0.08)', border:'rgba(232,121,249,0.25)', category:'security' },
  { id:'redact',       icon:'⬛', label:'Redact Text',          desc:'Permanently black out sensitive text.',                   color:'#e5534b', bg:'rgba(229,83,75,0.08)',   border:'rgba(229,83,75,0.25)',   category:'security' },
]

const CATEGORIES = [
  { id:'all', label:'All Tools' },
  { id:'organize', label:'Organize' },
  { id:'convert', label:'Convert' },
  { id:'optimize', label:'Optimize' },
  { id:'enhance', label:'Enhance' },
  { id:'security', label:'Security' },
]

const TOP_TOOLS = ['editor','merge','split','compress','watermark','protect','pdf-to-word','word-to-pdf']

// ── Global Dropzone Overlay ──────────────────────────────────────────────────
function GlobalDropzone({ onDrop, visible }) {
  if (!visible) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:999, background:'rgba(13,13,20,0.93)', backdropFilter:'blur(8px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'32px' }}>
      <div style={{ fontSize:'48px' }}>📄</div>
      <h2 style={{ fontSize:'28px', fontWeight:800, color:'#eeeef5', fontFamily:"'Syne',sans-serif", margin:0 }}>What would you like to do?</h2>
      <p style={{ color:'#9898b8', fontSize:'14px', margin:0 }}>Drop your file or pick a tool below</p>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'12px', justifyContent:'center', maxWidth:'600px' }}>
        {[
          { id:'merge', icon:'⊕', label:'Merge' },
          { id:'compress', icon:'⬡', label:'Compress' },
          { id:'editor', icon:'✦', label:'Edit' },
          { id:'watermark', icon:'◈', label:'Watermark' },
          { id:'split', icon:'⊘', label:'Split' },
          { id:'protect', icon:'🔐', label:'Protect' },
          { id:'pdf-to-word', icon:'📝', label:'To Word' },
          { id:'stamp', icon:'◆', label:'Stamp' },
        ].map(t => (
          <button key={t.id} onClick={() => onDrop(t.id)}
            style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 22px', background:'rgba(108,99,255,0.12)', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'14px', cursor:'pointer', color:'#eeeef5', fontSize:'13px', fontWeight:600, minWidth:'80px', transition:'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(108,99,255,0.25)'; e.currentTarget.style.transform='translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(108,99,255,0.12)'; e.currentTarget.style.transform='' }}>
            <span style={{ fontSize:'24px' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Tool Card ────────────────────────────────────────────────────────────────
function ToolCard({ tool, onClick, dark }) {
  const cardBg = dark
    ? (tool.featured ? 'linear-gradient(135deg, rgba(108,99,255,0.18), rgba(232,121,249,0.1))' : tool.bg)
    : (tool.featured ? 'linear-gradient(135deg, rgba(108,99,255,0.1), rgba(232,121,249,0.06))' : tool.bg.replace('0.08','0.05').replace('0.12','0.07'))

  return (
    <div onClick={() => onClick(tool.id)}
      style={{ background:cardBg, border:`1px solid ${tool.border}`, borderRadius:'16px', padding:tool.featured?'26px':'20px', cursor:'pointer', transition:'transform 0.15s, box-shadow 0.15s', position:'relative', overflow:'hidden', gridColumn:tool.featured?'span 2':'span 1' }}
      onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 12px 36px rgba(0,0,0,0.25)' }}
      onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='' }}>
      {tool.featured && <div style={{ position:'absolute', top:'-60px', right:'-60px', width:'200px', height:'200px', background:'radial-gradient(circle, rgba(108,99,255,0.15) 0%, transparent 70%)', pointerEvents:'none' }}/>}
      {tool.tag && (
        <div style={{ display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'10px', fontWeight:700, letterSpacing:'.08em', color:'#fff', background:'linear-gradient(135deg,#6c63ff,#e879f9)', padding:'3px 10px', borderRadius:'999px', marginBottom:'12px' }}>{tool.tag}</div>
      )}
      <div style={{ display:'flex', alignItems:'flex-start', gap:'14px' }}>
        <div style={{ width:tool.featured?'46px':'38px', height:tool.featured?'46px':'38px', borderRadius:'11px', background:`rgba(108,99,255,0.1)`, border:`1px solid ${tool.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:tool.featured?'22px':'17px', flexShrink:0, color:tool.color }}>{tool.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'5px' }}>
            <h3 style={{ fontSize:tool.featured?'17px':'14px', fontWeight:700, color: dark ? '#eeeef5' : '#1a1a2e' }}>{tool.label}</h3>
            <ArrowRight size={13} color="#5a5a78"/>
          </div>
          <p style={{ fontSize:'12px', color: dark ? '#9898b8' : '#6b6b8a', lineHeight:1.6 }}>{tool.desc}</p>
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

function SectionHeading({ label, dark }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'16px', marginTop:'8px' }}>
      <span style={{ fontSize:'12px', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color: dark ? '#9898b8' : '#8888a8' }}>{label}</span>
      <div style={{ flex:1, height:'1px', background: dark ? '#252538' : '#e0e0ee' }}/>
    </div>
  )
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard({ onSelectTool }) {
  const [cat,         setCat]         = useState('all')
  const [search,      setSearch]      = useState('')
  const [dark,        setDark]        = useState(true)
  const [showAll,     setShowAll]     = useState(false)
  const [dragOver,    setDragOver]    = useState(false)
  const [showDropzone, setShowDropzone] = useState(false)
  const searchRef = useRef(null)

  // Global drag detection
  useEffect(() => {
    const onDragEnter = e => { if (e.dataTransfer?.types?.includes('Files')) setShowDropzone(true) }
    const onDragLeave = e => { if (!e.relatedTarget) setShowDropzone(false) }
    const onDrop      = e => { e.preventDefault(); setShowDropzone(false) }
    const onDragOver  = e => { e.preventDefault() }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [])

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    const handler = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const bg       = dark ? '#0d0d14' : '#f4f4fb'
  const headerBg = dark ? 'rgba(13,13,20,0.97)' : 'rgba(244,244,251,0.97)'
  const border   = dark ? '#252538' : '#e0e0ee'
  const text     = dark ? '#eeeef5' : '#1a1a2e'
  const text2    = dark ? '#9898b8' : '#6b6b8a'
  const inputBg  = dark ? '#13131e' : '#ffffff'

  const filterTools = (tools) => {
    if (!search.trim()) return tools
    const q = search.toLowerCase()
    return tools.filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.category.includes(q))
  }

  const renderTools = () => {
    const isSearching = search.trim().length > 0

    if (isSearching) {
      const results = filterTools(TOOLS)
      return results.length === 0
        ? <div style={{ textAlign:'center', padding:'60px 0', color:text2 }}>No tools found for "{search}"</div>
        : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
            {results.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool} dark={dark}/>)}
          </div>
    }

    if (cat === 'convert') {
      const toTools   = TOOLS.filter(t => t.category === 'convert' && t.sub === 'to')
      const fromTools = TOOLS.filter(t => t.category === 'convert' && t.sub === 'from')
      return (
        <>
          <SectionHeading label="Convert to PDF" dark={dark}/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px', marginBottom:'32px' }}>
            {toTools.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool} dark={dark}/>)}
          </div>
          <SectionHeading label="Convert from PDF" dark={dark}/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
            {fromTools.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool} dark={dark}/>)}
          </div>
        </>
      )
    }

    const all = cat === 'all' ? TOOLS : TOOLS.filter(t => t.featured || t.category === cat)

    if (cat === 'all' && !showAll) {
      const top = TOOLS.filter(t => TOP_TOOLS.includes(t.id))
      return (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px', marginBottom:'20px' }}>
            {top.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool} dark={dark}/>)}
          </div>
          <div style={{ textAlign:'center' }}>
            <button onClick={() => setShowAll(true)}
              style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'10px 24px', background:'transparent', border:`1px solid ${border}`, borderRadius:'999px', color:text2, fontSize:'13px', cursor:'pointer', transition:'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#6c63ff'; e.currentTarget.style.color='#9d97ff' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=border; e.currentTarget.style.color=text2 }}>
              <ChevronDown size={14}/> See all {TOOLS.length - 1} tools
            </button>
          </div>
        </>
      )
    }

    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(270px, 1fr))', gap:'14px' }}>
        {all.map(t => <ToolCard key={t.id} tool={t} onClick={onSelectTool} dark={dark}/>)}
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:bg, transition:'background 0.3s' }}>

      <GlobalDropzone visible={showDropzone} onDrop={(id) => { setShowDropzone(false); onSelectTool(id) }}/>

      {/* ── Header ── */}
      <header style={{ borderBottom:`1px solid ${border}`, padding:'0 40px', height:'58px', display:'flex', alignItems:'center', justifyContent:'space-between', background:headerBg, backdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50, transition:'background 0.3s' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <div style={{ width:'32px', height:'32px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' }}>✦</div>
          <span style={{ fontSize:'18px', fontWeight:800, color:text, letterSpacing:'-0.02em', fontFamily:"'Syne', sans-serif" }}>PDFForge</span>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:text2 }}>
            <Shield size={12} color="#3ecf8e"/> Files auto-deleted after processing
          </div>

          {/* Dark mode toggle */}
          <button onClick={() => setDark(d => !d)}
            style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 12px', background: dark ? '#1e1e2e' : '#e8e8f4', border:`1px solid ${border}`, borderRadius:'999px', cursor:'pointer', fontSize:'12px', color:text2, transition:'all 0.2s' }}>
            {dark ? <><Sun size={12}/> Light</> : <><Moon size={12}/> Dark</>}
          </button>
        </div>
      </header>

      <main style={{ maxWidth:'1200px', margin:'0 auto', padding:'56px 24px' }}>

        {/* ── Hero ── */}
        <div style={{ textAlign:'center', marginBottom:'48px' }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:'7px', fontSize:'11px', letterSpacing:'.12em', textTransform:'uppercase', color:'#9d97ff', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.2)', padding:'5px 18px', borderRadius:'999px', marginBottom:'22px' }}>
            <Zap size={11}/> {TOOLS.length - 1} PDF Tools — All Free
          </div>
          <h1 style={{ fontSize:'54px', fontWeight:800, lineHeight:1.07, letterSpacing:'-0.03em', marginBottom:'16px', color:text, fontFamily:"'Syne', sans-serif" }}>
            All your PDF tools,<br/>
            <span style={{ background:'linear-gradient(135deg,#6c63ff,#e879f9)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              one place.
            </span>
          </h1>
          <p style={{ fontSize:'16px', color:text2, maxWidth:'500px', margin:'0 auto', lineHeight:1.75 }}>
            Edit, merge, split, compress, protect, watermark — and the best PDF resume editor on the web.
          </p>
        </div>

        {/* ── Search Bar ── */}
        <div style={{ maxWidth:'520px', margin:'0 auto 32px', position:'relative' }}>
          <Search size={15} style={{ position:'absolute', left:'14px', top:'50%', transform:'translateY(-50%)', color:text2, pointerEvents:'none' }}/>
          <input
            ref={searchRef}
            value={search}
            onChange={e => { setSearch(e.target.value); setShowAll(true) }}
            placeholder="Search tools… (Ctrl+K)"
            style={{ width:'100%', background:inputBg, color:text, border:`1px solid ${border}`, borderRadius:'12px', padding:'12px 40px 12px 40px', fontSize:'14px', outline:'none', boxSizing:'border-box', transition:'border-color 0.2s', boxShadow: dark ? 'none' : '0 2px 12px rgba(0,0,0,0.06)' }}
            onFocus={e => e.target.style.borderColor='#6c63ff'}
            onBlur={e => e.target.style.borderColor=border}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position:'absolute', right:'12px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:text2, display:'flex', alignItems:'center' }}>
              <X size={14}/>
            </button>
          )}
        </div>

        {/* ── Category Filter (sticky) ── */}
        <div style={{ position:'sticky', top:'58px', zIndex:40, background:bg, paddingTop:'12px', paddingBottom:'12px', marginBottom:'28px', transition:'background 0.3s' }}>
          <div style={{ display:'flex', gap:'8px', justifyContent:'center', flexWrap:'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => { setCat(c.id); setSearch(''); if(c.id !== 'all') setShowAll(true) }}
                style={{ fontSize:'13px', fontWeight:500, padding:'7px 18px', borderRadius:'999px', border:`1px solid ${cat===c.id ? '#6c63ff' : border}`, background: cat===c.id ? 'rgba(108,99,255,0.15)' : inputBg, color: cat===c.id ? '#9d97ff' : text2, cursor:'pointer', transition:'all 0.15s' }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tool Grid ── */}
        {renderTools()}

        {/* ── Trust Section ── */}
        <div style={{ marginTop:'64px', padding:'40px', background: dark ? 'rgba(108,99,255,0.06)' : 'rgba(108,99,255,0.04)', border:`1px solid ${dark ? 'rgba(108,99,255,0.2)' : 'rgba(108,99,255,0.15)'}`, borderRadius:'20px' }}>
          <h3 style={{ textAlign:'center', fontSize:'20px', fontWeight:800, color:text, marginBottom:'8px', fontFamily:"'Syne',sans-serif" }}>Why Choose MyPDFForge?</h3>
          <p style={{ textAlign:'center', color:text2, fontSize:'13px', marginBottom:'32px' }}>Trusted by thousands of users worldwide</p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:'24px' }}>
            {[
              { icon:<Lock size={20} color="#3ecf8e"/>, title:'Secure Processing', desc:'All files are encrypted in transit and never stored on our servers.' },
              { icon:<Trash2 size={20} color="#f5a623"/>, title:'Auto-Deleted', desc:'Your files are automatically deleted after processing is complete.' },
              { icon:<Globe size={20} color="#9d97ff"/>, title:'No Installation', desc:'Works entirely in your browser — no downloads or accounts needed.' },
              { icon:<Smartphone size={20} color="#e879f9"/>, title:'Mobile Friendly', desc:'Works seamlessly on phones and tablets as well as desktop.' },
            ].map(item => (
              <div key={item.title} style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:'10px' }}>
                <div style={{ width:'44px', height:'44px', borderRadius:'12px', background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', display:'flex', alignItems:'center', justifyContent:'center' }}>{item.icon}</div>
                <span style={{ fontSize:'14px', fontWeight:700, color:text }}>{item.title}</span>
                <span style={{ fontSize:'12px', color:text2, lineHeight:1.6 }}>{item.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Stats ── */}
        <div style={{ display:'flex', gap:'48px', justifyContent:'center', marginTop:'60px', paddingTop:'40px', borderTop:`1px solid ${border}`, flexWrap:'wrap' }}>
          {[['29+','PDF Tools'],['100%','Free to use'],['50MB','Max file size'],['0','Data stored']].map(([n,l]) => (
            <div key={l} style={{ textAlign:'center' }}>
              <div style={{ fontSize:'32px', fontWeight:800, color:'#9d97ff', lineHeight:1, fontFamily:"'Syne',sans-serif" }}>{n}</div>
              <div style={{ fontSize:'13px', color:text2, marginTop:'6px' }}>{l}</div>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer style={{ borderTop:`1px solid ${border}`, padding:'48px 40px 32px', background: dark ? 'rgba(13,13,20,0.98)' : 'rgba(244,244,251,0.98)', transition:'background 0.3s' }}>
        <div style={{ maxWidth:'1200px', margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:'48px', marginBottom:'40px' }}>

            {/* Brand */}
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px' }}>
                <div style={{ width:'32px', height:'32px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' }}>✦</div>
                <span style={{ fontSize:'18px', fontWeight:800, color:text, fontFamily:"'Syne',sans-serif" }}>PDFForge</span>
              </div>
              <p style={{ fontSize:'13px', color:text2, lineHeight:1.8, maxWidth:'280px' }}>
                The complete PDF toolkit. Edit, convert, compress, protect — all in your browser, all for free.
              </p>
            </div>

            {/* Tools links */}
            <div>
              <p style={{ fontSize:'12px', fontWeight:700, color:text, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:'16px' }}>Tools</p>
              {['Edit PDF','Merge PDF','Split PDF','Compress PDF','Watermark'].map(l => (
                <p key={l} style={{ fontSize:'13px', color:text2, marginBottom:'10px', cursor:'pointer' }}
                  onMouseEnter={e => e.target.style.color='#9d97ff'}
                  onMouseLeave={e => e.target.style.color=text2}>{l}</p>
              ))}
            </div>

            {/* Company links */}
            <div>
              <p style={{ fontSize:'12px', fontWeight:700, color:text, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:'16px' }}>Company</p>
              {['About','Privacy Policy','Contact'].map(l => (
                <p key={l} style={{ fontSize:'13px', color:text2, marginBottom:'10px', cursor:'pointer' }}
                  onMouseEnter={e => e.target.style.color='#9d97ff'}
                  onMouseLeave={e => e.target.style.color=text2}>{l}</p>
              ))}
            </div>
          </div>

          <div style={{ borderTop:`1px solid ${border}`, paddingTop:'24px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
            <p style={{ fontSize:'12px', color:text2 }}>© 2025 MyPDFForge. All rights reserved.</p>
            <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:text2 }}>
              <Shield size={12} color="#3ecf8e"/> Secure · Private · Free
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
