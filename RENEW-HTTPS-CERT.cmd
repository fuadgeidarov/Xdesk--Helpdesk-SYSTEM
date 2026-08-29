@echo off
setlocal
cd /d "%~dp0"
docker compose run --rm certbot renew --quiet
if errorlevel 1 exit /b 1
docker compose restart proxy >nul
endlocal
