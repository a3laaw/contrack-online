@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ConTrack - Safe Backup Restore

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
echo   ConTrack - Safe Backup Restore
echo ======================================================
echo.
echo Close ConTrack before continuing.
echo Enter the full path of the .sqlite backup file.
echo Example: C:\Backups\backup_2026-09-06.sqlite
echo.
set /p BK=Backup file path: 
if "%BK%"=="" (
    echo Cancelled.
    pause
    exit /b 1
)

set "CONTRACK_BACKUP=%BK%"
"%PYEXE_CMD%" %PYEXE_ARG% -c "import sys, os; sys.path.insert(0, os.getcwd()); from database.database import restore_db; restore_db(os.environ['CONTRACK_BACKUP'].strip(' \"')); print('Restore completed successfully.')"
if errorlevel 1 (
    echo.
    echo [FAILED] Restore failed. Check the backup path and permissions.
    pause
    exit /b 1
)

echo.
echo Done. Run RUN.bat now.
pause
