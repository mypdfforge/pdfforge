// Protect / Unlock in the browser. @cantoo/pdf-lib (a pdf-lib fork with encryption) loads only when used.
const MAX_BYTES = 250 * 1024 * 1024 // shortcut: whole file is held in memory, raise only with a streaming engine
const lib = () => import('@cantoo/pdf-lib')
const out = (bytes) => ({ data: new Blob([bytes], { type: 'application/pdf' }) })

async function bytesOf(file) {
  if (file.size > MAX_BYTES) throw new Error(`File is too large for the browser (max ${MAX_BYTES / 1048576} MB).`)
  return new Uint8Array(await file.arrayBuffer())
}

export async function clientProtect(file, password) {
  if (!password) throw new Error('Enter a password.')
  const { PDFDocument } = await lib()
  let doc
  try {
    doc = await PDFDocument.load(await bytesOf(file))
  } catch (e) {
    throw new Error(/encrypt|password/i.test(e.message) ? 'This PDF is already protected. Unlock it first.' : 'Could not read this PDF.')
  }
  await doc.encrypt({ userPassword: password, ownerPassword: password })
  return out(await doc.save())
}

export async function clientUnlock(file, password) {
  const { PDFDocument } = await lib()
  try {
    const doc = await PDFDocument.load(await bytesOf(file), { password: password || '' })
    return out(await doc.save())
  } catch (e) {
    throw new Error(/password|encrypt/i.test(e.message) ? 'Wrong password.' : 'Could not read this PDF.')
  }
}
