import { db, now } from '../db/knex.js'
import { emitCompany } from './realtime.js'
import { sendOutbound, addTagByName, moveToStageByName, assignRoundRobin, logActivity, broadcastConversation } from './conversations.js'
import { agentReply } from './ai.js'

const parse = (s, d) => { try { return s ? JSON.parse(s) : d } catch { return d } }

function isOutsideHours(company) {
  const [start, end] = (company.business_hours || '08:00-18:00').split('-')
  const fmt = new Intl.DateTimeFormat('es-CO', { timeZone: company.timezone || 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  const hhmm = `${parts.hour}:${parts.minute}`
  const weekend = /^(s[aá]b|dom)/i.test(parts.weekday)
  return weekend || hhmm < start || hhmm >= end
}

function matches(auto, ctx) {
  const cond = parse(auto.conditions, {})
  if (cond.source && ctx.contact.source !== cond.source) return false
  if (auto.trigger === 'keyword') {
    const kws = (cond.keywords || []).map((k) => k.toLowerCase())
    const body = (ctx.message?.body || '').toLowerCase()
    if (!kws.some((k) => body.includes(k))) return false
  }
  if (auto.trigger === 'outside_hours' && !isOutsideHours(ctx.company)) return false
  if (cond.unassigned_only && ctx.conversation.assigned_user_id) return false
  return true
}

export async function runActions(auto, ctx) {
  const actions = parse(auto.actions, [])
  const conv = ctx.conversation
  for (const a of actions) {
    try {
      if (a.type === 'reply') {
        await sendOutbound(conv.id, { body: a.body, senderType: 'bot' })
      } else if (a.type === 'add_tag') {
        await addTagByName(conv.id, conv.company_id, a.tag_name)
      } else if (a.type === 'move_stage') {
        await moveToStageByName(conv.id, conv.company_id, a.stage_name)
      } else if (a.type === 'assign') {
        if (a.mode === 'round_robin') await assignRoundRobin(conv.id, conv.company_id)
        else if (a.user_id) await db('conversations').where({ id: conv.id }).update({ assigned_user_id: a.user_id })
      } else if (a.type === 'notify') {
        emitCompany(conv.company_id, 'notification', { conversation_id: conv.id, body: a.body, automation: auto.name })
      } else if (a.type === 'ai_reply') {
        await aiRespond(conv.id, ctx)
      }
    } catch (e) {
      console.error(`Automatización "${auto.name}" acción ${a.type}:`, e.message)
    }
  }
  await db('automations').where({ id: auto.id }).increment('runs', 1)
  await logActivity(conv.company_id, conv.id, 'automation.run', { automation: auto.name, trigger: auto.trigger })
}

/** El agente IA responde si está habilitado para la empresa y la conversación */
export async function aiRespond(conversationId, ctx = {}) {
  const conv = await db('conversations').where({ id: conversationId }).first()
  const settings = await db('ai_settings').where({ company_id: conv.company_id }).first()
  if (!settings?.enabled || !conv.ai_enabled) return null
  // Si un humano respondió hace poco, el bot no interviene
  const cond = ctx.conditions || {}
  const quiet = Number(cond.ai_only_when_no_human_reply_minutes || 3)
  if (conv.last_outbound_at) {
    const lastHuman = await db('messages').where({ conversation_id: conversationId, direction: 'out', sender_type: 'user' }).orderBy('created_at', 'desc').first()
    if (lastHuman && Date.now() - new Date(lastHuman.created_at).getTime() < quiet * 60_000) return null
  }
  const botTurns = await db('messages').where({ conversation_id: conversationId, sender_type: 'bot' }).count('id as n').first()
  if (Number(botTurns.n) >= (settings.max_bot_turns || 6) + 1) return null

  const reply = await agentReply(conversationId)
  if (!reply?.text) return null
  await sendOutbound(conversationId, { body: reply.text, senderType: 'bot' })
  await logActivity(conv.company_id, conversationId, 'ai.reply', { model: reply.model, demo: reply.demo })
  if (reply.handoff) {
    await db('conversations').where({ id: conversationId }).update({ ai_enabled: false })
    if (!conv.assigned_user_id) await assignRoundRobin(conversationId, conv.company_id)
    await db('notes').insert({ conversation_id: conversationId, body: `🤖 Entrega a humano. Motivo: ${reply.handoff.motivo}\nResumen: ${reply.handoff.resumen}` })
    await addTagByName(conversationId, conv.company_id, 'Caliente')
    emitCompany(conv.company_id, 'notification', { conversation_id: conversationId, body: `El agente IA entregó la conversación: ${reply.handoff.motivo}` })
    await logActivity(conv.company_id, conversationId, 'ai.handoff', reply.handoff)
    await broadcastConversation(conversationId)
  }
  return reply
}

/** Dispara todas las automatizaciones de un trigger para una conversación */
export async function fire(trigger, ctx) {
  const autos = await db('automations').where({ company_id: ctx.company.id, trigger, enabled: true })
  for (const auto of autos) {
    if (!matches(auto, ctx)) continue
    await runActions(auto, { ...ctx, conditions: parse(auto.conditions, {}) })
    ctx.conversation = await db('conversations').where({ id: ctx.conversation.id }).first()
  }
}

/** Revisa conversaciones sin respuesta (trigger inactivity). Se ejecuta cada minuto. */
export async function checkInactivity() {
  const autos = await db('automations').where({ trigger: 'inactivity', enabled: true })
  for (const auto of autos) {
    const cond = parse(auto.conditions, {})
    const minutes = Number(cond.minutes || 120)
    const limit = new Date(Date.now() - minutes * 60_000).toISOString()
    const convs = await db('conversations').where({ company_id: auto.company_id, status: 'open' })
      .whereNotNull('last_inbound_at').where('last_inbound_at', '<', limit)
      .where((q) => q.whereNull('last_outbound_at').orWhereRaw('last_outbound_at < last_inbound_at'))
    const company = await db('companies').where({ id: auto.company_id }).first()
    for (const conv of convs) {
      const already = await db('activity_log').where({ conversation_id: conv.id, type: 'automation.run' }).where('created_at', '>', conv.last_inbound_at)
        .whereLike('data', `%${auto.name}%`).first()
      if (already) continue
      const contact = await db('contacts').where({ id: conv.contact_id }).first()
      await runActions(auto, { company, conversation: conv, contact, message: null })
      await broadcastConversation(conv.id)
    }
  }
}
