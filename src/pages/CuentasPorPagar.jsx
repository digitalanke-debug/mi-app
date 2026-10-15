import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { cop, fmtDate, todayISO, addDaysISO, relativeDue } from '../lib/format.js'
import { computePriority, priorityReason, sortByPriority } from '../lib/priority.js'
import { downloadCSV } from '../lib/csv.js'
import { Modal, PriorityBadge, MoneyInput, Field, Empty, Confirm, StatusBadge } from '../components/ui.jsx'
import { AccountSelect } from './Caja.jsx'
import { defaultAccountId, totals, accountName } from '../lib/accounts.js'

const CATEGORIES = ['Arriendo', 'Servicios', 'Nómina', 'Honorarios', 'Software', 'Oficina', 'Gastos de procesos', 'Impuestos', 'Financiero', 'Mantenimiento', 'Otros']

export default function CuentasPorPagar() {
  const { state, dispatch } = useStore()
  const [accountId, setAccountId] = useState(() => defaultAccountId(state))
  const t = totals(state)
  const balance = t.porCuenta[accountId] || 0
  const [tab, setTab] = useState('pendientes') // pendientes | pagadas | fijos
  const [selected, setSelected] = useState(() => new Set())
  const [expenseModal, setExpenseModal] = useState(null)
  const [ruleModal, setRuleModal] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [payDate, setPayDate] = useState(todayISO())
  const [filterPriority, setFilterPriority] = useState('todas')

  const pendientes = useMemo(() => sortByPriority(state.expenses.filter((e) => e.status !== 'pagado')), [state.expenses])
  const visibles = pendientes.filter((e) => filterPriority === 'todas' || computePriority(e) === filterPriority)
  const pagadas = useMemo(() => state.expenses.filter((e) => e.status === 'pagado').sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || '')), [state.expenses])

  const selectedList = pendientes.filter((e) => selected.has(e.id))
  const totalSel = selectedList.reduce((s, e) => s + e.amount, 0)
  const restante = balance - totalSel
  const totalPend = pendientes.reduce((s, e) => s + e.amount, 0)
  const totalAlta = pendientes.filter((e) => computePriority(e) === 'alta').reduce((s, e) => s + e.amount, 0)

  function toggle(id) {
    const n = new Set(selected)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setSelected(n)
  }
  function selectPriority(level) {
    setSelected(new Set(pendientes.filter((e) => computePriority(e) === level).map((e) => e.id)))
  }
  /** Selecciona por prioridad y fecha hasta donde alcance el saldo */
  function selectWhatFits() {
    const n = new Set()
    let acc = 0
    for (const e of pendientes) {
      if (acc + e.amount <= balance) {
        n.add(e.id)
        acc += e.amount
      }
    }
    setSelected(n)
  }
  function pagarSeleccionados() {
    dispatch({ type: 'expense/pay', ids: [...selected], date: payDate, accountId })
    setSelected(new Set())
    setConfirm(null)
  }
  function exportar() {
    const rows = state.expenses.map((e) => [e.concept, e.supplier, e.category, e.dueDate, e.amount, e.status === 'pagado' ? 'Pagado' : 'Pendiente', e.status === 'pagado' ? '' : computePriority(e), e.paidAt || '', e.recurringId ? 'Sí' : 'No'])
    downloadCSV('cuentas-por-pagar.csv', ['Concepto', 'Proveedor', 'Categoría', 'Vence', 'Valor', 'Estado', 'Prioridad', 'Pagado el', 'Gasto fijo'], rows)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Cuentas por pagar</h1>
          <p className="muted">Pendiente: <strong>{cop(totalPend)}</strong> · Prioritario: <strong className="text-danger">{cop(totalAlta)}</strong></p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={exportar}>Exportar CSV</button>
          <button type="button" className="btn" onClick={() => setRuleModal({})}>+ Gasto fijo</button>
          <button type="button" className="btn btn-primary" onClick={() => setExpenseModal({})}>+ Cuenta por pagar</button>
        </div>
      </header>

      <div className="tabs">
        <button type="button" className={tab === 'pendientes' ? 'active' : ''} onClick={() => setTab('pendientes')}>Pendientes ({pendientes.length})</button>
        <button type="button" className={tab === 'pagadas' ? 'active' : ''} onClick={() => setTab('pagadas')}>Pagadas ({pagadas.length})</button>
        <button type="button" className={tab === 'fijos' ? 'active' : ''} onClick={() => setTab('fijos')}>Gastos fijos ({state.recurring.length})</button>
      </div>

      {tab === 'pendientes' && (
        <div className="split split-calc">
          <section className="card">
            <div className="toolbar">
              <div className="row">
                <span className="muted">Mostrar:</span>
                {['todas', 'alta', 'media', 'baja'].map((p) => (
                  <button key={p} type="button" className={`chip ${filterPriority === p ? 'active' : ''}`} onClick={() => setFilterPriority(p)}>
                    {p === 'todas' ? 'Todas' : p === 'alta' ? 'Prioritarias' : p === 'media' ? 'Media' : 'Baja'}
                  </button>
                ))}
              </div>
            </div>
            {visibles.length === 0 ? (
              <Empty title="Nada pendiente" text="No hay cuentas por pagar en este filtro." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Concepto</th>
                    <th>Vence</th>
                    <th>Prioridad</th>
                    <th className="num">Valor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((e) => {
                    const p = computePriority(e)
                    return (
                      <tr key={e.id} className={selected.has(e.id) ? 'selected' : ''}>
                        <td><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Seleccionar ${e.concept}`} /></td>
                        <td>
                          <strong>{e.concept}</strong>
                          <div className="muted small">{e.supplier}{e.category ? ` · ${e.category}` : ''}{e.recurringId ? ' · fijo' : ''}</div>
                        </td>
                        <td>{fmtDate(e.dueDate)}<div className="muted small">{relativeDue(e.dueDate)}</div></td>
                        <td><PriorityBadge level={p} /><div className="muted small">{priorityReason(e)}</div></td>
                        <td className="num"><strong>{cop(e.amount)}</strong></td>
                        <td className="actions">
                          <button type="button" className="btn btn-sm" onClick={() => setExpenseModal({ expense: e })}>Editar</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>

          <aside className="card calc">
            <h2>Calculadora de pagos</h2>
            <p className="muted small">Marca lo que vas a pagar y mira cómo queda la cuenta.</p>
            <Field label="Pagar desde"><AccountSelect accounts={state.accounts} balances={t.porCuenta} value={accountId} onChange={setAccountId} excludeLoans /></Field>
            <div className="calc-row"><span>Saldo de la cuenta</span><strong>{cop(balance)}</strong></div>
            <div className="calc-row"><span>Seleccionado ({selectedList.length})</span><strong className="text-danger">− {cop(totalSel)}</strong></div>
            <div className={`calc-row calc-total ${restante < 0 ? 'text-danger' : 'text-ok'}`}><span>Quedaría</span><strong>{cop(restante)}</strong></div>
            {restante < 0 && <p className="note note-danger">No alcanza: faltan {cop(-restante)}.</p>}

            <div className="calc-quick">
              <span className="muted small">Selección rápida</span>
              <button type="button" className="btn btn-sm" onClick={() => selectPriority('alta')}>Solo prioritarias</button>
              <button type="button" className="btn btn-sm" onClick={selectWhatFits}>Lo que alcance con el saldo</button>
              <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(pendientes.map((e) => e.id)))}>Todo</button>
              <button type="button" className="btn btn-sm btn-link" onClick={() => setSelected(new Set())}>Limpiar</button>
            </div>

            {selectedList.length > 0 && (
              <ul className="calc-list">
                {selectedList.map((e) => (
                  <li key={e.id}><span>{e.concept}</span><span>{cop(e.amount)}</span></li>
                ))}
              </ul>
            )}

            <Field label="Fecha del pago"><input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={selectedList.length === 0}
              onClick={() => setConfirm({ text: `¿Registrar el pago de ${selectedList.length} cuenta${selectedList.length === 1 ? '' : 's'} por ${cop(totalSel)} desde ${accountName(state, accountId)}? Se descontará de esa cuenta.`, onYes: pagarSeleccionados })}
            >
              Registrar pago de {cop(totalSel)}
            </button>
          </aside>
        </div>
      )}

      {tab === 'pagadas' && (
        <section className="card">
          {pagadas.length === 0 ? (
            <Empty title="Aún no hay pagos" text="Cuando registres pagos aparecerán aquí." />
          ) : (
            <table className="table">
              <thead><tr><th>Concepto</th><th>Vencía</th><th>Pagado el</th><th className="num">Valor</th><th></th></tr></thead>
              <tbody>
                {pagadas.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.concept}</strong><div className="muted small">{e.supplier}</div></td>
                    <td>{fmtDate(e.dueDate)}</td>
                    <td>{fmtDate(e.paidAt)} <StatusBadge status="pagado" />{e.paidFromAccountId && <div className="muted small">desde {accountName(state, e.paidFromAccountId)}</div>}</td>
                    <td className="num">{cop(e.amount)}</td>
                    <td className="actions"><button type="button" className="btn btn-sm" onClick={() => setConfirm({ text: `¿Deshacer el pago de "${e.concept}"? Volverá a pendiente y se devolverá ${cop(e.amount)} al saldo.`, onYes: () => { dispatch({ type: 'expense/unpay', id: e.id }); setConfirm(null) } })}>Deshacer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'fijos' && (
        <section className="card">
          <p className="muted">Cada gasto fijo genera automáticamente su cuenta por pagar del mes actual y del siguiente.</p>
          {state.recurring.length === 0 ? (
            <Empty title="Sin gastos fijos" text="Registra el arriendo, servicios, nómina y demás gastos que se repiten cada mes." />
          ) : (
            <table className="table">
              <thead><tr><th>Concepto</th><th>Proveedor</th><th>Día de pago</th><th className="num">Valor mensual</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {state.recurring.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.concept}</strong><div className="muted small">{r.category}{r.cutsService ? ' · cortan el servicio' : ''}</div></td>
                    <td>{r.supplier}</td>
                    <td>Día {r.dayOfMonth}</td>
                    <td className="num">{cop(r.amount)}</td>
                    <td>{r.active ? <span className="badge badge-ok">Activo</span> : <span className="badge badge-neutral">Pausado</span>}</td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm" onClick={() => setRuleModal({ rule: r })}>Editar</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'recurring/update', id: r.id, rule: { active: !r.active } })}>{r.active ? 'Pausar' : 'Activar'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row-end" style={{ marginTop: 12 }}>
            <span className="muted small">Total fijo mensual: <strong>{cop(state.recurring.filter((r) => r.active).reduce((s, r) => s + r.amount, 0))}</strong></span>
          </div>
        </section>
      )}

      {expenseModal && (
        <ExpenseForm
          initial={expenseModal.expense}
          onClose={() => setExpenseModal(null)}
          onDelete={expenseModal.expense ? () => setConfirm({ text: `¿Eliminar "${expenseModal.expense.concept}"?`, onYes: () => { dispatch({ type: 'expense/remove', id: expenseModal.expense.id }); setExpenseModal(null); setConfirm(null) } }) : null}
          onSave={(data) => {
            if (expenseModal.expense) dispatch({ type: 'expense/update', id: expenseModal.expense.id, expense: data })
            else dispatch({ type: 'expense/add', expense: data })
            setExpenseModal(null)
          }}
        />
      )}

      {ruleModal && (
        <RuleForm
          initial={ruleModal.rule}
          onClose={() => setRuleModal(null)}
          onDelete={ruleModal.rule ? () => setConfirm({ text: `¿Eliminar el gasto fijo "${ruleModal.rule.concept}"? Se borrarán sus cuentas pendientes generadas.`, onYes: () => { dispatch({ type: 'recurring/remove', id: ruleModal.rule.id }); setRuleModal(null); setConfirm(null) } }) : null}
          onSave={(data) => {
            if (ruleModal.rule) dispatch({ type: 'recurring/update', id: ruleModal.rule.id, rule: data })
            else dispatch({ type: 'recurring/add', rule: data })
            setRuleModal(null)
          }}
        />
      )}

      {confirm && <Confirm text={confirm.text} onYes={confirm.onYes} onNo={() => setConfirm(null)} />}
    </div>
  )
}

function ExpenseForm({ initial, onClose, onSave, onDelete }) {
  const [f, setF] = useState(initial ? { ...initial } : { concept: '', supplier: '', category: 'Otros', amount: 0, dueDate: addDaysISO(todayISO(), 15), manualPriority: null, cutsService: false, hasInterest: false, notes: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const auto = computePriority({ ...f, manualPriority: null })
  return (
    <Modal title={initial ? 'Editar cuenta por pagar' : 'Nueva cuenta por pagar'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.concept.trim() && f.amount > 0) onSave(f) }}>
        <Field label="Concepto"><input className="input" value={f.concept} onChange={set('concept')} required autoFocus /></Field>
        <div className="form-row">
          <Field label="Proveedor"><input className="input" value={f.supplier} onChange={set('supplier')} /></Field>
          <Field label="Categoría">
            <select className="input" value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(n) => setF({ ...f, amount: n })} /></Field>
          <Field label="Fecha límite de pago"><input className="input" type="date" value={f.dueDate} onChange={set('dueDate')} required /></Field>
        </div>
        <div className="form-row">
          <label className="check"><input type="checkbox" checked={!!f.cutsService} onChange={set('cutsService')} /> Si no se paga cortan el servicio</label>
          <label className="check"><input type="checkbox" checked={!!f.hasInterest} onChange={set('hasInterest')} /> Genera intereses de mora</label>
        </div>
        <Field label="Prioridad" hint={`Calculada automáticamente: ${auto === 'alta' ? 'Prioritaria' : auto === 'media' ? 'Media' : 'Baja'}`}>
          <select className="input" value={f.manualPriority || ''} onChange={(e) => setF({ ...f, manualPriority: e.target.value || null })}>
            <option value="">Automática</option>
            <option value="alta">Forzar: Prioritaria</option>
            <option value="media">Forzar: Media</option>
            <option value="baja">Forzar: Baja</option>
          </select>
        </Field>
        <Field label="Notas"><input className="input" value={f.notes || ''} onChange={set('notes')} /></Field>
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

function RuleForm({ initial, onClose, onSave, onDelete }) {
  const [f, setF] = useState(initial ? { ...initial } : { concept: '', supplier: '', category: 'Servicios', amount: 0, dayOfMonth: 5, cutsService: false, active: true })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <Modal title={initial ? 'Editar gasto fijo' : 'Nuevo gasto fijo mensual'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.concept.trim() && f.amount > 0) onSave({ ...f, dayOfMonth: Math.min(31, Math.max(1, Number(f.dayOfMonth) || 1)) }) }}>
        <Field label="Concepto"><input className="input" value={f.concept} onChange={set('concept')} required autoFocus placeholder="Ej: Arriendo oficina" /></Field>
        <div className="form-row">
          <Field label="Proveedor"><input className="input" value={f.supplier} onChange={set('supplier')} /></Field>
          <Field label="Categoría">
            <select className="input" value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Valor mensual"><MoneyInput value={f.amount} onChange={(n) => setF({ ...f, amount: n })} /></Field>
          <Field label="Día del mes en que vence"><input className="input" type="number" min={1} max={31} value={f.dayOfMonth} onChange={set('dayOfMonth')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.cutsService} onChange={set('cutsService')} /> Si no se paga cortan el servicio (sube la prioridad)</label>
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
