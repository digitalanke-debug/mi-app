# Despliegue en Hetzner Cloud

La app corre con Docker Compose en un servidor Ubuntu. Tres contenedores: PostgreSQL (datos),
la app (API + interfaz) y un respaldo nocturno. Opcionalmente Caddy para el HTTPS automático.

## Instalación

Funciona igual en un servidor nuevo o en uno que ya tiene otras aplicaciones (por ejemplo el CRM).
El instalador detecta si el sistema ya tiene **Caddy** atendiendo la web: si es así, le agrega el subdominio;
si no, levanta su propio Caddy con HTTPS automático.

1. En el DNS del dominio crea un registro **A** `admin.sygoabogados.com` apuntando a la IP del servidor.
2. Entra al servidor como root (SSH o la consola web de Hetzner) y ejecuta:

```bash
curl -fsSL https://raw.githubusercontent.com/digitalanke-debug/mi-app/main/deploy/install.sh -o install.sh
bash install.sh
```

   Para instalar desde otra rama: `BRANCH=nombre-de-la-rama bash install.sh`.

3. El instalador pregunta el dominio, el correo y la contraseña del primer administrador, genera los secretos,
   instala Docker si falta, construye la app y la arranca. En dos o tres minutos queda en `https://admin.sygoabogados.com`.

Si el servidor tiene otro proxy que no sea Caddy (nginx, Traefik), el instalador deja la app en `127.0.0.1:3000`
y hay que agregar el subdominio en ese proxy. Ejemplo para nginx:

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

Firewall: en Hetzner conviene crear un **Firewall** en el panel que permita solo los puertos 22, 80 y 443 y asignarlo al servidor.

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
| `JWT_SECRET` | Firma de las sesiones. Generado por `install.sh` |
| `POSTGRES_PASSWORD` | Contraseña de la base de datos. Generado por `install.sh` |

## Cómo funciona por dentro

- La interfaz envía **acciones** (crear cliente, pagar cuenta, registrar abono) al backend. El backend aplica la misma lógica que la interfaz (`src/store/reducer.js`), guarda el resultado en PostgreSQL y registra quién hizo qué en la tabla `actions_log`.
- Esa misma puerta de entrada es la que usará el agente de WhatsApp: enviará acciones idénticas a las de los botones.
- Roles: `admin` registra y modifica; `lectura` solo consulta.
