const ts = (knex) => knex.client.config.client === 'pg' ? knex.fn.now() : knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")

// De qué anuncio llegó cada persona (anuncios "clic a WhatsApp" de Meta) y el gasto por anuncio traído de Meta Ads
export async function up(knex) {
  await knex.schema.createTable('ad_referrals', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.integer('contact_id').references('contacts.id').onDelete('CASCADE')
    t.integer('conversation_id').references('conversations.id').onDelete('CASCADE')
    t.integer('message_id') // mensaje con el que llegó (para mostrar el anuncio en ese punto del chat)
    t.string('wa_message_id')
    t.string('platform') // facebook | instagram
    t.string('source_type') // ad | post
    t.string('source_id') // identificador del anuncio en Meta
    t.string('headline', 500)
    t.text('body')
    t.text('source_url')
    t.text('thumbnail_url') // copia local de la imagen del anuncio (las de Meta caducan)
    t.string('media_type')
    t.string('ctwa_clid', 500)
    t.timestamp('created_at').defaultTo(ts(knex))
    t.index(['company_id', 'created_at'])
    t.index(['conversation_id'])
    t.index(['company_id', 'source_id'])
  })
  // Gasto diario por anuncio, sincronizado desde la API de Meta Ads
  await knex.schema.createTable('ad_insights', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.date('date').notNullable()
    t.string('ad_id').notNullable()
    t.string('ad_name', 500)
    t.string('adset_name', 500)
    t.string('campaign_name', 500)
    t.decimal('spend', 14, 2).defaultTo(0)
    t.integer('impressions').defaultTo(0)
    t.integer('clicks').defaultTo(0)
    t.integer('conversations_started').defaultTo(0) // conversaciones de mensajes iniciadas según Meta
    t.unique(['company_id', 'date', 'ad_id'])
  })
}
export async function down(knex) {
  await knex.schema.dropTableIfExists('ad_insights')
  await knex.schema.dropTableIfExists('ad_referrals')
}
