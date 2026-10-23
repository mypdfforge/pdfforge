/**
 * SmartDownload.jsx
 * Enterprise SaaS post-processing download panel with performance metrics & next actions.
 */
import React, { useState, useEffect, useRef } from 'react'
import {
  Check,
  Download,
  ArrowRight,
  ShieldCheck,
  Lock,
  Clock,
  Sparkles,
  RotateCcw,
  FileCheck
} from 'lucide-react'
import { formatBytes, pctReduction, addToHistory } from '../utils/credits'
import { toolById } from '../utils/tools'

const NEXT_ACTIONS = {
  compress:      ['pdf-to-word', 'merge', 'watermark'],
  merge:         ['compress', 'organize', 'sign'],
  split:         ['compress', 'watermark', 'pdf-to-word'],
  watermark:     ['compress', 'sign', 'protect'],
  'pdf-to-word': ['compress', 'merge', 'translate'],
  'word-to-pdf': ['compress', 'sign', 'watermark'],
  ocr:           ['compress', 'translate', 'pdf-to-word'],
  sign:          ['compress', 'protect', 'watermark'],
  default:       ['compress', 'merge', 'sign'],
}

export default function SmartDownload({
  toolId,
  originalFile,
  outputBlob,
  outputFilename,
  onReset,
  onNextAction,
  processingTimeMs,
}) {
  const [downloaded, setDownloaded] = useState(false)
  const autoTriggered = useRef(false)

  const origSize = originalFile?.size || null
  const outSize  = outputBlob?.size   || null
  const savedPct = origSize && outSize && outSize < origSize ? pctReduction(origSize, outSize) : null
  const timeMs   = processingTimeMs || null

  useEffect(() => {
    if (!autoTriggered.current && outputBlob) {
      autoTriggered.current = true
      triggerDownload()
      if (originalFile && outputBlob) {
        addToHistory({
          name:         outputFilename || originalFile.name,
          toolId,
          toolLabel:    toolById(toolId)?.label || toolId,
          originalSize: origSize,
          outputSize:   outSize,
        })
      }
    }
  }, [outputBlob])

  const triggerDownload = () => {
    if (!outputBlob) return
    const url = URL.createObjectURL(outputBlob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = outputFilename || 'output.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setDownloaded(true)
  }

  const nextIds = NEXT_ACTIONS[toolId] || NEXT_ACTIONS.default

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', padding: '36px 16px', textAlign: 'center' }} className="fade-up">
      {/* Success Badge */}
      <div
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '20px',
          margin: '0 auto 18px',
          background: 'rgba(21,128,61,0.12)',
          border: '1px solid rgba(21,128,61,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--green)',
          boxShadow: '0 8px 24px rgba(21,128,61,0.15)',
        }}
        className="scale-in"
      >
        <Check size={32} strokeWidth={2.5} />
      </div>

      <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text)', marginBottom: '6px', letterSpacing: '-0.02em' }}>
        Document processing complete
      </h2>
      <p style={{ fontSize: '14px', color: 'var(--text3)', marginBottom: '24px' }}>
        {downloaded ? 'Your file was downloaded automatically.' : 'Click below to save your processed document.'}
      </p>

      {/* Metrics Row */}
      {(origSize || outSize || timeMs) && (
        <div
          style={{
            display: 'flex',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: 'var(--bg2)',
            marginBottom: '24px',
            boxShadow: 'var(--shadow)',
          }}
        >
          {origSize && (
            <StatBox label="Original size" value={formatBytes(origSize)} />
          )}
          {outSize && (
            <StatBox
              label="Processed size"
              value={formatBytes(outSize)}
              highlight={!savedPct}
              green={!!savedPct}
            />
          )}
          {savedPct && (
            <StatBox label="Space saved" value={`-${savedPct}%`} green />
          )}
          {timeMs && (
            <StatBox label="Latency" value={`${(timeMs / 1000).toFixed(1)}s`} />
          )}
        </div>
      )}

      {/* Primary Action Buttons */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '32px' }}>
        <button
          onClick={triggerDownload}
          className="btn btn-primary"
          style={{ height: '42px', padding: '0 24px', fontSize: '14px', gap: '8px' }}
        >
          <Download size={16} /> Download {outputFilename || 'file'}
        </button>

        {onReset && (
          <button
            onClick={onReset}
            className="btn btn-ghost"
            style={{ height: '42px', padding: '0 18px', fontSize: '14px', gap: '8px' }}
          >
            <RotateCcw size={15} /> Process another file
          </button>
        )}
      </div>

      {/* Next Actions */}
      {nextIds.length > 0 && onNextAction && (
        <div style={{ textAlign: 'left', marginTop: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)' }}>
              Next Recommended Step
            </span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            {nextIds.map(actId => {
              const meta = toolById(actId)
              if (!meta) return null
              const IconComp = meta.icon || Sparkles
              return (
                <button
                  key={actId}
                  onClick={() => onNextAction(actId)}
                  className="tool-card"
                  style={{
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <span className="tool-icon" style={{ width: '32px', height: '32px' }}>
                    <IconComp size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {meta.label}
                    </div>
                  </div>
                  <ArrowRight size={12} color="var(--text3)" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Trust Badges */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: '36px',
          paddingTop: '20px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <span className="badge" style={{ gap: '6px' }}>
          <ShieldCheck size={12} color="var(--green)" /> No watermarks
        </span>
        <span className="badge" style={{ gap: '6px' }}>
          <Lock size={12} color="var(--green)" /> Private browser execution
        </span>
        <span className="badge" style={{ gap: '6px' }}>
          <Clock size={12} color="var(--green)" /> Ephemeral memory only
        </span>
      </div>
    </div>
  )
}

function StatBox({ label, value, highlight, green }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 8px',
        borderRight: '1px solid var(--border)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '16px',
          fontWeight: 700,
          lineHeight: 1.2,
          marginBottom: '3px',
          color: green ? 'var(--green)' : highlight ? 'var(--brand)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{label}</div>
    </div>
  )
}
