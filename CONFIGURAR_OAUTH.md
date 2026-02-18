# 🔐 Guía de Configuración de OAuth - LOCOBAR

Esta guía te ayudará a configurar la autenticación OAuth paso a paso.

## 📋 Índice
1. [Google OAuth (Recomendado)](#1-google-oauth)
2. [Microsoft OAuth](#2-microsoft-oauth)
3. [Verificación](#3-verificación)
4. [Solución de Problemas](#4-solución-de-problemas)

---

## 1. Google OAuth

### Paso 1: Crear Proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Inicia sesión con tu cuenta de Google
3. Clic en el selector de proyectos (arriba) → **Nuevo Proyecto**
4. Ingresa:
   - **Nombre del proyecto**: `LOCOBAR` (o el que prefieras)
   - **Organización**: (opcional)
5. Clic en **Crear**

### Paso 2: Habilitar Google+ API

1. En el menú lateral, ve a **APIs y servicios > Biblioteca**
2. Busca "Google+ API" o "People API"
3. Clic en **Habilitar**

### Paso 3: Configurar Pantalla de Consentimiento OAuth

1. Ve a **APIs y servicios > Pantalla de consentimiento OAuth**
2. Selecciona **Externo** (o Interno si tienes Google Workspace)
3. Clic en **Crear**
4. Completa el formulario:
   - **Nombre de la aplicación**: `LOCOBAR`
   - **Correo electrónico de soporte**: Tu email
   - **Logo**: (opcional)
   - **Dominio autorizado**: `localhost` (para desarrollo)
   - **Email del desarrollador**: Tu email
5. Clic en **Guardar y continuar**
6. En **Scopes**, deja los predeterminados y haz clic en **Guardar y continuar**
7. En **Usuarios de prueba**, agrega tu email si es necesario
8. Clic en **Guardar y continuar** → **Volver al panel**

### Paso 4: Crear Credenciales OAuth

1. Ve a **APIs y servicios > Credenciales**
2. Clic en **+ CREAR CREDENCIALES** → **ID de cliente OAuth**
3. Selecciona **Aplicación web**
4. Configura:
   - **Nombre**: `LOCOBAR Web Client`
   - **URIs de redirección autorizados**: 
     - Para desarrollo: `http://localhost:3000/api/auth/google/callback`
     - Para producción: `https://tudominio.com/api/auth/google/callback`
5. Clic en **Crear**

### Paso 5: Copiar Credenciales

Después de crear, verás:
- **ID de cliente**: `123456789-abc...apps.googleusercontent.com`
- **Secreto de cliente**: `GOCSPX-abc...`

⚠️ **IMPORTANTE**: Guarda el secreto de cliente, solo se muestra una vez.

### Paso 6: Configurar Variables de Entorno

#### Opción A: Usando archivo .env (Recomendado para desarrollo local)

Crea o edita el archivo `.env` en la raíz del proyecto:

```env
# Base URL (importante para callbacks)
BASE_URL=http://localhost:3000

# Session secret (genera uno aleatorio)
SESSION_SECRET=tu-clave-secreta-aleatoria-aqui-cambiar-en-produccion

# Google OAuth
GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu-client-secret

# JWT Secret (si no está configurado)
JWT_SECRET=tu-secreto-jwt-seguro-aqui
```

#### Opción B: Usando Docker Compose (Recomendado para producción)

Edita `docker-compose.yml` y agrega las variables en la sección `environment`:

```yaml
environment:
  # ... otras variables ...
  BASE_URL: http://localhost:3000
  SESSION_SECRET: tu-clave-secreta-aleatoria
  GOOGLE_CLIENT_ID: tu-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET: tu-client-secret
```

O mejor aún, usa un archivo `.env` y referencia las variables:

```yaml
environment:
  GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
  GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
  BASE_URL: ${BASE_URL:-http://localhost:3000}
  SESSION_SECRET: ${SESSION_SECRET}
```

### Paso 7: Reiniciar la Aplicación

```bash
# Si usas Docker
docker-compose down
docker-compose up -d --build

# Si usas Node.js directamente
npm restart
```

### Paso 8: Verificar Configuración

1. Abre tu navegador en: `http://localhost:3000/customer/register`
2. Deberías ver el botón "Continuar con Google"
3. Haz clic y debería redirigirte a Google para autenticarte

---

## 2. Microsoft OAuth

### Paso 1: Registrar Aplicación en Azure

1. Ve a [Azure Portal](https://portal.azure.com)
2. Busca **Azure Active Directory**
3. Ve a **Registros de aplicaciones** → **Nuevo registro**
4. Configura:
   - **Nombre**: `LOCOBAR`
   - **Tipos de cuenta**: Cuentas en cualquier directorio organizativo y cuentas Microsoft personales
   - **URI de redirección**: 
     - Tipo: Web
     - URL: `http://localhost:3000/api/auth/microsoft/callback`
5. Clic en **Registrar**

### Paso 2: Obtener Credenciales

1. En la página de la aplicación, copia el **Application (client) ID**
2. Ve a **Certificados y secretos** → **Nuevo secreto de cliente**
3. Configura:
   - **Descripción**: `LOCOBAR Secret`
   - **Expira**: (elige una fecha)
4. Clic en **Agregar**
5. **Copia el Value del secreto** (solo se muestra una vez)

### Paso 3: Configurar Variables

Agrega a tu `.env` o `docker-compose.yml`:

```env
MICROSOFT_CLIENT_ID=tu-application-id
MICROSOFT_CLIENT_SECRET=tu-client-secret-value
```

---

## 3. Verificación

### Verificar Proveedores Configurados

Haz una petición GET a:
```
http://localhost:3000/api/auth/oauth/providers
```

Deberías recibir:
```json
{
  "google": true,
  "microsoft": false,
  "apple": false
}
```

### Probar OAuth

1. Ve a `http://localhost:3000/customer/register`
2. Deberías ver los botones de OAuth habilitados
3. Haz clic en "Continuar con Google"
4. Deberías ser redirigido a Google para autenticarte
5. Después de autenticarte, serás redirigido de vuelta a la aplicación

---

## 4. Solución de Problemas

### ❌ "Google OAuth not configured"

**Causa**: Las variables de entorno no están configuradas o la aplicación no se reinició.

**Solución**:
1. Verifica que `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` estén en `.env` o `docker-compose.yml`
2. Reinicia la aplicación
3. Verifica los logs: `docker-compose logs app`

### ❌ "Redirect URI mismatch"

**Causa**: La URI de callback no coincide con la configurada en Google Cloud Console.

**Solución**:
1. Ve a Google Cloud Console → Credenciales
2. Verifica que la URI sea exactamente: `http://localhost:3000/api/auth/google/callback`
3. Asegúrate de que `BASE_URL` en tu `.env` sea `http://localhost:3000`

### ❌ "Invalid client"

**Causa**: El Client ID o Client Secret son incorrectos.

**Solución**:
1. Verifica que copiaste correctamente las credenciales
2. Asegúrate de que no haya espacios extra
3. Verifica que la aplicación OAuth esté activa en Google Cloud Console

### ❌ Botón de OAuth no aparece

**Causa**: El proveedor no está configurado o hay un error en el frontend.

**Solución**:
1. Verifica `/api/auth/oauth/providers` para ver qué proveedores están disponibles
2. Revisa la consola del navegador para errores
3. Verifica que el script de verificación OAuth esté funcionando

### ❌ Error después de autenticarse

**Causa**: Problema con la base de datos o el callback.

**Solución**:
1. Verifica los logs: `docker-compose logs app`
2. Asegúrate de que la tabla `customers` tenga las columnas `oauth_provider` y `oauth_id`
3. Verifica que la migración OAuth se haya ejecutado

---

## 🔒 Seguridad en Producción

### Checklist antes de producción:

- [ ] Cambiar `BASE_URL` a tu dominio real (ej: `https://locobar.com`)
- [ ] Actualizar URIs de callback en Google Cloud Console
- [ ] Usar HTTPS obligatoriamente
- [ ] Cambiar `SESSION_SECRET` y `JWT_SECRET` por valores seguros aleatorios
- [ ] Configurar dominio autorizado en Google Cloud Console
- [ ] Revisar permisos de la aplicación OAuth
- [ ] Configurar límites de rate limiting si es necesario

### Generar Secretos Seguros

```bash
# En Linux/Mac
openssl rand -base64 32

# En PowerShell (Windows)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs: `docker-compose logs app`
2. Verifica la configuración en Google Cloud Console
3. Asegúrate de que todas las variables de entorno estén correctas
4. Reinicia la aplicación después de cambiar variables de entorno

---

## ✅ Listo!

Una vez configurado, los usuarios podrán:
- Registrarse con Google OAuth
- Iniciar sesión con Google OAuth
- Vincular su cuenta existente con OAuth

¡Disfruta de la autenticación OAuth! 🎉
