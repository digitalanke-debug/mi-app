#!/bin/bash
# Instalador para un servidor Ubuntu (nuevo o compartido con otras apps).
# Uso como root:  bash install.sh
# Variables opcionales: BRANCH (rama del repositorio), DIR (carpeta de instalación)
set -euo pipefail

REPO="https://github.com/digitalanke-debug/mi-app.git"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/sigo-admin}"

say() { printf '\n\033[1;34m>>> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta este script como root."; exit 1; fi

say "Instalando herramientas básicas"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl >/dev/null
if ! command -v docker >/dev/null; then
  say "Instalando Docker"
  curl -fsSL https://get.docker.com | sh
fi

say "Descargando la aplicación (rama $BRANCH) en $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" pull -q --ff-only origin "$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

# ---------- Puerto libre ----------
APP_PORT=3000
while ss -tln 2>/dev/null | grep -q ":$APP_PORT "; do APP_PORT=$((APP_PORT + 1)); done

# ---------- Configuración (.env) ----------
if [ ! -f .env ]; then
  say "Configuración inicial"
  read -r -p "Dominio de la app [admin.sygoabogados.com]: " DOMAIN
  DOMAIN="${DOMAIN:-admin.sygoabogados.com}"
  read -r -p "Correo del primer administrador: " ADMIN_EMAIL
  while [ -z "$ADMIN_EMAIL" ]; do read -r -p "Correo del primer administrador: " ADMIN_EMAIL; done
  read -r -p "Nombre que verá en la app [Administradora]: " ADMIN_NAME
  ADMIN_NAME="${ADMIN_NAME:-Administradora}"
  while true; do
    read -r -s -p "Contraseña (mínimo 8 caracteres): " ADMIN_PASSWORD; echo
    read -r -s -p "Repite la contraseña: " ADMIN_PASSWORD2; echo
    if [ "${#ADMIN_PASSWORD}" -ge 8 ] && [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ]; then break; fi
    echo "No coinciden o es muy corta. Intenta de nuevo."
  done

  # ¿Hay un Caddy instalado en el sistema atendiendo la web? Entonces lo reutilizamos.
  USE_CADDY=true
  if systemctl is-active --quiet caddy 2>/dev/null && [ -f /etc/caddy/Caddyfile ]; then USE_CADDY=false; fi

  cat > .env <<ENV
DOMAIN=$DOMAIN
USE_CADDY=$USE_CADDY
APP_PORT=$APP_PORT
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_NAME=$ADMIN_NAME
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
ENV
  chmod 600 .env
else
  say "Usando la configuración existente en $DIR/.env"
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

# ---------- Proxy ----------
if [ "$USE_CADDY" = "false" ]; then
  if grep -q "^$DOMAIN " /etc/caddy/Caddyfile; then
    say "Caddy ya tiene configurado $DOMAIN"
  else
    say "Agregando $DOMAIN al Caddy del sistema"
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
    cat >> /etc/caddy/Caddyfile <<CADDY

$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$APP_PORT
}
CADDY
    if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
      systemctl reload caddy
    else
      echo "La configuración de Caddy no validó. Se restaura la copia anterior."
      cp "$(ls -t /etc/caddy/Caddyfile.bak.* | head -1)" /etc/caddy/Caddyfile
      echo "Agrega a mano en /etc/caddy/Caddyfile:  $DOMAIN { reverse_proxy 127.0.0.1:$APP_PORT }"
    fi
  fi
  PROFILES=""
else
  PROFILES="--profile caddy"
fi

# ---------- Arranque ----------
say "Construyendo y arrancando la aplicación (puede tardar 2 o 3 minutos)"
docker compose $PROFILES up -d --build --remove-orphans

say "Esperando a que responda"
for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    echo
    echo "Listo. Entra en https://$DOMAIN con el correo $ADMIN_EMAIL"
    echo "Para actualizar más adelante:  cd $DIR && bash deploy/deploy.sh"
    exit 0
  fi
  sleep 3
done
echo "La app no respondió todavía. Revisa con:  cd $DIR && docker compose logs app"
exit 1
