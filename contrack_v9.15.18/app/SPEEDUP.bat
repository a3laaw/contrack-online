@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo تنظيف ملفات مؤقتة وتسريع تشغيل ConTrack...

if exist "__pycache__" rmdir /s /q "__pycache__"
for /d /r %%D in (__pycache__) do @if exist "%%D" rmdir /s /q "%%D"
if exist ".pytest_cache" rmdir /s /q ".pytest_cache"
if exist "build" rmdir /s /q "build"

echo.
echo تم التنظيف.
echo إذا كان التشغيل بطيئًا أول مرة فهذا طبيعي بسبب تحميل PySide6.
pause
