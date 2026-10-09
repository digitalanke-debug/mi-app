import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(here, '..', '..', 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
  'video/mp4': 'mp4', 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/plain': 'txt' }
export const MAX_BYTES = 20 * 1024 * 1024

export function typeFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

/** Guarda un archivo (base64 o Buffer) y devuelve { url, name, mime, size, type } */
export function saveMedia({ base64, buffer, mime = 'application/octet-stream', name }) {
  const buf = buffer || Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64')
  if (buf.length > MAX_BYTES) throw new Error('Archivo demasiado grande (máximo 20 MB)')
  const cleanMime = mime.split(';')[0].trim()
  const ext = EXT[cleanMime] || (name && path.extname(name).slice(1)) || 'bin'
  const file = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf)
  return { url: `/uploads/${file}`, name: name || file, mime: cleanMime, size: buf.length, type: typeFromMime(cleanMime) }
}

export function readMediaBase64(url) {
  const file = path.join(UPLOAD_DIR, path.basename(url))
  return fs.readFileSync(file).toString('base64')
}
