/**
 * OneClickWorkflows.jsx
 * Bundled action workflows shown as large CTA buttons on the homepage.
 */
import React, { useState } from 'react'

const WORKFLOWS = [
  {
    id:      'workflow-email',
    icon:    '📧',
    label:   'Prepare for Email',
    desc:    'Compress + clean metadata for the perfect email attachment',
    steps:   ['Compress PDF', 'Strip metadata', 'Optimize for email'],
    color:   '#3ecf8e',
    toolIds: ['compress'],
    gradient:'linear-gradient(135deg,rgba(62,207,142,0.15),rgba(62,207,142,0.05))',
  },
  {
    id:      'workflow-resume',
    icon:    '🎯',
    label:   'Make Resume ATS Ready',
    desc:    'Analyze keywords, optimize formatting for applicant tracking systems',
    steps:   ['AI analysis', 'Keyword suggestions', 'ATS score check'],
    color:   '#6c63ff',
    toolIds: ['editor'],
    gradient:'linear-gradient(135deg,rgba(108,99,255,0.15),rgba(232,121,249,0.08))',
    hot:     true,
  },
  {
    id:      'workflow-convert',
    icon:    '🔄',
    label:   'Convert & Compress',
    desc:    'Convert your file to PDF then reduce size — ready to share',
    steps:   ['Convert to PDF', 'Compress output', 'Download'],
    color:   '#f5a623',
    toolIds: ['word-to-pdf', 'compress'],
    gradient:'linear-gradient(135deg,rgba(245,166,35,0.12),rgba(245,166,35,0.04))',
  },
  {
    id:      'workflow-sign',
    icon:    '✍️',
    label:   'Sign & Send',
    desc:    'Add your signature, stamp, and protect with a password',
    steps:   ['Add signature', 'Stamp document', 'Password protect'],
    color:   '#e879f9',
    toolIds: ['sign'],
    gradient:'linear-gradient(135deg,rgba(232,121,249,0.12),rgba(232,121,249,0.04))',
  },
]

export default function OneClickWorkflows({ onSelectTool }) {
  return (
    <div style={{ marginBottom:'48px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'20px' }}>
        <span style={{
          fontSize:'11px', fontWeight:700, letterSpacing:'.1em',
          textTransform:'uppercase', color:'#9d97ff',
          background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.2)',
          borderRadius:'999px', padding:'3px 12px',
        }}>⚡ One-Click Workflows</span>
        <div style={{ flex:1, height:'1px', background:'var(--border)' }}/>
      </div>

      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',
        gap:'12px',
      }}>
        {WORKFLOWS.map(wf => (
          <WorkflowCard key={wf.id} wf={wf} onSelect={onSelectTool} />
        ))}
      </div>
    </div>
  )
}

function WorkflowCard({ wf, onSelect }) {
  const [hov, setHov] = useState(false)

  return (
    <div
      onClick={() => onSelect(wf.toolIds[0], null)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius:  '16px',
        padding:       '20px',
        cursor:        'pointer',
        background:    hov
          ? `rgba(${hexToRgb(wf.color)},0.18)`
          : wf.gradient,
        border:        `1px solid ${hov ? wf.color+'77' : wf.color+'28'}`,
        transition:    'all 0.18s',
        transform:     hov ? 'translateY(-3px)' : 'none',
        boxShadow:     hov ? `0 10px 32px rgba(${hexToRgb(wf.color)},0.2)` : 'none',
        position:      'relative',
      }}
    >
      {wf.hot && (
        <div style={{
          position:'absolute', top:'12px', right:'12px',
          fontSize:'9px', fontWeight:700, color:'#fff',
          background:'linear-gradient(135deg,#6c63ff,#e879f9)',
          padding:'2px 8px', borderRadius:'999px',
        }}>🔥 POPULAR</div>
      )}

      <div style={{ fontSize:'26px', marginBottom:'12px' }}>{wf.icon}</div>
      <h3 style={{ fontSize:'14px', fontWeight:700, color:'#ffffff', marginBottom:'6px' }}>
        {wf.label}
      </h3>
      <p style={{ fontSize:'12px', color:'#b0b0cc', lineHeight:1.6, marginBottom:'14px' }}>
        {wf.desc}
      </p>

      <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
        {wf.steps.map((step, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:'7px' }}>
            <div style={{
              width:'16px', height:'16px', borderRadius:'50%', flexShrink:0,
              background:`rgba(${hexToRgb(wf.color)},0.2)`,
              border:`1px solid ${wf.color}44`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'9px', fontWeight:700, color:wf.color,
            }}>{i+1}</div>
            <span style={{ fontSize:'11px', color:'#d0d0e8' }}>{step}</span>
          </div>
        ))}
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
