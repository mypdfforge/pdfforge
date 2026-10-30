/**
 * zipClient.js — tiny STORE-only ZIP writer. No dependency, runs in the browser.
 * PDFs are already compressed, so STORE (no deflate) is fast and cheap on memory:
 * each entry is read once for its CRC, then kept as a Blob reference (no second copy in the JS heap).
 * Limits: no ZIP64 → max 65 535 entries and 4 GB. Throws a clear error beyond that.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
const tick = () => new Promise(r => setTimeout(r, 0))

/** entries: [{ name, blob }]  (name may contain "folder/file.pdf").  Returns a zip Blob. */
export async function makeZip(entries, onProgress) {
  if (entries.length > 65535) throw new Error('Too many files for one ZIP (max 65 535).')
  const enc = new TextEncoder(), parts = [], central = []
  const d = new Date()
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  let offset = 0, cdSize = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], name = enc.encode(e.name), size = e.blob.size
    const crc = crc32(new Uint8Array(await e.blob.arrayBuffer()))   // buffer is garbage after this line
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true) // utf-8 names
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true)
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true)
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    parts.push(lh.buffer, name, e.blob)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true)
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true)
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true)
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true)
    central.push(ch.buffer, name)
    cdSize += 46 + name.length
    offset += 30 + name.length + size
    if (offset > 0xFFFFFFFF) throw new Error('ZIP would be over 4 GB. Download fewer files at once.')
    onProgress?.({ done: i + 1, total: entries.length, label: 'Packing .zip…' })
    await tick()
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}

/** Make `name` unique inside `used` (case-insensitive): "a.pdf" -> "a (2).pdf". Adds the result to `used`. */
export function uniqueName(name, used) {
  const dot = name.lastIndexOf('.'), slash = name.lastIndexOf('/')
  const stem = dot > slash + 1 ? name.slice(0, dot) : name, ext = dot > slash + 1 ? name.slice(dot) : ''
  let out = name, n = 1
  while (used.has(out.toLowerCase())) out = `${stem} (${++n})${ext}`
  used.add(out.toLowerCase())
  return out
}
