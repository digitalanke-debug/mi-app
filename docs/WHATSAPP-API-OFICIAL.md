# Conectar un número de la API oficial de WhatsApp (Meta Cloud API)

Úsalo cuando el número está registrado en Meta (por ejemplo, el que venía de Kommo) y no en la app WhatsApp Business de un celular.

## Lo que necesitas de Meta

1. El número debe estar en **tu propia** cuenta de WhatsApp Business (WABA) en https://business.facebook.com. Si lo administraba Kommo, desconecta primero la integración en Kommo para que no reciba los mismos mensajes.
2. En https://developers.facebook.com crea una app tipo **Business**, agrega el producto **WhatsApp** y vincula tu WABA.
3. En Meta Business → Configuración → **Usuarios del sistema**, crea un usuario del sistema administrador, asígnale la app y la WABA, y genera un **token permanente** con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Anota: **Phone Number ID** y **WhatsApp Business Account ID** (en la app → WhatsApp → Configuración de la API) y el **App secret** (app → Configuración → Básica).

## En el CRM

1. WhatsApp → **Número de la API oficial** → pega los datos → **Guardar y verificar**.
2. El mismo formulario muestra la **URL de devolución** y el **token de verificación**. Pégalos en la app de Meta → WhatsApp → Configuración → Webhook, y suscribe el campo **messages**.
3. Escribe al número desde otro celular: el mensaje debe aparecer en la bandeja.

## Reglas de WhatsApp que aplica el CRM

- Ventana de 24 horas: después de 24 horas sin mensaje del cliente, solo se puede escribir con una **plantilla aprobada**. El chat lo avisa y ofrece el botón **Enviar plantilla**.
- Las plantillas se crean y aprueban en Meta Business → Administrador de WhatsApp → Plantillas. El CRM lista solo las aprobadas y rellena las variables `{{1}}`, `{{2}}`.
- Los mensajes muestran el estado que reporta Meta: enviado, entregado, leído o fallido con el motivo.
- Costos: Meta cobra por las conversaciones que inicia la empresa con plantilla; las respuestas dentro de la ventana de 24 horas a un cliente que escribió primero no tienen costo de plantilla.
