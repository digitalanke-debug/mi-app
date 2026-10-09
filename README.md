# CRM WhatsApp multiempresa

CRM comercial para varias empresas con WhatsApp Business conectado por **QR** (sin API oficial de Meta), bandeja compartida en tiempo real, pipeline kanban, etiquetas, asignación, tiempos de respuesta, automatizaciones y un agente IA que responde por WhatsApp y entrega a un asesor.

## Demo en 1 minuto

Requisitos: Node.js 20 o superior (https://nodejs.org, versión LTS) y Git.

```bash
git clone https://github.com/digitalanke-debug/mi-app.git
cd mi-app
git checkout claude/epic-tesla-80pp6u   # rama con el CRM (hasta que se fusione a main)
npm install
npm run demo        # migra la base SQLite, carga datos demo y levanta API + web
```

Si ya lo habías clonado, actualiza con `git pull` y vuelve a correr `npm install`.

Problemas frecuentes:
- `Cannot open database because the directory does not exist`: actualiza el repositorio, ya está corregido.
- Error compilando `better-sqlite3` en Windows: instala Node LTS desde nodejs.org (trae los binarios precompilados) o ejecuta `npm install` de nuevo.
- `EADDRINUSE 4000` o `5173`: hay otro programa usando ese puerto; cierra la terminal anterior donde corría la demo.

Abre http://localhost:5173 y entra con `admin@demo.com` / `demo1234` (también `kevin@demo.com` y `laura@demo.com` como asesores).

En modo demo no hace falta Docker, PostgreSQL ni un celular: el QR es simulado, los mensajes se generan con los botones "Simular lead nuevo" y "Simular respuesta del cliente", y el agente IA responde con reglas de prueba si no hay `ANTHROPIC_API_KEY`.

## Qué incluye

- **Multiempresa**: 4 empresas demo (Núcleo Pensional, Abogado Fiduciario, Piensas - Fogainc, DDI), cada una con sus números de WhatsApp, pipeline, etiquetas, respuestas rápidas, automatizaciones y agente IA. Los usuarios ven solo las empresas que tienen asignadas.
- **Bandeja en vivo** (Socket.io): filtros por estado, mías, sin asignar; chat con respuestas rápidas (`/atajo`), notas internas, tareas, etiquetas, etapa, valor y servicio.
- **Tiempos**: esperando respuesta, abierta hace, primera respuesta, tiempo en etapa. Alertas por inactividad.
- **Pipeline kanban** con arrastrar y soltar, valor por etapa y tiempo en etapa.
- **Automatizaciones**: bienvenida, etiquetado por origen, asignación round robin, palabras clave, fuera de horario, sin respuesta N minutos, respuesta del agente IA.
- **Agente IA** (Claude): instrucciones y base de conocimiento por empresa, máximo de turnos, entrega a humano con resumen y nota.
- **Origen de los leads**: código `[GA-…]`, `[META-…]`, `[WEB-…]`, `[REF-…]` en el primer mensaje (enlaces wa.me desde Google Ads, Meta Ads, web) y webhook `POST /api/whatsapp/webhooks/lead/:companyId` para formularios.
- **Dashboard**: leads, conversión, primera respuesta, valor ganado, por origen / campaña / etapa / asesor / servicio.
- **Equipo**: usuarios, roles (admin/asesor) y acceso por empresa.
- **Adjuntos**: imágenes, audios, videos y documentos en ambas direcciones, con visor de imágenes.
- **Plantillas** con variables y selector de emojis. **Modo oscuro**, **vista móvil** y **avisos** de escritorio con sonido.
- **Marketing**: inversión por campaña (importación manual o API de Google Ads), costo por lead y por cierre, retorno; comparativo entre empresas; exportación CSV.
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

## Publicar

- Gratis para pruebas (sin WhatsApp real): [docs/DEPLOY-GRATIS.md](docs/DEPLOY-GRATIS.md) con Render + Neon.
- Producción completa con WhatsApp por QR: [docs/DEPLOY.md](docs/DEPLOY.md) en un VPS (Hetzner) con Docker.

## Producción

Ver [docs/DEPLOY.md](docs/DEPLOY.md). Resumen: VPS con Docker, `docker compose up -d`, dominio con HTTPS, y en la sección WhatsApp del CRM se escanea el QR real de cada número.
