import bcrypt from 'bcryptjs'
import { db } from './knex.js'

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()

const COMPANIES = [
  { name: 'Núcleo Pensional', slug: 'nucleo-pensional', color: '#2563eb', sector: 'Asesoría pensional',
    description: 'Asesoría en pensiones, traslados de régimen, corrección de historia laboral y reconocimiento de pensión.',
    services: ['Traslado de régimen', 'Corrección historia laboral', 'Reconocimiento pensión', 'Pensión de sobrevivientes'] },
  { name: 'Abogado Fiduciario', slug: 'abogado-fiduciario', color: '#7c3aed', sector: 'Servicios jurídicos',
    description: 'Abogados especializados en fiducia, patrimonio autónomo, sucesiones y protección patrimonial.',
    services: ['Fiducia mercantil', 'Sucesión', 'Protección patrimonial', 'Consulta jurídica'] },
  { name: 'Piensas - Fogainc', slug: 'piensas-fogainc', color: '#ea580c', sector: 'Asesoría pensional y financiera',
    description: 'Acompañamiento en pensiones, planeación de retiro y asesoría financiera. (Editar descripción y servicios en Configuración.)',
    services: ['Asesoría pensional', 'Plan de retiro', 'Consulta financiera'] },
  { name: 'DDI', slug: 'ddi', color: '#059669', sector: 'Servicios',
    description: 'Empresa DDI. (Editar descripción y servicios en Configuración para que el agente IA responda con información real.)',
    services: ['Consulta general', 'Cotización', 'Soporte'] },
]

const STAGES = [
  { name: 'Nuevo', color: '#64748b' },
  { name: 'Contactado', color: '#0ea5e9' },
  { name: 'Calificado', color: '#8b5cf6' },
  { name: 'Propuesta', color: '#f59e0b' },
  { name: 'Ganado', color: '#16a34a', is_won: true },
  { name: 'Perdido', color: '#dc2626', is_lost: true },
]

const TAGS = [
  ['Caliente', '#dc2626'], ['Tibio', '#f59e0b'], ['Frío', '#0ea5e9'],
  ['Google Ads', '#2563eb'], ['Meta Ads', '#7c3aed'], ['Referido', '#16a34a'], ['Sin respuesta', '#64748b'],
]

const NAMES = ['Carlos Pérez', 'María Gómez', 'Andrés Rojas', 'Luisa Martínez', 'Jorge Ramírez', 'Paola Torres',
  'Camilo Herrera', 'Diana Castro', 'Felipe Ruiz', 'Natalia López', 'Sebastián Moreno', 'Valentina Díaz']

const OPENERS = {
  'nucleo-pensional': [
    'Buenas tardes, quiero saber si puedo trasladarme de Porvenir a Colpensiones',
    'Hola, tengo 58 años y quiero saber cuántas semanas me faltan',
    'Vi su anuncio en Google, necesito corregir mi historia laboral',
    'Mi papá falleció y quiero saber de la pensión de sobrevivientes',
  ],
  'abogado-fiduciario': [
    'Buen día, necesito asesoría sobre una fiducia para proteger un inmueble',
    'Hola, quiero iniciar una sucesión, ¿cuánto vale la consulta?',
    'Necesito un abogado para revisar un contrato de fiducia mercantil',
  ],
  'piensas-fogainc': [
    'Hola, quiero saber cómo va mi trámite de pensión, ¿me pueden asesorar?',
    'Quiero un plan de retiro, tengo 35 años',
    'Buenas, ¿cómo funciona la asesoría financiera?',
  ],
  ddi: [
    'Buenas tardes, quiero información de sus servicios',
    'Hola, necesito una cotización',
    'Vi su anuncio en Google, ¿me pueden contactar?',
  ],
}

const SOURCES = ['google_ads', 'meta_ads', 'organico', 'referido', 'web']

