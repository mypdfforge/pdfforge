// Editor store: immutable document operations + undo/redo history. Framework-agnostic (React subscribes via useSyncExternalStore).
import type { DocState, TextElement, TextStyle, Block, Role, RGB } from './types.ts'
import type { Measurer } from './fonts.ts'
import { elementIssues } from './layout.ts'
import type { Issue } from './layout.ts'
import { reconstruct, layoutFlow, flowWarnings } from './reflow.ts'
import { isChanged } from './plan.ts'

export type Target = { kind: 'el' | 'block'; id: string }
const HISTORY_LIMIT = 100
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const title = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase())

export class EditorStore {
  doc: DocState
  past: Array<{ label: string; doc: DocState }> = []
  future: Array<{ label: string; doc: DocState }> = []
  selection: Target | null = null
  painter: TextStyle | null = null
  version = 0
  dirty = false
  m: Measurer
  private listeners = new Set<() => void>()
  private issueCache: { doc: DocState; value: IssueReport } | null = null
  lastLabel = ''

  constructor(doc: DocState, m: Measurer) { this.doc = doc; this.m = m }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getVersion = () => this.version
  private emit() { this.version++; this.listeners.forEach((f) => f()) }

  /** Every mutation goes through here: one history entry per user action. */
  commit(label: string, fn: (d: DocState) => DocState) {
    const next = fn(this.doc)
    if (next === this.doc) return false
    this.past.push({ label, doc: this.doc })
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.doc = next; this.dirty = true; this.lastLabel = label
    this.emit(); return true
  }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  undo() { const h = this.past.pop(); if (!h) return; this.future.push({ label: h.label, doc: this.doc }); this.doc = h.doc; this.dirty = true; this.fixSelection(); this.emit() }
  redo() { const h = this.future.pop(); if (!h) return; this.past.push({ label: h.label, doc: this.doc }); this.doc = h.doc; this.dirty = true; this.fixSelection(); this.emit() }
  private fixSelection() {
    const s = this.selection
    if (s && (s.kind === 'el' ? !this.doc.els[s.id] : !this.doc.blocks?.some((b) => b.id === s.id))) this.selection = null
  }
  select(t: Target | null) { this.selection = t; this.emit() }

