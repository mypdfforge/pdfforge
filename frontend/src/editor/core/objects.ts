// core/objects.ts
import type { DocState, FlowObject, RGB } from './types.ts'
import { mul, apply, IDENT, union } from './geometry.ts'
import type { Mat, Rect } from './geometry.ts'

export type Tok = { op: string; args: Array<number | string> }

/** A range is translatable iff it is a complete, state-neutral graphics scope:
 *  q/Q balanced, BT/ET balanced, and no clip (W) left active. Wrapping such a range
 *  in `q 1 0 0 1 dx dy cm … Q` cannot leak state into neighbouring content. */
export function translatableRange(toks: Tok[], from: number, to: number): boolean {
  let q = 0, bt = 0, clip = false
  for (let i = from; i <= to; i++) {
    const o = toks[i]?.op
    if (o === 'q') q++
    else if (o === 'Q') { if (--q < 0) return false }
    else if (o === 'BT') bt++
    else if (o === 'ET') { if (--bt < 0) return false }
    else if (o === 'W' || o === 'W*') clip = true
  }
  return q === 0 && bt === 0 && !clip
}

export function scanObjects(toks: Tok[], doc: DocState, page: number, idxOf: (t: Tok, index: number) => number = (_, i) => i): FlowObject[] {
  const out: FlowObject[] = []
  let ctm: Mat = IDENT, stack: Mat[] = [], fill: RGB = [0, 0, 0], stroke: RGB = [0, 0, 0], lw = 1
  let scopeStart = -1, ops: number[] = [], rect: Rect | null = null, path: Array<[number, number]> = []
  const n = (t: Tok, i: number) => Number(t.args[i] ?? 0)
  const box = (x: number, y: number, w: number, h: number): Rect => {
    const [x1, y1] = apply(ctm, x, y), [x2, y2] = apply(ctm, x + w, y + h)
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
  }
  const emit = (kind: FlowObject['kind'], r: Rect, idxs: number[], color: RGB) => {
    if (r.w < 0.2 || r.h < 0.2) return
    const from = idxs[0], to = idxs[idxs.length - 1]
    out.push({
      id: `o${page}_${from}`, page, kind, rect: r, ops: idxs, color,
      flow: 'inline', anchorId: null, keepTogetherId: null,
      translatable: translatableRange(toks, from, to), locked: null
    })
  }

  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx]
    const i = idxOf(t, idx)
    switch (t.op) {
      case 'q': if (!stack.length) { scopeStart = i; ops = [] } stack.push(ctm); ops.push(i); break
      case 'Q': ctm = stack.pop() ?? IDENT; ops.push(i); if (!stack.length) { scopeStart = -1 } break
      case 'cm': ctm = mul([n(t,0),n(t,1),n(t,2),n(t,3),n(t,4),n(t,5)] as Mat, ctm); ops.push(i); break
      case 'w': lw = n(t, 0); ops.push(i); break
      case 'rg': fill = [n(t,0),n(t,1),n(t,2)]; ops.push(i); break
      case 'RG': stroke = [n(t,0),n(t,1),n(t,2)]; ops.push(i); break
      case 'g': fill = [n(t,0),n(t,0),n(t,0)]; ops.push(i); break
      case 'G': stroke = [n(t,0),n(t,0),n(t,0)]; ops.push(i); break
      case 're': rect = { x: n(t,0), y: n(t,1), w: n(t,2), h: n(t,3) }; ops.push(i); break
      case 'm': path = [[n(t,0), n(t,1)]]; ops.push(i); break
      case 'l': path.push([n(t,0), n(t,1)]); ops.push(i); break
      case 'Do': {                                            // image / form XObject
        const r = box(0, 0, 1, 1)                             // unit square under current CTM
        emit('image', r, [...ops, i], fill); ops = []; break
      }
      case 'f': case 'f*': case 'S': case 's': case 'B': {
        const col = t.op === 'S' || t.op === 's' ? stroke : fill
        if (rect) {
          const r = box(rect.x, rect.y, rect.w, rect.h)
          emit(r.h <= 3 && r.w >= 24 ? 'rule' : 'vector', r, [...ops, i], col)
        } else if (path.length === 2 && Math.abs(path[0][1] - path[1][1]) < 0.5 && lw <= 3) {
          const [x1, y1] = apply(ctm, path[0][0], path[0][1]), [x2] = apply(ctm, path[1][0], path[1][1])
          emit('rule', { x: Math.min(x1, x2), y: y1 - lw / 2, w: Math.abs(x2 - x1), h: lw }, [...ops, i], col)
        } else if (path.length === 2 && Math.abs(path[0][0] - path[1][0]) < 0.5 && lw <= 3) {
          const [x1, y1] = apply(ctm, path[0][0], path[0][1]), [, y2] = apply(ctm, path[1][0], path[1][1])
          emit('rule', { x: x1 - lw / 2, y: Math.min(y1, y2), w: lw, h: Math.abs(y2 - y1) }, [...ops, i], col)
        } else if (path.length > 2) {
          let b: Rect | null = null
          for (const [px, py] of path) {
            const [X, Y] = apply(ctm, px, py)
            const p = { x: X, y: Y, w: 0.1, h: 0.1 }
            b = b ? union(b, p) : p
          }
          if (b) emit('vector', b, [...ops, i], col)
        }
        rect = null; path = []; ops = scopeStart >= 0 ? [scopeStart] : []; break
      }
      default: ops.push(i)
    }
  }
  return classify(out, doc, page)
}

/** Furniture vs content. Prefer PDF tags (/Artifact) when the file is tagged. */
export function classify(objs: FlowObject[], doc: DocState, page: number): FlowObject[] {
  const pm = doc.pages[page]
  if (!pm) return objs
  const els = doc.order.map((id) => doc.els[id]).filter((e) => e && e.page === page && !e.deleted)
  const top = pm.y0 + pm.height, bot = pm.y0
  for (const o of objs) {
    const cy = o.rect.y + o.rect.h / 2
    const coversPage = o.rect.w > pm.width * 0.9 && o.rect.h > pm.height * 0.9
    const inMargin = cy > top - 40 || cy < bot + 40
    if (coversPage || inMargin) { o.flow = 'pinned'; continue }        // letterhead, watermark, footer rule
    // Caption directly below an image => one keep-together group.
    const cap = els.filter((e) => e.origBox.y + e.origBox.h <= o.rect.y + 1 &&
      o.rect.y - (e.origBox.y + e.origBox.h) < 14 &&
      e.origBox.x < o.rect.x + o.rect.w && e.origBox.x + e.origBox.w > o.rect.x)
      .sort((a, b) => b.origBox.y - a.origBox.y)[0]
    if (o.kind === 'image' && cap) { o.keepTogetherId = `fig_${o.id}`; o.anchorId = cap.id }
    // Rule under a heading => anchored to it.
    if (o.kind === 'rule') {
      const h = els.filter((e) => e.origBox.y >= o.rect.y + o.rect.h - 1 &&
        e.origBox.y - (o.rect.y + o.rect.h) < 10 &&
        e.origBox.x < o.rect.x + o.rect.w && e.origBox.x + e.origBox.w > o.rect.x)
        .sort((a, b) => a.origBox.y - b.origBox.y)[0]
      if (h) { o.flow = 'anchored'; o.anchorId = h.id }
    }
    if (!o.translatable && o.kind !== 'rule') {
      o.locked = 'This graphic shares a graphics state with its neighbours and cannot be moved safely.'
    }
  }
  return objs
}
