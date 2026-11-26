import { zipSync } from 'fflate'
export { formatBytes, downloadBlob } from '../../pdf-to-word/lib/download.js'

export function pptxName(name) {
  const base = (name || 'presentation').replace(/\.[^.]+$/, '')
  return `${base}.pptx`
}

/**
 * @param {{name: string, blob: Blob}[]} entries
 * @returns {Promise<Blob>} zip of PPTX files. Duplicate names get -2, -3 ...
 */
export async function zipPptx(entries) {
  const files = {}
  const used = new Map()
  for (const { name, blob } of entries) {
    const count = (used.get(name) || 0) + 1
    used.set(name, count)
    const finalName = count === 1 ? name : name.replace(/\.pptx$/i, `-${count}.pptx`)
    files[finalName] = new Uint8Array(await blob.arrayBuffer())
  }
  try {
    const w = new Worker(new URL('../../pdf-to-word/lib/zipWorker.js', import.meta.url), { type: 'module' })
    const buf = await new Promise((res, rej) => {
      w.onmessage = (e) => (e.data?.ok ? res(e.data.buf) : rej(new Error(e.data?.message || 'zip error')))
      w.onerror = (e) => rej(new Error(e?.message || 'zip worker failed'))
      w.postMessage({ files })
    }).finally(() => w.terminate())
    return new Blob([buf], { type: 'application/zip' })
  } catch {
    return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
  }
}
