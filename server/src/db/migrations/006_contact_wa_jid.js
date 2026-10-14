// Identificador completo de WhatsApp del contacto. WhatsApp está reemplazando el número por
// identificadores privados (@lid); para responder hay que usar ese identificador exacto.
export async function up(knex) {
  await knex.schema.alterTable('contacts', (t) => { t.string('wa_jid') })
  // Repara contactos cuyo envío falló porque el "teléfono" guardado era en realidad un @lid
  const failed = await knex('messages as m').join('conversations as c', 'c.id', 'm.conversation_id').join('contacts as ct', 'ct.id', 'c.contact_id')
    .where('m.status', 'failed').whereLike('m.error', '%"exists":false%').distinct('ct.id', 'ct.phone')
  for (const ct of failed) await knex('contacts').where({ id: ct.id }).update({ wa_jid: `${ct.phone}@lid` })
}
export async function down(knex) { await knex.schema.alterTable('contacts', (t) => { t.dropColumn('wa_jid') }) }
