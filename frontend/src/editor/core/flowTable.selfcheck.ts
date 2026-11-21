// Self-check for table-aware Live Flow. Run: npx tsx frontend/src/editor/core/flowTable.selfcheck.ts
import assert from 'node:assert/strict'
import type { DocState, TextElement, TextStyle, TableModel } from './types.ts'
import { cascadeVerticalShift } from './flow.ts'
import { cascadePlan } from './plan.ts'

const M: any = { width: (t: string, s: TextStyle) => t.length * s.size * 0.5, canEncode: () => [] }
const style: TextStyle = { family: 'Helvetica', bold: false, italic: false, underline: false, strike: false, size: 11, color: [0, 0, 0], highlight: null, charSpacing: 0, wordSpacing: 0, align: 'left', lineHeight: 1.2 }
const el = (id: string, text: string, x: number, baseline: number, w: number, maxW = w): TextElement => ({
  id, page: 0, text, originalText: text, style, originalStyle: style, origBox: { x, y: baseline - 3, w, h: 11 }, x, baseline, origX: x, origBaseline: baseline,
  maxW, wrap: false, movable: true, ops: [], locked: null, cover: null, mappedFont: 'Helvetica', fidelity: 'exact' as any, fontNote: null, deleted: false, created: false,
})
const YS = [650, 620, 590, 560]
function build(left: number, extra: TextElement[] = []): DocState {
  const xs = [left, left + 130, left + 260]
  const els = [el('intro', 'Intro', left, 700, 200, 372)]
  const cells: TableModel['cells'] = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
    const e = el(`c${r}${c}`, `R${r}C${c}`, xs[c] + 4, YS[r] - 18, 60, 122)
    els.push(e); cells.push({ r, c, elIds: [e.id], rect: { x: xs[c], y: YS[r + 1], w: 130, h: 30 } })
  }
  els.push(el('after', 'After table', left, 520, 200, 372), ...extra)
  const table: TableModel = { id: 't0', page: 0, rect: { x: xs[0], y: 560, w: 260, h: 90 }, xs, ys: YS, cells, ruleOps: [1, 2, 3], ruleColor: [0, 0, 0], headerRows: 1, padX: 4, padY: 3, confidence: 'high' }
  return {
    name: 't', pages: [{ x0: 0, y0: 0, width: 612, height: 792, index: 0, editable: true, reason: null, images: 0, paints: 0 } as any],
    els: Object.fromEntries(els.map((e) => [e.id, e])), order: els.map((e) => e.id), mode: 'design', blocks: null,
    contentBottom: [36], flow: { enabled: true, squeeze: null }, objects: [], tables: [table], rules: [],
  }
}
const edit = (d: DocState, id: string, text: string): DocState => ({ ...d, els: { ...d.els, [id]: { ...d.els[id], text, wrap: true } } })
const dy = (d: DocState, id: string) => cascadeVerticalShift(d, M).shifts.get(id)!.dy
const hrules = (d: DocState) => cascadePlan(d, M).pages[0].draws.filter((x: any) => x.kind === 'rect' && x.h === 1).map((x: any) => x.y + 0.5)
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`)

// 1. unedited doc: identity, nothing drawn or removed
const base = build(72)
assert.equal(cascadePlan(base, M).pages[0].draws.length + cascadePlan(base, M).pages[0].edits.length, 0)

// 2. text grows above the table: every row moves by the same amount, borders follow (no per-row drift)
const a = edit(base, 'intro', 'x'.repeat(300))
const d0 = dy(a, 'c00')
for (const id of ['c01', 'c10', 'c11', 'c20', 'c21', 'after']) near(dy(a, id), d0)
hrules(a).forEach((y, i) => near(y, YS[i] + d0))

// 3. a cell grows: borders appear and the row below + its border move down with it
const b = edit(base, 'c10', 'word '.repeat(40))
near(dy(b, 'c20'), dy(b, 'c21'))
assert.ok(dy(b, 'c20') < -50)
const hb = hrules(b)
assert.equal(hb.length, 4)
near(hb[2], YS[2] + dy(b, 'c20'), 0.01); near(hb[3], YS[3] + dy(b, 'c20'), 0.01)

// 4. footer stays on its page and position while body grows
const f = edit(build(72, [el('foot', 'Page 1', 290, 20, 40)]), 'intro', 'x'.repeat(2400))
assert.deepEqual([dy(f, 'foot'), cascadeVerticalShift(f, M).shifts.get('foot')!.page], [0, 0])

// 5. table inside the main column of a 2-column page: cell growth moves both table columns, sidebar stays
const c = edit(build(200, [el('s1', 'Side 1', 20, 700, 100), el('s2', 'Side 2', 20, 600, 100)]), 'c10', 'word '.repeat(40))
near(dy(c, 'c20'), dy(c, 'c21')); assert.ok(dy(c, 'c20') < -50)
assert.equal(dy(c, 's1'), 0); assert.equal(dy(c, 's2'), 0)
console.log('flowTable selfcheck: ok')
