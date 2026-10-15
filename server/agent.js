/**
 * Asistente administrativo: interpreta mensajes de WhatsApp con Claude y ejecuta
 * las mismas acciones que los botones de la app (vía applyAction), consultando el estado real.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readState, applyAction } from './state.js'
import { cop, todayISO, addDaysISO, daysUntil, fmtDate } from '../src/lib/format.js'
import { invoiceBalance, invoiceStatus, invoiceTotal, invoicePaid, agingBuckets } from '../src/lib/invoices.js'
import { computePriority, sortByPriority } from '../src/lib/priority.js'
import { totals, isLoan, defaultAccountId, accountName } from '../src/lib/accounts.js'
import { monthlyReport, monthLabel } from '../src/lib/reports.js'
import { resolveCompanyId, companyName } from '../src/store/migrate.js'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'

export function agentConfigured() {
  return !!process.env.ANTHROPIC_API_KEY
}

// ---------- Herramientas ----------
const TOOLS = [
  {
    name: 'ver_empresas',
    description: 'Lista las empresas registradas (id, nombre, NIT, régimen). Todo lo demás pertenece a una empresa.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'resumen',
    description: 'Resumen: saldo disponible por cuenta, deudas, cartera por cobrar (vencida y por vencer), cuentas por pagar de los próximos 30 días y las prioritarias. Sin empresaId devuelve el consolidado de todas con detalle por empresa. Úsalo para "cómo vamos", "cuánto hay", "qué toca pagar".',
    input_schema: { type: 'object', properties: { empresaId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'informe_mensual',
    description: 'Informe de un mes: facturado, cobrado, gastado, resultado, gastos por rubro (etiqueta) y categoría, facturado y cobrado por cliente. Sin empresaId consolida todas y detalla por empresa. Para "cuánto facturamos", "cuánto gastamos en oficina", "informe de septiembre".',
    input_schema: { type: 'object', properties: { empresaId: { type: 'string' }, mes: { type: 'string', description: 'AAAA-MM. Por defecto el mes actual' } }, additionalProperties: false },
  },
  {
    name: 'ver_cuentas',
    description: 'Lista las cuentas (bancos, caja menor, préstamos) con su id, empresa y saldo actual.',
    input_schema: { type: 'object', properties: { empresaId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'buscar_clientes',
    description: 'Busca clientes por nombre o NIT y devuelve id, empresa, nombre, celular y saldo pendiente. Sin texto devuelve todos.',
    input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Parte del nombre o NIT' }, empresaId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'ver_cuentas_de_cobro',
    description: 'Lista cuentas de cobro (facturas a clientes) con id, número, cliente, concepto, total, pagado, saldo, vencimiento y estado.',
    input_schema: {
      type: 'object',
      properties: {
        clienteId: { type: 'string', description: 'Filtrar por cliente' },
        empresaId: { type: 'string' },
        soloPendientes: { type: 'boolean', description: 'Solo las que tienen saldo (por defecto true)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ver_cuentas_por_pagar',
    description: 'Lista cuentas por pagar (gastos, proveedores, servicios) con id, concepto, proveedor, valor, fecha límite, prioridad y estado. Ordenadas por prioridad.',
    input_schema: {
      type: 'object',
      properties: {
        soloPendientes: { type: 'boolean', description: 'Por defecto true' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
        empresaId: { type: 'string' },
        etiqueta: { type: 'string', description: 'Filtrar por rubro/etiqueta, ej. Oficina' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crear_cliente',
    description: 'Crea un cliente nuevo.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' }, nit: { type: 'string' }, celular: { type: 'string', description: 'Solo dígitos, sin indicativo' }, correo: { type: 'string' }, notas: { type: 'string' },
        empresaId: { type: 'string', description: 'Empresa a la que pertenece. Obligatorio si hay más de una.' },
      },
      required: ['nombre'],
      additionalProperties: false,
    },
  },
  {
    name: 'crear_cuenta_de_cobro',
    description: 'Crea una cuenta de cobro a un cliente. Separa honorarios de gastos reembolsables (notaría, estampillas, peritos).',
    input_schema: {
      type: 'object',
      properties: {
        clienteId: { type: 'string' },
        concepto: { type: 'string', description: 'Ej: Honorarios proceso ejecutivo - cuota 1' },
        honorarios: { type: 'number', description: 'Valor en pesos' },
        gastos: { type: 'number', description: 'Gastos reembolsables en pesos (opcional)' },
        detalleGastos: { type: 'string' },
        fechaVencimiento: { type: 'string', description: 'AAAA-MM-DD. Por defecto 30 días' },
        numero: { type: 'string', description: 'Déjalo vacío para numerar automáticamente' },
      },
      required: ['clienteId', 'concepto', 'honorarios'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_pago_cliente',
    description: 'Registra un pago o abono de un cliente a una cuenta de cobro. El dinero entra a la cuenta bancaria indicada.',
    input_schema: {
      type: 'object',
      properties: {
        cuentaDeCobroId: { type: 'string' },
        valor: { type: 'number' },
        cuentaId: { type: 'string', description: 'Cuenta bancaria donde entró. Si no se indica, la principal' },
        fecha: { type: 'string', description: 'AAAA-MM-DD, por defecto hoy' },
        nota: { type: 'string' },
      },
      required: ['cuentaDeCobroId', 'valor'],
      additionalProperties: false,
    },
  },
  {
    name: 'crear_cuenta_por_pagar',
    description: 'Registra un gasto o cuenta por pagar pendiente (proveedor, servicio, impuesto). No la paga.',
    input_schema: {
      type: 'object',
      properties: {
        concepto: { type: 'string' }, proveedor: { type: 'string' },
        categoria: { type: 'string', enum: ['Arriendo', 'Servicios', 'Nómina', 'Honorarios', 'Software', 'Oficina', 'Gastos de procesos', 'Impuestos', 'Financiero', 'Mantenimiento', 'Otros'] },
        valor: { type: 'number' }, fechaLimite: { type: 'string', description: 'AAAA-MM-DD' },
        cortanServicio: { type: 'boolean' }, generaIntereses: { type: 'boolean' }, notas: { type: 'string' },
        etiquetas: { type: 'array', items: { type: 'string' }, description: 'Rubros, ej. ["Oficina"] o ["Dr. Suárez"]' },
        empresaId: { type: 'string', description: 'Obligatorio si hay más de una empresa' },
      },
      required: ['concepto', 'valor', 'fechaLimite'],
      additionalProperties: false,
    },
  },
  {
    name: 'pagar_cuentas_por_pagar',
    description: 'Marca como pagadas una o varias cuentas por pagar y descuenta el dinero de la cuenta bancaria indicada.',
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        cuentaId: { type: 'string', description: 'De dónde sale el dinero. Si no se indica, la principal' },
        fecha: { type: 'string' },
      },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_movimiento',
    description: 'Ingreso o egreso manual en una cuenta que no corresponde a una cuenta de cobro ni a una cuenta por pagar (consignación de un socio, retiro, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        cuentaId: { type: 'string' }, tipo: { type: 'string', enum: ['ingreso', 'egreso'] }, valor: { type: 'number' }, descripcion: { type: 'string' }, fecha: { type: 'string' },
      },
      required: ['cuentaId', 'tipo', 'valor', 'descripcion'],
      additionalProperties: false,
    },
  },
  {
    name: 'traslado',
    description: 'Mueve dinero entre cuentas. Un abono a un préstamo es un traslado desde el banco hacia la cuenta del préstamo; un desembolso es al revés.',
    input_schema: {
      type: 'object',
      properties: { desdeCuentaId: { type: 'string' }, haciaCuentaId: { type: 'string' }, valor: { type: 'number' }, descripcion: { type: 'string' }, fecha: { type: 'string' } },
      required: ['desdeCuentaId', 'haciaCuentaId', 'valor'],
      additionalProperties: false,
    },
  },
  {
    name: 'ajustar_saldo',
    description: 'Deja el saldo de una cuenta exactamente en el valor indicado (según el extracto). En préstamos, el valor es la deuda actual.',
    input_schema: {
      type: 'object',
      properties: { cuentaId: { type: 'string' }, saldo: { type: 'number' }, motivo: { type: 'string' } },
      required: ['cuentaId', 'saldo'],
      additionalProperties: false,
    },
  },
  {
    name: 'enviar_cuenta_de_cobro',
    description: 'Genera el PDF de una cuenta de cobro y lo envía por WhatsApp al celular del cliente, con un mensaje corto. Úsalo cuando pidan "mándale la cuenta de cobro a X".',
    input_schema: {
      type: 'object',
      properties: { cuentaDeCobroId: { type: 'string' }, mensaje: { type: 'string', description: 'Texto que acompaña el PDF (opcional)' } },
      required: ['cuentaDeCobroId'],
      additionalProperties: false,
    },
  },
  {
    name: 'enviar_recordatorio',
    description: 'Envía por WhatsApp un recordatorio de pago al cliente de una cuenta de cobro y lo deja registrado. Si no pasas mensaje, se usa la plantilla de la firma.',
    input_schema: {
      type: 'object',
      properties: { cuentaDeCobroId: { type: 'string' }, mensaje: { type: 'string' } },
      required: ['cuentaDeCobroId'],
      additionalProperties: false,
    },
  },
]

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

function accountsView(state, empresaId) {
  const t = totals(state)
  return state.accounts.filter((a) => a.active && (!empresaId || a.companyId === empresaId)).map((a) => ({
    id: a.id, nombre: a.name, tipo: a.type, empresa: companyName(state, a.companyId), empresaId: a.companyId,
    ...(isLoan(a) ? { deuda: Math.max(0, -(t.porCuenta[a.id] || 0)) } : { saldo: t.porCuenta[a.id] || 0 }),
  }))
}

/** Ejecuta una herramienta. deps.sendWhatsApp(number, text) se inyecta desde el router. */
export async function runTool(name, input, actor, deps) {
  const { state } = await readState(actor)
  const clientOf = (id) => state.clients.find((c) => c.id === id)
  const money = (n) => Number(n) || 0
  const empresas = state.companies.filter((c) => c.active)
  const validEmpresa = (id) => id && state.companies.some((c) => c.id === id)
  const scopeOf = (id) => (validEmpresa(id) ? (x) => x.companyId === id : () => true)
  // Cuando hay varias empresas, crear registros exige decir cuál
  const needEmpresa = (id) => empresas.length > 1 && !validEmpresa(id)
  const empresaError = { error: 'Hay varias empresas. Indica empresaId (usa ver_empresas) o pregunta a la persona a cuál empresa corresponde.' }

  switch (name) {
    case 'ver_empresas':
      return empresas.map((c) => ({ id: c.id, nombre: c.name, nit: c.nit, regimen: c.regimen, practicaRetencion: c.regimen !== 'simple' }))
    case 'resumen': {
      const build = (cid) => {
        const inS = cid ? (x) => x.companyId === cid : () => true
        const t = totals(state, cid || 'all')
        const hoy = todayISO()
        const en30 = addDaysISO(hoy, 30)
        const pend = state.expenses.filter((e) => inS(e) && e.status !== 'pagado')
        const prioritarias = sortByPriority(pend.filter((e) => computePriority(e) === 'alta'))
        const invs = state.invoices.filter(inS)
        const vencidas = invs.filter((i) => invoiceStatus(i) === 'vencida')
        return {
          empresa: cid ? companyName(state, cid) : 'Todas',
          disponible: t.disponible, deudas: t.deudas, neto: t.neto,
          cuentas: accountsView(state, cid),
          porCobrarTotal: invs.reduce((s, i) => s + invoiceBalance(i), 0),
          porCobrarVencido: vencidas.reduce((s, i) => s + invoiceBalance(i), 0),
          clientesVencidos: vencidas.map((i) => ({ cliente: clientOf(i.clientId)?.name, numero: i.number, saldo: invoiceBalance(i), vencioHace: -daysUntil(i.dueDate) })),
          porPagar30dias: pend.filter((e) => e.dueDate <= en30).reduce((s, e) => s + e.amount, 0),
          prioritarias: prioritarias.map((e) => ({ id: e.id, concepto: e.concept, proveedor: e.supplier, valor: e.amount, vence: e.dueDate })),
          totalPrioritarias: prioritarias.reduce((s, e) => s + e.amount, 0),
          antiguedadCartera: agingBuckets(invs),
        }
      }
      if (validEmpresa(input.empresaId)) return { fecha: todayISO(), ...build(input.empresaId) }
      return { fecha: todayISO(), consolidado: build(null), porEmpresa: empresas.map((c) => build(c.id)) }
    }
    case 'informe_mensual': {
      const mes = /^\d{4}-\d{2}$/.test(input.mes || '') ? input.mes : undefined
      const r = monthlyReport(state, validEmpresa(input.empresaId) ? input.empresaId : 'all', mes)
      return {
        mes: monthLabel(r.month), empresa: validEmpresa(input.empresaId) ? companyName(state, input.empresaId) : 'Todas',
        facturado: r.facturado, honorarios: r.honorarios, gastosReembolsables: r.gastosReembolsables, cuentasDeCobroEmitidas: r.facturas,
        cobrado: r.cobrado, pagosRecibidos: r.pagos,
        gastosPagados: r.totalGastosPagados, otrosEgresos: r.totalOtrosEgresos, gastosPendientesDelMes: r.totalGastosPendientes,
        resultado: r.resultado, carteraPendienteTotal: r.carteraPendiente,
        gastosPorRubro: r.porEtiqueta, gastosPorCategoria: r.porCategoria, facturadoPorCliente: r.porCliente, cobradoPorCliente: r.cobrosPorCliente,
        porEmpresa: r.porEmpresa,
      }
    }
    case 'ver_cuentas':
      return accountsView(state, validEmpresa(input.empresaId) ? input.empresaId : null)
    case 'buscar_clientes': {
      const q = (input.texto || '').toLowerCase().trim()
      return state.clients
        .filter(scopeOf(input.empresaId))
        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.nit || '').toLowerCase().includes(q))
        .map((c) => ({ id: c.id, empresa: companyName(state, c.companyId), empresaId: c.companyId, nombre: c.name, nit: c.nit, celular: c.phone, correo: c.email, saldoPendiente: state.invoices.filter((i) => i.clientId === c.id).reduce((s, i) => s + invoiceBalance(i), 0) }))
    }
    case 'ver_cuentas_de_cobro': {
      const solo = input.soloPendientes !== false
      return state.invoices
        .filter(scopeOf(input.empresaId))
        .filter((i) => (!input.clienteId || i.clientId === input.clienteId) && (!solo || invoiceBalance(i) > 0))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map((i) => ({ id: i.id, numero: i.number, empresa: companyName(state, i.companyId), cliente: clientOf(i.clientId)?.name, clienteId: i.clientId, concepto: i.concept, total: invoiceTotal(i), pagado: invoicePaid(i), saldo: invoiceBalance(i), vence: i.dueDate, estado: invoiceStatus(i) }))
    }
    case 'ver_cuentas_por_pagar': {
      const solo = input.soloPendientes !== false
      return sortByPriority(state.expenses.filter(scopeOf(input.empresaId)).filter((e) => (!solo || e.status !== 'pagado') && (!input.prioridad || computePriority(e) === input.prioridad) && (!input.etiqueta || (e.tags || []).some((t) => t.toLowerCase() === input.etiqueta.toLowerCase()))))
        .map((e) => ({ id: e.id, empresa: companyName(state, e.companyId), concepto: e.concept, proveedor: e.supplier, categoria: e.category, etiquetas: e.tags || [], valor: e.amount, fechaLimite: e.dueDate, prioridad: e.status === 'pagado' ? null : computePriority(e), estado: e.status, gastoFijo: !!e.recurringId }))
    }
    case 'crear_cliente': {
      if (needEmpresa(input.empresaId)) return empresaError
      const r = await applyAction({ type: 'client/add', client: { name: input.nombre, nit: input.nit || '', phone: (input.celular || '').replace(/\D/g, ''), email: input.correo || '', contact: '', notes: input.notas || '', companyId: resolveCompanyId(state, input.empresaId) } }, actor)
      const c = r.state.clients[r.state.clients.length - 1]
      return { ok: true, clienteId: c.id, nombre: c.name }
    }
    case 'crear_cuenta_de_cobro': {
      if (!clientOf(input.clienteId)) return { error: 'No existe un cliente con ese id. Usa buscar_clientes.' }
      const items = [{ desc: input.concepto, kind: 'honorarios', amount: money(input.honorarios) }]
      if (money(input.gastos) > 0) items.push({ desc: input.detalleGastos || 'Gastos reembolsables', kind: 'gastos', amount: money(input.gastos) })
      const hoy = todayISO()
      const r = await applyAction({ type: 'invoice/add', invoice: { clientId: input.clienteId, number: input.numero || '', concept: input.concepto, issueDate: hoy, dueDate: input.fechaVencimiento || addDaysISO(hoy, 30), items, notes: '' } }, actor)
      const inv = r.state.invoices[r.state.invoices.length - 1]
      return { ok: true, cuentaDeCobroId: inv.id, numero: inv.number, total: invoiceTotal(inv), vence: inv.dueDate }
    }
    case 'registrar_pago_cliente': {
      const inv = state.invoices.find((i) => i.id === input.cuentaDeCobroId)
      if (!inv) return { error: 'No existe esa cuenta de cobro. Usa ver_cuentas_de_cobro.' }
      if (!(money(input.valor) > 0)) return { error: 'El valor debe ser mayor a cero.' }
      const accountId = input.cuentaId || defaultAccountId(state, inv.companyId)
      if (!state.accounts.some((a) => a.id === accountId)) return { error: 'No existe esa cuenta bancaria. Usa ver_cuentas.' }
      const r = await applyAction({ type: 'invoice/payment', id: inv.id, amount: money(input.valor), date: input.fecha || todayISO(), note: input.nota || 'Registrado por WhatsApp', accountId }, actor)
      const after = r.state.invoices.find((i) => i.id === inv.id)
      return { ok: true, numero: inv.number, cliente: clientOf(inv.clientId)?.name, pagado: money(input.valor), saldoRestante: invoiceBalance(after), entroA: accountName(r.state, accountId), nuevoSaldoCuenta: totals(r.state).porCuenta[accountId] }
    }
    case 'crear_cuenta_por_pagar': {
      if (!(money(input.valor) > 0)) return { error: 'El valor debe ser mayor a cero.' }
      if (needEmpresa(input.empresaId)) return empresaError
      const r = await applyAction({ type: 'expense/add', expense: { concept: input.concepto, supplier: input.proveedor || '', category: input.categoria || 'Otros', amount: money(input.valor), dueDate: input.fechaLimite, cutsService: !!input.cortanServicio, hasInterest: !!input.generaIntereses, notes: input.notas || '', tags: Array.isArray(input.etiquetas) ? input.etiquetas.map(String) : [], companyId: resolveCompanyId(state, input.empresaId) } }, actor)
      const e = r.state.expenses[r.state.expenses.length - 1]
      return { ok: true, id: e.id, concepto: e.concept, valor: e.amount, fechaLimite: e.dueDate, prioridad: computePriority(e) }
    }
    case 'pagar_cuentas_por_pagar': {
      const ids = (input.ids || []).filter((id) => state.expenses.some((e) => e.id === id && e.status !== 'pagado'))
      if (!ids.length) return { error: 'Ninguno de esos ids corresponde a una cuenta pendiente. Usa ver_cuentas_por_pagar.' }
      const accountId = input.cuentaId || defaultAccountId(state, state.expenses.find((e) => e.id === ids[0])?.companyId)
      if (!state.accounts.some((a) => a.id === accountId)) return { error: 'No existe esa cuenta bancaria. Usa ver_cuentas.' }
      const total = state.expenses.filter((e) => ids.includes(e.id)).reduce((s, e) => s + e.amount, 0)
      const r = await applyAction({ type: 'expense/pay', ids, date: input.fecha || todayISO(), accountId }, actor)
      return { ok: true, pagadas: ids.length, total, desde: accountName(r.state, accountId), nuevoSaldoCuenta: totals(r.state).porCuenta[accountId] }
    }
    case 'registrar_movimiento': {
      if (!state.accounts.some((a) => a.id === input.cuentaId)) return { error: 'No existe esa cuenta. Usa ver_cuentas.' }
      if (!(money(input.valor) > 0)) return { error: 'El valor debe ser mayor a cero.' }
      const r = await applyAction({ type: 'cash/movement', movement: { type: input.tipo, amount: money(input.valor), date: input.fecha || todayISO(), description: input.descripcion, accountId: input.cuentaId } }, actor)
      return { ok: true, nuevoSaldoCuenta: totals(r.state).porCuenta[input.cuentaId] }
    }
    case 'traslado': {
      if (!state.accounts.some((a) => a.id === input.desdeCuentaId) || !state.accounts.some((a) => a.id === input.haciaCuentaId)) return { error: 'Alguna de las cuentas no existe. Usa ver_cuentas.' }
      const r = await applyAction({ type: 'cash/transfer', fromId: input.desdeCuentaId, toId: input.haciaCuentaId, amount: money(input.valor), date: input.fecha || todayISO(), description: input.descripcion || '' }, actor)
      const t = totals(r.state)
      return { ok: true, cuentas: accountsView(r.state), disponible: t.disponible, deudas: t.deudas }
    }
    case 'ajustar_saldo': {
      if (!state.accounts.some((a) => a.id === input.cuentaId)) return { error: 'No existe esa cuenta. Usa ver_cuentas.' }
      const r = await applyAction({ type: 'cash/setBalance', accountId: input.cuentaId, balance: money(input.saldo), description: input.motivo || 'Ajuste por WhatsApp' }, actor)
      return { ok: true, cuentas: accountsView(r.state) }
    }
    case 'enviar_cuenta_de_cobro': {
      if (!deps?.sendInvoicePDF) return { error: 'El envío de PDF por WhatsApp no está disponible.' }
      try {
        return await deps.sendInvoicePDF(state, input.cuentaDeCobroId, input.mensaje, actor)
      } catch (e) {
        return { error: e.message }
      }
    }
    case 'enviar_recordatorio': {
      const inv = state.invoices.find((i) => i.id === input.cuentaDeCobroId)
      if (!inv) return { error: 'No existe esa cuenta de cobro.' }
      const c = clientOf(inv.clientId)
      const phone = (c?.phone || '').replace(/\D/g, '')
      if (!phone) return { error: `El cliente ${c?.name ?? ''} no tiene celular registrado.` }
      const message = input.mensaje || fillTemplate(state.settings.reminderTemplate, { nombre: c.contact || c.name, numero: inv.number, valor: cop(invoiceBalance(inv)), fecha: fmtDate(inv.dueDate) })
      if (!deps?.sendWhatsApp) return { error: 'El envío por WhatsApp no está disponible.' }
      await deps.sendWhatsApp(`${state.settings.countryCode || '57'}${phone}`, message)
      await applyAction({ type: 'reminder/add', reminder: { clientId: c.id, invoiceId: inv.id, date: todayISO(), channel: 'WhatsApp (asistente)', message } }, actor)
      return { ok: true, enviadoA: c.name, celular: phone, mensaje: message }
    }
    default:
      return { error: `Herramienta desconocida: ${name}` }
  }
}

