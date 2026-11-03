/**
 * probe.js - cheap, safe checks before conversion.
 *
 * - Checks name, size and real file type (magic bytes).
 * - Reads only the XML parts that hold text. Caps their size (zip bomb guard).
 * - Detects CJK text so the big font pack loads only when needed.
 * - No layout guessing. The engine is the same for every file.
 */

import { unzipSync } from 'fflate'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_XML_BYTES = 100 * 1024 * 1024

const TEXT_PARTS = /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/

const fail = (code, message) => ({ ok: false, code, message, hasCjk: false })

function extOf(name) {
  const m = /\.([^.]+)$/.exec(name || '')
  return m ? `.${m[1].toLowerCase()}` : ''
}

/**
 * @param {File} file
 * @returns {Promise<{ok:boolean, code?:string, message?:string, hasCjk:boolean}>}
 */
export async function probeDocument(file) {
  const ext = extOf(file?.name)
  if (ext !== '.docx' && ext !== '.doc') {
    return fail('UNSUPPORTED', 'Only .docx and .doc files are supported.')
  }
  if (!file.size) return fail('EMPTY', 'This file is empty.')
  if (file.size > MAX_FILE_BYTES) {
    return fail('TOO_LARGE', `This file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 50 MB.`)
  }

  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0

  if (isOle) {
    if (ext === '.docx') {
      // A real .docx is a zip. An OLE file with .docx name is a password-protected docx.
      return fail('PROTECTED', 'This file is password-protected. Remove the password in Word, then try again.')
    }
    return { ok: true, hasCjk: false } // legacy .doc. LibreOffice reads it.
  }
  if (!isZip) return fail('INVALID', 'This is not a valid Word file. It may be damaged.')

  let tooBig = false
  let parts
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    parts = unzipSync(bytes, {
      filter: (f) => {
        if (!TEXT_PARTS.test(f.name)) return false
        if (f.originalSize > MAX_XML_BYTES) { tooBig = true; return false }
        return true
      },
    })
  } catch {
    return fail('INVALID', 'This is not a valid Word file. It may be damaged.')
  }

  if (tooBig) return fail('TOO_COMPLEX', 'This document is too large to open in a browser.')
  if (!parts['word/document.xml']) {
    return fail('INVALID', 'This is not a valid Word file. It has no document body.')
  }

  const decoder = new TextDecoder('utf-8')
  let hasCjk = false
  for (const name of Object.keys(parts)) {
    if (CJK.test(decoder.decode(parts[name]))) { hasCjk = true; break }
  }
  return { ok: true, hasCjk }
}
