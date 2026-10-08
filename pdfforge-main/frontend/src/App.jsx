import React, { useState, useEffect } from 'react'
import Dashboard          from './pages/Dashboard'
import EditorPage         from './pages/EditorPage'
import ToolPage           from './pages/ToolPage'
import StampToolPage      from './pages/StampToolPage'
import WatermarkToolPage  from './pages/WatermarkToolPage'
import PageNumberToolPage from './pages/PageNumberToolPage'
import CropToolPage       from './pages/CropToolPage'
import RotateToolPage     from './pages/RotateToolPage'
import OrganizePDFPage    from './pages/OrganizePDFPage'
import SignPDFPage        from './pages/SignPDFPage'
import OCRToolPage        from './pages/OCRToolPage'
import TranslateToolPage  from './pages/TranslateToolPage'
import RedactToolPage     from './pages/RedactToolPage'
import { consume } from './utils/credits'
import './index.css'

export default function App() {
  const [page,         setPage]         = useState({ type:'dashboard' })
  const [lastCategory, setLastCategory] = useState('all')
  const [search,       setSearch]       = useState('')
  const [dark,         setDark]         = useState(true)
  // pendingFiles: files passed from SmartUpload through to tool pages
  const [pendingFiles, setPendingFiles] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  const goHome = () => {
    setPage({ type:'dashboard' })
    setSearch('')
    setPendingFiles(null)
  }

  const toggleTheme = () => setDark(d => !d)

  const handleCategoryChange = (cat) => {
    setLastCategory(cat)
    setSearch('')
    setPage({ type:'dashboard' })
  }

  const handleTool = (id, fromCategory, files) => {
    if (fromCategory) setLastCategory(fromCategory)
    setSearch('')
    // Store files that were pre-selected (e.g. from SmartUpload)
    if (files) setPendingFiles(files)

    // Consume a credit for this action
    consume(id)
    window.dispatchEvent(new Event('pdfforge:credits'))

    if (id === 'editor')    return setPage({ type:'editor' })
    if (id === 'stamp')     return setPage({ type:'stamp' })
    if (id === 'watermark') return setPage({ type:'watermark' })
    if (id === 'pagenums')  return setPage({ type:'pagenums' })
    if (id === 'crop')      return setPage({ type:'crop' })
    if (id === 'rotate')    return setPage({ type:'rotate' })
    if (id === 'organize')  return setPage({ type:'organize' })
    if (id === 'sign')      return setPage({ type:'sign' })
    if (id === 'ocr')       return setPage({ type:'ocr' })
    if (id === 'translate') return setPage({ type:'translate' })
    if (id === 'redact')    return setPage({ type:'redact' })
    setPage({ type:'tool', toolId: id })
  }

  const shared = {
    dark, onToggleTheme: toggleTheme, onGoHome: goHome,
    showCategories: true,
    activeCategory: lastCategory,
    onCategoryChange: handleCategoryChange,
    search, onSearch: setSearch,
  }

  // Pass pendingFiles as initialFile to tool pages that support it
  const fileProps = pendingFiles ? { initialFiles: pendingFiles } : {}

  if (page.type === 'editor')    return <EditorPage         onBack={goHome} dark={dark} onToggleTheme={toggleTheme} onGoHome={goHome} showCategories={false} {...fileProps}/>
  if (page.type === 'stamp')     return <StampToolPage      onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'watermark') return <WatermarkToolPage  onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'pagenums')  return <PageNumberToolPage onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'crop')      return <CropToolPage       onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'rotate')    return <RotateToolPage     onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'organize')  return <OrganizePDFPage    onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'sign')      return <SignPDFPage        onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'ocr')       return <OCRToolPage        onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'translate') return <TranslateToolPage  onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'redact')    return <RedactToolPage     onBack={goHome} {...shared} {...fileProps}/>
  if (page.type === 'tool')      return <ToolPage toolId={page.toolId} onBack={goHome} onSelectTool={handleTool} {...shared} {...fileProps}/>
  return <Dashboard onSelectTool={handleTool} initialCategory={lastCategory} {...shared}/>
}
