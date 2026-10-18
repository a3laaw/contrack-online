# -*- coding: utf-8 -*-
"""نقطة تشغيل البرنامج: إدارة العملاء والعقود والفواتير وكشوف الحساب.

ملاحظة حول "الشاشة السوداء" (نافذة الأوامر):
- عند البناء بـ PyInstaller نستخدم --windowed فلا تظهر نافذة أوامر إطلاقًا.
- عند التشغيل اليدوي على ويندوز استخدم main.pyw أو الأمر pythonw main.py.
- كإجراء إضافي، الكود أدناه يخفي نافذة الكونسول إن وُجدت على ويندوز.
"""
import os
import sys
import traceback

# ضمان عمل الاستيرادات من مجلد app مباشرة
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# =====================================================================
# التكيف التلقائي مع أي إصدار ويندوز وأي حجم شاشة وأي نسبة تكبير (DPI)
# يجب ضبط هذه المتغيرات قبل إنشاء QApplication وقبل أي استيراد لـ Qt
# حتى تُقرأ عند تهيئة النظام الرسومي:
#   - QT_ENABLE_HIGHDPI_SCALING: تفعيل التكبير التلقائي حسب إعداد ويندوز
#   - PassThrough: قبول النسب الكسرية (125% / 150% / 175%) بلا تقريب
#     فلا تظهر الواجهة مقصوصة أو مكبّرة أكثر من اللازم
# =====================================================================
os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")
os.environ.setdefault("QT_SCALE_FACTOR_ROUNDING_POLICY", "PassThrough")

# ملاحظة: لا نضبط QT_QPA_PLATFORM إطلاقًا · أي قيمة لا يقبلها إصدار Qt
# على جهاز العميل تُنهي البرنامج فورًا وبلا رسالة (الأيقونة لا تفتح).
# منع الوضع الليلي لويندوز يتم بطرق آمنة داخل البرنامج:
# setColorScheme(Light) + Fusion + حارس المظهر في ui/style.py


def _hide_console_window():
    """إخفاء نافذة الأوامر السوداء على ويندوز إذا ظهرت."""
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:
        pass


from PySide6.QtCore import QObject, QEvent, Qt, QTimer
from PySide6.QtWidgets import (QApplication, QComboBox, QDateEdit,
                               QDateTimeEdit, QDialog, QDoubleSpinBox,
                               QMessageBox, QSpinBox, QTimeEdit)

from database.database import init_db, DatabaseError, apply_pending_restore
from services import auth_service, backup_service
from ui import style
from ui.login import LoginDialog
from ui.main_window import MainWindow

class _WheelBlocker(QObject):
    """منع بكرة الماوس من تغيير قيم الخانات في كل النظام."""

    _blocked = (QSpinBox, QDoubleSpinBox, QComboBox,
                QDateEdit, QDateTimeEdit, QTimeEdit)

    def eventFilter(self, obj, event):  # noqa: N802
        if event.type() == QEvent.Wheel and isinstance(obj, self._blocked):
            event.ignore()
            return True
        return super().eventFilter(obj, event)


# مسار الأيقونة (يدعم PyInstaller)
if getattr(sys, "frozen", False):
    _ASSETS_BASE = getattr(sys, "_MEIPASS",
                           os.path.dirname(os.path.abspath(sys.executable)))
else:
    _ASSETS_BASE = os.path.dirname(os.path.abspath(__file__))
# أيقونة البرنامج تُحدد في style.app_icon_path() · SVG أولًا ثم PNG

# فحص النسخ التلقائي كل 10 دقائق أثناء التشغيل
_BACKUP_CHECK_MS = 10 * 60 * 1000



_STAGE_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "data", "startup.log")


def _stage(name: str) -> None:
    """تسجيل مرحلة الإقلاع · لو تعطّل البرنامج نعرف أين توقف بالضبط.

    يُكتب في data/startup.log ويُطبع في نافذة الأوامر (التي تبقى ظاهرة
    حتى تُفتح النافذة الرئيسية).
    """
    from datetime import datetime
    import time as _time
    global _STAGE_T0, _STAGE_PREV
    now = _time.perf_counter()
    if name == "بدء التشغيل" or _STAGE_T0 is None:
        _STAGE_T0 = now
        _STAGE_PREV = now
        gap = total = 0.0
    else:
        gap = (now - _STAGE_PREV) * 1000
        total = (now - _STAGE_T0) * 1000
        _STAGE_PREV = now
    # زمن المرحلة نفسها + الزمن التراكمي بالمللي ثانية: يكشف أي مرحلة
    # هي البطيئة فعلًا بدل دقة الثانية الواحدة
    line = (f"{datetime.now():%H:%M:%S}  {name}"
            f"   (+{gap:,.0f} ms · الإجمالي {total:,.0f} ms)")
    try:
        print(" [start]", line, flush=True)
    except Exception:
        pass
    try:
        os.makedirs(os.path.dirname(_STAGE_LOG), exist_ok=True)
        mode = "w" if name == "بدء التشغيل" else "a"
        with open(_STAGE_LOG, mode, encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


# فوق هذا الحد يُعتبر الجهاز بطيئًا فتُطفأ الظلال تلقائيًا
_SLOW_PAINT_MS = 2500

_STAGE_T0 = None
_STAGE_PREV = None

_OK_FLAG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "data", "startup_ok.flag")


