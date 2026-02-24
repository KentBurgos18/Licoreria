#!/bin/sh
set -e
# Esperar a que la base esté aceptando conexiones (útil si el healthcheck no basta)
echo ">>> Verificando conexión a la base de datos..."
until node -e "
const seq = require('./config/database');
seq.authenticate().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "    Base de datos no lista, reintentando en 3s..."
  sleep 3
done
echo ">>> Base de datos lista."

# Migraciones + seed + usuario admin (solo tiene efecto la primera vez)
echo ">>> Ejecutando migraciones y seed (primer despliegue)..."
node scripts/seed-first-deploy.js || true

echo ">>> Iniciando aplicación..."
exec npm start
