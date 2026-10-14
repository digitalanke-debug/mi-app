import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { cop, fmtDate, todayISO, addDaysISO, relativeDue } from '../lib/format.js'
import { invoiceBalance, invoicePaid, invoiceStatus, invoiceTotal, clientBalance, clientOverdue } from '../lib/invoices.js'
import { downloadCSV } from '../lib/csv.js'
import { Modal, StatusBadge, MoneyInput, Field, Empty, Confirm } from '../components/ui.jsx'

const blankClient = { name: '', nit: '', phone: '', email: '', contact: '', notes: '' }

export default function Clientes() {
  const { state, dispatch } = useStore()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [clientModal, setClientModal] = useState(null) // null | {mode:'new'} | {mode:'edit', client}
  const [invoiceModal, setInvoiceModal] = useState(null) // null | {clientId} | {invoice}
  const [paymentModal, setPaymentModal] = useState(null) // invoice
  const [confirm, setConfirm] = useState(null)
  const [onlyDebt, setOnlyDebt] = useState(false)

  const clients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.clients
      .map((c) => ({ ...c, balance: clientBalance(state.invoices, c.id), overdue: clientOverdue(state.invoices, c.id) }))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.nit || '').toLowerCase().includes(q))
      .filter((c) => !onlyDebt || c.balance > 0)
      .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance || a.name.localeCompare(b.name))
  }, [state.clients, state.invoices, search, onlyDebt])

  const selected = state.clients.find((c) => c.id === selectedId) || null
  const selectedInvoices = selected
    ? state.invoices.filter((i) => i.clientId === selected.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    : []

  const totalCartera = state.invoices.reduce((s, i) => s + invoiceBalance(i), 0)

  function exportar() {
    const rows = state.invoices.map((i) => {
      const c = state.clients.find((x) => x.id === i.clientId)
      return [i.number, c?.name ?? '', c?.nit ?? '', i.concept, i.issueDate, i.dueDate, invoiceTotal(i), invoicePaid(i), invoiceBalance(i), invoiceStatus(i)]
    })
    downloadCSV('cuentas-de-cobro.csv', ['Número', 'Cliente', 'NIT/CC', 'Concepto', 'Emisión', 'Vencimiento', 'Total', 'Pagado', 'Saldo', 'Estado'], rows)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Clientes y facturación</h1>
          <p className="muted">Cartera total por cobrar: <strong>{cop(totalCartera)}</strong></p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={exportar}>Exportar CSV</button>
          <button type="button" className="btn btn-primary" onClick={() => setClientModal({ mode: 'new' })}>+ Nuevo cliente</button>
        </div>
      </header>

      <div className="split">
        <aside className="card split-list">
          <div className="toolbar">
            <input className="input" placeholder="Buscar por nombre o NIT" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="check"><input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} /> Solo con saldo</label>
          </div>
          {clients.length === 0 ? (
            <Empty title="Sin clientes" text="Crea el primer cliente para empezar a facturar." />
          ) : (
            <ul className="list">
              {clients.map((c) => (
                <li key={c.id}>
                  <button type="button" className={`list-item list-btn ${c.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(c.id)}>
                    <div className="list-main">
                      <strong>{c.name}</strong>
                      <span className="muted">{c.nit || 'Sin NIT'}{c.overdue > 0 ? ` · ${cop(c.overdue)} vencido` : ''}</span>
                    </div>
                    <div className="list-side">
                      <span className={`amount ${c.overdue > 0 ? 'text-danger' : ''}`}>{cop(c.balance)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="card split-detail">
          {!selected ? (
            <Empty title="Selecciona un cliente" text="Aquí verás sus cuentas de cobro, abonos y saldo." />
          ) : (
            <>
              <div className="card-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted">
                    {selected.nit && <>NIT/CC {selected.nit} · </>}
                    {selected.phone && <>Cel {selected.phone} · </>}
                    {selected.email}
                    {selected.contact && <> · Contacto: {selected.contact}</>}
                  </p>
                  {selected.notes && <p className="muted">{selected.notes}</p>}
                </div>
                <div className="row">
                  <button type="button" className="btn" onClick={() => setClientModal({ mode: 'edit', client: selected })}>Editar</button>
                  <button type="button" className="btn btn-primary" onClick={() => setInvoiceModal({ clientId: selected.id })}>+ Cuenta de cobro</button>
                </div>
              </div>

              <div className="kpis kpis-3">
                <div className="kpi"><div className="kpi-label">Saldo pendiente</div><div className="kpi-value">{cop(clientBalance(state.invoices, selected.id))}</div></div>
                <div className="kpi"><div className="kpi-label">Vencido</div><div className="kpi-value text-danger">{cop(clientOverdue(state.invoices, selected.id))}</div></div>
                <div className="kpi"><div className="kpi-label">Facturado histórico</div><div className="kpi-value">{cop(selectedInvoices.reduce((s, i) => s + invoiceTotal(i), 0))}</div></div>
              </div>

              {selectedInvoices.length === 0 ? (
                <Empty title="Sin cuentas de cobro" text="Crea la primera cuenta de cobro para este cliente." />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Concepto</th>
                      <th>Vence</th>
                      <th className="num">Total</th>
                      <th className="num">Saldo</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoices.map((i) => {
                      const st = invoiceStatus(i)
                      return (
                        <tr key={i.id}>
                          <td><strong>{i.number}</strong></td>
                          <td>{i.concept}<div className="muted small">{fmtDate(i.issueDate)}</div></td>
                          <td>{fmtDate(i.dueDate)}<div className="muted small">{invoiceBalance(i) > 0 ? relativeDue(i.dueDate) : ''}</div></td>
                          <td className="num">{cop(invoiceTotal(i))}</td>
                          <td className="num"><strong>{cop(invoiceBalance(i))}</strong></td>
                          <td><StatusBadge status={st} /></td>
                          <td className="actions">
                            {st !== 'pagada' && <button type="button" className="btn btn-sm btn-primary" onClick={() => setPaymentModal(i)}>Registrar pago</button>}
                            <button type="button" className="btn btn-sm" onClick={() => setInvoiceModal({ invoice: i })}>Ver</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              <div className="row-end">
                <button type="button" className="btn btn-link text-danger" onClick={() => setConfirm({ text: `¿Eliminar a ${selected.name} y todas sus cuentas de cobro?`, onYes: () => { dispatch({ type: 'client/remove', id: selected.id }); setSelectedId(null); setConfirm(null) } })}>Eliminar cliente</button>
              </div>
            </>
          )}
        </section>
      </div>

      {clientModal && (
        <ClientForm
          initial={clientModal.mode === 'edit' ? clientModal.client : blankClient}
          onClose={() => setClientModal(null)}
          onSave={(data) => {
            if (clientModal.mode === 'edit') dispatch({ type: 'client/update', id: clientModal.client.id, client: data })
            else dispatch({ type: 'client/add', client: data })
            setClientModal(null)
          }}
        />
      )}

      {invoiceModal && (
        <InvoiceForm
          clients={state.clients}
          initial={invoiceModal.invoice}
          clientId={invoiceModal.clientId}
          onClose={() => setInvoiceModal(null)}
          onDelete={invoiceModal.invoice ? () => setConfirm({ text: `¿Eliminar la cuenta de cobro ${invoiceModal.invoice.number}?`, onYes: () => { dispatch({ type: 'invoice/remove', id: invoiceModal.invoice.id }); setInvoiceModal(null); setConfirm(null) } }) : null}
          onSave={(data) => {
            if (invoiceModal.invoice) dispatch({ type: 'invoice/update', id: invoiceModal.invoice.id, invoice: data })
            else dispatch({ type: 'invoice/add', invoice: data })
            setInvoiceModal(null)
          }}
        />
      )}

      {paymentModal && (
        <PaymentForm
          invoice={paymentModal}
          onClose={() => setPaymentModal(null)}
          onSave={({ amount, date, note }) => {
            dispatch({ type: 'invoice/payment', id: paymentModal.id, amount, date, note })
            setPaymentModal(null)
          }}
        />
      )}

      {confirm && <Confirm text={confirm.text} onYes={confirm.onYes} onNo={() => setConfirm(null)} yesLabel="Sí, eliminar" />}
    </div>
  )
}

function ClientForm({ initial, onClose, onSave }) {
  const [f, setF] = useState({ ...blankClient, ...initial })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title={initial.name ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSave(f) }}>
        <Field label="Nombre o razón social"><input className="input" value={f.name} onChange={set('name')} required autoFocus /></Field>
        <div className="form-row">
          <Field label="NIT o cédula"><input className="input" value={f.nit} onChange={set('nit')} /></Field>
          <Field label="Celular (WhatsApp)" hint="Solo números, sin +57"><input className="input" value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        </div>
        <div className="form-row">
          <Field label="Correo"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Persona de contacto"><input className="input" value={f.contact} onChange={set('contact')} /></Field>
        </div>
        <Field label="Notas"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function InvoiceForm({ clients, initial, clientId, onClose, onSave, onDelete }) {
  const hoy = todayISO()
  const [f, setF] = useState(
    initial
      ? { ...initial }
      : { clientId: clientId || clients[0]?.id || '', number: '', concept: '', issueDate: hoy, dueDate: addDaysISO(hoy, 30), items: [{ desc: '', kind: 'honorarios', amount: 0 }], notes: '' },
  )
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const setItem = (idx, patch) => setF({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) })
  const total = invoiceTotal(f)
  const paid = initial ? invoicePaid(initial) : 0

  return (
    <Modal title={initial ? `Cuenta de cobro ${initial.number}` : 'Nueva cuenta de cobro'} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.clientId && total > 0) onSave({ ...f, items: f.items.filter((it) => it.amount > 0 || it.desc) }) }}>
        <div className="form-row">
          <Field label="Cliente">
            <select className="input" value={f.clientId} onChange={set('clientId')} required>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Número" hint={initial ? '' : 'Déjalo vacío para numerar automáticamente'}><input className="input" value={f.number} onChange={set('number')} placeholder="Automático" /></Field>
        </div>
        <Field label="Concepto general"><input className="input" value={f.concept} onChange={set('concept')} placeholder="Ej: Honorarios proceso ejecutivo - cuota 1" required /></Field>
        <div className="form-row">
          <Field label="Fecha de emisión"><input className="input" type="date" value={f.issueDate} onChange={set('issueDate')} required /></Field>
          <Field label="Fecha de vencimiento"><input className="input" type="date" value={f.dueDate} onChange={set('dueDate')} required /></Field>
        </div>

        <div className="items">
          <div className="items-head"><span>Detalle</span><span>Tipo</span><span className="num">Valor</span><span></span></div>
          {f.items.map((it, idx) => (
            <div key={idx} className="items-row">
              <input className="input" placeholder="Descripción" value={it.desc} onChange={(e) => setItem(idx, { desc: e.target.value })} />
              <select className="input" value={it.kind} onChange={(e) => setItem(idx, { kind: e.target.value })}>
                <option value="honorarios">Honorarios</option>
                <option value="gastos">Gasto reembolsable</option>
              </select>
              <MoneyInput value={it.amount} onChange={(n) => setItem(idx, { amount: n })} />
              <button type="button" className="btn-icon" aria-label="Quitar" onClick={() => setF({ ...f, items: f.items.filter((_, i) => i !== idx) })} disabled={f.items.length === 1}>×</button>
            </div>
          ))}
          <button type="button" className="btn btn-link" onClick={() => setF({ ...f, items: [...f.items, { desc: '', kind: 'gastos', amount: 0 }] })}>+ Agregar línea</button>
          <div className="items-total">
            <span>Honorarios: {cop(f.items.filter((i) => i.kind === 'honorarios').reduce((s, i) => s + (i.amount || 0), 0))}</span>
            <span>Gastos: {cop(f.items.filter((i) => i.kind === 'gastos').reduce((s, i) => s + (i.amount || 0), 0))}</span>
            <strong>Total: {cop(total)}</strong>
          </div>
        </div>

        {initial && initial.payments?.length > 0 && (
          <div className="payments">
            <h3>Abonos registrados ({cop(paid)})</h3>
            <ul>
              {initial.payments.map((p) => <li key={p.id}>{fmtDate(p.date)} · {cop(p.amount)} {p.note && <span className="muted">· {p.note}</span>}</li>)}
            </ul>
          </div>
        )}

        <Field label="Notas internas"><textarea className="input" rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        <div className="row-between">
          {onDelete ? <button type="button" className="btn btn-link text-danger" onClick={onDelete}>Eliminar</button> : <span />}
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function PaymentForm({ invoice, onClose, onSave }) {
  const balance = invoiceBalance(invoice)
  const [amount, setAmount] = useState(balance)
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  return (
    <Modal title={`Registrar pago · ${invoice.number}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (amount > 0) onSave({ amount, date, note }) }}>
        <p className="muted">Saldo pendiente: <strong>{cop(balance)}</strong>. El pago se suma automáticamente al saldo de la cuenta.</p>
        <div className="form-row">
          <Field label="Valor recibido"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Fecha"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Nota"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Transferencia Bancolombia" /></Field>
        {amount > balance && <p className="note note-warn">El valor supera el saldo. Se registrará como pago en exceso.</p>}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Registrar {cop(amount)}</button>
        </div>
      </form>
    </Modal>
  )
}
