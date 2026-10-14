import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { Field } from '../components/ui.jsx'

export default function Login() {
  const { login, error, clearError } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    clearError()
    try {
      await login(email, password)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-dark">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">Administración</div>
            <div className="brand-sub">Acceso privado</div>
          </div>
        </div>
        <Field label="Correo"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="username" /></Field>
        <Field label="Contraseña"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
        {(msg || error) && <p className="note note-danger">{msg || error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
