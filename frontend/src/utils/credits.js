/**
 * credits.js — Client-side credit & daily limit system
 * No login required. Uses localStorage.
 * Free: 6 actions/day. Resets at midnight local time.
 */

const KEY_CREDITS   = 'pdfforge_credits_v1'
const KEY_HISTORY   = 'pdfforge_history_v1'
export const FREE_DAILY    = 6

export const TOOL_COSTS = {
  ocr:       2,
  translate: 2,
  'ai-chat': 1,
  'ai-suggest': 1,
  'resume-ats': 2,
  default:   1,
}

function todayStr() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY_CREDITS)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function saveState(state) {
  try { localStorage.setItem(KEY_CREDITS, JSON.stringify(state)) } catch {}
}

function freshState() {
  return {
    date:        todayStr(),
    used:        0,
    bonusCredits: 0, // purchased/earned extra credits
  }
}

export function getCreditsState() {
  let s = loadState()
  if (!s || s.date !== todayStr()) {
    s = freshState()
    saveState(s)
  }
  return s
}

export function getRemaining() {
  const s = getCreditsState()
  return Math.max(0, FREE_DAILY - s.used) + (s.bonusCredits || 0)
}

export function canUse(toolId) {
  const cost = TOOL_COSTS[toolId] ?? TOOL_COSTS.default
  return getRemaining() >= cost
}

export function consume(toolId) {
  const cost = TOOL_COSTS[toolId] ?? TOOL_COSTS.default
  const s    = getCreditsState()
  const bonus = s.bonusCredits || 0
  if (bonus >= cost) {
    s.bonusCredits = bonus - cost
  } else {
    const fromBonus = bonus
    const fromFree  = cost - fromBonus
    s.bonusCredits  = 0
    s.used         += fromFree
  }
  saveState(s)
  return getRemaining()
}

export function addBonusCredits(n) {
  const s = getCreditsState()
  s.bonusCredits = (s.bonusCredits || 0) + n
  saveState(s)
}

export function resetForTesting() {
  localStorage.removeItem(KEY_CREDITS)
}

// ── File History ─────────────────────────────────────────────────────
const HISTORY_TTL = 24 * 60 * 60 * 1000 // 24 hours

export function addToHistory(entry) {
  // entry: { id, name, toolLabel, originalSize, outputSize, outputUrl, ts }
  try {
    const raw  = localStorage.getItem(KEY_HISTORY)
    let list   = raw ? JSON.parse(raw) : []
    const now  = Date.now()
    list       = list.filter(e => now - e.ts < HISTORY_TTL)
    list.unshift({ ...entry, ts: now })
    list       = list.slice(0, 20) // cap at 20
    localStorage.setItem(KEY_HISTORY, JSON.stringify(list))
  } catch {}
}

export function getHistory() {
  try {
    const raw  = localStorage.getItem(KEY_HISTORY)
    if (!raw) return []
    const now  = Date.now()
    const list = JSON.parse(raw).filter(e => now - e.ts < HISTORY_TTL)
    localStorage.setItem(KEY_HISTORY, JSON.stringify(list))
    return list
  } catch { return [] }
}

export function clearHistory() {
  try { localStorage.removeItem(KEY_HISTORY) } catch {}
}

export function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1024/1024).toFixed(2)} MB`
}

export function pctReduction(orig, final) {
  if (!orig || !final || final >= orig) return null
  return Math.round((1 - final / orig) * 100)
}
