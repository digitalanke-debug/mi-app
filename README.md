# CRM WhatsApp multiempresa

CRM comercial para varias empresas con WhatsApp Business conectado por **QR** (sin API oficial de Meta), bandeja compartida en tiempo real, pipeline kanban, etiquetas, asignación, tiempos de respuesta, automatizaciones y un agente IA que responde por WhatsApp y entrega a un asesor.

## Demo en 1 minuto

```bash
npm install
npm run demo        # migra la base SQLite, carga datos demo y levanta API + web
```

Abre http://localhost:5173 y entra con `admin@demo.com` / `demo1234` (también `kevin@demo.com` y `laura@demo.com` como asesores).

En modo demo no hace falta Docker, PostgreSQL ni un celular: el QR es simulado, los mensajes se generan con los botones "Simular lead nuevo" y "Simular respuesta del cliente", y el agente IA responde con reglas de prueba si no hay `ANTHROPIC_API_KEY`.

## Qué incluye

- **Multiempresa**: 4 empresas demo (Núcleo Pensional, Abogado Fiduciario, SGO Consultores, Piensa Financiero), cada una con sus números de WhatsApp, pipeline, etiquetas, respuestas rápidas, automatizaciones y agente IA. Los usuarios ven solo las empresas que tienen asignadas.
- **Bandeja en vivo** (Socket.io): filtros por estado, mías, sin asignar; chat con respuestas rápidas (`/atajo`), notas internas, tareas, etiquetas, etapa, valor y servicio.
- **Tiempos**: esperando respuesta, abierta hace, primera respuesta, tiempo en etapa. Alertas por inactividad.
- **Pipeline kanban** con arrastrar y soltar, valor por etapa y tiempo en etapa.
- **Automatizaciones**: bienvenida, etiquetado por origen, asignación round robin, palabras clave, fuera de horario, sin respuesta N minutos, respuesta del agente IA.
- **Agente IA** (Claude): instrucciones y base de conocimiento por empresa, máximo de turnos, entrega a humano con resumen y nota.
- **Origen de los leads**: código `[GA-…]`, `[META-…]`, `[WEB-…]`, `[REF-…]` en el primer mensaje (enlaces wa.me desde Google Ads, Meta Ads, web) y webhook `POST /api/whatsapp/webhooks/lead/:companyId` para formularios.
- **Dashboard**: leads, conversión, primera respuesta, valor ganado, por origen / campaña / etapa / asesor / servicio.
- **Equipo**: usuarios, roles (admin/asesor) y acceso por empresa.
- **Habeas data**: eliminación de contacto con todas sus conversaciones, exportación CSV.

## Estructura

```
client/   React + Vite (interfaz)
server/   Node + Express + Socket.io + Knex (SQLite en demo, PostgreSQL en producción)
  src/services/whatsapp/   proveedores: demo (simulado) y evolution (Evolution API real)
  src/services/inbound.js  entrada única de mensajes -> contacto, conversación, automatizaciones
  src/services/automations.js  motor de reglas
  src/services/ai.js       agente IA con Claude
docs/DEPLOY.md        guía de despliegue en VPS con Docker
docs/ARQUITECTURA.md  decisiones técnicas y modelo de datos
```

## Producción

Ver [docs/DEPLOY.md](docs/DEPLOY.md). Resumen: VPS con Docker, `docker compose up -d`, dominio con HTTPS, y en la sección WhatsApp del CRM se escanea el QR real de cada número.
