// Hit-test rectangles for the editing overlay, per OUTPUT page, in PDF points. Mirrors exactly what plan.ts draws.
import type { DocState, Rect } from './types.ts'
import type { Measurer } from './fonts.ts'
import { layoutElement } from './layout.ts'
import { layoutFlow, followerMoves } from './reflow.ts'
import { isChanged } from './plan.ts'

export type Overlay = { key: string; kind: 'el' | 'block'; id: string; rect: Rect; locked: boolean; changed: boolean; role?: string }

export function overlaysByPage(doc: DocState, m: Measurer): { pages: Overlay[][]; pageCount: number } {
  if (doc.mode === 'reflow' && doc.blocks) {
    const flow = layoutFlow(doc, m)
    const pages: Overlay[][] = flow.pageBox.map(() => [])
    const inBlock = new Set<string>()
    for (const b of doc.blocks) if (b.included) b.lineIds.forEach((i) => inBlock.add(i))
    for (const pb of flow.placed) {
      const b = pb.block
      const x = Math.min(b.x, ...pb.lines.map((l) => l.x)), w = Math.max(b.width, ...pb.lines.map((l) => l.width))
      pages[pb.page].push({ key: `${b.id}:${pb.from}`, kind: 'block', id: b.id, rect: { x, y: pb.rect.bottom, w, h: pb.rect.top - pb.rect.bottom }, locked: false, changed: b.edited, role: b.role })
    }
    const mv = followerMoves(doc, flow)
    for (const id of doc.order) {
      const e = doc.els[id]
      if (inBlock.has(id) || e.deleted) continue
      const s = mv.get(id), dy = s?.dy ?? 0, pg = s?.page ?? e.page
      const r = isChanged(e) ? layoutElement({ ...e, baseline: e.baseline + dy }, m).rect : { ...e.origBox, y: e.origBox.y + dy }
      pages[pg]?.push({ key: id, kind: 'el', id, rect: r, locked: !!e.locked && !e.cover && !e.created, changed: isChanged(e) })
    }
    return { pages, pageCount: flow.pageCount }
  }
  const pages: Overlay[][] = doc.pages.map(() => [])
  for (const id of doc.order) {
    const e = doc.els[id]
    if (e.deleted) continue
    pages[e.page].push({ key: id, kind: 'el', id, rect: isChanged(e) ? layoutElement(e, m).rect : e.origBox, locked: !!e.locked && !e.cover && !e.created, changed: isChanged(e) })
  }
  return { pages, pageCount: doc.pages.length }
}
