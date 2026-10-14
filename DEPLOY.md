# Despliegue en Hetzner Cloud

La app corre con Docker Compose en un servidor Ubuntu. Tres contenedores: PostgreSQL (datos),
la app (API + interfaz) y un respaldo nocturno. Opcionalmente Caddy para el HTTPS automático.

## Opción A: servidor nuevo solo para esta app (recomendado)

1. En Hetzner Cloud crea un servidor: Ubuntu 24.04, tipo CPX22 o similar, ubicación Ashburn (la más cercana a Colombia). Agrega tu llave SSH.
2. En el DNS del dominio crea un registro **A** `admin.sygoabogados.com` apuntando a la IP del servidor.
3. Entra al servidor y ejecuta:

```bash
curl -fsSL https://raw.githubusercontent.com/digitalanke-debug/mi-app/main/deploy/setup-server.sh -o setup-server.sh
bash setup-server.sh https://github.com/digitalanke-debug/mi-app.git
```

   Esto instala Docker, abre solo los puertos 22, 80 y 443 en el firewall, clona el proyecto en `/opt/sigo-admin` y genera los secretos en `.env`.

4. Edita `/opt/sigo-admin/.env`: pon `DOMAIN`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Deja `USE_CADDY=true`.
5. Arranca:

```bash
cd /opt/sigo-admin && bash deploy/deploy.sh
```

   En uno o dos minutos la app queda en `https://admin.sygoabogados.com` con certificado válido.
   Entra con el correo y la contraseña del paso 4 y cámbiala desde **Usuarios y bitácora**.

## Opción B: en el mismo servidor del CRM

Si el servidor ya tiene un proxy (nginx, Traefik, Caddy o el propio CRM) escuchando en los puertos 80 y 443,
no se puede levantar otro Caddy. En ese caso:

1. Pasos 3 y 4 de la opción A, pero en `.env` pon `USE_CADDY=false` y, si el puerto 3000 ya está ocupado, cambia `APP_PORT`.
2. `bash deploy/deploy.sh`. La app queda escuchando solo en `127.0.0.1:3000`.
3. En el proxy existente agrega el subdominio `admin.sygoabogados.com` reenviando a `http://127.0.0.1:3000`. Ejemplo para nginx:

```nginx
server {
    server_name admin.sygoabogados.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

   y genera el certificado con `certbot --nginx -d admin.sygoabogados.com`.

## Actualizar la app

Cada vez que haya cambios en el repositorio:

```bash
cd /opt/sigo-admin && bash deploy/deploy.sh
```

## Respaldos

- El contenedor `backup` hace un `pg_dump` comprimido cada 24 horas en `/opt/sigo-admin/backups/` y conserva los últimos 30.
- Activa además los **Backups** o **Snapshots** del servidor en el panel de Hetzner (copia completa de la máquina).
- Para guardar los respaldos fuera del servidor, sincroniza la carpeta `backups/` a un Hetzner Object Storage o Storage Box con `rclone` en un cron.
- Desde la app, en **Caja → Configuración**, cualquier administrador puede descargar una copia en JSON y restaurarla.

Restaurar un respaldo SQL:

```bash
cd /opt/sigo-admin
gunzip -c backups/sigo-AAAAMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U sigo sigo
```

## Variables de entorno

| Variable | Para qué |
|---|---|
| `DOMAIN` | Dominio de la app (Caddy pide el certificado para este nombre) |
| `USE_CADDY` | `true` para que Caddy maneje HTTPS; `false` si hay otro proxy |
| `APP_PORT` | Puerto local donde escucha la app (por defecto 3000) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Primer usuario administrador; solo se usan al crear la base de datos |
| `JWT_SECRET` | Firma de las sesiones. Generado por `setup-server.sh` |
| `POSTGRES_PASSWORD` | Contraseña de la base de datos. Generado por `setup-server.sh` |

## Cómo funciona por dentro

- La interfaz envía **acciones** (crear cliente, pagar cuenta, registrar abono) al backend. El backend aplica la misma lógica que la interfaz (`src/store/reducer.js`), guarda el resultado en PostgreSQL y registra quién hizo qué en la tabla `actions_log`.
- Esa misma puerta de entrada es la que usará el agente de WhatsApp: enviará acciones idénticas a las de los botones.
- Roles: `admin` registra y modifica; `lectura` solo consulta.
