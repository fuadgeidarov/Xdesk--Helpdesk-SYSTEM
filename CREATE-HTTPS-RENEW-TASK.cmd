@echo off
setlocal
set TASK_NAME=Xdesk HTTPS Certificate Renewal
set SCRIPT=%~dp0RENEW-HTTPS-CERT.cmd
schtasks /Create /F /SC DAILY /ST 03:00 /TN "%TASK_NAME%" /TR "\"%SCRIPT%\"" /RL HIGHEST
if errorlevel 1 (
  echo Failed to create Task Scheduler job. Run this CMD as Administrator.
  exit /b 1
)
echo Task "%TASK_NAME%" created. It will run daily at 03:00.
endlocal