  // ---- element ops --------------------------------------------------------------------------------------------
  private patchEl(d: DocState, id: string, f: (e: TextElement) => TextElement): DocState {
    const e = d.els[id]; if (!e) return d
    const n = f(e); if (n === e) return d
    return { ...d, els: { ...d.els, [id]: n } }
  }
  private editable(e: TextElement) { return !e.locked || !!e.cover || e.created }
  setText(id: string, text: string) {
    return this.commit('Edit text', (d) => this.patchEl(d, id, (e) => (!this.editable(e) || e.text === text ? e : { ...e, text })))
  }
  setStyle(patch: Partial<TextStyle>, label = 'Format') {
    const s = this.selection; if (!s) return false
    return s.kind === 'block' ? this.setBlockStyle(s.id, patch, label) : this.commit(label, (d) => this.patchEl(d, s.id, (e) => (this.editable(e) ? { ...e, style: { ...e.style, ...patch } } : e)))
  }
  moveElement(id: string, dx: number, dy: number) {
    return this.commit('Move text', (d) => this.patchEl(d, id, (e) => (this.editable(e) ? { ...e, x: e.x + dx, baseline: e.baseline + dy, maxW: Math.max(e.maxW - dx, e.origBox.w) } : e)))
  }
  deleteSelected() {
    const s = this.selection; if (!s) return false
    if (s.kind === 'block') return this.commit('Delete paragraph', (d) => ({ ...d, blocks: d.blocks!.map((b) => (b.id === s.id ? { ...b, included: false } : b)), els: this.markDeleted(d, d.blocks!.find((b) => b.id === s.id)!.lineIds) }))
    return this.commit('Delete text', (d) => this.patchEl(d, s.id, (e) => (this.editable(e) ? { ...e, deleted: true } : e)))
  }
  private markDeleted(d: DocState, ids: string[]) { const els = { ...d.els }; for (const i of ids) if (!els[i].locked) els[i] = { ...els[i], deleted: true }; return els }
  restoreDeleted(id: string) { return this.commit('Restore text', (d) => this.patchEl(d, id, (e) => (e.deleted ? { ...e, deleted: false } : e))) }
  addText(page: number, x: number, baseline: number, text = 'New text') {
    const d0 = this.doc
    const base = d0.order.map((k) => d0.els[k]).find((e) => e.page === page && !e.locked)?.style
    const style: TextStyle = base ?? { family: 'Helvetica', bold: false, italic: false, underline: false, strike: false, size: 11, color: [0, 0, 0], highlight: null, charSpacing: 0, wordSpacing: 0, align: 'left', lineHeight: 1.2 }
    const pm = d0.pages[page]
    const id = `n${Date.now().toString(36)}${d0.order.length}`
    const maxW = Math.max(40, pm.x0 + pm.width - 36 - x)
    const el: TextElement = { id, page, text, originalText: '', style, originalStyle: style, origBox: { x, y: baseline - 3, w: 40, h: style.size }, x, baseline, origX: x, origBaseline: baseline, maxW, wrap: true, movable: false, ops: [], locked: null, cover: null, mappedFont: 'Helvetica', fidelity: 'exact', fontNote: null, deleted: false, created: true }
    this.commit('Add text', (d) => ({ ...d, els: { ...d.els, [id]: el }, order: [...d.order, id] }))
    this.selection = { kind: 'el', id }; this.emit()
    return id
  }
  setWrap(id: string, wrap: boolean) { return this.commit(wrap ? 'Wrap text' : 'Unwrap text', (d) => this.patchEl(d, id, (e) => (this.editable(e) && e.wrap !== wrap ? { ...e, wrap } : e))) }
  /** Smallest reduction (down to 70%) that makes a single line fit its region. */
  shrinkToFit(id: string) {
    return this.commit('Shrink to fit', (d) => this.patchEl(d, id, (e) => {
      if (!this.editable(e)) return e
      const fits = (sz: number) => this.m.width(e.text, { ...e.style, size: sz }) <= e.maxW + 0.5
      let sz = e.style.size
      const floor = e.style.size * 0.7
      while (sz > floor && !fits(sz)) sz = Math.round((sz - 0.25) * 100) / 100
      return fits(sz) && sz !== e.style.size ? { ...e, style: { ...e.style, size: sz }, wrap: false } : e
    }))
  }
  /** User explicitly accepts covering the original of a locked element with a flat colour (sampled from the page). */
  coverLocked(id: string, color: RGB) {
    return this.commit('Cover & replace', (d) => this.patchEl(d, id, (e) => (e.locked && !e.cover ? { ...e, cover: color } : e)))
  }
  applyCase(mode: 'upper' | 'lower' | 'title') {
    const s = this.selection; if (!s) return false
    const f = (t: string) => (mode === 'upper' ? t.toUpperCase() : mode === 'lower' ? t.toLowerCase() : title(t.toLowerCase()))
    return s.kind === 'block' ? this.setBlockText(s.id, f(this.doc.blocks!.find((b) => b.id === s.id)!.text)) : this.setText(s.id, f(this.doc.els[s.id].text))
  }

  // ---- Format Painter ---------------------------------------------------------------------------------------------
  startPainter() {
    const s = this.selection; if (!s) return false
    this.painter = s.kind === 'block' ? { ...this.doc.blocks!.find((b) => b.id === s.id)!.style } : { ...this.doc.els[s.id].style }
    this.emit(); return true
  }
  cancelPainter() { if (this.painter) { this.painter = null; this.emit() } }
  /** Copies formatting only: never text or geometry. */
  paintOn(t: Target) {
    const st = this.painter; if (!st) return false
    this.selection = t
    const ok = t.kind === 'block' ? this.setBlockStyle(t.id, st, 'Format painter') : this.commit('Format painter', (d) => this.patchEl(d, t.id, (e) => (this.editable(e) && !same(e.style, st) ? { ...e, style: { ...st } } : e)))
    this.painter = null; this.emit(); return ok
  }

