# Configuración de OAuth para LOCOBAR

Este documento explica cómo configurar la autenticación OAuth con Google, Microsoft y Apple.

## Variables de Entorno Requeridas

Agrega las siguientes variables a tu archivo `.env`:

```env
# Base URL (importante para callbacks)
BASE_URL=http://localhost:3000

# Session secret (para OAuth)
SESSION_SECRET=tu-clave-secreta-de-sesion
```

---

## 1. Google OAuth

### Pasos para configurar:

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un nuevo proyecto o selecciona uno existente
3. Ve a **APIs y servicios > Credenciales**
4. Clic en **Crear credenciales > ID de cliente OAuth**
5. Selecciona **Aplicación web**
6. Configura:
   - **Nombre**: LOCOBAR
   - **URIs de redirección autorizados**: `http://localhost:3000/api/auth/google/callback`
7. Copia el **Client ID** y **Client Secret**

### Variables de entorno:
```env
GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu-client-secret
```

---

## 2. Microsoft OAuth

### Pasos para configurar:

1. Ve a [Azure Portal](https://portal.azure.com)
2. Busca **Azure Active Directory > Registros de aplicaciones**
3. Clic en **Nuevo registro**
4. Configura:
   - **Nombre**: LOCOBAR
   - **Tipos de cuenta**: Cuentas en cualquier directorio organizativo y cuentas Microsoft personales
   - **URI de redirección**: `http://localhost:3000/api/auth/microsoft/callback` (Web)
5. En la aplicación creada:
   - Copia el **Application (client) ID**
   - Ve a **Certificados y secretos > Nuevo secreto de cliente**
   - Copia el **Value** del secreto

### Variables de entorno:
```env
MICROSOFT_CLIENT_ID=tu-application-id
MICROSOFT_CLIENT_SECRET=tu-client-secret-value
```

---

## 3. Apple OAuth

### Requisitos:
- Cuenta de Apple Developer ($99/año)

### Pasos para configurar:

1. Ve a [Apple Developer](https://developer.apple.com/account)
2. Ve a **Certificates, Identifiers & Profiles**
3. Crea un **App ID** con "Sign In with Apple" habilitado
4. Crea un **Service ID**:
   - Habilita "Sign In with Apple"
   - Configura el dominio y URL de retorno: `http://localhost:3000/api/auth/apple/callback`
5. Crea una **Key** para Sign In with Apple
6. Descarga la key (.p8)

### Variables de entorno:
```env
APPLE_CLIENT_ID=tu-service-id
APPLE_TEAM_ID=tu-team-id
APPLE_KEY_ID=tu-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\ncontenido-de-tu-key-p8\n-----END PRIVATE KEY-----"
```

---

## Notas Importantes

### Para producción:
- Cambia `BASE_URL` a tu dominio real (ej: `https://locobar.com`)
- Actualiza las URIs de callback en cada proveedor OAuth
- Usa HTTPS obligatoriamente

### Comportamiento:
- Si un proveedor no está configurado, su botón aparecerá deshabilitado
- Si ningún proveedor está configurado, la sección OAuth se ocultará automáticamente
- Los usuarios que se registren con OAuth no necesitan contraseña
- Si el email ya existe, se vinculará la cuenta OAuth existente

### Endpoints OAuth:
- Google: `GET /api/auth/google`
- Microsoft: `GET /api/auth/microsoft`
- Apple: `GET /api/auth/apple`
- Verificar proveedores: `GET /api/auth/oauth/providers`

---

## Solución de Problemas

### "OAuth not configured"
- Verifica que las variables de entorno estén correctamente configuradas
- Reinicia la aplicación después de agregar las variables

### "Redirect URI mismatch"
- Asegúrate de que la URI de callback coincida exactamente con la configurada en el proveedor
- Verifica que `BASE_URL` esté configurado correctamente

### "Invalid client"
- Verifica que el Client ID y Client Secret sean correctos
- Asegúrate de que la aplicación OAuth esté activa/publicada
