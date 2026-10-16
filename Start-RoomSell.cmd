@echo off
setlocal
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Start Docker Desktop with Linux containers, then open this file again.
  pause
  exit /b 1
)
echo Preparing RoomSell and the fictional Boreal Living customer.
echo Docker Desktop: enable Settings - Resources - Network - Enable host networking.
echo Wait for READY, then open http://localhost:3000/testing in your browser.
echo Keep this window open while testing. Ctrl+C stops the app and keeps your data.
docker compose up --build
if errorlevel 1 (
  echo Startup did not complete. Keep the error above for troubleshooting.
  pause
  exit /b 1
)