  // ---- global operations --------------------------------------------------------------------------------------------
  /** Elements/blocks whose formatting is identical to the target's (family, size, weight, colour). */
  matchSelection(): { els: string[]; blocks: string[] } {
    const s = this.selection, d = this.doc
    if (!s) return { els: [], blocks: [] }
    const ref = s.kind === 'block' ? d.blocks!.find((b) => b.id === s.id)!.style : d.els[s.id].style
    const sig = (x: TextStyle) => [x.family, x.bold, x.italic, x.size, x.color.join()].join('|')
    const inBlock = this.blockLineIds()
    return {
      els: d.order.filter((k) => !d.els[k].locked && !d.els[k].deleted && (d.mode === 'design' || !inBlock.has(k)) && sig(d.els[k].style) === sig(ref)),
      blocks: d.mode === 'reflow' ? (d.blocks ?? []).filter((b) => b.included && sig(b.style) === sig(ref)).map((b) => b.id) : [],
    }
  }
  private blockLineIds() { const s = new Set<string>(); for (const b of this.doc.blocks ?? []) if (b.included) b.lineIds.forEach((i) => s.add(i)); return s }
  applyToAll(match: { els: string[]; blocks: string[] }, patch: Partial<TextStyle>, label: string) {
    return this.commit(label, (d) => {
      const els = { ...d.els }
      for (const id of match.els) els[id] = { ...els[id], style: { ...els[id].style, ...patch } }
      let blocks = d.blocks
      if (blocks && match.blocks.length) blocks = blocks.map((b) => (match.blocks.includes(b.id) ? this.reedit(d, { ...b, style: { ...b.style, ...patch } }) : b))
      return { ...d, els, blocks }
    })
  }
  replaceFamilyEverywhere(family: TextStyle['family']) {
    const d = this.doc, inBlock = this.blockLineIds()
    const els = d.order.filter((k) => !d.els[k].locked && (d.mode === 'design' || !inBlock.has(k)))
    return this.applyToAll({ els, blocks: d.mode === 'reflow' ? (d.blocks ?? []).filter((b) => b.included).map((b) => b.id) : [] }, { family }, 'Change font everywhere')
  }
  /** Replace text across the document. Returns number of replacements (0 = nothing changed). */
  findReplace(find: string, repl: string, caseSensitive = false) {
    if (!find) return 0
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
    let n = 0
    const d0 = this.doc, inBlock = this.blockLineIds()
    this.commit('Replace text', (d) => {
      const els = { ...d.els }
      for (const id of d.order) {
        const e = els[id]
        if (e.locked || e.deleted || (d.mode === 'reflow' && inBlock.has(id))) continue
        const t = e.text.replace(re, () => { n++; return repl })
        if (t !== e.text) els[id] = { ...e, text: t }
      }
      let blocks = d.blocks
      if (blocks && d.mode === 'reflow') blocks = blocks.map((b) => { if (!b.included) return b; const t = b.text.replace(re, () => { n++; return repl }); return t === b.text ? b : this.reedit(d, { ...b, text: t }) })
      return n ? { ...d, els, blocks } : d
    })
    void d0
    return n
  }

