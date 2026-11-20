// Textos automáticos más cálidos. Solo cambia los que siguen con el texto de fábrica (no toca los que el equipo editó).
const OLD_AFTER_HOURS = 'Gracias por escribirnos. En este momento estamos fuera de horario (L-V 8am a 6pm). Te responderemos a primera hora. 🙌'
export const NEW_AFTER_HOURS = '¡Gracias por escribirnos! 😊 En este momento estamos fuera de horario ({{horario}}), pero ya recibimos su mensaje y un asesor le responde {{cuando}}.'

export async function up(knex) {
  for (const a of await knex('automations').where({ trigger: 'outside_hours' })) {
    let actions
    try { actions = JSON.parse(a.actions || '[]') } catch { continue }
    if (!actions.some((x) => x.type === 'reply' && x.body === OLD_AFTER_HOURS)) continue
    await knex('automations').where({ id: a.id }).update({ actions: JSON.stringify(actions.map((x) => (x.type === 'reply' && x.body === OLD_AFTER_HOURS ? { ...x, body: NEW_AFTER_HOURS } : x))) })
  }
}
export async function down() {}
