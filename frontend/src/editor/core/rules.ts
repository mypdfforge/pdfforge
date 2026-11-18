// core/rules.ts
// Additive extraction of horizontal vector rules from content stream instructions.
// Rules are anchored to nearest heading above and travel synchronously with text flow.
import type { DocState, GraphicRule, RGB } from './types.ts'
import { mul, apply, IDENT } from './geometry.ts'
import type { Mat } from './geometry.ts'

type Tok = { op: string; args: Array<number | string> }

export function scanRules(toks: Tok[], doc: DocState, page: number, indexOf: (t: Tok) => number): GraphicRule[] {
  const out: GraphicRule[] = []
  let ctm: Mat = IDENT, stack: Mat[] = [], fill: RGB = [0, 0, 0], stroke: RGB = [0, 0, 0], lw = 1
  let rect: { x: number; y: number; w: number; h: number } | null = null
  let path: Array<[number, number]> = [], ops: number[] = []
  const num = (t: Tok, i: number) => Number(t.args[i])
  const flush = (color: RGB, r: { x: number; y: number; w: number; h: number }, idxs: number[]) => {
    if (r.w >= 24 && r.h <= 3 && r.h > 0) {                  // thin & wide => horizontal rule
      const anchor = doc.order.map((id) => doc.els[id])
        .filter((e) => e.page === page && !e.locked && !e.deleted &&
          e.origBox.y >= r.y + r.h - 1 && e.origBox.y - (r.y + r.h) < 10 &&
          e.origBox.x < r.x + r.w && e.origBox.x + e.origBox.w > r.x)
        .sort((a, b) => a.origBox.y - b.origBox.y)[0]
      out.push({ id: `rule${page}_${idxs[0]}`, page, ops: idxs, rect: r, color, anchorId: anchor?.id ?? null })
    }
  }
  for (const t of toks) {
    const idx = indexOf(t)
    switch (t.op) {
      case 'q': stack.push(ctm); ops.push(idx); break
      case 'Q': ctm = stack.pop() ?? IDENT; ops.push(idx); break
      case 'cm': ctm = mul([num(t,0),num(t,1),num(t,2),num(t,3),num(t,4),num(t,5)] as Mat, ctm); ops.push(idx); break
      case 'w': lw = num(t, 0); ops.push(idx); break
      case 'rg': fill = [num(t,0),num(t,1),num(t,2)]; break
      case 'RG': stroke = [num(t,0),num(t,1),num(t,2)]; break
      case 'g': fill = [num(t,0),num(t,0),num(t,0)]; break
      case 'G': stroke = [num(t,0),num(t,0),num(t,0)]; break
      case 're': rect = { x: num(t,0), y: num(t,1), w: num(t,2), h: num(t,3) }; ops.push(idx); break
      case 'm': path = [[num(t,0), num(t,1)]]; ops.push(idx); break
      case 'l': path.push([num(t,0), num(t,1)]); ops.push(idx); break
      case 'f': case 'f*': case 'S': case 's': case 'B': {
        if (rect) {
          const [x1, y1] = apply(ctm, rect.x, rect.y), [x2, y2] = apply(ctm, rect.x + rect.w, rect.y + rect.h)
          flush(t.op === 'S' ? stroke : fill, { x: Math.min(x1,x2), y: Math.min(y1,y2), w: Math.abs(x2-x1), h: Math.abs(y2-y1) }, [...ops, idx])
        } else if (path.length === 2 && Math.abs(path[0][1] - path[1][1]) < 0.5 && lw <= 3) {
          const [x1, y1] = apply(ctm, path[0][0], path[0][1]), [x2] = apply(ctm, path[1][0], path[1][1])
          flush(stroke, { x: Math.min(x1,x2), y: y1 - lw/2, w: Math.abs(x2-x1), h: lw }, [...ops, idx])
        }
        rect = null; path = []; ops = []; break
      }
      default: if (rect || path.length) ops.push(idx)
    }
  }
  return out
}
