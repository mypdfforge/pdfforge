// PDF content-stream tokenizer, text-state analyzer and non-destructive rewriter.
// Works on a "binary string" (one char per byte) so slicing keeps the stream byte-exact.
import { IDENT, mul, apply } from './geometry.ts'
import type { Mat } from './geometry.ts'

export type Tok = { t: 'num' | 'str' | 'name' | 'arr' | 'dict' | 'bool' | 'null' | 'op'; v: any; s: number; e: number }
export type Instr = { op: string; args: Tok[]; s: number; e: number }

const WS = new Set([0, 9, 10, 12, 13, 32])
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)))
const isReg = (c: number) => !WS.has(c) && !DELIM.has(c)

export function parseContent(src: string): Instr[] {
  let i = 0
  const n = src.length
  const out: Instr[] = []
  let args: Tok[] = []

  const skipWs = () => {
    while (i < n) {
      const c = src.charCodeAt(i)
      if (WS.has(c)) i++
      else if (c === 37) { while (i < n && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++ }
      else break
    }
  }
  const litString = (): Tok => {
    const s = i; i++
    let depth = 1, v = ''
    while (i < n && depth > 0) {
      const ch = src[i]
      if (ch === '\\') {
        const nx = src[i + 1]
        if (nx === undefined) { i++; break }
        if (/[0-7]/.test(nx)) { let o = nx, k = 2; while (k < 4 && /[0-7]/.test(src[i + k] ?? '')) { o += src[i + k]; k++ } v += String.fromCharCode(parseInt(o, 8) & 255); i += k }
        else if (nx === 'n') { v += '\n'; i += 2 } else if (nx === 'r') { v += '\r'; i += 2 } else if (nx === 't') { v += '\t'; i += 2 }
        else if (nx === 'b') { v += '\b'; i += 2 } else if (nx === 'f') { v += '\f'; i += 2 }
        else if (nx === '\r') { i += src[i + 2] === '\n' ? 3 : 2 } else if (nx === '\n') { i += 2 }
        else { v += nx; i += 2 }
      } else if (ch === '(') { depth++; v += ch; i++ }
      else if (ch === ')') { depth--; if (depth > 0) v += ch; i++ }
      else { v += ch; i++ }
    }
    return { t: 'str', v, s, e: i }
  }
  const hexString = (): Tok => {
    const s = i; i++
    let h = ''
    while (i < n && src[i] !== '>') { if (!WS.has(src.charCodeAt(i))) h += src[i]; i++ }
    i++
    if (h.length % 2) h += '0'
    let v = ''
    for (let k = 0; k < h.length; k += 2) v += String.fromCharCode(parseInt(h.substr(k, 2), 16) || 0)
    return { t: 'str', v, s, e: i }
  }
  const value = (): Tok | null => {
    skipWs()
    if (i >= n) return null
    const c = src[i], s = i
    if (c === '(') return litString()
    if (c === '<' && src[i + 1] === '<') {
      let depth = 0
      while (i < n) {
        if (src[i] === '<' && src[i + 1] === '<') { depth++; i += 2 }
        else if (src[i] === '>' && src[i + 1] === '>') { depth--; i += 2; if (depth === 0) break }
        else if (src[i] === '(') litString()
        else i++
      }
      return { t: 'dict', v: null, s, e: i }
    }
    if (c === '<') return hexString()
    if (c === '[') {
      i++
      const items: Tok[] = []
      for (;;) {
        skipWs()
        if (i >= n) break
        if (src[i] === ']') { i++; break }
        const t = value()
        if (!t) break
        items.push(t)
      }
      return { t: 'arr', v: items, s, e: i }
    }
    if (c === '/') {
      i++; let nm = ''
      while (i < n && isReg(src.charCodeAt(i))) nm += src[i++]
      return { t: 'name', v: nm, s, e: i }
    }
    if (c === ']' || c === ')' || c === '>' || c === '{' || c === '}') { i++; return value() }
    let w = ''
    while (i < n && isReg(src.charCodeAt(i))) w += src[i++]
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: parseFloat(w), s, e: i }
    if (w === 'true' || w === 'false') return { t: 'bool', v: w === 'true', s, e: i }
    if (w === 'null') return { t: 'null', v: null, s, e: i }
    return { t: 'op', v: w, s, e: i }
  }

  for (;;) {
    const tok = value()
    if (!tok) break
    if (tok.t !== 'op') { args.push(tok); continue }
    const op = tok.v as string
    let e = tok.e
    if (op === 'BI') {
      // inline image: skip dictionary until ID, then raw bytes until whitespace + EI + delimiter
      const idPos = src.indexOf('ID', i)
      let k = idPos < 0 ? n : idPos + 3
      for (;;) {
        const ei = src.indexOf('EI', k)
        if (ei < 0) { k = n; break }
        if (WS.has(src.charCodeAt(ei - 1)) && (ei + 2 >= n || WS.has(src.charCodeAt(ei + 2)))) { k = ei + 2; break }
        k = ei + 2
      }
      i = k; e = k
    }
    out.push({ op, args, s: args.length ? args[0].s : tok.s, e })
    args = []
  }
  return out
}

