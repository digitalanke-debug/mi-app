import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { api, fmtMoney, fmtDate, mediaSrc, adTitle, PLATFORM_LABEL } from '../api.js'
import { Icon } from '../components/Icons.jsx'

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')

/** Lectura rápida de cada anuncio con los datos del CRM. Las reglas se explican debajo de la tabla. */
function verdict(a) {
  if (a.leads === 0) return a.spend > 0 ? ['bad', 'Gasta y no trae chats'] : ['new', 'Sin chats']
  if (a.won > 0) return ['good', 'Trae clientes']
  if (a.leads < 5) return ['new', 'Pocos datos']
  const eng = a.engaged / a.leads
  if (eng >= 0.5) return ['good', 'Trae conversaciones']
  if (eng < 0.25) return ['bad', 'Escriben y no siguen']
  return ['mid', 'Regular']
}

export default function Ads() {
  const { companyId, company, user, toast } = useStore()
  const nav = useNavigate()
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(null)
  const load = useCallback(() => companyId && api('/marketing/ads', { params: { company_id: companyId, days } }).then(setD).catch((e) => toast(e.message, 'error')), [companyId, days, toast])
  useEffect(() => { setD(null); load() }, [load])

  const money = (n) => (d?.meta.currency && d.meta.currency !== 'COP'
    ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: d.meta.currency, maximumFractionDigits: 2 }).format(Number(n || 0)) : fmtMoney(n))
  const syncMeta = async () => {
    setBusy('sync')
    try { const r = await api('/marketing/integrations/meta-ads/sync', { method: 'POST', body: { company_id: companyId, days: Math.max(days, 30) } }); toast(`Meta Ads sincronizado: ${r.rows} registros de ${r.account || 'la cuenta'}`, 'success'); load() }
    catch (e) { toast(e.message, 'error'); load() } finally { setBusy(null) }
  }
  const backfill = async () => {
    setBusy('backfill')
    try { const r = await api('/marketing/ads/backfill', { method: 'POST', body: { company_id: companyId } }); toast(`Se revisaron ${r.scanned} mensajes: ${r.recorded} chats nuevos con anuncio identificado`, r.recorded ? 'success' : 'warn'); load() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  if (!d) return <div className="page"><div className="empty">Cargando…</div></div>
  const t = d.totals
  const connected = d.meta.status === 'connected'
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Anuncios · {company?.name}</h1><div className="sub">De qué anuncio de Meta llega cada persona y qué pasa después con ese chat.</div></div>
        <div className="actions">
          <div className="filters">{[7, 30, 90].map((n) => <button key={n} className={days === n ? 'active' : ''} onClick={() => setDays(n)}>Últimos {n} días</button>)}</div>
          {user.role === 'admin' && <button className="btn" disabled={busy === 'backfill'} onClick={backfill} title="Revisa los chats que ya están en el CRM"><Icon name="search" size={15} /> {busy === 'backfill' ? 'Buscando…' : 'Buscar en chats anteriores'}</button>}
          {user.role === 'admin' && d.meta.status !== 'disconnected' && <button className="btn" disabled={busy === 'sync'} onClick={syncMeta}><Icon name="sync" size={15} /> {busy === 'sync' ? 'Sincronizando…' : 'Actualizar gasto de Meta'}</button>}
        </div>
      </div>

      <div className="grid-4">
        <div className="card kpi"><div className="v">{t.conversations}</div><div className="k">Chats nuevos</div><div className="d">todos los orígenes</div></div>
        <div className="card kpi"><div className="v">{t.from_ads}</div><div className="k">Llegaron por un anuncio</div><div className="d">{pct(t.from_ads, t.conversations)} de los chats nuevos</div></div>
        <div className="card kpi"><div className="v">{connected ? money(t.spend) : '—'}</div><div className="k">Gasto en Meta</div><div className="d">{connected ? `${d.meta.account_name || 'cuenta conectada'} · ${d.meta.currency || ''}` : 'Meta Ads sin conectar'}</div></div>
        <div className="card kpi"><div className="v">{connected && t.from_ads ? money(t.spend / t.from_ads) : '—'}</div><div className="k">Costo por chat</div><div className="d">{t.won} clientes ganados · {fmtMoney(t.value_won)}</div></div>
      </div>

      {d.meta.status === 'disconnected' && <div className="alert info">Para ver <b>cuánto cuesta cada chat</b> y el <b>nombre del anuncio, el conjunto y la campaña</b> como aparecen en Meta, conecta la cuenta publicitaria en <a onClick={() => nav('/configuracion')} style={{ cursor: 'pointer' }}>Configuración → Meta Ads</a>. Sin esa conexión igual se ve de qué anuncio llega cada persona.</div>}
      {d.meta.status === 'error' && <div className="alert">Meta Ads no pudo sincronizar: {d.meta.last_error}</div>}

      <div className="card">
        <div className="card-head"><h2>Resultados por anuncio</h2><div className="actions small muted">{connected && d.meta.last_sync_at ? `Gasto actualizado: ${fmtDate(d.meta.last_sync_at)}` : ''}</div></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table ads-table">
            <thead><tr><th></th><th>Anuncio</th><th>Chats</th><th>Siguieron la conversación</th><th>Les respondimos</th><th>Ganados</th><th>Valor ganado</th>{connected && <><th>Gasto</th><th>Costo por chat</th></>}<th>Lectura</th><th></th></tr></thead>
            <tbody>
              {d.ads.map((a) => { const [kind, text] = verdict(a); return (
                <tr key={a.key}>
                  <td>{a.thumbnail_url ? <img src={mediaSrc(a.thumbnail_url)} alt="" loading="lazy" /> : <div className="noimg"><Icon name="megaphone" size={18} /></div>}</td>
                  <td>
                    <div className="adname">{adTitle(a)}</div>
                    {a.campaign_name && <div className="adsub" title={`${a.campaign_name} › ${a.adset_name || ''}`}>{a.campaign_name}{a.adset_name ? ` › ${a.adset_name}` : ''}</div>}
                    {a.ad_name && a.headline && a.headline !== a.ad_name && <div className="adsub" title={a.headline}>Título: {a.headline}</div>}
                    {!a.campaign_name && a.body && <div className="adsub" title={a.body}>{a.body}</div>}
                    <div className="adsub">{[PLATFORM_LABEL[a.platform], a.source_id && `ID ${a.source_id}`, a.last_at && `último chat ${fmtDate(a.last_at)}`].filter(Boolean).join(' · ')}{a.source_url && <> · <a href={a.source_url} target="_blank" rel="noreferrer">ver anuncio</a></>}</div>
                  </td>
                  <td><b>{a.leads}</b>{a.services?.length > 0 && <div className="adsub" style={{ maxWidth: 200, whiteSpace: 'normal' }} title="Servicio que eligieron en el menú o que anotó el asesor">{a.services.slice(0, 3).map((s) => `${s.name} ${s.n}`).join(' · ')}</div>}</td>
                  <td>{a.engaged} <span className="muted">({pct(a.engaged, a.leads)})</span></td>
                  <td>{a.answered} <span className="muted">({pct(a.answered, a.leads)})</span></td>
                  <td>{a.won}{a.lost > 0 && <span className="muted"> · {a.lost} perdidos</span>}</td>
                  <td>{a.value_won ? fmtMoney(a.value_won) : '—'}</td>
                  {connected && <><td>{a.spend != null ? money(a.spend) : '—'}</td><td>{a.cpl != null ? money(a.cpl) : '—'}</td></>}
                  <td><span className={`verdict ${kind}`}>{text}</span></td>
                  <td>{a.leads > 0 && <button className="btn btn-sm" onClick={() => nav(`/bandeja?anuncio=${encodeURIComponent(a.source_id || a.headline || 'any')}&nombre=${encodeURIComponent(adTitle(a))}`)}>Ver chats</button>}</td>
                </tr>) })}
              {d.ads.length === 0 && <tr><td colSpan={connected ? 11 : 9} className="muted" style={{ padding: 24 }}>Todavía no hay chats identificados con un anuncio en este periodo. Los chats nuevos que lleguen desde un anuncio "clic a WhatsApp" aparecerán aquí. Para revisar los que ya llegaron, usa "Buscar en chats anteriores".</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card"><div className="card-body small text-2" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ color: 'var(--text)' }}>Cómo leer esta tabla</b>
        <div><b>Chats</b>: personas que escribieron desde ese anuncio. <b>Siguieron la conversación</b>: enviaron más de un mensaje; si casi nadie sigue, el anuncio atrae curiosos. <b>Ganados</b>: chats que el equipo movió a la etapa de ganado en el Pipeline.</div>
        <div><span className="verdict good">Trae clientes</span> al menos un chat ganado · <span className="verdict good">Trae conversaciones</span> la mitad o más siguen la conversación · <span className="verdict mid">Regular</span> entre 25 % y 50 % · <span className="verdict bad">Escriben y no siguen</span> menos de 25 % · <span className="verdict new">Pocos datos</span> menos de 5 chats.</div>
        <div>La lectura depende de que el equipo mueva cada chat a su etapa real (Calificado, Ganado, Perdido). Solo se identifican anuncios de Meta con destino WhatsApp; los de Google Ads se identifican con el código del enlace.</div>
      </div></div>
    </div>
  )
}
