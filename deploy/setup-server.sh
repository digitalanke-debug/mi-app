#!/bin/bash
# Prepara un servidor Ubuntu 24.04 recién creado en Hetzner: Docker, firewall y la app.
# Uso (como root en el servidor):  bash setup-server.sh https://github.com/digitalanke-debug/mi-app.git
set -euo pipefail
REPO="${1:?Falta la URL del repositorio}"
DIR=/opt/sigo-admin

apt-get update -y && apt-get install -y ca-certificates curl git ufw
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [ ! -d "$DIR" ]; then
  git clone "$REPO" "$DIR"
fi
cd "$DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
  echo
  echo ">>> Edita $DIR/.env y pon DOMAIN, ADMIN_EMAIL y ADMIN_PASSWORD. Luego ejecuta: bash deploy/deploy.sh"
fi
