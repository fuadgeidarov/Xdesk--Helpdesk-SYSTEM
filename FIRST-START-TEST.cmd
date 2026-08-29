@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Xdesk disposable TEST first start.
echo WARNING: this DELETES existing Xdesk DB and uploads volumes.
echo ============================================================
echo.
echo Before continuing, .env must contain:
echo   SEED_DEFAULT_USERS=auto
echo   SEED_USER_PASSWORD=...
echo   SEED_AGENT_PASSWORD=...
echo   SEED_ADMIN_PASSWORD=...
echo.
choice /C YN /N /M "Delete Xdesk database/uploads volumes and create a clean test database? [Y/N]: "
if errorlevel 2 exit /b 1

docker compose down -v --remove-orphans
if errorlevel 1 goto :fail

docker compose up -d --build
if errorlevel 1 goto :fail

echo.
echo Waiting for containers to initialize...
timeout /t 20 /nobreak >nul

docker compose ps
echo.
echo After testing, set SEED_DEFAULT_USERS=false and recreate app.
echo Open http://localhost for a local bootstrap installation.
exit /b 0

:fail
echo.
echo Xdesk first start failed. Run: docker compose logs --tail=200 app
exit /b 1
