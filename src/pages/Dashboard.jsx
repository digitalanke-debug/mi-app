import { useStore } from '../store/useStore.js'
import { cop, daysUntil, fmtDateShort, relativeDue, todayISO, addDaysISO } from '../lib/format.js'
import { computePriority, sortByPriority } from '../lib/priority.js'
import { agingBuckets, invoiceBalance, invoiceStatus } from '../lib/invoices.js'
import { Kpi, PriorityBadge, Empty } from '../components/ui.jsx'
import { totals, isLoan } from '../lib/accounts.js'

export default function Dashboard({ go }) {
  const { state, companyId, company, activeCompanies, scoped } = useStore()
  const t = totals(state, companyId)
  const balance = t.disponible
  const activeAccounts = scoped.accounts.filter((a) => a.active)
  const hoy = todayISO()
  const en30 = addDaysISO(hoy, 30)

  const pendientes = scoped.expenses.filter((e) => e.status !== 'pagado')
  const porPagar30 = pendientes.filter((e) => e.dueDate <= en30).reduce((s, e) => s + e.amount, 0)
  const prioritarias = sortByPriority(pendientes.filter((e) => computePriority(e) === 'alta'))
  const totalPrioritarias = prioritarias.reduce((s, e) => s + e.amount, 0)

  const porCobrar = scoped.invoices.reduce((s, i) => s + invoiceBalance(i), 0)
  const vencidas = scoped.invoices.filter((i) => invoiceStatus(i) === 'vencida')
  const totalVencido = vencidas.reduce((s, i) => s + invoiceBalance(i), 0)
  const porCobrar30 = scoped.invoices
    .filter((i) => invoiceBalance(i) > 0 && i.dueDate <= en30)
    .reduce((s, i) => s + invoiceBalance(i), 0)

  const proyeccion = balance - porPagar30
  const proyeccionOptimista = balance + porCobrar30 - porPagar30
  const aging = agingBuckets(scoped.invoices)
  const clientName = (id) => state.clients.find((c) => c.id === id)?.name ?? 'Cliente'

  const proximasCobros = scoped.invoices
    .filter((i) => invoiceBalance(i) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Panel</h1>
          <p className="muted">{company ? company.name : `Consolidado de ${activeCompanies.length} empresa${activeCompanies.length === 1 ? '' : 's'}`} · {fmtDateShort(hoy)}</p>
        </div>
      </header>

      <section className="kpis">
        <Kpi label="Saldo disponible" value={cop(balance)} tone={balance < 0 ? 'danger' : 'primary'} hint={t.deudas > 0 ? `Deudas: ${cop(t.deudas)} · Neto: ${cop(t.neto)}` : `En ${activeAccounts.length} cuenta${activeAccounts.length === 1 ? '' : 's'}`} />
        <Kpi label="Por cobrar a clientes" value={cop(porCobrar)} hint={totalVencido > 0 ? `${cop(totalVencido)} vencido` : 'Nada vencido'} tone={totalVencido > 0 ? 'warn' : undefined} />
        <Kpi label="Por pagar (30 días)" value={cop(porPagar30)} hint={`${prioritarias.length} prioritaria${prioritarias.length === 1 ? '' : 's'} por ${cop(totalPrioritarias)}`} tone={prioritarias.length ? 'danger' : undefined} />
        <Kpi
          label="Si pago todo lo de 30 días"
          value={cop(proyeccion)}
          hint={`Si además cobro lo que vence: ${cop(proyeccionOptimista)}`}
          tone={proyeccion < 0 ? 'danger' : 'ok'}
        />
      </section>

      {companyId === 'all' && activeCompanies.length > 1 && (
        <section className="card">
          <div className="card-head"><h2>Por empresa</h2><span className="muted small">Cada empresa con su caja, su cartera y sus pagos</span></div>
          <table className="table">
            <thead><tr><th>Empresa</th><th className="num">Disponible</th><th className="num">Por cobrar</th><th className="num">Vencido</th><th className="num">Por pagar 30 días</th><th className="num">Prioritarias</th></tr></thead>
            <tbody>
              {activeCompanies.map((c) => {
                const tc = totals(state, c.id)
                const inv = state.invoices.filter((i) => i.companyId === c.id)
                const exp = state.expenses.filter((e) => e.companyId === c.id && e.status !== 'pagado')
                const pri = exp.filter((e) => computePriority(e) === 'alta')
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td className="num">{cop(tc.disponible)}</td>
                    <td className="num">{cop(inv.reduce((s, i) => s + invoiceBalance(i), 0))}</td>
                    <td className="num text-danger">{cop(inv.filter((i) => invoiceStatus(i) === 'vencida').reduce((s, i) => s + invoiceBalance(i), 0))}</td>
                    <td className="num">{cop(exp.filter((e) => e.dueDate <= en30).reduce((s, e) => s + e.amount, 0))}</td>
                    <td className="num">{pri.length ? <span className="badge badge-danger">{pri.length} · {cop(pri.reduce((s, e) => s + e.amount, 0))}</span> : <span className="muted">0</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {activeAccounts.length > 1 && (
        <div className="account-strip">
          {activeAccounts.map((a) => (
            <span key={a.id} className={isLoan(a) ? 'text-danger' : ''}>{a.name}: <strong>{isLoan(a) ? `debe ${cop(Math.max(0, -(t.porCuenta[a.id] || 0)))}` : cop(t.porCuenta[a.id] || 0)}</strong></span>
          ))}
          <button type="button" className="btn btn-link btn-sm" onClick={() => go('caja')}>Ver caja</button>
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Pagos prioritarios</h2>
            <button type="button" className="btn btn-link" onClick={() => go('pagar')}>Ir a cuentas por pagar</button>
          </div>
          {prioritarias.length === 0 ? (
            <Empty title="Sin pagos urgentes" text="Ninguna cuenta por pagar está en prioridad alta." />
          ) : (
            <ul className="list">
              {prioritarias.map((e) => (
                <li key={e.id} className="list-item">
                  <div className="list-main">
                    <strong>{e.concept}</strong>
                    <span className="muted">{e.supplier} · {relativeDue(e.dueDate)}</span>
                  </div>
                  <div className="list-side">
                    <span className="amount">{cop(e.amount)}</span>
                    <PriorityBadge level="alta" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {prioritarias.length > 0 && (
            <p className={`note ${totalPrioritarias > balance ? 'note-danger' : 'note-ok'}`}>
              {totalPrioritarias > balance
                ? `Faltan ${cop(totalPrioritarias - balance)} para cubrir todo lo prioritario.`
                : `Con el saldo actual alcanza para todo lo prioritario y quedan ${cop(balance - totalPrioritarias)}.`}
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Próximos cobros</h2>
            <button type="button" className="btn btn-link" onClick={() => go('clientes')}>Ver clientes</button>
          </div>
          {proximasCobros.length === 0 ? (
            <Empty title="Nada por cobrar" text="Todas las cuentas de cobro están pagadas." />
          ) : (
            <ul className="list">
              {proximasCobros.map((i) => {
                const d = daysUntil(i.dueDate)
                return (
                  <li key={i.id} className="list-item">
                    <div className="list-main">
                      <strong>{clientName(i.clientId)}</strong>
                      <span className="muted">{i.number} · {relativeDue(i.dueDate)}</span>
                    </div>
                    <div className="list-side">
                      <span className="amount">{cop(invoiceBalance(i))}</span>
                      <span className={`dot ${d < 0 ? 'dot-danger' : d <= 7 ? 'dot-warn' : 'dot-ok'}`} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Antigüedad de cartera</h2>
          <span className="muted">Cuánto deben los clientes según el tiempo vencido</span>
        </div>
        <div className="aging">
          {[
            ['Al día', aging.alDia, 'ok'],
            ['1 a 30 días', aging.d1a30, 'warn'],
            ['31 a 60 días', aging.d31a60, 'warn'],
            ['61 a 90 días', aging.d61a90, 'danger'],
            ['Más de 90', aging.mas90, 'danger'],
          ].map(([label, val, tone]) => (
            <div key={label} className={`aging-cell aging-${tone}`}>
              <div className="aging-label">{label}</div>
              <div className="aging-value">{cop(val)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
