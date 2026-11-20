// Menú de bienvenida para todas las empresas (borradores basados en sus anuncios; se editan en Automatizaciones).
// Núcleo Pensional se incluye por si su menú no se creó en la migración 011.
import { NUCLEO_MENU } from './011_welcome_menu.js'
const intro = (name, who = 'el asesor indicado') => `¡Hola! 👋 Qué gusto saludarle. Bienvenido(a) a ${name}, con mucho gusto le ayudamos.\n\nPara ponerle en contacto con ${who}, cuéntenos qué necesita respondiendo con el número de la opción:`
const ask = (lead, items, close = 'le escribe {{cuando}}. 😊', who = 'Un abogado') => `${lead} Cuéntenos por favor:\n\n${items.map((i) => `• ${i}`).join('\n')}\n\n${who} ${close}`
const human = (who) => ({ label: `Hablar con ${who === 'abogado' ? 'un abogado' : 'un asesor'}`, service: '', keywords: `${who}, asesor, persona, llamar, llamada`, tag: 'Caliente', notify: true,
  reply: `¡Con gusto! 😊 Ya le avisamos a ${who === 'abogado' ? 'un abogado' : 'un asesor'} para que le escriba {{cuando}}. Mientras tanto, ¿nos regala su nombre completo y la ciudad desde donde nos escribe?` })
const finish = (options, who) => ({
  type: 'menu', options,
  retry: `Disculpe 🙏 para ubicar mejor su caso, ¿nos responde solo con el número de la opción (del 1 al ${options.length})? Si prefiere, escríbanos su pregunta y ${who} le contesta.`,
  after_hours: `🌙 En este momento estamos fuera de horario ({{horario}}), pero puede elegir una opción y dejarnos su consulta: ${who} le escribe {{cuando}}.`,
})
const SOCIETARIO = { label: 'Socios, sociedades y derecho societario', service: 'Derecho societario', keywords: 'socio, socios, minoritario, sociedad, accionista, accionistas, desacuerdo, junta',
  reply: ask('Con mucho gusto le acompañamos. 🤝', ['Su nombre completo', 'Qué tipo de sociedad tiene (S.A.S., limitada, etc.)', 'Qué situación necesita resolver con sus socios']) }

