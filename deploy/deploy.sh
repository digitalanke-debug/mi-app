#!/bin/bash
# Actualiza y reinicia la app. Ejecutar dentro de la carpeta del proyecto en el servidor.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only

# Completa variables nuevas que versiones anteriores del .env no tenían
ensure() { grep -q "^$1=" .env 2>/dev/null || echo "$1=$2" >> .env; }
ensure WHATSAPP_WEBHOOK_SECRET "$(openssl rand -hex 24)"
ensure EVOLUTION_INSTANCE "sygo-admin"
ensure EVOLUTION_NETWORK "bridge"
ensure VOICE_NOTES "false"
ensure TRANSCRIBE_URL ""

PROFILES=""
grep -q '^USE_CADDY=true' .env && PROFILES="$PROFILES --profile caddy"
if grep -q '^VOICE_NOTES=true' .env; then
  PROFILES="$PROFILES --profile voz"
  sed -i 's#^TRANSCRIBE_URL=.*#TRANSCRIBE_URL=http://transcriber:9000#' .env
fi
docker compose $PROFILES up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "Listo. Estado:"
docker compose $PROFILES ps
