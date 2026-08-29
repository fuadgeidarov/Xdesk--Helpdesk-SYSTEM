@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PUBLIC_HOST="
for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"PUBLIC_HOST=" .env 2^>nul') do set "PUBLIC_HOST=%%B"
if not defined PUBLIC_HOST (
  echo PUBLIC_HOST is not set in .env.
  exit /b 1
)
if /I "%PUBLIC_HOST%"=="localhost" (
  echo Set PUBLIC_HOST in .env to your public IPv4 address before requesting a certificate.
  exit /b 1
)
echo Requesting trusted Let's Encrypt IP certificate for %PUBLIC_HOST%...
docker compose run --rm certbot certonly --preferred-profile shortlived --webroot --webroot-path /var/www/certbot --ip-address %PUBLIC_HOST% --cert-name %PUBLIC_HOST% --agree-tos --register-unsafely-without-email
if errorlevel 1 (
  echo.
  echo Certificate request failed. Check public TCP 80 forwarding and the server firewall.
  exit /b 1
)
echo Restarting HTTPS proxy...
docker compose restart proxy
docker compose ps
echo.
echo Open https://%PUBLIC_HOST%
endlocal
