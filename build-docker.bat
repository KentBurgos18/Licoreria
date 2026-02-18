@echo off
echo ========================================
echo   Construyendo Imagen Docker
echo ========================================
echo.

echo [1/3] Verificando Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker no está instalado o no está en ejecución
    echo Por favor instale Docker Desktop desde https://docker.com
    pause
    exit /b 1
)
echo ✅ Docker encontrado

echo.
echo [2/3] Construyendo imagen...
docker build -t licoreria-pos:latest .
if %errorlevel% neq 0 (
    echo ❌ Error al construir la imagen Docker
    pause
    exit /b 1
)
echo ✅ Imagen construida exitosamente

echo.
echo [3/3] Verificando imagen...
docker images licoreria-pos
echo.

echo ✅ Imagen Docker lista para usar
echo.
echo Para ejecutar con docker-compose:
echo docker-compose up -d
echo.
echo Para ejecutar individualmente:
echo docker run -d -p 3000:3000 --name licoreria-container licoreria-pos:latest
echo.
pause