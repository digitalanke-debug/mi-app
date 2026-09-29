const TOKEN_KEY = 'crm_token'

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch {} }

export async function api(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`/api${path}`, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, v))
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) { setToken(null); window.dispatchEvent(new Event('crm:logout')) }
    throw new Error(data.error || `Error ${res.status}`)
  }
  return data
}

export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : ''
export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
export const fmtMoney = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n || 0))

/** "hace 5 min", "2 h", "3 d" */
export function ago(iso) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'ahora'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86400)} d`
}

export const SOURCE_LABEL = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', organico: 'Orgánico', referido: 'Referido', web: 'Web' }
export const initials = (name) => (name || '?').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
