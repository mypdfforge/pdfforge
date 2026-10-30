/**
 * RotateToolPage.jsx — multi-file Rotate PDF built on the shared BatchWorkspace.
 *
 * Supports:
 *   - Drag & drop multiple PDF files with dual-scroll layout and persistent dropzones
 *   - Document accent color coding (DOC_COLORS) to identify page origins
 *   - Global rotation shortcuts: Rotate All Files (+90° CW, -90° CCW, 180° Flip)
 *   - Pattern presets: Rotate Odd pages, Rotate Even pages across all files
 *   - Per-file controls: Rotate all pages in a specific file, reset file
 *   - Per-page hover buttons: Rotate CW, Rotate CCW, Zoom in full resolution
 *   - Visual live thumbnail rotation with smooth CSS transform (0°, 90°, 180°, 270°)
 *   - Dual download options:
 *       • Download Rotated Files (.zip or .pdf if 1 file)
 *       • Merge & Download as 1 PDF (rotates and combines into a single document)
 *       • Mobile direct download list for ≤ 3 files
 */
import React, { useState, useMemo, useCallback } from 'react'
import {
  RotateCw, RotateCcw, ZoomIn, Check, X, Undo2,
  RefreshCw, CheckSquare, Square, Layers,
} from 'lucide-react'
import BatchLayout, {
  useBatchFiles, useBatchRun, BatchBar, ThumbCard, CardBtn, ZoomModal,
} from '../components/BatchWorkspace'
import { runBatch, zipNameFor, isCoarse } from '../utils/batchClient'
import { parseSpec, formatSpec } from '../utils/pageSpec'

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360

