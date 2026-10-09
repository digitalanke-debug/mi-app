#!/bin/bash
# Despliega automáticamente cuando hay commits nuevos en la rama configurada (cron cada 5 min).
cd /opt/crm || exit 1
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$BRANCH" || exit 0
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse "origin/$BRANCH")
LOG=/var/log/crm-autodeploy.log
# Mantiene el registro corto
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 600 ] && tail -300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
echo "$(date -Is) revisión: local ${LOCAL:0:7} remoto ${REMOTE:0:7}" >> "$LOG"
[ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force" ] && exit 0
echo "$(date -Is) desplegando $REMOTE" >> /var/log/crm-autodeploy.log
git reset -q --hard "origin/$BRANCH"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MB" -lt 6000 ]; then docker compose up -d --build postgres redis evolution hostops server >> /var/log/crm-autodeploy.log 2>&1
else docker compose up -d --build >> /var/log/crm-autodeploy.log 2>&1; fi
sleep 10
docker compose exec -T server node server/src/db/migrate.js >> /var/log/crm-autodeploy.log 2>&1
docker image prune -f >/dev/null 2>&1
echo "$(date -Is) listo" >> /var/log/crm-autodeploy.log
