import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { waApi } from '../store/api.js'
import { Field, Empty, Badge } from '../components/ui.jsx'

export default function WhatsApp() {
  const { state, dispatch } = useStore()
  const wa = state.settings.whatsapp || { allowedNumbers: [], assistantName: '' }
  const [status, setStatus] = useState(null)
  const [qr, setQr] = useState(null)
  const [pairingCode, setPairingCode] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [newNum, setNewNum] = useState({ name: '', phone: '' })
  const [assistantName, setAssistantName] = useState(wa.assistantName || '')
  const [daily, setDaily] = useState(wa.dailySummary || { enabled: false, hour: 8 })
  const [chat, setChat] = useState([])
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const pollRef = useRef(null)

  function refresh() {
    return waApi.status().then(setStatus).catch((e) => setErr(e.message))
  }
  useEffect(() => {
    waApi.status().then(setStatus).catch((e) => setErr(e.message))
  }, [])

  // Mientras se muestra el QR, consulta el estado cada 4 segundos
  useEffect(() => {
    if (!qr) return
    pollRef.current = setInterval(async () => {
      try {
        const s = await waApi.status()
        setStatus(s)
        if (s.estado === 'open') { setQr(null); setPairingCode(null) }
      } catch { /* ignorar */ }
    }, 4000)
    return () => clearInterval(pollRef.current)
  }, [qr])

  async function connect() {
    setBusy(true)
    setErr(null)
    try {
      const r = await waApi.connect()
      setQr(r.qr)
      setPairingCode(r.pairingCode || null)
      await refresh()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  function saveWa(patch) {
    dispatch({ type: 'settings/update', settings: { whatsapp: { ...wa, ...patch } } })
  }
  function addNumber(e) {
    e.preventDefault()
    const phone = newNum.phone.replace(/\D/g, '')
    if (phone.length < 10) return
    saveWa({ allowedNumbers: [...(wa.allowedNumbers || []), { name: newNum.name.trim() || phone, phone }] })
    setNewNum({ name: '', phone: '' })
  }
  function removeNumber(phone) {
    saveWa({ allowedNumbers: (wa.allowedNumbers || []).filter((n) => n.phone !== phone) })
  }

  async function sendTest(e) {
    e.preventDefault()
    const text = chatText.trim()
    if (!text) return
    setChat((c) => [...c, { who: 'yo', text }])
    setChatText('')
    setChatBusy(true)
    try {
      const r = await waApi.test(text, chat.length === 0)
      setChat((c) => [...c, { who: 'asistente', text: r.reply }])
    } catch (e2) {
      setChat((c) => [...c, { who: 'error', text: e2.message }])
    } finally {
      setChatBusy(false)
    }
  }

  const conectado = status?.estado === 'open'
  const tone = conectado ? 'ok' : status?.estado === 'connecting' ? 'warn' : 'neutral'
  const estadoLabel = !status ? 'Consultando…' : !status.evolution ? 'Sin configurar' : conectado ? 'Conectado' : status.estado === 'connecting' ? 'Esperando escaneo del QR' : status.estado === 'sin instancia' ? 'Número sin vincular' : status.estado === 'close' ? 'Desconectado' : status.estado

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Asistente de WhatsApp</h1>
          <p className="muted">Un número de WhatsApp dedicado por el que la administración consulta y registra todo escribiendo o con notas de voz.</p>
        </div>
      </header>
      {err && <p className="note note-danger">{err}</p>}

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Número conectado</h2><Badge tone={tone}>{estadoLabel}</Badge></div>
          {status && !status.evolution && (
            <p className="note note-warn">El servidor aún no tiene la conexión con Evolution API. Hay que ejecutar en el servidor: <code>cd /opt/sigo-admin && bash deploy/configurar-whatsapp.sh</code></p>
          )}
          {status?.evolution && !conectado && (
            <>
              <p className="muted small">Vincula el número dedicado como si fuera "WhatsApp Web": en el celular abre WhatsApp → Dispositivos vinculados → Vincular dispositivo, y escanea el código.</p>
              <button type="button" className="btn btn-primary" onClick={connect} disabled={busy}>{busy ? 'Generando…' : qr ? 'Generar otro código' : 'Vincular número'}</button>
              {qr && (
                <div className="qr">
                  <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="Código QR para vincular WhatsApp" />
                  {pairingCode && <p className="muted small">Código de emparejamiento: <strong>{pairingCode}</strong></p>}
                  <p className="muted small">El código caduca en un minuto. Si no alcanzas, genera otro.</p>
                </div>
              )}
            </>
          )}
          {conectado && <p className="muted">Listo. Los números autorizados ya pueden escribirle al asistente.</p>}
          {status && (
            <ul className="checks">
              <li><Badge tone={status.evolution ? 'ok' : 'neutral'}>{status.evolution ? 'Sí' : 'No'}</Badge> Conexión con Evolution API</li>
              <li><Badge tone={status.webhook ? 'ok' : 'neutral'}>{status.webhook ? 'Sí' : 'No'}</Badge> Dirección pública para recibir mensajes</li>
              <li><Badge tone={status.asistente ? 'ok' : 'neutral'}>{status.asistente ? 'Sí' : 'No'}</Badge> Clave de Claude para el asistente</li>
              <li><Badge tone={status.voz ? 'ok' : 'neutral'}>{status.voz ? 'Sí' : 'No'}</Badge> Transcripción de notas de voz</li>
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Quién puede escribirle</h2></div>
          <p className="muted small">Solo estos celulares reciben respuesta. Cualquier otro número se ignora en silencio.</p>
          {(wa.allowedNumbers || []).length === 0 ? <Empty title="Nadie autorizado todavía" /> : (
            <ul className="list">
              {wa.allowedNumbers.map((n) => (
                <li key={n.phone} className="list-item">
                  <div className="list-main"><strong>{n.name}</strong><span className="muted small">{n.phone}</span></div>
                  <div className="list-side"><button type="button" className="btn btn-sm btn-link text-danger" onClick={() => removeNumber(n.phone)}>Quitar</button></div>
                </li>
              ))}
            </ul>
          )}
          <form className="form" onSubmit={addNumber}>
            <div className="form-row">
              <Field label="Nombre"><input className="input" value={newNum.name} onChange={(e) => setNewNum({ ...newNum, name: e.target.value })} placeholder="Gladys" /></Field>
              <Field label="Celular con indicativo" hint="Ej: 573001234567"><input className="input" value={newNum.phone} onChange={(e) => setNewNum({ ...newNum, phone: e.target.value })} inputMode="tel" required /></Field>
            </div>
            <div className="row-end"><button type="submit" className="btn btn-primary">Autorizar</button></div>
          </form>
          <hr />
          <form className="form" onSubmit={(e) => { e.preventDefault(); saveWa({ assistantName, dailySummary: { enabled: !!daily.enabled, hour: Number(daily.hour) || 8 } }) }}>
            <Field label="Nombre del asistente"><input className="input" value={assistantName} onChange={(e) => setAssistantName(e.target.value)} /></Field>
            <label className="check"><input type="checkbox" checked={!!daily.enabled} onChange={(e) => setDaily({ ...daily, enabled: e.target.checked })} /> Enviar un resumen diario a los números autorizados</label>
            <Field label="Hora del resumen (0 a 23)"><input className="input" type="number" min={0} max={23} value={daily.hour} onChange={(e) => setDaily({ ...daily, hour: e.target.value })} /></Field>
            <div className="row-end"><button type="submit" className="btn">Guardar</button></div>
          </form>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Probar el asistente aquí</h2>
          <span className="muted small">Mismo cerebro, sin WhatsApp. En modo prueba no envía mensajes a clientes.</span>
        </div>
        {!status?.asistente ? <p className="note note-warn">Falta la clave de Claude en el servidor (ANTHROPIC_API_KEY). Ejecuta <code>bash deploy/configurar-whatsapp.sh</code>.</p> : (
          <>
            <div className="chat">
              {chat.length === 0 && <p className="muted small">Prueba con: "¿cuánto hay en las cuentas?", "qué toca pagar esta semana", "registra un abono de 500 mil de Pérez a Bancolombia".</p>}
              {chat.map((m, i) => <div key={i} className={`bubble bubble-${m.who}`}>{m.text}</div>)}
              {chatBusy && <div className="bubble bubble-asistente muted">Pensando…</div>}
            </div>
            <form className="row" onSubmit={sendTest}>
              <input className="input" value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Escribe como lo harías por WhatsApp" disabled={chatBusy} />
              <button type="submit" className="btn btn-primary" disabled={chatBusy}>Enviar</button>
              <button type="button" className="btn" onClick={() => setChat([])}>Nueva conversación</button>
            </form>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Qué puede hacer</h2></div>
        <ul className="muted small two-col">
          <li>"¿Cuánto hay en Bancolombia?" / "¿Cómo vamos?"</li>
          <li>"¿Qué toca pagar esta semana?" / "¿Quién está vencido?"</li>
          <li>"Registra un pago de 2 millones de Inversiones del Norte, entró a Davivienda"</li>
          <li>"Crea cuenta de cobro a Pérez por 1.500.000 de honorarios, vence el 30"</li>
          <li>"Paga el arriendo y el internet desde Bancolombia"</li>
          <li>"Abona 800 mil al préstamo"</li>
          <li>"Mándale recordatorio a Constructora Horizonte"</li>
          <li>Notas de voz con cualquiera de las anteriores, y fotos o PDF de facturas para registrarlas.</li>
        </ul>
      </section>
    </div>
  )
}
