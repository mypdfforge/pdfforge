/**
 * pageSpec.js — page-range text <-> page set. Pure, no React. Shared by Split/Extract/Delete/Duplicate.
 * Pages are 1-based here. A "group" is a run of consecutive pages: [2,3,4].
 * Split uses groups (each comma token = one output part). Other tools only use the union (a Set).
 */

/** Parse what the user typed. Never throws. Bad tokens become `issues`, a half-typed "3-" is `pending`. */
export function parseSpec(text, max) {
  const groups = [], issues = []
  let pending = false
  const run = (a, b) => { const g = []; for (let i = a; i <= b; i++) g.push(i); groups.push(g) }
  const toks = String(text || '').toLowerCase().replace(/\s*[-–—]\s*/g, '-').split(/[,;\s]+/).filter(Boolean)
  for (const t of toks) {
    let m
    if (t === 'all')        { if (max) run(1, max) }
    else if (t === 'odd')   { for (let i = 1; i <= max; i += 2) groups.push([i]) }
    else if (t === 'even')  { for (let i = 2; i <= max; i += 2) groups.push([i]) }
    else if (t === 'first') { if (max) groups.push([1]) }
    else if (t === 'last')  { if (max) groups.push([max]) }
    else if ((m = t.match(/^(\d+)-(\d+)$/))) {
      let a = +m[1], b = +m[2]
      if (a > b) { [a, b] = [b, a]; issues.push({ kind: 'reversed', token: t, hint: `read as ${a}-${b}` }) }
      if (b < 1 || a > max) { issues.push({ kind: 'range', token: t, hint: `file has ${max} pages` }); continue }
      run(Math.max(a, 1), Math.min(b, max))          // clamp BEFORE expanding: "1-999999" stays cheap
    } else if (/^\d+-$/.test(t)) pending = true      // user is still typing the end of a range
    else if (/^\d+$/.test(t)) {
      const n = +t
      if (n >= 1 && n <= max) groups.push([n]); else issues.push({ kind: 'range', token: t, hint: `file has ${max} pages` })
    } else issues.push({ kind: 'junk', token: t, hint: "can't read this" })
  }
  const set = new Set()
  for (const g of groups) for (const n of g) set.add(n)
  return { set, groups, issues, pending }
}

/** Set -> "1-3, 5, 8-9" (hyphen, so old parsers still read it) */
export function formatSpec(set) {
  const s = [...set].sort((a, b) => a - b), out = []
  if (!s.length) return ''
  let a = s[0], b = a
  for (const n of s.slice(1)) { if (n === b + 1) { b = n; continue } out.push(a === b ? `${a}` : `${a}-${b}`); a = b = n }
  out.push(a === b ? `${a}` : `${a}-${b}`)
  return out.join(', ')
}

/** Groups -> "1-3, 5" keeping every group as its own token (Split: 1 token = 1 part). */
export function formatGroups(groups) {
  return groups.filter(g => g.length).map(g => g.length === 1 ? `${g[0]}` : `${g[0]}-${g[g.length - 1]}`).join(', ')
}

/** Set -> consecutive runs [[1,2,3],[5]] */
export function runsOf(set) {
  const s = [...set].sort((a, b) => a - b), out = []
  for (const n of s) {
    const last = out[out.length - 1]
    if (last && last[last.length - 1] === n - 1) last.push(n); else out.push([n])
  }
  return out
}

/** Click on page n in Split: inside a part -> cut it out (part may split in two); outside -> new 1-page part. */
export function toggleInGroups(groups, n) {
  const i = groups.findIndex(g => g.includes(n))
  let next
  if (i < 0) next = [...groups, [n]]
  else {
    const g = groups[i], left = g.filter(x => x < n), right = g.filter(x => x > n)
    next = [...groups.slice(0, i), ...[left, right].filter(x => x.length), ...groups.slice(i + 1)]
  }
  return next.sort((a, b) => a[0] - b[0])
}

/** Presets. Return a Set of pages. `cur` = current selection, `k` = N for firstN/lastN. */
export function presetSet(name, max, cur = new Set(), k = 1) {
  const s = new Set()
  const add = (a, b, step = 1) => { for (let i = a; i <= b; i += step) if (i >= 1 && i <= max) s.add(i) }
  switch (name) {
    case 'all':    add(1, max); break
    case 'odd':    add(1, max, 2); break
    case 'even':   add(2, max, 2); break
    case 'first':  add(1, 1); break
    case 'last':   add(max, max); break
    case 'firstN': add(1, Math.min(k, max)); break
    case 'lastN':  add(Math.max(1, max - k + 1), max); break
    case 'invert': for (let i = 1; i <= max; i++) if (!cur.has(i)) s.add(i); break
    default: break   // 'none'
  }
  return s
}

/** "halves" for Split: [[1..h],[h+1..max]] */
export function halves(max) {
  if (max < 2) return max ? [[1]] : []
  const h = Math.ceil(max / 2), g = [[], []]
  for (let i = 1; i <= max; i++) g[i <= h ? 0 : 1].push(i)
  return g
}

/** groups -> Int32Array where arr[page] = part number (0 = no part) */
export function partIndex(groups, max) {
  const a = new Int32Array(max + 2)
  groups.forEach((g, gi) => { for (const n of g) if (!a[n]) a[n] = gi + 1 })
  return a
}

/** pages [1,2,3,7] -> "1-3_7" for file names */
export const rangeName = (pages) => formatSpec(new Set(pages)).replace(/, /g, '_')
