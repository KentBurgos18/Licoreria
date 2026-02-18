@echo off
echo ========================================
echo   Cargando Datos de Prueba
echo ========================================
echo.

echo [1/2] Verificando conexión a PostgreSQL...
psql -U licoreria_user -d licoreria -c "SELECT 1;" >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ No se puede conectar a la base de datos
    echo Verifique que PostgreSQL esté corriendo y que el usuario licoreria_user exista
    pause
    exit /b 1
)
echo ✅ Conexión a PostgreSQL exitosa

echo.
echo [2/2] Cargando datos de prueba...
psql -U licoreria_user -d licoreria -f "database\seed.sql"
if %errorlevel% neq 0 (
    echo ❌ Error al cargar datos de prueba
    pause
    exit /b 1
)

echo.
echo ✅ Datos de prueba cargados exitosamente
echo.
echo Productos creados:
echo - 7 productos simples
echo - 3 combos virtuales
echo - Movimientos de inventario iniciales
echo - 1 cliente de prueba
echo.
echo Ahora puede iniciar el servidor con start.bat
echo.
pause