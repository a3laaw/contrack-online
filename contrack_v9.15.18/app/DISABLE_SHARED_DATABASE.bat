@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PYEXE_CMD="
set "PYEXE_ARG="
if exist ".venv\Scripts\python.exe" set "PYEXE_CMD=%~dp0.venv\Scripts\python.exe"
if not defined PYEXE_CMD where py >nul 2>nul && set "PYEXE_CMD=py" && set "PYEXE_ARG=-3"
if not defined PYEXE_CMD where python >nul 2>nul && set "PYEXE_CMD=python"
if not defined PYEXE_CMD (
    echo [ERROR] Python was not found.
    pause
    exit /b 1
)

"%PYEXE_CMD%" %PYEXE_ARG% -c "import sys, os, pprint; sys.path.insert(0, os.getcwd()); from services.network_single_db_service import disable_shared_database; pprint.pp(disable_shared_database())"
echo Local database mode is enabled on this computer.
pause
