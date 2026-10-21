import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import Dashboard from './pages/Dashboard'
import Sidebar from './components/Sidebar'
import CommandPalette from './components/CommandPalette'
import FileHistory from './components/FileHistory'
import { toolById } from './utils/tools'
import './index.css'

// Heavy tool pages load on demand.
const STANDALONE = {
  editor:    lazy(() => import('./pages/EditorPage')),
  stamp:     lazy(() => import('./pages/StampToolPage')),
  watermark: lazy(() => import('./pages/WatermarkToolPage')),
  pagenums:  lazy(() => import('./pages/PageNumberToolPage')),
  crop:      lazy(() => import('./pages/CropToolPage')),
  rotate:    lazy(() => import('./pages/RotateToolPage')),
  organize:  lazy(() => import('./pages/OrganizePDFPage')),
  sign:      lazy(() => import('./pages/SignPDFPage')),
  ocr:       lazy(() => import('./pages/OCRToolPage')),
  translate: lazy(() => import('./pages/TranslateToolPage')),
  redact:    lazy(() => import('./pages/RedactToolPage')),
}
const GenericTool = lazy(() => import('./pages/ToolPage'))

const THEME_KEY = 'pdfforge-theme'
const idFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, '')
  return toolById(id) ? id : null
}

export default function App() {
  const [toolId,       setToolId]       = useState(idFromHash)
  const [dark,         setDark]         = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const [collapsed,    setCollapsed]    = useState(() => !!idFromHash())
  const [drawer,       setDrawer]       = useState(false)
  const [palette,      setPalette]      = useState(false)
  const [history,      setHistory]      = useState(false)
  // Files chosen on the home page, carried into the tool the user picks.
  const [pendingFiles, setPendingFiles] = useState(null)

  // Browser back/forward and refresh work because the tool lives in the URL hash.
  useEffect(() => {
    const h = () => { setToolId(idFromHash()); setDrawer(false) }
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  useEffect(() => {
    setCollapsed(!!toolId)
    document.title = toolId ? `${toolById(toolId).label} — PDFForge` : 'PDFForge — PDF tools that run in your browser'
  }, [toolId])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) }
      if (e.key === 'Escape') setDrawer(false)
    }
    const openMenu   = () => setDrawer(true)
    const openSearch = () => setPalette(true)
    window.addEventListener('keydown', key)
    window.addEventListener('pdfforge:menu', openMenu)
    window.addEventListener('pdfforge:search', openSearch)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pdfforge:menu', openMenu)
      window.removeEventListener('pdfforge:search', openSearch)
    }
  }, [])

  const toggleTheme = () => setDark(d => {
    try { localStorage.setItem(THEME_KEY, d ? 'light' : 'dark') } catch {}
    return !d
  })

  // handleTool keeps the (id, category, files) signature SmartUpload/ToolPage already call.
  const go = useCallback((id, _category, files) => {
    if (files) setPendingFiles(files)
    if (!id) setPendingFiles(null)
    window.location.hash = id ? `/${id}` : '/'
    setToolId(id || null)
    setDrawer(false)
  }, [])

  const goHome = () => go(null)
  const shared = { dark, onToggleTheme: toggleTheme, onGoHome: goHome, onBack: goHome }
  const fileProps = pendingFiles ? { initialFiles: pendingFiles } : {}
  const Page = toolId && STANDALONE[toolId]

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <Sidebar current={toolId} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        onNavigate={go} onSearch={() => { setDrawer(false); setPalette(true) }}
        onHistory={() => { setDrawer(false); setHistory(true) }}
        dark={dark} onToggleTheme={toggleTheme}/>
      <div className="scrim" onClick={() => setDrawer(false)}/>
      <main className="main" id="main">
        <Suspense fallback={<p role="status" style={{ padding:40, color:'var(--text3)' }}>Loading…</p>}>
          {!toolId ? <Dashboard onSelectTool={go} onHistory={() => setHistory(true)} {...shared}/>
           : Page  ? <Page {...shared} {...fileProps}/>
           : <GenericTool key={toolId} toolId={toolId} onSelectTool={go} {...shared} {...fileProps}/>}
        </Suspense>
      </main>
      {palette && <CommandPalette onClose={() => setPalette(false)} onSelect={id => go(id)}/>}
      {history && <FileHistory onClose={() => setHistory(false)}/>}
    </div>
  )
}
