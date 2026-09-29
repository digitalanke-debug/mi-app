import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRealtime, useStore } from '../store.jsx'
import { api, ago, fmtDate, fmtDateTime, fmtTime, initials, SOURCE_LABEL } from '../api.js'

const FILTERS = [['open', 'Abiertas'], ['mine', 'Mías'], ['unassigned', 'Sin asignar'], ['pending', 'Pendientes'], ['closed', 'Cerradas'], ['all', 'Todas']]

export default function Inbox() {
  const { companyId, user, toast } = useStore()
  const { id } = useParams()
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [filter, setFilter] = useState('open')
  const [q, setQ] = useState('')
  const [meta, setMeta] = useState({ tags: [], stages: [], users: [], quick: [] })
  const selectedId = id ? Number(id) : null

  const params = useMemo(() => {
    const p = { company_id: companyId, q }
    if (filter === 'mine') { p.status = 'open'; p.mine = '1' }
    else if (filter === 'unassigned') { p.status = 'open'; p.assigned = 'none' }
    else p.status = filter
    return p
  }, [companyId, filter, q])

  const load = useCallback(() => companyId && api('/conversations', { params }).then(setList).catch((e) => toast(e.message, 'error')), [companyId, params, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!companyId) return
    Promise.all([
      api('/tags', { params: { company_id: companyId } }), api('/pipelines', { params: { company_id: companyId } }),
      api(`/companies/${companyId}/users`), api('/quick-replies', { params: { company_id: companyId } }),
    ]).then(([tags, pipes, users, quick]) => setMeta({ tags, stages: pipes.flatMap((p) => p.stages), users, quick })).catch(() => {})
  }, [companyId])

  useRealtime('conversation:update', (c) => {
    if (c.company_id !== companyId) return
    setList((cur) => {
      const matches = filter === 'all' || (filter === 'mine' ? c.status === 'open' && c.assigned_user_id === user.id : filter === 'unassigned' ? c.status === 'open' && !c.assigned_user_id : c.status === filter)
      const without = cur.filter((x) => x.id !== c.id)
      if (!matches) return without
      return [c, ...without].sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''))
    })
  })

  return (
    <div className="inbox">
      <div className="inbox-list">
        <div className="head">
          <input className="input" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="filters">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        </div>
        <div className="items">
          {list.length === 0 && <div className="empty">Sin conversaciones</div>}
          {list.map((c) => (
            <div key={c.id} className={`conv-item ${c.id === selectedId ? 'active' : ''}`} onClick={() => nav(`/bandeja/${c.id}`)}>
              <div className="avatar">{initials(c.contact_name)}</div>
              <div className="body">
                <div className="top"><span className="name">{c.contact_name || c.contact_phone}</span><span className="time">{ago(c.last_message_at)}</span></div>
                <div className="preview">{c.last_message ? `${c.last_message.direction === 'out' ? (c.last_message.sender_type === 'bot' ? '🤖 ' : '↩ ') : ''}${c.last_message.body}` : '—'}</div>
                <div className="meta">
                  {c.stage_name && <span className="chip"><span className="dot" style={{ background: c.stage_color }} />{c.stage_name}</span>}
                  {c.tags.slice(0, 2).map((t) => <span key={t.id} className="chip tag" style={{ background: t.color }}>{t.name}</span>)}
                  {c.assigned_name ? <span className="chip">{initials(c.assigned_name)}</span> : <span className="chip" style={{ color: 'var(--warn)' }}>Sin asignar</span>}
                  {c.unread_count > 0 && <span className="unread" style={{ marginLeft: 'auto' }}>{c.unread_count}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {selectedId ? <Chat key={selectedId} id={selectedId} meta={meta} onChanged={load} /> : <div className="chat"><div className="empty" style={{ margin: 'auto' }}>Selecciona una conversación</div></div>}
    </div>
  )
}

function Chat({ id, meta, onChanged }) {
  const { user, toast } = useStore()
  const [data, setData] = useState(null)
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(null)
  const [showQuick, setShowQuick] = useState(false)
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  const load = useCallback(() => api(`/conversations/${id}`).then((d) => { setData(d); api(`/conversations/${id}/read`, { method: 'POST' }).catch(() => {}) }).catch((e) => toast(e.message, 'error')), [id, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [data?.messages?.length])

  useRealtime('message:new', (m) => { if (m.conversation_id === id) setData((d) => d && !d.messages.find((x) => x.id === m.id) ? { ...d, messages: [...d.messages, m] } : d) })
  useRealtime('conversation:update', (c) => { if (c.id === id) setData((d) => d ? { ...d, conversation: c } : d) })
  useRealtime('typing', (t) => { if (t.conversationId === id && t.user !== user.name) { setTyping(t.user); setTimeout(() => setTyping(null), 2500) } })

  const send = async () => {
    const body = text.trim(); if (!body) return
    setText(''); setShowQuick(false)
    try { await api(`/conversations/${id}/messages`, { method: 'POST', body: { body } }); await load() } catch (e) { toast(e.message, 'error') }
  }
  const patch = async (p) => { try { const c = await api(`/conversations/${id}`, { method: 'PATCH', body: p }); setData((d) => ({ ...d, conversation: c })); onChanged() } catch (e) { toast(e.message, 'error') } }
  const aiReply = async () => { setBusy(true); try { const r = await api(`/conversations/${id}/ai-reply`, { method: 'POST' }); if (r.skipped) toast('El agente no respondió (deshabilitado o límite de turnos)', 'warn'); await load() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }
  const simulate = async () => { try { await api(`/whatsapp/demo/reply/${id}`, { method: 'POST' }) } catch (e) { toast(e.message, 'error') } }
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === '/' && text === '') setShowQuick(true)
    if (e.key === 'Escape') setShowQuick(false)
  }
  const applyQuick = (qr) => { setText(qr.body.replace('{{agente}}', user.name.split(' ')[0]).replace('{{nombre}}', (data?.contact?.name || '').split(' ')[0])); setShowQuick(false) }

  if (!data) return <div className="chat"><div className="empty" style={{ margin: 'auto' }}>Cargando…</div></div>
  const { conversation: c, contact, messages } = data
  const quickMatches = meta.quick.filter((q) => text === '' || text === '/' || q.shortcut.includes(text.replace('/', '')))

  let lastDay = ''
  return (
    <>
      <div className="chat">
        <div className="chat-head">
          <div className="avatar">{initials(contact.name)}</div>
          <div><div className="title">{contact.name || contact.phone}</div><div className="sub">+{contact.phone} · {SOURCE_LABEL[contact.source] || contact.source}{contact.campaign ? ` · ${contact.campaign}` : ''} · {c.instance_name}</div></div>
          <div className="actions" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <select className="select" style={{ width: 'auto' }} value={c.status} onChange={(e) => patch({ status: e.target.value })}>
              <option value="open">Abierta</option><option value="pending">Pendiente</option><option value="closed">Cerrada</option>
            </select>
          </div>
        </div>
        <div className="chat-msgs">
          {messages.map((m) => {
            const day = fmtDate(m.created_at)
            const sep = day !== lastDay; lastDay = day
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {sep && <div className="day-sep">{day}</div>}
                <div className={`msg ${m.direction} ${m.sender_type}`}>
                  {m.direction === 'out' && m.sender_type !== 'system' && <div className="who">{m.sender_type === 'bot' ? '🤖 Agente IA' : m.sender_name || 'Asesor'}</div>}
                  {m.body}
                  <div className="t">{fmtTime(m.created_at)} {m.direction === 'out' && (m.status === 'failed' ? <span className="fail" title="No se pudo enviar: instancia desconectada">✗ no enviado</span> : '✓✓')}</div>
                </div>
              </div>
            )
          })}
          {typing && <div className="typing">{typing} está escribiendo…</div>}
          <div ref={endRef} />
        </div>
        <div className="chat-compose">
          <div className="box" style={{ position: 'relative' }}>
            {showQuick && quickMatches.length > 0 && <div className="quick-menu">{quickMatches.map((q) => <div key={q.id} onClick={() => applyQuick(q)}><b>/{q.shortcut}</b>{q.body.slice(0, 80)}</div>)}</div>}
            <textarea className="textarea" placeholder="Escribe un mensaje… (Enter envía, / respuestas rápidas)" value={text}
              onChange={(e) => { setText(e.target.value); if (e.target.value.startsWith('/')) setShowQuick(true); else setShowQuick(false); api(`/conversations/${id}/typing`, { method: 'POST' }).catch(() => {}) }} onKeyDown={onKey} />
            <button className="btn btn-wa" onClick={send} disabled={!text.trim()}>Enviar ➤</button>
          </div>
          <div className="tools">
            <button className="btn btn-sm" onClick={() => setShowQuick((s) => !s)}>⚡ Rápidas</button>
            <button className="btn btn-sm" onClick={aiReply} disabled={busy}>🤖 {busy ? 'Pensando…' : 'Que responda la IA'}</button>
            <label className="row small" style={{ gap: 6 }}><button className={`toggle ${c.ai_enabled ? 'on' : ''}`} onClick={() => patch({ ai_enabled: !c.ai_enabled })} /> IA automática en este chat</label>
            {c.instance_name?.startsWith('WhatsApp') && <button className="btn btn-sm btn-ghost muted" onClick={simulate} title="Solo demo: simula que el cliente escribe">🧪 Simular respuesta del cliente</button>}
          </div>
        </div>
      </div>
      <SidePanel data={data} meta={meta} patch={patch} reload={load} />
    </>
  )
}

function SidePanel({ data, meta, patch, reload }) {
  const { toast } = useStore()
  const { conversation: c, contact, notes, tasks, activity } = data
  const [note, setNote] = useState('')
  const [task, setTask] = useState('')
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t) }, [])

  const openMin = c.opened_at ? (Date.now() - new Date(c.opened_at)) / 60000 : 0
  const waitingMin = c.last_inbound_at && (!c.last_outbound_at || c.last_outbound_at < c.last_inbound_at) ? (Date.now() - new Date(c.last_inbound_at)) / 60000 : 0
  const stageMin = c.stage_entered_at ? (Date.now() - new Date(c.stage_entered_at)) / 60000 : 0
  const frt = c.first_response_at && c.opened_at ? (new Date(c.first_response_at) - new Date(c.opened_at)) / 60000 : null
  const dur = (m) => m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`

  const addTag = async (tagId) => { if (!tagId) return; try { await api(`/conversations/${c.id}/tags/${tagId}`, { method: 'POST' }); reload() } catch (e) { toast(e.message, 'error') } }
  const rmTag = async (tagId) => { await api(`/conversations/${c.id}/tags/${tagId}`, { method: 'DELETE' }); reload() }
  const addNote = async () => { if (!note.trim()) return; await api(`/conversations/${c.id}/notes`, { method: 'POST', body: { body: note } }); setNote(''); reload() }
  const addTask = async () => { if (!task.trim()) return; await api(`/conversations/${c.id}/tasks`, { method: 'POST', body: { title: task, due_at: new Date(Date.now() + 86400000).toISOString() } }); setTask(''); reload() }
  const toggleTask = async (t) => { await api(`/conversations/tasks/${t.id}`, { method: 'PATCH', body: { done: !t.done } }); reload() }
  const saveContact = async (p) => { await api(`/contacts/${contact.id}`, { method: 'PATCH', body: { ...contact, ...p } }); reload() }

  return (
    <aside className="side">
      <div className="contact-top">
        <div className="avatar">{initials(contact.name)}</div>
        <input className="input" style={{ textAlign: 'center', fontWeight: 600 }} defaultValue={contact.name || ''} onBlur={(e) => e.target.value !== contact.name && saveContact({ name: e.target.value })} />
        <div className="small text-2">+{contact.phone}{contact.city ? ` · ${contact.city}` : ''}</div>
        <div className="row" style={{ justifyContent: 'center' }}><span className="chip">{SOURCE_LABEL[contact.source] || contact.source}</span>{contact.campaign && <span className="chip">{contact.campaign}</span>}</div>
      </div>
      <div className="sec">
        <h3>Tiempos</h3>
        <div className="timers">
          <div className={`timer ${waitingMin > 60 ? 'bad' : ''}`}><div className="v">{dur(waitingMin)}</div><div className="k">Esperando respuesta</div></div>
          <div className="timer"><div className="v">{dur(openMin)}</div><div className="k">Abierta hace</div></div>
          <div className="timer"><div className="v">{dur(frt)}</div><div className="k">Primera respuesta</div></div>
          <div className="timer"><div className="v">{dur(stageMin)}</div><div className="k">En esta etapa</div></div>
        </div>
      </div>
      <div className="sec">
        <h3>Gestión</h3>
        <div className="field"><label>Asignado a</label>
          <select className="select" value={c.assigned_user_id || ''} onChange={(e) => patch({ assigned_user_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin asignar</option>{meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></div>
        <div className="field"><label>Etapa</label>
          <select className="select" value={c.stage_id || ''} onChange={(e) => patch({ stage_id: Number(e.target.value) })}>
            {meta.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div className="grid-2">
          <div className="field"><label>Servicio</label><input className="input" defaultValue={c.service || ''} onBlur={(e) => e.target.value !== (c.service || '') && patch({ service: e.target.value })} /></div>
          <div className="field"><label>Valor (COP)</label><input className="input" type="number" defaultValue={c.value || 0} onBlur={(e) => Number(e.target.value) !== Number(c.value) && patch({ value: e.target.value })} /></div>
        </div>
      </div>
      <div className="sec">
        <h3>Etiquetas</h3>
        <div className="row">{c.tags.map((t) => <span key={t.id} className="chip tag" style={{ background: t.color }}>{t.name}<span className="x" onClick={() => rmTag(t.id)}>✕</span></span>)}</div>
        <select className="select" value="" onChange={(e) => addTag(Number(e.target.value))}>
          <option value="">+ Agregar etiqueta</option>{meta.tags.filter((t) => !c.tags.find((x) => x.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="sec">
        <h3>Notas internas</h3>
        {notes.map((n) => <div key={n.id} className="note">{n.body}<div className="by">{n.user_name || 'Sistema'} · {fmtDateTime(n.created_at)}</div></div>)}
        <div className="row"><input className="input" placeholder="Nueva nota…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} /><button className="btn btn-sm" onClick={addNote}>+</button></div>
      </div>
      <div className="sec">
        <h3>Tareas y recordatorios</h3>
        {tasks.map((t) => <div key={t.id} className={`task ${t.done ? 'done' : ''}`}><input type="checkbox" checked={!!t.done} onChange={() => toggleTask(t)} /><div>{t.title}<div className="small muted">{fmtDateTime(t.due_at)}</div></div></div>)}
        <div className="row"><input className="input" placeholder="Nueva tarea (vence mañana)…" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} /><button className="btn btn-sm" onClick={addTask}>+</button></div>
      </div>
      <div className="sec">
        <h3>Actividad</h3>
        <div className="activity">{activity.slice(0, 12).map((a) => <div key={a.id}>• <b>{a.type}</b> {a.user_name ? `por ${a.user_name}` : ''} <span className="muted">{ago(a.created_at)}</span></div>)}</div>
      </div>
    </aside>
  )
}
