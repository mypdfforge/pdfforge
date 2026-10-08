/**
 * VirtualPageGrid.jsx
 *
 * Virtualized thumbnail grid — only pages inside the viewport are in the DOM.
 * A 100-page PDF only has ~12 DOM nodes at any time regardless of page count.
 *
 * Props:
 *   pages        — array of { id, thumb, rotation, blank, origIdx }
 *   hoverId      — currently hovered page id
 *   onHover      — (id) => void
 *   onDragStart  — (index) => void
 *   onDragEnter  — (index) => void
 *   onDragEnd    — () => void
 *   onRotate     — (id) => void
 *   onDelete     — (id) => void
 *   onAddBlank   — () => void
 *   itemWidth    — thumbnail width (default 140)
 *   itemHeight   — thumbnail height (default 210)  includes label
 */

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { RotateCw, Trash2, Plus } from 'lucide-react'

const ITEM_W      = 140
const ITEM_H      = 210   // thumb 180 + label 30
const GAP         = 16
const OVERSCAN    = 2     // extra rows to render above/below viewport

export default function VirtualPageGrid({
  pages       = [],
  hoverId,
  onHover,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onRotate,
  onDelete,
  onAddBlank,
}) {
  const containerRef = useRef(null)
  const [scrollTop,  setScrollTop]  = useState(0)
  const [viewHeight, setViewHeight] = useState(600)
  const [cols,       setCols]       = useState(5)

  // Measure container on resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w    = entry.contentRect.width
      const c    = Math.max(1, Math.floor((w + GAP) / (ITEM_W + GAP)))
      setCols(c)
      setViewHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Track scroll position
  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // ── Virtual window calculation ─────────────────────────────────────
  const rows        = Math.ceil(pages.length / cols)
  const rowH        = ITEM_H + GAP
  const totalH      = rows * rowH

  const firstVisRow = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN)
  const lastVisRow  = Math.min(rows - 1, Math.ceil((scrollTop + viewHeight) / rowH) + OVERSCAN)

  const firstIdx    = firstVisRow * cols
  const lastIdx     = Math.min(pages.length - 1, (lastVisRow + 1) * cols - 1)

  const visiblePages = pages.slice(firstIdx, lastIdx + 1)
  const offsetY      = firstVisRow * rowH

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        flex:       1,
        overflowY:  'auto',
        padding:    '24px',
        position:   'relative',
      }}
    >
      {/* Full-height spacer so scrollbar is correct size */}
      <div style={{ height: totalH, position: 'relative' }}>

        {/* Only visible pages are rendered */}
        <div style={{
          position:       'absolute',
          top:            offsetY,
          left:           0,
          right:          0,
          display:        'flex',
          flexWrap:       'wrap',
          gap:            GAP,
          alignContent:   'flex-start',
        }}>
          {visiblePages.map((pg, relIdx) => {
            const absIdx = firstIdx + relIdx
            return (
              <PageCard
                key={pg.id}
                pg={pg}
                index={absIdx}
                isHovered={hoverId === pg.id}
                onHover={onHover}
                onDragStart={onDragStart}
                onDragEnter={onDragEnter}
                onDragEnd={onDragEnd}
                onRotate={onRotate}
                onDelete={onDelete}
              />
            )
          })}

          {/* Add blank page card — always at the end */}
          <AddBlankCard onClick={onAddBlank} />
        </div>
      </div>
    </div>
  )
}

// ── Individual page card ───────────────────────────────────────────────
function PageCard({ pg, index, isHovered, onHover, onDragStart, onDragEnter, onDragEnd, onRotate, onDelete }) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      onMouseEnter={() => onHover(pg.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        position:   'relative',
        width:      ITEM_W,
        flexShrink: 0,
        cursor:     'grab',
        transform:  isHovered ? 'translateY(-3px)' : 'none',
        transition: 'transform 0.15s',
      }}
    >
      {/* Thumbnail box */}
      <div style={{
        width:          ITEM_W,
        height:         180,
        borderRadius:   10,
        overflow:       'hidden',
        border:         `2px solid ${isHovered ? 'var(--accent)' : 'var(--border)'}`,
        background:     'var(--bg3)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        transition:     'border-color 0.15s',
        boxShadow:      isHovered ? '0 8px 24px rgba(108,99,255,0.2)' : '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        {pg.blank ? (
          <BlankPageIcon />
        ) : pg.thumb ? (
          <img
            src={pg.thumb}
            alt={`Page ${index + 1}`}
            loading="lazy"
            style={{
              width:      '100%',
              height:     '100%',
              objectFit:  'contain',
              transform:  `rotate(${pg.rotation}deg)`,
              transition: 'transform 0.25s',
            }}
          />
        ) : (
          <PageSkeleton />
        )}
      </div>

      {/* Hover action buttons */}
      {isHovered && (
        <div style={{
          position:      'absolute',
          top:           8,
          right:         8,
          display:       'flex',
          flexDirection: 'column',
          gap:           5,
          zIndex:        10,
        }}>
          {!pg.blank && (
            <ActionBtn
              onClick={() => onRotate(pg.id)}
              title="Rotate 90°"
              color="rgba(108,99,255,0.9)"
              icon={<RotateCw size={13} />}
            />
          )}
          <ActionBtn
            onClick={() => onDelete(pg.id)}
            title="Delete page"
            color="rgba(229,83,75,0.9)"
            icon={<Trash2 size={13} />}
          />
        </div>
      )}

      {/* Page label */}
      <div style={{ textAlign: 'center', marginTop: 7 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
          {pg.blank ? '+ Blank' : `Page ${index + 1}`}
        </span>
        {pg.rotation !== 0 && (
          <span style={{ fontSize: 10, color: 'var(--accent2)', marginLeft: 5 }}>
            {pg.rotation}°
          </span>
        )}
      </div>
    </div>
  )
}

function ActionBtn({ onClick, title, color, icon }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width:           28,
        height:          28,
        borderRadius:    7,
        border:          'none',
        background:      color,
        color:           '#fff',
        cursor:          'pointer',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backdropFilter:  'blur(4px)',
      }}
    >
      {icon}
    </button>
  )
}

function AddBlankCard({ onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width:           ITEM_W,
        height:          180,
        borderRadius:    10,
        border:          `2px dashed ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        background:      'transparent',
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        cursor:          'pointer',
        color:           hovered ? 'var(--accent2)' : 'var(--text3)',
        gap:             8,
        transition:      'all 0.15s',
        flexShrink:      0,
      }}
    >
      <Plus size={22} />
      <span style={{ fontSize: 11, fontWeight: 600 }}>Add Blank</span>
    </div>
  )
}

function BlankPageIcon() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text3)' }}>
      <div style={{ width: 60, height: 80, background: '#fff', borderRadius: 4, border: '1px solid var(--border)' }} />
      <span style={{ fontSize: 10 }}>Blank Page</span>
    </div>
  )
}

// Skeleton shown while page is still rendering in worker
function PageSkeleton() {
  return (
    <div style={{
      width:     '85%',
      height:    '90%',
      borderRadius: 4,
      background: 'linear-gradient(90deg, var(--bg2) 25%, var(--bg3) 50%, var(--bg2) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }}>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </div>
  )
}
