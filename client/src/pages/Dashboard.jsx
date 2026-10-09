import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api, fmtMoney, SOURCE_LABEL, getToken } from '../api.js'
import { Icon } from '../components/Icons.jsx'

function Bars({ title, rows, label = (r) => r.name }) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2></div>
      <div className="card-body bars">
        {rows.length === 0 && <div className="muted">Sin datos</div>}
        {rows.slice(0, 8).map((r) => (
          <div key={r.name} className="bar-row" title={`${label(r)}: ${r.total} leads, ${r.won} ganados`}>
            <div className="lbl">{label(r)}</div>
            <div className="track"><div className="fill" style={{ width: `${(r.total / max) * 100}%` }} /></div>
            <div className="val">{r.total}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { companyId, company, companies } = useStore()
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [cmp, setCmp] = useState([])
  useEffect(() => { if (companyId) api('/dashboard', { params: { company_id: companyId, days } }).then(setD) }, [companyId, days])
  useEffect(() => { if (companies.length > 1) api('/dashboard/compare', { params: { days } }).then(setCmp).catch(() => {}) }, [companies.length, days])
  const exportCsv = () => { const a = document.createElement('a'); a.href = `/api/dashboard/export?company_id=${companyId}&days=${days}&t=${getToken()}`; a.download = ''; a.click() }
  if (!d) return <div className="page"><div className="empty">Cargando…</div></div>
  const k = d.kpis
  const maxDay = Math.max(1, ...d.series.map((s) => s.n))
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Dashboard · {company?.name}</h1><div className="sub">Rendimiento comercial de la empresa activa.</div></div>
        <div className="actions"><div className="filters">{[7, 30, 90].map((n) => <button key={n} className={days === n ? 'active' : ''} onClick={() => setDays(n)}>Últimos {n} días</button>)}</div>
          <button className="btn" onClick={exportCsv}><Icon name="download" size={15} /> Exportar leads (CSV)</button></div>
      </div>
      <div className="grid-4">
        <div className="card kpi"><div className="v">{k.total}</div><div className="k">Leads nuevos</div><div className="d">{k.open} abiertos ahora</div></div>
        <div className="card kpi"><div className="v">{k.conversionRate}%</div><div className="k">Conversión</div><div className="d">{k.won} ganados · {k.lost} perdidos</div></div>
        <div className="card kpi"><div className="v" style={{ color: k.avgFirstResponseMin > 30 ? 'var(--danger)' : 'var(--success)' }}>{k.avgFirstResponseMin ?? '—'} min</div><div className="k">Primera respuesta promedio</div><div className="d">{k.noReply} leads sin responder</div></div>
        <div className="card kpi"><div className="v">{fmtMoney(k.valueWon)}</div><div className="k">Valor ganado</div><div className="d">{fmtMoney(k.pipelineValue)} en pipeline</div></div>
      </div>
      <div className="grid-4">
        <div className="card kpi"><div className="v" style={{ color: k.unassigned ? 'var(--warn)' : undefined }}>{k.unassigned}</div><div className="k">Sin asignar</div></div>
        <div className="card kpi"><div className="v">{k.aiReplies}</div><div className="k">Respuestas del agente IA</div></div>
        <div className="card kpi"><div className="v">{k.automationRuns}</div><div className="k">Automatizaciones ejecutadas</div></div>
        <div className="card kpi"><div className="v">{d.messagesBySender.find((m) => m.sender === 'contact')?.n || 0}</div><div className="k">Mensajes recibidos</div><div className="d">{d.messagesBySender.filter((m) => m.sender !== 'contact').reduce((a, m) => a + m.n, 0)} enviados</div></div>
      </div>
      {(k.totalSpend > 0 || d.byCampaign.some((c) => c.cost > 0)) && <div className="grid-3">
        <div className="card kpi"><div className="v">{fmtMoney(k.totalSpend)}</div><div className="k">Inversión en anuncios</div><div className="d">Google Ads y Meta Ads en el periodo</div></div>
        <div className="card kpi"><div className="v">{k.cplGlobal != null ? fmtMoney(k.cplGlobal) : '—'}</div><div className="k">Costo por lead (pagado)</div><div className="d">{k.paidLeads} leads de anuncios</div></div>
        <div className="card kpi"><div className="v">{k.totalSpend && k.valueWon ? `${(k.valueWon / k.totalSpend).toFixed(1)}x` : '—'}</div><div className="k">Retorno sobre inversión</div><div className="d">valor ganado / inversión</div></div>
      </div>}
      <div className="card">
        <div className="card-head"><h2>Leads por día</h2></div>
        <div className="card-body"><div className="cols">{d.series.map((s) => <div key={s.date} className="c" style={{ height: `${(s.n / maxDay) * 100}%` }} data-l={`${s.date}: ${s.n}`} />)}</div>
          {d.series.length === 0 && <div className="muted">Sin datos en el periodo</div>}</div>
      </div>
      <div className="grid-3">
        <Bars title="Por origen" rows={d.bySource} label={(r) => SOURCE_LABEL[r.name] || r.name} />
        <Bars title="Por campaña" rows={d.byCampaign} />
        <Bars title="Por etapa" rows={d.byStage} />
      </div>
      <div className="grid-2">
        <Bars title="Por asesor" rows={d.byAgent} />
        <Bars title="Por servicio" rows={d.byService} />
      </div>
      <div className="card">
        <div className="card-head"><h2>Campañas: leads, inversión y costo por lead</h2><div className="actions small muted">Registra la inversión en Configuración → Marketing</div></div>
        <table className="table"><thead><tr><th>Campaña</th><th>Leads</th><th>Ganados</th><th>Inversión</th><th>Costo por lead</th><th>Costo por cierre</th></tr></thead>
          <tbody>{d.byCampaign.filter((r) => r.name !== 'sin dato').map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.total}</td><td>{r.won}</td><td>{r.cost ? fmtMoney(r.cost) : '—'}</td><td>{r.cpl != null ? fmtMoney(r.cpl) : '—'}</td><td>{r.cpa != null ? fmtMoney(r.cpa) : '—'}</td></tr>)}
          {d.byCampaign.filter((r) => r.name !== 'sin dato').length === 0 && <tr><td colSpan={6} className="muted">Sin leads con campaña en el periodo</td></tr>}</tbody></table>
      </div>
      {cmp.length > 1 && <div className="card">
        <div className="card-head"><h2>Comparativo entre empresas</h2></div>
        <table className="table compare-table"><thead><tr><th>Empresa</th><th>Leads</th><th>Abiertos</th><th>Ganados</th><th>Conversión</th><th>1ª respuesta</th><th>Valor ganado</th><th>Inversión</th><th>Mensajes recibidos</th></tr></thead>
          <tbody>{cmp.map((c) => { const max = Math.max(1, ...cmp.map((x) => x.total)); return (
            <tr key={c.id}><td><span className="chip tag" style={{ background: c.color }}>{c.name}</span></td>
              <td className="bar"><div className="bar-row" style={{ gridTemplateColumns: '1fr 30px' }}><div className="track"><div className="fill" style={{ width: `${(c.total / max) * 100}%` }} /></div><div className="val">{c.total}</div></div></td>
              <td>{c.open}</td><td>{c.won}</td><td>{c.conversionRate}%</td><td>{c.avgFirstResponseMin ?? '—'} min</td><td>{fmtMoney(c.valueWon)}</td><td>{c.spend ? fmtMoney(c.spend) : '—'}</td><td>{c.inbound}</td></tr>) })}</tbody></table>
      </div>}
      <div className="card">
        <div className="card-head"><h2>Tabla de conversión</h2></div>
        <table className="table"><thead><tr><th>Origen</th><th>Leads</th><th>Ganados</th><th>Tasa</th></tr></thead>
          <tbody>{d.bySource.map((r) => <tr key={r.name}><td>{SOURCE_LABEL[r.name] || r.name}</td><td>{r.total}</td><td>{r.won}</td><td>{r.total ? Math.round((r.won / r.total) * 100) : 0}%</td></tr>)}</tbody></table>
      </div>
    </div>
  )
}
