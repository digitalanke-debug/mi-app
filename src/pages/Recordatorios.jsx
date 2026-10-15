import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { cop, fmtDate, todayISO, daysUntil, relativeDue } from '../lib/format.js'
import { invoiceBalance, invoiceStatus } from '../lib/invoices.js'
import { Modal, StatusBadge, Field, Empty } from '../components/ui.jsx'
import { waApi } from '../store/api.js'

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

export default function Recordatorios() {
  const { state, dispatch, mode, canEdit, scoped } = useStore()
  const [modal, setModal] = useState(null)
  const [waReady, setWaReady] = useState(false)
  useEffect(() => {
    if (mode === 'api' && canEdit) waApi.status().then((s) => setWaReady(s.estado === 'open')).catch(() => {})
  }, [mode, canEdit])
  const [filter, setFilter] = useState('porCobrar') // porCobrar | vencidas | proximas

  const clientOf = (id) => state.clients.find((c) => c.id === id)

  const pendientes = useMemo(
    () => scoped.invoices.filter((i) => invoiceBalance(i) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [scoped.invoices],
  )
  const visibles = pendientes.filter((i) => {
    if (filter === 'vencidas') return daysUntil(i.dueDate) < 0
    if (filter === 'proximas') return daysUntil(i.dueDate) >= 0 && daysUntil(i.dueDate) <= 7
    return true
  })

  const lastReminder = (invoiceId) =>
    [...state.reminders].filter((r) => r.invoiceId === invoiceId).sort((a, b) => b.date.localeCompare(a.date))[0]

  const historial = [...scoped.reminders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Recordatorios a clientes</h1>
          <p className="muted">Hoy toca escribirle a quien está vencido o vence en la semana.</p>
        </div>
      </header>

      <section className="card">
        <div className="toolbar">
          <div className="row">
            <button type="button" className={`chip ${filter === 'porCobrar' ? 'active' : ''}`} onClick={() => setFilter('porCobrar')}>Todo por cobrar ({pendientes.length})</button>
            <button type="button" className={`chip ${filter === 'vencidas' ? 'active' : ''}`} onClick={() => setFilter('vencidas')}>Vencidas ({pendientes.filter((i) => daysUntil(i.dueDate) < 0).length})</button>
            <button type="button" className={`chip ${filter === 'proximas' ? 'active' : ''}`} onClick={() => setFilter('proximas')}>Vencen esta semana ({pendientes.filter((i) => daysUntil(i.dueDate) >= 0 && daysUntil(i.dueDate) <= 7).length})</button>
          </div>
        </div>
        {visibles.length === 0 ? (
          <Empty title="Nada por recordar" text="No hay cuentas de cobro en este filtro." />
        ) : (
          <table className="table">
            <thead><tr><th>Cliente</th><th>Cuenta</th><th>Vence</th><th className="num">Saldo</th><th>Último recordatorio</th><th></th></tr></thead>
            <tbody>
              {visibles.map((i) => {
                const c = clientOf(i.clientId)
                const last = lastReminder(i.id)
                return (
                  <tr key={i.id}>
                    <td><strong>{c?.name ?? 'Cliente'}</strong><div className="muted small">{c?.phone || 'Sin celular'}</div></td>
                    <td>{i.number}<div className="muted small">{i.concept}</div></td>
                    <td>{fmtDate(i.dueDate)}<div className="muted small">{relativeDue(i.dueDate)}</div></td>
                    <td className="num"><strong>{cop(invoiceBalance(i))}</strong></td>
                    <td>{last ? <>{fmtDate(last.date)} <span className="muted small">· {last.channel}</span></> : <span className="muted">Nunca</span>}</td>
                    <td className="actions">
                      <StatusBadge status={invoiceStatus(i)} />
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setModal({ invoice: i, client: c })}>Recordar</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Historial de recordatorios</h2></div>
        {historial.length === 0 ? (
          <Empty title="Aún no has enviado recordatorios" />
        ) : (
          <ul className="list">
            {historial.map((r) => {
              const c = clientOf(r.clientId)
              const inv = state.invoices.find((i) => i.id === r.invoiceId)
              return (
                <li key={r.id} className="list-item">
                  <div className="list-main">
                    <strong>{c?.name ?? 'Cliente'} · {inv?.number ?? ''}</strong>
                    <span className="muted small">{r.message}</span>
                  </div>
                  <div className="list-side"><span className="muted small">{fmtDate(r.date)} · {r.channel}</span></div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {modal && (
        <ReminderForm
          invoice={modal.invoice}
          client={modal.client}
          settings={state.settings}
          waReady={waReady}
          onClose={() => setModal(null)}
          onLog={(reminder) => { dispatch({ type: 'reminder/add', reminder }); setModal(null) }}
          onAutoSend={async (message) => { await waApi.sendReminder(modal.invoice.id, message); setModal(null) }}
        />
      )}
    </div>
  )
}

function ReminderForm({ invoice, client, settings, waReady, onClose, onLog, onAutoSend }) {
  const vars = {
    nombre: client?.contact || client?.name || '',
    numero: invoice.number,
    valor: cop(invoiceBalance(invoice)),
    fecha: fmtDate(invoice.dueDate),
  }
  const [message, setMessage] = useState(fillTemplate(settings.reminderTemplate, vars))
  const [channel, setChannel] = useState('WhatsApp')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState(null)
  const phone = (client?.phone || '').replace(/\D/g, '')
  const waUrl = phone ? `https://wa.me/${settings.countryCode}${phone}?text=${encodeURIComponent(message)}` : null
  const mailUrl = client?.email ? `mailto:${client.email}?subject=${encodeURIComponent('Recordatorio de pago ' + invoice.number)}&body=${encodeURIComponent(message)}` : null

  function log() {
    onLog({ clientId: client?.id, invoiceId: invoice.id, date: todayISO(), channel, message })
  }

  return (
    <Modal title={`Recordatorio · ${client?.name ?? ''}`} onClose={onClose}>
      <div className="form">
        <Field label="Canal">
          <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option>WhatsApp</option>
            <option>Correo</option>
            <option>Llamada</option>
          </select>
        </Field>
        <Field label="Mensaje"><textarea className="input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <div className="row wrap">
          {channel === 'WhatsApp' && waReady && phone && (
            <button type="button" className="btn btn-primary" disabled={sending} onClick={async () => { setSending(true); setSendErr(null); try { await onAutoSend(message) } catch (e) { setSendErr(e.message) } finally { setSending(false) } }}>{sending ? 'Enviando…' : 'Enviar desde el número de la firma'}</button>
          )}
          {channel === 'WhatsApp' && (waUrl
            ? <a className={`btn ${waReady ? '' : 'btn-primary'}`} href={waUrl} target="_blank" rel="noreferrer" onClick={log}>Abrir WhatsApp y registrar</a>
            : <span className="note note-warn">Este cliente no tiene celular registrado.</span>)}
          {channel === 'Correo' && (mailUrl
            ? <a className="btn btn-primary" href={mailUrl} onClick={log}>Abrir correo y registrar</a>
            : <span className="note note-warn">Este cliente no tiene correo registrado.</span>)}
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(message)}>Copiar mensaje</button>
          <button type="button" className="btn" onClick={log}>Solo registrar que se hizo</button>
        </div>
        {sendErr && <p className="note note-danger">{sendErr}</p>}
      </div>
    </Modal>
  )
}