const MENUS = [
  { match: (n) => n.startsWith('nucleopensional'), menu: () => NUCLEO_MENU },
  { match: (n) => n.startsWith('abogadofiduciario'), menu: (name) => ({ intro: intro(name, 'el abogado indicado'), ...finish([
    { label: 'Aporte de lote o negocio con una constructora', service: 'Aporte de lote', keywords: 'aporte, lote, terreno, constructora, constructoras, inmueble, finca',
      reply: ask('¡Perfecto! 🙌 Le ayudamos a estructurar ese negocio de forma segura.', ['Su nombre completo', 'Ciudad donde está el lote o inmueble', 'Si ya tiene una propuesta de la constructora']) },
    { label: 'Estructuración de un negocio o planeación tributaria', service: 'Estructuración de negocio', keywords: 'estructuracion, estructurar, tributaria, tributario, impuestos, proyecto',
      reply: ask('¡Claro que sí! 🙌 Con gusto le orientamos.', ['Su nombre completo', 'Qué tipo de negocio o proyecto quiere estructurar', 'Si es como persona natural o empresa']) },
    SOCIETARIO,
    { label: 'Fiducia, patrimonio o sucesiones', service: 'Fiducia y patrimonio', keywords: 'fiducia, fiduciaria, fideicomiso, patrimonio, herencia, sucesion, proteger',
      reply: ask('¡Con gusto! 🙌 Revisemos la mejor forma de proteger su patrimonio.', ['Su nombre completo', 'Qué bienes o negocio quiere proteger u organizar', 'Si es para una sucesión, una inversión o un proyecto']) },
    human('abogado'),
  ], 'un abogado') }) },
  { match: (n) => n.includes('sgoabogados') || n.includes('suarezygomez'), menu: (name) => ({ intro: intro(name, 'el abogado indicado'), ...finish([
    { label: 'Litigios y procesos judiciales', service: 'Litigios', keywords: 'litigio, litigios, demanda, demandar, proceso, juicio, juzgado, tutela',
      reply: ask('Con mucho gusto revisamos su caso. ⚖️', ['Su nombre completo', 'De qué se trata el proceso o la demanda', 'Si ya hay un proceso en curso y en qué ciudad']) },
    SOCIETARIO,
    { label: 'Asesoría legal y fiduciaria para constructoras', service: 'Constructoras', keywords: 'constructora, constructoras, proyecto inmobiliario, obra, lote, fiducia',
      reply: ask('¡Perfecto! 🙌 Le acompañamos en su proyecto.', ['Su nombre completo y el de la empresa', 'En qué etapa está el proyecto', 'Qué necesita resolver (contratos, fiducia, socios, etc.)']) },
    { label: 'Protección de capital e inversiones', service: 'Protección de capital', keywords: 'capital, inversion, invertir, proteger, patrimonio',
      reply: ask('¡Claro que sí! 🙌 Revisemos cómo proteger su capital.', ['Su nombre completo', 'Qué tipo de inversión o negocio tiene', 'Qué le preocupa o qué quiere lograr']) },
    human('abogado'),
  ], 'un abogado') }) },
  { match: (n) => n.includes('piensas'), menu: (name) => ({ intro: intro(name), ...finish([
    { label: 'Estructurar un proyecto inmobiliario', service: 'Proyecto inmobiliario', keywords: 'inmueble, inmobiliario, proyecto, lote, estructurar, construir',
      reply: ask('¡Perfecto! 🙌 Le ayudamos a pasar del inmueble a un proyecto bien estructurado.', ['Su nombre completo', 'Ciudad del inmueble o lote', 'Qué quiere hacer con él'], undefined, 'Un asesor') },
    { label: 'Fiducia y negocios fiduciarios', service: 'Fiducia', keywords: 'fiducia, fiduciaria, fiduciario, fideicomiso',
      reply: ask('¡Claro que sí! 🙌', ['Su nombre completo', 'Para qué necesita la fiducia (proyecto, inversión o patrimonio)'], undefined, 'Un asesor') },
    { label: 'Cursos, masterclass y eventos', service: 'Cursos y eventos', keywords: 'curso, cursos, masterclass, clase, reto, evento, cafe, inscripcion, inscribirme',
      reply: ask('¡Qué bueno que le interese! 🎓', ['Su nombre completo', 'Qué curso o evento vio', 'Su correo electrónico'], 'le envía la información {{cuando}}. 😊', 'Un asesor') },
    { label: 'Invertir en un proyecto inmobiliario', service: 'Inversión inmobiliaria', keywords: 'invertir, inversion, inversionista, rentabilidad, participar, comprar',
      reply: ask('¡Excelente! 🙌 Con gusto le contamos cómo invertir de forma segura a través de fiducia.', ['Su nombre completo', 'Ciudad donde le gustaría invertir', 'Cuánto le gustaría invertir, aproximadamente'], undefined, 'Un asesor') },
    human('asesor'),
  ], 'un asesor') }) },
  { match: (n) => n === 'ddi' || n.startsWith('ddi'), menu: (name) => ({ intro: intro(name), ...finish([
    { label: 'Información de nuestros servicios', service: 'Información general', keywords: 'informacion, servicios, servicio',
      reply: ask('¡Con gusto! Le contamos todo lo que necesita.', ['Su nombre completo', 'Qué servicio le interesa'], undefined, 'Un asesor') },
    { label: 'Eventos e inscripciones', service: 'Eventos', keywords: 'evento, eventos, inscripcion, inscribirme, invitacion, asistir, confirmar, cupo',
      reply: ask('¡Qué bueno que le interese! 🎉', ['Su nombre completo', 'A qué evento quiere asistir', 'Cuántas personas asistirían'], 'le confirma {{cuando}}. 😊', 'Un asesor') },
    { label: 'Cotización', service: 'Cotización', keywords: 'cotizacion, cotizar, precio, valor, costo',
      reply: ask('¡Claro que sí! 🙌 Con gusto le preparamos la cotización.', ['Su nombre completo o el de su empresa', 'Qué necesita cotizar', 'Su correo electrónico'], undefined, 'Un asesor') },
    human('asesor'),
  ], 'un asesor') }) },
]

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

export async function up(knex) {
  for (const company of await knex('companies')) {
    const def = MENUS.find((m) => m.match(norm(company.name)) || m.match(norm(company.slug)))
    if (!def) continue
    const autos = await knex('automations').where({ company_id: company.id, trigger: 'new_conversation' }).orderBy('id')
    const auto = autos.find((a) => /bienvenida/i.test(a.name))
    if (!auto) continue
    let actions
    try { actions = JSON.parse(auto.actions || '[]') } catch { continue }
    if (actions.some((x) => x.type === 'menu')) continue
    const menu = def.menu(company.name)
    const i = actions.findIndex((x) => x.type === 'reply')
    if (i >= 0) actions[i] = menu; else actions.unshift(menu)
    await knex('automations').where({ id: auto.id }).update({ name: 'Bienvenida con menú de opciones', actions: JSON.stringify(actions) })
  }
}
export async function down() {}
