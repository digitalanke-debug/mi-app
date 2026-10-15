import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { cop, fmtDate, todayISO, monthKey } from '../lib/format.js'
import { totals, isLoan, defaultAccountId, accountName } from '../lib/accounts.js'
import { ACCOUNT_TYPES } from '../store/migrate.js'
import { downloadCSV } from '../lib/csv.js'
import { Modal, MoneyInput, Field, Empty, Confirm, Kpi, CompanyField } from '../components/ui.jsx'

export default function Caja() {
  const { state, dispatch, resetToSeed, resetEmpty, exportJSON, importJSON, mode, companyId, companies, scoped } = useStore()
  const [accountId, setAccountId] = useState('all')
  const companyName = (id) => companies.find((c) => c.id === id)?.name ?? ''
  const [movModal, setMovModal] = useState(null)
  const [balanceModal, setBalanceModal] = useState(null)
  const [transferModal, setTransferModal] = useState(false)
  const [accountModal, setAccountModal] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [filterType, setFilterType] = useState('todos')
  const [month, setMonth] = useState('')
  const [settings, setSettings] = useState(state.settings)
  const fileRef = useRef(null)

  const t = useMemo(() => totals(state, companyId), [state, companyId])
  const activeAccounts = scoped.accounts.filter((a) => a.active)
  const inactiveAccounts = scoped.accounts.filter((a) => !a.active)
  const scopedIds = useMemo(() => new Set(scoped.accounts.map((a) => a.id)), [scoped.accounts])
  const selected = accountId === 'all' ? null : state.accounts.find((a) => a.id === accountId)

  const movements = useMemo(
    () => state.cash.movements.filter((m) => scopedIds.has(m.accountId)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [state.cash.movements, scopedIds],
  )
  const months = useMemo(() => [...new Set(movements.map((m) => monthKey(m.date)))].sort().reverse(), [movements])
  const visibles = movements.filter(
    (m) => (accountId === 'all' || m.accountId === accountId) && (filterType === 'todos' || m.type === filterType) && (!month || monthKey(m.date) === month),
  )

  const thisMonth = monthKey(todayISO())
  const inScope = (m) => accountId === 'all' ? !isLoan(state.accounts.find((a) => a.id === m.accountId)) : m.accountId === accountId
  const ingresosMes = movements.filter((m) => inScope(m) && m.type === 'ingreso' && monthKey(m.date) === thisMonth && m.ref?.kind !== 'transfer').reduce((s, m) => s + m.amount, 0)
  const egresosMes = movements.filter((m) => inScope(m) && m.type === 'egreso' && monthKey(m.date) === thisMonth && m.ref?.kind !== 'transfer').reduce((s, m) => s + m.amount, 0)

  function exportar() {
    downloadCSV('movimientos-caja.csv', ['Fecha', 'Cuenta', 'Tipo', 'Descripción', 'Valor'], movements.map((m) => [m.date, accountName(state, m.accountId), m.type, m.description, m.type === 'egreso' ? -m.amount : m.amount]))
  }

  const headBalance = selected ? t.porCuenta[selected.id] || 0 : t.disponible

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Caja y cuentas</h1>
          <p className="muted">Disponible en todas las cuentas: <strong>{cop(t.disponible)}</strong>{t.deudas > 0 && <> · Deudas: <strong className="text-danger">{cop(t.deudas)}</strong></>}</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn" onClick={exportar}>Exportar CSV</button>
          <button type="button" className="btn" onClick={() => setAccountModal({})}>+ Cuenta</button>
          <button type="button" className="btn" onClick={() => setTransferModal(true)} disabled={activeAccounts.length < 2}>Traslado entre cuentas</button>
          <button type="button" className="btn btn-primary" onClick={() => setMovModal({})}>+ Movimiento manual</button>
        </div>
      </header>

      <div className="accounts">
        <button type="button" className={`account-card ${accountId === 'all' ? 'active' : ''}`} onClick={() => setAccountId('all')}>
          <div className="account-name">Todas las cuentas</div>
          <div className="account-balance">{cop(t.disponible)}</div>
          <div className="muted small">{t.deudas > 0 ? `Neto con deudas: ${cop(t.neto)}` : `${activeAccounts.length} cuenta${activeAccounts.length === 1 ? '' : 's'}`}</div>
        </button>
        {activeAccounts.map((a) => {
          const b = t.porCuenta[a.id] || 0
          const loan = isLoan(a)
          return (
            <button type="button" key={a.id} className={`account-card ${accountId === a.id ? 'active' : ''} ${loan ? 'account-loan' : ''}`} onClick={() => setAccountId(a.id)}>
              <div className="account-name">{a.name}</div>
              <div className={`account-balance ${loan ? 'text-danger' : b < 0 ? 'text-danger' : ''}`}>{loan ? cop(Math.max(0, -b)) : cop(b)}</div>
              <div className="muted small">{companyId === 'all' ? companyName(a.companyId) : loan ? 'Saldo de la deuda' : ACCOUNT_TYPES[a.type] || a.type}</div>
            </button>
          )
        })}
      </div>

      <section className="kpis kpis-3">
        <Kpi label={selected ? (isLoan(selected) ? `Deuda · ${selected.name}` : `Saldo · ${selected.name}`) : 'Saldo disponible'} value={cop(selected && isLoan(selected) ? Math.max(0, -headBalance) : headBalance)} tone={selected && isLoan(selected) ? 'danger' : headBalance < 0 ? 'danger' : 'primary'} />
        <Kpi label={selected && isLoan(selected) ? 'Abonos del mes' : 'Ingresos del mes'} value={cop(selected && isLoan(selected) ? movements.filter((m) => m.accountId === selected.id && m.type === 'ingreso' && monthKey(m.date) === thisMonth).reduce((s, m) => s + m.amount, 0) : ingresosMes)} tone="ok" />
        <Kpi label={selected && isLoan(selected) ? 'Desembolsos del mes' : 'Egresos del mes'} value={cop(selected && isLoan(selected) ? movements.filter((m) => m.accountId === selected.id && m.type === 'egreso' && monthKey(m.date) === thisMonth).reduce((s, m) => s + m.amount, 0) : egresosMes)} tone="warn" />
      </section>

      {selected && (
        <div className="row wrap" style={{ marginBottom: 14 }}>
          <button type="button" className="btn btn-sm" onClick={() => setBalanceModal(selected)}>{isLoan(selected) ? 'Ajustar deuda' : 'Ajustar saldo'}</button>
          <button type="button" className="btn btn-sm" onClick={() => setAccountModal({ account: selected })}>Editar cuenta</button>
          {isLoan(selected) && <button type="button" className="btn btn-sm btn-primary" onClick={() => setTransferModal({ toId: selected.id })}>Registrar abono al préstamo</button>}
        </div>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="row wrap">
            {['todos', 'ingreso', 'egreso', 'ajuste'].map((ty) => (
              <button key={ty} type="button" className={`chip ${filterType === ty ? 'active' : ''}`} onClick={() => setFilterType(ty)}>
                {ty === 'todos' ? 'Todos' : ty === 'ingreso' ? 'Ingresos' : ty === 'egreso' ? 'Egresos' : 'Ajustes'}
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
            <thead><tr><th>Fecha</th><th>Descripción</th>{accountId === 'all' && <th>Cuenta</th>}<th>Tipo</th><th className="num">Valor</th><th></th></tr></thead>
            <tbody>
              {visibles.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.date)}</td>
                  <td>{m.description}{m.ref && m.ref.kind !== 'transfer' && <span className="muted small"> · automático</span>}</td>
                  {accountId === 'all' && <td>{accountName(state, m.accountId)}</td>}
                  <td><span className={`badge ${m.ref?.kind === 'transfer' ? 'badge-info' : m.type === 'ingreso' ? 'badge-ok' : m.type === 'egreso' ? 'badge-danger' : 'badge-neutral'}`}>{m.ref?.kind === 'transfer' ? 'Traslado' : m.type === 'ingreso' ? 'Ingreso' : m.type === 'egreso' ? 'Egreso' : 'Ajuste'}</span></td>
                  <td className={`num ${m.type === 'egreso' ? 'text-danger' : m.type === 'ingreso' ? 'text-ok' : ''}`}>{m.type === 'egreso' ? '− ' : m.type === 'ingreso' ? '+ ' : ''}{cop(m.amount)}</td>
                  <td className="actions">
                    {!m.ref && <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => setConfirm({ text: `¿Eliminar el movimiento "${m.description}"?`, onYes: () => { dispatch({ type: 'cash/remove', id: m.id }); setConfirm(null) } })}>Eliminar</button>}
                    {m.ref?.kind === 'transfer' && <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => setConfirm({ text: `¿Eliminar el traslado "${m.description}"? Se quitará de las dos cuentas.`, onYes: () => { dispatch({ type: 'cash/removeTransfer', id: m.ref.id }); setConfirm(null) } })}>Eliminar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {inactiveAccounts.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Cuentas inactivas</h2></div>
          <ul className="list">
            {inactiveAccounts.map((a) => (
              <li key={a.id} className="list-item">
                <div className="list-main"><strong>{a.name}</strong><span className="muted small">{ACCOUNT_TYPES[a.type]} · saldo {cop(t.porCuenta[a.id] || 0)}</span></div>
                <div className="list-side"><button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'account/update', id: a.id, account: { active: true } })}>Reactivar</button></div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <MovementForm accounts={activeAccounts} defaultId={selected?.id || defaultAccountId(state, companyId)} onClose={() => setMovModal(null)} onSave={(m) => { dispatch({ type: 'cash/movement', movement: m }); setMovModal(null) }} />
      )}
      {balanceModal && (
        <BalanceForm account={balanceModal} current={t.porCuenta[balanceModal.id] || 0} onClose={() => setBalanceModal(null)} onSave={(b, d) => { dispatch({ type: 'cash/setBalance', accountId: balanceModal.id, balance: b, description: d }); setBalanceModal(null) }} />
      )}
      {transferModal && (
        <TransferForm accounts={activeAccounts} balances={t.porCuenta} initialTo={transferModal.toId} initialFrom={selected && !isLoan(selected) ? selected.id : defaultAccountId(state, companyId)} onClose={() => setTransferModal(false)} onSave={(tr) => { dispatch({ type: 'cash/transfer', ...tr }); setTransferModal(false) }} />
      )}
      {accountModal && (
        <AccountForm
          companies={companies}
          showCompany={companyId === 'all' || !!accountModal.account}
          defaultCompanyId={companyId === 'all' ? companies.find((c) => c.active)?.id : companyId}
          initial={accountModal.account}
          onClose={() => setAccountModal(null)}
          onDeactivate={accountModal.account ? () => setConfirm({ text: `¿Desactivar la cuenta "${accountModal.account.name}"? Sus movimientos se conservan y deja de sumar en el total.`, onYes: () => { dispatch({ type: 'account/remove', id: accountModal.account.id }); setAccountModal(null); setAccountId('all'); setConfirm(null) } }) : null}
          onSave={(data, initial) => {
            if (accountModal.account) dispatch({ type: 'account/update', id: accountModal.account.id, account: data })
            else dispatch({ type: 'account/add', account: data, initialBalance: initial })
            setAccountModal(null)
          }}
        />
      )}
      {confirm && <Confirm text={confirm.text} onYes={confirm.onYes} onNo={() => setConfirm(null)} />}
    </div>
  )
}

export function AccountSelect({ accounts, value, onChange, balances, excludeLoans }) {
  const list = accounts.filter((a) => a.active && (!excludeLoans || !isLoan(a)))
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((a) => (
        <option key={a.id} value={a.id}>{a.name}{balances ? ` · ${isLoan(a) ? 'deuda ' + cop(Math.max(0, -(balances[a.id] || 0))) : cop(balances[a.id] || 0)}` : ''}</option>
      ))}
    </select>
  )
}

