import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Modal } from '../components/Layout.jsx'
import { Icon } from '../components/Icons.jsx'

const TRIGGERS = {
  new_conversation: 'Llega un lead nuevo', message_in: 'Llega cualquier mensaje', keyword: 'El mensaje contiene palabras clave',
  outside_hours: 'Mensaje fuera de horario', inactivity: 'Lead sin respuesta por X minutos',
}
const ACTIONS = { menu: 'Enviar menú de opciones', reply: 'Responder mensaje', add_tag: 'Agregar etiqueta', move_stage: 'Mover a etapa', assign: 'Asignar asesor', notify: 'Notificar al equipo', ai_reply: 'Que responda el agente IA' }

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
  const describeAction = (x) => x.type === 'menu' ? `Menú: ${(x.options || []).map((o, i) => `${i + 1}. ${o.label}`).join(' · ').slice(0, 90)}…` : x.type === 'reply' ? `Responder: "${(x.body || '').slice(0, 50)}…"` : x.type === 'add_tag' ? `Etiqueta "${x.tag_name}"` : x.type === 'move_stage' ? `Etapa "${x.stage_name}"`
    : x.type === 'assign' ? (x.mode === 'round_robin' ? 'Asignar round robin' : `Asignar a usuario ${x.user_id}`) : x.type === 'notify' ? `Notificar: ${x.body}` : ACTIONS[x.type]

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Automatizaciones y bots</h1><div className="sub">Reglas "cuando pasa X, haz Y". Se ejecutan en orden para cada mensaje que entra.</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => setEdit({ name: '', trigger: 'new_conversation', conditions: {}, actions: [{ type: 'reply', body: '' }], enabled: true })}><Icon name="plus" size={15} /> Nueva automatización</button></div>
      </div>
      <div className="card">
        {list.map((a) => (
          <div key={a.id} className="auto-item">
            <button className={`toggle ${a.enabled ? 'on' : ''}`} onClick={() => toggle(a)} />
            <div className="info">
              <b>{a.name}</b> <span className="muted small">· ejecutada {a.runs} veces</span>
              <div className="flow">
                <span className="chip"><Icon name="zap" size={12} /> {TRIGGERS[a.trigger] || a.trigger}</span>
                {describeCond(a) && <span className="chip">si {describeCond(a)}</span>}
                <span className="arrow"><Icon name="arrow" size={14} /></span>
                {a.actions.map((x, i) => <span key={i} className="chip action">{describeAction(x)}</span>)}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => setEdit({ ...a })}><Icon name="edit" size={13} /> Editar</button>
            <button className="btn btn-sm btn-danger btn-icon" title="Eliminar" onClick={() => remove(a)}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {list.length === 0 && <div className="empty">Sin automatizaciones</div>}
      </div>

      {edit && <Modal wide={edit.actions.some((x) => x.type === 'menu')} title={edit.id ? 'Editar automatización' : 'Nueva automatización'} onClose={() => setEdit(null)} footer={<button className="btn btn-primary" onClick={save}>Guardar</button>}>
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
              <select className="select" value={x.type} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? (e.target.value === 'menu' ? { type: 'menu', intro: '', retry: '', options: [{ ...NEW_OPTION }, { ...NEW_OPTION, label: 'Hablar con un asesor', notify: true }] } : { type: e.target.value }) : y)) })}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <div>
                {x.type === 'reply' && <textarea className="textarea" style={{ minHeight: 60 }} placeholder="Texto del mensaje. Puede usar {{cuando}} y {{horario}}" value={x.body || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)) })} />}
                {x.type === 'notify' && <input className="input" placeholder="Texto de la notificación" value={x.body || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)) })} />}
                {x.type === 'add_tag' && <select className="select" value={x.tag_name || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, tag_name: e.target.value } : y)) })}><option value="">Elegir etiqueta</option>{meta.tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select>}
                {x.type === 'move_stage' && <select className="select" value={x.stage_name || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? { ...y, stage_name: e.target.value } : y)) })}><option value="">Elegir etapa</option>{meta.stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>}
                {x.type === 'assign' && <select className="select" value={x.mode === 'round_robin' ? 'rr' : x.user_id || ''} onChange={(e) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? (e.target.value === 'rr' ? { type: 'assign', mode: 'round_robin' } : { type: 'assign', user_id: Number(e.target.value) }) : y)) })}><option value="rr">Round robin (el que tenga menos carga)</option>{meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
                {x.type === 'menu' && <MenuEditor value={x} tags={meta.tags} stages={meta.stages} onChange={(v) => setEdit({ ...edit, actions: edit.actions.map((y, j) => (j === i ? v : y)) })} />}
                {x.type === 'ai_reply' && <div className="small text-2">Usa la configuración del Agente IA de esta empresa.</div>}
              </div>
              <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEdit({ ...edit, actions: edit.actions.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit({ ...edit, actions: [...edit.actions, { type: 'add_tag' }] })}>+ Acción</button>
        </div>
      </Modal>}
    </div>
  )
}

