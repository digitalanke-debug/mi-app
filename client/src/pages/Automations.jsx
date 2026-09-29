import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Modal } from '../components/Layout.jsx'

const TRIGGERS = {
  new_conversation: 'Llega un lead nuevo', message_in: 'Llega cualquier mensaje', keyword: 'El mensaje contiene palabras clave',
  outside_hours: 'Mensaje fuera de horario', inactivity: 'Lead sin respuesta por X minutos',
}
const ACTIONS = { reply: 'Responder mensaje', add_tag: 'Agregar etiqueta', move_stage: 'Mover a etapa', assign: 'Asignar asesor', notify: 'Notificar al equipo', ai_reply: 'Que responda el agente IA' }

export default function Automations() {
  const { companyId, toast } = useStore()
  const [list, setList] = useState([])
  const [meta, setMeta] = useState({ tags: [], stages: [], users: [] })
  const [edit, setEdit] = useState(null)

  const load = useCallback(() => companyId && api('/automations', { params: { company_id: companyId } }).then(setList), [companyId])
  useEffect(() => {
    load()
    if (!companyId) return
    Promise.all([api('/tags', { params: { company_id: companyId } }), api('/pipelines', { params: { company_id: companyId } }), api(`/companies/${companyId}/users`)])
      .then(([tags, p, users]) => setMeta({ tags, stages: p.flatMap((x) => x.stages), users }))
  }, [load, companyId])

  const toggle = async (a) => { await api(`/automations/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } }); load() }
  const remove = async (a) => { if (!confirm(`¿Eliminar "${a.name}"?`)) return; await api(`/automations/${a.id}`, { method: 'DELETE' }); load() }
  const save = async () => {
    try {
      const body = { ...edit, company_id: companyId }
      if (edit.id) await api(`/automations/${edit.id}`, { method: 'PATCH', body }); else await api('/automations', { method: 'POST', body })
      setEdit(null); load(); toast('Automatización guardada', 'success')
    } catch (e) { toast(e.message, 'error') }
  }
  const describeCond = (a) => {
    const c = a.conditions || {}
    const parts = []
    if (c.source) parts.push(`origen = ${c.source}`)
    if (c.keywords?.length) parts.push(`palabras: ${c.keywords.join(', ')}`)
    if (c.minutes) parts.push(`${c.minutes} min sin respuesta`)
    if (c.unassigned_only) parts.push('solo sin asignar')
    return parts.join(' · ')
  }
  const describeAction = (x) => x.type === 'reply' ? `Responder: "${(x.body || '').slice(0, 50)}…"` : x.type === 'add_tag' ? `Etiqueta "${x.tag_name}"` : x.type === 'move_stage' ? `Etapa "${x.stage_name}"`
    : x.type === 'assign' ? (x.mode === 'round_robin' ? 'Asignar round robin' : `Asignar a usuario ${x.user_id}`) : x.type === 'notify' ? `Notificar: ${x.body}` : ACTIONS[x.type]

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Automatizaciones y bots</h1><div className="sub">Reglas "cuando pasa X, haz Y". Se ejecutan en orden para cada mensaje que entra.</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => setEdit({ name: '', trigger: 'new_conversation', conditions: {}, actions: [{ type: 'reply', body: '' }], enabled: true })}>+ Nueva automatización</button></div>
      </div>
      <div className="card">
        {list.map((a) => (
          <div key={a.id} className="auto-item">
            <button className={`toggle ${a.enabled ? 'on' : ''}`} onClick={() => toggle(a)} />
            <div className="info">
              <b>{a.name}</b> <span className="muted small">· ejecutada {a.runs} veces</span>
              <div className="flow">
                <span className="chip">⚡ {TRIGGERS[a.trigger] || a.trigger}</span>
                {describeCond(a) && <span className="chip">si {describeCond(a)}</span>}
                <span className="arrow">→</span>
                {a.actions.map((x, i) => <span key={i} className="chip" style={{ background: 'var(--primary-soft)', color: 'var(--primary-2)', borderColor: '#bfd6f5' }}>{describeAction(x)}</span>)}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => setEdit({ ...a })}>Editar</button>
            <button className="btn btn-sm btn-danger" onClick={() => remove(a)}>Eliminar</button>
          </div>
        ))}
        {list.length === 0 && <div className="empty">Sin automatizaciones</div>}
      </div>

      {edit && <Modal title={edit.id ? 'Editar automatización' : 'Nueva automatización'} onClose={() => setEdit(null)} footer={<button className="btn btn-primary" onClick={save}>Guardar</button>}>
        <div className="field"><label>Nombre</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
        <div className="field"><label>Cuando…</label>
          <select className="select" value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value, conditions: {} })}>{Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        {edit.trigger === 'keyword' && <div className="field"><label>Palabras clave (separadas por coma)</label><input className="input" value={(edit.conditions.keywords || []).join(', ')} onChange={(e) => setEdit({ ...edit, conditions: { ...edit.conditions, keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} /></div>}
        {edit.trigger === 'inactivity' && <div className="field"><label>Minutos sin respuesta nuestra</label><input className="input" type="number" value={edit.conditions.minutes || 120} onChange={(e) => setEdit({ ...edit, conditions: { ...edit.conditions, minutes: Number(e.target.value) } })} /></div>}
        {['new_conversation', 'message_in'].includes(edit.trigger) && <div className="field"><label>Solo si el origen es</label>
          <select className="select" value={edit.conditions.source || ''} onChange={(e) => setEdit({ ...edit, conditions: { ...edit.conditions, source: e.target.value || undefined } })}>
            <option value="">Cualquiera</option><option value="google_ads">Google Ads</option><option value="meta_ads">Meta Ads</option><option value="web">Web</option><option value="referido">Referido</option><option value="organico">Orgánico</option></select></div>}
        <div className="field"><label>Entonces…</label>
          {edit.actions.map((x, i) => (
            <div key={i} className="action-row">
              <select className="select" value={x.type} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { type: e.target.value } : y)) })}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <div>
                {x.type === 'reply' && <textarea className="textarea" style={{ minHeight: 60 }} placeholder="Texto del mensaje" value={x.body || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)) })} />}
                {x.type === 'notify' && <input className="input" placeholder="Texto de la notificación" value={x.body || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)) })} />}
                {x.type === 'add_tag' && <select className="select" value={x.tag_name || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, tag_name: e.target.value } : y)) })}><option value="">Elegir etiqueta</option>{meta.tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select>}
                {x.type === 'move_stage' && <select className="select" value={x.stage_name || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, stage_name: e.target.value } : y)) })}><option value="">Elegir etapa</option>{meta.stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>}
                {x.type === 'assign' && <select className="select" value={x.mode === 'round_robin' ? 'rr' : x.user_id || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? (e.target.value === 'rr' ? { type: 'assign', mode: 'round_robin' } : { type: 'assign', user_id: Number(e.target.value) }) : y)) })}><option value="rr">Round robin (el que tenga menos carga)</option>{meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
                {x.type === 'ai_reply' && <div className="small text-2">Usa la configuración del Agente IA de esta empresa.</div>}
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ ...edit, actions: edit.actions.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit({ ...edit, actions: [...edit.actions, { type: 'add_tag' }] })}>+ Acción</button>
        </div>
      </Modal>}
    </div>
  )
}
