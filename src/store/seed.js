import { addDaysISO, todayISO, uid } from '../lib/format.js'

/**
 * Datos de ejemplo para que la app se vea con contenido la primera vez.
 * Se pueden borrar desde Caja > Configuración.
 */
export function buildSeed() {
  const hoy = todayISO()
  const c1 = uid('cli')
  const c2 = uid('cli')
  const c3 = uid('cli')
  const c4 = uid('cli')

  const clients = [
    { id: c1, name: 'Inversiones del Norte S.A.S.', nit: '901.234.567-8', phone: '3001234567', email: 'contabilidad@invnorte.co', contact: 'Laura Gómez', notes: 'Paga a 30 días, siempre pide cuenta de cobro.' },
    { id: c2, name: 'Carlos Andrés Pérez', nit: '79.456.123', phone: '3109876543', email: 'carlosperez@gmail.com', contact: '', notes: 'Proceso laboral. Acordó pagar en 3 cuotas.' },
    { id: c3, name: 'Constructora Horizonte Ltda.', nit: '800.987.654-1', phone: '3156667788', email: 'gerencia@horizonte.com.co', contact: 'Mauricio Rojas', notes: '' },
    { id: c4, name: 'María Fernanda Restrepo', nit: '43.123.987', phone: '3012223344', email: 'mfrestrepo@hotmail.com', contact: '', notes: 'Sucesión. Buena pagadora.' },
  ]

  const invoices = [
    {
      id: uid('inv'), number: 'CC-2026-041', clientId: c1, issueDate: addDaysISO(hoy, -45), dueDate: addDaysISO(hoy, -15),
      concept: 'Asesoría contractual septiembre',
      items: [
        { desc: 'Honorarios asesoría mensual', kind: 'honorarios', amount: 4500000 },
        { desc: 'Autenticaciones notaría', kind: 'gastos', amount: 180000 },
      ],
      payments: [], notes: '',
    },
    {
      id: uid('inv'), number: 'CC-2026-044', clientId: c2, issueDate: addDaysISO(hoy, -30), dueDate: addDaysISO(hoy, 5),
      concept: 'Proceso laboral - cuota 2 de 3',
      items: [{ desc: 'Honorarios proceso laboral (cuota 2/3)', kind: 'honorarios', amount: 2000000 }],
      payments: [{ id: uid('pay'), date: addDaysISO(hoy, -10), amount: 800000, note: 'Abono transferencia', accountId: 'acc_davivienda' }], notes: '',
    },
    {
      id: uid('inv'), number: 'CC-2026-047', clientId: c3, issueDate: addDaysISO(hoy, -8), dueDate: addDaysISO(hoy, 22),
      concept: 'Revisión de contratos de obra',
      items: [
        { desc: 'Honorarios revisión contratos', kind: 'honorarios', amount: 6800000 },
        { desc: 'Certificados Cámara de Comercio', kind: 'gastos', amount: 96000 },
      ],
      payments: [], notes: '',
    },
    {
      id: uid('inv'), number: 'CC-2026-039', clientId: c4, issueDate: addDaysISO(hoy, -60), dueDate: addDaysISO(hoy, -30),
      concept: 'Sucesión - honorarios etapa 1',
      items: [{ desc: 'Honorarios sucesión etapa 1', kind: 'honorarios', amount: 3200000 }],
      payments: [{ id: uid('pay'), date: addDaysISO(hoy, -28), amount: 3200000, note: 'Pago total', accountId: 'acc_bancolombia' }], notes: '',
    },
    {
      id: uid('inv'), number: 'CC-2026-048', clientId: c4, issueDate: addDaysISO(hoy, -3), dueDate: addDaysISO(hoy, 27),
      concept: 'Sucesión - honorarios etapa 2',
      items: [
        { desc: 'Honorarios sucesión etapa 2', kind: 'honorarios', amount: 2800000 },
        { desc: 'Impuesto de registro', kind: 'gastos', amount: 450000 },
      ],
      payments: [], notes: '',
    },
  ]

  const recurring = [
    { id: uid('rec'), concept: 'Arriendo oficina', supplier: 'Inmobiliaria Centro', category: 'Arriendo', amount: 2800000, dayOfMonth: 5, cutsService: false, active: true },
    { id: uid('rec'), concept: 'Internet y telefonía', supplier: 'Claro Empresas', category: 'Servicios', amount: 245000, dayOfMonth: 18, cutsService: true, active: true },
    { id: uid('rec'), concept: 'Energía', supplier: 'EPM', category: 'Servicios', amount: 310000, dayOfMonth: 22, cutsService: true, active: true },
    { id: uid('rec'), concept: 'Honorarios contador', supplier: 'Contadores Asociados', category: 'Honorarios', amount: 650000, dayOfMonth: 10, cutsService: false, active: true },
    { id: uid('rec'), concept: 'Nómina asistente administrativa', supplier: 'Nómina', category: 'Nómina', amount: 2100000, dayOfMonth: 30, cutsService: false, active: true },
    { id: uid('rec'), concept: 'Software jurídico (licencia)', supplier: 'LegalSoft', category: 'Software', amount: 189000, dayOfMonth: 15, cutsService: true, active: true },
  ]

  const expenses = [
    { id: uid('exp'), concept: 'Papelería y tóner', supplier: 'Papelería La 70', category: 'Oficina', amount: 165000, dueDate: addDaysISO(hoy, 12), status: 'pendiente', manualPriority: null, cutsService: false, hasInterest: false, notes: '' },
    { id: uid('exp'), concept: 'Perito contable - caso Pérez', supplier: 'Jorge Mejía', category: 'Gastos de procesos', amount: 900000, dueDate: addDaysISO(hoy, 3), status: 'pendiente', manualPriority: null, cutsService: false, hasInterest: false, notes: 'Reembolsable al cliente' },
    { id: uid('exp'), concept: 'Tarjeta de crédito empresarial', supplier: 'Bancolombia', category: 'Financiero', amount: 1350000, dueDate: addDaysISO(hoy, -2), status: 'pendiente', manualPriority: null, cutsService: false, hasInterest: true, notes: '' },
    { id: uid('exp'), concept: 'Mantenimiento aire acondicionado', supplier: 'Climatec', category: 'Mantenimiento', amount: 220000, dueDate: addDaysISO(hoy, 35), status: 'pendiente', manualPriority: null, cutsService: false, hasInterest: false, notes: '' },
  ]

  const accounts = [
    { id: 'acc_bancolombia', name: 'Bancolombia', type: 'banco', active: true },
    { id: 'acc_davivienda', name: 'Davivienda', type: 'banco', active: true },
    { id: 'acc_caja', name: 'Caja menor', type: 'efectivo', active: true },
    { id: 'acc_prestamo', name: 'Préstamo Bancolombia', type: 'prestamo', active: true },
  ]
  const cash = {
    movements: [
      { id: uid('mov'), date: addDaysISO(hoy, -40), type: 'ajuste', amount: 5250000, accountId: 'acc_bancolombia', description: 'Saldo inicial', ref: null },
      { id: uid('mov'), date: addDaysISO(hoy, -40), type: 'ajuste', amount: 1800000, accountId: 'acc_davivienda', description: 'Saldo inicial', ref: null },
      { id: uid('mov'), date: addDaysISO(hoy, -40), type: 'ajuste', amount: 350000, accountId: 'acc_caja', description: 'Saldo inicial', ref: null },
      { id: uid('mov'), date: addDaysISO(hoy, -40), type: 'ajuste', amount: -4500000, accountId: 'acc_prestamo', description: 'Saldo inicial (deuda)', ref: null },
      { id: uid('mov'), date: addDaysISO(hoy, -28), type: 'ingreso', amount: 3200000, accountId: 'acc_bancolombia', description: 'Pago María Fernanda Restrepo - CC-2026-039', ref: { kind: 'invoice', id: invoices[3].id } },
      { id: uid('mov'), date: addDaysISO(hoy, -10), type: 'ingreso', amount: 800000, accountId: 'acc_davivienda', description: 'Abono Carlos Andrés Pérez - CC-2026-044', ref: { kind: 'invoice', id: invoices[1].id } },
    ],
  }

  return {
    version: 2,
    accounts,
    settings: {
      whatsapp: { allowedNumbers: [], assistantName: 'Asistente S&Go' },
      firmName: 'S&Go Abogados',
      reminderTemplate:
        'Hola {nombre}, le escribimos de S&Go Abogados. Le recordamos que la cuenta de cobro {numero} por {valor} tiene fecha de vencimiento el {fecha}. Quedamos atentos a su pago. ¡Gracias!',
      countryCode: '57',
    },
    clients,
    invoices,
    expenses,
    recurring,
    reminders: [],
    cash,
    nextInvoiceNumber: 49,
  }
}

export function emptyState() {
  return {
    version: 2,
    accounts: [{ id: 'acc_principal', name: 'Cuenta principal', type: 'banco', active: true }],
    settings: {
      whatsapp: { allowedNumbers: [], assistantName: 'Asistente S&Go' },
      firmName: 'S&Go Abogados',
      reminderTemplate:
        'Hola {nombre}, le escribimos de S&Go Abogados. Le recordamos que la cuenta de cobro {numero} por {valor} tiene fecha de vencimiento el {fecha}. Quedamos atentos a su pago. ¡Gracias!',
      countryCode: '57',
    },
    clients: [],
    invoices: [],
    expenses: [],
    recurring: [],
    reminders: [],
    cash: { movements: [] },
    nextInvoiceNumber: 1,
  }
}