const NEW_OPTION = { label: '', reply: '', service: '', tag: '', stage: '', keywords: '', notify: false }

/** Editor del menú de bienvenida: mensaje, opciones numeradas y respuesta de cada una */
function MenuEditor({ value, onChange, tags, stages }) {
  const v = { intro: '', retry: '', options: [], ...value }
  const setOpt = (i, p) => onChange({ ...v, options: v.options.map((o, j) => (j === i ? { ...o, ...p } : o)) })
  const preview = [v.intro.trim(), v.options.map((o, i) => `${i + 1}. ${o.label || '…'}`).join('\n')].filter(Boolean).join('\n\n')
  return (
    <div className="menu-editor">
      <div className="field"><label>Mensaje de bienvenida (va antes de las opciones)</label>
        <textarea className="textarea" style={{ minHeight: 70 }} value={v.intro} onChange={(e) => onChange({ ...v, intro: e.target.value })} placeholder="¡Hola! Bienvenido(a)… Responda con el número de la opción:" /></div>
      {v.options.map((o, i) => (
        <div key={i} className="menu-opt">
          <div className="row"><b>Opción {i + 1}</b><button className="btn btn-sm btn-ghost btn-icon" style={{ marginLeft: 'auto' }} title="Quitar opción" onClick={() => onChange({ ...v, options: v.options.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button></div>
          <input className="input" placeholder="Texto de la opción, ej. Traslado de régimen" value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} />
          <textarea className="textarea" style={{ minHeight: 70 }} placeholder="Respuesta cuando elige esta opción (preguntas para perfilar el caso)" value={o.reply} onChange={(e) => setOpt(i, { reply: e.target.value })} />
          <div className="grid-3">
            <div className="field"><label>Servicio que se guarda</label><input className="input" value={o.service || ''} onChange={(e) => setOpt(i, { service: e.target.value })} /></div>
            <div className="field"><label>Etiqueta</label><select className="select" value={o.tag || ''} onChange={(e) => setOpt(i, { tag: e.target.value })}><option value="">Ninguna</option>{tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div>
            <div className="field"><label>Mover a etapa</label><select className="select" value={o.stage || ''} onChange={(e) => setOpt(i, { stage: e.target.value })}><option value="">No mover</option>{stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select></div>
          </div>
          <div className="field"><label>Palabras que también eligen esta opción (separadas por coma)</label><input className="input" placeholder="traslado, colpensiones, porvenir" value={o.keywords || ''} onChange={(e) => setOpt(i, { keywords: e.target.value })} /></div>
          <label className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!o.notify} onChange={(e) => setOpt(i, { notify: e.target.checked })} /> Avisar al equipo cuando eligen esta opción</label>
        </div>
      ))}
      {v.options.length < 9 && <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...v, options: [...v.options, { ...NEW_OPTION }] })}>+ Opción</button>}
      <div className="field"><label>Línea que se agrega fuera de horario</label>
        <input className="input" value={v.after_hours || ''} onChange={(e) => onChange({ ...v, after_hours: e.target.value })} placeholder="🌙 En este momento estamos fuera de horario, pero puede elegir una opción y dejarnos su consulta: un asesor le escribe {{cuando}}." /></div>
      <div className="field"><label>Si responde otra cosa (se envía una sola vez; después lo atiende el asesor)</label>
        <input className="input" value={v.retry} onChange={(e) => onChange({ ...v, retry: e.target.value })} placeholder={`Para ubicar su caso, responda solo con el número de la opción (1 a ${v.options.length || 1}).`} /></div>
      <div className="field"><label>Así lo verá el cliente</label><div className="menu-preview">{preview || '—'}</div></div>
      <div className="small text-2">Variables: <span className="kbd">{'{{cuando}}'}</span> se cambia por "en breve", "mañana a primera hora" o "el lunes a primera hora" según el horario de la empresa; <span className="kbd">{'{{horario}}'}</span> por el horario de atención.</div>
    </div>
  )
}
