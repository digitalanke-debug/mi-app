/**
 * Tareas programadas (cada 15 minutos revisa qué toca):
 *  - Recordatorios automáticos a clientes por WhatsApp: N días antes del vencimiento,
 *    el día del vencimiento y cada X días en mora. Solo si está activado y el número conectado.
 *  - Resumen diario a los números autorizados.
 */
import { readState, applyAction, query } from './state.js'
import { evolution, evolutionConfig } from './evolution.js'
import { cop, fmtDate, todayISO, daysUntil } from '../src/lib/format.js'
import { invoiceBalance, invoiceStatus } from '../src/lib/invoices.js'
import { computePriority, sortByPriority } from '../src/lib/priority.js'
import { totals, isLoan } from '../src/lib/accounts.js'

const TZ = process.env.TZ_LOCAL || 'America/Bogota'
const ACTOR = { id: null, email: 'sistema:programado' }

function localNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date())
  const get = (t) => parts.find((p) => p.type === t)?.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 }
}

async function markDone(key) {
  // Usa la tabla wa_processed como registro de "ya se hizo hoy"
  const r = await query('INSERT INTO wa_processed (message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING message_id', [key])
  return r.rowCount === 1
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

async function connected() {
  if (!evolutionConfig().configured) return false
  try { return (await evolution.connectionState()) === 'open' } catch { return false }
}

/** Decide si una cuenta de cobro merece recordatorio hoy según la configuración */
export function reminderDue(inv, cfg, today, lastReminderDate) {
  const d = daysUntil(inv.dueDate)
  if (lastReminderDate === today) return null
  if (cfg.daysBefore > 0 && d === cfg.daysBefore) return 'previo'
  if (cfg.onDue && d === 0) return 'vencimiento'
  if (d < 0 && cfg.everyDaysOverdue > 0) {
    const overdue = -d
    if (overdue % cfg.everyDaysOverdue === 0) return 'mora'
  }
  return null
}

export async function runReminders(deps = {}) {
  const { state } = await readState(ACTOR)
  const cfg = state.settings.reminders
  if (!cfg?.auto) return { skipped: 'desactivado' }
  const { date, hour } = localNow()
  if (hour !== Number(cfg.hour ?? 9)) return { skipped: 'hora' }
  if (!(deps.connected ? await deps.connected() : await connected())) return { skipped: 'whatsapp desconectado' }
  const sendText = deps.sendText || ((n, t) => evolution.sendText(n, t))
  let sent = 0
  for (const inv of state.invoices) {
    if (invoiceBalance(inv) <= 0) continue
    const client = state.clients.find((c) => c.id === inv.clientId)
    const phone = (client?.phone || '').replace(/\D/g, '')
    if (!phone) continue
    const last = state.reminders.filter((r) => r.invoiceId === inv.id).map((r) => r.date).sort().at(-1)
    const kind = reminderDue(inv, cfg, date, last)
    if (!kind) continue
    if (!(await markDone(`rem:${inv.id}:${date}`))) continue
    const message = fillTemplate(state.settings.reminderTemplate, { nombre: client.contact || client.name, numero: inv.number, valor: cop(invoiceBalance(inv)), fecha: fmtDate(inv.dueDate) })
    try {
      await sendText(`${state.settings.countryCode || '57'}${phone}`, message)
      await applyAction({ type: 'reminder/add', reminder: { clientId: client.id, invoiceId: inv.id, date, channel: `WhatsApp (automático · ${kind})`, message } }, ACTOR)
      sent++
    } catch (e) {
      console.error('Recordatorio automático falló', inv.number, e.message)
    }
  }
  return { sent }
}

export function buildDailySummary(state) {
  const hoy = todayISO()
  const lines = [`Resumen ${fmtDate(hoy)}`]
  for (const c of state.companies.filter((x) => x.active)) {
    const t = totals(state, c.id)
    const inv = state.invoices.filter((i) => i.companyId === c.id)
    const exp = state.expenses.filter((e) => e.companyId === c.id && e.status !== 'pagado')
    const vencidas = inv.filter((i) => invoiceStatus(i) === 'vencida')
    const pri = sortByPriority(exp.filter((e) => computePriority(e) === 'alta'))
    const hoyVencen = exp.filter((e) => daysUntil(e.dueDate) === 0)
    lines.push('')
    lines.push(`*${c.name}*`)
    lines.push(`Disponible: ${cop(t.disponible)}${t.deudas ? ` · deudas ${cop(t.deudas)}` : ''}`)
    const cuentas = state.accounts.filter((a) => a.companyId === c.id && a.active && !isLoan(a))
    if (cuentas.length > 1) lines.push(cuentas.map((a) => `  ${a.name}: ${cop(t.porCuenta[a.id] || 0)}`).join('\n'))
    lines.push(`Por cobrar: ${cop(inv.reduce((s, i) => s + invoiceBalance(i), 0))}${vencidas.length ? ` (${vencidas.length} vencida${vencidas.length === 1 ? '' : 's'}: ${cop(vencidas.reduce((s, i) => s + invoiceBalance(i), 0))})` : ''}`)
    if (hoyVencen.length) lines.push(`Vence hoy: ${hoyVencen.map((e) => `${e.concept} ${cop(e.amount)}`).join(', ')}`)
    if (pri.length) lines.push(`Prioritarias (${pri.length}): ${pri.slice(0, 5).map((e) => `${e.concept} ${cop(e.amount)}`).join(', ')}${pri.length > 5 ? '…' : ''}`)
    else lines.push('Sin pagos urgentes')
  }
  return lines.join('\n')
}

export async function runDailySummary(deps = {}) {
  const { state } = await readState(ACTOR)
  const cfg = state.settings.whatsapp?.dailySummary
  if (!cfg?.enabled) return { skipped: 'desactivado' }
  const { date, hour } = localNow()
  if (hour !== Number(cfg.hour ?? 8)) return { skipped: 'hora' }
  const numbers = state.settings.whatsapp.allowedNumbers || []
  if (!numbers.length) return { skipped: 'sin números' }
  if (!(deps.connected ? await deps.connected() : await connected())) return { skipped: 'whatsapp desconectado' }
  if (!(await markDone(`resumen:${date}`))) return { skipped: 'ya enviado' }
  const text = buildDailySummary(state)
  const sendText = deps.sendText || ((n, t) => evolution.sendText(n, t))
  let sent = 0
  for (const n of numbers) {
    try { await sendText(n.phone, text); sent++ } catch (e) { console.error('Resumen diario falló', n.phone, e.message) }
  }
  return { sent }
}

export function startScheduler() {
  const tick = async () => {
    try { await runReminders() } catch (e) { console.error('Programador recordatorios:', e.message) }
    try { await runDailySummary() } catch (e) { console.error('Programador resumen:', e.message) }
    try { await query("DELETE FROM wa_processed WHERE created_at < now() - interval '60 days'") } catch { /* ignorar */ }
  }
  setTimeout(tick, 20000)
  setInterval(tick, 15 * 60 * 1000)
}
