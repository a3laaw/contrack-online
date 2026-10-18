@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack - DEBUG

echo ======================================================
echo   ConTrack - Debug Run
echo ======================================================
echo.

set "PY_CMD="
set "PY_ARG="
if exist ".venv\Scripts\python.exe" set "PY_CMD=%CD%\.venv\Scripts\python.exe"
if not defined PY_CMD where py >nul 2>nul && set "PY_CMD=py" && set "PY_ARG=-3"
if not defined PY_CMD where python >nul 2>nul && set "PY_CMD=python"

if not defined PY_CMD (
    echo [ERROR] Python was not found. Run INSTALL.bat first.
    pause
    exit /b 1
)

if defined PY_ARG (
    "%PY_CMD%" %PY_ARG% "%~dp0main.py" 1>"%~dp0error_last.txt" 2>&1
) else (
    "%PY_CMD%" "%~dp0main.py" 1>"%~dp0error_last.txt" 2>&1
)
set "ERR=%ERRORLEVEL%"

type "%~dp0error_last.txt"
echo.
echo ------------------------------------------------------
echo Exit code: %ERR%
echo If there is an error, send error_last.txt and startup_trace.txt
echo ------------------------------------------------------
pause
exit /b %ERR%
