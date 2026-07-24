@echo off
REM DataMover Windows Service installer — requires NSSM in nssm\ and node.exe in runtime\
REM Run as Administrator

setlocal

set SERVICE_NAME=DataMover
set BASE_DIR=%~dp0
set NODE_EXE=%BASE_DIR%runtime\node.exe
set SERVER_JS=%BASE_DIR%app\server.js
set NSSM_EXE=%BASE_DIR%nssm\nssm.exe
set LOG_DIR=%BASE_DIR%logs

REM TODO: Set service account — replace DOMAIN\srv_datamover with actual account
set SERVICE_ACCOUNT=DOMAIN\srv_datamover
set SERVICE_PASSWORD=

echo Installing %SERVICE_NAME% service...

"%NSSM_EXE%" install %SERVICE_NAME% "%NODE_EXE%" "%SERVER_JS%"
"%NSSM_EXE%" set %SERVICE_NAME% AppDirectory "%BASE_DIR%"
"%NSSM_EXE%" set %SERVICE_NAME% DisplayName "DataMover MFT"
"%NSSM_EXE%" set %SERVICE_NAME% Description "Managed File Transfer — replaces GlobalScape EFT"
"%NSSM_EXE%" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%NSSM_EXE%" set %SERVICE_NAME% ObjectName "%SERVICE_ACCOUNT%" "%SERVICE_PASSWORD%"
"%NSSM_EXE%" set %SERVICE_NAME% AppRestartDelay 5000
"%NSSM_EXE%" set %SERVICE_NAME% AppStdout "%LOG_DIR%\service-stdout.log"
"%NSSM_EXE%" set %SERVICE_NAME% AppStderr "%LOG_DIR%\service-stderr.log"

echo Done. Start with: net start %SERVICE_NAME%
endlocal