  // ---- reflow blocks ---------------------------------------------------------------------------------------------------
  private reedit(d: DocState, b: Block): Block {
    const first = d.els[b.lineIds[0]]
    const orig = b.lineIds.map((i) => d.els[i].text).join(' ')
    return { ...b, edited: b.text !== orig || !same(b.style, first.style) }
  }
  private patchBlock(id: string, label: string, f: (b: Block, d: DocState) => Block) {
    return this.commit(label, (d) => {
      if (!d.blocks) return d
      const i = d.blocks.findIndex((b) => b.id === id); if (i < 0) return d
      const nb = f(d.blocks[i], d); if (nb === d.blocks[i]) return d
      const blocks = d.blocks.slice(); blocks[i] = this.reedit(d, nb)
      return { ...d, blocks }
    })
  }
  setBlockText(id: string, text: string) { return this.patchBlock(id, 'Edit paragraph', (b) => (b.text === text ? b : { ...b, text })) }
  setBlockStyle(id: string, patch: Partial<TextStyle>, label = 'Format') { return this.patchBlock(id, label, (b) => (Object.entries(patch).every(([k, v]) => same((b.style as any)[k], v)) ? b : { ...b, style: { ...b.style, ...patch } })) }
  setBlockRole(id: string, role: Role) { return this.patchBlock(id, 'Change role', (b) => (b.role === role ? b : { ...b, role })) }
  setBlockSpacing(id: string, spacing: number) { return this.patchBlock(id, 'Paragraph spacing', (b) => (b.spacing === spacing ? b : { ...b, spacing })) }
  setBlockIncluded(id: string, included: boolean) { return this.patchBlock(id, included ? 'Include in flow' : 'Keep fixed', (b) => (b.included === included ? b : { ...b, included })) }
  mergeWithPrevious(id: string) {
    return this.commit('Merge paragraphs', (d) => {
      const bs = d.blocks; if (!bs) return d
      const i = bs.findIndex((b) => b.id === id)
      const p = bs[i - 1], b = bs[i]
      if (i < 1 || p.page !== b.page || p.role === 'heading' || b.role === 'heading') return d
      const merged: Block = { ...p, lineIds: [...p.lineIds, ...b.lineIds], text: p.text + ' ' + b.text, bottom: b.bottom, width: Math.min(p.width, b.width), followers: [...p.followers, ...b.followers.map((f) => ({ ...f, line: f.line + p.lineIds.length }))] }
      const nb = bs.slice(); nb.splice(i - 1, 2, this.reedit(d, merged))
      return { ...d, blocks: nb }
    })
  }
  /** Switch mode. Reflow reconstructs blocks on first use; returning to Design Lock discards reflow-only changes (undoable). */
  setMode(mode: 'design' | 'reflow'): { notes: string[] } {
    const notes: string[] = []
    this.commit(mode === 'reflow' ? 'Switch to Document Reflow' : 'Switch to Design Lock', (d) => {
      if (d.mode === mode) return d
      if (mode === 'reflow') { const r = reconstruct(d); notes.push(...r.notes); return { ...d, mode, blocks: r.blocks } }
      return { ...d, mode, blocks: null }
    })
    this.selection = null; this.emit()
    return { notes }
  }

  // ---- diagnostics ------------------------------------------------------------------------------------------------------
  issues(): IssueReport {
    if (this.issueCache?.doc === this.doc) return this.issueCache.value
    const d = this.doc, byId: Record<string, Issue[]> = {}, all: Issue[] = []
    const inBlock = this.blockLineIds()
    for (const id of d.order) {
      const e = d.els[id]
      if (!isChanged(e) || e.deleted || (d.mode === 'reflow' && inBlock.has(id))) continue
      const is = elementIssues(d, e, this.m)
      if (is.length) { byId[id] = is; all.push(...is) }
    }
    let flowMsgs: string[] = [], pageCount = d.pages.length
    if (d.mode === 'reflow' && d.blocks) {
      const f = layoutFlow(d, this.m); flowMsgs = flowWarnings(d, f); pageCount = f.pageCount
      for (const pb of f.placed) { const bad = this.m.canEncode(pb.block.style.family, pb.block.text); if (bad.length && pb.from === 0) all.push({ id: pb.block.id, kind: 'encoding', message: `Characters not supported by the export font: ${bad.join(' ')}` }) }
    }
    const value = { byId, all, flow: flowMsgs, pageCount }
    this.issueCache = { doc: d, value }
    return value
  }
  changedCount() {
    const d = this.doc
    return d.order.filter((k) => isChanged(d.els[k])).length + (d.blocks ?? []).filter((b) => b.edited).length
  }
}
export type IssueReport = { byId: Record<string, Issue[]>; all: Issue[]; flow: string[]; pageCount: number }
