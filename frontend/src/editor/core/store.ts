// Editor store: immutable document operations + undo/redo history. Framework-agnostic (React subscribes via useSyncExternalStore).
import type { DocState, TextElement, TextStyle, Block, Role, RGB, Squeeze } from './types.ts'
import type { Measurer } from './fonts.ts'
import { elementIssues } from './layout.ts'
import type { Issue } from './layout.ts'
import { reconstruct, layoutFlow, flowWarnings } from './reflow.ts'
import { isChanged } from './plan.ts'
import { cascadeVerticalShift } from './flow.ts'
import type { CascadeResult } from './flow.ts'
import { intersects } from './geometry.ts'
import type { Rect } from './geometry.ts'
import { findSections } from './sections.ts'

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
  private preview: { target: Target; text: string } | null = null
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

  setPreview(target: Target, text: string) { this.preview = { target, text }; this.emit() }
  clearPreview() { if (this.preview) { this.preview = null; this.emit() } }

  effectiveDoc(): DocState {
    const p = this.preview
    if (!p) return this.doc
    const d = this.doc
    if (p.target.kind === 'el') {
      const e = d.els[p.target.id]
      return !e || e.text === p.text ? d : { ...d, els: { ...d.els, [p.target.id]: { ...e, text: p.text } } }
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
    return this.commit('Edit text', (d) => this.patchEl(d, id, (e) => (!this.editable(e) || e.text === text ? e : { ...e, text, wrap: d.flow?.enabled ? true : e.wrap })))
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

  listState(target: { kind: 'el' | 'block'; id: string } | null): { bullet: boolean; numbered: boolean } {
    if (!target) return { bullet: false, numbered: false }
    const d = this.effectiveDoc()
    const isBlock = target.kind === 'block'
    const obj = isBlock ? d.blocks?.find((b) => b.id === target.id) : d.els[target.id]
    if (!obj || !obj.text.trim()) return { bullet: false, numbered: false }
    const firstLine = obj.text.split('\n')[0]
    return {
      bullet: /^\s*[-•–*▪◦·●]\s*/.test(firstLine),
      numbered: /^\s*\d+[.)]\s*/.test(firstLine)
    }
  }

  detectMatchingBullet(page?: number): string {
    const d = this.effectiveDoc()
    const counts = new Map<string, number>()
    const regex = /^\s*([●•▪◦–\-*·])/
    const els = Object.values(d.els)
    const pageEls = page !== undefined ? els.filter((e) => e.page === page) : els

    for (const el of pageEls) {
      for (const line of el.text.split('\n')) {
        const m = line.match(regex)
        if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
      }
    }
    if (!counts.size && page !== undefined) {
      for (const el of els) {
        for (const line of el.text.split('\n')) {
          const m = line.match(regex)
          if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
        }
      }
    }
    let bestChar = '•', maxCount = 0
    for (const [char, count] of counts.entries()) {
      if (count > maxCount) { maxCount = count; bestChar = char }
    }
    return bestChar
  }

  toggleBullet(target: { kind: 'el' | 'block'; id: string } | null) {
    if (!target) return
    const d = this.effectiveDoc()
    const isBlock = target.kind === 'block'
    const obj = isBlock ? d.blocks?.find((b) => b.id === target.id) : d.els[target.id]
    if (!obj) return
    const text = obj.text
    const bulletChar = this.detectMatchingBullet((obj as any).page)
    const markerRegex = /^\s*([-•–*▪◦·●]|\d+[.)])\s*/
    const bulletRegex = /^\s*[-•–*▪◦·●]\s*/
    const lines = text.split('\n')

    const allBulleted = lines.every((l) => l.trim().length === 0 || bulletRegex.test(l))
    let newText = ''
    if (allBulleted) {
      newText = lines.map((l) => l.replace(bulletRegex, '')).join('\n')
    } else {
      newText = lines.map((l) => {
        const clean = l.replace(markerRegex, '')
        return `${bulletChar} ${clean}`
      }).join('\n')
    }
    if (isBlock) this.setBlockText(target.id, newText)
    else this.setText(target.id, newText)
  }

  toggleNumber(target: { kind: 'el' | 'block'; id: string } | null) {
    if (!target) return
    const d = this.effectiveDoc()
    const isBlock = target.kind === 'block'
    const obj = isBlock ? d.blocks?.find((b) => b.id === target.id) : d.els[target.id]
    if (!obj) return
    const text = obj.text
    const numberRegex = /^\s*(\d+)[.)]\s*/
    const markerRegex = /^\s*([-•–*▪◦·●]|\d+[.)])\s*/
    const lines = text.split('\n')

    const allNumbered = lines.every((l) => l.trim().length === 0 || numberRegex.test(l))
    let newText = ''
    if (allNumbered) {
      newText = lines.map((l) => l.replace(numberRegex, '')).join('\n')
    } else {
      let startNum = 1
      if (!isBlock) {
        const orderIdx = d.order.indexOf(target.id)
        if (orderIdx > 0) {
          const prevEl = d.els[d.order[orderIdx - 1]]
          if (prevEl && prevEl.page === (obj as any).page) {
            const lastLine = prevEl.text.trim().split('\n').pop() || ''
            const prevMatch = lastLine.match(/^\s*(\d+)[.)]\s*/)
            if (prevMatch) startNum = parseInt(prevMatch[1], 10) + 1
          }
        }
      }
      newText = lines.map((l, i) => {
        const clean = l.replace(markerRegex, '')
        return `${startNum + i}. ${clean}`
      }).join('\n')
    }
    if (isBlock) this.setBlockText(target.id, newText)
    else this.setText(target.id, newText)
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
