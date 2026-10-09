#!/bin/sh
# Se ejecuta en el servidor (contenedor con acceso al host) en cada despliegue automático.
# 1) Mantiene el Caddyfile: dominio propio de deploy/domain.txt + dominio por IP (sslip.io) como respaldo.
# 2) Actualiza el script de autodespliegue del host desde el repositorio.
# Nunca falla el despliegue: cualquier error se registra y se sigue.
set +e
LOG=/host/var/log/crm-hostops.log
echo "$(date -Is) hostops inicio" >> "$LOG"
DOMAIN=$(tr -d ' \r\n' < /app/deploy/domain.txt 2>/dev/null)
IP=$(wget -qO- --timeout=5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 2>/dev/null || wget -qO- --timeout=5 https://api.ipify.org 2>/dev/null)
HOSTS="${IP}.sslip.io"
# Solo activa el dominio propio cuando su DNS ya apunta a este servidor (si no, Caddy fallaría al pedir el certificado)
if [ -n "$DOMAIN" ] && [ -n "$IP" ]; then
  RESOLVED=$(nslookup "$DOMAIN" 2>/dev/null | awk '/^Address/ && !/#/ {print $2}' | tail -1)
  if [ "$RESOLVED" = "$IP" ]; then HOSTS="$DOMAIN, ${IP}.sslip.io"; echo "$(date -Is) dominio $DOMAIN apunta a $IP" >> "$LOG"
  else echo "$(date -Is) dominio $DOMAIN aún no apunta a $IP (resuelve: ${RESOLVED:-nada})" >> "$LOG"; fi
fi
NEW=$(cat <<CADDY
$HOSTS {
    encode gzip
    handle /install.log {
        root * /var/www/status
        file_server
    }
    handle /autodeploy.log {
        root * /var/www/status
        file_server
    }
    handle /hostops.log {
        root * /var/www/status
        file_server
    }
    handle {
        reverse_proxy localhost:4000
    }
}
CADDY
)
if [ "$NEW" != "$(cat /host/etc/caddy/Caddyfile 2>/dev/null)" ]; then
  echo "$NEW" > /host/etc/caddy/Caddyfile
  caddy reload --config /host/etc/caddy/Caddyfile --adapter caddyfile >> "$LOG" 2>&1 && echo "$(date -Is) Caddy recargado con: $HOSTS" >> "$LOG"
fi
ln -sf /var/log/crm-hostops.log /host/var/www/status/hostops.log 2>/dev/null
if [ -f /app/deploy/autodeploy.sh ] && ! cmp -s /app/deploy/autodeploy.sh /host/usr/local/bin/crm-autodeploy; then
  cp /app/deploy/autodeploy.sh /host/usr/local/bin/crm-autodeploy && chmod +x /host/usr/local/bin/crm-autodeploy && echo "$(date -Is) autodeploy actualizado" >> "$LOG"
fi
echo "$(date -Is) hostops fin" >> "$LOG"
exit 0
