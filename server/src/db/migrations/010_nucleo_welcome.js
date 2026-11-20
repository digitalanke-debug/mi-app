// Saludo de bienvenida de Núcleo Pensional (texto definido por la empresa)
const BODY = '¡Hola! Claro que sí, bienvenido(a) a Núcleo Pensional. Para agendar su caso, ya lo contactamos con un asesor.'

export async function up(knex) {
  const company = await knex('companies').where({ slug: 'nucleo-pensional' }).first()
  if (!company) return
  const autos = await knex('automations').where({ company_id: company.id, trigger: 'new_conversation', name: 'Bienvenida automática' })
  for (const a of autos) {
    let actions
    try { actions = JSON.parse(a.actions || '[]') } catch { continue }
    if (!actions.some((x) => x.type === 'reply')) continue
    await knex('automations').where({ id: a.id }).update({ actions: JSON.stringify(actions.map((x) => (x.type === 'reply' ? { ...x, body: BODY } : x))) })
  }
}
export async function down() {}
