import React, { useState } from 'react'
import Dashboard       from './pages/Dashboard'
import EditorPage      from './pages/EditorPage'
import ToolPage        from './pages/ToolPage'
import StampToolPage   from './pages/StampToolPage'
import WatermarkToolPage from './pages/WatermarkToolPage'
import './index.css'

export default function App() {
  const [page,        setPage]        = useState({ type:'dashboard' })
  const [lastCategory, setLastCategory] = useState('all')

  const goBack = () => setPage({ type:'dashboard' })

  const handleTool = (id, fromCategory) => {
    // Remember which category the user came from
    if (fromCategory) setLastCategory(fromCategory)
    if (id === 'editor')    return setPage({ type:'editor',    fromCategory })
    if (id === 'stamp')     return setPage({ type:'stamp',     fromCategory })
    if (id === 'watermark') return setPage({ type:'watermark', fromCategory })
    setPage({ type:'tool', toolId: id, fromCategory })
  }

  if (page.type === 'dashboard')  return <Dashboard onSelectTool={handleTool} initialCategory={lastCategory}/>
  if (page.type === 'editor')     return <EditorPage onBack={goBack}/>
  if (page.type === 'stamp')      return <StampToolPage onBack={goBack}/>
  if (page.type === 'watermark')  return <WatermarkToolPage onBack={goBack}/>
  if (page.type === 'tool')       return <ToolPage toolId={page.toolId} onBack={goBack}/>
  return <Dashboard onSelectTool={handleTool} initialCategory={lastCategory}/>
}
