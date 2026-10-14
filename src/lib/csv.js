function escapeCell(v) {
  const s = v == null ? '' : String(v)
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Exporta filas a CSV con separador ; (el que abre Excel en Colombia sin asistente) */
export function downloadCSV(filename, headers, rows) {
  const lines = [headers.map(escapeCell).join(';')]
  for (const r of rows) lines.push(r.map(escapeCell).join(';'))
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
