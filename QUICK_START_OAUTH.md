# 🚀 Inicio Rápido - Configuración OAuth

## Configuración Rápida de Google OAuth (5 minutos)

### 1. Obtener Credenciales de Google

1. Ve a: https://console.cloud.google.com
2. Crea un proyecto nuevo o selecciona uno existente
3. Ve a **APIs y servicios > Credenciales**
4. Clic en **+ CREAR CREDENCIALES > ID de cliente OAuth**
5. Tipo: **Aplicación web**
6. **URIs de redirección autorizados**: 
   ```
   http://localhost:3000/api/auth/google/callback
   ```
7. Copia el **Client ID** y **Client Secret**

### 2. Configurar Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con:

```env
# Base URL
BASE_URL=http://localhost:3000

# Secretos (genera con: .\generar-secretos.ps1)
JWT_SECRET=tu-secreto-jwt-aqui
SESSION_SECRET=tu-secreto-sesion-aqui

# Google OAuth
GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu-client-secret
```

### 3. Generar Secretos Seguros

**Windows (PowerShell):**
```powershell
.\generar-secretos.ps1
```

**Linux/Mac:**
```bash
chmod +x generar-secretos.sh
./generar-secretos.sh
```

### 4. Reiniciar Contenedores

```bash
docker-compose down
docker-compose up -d --build
```

### 5. Verificar

1. Abre: http://localhost:3000/customer/register
2. Deberías ver el botón "Continuar con Google"
3. Haz clic y prueba la autenticación

---

## ✅ Verificación Rápida

Verifica que OAuth esté configurado:
```bash
curl http://localhost:3000/api/auth/oauth/providers
```

Deberías ver:
```json
{
  "google": true
}
```

---

## 📖 Guía Completa

Para más detalles, consulta: **CONFIGURAR_OAUTH.md**

---

## ❌ Problemas Comunes

**"OAuth not configured"**
- Verifica que las variables estén en `.env`
- Reinicia los contenedores

**"Redirect URI mismatch"**
- Verifica que la URI en Google Console sea exactamente: `http://localhost:3000/api/auth/google/callback`
- Verifica que `BASE_URL` sea `http://localhost:3000`
