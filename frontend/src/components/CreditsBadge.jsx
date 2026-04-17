/**
 * CreditsBadge.jsx + PaywallModal.jsx
 * Shows remaining credits in the TopBar and paywall modal when credits run out.
 */
import React, { useState, useEffect } from 'react'
import { getRemaining, getCreditsState, FREE_DAILY, TOOL_COSTS, addBonusCredits } from '../utils/credits'

// ── Credits Badge (for TopBar) ────────────────────────────────────────
export function CreditsBadge({ toolId }) {
  const [remaining, setRemaining] = useState(getRemaining())

  useEffect(() => {
    const update = () => setRemaining(getRemaining())
    window.addEventListener('pdfforge:credits', update)
    return () => window.removeEventListener('pdfforge:credits', update)
  }, [])

  const cost     = TOOL_COSTS[toolId] ?? TOOL_COSTS.default
  const isLow    = remaining <= 2
  const isEmpty  = remaining === 0

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:'5px',
      padding:'4px 10px', borderRadius:'999px',
      background: isEmpty ? 'rgba(229,83,75,0.12)' : isLow ? 'rgba(245,166,35,0.1)' : 'rgba(62,207,142,0.08)',
      border: `1px solid ${isEmpty ? 'rgba(229,83,75,0.3)' : isLow ? 'rgba(245,166,35,0.25)' : 'rgba(62,207,142,0.2)'}`,
      fontSize:'12px', fontWeight:600,
      color: isEmpty ? '#e5534b' : isLow ? '#f5a623' : '#3ecf8e',
    }}>
      <span>⚡</span>
      <span>{remaining} credit{remaining !== 1 ? 's' : ''} left</span>
    </div>
  )
}

// ── Paywall Modal ─────────────────────────────────────────────────────
const PLANS = [
  {
    id:      'starter',
    label:   'Starter',
    price:   '$2.99',
    credits: 50,
    perks:   ['50 credits', 'Valid 30 days', 'All tools', 'Priority processing'],
    popular: false,
    color:   '#3ecf8e',
  },
  {
    id:      'pro',
    label:   'Pro',
    price:   '$7.99',
    credits: 200,
    perks:   ['200 credits', 'Valid 90 days', 'All tools', 'Priority processing', 'Batch processing'],
    popular: true,
    color:   '#6c63ff',
  },
  {
    id:      'unlimited',
    label:   'Unlimited',
    price:   '$14.99',
    credits: 9999,
    perks:   ['Unlimited for 30 days', 'All tools', 'Fastest servers', 'API access'],
    popular: false,
    color:   '#e879f9',
  },
]

const fadeIn  = `@keyframes pwFadeIn{from{opacity:0}to{opacity:1}}`
const slideUp = `@keyframes pwSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}`

export function PaywallModal({ onClose, reason }) {
  const [selected, setSelected] = useState('pro')

  // Demo purchase (no real payment yet — just adds credits)
  const handlePurchase = () => {
    const plan = PLANS.find(p => p.id === selected)
    if (!plan) return
    addBonusCredits(plan.credits === 9999 ? 9999 : plan.credits)
    window.dispatchEvent(new Event('pdfforge:credits'))
    onClose?.()
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999,
      background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      padding:'20px', animation:'pwFadeIn 0.2s ease',
    }} onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <style>{fadeIn}{slideUp}</style>

      <div style={{
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:'20px', padding:'32px', maxWidth:'560px', width:'100%',
        animation:'pwSlideUp 0.25s ease',
      }}>
        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:'24px' }}>
          <div style={{ fontSize:'36px', marginBottom:'10px' }}>⚡</div>
          <h2 style={{ fontSize:'22px', fontWeight:800, color:'#ffffff', marginBottom:'6px' }}>
            {reason || 'Daily free credits used up'}
          </h2>
          <p style={{ fontSize:'14px', color:'#b0b0cc' }}>
            Get more credits to keep working. Resets for free tomorrow at midnight.
          </p>
        </div>

        {/* Free reset notice */}
        <div style={{
          background:'rgba(62,207,142,0.08)', border:'1px solid rgba(62,207,142,0.2)',
          borderRadius:'10px', padding:'10px 16px', marginBottom:'20px',
          display:'flex', alignItems:'center', gap:'8px',
        }}>
          <span style={{ color:'#3ecf8e' }}>✓</span>
          <span style={{ fontSize:'13px', color:'#d0d0e8' }}>
            Free plan: {FREE_DAILY} actions/day — resets every midnight, no signup needed
          </span>
        </div>

        {/* Plans */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px', marginBottom:'20px' }}>
          {PLANS.map(plan => (
            <div
              key={plan.id}
              onClick={() => setSelected(plan.id)}
              style={{
                borderRadius:'14px', padding:'16px 12px', cursor:'pointer',
                border:`2px solid ${selected === plan.id ? plan.color : 'var(--border)'}`,
                background: selected === plan.id ? `rgba(${hexToRgb(plan.color)},0.1)` : 'var(--bg3)',
                transition:'all 0.15s', position:'relative',
              }}
            >
              {plan.popular && (
                <div style={{
                  position:'absolute', top:'-10px', left:'50%', transform:'translateX(-50%)',
                  background:'linear-gradient(135deg,#6c63ff,#e879f9)',
                  fontSize:'9px', fontWeight:700, color:'#fff',
                  padding:'2px 10px', borderRadius:'999px', whiteSpace:'nowrap',
                }}>MOST POPULAR</div>
              )}
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:'18px', fontWeight:800, color:'#ffffff' }}>{plan.price}</div>
                <div style={{ fontSize:'11px', color:'#b0b0cc', marginBottom:'10px' }}>{plan.label}</div>
                {plan.perks.slice(0,3).map(p => (
                  <div key={p} style={{ fontSize:'11px', color:'#d0d0e8', marginBottom:'3px' }}>✓ {p}</div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={handlePurchase}
          style={{
            width:'100%', padding:'14px', borderRadius:'12px', border:'none',
            background:'linear-gradient(135deg,#6c63ff,#e879f9)',
            color:'#ffffff', fontSize:'15px', fontWeight:700, cursor:'pointer',
            marginBottom:'10px',
          }}
        >
          Get {PLANS.find(p=>p.id===selected)?.label} — {PLANS.find(p=>p.id===selected)?.price}
        </button>

        <button
          onClick={onClose}
          style={{
            width:'100%', padding:'10px', borderRadius:'12px',
            border:'1px solid var(--border)', background:'transparent',
            color:'#b0b0cc', fontSize:'13px', cursor:'pointer',
          }}
        >Maybe later — wait until tomorrow</button>

        <p style={{ fontSize:'11px', color:'#7070a0', textAlign:'center', marginTop:'12px' }}>
          💳 Stripe integration coming soon. Clicking "Get" adds demo credits.
        </p>
      </div>
    </div>
  )
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `${r},${g},${b}`
}
