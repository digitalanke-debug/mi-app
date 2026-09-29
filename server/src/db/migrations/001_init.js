const ts = (knex) => knex.client.config.client === 'pg' ? knex.fn.now() : knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")

export async function up(knex) {
  await knex.schema.createTable('companies', (t) => {
    t.increments('id')
    t.string('name').notNullable()
    t.string('slug').notNullable().unique()
    t.string('color').defaultTo('#2563eb')
    t.string('sector')
    t.text('description')
    t.string('timezone').defaultTo('America/Bogota')
    t.string('business_hours').defaultTo('08:00-18:00')
    t.timestamp('created_at').defaultTo(ts(knex))
  })

  await knex.schema.createTable('users', (t) => {
    t.increments('id')
    t.string('name').notNullable()
    t.string('email').notNullable().unique()
    t.string('password_hash').notNullable()
    t.string('role').notNullable().defaultTo('agent') // admin | agent
    t.boolean('active').defaultTo(true)
    t.timestamp('created_at').defaultTo(ts(knex))
  })

  await knex.schema.createTable('company_users', (t) => {
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.integer('user_id').references('users.id').onDelete('CASCADE')
    t.primary(['company_id', 'user_id'])
  })

  await knex.schema.createTable('whatsapp_instances', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('name').notNullable()
    t.string('phone')
    t.string('provider').defaultTo('demo') // demo | evolution
    t.string('instance_key').notNullable().unique()
    t.string('status').defaultTo('disconnected') // disconnected | qr | connecting | connected
    t.text('qr_code')
    t.timestamp('connected_at')
    t.timestamp('created_at').defaultTo(ts(knex))
  })

  await knex.schema.createTable('contacts', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('phone').notNullable()
    t.string('name')
    t.string('email')
    t.string('document')
    t.string('city')
    t.string('source').defaultTo('organico') // google_ads | meta_ads | organico | referido | web
    t.string('campaign')
    t.text('notes')
    t.timestamp('created_at').defaultTo(ts(knex))
    t.unique(['company_id', 'phone'])
  })

  await knex.schema.createTable('tags', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('name').notNullable()
    t.string('color').defaultTo('#64748b')
  })

  await knex.schema.createTable('pipelines', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('name').notNullable()
    t.boolean('is_default').defaultTo(false)
  })

  await knex.schema.createTable('pipeline_stages', (t) => {
    t.increments('id')
    t.integer('pipeline_id').references('pipelines.id').onDelete('CASCADE')
    t.string('name').notNullable()
    t.integer('position').defaultTo(0)
    t.string('color').defaultTo('#94a3b8')
    t.boolean('is_won').defaultTo(false)
    t.boolean('is_lost').defaultTo(false)
  })

  await knex.schema.createTable('conversations', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.integer('instance_id').references('whatsapp_instances.id').onDelete('SET NULL')
    t.integer('contact_id').references('contacts.id').onDelete('CASCADE')
    t.integer('assigned_user_id').references('users.id').onDelete('SET NULL')
    t.integer('pipeline_id').references('pipelines.id').onDelete('SET NULL')
    t.integer('stage_id').references('pipeline_stages.id').onDelete('SET NULL')
    t.string('status').defaultTo('open') // open | pending | closed
    t.string('service') // servicio de interés
    t.decimal('value', 14, 2).defaultTo(0)
    t.boolean('ai_enabled').defaultTo(true)
    t.integer('unread_count').defaultTo(0)
    t.timestamp('stage_entered_at')
    t.timestamp('opened_at')
    t.timestamp('closed_at')
    t.timestamp('first_response_at')
    t.timestamp('last_message_at')
    t.timestamp('last_inbound_at')
    t.timestamp('last_outbound_at')
    t.timestamp('created_at').defaultTo(ts(knex))
    t.index(['company_id', 'status'])
  })

  await knex.schema.createTable('conversation_tags', (t) => {
    t.integer('conversation_id').references('conversations.id').onDelete('CASCADE')
    t.integer('tag_id').references('tags.id').onDelete('CASCADE')
    t.primary(['conversation_id', 'tag_id'])
  })

  await knex.schema.createTable('messages', (t) => {
    t.increments('id')
    t.integer('conversation_id').references('conversations.id').onDelete('CASCADE')
    t.string('direction').notNullable() // in | out
    t.string('sender_type').notNullable() // contact | user | bot | system
    t.integer('sender_user_id').references('users.id').onDelete('SET NULL')
    t.string('type').defaultTo('text') // text | image | audio | document
    t.text('body')
    t.string('media_url')
    t.string('wa_message_id')
    t.string('status').defaultTo('sent') // pending | sent | delivered | read | failed
    t.timestamp('created_at').defaultTo(ts(knex))
    t.index(['conversation_id', 'created_at'])
  })

  await knex.schema.createTable('notes', (t) => {
    t.increments('id')
    t.integer('conversation_id').references('conversations.id').onDelete('CASCADE')
    t.integer('user_id').references('users.id').onDelete('SET NULL')
    t.text('body').notNullable()
    t.timestamp('created_at').defaultTo(ts(knex))
  })

  await knex.schema.createTable('tasks', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.integer('conversation_id').references('conversations.id').onDelete('CASCADE')
    t.integer('user_id').references('users.id').onDelete('SET NULL')
    t.string('title').notNullable()
    t.timestamp('due_at')
    t.boolean('done').defaultTo(false)
    t.timestamp('created_at').defaultTo(ts(knex))
  })

  await knex.schema.createTable('quick_replies', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('shortcut').notNullable()
    t.text('body').notNullable()
  })

  await knex.schema.createTable('automations', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.string('name').notNullable()
    // trigger: new_conversation | message_in | keyword | inactivity | stage_change | outside_hours
    t.string('trigger').notNullable()
    t.text('conditions').defaultTo('{}') // JSON
    t.text('actions').defaultTo('[]') // JSON [{type, ...}]
    t.boolean('enabled').defaultTo(true)
    t.integer('runs').defaultTo(0)
    t.timestamp('created_at').defaultTo(ts(knex))
  })

  await knex.schema.createTable('ai_settings', (t) => {
    t.integer('company_id').primary().references('companies.id').onDelete('CASCADE')
    t.boolean('enabled').defaultTo(true)
    t.string('model').defaultTo('claude-opus-5-5')
    t.string('agent_name').defaultTo('Asistente')
    t.text('instructions')
    t.text('knowledge')
    t.boolean('handoff_on_request').defaultTo(true)
    t.integer('max_bot_turns').defaultTo(6)
  })

  await knex.schema.createTable('activity_log', (t) => {
    t.increments('id')
    t.integer('company_id').references('companies.id').onDelete('CASCADE')
    t.integer('conversation_id').references('conversations.id').onDelete('CASCADE')
    t.integer('user_id').references('users.id').onDelete('SET NULL')
    t.string('type').notNullable()
    t.text('data').defaultTo('{}')
    t.timestamp('created_at').defaultTo(ts(knex))
  })
}

export async function down(knex) {
  for (const t of [
    'activity_log', 'ai_settings', 'automations', 'quick_replies', 'tasks', 'notes', 'messages',
    'conversation_tags', 'conversations', 'pipeline_stages', 'pipelines', 'tags', 'contacts',
    'whatsapp_instances', 'company_users', 'users', 'companies',
  ]) await knex.schema.dropTableIfExists(t)
}
