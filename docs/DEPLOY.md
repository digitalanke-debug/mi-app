# Despliegue en producción (VPS)

El hosting cPanel compartido **no sirve** para este CRM: necesita procesos Node permanentes, websockets y Docker. La web actual se queda en cPanel y el CRM va en un VPS aparte.

## 1. VPS

- Proveedor: Hetzner (CX32, 8 GB RAM, ~8 EUR/mes), DigitalOcean (4 vCPU / 8 GB, ~48 USD) o Contabo. Mínimo recomendado 4 GB; con n8n y Evolution, 8 GB.
- Ubuntu 24.04. Instalar Docker: `curl -fsSL https://get.docker.com | sh`.
- DNS: crear `crm.tudominio.com` apuntando a la IP del VPS (y `n8n.tudominio.com` si se usa n8n).

## 2. Subir el proyecto

```bash
git clone <repo> crm && cd crm
cp .env.production.example .env
nano .env        # claves fuertes, dominio, ANTHROPIC_API_KEY
docker compose up -d --build
docker compose exec server node server/src/db/migrate.js
docker compose exec server node server/src/db/seed.js   # solo la primera vez, crea usuarios y empresas demo (luego editarlos en Equipo / Configuración)
```

## 3. HTTPS con Caddy (o Nginx)

Instalar Caddy en el VPS y usar este `Caddyfile`:

```
crm.tudominio.com {
  reverse_proxy /evolution/* localhost:8080
  reverse_proxy localhost:4000
}
n8n.tudominio.com {
  reverse_proxy localhost:5678
}
```

Caddy emite el certificado SSL solo. Los puertos 4000, 8080 y 5678 solo escuchan en localhost, así que nada queda expuesto sin HTTPS.

## 4. Conectar los WhatsApp

1. Entrar al CRM como admin, elegir la empresa, ir a **WhatsApp**, "Conectar otro número".
2. Pulsar "Conectar con QR" y escanear desde el celular: WhatsApp Business → ⋮ → Dispositivos vinculados → Vincular un dispositivo.
3. Repetir por cada empresa / número. Cada número queda como una instancia independiente en Evolution API.

Recomendaciones para evitar bloqueos de Meta: un número por instancia, responder principalmente a mensajes entrantes, nada de envíos masivos a números que no han escrito, no cambiar de celular con frecuencia y mantener el teléfono con internet.

## 5. Captura de leads

- **Google Ads / Meta Ads / web**: usar enlaces `https://wa.me/57XXXXXXXXXX?text=Hola%20[GA-CAMPAÑA]`. El CRM lee el código entre corchetes y marca origen y campaña.
- **Formularios** (Google Ads Lead Form, landing, n8n): `POST https://crm.tudominio.com/api/whatsapp/webhooks/lead/<companyId>` con JSON `{ "phone": "573001234567", "name": "…", "message": "…", "source": "google_ads", "campaign": "…" }`.
- **Anuncios clic a WhatsApp de Meta**: llegan con datos del anuncio y se marcan automáticamente como `meta_ads`.

## 6. Agente IA

Poner `ANTHROPIC_API_KEY` en `.env` y reiniciar `server`. Por empresa, en **Agente IA**: instrucciones, base de conocimiento, modelo y máximo de turnos. Costo aproximado: entre 3 y 15 centavos de dólar por conversación con Claude Sonnet 5.5 u Opus 5.5.

## 7. Respaldos

```bash
docker compose exec postgres pg_dump -U crm crm | gzip > backup-$(date +%F).sql.gz
```
Programar con cron a diario y copiar a otro lugar (Backblaze B2, Google Drive con rclone). El volumen `evolution_instances` guarda las sesiones de WhatsApp; respaldarlo evita re-escanear el QR al restaurar.

## 8. Actualizar

```bash
git pull && docker compose up -d --build && docker compose exec server node server/src/db/migrate.js
```
