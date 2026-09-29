import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRealtime, useStore } from '../store.jsx'
import { api, ago, fmtMoney, initials } from '../api.js'

export default function Pipeline() {
  const { companyId, toast } = useStore()
  const nav = useNavigate()
  const [pipelines, setPipelines] = useState([])
  const [convs, setConvs] = useState([])
  const [over, setOver] = useState(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const { user } = useStore()

  const load = useCallback(() => {
    if (!companyId) return
    api('/pipelines', { params: { company_id: companyId } }).then(setPipelines)
    api('/conversations', { params: { company_id: companyId, status: 'all', limit: 500 } }).then(setConvs)
  }, [companyId])
  useEffect(() => { load() }, [load])
  useRealtime('conversation:update', (c) => { if (c.company_id === companyId) setConvs((cur) => [c, ...cur.filter((x) => x.id !== c.id)]) })

  const pipeline = pipelines[0]
  if (!pipeline) return <div className="page"><div className="empty">Sin pipeline</div></div>

  const drop = async (stageId) => {
    setOver(null)
    const id = Number(dragId)
    if (!id) return
    const c = convs.find((x) => x.id === id)
    if (!c || c.stage_id === stageId) return
    setConvs((cur) => cur.map((x) => (x.id === id ? { ...x, stage_id: stageId, stage_entered_at: new Date().toISOString() } : x)))
    try { await api(`/conversations/${id}`, { method: 'PATCH', body: { stage_id: stageId } }) } catch (e) { toast(e.message, 'error'); load() }
  }

  const visible = convs.filter((c) => !onlyMine || c.assigned_user_id === user.id)
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div><h1>Pipeline · {pipeline.name}</h1><div className="sub">Arrastra las tarjetas entre etapas. El tiempo en etapa se reinicia al mover.</div></div>
        <div className="actions"><label className="row small"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Solo mis leads</label>
          <button className="btn" onClick={() => nav('/configuracion')}>Editar etapas</button></div>
      </div>
      <div className="kanban">
        {pipeline.stages.map((s) => {
          const items = visible.filter((c) => c.stage_id === s.id)
          const total = items.reduce((a, c) => a + Number(c.value || 0), 0)
          return (
            <div key={s.id} className={`kcol ${over === s.id ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(s.id) }} onDragLeave={() => setOver(null)} onDrop={() => drop(s.id)}>
              <div className="khead" style={{ borderTopColor: s.color }}>{s.name}<span className="n">{items.length}</span></div>
              <div className="ksum">{fmtMoney(total)}</div>
              <div className="kbody">
                {items.map((c) => {
                  const stageMin = c.stage_entered_at ? (Date.now() - new Date(c.stage_entered_at)) / 60000 : 0
                  return (
                    <div key={c.id} className="kcard" draggable onDragStart={() => { dragId = c.id }} onDoubleClick={() => nav(`/bandeja/${c.id}`)} title="Doble clic para abrir el chat">
                      <div className="n">{c.contact_name || c.contact_phone}{c.unread_count > 0 && <span className="unread" style={{ background: 'var(--wa)', fontSize: 10, borderRadius: 999, padding: '0 6px' }}>{c.unread_count}</span>}</div>
                      <div className="s">{c.service || 'Sin servicio'}{c.value > 0 ? ` · ${fmtMoney(c.value)}` : ''}</div>
                      <div className="f">
                        {c.tags.slice(0, 2).map((t) => <span key={t.id} className="chip tag" style={{ background: t.color }}>{t.name}</span>)}
                        {c.assigned_name ? <span className="avatar sm" title={c.assigned_name}>{initials(c.assigned_name)}</span> : <span className="chip" style={{ color: 'var(--warn)' }}>Sin asignar</span>}
                        <span className={`age ${stageMin > 2880 && !s.is_won && !s.is_lost ? 'bad' : ''}`} title="Tiempo en esta etapa">⏱ {ago(c.stage_entered_at)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
let dragId = null