function systemPrompt(state, actorName) {
  const hoy = todayISO()
  const empresas = state.companies.filter((c) => c.active)
  const listaEmpresas = empresas.map((c) => `${c.name} (id ${c.id}${c.regimen === 'simple' ? ', régimen simple' : ''})`).join('; ')
  return `Eres ${state.settings?.whatsapp?.assistantName || 'el asistente administrativo'} de ${state.settings.firmName}, un grupo de empresas de servicios jurídicos y tributarios en Colombia. Hablas por WhatsApp con ${actorName || 'la persona encargada de la administración'}.

Tu trabajo: consultar y registrar en el sistema administrativo (clientes, cuentas de cobro, pagos de clientes, cuentas por pagar, cuentas bancarias, caja menor, préstamos, recordatorios e informes) usando las herramientas. Hoy es ${hoy}.

Empresas registradas: ${listaEmpresas || 'una sola'}. Cada cliente, gasto y cuenta bancaria pertenece a una empresa. Cuando pregunten sin decir empresa, responde con el consolidado y el detalle por empresa. Cuando vayan a crear algo y haya varias empresas, pregunta a cuál corresponde si no es evidente por el contexto (por ejemplo, si nombran a un cliente que ya existe, usa su empresa).

Reglas:
- Siempre consulta con las herramientas antes de afirmar cifras; nunca inventes datos ni ids.
- Montos en pesos colombianos. Interpreta "2 millones" = 2000000, "350 mil" = 350000, "1.5 palos" = 1500000.
- Antes de registrar un pago, crear una cuenta de cobro o pagar algo, si falta un dato clave (qué cliente, qué valor, de qué cuenta bancaria sale o entra el dinero) pregunta en un solo mensaje corto. Si todo está claro, ejecútalo y confirma lo hecho con cifras.
- Si hay varias cuentas bancarias y no te dicen cuál, pregunta cuál usar, salvo que solo haya una.
- Si un cliente no existe y te piden crearle una cuenta de cobro, propón crearlo.
- Respuestas cortas, para leer en el celular: frases directas, sin encabezados ni tablas. Para listas usa guiones. Formatea montos como $ 2.500.000.
- Nunca ejecutes borrados ni cambies configuración. No des asesoría legal.
- Si el mensaje no tiene que ver con la administración de la firma, dilo amablemente en una línea.`
}

