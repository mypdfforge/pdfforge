/**
 * ATSScoreMeter.jsx
 * ATS score checker for the resume editor.
 * Analyzes text blocks client-side for common ATS signals,
 * then calls the AI for deeper keyword analysis.
 */
import React, { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://mypdfforge.onrender.com/api'

// Client-side heuristic scoring (no API call needed for basics)
function computeClientScore(blocks) {
  if (!blocks?.length) return { score: 0, signals: [] }

  const text    = blocks.map(b => b.text || '').join(' ').toLowerCase()
  const signals = []
  let   score   = 0

  // Contact info
  if (/\b[\w.+-]+@[\w-]+\.\w+/.test(text)) { score += 10; signals.push({ ok:true,  msg:'Email address found' }) }
  else                                       {             signals.push({ ok:false, msg:'No email address detected' }) }

  if (/(\+?\d[\d\s\-().]{7,})/.test(text))  { score += 8;  signals.push({ ok:true,  msg:'Phone number found' }) }
  else                                       {             signals.push({ ok:false, msg:'No phone number detected' }) }

  // Sections
  const sections = ['experience','education','skills','summary','objective','work']
  const foundSec = sections.filter(s => text.includes(s))
  score += Math.min(foundSec.length * 5, 20)
  if (foundSec.length >= 3) signals.push({ ok:true,  msg:`Key sections: ${foundSec.slice(0,3).join(', ')}` })
  else                      signals.push({ ok:false, msg:'Missing common resume sections' })

  // Action verbs
  const verbs = ['led','managed','built','developed','designed','improved','increased','reduced',
    'created','launched','achieved','delivered','optimized','implemented','collaborated']
  const foundVerbs = verbs.filter(v => text.includes(v))
  score += Math.min(foundVerbs.length * 3, 18)
  if (foundVerbs.length >= 4) signals.push({ ok:true,  msg:`Strong action verbs: ${foundVerbs.slice(0,3).join(', ')}…` })
  else                        signals.push({ ok:false, msg:'Use more action verbs (led, built, improved…)' })

  // Metrics
  if (/\d+\s*%|\$\d+|\d+\s*(million|thousand|users|clients|team)/.test(text)) {
    score += 12; signals.push({ ok:true,  msg:'Quantified achievements detected' })
  } else {
    signals.push({ ok:false, msg:'Add quantified results (%, $, team size…)' })
  }

  // Length
  const wordCount = text.split(/\s+/).length
  if (wordCount >= 200 && wordCount <= 800) {
    score += 10; signals.push({ ok:true,  msg:`Good length (${wordCount} words)` })
  } else if (wordCount < 200) {
    signals.push({ ok:false, msg:'Resume may be too short' })
  } else {
    signals.push({ ok:false, msg:'Resume may be too long for ATS' })
  }

  // LinkedIn
  if (text.includes('linkedin')) { score += 7; signals.push({ ok:true, msg:'LinkedIn profile included' }) }

  return { score: Math.min(score, 100), signals }
}

function scoreColor(score) {
  if (score >= 80) return '#3ecf8e'
  if (score >= 60) return '#f5a623'
  return '#e5534b'
}

function scoreLabel(score) {
  if (score >= 80) return 'ATS Ready'
  if (score >= 60) return 'Needs Work'
  return 'Risky'
}

export default function ATSScoreMeter({ blocks, jobDescription }) {
  const [clientResult, setClientResult] = useState(null)
  const [aiKeywords,   setAiKeywords]   = useState(null)
  const [loading,      setLoading]      = useState(false)

  useEffect(() => {
    if (blocks?.length) {
      setClientResult(computeClientScore(blocks))
    }
  }, [blocks])

  const fetchAIKeywords = async () => {
    if (!blocks?.length || loading) return
    setLoading(true)
    try {
      const context = blocks.slice(0, 80).map(b => b.text).join('\n')
      const { data } = await axios.post(`${API_URL}/ai/ats`, {
        resumeText:     context,
        jobDescription: jobDescription || '',
      })
      setAiKeywords(data)
    } catch (e) {
      console.warn('ATS AI error', e)
    }
    setLoading(false)
  }

  if (!clientResult) return null

  const { score, signals } = clientResult
  const color = scoreColor(score)
  const circumference = 2 * Math.PI * 42

  return (
    <div style={{
      background:'var(--bg2)', border:'1px solid var(--border)',
      borderRadius:'16px', padding:'20px', marginBottom:'16px',
    }}>
      {/* Score gauge */}
      <div style={{ display:'flex', alignItems:'center', gap:'20px', marginBottom:'16px' }}>
        <div style={{ position:'relative', width:'96px', height:'96px', flexShrink:0 }}>
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="42" fill="none" stroke="var(--bg4)" strokeWidth="7"/>
            <circle
              cx="48" cy="48" r="42" fill="none"
              stroke={color} strokeWidth="7"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - score/100)}
              strokeLinecap="round"
              transform="rotate(-90 48 48)"
              style={{ transition:'stroke-dashoffset 1s ease' }}
            />
          </svg>
          <div style={{
            position:'absolute', inset:0,
            display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center',
          }}>
            <span style={{ fontSize:'22px', fontWeight:800, color, lineHeight:1 }}>{score}</span>
            <span style={{ fontSize:'9px', color:'#b0b0cc', fontWeight:600 }}>/100</span>
          </div>
        </div>

        <div>
          <div style={{
            display:'inline-block', marginBottom:'6px',
            fontSize:'11px', fontWeight:700, color,
            background:`rgba(${hexToRgb(color)},0.12)`,
            border:`1px solid ${color}33`,
            borderRadius:'999px', padding:'2px 10px',
          }}>{scoreLabel(score)}</div>
          <h3 style={{ fontSize:'15px', fontWeight:700, color:'#ffffff', marginBottom:'4px' }}>
            ATS Score
          </h3>
          <p style={{ fontSize:'12px', color:'#b0b0cc', lineHeight:1.5 }}>
            {score >= 80
              ? 'Your resume should pass most ATS filters'
              : score >= 60
              ? 'Some improvements will help pass ATS filters'
              : 'Significant improvements needed for ATS compatibility'
            }
          </p>
        </div>
      </div>

      {/* Signals */}
      <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'14px' }}>
        {signals.map((sig, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize:'12px', color: sig.ok ? '#3ecf8e' : '#e5534b', flexShrink:0 }}>
              {sig.ok ? '✓' : '✗'}
            </span>
            <span style={{ fontSize:'12px', color: sig.ok ? '#d0d0e8' : '#b0b0cc' }}>{sig.msg}</span>
          </div>
        ))}
      </div>

      {/* AI keyword analysis */}
      {!aiKeywords ? (
        <button
          onClick={fetchAIKeywords}
          disabled={loading}
          style={{
            width:'100%', padding:'9px', borderRadius:'10px',
            border:'1px solid rgba(108,99,255,0.3)',
            background:'rgba(108,99,255,0.08)',
            color:'#9d97ff', fontSize:'12px', fontWeight:600,
            cursor: loading ? 'default' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
          }}
        >
          {loading ? (
            <><SpinDot/> Analyzing keywords…</>
          ) : (
            <>🤖 Get AI keyword suggestions (1 credit)</>
          )}
        </button>
      ) : (
        <div style={{ borderTop:'1px solid var(--border)', paddingTop:'12px' }}>
          <p style={{ fontSize:'11px', fontWeight:700, color:'#9d97ff', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'.08em' }}>
            AI Keyword Suggestions
          </p>
          {aiKeywords.missing?.length > 0 && (
            <div style={{ marginBottom:'8px' }}>
              <p style={{ fontSize:'11px', color:'#b0b0cc', marginBottom:'6px' }}>Missing keywords to add:</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                {aiKeywords.missing.map(k => (
                  <span key={k} style={{
                    fontSize:'11px', color:'#f5a623',
                    background:'rgba(245,166,35,0.1)', border:'1px solid rgba(245,166,35,0.25)',
                    borderRadius:'999px', padding:'2px 9px',
                  }}>+ {k}</span>
                ))}
              </div>
            </div>
          )}
          {aiKeywords.found?.length > 0 && (
            <div>
              <p style={{ fontSize:'11px', color:'#b0b0cc', marginBottom:'6px' }}>Strong keywords found:</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                {aiKeywords.found.map(k => (
                  <span key={k} style={{
                    fontSize:'11px', color:'#3ecf8e',
                    background:'rgba(62,207,142,0.08)', border:'1px solid rgba(62,207,142,0.2)',
                    borderRadius:'999px', padding:'2px 9px',
                  }}>✓ {k}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SpinDot() {
  return (
    <div style={{
      width:'12px', height:'12px', borderRadius:'50%',
      border:'2px solid rgba(108,99,255,0.3)', borderTopColor:'#6c63ff',
      animation:'spin 0.7s linear infinite', display:'inline-block',
    }}/>
  )
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `${r},${g},${b}`
}
