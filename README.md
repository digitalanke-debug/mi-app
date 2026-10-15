# S&Go Abogados · Administración

Aplicación web para la gestión administrativa del bufete: facturación a clientes,
cuentas por pagar con prioridad automática, control de caja y recordatorios de cobro.

## Módulos

- **Panel**: saldo en cuenta, cartera por cobrar, pagos prioritarios, proyección a 30 días y antigüedad de cartera.
- **Clientes y facturación**: clientes, cuentas de cobro con honorarios y gastos reembolsables, abonos parciales, estado automático.
- **Cuentas por pagar**: gastos puntuales y gastos fijos mensuales (se generan solos), prioridad calculada, calculadora de pagos contra el saldo.
- **Caja y cuentas**: varias cuentas (bancos, caja menor, préstamos) con saldo por cuenta y consolidado, traslados, abonos a préstamos, movimientos automáticos por cobros y pagos, ajustes, respaldo y restauración.
- **Recordatorios**: lista de quién está vencido o vence pronto, mensaje prellenado para WhatsApp o correo, envío automático desde el número de la firma, historial.
- **Asistente WhatsApp**: la administración consulta y registra todo por WhatsApp, con texto, notas de voz, fotos o PDF. Ver [WHATSAPP.md](WHATSAPP.md).
- **Usuarios y bitácora**: usuarios con rol, y registro de quién cambió qué.

## Cómo correrla

```bash
npm install
npm run dev
```

Abre la dirección que muestra la consola. Para generar la versión de producción: `npm run build` (queda en `dist/`).

## Dónde se guardan los datos

Dos modos, elegidos en `src/store/useStore.js`:

- **Local** (por defecto al correr `npm run dev`): todo en el navegador. Útil para probar sin servidor.
- **Servidor** (producción): el backend en `server/` guarda los datos en PostgreSQL, maneja usuarios con
  contraseña y roles, y registra una bitácora de cambios. Para probarlo en desarrollo:
  `DATABASE_URL=... JWT_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run server` y en otra terminal
  `VITE_STORAGE=api npm run dev`.

Desde **Caja → Configuración** se puede descargar y restaurar un respaldo en JSON en ambos modos.

## Producción

Ver [DEPLOY.md](DEPLOY.md): Docker Compose con PostgreSQL, respaldo nocturno y HTTPS automático, pensado para Hetzner Cloud.

## Regla de prioridad de pagos

Prioridad **alta** si la cuenta ya venció o vence en 7 días o menos, si genera intereses de mora,
o si cortan el servicio y vence en 15 días o menos. **Media** si vence en 20 días o menos. **Baja** el resto.
La prioridad se puede forzar manualmente en cada cuenta. La regla vive en `src/lib/priority.js`.

## Estructura

```
src/
  lib/        formato COP y fechas, prioridad, cálculos de facturas, CSV
  store/      estado global (reducer), persistencia local, cliente de la API, datos de ejemplo
  components/ componentes de interfaz reutilizables
  pages/      Panel, Clientes, CuentasPorPagar, Caja, Recordatorios, Usuarios, Login
server/       API en Node + Express: autenticación, usuarios, estado y bitácora en PostgreSQL,
              integración con Evolution API (WhatsApp) y asistente con Claude
deploy/       Caddyfile, respaldo, scripts de instalación y despliegue
```

## Siguientes fases

1. Importar los datos actuales desde Excel.
2. Facturación electrónica DIAN a través de un proveedor tecnológico autorizado.
3. Recordatorios automáticos programados (sin intervención) y resumen diario por WhatsApp.
