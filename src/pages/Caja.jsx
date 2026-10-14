import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { cop, fmtDate, todayISO, monthKey } from '../lib/format.js'
import { downloadCSV } from '../lib/csv.js'
import { Modal, MoneyInput, Field, Empty, Confirm, Kpi } from '../components/ui.jsx'

export default function Caja() {
  const { state, dispatch, balance, resetToSeed, resetEmpty, exportJSON, importJSON, mode } = useStore()
  const [movModal, setMovModal] = useState(null)
  const [balanceModal, setBalanceModal] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [filterType, setFilterType] = useState('todos')
  const [month, setMonth] = useState('')
  const [settings, setSettings] = useState(state.settings)
  const fileRef = useRef(null)

  const movements = useMemo(
    () => [...state.cash.movements].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [state.cash.movements],
  )
  const months = useMemo(() => [...new Set(movements.map((m) => monthKey(m.date)))].sort().reverse(), [movements])
  const visibles = movements.filter((m) => (filterType === 'todos' || m.type === filterType) && (!month || monthKey(m.date) === month))

  const thisMonth = monthKey(todayISO())
  const ingresosMes = movements.filter((m) => m.type === 'ingreso' && monthKey(m.date) === thisMonth).reduce((s, m) => s + m.amount, 0)
  const egresosMes = movements.filter((m) => m.type === 'egreso' && monthKey(m.date) === thisMonth).reduce((s, m) => s + m.amount, 0)

  function exportar() {
    downloadCSV('movimientos-caja.csv', ['Fecha', 'Tipo', 'Descripción', 'Valor'], movements.map((m) => [m.date, m.type, m.description, m.type === 'egreso' ? -m.amount : m.amount]))
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Caja</h1>
          <p className="muted">Cuenta bancaria principal</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={exportar}>Exportar CSV</button>
          <button type="button" className="btn" onClick={() => setBalanceModal(true)}>Ajustar saldo</button>
          <button type="button" className="btn btn-primary" onClick={() => setMovModal({})}>+ Movimiento manual</button>
        </div>
      </header>

      <section className="kpis kpis-3">
        <Kpi label="Saldo actual" value={cop(balance)} tone={balance < 0 ? 'danger' : 'primary'} />
        <Kpi label="Ingresos del mes" value={cop(ingresosMes)} tone="ok" />
        <Kpi label="Egresos del mes" value={cop(egresosMes)} tone="warn" />
      </section>

      <section className="card">
        <div className="toolbar">
          <div className="row">
            {['todos', 'ingreso', 'egreso', 'ajuste'].map((t) => (
              <button key={t} type="button" className={`chip ${filterType === t ? 'active' : ''}`} onClick={() => setFilterType(t)}>
                {t === 'todos' ? 'Todos' : t === 'ingreso' ? 'Ingresos' : t === 'egreso' ? 'Egresos' : 'Ajustes'}
              </button>
            ))}
          </div>
          <select className="input input-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Todos los meses</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {visibles.length === 0 ? (
          <Empty title="Sin movimientos" text="Los pagos de clientes y de cuentas por pagar aparecen aquí automáticamente." />
        ) : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th className="num">Valor</th><th></th></tr></thead>
            <tbody>
              {visibles.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.date)}</td>
                  <td>{m.description}{m.ref && <span className="muted small"> · automático</span>}</td>
                  <td><span className={`badge ${m.type === 'ingreso' ? 'badge-ok' : m.type === 'egreso' ? 'badge-danger' : 'badge-neutral'}`}>{m.type === 'ingreso' ? 'Ingreso' : m.type === 'egreso' ? 'Egreso' : 'Ajuste'}</span></td>
                  <td className={`num ${m.type === 'egreso' ? 'text-danger' : m.type === 'ingreso' ? 'text-ok' : ''}`}>{m.type === 'egreso' ? '− ' : m.type === 'ingreso' ? '+ ' : ''}{cop(m.amount)}</td>
                  <td className="actions">
                    {!m.ref && <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => setConfirm({ text: `¿Eliminar el movimiento "${m.description}"?`, onYes: () => { dispatch({ type: 'cash/remove', id: m.id }); setConfirm(null) } })}>Eliminar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Configuración</h2></div>
        <form className="form" onSubmit={(e) => { e.preventDefault(); dispatch({ type: 'settings/update', settings }) }}>
          <div className="form-row">
            <Field label="Nombre de la firma"><input className="input" value={settings.firmName} onChange={(e) => setSettings({ ...settings, firmName: e.target.value })} /></Field>
            <Field label="Indicativo de país para WhatsApp"><input className="input" value={settings.countryCode} onChange={(e) => setSettings({ ...settings, countryCode: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <Field label="Plantilla de recordatorio" hint="Variables: {nombre} {numero} {valor} {fecha}">
            <textarea className="input" rows={3} value={settings.reminderTemplate} onChange={(e) => setSettings({ ...settings, reminderTemplate: e.target.value })} />
          </Field>
          <div className="row-end"><button type="submit" className="btn btn-primary">Guardar configuración</button></div>
        </form>

        <hr />
        <h3>Datos</h3>
        <p className="muted small">{mode === 'api' ? 'Los datos viven en el servidor y se respaldan automáticamente cada noche. Aquí puedes descargar una copia adicional.' : 'Los datos se guardan en este navegador. Haz respaldos periódicos hasta que conectemos la base de datos en la nube.'}</p>
        <div className="row wrap">
          <button type="button" className="btn" onClick={exportJSON}>Descargar respaldo</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Restaurar respaldo</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { importJSON(await f.text()) } catch { alert('El archivo no es un respaldo válido.') } e.target.value = '' }} />
          <button type="button" className="btn" onClick={() => setConfirm({ text: '¿Cargar los datos de ejemplo? Se perderá lo que hay ahora.', onYes: () => { resetToSeed(); setConfirm(null) } })}>Cargar datos de ejemplo</button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirm({ text: '¿Vaciar todo y empezar de cero? Esta acción no se puede deshacer.', onYes: () => { resetEmpty(); setConfirm(null) } })}>Vaciar todo</button>
        </div>
      </section>

      {movModal && (
        <MovementForm onClose={() => setMovModal(null)} onSave={(m) => { dispatch({ type: 'cash/movement', movement: m }); setMovModal(null) }} />
      )}
      {balanceModal && (
        <BalanceForm current={balance} onClose={() => setBalanceModal(false)} onSave={(b, d) => { dispatch({ type: 'cash/setBalance', balance: b, description: d }); setBalanceModal(false) }} />
      )}
      {confirm && <Confirm text={confirm.text} onYes={confirm.onYes} onNo={() => setConfirm(null)} />}
    </div>
  )
}

