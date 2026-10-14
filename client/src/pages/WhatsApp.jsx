import { useCallback, useEffect, useState } from 'react'
import { useRealtime, useStore } from '../store.jsx'
import { api, fmtDateTime } from '../api.js'
import { Modal } from '../components/Layout.jsx'
import { Icon } from '../components/Icons.jsx'

const STATUS = { connected: 'Conectado', qr: 'Esperando escaneo del QR', connecting: 'Conectando…', disconnected: 'Desconectado' }

export default function WhatsApp() {
  const { companyId, company, user, toast } = useStore()
  const [list, setList] = useState([])
  const [qrFor, setQrFor] = useState(null)
  const [sim, setSim] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [metaForm, setMetaForm] = useState(null) // { id?, name, phone_number_id, waba_id, access_token, app_secret }
  const [metaSetup, setMetaSetup] = useState(null)
  const [savingMeta, setSavingMeta] = useState(false)

  const load = useCallback(() => companyId && api('/whatsapp/instances', { params: { company_id: companyId } }).then(setList), [companyId])
  useEffect(() => { load(); api('/whatsapp/demo/simulator').then((r) => setSim(r.running)).catch(() => {}) }, [load])
  useRealtime('instance:update', (i) => { if (i.company_id === companyId) setList((cur) => cur.map((x) => (x.id === i.id ? i : x))) })

  const openMeta = async (inst) => {
    setMetaForm(inst ? { id: inst.id, name: inst.name, ...inst.meta } : { name: '', phone_number_id: '', waba_id: '', access_token: '', app_secret: '' })
    if (!metaSetup) api('/whatsapp/meta/setup').then(setMetaSetup).catch(() => {})
  }
  const saveMeta = async () => {
    setSavingMeta(true)
    try {
      const { id, name: n, ...meta } = metaForm
      const r = id ? await api(`/whatsapp/instances/${id}/meta`, { method: 'PATCH', body: { name: n, ...meta } })
        : await api('/whatsapp/instances', { method: 'POST', body: { company_id: companyId, provider: 'meta', name: n || 'WhatsApp API oficial', meta } })
      toast(`Conectado${r.verified_name ? `: ${r.verified_name}` : ''}`, 'success'); setMetaForm(null); load()
    } catch (e) { toast(e.message, 'error'); load() } finally { setSavingMeta(false) }
  }
  const verifyMeta = async (i) => { try { const r = await api(`/whatsapp/instances/${i.id}/connect`, { method: 'POST' }); toast(`Conexión verificada${r.quality ? ` · calidad ${r.quality}` : ''}`, 'success'); load() } catch (e) { toast(e.message, 'error'); load() } }
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copiado', 'success') }
  const [qrImg, setQrImg] = useState(null)
  const [importing, setImporting] = useState(null)
  const importHistory = async (i) => {
    if (!confirm(`¿Importar las conversaciones anteriores de ${i.name}? Se traen los chats del último año que WhatsApp envió al vincular el número. No se envía ningún mensaje a los clientes.`)) return
    setImporting(i.id)
    try {
      const r = await api(`/whatsapp/instances/${i.id}/import-history`, { method: 'POST', body: { days: 365 } })
      if (!r.scanned) toast('No hay historial guardado para este número. Desconéctalo y vuelve a escanear el QR para que WhatsApp lo envíe, espera 2 minutos e importa de nuevo.', 'warn')
      else toast(`Historial importado: ${r.conversationsCreated} conversaciones nuevas, ${r.messagesImported} mensajes${r.contacts ? `, ${r.contacts.created} contactos de la agenda` : ''}`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setImporting(null) }
  }
  const connect = async (i) => {
    setQrFor(i.id); setQrImg(null)
    try { const r = await api(`/whatsapp/instances/${i.id}/connect`, { method: 'POST' }); if (r?.qr) setQrImg(r.qr); load() }
    catch (e) { toast(e.message, 'error'); setQrFor(null) }
  }
  const disconnect = async (i) => { await api(`/whatsapp/instances/${i.id}/disconnect`, { method: 'POST' }); load() }
  const remove = async (i) => { if (!confirm(`¿Eliminar ${i.name}?`)) return; await api(`/whatsapp/instances/${i.id}`, { method: 'DELETE' }); load() }
  // Crea el número y abre el QR de inmediato
  const create = async () => {
    try {
      const inst = await api('/whatsapp/instances', { method: 'POST', body: { company_id: companyId, name: name || `WhatsApp ${company?.name || ''}`.trim() } })
      setCreating(false); setName(''); await load(); connect(inst)
    } catch (e) { toast(e.message, 'error') }
  }
  const newLead = async (i) => { try { await api(`/whatsapp/demo/new-lead/${i.id}`, { method: 'POST' }); toast('Lead simulado creado. Míralo en la bandeja.', 'success') } catch (e) { toast(e.message, 'error') } }
  const toggleSim = async () => { const r = await api('/whatsapp/demo/simulator', { method: 'POST', body: { running: !sim, everyMs: 45000 } }); setSim(r.running) }

  const current = list.find((i) => i.id === qrFor)
  // Mientras el QR está abierto, refresca el estado cada 3 s (por si el tiempo real se demora); el QR de WhatsApp cambia cada ~40 s
  useEffect(() => {
    if (!qrFor) return
    const t = setInterval(() => { load() }, 3000)
    return () => clearInterval(t)
  }, [qrFor, load])
  const shownQr = current?.qr_code || qrImg
  useEffect(() => { if (current?.status === 'connected' && qrFor) { toast(`${current.name} conectado`, 'success'); setTimeout(() => setQrFor(null), 1200) } }, [current?.status])

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>WhatsApp Business · {company?.name}</h1><div className="sub">Conecta cada número por QR desde la app WhatsApp Business, o con la API oficial de Meta.</div></div>
        <div className="actions">
          {user.role === 'admin' && <button className="btn" onClick={() => openMeta(null)}><Icon name="link" size={15} /> Número de la API oficial</button>}
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="qr" size={15} /> Conectar número por QR</button></div>
      </div>
      <div className="alert info"><Icon name="info" size={16} /><div>Dos formas de conectar: <b>por QR</b> (app WhatsApp Business del celular, sin costo por mensaje) o <b>API oficial de Meta</b> (número registrado en Meta, sin celular, plantillas aprobadas y cobro por conversación iniciada por la empresa).</div></div>
      {list.map((i) => (
        <div key={i.id} className="card inst">
          <div className="ico-box"><Icon name={i.provider === 'meta' ? 'link' : 'phone'} size={20} /></div>
          <div className="info">
            <b>{i.name}</b> <span className="muted small">{i.phone}</span>
            <div className="row small" style={{ marginTop: 4 }}><span className={`status-dot status-${i.status}`} /> {STATUS[i.status] || i.status}{i.connected_at && i.status === 'connected' ? ` desde ${fmtDateTime(i.connected_at)}` : ''} · {i.provider === 'meta' ? 'API oficial de Meta' : i.provider === 'evolution' ? 'QR (WhatsApp Business)' : 'demo'}</div>
          </div>
          <div className="row">
            {i.provider === 'meta' ? (<>
              <button className="btn btn-sm" onClick={() => verifyMeta(i)}><Icon name="refresh" size={14} /> Verificar</button>
              {user.role === 'admin' && <button className="btn btn-sm" onClick={() => openMeta(i)}><Icon name="edit" size={13} /> Credenciales</button>}
            </>) : i.status === 'connected' ? (<>
              {i.provider === 'demo' && <button className="btn btn-sm" onClick={() => newLead(i)}><Icon name="flask" size={14} /> Simular lead nuevo</button>}
              <button className="btn btn-sm" onClick={() => disconnect(i)}>Desconectar</button>
            </>) : <button className="btn btn-wa btn-sm" onClick={() => connect(i)}><Icon name="qr" size={14} /> Conectar con QR</button>}
            {i.provider === 'evolution' && <button className="btn btn-sm" disabled={importing === i.id} onClick={() => importHistory(i)}><Icon name="download" size={14} /> {importing === i.id ? 'Importando…' : 'Importar historial'}</button>}
            {user.role === 'admin' && <button className="btn btn-sm btn-danger" onClick={() => remove(i)}>Eliminar</button>}
          </div>
        </div>
      ))}
      {list.length === 0 && <div className="card empty">Esta empresa no tiene números conectados.</div>}

      {list.some((i) => i.provider === 'demo') && <div className="card">
        <div className="card-head"><h2>Simulador de la demo</h2></div>
        <div className="card-body row">
          <button className={`toggle ${sim ? 'on' : ''}`} onClick={toggleSim} />
          <div><b>Generar leads y respuestas automáticamente</b><div className="small text-2">Cada 45 segundos entra un lead nuevo o un cliente responde en alguna instancia demo conectada, para ver la bandeja moverse en vivo.</div></div>
        </div>
      </div>}

      <div className="card">
        <div className="card-head"><h2>Captura de leads desde anuncios y formularios</h2></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="text-2">Para saber de dónde llega cada lead, el enlace del anuncio abre WhatsApp con un texto prellenado que incluye un código entre corchetes. El CRM lo lee y marca el origen y la campaña automáticamente.</p>
          <table className="table">
            <thead><tr><th>Origen</th><th>Código en el mensaje</th><th>Ejemplo de enlace</th></tr></thead>
            <tbody>
              <tr><td>Google Ads</td><td><span className="kbd">[GA-NOMBRE-CAMPAÑA]</span></td><td className="small">https://wa.me/57XXXXXXXXXX?text=Hola%2C%20quiero%20informaci%C3%B3n%20%5BGA-BUSQUEDA-MARCA%5D</td></tr>
              <tr><td>Meta Ads (FB/IG)</td><td><span className="kbd">[META-CAMPAÑA]</span> o automático en anuncios clic a WhatsApp</td><td className="small">…?text=Hola%20%5BIG-LEADS-SEPT%5D</td></tr>
              <tr><td>Web / landing</td><td><span className="kbd">[WEB-LANDING]</span></td><td className="small">…?text=Hola%20%5BWEB-LANDING%5D</td></tr>
              <tr><td>Referido</td><td><span className="kbd">[REF-NOMBRE]</span></td><td className="small">…?text=Hola%20%5BREF-JUAN%5D</td></tr>
            </tbody>
          </table>
          <p className="text-2">Formularios (Google Ads Lead Form, sitio web, n8n): envía un POST a <span className="kbd">/api/whatsapp/webhooks/lead/{companyId}</span> con <span className="kbd">{`{ phone, name, message, source, campaign }`}</span> y el lead aparece en la bandeja.</p>
        </div>
      </div>

      {metaForm && <Modal title={metaForm.id ? 'Credenciales de la API oficial' : 'Conectar número de la API oficial de WhatsApp'} onClose={() => setMetaForm(null)}
        footer={<button className="btn btn-primary" disabled={savingMeta} onClick={saveMeta}>{savingMeta ? 'Verificando…' : 'Guardar y verificar'}</button>}>
        <p className="small text-2">Datos de <b>Meta for Developers → tu app → WhatsApp → Configuración de la API</b>. El token debe ser permanente (usuario del sistema en Meta Business), no el temporal de 24 horas.</p>
        <div className="field"><label>Nombre en el CRM</label><input className="input" placeholder="Ej. WhatsApp oficial Núcleo" value={metaForm.name || ''} onChange={(e) => setMetaForm({ ...metaForm, name: e.target.value })} /></div>
        <div className="grid-2">
          <div className="field"><label>Phone Number ID</label><input className="input" value={metaForm.phone_number_id || ''} onChange={(e) => setMetaForm({ ...metaForm, phone_number_id: e.target.value })} /></div>
          <div className="field"><label>WhatsApp Business Account ID</label><input className="input" value={metaForm.waba_id || ''} onChange={(e) => setMetaForm({ ...metaForm, waba_id: e.target.value })} /></div>
        </div>
        <div className="field"><label>Token de acceso permanente</label><input className="input" type="password" value={metaForm.access_token || ''} onChange={(e) => setMetaForm({ ...metaForm, access_token: e.target.value })} /></div>
        <div className="field"><label>App secret (recomendado, valida que los avisos vienen de Meta)</label><input className="input" type="password" value={metaForm.app_secret || ''} onChange={(e) => setMetaForm({ ...metaForm, app_secret: e.target.value })} /></div>
        {metaSetup && <div className="alert info" style={{ flexDirection: 'column', gap: 6 }}>
          <b>En Meta → WhatsApp → Configuración → Webhook, pega estos datos y suscribe el campo "messages":</b>
          <div className="row" style={{ gap: 6 }}><span className="small">URL de devolución:</span><span className="kbd" style={{ wordBreak: 'break-all' }}>{metaSetup.callback_url}</span><button className="btn btn-sm btn-ghost" onClick={() => copy(metaSetup.callback_url)}>Copiar</button></div>
          <div className="row" style={{ gap: 6 }}><span className="small">Token de verificación:</span><span className="kbd">{metaSetup.verify_token}</span><button className="btn btn-sm btn-ghost" onClick={() => copy(metaSetup.verify_token)}>Copiar</button></div>
        </div>}
      </Modal>}

      {creating && <Modal title="Conectar otro número" onClose={() => setCreating(false)} footer={<button className="btn btn-primary" onClick={create}><Icon name="qr" size={15} /> Continuar y mostrar QR</button>}>
        <div className="field"><label>Nombre</label><input className="input" placeholder="Ej. WhatsApp Ventas Medellín" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <p className="small text-2">Al continuar se muestra el código QR para escanear desde WhatsApp Business → Dispositivos vinculados.</p>
      </Modal>}

      {qrFor && current && <Modal title={`Conectar ${current.name}`} onClose={() => { setQrFor(null); setQrImg(null) }}>
        <div className="qr-box">
          {current.status === 'connected' ? <div className="ico-box" style={{ width: 72, height: 72 }}><Icon name="check" size={36} /></div>
            : shownQr ? <img src={shownQr} width={260} height={260} alt="Código QR" />
            : <div className="spinner" />}
          <b>{current.status === 'connected' ? 'Conectado' : shownQr ? 'Escanea el código con el celular' : 'Generando código QR…'}</b>
          <ol>
            <li>Abre WhatsApp Business en el celular</li>
            <li>Menú ⋮ (o Configuración en iPhone) → Dispositivos vinculados → Vincular un dispositivo</li>
            <li>Apunta la cámara a este código</li>
          </ol>
          <p className="small muted">El código se renueva solo cada 40 segundos aproximadamente. Si no aparece o expira, genera uno nuevo.</p>
          {current.status !== 'connected' && <button className="btn btn-sm" onClick={() => connect(current)}><Icon name="refresh" size={14} /> Generar nuevo QR</button>}
        </div>
      </Modal>}
    </div>
  )
}
