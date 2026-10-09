import { Router } from 'express'
import { db } from '../db/knex.js'
import { requireCompany, requireAdmin, userCompanyIds } from '../auth.js'

export const dashboardRouter = Router()

dashboardRouter.get('/', requireCompany, async (req, res) => {
  const days = Number(req.query.days || 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const cid = req.companyId

  const convs = await db('conversations as c').leftJoin('contacts as ct', 'ct.id', 'c.contact_id').leftJoin('pipeline_stages as s', 's.id', 'c.stage_id')
    .leftJoin('users as u', 'u.id', 'c.assigned_user_id')
    .where('c.company_id', cid).where('c.created_at', '>=', since)
    .select('c.*', 'ct.source', 'ct.campaign', 's.name as stage_name', 's.is_won', 's.is_lost', 'u.name as assigned_name')

  const total = convs.length
  const open = convs.filter((c) => c.status === 'open').length
  const won = convs.filter((c) => c.is_won).length
  const lost = convs.filter((c) => c.is_lost).length
  const unassigned = convs.filter((c) => !c.assigned_user_id && c.status === 'open').length
  const noReply = convs.filter((c) => c.status === 'open' && !c.first_response_at).length
  const frt = convs.filter((c) => c.first_response_at && c.opened_at).map((c) => (new Date(c.first_response_at) - new Date(c.opened_at)) / 60000)
  const avgFirstResponseMin = frt.length ? Math.round(frt.reduce((a, b) => a + b, 0) / frt.length) : null
  const valueWon = convs.filter((c) => c.is_won).reduce((a, c) => a + Number(c.value || 0), 0)
  const pipelineValue = convs.filter((c) => c.status === 'open').reduce((a, c) => a + Number(c.value || 0), 0)

  const group = (key) => Object.entries(convs.reduce((acc, c) => { const k = c[key] || 'sin dato'; acc[k] = acc[k] || { total: 0, won: 0 }; acc[k].total++; if (c.is_won) acc[k].won++; return acc }, {}))
    .map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total)

  const byDay = {}
  for (let i = days - 1; i >= 0; i--) byDay[new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)] = 0
  for (const c of convs) { const d = String(c.created_at).slice(0, 10); if (d in byDay) byDay[d]++ }
  const series = Object.entries(byDay).sort().map(([date, n]) => ({ date, n }))

  const msgs = await db('messages as m').join('conversations as c', 'c.id', 'm.conversation_id').where('c.company_id', cid).where('m.created_at', '>=', since)
    .groupBy('m.sender_type').select('m.sender_type').count('m.id as n')
  const aiRuns = await db('activity_log').where({ company_id: cid, type: 'ai.reply' }).where('created_at', '>=', since).count('id as n').first()
  const autoRuns = await db('activity_log').where({ company_id: cid, type: 'automation.run' }).where('created_at', '>=', since).count('id as n').first()

  // Gasto publicitario y costo por lead (por campaña)
  const spend = await db('ad_spend').where({ company_id: cid }).where('date', '>=', since.slice(0, 10)).groupBy('campaign', 'source').select('campaign', 'source').sum('cost as cost').sum('clicks as clicks')
  const byCampaign = group('campaign').map((c) => {
    const sp = spend.find((x) => x.campaign === c.name)
    const cost = Number(sp?.cost || 0)
    return { ...c, cost, clicks: Number(sp?.clicks || 0), cpl: c.total ? cost / c.total : null, cpa: c.won ? cost / c.won : null }
  })
  for (const sp of spend) if (!byCampaign.find((c) => c.name === sp.campaign)) byCampaign.push({ name: sp.campaign, total: 0, won: 0, cost: Number(sp.cost), clicks: Number(sp.clicks), cpl: null, cpa: null })
  const totalSpend = spend.reduce((a, x) => a + Number(x.cost || 0), 0)
  const paidLeads = convs.filter((c) => ['google_ads', 'meta_ads'].includes(c.source)).length

  res.json({
    kpis: { total, open, won, lost, unassigned, noReply, avgFirstResponseMin, valueWon, pipelineValue, totalSpend, paidLeads, cplGlobal: paidLeads ? totalSpend / paidLeads : null,
      conversionRate: total ? Math.round((won / total) * 100) : 0, aiReplies: Number(aiRuns?.n || 0), automationRuns: Number(autoRuns?.n || 0) },
    bySource: group('source'), byCampaign, byStage: group('stage_name'), byAgent: group('assigned_name'), byService: group('service'),
    series, messagesBySender: msgs.map((m) => ({ sender: m.sender_type, n: Number(m.n) })),
  })
})

