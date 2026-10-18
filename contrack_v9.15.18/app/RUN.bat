@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack

if not exist "main.py" (
    echo [ERROR] main.py was not found next to RUN.bat
    pause
    exit /b 1
)

set "PYW_CMD="
set "PYW_ARG="
set "PY_CMD="
set "PY_ARG="

if exist ".venv\Scripts\pythonw.exe" set "PYW_CMD=%CD%\.venv\Scripts\pythonw.exe"
if exist ".venv\Scripts\python.exe" set "PY_CMD=%CD%\.venv\Scripts\python.exe"

if not defined PYW_CMD where pyw >nul 2>nul && set "PYW_CMD=pyw" && set "PYW_ARG=-3"
if not defined PY_CMD where py >nul 2>nul && set "PY_CMD=py" && set "PY_ARG=-3"
if not defined PYW_CMD where pythonw >nul 2>nul && set "PYW_CMD=pythonw"
if not defined PY_CMD where python >nul 2>nul && set "PY_CMD=python"

if not defined PYW_CMD (
    echo [ERROR] Python was not found. Run INSTALL.bat first.
    pause
    exit /b 1
)

if defined PY_CMD (
    if defined PY_ARG (
        "%PY_CMD%" %PY_ARG% -c "import PySide6, reportlab, pypdf, docx, openpyxl, PIL; import arabic_reshaper; import bidi" >nul 2>nul
    ) else (
        "%PY_CMD%" -c "import PySide6, reportlab, pypdf, docx, openpyxl, PIL; import arabic_reshaper; import bidi" >nul 2>nul
    )
    if errorlevel 1 (
        echo [ERROR] Required Python packages are missing.
        echo Run INSTALL.bat once, then run RUN.bat again.
        echo If installation fails, run DIAGNOSE.bat and send diagnose_report.txt.
        pause
        exit /b 1
    )
)

if exist "network_folder.txt" if defined PY_CMD (
    if defined PY_ARG (
        "%PY_CMD%" %PY_ARG% -c "import sys, os; sys.path.insert(0, os.getcwd()); from services.network_single_db_service import status, health_check; st=status(); hc=health_check(st['data_dir']); raise SystemExit(0 if hc['ok'] else 2)" >nul 2>nul
    ) else (
        "%PY_CMD%" -c "import sys, os; sys.path.insert(0, os.getcwd()); from services.network_single_db_service import status, health_check; st=status(); hc=health_check(st['data_dir']); raise SystemExit(0 if hc['ok'] else 2)" >nul 2>nul
    )
    if errorlevel 1 (
        echo [ERROR] Cannot access the shared database folder.
        echo Run DIAGNOSE.bat or check network_folder.txt and server permissions.
        pause
        exit /b 1
    )
)

if defined PYW_ARG (
    start "ConTrack" /D "%~dp0" "%PYW_CMD%" %PYW_ARG% "%~dp0main.py"
) else (
    start "ConTrack" /D "%~dp0" "%PYW_CMD%" "%~dp0main.py"
)
exit /b 0
