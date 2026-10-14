import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRealtime, useStore } from '../store.jsx'
import { api, fmtDateTime, phoneLabel } from '../api.js'
import { Modal } from '../components/Layout.jsx'
import { Icon } from '../components/Icons.jsx'

const STATUS = { draft: ['Borrador', 'status-disconnected'], sending: ['Enviando', 'status-qr'], paused: ['En pausa', 'status-disconnected'], done: ['Terminada', 'status-connected'], cancelled: ['Cancelada', 'status-disconnected'] }
const PACES = { safe: ['Seguro (30–60 s entre mensajes)', 30, 60], normal: ['Normal (20–45 s)', 20, 45], fast: ['Rápido (10–20 s, más riesgo)', 10, 20] }
const eta = (n, min, max) => { const m = Math.round((n * (min + max)) / 2 / 60); return m < 1 ? 'menos de 1 minuto' : m < 60 ? `${m} min aprox.` : `${(m / 60).toFixed(1)} h aprox.` }

export default function Broadcasts() {
  const { companyId, company, toast } = useStore()
  const [list, setList] = useState([])
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState(null)
  const load = useCallback(() => companyId && api('/broadcasts', { params: { company_id: companyId } }).then(setList).catch((e) => toast(e.message, 'error')), [companyId, toast])
  useEffect(() => { load() }, [load])
  useRealtime('broadcast:update', (b) => {
    if (b.company_id !== companyId) return
    setList((cur) => (cur.some((x) => x.id === b.id) ? cur.map((x) => (x.id === b.id ? b : x)) : [b, ...cur]))
    setDetail((d) => (d && d.id === b.id ? { ...d, ...b } : d))
  })
  const act = async (b, action) => {
    if (action === 'cancel' && !confirm(`¿Cancelar "${b.name}"? Los mensajes pendientes no se enviarán.`)) return
    try { const r = await api(`/broadcasts/${b.id}/${action}`, { method: 'POST' }); if (action === 'retry-failed') toast(`${r.requeued} destinatarios vuelven a la cola`, 'success') } catch (e) { toast(e.message, 'error') }
  }
  const openDetail = async (b) => { try { setDetail(await api(`/broadcasts/${b.id}`)) } catch (e) { toast(e.message, 'error') } }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Difusiones · {company?.name}</h1><div className="sub">Envía un mismo mensaje (con su nombre) a una lista de contactos. Se envía uno por uno, con pausas, para proteger el número.</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="send" size={15} /> Nueva difusión</button></div>
      </div>
      <div className="card">
        {list.length === 0 && <div className="empty">Aún no hay difusiones en esta empresa.</div>}
        {list.map((b) => {
          const done = b.sent + b.failed, pct = b.total ? Math.round((done / b.total) * 100) : 0
          return (
            <div key={b.id} className="auto-item">
              <div className="ico-box" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--primary-soft)', color: 'var(--primary-2)', display: 'grid', placeItems: 'center' }}><Icon name="send" size={18} /></div>
              <div className="info" style={{ cursor: 'pointer' }} onClick={() => openDetail(b)}>
                <b>{b.name}</b> <span className="chip"><span className={`status-dot ${STATUS[b.status]?.[1]}`} /> {STATUS[b.status]?.[0] || b.status}</span>
                <div className="small text-2" style={{ marginTop: 3 }}>{b.instance_name || 'Número eliminado'} · {b.created_by_name || ''} · {fmtDateTime(b.created_at)}</div>
                <div className="bar-row" style={{ gridTemplateColumns: '1fr auto', marginTop: 6 }}>
                  <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
                  <div className="small text-2">{b.sent} enviados · {b.failed} fallidos · {b.pending} pendientes de {b.total}</div>
                </div>
                {b.status === 'sending' && b.pending > 0 && <div className="small muted">Termina en {eta(b.pending, b.delay_min, b.delay_max)}</div>}
                {b.last_error && <div className="small" style={{ color: 'var(--danger)' }}>{b.last_error}</div>}
              </div>
              <div className="row">
                {b.status === 'sending' && <button className="btn btn-sm" onClick={() => act(b, 'pause')}>Pausar</button>}
                {['paused', 'draft'].includes(b.status) && <button className="btn btn-sm btn-primary" onClick={() => act(b, 'resume')}>{b.status === 'draft' ? 'Enviar' : 'Reanudar'}</button>}
                {b.failed > 0 && ['done', 'paused'].includes(b.status) && <button className="btn btn-sm" onClick={() => act(b, 'retry-failed')}><Icon name="refresh" size={13} /> Reintentar fallidos</button>}
                {['sending', 'paused', 'draft'].includes(b.status) && <button className="btn btn-sm btn-danger" onClick={() => act(b, 'cancel')}>Cancelar</button>}
              </div>
            </div>
          )
        })}
      </div>
      {creating && <NewBroadcast onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />}
      {detail && <Detail b={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function NewBroadcast({ onClose, onCreated }) {
  const { companyId, company, toast } = useStore()
  const [instances, setInstances] = useState([])
  const [tags, setTags] = useState([])
  const [stages, setStages] = useState([])
  const [f, setF] = useState({ name: '', instance_id: '', mode: 'paste', numbers: '', tag_id: '', stage_id: '', body: '¡Hola {{nombre}}! ', pace: 'normal' })
  const [media, setMedia] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('/whatsapp/instances', { params: { company_id: companyId } }).then((l) => { setInstances(l); const c = l.find((i) => i.status === 'connected'); if (c) setF((x) => ({ ...x, instance_id: c.id })) })
    api('/tags', { params: { company_id: companyId } }).then(setTags)
    api('/pipelines', { params: { company_id: companyId } }).then((p) => setStages(p.flatMap((x) => x.stages)))
  }, [companyId])
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); if (['mode', 'numbers', 'tag_id', 'stage_id'].includes(k)) setPreview(null) }
  const criteria = () => ({ company_id: companyId, mode: f.mode, numbers: f.numbers, tag_id: f.tag_id, stage_id: f.stage_id, body: f.body })
  const doPreview = async () => { try { setPreview(await api('/broadcasts/preview', { method: 'POST', body: criteria() })) } catch (e) { toast(e.message, 'error') } }
  const pickFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 16 * 1024 * 1024) return toast('Máximo 16 MB', 'error')
    const r = new FileReader(); r.onload = () => setMedia({ base64: String(r.result).split(',')[1], mime: file.type || 'application/octet-stream', name: file.name, preview: file.type.startsWith('image/') ? r.result : null }); r.readAsDataURL(file)
  }
  const [, min, max] = PACES[f.pace]
  const send = async () => {
    if (!preview) return doPreview()
    if (!confirm(`Se enviará a ${preview.total} contactos desde ${instances.find((i) => i.id === Number(f.instance_id))?.name}. Tiempo estimado: ${eta(preview.total, min, max)}. ¿Continuar?`)) return
    setBusy(true)
    try { const r = await api('/broadcasts', { method: 'POST', body: { ...criteria(), name: f.name, instance_id: f.instance_id, media: media && { base64: media.base64, mime: media.mime, name: media.name }, delay_min: min, delay_max: max, start: true } }); toast(`Difusión iniciada: ${r.total} destinatarios`, 'success'); onCreated() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const connected = instances.filter((i) => i.status === 'connected')
  return (
    <Modal title="Nueva difusión" onClose={onClose} footer={<>
      <button className="btn" onClick={doPreview}>Vista previa</button>
      <button className="btn btn-primary" disabled={busy || !f.name.trim() || !f.instance_id || (!f.body.trim() && !media)} onClick={send}><Icon name="send" size={14} /> {busy ? 'Creando…' : preview ? `Enviar a ${preview.total} contactos` : 'Revisar y enviar'}</button></>}>
      {connected.length === 0 && <div className="alert">{company?.name} no tiene un número de WhatsApp conectado. Conéctalo primero en la sección WhatsApp.</div>}
      <div className="grid-2">
        <div className="field"><label>Nombre de la difusión</label><input className="input" placeholder="Ej. Recordatorio evento DDI" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>Enviar desde</label><select className="select" value={f.instance_id} onChange={(e) => set('instance_id', e.target.value)}><option value="">Elegir número</option>{instances.map((i) => <option key={i.id} value={i.id} disabled={i.status !== 'connected'}>{i.name}{i.status !== 'connected' ? ' (desconectado)' : ''}</option>)}</select></div>
      </div>
      <div className="field"><label>Destinatarios</label>
        <div className="filters">{[['paste', 'Pegar lista de números'], ['tag', 'Por etiqueta'], ['stage', 'Por etapa'], ['all', 'Todos los contactos']].map(([k, l]) => <button key={k} className={f.mode === k ? 'active' : ''} onClick={() => set('mode', k)}>{l}</button>)}</div>
      </div>
      {f.mode === 'paste' && <div className="field"><textarea className="textarea" style={{ minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} placeholder={'Un contacto por línea. Ejemplos:\n3001234567\nMaría López, 3109876543\n+57 315 555 1234; Juan Pérez'} value={f.numbers} onChange={(e) => set('numbers', e.target.value)} />
        <div className="small muted">Puedes copiar y pegar desde Excel (nombre y celular). Los números de 10 dígitos se toman como Colombia (+57). Los contactos nuevos se agregan al CRM.</div></div>}
      {f.mode === 'tag' && <select className="select" value={f.tag_id} onChange={(e) => set('tag_id', e.target.value)}><option value="">Elegir etiqueta</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      {f.mode === 'stage' && <select className="select" value={f.stage_id} onChange={(e) => set('stage_id', e.target.value)}><option value="">Elegir etapa</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      <div className="field"><label>Mensaje</label><textarea className="textarea" style={{ minHeight: 120 }} value={f.body} onChange={(e) => { set('body', e.target.value); setPreview(null) }} />
        <div className="small muted">Variables: <span className="kbd">{'{{nombre}}'}</span> primer nombre del contacto, <span className="kbd">{'{{empresa}}'}</span> {company?.name}. Si no hay nombre, se omite.</div></div>
      <div className="row">
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}><Icon name="paperclip" size={14} /> {media ? 'Cambiar adjunto' : 'Adjuntar imagen o PDF'}<input type="file" hidden accept="image/*,application/pdf,video/mp4" onChange={pickFile} /></label>
        {media && <span className="attach-preview" style={{ padding: '4px 8px' }}>{media.preview ? <img src={media.preview} alt="" style={{ width: 28, height: 28 }} /> : <Icon name="file" size={16} />} {media.name} <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMedia(null)}><Icon name="x" size={12} /></button></span>}
      </div>
      <div className="field"><label>Ritmo de envío</label><select className="select" value={f.pace} onChange={(e) => set('pace', e.target.value)}>{Object.entries(PACES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {preview && <div className="alert info" style={{ flexDirection: 'column', gap: 6 }}>
        <div><b>{preview.total} destinatarios</b>{preview.new_contacts ? ` (${preview.new_contacts} nuevos se agregarán al CRM)` : ''} · tiempo estimado {eta(preview.total, min, max)}</div>
        {preview.invalid?.length > 0 && <div style={{ color: 'var(--danger)' }}>{preview.invalid.length} líneas sin un número válido se omitirán: {preview.invalid.slice(0, 3).join(' · ')}{preview.invalid.length > 3 ? '…' : ''}</div>}
        {preview.sample?.length > 0 && <div className="small">Ejemplos: {preview.sample.slice(0, 5).map((s) => s.name || phoneLabel(s.phone, s.wa_jid)).join(', ')}</div>}
        <div className="small">Así se verá:</div>
        <div className="msg out" style={{ maxWidth: '100%', alignSelf: 'stretch' }}>{preview.example}</div>
      </div>}
      <div className="small muted">Envía solo a personas que te conocen o aceptaron recibir información (por ejemplo, los invitados al evento). Los envíos a desconocidos o muy seguidos pueden hacer que WhatsApp bloquee el número.</div>
    </Modal>
  )
}

function Detail({ b, onClose }) {
  const nav = useNavigate()
  const LABEL = { pending: 'Pendiente', sent: 'Enviado', failed: 'Falló' }
  return (
    <Modal title={b.name} onClose={onClose}>
      <div className="small text-2">{b.sent} enviados · {b.failed} fallidos · {b.pending} pendientes · desde {b.instance_name}</div>
      {b.media_name && <div className="small"><Icon name="paperclip" size={13} /> {b.media_name}</div>}
      <div className="msg out" style={{ maxWidth: '100%', alignSelf: 'stretch' }}>{b.body}</div>
      <div style={{ maxHeight: 340, overflow: 'auto' }}>
        <table className="table small"><thead><tr><th>Contacto</th><th>Estado</th><th></th></tr></thead>
          <tbody>{(b.recipients || []).map((r) => <tr key={r.id}>
            <td>{r.name}<div className="muted">{phoneLabel(r.phone, r.wa_jid)}</div></td>
            <td>{LABEL[r.status]}{r.status === 'sent' && r.delivery === 'read' ? ' · leído' : ''}{r.error ? <div style={{ color: 'var(--danger)' }}>{r.error.slice(0, 80)}</div> : null}</td>
            <td>{r.conversation_id && <button className="btn btn-sm btn-ghost" onClick={() => nav(`/bandeja/${r.conversation_id}`)}>Ver chat</button>}</td>
          </tr>)}</tbody></table>
      </div>
    </Modal>
  )
}
