import React, { useEffect, useRef, useState } from 'react'

const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

export default function PDFEditor({ sessionId, pages: initialPages, onBlocksChange }) {
  const [pages,       setPages]       = useState(initialPages)
  const [scale,       setScale]       = useState(1.2)
  const [popup,       setPopup]       = useState(null)
  const [inputVal,    setInputVal]    = useState('')
  const [pdfReady,    setPdfReady]    = useState(false)
  const [totalBlocks, setTotalBlocks] = useState(0)
  const canvasRefs = useRef({})
  const ctxRefs    = useRef({})
  const pdfDocRef  = useRef(null)
  const textareaRef = useRef(null)
  const scaleRef   = useRef(scale)

  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    const lib = window.pdfjsLib
    if (!lib) return
    lib.GlobalWorkerOptions.workerSrc = WORKER
    lib.getDocument(`/api/upload/pdf/${sessionId}`).promise
      .then(doc => { pdfDocRef.current = doc; renderAll(doc, scale) })
  }, [sessionId])

  useEffect(() => {
    if (pdfDocRef.current) renderAll(pdfDocRef.current, scale)
  }, [scale])

  useEffect(() => {
    setTotalBlocks(pages.reduce((s, p) => s + p.blocks.length, 0))
  }, [pages])

  const renderAll = async (doc, sc) => {
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n)
      const vp = pg.getViewport({ scale: sc })
      const cv = canvasRefs.current[n]
      if (!cv) continue
      cv.width  = Math.floor(vp.width)
      cv.height = Math.floor(vp.height)
      const ctx = cv.getContext('2d')
      ctxRefs.current[n] = ctx
      await pg.render({ canvasContext: ctx, viewport: vp }).promise
    }
    setPdfReady(true)
  }

  // Draw wrapped text on canvas, returns total height used
  const redrawBlock = (pageNum, block, newText, sc) => {
    const ctx = ctxRefs.current[pageNum]
    const cv  = canvasRefs.current[pageNum]
    if (!ctx || !cv) return

    const px    = v => v * sc
    const x0    = px(block.x0)
    const y0    = px(block.y0)
    const fs    = block.fontSize * sc
    const lh    = fs * 1.35
    // Max width = from block's x0 to right margin of page
    const pageW = cv.width
    const maxW  = pageW - x0 - (px(36))  // 36pt right margin

    // Font string
    let fontStr = `${fs}px Calibri, Arial, sans-serif`
    if (block.bold && block.italic) fontStr = `italic bold ${fs}px Calibri, Arial, sans-serif`
    else if (block.bold)            fontStr = `bold ${fs}px Calibri, Arial, sans-serif`
    else if (block.italic)          fontStr = `italic ${fs}px Calibri, Arial, sans-serif`

    ctx.font = fontStr

    // Word-wrap the text
    const allLines = []
    for (const para of newText.split('\n')) {
      if (!para.trim()) { allLines.push(''); continue }
      const words = para.split(' ')
      let cur = ''
      for (const word of words) {
        const test = cur ? cur + ' ' + word : word
        if (ctx.measureText(test).width <= maxW) {
          cur = test
        } else {
          if (cur) allLines.push(cur)
          cur = word
        }
      }
      if (cur) allLines.push(cur)
    }

    // White out original area + extra for wrapped lines
    const whiteH = Math.max(
      px(block.height) + 4,
      allLines.length * lh + 4
    )
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x0 - 2, y0 - 2, maxW + 4, whiteH + 4)

    // Draw each wrapped line
    ctx.fillStyle = '#000000'
    ctx.textBaseline = 'top'
    allLines.forEach((line, i) => {
      if (line) ctx.fillText(line, x0, y0 + i * lh)
    })
  }

  const px = v => v * scale

  const openPopup = (block, pageIdx) => {
    setPopup({ block, pageIdx })
    setInputVal(block.text)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        // Put cursor at end
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    }, 60)
  }

  const saveEdit = () => {
    if (!popup) return
    const { block, pageIdx } = popup
    const newVal = inputVal
    setPages(prev => {
      const next = prev.map((pg, pi) => pi !== pageIdx ? pg : {
        ...pg,
        blocks: pg.blocks.map(b =>
          b.id === block.id ? { ...b, text: newVal, changed: newVal !== b.original } : b
        )
      })
      onBlocksChange(next.flatMap(p => p.blocks))
      return next
    })
    redrawBlock(block.page, block, newVal, scaleRef.current)
    setPopup(null)
  }

  // Auto-resize textarea height
  const autoResize = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  return (
    <>
      {/* POPUP */}
      {popup && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setPopup(null) }}
          style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background:'#1e1e28', border:'2px solid #6c63ff', borderRadius:'16px', padding:'28px', width:'520px', maxWidth:'92vw', boxShadow:'0 24px 80px rgba(0,0,0,0.9)' }}>

            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
              <span style={{ fontSize:'16px', fontWeight:700, color:'#eeeef2' }}>✎ Edit Text</span>
              <button onClick={() => setPopup(null)} style={{ background:'none', border:'none', color:'#9898b0', cursor:'pointer', fontSize:'22px' }}>×</button>
            </div>

            {/* Original */}
            <div style={{ fontSize:'12px', color:'#5a5a70', marginBottom:'6px' }}>Original:</div>
            <div style={{ fontSize:'13px', color:'#9898b0', background:'#111118', borderRadius:'8px', padding:'10px 14px', marginBottom:'18px', fontFamily:'Calibri,Arial,sans-serif', fontWeight: popup.block.bold ? 700 : 400, wordBreak:'break-word', whiteSpace:'pre-wrap' }}>
              {popup.block.original}
            </div>

            {/* Textarea — Enter = new line, Ctrl+Enter = save */}
            <div style={{ fontSize:'12px', color:'#9d97ff', marginBottom:'8px', fontWeight:600 }}>✏ Your edit:</div>
            <textarea
              ref={textareaRef}
              value={inputVal}
              onChange={e => { setInputVal(e.target.value); autoResize(e.target) }}
              onKeyDown={e => {
                // Ctrl+Enter OR Cmd+Enter = save
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  saveEdit()
                }
                // Esc = cancel
                if (e.key === 'Escape') setPopup(null)
                // Plain Enter = new line (default textarea behavior — do nothing)
              }}
              rows={3}
              style={{
                width:'100%', fontSize:'14px',
                fontWeight: popup.block.bold   ? 700 : 400,
                fontStyle:  popup.block.italic ? 'italic' : 'normal',
                fontFamily: 'Calibri,Arial,sans-serif',
                color:'#fff', background:'#111118',
                border:'2px solid #6c63ff', borderRadius:'10px',
                padding:'12px 16px', outline:'none',
                marginBottom:'12px', boxSizing:'border-box',
                boxShadow:'0 0 0 4px rgba(108,99,255,0.2)',
                resize:'vertical', lineHeight:'1.5',
                minHeight:'52px',
              }}
            />

            {/* Hint */}
            <p style={{ fontSize:'11px', color:'#5a5a70', marginBottom:'16px' }}>
              <kbd style={{ background:'#242432', border:'1px solid #363650', borderRadius:'4px', padding:'1px 6px', color:'#9898b0', fontSize:'11px' }}>Enter</kbd> = new line &nbsp;·&nbsp;
              <kbd style={{ background:'#242432', border:'1px solid #363650', borderRadius:'4px', padding:'1px 6px', color:'#9898b0', fontSize:'11px' }}>Ctrl+Enter</kbd> = save &nbsp;·&nbsp;
              <kbd style={{ background:'#242432', border:'1px solid #363650', borderRadius:'4px', padding:'1px 6px', color:'#9898b0', fontSize:'11px' }}>Esc</kbd> = cancel
            </p>

            {/* Buttons */}
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={saveEdit} style={{ flex:1, padding:'12px', background:'#6c63ff', color:'#fff', border:'none', borderRadius:'10px', cursor:'pointer', fontWeight:700, fontSize:'15px', boxShadow:'0 4px 16px rgba(108,99,255,0.35)' }}>
                ✓ Save  (Ctrl+Enter)
              </button>
              <button onClick={() => setPopup(null)} style={{ padding:'12px 20px', background:'#242432', color:'#9898b0', border:'1px solid #363650', borderRadius:'10px', cursor:'pointer', fontSize:'14px' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF VIEWER */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'24px' }}>

        {/* Controls */}
        <div style={{ position:'sticky', top:'58px', zIndex:40, display:'flex', alignItems:'center', gap:'10px', background:'rgba(17,17,24,0.97)', backdropFilter:'blur(8px)', border:'1px solid #2a2a3a', borderRadius:'10px', padding:'8px 16px' }}>
          <button onClick={() => setScale(s => Math.max(0.6, +(s-0.15).toFixed(2)))} style={zBtn}>−</button>
          <span style={{ fontSize:'13px', color:'#9898b0', fontFamily:'monospace', width:'44px', textAlign:'center' }}>{Math.round(scale*100)}%</span>
          <button onClick={() => setScale(s => Math.min(2.5, +(s+0.15).toFixed(2)))} style={zBtn}>+</button>
          <div style={{ width:'1px', height:'16px', background:'#2a2a3a', margin:'0 4px' }} />
          <span style={{ fontSize:'12px', color: pdfReady ? '#3ecf8e' : '#f5a623' }}>
            {pdfReady ? `✓ ${totalBlocks} zones — click any to edit` : 'Loading PDF…'}
          </span>
        </div>

        {/* Pages */}
        {pages.map((pg, pageIdx) => (
          <div key={pg.page} style={{ position:'relative', width:px(pg.width), height:px(pg.height), background:'#fff', boxShadow:'0 4px 40px rgba(0,0,0,0.5)', flexShrink:0 }}>
            <canvas
              ref={el => { canvasRefs.current[pg.page] = el; if (el) ctxRefs.current[pg.page] = el.getContext('2d') }}
              style={{ position:'absolute', top:0, left:0, zIndex:1, pointerEvents:'none', display:'block' }}
            />
            {pg.blocks.map(block => {
              const isChanged = block.changed
              const isActive  = popup?.block.id === block.id
              return (
                <div
                  key={block.id}
                  onClick={() => openPopup(block, pageIdx)}
                  title={block.text}
                  style={{
                    position:'absolute',
                    left:   px(block.x0), top: px(block.y0),
                    width:  Math.max(px(block.width) + 4, 20),
                    height: Math.max(px(block.height) + 2, 12),
                    zIndex: 10, cursor:'pointer', borderRadius:'2px', boxSizing:'border-box',
                    background: isActive  ? 'rgba(108,99,255,0.3)'
                              : isChanged ? 'rgba(62,207,142,0.3)'
                              : 'rgba(255,210,0,0.2)',
                    border: isActive  ? '2px solid #6c63ff'
                          : isChanged ? '1.5px solid #3ecf8e'
                          : '1px solid rgba(200,160,0,0.5)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(108,99,255,0.25)'; e.currentTarget.style.border='2px solid #6c63ff' }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = isActive ? 'rgba(108,99,255,0.3)' : isChanged ? 'rgba(62,207,142,0.3)' : 'rgba(255,210,0,0.2)'
                    e.currentTarget.style.border     = isActive ? '2px solid #6c63ff' : isChanged ? '1.5px solid #3ecf8e' : '1px solid rgba(200,160,0,0.5)'
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

const zBtn = { width:'28px', height:'28px', background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'6px', color:'#9898b0', cursor:'pointer', fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }
