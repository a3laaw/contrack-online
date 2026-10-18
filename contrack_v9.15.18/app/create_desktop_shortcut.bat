@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "TARGET=%~dp0RUN.bat"
set "SHORTCUT=%USERPROFILE%\Desktop\ConTrack.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$W=New-Object -ComObject WScript.Shell; $S=$W.CreateShortcut('%SHORTCUT%'); $S.TargetPath='%TARGET%'; $S.WorkingDirectory='%~dp0'; $S.IconLocation='%SystemRoot%\System32\shell32.dll,21'; $S.Save()"

if exist "%SHORTCUT%" (
    echo تم إنشاء اختصار سطح المكتب: ConTrack
) else (
    echo لم يتم إنشاء الاختصار. يمكنك تشغيل النظام من RUN.bat مباشرة.
)
pause
