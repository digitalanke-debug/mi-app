#!/bin/sh
# Respaldo diario de la base de datos. Conserva los últimos 30 archivos.
set -eu
mkdir -p /backups
while true; do
  f="/backups/sigo-$(date +%Y%m%d-%H%M%S).sql.gz"
  if pg_dump -h db -U sigo sigo | gzip > "$f"; then
    echo "Respaldo creado: $f"
  else
    echo "Falló el respaldo" >&2
    rm -f "$f"
  fi
  ls -1t /backups/sigo-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
  sleep 86400
done
