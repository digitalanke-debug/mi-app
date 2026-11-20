import { Router } from 'express'
import { db, now } from '../db/knex.js'
import { requireCompany, requireAdmin } from '../auth.js'
import { backfillAdReferrals } from '../services/adBackfill.js'

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

// ---- Anuncios de Meta: de qué anuncio llega cada persona y qué resultado da ----

/** Resultados por anuncio en el periodo: leads del CRM cruzados con el gasto de Meta (si está conectado) */
marketingRouter.get('/ads', requireCompany, async (req, res) => {
  const days = Number(req.query.days || 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const cid = req.companyId
  const refs = await db('ad_referrals as r').join('conversations as c', 'c.id', 'r.conversation_id').leftJoin('pipeline_stages as s', 's.id', 'c.stage_id')
    .where('r.company_id', cid).where('r.created_at', '>=', since).orderBy('r.created_at', 'desc')
    .select('r.*', 'c.status', 'c.value', 'c.first_response_at', 's.is_won', 's.is_lost', 's.name as stage_name')
  const convIds = [...new Set(refs.map((r) => r.conversation_id))]
  // Personas que siguieron la conversación (más de un mensaje): mide la calidad del lead
  const inbound = convIds.length ? await db('messages').whereIn('conversation_id', convIds).where({ direction: 'in' }).groupBy('conversation_id').select('conversation_id').count('id as n') : []
  const inboundOf = Object.fromEntries(inbound.map((x) => [x.conversation_id, Number(x.n)]))

  const insights = await db('ad_insights').where({ company_id: cid }).where('date', '>=', since.slice(0, 10)).orderBy('date', 'desc')
  const spendOf = {}
  for (const i of insights) {
    const s = (spendOf[i.ad_id] = spendOf[i.ad_id] || { spend: 0, impressions: 0, clicks: 0, conversations_started: 0, ad_name: i.ad_name, adset_name: i.adset_name, campaign_name: i.campaign_name })
    s.spend += Number(i.spend || 0); s.impressions += Number(i.impressions || 0); s.clicks += Number(i.clicks || 0); s.conversations_started += Number(i.conversations_started || 0)
  }
  // Nombres conocidos de anuncios aunque su gasto esté fuera del periodo
  const names = Object.fromEntries((await db('ad_insights').where({ company_id: cid }).select('ad_id', 'ad_name', 'adset_name', 'campaign_name')).map((n) => [n.ad_id, n]))

  const ads = {}
  for (const r of refs) {
    const key = r.source_id || `t:${r.headline || 'sin título'}`
    const a = (ads[key] = ads[key] || { key, source_id: r.source_id, headline: r.headline, body: r.body, source_url: r.source_url, thumbnail_url: r.thumbnail_url, platform: r.platform, media_type: r.media_type,
      convs: new Map(), first_at: r.created_at, last_at: r.created_at })
    if (!a.thumbnail_url && r.thumbnail_url) a.thumbnail_url = r.thumbnail_url
    if (r.created_at < a.first_at) a.first_at = r.created_at
    if (!a.convs.has(r.conversation_id)) a.convs.set(r.conversation_id, r)
  }
  const rows = Object.values(ads).map(({ convs, ...a }) => {
    const list = [...convs.values()]
    const leads = list.length
    const won = list.filter((c) => c.is_won).length
    const m = spendOf[a.source_id] || null
    const n = names[a.source_id] || m
    const stages = {}
    for (const c of list) stages[c.stage_name || 'Sin etapa'] = (stages[c.stage_name || 'Sin etapa'] || 0) + 1
    return { ...a, ad_name: n?.ad_name || null, adset_name: n?.adset_name || null, campaign_name: n?.campaign_name || null,
      leads, engaged: list.filter((c) => (inboundOf[c.conversation_id] || 0) >= 2).length, answered: list.filter((c) => c.first_response_at).length,
      won, lost: list.filter((c) => c.is_lost).length, open: list.filter((c) => c.status !== 'closed' && !c.is_won && !c.is_lost).length,
      value_won: list.filter((c) => c.is_won).reduce((x, c) => x + Number(c.value || 0), 0), stages,
      spend: m ? m.spend : null, impressions: m?.impressions ?? null, clicks: m?.clicks ?? null, conversations_started: m?.conversations_started ?? null,
      cpl: m && leads ? m.spend / leads : null, cpa: m && won ? m.spend / won : null }
  })
  // Anuncios con gasto en Meta que no trajeron ningún chat al CRM
  for (const [adId, m] of Object.entries(spendOf)) {
    if (rows.find((r) => r.source_id === adId) || !(m.spend > 0)) continue
    rows.push({ key: adId, source_id: adId, headline: null, ad_name: m.ad_name, adset_name: m.adset_name, campaign_name: m.campaign_name, leads: 0, engaged: 0, answered: 0, won: 0, lost: 0, open: 0, value_won: 0, stages: {},
      spend: m.spend, impressions: m.impressions, clicks: m.clicks, conversations_started: m.conversations_started, cpl: null, cpa: null })
  }
  rows.sort((a, b) => b.leads - a.leads || (b.spend || 0) - (a.spend || 0))

  const totalConvs = await db('conversations').where({ company_id: cid }).where('created_at', '>=', since).count('id as n').first()
  const integ = await db('integrations').where({ company_id: cid, provider: 'meta_ads' }).first()
  const cfg = JSON.parse(integ?.config || '{}')
  res.json({
    days, ads: rows,
    totals: { conversations: Number(totalConvs?.n || 0), from_ads: convIds.length, spend: rows.reduce((x, r) => x + (r.spend || 0), 0), won: rows.reduce((x, r) => x + r.won, 0), value_won: rows.reduce((x, r) => x + r.value_won, 0) },
    meta: { status: integ?.status || 'disconnected', last_sync_at: integ?.last_sync_at || null, last_error: integ?.last_error || null, currency: cfg.currency || null, account_name: cfg.account_name || null },
  })
})

/** Vuelve a revisar los chats existentes para recuperar su anuncio de origen (números por QR) */
marketingRouter.post('/ads/backfill', requireCompany, requireAdmin, async (req, res) => {
  const out = { scanned: 0, withAd: 0, recorded: 0 }
  for (const inst of await db('whatsapp_instances').where({ company_id: req.companyId, provider: 'evolution' })) {
    const r = await backfillAdReferrals(inst, { force: true })
    out.scanned += r.scanned || 0; out.withAd += r.withAd || 0; out.recorded += r.recorded || 0
  }
  res.json(out)
})

// ---- Meta Ads (gasto y nombre de cada anuncio) ----
const metaSafe = (row) => {
  const c = JSON.parse(row?.config || '{}')
  return { ad_account_id: c.ad_account_id || '', access_token: c.access_token ? '••••' + String(c.access_token).slice(-4) : '', currency: c.currency || '', account_name: c.account_name || '' }
}
const metaGraph = (path, params) => {
  const base = (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '')
  const u = new URL(`${base}/${process.env.META_GRAPH_VERSION || 'v23.0'}/${path}`)
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  return u.toString()
}
async function metaGet(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.error) throw new Error(`Meta Ads ${data.error?.code || r.status}: ${data.error?.error_user_msg || data.error?.message || 'error desconocido'}`)
  return data
}

