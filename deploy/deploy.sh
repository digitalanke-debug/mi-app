#!/bin/bash
# Actualiza y reinicia la app. Ejecutar dentro de la carpeta del proyecto en el servidor.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
PROFILES=""
if grep -q '^USE_CADDY=true' .env 2>/dev/null; then PROFILES="--profile caddy"; fi
docker compose $PROFILES up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "Listo. Estado:"
docker compose $PROFILES ps