/**
 * Procesa un turno de conversación. history: mensajes previos (formato de la API). content: bloques del usuario.
 * Devuelve { reply, messages } con la transcripción completa (solo se agrega, nunca se edita).
 */
export async function runAgent({ history, content, actor, actorName, deps }) {
  const client = deps?.anthropic || new Anthropic()
  const { state } = await readState(actor)
  const messages = [...history, { role: 'user', content }]
  const system = [{ type: 'text', text: systemPrompt(state, actorName), cache_control: { type: 'ephemeral' } }]
  let useFallbacks = deps?.useFallbacks !== false
  let reply = ''

  for (let i = 0; i < 12; i++) {
    let response
    try {
      response = useFallbacks
        ? await client.beta.messages.create({ model: MODEL, max_tokens: 4096, system, tools: TOOLS, messages, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' } })
        : await client.messages.create({ model: MODEL, max_tokens: 4096, system, tools: TOOLS, messages, output_config: { effort: 'medium' } })
    } catch (e) {
      if (useFallbacks && e?.status === 400) {
        useFallbacks = false
        i--
        continue
      }
      throw e
    }

    messages.push({ role: 'assistant', content: response.content })
    const texts = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    if (texts) reply = texts

    if (response.stop_reason === 'refusal') {
      reply = reply || 'No puedo ayudar con eso.'
      break
    }
    if (response.stop_reason === 'pause_turn') continue
    if (response.stop_reason !== 'tool_use') break

    const toolUses = response.content.filter((b) => b.type === 'tool_use')
    const results = []
    for (const tu of toolUses) {
      let out
      try {
        out = await runTool(tu.name, tu.input || {}, actor, deps)
      } catch (e) {
        out = { error: e.message }
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out), is_error: !!out?.error })
    }
    messages.push({ role: 'user', content: results })
  }

  return { reply: reply || 'Listo.', messages }
}

export { TOOLS }
