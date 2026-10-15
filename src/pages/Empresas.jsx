import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { REGIMENES } from '../store/migrate.js'
import { Modal, Field, Empty, Confirm, Badge } from '../components/ui.jsx'
import { cop } from '../lib/format.js'
import { totals } from '../lib/accounts.js'
import { invoiceBalance } from '../lib/invoices.js'

export default function Empresas() {
  const { state, dispatch, companies, setCompanyId } = useStore()
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Empresas</h1>
          <p className="muted">Cada empresa tiene sus clientes, cuentas de cobro, gastos y cuentas bancarias. Arriba a la izquierda eliges cuál ver o el consolidado.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({})}>+ Nueva empresa</button>
      </header>

      <section className="card">
        {companies.length === 0 ? <Empty title="Sin empresas" /> : (
          <table className="table">
            <thead><tr><th>Empresa</th><th>NIT</th><th>Régimen</th><th className="num">Disponible</th><th className="num">Por cobrar</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {companies.map((c) => {
                const t = totals(state, c.id)
                const porCobrar = state.invoices.filter((i) => i.companyId === c.id).reduce((s, i) => s + invoiceBalance(i), 0)
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><div className="muted small">Prefijo {c.prefix} · {c.city}</div></td>
                    <td>{c.nit || <span className="muted">—</span>}</td>
                    <td>{c.regimen === 'simple' ? 'Simple' : 'Ordinario'}<div className="muted small">{c.regimen === 'simple' ? 'No practica retención' : 'Practica retención'}{c.iva ? ' · IVA' : ''}</div></td>
                    <td className="num">{cop(t.disponible)}</td>
                    <td className="num">{cop(porCobrar)}</td>
                    <td>{c.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="neutral">Inactiva</Badge>}</td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm" onClick={() => setCompanyId(c.id)}>Ver</button>
                      <button type="button" className="btn btn-sm" onClick={() => setModal({ company: c })}>Editar</button>
                      {c.active
                        ? <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => setConfirm({ text: `¿Desactivar ${c.name}? Sus datos se conservan pero deja de aparecer.`, onYes: () => { dispatch({ type: 'company/remove', id: c.id }); setConfirm(null) } })}>Desactivar</button>
                        : <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'company/update', id: c.id, company: { active: true } })}>Reactivar</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {modal && (
        <CompanyForm
          initial={modal.company}
          onClose={() => setModal(null)}
          onSave={(data) => {
            if (modal.company) dispatch({ type: 'company/update', id: modal.company.id, company: data })
            else dispatch({ type: 'company/add', company: data })
            setModal(null)
          }}
        />
      )}
      {confirm && <Confirm text={confirm.text} onYes={confirm.onYes} onNo={() => setConfirm(null)} />}
    </div>
  )
}

function CompanyForm({ initial, onClose, onSave }) {
  const [f, setF] = useState(initial ? { ...initial } : { name: '', prefix: '', nit: '', regimen: 'ordinario', iva: true, address: '', city: '', phone: '', email: '', bankInfo: '', footer: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <Modal title={initial ? 'Editar empresa' : 'Nueva empresa'} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSave({ ...f, prefix: (f.prefix || f.name.slice(0, 2)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CC' }) }}>
        <div className="form-row">
          <Field label="Nombre o razón social"><input className="input" value={f.name} onChange={set('name')} required autoFocus /></Field>
          <Field label="Prefijo de cuentas de cobro" hint="Ej: SG → SG-2026-001"><input className="input" value={f.prefix} onChange={set('prefix')} maxLength={5} /></Field>
        </div>
        <div className="form-row">
          <Field label="NIT"><input className="input" value={f.nit} onChange={set('nit')} /></Field>
          <Field label="Régimen tributario">
            <select className="input" value={f.regimen} onChange={set('regimen')}>{Object.entries(REGIMENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.iva} onChange={set('iva')} /> Responsable de IVA</label>
        <div className="form-row">
          <Field label="Dirección"><input className="input" value={f.address} onChange={set('address')} /></Field>
          <Field label="Ciudad"><input className="input" value={f.city} onChange={set('city')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Teléfono"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Correo"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Datos para el pago (van en la cuenta de cobro)" hint="Banco, tipo y número de cuenta, titular"><textarea className="input" rows={2} value={f.bankInfo} onChange={set('bankInfo')} /></Field>
        <Field label="Texto al pie de la cuenta de cobro (opcional)" hint="Ej: declaración de régimen, nota legal, agradecimiento"><textarea className="input" rows={2} value={f.footer} onChange={set('footer')} /></Field>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}
