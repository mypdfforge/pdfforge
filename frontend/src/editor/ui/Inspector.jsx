import React, { useState } from 'react'
import { AlertCircle, Lock, ShieldCheck, Check } from 'lucide-react'
import { FAMILIES } from '../ui-util.js'
import { FAMILY_LABEL, stripSubset } from '../core/fonts.ts'

const KIND = { overflow: 'Overflow', collision: 'Overlap', encoding: 'Font' }
const FID = { exact: ['Original font', 'pe-ok'], 'metric-compatible': ['Metric-compatible standard font', 'pe-ok'], substituted: ['Substituted font', ''] }

export default function Inspector({ session, store, doc, sel, target, issues, pageCount, cur, onMode, onCover, onEdit, onSelect }) {
  const [fam, setFam] = useState('Helvetica')
  const isBlock = sel?.kind === 'block'
  const mine = sel ? (issues.byId[sel.id] || issues.all.filter((i) => i.id === sel.id)) : []
  const origPages = doc.pages.length
  const changed = store.changedCount()
  const pageIssues = issues.all.filter((i) => i.kind !== 'encoding' || true)
  const blocks = doc.mode === 'reflow' ? (doc.blocks || []).filter((b) => b.page === Math.min(cur, origPages - 1)) : []
  return (
    <>
      <section>
        <h4>Selection</h4>
        {!target && <div className="pe-muted">Click text to select it. Double-click (or press Enter) to edit. Use <b>Add text</b> in the toolbar to place new text.</div>}
        {target && !isBlock && <ElementInfo store={store} el={target} mine={mine} onMode={onMode} onCover={onCover} onEdit={() => onEdit(sel)} />}
        {target && isBlock && <BlockInfo store={store} b={target} onEdit={() => onEdit(sel)} />}
      </section>

      {(pageIssues.length > 0 || issues.flow.length > 0) && (
        <section>
          <h4>Layout &amp; warnings</h4>
          {issues.flow.map((m, i) => <div key={i} className="pe-card pe-warn" style={{ marginBottom: 6 }}><AlertCircle size={13} /> {m}</div>)}
          {pageIssues.map((it, i) => {
            const isB = !!doc.blocks?.some((b) => b.id === it.id)
            return <button key={i} className="pe-card pe-warn" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              onClick={() => onSelect({ kind: isB ? 'block' : 'el', id: it.id }, isB ? doc.blocks.find((b) => b.id === it.id).page : doc.els[it.id]?.page)}><b>{KIND[it.kind]}:</b> {it.message}</button>
          })}
        </section>
      )}

      {doc.mode === 'reflow' && (
        <section>
          <h4>Paragraphs on page {Math.min(cur, origPages - 1) + 1}</h4>
          <div className="pe-muted" style={{ marginBottom: 6 }}>Reflow rebuilt these blocks from the page text. Check the roles; change anything that was guessed wrong.</div>
          {blocks.map((b) => (
            <button key={b.id} className="pe-card" onClick={() => onSelect({ kind: 'block', id: b.id }, null)}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 5, padding: '6px 8px', cursor: 'pointer', font: 'inherit', color: 'inherit', opacity: b.included ? 1 : 0.55, borderColor: sel?.id === b.id ? 'var(--brand)' : undefined }}>
              <span className="badge" style={{ marginRight: 6 }}>{b.included ? b.role : 'fixed'}</span>
              <span className="pe-muted">{b.text.slice(0, 54)}{b.text.length > 54 ? '…' : ''}</span>
            </button>
          ))}
        </section>
      )}

      <section>
        <h4>Whole document</h4>
        <div className="row"><span>Pages</span><b>{pageCount}{pageCount !== origPages ? ` (was ${origPages})` : ''}</b></div>
        <div className="row"><span>Edited items</span><b>{changed}</b></div>
        <div className="row"><span>Mode</span><b>{doc.mode === 'design' ? 'Design Lock' : 'Document Reflow'}</b></div>
        <div className="pe-actions" style={{ alignItems: 'center' }}>
          <select className="pe-sel" aria-label="Font for whole document" value={fam} onChange={(e) => setFam(e.target.value)}>{FAMILIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="btn btn-ghost" onClick={() => store.replaceFamilyEverywhere(fam)}>Use everywhere</button>
        </div>
        <div className="pe-muted" style={{ marginTop: 8 }}>
          {doc.mode === 'design' ? 'Design Lock keeps every original position. Longer text is flagged, never clipped or drawn over neighbours.' : 'Document Reflow moves following paragraphs and adds pages as text grows. Images and vector graphics are not tracked, so check pages that contain them.'}
        </div>
      </section>
      <section className="pe-muted"><ShieldCheck size={13} style={{ verticalAlign: -2 }} /> Processed entirely in your browser. Autosaved only in this browser's storage.</section>
    </>
  )
}

