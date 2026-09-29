import { Router } from 'express'
import { db } from '../db/knex.js'
import { requireCompany } from '../auth.js'

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

  res.json({
    kpis: { total, open, won, lost, unassigned, noReply, avgFirstResponseMin, valueWon, pipelineValue,
      conversionRate: total ? Math.round((won / total) * 100) : 0, aiReplies: Number(aiRuns?.n || 0), automationRuns: Number(autoRuns?.n || 0) },
    bySource: group('source'), byCampaign: group('campaign'), byStage: group('stage_name'), byAgent: group('assigned_name'), byService: group('service'),
    series, messagesBySender: msgs.map((m) => ({ sender: m.sender_type, n: Number(m.n) })),
  })
})