marketingRouter.get('/integrations/meta-ads', requireCompany, async (req, res) => {
  const row = await db('integrations').where({ company_id: req.companyId, provider: 'meta_ads' }).first()
  res.json({ status: row?.status || 'disconnected', last_sync_at: row?.last_sync_at || null, last_error: row?.last_error || null, config: metaSafe(row) })
})

marketingRouter.put('/integrations/meta-ads', requireCompany, requireAdmin, async (req, res) => {
  const row = await db('integrations').where({ company_id: req.companyId, provider: 'meta_ads' }).first()
  const cur = JSON.parse(row?.config || '{}')
  const inc = req.body || {}
  if (inc.ad_account_id !== undefined) cur.ad_account_id = String(inc.ad_account_id).replace(/^act_/, '').replace(/\D/g, '')
  if (inc.access_token !== undefined && !String(inc.access_token).startsWith('••••')) cur.access_token = String(inc.access_token).trim()
  const complete = !!(cur.ad_account_id && cur.access_token)
  const data = { config: JSON.stringify(cur), status: complete ? 'configured' : 'disconnected', last_error: null }
  if (row) await db('integrations').where({ id: row.id }).update(data)
  else await db('integrations').insert({ company_id: req.companyId, provider: 'meta_ads', ...data })
  res.json({ ok: true, status: data.status })
})

