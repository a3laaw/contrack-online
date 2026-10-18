@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title ConTrack - INSTALL

echo ======================================================
echo   ConTrack - Install Requirements
echo ======================================================
echo.

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo [ERROR] Python was not found in PATH.
    echo Install Python 3.11 or 3.12 and tick Add Python to PATH.
    echo Download: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

echo [1/6] Python version:
%PY% --version
if errorlevel 1 goto fail

if not exist "requirements.txt" (
    echo [ERROR] requirements.txt not found next to INSTALL.bat
    pause
    exit /b 1
)

echo.
echo [2/6] Creating local virtual environment .venv ...
if not exist ".venv\Scripts\python.exe" (
    %PY% -m venv .venv
    if errorlevel 1 goto fail
) else (
    echo Existing .venv found.
)

set "VPY=%~dp0.venv\Scripts\python.exe"

echo.
echo [3/6] Upgrading pip ...
"%VPY%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto fail

echo.
echo [4/6] Installing ConTrack Python packages ...
"%VPY%" -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 goto fail

echo.
echo [5/6] Checking LibreOffice for Word to PDF export ...
call :ensure_libreoffice

echo.
echo [6/6] Import test ...
"%VPY%" -c "import PySide6, reportlab, pypdf, docx, openpyxl, PIL, docx2pdf; import arabic_reshaper; import bidi; print('OK')"
if errorlevel 1 goto fail

echo.
echo ======================================================
echo Install completed successfully.
echo Run the app using RUN.bat
echo.
echo PDF export from Word templates needs LibreOffice or Microsoft Word.
echo INSTALL checks LibreOffice and tries to install it with winget when available.
echo ======================================================
echo.
pause
exit /b 0

:ensure_libreoffice
set "SOFFICE="
where soffice >nul 2>nul && set "SOFFICE=soffice"
if not defined SOFFICE if exist "%ProgramFiles%\LibreOffice\program\soffice.exe" set "SOFFICE=%ProgramFiles%\LibreOffice\program\soffice.exe"
if not defined SOFFICE if exist "%ProgramFiles(x86)%\LibreOffice\program\soffice.exe" set "SOFFICE=%ProgramFiles(x86)%\LibreOffice\program\soffice.exe"
if defined SOFFICE (
    echo LibreOffice found: %SOFFICE%
    exit /b 0
)

echo LibreOffice was not found.
echo It is recommended for PDF export from Word templates.
where winget >nul 2>nul
if errorlevel 1 (
    echo winget is not available. Please install LibreOffice manually from:
    echo https://www.libreoffice.org/download/download-libreoffice/
    exit /b 0
)

echo Trying to install LibreOffice using winget ...
winget install --id TheDocumentFoundation.LibreOffice --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo LibreOffice automatic install was not completed.
    echo You can still run the system, but PDF export needs LibreOffice or Microsoft Word.
    exit /b 0
)
echo LibreOffice install command completed.
exit /b 0

:fail
echo.
echo ======================================================
echo [INSTALL FAILED]
echo Run DIAGNOSE.bat and send diagnose_report.txt
echo If .venv is broken, delete the .venv folder and run INSTALL.bat again.
echo ======================================================
echo.
pause
exit /b 1
