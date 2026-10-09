#!/usr/bin/env bash
# Instalación en un servidor Hetzner Cloud (Ubuntu 24.04) recién creado.
# Uso (como root):  bash install-hetzner.sh https://github.com/USUARIO/REPO.git crm.tudominio.com
set -euo pipefail

REPO="${1:?Falta la URL del repositorio git}"
DOMAIN="${2:-auto}"
BRANCH="${3:-main}"
APP_DIR=/opt/crm

# Sin dominio: usa la IP pública con sslip.io (ej. 1.2.3.4.sslip.io) y HTTPS igual funciona.
if [ "$DOMAIN" = "auto" ]; then
  IP=$(curl -fs http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -fs https://api.ipify.org)
  DOMAIN="${IP}.sslip.io"
  echo "==> Sin dominio propio: el CRM quedará en https://$DOMAIN"
fi

echo "==> Actualizando sistema"
apt-get update -y && apt-get upgrade -y
apt-get install -y git curl ufw fail2ban unattended-upgrades

echo "==> Firewall: solo SSH, HTTP y HTTPS"
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

echo "==> Instalando Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "==> Instalando Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Clonando el CRM en $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull; else git clone -b "$BRANCH" "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "==> Generando .env con claves aleatorias"
  rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40; }
  cat > .env <<ENV
PUBLIC_URL=https://$DOMAIN
POSTGRES_PASSWORD=$(rand)
JWT_SECRET=$(rand)
EVOLUTION_API_KEY=$(rand)
EVOLUTION_PUBLIC_URL=https://$DOMAIN
WHATSAPP_PROVIDER=evolution
ANTHROPIC_API_KEY=
N8N_HOST=n8n.$DOMAIN
N8N_PUBLIC_URL=https://n8n.$DOMAIN
N8N_USER=admin
N8N_PASSWORD=$(rand)
ENV
  echo "    Revisa $APP_DIR/.env y agrega ANTHROPIC_API_KEY si vas a usar el agente IA."
fi

echo "==> Configurando Caddy para $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    reverse_proxy localhost:4000
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "==> Levantando contenedores (esto tarda unos minutos la primera vez)"
docker compose up -d --build
sleep 15
docker compose exec -T server node server/src/db/migrate.js
if [ "${SEED:-yes}" = "yes" ]; then docker compose exec -T server node server/src/db/seed.js || true; fi
echo "https://$DOMAIN" > /root/CRM_URL.txt

echo "==> Respaldo diario de la base de datos a /opt/crm/backups"
mkdir -p backups
cat > /etc/cron.daily/crm-backup <<'CRON'
#!/bin/sh
cd /opt/crm && docker compose exec -T postgres pg_dump -U crm crm | gzip > backups/crm-$(date +%F).sql.gz
find /opt/crm/backups -name '*.sql.gz' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/crm-backup

echo
echo "Listo. Pasos finales:"
echo "  1. Crear el primer administrador:  cd $APP_DIR && docker compose exec server node server/src/db/seed.js   (crea datos demo; luego edítalos en el CRM)"
echo "  2. Abrir https://$DOMAIN y conectar los WhatsApp por QR."
echo "  3. Claves generadas en $APP_DIR/.env (guárdalas en un lugar seguro)."
