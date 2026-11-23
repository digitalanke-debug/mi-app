import { db } from '../db/knex.js'
import { onlineUsers } from './realtime.js'
import { webhookStatus } from './whatsapp/evolutionProvider.js'
import { isOutsideHours, hoursText } from './businessHours.js'

/**
 * Revisión de una empresa: números de WhatsApp, mensajes automáticos, anuncios y avisos al equipo.
 * Devuelve una lista de comprobaciones (ok | warn | bad) y el detalle de cada parte.
 */
const parse = (s, d) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const n = (r) => Number(r?.n || 0)

export async function companyCheckup(companyId) {
  const company = await db('companies').where({ id: companyId }).first()
  const checks = []
  const add = (status, title, detail) => checks.push({ status, title, detail })

  // 1) Números de WhatsApp
  const instances = []
  for (const inst of await db('whatsapp_instances').where({ company_id: companyId }).orderBy('id')) {
    const base = db('messages as m').join('conversations as c', 'c.id', 'm.conversation_id').where({ 'c.instance_id': inst.id, 'm.direction': 'in' })
    const last = await base.clone().max('m.created_at as at').first()
    const day = await base.clone().where('m.created_at', '>', ago(24)).count('m.id as n').first()
    const week = await base.clone().where('m.created_at', '>', ago(24 * 7)).count('m.id as n').first()
    let webhook = null
    if (inst.provider === 'evolution') { try { webhook = await webhookStatus(inst) } catch (e) { webhook = { error: e.message.slice(0, 160) } } }
    instances.push({ id: inst.id, name: inst.name, provider: inst.provider, status: inst.status, phone: inst.phone, connected_at: inst.connected_at,
      last_inbound_at: last?.at || null, inbound_24h: n(day), inbound_7d: n(week), webhook })
  }
  if (!instances.length) add('bad', 'Números de WhatsApp', 'La empresa no tiene ningún número conectado al CRM.')
  for (const i of instances) {
    const label = `${i.name}${i.phone ? ` (${i.phone})` : ''}`
    if (i.status !== 'connected') add('bad', `Número ${label}`, i.provider === 'meta' ? 'La API oficial no está verificada. Revisa el token en WhatsApp.' : 'Está desconectado. Hay que volver a escanear el QR en la pantalla WhatsApp.')
    else if (i.webhook && (i.webhook.error || !i.webhook.enabled || !i.webhook.url_ok)) add('bad', `Número ${label}`, 'Está conectado, pero los mensajes no le llegan al CRM (aviso de mensajes desactivado). El servidor lo repara al reiniciar; si sigue así, avísale a soporte.')
    else if (!i.inbound_7d) add('warn', `Número ${label}`, 'Conectado, pero no ha recibido mensajes en los últimos 7 días.')
    else add('ok', `Número ${label}`, `Conectado. ${i.inbound_24h} mensajes recibidos en 24 horas y ${i.inbound_7d} en 7 días.`)
  }

  // 2) Mensajes automáticos
  const autos = await db('automations').where({ company_id: companyId }).orderBy('id')
  const automations = []
  for (const a of autos) {
    const actions = parse(a.actions, [])
    const lastRun = await db('activity_log').where({ company_id: companyId, type: 'automation.run' }).whereLike('data', `%${JSON.stringify(a.name).slice(1, -1)}%`).max('created_at as at').first()
    automations.push({ id: a.id, name: a.name, trigger: a.trigger, enabled: !!a.enabled, runs: a.runs || 0, last_run_at: lastRun?.at || null, actions: actions.map((x) => x.type),
      menu_options: actions.find((x) => x.type === 'menu')?.options?.length || 0 })
  }
  const welcome = automations.find((a) => a.trigger === 'new_conversation' && (a.menu_options || /bienvenida/i.test(a.name)))
  const menuPicks = await db('activity_log').where({ company_id: companyId, type: 'menu.option' }).where('created_at', '>', ago(24 * 7)).count('id as n').first()
  if (!welcome) add('bad', 'Saludo de bienvenida', 'No hay un saludo automático para los chats nuevos.')
  else if (!welcome.enabled) add('bad', 'Saludo de bienvenida', `"${welcome.name}" está apagado.`)
  else if (!welcome.menu_options) add('warn', 'Saludo de bienvenida', 'Está activo, pero es un texto fijo sin menú de opciones.')
  else add('ok', 'Menú de bienvenida', `Activo con ${welcome.menu_options} opciones. ${n(menuPicks)} personas eligieron una opción en los últimos 7 días.`)

  const afterHours = automations.find((a) => a.trigger === 'outside_hours')
  const hours = `${hoursText(company)} (${company.timezone || 'America/Bogota'})`
  if (!afterHours) add('warn', 'Aviso de fuera de horario', `No existe. Horario configurado: ${hours}.`)
  else if (!afterHours.enabled) add('warn', 'Aviso de fuera de horario', `Está apagado. Horario configurado: ${hours}.`)
  else add('ok', 'Aviso de fuera de horario', `Activo. Horario: ${hours}. Ahora mismo ${isOutsideHours(company) ? 'están fuera de horario' : 'están en horario'}.`)

  // Asignación automática: solo reparte entre usuarios con rol Asesor que tengan acceso a la empresa
  const agents = await db('company_users as cu').join('users as u', 'u.id', 'cu.user_id').where({ 'cu.company_id': companyId, 'u.active': true, 'u.role': 'agent' }).select('u.id', 'u.name')
  const rr = automations.find((a) => a.actions.includes('assign'))
  const unassigned = await db('conversations').where({ company_id: companyId, status: 'open' }).whereNull('assigned_user_id').count('id as n').first()
  if (rr?.enabled && !agents.length) add('bad', 'Asignación automática', `Está activa, pero ningún usuario con rol Asesor tiene acceso a esta empresa, así que los chats quedan sin asignar (${n(unassigned)} abiertos sin asignar). Los administradores no reciben asignaciones.`)
  else if (rr?.enabled) add(n(unassigned) > 10 ? 'warn' : 'ok', 'Asignación automática', `Reparte entre: ${agents.map((a) => a.name).join(', ')}. ${n(unassigned)} chats abiertos sin asignar.`)
  else add('warn', 'Asignación automática', `Está apagada. ${n(unassigned)} chats abiertos sin asignar.`)

  // 3) Anuncios de Meta
  const meta = await db('integrations').where({ company_id: companyId, provider: 'meta_ads' }).first()
  const refs30 = await db('ad_referrals').where({ company_id: companyId }).where('created_at', '>', ago(24 * 30)).count('id as n').first()
  const lastRef = await db('ad_referrals').where({ company_id: companyId }).max('created_at as at').first()
  const convs30 = await db('conversations').where({ company_id: companyId }).where('created_at', '>', ago(24 * 30)).count('id as n').first()
  if (n(refs30)) add('ok', 'Chats que llegan por anuncios', `${n(refs30)} de ${n(convs30)} chats nuevos de los últimos 30 días llegaron por un anuncio de Meta.`)
  else add('warn', 'Chats que llegan por anuncios', `Ningún chat de los últimos 30 días llegó por un anuncio de Meta${n(convs30) ? ` (de ${n(convs30)} chats nuevos)` : ''}. Si hay anuncios activos, revisa que apunten a un número de esta empresa.`)
  if (!meta || meta.status === 'disconnected') add('warn', 'Gasto de Meta Ads', 'Sin conectar: no se ve el costo por chat. Se conecta en Configuración → Meta Ads.')
  else if (meta.status === 'error') add('bad', 'Gasto de Meta Ads', `Error al sincronizar: ${meta.last_error || 'desconocido'}`)
  else if (meta.status === 'configured') add('warn', 'Gasto de Meta Ads', 'Datos guardados, falta pulsar "Sincronizar" en Configuración → Meta Ads.')
  else add('ok', 'Gasto de Meta Ads', `Conectado${parse(meta.config, {}).account_name ? ` a "${parse(meta.config, {}).account_name}"` : ''}. Última sincronización: ${meta.last_sync_at ? new Date(meta.last_sync_at).toLocaleString('es-CO', { timeZone: company.timezone || 'America/Bogota' }) : 'nunca'}.`)

  // 4) Avisos al equipo: reciben los mensajes en vivo todos los usuarios activos con acceso (administradores siempre)
  const admins = await db('users').where({ role: 'admin', active: true }).select('id', 'name', 'role')
  const members = await db('company_users as cu').join('users as u', 'u.id', 'cu.user_id').where({ 'cu.company_id': companyId, 'u.active': true }).select('u.id', 'u.name', 'u.role')
  const online = await onlineUsers(companyId)
  const team = [...new Map([...admins, ...members].map((u) => [u.id, u])).values()].map((u) => {
    const o = online.find((x) => x.id === u.id)
    const p = o?.prefs?.[0] || null
    return { id: u.id, name: u.name, role: u.role, online: !!o, sessions: o?.sessions || 0, notify: p ? p.notify && p.permission === 'granted' : null, sound: p ? p.sound : null, permission: p?.permission || null }
  })
  const silent = team.filter((u) => u.online && u.notify === false && u.sound === false)
  const blocked = team.filter((u) => u.online && u.permission === 'denied')
  if (!team.some((u) => u.online)) add('warn', 'Avisos al equipo', `Nadie tiene el CRM abierto en este momento, así que nadie recibe avisos. Con acceso: ${team.map((u) => u.name).join(', ')}.`)
  else if (blocked.length || silent.length) add('warn', 'Avisos al equipo', `${[...new Set([...blocked, ...silent].map((u) => u.name))].join(', ')} ${blocked.length ? 'tiene bloqueadas las notificaciones del navegador' : 'tiene los avisos y el sonido apagados'}.`)
  else add('ok', 'Avisos al equipo', `Conectados ahora: ${team.filter((u) => u.online).map((u) => u.name).join(', ')}.`)

  return { company: { id: company.id, name: company.name, color: company.color }, checks, instances, automations, team, generated_at: new Date().toISOString() }
}
