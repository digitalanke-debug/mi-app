// El agente IA queda desactivado hasta que el equipo decida activarlo (evita respuestas de prueba a clientes reales).
export async function up(knex) {
  await knex('ai_settings').update({ enabled: false })
  await knex('automations').whereLike('actions', '%ai_reply%').update({ enabled: false })
}
export async function down() {}
