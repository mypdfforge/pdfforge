// Test harness only: mounts the real editor UI like the platform does, with a locally-built worker.
import React from 'react'
import { createRoot } from 'react-dom/client'
import EditorApp from '../src/editor/ui/EditorApp.jsx'
import '../src/index.css'
const makeWorker = () => new Worker('/worker.js', { type: 'module' })
createRoot(document.getElementById('root')).render(
  <div className="app"><main className="main" id="main"><EditorApp makeWorker={window.__noWorker ? undefined : makeWorker} onBack={() => {}} /></main></div>
)