function MovementForm({ accounts, defaultId, onClose, onSave }) {
  const [f, setF] = useState({ type: 'ingreso', amount: 0, date: todayISO(), description: '', accountId: defaultId })
  return (
    <Modal title="Movimiento manual" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.amount > 0 && f.description.trim()) onSave(f) }}>
        <p className="muted small">Para ingresos o egresos que no vienen de una cuenta de cobro ni de una cuenta por pagar (por ejemplo, una consignación de un socio). Para mover plata entre cuentas usa "Traslado".</p>
        <div className="form-row">
          <Field label="Cuenta"><AccountSelect accounts={accounts} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} /></Field>
          <Field label="Tipo">
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="ingreso">Ingreso (entra dinero)</option>
              <option value="egreso">Egreso (sale dinero)</option>
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(n) => setF({ ...f, amount: n })} autoFocus /></Field>
          <Field label="Fecha"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Descripción"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function BalanceForm({ account, current, onClose, onSave }) {
  const loan = isLoan(account)
  const shown = loan ? Math.max(0, -current) : current
  const [b, setB] = useState(shown)
  const [d, setD] = useState(loan ? 'Ajuste según extracto del préstamo' : 'Ajuste según extracto bancario')
  const diff = loan ? b - shown : b - shown
  return (
    <Modal title={`${loan ? 'Ajustar deuda' : 'Ajustar saldo'} · ${account.name}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave(b, d) }}>
        <p className="muted small">Escribe {loan ? 'lo que realmente se debe hoy' : 'el saldo real de la cuenta'}. Se creará un ajuste por la diferencia ({cop(diff)}).</p>
        <Field label={loan ? 'Deuda real' : 'Saldo real en la cuenta'}><MoneyInput value={b} onChange={setB} autoFocus /></Field>
        <Field label="Motivo"><input className="input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Ajustar</button>
        </div>
      </form>
    </Modal>
  )
}

function TransferForm({ accounts, balances, initialFrom, initialTo, onClose, onSave }) {
  const [f, setF] = useState({ fromId: initialFrom || accounts[0]?.id, toId: initialTo || accounts.find((a) => a.id !== (initialFrom || accounts[0]?.id))?.id || '', amount: 0, date: todayISO(), description: '' })
  const to = accounts.find((a) => a.id === f.toId)
  const from = accounts.find((a) => a.id === f.fromId)
  const title = to && isLoan(to) ? 'Abono al préstamo' : from && isLoan(from) ? 'Desembolso del préstamo' : 'Traslado entre cuentas'
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.amount > 0 && f.fromId !== f.toId) onSave(f) }}>
        <div className="form-row">
          <Field label="Sale de"><AccountSelect accounts={accounts} balances={balances} value={f.fromId} onChange={(v) => setF({ ...f, fromId: v })} /></Field>
          <Field label="Entra a"><AccountSelect accounts={accounts} balances={balances} value={f.toId} onChange={(v) => setF({ ...f, toId: v })} /></Field>
        </div>
        <div className="form-row">
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(n) => setF({ ...f, amount: n })} autoFocus /></Field>
          <Field label="Fecha"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Descripción (opcional)"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={to && isLoan(to) ? 'Ej: Cuota octubre' : 'Ej: Reposición caja menor'} /></Field>
        {f.fromId === f.toId && <p className="note note-warn">Elige dos cuentas distintas.</p>}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Registrar {cop(f.amount)}</button>
        </div>
      </form>
    </Modal>
  )
}

function AccountForm({ initial, companies, showCompany, defaultCompanyId, onClose, onSave, onDeactivate }) {
  const [f, setF] = useState(initial ? { name: initial.name, type: initial.type, companyId: initial.companyId } : { name: '', type: 'banco', companyId: defaultCompanyId })
  const [initialBalance, setInitialBalance] = useState(0)
  return (
    <Modal title={initial ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSave(f, initialBalance) }}>
        <CompanyField companies={companies} value={f.companyId} onChange={(v) => setF({ ...f, companyId: v })} show={showCompany} />
        <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="Ej: Bancolombia, Davivienda, Caja menor, Préstamo" /></Field>
        <Field label="Tipo" hint="Los préstamos se muestran como deuda y restan en el neto, pero no en el disponible.">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {!initial && <Field label={f.type === 'prestamo' ? 'Deuda actual' : 'Saldo actual'} hint="Lo que hay hoy. Después se ajusta cuando quieras."><MoneyInput value={initialBalance} onChange={setInitialBalance} /></Field>}
        <div className="row-between">
          {onDeactivate ? <button type="button" className="btn btn-link text-danger" onClick={onDeactivate}>Desactivar</button> : <span />}
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
