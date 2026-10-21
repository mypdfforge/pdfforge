import React from 'react'
import { Home, Clock, PanelLeftClose, PanelLeft, Search, Sun, Moon } from 'lucide-react'
import { CATEGORIES, TOOLS } from '../utils/tools'

export default function Sidebar({ current, collapsed, onToggle, onNavigate, onSearch, onHistory, dark, onToggleTheme }) {
  const Item = ({ icon: Icon, label, onClick, active, tool }) => (
    <button className={`sb-item${tool ? ' sb-tool' : ''}`} title={collapsed ? label : undefined} aria-label={label}
      aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon size={16}/><span className="sb-label">{label}</span>
    </button>
  )
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sb-head">
        <div className="logo" aria-hidden>P</div>
        <span className="sb-label" style={{ fontWeight:700, fontSize:15, flex:1 }}>PDFForge</span>
        <button className="icon-btn hide-sm" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeft size={15}/> : <PanelLeftClose size={15}/>}
        </button>
      </div>
      <nav className="sb-nav">
        <Item icon={Search} label="Search tools" onClick={onSearch}/>
        <Item icon={Home}   label="All tools" active={!current} onClick={() => onNavigate(null)}/>
        <Item icon={Clock}  label="Recent files" onClick={onHistory}/>
        {CATEGORIES.filter(c => c.id !== 'all').map(c => (
          <div key={c.id}>
            <div className="sb-group">{c.label}</div>
            {TOOLS.filter(t => t.category === c.id).map(t => (
              <Item tool key={t.id} icon={t.icon} label={t.label} active={current === t.id} onClick={() => onNavigate(t.id)}/>
            ))}
          </div>
        ))}
      </nav>
      <div className="sb-foot">
        <Item icon={dark ? Sun : Moon} label={dark ? 'Light theme' : 'Dark theme'} onClick={onToggleTheme}/>
      </div>
    </aside>
  )
}
