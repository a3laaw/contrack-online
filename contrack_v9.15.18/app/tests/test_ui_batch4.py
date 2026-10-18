# -*- coding: utf-8 -*-
"""الدفعة 4: Ctrl+K + تجميع نتائج البحث + توحيد الشارة + طي 72 — عرضي فقط."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtGui import QKeySequence, QShortcut  # noqa: E402
from PySide6.QtWidgets import QApplication, QDialog  # noqa: E402

from database import database  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service, contract_service  # noqa: E402
from services import customer_service, feature_service  # noqa: E402
from ui import style  # noqa: E402
from ui.global_search import GlobalSearchDialog  # noqa: E402
from ui.main_window import MainWindow  # noqa: E402
from ui.widgets import status_badge  # noqa: E402

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} {extra}")


def _lum(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def _ratio(a, b):
    x, y = _lum(a), _lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


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

        print("=== 1. Ctrl+K ===")
        keys = [s.key().toString() for s in win.findChildren(QShortcut)]
        check("Ctrl+K موجود مرة واحدة", keys.count("Ctrl+K") == 1, keys)
        check("Ctrl+F باقٍ", "Ctrl+F" in keys)
        check("التلميح يذكر K", "Ctrl+K" in win._search_btn.toolTip())
        opened = []
        _ex = GlobalSearchDialog.exec
        GlobalSearchDialog.exec = lambda self: opened.append(True) or QDialog.Rejected
        try:
            win._open_global_search()
        finally:
            GlobalSearchDialog.exec = _ex
        check("المسار يفتح البحث", opened == [True])

        print("=== 2. تجميع نتائج البحث ===")
        cid = customer_service.add_customer(Customer(
            customer_code="C-K1", name="تجربة بحث عميل", phone="9033"))
        contract_service.add_contract(Contract(
            contract_number="CON-K1", customer_id=cid,
            contract_date="2026-01-01", description="تجربة بحث عقد",
            amount=5000.0, contract_type="مقاولة عامة"))
        dlg = GlobalSearchDialog(win)
        dlg.search.setText("تجربة بحث")
        dlg._do_search()
        app.processEvents()
        check("تلميح العدد والنوع", dlg.hint.text() == "3 نتيجة · 3 نوع",
              dlg.hint.text())
        heads, items = [], []
        for i in range(dlg.results_list.count()):
            it = dlg.results_list.item(i)
            (heads if it.data(Qt.UserRole) is None else items).append(it)
        check("3 رؤوس", len(heads) == 3, dlg.results_list.count())
        check("نصوص الرؤوس",
              sorted(h.text() for h in heads) == ["عقد (1)", "عميل (1)", "مشروع (1)"],
              [h.text() for h in heads])
        check("الرؤوس عريضة غير قابلة للتحديد",
              all(h.font().bold() and h.flags() == Qt.NoItemFlags
                  for h in heads))
        check("العناصر تحمل بيانات",
              all(isinstance(it.data(Qt.UserRole), tuple) for it in items))
        check("ترتيب الظهور الأول",
              [it.data(Qt.UserRole)[0] for it in items]
              == ["customer", "contract", "project"],
              [it.data(Qt.UserRole)[0] for it in items])
        check("لا وسم نوع داخل العنصر",
              all("[" not in it.text() for it in items))
        fired = []
        dlg.result_chosen.connect(lambda t, i: fired.append((t, i)))
        dlg._open_result(heads[0])
        check("النقر على رأس لا يفعل شيئًا", fired == [])
        dlg._open_first()
        check("أول نتيجة حقيقية",
              fired == [("customer", cid)], fired)
        dlg.search.setText("ت")
        dlg._do_search()
        check("استعلام قصير", "حرفين" in dlg.hint.text(), dlg.hint.text())
        dlg.search.setText("zzz_no_match_xyz")
        dlg._do_search()
        check("لا نتائج", "لا نتائج" in dlg.hint.text(), dlg.hint.text())

        print("=== 3. الشارة الموحدة ===")
        import ui.contract_hub as hub_mod
        check("المكرر الميت حُذف",
              not hasattr(hub_mod, "_badge")
              and not hasattr(hub_mod, "_rgba")
              and not hasattr(hub_mod, "_darken"))
        b = status_badge("نشط", style.OK_GREEN)
        check("شارة QLabel", b.text() == "نشط")
        ss = b.styleSheet()
        check("تنسيق الشارة",
              "border-radius" in ss and "rgba" in ss and "700" in ss)
        worst = ("", 99.0)
        for name, col in list(style.STATUS_COLORS.items()) + [
                ("OK", style.OK_GREEN)]:
            h = col.lstrip("#")
            r, g, bl = (int(h[i:i + 2], 16) for i in (0, 2, 4))
            txt = "#%02X%02X%02X" % (int(r * 0.66), int(g * 0.66), int(bl * 0.66))
            bg = "#%02X%02X%02X" % (
                int(r * 0.13 + 255 * 0.87), int(g * 0.13 + 255 * 0.87),
                int(bl * 0.13 + 255 * 0.87))
            rt = _ratio(txt, bg)
            if rt < worst[1]:
                worst = (name, rt)
        check("تباين الشارات ≥ 4.5", worst[1] >= 4.5, worst)

        print("=== 4. عرض الطي 72 ===")
        win._toggle_sidebar()
        app.processEvents()
        scale = getattr(win, "_sidebar_scale", 1.0)
        check("مطوي 72", win._sidebar.width() == int(72 * scale),
              win._sidebar.width())
        win._toggle_sidebar()
        app.processEvents()
        check("توسيع يعيد العرض", win._sidebar.width() > 150)
    finally:
        auth_service.has_permission = _op
        feature_service.enabled = _of
    print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
    app.quit()
    if FAIL:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
