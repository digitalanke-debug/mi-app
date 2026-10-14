import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../store/api.js'
import { Modal, Field, Empty } from '../components/ui.jsx'
import { fmtDate } from '../lib/format.js'

export default function Usuarios() {
  const { user } = useStore()
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(null)
  const [pwModal, setPwModal] = useState(false)
  const [msg, setMsg] = useState(null)
  const [log, setLog] = useState([])

  function refresh() {
    return Promise.all([api.users(), api.log(50)])
      .then(([r, l]) => { setUsers(r.users); setLog(l.log) })
      .catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    Promise.all([api.users(), api.log(50)])
      .then(([r, l]) => { setUsers(r.users); setLog(l.log) })
      .catch((e) => setMsg(e.message))
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Usuarios y bitácora</h1>
          <p className="muted">Quién puede entrar y qué ha cambiado.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setPwModal(true)}>Cambiar mi contraseña</button>
          <button type="button" className="btn btn-primary" onClick={() => setModal({})}>+ Nuevo usuario</button>
        </div>
      </header>
      {msg && <p className="note note-danger">{msg}</p>}

      <section className="card">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Creado</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong>{u.id === user.id && <span className="muted small"> (tú)</span>}</td>
                <td>{u.email}</td>
                <td>{u.role === 'admin' ? 'Administra' : 'Solo lectura'}</td>
                <td>{u.active ? <span className="badge badge-ok">Activo</span> : <span className="badge badge-neutral">Inactivo</span>}</td>
                <td>{fmtDate(String(u.created_at).slice(0, 10))}</td>
                <td className="actions">
                  <button type="button" className="btn btn-sm" onClick={() => setModal({ user: u })}>Editar</button>
                  {u.id !== user.id && (
                    <button type="button" className="btn btn-sm" onClick={async () => { await api.updateUser(u.id, { active: !u.active }); refresh() }}>{u.active ? 'Desactivar' : 'Activar'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head"><h2>Últimos cambios</h2></div>
        {log.length === 0 ? <Empty title="Sin movimientos todavía" /> : (
          <ul className="list">
            {log.map((l) => (
              <li key={l.id} className="list-item">
                <div className="list-main">
                  <strong>{describe(l.action)}</strong>
                  <span className="muted small">{l.user_email}</span>
                </div>
                <div className="list-side"><span className="muted small">{new Date(l.created_at).toLocaleString('es-CO')}</span></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modal && (
        <UserForm
          initial={modal.user}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            try {
              if (modal.user) await api.updateUser(modal.user.id, data)
              else await api.createUser(data)
              setModal(null)
              refresh()
            } catch (e) {
              setMsg(e.message)
            }
          }}
        />
      )}
      {pwModal && <PasswordForm onClose={() => setPwModal(false)} />}
    </div>
  )
}

function describe(a) {
  const map = {
    'client/add': 'Creó un cliente', 'client/update': 'Editó un cliente', 'client/remove': 'Eliminó un cliente',
    'invoice/add': 'Creó una cuenta de cobro', 'invoice/update': 'Editó una cuenta de cobro', 'invoice/remove': 'Eliminó una cuenta de cobro', 'invoice/payment': 'Registró un pago de cliente',
    'expense/add': 'Creó una cuenta por pagar', 'expense/update': 'Editó una cuenta por pagar', 'expense/remove': 'Eliminó una cuenta por pagar', 'expense/pay': 'Pagó cuentas por pagar', 'expense/unpay': 'Deshizo un pago',
    'recurring/add': 'Creó un gasto fijo', 'recurring/update': 'Editó un gasto fijo', 'recurring/remove': 'Eliminó un gasto fijo', 'recurring/generate': 'Se generaron gastos fijos del periodo',
    'cash/movement': 'Registró un movimiento manual de caja', 'cash/remove': 'Eliminó un movimiento de caja', 'cash/setBalance': 'Ajustó el saldo',
    'reminder/add': 'Registró un recordatorio', 'settings/update': 'Cambió la configuración', replace: 'Restauró o reemplazó todos los datos',
  }
  let s = map[a.type] || a.type
  if (a.type === 'expense/pay') s += ` (${a.ids?.length || 0})`
  if (a.type === 'invoice/payment') s += ` por ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(a.amount || 0)}`
  return s
}

function UserForm({ initial, onClose, onSave }) {
  const [f, setF] = useState({ name: initial?.name || '', email: initial?.email || '', role: initial?.role || 'admin', password: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title={initial ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); const data = { name: f.name, role: f.role }; if (!initial) data.email = f.email; if (f.password) data.password = f.password; onSave(data) }}>
        <Field label="Nombre"><input className="input" value={f.name} onChange={set('name')} required autoFocus /></Field>
        {!initial && <Field label="Correo"><input className="input" type="email" value={f.email} onChange={set('email')} required /></Field>}
        <Field label="Rol" hint="Solo lectura puede ver todo pero no registrar nada.">
          <select className="input" value={f.role} onChange={set('role')}>
            <option value="admin">Administra (crea, paga, edita)</option>
            <option value="lectura">Solo lectura (socios)</option>
          </select>
        </Field>
        <Field label={initial ? 'Nueva contraseña (opcional)' : 'Contraseña'} hint="Mínimo 8 caracteres"><input className="input" type="password" value={f.password} onChange={set('password')} required={!initial} minLength={8} autoComplete="new-password" /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function PasswordForm({ onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState(null)
  return (
    <Modal title="Cambiar mi contraseña" onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await api.changePassword(current, next); onClose() } catch (err) { setMsg(err.message) } }}>
        <Field label="Contraseña actual"><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" /></Field>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
        {msg && <p className="note note-danger">{msg}</p>}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Cambiar</button>
        </div>
      </form>
    </Modal>
  )
}