def _clear_ok_flag():
    """مسح علامة النجاح عند بدء كل تشغيل."""
    try:
        os.makedirs(os.path.dirname(_OK_FLAG), exist_ok=True)
        if os.path.exists(_OK_FLAG):
            os.remove(_OK_FLAG)
    except OSError:
        pass


def _write_ok_flag():
    """كتابة علامة «النافذة ظهرت» · يقرأها RUN.bat ليعرف أن التشغيل نجح."""
    try:
        with open(_OK_FLAG, "w", encoding="utf-8") as f:
            f.write("STARTUP_OK\n")
    except OSError:
        pass


def _excepthook(exc_type, exc_value, exc_tb):
    """عدم إظهار Traceback للمستخدم النهائي · رسالة عربية + تسجيل في ملف."""
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "data", "error.log")
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write("".join(traceback.format_exception(exc_type, exc_value, exc_tb)))
            f.write("\n" + "=" * 60 + "\n")
    except OSError:
        pass
    app = QApplication.instance()
    if app:
        box = QMessageBox()
        box.setIcon(QMessageBox.Critical)
        box.setWindowTitle("خطأ غير متوقع")
        box.setText("حدث خطأ غير متوقع في البرنامج.\n"
                    "تم تسجيل تفاصيل الخطأ في ملف data/error.log")
        box.addButton("موافق", QMessageBox.AcceptRole)
        box.exec()