function MovementForm({ onClose, onSave }) {
  const [f, setF] = useState({ type: 'ingreso', amount: 0, date: todayISO(), description: '' })
  return (
    <Modal title="Movimiento manual" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.amount > 0 && f.description.trim()) onSave(f) }}>
        <p className="muted small">Úsalo para ingresos o egresos que no vienen de una cuenta de cobro ni de una cuenta por pagar (por ejemplo, un consignación de un socio).</p>
        <div className="form-row">
          <Field label="Tipo">
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="ingreso">Ingreso (entra dinero)</option>
              <option value="egreso">Egreso (sale dinero)</option>
            </select>
          </Field>
          <Field label="Fecha"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Valor"><MoneyInput value={f.amount} onChange={(n) => setF({ ...f, amount: n })} autoFocus /></Field>
        <Field label="Descripción"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function BalanceForm({ current, onClose, onSave }) {
  const [b, setB] = useState(current)
  const [d, setD] = useState('Ajuste según extracto bancario')
  return (
    <Modal title="Ajustar saldo" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave(b, d) }}>
        <p className="muted small">Escribe el saldo real de la cuenta. Se creará un ajuste por la diferencia ({cop(b - current)}).</p>
        <Field label="Saldo real en la cuenta"><MoneyInput value={b} onChange={setB} autoFocus /></Field>
        <Field label="Motivo"><input className="input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Ajustar</button>
        </div>
      </form>
    </Modal>
  )
}
