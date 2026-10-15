#!/bin/bash
# Configura la conexión con Evolution API (WhatsApp) y la clave de Claude para el asistente.
# Ejecutar como root dentro de la carpeta del proyecto:  bash deploy/configurar-whatsapp.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No existe .env. Ejecuta primero install.sh"; exit 1; }

say() { printf '\n\033[1;34m>>> %s\033[0m\n' "$*"; }
setvar() { if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi; }
getvar() { grep "^$1=" .env | head -1 | cut -d= -f2-; }

# ---------- Evolution API ----------
say "Buscando Evolution API en este servidor"
EVO_CONTAINER=$(docker ps --format '{{.Names}} {{.Image}}' | awk '/evolution-api/ {print $1; exit}' || true)
EVO_KEY=""
EVO_PORT=""
if [ -n "$EVO_CONTAINER" ]; then
  EVO_KEY=$(docker exec "$EVO_CONTAINER" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)
  EVO_PORT=$(docker port "$EVO_CONTAINER" 8080/tcp 2>/dev/null | head -1 | sed 's/.*://')
  echo "Encontrado: $EVO_CONTAINER (puerto ${EVO_PORT:-?})"
fi
if [ -n "$EVO_KEY" ] && [ -n "$EVO_PORT" ]; then
  setvar EVOLUTION_URL "http://host.docker.internal:$EVO_PORT"
  setvar EVOLUTION_API_KEY "$EVO_KEY"
  echo "Clave y puerto de Evolution tomados automáticamente."
else
  read -r -p "Dirección de Evolution API [http://host.docker.internal:8080]: " U
  setvar EVOLUTION_URL "${U:-http://host.docker.internal:8080}"
  read -r -s -p "Clave (AUTHENTICATION_API_KEY) de Evolution API: " K; echo
  setvar EVOLUTION_API_KEY "$K"
fi
read -r -p "Nombre de la instancia de WhatsApp para esta app [sygo-admin]: " I
setvar EVOLUTION_INSTANCE "${I:-sygo-admin}"
[ -n "$(getvar WHATSAPP_WEBHOOK_SECRET)" ] || setvar WHATSAPP_WEBHOOK_SECRET "$(openssl rand -hex 24)"

# ---------- Claude ----------
say "Asistente (Claude)"
CUR=$(getvar ANTHROPIC_API_KEY)
if [ -n "$CUR" ]; then
  read -r -p "Ya hay una clave de Anthropic guardada. ¿Reemplazarla? [s/N]: " R
  if [ "${R:-n}" = "s" ] || [ "${R:-n}" = "S" ]; then read -r -s -p "Nueva clave (sk-ant-...): " A; echo; setvar ANTHROPIC_API_KEY "$A"; fi
else
  read -r -s -p "Clave de la API de Anthropic (sk-ant-...). Enter para dejar vacío: " A; echo
  setvar ANTHROPIC_API_KEY "$A"
fi

# ---------- Notas de voz ----------
say "Notas de voz"
read -r -p "¿Activar transcripción de notas de voz? Descarga ~3 GB y usa ~1 GB de memoria [S/n]: " V
if [ "${V:-s}" = "n" ] || [ "${V:-s}" = "N" ]; then setvar VOICE_NOTES false; setvar TRANSCRIBE_URL ""; else setvar VOICE_NOTES true; setvar TRANSCRIBE_URL "http://transcriber:9000"; fi

say "Aplicando"
bash deploy/deploy.sh
echo
echo "Listo. Entra a la app, menú 'Asistente WhatsApp', y vincula el número con el código QR."
