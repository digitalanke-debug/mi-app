// Identificador privado @lid del contacto, separado del teléfono. Permite reconocer a la misma persona
// cuando WhatsApp a veces manda su número real y a veces solo el @lid (y así no duplicar contactos).
export async function up(knex) {
  await knex.schema.alterTable('contacts', (t) => { t.string('wa_lid'); t.index(['company_id', 'wa_lid']) })
  await knex('contacts').whereLike('wa_jid', '%@lid').update({ wa_lid: knex.ref('wa_jid') })
}
export async function down(knex) { await knex.schema.alterTable('contacts', (t) => { t.dropIndex(['company_id', 'wa_lid']); t.dropColumn('wa_lid') }) }
