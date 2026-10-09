import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Modal } from '../components/Layout.jsx'
import { Icon } from '../components/Icons.jsx'

export default function Team() {
  const { companies, toast } = useStore()
  const [users, setUsers] = useState([])
  const [edit, setEdit] = useState(null)
  const load = () => api('/companies/all-users').then(setUsers).catch((e) => toast(e.message, 'error'))
  useEffect(() => { load() }, [])
  const save = async () => {
    try {
      if (edit.id) await api(`/companies/users/${edit.id}`, { method: 'PATCH', body: edit }); else await api('/companies/users', { method: 'POST', body: edit })
      setEdit(null); load(); toast('Usuario guardado', 'success')
    } catch (e) { toast(e.message, 'error') }
  }
  const toggleCompany = (cid) => setEdit({ ...edit, company_ids: edit.company_ids.includes(cid) ? edit.company_ids.filter((x) => x !== cid) : [...edit.company_ids, cid] })
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Equipo</h1><div className="sub">Usuarios, roles y a qué empresas tiene acceso cada uno.</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => setEdit({ name: '', email: '', password: '', role: 'agent', company_ids: companies.map((c) => c.id), active: true })}><Icon name="plus" size={15} /> Nuevo usuario</button></div>
      </div>
      <div className="card"><table className="table">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Empresas</th><th>Estado</th><th></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td><span className="chip">{u.role === 'admin' ? 'Administrador' : 'Asesor'}</span></td>
            <td className="row">{u.role === 'admin' ? <span className="muted small">Todas</span> : companies.filter((c) => u.company_ids.includes(c.id)).map((c) => <span key={c.id} className="chip tag" style={{ background: c.color }}>{c.name}</span>)}</td>
            <td>{u.active ? <span style={{ color: 'var(--success)' }}>Activo</span> : <span className="muted">Inactivo</span>}</td>
            <td><button className="btn btn-sm" onClick={() => setEdit({ ...u, password: '' })}>Editar</button></td></tr>))}</tbody>
      </table></div>
      {edit && <Modal title={edit.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={() => setEdit(null)} footer={<button className="btn btn-primary" onClick={save}>Guardar</button>}>
        <div className="grid-2">
          <div className="field"><label>Nombre</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div className="field"><label>Correo</label><input className="input" value={edit.email} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></div>
          <div className="field"><label>{edit.id ? 'Nueva contraseña (opcional)' : 'Contraseña'}</label><input className="input" type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></div>
          <div className="field"><label>Rol</label><select className="select" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="agent">Asesor</option><option value="admin">Administrador</option></select></div>
        </div>
        <div className="field"><label>Empresas a las que tiene acceso</label>
          <div className="row">{companies.map((c) => <label key={c.id} className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={edit.company_ids.includes(c.id)} onChange={() => toggleCompany(c.id)} /> {c.name}</label>)}</div></div>
        {edit.id && <label className="row"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Usuario activo</label>}
      </Modal>}
    </div>
  )
}
