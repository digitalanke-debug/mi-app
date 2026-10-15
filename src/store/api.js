/** Cliente HTTP mínimo para hablar con el backend (server/) */
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (current, next) => request('POST', '/api/auth/password', { current, next }),
  state: () => request('GET', '/api/state'),
  action: (action) => request('POST', '/api/actions', { action }),
  users: () => request('GET', '/api/users'),
  createUser: (u) => request('POST', '/api/users', u),
  updateUser: (id, patch) => request('PATCH', `/api/users/${id}`, patch),
  log: (limit) => request('GET', `/api/log?limit=${limit || 100}`),
}

export const waApi = {
  status: () => request('GET', '/api/whatsapp/status'),
  connect: () => request('POST', '/api/whatsapp/connect'),
  sendReminder: (invoiceId, message) => request('POST', '/api/whatsapp/send-reminder', { invoiceId, message }),
  test: (text, reset) => request('POST', '/api/whatsapp/test', { text, reset }),
  sendInvoice: (invoiceId, message) => request('POST', '/api/whatsapp/send-invoice', { invoiceId, message }),
}
