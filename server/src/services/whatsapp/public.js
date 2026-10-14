/** Versión de la instancia segura para enviar al navegador: nunca expone tokens */
export function publicInstance(inst) {
  if (!inst) return inst
  const { config, ...rest } = inst
  let c = {}
  try { c = JSON.parse(config || '{}') } catch {}
  return {
    ...rest,
    meta: inst.provider === 'meta' ? {
      phone_number_id: c.phone_number_id || '', waba_id: c.waba_id || '',
      access_token: c.access_token ? '••••' + String(c.access_token).slice(-4) : '', app_secret: c.app_secret ? '••••' : '',
    } : undefined,
  }
}
