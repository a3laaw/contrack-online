@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "OUT=%~dp0diagnose_report.txt"

echo ConTrack Diagnose Report > "%OUT%"
echo Generated: %DATE% %TIME% >> "%OUT%"
echo Folder: %CD% >> "%OUT%"
echo. >> "%OUT%"

echo ==== Files ==== >> "%OUT%"
dir >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo ==== Python discovery ==== >> "%OUT%"
where py >> "%OUT%" 2>&1
where python >> "%OUT%" 2>&1
where pythonw >> "%OUT%" 2>&1
echo. >> "%OUT%"

set "PYEXE_CMD="
set "PYEXE_ARG="
if exist ".venv\Scripts\python.exe" set "PYEXE_CMD=%~dp0.venv\Scripts\python.exe"
if not defined PYEXE_CMD where py >nul 2>nul && set "PYEXE_CMD=py" && set "PYEXE_ARG=-3"
if not defined PYEXE_CMD where python >nul 2>nul && set "PYEXE_CMD=python"

if defined PYEXE_CMD (
    echo ==== Python version ==== >> "%OUT%"
    "%PYEXE_CMD%" %PYEXE_ARG% --version >> "%OUT%" 2>&1
    echo. >> "%OUT%"

    echo ==== pip list ==== >> "%OUT%"
    "%PYEXE_CMD%" %PYEXE_ARG% -m pip list >> "%OUT%" 2>&1
    echo. >> "%OUT%"

    echo ==== Import test ==== >> "%OUT%"
    "%PYEXE_CMD%" %PYEXE_ARG% -c "mods=['PySide6','reportlab','pypdf','arabic_reshaper','bidi','docx','openpyxl','PIL','docx2pdf']; import importlib; [print(m, 'OK') if importlib.import_module(m) else None for m in mods]" >> "%OUT%" 2>&1
    echo. >> "%OUT%"

    echo ==== LibreOffice / Word PDF converter ==== >> "%OUT%"
    where soffice >> "%OUT%" 2>&1
    if exist "%ProgramFiles%\LibreOffice\program\soffice.exe" echo Found: %ProgramFiles%\LibreOffice\program\soffice.exe >> "%OUT%"
    if exist "%ProgramFiles(x86)%\LibreOffice\program\soffice.exe" echo Found: %ProgramFiles(x86)%\LibreOffice\program\soffice.exe >> "%OUT%"
    "%PYEXE_CMD%" %PYEXE_ARG% -c "import sys, os; sys.path.insert(0, os.getcwd()); from services.form_service import _find_libreoffice_exe; print('Detected LibreOffice:', _find_libreoffice_exe() or 'NOT FOUND')" >> "%OUT%" 2>&1
    echo. >> "%OUT%"

    echo ==== App smoke test ==== >> "%OUT%"
    "%PYEXE_CMD%" %PYEXE_ARG% -c "import sys, os; sys.path.insert(0, os.getcwd()); from database import database; database.init_db(); from services import contract_service; print('DB OK'); print(contract_service.dashboard_stats())" >> "%OUT%" 2>&1
) else (
    echo Python not found. >> "%OUT%"
)

echo.
echo Diagnose report created:
echo %OUT%
echo.
notepad "%OUT%"
pause
