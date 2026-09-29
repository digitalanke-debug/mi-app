import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Modal } from '../components/Layout.jsx'

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

  const load = () => {
    if (!companyId) return
    api('/tags', { params: { company_id: companyId } }).then(setTags)
    api('/pipelines', { params: { company_id: companyId } }).then(setPipelines)
    api('/quick-replies', { params: { company_id: companyId } }).then(setQuick)
  }
  useEffect(() => { load(); if (company) setForm(company) }, [companyId, company])

  const saveCompany = async () => { try { await api(`/companies/${companyId}`, { method: 'PATCH', body: form }); await refreshCompanies(); toast('Empresa guardada', 'success') } catch (e) { toast(e.message, 'error') } }
  const addTag = async () => { if (!newTag.name) return; await api('/tags', { method: 'POST', body: { ...newTag, company_id: companyId } }); setNewTag({ name: '', color: '#2563eb' }); load() }
  const addStage = async () => { if (!newStage.name) return; await api(`/pipelines/${pipelines[0].id}/stages`, { method: 'POST', body: newStage }); setNewStage({ name: '', color: '#94a3b8' }); load() }
  const addQuick = async () => { if (!newQuick.shortcut || !newQuick.body) return; await api('/quick-replies', { method: 'POST', body: { ...newQuick, company_id: companyId } }); setNewQuick({ shortcut: '', body: '' }); load() }
  const createCompany = async () => { try { await api('/companies', { method: 'POST', body: newCompany }); await refreshCompanies(); setNewCompany(null); toast('Empresa creada', 'success') } catch (e) { toast(e.message, 'error') } }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Configuración · {company?.name}</h1><div className="sub">Datos de la empresa, etapas del pipeline, etiquetas y respuestas rápidas.</div></div>
        <div className="actions">{user.role === 'admin' && <button className="btn" onClick={() => setNewCompany({ name: '', sector: '', color: '#2563eb', description: '' })}>+ Nueva empresa</button>}</div></div>
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
                <button className="btn btn-sm btn-ghost" onClick={async () => { if (confirm('¿Eliminar etapa?')) { await api(`/stages/${s.id}`, { method: 'DELETE' }); load() } }}>✕</button></div>))}
            <div className="row"><input type="color" value={newStage.color} onChange={(e) => setNewStage({ ...newStage, color: e.target.value })} /><input className="input" style={{ flex: 1 }} placeholder="Nueva etapa" value={newStage.name} onChange={(e) => setNewStage({ ...newStage, name: e.target.value })} /><button className="btn btn-sm" onClick={addStage}>+</button></div>
          </div></div>
        <div className="card"><div className="card-head"><h2>Etiquetas</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row">{tags.map((t) => <span key={t.id} className="chip tag" style={{ background: t.color }}>{t.name}<span className="x" onClick={async () => { await api(`/tags/${t.id}`, { method: 'DELETE' }); load() }}>✕</span></span>)}</div>
            <div className="row"><input type="color" value={newTag.color} onChange={(e) => setNewTag({ ...newTag, color: e.target.value })} /><input className="input" style={{ flex: 1 }} placeholder="Nueva etiqueta" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addTag()} /><button className="btn btn-sm" onClick={addTag}>+</button></div>
          </div></div>
        <div className="card"><div className="card-head"><h2>Respuestas rápidas</h2></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quick.map((q) => <div key={q.id} className="row"><span className="kbd">/{q.shortcut}</span><span style={{ flex: 1 }} className="small">{q.body}</span><button className="btn btn-sm btn-ghost" onClick={async () => { await api(`/quick-replies/${q.id}`, { method: 'DELETE' }); load() }}>✕</button></div>)}
            <div className="row"><input className="input" style={{ width: 120 }} placeholder="atajo" value={newQuick.shortcut} onChange={(e) => setNewQuick({ ...newQuick, shortcut: e.target.value.replace(/\W/g, '').toLowerCase() })} /><input className="input" style={{ flex: 1 }} placeholder="Texto ({{agente}} y {{nombre}} se reemplazan)" value={newQuick.body} onChange={(e) => setNewQuick({ ...newQuick, body: e.target.value })} /><button className="btn btn-sm" onClick={addQuick}>+</button></div>
          </div></div>
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