export type RGB = [number, number, number]
export type FontMetrics = { bytes: 1 | 2; width: (code: number) => number /* 1/1000 em */ }
export type ShowOp = {
  idx: number; s: number; e: number; op: string
  x: number; y: number; x2: number // origin and end of advance, user space
  fontRes: string; size: number // effective size in user-space points
  color: RGB | null; tc: number; tw: number; tr: number
  positioned: boolean // origin did not depend on the previous show's advance
  inForm: boolean
}
export type Analysis = { ops: ShowOp[]; images: number; paints: number }

const cmyk = (c: number, m: number, y: number, k: number): RGB => [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]

type GS = { ctm: Mat; color: RGB | null; tc: number; tw: number; tz: number; tl: number; font: string; fs: number; rise: number; tr: number }

export function analyze(instrs: Instr[], metrics: (res: string) => FontMetrics | null): Analysis {
  let gs: GS = { ctm: IDENT, color: [0, 0, 0], tc: 0, tw: 0, tz: 1, tl: 0, font: '', fs: 0, rise: 0, tr: 0 }
  const stack: GS[] = []
  let tm: Mat = IDENT, tlm: Mat = IDENT
  let dirty = true // true => position came from an explicit positioning operator
  const ops: ShowOp[] = []
  let images = 0, paints = 0
  const num = (a: Tok[], k: number) => (a[k] && a[k].t === 'num' ? (a[k].v as number) : 0)

  const advance = (strings: string[], adj: Array<number | null>, fm: FontMetrics | null) => {
    let tx = 0
    for (let k = 0; k < strings.length; k++) {
      const s = strings[k]
      if (s !== '') {
        const step = fm?.bytes ?? 1
        for (let j = 0; j + step <= s.length; j += step) {
          const code = step === 2 ? (s.charCodeAt(j) << 8) | s.charCodeAt(j + 1) : s.charCodeAt(j)
          const w = fm ? fm.width(code) : 500
          tx += ((w / 1000) * gs.fs + gs.tc + (step === 1 && code === 32 ? gs.tw : 0)) * gs.tz
        }
      }
      const a = adj[k]
      if (a != null) tx -= (a / 1000) * gs.fs * gs.tz
    }
    return tx
  }
  const show = (ix: number, ins: Instr, strings: string[], adj: Array<number | null>) => {
    const full = mul(tm, gs.ctm)
    const [x, y] = apply(full, 0, gs.rise)
    const fm = metrics(gs.font)
    const tx = advance(strings, adj, fm)
    const [x2] = apply(mul(mul([1, 0, 0, 1, tx, 0], tm), gs.ctm), 0, gs.rise)
    ops.push({
      idx: ix, s: ins.s, e: ins.e, op: ins.op, x, y, x2, fontRes: gs.font,
      size: Math.abs(gs.fs) * Math.hypot(full[2], full[3]), color: gs.color, tc: gs.tc, tw: gs.tw, tr: gs.tr,
      positioned: dirty, inForm: false,
    })
    tm = mul([1, 0, 0, 1, tx, 0], tm)
    dirty = false
  }
  const nextLine = () => { tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; dirty = true }

  instrs.forEach((ins, ix) => {
    const a = ins.args
    switch (ins.op) {
      case 'q': stack.push({ ...gs }); break
      case 'Q': if (stack.length) gs = stack.pop()!; break
      case 'cm': gs = { ...gs, ctm: mul([num(a, 0), num(a, 1), num(a, 2), num(a, 3), num(a, 4), num(a, 5)], gs.ctm) }; break
      case 'BT': tm = IDENT; tlm = IDENT; dirty = true; break
      case 'Tc': gs.tc = num(a, 0); break
      case 'Tw': gs.tw = num(a, 0); break
      case 'Tz': gs.tz = num(a, 0) / 100; break
      case 'TL': gs.tl = num(a, 0); break
      case 'Ts': gs.rise = num(a, 0); break
      case 'Tr': gs.tr = num(a, 0); break
      case 'Tf': gs.font = a[0]?.t === 'name' ? a[0].v : ''; gs.fs = num(a, 1); break
      case 'Td': tlm = mul([1, 0, 0, 1, num(a, 0), num(a, 1)], tlm); tm = tlm; dirty = true; break
      case 'TD': gs.tl = -num(a, 1); tlm = mul([1, 0, 0, 1, num(a, 0), num(a, 1)], tlm); tm = tlm; dirty = true; break
      case 'Tm': tm = [num(a, 0), num(a, 1), num(a, 2), num(a, 3), num(a, 4), num(a, 5)]; tlm = tm; dirty = true; break
      case 'T*': nextLine(); break
      case 'Tj': if (a[0]?.t === 'str') show(ix, ins, [a[0].v], [null]); break
      case "'": nextLine(); if (a[0]?.t === 'str') show(ix, ins, [a[0].v], [null]); break
      case '"': gs.tw = num(a, 0); gs.tc = num(a, 1); nextLine(); if (a[2]?.t === 'str') show(ix, ins, [a[2].v], [null]); break
      case 'TJ': {
        const strs: string[] = [], adj: Array<number | null> = []
        for (const t of a[0]?.t === 'arr' ? (a[0].v as Tok[]) : []) {
          if (t.t === 'str') { strs.push(t.v); adj.push(null) }
          else if (t.t === 'num') { if (!strs.length) { strs.push(''); adj.push(t.v) } else adj[adj.length - 1] = (adj[adj.length - 1] ?? 0) + t.v }
        }
        show(ix, ins, strs, adj); break
      }
      case 'g': gs.color = [num(a, 0), num(a, 0), num(a, 0)]; break
      case 'rg': gs.color = [num(a, 0), num(a, 1), num(a, 2)]; break
      case 'k': gs.color = cmyk(num(a, 0), num(a, 1), num(a, 2), num(a, 3)); break
      case 'sc': case 'scn': {
        const nums = a.filter((t) => t.t === 'num').map((t) => t.v as number)
        if (a.some((t) => t.t === 'name')) gs.color = null // pattern/shading: unknown
        else if (nums.length === 1) gs.color = [nums[0], nums[0], nums[0]]
        else if (nums.length === 3) gs.color = [nums[0], nums[1], nums[2]]
        else if (nums.length === 4) gs.color = cmyk(nums[0], nums[1], nums[2], nums[3])
        else gs.color = null
        break
      }
      case 'Do': images++; break
      case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'S': case 's': case 'sh': paints++; break
    }
  })
  return { ops, images, paints }
}

