import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'

const MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (recomendado, mejor calidad)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (rápido y económico)'], ['claude-haiku-4-5', 'Claude Haiku 4.5 (muy económico)']]

export default function AiAgent() {
  const { companyId, company, toast } = useStore()
  const [s, setS] = useState(null)
  useEffect(() => { companyId && api('/ai', { params: { company_id: companyId } }).then(setS) }, [companyId])
  const save = async () => { try { await api('/ai', { method: 'PUT', body: { ...s, company_id: companyId } }); toast('Agente guardado', 'success') } catch (e) { toast(e.message, 'error') } }
  if (!s) return <div className="page"><div className="empty">Cargando…</div></div>

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Agente IA · {company?.name}</h1><div className="sub">Responde por WhatsApp las consultas frecuentes, califica el lead y lo entrega a un asesor cuando hace falta.</div></div>
        <div className="actions"><button className="btn btn-primary" onClick={save}>Guardar</button></div>
      </div>
      {!s.api_key_configured && <div className="alert">Sin clave de API configurada: el agente funciona en <b>modo demo</b> con respuestas de prueba. Para activar la IA real, agrega <span className="kbd">ANTHROPIC_API_KEY</span> en el servidor.</div>}
      <div className="grid-2">
        <div className="card"><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row"><button className={`toggle ${s.enabled ? 'on' : ''}`} onClick={() => setS({ ...s, enabled: !s.enabled })} /><b>Agente activo en esta empresa</b></div>
          <div className="field"><label>Nombre del agente</label><input className="input" value={s.agent_name || ''} onChange={(e) => setS({ ...s, agent_name: e.target.value })} /></div>
          <div className="field"><label>Modelo</label><select className="select" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })}>{MODELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label>Máximo de respuestas del bot por conversación</label><input className="input" type="number" value={s.max_bot_turns} onChange={(e) => setS({ ...s, max_bot_turns: Number(e.target.value) })} /><div className="small muted">Después de este número, el bot deja de responder y espera a un asesor.</div></div>
          <div className="alert info small">Cómo funciona: el agente responde solo cuando ningún asesor ha escrito en los últimos 3 minutos. Si el cliente pide hablar con una persona, pregunta precios exactos o el caso es complejo, el agente entrega la conversación (etiqueta "Caliente", asigna asesor y deja una nota con el resumen).</div>
        </div></div>
        <div className="card"><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field"><label>Instrucciones (personalidad y objetivo)</label><textarea className="textarea" style={{ minHeight: 140 }} value={s.instructions || ''} onChange={(e) => setS({ ...s, instructions: e.target.value })} /></div>
          <div className="field"><label>Base de conocimiento (servicios, precios orientativos, horarios, requisitos, preguntas frecuentes)</label><textarea className="textarea" style={{ minHeight: 220 }} value={s.knowledge || ''} onChange={(e) => setS({ ...s, knowledge: e.target.value })} /></div>
        </div></div>
      </div>
    </div>
  )
}
