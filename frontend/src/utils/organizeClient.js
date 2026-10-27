import { mergePages } from './mergeClient'

/** One PDF per source file, zipped. Pages dragged across files go back to their origin file. */
export async function zipSeparately(files, pages, onProgress, opts) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip(), names = new Set()
  const mine = files.filter(f => pages.some(p => p.fileId === f.id && !p.deleted))
  for (const [i, f] of mine.entries()) {
    const base = f.name.replace(/\.pdf$/i, '') + '-organized'
    let name = `${base}.pdf`, k = 2
    while (names.has(name)) name = `${base}-${k++}.pdf` // two uploads with the same name
    names.add(name)
    zip.file(name, await mergePages([f], pages.filter(p => p.fileId === f.id), null, opts))
    onProgress?.({ done: i + 1, total: mine.length })
  }
  return zip.generateAsync({ type: 'blob' })
}
