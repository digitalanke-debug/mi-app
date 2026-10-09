import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { api, fmtDate, SOURCE_LABEL } from '../api.js'
import { Icon } from '../components/Icons.jsx'

export default function Contacts() {
  const { companyId, user, toast } = useStore()
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const load = () => companyId && api('/contacts', { params: { company_id: companyId, q } }).then(setList)
  useEffect(() => { load() }, [companyId, q])
  const remove = async (c) => { if (!confirm(`¿Eliminar a ${c.name} y todas sus conversaciones? (derecho de supresión)`)) return; await api(`/contacts/${c.id}`, { method: 'DELETE' }); load(); toast('Contacto eliminado', 'success') }
  const exportCsv = () => {
    const rows = [['Nombre', 'Teléfono', 'Correo', 'Ciudad', 'Origen', 'Campaña', 'Creado'], ...list.map((c) => [c.name, c.phone, c.email, c.city, SOURCE_LABEL[c.source] || c.source, c.campaign, c.created_at])]
    const blob = new Blob([rows.map((r) => r.map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'contactos.csv'; a.click()
  }
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Contactos</h1><div className="sub">{list.length} contactos de la empresa activa</div></div>
        <div className="actions"><input className="input" style={{ width: 260 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" onClick={exportCsv}><Icon name="download" size={15} /> Exportar CSV</button></div>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Teléfono</th><th>Ciudad</th><th>Origen</th><th>Campaña</th><th>Conversaciones</th><th>Creado</th><th></th></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td><td>+{c.phone}</td><td>{c.city || '—'}</td><td><span className="chip">{SOURCE_LABEL[c.source] || c.source}</span></td><td>{c.campaign || '—'}</td>
              <td>{c.conversations.map((v) => <button key={v.id} className="btn btn-sm btn-ghost" onClick={() => nav(`/bandeja/${v.id}`)}>#{v.id} {v.status === 'closed' ? '✓' : '💬'}</button>)}</td>
              <td className="muted">{fmtDate(c.created_at)}</td>
              <td>{user.role === 'admin' && <button className="btn btn-sm btn-danger btn-icon" title="Eliminar" onClick={() => remove(c)}><Icon name="trash" size={14} /></button>}</td>
            </tr>))}</tbody>
        </table>
        {list.length === 0 && <div className="empty">Sin contactos</div>}
      </div>
    </div>
  )
}
