# Solución para Error de Docker Build

## Problema
Error: `failed to resolve source metadata for docker.io/library/node:18-alpine: lookup registry-1.docker.io: no such host`

## Soluciones

### Solución 1: Configurar DNS en Docker Desktop (Recomendado)

1. Abre **Docker Desktop**
2. Ve a **Settings** → **Docker Engine**
3. Agrega esta configuración:
```json
{
  "dns": ["8.8.8.8", "8.8.4.4", "1.1.1.1"]
}
```
4. Haz clic en **Apply & Restart**

### Solución 2: Usar el archivo docker-compose-fix.yml

Ya creé un archivo `docker-compose-fix.yml` con DNS configurado. Úsalo así:

```bash
docker compose -f docker-compose-fix.yml build
```

### Solución 3: Verificar conectividad de red

1. Verifica tu conexión a internet:
```powershell
ping google.com
```

2. Verifica que Docker Desktop esté corriendo:
```powershell
docker ps
```

3. Prueba conectividad a Docker Hub:
```powershell
curl https://registry-1.docker.io/v2/
```

### Solución 4: Usar un mirror de Docker Hub

Si tienes problemas de conectividad, puedes configurar un mirror. Edita el Dockerfile:

```dockerfile
FROM node:18-alpine
```

Y en Docker Desktop, configura un mirror en Settings → Docker Engine.

### Solución 5: Reinstalar Docker Desktop

Si nada funciona:
1. Desinstala Docker Desktop completamente
2. Reinicia tu computadora
3. Reinstala Docker Desktop desde docker.com
4. Reinicia nuevamente

### Solución 6: Usar VPN o cambiar DNS del sistema

Si estás en una red corporativa:
1. Cambia el DNS de Windows a 8.8.8.8 y 8.8.4.4
2. O usa una VPN
3. O contacta a tu administrador de red

## Comandos útiles

```bash
# Limpiar caché de Docker
docker system prune -a

# Verificar configuración de DNS
docker info | grep -i dns

# Probar descarga de imagen manualmente
docker pull node:18-alpine

# Build con más información de debug
docker compose build --progress=plain --no-cache
```
