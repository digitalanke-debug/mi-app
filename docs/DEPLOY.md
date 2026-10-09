# Despliegue en producción (VPS)

El hosting cPanel compartido **no sirve** para este CRM: necesita procesos Node permanentes, websockets y Docker. La web actual se queda en cPanel y el CRM va en un VPS aparte.

## 1. VPS

- Proveedor: Hetzner (CX32, 8 GB RAM, ~8 EUR/mes), DigitalOcean (4 vCPU / 8 GB, ~48 USD) o Contabo. Mínimo recomendado 4 GB; con n8n y Evolution, 8 GB.
- Ubuntu 24.04. Instalar Docker: `curl -fsSL https://get.docker.com | sh`.
- DNS: crear `crm.tudominio.com` apuntando a la IP del VPS (y `n8n.tudominio.com` si se usa n8n).

## 1a. Instalación sin terminal (Cloud config)

Al crear el servidor en la consola de Hetzner, en el campo **Cloud config** pegar el contenido de `deploy/cloud-init.yaml`. Requiere que el repositorio sea público (o cambiar la URL por una con token). En 5 a 8 minutos el CRM queda en `https://<IP>.sslip.io` con HTTPS, sin dominio propio. El registro de la instalación queda en `/root/install.log` del servidor.

### Dominio propio (automático)

El dominio del CRM se define en `deploy/domain.txt` del repositorio (actualmente `crm.sygoabogados.com`). En cada despliegue, el servidor comprueba si ese dominio ya apunta a su IP; cuando lo hace, agrega el dominio a Caddy y emite el certificado HTTPS solo. El dominio por IP (`<IP>.sslip.io`) sigue funcionando como respaldo.

Pasos para activarlo:
1. En el DNS del dominio crear un registro **A** con nombre `crm` y valor la IP del servidor (TTL 300).
2. Esperar la propagación (5 a 30 minutos). El estado se ve en `https://<IP>.sslip.io/hostops.log`.
3. El siguiente despliegue (cualquier commit, o manualmente `crm-autodeploy --force` en el servidor) activa el dominio.

## Actualizaciones automáticas

Cada 5 minutos el servidor revisa la rama configurada en GitHub. Si hay commits nuevos: descarga, reconstruye los contenedores, aplica migraciones y recarga. Registro en `https://<IP>.sslip.io/autodeploy.log`. Para forzar: `crm-autodeploy --force`.

## 1b. Instalación automática en Hetzner

Hay un script que hace los pasos 1 a 3 y 7 solo:

1. En https://console.hetzner.cloud crear proyecto → "Add server". Ubicación: Falkenstein o Nuremberg (Alemania, línea CX, la más barata) o Ashburn (EE. UU., línea CPX, más cara). Imagen: **Ubuntu 24.04**. Tipo: **CX33** (4 vCPU, 8 GB) o CPX31 en EE. UU. Agregar la llave SSH y crear.
2. Apuntar el DNS `crm.tudominio.com` → IP del servidor (registro A).
3. Conectarse por SSH y ejecutar:

```bash
ssh root@IP_DEL_SERVIDOR
curl -fsSL https://raw.githubusercontent.com/USUARIO/REPO/main/deploy/install-hetzner.sh -o install.sh
bash install.sh https://github.com/USUARIO/REPO.git crm.tudominio.com
```

El script actualiza Ubuntu, activa firewall y fail2ban, instala Docker y Caddy, clona el CRM en `/opt/crm`, genera un `.env` con claves aleatorias, emite el certificado HTTPS, levanta los contenedores, migra la base y deja un respaldo diario en `/opt/crm/backups`. Al terminar imprime los pasos finales. Si el repositorio es privado, usar un token de acceso en la URL o clonar con llave de despliegue.

Los pasos manuales siguen abajo por si prefieren hacerlos uno a uno o el servidor no es Hetzner.

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
