import React, { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import './editor.css'
import Home from './Home.jsx'
import Workspace from './Workspace.jsx'
import { openSession, friendlyError } from '../session.js'
import { checkFile } from '../core/limits.ts'
import { listProjects, createProject, loadProject, deleteProject, duplicateProject, renameProject, storageAvailable } from '../core/projects.ts'

export default function EditorApp({ onBack, initialFiles, makeWorker }) {
  const [phase, setPhase] = useState('home')
  const [session, setSession] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const [projects, setProjects] = useState([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null)
  const live = useRef(null)
  const storageOk = storageAvailable()
  const refresh = () => (storageOk ? listProjects().then(setProjects).catch(() => {}) : undefined)
  useEffect(() => { refresh(); const f = initialFiles?.[0]; if (f instanceof Blob) openFile(f); return () => live.current?.dispose() }, [])
  const mount = (s, id) => { live.current?.dispose(); live.current = s; setSession(s); setProjectId(id); setPhase('edit') }

  async function openFile(file) {
    setError(''); setPhase('loading'); setProgress(null)
    try {
      const chk = checkFile(file.name || 'document.pdf', file.size, new Uint8Array(await file.slice(0, 1024).arrayBuffer()))
      if (!chk.ok) throw new Error(chk.error)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const name = file.name || 'document.pdf'
      const s = await openSession({ bytes, name, makeWorker, onProgress: (d, t) => setProgress({ d, t }) })
      let id = null
      if (storageOk) { try { id = (await createProject(name, bytes, s.doc)).id } catch { /* storage full/blocked: editing still works */ } }
      mount(s, id)
    } catch (e) { setError(friendlyError(e)); setPhase('home') }
  }
  async function openProject(pid) {
    setError(''); setPhase('loading'); setProgress(null)
    try {
      const l = await loadProject(pid)
      if (!l) throw new Error('This saved document could not be found.')
      const s = await openSession({ bytes: l.bytes, name: l.meta.name, restored: l.doc, makeWorker })
      mount(s, pid)
    } catch (e) { setError(friendlyError(e)); setPhase('home') }
  }
  const close = () => { live.current?.dispose(); live.current = null; setSession(null); setProjectId(null); setPhase('home'); refresh() }

  if (phase === 'edit' && session) return <Workspace session={session} projectId={projectId} onClose={close} />
  return (
    <div className="pe" style={{ overflow: 'auto' }}>
      {phase === 'loading' ? (
        <div className="pe-home" data-testid="loading" role="status"><Loader2 className="spin" size={22} /> <b style={{ marginLeft: 8 }}>Opening on your device…</b>
          <div className="pe-muted" style={{ marginTop: 6 }}>{progress ? `Reading page ${progress.d} of ${progress.t}` : 'Parsing the PDF'}</div></div>
      ) : (
        <>
          {error && <div className="pe-home" style={{ paddingBottom: 0 }}><div className="pe-card pe-err" role="alert" data-testid="open-error"><AlertCircle size={14} style={{ verticalAlign: -2 }} /> {error}</div></div>}
          <Home projects={projects} storageOk={storageOk} onFile={openFile} onOpen={openProject}
            onDelete={async (id) => { await deleteProject(id); refresh() }} onDuplicate={async (id) => { await duplicateProject(id); refresh() }} onRename={async (id, n) => { await renameProject(id, n); refresh() }} />
        </>
      )}
    </div>
  )
}
