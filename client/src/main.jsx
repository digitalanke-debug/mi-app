import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { StoreProvider, useStore } from './store.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Inbox from './pages/Inbox.jsx'
import Pipeline from './pages/Pipeline.jsx'
import Contacts from './pages/Contacts.jsx'
import WhatsApp from './pages/WhatsApp.jsx'
import Automations from './pages/Automations.jsx'
import AiAgent from './pages/AiAgent.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Team from './pages/Team.jsx'
import Settings from './pages/Settings.jsx'

function App() {
  const { user, loading } = useStore()
  if (loading) return <div className="empty">Cargando…</div>
  if (!user) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/bandeja" replace />} />
        <Route path="/bandeja" element={<Inbox />} />
        <Route path="/bandeja/:id" element={<Inbox />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/contactos" element={<Contacts />} />
        <Route path="/whatsapp" element={<WhatsApp />} />
        <Route path="/automatizaciones" element={<Automations />} />
        <Route path="/agente-ia" element={<AiAgent />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/equipo" element={<Team />} />
        <Route path="/configuracion" element={<Settings />} />
        <Route path="*" element={<Navigate to="/bandeja" replace />} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