/** Trae de Meta el gasto diario por anuncio (y el nombre del anuncio, conjunto y campaña) */
export async function syncMetaAds(companyId, days = 30) {
  const row = await db('integrations').where({ company_id: companyId, provider: 'meta_ads' }).first()
  if (!row) throw new Error('Meta Ads no está configurado')
  const c = JSON.parse(row.config || '{}')
  if (!c.ad_account_id || !c.access_token) throw new Error('Faltan el ID de la cuenta publicitaria o el token')
  const acct = await metaGet(metaGraph(`act_${c.ad_account_id}`, { fields: 'name,currency' }), c.access_token)
  const until = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  let url = metaGraph(`act_${c.ad_account_id}/insights`, { level: 'ad', fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,inline_link_clicks,clicks,actions', time_increment: '1', time_range: { since, until }, limit: '500' })
  let n = 0
  const byCampaign = {}
  for (let page = 0; url && page < 40; page++) {
    const data = await metaGet(url, c.access_token)
    for (const r of data.data || []) {
      const started = (r.actions || []).find((a) => /messaging_conversation_started/.test(a.action_type))
      const rowData = { ad_name: r.ad_name, adset_name: r.adset_name, campaign_name: r.campaign_name, spend: Number(r.spend || 0), impressions: Number(r.impressions || 0),
        clicks: Number(r.inline_link_clicks ?? r.clicks ?? 0), conversations_started: Number(started?.value || 0) }
      await db('ad_insights').insert({ company_id: companyId, date: r.date_start, ad_id: String(r.ad_id), ...rowData }).onConflict(['company_id', 'date', 'ad_id']).merge()
      const k = `${r.date_start}|${r.campaign_name || 'Sin campaña'}`
      const agg = (byCampaign[k] = byCampaign[k] || { cost: 0, clicks: 0, impressions: 0 })
      agg.cost += rowData.spend; agg.clicks += rowData.clicks; agg.impressions += rowData.impressions
      n++
    }
    url = data.paging?.next || null
  }
  // Total por campaña y día para los indicadores de inversión del Dashboard
  for (const [k, v] of Object.entries(byCampaign)) {
    const [date, campaign] = k.split('|')
    await db('ad_spend').insert({ company_id: companyId, date, source: 'meta_ads', campaign, ...v }).onConflict(['company_id', 'date', 'source', 'campaign']).merge()
  }
  await db('integrations').where({ id: row.id }).update({ status: 'connected', last_sync_at: now(), last_error: null, config: JSON.stringify({ ...c, currency: acct.currency || null, account_name: acct.name || null }) })
  return { rows: n, currency: acct.currency, account: acct.name }
}

marketingRouter.post('/integrations/meta-ads/sync', requireCompany, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await syncMetaAds(req.companyId, Number(req.body?.days || 30))) }) }
  catch (e) {
    await db('integrations').where({ company_id: req.companyId, provider: 'meta_ads' }).update({ status: 'error', last_error: e.message.slice(0, 500) })
    res.status(400).json({ error: e.message })
  }
})

/** Sincroniza Meta Ads en todas las empresas que lo tienen conectado (tarea periódica) */
export async function syncAllMetaAds() {
  for (const row of await db('integrations').where({ provider: 'meta_ads' }).whereIn('status', ['configured', 'connected', 'error'])) {
    try { await syncMetaAds(row.company_id, 7) } catch (e) { await db('integrations').where({ id: row.id }).update({ status: 'error', last_error: e.message.slice(0, 500) }); console.warn('Meta Ads:', e.message) }
  }
}
