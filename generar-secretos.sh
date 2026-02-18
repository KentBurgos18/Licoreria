#!/bin/bash
# Script para generar secretos seguros para OAuth
# Ejecuta: chmod +x generar-secretos.sh && ./generar-secretos.sh

echo "========================================"
echo "  Generador de Secretos para LOCOBAR"
echo "========================================"
echo ""

# Generar JWT_SECRET
JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET generado:"
echo "$JWT_SECRET"
echo ""

# Generar SESSION_SECRET
SESSION_SECRET=$(openssl rand -base64 32)
echo "SESSION_SECRET generado:"
echo "$SESSION_SECRET"
echo ""

echo "========================================"
echo "Copia estos valores a tu archivo .env:"
echo "========================================"
echo ""
echo "JWT_SECRET=$JWT_SECRET"
echo "SESSION_SECRET=$SESSION_SECRET"
echo ""
