#!/usr/bin/env bash
# Instalación en un servidor Hetzner Cloud (Ubuntu 24.04) recién creado.
# Uso (como root):  bash install-hetzner.sh https://github.com/USUARIO/REPO.git crm.tudominio.com
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
STATUS_DIR=/var/www/status   # el registro de instalación se publica en https://<dominio>/install.log

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

echo "==> Instalando paquetes base (sin upgrade completo, para no bloquear la instalación)"
apt-get update -y
apt-get install -y git curl ufw fail2ban unattended-upgrades

echo "==> Firewall: solo SSH, HTTP y HTTPS"
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

echo "==> Instalando Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  # Repositorio de Ubuntu (universe). Si falla, binario oficial descargado directamente.
  apt-get install -y caddy || {
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy && chmod +x /usr/bin/caddy
    groupadd --system caddy 2>/dev/null || true
    useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy 2>/dev/null || true
    mkdir -p /etc/caddy
    curl -fsSL https://raw.githubusercontent.com/caddyserver/dist/master/init/caddy.service -o /etc/systemd/system/caddy.service
    systemctl daemon-reload
  }
fi
mkdir -p /etc/caddy

echo "==> Página de estado mientras se instala: https://$DOMAIN/install.log"
mkdir -p "$STATUS_DIR"
ln -sf /var/log/crm-install.log "$STATUS_DIR/install.log"
echo "Instalando el CRM... recarga esta página en unos minutos. Registro: /install.log" > "$STATUS_DIR/index.html"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    root * $STATUS_DIR
    file_server
}
CADDY
pkill -f "http.server 80" || true   # libera el puerto 80 del servidor de estado provisional
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

echo "==> Instalando Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh || apt-get install -y docker.io docker-compose-v2
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

echo "==> Levantando contenedores (esto tarda unos minutos la primera vez)"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MB" -lt 6000 ]; then
  echo "    Servidor con ${RAM_MB} MB de RAM: se omite n8n (se activa luego con: docker compose up -d n8n)"
  docker compose up -d --build postgres redis evolution server
else
  docker compose up -d --build
fi
sleep 15
docker compose exec -T server node server/src/db/migrate.js
if [ "${SEED:-yes}" = "yes" ]; then docker compose exec -T server node server/src/db/seed.js || true; fi
echo "https://$DOMAIN" > /root/CRM_URL.txt

echo "==> Configurando Caddy para $DOMAIN (CRM en /, registro en /install.log)"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    handle /install.log {
        root * $STATUS_DIR
        file_server
    }
    handle /autodeploy.log {
        root * $STATUS_DIR
        file_server
    }
    handle {
        reverse_proxy localhost:4000
    }
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "==> Actualización automática: cada 5 minutos revisa GitHub y despliega si hay cambios"
cat > /usr/local/bin/crm-autodeploy <<'AUTO'
#!/bin/bash
# Despliega automáticamente cuando hay commits nuevos en la rama configurada.
cd /opt/crm || exit 1
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$BRANCH" || exit 0
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0
echo "$(date -Is) desplegando $REMOTE" >> /var/log/crm-autodeploy.log
git reset -q --hard "origin/$BRANCH"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MB" -lt 6000 ]; then docker compose up -d --build postgres redis evolution server >> /var/log/crm-autodeploy.log 2>&1
else docker compose up -d --build >> /var/log/crm-autodeploy.log 2>&1; fi
sleep 10
docker compose exec -T server node server/src/db/migrate.js >> /var/log/crm-autodeploy.log 2>&1
docker image prune -f >/dev/null 2>&1
echo "$(date -Is) listo" >> /var/log/crm-autodeploy.log
AUTO
chmod +x /usr/local/bin/crm-autodeploy
echo "*/5 * * * * root flock -n /tmp/crm-autodeploy.lock /usr/local/bin/crm-autodeploy" > /etc/cron.d/crm-autodeploy
touch /var/log/crm-autodeploy.log && ln -sf /var/log/crm-autodeploy.log "$STATUS_DIR/autodeploy.log"

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
