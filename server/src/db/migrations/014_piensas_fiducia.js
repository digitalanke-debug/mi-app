// Piensas es de fiducia y proyectos inmobiliarios (no pensiones): menú, descripción y datos del asistente
const INVEST = { label: 'Invertir en un proyecto inmobiliario', service: 'Inversión inmobiliaria', keywords: 'invertir, inversion, inversionista, rentabilidad, participar, comprar',
  reply: '¡Excelente! 🙌 Con gusto le contamos cómo invertir de forma segura a través de fiducia. Cuéntenos por favor:\n\n• Su nombre completo\n• Ciudad donde le gustaría invertir\n• Cuánto le gustaría invertir, aproximadamente\n\nUn asesor le escribe {{cuando}}. 😊' }
const SECTOR = 'Fiducia y proyectos inmobiliarios'
const DESCRIPTION = 'Estructuramos proyectos inmobiliarios con fiducia: acompañamos a propietarios de inmuebles y lotes, inversionistas y desarrolladores para que su proyecto quede bien estructurado y protegido. También ofrecemos cursos, masterclass y eventos sobre negocios fiduciarios.'
const KNOWLEDGE = 'Servicios: estructuración de proyectos inmobiliarios, fiducia y negocios fiduciarios, inversión en proyectos inmobiliarios, cursos y masterclass.\nHorario: lunes a viernes 8:00 a.m. a 6:00 p.m.\nAtención virtual en toda Colombia.'
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

export async function up(knex) {
  for (const company of (await knex('companies')).filter((c) => norm(c.name).includes('piensas') || norm(c.slug).includes('piensas'))) {
    // Descripción y sector solo si siguen hablando de pensiones (no se pisa lo que el equipo haya escrito)
    const patch = {}
    if (!company.sector || /pension/i.test(norm(company.sector))) patch.sector = SECTOR
    if (!company.description || /pension/i.test(norm(company.description))) patch.description = DESCRIPTION
    if (Object.keys(patch).length) await knex('companies').where({ id: company.id }).update(patch)
    const ai = await knex('ai_settings').where({ company_id: company.id }).first()
    if (ai && /pension/i.test(norm(ai.knowledge))) await knex('ai_settings').where({ company_id: company.id }).update({ knowledge: KNOWLEDGE })
    // Menú: la opción de pensión pasa a ser de inversión inmobiliaria
    for (const auto of await knex('automations').where({ company_id: company.id, trigger: 'new_conversation' })) {
      let actions
      try { actions = JSON.parse(auto.actions || '[]') } catch { continue }
      let changed = false
      for (const a of actions.filter((x) => x.type === 'menu')) {
        a.options = (a.options || []).map((o) => (o.service === 'Asesoría pensional' || /pension/i.test(norm(o.label)) ? ((changed = true), { ...INVEST }) : o))
      }
      if (changed) await knex('automations').where({ id: auto.id }).update({ actions: JSON.stringify(actions) })
    }
  }
}
export async function down() {}
