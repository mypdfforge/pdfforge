// Editor store: immutable document operations + undo/redo history. Framework-agnostic (React subscribes via useSyncExternalStore).
import type { DocState, TextElement, TextStyle, Block, Role, RGB, Squeeze, ListInfo, ListKind } from './types.ts'
import type { Measurer } from './fonts.ts'
import { elementIssues, layoutElement } from './layout.ts'
import type { Issue } from './layout.ts'
import { reconstruct, layoutFlow, flowWarnings } from './reflow.ts'
import { isChanged } from './plan.ts'
import { cascadeVerticalShift } from './flow.ts'
import type { CascadeResult } from './flow.ts'
import { intersects } from './geometry.ts'
import type { Rect } from './geometry.ts'
import { findSections } from './sections.ts'
import {
  companionOf, detectMatchingBullet, applyList, stripList, parseMarker,
  hasAnyMarker, markerWidth, renumberLists, derivePitchRatio, isMarkerOnly, exportMarker,
} from './lists.ts'

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
  private preview: { target: Target; text: string; list: ListInfo | null } | null = null
  private flowCache: { doc: DocState; value: CascadeResult } | null = null
  lastLabel = ''

  constructor(doc: DocState, m: Measurer) {
    this.doc = doc.flow !== undefined ? doc : { ...doc, flow: { enabled: true, squeeze: null } }
    this.m = m
  }
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

  setPreview(targetOrId: Target | string, text: string, list: ListInfo | null = null) {
    const target: Target = typeof targetOrId === 'string' ? { kind: 'el', id: targetOrId } : targetOrId
    this.preview = { target, text, list }
    this.emit()
  }
  clearPreview() { if (this.preview) { this.preview = null; this.emit() } }

  effectiveDoc(): DocState {
    const p = this.preview
    if (!p) return this.doc
    const d = this.doc
    if (p.target.kind === 'el') {
      const e = d.els[p.target.id]
      if (!e || (e.text === p.text && e.list === p.list)) return d
      return { ...d, els: { ...d.els, [p.target.id]: { ...e, text: p.text, list: p.list } } }
    }
    return d.blocks ? { ...d, blocks: d.blocks.map((b) => (b.id === p.target.id ? { ...b, text: p.text, edited: true } : b)) } : d
  }

  cascade(): CascadeResult {
    const d = this.effectiveDoc()
    if (this.flowCache?.doc === d) return this.flowCache.value
    const value = cascadeVerticalShift(d, this.m)
    this.flowCache = { doc: d, value }
    return value
  }

  setFlowEnabled(on: boolean) {
    return this.commit(on ? 'Enable Live Flow' : 'Disable Live Flow',
      (d) => (d.mode !== 'design' || !!d.flow?.enabled === on ? d : { ...d, flow: { enabled: on, squeeze: d.flow?.squeeze ?? null } }))
  }

  applySqueeze(sq: Squeeze | null) {
    return this.commit(sq ? 'Fit to page' : 'Clear squeeze',
      (d) => ({ ...d, flow: { enabled: true, squeeze: sq } }))
  }

  moveSection(sectionId: string, beforeSectionId: string | null) {
    return this.commit('Reorder section', (d) => {
      if (!d.blocks) return d
      const secs = findSections(d.blocks)
      const from = secs.findIndex((s) => s.id === sectionId)
      if (from < 0) return d
      const moved = secs.splice(from, 1)[0]
      const to = beforeSectionId ? secs.findIndex((s) => s.id === beforeSectionId) : secs.length
      secs.splice(to < 0 ? secs.length : to, 0, moved)
      const byId = new Map(d.blocks.map((b) => [b.id, b]))
      const targetPage = secs[to]?.page ?? moved.page
      const blocks: Block[] = []
      for (const s of secs) for (const id of s.blockIds) {
        const b = byId.get(id)!
        blocks.push(s.id === moved.id ? { ...b, page: targetPage } : b)
      }
      return { ...d, blocks }
    })
  }

  // ---- element ops --------------------------------------------------------------------------------------------
  private patchEl(d: DocState, id: string, f: (e: TextElement) => TextElement): DocState {
    const e = d.els[id]; if (!e) return d
    const n = f(e); if (n === e) return d
    return { ...d, els: { ...d.els, [id]: n } }
  }
  private editable(e: TextElement) { return !e.locked || !!e.cover || e.created }
  setText(id: string, text: string) {
    const e = this.doc.els[id]
    if (e?.list || hasAnyMarker(text)) {
      return this.setTextWithList(id, text, e?.list ?? null)
    }
    return this.commit('Edit text', (d) => this.patchEl(d, id, (el) => (!this.editable(el) || el.text === text ? el : { ...el, text, wrap: d.flow?.enabled ? true : el.wrap })))
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
    return this.commit('Delete text', (d) => {
      const e = d.els[s.id]; if (!e || !this.editable(e)) return d
      const els = { ...d.els, [s.id]: { ...e, deleted: true } }
      this.deleteCompanions(d, e, els, true)
      return this.finishList({ ...d, els })
    })
  }
  private markDeleted(d: DocState, ids: string[]) { const els = { ...d.els }; for (const i of ids) if (!els[i].locked) els[i] = { ...els[i], deleted: true }; return els }
  restoreDeleted(id: string) {
    return this.commit('Restore text', (d) => {
      const e = d.els[id]; if (!e?.deleted) return d
      const els = { ...d.els, [id]: { ...e, deleted: false } }
      this.deleteCompanions(d, e, els, false)
      return this.finishList({ ...d, els })
    })
  }
  private deleteCompanions(d: DocState, e: TextElement, els: Record<string, TextElement>, deleted: boolean) {
    const ids = [e.list?.externalId, companionOf(d, e)?.id].filter(Boolean) as string[]
    for (const cid of ids) { const a = els[cid]; if (a && !a.locked) els[cid] = { ...a, deleted } }
  }
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
    const d = this.effectiveDoc()
    if (this.issueCache?.doc === d) return this.issueCache.value
    const byId: Record<string, Issue[]> = {}, all: Issue[] = []
    const inBlock = this.blockLineIds()
    let flowMsgs: string[] = [], pageCount = d.pages.length

    if (d.mode === 'design' && d.flow?.enabled) {
      const res = this.cascade()
      for (const id of d.order) {
        const e = d.els[id]
        if (!isChanged(e) || e.deleted || e.locked) continue
        const is = elementIssues(d, e, this.m).filter((i) => i.kind !== 'collision')
        const r = res.rects.get(id)
        if (r) {
          const hits: string[] = []
          for (const [oid, or] of res.rects) {
            if (oid === id || res.shifts.get(oid)?.page !== res.shifts.get(id)?.page) continue
            if (intersects(r, or, 0.8)) hits.push(oid)
          }
          if (hits.length) is.push({ id, kind: 'collision', message: `Overlaps ${hits.length} neighbouring text item${hits.length > 1 ? 's' : ''}.`, with: hits })
        }
        if (is.length) { byId[id] = is; all.push(...is) }
      }
      flowMsgs = res.warnings; pageCount = res.pageCount
    } else {
      for (const id of d.order) {
        const e = d.els[id]
        if (!isChanged(e) || e.deleted || (d.mode === 'reflow' && inBlock.has(id))) continue
        const is = elementIssues(d, e, this.m)
        if (is.length) { byId[id] = is; all.push(...is) }
      }
      if (d.mode === 'reflow' && d.blocks) {
        const f = layoutFlow(d, this.m); flowMsgs = flowWarnings(d, f); pageCount = f.pageCount
        for (const pb of f.placed) { const bad = this.m.canEncode(pb.block.style.family, pb.block.text); if (bad.length && pb.from === 0) all.push({ id: pb.block.id, kind: 'encoding', message: `Characters not supported by the export font: ${bad.join(' ')}` }) }
      }
    }

    const value = { byId, all, flow: flowMsgs, pageCount }
    this.issueCache = { doc: d, value }
    return value
  }
  changedCount() {
    const d = this.doc
    return d.order.filter((k) => isChanged(d.els[k])).length + (d.blocks ?? []).filter((b) => b.edited).length
  }

  setObjectFlow(id: string, flow: 'inline' | 'anchored' | 'pinned') {
    return this.commit(`Set object flow to ${flow}`, (d) => {
      const objs = (d.objects ?? []).map((o) => (o.id === id ? { ...o, flow } : o))
      return { ...d, objects: objs }
    })
  }

  pinObject(id: string) {
    return this.setObjectFlow(id, 'pinned')
  }

  confirmTable(id: string) {
    return this.commit('Confirm table', (d) => {
      const tables = (d.tables ?? []).map((t) => (t.id === id ? { ...t, confidence: 'high' as const } : t))
      return { ...d, tables }
    })
  }

  splitTableAt(id: string, rowIndex: number) {
    return this.commit(`Split table at row ${rowIndex + 1}`, (d) => {
      const t = (d.tables ?? []).find((tbl) => tbl.id === id)
      if (!t || rowIndex <= 0 || rowIndex >= t.ys.length - 1) return d
      const splitY = t.ys[rowIndex]
      const t1: typeof t = {
        ...t,
        id: `${t.id}_a`,
        rect: { ...t.rect, y: splitY, h: t.rect.y + t.rect.h - splitY },
        ys: t.ys.slice(0, rowIndex + 1),
        cells: t.cells.filter((c) => c.r < rowIndex)
      }
      const t2: typeof t = {
        ...t,
        id: `${t.id}_b`,
        rect: { ...t.rect, h: splitY - t.rect.y },
        ys: t.ys.slice(rowIndex),
        cells: t.cells.filter((c) => c.r >= rowIndex).map((c) => ({ ...c, r: c.r - rowIndex }))
      }
      const tables = (d.tables ?? []).filter((tbl) => tbl.id !== id).concat([t1, t2])
      return { ...d, tables }
    })
  }

  listKindOf(id: string): ListKind | null {
    const e = this.doc.els[id]
    if (!e) return null
    if (e.list) return e.list.kind
    const c = companionOf(this.doc, e)
    if (c) return /^\d/.test(c.text.trim()) ? 'number' : 'bullet'
    const p = parseMarker(e.text.split('\n')[0] ?? '')
    return p ? p.kind : null
  }

  listState(target: Target | null): { bullet: boolean; numbered: boolean } {
    if (!target) return { bullet: false, numbered: false }
    const kind = this.listKindOf(target.id)
    return {
      bullet: kind === 'bullet',
      numbered: kind === 'number',
    }
  }

  detectMatchingBullet(page?: number, nearId?: string) { return detectMatchingBullet(this.doc, page, nearId) }

  toggleBullet(targetOrId: Target | string | null) {
    const id = typeof targetOrId === 'string' ? targetOrId : targetOrId?.id
    if (!id) return false
    return this.toggleList(id, 'bullet')
  }

  toggleNumber(targetOrId: Target | string | null) {
    const id = typeof targetOrId === 'string' ? targetOrId : targetOrId?.id
    if (!id) return false
    return this.toggleList(id, 'number')
  }

  toggleList(id: string, kind: ListKind) {
    const cur = this.listKindOf(id)
    return this.commitList(cur === kind ? `Remove ${kind} list` : `${kind === 'bullet' ? 'Bulleted' : 'Numbered'} list`,
      (d) => this.applyListTo(d, id, cur === kind ? null : kind))
  }

  setListMarker(id: string, marker: string) {
    return this.commitList('Bullet style', (d) => {
      const e = d.els[id]; if (!e?.list || e.list.kind !== 'bullet') return d
      const els = { ...d.els }
      if (e.list.externalId) { const a = els[e.list.externalId]; if (a) els[a.id] = { ...a, deleted: true } }
      const indent = markerWidth(marker, e.style, this.m)
      const ne: TextElement = { ...e, text: applyList(e.text, 'bullet', marker), list: { ...e.list, marker, indent, externalId: null } }
      els[id] = ne
      return { ...d, els }
    })
  }

  setTextWithList(id: string, text: string, list: ListInfo | null) {
    this.clearPreview()
    return this.commitList('Edit text', (d) => {
      const e = d.els[id]; if (!e || !this.editable(e)) return d
      const els = { ...d.els }
      let ne: TextElement = { ...e, text }
      const want = list && hasAnyMarker(text) ? list : null
      if (!want && e.list?.externalId) { const a = els[e.list.externalId]; if (a) els[a.id] = { ...a, deleted: true } }
      if (!want && !e.list) {
        const c = companionOf(d, e)
        if (c && hasAnyMarker(text)) return this.applyListTo(d, id, parseMarker(text.split('\n')[0])!.kind)
      }
      ne.list = want ? { ...want } : null
      if (ne.list?.kind === 'number') {
        const suffix = /\d+([.)])/.exec(ne.list.marker)?.[1] ?? '.'
        ne.text = applyList(text, 'number', ne.list.marker, ne.list.start || 1, suffix)
      }
      els[id] = ne
      return this.finishList({ ...d, els })
    })
  }

  private commitList(label: string, fn: (d: DocState) => DocState) {
    return this.commit(label, (d) => {
      const next = fn(d)
      return next === d ? d : this.finishList(next)
    })
  }

  private finishList(d: DocState): DocState {
    const pitchRatio = d.flow?.pitchRatio ?? derivePitchRatio(d)
    const patch = renumberLists(d)
    const els = patch ? { ...d.els, ...patch } : d.els
    return { ...d, els, flow: { ...(d.flow ?? { enabled: false, squeeze: null }), pitchRatio } }
  }

  private applyListTo(d: DocState, id: string, kind: ListKind | null): DocState {
    const e = d.els[id]
    if (!e || !this.editable(e)) return d
    const els = { ...d.els }
    const comp = companionOf(d, e)
    let ne: TextElement = { ...e }

    if (kind === null) {
      if (e.list?.externalId) { const a = els[e.list.externalId]; if (a) els[a.id] = { ...a, deleted: true } }
      if (comp && !comp.deleted) els[comp.id] = { ...comp, deleted: true }
      ne = { ...ne, text: stripList(ne.text), list: null }
      els[id] = ne
      return { ...d, els }
    }

    let marker = kind === 'number' ? '1.' : this.detectMatchingBullet(e.page, id)
    let indent = e.list?.indent ?? 0
    let externalId: string | null = null

    if (comp) {
      const delta = Math.max(0, e.origX - comp.origX)
      indent = Math.max(6, delta)
      ne.x = comp.origX; ne.origX = comp.origX
      ne.origBox = { ...e.origBox, x: comp.origX, w: e.origBox.w + delta }
      ne.maxW = e.maxW + delta
      const glyph = comp.text.trim()
      if (kind === 'bullet') {
        marker = glyph
        const encodable = this.m.canEncode(ne.style.family, glyph).length === 0
        if (!encodable && !comp.locked) { externalId = comp.id; els[comp.id] = { ...comp, deleted: false } }
        else els[comp.id] = { ...comp, deleted: true }
      } else {
        els[comp.id] = { ...comp, deleted: true }
      }
    } else {
      indent = indent || markerWidth(marker, ne.style, this.m)
      if (kind === 'bullet' && exportMarker(marker, ne.style.family, this.m).substituted)
        marker = exportMarker(marker, ne.style.family, this.m).glyph
    }

    ne.wrap = true
    ne.list = { kind, marker, indent, start: 1, externalId }
    ne.text = applyList(ne.text, kind, marker, 1, /\d+([.)])/.exec(marker)?.[1] ?? '.')
    els[id] = ne
    return { ...d, els }
  }
}
export type IssueReport = { byId: Record<string, Issue[]>; all: Issue[]; flow: string[]; pageCount: number }

export function flowOverlays(doc: DocState, res: CascadeResult): { pages: Array<Array<{ key: string; id: string; kind: 'el'; rect: Rect; locked: boolean; changed: boolean }>>; pageCount: number } {
  const pages: Array<Array<{ key: string; id: string; kind: 'el'; rect: Rect; locked: boolean; changed: boolean }>> =
    res.pageBox.map(() => [])
  for (const id of doc.order) {
    const e = doc.els[id]; if (e.deleted) continue
    const sh = res.shifts.get(id)
    const rect = res.rects.get(id) ?? e.origBox
    pages[sh?.page ?? e.page]?.push({ key: id, id, kind: 'el', rect, locked: !!e.locked, changed: isChanged(e) })
  }
  return { pages, pageCount: res.pageCount }
}
