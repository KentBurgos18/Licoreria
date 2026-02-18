@echo off
echo ========================================
echo   Iniciando Sistema de Licorería POS
echo ========================================
echo.

echo [1/4] Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js no está instalado
    echo Por favor instale Node.js desde https://nodejs.org
    pause
    exit /b 1
)
echo ✅ Node.js encontrado

echo.
echo [2/4] Verificando PostgreSQL...
psql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PostgreSQL no está instalado
    echo Por favor instale PostgreSQL desde https://postgresql.org
    pause
    exit /b 1
)
echo ✅ PostgreSQL encontrado

echo.
echo [3/4] Instalando dependencias...
npm install
if %errorlevel% neq 0 (
    echo ❌ Error al instalar dependencias
    pause
    exit /b 1
)
echo ✅ Dependencias instaladas

echo.
echo [4/4] Iniciando servidor...
echo.
echo 🚀 El servidor se está iniciando...
echo 📊 POS estará disponible en: http://localhost:3000
echo 🛠️  API Health Check: http://localhost:3000/api/health
echo.
echo Presione Ctrl+C para detener el servidor
echo.

npm start