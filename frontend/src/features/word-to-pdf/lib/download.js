import { zipSync } from 'fflate'

export function pdfName(name) {
  const base = (name || 'document').replace(/\.[^.]+$/, '')
  return `${base}.pdf`
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return ''
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(2)} MB`
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * @param {{name: string, blob: Blob}[]} entries
 * @returns {Promise<Blob>} zip of PDFs. Duplicate names get -2, -3 ...
 */
export async function zipPdfs(entries) {
  const files = {}
  const used = new Map()
  for (const { name, blob } of entries) {
    const count = (used.get(name) || 0) + 1
    used.set(name, count)
    const finalName = count === 1 ? name : name.replace(/\.pdf$/i, `-${count}.pdf`)
    files[finalName] = new Uint8Array(await blob.arrayBuffer())
  }
  // PDFs are already compressed. Store only.
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
}
