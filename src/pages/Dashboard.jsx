import { useStore } from '../store/useStore.js'
import { cop, daysUntil, fmtDateShort, relativeDue, todayISO, addDaysISO } from '../lib/format.js'
import { computePriority, sortByPriority } from '../lib/priority.js'
import { agingBuckets, invoiceBalance, invoiceStatus } from '../lib/invoices.js'
import { Kpi, PriorityBadge, Empty } from '../components/ui.jsx'

export default function Dashboard({ go }) {
  const { state, balance } = useStore()
  const hoy = todayISO()
  const en30 = addDaysISO(hoy, 30)

  const pendientes = state.expenses.filter((e) => e.status !== 'pagado')
  const porPagar30 = pendientes.filter((e) => e.dueDate <= en30).reduce((s, e) => s + e.amount, 0)
  const prioritarias = sortByPriority(pendientes.filter((e) => computePriority(e) === 'alta'))
  const totalPrioritarias = prioritarias.reduce((s, e) => s + e.amount, 0)

  const porCobrar = state.invoices.reduce((s, i) => s + invoiceBalance(i), 0)
  const vencidas = state.invoices.filter((i) => invoiceStatus(i) === 'vencida')
  const totalVencido = vencidas.reduce((s, i) => s + invoiceBalance(i), 0)
  const porCobrar30 = state.invoices
    .filter((i) => invoiceBalance(i) > 0 && i.dueDate <= en30)
    .reduce((s, i) => s + invoiceBalance(i), 0)

  const proyeccion = balance - porPagar30
  const proyeccionOptimista = balance + porCobrar30 - porPagar30
  const aging = agingBuckets(state.invoices)
  const clientName = (id) => state.clients.find((c) => c.id === id)?.name ?? 'Cliente'

  const proximasCobros = state.invoices
    .filter((i) => invoiceBalance(i) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Panel</h1>
          <p className="muted">Resumen de {state.settings.firmName} al {fmtDateShort(hoy)}</p>
        </div>
      </header>

      <section className="kpis">
        <Kpi label="Saldo en cuenta" value={cop(balance)} tone={balance < 0 ? 'danger' : 'primary'} hint="Lo que hay hoy" />
        <Kpi label="Por cobrar a clientes" value={cop(porCobrar)} hint={totalVencido > 0 ? `${cop(totalVencido)} vencido` : 'Nada vencido'} tone={totalVencido > 0 ? 'warn' : undefined} />
        <Kpi label="Por pagar (30 días)" value={cop(porPagar30)} hint={`${prioritarias.length} prioritaria${prioritarias.length === 1 ? '' : 's'} por ${cop(totalPrioritarias)}`} tone={prioritarias.length ? 'danger' : undefined} />
        <Kpi
          label="Si pago todo lo de 30 días"
          value={cop(proyeccion)}
          hint={`Si además cobro lo que vence: ${cop(proyeccionOptimista)}`}
          tone={proyeccion < 0 ? 'danger' : 'ok'}
        />
      </section>

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
