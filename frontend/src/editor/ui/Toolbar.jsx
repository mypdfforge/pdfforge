import React from 'react'
import { ArrowLeft, Undo2, Redo2, ZoomIn, Download, Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, Paintbrush, Highlighter, Trash2, Search, History, Plus, Loader2, Check, AlertCircle, ShieldCheck, Type, PanelLeft } from 'lucide-react'
import { hex, rgb, FAMILIES } from '../ui-util.js'

const SAVE = {
  saving: [<Loader2 key="s" size={12} className="spin" />, 'Saving…'],
  saved: [<Check key="s" size={12} />, 'Saved in this browser'],
  unsaved: [null, 'Unsaved changes'],
  failed: [<AlertCircle key="s" size={12} />, 'Not saved'],
  off: [null, 'Autosave off'],
}
const Btn = ({ icon, label, on, accent, ...p }) => (
  <button type="button" className={`pe-tb${on ? ' on' : ''}${accent ? ' accent' : ''}`} title={label} aria-label={label} aria-pressed={on === undefined ? undefined : !!on} {...p}>{icon}</button>
)

export function TopBar({ doc, store, saveState, saveDetail, zoom, setZoom, onBack, onRename, onExport, onFind, onVersions, onMode, exporting, toggleSide, canVersions }) {
  const [ic, text] = SAVE[saveState] || SAVE.off
  return (
    <div className="pe-bar" role="toolbar" aria-label="Document">
      <button className="icon-btn" onClick={onBack} aria-label="Back to documents" title="Back to documents"><ArrowLeft size={16} /></button>
      <input className="pe-title" aria-label="Document name" value={doc.name} onChange={(e) => onRename(e.target.value)} />
      <span className={`badge${saveState === 'failed' ? '' : ' badge-browser'}`} title={saveDetail} role="status" style={saveState === 'failed' ? { color: 'var(--red)' } : undefined}>{ic}{text}</span>
      <div className="pe-sep" />
      <Btn icon={<Undo2 size={15} />} label="Undo (Ctrl+Z)" disabled={!store.canUndo} onClick={() => store.undo()} />
      <Btn icon={<Redo2 size={15} />} label="Redo (Ctrl+Shift+Z)" disabled={!store.canRedo} onClick={() => store.redo()} />
      <div className="pe-sep" />
      <button className="pe-tb" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(Math.max(0.4, +(zoom - 0.1).toFixed(2)))}>–</button>
      <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }} aria-live="polite">{Math.round(zoom * 100)}%</span>
      <Btn icon={<ZoomIn size={15} />} label="Zoom in" onClick={() => setZoom(Math.min(3, +(zoom + 0.1).toFixed(2)))} />
      <div className="pe-sep" />
      <select className="pe-sel" aria-label="Editing mode" value={doc.mode} onChange={(e) => onMode(e.target.value)} title="Design Lock keeps the original layout. Document Reflow lets paragraphs grow and flow onto new pages.">
        <option value="design">Design Lock</option>
        <option value="reflow">Document Reflow</option>
      </select>
      <Btn icon={<Search size={15} />} label="Find & replace" onClick={onFind} />
      <Btn icon={<History size={15} />} label="Version history" onClick={onVersions} disabled={!canVersions} />
      <span className="pe-spacer" />
      <button className="pe-tb pe-toggle-side" onClick={toggleSide} aria-label="Toggle properties panel"><PanelLeft size={15} /></button>
      <span className="badge badge-browser" title="Rendering, editing and export all run in this browser tab."><ShieldCheck size={12} /> Runs on your device</span>
      <button className="btn btn-primary" onClick={onExport} disabled={exporting}>{exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Export PDF</button>
    </div>
  )
}

