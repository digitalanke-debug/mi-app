# Asistente de WhatsApp

La administración puede escribirle (o mandarle notas de voz, fotos y PDF) a un número de WhatsApp
dedicado de la firma. Un modelo de Claude interpreta el mensaje y ejecuta las mismas acciones que los
botones de la app, consultando y registrando en los datos reales. Todo queda en la bitácora con la marca
`whatsapp:<celular>`.

## Piezas

| Pieza | Dónde corre | Para qué |
|---|---|---|
| Evolution API | Ya existe en el servidor (la usa el CRM) | Conecta el número de WhatsApp y entrega los mensajes por webhook |
| Backend de la app (`server/whatsapp.js`, `server/agent.js`) | Contenedor `app` | Recibe el webhook, decide si el número está autorizado, llama a Claude y responde |
| Claude (API de Anthropic) | Nube | Entiende el mensaje y elige qué herramienta usar |
| Transcriptor Whisper (`transcriber`) | Contenedor opcional | Convierte notas de voz a texto en el propio servidor |

## Activación (una sola vez)

1. En el servidor:

```bash
cd /opt/sigo-admin && bash deploy/configurar-whatsapp.sh
```

   El script busca el contenedor de Evolution API, toma su clave y puerto automáticamente, pide la clave de
   la API de Anthropic, pregunta si activar notas de voz, y reinicia la app.

2. En la app, menú **Asistente WhatsApp**:
   - **Vincular número**: muestra un código QR. En el celular con el número dedicado: WhatsApp → Dispositivos
     vinculados → Vincular dispositivo → escanear. El número queda conectado como si fuera WhatsApp Web.
   - **Quién puede escribirle**: agrega los celulares autorizados (con indicativo, ej. `573001234567`).
     Cualquier otro número se ignora sin responder.
   - **Probar el asistente aquí**: chat de prueba con el mismo cerebro, sin pasar por WhatsApp.

## Qué entiende

- Consultas: "¿cuánto hay en Bancolombia?", "¿cómo vamos?", "¿qué toca pagar esta semana?", "¿quién está vencido?".
- Registros: "registra un pago de 2 millones de Inversiones del Norte, entró a Davivienda", "crea cuenta de cobro
  a Pérez por 1.500.000 de honorarios", "paga el arriendo y el internet desde Bancolombia", "abona 800 mil al préstamo".
- Recordatorios: "mándale recordatorio a Constructora Horizonte" envía el mensaje al cliente desde el número de la firma.
- Notas de voz con cualquiera de las anteriores (si la transcripción está activa).
- Fotos o PDF de facturas: describe el contenido y propone cómo registrarlo.

Si falta un dato clave (qué cliente, qué valor, de qué cuenta sale el dinero) pregunta antes de registrar.
No borra nada ni cambia la configuración.

## Seguridad

- El webhook solo acepta llamadas con el secreto de la URL (`WHATSAPP_WEBHOOK_SECRET`) y, si viene, la clave de Evolution.
- Solo responde a los números autorizados en la app.
- Cada mensaje se procesa una sola vez (tabla `wa_processed`).
- La conversación se recuerda por 6 horas por número y se reinicia sola cuando crece demasiado.

## Variables de entorno

| Variable | Qué es |
|---|---|
| `EVOLUTION_URL` | Dirección de Evolution API vista desde el contenedor (`http://host.docker.internal:8080`) |
| `EVOLUTION_API_KEY` | Clave global de Evolution (`AUTHENTICATION_API_KEY` del CRM) |
| `EVOLUTION_INSTANCE` | Nombre de la instancia de WhatsApp de esta app (`sygo-admin`) |
| `WHATSAPP_WEBHOOK_SECRET` | Secreto de la URL del webhook; lo genera el instalador |
| `PUBLIC_URL` | `https://admin.sygoabogados.com`; se arma desde `DOMAIN` |
| `ANTHROPIC_API_KEY` | Clave de la API de Anthropic |
| `ANTHROPIC_MODEL` | Modelo (por defecto `claude-opus-5-5`) |
| `VOICE_NOTES` / `TRANSCRIBE_URL` | Activan el contenedor de transcripción |

## Costos aproximados

Cada mensaje al asistente consume tokens de la API de Anthropic: unos pocos centavos de dólar por interacción
típica. Las notas de voz se transcriben en el servidor sin costo adicional.
