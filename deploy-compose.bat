@echo off
echo ========================================
echo   Desplegando con Docker Compose
echo ========================================
echo.

echo [1/3] Verificando Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose no está instalado
    pause
    exit /b 1
)
echo ✅ Docker Compose encontrado

echo.
echo [2/3] Limpiando despliegues anteriores...
docker-compose down -v >nul 2>&1
docker system prune -f >nul 2>&1
echo ✅ Limpieza completada

echo.
echo [3/3] Iniciando servicios...
docker-compose up -d --build

if %errorlevel% neq 0 (
    echo ❌ Error al iniciar los servicios
    pause
    exit /b 1
)

echo ✅ Servicios iniciados exitosamente
echo.
echo 📊 Estado de los Servicios:
docker-compose ps

echo.
echo 🌐 Acceso a la Aplicación:
echo POS: http://localhost:3000
echo API Health: http://localhost:3000/api/health
echo PostgreSQL: localhost:5432
echo.
echo 📋 Comandos Útiles:
echo Ver logs: docker-compose logs -f
echo Detener: docker-compose down
echo Reiniciar: docker-compose restart
echo Ver estado: docker-compose ps
echo.
echo ⏳ Esperando que la aplicación esté lista...
timeout /t 10 /nobreak >nul

echo.
echo 🧪 Verificando salud de la aplicación...
curl -f http://localhost:3000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Aplicación lista y funcionando
) else (
    echo ⚠️  La aplicación está iniciando, espere unos momentos
)

echo.
pause