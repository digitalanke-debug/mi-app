import { Router } from 'express'
import { db, now } from '../db/knex.js'
import { requireCompany, requireAdmin } from '../auth.js'

export const marketingRouter = Router()

/** Gasto publicitario registrado (por campaña y día) */
marketingRouter.get('/ad-spend', requireCompany, async (req, res) => {
  const days = Number(req.query.days || 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const rows = await db('ad_spend').where({ company_id: req.companyId }).where('date', '>=', since).orderBy('date', 'desc')
  res.json(rows)
})

/**
 * Importa gasto manualmente. Acepta JSON { rows: [{date, source, campaign, cost, clicks, impressions}] }
 * o { csv: "fecha,origen,campaña,costo,clics,impresiones\n2026-10-01,google_ads,Search - Marca,120000,40,2000" }
 */
marketingRouter.post('/ad-spend/import', requireCompany, async (req, res) => {
  let rows = req.body.rows || []
  if (req.body.csv) {
    const lines = String(req.body.csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const header = lines.shift().toLowerCase()
    const sep = header.includes(';') ? ';' : ','
    rows = lines.map((l) => {
      const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''))
      return { date: c[0], source: (c[1] || 'google_ads').toLowerCase().replace(' ', '_'), campaign: c[2], cost: Number(String(c[3] || 0).replace(/[^\d.-]/g, '')), clicks: Number(c[4] || 0), impressions: Number(c[5] || 0) }
    })
  }
  let n = 0
  for (const r of rows) {
    if (!r.date || !r.campaign) continue
    const date = new Date(r.date).toISOString().slice(0, 10)
    await db('ad_spend').insert({ company_id: req.companyId, date, source: r.source || 'google_ads', campaign: r.campaign, cost: Number(r.cost) || 0, clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0 })
      .onConflict(['company_id', 'date', 'source', 'campaign']).merge()
    n++
  }
  res.json({ ok: true, imported: n })
})

marketingRouter.delete('/ad-spend', requireCompany, requireAdmin, async (req, res) => {
  await db('ad_spend').where({ company_id: req.companyId }).del()
  res.json({ ok: true })
})

// ---- Google Ads ----
const safeConfig = (row) => {
  const c = JSON.parse(row?.config || '{}')
  return { customer_id: c.customer_id || '', login_customer_id: c.login_customer_id || '', developer_token: c.developer_token ? '••••' + String(c.developer_token).slice(-4) : '',
    client_id: c.client_id || '', client_secret: c.client_secret ? '••••' : '', refresh_token: c.refresh_token ? '••••' : '' }
}

marketingRouter.get('/integrations/google-ads', requireCompany, async (req, res) => {
  const row = await db('integrations').where({ company_id: req.companyId, provider: 'google_ads' }).first()
  res.json({ status: row?.status || 'disconnected', last_sync_at: row?.last_sync_at || null, last_error: row?.last_error || null, config: safeConfig(row) })
})

marketingRouter.put('/integrations/google-ads', requireCompany, requireAdmin, async (req, res) => {
  const row = await db('integrations').where({ company_id: req.companyId, provider: 'google_ads' }).first()
  const cur = JSON.parse(row?.config || '{}')
  const inc = req.body || {}
  for (const k of ['customer_id', 'login_customer_id', 'developer_token', 'client_id', 'client_secret', 'refresh_token']) {
    if (inc[k] !== undefined && !String(inc[k]).startsWith('••••')) cur[k] = String(inc[k]).trim()
  }
  const complete = ['customer_id', 'developer_token', 'client_id', 'client_secret', 'refresh_token'].every((k) => cur[k])
  const data = { config: JSON.stringify(cur), status: complete ? 'configured' : 'disconnected' }
  if (row) await db('integrations').where({ id: row.id }).update(data)
  else await db('integrations').insert({ company_id: req.companyId, provider: 'google_ads', ...data })
  res.json({ ok: true, status: data.status })
})

/** Sincroniza costo por campaña y día desde la API de Google Ads (GAQL via REST) */
export async function syncGoogleAds(companyId, days = 30) {
  const row = await db('integrations').where({ company_id: companyId, provider: 'google_ads' }).first()
  if (!row) throw new Error('Google Ads no está configurado')
  const c = JSON.parse(row.config || '{}')
  // 1) access token con el refresh token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }) })
  const tok = await tokenRes.json()
  if (!tok.access_token) throw new Error(`OAuth: ${tok.error_description || tok.error || 'sin access_token'}`)
  // 2) consulta GAQL
  const cid = String(c.customer_id).replace(/-/g, '')
  const query = `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date DURING LAST_${days === 7 ? '7' : days === 90 ? '90' : '30'}_DAYS AND metrics.cost_micros > 0`
  const headers = { Authorization: `Bearer ${tok.access_token}`, 'developer-token': c.developer_token, 'Content-Type': 'application/json' }
  if (c.login_customer_id) headers['login-customer-id'] = String(c.login_customer_id).replace(/-/g, '')
  const r = await fetch(`https://googleads.googleapis.com/v21/customers/${cid}/googleAds:searchStream`, { method: 'POST', headers, body: JSON.stringify({ query }) })
  const data = await r.json()
  if (!r.ok) throw new Error(`Google Ads API ${r.status}: ${JSON.stringify(data).slice(0, 300)}`)
  let n = 0
  for (const chunk of Array.isArray(data) ? data : [data]) {
    for (const res of chunk.results || []) {
      await db('ad_spend').insert({ company_id: companyId, date: res.segments.date, source: 'google_ads', campaign: res.campaign.name,
        cost: Number(res.metrics.costMicros || 0) / 1e6, clicks: Number(res.metrics.clicks || 0), impressions: Number(res.metrics.impressions || 0) })
        .onConflict(['company_id', 'date', 'source', 'campaign']).merge()
      n++
    }
  }
  await db('integrations').where({ id: row.id }).update({ status: 'connected', last_sync_at: now(), last_error: null })
  return n
}

marketingRouter.post('/integrations/google-ads/sync', requireCompany, requireAdmin, async (req, res) => {
  try { const n = await syncGoogleAds(req.companyId, Number(req.body?.days || 30)); res.json({ ok: true, rows: n }) }
  catch (e) {
    await db('integrations').where({ company_id: req.companyId, provider: 'google_ads' }).update({ status: 'error', last_error: e.message })
    res.status(400).json({ error: e.message })
  }
})