async function run() {
  console.log('Limpiando datos existentes...')
  for (const t of ['activity_log', 'ai_settings', 'automations', 'quick_replies', 'tasks', 'notes', 'messages',
    'conversation_tags', 'conversations', 'pipeline_stages', 'pipelines', 'tags', 'contacts',
    'whatsapp_instances', 'company_users', 'users', 'companies']) await db(t).del()

  const hash = await bcrypt.hash('demo1234', 10)
  const [admin] = await db('users').insert({ name: 'Ana Administradora', email: 'admin@demo.com', password_hash: hash, role: 'admin' }).returning('id')
  const [a1] = await db('users').insert({ name: 'Kevin Comercial', email: 'kevin@demo.com', password_hash: hash, role: 'agent' }).returning('id')
  const [a2] = await db('users').insert({ name: 'Laura Asesora', email: 'laura@demo.com', password_hash: hash, role: 'agent' }).returning('id')
  const agents = [a1.id ?? a1, a2.id ?? a2]
  const adminId = admin.id ?? admin

  let ci = 0
  for (const c of COMPANIES) {
    ci++
    const [cRow] = await db('companies').insert({ name: c.name, slug: c.slug, color: c.color, sector: c.sector, description: c.description }).returning('id')
    const companyId = cRow.id ?? cRow
    await db('company_users').insert([{ company_id: companyId, user_id: adminId }, ...agents.map((u) => ({ company_id: companyId, user_id: u }))])

    const [inst] = await db('whatsapp_instances').insert({
      company_id: companyId, name: `WhatsApp ${c.name}`, phone: `+57 31${ci} 000 00${ci}${ci}`,
      provider: 'demo', instance_key: `demo-${c.slug}`, status: ci <= 2 ? 'connected' : 'disconnected',
      connected_at: ci <= 2 ? minutesAgo(600) : null,
    }).returning('id')
    const instanceId = inst.id ?? inst

    const tagIds = {}
    for (const [name, color] of TAGS) {
      const [t] = await db('tags').insert({ company_id: companyId, name, color }).returning('id')
      tagIds[name] = t.id ?? t
    }

    const [p] = await db('pipelines').insert({ company_id: companyId, name: 'Ventas', is_default: true }).returning('id')
    const pipelineId = p.id ?? p
    const stageIds = []
    let pos = 0
    for (const s of STAGES) {
      const [st] = await db('pipeline_stages').insert({ pipeline_id: pipelineId, name: s.name, color: s.color, position: pos++, is_won: !!s.is_won, is_lost: !!s.is_lost }).returning('id')
      stageIds.push(st.id ?? st)
    }

    await db('quick_replies').insert([
      { company_id: companyId, shortcut: 'saludo', body: `¡Hola! Gracias por escribir a ${c.name}. Soy {{agente}}, ¿en qué te puedo ayudar?` },
      { company_id: companyId, shortcut: 'horario', body: 'Nuestro horario de atención es de lunes a viernes de 8:00 a.m. a 6:00 p.m.' },
      { company_id: companyId, shortcut: 'cita', body: '¿Te parece si agendamos una llamada? Dime qué día y hora te queda bien.' },
      { company_id: companyId, shortcut: 'docs', body: 'Para avanzar necesito que me envíes por aquí: cédula, y los documentos relacionados con tu caso.' },
    ])

    await db('automations').insert([
      { company_id: companyId, name: 'Bienvenida automática', trigger: 'new_conversation', conditions: '{}', enabled: true,
        actions: JSON.stringify([{ type: 'reply', body: `¡Hola! Bienvenido a ${c.name} 👋. En un momento uno de nuestros asesores te atenderá. Mientras tanto, cuéntanos en qué te podemos ayudar.` }, { type: 'move_stage', stage_name: 'Nuevo' }]) },
      { company_id: companyId, name: 'Etiquetar leads de Google Ads', trigger: 'new_conversation', conditions: JSON.stringify({ source: 'google_ads' }), enabled: true,
        actions: JSON.stringify([{ type: 'add_tag', tag_name: 'Google Ads' }]) },
      { company_id: companyId, name: 'Etiquetar leads de Meta Ads', trigger: 'new_conversation', conditions: JSON.stringify({ source: 'meta_ads' }), enabled: true,
        actions: JSON.stringify([{ type: 'add_tag', tag_name: 'Meta Ads' }]) },
      { company_id: companyId, name: 'Asignación automática (round robin)', trigger: 'new_conversation', conditions: '{}', enabled: true,
        actions: JSON.stringify([{ type: 'assign', mode: 'round_robin' }]) },
      { company_id: companyId, name: 'Palabra clave: precio', trigger: 'keyword', enabled: true, conditions: JSON.stringify({ keywords: ['precio', 'costo', 'cuánto vale', 'cuanto vale', 'valor'] }),
        actions: JSON.stringify([{ type: 'add_tag', tag_name: 'Caliente' }, { type: 'move_stage', stage_name: 'Calificado' }]) },
      { company_id: companyId, name: 'Fuera de horario', trigger: 'outside_hours', conditions: '{}', enabled: true,
        actions: JSON.stringify([{ type: 'reply', body: 'Gracias por escribirnos. En este momento estamos fuera de horario (L-V 8am a 6pm). Te responderemos a primera hora. 🙌' }]) },
      { company_id: companyId, name: 'Sin respuesta 2 horas', trigger: 'inactivity', conditions: JSON.stringify({ minutes: 120, who: 'us' }), enabled: true,
        actions: JSON.stringify([{ type: 'add_tag', tag_name: 'Sin respuesta' }, { type: 'notify', body: 'Lead lleva más de 2 horas sin respuesta' }]) },
      { company_id: companyId, name: 'Agente IA responde primero', trigger: 'message_in', conditions: JSON.stringify({ unassigned_only: false, ai_only_when_no_human_reply_minutes: 3 }),
        actions: JSON.stringify([{ type: 'ai_reply' }]), enabled: ci <= 2 },
    ])

    await db('ai_settings').insert({
      company_id: companyId, enabled: true, model: 'claude-opus-5-5', agent_name: `Asistente ${c.name}`,
      instructions: `Eres el asistente virtual de ${c.name} (${c.sector}). Responde en español colombiano, de forma cálida, breve y profesional. Tu objetivo es entender la necesidad del cliente, calificar el lead (nombre, ciudad, servicio de interés) y agendar una llamada con un asesor. No inventes precios ni promesas legales; si preguntan por costos exactos o casos complejos, indica que un asesor humano confirmará y usa la herramienta de entrega a humano.`,
      knowledge: `Servicios: ${c.services.join(', ')}.\nHorario: lunes a viernes 8:00 a.m. a 6:00 p.m.\nCiudad principal: Bogotá, atención virtual en toda Colombia.\nPrimera consulta: sin costo, 20 minutos por videollamada.\nDocumentos usuales: cédula y documentos del caso.`,
    })

    // Conversaciones demo
    const openers = OPENERS[c.slug]
    const count = 5 + ci
    for (let i = 0; i < count; i++) {
      const name = NAMES[(i + ci * 3) % NAMES.length]
      const phone = `57300${String(1000000 + ci * 100000 + i * 7919).slice(-7)}`
      const source = SOURCES[(i + ci) % SOURCES.length]
      const [ct] = await db('contacts').insert({ company_id: companyId, phone, name, source, city: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla'][i % 4],
        campaign: source === 'google_ads' ? 'Search - Marca' : source === 'meta_ads' ? 'Leads IG - Septiembre' : null }).returning('id')
      const contactId = ct.id ?? ct
      const stageIdx = i % 5
      const ageMin = 30 + i * 240 + ci * 50
      const assigned = i % 3 === 2 ? null : agents[i % 2]
      const [conv] = await db('conversations').insert({
        company_id: companyId, instance_id: instanceId, contact_id: contactId, assigned_user_id: assigned,
        pipeline_id: pipelineId, stage_id: stageIds[stageIdx], status: stageIdx === 4 ? 'closed' : 'open',
        service: c.services[i % c.services.length], value: [0, 350000, 800000, 1500000, 2500000][stageIdx],
        unread_count: i % 3 === 0 ? 2 : 0, opened_at: minutesAgo(ageMin), stage_entered_at: minutesAgo(ageMin / 2),
        first_response_at: i % 3 === 2 ? null : minutesAgo(ageMin - 5), last_message_at: minutesAgo(i * 13 + 2),
        last_inbound_at: minutesAgo(i * 13 + 2), last_outbound_at: i % 3 === 2 ? null : minutesAgo(i * 13 + 20),
        closed_at: stageIdx === 4 ? minutesAgo(10) : null,
      }).returning('id')
      const convId = conv.id ?? conv
      await db('conversation_tags').insert({ conversation_id: convId, tag_id: tagIds[source === 'google_ads' ? 'Google Ads' : source === 'meta_ads' ? 'Meta Ads' : ['Caliente', 'Tibio', 'Frío'][i % 3]] })
      const msgs = [
        { direction: 'in', sender_type: 'contact', body: openers[i % openers.length], created_at: minutesAgo(ageMin) },
        { direction: 'out', sender_type: 'bot', body: `¡Hola ${name.split(' ')[0]}! Bienvenido a ${c.name} 👋. En un momento uno de nuestros asesores te atenderá.`, created_at: minutesAgo(ageMin - 1) },
      ]
      if (i % 3 !== 2) msgs.push(
        { direction: 'out', sender_type: 'user', sender_user_id: assigned, body: `Hola ${name.split(' ')[0]}, soy tu asesor. Con gusto te ayudo, ¿me cuentas un poco más de tu caso?`, created_at: minutesAgo(ageMin - 5) },
        { direction: 'in', sender_type: 'contact', body: 'Claro, te cuento: llevo varios años cotizando y quiero saber cuál es la mejor opción para mí.', created_at: minutesAgo(i * 13 + 2) },
      )
      await db('messages').insert(msgs.map((m) => ({ ...m, conversation_id: convId })))
      if (i % 2 === 0) await db('notes').insert({ conversation_id: convId, user_id: assigned || adminId, body: 'Cliente interesado, pidió que lo llamaran en la tarde.' })
      if (i % 4 === 1) await db('tasks').insert({ company_id: companyId, conversation_id: convId, user_id: assigned || adminId, title: `Llamar a ${name}`, due_at: new Date(Date.now() + 3600_000 * (i + 1)).toISOString() })
      await db('activity_log').insert({ company_id: companyId, conversation_id: convId, type: 'conversation.created', data: JSON.stringify({ source }), created_at: minutesAgo(ageMin) })
    }
  }
  console.log('Seed listo. Usuarios: admin@demo.com, kevin@demo.com, laura@demo.com (clave: demo1234)')
}

await run()
if (process.argv[1]?.endsWith('seed.js')) await db.destroy()
