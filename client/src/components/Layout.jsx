import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useRealtime, useStore, requestNotifications } from '../store.jsx'
import { api, initials } from '../api.js'
import { Icon } from './Icons.jsx'

const NAV = [
  ['/bandeja', 'inbox', 'Bandeja'],
  ['/pipeline', 'kanban', 'Pipeline'],
  ['/contactos', 'users', 'Contactos'],
  ['/dashboard', 'chart', 'Dashboard'],
  ['/automatizaciones', 'zap', 'Automatizaciones'],
  ['/agente-ia', 'sparkles', 'Agente IA'],
  ['/whatsapp', 'wa', 'WhatsApp'],
  ['/equipo', 'team', 'Equipo'],
  ['/configuracion', 'settings', 'Configuración'],
]

export default function Layout() {
  const { user, companies, company, companyId, setCompanyId, logout, toasts, theme, setTheme, prefs, setPrefs } = useStore()
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname])
  useEffect(() => { if (prefs.notify) requestNotifications() }, [prefs.notify])

  const loadUnread = () => companyId && api('/conversations', { params: { company_id: companyId, status: 'open' } })
    .then((list) => setUnread(list.reduce((a, c) => a + (c.unread_count || 0), 0))).catch(() => {})
  useEffect(() => { loadUnread() }, [companyId])
  useRealtime('conversation:update', (c) => { if (c.company_id === companyId) loadUnread() })

  return (
    <div className="app">
      <div className="topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="Menú"><Icon name="menu" size={20} /></button>
        <div className="brand"><div className="logo"><Icon name="wa" size={17} strokeWidth={2} /></div> {company?.name || 'CRM'}</div>
        <NavLink to="/bandeja" className="btn btn-ghost btn-icon" aria-label="Bandeja"><Icon name="inbox" size={20} />{unread > 0 && <span className="badge" style={{ marginLeft: 4 }}>{unread}</span>}</NavLink>
      </div>
      <div className={`sidebar-bg ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><div className="logo"><Icon name="wa" size={17} strokeWidth={2} /></div> CRM WhatsApp</div>
        <select className="company-select" value={companyId || ''} onChange={(e) => setCompanyId(Number(e.target.value))}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <nav className="nav">
          {NAV.filter(([p]) => p !== '/equipo' || user.role === 'admin').map(([path, ico, label]) => (
            <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={ico} />{label}
              {path === '/bandeja' && unread > 0 && <span className="badge">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="theme-row"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} /> {theme === 'dark' ? 'Modo oscuro' : 'Modo claro'}
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Cambiar</button></div>
        <div className="theme-row"><Icon name="bell" size={15} /> Avisos
          <button className={`toggle ${prefs.notify ? 'on' : ''}`} style={{ marginLeft: 'auto' }} title="Notificaciones de escritorio" onClick={() => setPrefs({ notify: !prefs.notify })} />
          <button className={`toggle ${prefs.sound ? 'on' : ''}`} title="Sonido" onClick={() => setPrefs({ sound: !prefs.sound })} /></div>
        {company && <div className="small muted" style={{ padding: '6px 10px 0' }}>Empresa activa: <b style={{ color: company.color }}>{company.name}</b></div>}
        <div className="userbox">
          <div className="avatar sm">{initials(user.name)}</div>
          <div><div className="name">{user.name}</div><div className="role">{user.role === 'admin' ? 'Administrador' : 'Asesor'}</div></div>
          <button className="btn btn-ghost btn-sm btn-icon" title="Salir" onClick={logout}><Icon name="logout" size={16} /></button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </div>
  )
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="card-head"><h2>{title}</h2><div className="actions"><button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><Icon name="x" size={16} /></button></div></div>
        <div className="card-body">{children}</div>
        {footer && <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none', justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  )
}
