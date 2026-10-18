@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack - Reset Developer Password

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

echo ======================================================
echo   ConTrack - Reset Developer Password
echo ======================================================
echo.
echo This will create a NEW developer password for the current database.
echo It does not delete any customer/contract/accounting data.
echo.

"%PYEXE_CMD%" %PYEXE_ARG% -c "import sys, os; sys.path.insert(0, os.getcwd()); from database.database import init_db; init_db(); from services.auth_service import reset_developer_password; r=reset_developer_password(); print('Username:', r['username']); print('Password:', r['password']); print('Saved file:', r['file'])"
if errorlevel 1 (
    echo.
    echo [FAILED] Could not reset developer password.
    echo Run DIAGNOSE.bat and send diagnose_report.txt
    pause
    exit /b 1
)

echo.
echo Done. The password was saved in the file shown above.
echo Open it, copy the password, then delete it before delivery if needed.
echo.
pause
