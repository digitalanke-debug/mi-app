// Credenciales por número para la API oficial de WhatsApp (Meta Cloud API)
export async function up(knex) {
  await knex.schema.alterTable('whatsapp_instances', (t) => { t.text('config') })
  await knex.schema.alterTable('messages', (t) => { t.string('error') })
}
export async function down(knex) {
  await knex.schema.alterTable('whatsapp_instances', (t) => { t.dropColumn('config') })
  await knex.schema.alterTable('messages', (t) => { t.dropColumn('error') })
}
