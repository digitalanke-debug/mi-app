const ts = (knex) => knex.client.config.client === 'pg' ? knex.fn.now() : knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")

// Difusiones: envío de un mismo mensaje a una lista de contactos, uno por uno con pausas
export async function up(knex) {
  await knex.schema.createTable('broadcasts', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.integer('instance_id').references('whatsapp_instances.id').onDelete('SET NULL')
    t.integer('created_by').references('users.id').onDelete('SET NULL')
    t.string('name').notNullable()
    t.text('body')
    t.string('media_url'); t.string('media_name'); t.string('media_mime'); t.integer('media_size'); t.string('media_type')
    t.string('status').defaultTo('draft') // draft | sending | paused | done | cancelled
    t.integer('delay_min').defaultTo(20) // segundos entre mensajes
    t.integer('delay_max').defaultTo(45)
    t.integer('total').defaultTo(0); t.integer('sent').defaultTo(0); t.integer('failed').defaultTo(0)
    t.string('last_error')
    t.timestamp('next_at')
    t.timestamp('started_at'); t.timestamp('finished_at')
    t.timestamp('created_at').defaultTo(ts(knex))
  })
  await knex.schema.createTable('broadcast_recipients', (t) => {
    t.increments('id')
    t.integer('broadcast_id').references('broadcasts.id').onDelete('CASCADE')
    t.integer('contact_id').references('contacts.id').onDelete('CASCADE')
    t.string('status').defaultTo('pending') // pending | sent | failed
    t.string('error')
    t.integer('message_id')
    t.timestamp('sent_at')
    t.unique(['broadcast_id', 'contact_id'])
    t.index(['broadcast_id', 'status'])
  })
}
export async function down(knex) {
  await knex.schema.dropTableIfExists('broadcast_recipients')
  await knex.schema.dropTableIfExists('broadcasts')
}
