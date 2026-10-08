import React, { useState } from 'react'
import { Sparkles, X, Check, RotateCcw, Loader2, ChevronDown, ChevronUp, AlertTriangle, Info } from 'lucide-react'
import axios from 'axios'

const QUICK = [
  'Improve action verbs in work experience',
  'Make professional summary more impactful',
  'Fix grammar and spelling errors',
  'Make bullet points more concise',
  'Strengthen skills section wording',
]

export default function AIAssistant({ sessionId, blocks, onApplySuggestion, onClose }) {
  const [prompt,      setPrompt]      = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [applied,     setApplied]     = useState(new Set())
  const [expanded,    setExpanded]    = useState(new Set())

  const ask = async (p) => {
    if (!p?.trim()) return
    setLoading(true); setError(''); setSuggestions([]); setApplied(new Set())
    try {
      // Filter to meaningful blocks only
      const meaningful = blocks.filter(b => b.text?.trim().length > 3).slice(0, 60)
      const { data } = await axios.post('/api/ai/suggest', {
        blocks:    meaningful,
        prompt:    p,
        sessionId: sessionId,
      })
      if (data.error) {
        setError(`AI error: ${data.error}`)
      } else if (!data.suggestions?.length) {
        setError('No suggestions found for this prompt. Try being more specific, e.g. "improve action verbs in work experience section".')
      } else {
        setSuggestions(data.suggestions)
      }
    } catch(e) {
      setError(`Failed to reach AI service: ${e.message}. Make sure backend is running.`)
    } finally { setLoading(false) }
  }

  const apply = (s, idx) => {
    const block = blocks.find(b => b.id === s.blockId)
    if (block) {
      onApplySuggestion({ ...block, text: s.suggested, changed: true })
      setApplied(prev => new Set([...prev, idx]))
    }
  }

  const applyAll = () => suggestions.forEach((s,i) => { if (!applied.has(i)) apply(s,i) })

  return (
    <div style={{ position:'fixed', right:0, top:0, bottom:0, width:'380px', zIndex:80, background:'#13131e', borderLeft:'1px solid #252538', display:'flex', flexDirection:'column', boxShadow:'-8px 0 32px rgba(0,0,0,0.5)' }}>

      {/* Header */}
      <div style={{ padding:'16px 18px', borderBottom:'1px solid #252538', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{ width:'28px', height:'28px', background:'linear-gradient(135deg,#6c63ff,#e879f9)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Sparkles size={14} color="#fff"/>
          </div>
          <div>
            <div style={{ fontSize:'14px', fontWeight:700, color:'#eeeef5' }}>AI Assistant</div>
            <div style={{ fontSize:'11px', color:'#5a5a78' }}>Suggests line replacements only</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'#5a5a78', cursor:'pointer' }}><X size={16}/></button>
      </div>

      {/* Warning */}
      <div style={{ margin:'12px 14px 0', background:'rgba(245,166,35,0.08)', border:'1px solid rgba(245,166,35,0.2)', borderRadius:'8px', padding:'8px 12px', display:'flex', gap:'8px', flexShrink:0 }}>
        <AlertTriangle size={12} color="#f5a623" style={{ flexShrink:0, marginTop:'2px' }}/>
        <p style={{ fontSize:'11px', color:'#9898b8', lineHeight:1.5 }}>
          AI only <strong style={{ color:'#f5a623' }}>replaces existing lines</strong> — never adds new ones. This preserves your PDF layout perfectly.
        </p>
      </div>

      {/* Quick prompts */}
      <div style={{ padding:'12px 14px 0', flexShrink:0 }}>
        <p style={{ fontSize:'11px', color:'#5a5a78', marginBottom:'7px', fontWeight:600 }}>Quick actions:</p>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
          {QUICK.map(q => (
            <button key={q} onClick={() => { setPrompt(q); ask(q) }}
              style={{ fontSize:'11px', color:'#9d97ff', background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.2)', borderRadius:'6px', padding:'4px 9px', cursor:'pointer' }}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div style={{ padding:'12px 14px', flexShrink:0 }}>
        <div style={{ display:'flex', gap:'7px' }}>
          <input value={prompt} onChange={e=>setPrompt(e.target.value)}
            onKeyDown={e => e.key==='Enter' && ask(prompt)}
            placeholder="Ask AI to improve your resume..."
            style={{ flex:1, background:'#1e1e2e', color:'#eeeef5', border:'1px solid #252538', borderRadius:'8px', padding:'9px 12px', fontSize:'13px', outline:'none' }}/>
          <button onClick={() => ask(prompt)} disabled={loading||!prompt.trim()}
            style={{ padding:'9px 12px', background:'#6c63ff', color:'#fff', border:'none', borderRadius:'8px', cursor:loading||!prompt.trim()?'not-allowed':'pointer', opacity:!prompt.trim()?0.4:1, display:'flex', alignItems:'center' }}>
            {loading ? <Loader2 size={14} className="spin"/> : <Sparkles size={14}/>}
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ flex:1, overflowY:'auto', padding:'0 14px 16px' }}>
        {loading && (
          <div style={{ textAlign:'center', padding:'40px 0', color:'#5a5a78' }}>
            <Loader2 size={28} color="#6c63ff" className="spin" style={{ display:'block', margin:'0 auto 12px' }}/>
            <p style={{ fontSize:'13px' }}>Analyzing your resume…</p>
          </div>
        )}

        {error && !loading && (
          <div style={{ background:'rgba(229,83,75,0.1)', border:'1px solid rgba(229,83,75,0.25)', borderRadius:'8px', padding:'12px', fontSize:'12px', color:'#e5534b', lineHeight:1.5 }}>
            <Info size={12} style={{ marginRight:'6px', verticalAlign:'middle' }}/>{error}
          </div>
        )}

        {!loading && !error && suggestions.length > 0 && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
              <p style={{ fontSize:'12px', color:'#9898b8', fontWeight:500 }}>
                {suggestions.length} suggestion{suggestions.length>1?'s':''} found
              </p>
              <button onClick={applyAll}
                style={{ fontSize:'11px', color:'#3ecf8e', background:'rgba(62,207,142,0.1)', border:'1px solid rgba(62,207,142,0.25)', borderRadius:'6px', padding:'3px 10px', cursor:'pointer' }}>
                Apply All
              </button>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {suggestions.map((s, idx) => {
                const isApplied  = applied.has(idx)
                const isExpanded = expanded.has(idx)
                return (
                  <div key={idx} style={{ background:isApplied?'rgba(62,207,142,0.06)':'#1e1e2e', border:`1px solid ${isApplied?'rgba(62,207,142,0.3)':'#252538'}`, borderRadius:'10px', overflow:'hidden' }}>
                    <div style={{ padding:'10px 12px' }}>
                      <p style={{ fontSize:'11px', color:'#9d97ff', fontWeight:600, marginBottom:'5px' }}>{s.reason}</p>
                      <p style={{ fontSize:'12px', color:'#eeeef5', lineHeight:1.5, wordBreak:'break-word' }}>
                        "{s.suggested?.substring(0,90)}{s.suggested?.length>90?'…':''}"
                      </p>
                    </div>

                    <div style={{ padding:'0 12px 4px' }}>
                      <button onClick={() => setExpanded(prev => { const n=new Set(prev); isExpanded?n.delete(idx):n.add(idx); return n })}
                        style={{ fontSize:'11px', color:'#5a5a78', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:'3px', padding:0 }}>
                        {isExpanded ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
                        {isExpanded?'Hide':'See'} original
                      </button>
                    </div>

                    {isExpanded && (
                      <div style={{ margin:'0 12px 8px', background:'rgba(0,0,0,0.25)', borderRadius:'6px', padding:'8px', fontSize:'11px', color:'#5a5a78', lineHeight:1.5 }}>
                        <strong style={{ color:'#9898b8' }}>Original: </strong>{s.original}
                      </div>
                    )}

                    <div style={{ padding:'8px 12px 10px', borderTop:'1px solid #1a1a2e' }}>
                      {isApplied ? (
                        <div style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', color:'#3ecf8e' }}>
                          <Check size={12}/> Applied!
                        </div>
                      ) : (
                        <button onClick={() => apply(s,idx)}
                          style={{ width:'100%', padding:'6px', background:'#6c63ff', color:'#fff', border:'none', borderRadius:'7px', cursor:'pointer', fontWeight:600, fontSize:'12px', display:'flex', alignItems:'center', justifyContent:'center', gap:'5px' }}>
                          <Check size={11}/> Apply this change
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
