// Self-check for table-aware Live Flow. Run: npx tsx frontend/src/editor/core/flowTable.selfcheck.ts
import assert from 'node:assert/strict'
import type { DocState, TextElement, TextStyle, TableModel } from './types.ts'
import { cascadeVerticalShift } from './flow.ts'
import { cascadePlan } from './plan.ts'
import { wrapText, placeLines } from './layout.ts'
import { scanObjects } from './objects.ts'
import { detectTables } from './table.ts'

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

// ---- Bug 1: whitespace survives wrap + placement ----
const W = (t: string, w = 100) => wrapText(t, w, style, M)
assert.deepEqual(W('a     b'), ['a     b'])
assert.deepEqual(W('     hi'), ['     hi'])
assert.deepEqual(W('x\n      y'), ['x', '      y'])
assert.deepEqual(W('hi     '), ['hi     '])
assert.deepEqual(W('   '), ['   '])
assert.deepEqual(W('\tz'), ['    z'])
assert.deepEqual(W('    aaa bbb ccc', 60), ['    aaa', '    bbb', '    ccc'])       // continuation keeps the indent
assert.equal(placeLines(W('     hi'), 10, 100, 100, style, M).lines[0].text, '     hi')
near(placeLines(['hi     '], 10, 100, 40, style, M).overflowX ? 1 : 0, 0)           // trailing spaces never flag overflow

// ---- Bug 2: ruleOps hold only path/paint ops, never text ----
const T = (op: string, ...args: any[]) => ({ op, args })
const toks = [T('q'), T('RG', 0, 0, 0), T('w', 1),
  T('BT'), T('Tf', 'F1', 11), T('Td', 76, 632), T('Tj', 'a'), T('ET'), T('re', 72, 650, 400, 1), T('f'),
  T('BT'), T('Tj', 'b'), T('ET'), T('re', 72, 620, 400, 1), T('f'),
  T('BT'), T('Tj', 'c'), T('ET'), T('re', 72, 590, 400, 1), T('f'),
  T('BT'), T('Tj', 'd'), T('ET'), T('re', 72, 590, 1, 60), T('f'), T('re', 272, 590, 1, 60), T('f'), T('re', 472, 590, 1, 60), T('f'), T('Q')]
const objs = scanObjects(toks as any, base, 0)
const tb = detectTables(objs, Object.values(base.els), 0, toks as any)[0]
assert.ok(tb && tb.ruleOps.length >= 6)
const TEXT = new Set(['BT', 'ET', 'Tf', 'Td', 'Tj', 'TJ'])
assert.ok(tb.ruleOps.every((i) => !TEXT.has(toks[i].op)), 'ruleOps must not contain text ops')

// cell text moves byte-identical with the table (even when locked); never removed
const withOps = (d: DocState, lockId?: string): DocState => {
  const els = { ...d.els }
  d.order.forEach((id, i) => { els[id] = { ...els[id], ops: [100 + i], ...(id === lockId ? { locked: 'no font map' } : {}) } })
  return { ...d, els }
}
const m1 = edit(withOps(base, 'c11'), 'intro', 'x'.repeat(300))
const pe = cascadePlan(m1, M).pages[0].edits as any[]
const dm = dy(m1, 'c00')
for (const id of ['c00', 'c01', 'c10', 'c11', 'c20', 'c21']) {
  const op = m1.els[id].ops[0]
  const mv = pe.filter((e) => e.idx === op)
  assert.equal(mv.length, 1, `${id}: one edit`); assert.equal(mv[0].action, 'move', `${id}: moved not removed`); near(mv[0].dy, dm, 0.01)
}

// ---- Bug 3: footer at 45pt; one extra line is absorbed on the page, footer untouched ----
const foot = (d: DocState) => cascadeVerticalShift(d, M)
const f1 = edit(build(72, [el('foot', 'Page 1', 290, 45, 40)]), 'intro', 'x'.repeat(400))
const r1 = foot(f1)
assert.equal(r1.pageCount, 1); assert.equal(r1.shifts.get('foot')!.dy, 0); assert.equal(r1.shifts.get('after')!.page, 0)
// real overflow: stops above the footer (top 53 + 8 pad), natural spacing untouched
const f2 = edit(build(72, [el('foot', 'Page 1', 290, 45, 40)]), 'intro', 'x'.repeat(7000))
const r2 = foot(f2)
assert.ok(r2.pageCount >= 2)
for (const [id, rc] of r2.rects) if (id !== 'foot' && r2.shifts.get(id)!.page === 0) assert.ok(rc.y >= 53 + 8 - 0.01, `${id} dips into footer: ${rc.y}`)
console.log('flowTable selfcheck: ok')
