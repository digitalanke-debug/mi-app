# Publicar el CRM gratis para pruebas (Render + Neon)

Sirve para que el equipo pruebe el CRM desde cualquier navegador con el dominio propio. WhatsApp queda en modo simulado: los planes gratuitos apagan la app cuando nadie la usa y no guardan la sesión del celular. Para WhatsApp real ver `DEPLOY.md` (Hetzner, 4 a 8 euros al mes).

Tiempo: 20 minutos. Costo: 0.

## 1. Base de datos gratis en Neon

1. Entrar a https://neon.tech y crear cuenta (con Google o GitHub).
2. Crear proyecto: nombre `crm`, región US East. Dejar lo demás por defecto.
3. En el panel, botón **Connect** → copiar la cadena que empieza por `postgresql://…neon.tech/…?sslmode=require`. Guardarla, se usa en el paso 2.

## 2. Aplicación gratis en Render

1. Entrar a https://render.com y crear cuenta con GitHub. Autorizar acceso al repositorio `mi-app`.
2. Dashboard → **New** → **Blueprint** → elegir el repositorio `digitalanke-debug/mi-app` → rama `claude/epic-tesla-80pp6u` (o `main` cuando se fusione).
3. Render lee `render.yaml` y pide los valores faltantes:
   - `DATABASE_URL`: pegar la cadena de Neon.
   - `ANTHROPIC_API_KEY`: dejar vacío por ahora (el agente IA responde en modo demo).
4. **Apply**. El primer despliegue tarda 3 a 5 minutos. Al terminar aparece una URL tipo `https://crm-whatsapp.onrender.com`.
5. Abrir esa URL y entrar con `admin@demo.com` / `demo1234`. La base se llena sola con las 4 empresas y datos de ejemplo la primera vez.

## 3. Usar el dominio propio

1. En Render: el servicio → **Settings** → **Custom Domains** → **Add** → `crm.tudominio.com`. Render muestra un valor CNAME.
2. En el panel de DNS del dominio (cPanel de MochaHost → Zone Editor, o donde esté el dominio): crear registro **CNAME** con nombre `crm` y destino el valor que dio Render.
3. Esperar 5 a 30 minutos. Render emite el certificado HTTPS solo.
4. En Render → **Environment** → cambiar `CLIENT_ORIGIN` a `https://crm.tudominio.com` → Save (se redespliega solo).

## 4. Primeros pasos dentro del CRM

- **Equipo**: cambiar la clave del admin y crear los usuarios reales. Desactivar los usuarios demo.
- **Configuración**: por empresa, ajustar nombre, descripción, horario, etapas, etiquetas y respuestas rápidas.
- **Agente IA**: escribir la base de conocimiento de cada empresa.
- **Contactos**: eliminar los contactos demo cuando ya no hagan falta.

## Limitaciones del plan gratuito

- Render apaga la app tras 15 minutos sin uso; la siguiente visita tarda 30 a 60 segundos en despertar. Los datos no se pierden (están en Neon).
- Neon gratis: 0,5 GB, suficiente para decenas de miles de mensajes.
- Sin WhatsApp real ni n8n. Cuando se pase a Hetzner, se exporta la base de Neon y se importa en el servidor sin perder nada.

## Si algo falla

- En Render → **Logs** se ve el error. Lo más común: `DATABASE_URL` mal pegada (debe terminar en `?sslmode=require`).
- Para reiniciar los datos demo: en Neon → SQL Editor → `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` y en Render → **Manual Deploy**.
