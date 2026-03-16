import React, { useState, useEffect } from 'react'
import Dashboard        from './pages/Dashboard'
import EditorPage       from './pages/EditorPage'
import ToolPage         from './pages/ToolPage'
import StampToolPage    from './pages/StampToolPage'
import WatermarkToolPage from './pages/WatermarkToolPage'
import CropToolPage     from './pages/CropToolPage'
import RotateToolPage   from './pages/RotateToolPage'
import './index.css'

export default function App() {
  const [page,         setPage]         = useState({ type:'dashboard' })
  const [lastCategory, setLastCategory] = useState('all')
  const [search,       setSearch]       = useState('')
  const [dark,         setDark]         = useState(true)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  const goHome      = () => { setPage({ type:'dashboard' }); setSearch('') }
  const toggleTheme = () => setDark(d => !d)

  const handleCategoryChange = (cat) => {
    setLastCategory(cat)
    setSearch('')
    setPage({ type:'dashboard' })
  }

  const handleTool = (id, fromCategory) => {
    if (fromCategory) setLastCategory(fromCategory)
    setSearch('')
    if (id === 'editor')    return setPage({ type:'editor' })
    if (id === 'stamp')     return setPage({ type:'stamp' })
    if (id === 'watermark') return setPage({ type:'watermark' })
    if (id === 'crop')      return setPage({ type:'crop' })
    if (id === 'rotate')    return setPage({ type:'rotate' })
    setPage({ type:'tool', toolId: id })
  }

  const shared = {
    dark, onToggleTheme: toggleTheme, onGoHome: goHome,
    showCategories: true,
    activeCategory: lastCategory,
    onCategoryChange: handleCategoryChange,
    search, onSearch: setSearch,
  }

  if (page.type === 'editor')    return <EditorPage    onBack={goHome} dark={dark} onToggleTheme={toggleTheme} onGoHome={goHome} showCategories={false}/>
  if (page.type === 'stamp')     return <StampToolPage onBack={goHome} {...shared}/>
  if (page.type === 'watermark') return <WatermarkToolPage onBack={goHome} {...shared}/>
  if (page.type === 'crop')      return <CropToolPage  onBack={goHome} {...shared}/>
  if (page.type === 'rotate')    return <RotateToolPage onBack={goHome} {...shared}/>
  if (page.type === 'tool')      return <ToolPage toolId={page.toolId} onBack={goHome} onSelectTool={handleTool} {...shared}/>
  return <Dashboard onSelectTool={handleTool} initialCategory={lastCategory} {...shared}/>
}
