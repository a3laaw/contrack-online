# -*- coding: utf-8 -*-
"""فحص دخاني آلي لأزرار الواجهة.

الغرض: كشف أخطاء AttributeError/NameError ونحوها عند بناء الشاشات والضغط
على أزرارها الرئيسية بدون فتح نوافذ حوار حقيقية أو تنفيذ عمليات مدمرة.
"""
import os
import sys
import traceback
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402

# قاعدة اختبار جديدة محلية في app/data؛ لا نعتمد على بيانات العميل.
database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service, lifecycle_service  # noqa: E402
from PySide6.QtCore import Qt, QTimer  # noqa: E402
from PySide6.QtWidgets import (  # noqa: E402
    QApplication, QDialog, QFileDialog, QInputDialog, QMenu, QMessageBox,
    QPushButton, QTabWidget, QToolButton, QWidget,
)

ERRORS = []
CLICKS = []


def _excepthook(exc_type, exc, tb):
    msg = "".join(traceback.format_exception(exc_type, exc, tb))
    ERRORS.append(msg)
    print("[EXCEPTION]", msg)


sys.excepthook = _excepthook

# منع أي حوار من إيقاف الفحص، ومنع العمليات التي تحتاج ملف/مجلد.
QDialog.exec = lambda self: QDialog.Rejected
QMessageBox.exec = lambda self: QMessageBox.No
QMessageBox.information = lambda *a, **k: QMessageBox.Ok
QMessageBox.warning = lambda *a, **k: QMessageBox.Ok
QMessageBox.critical = lambda *a, **k: QMessageBox.Ok
QMessageBox.question = lambda *a, **k: QMessageBox.No
QFileDialog.getOpenFileName = lambda *a, **k: ("", "")
QFileDialog.getOpenFileNames = lambda *a, **k: ([], "")
QFileDialog.getSaveFileName = lambda *a, **k: ("", "")
QFileDialog.getExistingDirectory = lambda *a, **k: ""
QInputDialog.getText = lambda *a, **k: ("سبب اختبار آلي", True)
QInputDialog.getInt = lambda *a, **k: (1, True)
QInputDialog.getDouble = lambda *a, **k: (1.0, True)
QInputDialog.getItem = lambda *a, **k: ("", False)
QMenu.exec = lambda self, *a, **k: None
QMenu.popup = lambda self, *a, **k: None


def seed_data():
    cid = customer_service.add_customer(Customer(
        customer_code=customer_service.next_customer_code(),
        name="عميل فحص الأزرار", phone="99000000", address="الكويت"))
    kid = contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=cid,
        contract_date=date.today().isoformat(),
        description="عقد فحص الأزرار",
        amount=1000.0,
        contract_type="غير محدد"))
    lifecycle_service.add_addendum(kid, date.today().isoformat(), "اختبار", "ملحق فحص", 100, 0)
    lifecycle_service.add_voucher("receipt", date.today().isoformat(), "", "نقدًا", "", 100,
                                  "سند فحص", contract_id=kid,
                                  party_type="customer", party_id=cid)
    sub_id = lifecycle_service.add_subcontractor(lifecycle_service.next_sub_code(),
                                                 "مقاول فحص الأزرار", phone="66000000")
    lifecycle_service.add_sub_contract(sub_id, kid, None, 200, date.today().isoformat(),
                                       date.today().isoformat(), "عقد باطن فحص")
    return cid, kid


def click_buttons(root: QWidget, label: str):
    app = QApplication.instance()
    buttons = list(root.findChildren(QPushButton)) + list(root.findChildren(QToolButton))
    seen = set()
    for btn in buttons:
        if btn in seen:
            continue
        seen.add(btn)
        try:
            txt = (btn.text() or btn.objectName() or btn.toolTip() or repr(btn)).replace("\n", " ")
            if not btn.isEnabled():
                continue
            skip_texts = {"🔔", "⇅", "⋮", "☰"}
            tip = btn.toolTip() or ""
            if (txt.strip() in skip_texts or "تنبيهات" in tip or "ترتيب" in tip
                    or txt.startswith("مستخدم") or txt.startswith("المستخدم")
                    or "⌄" in txt or "⌃" in txt):
                print(f"[SKIP-POPUP] {label}: {txt}", flush=True)
                continue
            def _close_popups():
                for w in QApplication.topLevelWidgets():
                    if isinstance(w, (QMenu, QDialog)) and w is not root.window():
                        try: w.close()
                        except Exception: pass
            QTimer.singleShot(50, _close_popups)
            QTimer.singleShot(200, _close_popups)
            if hasattr(btn, "menu") and btn.menu() is not None:
                print(f"[SKIP-MENU] {label}: {txt}", flush=True)
                continue
            CLICKS.append((label, txt))
            print(f"[CLICK] {label}: {txt}", flush=True)
            btn.click()
            app.processEvents()
        except BaseException:
            _excepthook(*sys.exc_info())


def exercise_tabs(root: QWidget, label: str):
    app = QApplication.instance()
    for tabs in root.findChildren(QTabWidget):
        for i in range(tabs.count()):
            try:
                print(f"[TAB] {label}: {tabs.tabText(i)}", flush=True)
                tabs.setCurrentIndex(i)
                app.processEvents()
            except BaseException:
                _excepthook(*sys.exc_info())


def main():
    cid, kid = seed_data()
    app = QApplication.instance() or QApplication(sys.argv)
    widgets = []

    from ui.main_window import MainWindow
    main_window = MainWindow()
    widgets.append(("MainWindow", main_window))

    # افتح صفحات القائمة الجانبية الكسولة إن وجدت.
    max_idx = max(getattr(main_window, "_page_factories", {0: None}).keys(), default=0)
    for idx in range(max_idx + 1):
        try:
            print(f"[NAV] {idx}", flush=True)
            main_window._go(idx)
            app.processEvents()
        except BaseException:
            _excepthook(*sys.exc_info())

    # صفحات تفصيلية مهمة قد لا تُفتح من القائمة مباشرة.
    constructors = []
    try:
        from ui.archive import CustomerFileWidget
        constructors.append(("CustomerFileWidget", lambda: CustomerFileWidget(None, customer_service.get_customer(cid), embedded=True)))
    except Exception:
        pass
    try:
        from ui.contract_hub import ContractHubPage
        constructors.append(("ContractHubPage", lambda: ContractHubPage(None, embedded=True)))
    except Exception:
        pass
    try:
        from ui.vouchers import VouchersPage
        constructors.append(("VouchersPage(receipt)", lambda: VouchersPage("receipt")))
        constructors.append(("VouchersPage(payment)", lambda: VouchersPage("payment")))
    except Exception:
        pass
    for name, maker in constructors:
        try:
            print(f"[BUILD] {name}", flush=True)
            w = maker()
            if hasattr(w, "load_contract") and name == "ContractHubPage":
                w.load_contract(kid)
            widgets.append((name, w))
            app.processEvents()
        except BaseException:
            _excepthook(*sys.exc_info())

    for label, widget in widgets:
        exercise_tabs(widget, label)
        click_buttons(widget, label)

    print("=" * 60, flush=True)
    print("button_clicks", len(CLICKS), flush=True)
    print("errors", len(ERRORS), flush=True)
    if ERRORS:
        print(ERRORS[0])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
