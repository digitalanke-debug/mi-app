#!/bin/bash
# Despliega automáticamente cuando hay commits nuevos en la rama configurada (cron cada 5 min).
cd /opt/crm || exit 1
# Respaldo diario de la base de datos (una vez al día, conserva 14 días)
mkdir -p /opt/crm/backups
TODAY=$(date +%F)
if [ ! -s "/opt/crm/backups/crm-$TODAY.sql.gz" ] && docker compose ps --status running postgres 2>/dev/null | grep -q postgres; then
  docker compose exec -T postgres pg_dump -U crm crm | gzip > "/opt/crm/backups/crm-$TODAY.sql.gz.tmp" && mv "/opt/crm/backups/crm-$TODAY.sql.gz.tmp" "/opt/crm/backups/crm-$TODAY.sql.gz" \
    && echo "$(date -Is) respaldo crm-$TODAY.sql.gz ($(du -h "/opt/crm/backups/crm-$TODAY.sql.gz" | cut -f1))" >> /var/log/crm-autodeploy.log
  find /opt/crm/backups -name 'crm-*.sql.gz' -mtime +14 -delete
fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$BRANCH" || exit 0
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse "origin/$BRANCH")
LOG=/var/log/crm-autodeploy.log
# Mantiene el registro corto
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 600 ] && tail -300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
echo "$(date -Is) revisión: local ${LOCAL:0:7} remoto ${REMOTE:0:7}" >> "$LOG"
[ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force" ] && exit 0
echo "$(date -Is) desplegando $REMOTE" >> /var/log/crm-autodeploy.log
docker compose exec -T postgres pg_dump -U crm crm 2>/dev/null | gzip > "/opt/crm/backups/pre-deploy-$(date +%F-%H%M).sql.gz"
find /opt/crm/backups -name 'pre-deploy-*.sql.gz' -mtime +7 -delete
git reset -q --hard "origin/$BRANCH"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MB" -lt 6000 ]; then docker compose up -d --build postgres redis evolution hostops server >> /var/log/crm-autodeploy.log 2>&1
else docker compose up -d --build >> /var/log/crm-autodeploy.log 2>&1; fi
sleep 10
docker compose exec -T server node server/src/db/migrate.js >> /var/log/crm-autodeploy.log 2>&1
docker image prune -f >/dev/null 2>&1
echo "$(date -Is) listo" >> /var/log/crm-autodeploy.log
