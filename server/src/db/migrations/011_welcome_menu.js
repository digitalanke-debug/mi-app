// Menú de bienvenida con opciones: estado de la conversación mientras se espera la respuesta del cliente.
// Núcleo Pensional pasa de un saludo fijo a un menú (borrador editable en Automatizaciones).
export const NUCLEO_MENU = {
  type: 'menu',
  intro: '¡Hola! 👋 Qué gusto saludarle. Bienvenido(a) a Núcleo Pensional, con mucho gusto le ayudamos con su pensión.\n\nPara ponerle en contacto con el asesor indicado, cuéntenos qué necesita respondiendo con el número de la opción:',
  options: [
    { label: 'Traslado de régimen (Colpensiones o fondo privado)', service: 'Traslado de régimen', keywords: 'traslado, trasladar, colpensiones, porvenir, proteccion, colfondos, skandia, fondo',
      reply: '¡Perfecto! 🙌 Le ayudamos a revisar si todavía puede trasladarse. Para avanzar, cuéntenos por favor:\n\n• Su nombre completo\n• Su edad\n• En qué fondo está hoy\n• Cuántas semanas tiene cotizadas, más o menos\n\nCon esos datos un asesor le escribe {{cuando}}. 😊' },
    { label: 'Régimen de transición o reforma pensional', service: 'Régimen de transición', keywords: 'transicion, reforma, semanas, 1000 semanas',
      reply: '¡Claro que sí! 🙌 Revisemos si el régimen de transición o la reforma le aplican. Cuéntenos por favor:\n\n• Su nombre completo\n• Su edad\n• Cuántas semanas tiene cotizadas, más o menos\n\nUn asesor le escribe {{cuando}} con la información de su caso. 😊' },
    { label: 'Reconocimiento de pensión (vejez, invalidez o sobrevivientes)', service: 'Reconocimiento pensión', keywords: 'vejez, invalidez, sobreviviente, sobrevivientes, reconocimiento, pensionar, pensionarme, fallecio, viuda, viudo',
      reply: 'Con mucho gusto le acompañamos en ese trámite. 🤝 Para orientarle mejor, cuéntenos por favor:\n\n• Su nombre completo\n• Qué pensión necesita (vejez, invalidez o sobrevivientes)\n• Si ya hizo la solicitud y en qué entidad\n\nUn asesor le escribe {{cuando}}. 😊' },
    { label: 'Corrección de historia laboral', service: 'Corrección historia laboral', keywords: 'historia laboral, corregir, correccion, semanas perdidas, faltan semanas',
      reply: '¡Claro! Revisemos juntos su historia laboral. 📋 Cuéntenos por favor:\n\n• Su nombre completo\n• Dónde cotiza (Colpensiones o qué fondo)\n• Qué periodos o semanas cree que le faltan\n\nUn asesor le escribe {{cuando}}. 😊' },
    { label: 'Hablar con un asesor', service: '', keywords: 'asesor, persona, humano, llamar, llamada', tag: 'Caliente', notify: true,
      reply: '¡Con gusto! 😊 Ya le avisamos a un asesor para que le escriba {{cuando}}. Mientras tanto, ¿nos regala su nombre completo y la ciudad desde donde nos escribe?' },
  ],
  retry: 'Disculpe 🙏 para ubicar mejor su caso, ¿nos responde solo con el número de la opción (del 1 al 5)? Si prefiere, escríbanos su pregunta y un asesor le contesta.',
  after_hours: '🌙 En este momento estamos fuera de horario ({{horario}}), pero puede elegir una opción y dejarnos su consulta: un asesor le escribe {{cuando}}.',
}

export async function up(knex) {
  await knex.schema.alterTable('conversations', (t) => { t.text('menu_state') })
  const company = await knex('companies').where({ slug: 'nucleo-pensional' }).first()
  if (!company) return
  const auto = await knex('automations').where({ company_id: company.id, trigger: 'new_conversation', name: 'Bienvenida automática' }).first()
  if (!auto) return
  let actions
  try { actions = JSON.parse(auto.actions || '[]') } catch { return }
  if (actions.some((x) => x.type === 'menu')) return
  const i = actions.findIndex((x) => x.type === 'reply')
  if (i >= 0) actions[i] = NUCLEO_MENU; else actions.unshift(NUCLEO_MENU)
  await knex('automations').where({ id: auto.id }).update({ name: 'Bienvenida con menú de opciones', actions: JSON.stringify(actions) })
}
export async function down(knex) { await knex.schema.alterTable('conversations', (t) => { t.dropColumn('menu_state') }) }
