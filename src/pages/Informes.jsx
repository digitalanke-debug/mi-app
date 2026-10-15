import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { cop, fmtDate, monthKey, todayISO } from '../lib/format.js'
import { monthlyReport, lastMonths, monthLabel } from '../lib/reports.js'
import { downloadCSV } from '../lib/csv.js'
import { Kpi, Empty } from '../components/ui.jsx'

export default function Informes() {
  const { state, companyId, company, companies } = useStore()
  const [month, setMonth] = useState(monthKey(todayISO()))
  const months = useMemo(() => lastMonths(18), [])
  const r = useMemo(() => monthlyReport(state, companyId, month), [state, companyId, month])
  const companyName = (id) => companies.find((c) => c.id === id)?.name ?? ''

  function exportar() {
    const rows = [...r.gastosPagados.map((e) => ['Pagado', e.paidAt, e.concept, e.supplier, e.category, (e.tags || []).join(' | '), e.amount, companyName(e.companyId)]), ...r.gastosPendientes.map((e) => ['Pendiente', e.dueDate, e.concept, e.supplier, e.category, (e.tags || []).join(' | '), e.amount, companyName(e.companyId)])]
    downloadCSV(`gastos-${month}.csv`, ['Estado', 'Fecha', 'Concepto', 'Proveedor', 'Categoría', 'Etiquetas', 'Valor', 'Empresa'], rows)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Informe mensual</h1>
          <p className="muted">{company ? company.name : 'Todas las empresas'} · {monthLabel(month)}</p>
        </div>
        <div className="row">
          <select className="input input-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button type="button" className="btn" onClick={exportar}>Exportar gastos CSV</button>
        </div>
      </header>

      <section className="kpis">
        <Kpi label="Facturado en el mes" value={cop(r.facturado)} hint={`${r.facturas} cuenta${r.facturas === 1 ? '' : 's'} de cobro · honorarios ${cop(r.honorarios)}`} tone="primary" />
        <Kpi label="Cobrado en el mes" value={cop(r.cobrado)} hint={`${r.pagos} pago${r.pagos === 1 ? '' : 's'} recibido${r.pagos === 1 ? '' : 's'}`} tone="ok" />
        <Kpi label="Gastado en el mes" value={cop(r.totalGastosPagados + r.totalOtrosEgresos)} hint={r.totalGastosPendientes > 0 ? `Pendiente por pagar del mes: ${cop(r.totalGastosPendientes)}` : 'Nada pendiente del mes'} tone="warn" />
        <Kpi label="Resultado (cobrado − gastado)" value={cop(r.resultado)} hint={`Cartera pendiente total: ${cop(r.carteraPendiente)}`} tone={r.resultado < 0 ? 'danger' : 'ok'} />
      </section>

      {r.porEmpresa && (
        <section className="card">
          <div className="card-head"><h2>Por empresa</h2></div>
          <table className="table">
            <thead><tr><th>Empresa</th><th className="num">Facturado</th><th className="num">Cobrado</th><th className="num">Gastos pagados</th><th className="num">Pendiente del mes</th><th className="num">Resultado</th></tr></thead>
            <tbody>
              {r.porEmpresa.map((e) => (
                <tr key={e.empresaId}>
                  <td><strong>{e.empresa}</strong></td>
                  <td className="num">{cop(e.facturado)}</td>
                  <td className="num text-ok">{cop(e.cobrado)}</td>
                  <td className="num text-danger">{cop(e.gastosPagados)}</td>
                  <td className="num">{cop(e.gastosPendientes)}</td>
                  <td className={`num ${e.resultado < 0 ? 'text-danger' : 'text-ok'}`}><strong>{cop(e.resultado)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Gastos por rubro (etiqueta)</h2></div>
          {r.porEtiqueta.length === 0 ? <Empty title="Sin gastos en el mes" /> : <Bars rows={r.porEtiqueta} />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Gastos por categoría</h2></div>
          {r.porCategoria.length === 0 ? <Empty title="Sin gastos en el mes" /> : <Bars rows={r.porCategoria} />}
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Facturado por cliente</h2></div>
          {r.porCliente.length === 0 ? <Empty title="Nada facturado en el mes" /> : <Bars rows={r.porCliente} />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Cobrado por cliente</h2></div>
          {r.cobrosPorCliente.length === 0 ? <Empty title="Nada cobrado en el mes" /> : <Bars rows={r.cobrosPorCliente} />}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Detalle de gastos del mes</h2><span className="muted small">{r.gastosPagados.length} pagados · {r.gastosPendientes.length} pendientes</span></div>
        {r.gastosPagados.length + r.gastosPendientes.length === 0 ? <Empty title="Sin gastos en el mes" /> : (
          <table className="table">
            <thead><tr><th>Estado</th><th>Fecha</th><th>Concepto</th>{companyId === 'all' && <th>Empresa</th>}<th>Etiquetas</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {[...r.gastosPagados.map((e) => ({ ...e, _st: 'Pagado', _d: e.paidAt })), ...r.gastosPendientes.map((e) => ({ ...e, _st: 'Pendiente', _d: e.dueDate }))].sort((a, b) => (a._d || '').localeCompare(b._d || '')).map((e) => (
                <tr key={e.id}>
                  <td><span className={`badge ${e._st === 'Pagado' ? 'badge-ok' : 'badge-neutral'}`}>{e._st}</span></td>
                  <td>{fmtDate(e._d)}</td>
                  <td><strong>{e.concept}</strong><div className="muted small">{e.supplier}{e.category ? ` · ${e.category}` : ''}</div></td>
                  {companyId === 'all' && <td>{companyName(e.companyId)}</td>}
                  <td>{(e.tags || []).map((t) => <span key={t} className="badge badge-info" style={{ marginRight: 4 }}>{t}</span>)}</td>
                  <td className="num">{cop(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Bars({ rows }) {
  const max = Math.max(...rows.map((r) => r.valor), 1)
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.nombre}>
          <div className="bars-label"><span>{r.nombre}</span><strong>{cop(r.valor)}</strong></div>
          <div className="bars-track"><div className="bars-fill" style={{ width: `${Math.max(2, (r.valor / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}
