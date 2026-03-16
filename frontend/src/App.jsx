import React, { useState, useEffect } from 'react'
import Dashboard       from './pages/Dashboard'
import EditorPage      from './pages/EditorPage'
import ToolPage        from './pages/ToolPage'
import StampToolPage   from './pages/StampToolPage'
import WatermarkToolPage from './pages/WatermarkToolPage'
import './index.css'

export default function App() {
  const [page,         setPage]         = useState({ type:'dashboard' })
  const [lastCategory, setLastCategory] = useState('all')
  const [dark,         setDark]         = useState(true)

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  const goBack = () => setPage({ type:'dashboard' })

  const handleTool = (id, fromCategory) => {
    if (fromCategory) setLastCategory(fromCategory)
    if (id === 'editor')    return setPage({ type:'editor' })
    if (id === 'stamp')     return setPage({ type:'stamp' })
    if (id === 'watermark') return setPage({ type:'watermark' })
    setPage({ type:'tool', toolId: id })
  }

  if (page.type === 'dashboard')  return <Dashboard onSelectTool={handleTool} initialCategory={lastCategory} dark={dark} onToggleTheme={() => setDark(d => !d)}/>
  if (page.type === 'editor')     return <EditorPage onBack={goBack} dark={dark} onToggleTheme={() => setDark(d => !d)}/>
  if (page.type === 'stamp')      return <StampToolPage onBack={goBack} dark={dark} onToggleTheme={() => setDark(d => !d)}/>
  if (page.type === 'watermark')  return <WatermarkToolPage onBack={goBack} dark={dark} onToggleTheme={() => setDark(d => !d)}/>
  if (page.type === 'tool')       return <ToolPage toolId={page.toolId} onBack={goBack} dark={dark} onToggleTheme={() => setDark(d => !d)}/>
  return <Dashboard onSelectTool={handleTool} initialCategory={lastCategory} dark={dark} onToggleTheme={() => setDark(d => !d)}/>
}
