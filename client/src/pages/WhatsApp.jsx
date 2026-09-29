import { useCallback, useEffect, useState } from 'react'
import { useRealtime, useStore } from '../store.jsx'
import { api, fmtDateTime } from '../api.js'
import { Modal } from '../components/Layout.jsx'

const STATUS = { connected: 'Conectado', qr: 'Esperando escaneo del QR', connecting: 'Conectando…', disconnected: 'Desconectado' }

export default function WhatsApp() {
  const { companyId, company, user, toast } = useStore()
  const [list, setList] = useState([])
  const [qrFor, setQrFor] = useState(null)
  const [sim, setSim] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const load = useCallback(() => companyId && api('/whatsapp/instances', { params: { company_id: companyId } }).then(setList), [companyId])
  useEffect(() => { load(); api('/whatsapp/demo/simulator').then((r) => setSim(r.running)).catch(() => {}) }, [load])
  useRealtime('instance:update', (i) => { if (i.company_id === companyId) setList((cur) => cur.map((x) => (x.id === i.id ? i : x))) })

  const connect = async (i) => { setQrFor(i.id); try { await api(`/whatsapp/instances/${i.id}/connect`, { method: 'POST' }) } catch (e) { toast(e.message, 'error'); setQrFor(null) } }
  const disconnect = async (i) => { await api(`/whatsapp/instances/${i.id}/disconnect`, { method: 'POST' }); load() }
  const remove = async (i) => { if (!confirm(`¿Eliminar ${i.name}?`)) return; await api(`/whatsapp/instances/${i.id}`, { method: 'DELETE' }); load() }
  const create = async () => { try { await api('/whatsapp/instances', { method: 'POST', body: { company_id: companyId, name } }); setCreating(false); setName(''); load() } catch (e) { toast(e.message, 'error') } }
  const newLead = async (i) => { try { await api(`/whatsapp/demo/new-lead/${i.id}`, { method: 'POST' }); toast('Lead simulado creado. Míralo en la bandeja.', 'success') } catch (e) { toast(e.message, 'error') } }
  const toggleSim = async () => { const r = await api('/whatsapp/demo/simulator', { method: 'POST', body: { running: !sim, everyMs: 45000 } }); setSim(r.running) }

  const current = list.find((i) => i.id === qrFor)
  useEffect(() => { if (current?.status === 'connected' && qrFor) { toast(`${current.name} conectado ✅`, 'success'); setTimeout(() => setQrFor(null), 1200) } }, [current?.status])

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>WhatsApp Business · {company?.name}</h1><div className="sub">Cada número se conecta escaneando el QR desde la app WhatsApp Business del celular, igual que WhatsApp Web.</div></div>
        <div className="actions">{user.role === 'admin' && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Conectar otro número</button>}</div>
      </div>
      <div className="alert info">Modo demo: el QR es de prueba y la conexión se simula en unos segundos. En producción se usa Evolution API y el QR es real. Los mensajes de prueba se generan con los botones de simulación.</div>
      {list.map((i) => (
        <div key={i.id} className="card inst">
          <div className="ico">📱</div>
          <div className="info">
            <b>{i.name}</b> <span className="muted small">{i.phone}</span>
            <div className="row small" style={{ marginTop: 4 }}><span className={`status-dot status-${i.status}`} /> {STATUS[i.status] || i.status}{i.connected_at && i.status === 'connected' ? ` desde ${fmtDateTime(i.connected_at)}` : ''} · proveedor: {i.provider}</div>
          </div>
          <div className="row">
            {i.status === 'connected' ? (<>
              {i.provider === 'demo' && <button className="btn btn-sm" onClick={() => newLead(i)}>🧪 Simular lead nuevo</button>}
              <button className="btn btn-sm" onClick={() => disconnect(i)}>Desconectar</button>
            </>) : <button className="btn btn-wa btn-sm" onClick={() => connect(i)}>Conectar con QR</button>}
            {user.role === 'admin' && <button className="btn btn-sm btn-danger" onClick={() => remove(i)}>Eliminar</button>}
          </div>
        </div>
      ))}
      {list.length === 0 && <div className="card empty">Esta empresa no tiene números conectados.</div>}

      <div className="card">
        <div className="card-head"><h2>Simulador de la demo</h2></div>
        <div className="card-body row">
          <button className={`toggle ${sim ? 'on' : ''}`} onClick={toggleSim} />
          <div><b>Generar leads y respuestas automáticamente</b><div className="small text-2">Cada 45 segundos entra un lead nuevo o un cliente responde en alguna instancia demo conectada, para ver la bandeja moverse en vivo.</div></div>
        </div>
      </div>

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

      {creating && <Modal title="Conectar otro número" onClose={() => setCreating(false)} footer={<button className="btn btn-primary" onClick={create}>Crear instancia</button>}>
        <div className="field"><label>Nombre</label><input className="input" placeholder="Ej. WhatsApp Ventas Medellín" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <p className="small text-2">Después de crearla, pulsa "Conectar con QR" y escanea desde WhatsApp Business → Dispositivos vinculados.</p>
      </Modal>}

      {qrFor && current && <Modal title={`Conectar ${current.name}`} onClose={() => setQrFor(null)}>
        <div className="qr-box">
          {current.status === 'qr' && current.qr_code ? <img src={current.qr_code} width={260} height={260} alt="Código QR" /> : <div className="spinner" />}
          <b>{STATUS[current.status]}</b>
          <ol>
            <li>Abre WhatsApp Business en el celular</li>
            <li>Menú ⋮ → Dispositivos vinculados → Vincular un dispositivo</li>
            <li>Escanea este código</li>
          </ol>
        </div>
      </Modal>}
    </div>
  )
}
