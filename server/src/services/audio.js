import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { UPLOAD_DIR } from './media.js'

/**
 * Notas de voz: WhatsApp las envía en OGG/Opus, que Safari (iPhone y Mac) no reproduce.
 * Se convierten a MP3 con ffmpeg para que se escuchen en cualquier navegador.
 */
let available = null
export function ffmpegAvailable() {
  if (available === null) { try { available = spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0 } catch { available = false } }
  return available
}

const NEEDS = /^audio\/(ogg|opus|webm|amr|3gpp|x-caf|aac)/i
export const needsConversion = (mime = '', url = '') => NEEDS.test(mime) || /\.(ogg|opus|oga|webm|amr|3gp)$/i.test(url)

function run(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '64k', output])
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    const t = setTimeout(() => p.kill('SIGKILL'), 60_000)
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err.slice(0, 200) || `ffmpeg salió con código ${code}`)) })
    p.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}

/** Convierte un audio guardado ({url, mime, name, size, type}) a MP3. Si no se puede, devuelve el original. */
export async function toPlayableAudio(saved) {
  if (!saved || saved.type !== 'audio' || !needsConversion(saved.mime, saved.url) || !ffmpegAvailable()) return saved
  const input = path.join(UPLOAD_DIR, path.basename(saved.url))
  const file = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp3`
  const output = path.join(UPLOAD_DIR, file)
  try {
    await run(input, output)
    const size = fs.statSync(output).size
    fs.rmSync(input, { force: true })
    const name = saved.name && !/^\d+-[0-9a-f]{16}\./.test(saved.name) ? saved.name.replace(/\.[a-z0-9]+$/i, '.mp3') : 'nota-de-voz.mp3'
    return { ...saved, url: `/uploads/${file}`, mime: 'audio/mpeg', size, name }
  } catch (e) {
    fs.rmSync(output, { force: true })
    console.warn('No se pudo convertir la nota de voz:', e.message)
    return saved
  }
}
