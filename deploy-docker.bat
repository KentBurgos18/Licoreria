@echo off
echo ========================================
echo   Subiendo Imagen al Contenedor Local
echo ========================================
echo.

echo [1/4] Verificando Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker no está instalado o no está en ejecución
    pause
    exit /b 1
)
echo ✅ Docker encontrado

echo.
echo [2/4] Deteniendo contenedores existentes...
docker stop licoreria-container >nul 2>&1
docker rm licoreria-container >nul 2>&1
echo ✅ Contenedores anteriores limpiados

echo.
echo [3/4] Construyendo imagen...
docker build -t licoreria-pos:latest .
if %errorlevel% neq 0 (
    echo ❌ Error al construir la imagen
    pause
    exit /b 1
)
echo ✅ Imagen construida

echo.
echo [4/4] Creando y ejecutando contenedor...
docker run -d ^
    --name licoreria-container ^
    -p 3000:3000 ^
    -e DB_HOST=localhost ^
    -e DB_PORT=5432 ^
    -e DB_NAME=licoreria ^
    -e DB_USER=licoreria_user ^
    -e DB_PASSWORD=licoreria_password ^
    -e NODE_ENV=production ^
    -e JWT_SECRET=tu_secreto_jwt_aqui ^
    -e DEFAULT_TENANT_ID=1 ^
    licoreria-pos:latest

if %errorlevel% neq 0 (
    echo ❌ Error al crear el contenedor
    pause
    exit /b 1
)

echo ✅ Contenedor creado y en ejecución
echo.
echo 📊 Información del Contenedor:
docker ps -f name=licoreria-container

echo.
echo 🌐 Acceso a la Aplicación:
echo POS: http://localhost:3000
echo API Health: http://localhost:3000/api/health
echo.
echo 📋 Comandos Útiles:
echo Ver logs: docker logs licoreria-container
echo Detener: docker stop licoreria-container
echo Reiniciar: docker restart licoreria-container
echo Eliminar: docker rm licoreria-container
echo.
pause