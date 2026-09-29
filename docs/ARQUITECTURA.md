# Arquitectura

```
[WhatsApp Business (celular)] ⇄ QR ⇄ [Evolution API] ⇄ webhook/REST ⇄ [Server Node]
                                                                          ├── PostgreSQL (SQLite en demo)
                                                                          ├── Socket.io → [Web React]
                                                                          ├── Motor de automatizaciones
                                                                          └── Agente IA (Claude API)
[Google Ads / Meta Ads / Web] → wa.me con código [GA-…] o webhook /lead → Server
[n8n] ⇄ webhooks ⇄ Server  (automatizaciones avanzadas, integraciones externas)
```

## Proveedores de WhatsApp

`server/src/services/whatsapp/` define una interfaz mínima: `createInstance`, `connect` (devuelve QR), `disconnect`, `status`, `sendText`, y para Evolution `handleWebhook`. Se elige con `WHATSAPP_PROVIDER=demo|evolution`. Agregar otro proveedor (por ejemplo la API oficial de Meta en el futuro) es implementar esa interfaz.

## Flujo de un mensaje entrante

`services/inbound.js → handleInbound()`:
1. Normaliza el teléfono, crea o actualiza el contacto. Detecta origen y campaña por el código `[GA-…]` o el referral de Meta.
2. Busca conversación abierta con ese contacto o crea una en la primera etapa del pipeline por defecto.
3. Guarda el mensaje, emite `message:new` y `conversation:update` por Socket.io a la sala de la empresa.
4. Dispara automatizaciones en orden: `new_conversation` (solo si es nueva), `outside_hours`, `keyword`, `message_in`.

## Automatizaciones

Tabla `automations` por empresa: `trigger`, `conditions` (JSON), `actions` (JSON). Acciones: `reply`, `add_tag`, `move_stage`, `assign` (round robin o usuario), `notify`, `ai_reply`. El trigger `inactivity` corre cada minuto (`checkInactivity`) y no se repite para el mismo mensaje entrante.

## Agente IA

`services/ai.js`. Construye el system prompt con instrucciones + descripción de la empresa + base de conocimiento (con caché de prompt), envía el historial de WhatsApp como turnos user/assistant y expone la herramienta `entregar_a_humano`. Reglas de convivencia con humanos en `aiRespond()`: no responde si un asesor escribió en los últimos N minutos, respeta el máximo de turnos, y al entregar deshabilita la IA en ese chat, asigna asesor, etiqueta "Caliente" y deja nota con el resumen. Sin `ANTHROPIC_API_KEY` usa respuestas de prueba (`demoReply`).

## Multiempresa y permisos

- `companies` ⟷ `company_users` ⟷ `users` (rol `admin` ve todo; `agent` solo sus empresas).
- Todo dato comercial lleva `company_id`. Las rutas exigen `company_id` y validan membresía (`requireCompany`).
- Las salas de Socket.io son `company:<id>`, así cada usuario recibe solo eventos de sus empresas.

## Modelo de datos (resumen)

companies, users, company_users, whatsapp_instances, contacts, conversations, messages, conversation_tags, tags, pipelines, pipeline_stages, notes, tasks, quick_replies, automations, ai_settings, activity_log. Migración en `server/src/db/migrations/001_init.js`, compatible con SQLite y PostgreSQL.

## Pendientes sugeridos (fases 2 a 4)

- Medios (imágenes, audios, documentos) en la bandeja: Evolution ya los reporta; falta guardar y mostrar.
- Plantillas de campañas/segmentos (con cuidado por riesgo de bloqueo).
- Integración Google Ads API para gasto por campaña y costo por lead, y subida de conversiones offline.
- Recordatorios con notificaciones push / correo.
- Registro de auditoría más detallado y roles adicionales (supervisor).
