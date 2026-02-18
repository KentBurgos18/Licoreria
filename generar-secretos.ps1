# Script para generar secretos seguros para OAuth
# Ejecuta: .\generar-secretos.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Generador de Secretos para LOCOBAR" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Generar JWT_SECRET
$jwtSecret = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
Write-Host "JWT_SECRET generado:" -ForegroundColor Green
Write-Host $jwtSecret -ForegroundColor Yellow
Write-Host ""

# Generar SESSION_SECRET
$sessionSecret = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
Write-Host "SESSION_SECRET generado:" -ForegroundColor Green
Write-Host $sessionSecret -ForegroundColor Yellow
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Copia estos valores a tu archivo .env:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "JWT_SECRET=$jwtSecret" -ForegroundColor White
Write-Host "SESSION_SECRET=$sessionSecret" -ForegroundColor White
Write-Host ""
Write-Host "Presiona cualquier tecla para continuar..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
