import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { api, ago, fmtDateTime } from '../api.js'
import { Icon } from '../components/Icons.jsx'

const ICON = { ok: 'check', warn: 'alert', bad: 'x' }
const STATUS = { connected: 'Conectado', qr: 'Esperando QR', connecting: 'Conectando', disconnected: 'Desconectado' }

function CompanyCheck({ data, open, onToggle }) {
  const nav = useNavigate()
  const count = (s) => data.checks.filter((c) => c.status === s).length
  return (
    <div className="card">
      <div className="card-head" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <span className="chip tag" style={{ background: data.company.color }}>{data.company.name}</span>
        <div className="check-summary">
          {count('bad') > 0 && <span className="verdict bad">{count('bad')} por corregir</span>}
          {count('warn') > 0 && <span className="verdict mid">{count('warn')} para revisar</span>}
          <span className="verdict good">{count('ok')} bien</span>
          <Icon name={open ? 'back' : 'arrow'} size={15} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </div>
      </div>
      <div className="check-list">
        {data.checks.map((c, i) => (
          <div key={i} className="check-row"><span className={`dot ${c.status}`}><Icon name={ICON[c.status]} size={12} strokeWidth={3} /></span><div><div className="t">{c.title}</div><div className="d">{c.detail}</div></div></div>
        ))}
      </div>
      {open && <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border)' }}>
        <div>
          <h3 style={{ marginBottom: 6 }}>Números de WhatsApp</h3>
          <table className="table small"><thead><tr><th>Número</th><th>Conexión</th><th>Estado</th><th>Último mensaje recibido</th><th>24 h</th><th>7 días</th></tr></thead>
            <tbody>{data.instances.map((i) => <tr key={i.id}><td><b>{i.name}</b><div className="muted">{i.phone || '—'}</div></td><td>{i.provider === 'meta' ? 'API oficial' : 'QR'}</td>
              <td><span className={`status-dot status-${i.status}`} /> {STATUS[i.status] || i.status}{i.webhook && !i.webhook.error && (!i.webhook.enabled || !i.webhook.url_ok) && <div style={{ color: 'var(--danger)' }}>No recibe mensajes</div>}</td>
              <td>{i.last_inbound_at ? `${fmtDateTime(i.last_inbound_at)} (hace ${ago(i.last_inbound_at)})` : '—'}</td><td>{i.inbound_24h}</td><td>{i.inbound_7d}</td></tr>)}
              {!data.instances.length && <tr><td colSpan={6} className="muted">Sin números</td></tr>}</tbody></table>
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Mensajes automáticos</h3>
          <table className="table small"><thead><tr><th>Automatización</th><th>Activa</th><th>Veces</th><th>Última vez</th></tr></thead>
            <tbody>{data.automations.map((a) => <tr key={a.id}><td>{a.name}{a.menu_options > 0 && <span className="muted"> · menú de {a.menu_options} opciones</span>}</td><td>{a.enabled ? 'Sí' : <span className="muted">No</span>}</td><td>{a.runs}</td><td>{a.last_run_at ? fmtDateTime(a.last_run_at) : '—'}</td></tr>)}</tbody></table>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => nav('/automatizaciones')}>Ir a Automatizaciones</button>
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Equipo y avisos</h3>
          <table className="table small"><thead><tr><th>Persona</th><th>Rol</th><th>CRM abierto ahora</th><th>Avisos de escritorio</th><th>Sonido</th></tr></thead>
            <tbody>{data.team.map((u) => <tr key={u.id}><td><b>{u.name}</b></td><td>{u.role === 'admin' ? 'Administrador' : 'Asesor'}</td><td>{u.online ? `Sí${u.sessions > 1 ? ` (${u.sessions} pestañas)` : ''}` : <span className="muted">No</span>}</td>
              <td>{u.permission === 'denied' ? <span style={{ color: 'var(--danger)' }}>Bloqueados en el navegador</span> : u.notify === null ? <span className="muted">—</span> : u.notify ? 'Activados' : u.permission === 'default' ? 'Falta dar permiso' : 'Apagados'}</td>
              <td>{u.sound === null ? <span className="muted">—</span> : u.sound ? 'Activado' : 'Apagado'}</td></tr>)}</tbody></table>
          <div className="small text-2" style={{ marginTop: 6 }}>Los avisos llegan solo a quien tiene el CRM abierto. Los de escritorio salen cuando la pestaña no está a la vista; el sonido, con cada mensaje nuevo. Cada persona los activa abajo a la izquierda, en "Avisos".</div>
        </div>
      </div>}
    </div>
  )
}

export default function Checkup() {
  const { companies, toast } = useStore()
  const [list, setList] = useState(null)
  const [open, setOpen] = useState({})
  const load = useCallback(async () => {
    setList(null)
    const out = await Promise.all(companies.map((c) => api(`/companies/${c.id}/checkup`).catch((e) => { toast(`${c.name}: ${e.message}`, 'error'); return null })))
    setList(out.filter(Boolean))
  }, [companies, toast])
  useEffect(() => { load() }, [load])
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Revisión</h1><div className="sub">Estado de cada empresa: números de WhatsApp, mensajes automáticos, anuncios y avisos al equipo.</div></div>
        <div className="actions"><button className="btn" onClick={load}><Icon name="refresh" size={15} /> Revisar de nuevo</button></div>
      </div>
      {!list && <div className="empty">Revisando…</div>}
      {list?.map((d) => <CompanyCheck key={d.company.id} data={d} open={!!open[d.company.id]} onToggle={() => setOpen((o) => ({ ...o, [d.company.id]: !o[d.company.id] }))} />)}
    </div>
  )
}
