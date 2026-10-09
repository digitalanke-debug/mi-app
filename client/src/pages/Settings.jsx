import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Modal } from '../components/Layout.jsx'
import { Icon } from '../components/Icons.jsx'

export default function Settings() {
  const { companyId, company, user, toast, refreshCompanies } = useStore()
  const [tags, setTags] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [quick, setQuick] = useState([])
  const [form, setForm] = useState({})
  const [newTag, setNewTag] = useState({ name: '', color: '#2563eb' })
  const [newStage, setNewStage] = useState({ name: '', color: '#94a3b8' })
  const [newQuick, setNewQuick] = useState({ shortcut: '', body: '' })
  const [newCompany, setNewCompany] = useState(null)
  const [gads, setGads] = useState(null)
  const [gform, setGform] = useState({})
  const [spend, setSpend] = useState([])
  const [csv, setCsv] = useState('')
  const [syncing, setSyncing] = useState(false)

  const load = () => {
    if (!companyId) return
    api('/tags', { params: { company_id: companyId } }).then(setTags)
    api('/pipelines', { params: { company_id: companyId } }).then(setPipelines)
    api('/quick-replies', { params: { company_id: companyId } }).then(setQuick)
    api('/marketing/integrations/google-ads', { params: { company_id: companyId } }).then((g) => { setGads(g); setGform(g.config) }).catch(() => {})
    api('/marketing/ad-spend', { params: { company_id: companyId, days: 90 } }).then(setSpend).catch(() => {})
  }
  const saveGads = async () => { try { const r = await api('/marketing/integrations/google-ads', { method: 'PUT', body: { ...gform, company_id: companyId } }); toast(r.status === 'configured' ? 'Credenciales guardadas' : 'Guardado (faltan campos para sincronizar)', 'success'); load() } catch (e) { toast(e.message, 'error') } }
  const syncGads = async () => { setSyncing(true); try { const r = await api('/marketing/integrations/google-ads/sync', { method: 'POST', body: { company_id: companyId, days: 30 } }); toast(`Sincronizado: ${r.rows} filas`, 'success'); load() } catch (e) { toast(e.message, 'error'); load() } finally { setSyncing(false) } }
  const importCsv = async () => { try { const r = await api('/marketing/ad-spend/import', { method: 'POST', body: { company_id: companyId, csv } }); toast(`Importadas ${r.imported} filas`, 'success'); setCsv(''); load() } catch (e) { toast(e.message, 'error') } }
  const clearSpend = async () => { if (!confirm('¿Borrar toda la inversión registrada de esta empresa?')) return; await api('/marketing/ad-spend', { method: 'DELETE', params: { company_id: companyId } }); load() }
  useEffect(() => { load(); if (company) setForm(company) }, [companyId, company])

  const saveCompany = async () => { try { await api(`/companies/${companyId}`, { method: 'PATCH', body: form }); await refreshCompanies(); toast('Empresa guardada', 'success') } catch (e) { toast(e.message, 'error') } }
  const addTag = async () => { if (!newTag.name) return; await api('/tags', { method: 'POST', body: { ...newTag, company_id: companyId } }); setNewTag({ name: '', color: '#2563eb' }); load() }
  const addStage = async () => { if (!newStage.name) return; await api(`/pipelines/${pipelines[0].id}/stages`, { method: 'POST', body: newStage }); setNewStage({ name: '', color: '#94a3b8' }); load() }
  const addQuick = async () => { if (!newQuick.shortcut || !newQuick.body) return; await api('/quick-replies', { method: 'POST', body: { ...newQuick, company_id: companyId } }); setNewQuick({ shortcut: '', body: '' }); load() }
  const createCompany = async () => { try { await api('/companies', { method: 'POST', body: newCompany }); await refreshCompanies(); setNewCompany(null); toast('Empresa creada', 'success') } catch (e) { toast(e.message, 'error') } }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Configuración · {company?.name}</h1><div className="sub">Datos de la empresa, etapas del pipeline, etiquetas y respuestas rápidas.</div></div>
        <div className="actions">{user.role === 'admin' && <button className="btn" onClick={() => setNewCompany({ name: '', sector: '', color: '#0f766e', description: '' })}><Icon name="plus" size={15} /> Nueva empresa</button>}</div></div>
      <div className="grid-2">
        <div className="card"><div className="card-head"><h2>Empresa</h2><div className="actions"><button className="btn btn-sm btn-primary" onClick={saveCompany}>Guardar</button></div></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="grid-2">
              <div className="field"><label>Nombre</label><input className="input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label>Color</label><input className="input" type="color" value={form.color || '#2563eb'} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
              <div className="field"><label>Sector</label><input className="input" value={form.sector || ''} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></div>
              <div className="field"><label>Horario (HH:MM-HH:MM)</label><input className="input" value={form.business_hours || ''} onChange={(e) => setForm({ ...form, business_hours: e.target.value })} /></div>
            </div>
            <div className="field"><label>Descripción (la usa el agente IA)</label><textarea className="textarea" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div></div>
        <div className="card"><div className="card-head"><h2>Etapas del pipeline</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pipelines[0]?.stages.map((s) => (
              <div key={s.id} className="row"><input type="color" value={s.color} onChange={async (e) => { await api(`/stages/${s.id}`, { method: 'PATCH', body: { color: e.target.value } }); load() }} />
                <input className="input" style={{ flex: 1 }} defaultValue={s.name} onBlur={async (e) => { if (e.target.value !== s.name) { await api(`/stages/${s.id}`, { method: 'PATCH', body: { name: e.target.value } }); load() } }} />
                {s.is_won && <span className="chip" style={{ color: 'var(--success)' }}>Ganado</span>}{s.is_lost && <span className="chip" style={{ color: 'var(--danger)' }}>Perdido</span>}
                <button className="btn btn-sm btn-ghost btn-icon" onClick={async () => { if (confirm('¿Eliminar etapa?')) { await api(`/stages/${s.id}`, { method: 'DELETE' }); load() } }}><Icon name="x" size={14} /></button></div>))}
            <div className="row"><input type="color" value={newStage.color} onChange={(e) => setNewStage({ ...newStage, color: e.target.value })} /><input className="input" style={{ flex: 1 }} placeholder="Nueva etapa" value={newStage.name} onChange={(e) => setNewStage({ ...newStage, name: e.target.value })} /><button className="btn btn-sm btn-icon" onClick={addStage}><Icon name="plus" size={15} /></button></div>
          </div></div>
        <div className="card"><div className="card-head"><h2>Etiquetas</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row">{tags.map((t) => <span key={t.id} className="chip tag" style={{ background: t.color }}>{t.name}<span className="x" onClick={async () => { await api(`/tags/${t.id}`, { method: 'DELETE' }); load() }}><Icon name="x" size={11} strokeWidth={2.5} /></span></span>)}</div>
            <div className="row"><input type="color" value={newTag.color} onChange={(e) => setNewTag({ ...newTag, color: e.target.value })} /><input className="input" style={{ flex: 1 }} placeholder="Nueva etiqueta" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addTag()} /><button className="btn btn-sm btn-icon" onClick={addTag}><Icon name="plus" size={15} /></button></div>
          </div></div>
        <div className="card"><div className="card-head"><h2>Respuestas rápidas</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quick.map((q) => <div key={q.id} className="row"><span className="kbd">/{q.shortcut}</span><span style={{ flex: 1 }} className="small">{q.body}</span><button className="btn btn-sm btn-ghost btn-icon" onClick={async () => { await api(`/quick-replies/${q.id}`, { method: 'DELETE' }); load() }}><Icon name="x" size={14} /></button></div>)}
            <div className="row"><input className="input" style={{ width: 120 }} placeholder="atajo" value={newQuick.shortcut} onChange={(e) => setNewQuick({ ...newQuick, shortcut: e.target.value.replace(/\W/g, '').toLowerCase() })} /><input className="input" style={{ flex: 1 }} placeholder="Texto (variables: {{agente}}, {{nombre}}, {{empresa}}, {{telefono}})" value={newQuick.body} onChange={(e) => setNewQuick({ ...newQuick, body: e.target.value })} /><button className="btn btn-sm btn-icon" onClick={addQuick}><Icon name="plus" size={15} /></button></div>
          </div></div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Marketing: inversión en anuncios y Google Ads</h2>{gads && <span className={`chip ${gads.status === 'connected' ? '' : ''}`}><span className={`status-dot ${gads.status === 'connected' ? 'status-connected' : gads.status === 'error' ? 'status-qr' : 'status-disconnected'}`} /> {gads.status === 'connected' ? 'Conectado' : gads.status === 'configured' ? 'Configurado, sin sincronizar' : gads.status === 'error' ? 'Error' : 'Sin conectar'}</span>}</div>
        <div className="card-body grid-2">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3>Conexión con la API de Google Ads</h3>
            <p className="small text-2">Trae el costo por campaña y día automáticamente. Requiere una cuenta de desarrollador de Google Ads (token de desarrollador), un cliente OAuth y un refresh token. Si aún no los tienen, usen la importación manual de la derecha.</p>
            <div className="grid-2">
              <div className="field"><label>ID de cliente (Customer ID)</label><input className="input" placeholder="123-456-7890" value={gform.customer_id || ''} onChange={(e) => setGform({ ...gform, customer_id: e.target.value })} /></div>
              <div className="field"><label>ID de cuenta administrador (opcional)</label><input className="input" value={gform.login_customer_id || ''} onChange={(e) => setGform({ ...gform, login_customer_id: e.target.value })} /></div>
              <div className="field"><label>Developer token</label><input className="input" value={gform.developer_token || ''} onChange={(e) => setGform({ ...gform, developer_token: e.target.value })} /></div>
              <div className="field"><label>OAuth client ID</label><input className="input" value={gform.client_id || ''} onChange={(e) => setGform({ ...gform, client_id: e.target.value })} /></div>
              <div className="field"><label>OAuth client secret</label><input className="input" type="password" value={gform.client_secret || ''} onChange={(e) => setGform({ ...gform, client_secret: e.target.value })} /></div>
              <div className="field"><label>Refresh token</label><input className="input" type="password" value={gform.refresh_token || ''} onChange={(e) => setGform({ ...gform, refresh_token: e.target.value })} /></div>
            </div>
            {gads?.last_error && <div className="alert">{gads.last_error}</div>}
            <div className="row"><button className="btn btn-primary btn-sm" onClick={saveGads}>Guardar credenciales</button><button className="btn btn-sm" disabled={syncing || !gads || gads.status === 'disconnected'} onClick={syncGads}><Icon name="sync" size={14} /> {syncing ? 'Sincronizando…' : 'Sincronizar últimos 30 días'}</button>{gads?.last_sync_at && <span className="small muted">Última sincronización: {new Date(gads.last_sync_at).toLocaleString('es-CO')}</span>}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3>Importación manual de inversión</h3>
            <p className="small text-2">Pega filas con el formato <span className="kbd">fecha,origen,campaña,costo,clics,impresiones</span>. El nombre de la campaña debe coincidir con el código que usan en los enlaces (ej. BUSQUEDA-MARCA) para calcular el costo por lead.</p>
            <textarea className="textarea" style={{ minHeight: 110, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} placeholder={'fecha,origen,campaña,costo,clics,impresiones\n2026-10-01,google_ads,BUSQUEDA-MARCA,120000,40,2000\n2026-10-01,meta_ads,LEADS-SEPT,80000,65,9000'} value={csv} onChange={(e) => setCsv(e.target.value)} />
            <div className="row"><button className="btn btn-sm btn-primary" onClick={importCsv} disabled={!csv.trim()}><Icon name="download" size={14} /> Importar</button><span className="small muted">{spend.length} filas registradas (90 días)</span>{spend.length > 0 && user.role === 'admin' && <button className="btn btn-sm btn-ghost" onClick={clearSpend}>Borrar todo</button>}</div>
            {spend.length > 0 && <table className="table small"><thead><tr><th>Fecha</th><th>Origen</th><th>Campaña</th><th>Costo</th></tr></thead><tbody>{spend.slice(0, 8).map((r) => <tr key={r.id}><td>{String(r.date).slice(0, 10)}</td><td>{r.source}</td><td>{r.campaign}</td><td>{Number(r.cost).toLocaleString('es-CO')}</td></tr>)}</tbody></table>}
          </div>
        </div>
      </div>
      {newCompany && <Modal title="Nueva empresa" onClose={() => setNewCompany(null)} footer={<button className="btn btn-primary" onClick={createCompany}>Crear</button>}>
        <div className="field"><label>Nombre</label><input className="input" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} /></div>
        <div className="grid-2"><div className="field"><label>Sector</label><input className="input" value={newCompany.sector} onChange={(e) => setNewCompany({ ...newCompany, sector: e.target.value })} /></div>
          <div className="field"><label>Color</label><input className="input" type="color" value={newCompany.color} onChange={(e) => setNewCompany({ ...newCompany, color: e.target.value })} /></div></div>
        <div className="field"><label>Descripción</label><textarea className="textarea" value={newCompany.description} onChange={(e) => setNewCompany({ ...newCompany, description: e.target.value })} /></div>
        <p className="small text-2">Se crea con pipeline por defecto, agente IA y sin números de WhatsApp. Luego conecta el número en la sección WhatsApp.</p>
      </Modal>}
    </div>
  )
}
