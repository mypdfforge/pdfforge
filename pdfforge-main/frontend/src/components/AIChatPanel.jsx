/**
 * AIChatPanel.jsx
 * Right-side chat panel for uploaded PDFs.
 * Calls Anthropic API directly from the browser (via proxy/backend).
 * Backend route: POST /api/ai/chat
 */
import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://mypdfforge.onrender.com/api'

const PREBUILT = [
  { label: '📋 Summarize',         prompt: 'Summarize this document in 3-5 bullet points.' },
  { label: '🔑 Key points',        prompt: 'What are the key points of this document?' },
  { label: '🧾 Extract totals',    prompt: 'Extract all monetary totals, amounts, and dates from this document.' },
  { label: '📝 Simple English',    prompt: 'Explain this document in simple, plain English.' },
  { label: '⚠️ Action items',      prompt: 'List any action items, deadlines, or things I need to do.' },
  { label: '📊 Key numbers',       prompt: 'Extract all important numbers, statistics, and data points.' },
]

export default function AIChatPanel({ sessionId, textBlocks, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '👋 Hi! I\'ve read your document. Ask me anything or pick a quick action below.',
    }
  ])
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (prompt) => {
    const text = prompt || input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg = { role: 'user', text }
    setMessages(m => [...m, userMsg])
    setLoading(true)

    try {
      // Build context from text blocks (first 80 blocks for brevity)
      const context = (textBlocks || [])
        .slice(0, 80)
        .filter(b => b.text?.trim().length > 3)
        .map(b => b.text)
        .join('\n')

      const { data } = await axios.post(`${API_URL}/ai/chat`, {
        sessionId,
        context,
        message: text,
      })

      setMessages(m => [...m, { role: 'assistant', text: data.reply || 'No response.' }])
    } catch (e) {
      setMessages(m => [...m, {
        role: 'assistant',
        text: '⚠️ Could not reach AI. Please try again.',
        error: true,
      }])
    }
    setLoading(false)
  }

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100%',
      background:    'var(--bg2)',
      borderLeft:    '1px solid var(--border)',
      fontFamily:    'inherit',
    }}>
      {/* Header */}
      <div style={{
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'space-between',
        padding:     '14px 16px',
        borderBottom:'1px solid var(--border)',
        flexShrink:  0,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{
            width:'28px', height:'28px', borderRadius:'8px',
            background:'linear-gradient(135deg,#6c63ff,#e879f9)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px',
          }}>🤖</div>
          <div>
            <p style={{ fontSize:'13px', fontWeight:700, color:'#ffffff' }}>AI Assistant</p>
            <p style={{ fontSize:'10px', color:'#3ecf8e' }}>● Document loaded</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{
            background:'none', border:'none', color:'#b0b0cc',
            cursor:'pointer', fontSize:'18px', padding:'2px 6px',
          }}>×</button>
        )}
      </div>

      {/* Quick prompts */}
      <div style={{
        padding:    '12px 12px 8px',
        borderBottom:'1px solid var(--border)',
        flexShrink: 0,
      }}>
        <p style={{ fontSize:'10px', color:'#b0b0cc', marginBottom:'8px', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase' }}>Quick actions</p>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
          {PREBUILT.map(p => (
            <button
              key={p.label}
              onClick={() => sendMessage(p.prompt)}
              disabled={loading}
              style={{
                fontSize:'11px', fontWeight:500, color:'#d0d0e8',
                background:'var(--bg3)', border:'1px solid var(--border)',
                borderRadius:'999px', padding:'4px 10px', cursor:'pointer',
                transition:'all 0.15s', whiteSpace:'nowrap',
                opacity: loading ? 0.5 : 1,
              }}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex:       1,
        overflowY:  'auto',
        padding:    '16px 14px',
        display:    'flex',
        flexDirection:'column',
        gap:        '12px',
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display:   'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth:    '85%',
              padding:     '10px 13px',
              borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background:  m.role === 'user'
                ? 'linear-gradient(135deg,#6c63ff,#8b83ff)'
                : m.error ? 'rgba(229,83,75,0.12)' : 'var(--bg3)',
              border:      m.role === 'user' ? 'none' : `1px solid ${m.error ? 'rgba(229,83,75,0.3)' : 'var(--border)'}`,
              fontSize:    '13px',
              color:       '#ffffff',
              lineHeight:  1.65,
              whiteSpace:  'pre-wrap',
            }}>{m.text}</div>
          </div>
        ))}

        {loading && (
          <div style={{ display:'flex', justifyContent:'flex-start' }}>
            <div style={{
              padding:'10px 14px', borderRadius:'14px 14px 14px 4px',
              background:'var(--bg3)', border:'1px solid var(--border)',
              display:'flex', gap:'4px', alignItems:'center',
            }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width:'6px', height:'6px', borderRadius:'50%',
                  background:'#6c63ff',
                  animation:'sgPulse 1.2s ease infinite',
                  animationDelay:`${i*0.2}s`,
                }}/>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{
        padding:     '12px 12px',
        borderTop:   '1px solid var(--border)',
        flexShrink:  0,
        display:     'flex',
        gap:         '8px',
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder="Ask anything about this document…"
          disabled={loading}
          style={{
            flex:1, background:'var(--bg3)', border:'1px solid var(--border)',
            borderRadius:'10px', padding:'9px 13px', fontSize:'13px',
            color:'#ffffff', outline:'none', fontFamily:'inherit',
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          style={{
            width:'36px', height:'36px', borderRadius:'10px', flexShrink:0,
            background: input.trim() && !loading ? 'var(--accent)' : 'var(--bg4)',
            border:'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
            color:'#ffffff', fontSize:'16px', display:'flex',
            alignItems:'center', justifyContent:'center',
            transition:'background 0.15s',
          }}
        >↑</button>
      </div>

      <style>{`@keyframes sgPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  )
}
