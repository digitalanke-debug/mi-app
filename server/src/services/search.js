import { config } from '../config.js'

const ACCENTED = 'áàäâéèëêíìïîóòöôúùüûñ'
const PLAIN = 'aaaaeeeeiiiioooouuuun'
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/**
 * Búsqueda de contactos: nombre sin importar tildes ni mayúsculas ("maria" encuentra "María"),
 * teléfono en cualquier formato ("+57 300 123 4567", "3001234567", "300-123") , correo o cédula.
 */
export function matchContact(b, q) {
  const raw = String(q).trim()
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  if (config.dbClient === 'pg') b.whereRaw('translate(lower(??), ?, ?) like ?', ['name', ACCENTED, PLAIN, `%${plain(raw)}%`])
  else b.whereILike('name', `%${raw}%`)
  if (digits.length >= 3) b.orWhereLike('phone', `%${digits}%`)
  b.orWhereILike('email', `%${raw}%`)
  if (digits.length >= 5) b.orWhereLike('document', `%${digits}%`)
}
