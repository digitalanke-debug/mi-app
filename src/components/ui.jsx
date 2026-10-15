import { useEffect, useState } from 'react'
import { cop, parseMoney } from '../lib/format.js'

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function PriorityBadge({ level }) {
  const label = { alta: 'Prioritaria', media: 'Media', baja: 'Baja' }[level] || level
  return <Badge tone={level === 'alta' ? 'danger' : level === 'media' ? 'warn' : 'ok'}>{label}</Badge>
}

export function StatusBadge({ status }) {
  const map = {
    pagada: ['ok', 'Pagada'],
    parcial: ['info', 'Abono parcial'],
    vencida: ['danger', 'Vencida'],
    pendiente: ['neutral', 'Pendiente'],
    pagado: ['ok', 'Pagado'],
  }
  const [tone, label] = map[status] || ['neutral', status]
  return <Badge tone={tone}>{label}</Badge>
}

export function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`kpi ${tone ? 'kpi-' + tone : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  )
}

/** Campo de dinero: muestra con puntos de miles mientras no se edita, entrega número */
export function MoneyInput({ value, onChange, placeholder = '$ 0', autoFocus, required, id }) {
  const [draft, setDraft] = useState(null) // null = no se está editando
  const shown = draft ?? (value ? cop(value) : '')
  return (
    <input
      id={id}
      inputMode="numeric"
      className="input money"
      placeholder={placeholder}
      value={shown}
      autoFocus={autoFocus}
      required={required}
      onFocus={() => setDraft(value ? String(value) : '')}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(parseMoney(e.target.value))
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Empty({ title, text, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function Confirm({ text, onYes, onNo, yesLabel = 'Sí, continuar' }) {
  return (
    <Modal title="Confirmar" onClose={onNo}>
      <p>{text}</p>
      <div className="row-end">
        <button type="button" className="btn" onClick={onNo}>Cancelar</button>
        <button type="button" className="btn btn-danger" onClick={onYes}>{yesLabel}</button>
      </div>
    </Modal>
  )
}

/** Selector de empresa para formularios. Solo se muestra cuando el usuario está en "Todas las empresas". */
export function CompanyField({ companies, value, onChange, show = true, label = 'Empresa' }) {
  if (!show) return null
  return (
    <Field label={label}>
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)} required>
        {companies.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </Field>
  )
}

/** Campo de etiquetas separadas por coma, con sugerencias */
export function TagsInput({ value = [], onChange, suggestions = [] }) {
  const [text, setText] = useState(value.join(', '))
  return (
    <>
      <input
        className="input"
        list="tag-suggestions"
        value={text}
        placeholder="Ej: Oficina, Dr. Suárez"
        onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(',').map((t) => t.trim()).filter(Boolean)) }}
      />
      <datalist id="tag-suggestions">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  )
}
