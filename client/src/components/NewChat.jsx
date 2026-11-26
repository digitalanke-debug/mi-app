import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { api, formatPhone } from '../api.js'
import { Modal } from './Layout.jsx'

const fill = (text, v) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (v[k] ?? m))

/** Empezar un chat con un número que dicta el cliente (sin esperar a que escriba primero) */
export default function NewChatModal({ onClose, initial = {} }) {
  const { companyId, company, user, toast } = useStore()
  const nav = useNavigate()
  const [instances, setInstances] = useState([])
  const [quick, setQuick] = useState([])
  const [f, setF] = useState({ phone: initial.phone || '', name: initial.name || '', instance_id: '', body: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!companyId) return
    api('/whatsapp/instances', { params: { company_id: companyId } }).then((list) => {
      setInstances(list)
      const first = list.find((i) => i.status === 'connected')
      if (first) setF((x) => ({ ...x, instance_id: x.instance_id || String(first.id) }))
    }).catch(() => {})
    api('/quick-replies', { params: { company_id: companyId } }).then(setQuick).catch(() => {})
  }, [companyId])
  const inst = instances.find((i) => String(i.id) === String(f.instance_id))
  const isMeta = inst?.provider === 'meta'
  const firstName = (f.name || '').trim().split(/\s+/)[0] || ''
  const vars = { nombre: firstName, agente: user.name?.split(' ')[0] || '', empresa: company?.name || '', telefono: formatPhone(f.phone) }
  const useQuick = (id) => { const q = quick.find((x) => String(x.id) === id); if (q) setF((x) => ({ ...x, body: fill(q.body, vars).replace(/\s+([,.!?])/g, '$1') })) }
  const start = async () => {
    setBusy(true)
    try {
      const r = await api('/conversations/start', { method: 'POST', body: { company_id: companyId, ...f } })
      if (r.error) toast(`El chat se creó, pero el mensaje no salió: ${r.error}`, 'error')
      else if (r.needs_template) toast('Chat creado. Con la API oficial el primer mensaje debe ser una plantilla aprobada: usa "Plantillas" en el chat.', 'warn')
      else toast(r.sent ? 'Mensaje enviado' : 'Chat creado', 'success')
      onClose()
      nav(`/bandeja/${r.conversation_id}`)
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const connected = instances.filter((i) => i.status === 'connected')
  return (
    <Modal title="Nuevo chat" onClose={onClose} footer={<button className="btn btn-primary" disabled={busy || !f.phone.trim() || !f.instance_id || (!isMeta && !f.body.trim())} onClick={start}>{busy ? 'Enviando…' : isMeta ? 'Crear chat' : 'Enviar mensaje'}</button>}>
      <div className="small text-2">Para escribirle a alguien que les dio su número. Si esa persona ya tiene un chat abierto, el mensaje se agrega a ese chat.</div>
      <div className="grid-2">
        <div className="field"><label>Número de WhatsApp</label><input className="input" inputMode="tel" autoFocus placeholder="300 123 4567" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <span className="small muted">De Colombia: los 10 dígitos. De otro país: con + e indicativo.</span></div>
        <div className="field"><label>Nombre (opcional)</label><input className="input" placeholder="Nombre de la persona" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      </div>
      <div className="field"><label>Escribir desde</label>
        <select className="select" value={f.instance_id} onChange={(e) => setF({ ...f, instance_id: e.target.value })}>
          {!connected.length && <option value="">No hay números conectados</option>}
          {connected.map((i) => <option key={i.id} value={i.id}>{i.name}{i.phone ? ` · ${i.phone}` : ''}{i.provider === 'meta' ? ' (API oficial)' : ''}</option>)}
        </select></div>
      {isMeta
        ? <div className="alert info">Con la API oficial, WhatsApp solo permite empezar la conversación con una <b>plantilla aprobada</b>. Se crea el chat y ahí eliges la plantilla.</div>
        : <div className="field"><label>Primer mensaje</label>
            {quick.length > 0 && <select className="select" value="" onChange={(e) => useQuick(e.target.value)}><option value="">Usar una respuesta rápida…</option>{quick.map((q) => <option key={q.id} value={q.id}>/{q.shortcut} · {q.body.slice(0, 60)}</option>)}</select>}
            <textarea className="textarea" placeholder={`¡Hola${firstName ? ` ${firstName}` : ''}! Le escribe ${vars.agente} de ${company?.name || 'la empresa'}…`} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>}
    </Modal>
  )
}
