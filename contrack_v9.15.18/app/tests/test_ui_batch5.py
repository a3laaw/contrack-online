# -*- coding: utf-8 -*-
"""الدفعة 5: البحث في العلوي + تلميع الدخول — نفس الحقول والوظائف."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication, QDialog, QLabel, QLineEdit  # noqa: E402
from PySide6.QtWidgets import QPushButton  # noqa: E402

from database import database  # noqa: E402
from services import auth_service, feature_service  # noqa: E402
from services import prefs_service  # noqa: E402
from ui import style  # noqa: E402
from ui.global_search import GlobalSearchDialog  # noqa: E402
from ui.login import LoginDialog  # noqa: E402
from ui.main_window import MainWindow  # noqa: E402
from version import APP_VERSION  # noqa: E402

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} {extra}")


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    app.setStyleSheet(style.apply_theme())
    _op, _of = auth_service.has_permission, feature_service.enabled
    auth_service.has_permission = lambda *a, **k: True
    feature_service.enabled = lambda *a, **k: True
    try:
        win = MainWindow()
        win.show()
        app.processEvents()

        print("=== 1. البحث في الشريط العلوي ===")
        side_search = [b for b in win._sidebar.findChildren(QPushButton)
                       if b.text() == "🔍 بحث شامل ..."]
        check("لا بحث في الجانبي", side_search == [])
        sb = win._search_btn
        check("زر البحث علوي",
              sb.text() == "🔍 بحث شامل ..." and sb.isVisibleTo(win.top_bar))
        check("عرض أدنى 170", sb.minimumWidth() == 170)
        check("التلميح", "Ctrl+K" in sb.toolTip() and "Ctrl+F" in sb.toolTip())
        opened = []
        _ex = GlobalSearchDialog.exec
        GlobalSearchDialog.exec = lambda self: opened.append(True) or QDialog.Rejected
        try:
            sb.click()
            app.processEvents()
        finally:
            GlobalSearchDialog.exec = _ex
        check("النقر يفتح البحث", opened == [True])
        before = (sb.text(), sb.toolTip())
        win._toggle_sidebar()
        app.processEvents()
        check("الطي لا يمس البحث", (sb.text(), sb.toolTip()) == before
              and sb.isVisible())
        win._toggle_sidebar()
        app.processEvents()

        print("=== 2. الدخول: تسميات وإصدار ===")
        prefs_service.set_pref("last_username", "")
        dlg = LoginDialog()
        dlg.show()
        app.processEvents()
        labels = {l.text(): l for l in dlg.findChildren(QLabel)}
        check("تسمية المستخدم", "اسم المستخدم" in labels)
        check("تسمية المرور", "كلمة المرور" in labels)
        if "اسم المستخدم" in labels:
            ys = [labels["اسم المستخدم"].y(), dlg.username.y(),
                  labels["كلمة المرور"].y(), dlg.password.y()]
            check("ترتيب تسمية←حقل←تسمية←حقل", ys == sorted(ys), ys)
        check("سطر الإصدار",
              any(APP_VERSION in l.text() for l in dlg.findChildren(QLabel)),
              APP_VERSION)
        check("الحقول والأنماط",
              dlg.username.placeholderText() == "اسم المستخدم"
              and dlg.password.placeholderText() == "كلمة المرور"
              and dlg.password.echoMode() == QLineEdit.Password)
        btns = [b for b in dlg.findChildren(QPushButton)
                if b.text() == "دخول"]
        check("زر دخول رئيسي",
              len(btns) == 1 and btns[0].objectName() == "btnPrimary")
        check("بلا تذكرني/استعادة",
              not any("تذكر" in b.text() or "نسيت" in b.text()
                      for b in dlg.findChildren(QPushButton))
              and not any("تذكر" in l.text() or "نسيت" in l.text()
                          for l in dlg.findChildren(QLabel)))

        print("=== 3. الدخول: الوظائف محفوظة ===")
        prefs_service.set_pref("last_username", "admin")
        dlg2 = LoginDialog()
        check("ملء آخر مستخدم", dlg2.username.text() == "admin",
              dlg2.username.text())
        _vl = auth_service.verify_login
        auth_service.verify_login = lambda u, p: True
        try:
            dlg2.username.setText("admin")
            dlg2.password.setText("x")
            dlg2._try_login()
            check("نجاح يقبل", dlg2.result() == QDialog.Accepted)
        finally:
            auth_service.verify_login = _vl
        auth_service.verify_login = lambda u, p: False
        _err = style.error
        errs = []
        style.error = lambda *a, **k: errs.append(True)
        try:
            d3 = LoginDialog()
            d3.username.setText("a")
            d3.password.setText("bad")
            d3._try_login()
            check("فشل أول: عداد", "متبقي 2 محاولة" in d3.msg.text(),
                  d3.msg.text())
            check("فشل أول: مسح المرور", d3.password.text() == "")
            d3.password.setText("bad")
            d3._try_login()
            check("فشل ثانٍ: عداد", "متبقي 1 محاولة" in d3.msg.text())
            d3.password.setText("bad")
            d3._try_login()
            check("فشل ثالث: خطأ + رفض",
                  errs == [True] and d3.result() == QDialog.Rejected)
        finally:
            auth_service.verify_login = _vl
            style.error = _err

        print("=== 4. الدخول: Enter والتركيز ===")
        prefs_service.set_pref("last_username", "")
        d4 = LoginDialog()
        d4.show()
        app.processEvents()
        d4.username.setFocus()
        app.processEvents()
        d4.username.returnPressed.emit()
        app.processEvents()
        check("Enter من الاسم ينقل للمرور", d4.password.hasFocus())
        auth_service.verify_login = lambda u, p: True
        try:
            d4.username.setText("u")
            d4.password.setText("p")
            d4.password.returnPressed.emit()
            app.processEvents()
            check("Enter من المرور يدخل", d4.result() == QDialog.Accepted)
        finally:
            auth_service.verify_login = _vl
    finally:
        auth_service.has_permission = _op
        feature_service.enabled = _of
    print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
    app.quit()
    if FAIL:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