export function FormatBar({ store, target, style, tool, setTool, onApplyAll, matchCount }) {
  const off = !target || !style
  const set = (patch, label) => store.setStyle(patch, label)
  const s = style || { family: 'Helvetica', size: 11, bold: false, italic: false, underline: false, strike: false, color: [0, 0, 0], highlight: null, align: 'left', lineHeight: 1.2, charSpacing: 0, wordSpacing: 0 }
  const kind = target?.kind
  return (
    <div className="pe-bar fmt" role="toolbar" aria-label="Text formatting">
      <select className="pe-sel" aria-label="Font family" disabled={off} value={s.family} onChange={(e) => set({ family: e.target.value }, 'Font family')}>
        {FAMILIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button className="pe-tb" disabled={off} aria-label="Decrease font size" onClick={() => set({ size: Math.max(4, +(s.size - 0.5).toFixed(2)) }, 'Font size')}>–</button>
      <input className="pe-num" type="number" step="0.5" min="4" max="200" aria-label="Font size" disabled={off} value={+s.size.toFixed(2)} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 4 && v <= 200) set({ size: v }, 'Font size') }} />
      <button className="pe-tb" disabled={off} aria-label="Increase font size" onClick={() => set({ size: Math.min(200, +(s.size + 0.5).toFixed(2)) }, 'Font size')}>+</button>
      <div className="pe-sep" />
      <Btn icon={<Bold size={15} />} label="Bold (Ctrl+B)" on={s.bold} disabled={off} onClick={() => set({ bold: !s.bold }, 'Bold')} />
      <Btn icon={<Italic size={15} />} label="Italic (Ctrl+I)" on={s.italic} disabled={off} onClick={() => set({ italic: !s.italic }, 'Italic')} />
      <Btn icon={<Underline size={15} />} label="Underline (Ctrl+U)" on={s.underline} disabled={off} onClick={() => set({ underline: !s.underline }, 'Underline')} />
      <Btn icon={<Strikethrough size={15} />} label="Strikethrough" on={s.strike} disabled={off} onClick={() => set({ strike: !s.strike }, 'Strikethrough')} />
      <div className="pe-sep" />
      <label title="Text colour" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Type size={14} /><input type="color" aria-label="Text colour" disabled={off} value={hex(s.color)} onChange={(e) => set({ color: rgb(e.target.value) }, 'Text colour')} /></label>
      <label title="Highlight colour" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Highlighter size={14} /><input type="color" aria-label="Highlight colour" disabled={off} value={hex(s.highlight || [1, 1, 0])} onChange={(e) => set({ highlight: rgb(e.target.value) }, 'Highlight')} /></label>
      <button className="pe-tb" disabled={off || !s.highlight} onClick={() => set({ highlight: null }, 'Remove highlight')}>No highlight</button>
      <div className="pe-sep" />
      {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]].map(([a, I]) => (
        <Btn key={a} icon={<I size={15} />} label={`Align ${a}`} on={s.align === a} disabled={off} onClick={() => set({ align: a }, 'Alignment')} />
      ))}
      <select className="pe-sel" aria-label="Line spacing" disabled={off} value={String(s.lineHeight)} onChange={(e) => set({ lineHeight: parseFloat(e.target.value) }, 'Line spacing')} title="Line spacing">
        {[1, 1.2, 1.5, 2].map((v) => <option key={v} value={v}>Line {v}</option>)}
      </select>
      <label className="pe-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Tracking
        <input className="pe-num" type="number" step="0.1" min="-2" max="10" disabled={off} aria-label="Character spacing" value={s.charSpacing} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) set({ charSpacing: v }, 'Character spacing') }} style={{ width: 52 }} /></label>
      <label className="pe-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Word
        <input className="pe-num" type="number" step="0.5" min="-5" max="30" disabled={off} aria-label="Word spacing" value={s.wordSpacing} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) set({ wordSpacing: v }, 'Word spacing') }} style={{ width: 52 }} /></label>
      <div className="pe-sep" />
      <select className="pe-sel" aria-label="Change case" disabled={off} value="" onChange={(e) => { if (e.target.value) store.applyCase(e.target.value) }}>
        <option value="">Case…</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option><option value="title">Title Case</option>
      </select>
      <Btn icon={<Paintbrush size={15} />} label={store.painter ? 'Format Painter on: click text to paste the format (Esc cancels)' : 'Format Painter: copy this format'} on={!!store.painter} accent disabled={off && !store.painter} onClick={() => (store.painter ? store.cancelPainter() : store.startPainter())} />
      <button className="pe-tb" disabled={off || matchCount < 2} onClick={onApplyAll} title="Apply the current formatting to every item that currently looks the same">Apply to {matchCount > 1 ? matchCount : 'all'} matching</button>
      <div className="pe-sep" />
      <Btn icon={<Plus size={15} />} label={tool === 'add' ? 'Click on the page to place new text' : 'Add text box'} on={tool === 'add'} accent onClick={() => setTool(tool === 'add' ? null : 'add')} />
      <Btn icon={<Trash2 size={15} />} label="Delete (Del)" disabled={off} onClick={() => store.deleteSelected()} />
    </div>
  )
}
