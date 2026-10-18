# ConTrack — تشغيل وتثبيت النظام

ضع كل ملفات ومجلدات النظام في مجلد واحد كما في الصورة:

```text
ConTrack/
├── main.py
├── requirements.txt
├── INSTALL.bat
├── RUN.bat
├── RUN_DEBUG.bat
├── DIAGNOSE.bat
├── build_exe.bat
├── create_desktop_shortcut.bat
├── SPEEDUP.bat
├── database/
├── services/
├── ui/
├── reports/
├── assets/
└── data/
```

## أول تشغيل

1. ثبت Python 3.11 أو 3.12 من موقع Python الرسمي.
2. أثناء تثبيت Python فعّل خيار:

```text
Add Python to PATH
```

3. اضغط مرتين على:

```text
INSTALL.bat
```

4. بعد انتهاء التثبيت اضغط مرتين على:

```text
RUN.bat
```

## إذا لم يفتح البرنامج

شغل:

```text
RUN_DEBUG.bat
```

ثم أرسل الملف:

```text
error_last.txt
```

أو شغل:

```text
DIAGNOSE.bat
```

ثم أرسل:

```text
diagnose_report.txt
```

## إنشاء اختصار سطح المكتب

شغل:

```text
create_desktop_shortcut.bat
```

## بناء نسخة EXE

بعد نجاح التشغيل من RUN.bat، شغل:

```text
build_exe.bat
```

سيظهر الملف التنفيذي داخل:

```text
dist/ConTrack/ConTrack.exe
```
