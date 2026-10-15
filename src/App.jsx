import { useEffect, useState } from 'react'
import { AppStoreProvider } from './store/AppStore.jsx'
import { useStore } from './store/useStore.js'
import Dashboard from './pages/Dashboard.jsx'
import Clientes from './pages/Clientes.jsx'
import CuentasPorPagar from './pages/CuentasPorPagar.jsx'
import Caja from './pages/Caja.jsx'
import Recordatorios from './pages/Recordatorios.jsx'
import Usuarios from './pages/Usuarios.jsx'
import WhatsApp from './pages/WhatsApp.jsx'
import Login from './pages/Login.jsx'
import { cop } from './lib/format.js'
import { computePriority } from './lib/priority.js'
import { invoiceStatus } from './lib/invoices.js'

const NAV = [
  { key: 'panel', label: 'Panel' },
  { key: 'clientes', label: 'Clientes y facturación' },
  { key: 'pagar', label: 'Cuentas por pagar' },
  { key: 'caja', label: 'Caja' },
  { key: 'recordatorios', label: 'Recordatorios' },
  { key: 'whatsapp', label: 'Asistente WhatsApp', adminApiOnly: true },
  { key: 'usuarios', label: 'Usuarios y bitácora', adminApiOnly: true },
]

function readHash() {
  const h = window.location.hash.replace('#/', '').replace('#', '')
  return NAV.some((n) => n.key === h) ? h : 'panel'
}

function Shell() {
  const { state, balance, user, mode, canEdit, saving, error, clearError, logout } = useStore()
  const [page, setPage] = useState(readHash)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(clearError, 6000)
    return () => clearTimeout(t)
  }, [error, clearError])

  function go(key) {
    window.history.pushState(null, '', `#/${key}`)
    setPage(key)
    setMenuOpen(false)
  }

  const nav = NAV.filter((n) => !n.adminApiOnly || (mode === 'api' && user?.role === 'admin'))
  const altas = state.expenses.filter((e) => e.status !== 'pagado' && computePriority(e) === 'alta').length
  const vencidas = state.invoices.filter((i) => invoiceStatus(i) === 'vencida').length
  const badges = { pagar: altas, recordatorios: vencidas }

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">{state.settings.firmName}</div>
            <div className="brand-sub">Administración</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.key} type="button" className={page === n.key ? 'active' : ''} onClick={() => go(n.key)}>
              <span>{n.label}</span>
              {badges[n.key] > 0 && <span className="nav-badge">{badges[n.key]}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">Saldo en cuenta</div>
          <div className={`sidebar-balance ${balance < 0 ? 'text-danger' : ''}`}>{cop(balance)}</div>
          <div className="sidebar-user">
            <span className="small">{user?.name}{!canEdit && ' · solo lectura'}</span>
            {mode === 'api' && <button type="button" className="btn-link-light" onClick={logout}>Salir</button>}
          </div>
        </div>
      </aside>
      <div className="topbar">
        <button type="button" className="btn-icon" aria-label="Menú" onClick={() => setMenuOpen((v) => !v)}>☰</button>
        <strong>{NAV.find((n) => n.key === page)?.label}</strong>
        <span className="muted small">{cop(balance)}</span>
      </div>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <main className="content">
        {!canEdit && <div className="banner">Tu usuario es de solo lectura: puedes consultar todo pero no registrar cambios.</div>}
        {page === 'panel' && <Dashboard go={go} />}
        {page === 'clientes' && <Clientes />}
        {page === 'pagar' && <CuentasPorPagar />}
        {page === 'caja' && <Caja />}
        {page === 'recordatorios' && <Recordatorios />}
        {page === 'usuarios' && mode === 'api' && user?.role === 'admin' && <Usuarios />}
        {page === 'whatsapp' && mode === 'api' && user?.role === 'admin' && <WhatsApp />}
      </main>
      {saving && <div className="toast toast-info">Guardando…</div>}
      {error && <div className="toast toast-danger" onClick={clearError}>{error}</div>}
    </div>
  )
}

function Gate() {
  const { mode, user, state, error } = useStore()
  if (mode === 'api') {
    if (user === undefined) return <div className="login"><div className="muted">{error || 'Cargando…'}</div></div>
    if (user === null) return <Login />
    if (!state) return <div className="login"><div className="muted">{error || 'Cargando datos…'}</div></div>
  }
  return <Shell />
}

export default function App() {
  return (
    <AppStoreProvider>
      <Gate />
    </AppStoreProvider>
  )
}
