export const LIMITS = {
  maxBytes: 50 * 1024 * 1024, // client-side processing uses the user's memory: be explicit about the ceiling
  maxPages: 200,
  history: 100,
  versions: 20,
}
export type FileCheck = { ok: true } | { ok: false; error: string }

/** Cheap validation before any parsing. `head` = first bytes of the file. */
export function checkFile(name: string, size: number, head: Uint8Array): FileCheck {
  if (size === 0) return { ok: false, error: 'This file is empty.' }
  if (size > LIMITS.maxBytes) return { ok: false, error: `This PDF is ${(size / 1048576).toFixed(1)} MB. The in-browser editor supports up to ${LIMITS.maxBytes / 1048576} MB so your device does not run out of memory.` }
  let s = ''
  for (let i = 0; i < Math.min(head.length, 1024); i++) s += String.fromCharCode(head[i])
  if (!s.includes('%PDF-')) return { ok: false, error: `"${name}" does not look like a PDF file.` }
  return { ok: true }
}
