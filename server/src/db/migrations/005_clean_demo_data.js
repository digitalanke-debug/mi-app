// Puesta en producción: elimina todos los datos de prueba y conserva la configuración.
// Se conservan: empresas, usuarios reales, pipelines y etapas, etiquetas, respuestas rápidas,
// automatizaciones y ajustes del agente IA. Se eliminan: contactos, conversaciones, mensajes,
// notas, tareas, actividad, inversión registrada, números demo y los usuarios de prueba.
export async function up(knex) {
  const demoUsers = await knex('users').whereIn('email', ['kevin@demo.com', 'laura@demo.com']).select('id')
  for (const t of ['activity_log', 'tasks', 'notes', 'conversation_tags', 'messages']) await knex(t).del()
  await knex('conversations').del()
  await knex('contacts').del()
  await knex('ad_spend').del()
  await knex('whatsapp_instances').where({ provider: 'demo' }).del()
  await knex('automations').update({ runs: 0 })
  if (demoUsers.length) {
    const ids = demoUsers.map((u) => u.id)
    await knex('company_users').whereIn('user_id', ids).del()
    await knex('users').whereIn('id', ids).del()
  }
}
export async function down() {}
