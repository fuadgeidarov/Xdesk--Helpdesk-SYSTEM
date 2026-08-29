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
echo Testing Let's Encrypt STAGING validation for public IP %PUBLIC_HOST%...
docker compose run --rm certbot certonly --staging --preferred-profile shortlived --webroot --webroot-path /var/www/certbot --ip-address %PUBLIC_HOST% --cert-name %PUBLIC_HOST%-staging --agree-tos --register-unsafely-without-email
if errorlevel 1 (
  echo.
  echo Staging validation failed. Check that public TCP 80 reaches this server's TCP 80 and is not blocked by a firewall.
  exit /b 1
)
echo.
echo Staging validation succeeded. Run GET-HTTPS-CERT.cmd for the trusted certificate.
endlocal