function ElementInfo({ store, el, mine, onMode, onCover, onEdit }) {
  const f = FID[el.fidelity] || FID.substituted
  const edited = el.text !== el.originalText
  return (
    <div>
      <div className="pe-card" style={{ marginBottom: 8, wordBreak: 'break-word' }}>
        {el.deleted ? <i>Deleted</i> : el.text || <i>(empty)</i>}
        {edited && !el.created && <div className="pe-muted" style={{ marginTop: 4 }}>Original: {el.originalText}</div>}
      </div>
      {el.locked && !el.cover && !el.created && (
        <div className="pe-card pe-warn"><Lock size={13} style={{ verticalAlign: -2 }} /> <b>Locked.</b> {el.locked}
          {/form|pattern|unsupported/i.test(el.locked) && <div className="pe-actions"><button className="btn btn-ghost" onClick={() => onCover(el)}>Cover &amp; replace…</button></div>}
        </div>
      )}
      <div className="row"><span>Original font</span><b title={el.mappedFont}>{stripSubset(el.mappedFont) || 'unknown'}</b></div>
      <div className="row"><span>Export font</span><b>{FAMILY_LABEL[el.style.family]}{el.style.bold ? ' Bold' : ''}{el.style.italic ? ' Italic' : ''}</b></div>
      <div className="row"><span>Fidelity</span><b className={f[1]}>{f[0]}</b></div>
      {el.fontNote && <div className="pe-muted" style={{ margin: '4px 0 8px' }}>{el.fontNote}</div>}
      <div className="row"><span>Size</span><b>{+el.style.size.toFixed(2)} pt</b></div>
      <div className="row"><span>Position</span><b>{Math.round(el.x)}, {Math.round(el.baseline)} pt</b></div>
      <div className="row"><span>Available width</span><b>{Math.round(el.maxW)} pt</b></div>
      <div className="row"><span>Wrap</span><b>{el.wrap ? 'On' : 'Off'}</b></div>
      {mine.map((it, i) => (
        <div key={i} className="pe-card pe-warn" style={{ marginTop: 8 }}><AlertCircle size={13} style={{ verticalAlign: -2 }} /> {it.message}
          {it.kind === 'overflow' && <div className="pe-actions">
            <button className="btn btn-ghost" onClick={() => store.setWrap(el.id, true)}>Wrap onto extra lines</button>
            <button className="btn btn-ghost" onClick={() => store.shrinkToFit(el.id)}>Shrink to fit</button>
            <button className="btn btn-ghost" onClick={() => onMode('reflow')}>Use Reflow</button></div>}
          {it.kind === 'collision' && <div className="pe-actions"><button className="btn btn-ghost" onClick={() => store.shrinkToFit(el.id)}>Shrink to fit</button><button className="btn btn-ghost" onClick={() => onMode('reflow')}>Use Reflow</button></div>}
        </div>
      ))}
      <div className="pe-actions">
        {!el.locked || el.cover || el.created ? <button className="btn btn-ghost" onClick={onEdit}>Edit text</button> : null}
        {el.wrap && <button className="btn btn-ghost" onClick={() => store.setWrap(el.id, false)}>Unwrap</button>}
        {el.deleted && <button className="btn btn-ghost" onClick={() => store.restoreDeleted(el.id)}>Restore</button>}
      </div>
    </div>
  )
}

function BlockInfo({ store, b, onEdit }) {
  return (
    <div>
      <div className="pe-card" style={{ marginBottom: 8, wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>{b.text}</div>
      <div className="row"><span>Role</span>
        <select className="pe-sel" aria-label="Paragraph role" value={b.role} onChange={(e) => store.setBlockRole(b.id, e.target.value)}>
          <option value="heading">Heading</option><option value="paragraph">Paragraph</option><option value="bullet">Bullet item</option></select></div>
      <div className="row"><span>Space before</span>
        <select className="pe-sel" aria-label="Paragraph spacing" value={String(b.spacing)} onChange={(e) => store.setBlockSpacing(b.id, parseFloat(e.target.value))}>
          {[0, 0.5, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v === 1 ? 'Original' : `× ${v}`}</option>)}</select></div>
      <div className="row"><span>Original lines</span><b>{b.lineIds.length}</b></div>
      <div className="row"><span>Column width</span><b>{Math.round(b.width)} pt</b></div>
      <div className="row"><span>Keeps row items</span><b>{b.followers.length}</b></div>
      <div className="pe-actions">
        <button className="btn btn-ghost" onClick={onEdit}>Edit paragraph</button>
        <button className="btn btn-ghost" onClick={() => store.mergeWithPrevious(b.id)} title="Join with the paragraph above">Merge up</button>
        <button className="btn btn-ghost" onClick={() => store.setBlockIncluded(b.id, !b.included)}>{b.included ? 'Keep fixed' : 'Include in flow'}</button>
      </div>
    </div>
  )
}
