@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack - Build EXE

echo ======================================================
echo   ConTrack - بناء ملف EXE
echo ======================================================
echo.

set "PYEXE_CMD="
set "PYEXE_ARG="
if exist ".venv\Scripts\python.exe" set "PYEXE_CMD=%~dp0.venv\Scripts\python.exe"
if not defined PYEXE_CMD where py >nul 2>nul && set "PYEXE_CMD=py" && set "PYEXE_ARG=-3"
if not defined PYEXE_CMD where python >nul 2>nul && set "PYEXE_CMD=python"

if not defined PYEXE_CMD (
    echo [خطأ] Python غير مثبت. شغل INSTALL.bat أولاً.
    pause
    exit /b 1
)

"%PYEXE_CMD%" %PYEXE_ARG% -m pip install pyinstaller
if errorlevel 1 goto fail

if exist "assets\icon\icon.ico" (
    set "ICON=--icon=assets\icon\icon.ico"
) else (
    set "ICON="
)

"%PYEXE_CMD%" %PYEXE_ARG% -m PyInstaller --noconfirm --clean --windowed --name ConTrack %ICON% --add-data "assets;assets" main.py
if errorlevel 1 goto fail

echo.
echo تم البناء. ستجد البرنامج في:
echo dist\ConTrack\ConTrack.exe
echo.
pause
exit /b 0

:fail
echo.
echo [فشل] لم يتم بناء EXE. شغل RUN_DEBUG.bat أو DIAGNOSE.bat وأرسل الخطأ.
pause
exit /b 1
