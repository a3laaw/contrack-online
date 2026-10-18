@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack - Network Database Repair

set "OUT=%~dp0network_repair_report.txt"
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

echo ConTrack Network Repair Report > "%OUT%"
echo Generated: %DATE% %TIME% >> "%OUT%"
echo Folder: %CD% >> "%OUT%"
echo. >> "%OUT%"

"%PYEXE_CMD%" %PYEXE_ARG% -c "import sys, os, pprint; sys.path.insert(0, os.getcwd()); from services.network_single_db_service import status, health_check, repair_shared_database; print('STATUS:'); pprint.pp(status()); print('\nHEALTH:'); pprint.pp(health_check()); print('\nREPAIR:'); pprint.pp(repair_shared_database())" >> "%OUT%" 2>&1

type "%OUT%"
echo.
echo Report saved to: %OUT%
echo If the problem remains, send network_repair_report.txt
notepad "%OUT%"
pause
