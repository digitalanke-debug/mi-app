const ts = (knex) => knex.client.config.client === 'pg' ? knex.fn.now() : knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")

export async function up(knex) {
  await knex.schema.alterTable('messages', (t) => {
    t.string('media_name')
    t.string('media_mime')
    t.integer('media_size')
  })
  // Gasto publicitario por día y campaña (importado por CSV o sincronizado desde Google Ads)
  await knex.schema.createTable('ad_spend', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.date('date').notNullable()
    t.string('source').notNullable().defaultTo('google_ads') // google_ads | meta_ads
    t.string('campaign').notNullable()
    t.decimal('cost', 14, 2).defaultTo(0)
    t.integer('clicks').defaultTo(0)
    t.integer('impressions').defaultTo(0)
    t.unique(['company_id', 'date', 'source', 'campaign'])
  })
  // Credenciales y estado de integraciones externas por empresa
  await knex.schema.createTable('integrations', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('provider').notNullable() // google_ads
    t.text('config').defaultTo('{}')
    t.string('status').defaultTo('disconnected')
    t.text('last_error')
    t.timestamp('last_sync_at')
    t.timestamp('created_at').defaultTo(ts(knex))
    t.unique(['company_id', 'provider'])
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('integrations')
  await knex.schema.dropTableIfExists('ad_spend')
  await knex.schema.alterTable('messages', (t) => { t.dropColumn('media_name'); t.dropColumn('media_mime'); t.dropColumn('media_size') })
}
