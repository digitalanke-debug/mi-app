/**
 * Transcripción de notas de voz con un servicio Whisper (contenedor "transcriber" del docker-compose).
 * API: POST {TRANSCRIBE_URL}/asr?task=transcribe&language=es&output=json  (multipart, campo audio_file)
 */
export function transcribeConfigured() {
  return !!process.env.TRANSCRIBE_URL
}

export async function transcribeAudio(base64, mimetype = 'audio/ogg') {
  const base = (process.env.TRANSCRIBE_URL || '').replace(/\/$/, '')
  if (!base) throw new Error('Transcripción no configurada')
  const buffer = Buffer.from(base64, 'base64')
  const form = new FormData()
  form.append('audio_file', new Blob([buffer], { type: mimetype.split(';')[0] }), 'nota.ogg')
  const res = await fetch(`${base}/asr?task=transcribe&language=es&output=json`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`Transcriptor respondió ${res.status}`)
  const data = await res.json()
  return String(data.text || '').trim()
}