def main() -> int:
    sys.excepthook = _excepthook
    _clear_ok_flag()
    _stage("بدء التشغيل")

    # سياسة التكبير الكسري: تُضبط قبل إنشاء QApplication مباشرة
    try:
        QApplication.setHighDpiScaleFactorRoundingPolicy(
            Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    except Exception:
        pass  # إصدارات Qt الأقدم تتجاهلها بلا مشاكل

    app = QApplication(sys.argv)
    app._wheel_blocker = _WheelBlocker(app)
    app.installEventFilter(app._wheel_blocker)
    _stage("تهيئة Qt")
    # مظهر موحد على كل إصدارات ويندوز (7/8/10/11) ويمنع الوضع الليلي
    # للنظام من فرض خلفيات سوداء على النوافذ والقوائم المنسدلة
    try:
        app.setStyle("Fusion")
    except Exception:
        pass
    # أيقونات ورسوم حادة على الشاشات عالية الدقة (Qt6 يفعّلها ضمنيًا،
    # والسطر موجود لضمان السلوك على كل الإصدارات)
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # Qt6 يفعّلها ضمنيًا
            app.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
    except Exception:
        pass
    style.force_light_scheme()
    app.setLayoutDirection(Qt.RightToLeft)
    # الاسم يُقرأ من الإعدادات بعد فتح القاعدة (انظر أدناه)
    app.setApplicationName("ConTrack")
    app.setApplicationDisplayName("ConTrack")

    # تحميل خط Tajawal العربي الحديث
    from PySide6.QtGui import QFontDatabase
    fonts_dir = os.path.join(_ASSETS_BASE, "assets", "fonts")
    for fname in ("Tajawal-Regular.ttf", "Tajawal-Medium.ttf", "Tajawal-Bold.ttf"):
        fpath = os.path.join(fonts_dir, fname)
        if os.path.exists(fpath):
            QFontDatabase.addApplicationFont(fpath)
    if "Tajawal" in QFontDatabase.families():
        from PySide6.QtGui import QFont
        app.setFont(QFont("Tajawal"))

    # الأيقونة المخصصة (SVG أولًا فتظهر حادة في أي نسبة تكبير)
    _icon = style.app_icon()
    if not _icon.isNull():
        app.setWindowIcon(_icon)

    # قاعدة البيانات
    _stage("فتح قاعدة البيانات")
    try:
        pending = apply_pending_restore()
        if pending.get("error"):
            QMessageBox.critical(None, "خطأ استعادة النسخة الاحتياطية",
                                 "تعذرت استعادة النسخة الاحتياطية المؤجلة:\n"
                                 + str(pending.get("error")))
        elif pending.get("applied"):
            QMessageBox.information(None, "استعادة النسخة الاحتياطية",
                                    "تمت استعادة النسخة الاحتياطية بنجاح.\n"
                                    "سيتم الآن فتح البرنامج بالبيانات المستعادة.")
        init_db()
        first_run = auth_service.ensure_default_user()
        auth_service.ensure_developer_user()   # حساب المطور (مخفي عن العميل)
        # العقد هو المشروع: ترحيل العقود القديمة التي بلا مشروع
        # (استعلام واحد يرجع صفرًا في الغالب · لا يؤثر في زمن الإقلاع)
        try:
            from services import lifecycle_service as _lc0
            _moved = _lc0.backfill_auto_projects()
            if _moved:
                _stage(f"ربط {_moved} عقدًا بمشاريعها")
            _mig = _lc0.migrate_owner_to_partner()   # V4.33: جاري المالك ← الشريك
            if (_mig.get("vouchers") or 0) + (_mig.get("journals") or 0):
                _stage("ترحيل جاري الشريك")
        except Exception:
            pass
        try:
            from services import settings_service as _ss
            _name = _ss.app_name()
            app.setApplicationName(_name)
            app.setApplicationDisplayName(_name)
        except Exception:
            pass
    except DatabaseError as exc:
        box = QMessageBox()
        box.setIcon(QMessageBox.Critical)
        box.setWindowTitle("خطأ في قاعدة البيانات")
        box.setText(str(exc))
        box.addButton("موافق", QMessageBox.AcceptRole)
        box.exec()
        return 1

    # ثيم واحد معتمد للنظام (أُلغي الوضع الليلي) · يتجاهل أي قيمة قديمة
    # محفوظة في قاعدة بيانات العميل
    _stage("تطبيق المظهر")
    # الوضع السريع: الظلال مكلفة على الأجهزة بلا تسريع رسومي
    try:
        from services import prefs_service
        style.set_shadows_enabled(
            str(prefs_service.get_pref("ui_shadows", "1")) != "0")
    except Exception:
        pass
    app.setStyleSheet(style.apply_theme())
    # حارس المظهر: يمنع الوضع الليلي لويندوز من تسويد أي نافذة جديدة.
    # صمّام أمان: تشغيل البرنامج بمتغير CM_SAFE_MODE=1 يعطّل الحارس
    # (يستخدمه DIAGNOSE.bat لو اشتُبه أن الحارس سبب مشكلة على جهاز معيّن)
    if os.environ.get("CM_SAFE_MODE") != "1":
        style.install_light_guard(app)
    else:
        _stage("الوضع الآمن: حارس المظهر معطّل")

    # ===== فحص رمز التفعيل (الترخيص) =====
    if not _check_license():
        return 0

    # حلقة الدخول: عند تسجيل الخروج نعود لشاشة الدخول بلا إعادة تشغيل
    while True:
        _stage("فتح شاشة الدخول")
        login = LoginDialog()
        if not _icon.isNull():
            login.setWindowIcon(_icon)
        if login.exec() != QDialog.Accepted:
            return 0
        result = _run_session(app, _icon)
        if result != "logout":
            return result
        _stage("تسجيل الخروج · العودة لشاشة الدخول")


def _check_license() -> bool:
    """فحص رمز التفعيل (الترخيص) على هذا الجهاز.

    - لو الرمز محفوظًا وصحيحًا في القاعدة، يمر فورًا بلا أي نافذة.
    - لو غير صحيح أو غير موجود، يطلب إدخاله حتى يُكتب رمز صحيح،
      ويحفظه تلقائيًا فلا يُسأل عنه مرة أخرى.
    - الضغط على «إلغاء» يُنهي البرنامج.

    المفاتيح الصحيحة تُضبط هنا (سطر واحد يغيّره المطوّر لكل عميل).
    """
    # ===== مفاتيح التفعيل المعتمدة =====
    VALID_KEYS = ["CONTRACK-2024", "MOBARAK-PRO", "1234-5678"]

    from PySide6.QtWidgets import QInputDialog, QLineEdit, QMessageBox
    from services import settings_service as _ss

    try:
        saved = (_ss.get_settings().license_key or "").strip()
        if saved and saved in VALID_KEYS:
            return True
    except Exception:
        saved = ""

    # غيّر الرسالة الترحيبية هنا إن أحببت
    intro = ("هذه النسخة تحتاج إلى رمز تفعيل.\n\n"
             "أدخل الرمز الذي استلمته، وسيُحفظ تلقائيًا على هذا الجهاز.")
    while True:
        text, ok = QInputDialog.getText(
            None, "تفعيل البرنامج", intro,
            QLineEdit.Normal, saved or "")
        if not ok:
            # المستخدم ضغط إلغاء — إنهاء البرنامج بهدوء
            return False
        key = (text or "").strip()
        if key in VALID_KEYS:
            # احفظ الرمز الصحيح فورًا
            try:
                s = _ss.get_settings()
                s.license_key = key
                _ss.save_settings(s)
            except Exception:
                pass
            return True
        QMessageBox.warning(
            None, "رمز التفعيل غير صحيح",
            "الرمز الذي أدخلته غير صحيح.\n"
            "تأكد من الرمز وحاول مرة أخرى.")


def _run_full_backup_if_due():
    """النسخة الكاملة الأسبوعية · صامتة ولا توقف البرنامج عند أي فشل."""
    try:
        from services import full_backup_service
        result = full_backup_service.run_if_due()
        if result:
            _stage(f"نسخة كاملة: {os.path.basename(result['path'])}")
    except Exception as exc:      # noqa: BLE001
        _stage(f"تعذر إنشاء النسخة الكاملة: {exc}")


def _run_session(app, _icon):
    """جلسة عمل كاملة بعد الدخول · ترجع «logout» لإعادة فتح شاشة الدخول."""

    # نسخة تلقائية عند بدء التشغيل إن كانت مستحقة
    _stage("فحص النسخ الاحتياطي")
    backup_service.run_auto_backup()
    _run_full_backup_if_due()

    # ترحيل V4.32 لمرة واحدة: حذف بيانات المصروف الدوري نهائيًا
    # (نسخة إجبارية أولًا · آمن التكرار · بلا نسخة = بلا حذف)
    try:
        from services import lifecycle_service as _lc_purge
        if _lc_purge.recurring_purge_pending():
            _bk = backup_service.run_auto_backup(force=True)
            if not _bk:
                _stage("أُجّل حذف المصروف الدوري: تعذّرت النسخة الاحتياطية")
            else:
                _pg = _lc_purge.purge_recurring_feature()
                if _pg.get("done"):
                    _stage(f"حذف المصروف الدوري: {_pg['defs']} تعريف · "
                           f"{_pg['vouchers']} سند")
    except Exception as exc:
        _stage(f"تعذر ترحيل المصروف الدوري: {exc}")

    _stage("بناء النافذة الرئيسية")
    import time as _t
    _build_t0 = _t.perf_counter()
    window = MainWindow()
    _stage("تركيب الشاشات · جارٍ العرض")
    if not _icon.isNull():
        window.setWindowIcon(_icon)
    window.show()
    app.processEvents()
    _paint_ms = (_t.perf_counter() - _build_t0) * 1000
    # كشف تلقائي للجهاز البطيء: إن تجاوز أول رسم الحدّ، تُطفأ الظلال
    # للمرات القادمة (وظائف البرنامج لا تتأثر — بطاقات بحدود فقط).
    try:
        if _paint_ms > _SLOW_PAINT_MS and style.SHADOWS_ENABLED:
            from services import prefs_service as _pf
            _pf.set_pref("ui_shadows", "0")
            _stage(f"جهاز بطيء ({_paint_ms:,.0f} ms) · فُعِّل الوضع السريع "
                   "من التشغيل القادم")
    except Exception:
        pass
    # الآن فقط نخفي نافذة الأوامر · لو فشل التشغيل قبل هذه النقطة
    # تبقى رسالة الخطأ ظاهرة للمستخدم بدل شاشة لا تفتح
    _stage("جاهز · النافذة ظهرت")
    _write_ok_flag()
    _hide_console_window()

    # مؤقّت النسخ التلقائي أثناء التشغيل
    backup_timer = QTimer(window)
    backup_timer.timeout.connect(backup_service.run_auto_backup)
    backup_timer.timeout.connect(_run_full_backup_if_due)
    backup_timer.start(_BACKUP_CHECK_MS)

    code = app.exec()
    if getattr(window, "logout_requested", False):
        backup_timer.stop()
        window.deleteLater()
        return "logout"
    return code


if __name__ == "__main__":
    # شبكة أمان أخيرة: أي خطأ قبل تركيب المعالج أو بعده يُسجَّل ويُعرض
    # بالعربية بدل أن يُغلق البرنامج صامتًا (الأيقونة لا تفتح).
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException:  # noqa: BLE001
        _excepthook(*sys.exc_info())
        _stage("توقف بسبب خطأ · التفاصيل في data/error.log")
        try:
            print("\n" + "=" * 60)
            print("تعذر تشغيل البرنامج. التفاصيل:")
            traceback.print_exc()
            print("=" * 60)
            input("اضغط Enter للإغلاق...")
        except Exception:
            pass
        sys.exit(1)
