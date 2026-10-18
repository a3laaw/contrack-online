@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack - Shared Database Setup

echo ======================================================
echo   ConTrack - One Shared Database on LAN
echo ======================================================
echo.
echo IMPORTANT:
echo - Use a UNC path, example: \\SERVER\ConTrackData
echo - Do not use a mapped drive letter like Z:\ConTrackData
echo - On the HOST PC itself you may use its local path like C:\ConTrackData
echo - All users need Read/Write/Create/Delete permission.
echo - Put the shared DATA folder here, not the program folder.
echo.
set /p SHARE=Enter shared database folder path: 
if "%SHARE%"=="" (
    echo Cancelled.
    pause
    exit /b 1
)

set "PYEXE_CMD="
set "PYEXE_ARG="
if exist ".venv\Scripts\python.exe" set "PYEXE_CMD=%~dp0.venv\Scripts\python.exe"
if not defined PYEXE_CMD where py >nul 2>nul && set "PYEXE_CMD=py" && set "PYEXE_ARG=-3"
if not defined PYEXE_CMD where python >nul 2>nul && set "PYEXE_CMD=python"
if not defined PYEXE_CMD (
    echo [ERROR] Python was not found. Run INSTALL.bat first.
    pause
    exit /b 1
)

set "CONTRACK_SHARE=%SHARE%"
"%PYEXE_CMD%" %PYEXE_ARG% -c "import os, sys, pprint; sys.path.insert(0, os.getcwd()); from services.network_single_db_service import configure_shared_database, health_check; folder=os.environ['CONTRACK_SHARE']; print('Testing folder:', folder); pprint.pp(health_check(folder)); print('Configuring...'); pprint.pp(configure_shared_database(folder))"
if errorlevel 1 (
    echo.
    echo [FAILED] Shared database was not configured.
    echo Check the folder path and Windows sharing/security permissions.
    echo Tip: use UNC path like \\SERVER\ConTrackData and give Modify permission.
    pause
    exit /b 1
)

echo.
echo Shared database configured successfully on this computer.
echo Run RUN.bat now.
pause