export type OpEdit = { idx: number; action: 'remove' | 'hide' | 'move'; dy?: number; origTr?: number }

/** Rewrite the stream: remove / hide / translate individual show instructions. Everything else is byte-identical. */
export function rewrite(src: string, instrs: Instr[], edits: OpEdit[]): string {
  const sorted = [...edits].sort((a, b) => instrs[a.idx].s - instrs[b.idx].s)
  let out = '', pos = 0
  const f = (n: number) => String(Math.round(n * 1000) / 1000)
  for (const ed of sorted) {
    const ins = instrs[ed.idx]
    if (ins.s < pos) continue
    out += src.slice(pos, ins.s)
    const orig = src.slice(ins.s, ins.e)
    if (ed.action === 'remove') {
      // ' and " also move to the next line: keep that side effect so following text stays put
      if (ins.op === "'") out += 'T*'
      else if (ins.op === '"') out += `${src.slice(ins.args[0].s, ins.args[0].e)} Tw ${src.slice(ins.args[1].s, ins.args[1].e)} Tc T*`
    } else if (ed.action === 'hide') out += `3 Tr\n${orig}\n${ed.origTr ?? 0} Tr`
    else out += `0 ${f(ed.dy ?? 0)} Td\n${orig}\n0 ${f(-(ed.dy ?? 0))} Td`
    out += '\n'
    pos = ins.e
  }
  return out + src.slice(pos)
}
