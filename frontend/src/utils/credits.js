/**
 * Local file history (last 24h, localStorage) + size formatters.
 * The old daily-credit system was removed: it was client-side only and not enforceable.
 */
const KEY_HISTORY = 'pdfforge_history_v1'

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