export default function RotateToolPage(props) {
  const batch = useBatchFiles()
  const { files, thumbs, setErrs } = batch
  const run = useBatchRun((m) => setErrs((e) => [...e, m]))
  const coarse = isCoarse()

  // rotations map: `${fileId}:${pageIndex}` -> angle (0 | 90 | 180 | 270)
  const [rotations, setRotations] = useState({})
  // per-file selected pages for batch rotation in that file: { [fileId]: Set<pageNumber> }
  const [selectedPages, setSelectedPages] = useState({})
  // draft inputs for page ranges per file: { [fileId]: string }
  const [draftInputs, setDraftInputs] = useState({})
  // zoom modal target: { file, pageNum, rotation } | null
  const [zoomTarget, setZoomTarget] = useState(null)

  // ── Rotation Helpers ────────────────────────────────────────────────────────
  const getRot = useCallback(
    (fileId, idx) => rotations[`${fileId}:${idx}`] || 0,
    [rotations]
  )

  const rotatePage = useCallback((fileId, idx, delta) => {
    setRotations((prev) => {
      const key = `${fileId}:${idx}`
      const current = prev[key] || 0
      const next = normalizeDeg(current + delta)
      const copy = { ...prev }
      if (next === 0) delete copy[key]
      else copy[key] = next
      return copy
    })
  }, [])

  const rotateFile = useCallback((file, delta) => {
    setRotations((prev) => {
      const copy = { ...prev }
      for (let i = 0; i < file.count; i++) {
        const key = `${file.id}:${i}`
        const current = prev[key] || 0
        const next = normalizeDeg(current + delta)
        if (next === 0) delete copy[key]
        else copy[key] = next
      }
      return copy
    })
  }, [])

  const rotateAllFiles = useCallback((delta) => {
    setRotations((prev) => {
      const copy = { ...prev }
      for (const f of files) {
        for (let i = 0; i < f.count; i++) {
          const key = `${f.id}:${i}`
          const current = prev[key] || 0
          const next = normalizeDeg(current + delta)
          if (next === 0) delete copy[key]
          else copy[key] = next
        }
      }
      return copy
    })
  }, [files])

  const rotatePattern = useCallback((pattern, delta) => {
    // pattern: 'odd' | 'even'
    setRotations((prev) => {
      const copy = { ...prev }
      for (const f of files) {
        for (let i = 0; i < f.count; i++) {
          const isOdd = (i + 1) % 2 === 1
          if ((pattern === 'odd' && isOdd) || (pattern === 'even' && !isOdd)) {
            const key = `${f.id}:${i}`
            const current = prev[key] || 0
            const next = normalizeDeg(current + delta)
            if (next === 0) delete copy[key]
            else copy[key] = next
          }
        }
      }
      return copy
    })
  }, [files])

  const resetFile = useCallback((fileId, count) => {
    setRotations((prev) => {
      const copy = { ...prev }
      for (let i = 0; i < count; i++) {
        delete copy[`${fileId}:${i}`]
      }
      return copy
    })
  }, [])

  const resetAll = useCallback(() => {
    setRotations({})
    setSelectedPages({})
    setDraftInputs({})
  }, [])

  // ── Selection Helpers ───────────────────────────────────────────────────────
  const toggleSelectPage = useCallback((fileId, pageNum) => {
    setSelectedPages((prev) => {
      const current = new Set(prev[fileId] || [])
      if (current.has(pageNum)) current.delete(pageNum)
      else current.add(pageNum)
      return { ...prev, [fileId]: current }
    })
  }, [])

  const selectPatternForFile = useCallback((file, pattern) => {
    setSelectedPages((prev) => {
      const next = new Set()
      for (let p = 1; p <= file.count; p++) {
        if (pattern === 'all') next.add(p)
        else if (pattern === 'odd' && p % 2 === 1) next.add(p)
        else if (pattern === 'even' && p % 2 === 0) next.add(p)
      }
      return { ...prev, [file.id]: next }
    })
    setDraftInputs((prev) => {
      const sel = new Set()
      for (let p = 1; p <= file.count; p++) {
        if (pattern === 'all' || (pattern === 'odd' && p % 2 === 1) || (pattern === 'even' && p % 2 === 0)) sel.add(p)
      }
      return { ...prev, [file.id]: formatSpec(sel) }
    })
  }, [])

  const rotateSelectedInFile = useCallback((file, delta) => {
    const sel = selectedPages[file.id]
    if (!sel || !sel.size) return
    setRotations((prev) => {
      const copy = { ...prev }
      for (const p of sel) {
        const i = p - 1
        const key = `${file.id}:${i}`
        const current = prev[key] || 0
        const next = normalizeDeg(current + delta)
        if (next === 0) delete copy[key]
        else copy[key] = next
      }
      return copy
    })
  }, [selectedPages])

  // ── Counts & Metrics ────────────────────────────────────────────────────────
  const rotatedCountsPerFile = useMemo(() => {
    const map = {}
    for (const f of files) {
      let count = 0
      for (let i = 0; i < f.count; i++) {
        if (rotations[`${f.id}:${i}`]) count++
      }
      map[f.id] = count
    }
    return map
  }, [files, rotations])

  const totalRotatedPages = useMemo(
    () => Object.values(rotatedCountsPerFile).reduce((a, b) => a + b, 0),
    [rotatedCountsPerFile]
  )
  const filesWithRotations = useMemo(
    () => files.filter((f) => (rotatedCountsPerFile[f.id] || 0) > 0).length,
    [files, rotatedCountsPerFile]
  )

  // ── Export Flow ─────────────────────────────────────────────────────────────
  const go = useCallback(
    (mode) => {
      run.run(
        ({ onProgress, shouldCancel }) =>
          runBatch({
            tool: 'rotate',
            mode,
            files,
            states: {},
            opts: { rot: rotations },
            onProgress,
            shouldCancel,
          }),
        zipNameFor('rotate', files.length)
      )
    },
    [files, rotations, run]
  )

  const busy = run.status === 'loading'
  const n = files.length

  const buttons = useMemo(() => {
    if (!n) return []
    const primaryLabel =
      n === 1
        ? '📄 Download Rotated PDF (.pdf)'
        : coarse && n <= 3
        ? `⬇ Download ${n} Rotated Files`
        : `📦 Download ${n} Rotated Files (.zip)`

    const list = [
      {
        label: primaryLabel,
        primary: true,
        disabled: busy,
        onClick: () => go('files'),
      },
    ]
    if (n > 1) {
      list.push({
        label: '📄 Merge & Download (.pdf)',
        disabled: busy,
        onClick: () => go('merged'),
      })
    }
    return list
  }, [n, coarse, busy, go])

  // ── Sidebar: Global Controls ────────────────────────────────────────────────
  const sideTop = (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg2)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13, color: 'var(--text)' }}>Rotate All Files</strong>
        {totalRotatedPages > 0 && (
          <button className="bw-chipbtn" onClick={resetAll} title="Reset all page rotations to 0°">
            Reset all
          </button>
        )}
      </div>

      {/* Main rotation buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <button
          className="bw-chipbtn"
          style={{ height: 32, justifyContent: 'center', fontWeight: 600 }}
          onClick={() => rotateAllFiles(90)}
          title="Rotate every page in all files 90° clockwise"
        >
          <RotateCw size={13} style={{ marginRight: 4 }} /> 90° CW
        </button>
        <button
          className="bw-chipbtn"
          style={{ height: 32, justifyContent: 'center', fontWeight: 600 }}
          onClick={() => rotateAllFiles(-90)}
          title="Rotate every page in all files 90° counter-clockwise"
        >
          <RotateCcw size={13} style={{ marginRight: 4 }} /> 90° CCW
        </button>
        <button
          className="bw-chipbtn"
          style={{ height: 32, justifyContent: 'center', fontWeight: 600 }}
          onClick={() => rotateAllFiles(180)}
          title="Flip every page in all files 180°"
        >
          180° Flip
        </button>
      </div>

      {/* Quick Pattern shortcuts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>Batch pattern:</span>
        <button className="bw-chipbtn" onClick={() => rotatePattern('odd', 90)} title="Rotate odd pages in all files +90°">
          Odd pages CW
        </button>
        <button className="bw-chipbtn" onClick={() => rotatePattern('even', 90)} title="Rotate even pages in all files +90°">
          Even pages CW
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>
        Hover over any page thumbnail to rotate it individually, or click cards to select pages for bulk rotation.
      </div>
    </div>
  )

  // ── Sidebar: Per-File Details ───────────────────────────────────────────────
  const renderSideBody = (f) => {
    const rotCount = rotatedCountsPerFile[f.id] || 0
    const sel = selectedPages[f.id] || new Set()
    const draft = draftInputs[f.id] ?? ''

    const handleRangeChange = (text) => {
      setDraftInputs((prev) => ({ ...prev, [f.id]: text }))
      const { set } = parseSpec(text, f.count)
      setSelectedPages((prev) => ({ ...prev, [f.id]: set }))
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            {rotCount > 0 ? (
              <strong style={{ color: 'var(--brand)' }}>{rotCount} of {f.count} pages rotated</strong>
            ) : (
              'Original orientation'
            )}
          </span>
          {rotCount > 0 && (
            <button className="bw-chipbtn" onClick={() => resetFile(f.id, f.count)} style={{ fontSize: 10, padding: '2px 6px' }}>
              Reset file
            </button>
          )}
        </div>

        {/* Quick file-level rotation buttons */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button className="bw-chipbtn" onClick={() => rotateFile(f, 90)} title="Rotate all pages of this file +90°">
            <RotateCw size={11} style={{ verticalAlign: -1 }} /> Rotate file CW
          </button>
          <button className="bw-chipbtn" onClick={() => rotateFile(f, -90)} title="Rotate all pages of this file -90°">
            <RotateCcw size={11} style={{ verticalAlign: -1 }} /> Rotate file CCW
          </button>
        </div>

        {/* Per-file page range selector */}
        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>Pages in this file:</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="bw-chipbtn" onClick={() => selectPatternForFile(f, 'all')} style={{ fontSize: 10, padding: '1px 5px' }}>All</button>
              <button className="bw-chipbtn" onClick={() => selectPatternForFile(f, 'odd')} style={{ fontSize: 10, padding: '1px 5px' }}>Odd</button>
              <button className="bw-chipbtn" onClick={() => selectPatternForFile(f, 'even')} style={{ fontSize: 10, padding: '1px 5px' }}>Even</button>
              {sel.size > 0 && (
                <button
                  className="bw-chipbtn"
                  onClick={() => {
                    setSelectedPages((prev) => ({ ...prev, [f.id]: new Set() }))
                    setDraftInputs((prev) => ({ ...prev, [f.id]: '' }))
                  }}
                  style={{ fontSize: 10, padding: '1px 5px' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <input
            type="text"
            className="input"
            value={draft}
            placeholder={`e.g. 1-3, 5 (of ${f.count})`}
            onChange={(e) => handleRangeChange(e.target.value)}
            style={{ width: '100%', height: 26, fontSize: 11, padding: '2px 8px' }}
          />

          {sel.size > 0 && (
            <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
              <button
                className="bw-chipbtn"
                style={{ flex: 1, justifyContent: 'center', background: 'var(--bg3)', fontWeight: 600 }}
                onClick={() => rotateSelectedInFile(f, 90)}
              >
                <RotateCw size={11} style={{ marginRight: 3 }} /> Rotate {sel.size} selected CW
              </button>
              <button
                className="bw-chipbtn"
                style={{ justifyContent: 'center', background: 'var(--bg3)' }}
                onClick={() => rotateSelectedInFile(f, -90)}
                title="Rotate selected counter-clockwise"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Grid: Render Page Thumbnail Cards ───────────────────────────────────────
  const renderCard = ({ f, n: docN, i, thumb, color }) => {
    const rot = getRot(f.id, i)
    const isRot = rot !== 0
    const sel = selectedPages[f.id]?.has(i + 1)

    const labelBadge = isRot ? (
      <span style={{ color: 'var(--brand)', fontWeight: 700 }}>
        {rot === 90 ? '⟳ 90°' : rot === 180 ? '180°' : '⟲ 90°'}
      </span>
    ) : null

    // Card Hover Actions
    const actions = (
      <div style={{ display: 'flex', gap: 4 }}>
        <CardBtn title="Rotate 90° clockwise" onClick={() => rotatePage(f.id, i, 90)}>
          <RotateCw size={13} />
        </CardBtn>
        <CardBtn title="Rotate 90° counter-clockwise" onClick={() => rotatePage(f.id, i, -90)}>
          <RotateCcw size={13} />
        </CardBtn>
        <CardBtn
          title="Zoom full resolution"
          onClick={() => setZoomTarget({ file: f.file, pageNum: i + 1, rotation: rot })}
        >
          <ZoomIn size={13} />
        </CardBtn>
        {isRot && (
          <CardBtn title="Reset to original orientation" onClick={() => rotatePage(f.id, i, -rot)} bg="rgba(229,83,75,0.85)">
            <Undo2 size={13} />
          </CardBtn>
        )}
      </div>
    )

    // Selection Indicator Overlay
    const overlay = (
      <div
        onClick={(e) => {
          e.stopPropagation()
          toggleSelectPage(f.id, i + 1)
        }}
        title={sel ? 'Deselect page' : 'Select page'}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: 4,
          background: sel ? color : 'rgba(0,0,0,0.5)',
          border: '1.5px solid #fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 5,
          color: '#fff',
        }}
      >
        {sel && <Check size={13} strokeWidth={3} />}
      </div>
    )

    return (
      <ThumbCard
        thumb={thumb}
        color={color}
        docN={docN}
        page={i + 1}
        rotation={rot}
        label={labelBadge}
        actions={actions}
        overlay={overlay}
        ring={sel ? color : isRot ? 'var(--brand)' : null}
        ariaLabel={`Document ${docN}, page ${i + 1}${isRot ? `, rotated ${rot} degrees` : ''}`}
        onClick={() => rotatePage(f.id, i, 90)}
      />
    )
  }

  const summary = (f) => {
    const c = rotatedCountsPerFile[f.id] || 0
    return c ? `${c} of ${f.count} rotated` : 'original'
  }

  const headerExtra = (f) => {
    const c = rotatedCountsPerFile[f.id] || 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className="bw-chipbtn"
          onClick={() => rotateFile(f, 90)}
          title="Rotate all pages in this section +90°"
          style={{ fontSize: 11 }}
        >
          <RotateCw size={11} style={{ marginRight: 3 }} /> +90° Section
        </button>
        {c > 0 && (
          <button
            className="bw-chipbtn"
            onClick={() => resetFile(f.id, f.count)}
            title="Reset this section to original orientation"
            style={{ fontSize: 11 }}
          >
            Reset
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <BatchLayout
        title="Rotate PDF"
        subtitle="Rotate pages across one or many PDFs"
        topProps={props}
        batch={batch}
        sideTop={sideTop}
        summary={summary}
        renderSideBody={renderSideBody}
        renderCard={renderCard}
        headerExtra={headerExtra}
        emptyHint={
          <div>
            <p style={{ fontWeight: 600, color: 'var(--text2)' }}>Rotate PDF — Batch Mode</p>
            <p style={{ marginTop: 4 }}>
              Drop one or more PDFs. Rotate entire files, patterns (odd/even), or click individual pages to rotate.
            </p>
          </div>
        }
        footer={
          <BatchBar
            summary={
              !n
                ? 'Add PDFs to start'
                : totalRotatedPages
                ? `${totalRotatedPages} page${totalRotatedPages === 1 ? '' : 's'} rotated across ${filesWithRotations} of ${n} file${n === 1 ? '' : 's'}`
                : 'All pages in original orientation'
            }
            note="Unrotated pages stay unchanged · Merged PDF preserves each page's rotation"
            buttons={buttons}
            run={run}
          />
        }
      />

      {zoomTarget && (
        <ZoomModal
          file={zoomTarget.file}
          pageNum={zoomTarget.pageNum}
          rotation={zoomTarget.rotation}
          onClose={() => setZoomTarget(null)}
        />
      )}
    </>
  )
}
