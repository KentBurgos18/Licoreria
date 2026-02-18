# Configuración PayPhone - Cajita de Pagos

Integración de pago con tarjeta mediante PayPhone (Cajita de Pagos). El cliente paga en la misma página sin redirección.

## Requisitos

1. **Cuenta PayPhone Business** en [payphone.app/business](https://payphone.app/business)
2. **Usuario con rol Developer** en tu cuenta PayPhone
3. **Credenciales** generadas en el panel de desarrollador de PayPhone

## Pasos

### 1. Obtener credenciales en PayPhone

1. Inicia sesión en [PayPhone Developer](https://payphone.app) con tu usuario Developer
2. Crea una nueva configuración de aplicación (tipo **WEB**)
3. Configura el **dominio**:
   - **Desarrollo:** `http://localhost:3000`
   - **Producción:** `https://tu-dominio.com` (debe tener certificado SSL)
4. Configura la **URL de respuesta** (donde PayPhone redirige tras el pago):
   - `http://localhost:3000/customer/checkout/resultado` (desarrollo)
   - `https://tu-dominio.com/customer/checkout/resultado` (producción)
5. Copia el **TOKEN** y el **STORE_ID**

### 2. Variables de entorno

Edita tu archivo `.env` y añade:

```
PAYPHONE_TOKEN=tu_token_aqui
PAYPHONE_STORE_ID=tu_store_id_aqui
```

### 3. Migración de base de datos

Ejecuta la migración para crear la tabla de pagos pendientes:

```bash
psql -U licoreria_user -d licoreria -f database/migrations/015_create_payphone_pending_payments.sql
```

O conéctate a PostgreSQL y ejecuta manualmente el SQL del archivo.

### 4. Reiniciar la aplicación

Tras configurar las variables de entorno, reinicia el servidor.

## Flujo de pago

1. El cliente selecciona **Tarjeta** como método de pago
2. Click en **Confirmar Pedido**
3. Se abre un modal con el formulario de pago PayPhone
4. El cliente ingresa los datos de su tarjeta y paga
5. PayPhone redirige a `/customer/checkout/resultado`
6. El sistema confirma el pago con la API de PayPhone y registra la venta

## Importante

- **Dominio:** La Cajita solo funciona en el dominio configurado en PayPhone
- **Confirmación:** Debes confirmar el pago en menos de **5 minutos** o PayPhone revierte la transacción
- **Expiración:** Cada formulario de pago tiene validez de **10 minutos**
- **Producción:** Requiere HTTPS con certificado SSL válido

## Tarjetas de prueba

Para pruebas, usa las tarjetas de test proporcionadas por PayPhone en su documentación.