/** Comparativo entre todas las empresas del usuario */
dashboardRouter.get('/compare', async (req, res) => {
  const days = Number(req.query.days || 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const ids = await userCompanyIds(req.user)
  const companies = await db('companies').whereIn('id', ids).orderBy('name')
  const out = []
  for (const co of companies) {
    const convs = await db('conversations as c').leftJoin('pipeline_stages as s', 's.id', 'c.stage_id').where('c.company_id', co.id).where('c.created_at', '>=', since)
      .select('c.status', 'c.value', 'c.opened_at', 'c.first_response_at', 's.is_won', 's.is_lost')
    const total = convs.length, won = convs.filter((c) => c.is_won).length
    const frt = convs.filter((c) => c.first_response_at && c.opened_at).map((c) => (new Date(c.first_response_at) - new Date(c.opened_at)) / 60000)
    const spend = await db('ad_spend').where({ company_id: co.id }).where('date', '>=', since.slice(0, 10)).sum('cost as cost').first()
    const msgs = await db('messages as m').join('conversations as c', 'c.id', 'm.conversation_id').where('c.company_id', co.id).where('m.created_at', '>=', since).where('m.direction', 'in').count('m.id as n').first()
    out.push({ id: co.id, name: co.name, color: co.color, total, open: convs.filter((c) => c.status === 'open').length, won, lost: convs.filter((c) => c.is_lost).length,
      conversionRate: total ? Math.round((won / total) * 100) : 0, avgFirstResponseMin: frt.length ? Math.round(frt.reduce((a, b) => a + b, 0) / frt.length) : null,
      valueWon: convs.filter((c) => c.is_won).reduce((a, c) => a + Number(c.value || 0), 0), spend: Number(spend?.cost || 0), inbound: Number(msgs?.n || 0) })
  }
  res.json(out)
})

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')

/** Exporta las conversaciones del periodo a CSV */
dashboardRouter.get('/export', requireCompany, async (req, res) => {
  const days = Number(req.query.days || 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const rows = await db('conversations as c').leftJoin('contacts as ct', 'ct.id', 'c.contact_id').leftJoin('users as u', 'u.id', 'c.assigned_user_id').leftJoin('pipeline_stages as s', 's.id', 'c.stage_id')
    .where('c.company_id', req.companyId).where('c.created_at', '>=', since).orderBy('c.created_at', 'desc')
    .select('c.id', 'ct.name', 'ct.phone', 'ct.source', 'ct.campaign', 'ct.city', 'c.service', 'c.value', 's.name as stage', 'c.status', 'u.name as assigned', 'c.opened_at', 'c.first_response_at', 'c.closed_at')
  const header = ['ID', 'Nombre', 'Teléfono', 'Origen', 'Campaña', 'Ciudad', 'Servicio', 'Valor', 'Etapa', 'Estado', 'Asesor', 'Creado', 'Primera respuesta', 'Cerrado']
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="leads-${days}d.csv"`)
  res.send('\ufeff' + csv([header, ...rows.map((r) => [r.id, r.name, r.phone, r.source, r.campaign, r.city, r.service, r.value, r.stage, r.status, r.assigned, r.opened_at, r.first_response_at, r.closed_at])]))
})
