import { useState } from 'react'
import { useStore } from '../store.jsx'

export default function Login() {
  const { login } = useStore()
  const [email, setEmail] = useState('admin@demo.com')
  const [password, setPassword] = useState('demo1234')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await login(email, password) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ color: 'var(--text)', padding: 0 }}><div className="logo">✆</div> CRM WhatsApp</div>
        <p className="text-2">Bandeja multiempresa, pipeline, automatizaciones y agente IA.</p>
        <div className="field"><label>Correo</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
        <div className="field"><label>Contraseña</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <div className="demo">Usuarios demo (clave <span className="kbd">demo1234</span>): admin@demo.com (admin), kevin@demo.com y laura@demo.com (asesores).</div>
      </form>
    </div>
  )
}
