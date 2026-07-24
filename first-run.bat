@echo off
cd /d "%~dp0"
set PATH=%~dp0runtime;%PATH%

IF EXIST "certs\server.crt" (
  echo DataMover first run ^(HTTPS^) - open browser to https://localhost:3000 - Ctrl+C to stop
) ELSE (
  echo DataMover first run ^(HTTP^) - open browser to http://localhost:3000 - Ctrl+C to stop
  echo   ^(Place certs\server.crt and certs\server.key to enable HTTPS^)
)
echo.
node app\server.js
