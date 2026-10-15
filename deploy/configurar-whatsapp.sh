#!/bin/bash
# Configura la conexión con Evolution API (WhatsApp) y la clave de Claude para el asistente.
# Ejecutar como root dentro de la carpeta del proyecto:  bash deploy/configurar-whatsapp.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No existe .env. Ejecuta primero install.sh"; exit 1; }

say() { printf '\n\033[1;34m>>> %s\033[0m\n' "$*"; }
setvar() { if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi; }
getvar() { { grep "^$1=" .env || true; } | head -1 | cut -d= -f2-; }

# ---------- Evolution API ----------
say "Buscando Evolution API en este servidor"
EVO_CONTAINER=$(docker ps --format '{{.Names}} {{.Image}}' | { awk '/evolution-api/ {print $1; exit}' || true; })
EVO_KEY=""
EVO_PORT=""
if [ -n "$EVO_CONTAINER" ]; then
  EVO_KEY=$(docker exec "$EVO_CONTAINER" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)
  EVO_PORT=$(docker port "$EVO_CONTAINER" 8080/tcp 2>/dev/null | head -1 | sed 's/.*://')
  echo "Encontrado: $EVO_CONTAINER (puerto ${EVO_PORT:-?})"
fi
EVO_NET=""
if [ -n "$EVO_CONTAINER" ]; then
  EVO_NET=$(docker inspect "$EVO_CONTAINER" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null | grep -v '^bridge$' | head -1 || true)
fi
if [ -n "$EVO_KEY" ] && [ -n "$EVO_CONTAINER" ]; then
  if [ -n "$EVO_NET" ]; then
    # La app se une a la red del CRM y habla con Evolution por su nombre de contenedor
    setvar EVOLUTION_NETWORK "$EVO_NET"
    setvar EVOLUTION_URL "http://$EVO_CONTAINER:8080"
    echo "Red de Evolution: $EVO_NET (la app se conectará a ella)"
  else
    setvar EVOLUTION_NETWORK "bridge"
    setvar EVOLUTION_URL "http://host.docker.internal:${EVO_PORT:-8080}"
  fi
  setvar EVOLUTION_API_KEY "$EVO_KEY"
  echo "Clave de Evolution tomada automáticamente."
else
  setvar EVOLUTION_NETWORK "bridge"
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

say "Comprobando que la app llega a Evolution API"
EURL=$(getvar EVOLUTION_URL)
EKEY=$(getvar EVOLUTION_API_KEY)
sleep 3
if docker compose exec -T app wget -qO- --timeout=10 --header "apikey: $EKEY" "$EURL/instance/fetchInstances" >/dev/null 2>&1; then
  echo "Conexión con Evolution API correcta."
else
  echo "La app NO pudo conectarse a $EURL. Revisa EVOLUTION_URL y EVOLUTION_NETWORK en .env"
fi
echo
echo "Listo. Entra a la app, menú 'Asistente WhatsApp', y vincula el número con el código QR."
