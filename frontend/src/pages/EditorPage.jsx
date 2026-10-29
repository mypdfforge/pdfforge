/**
 * Resume Editor. Opens, edits and exports PDFs entirely in the browser (no upload, no server processing).
 * Engine + UI live in src/editor/. The old server-backed editor (SectionCard + /api/upload + /api/export) is no longer used here.
 */
import React from 'react'
import EditorApp from '../editor/ui/EditorApp.jsx'

// Module worker: bundled by Vite; falls back to the main thread automatically if it cannot start.
const makeWorker = () => new Worker(new URL('../editor/worker/exportWorker.ts', import.meta.url), { type: 'module' })

export default function EditorPage({ onBack, initialFiles }) {
  return <EditorApp onBack={onBack} initialFiles={initialFiles} makeWorker={makeWorker} />
}
