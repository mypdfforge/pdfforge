// ============================================================
//  PDFForge — Frontend Upload Library
//  Drop this file into:  src/lib/pdfForge.js
//
//  Usage in any React component:
//    import { processPDF } from '../lib/pdfForge'
//    const url = await processPDF(file, 'compress', (p) => console.log(p))
//    window.open(url)
// ============================================================

const BRAIN_URL  = 'Https://pdfforge-brain.mypdfforge.workers.dev'   // ← change this
const CHUNK_SIZE = 1 * 1024 * 1024   // 1 MB per chunk

// ── Split a File object into 1 MB Blob slices ─────────────────
function splitIntoChunks(file) {
  const chunks = []
  let offset   = 0
  while (offset < file.size) {
    chunks.push(file.slice(offset, offset + CHUNK_SIZE))
    offset += CHUNK_SIZE
  }
  return chunks
}

// ── Main function — call this from your UI ────────────────────
//
//  file      — a File object (from <input type="file">)
//  tool      — string: 'compress' | 'watermark' | 'stamp' | 'ocr'
//  onProgress — optional callback({ stage, done, total, downloadUrl })
//
export async function processPDF(file, tool, onProgress) {
  const chunks = splitIntoChunks(file)

  // Step 1 — tell the Brain we want to upload
  onProgress?.({ stage: 'starting' })

  const initRes = await fetch(`${BRAIN_URL}/init-job`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName:   file.name,
      chunkCount: chunks.length,
      tool,
    }),
  })

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}))
    throw new Error(err.error || `Init failed: ${initRes.status}`)
  }

  const { jobId, presignedUrls } = await initRes.json()
  onProgress?.({ stage: 'uploading', done: 0, total: chunks.length })

  // Step 2 — upload chunks (3 at a time)
  const CONCURRENCY = 3
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY)

    await Promise.all(batch.map(async (chunk, batchIdx) => {
      const globalIdx  = i + batchIdx
      const { uploadUrl } = presignedUrls[globalIdx]

      // Upload directly to R2 via the CF Worker
      const upRes = await fetch(uploadUrl, {
        method:  'POST',
        body:    chunk,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!upRes.ok) throw new Error(`Chunk ${globalIdx} upload failed`)

      // Tell Brain this chunk arrived
      const ackRes = await fetch(`${BRAIN_URL}/chunk-ack`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId, chunkIndex: globalIdx }),
      })
      if (!ackRes.ok) throw new Error(`Chunk ${globalIdx} ack failed`)

      onProgress?.({ stage: 'uploading', done: globalIdx + 1, total: chunks.length })
    }))
  }

  // Step 3 — poll until done
  onProgress?.({ stage: 'processing' })
  const downloadUrl = await pollUntilDone(jobId)

  onProgress?.({ stage: 'done', downloadUrl })
  return downloadUrl
}

// ── Poll /job-status every 2s, give up after 5 min ───────────
async function pollUntilDone(jobId, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))

    const res  = await fetch(
      `${BRAIN_URL}/job-status?jobId=${encodeURIComponent(jobId)}`
    )
    const data = await res.json()

    if (data.status === 'done')   return data.downloadUrl
    if (data.status === 'failed') throw new Error('Processing failed on worker')
    // status === 'uploading' or 'processing' — keep polling
  }

  throw new Error('Timed out — job took longer than 5 minutes')
}

// ── Example React hook (copy-paste ready) ────────────────────
/*
import { useState } from 'react'
import { processPDF } from '../lib/pdfForge'

export function usePDFProcessor() {
  const [progress, setProgress] = useState(null)
  const [error,    setError]    = useState(null)

  const process = async (file, tool) => {
    setError(null)
    try {
      const url = await processPDF(file, tool, setProgress)
      // Auto-download the result
      const a   = document.createElement('a')
      a.href    = url
      a.download = 'result.pdf'
      a.click()
    } catch (e) {
      setError(e.message)
    }
  }

  return { process, progress, error }
}
*/
