# -*- coding: utf-8 -*-
"""فحص أوامر القوائم المنسدلة المهمة بدون تنفيذ عمليات مدمرة فعليًا."""
import os
import sys
import traceback
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import auth_service, contract_service, customer_service, lifecycle_service  # noqa: E402
from PySide6.QtCore import QTimer  # noqa: E402
from PySide6.QtWidgets import (  # noqa: E402
    QApplication, QDialog, QFileDialog, QInputDialog, QMenu, QMessageBox,
    QPushButton, QToolButton, QWidget,
)

ERRORS = []
TRIGGERS = []


def _excepthook(exc_type, exc, tb):
    msg = "".join(traceback.format_exception(exc_type, exc, tb))
    ERRORS.append(msg)
    print("[EXCEPTION]", msg, flush=True)


sys.excepthook = _excepthook
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
    auth_service.ensure_default_user()
    auth_service.set_current_user("admin")
    cid = customer_service.add_customer(Customer(
        customer_code=customer_service.next_customer_code(),
        name="عميل فحص أوامر القوائم", phone="99111111", address="الكويت"))
    kid = contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=cid,
        contract_date=date.today().isoformat(),
        description="عقد فحص أوامر القوائم",
        amount=1000.0,
        contract_type="غير محدد"))
    return cid, kid


def _close_popups():
    for w in QApplication.topLevelWidgets():
        if isinstance(w, (QMenu, QDialog)):
            try:
                w.close()
            except Exception:
                pass


def trigger_menus(root: QWidget, label: str):
    app = QApplication.instance()
    buttons = list(root.findChildren(QPushButton)) + list(root.findChildren(QToolButton))
    seen = set()
    for btn in buttons:
        if btn in seen:
            continue
        seen.add(btn)
        menu = btn.menu() if hasattr(btn, "menu") else None
        if menu is None:
            continue
        owner = (btn.text() or btn.objectName() or btn.toolTip() or repr(btn)).replace("\n", " ").strip()
        for action in menu.actions():
            if action.isSeparator() or not action.isEnabled():
                continue
            text = (action.text() or "").replace("\n", " ").strip()
            try:
                QTimer.singleShot(50, _close_popups)
                QTimer.singleShot(200, _close_popups)
                print(f"[MENU] {label}: {owner} > {text}", flush=True)
                TRIGGERS.append((label, owner, text))
                action.trigger()
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
    max_idx = max(getattr(main_window, "_page_factories", {0: None}).keys(), default=0)
    for idx in range(max_idx + 1):
        try:
            main_window._go(idx)
            app.processEvents()
        except BaseException:
            _excepthook(*sys.exc_info())

    from ui.archive import CustomerFileWidget
    from ui.contract_hub import ContractHubPage
    widgets.append(("CustomerFileWidget", CustomerFileWidget(None, customer_service.get_customer(cid), embedded=True)))
    hub = ContractHubPage(None, embedded=True)
    hub.load_contract(kid)
    widgets.append(("ContractHubPage", hub))

    for label, widget in widgets:
        trigger_menus(widget, label)

    print("=" * 60, flush=True)
    print("menu_actions", len(TRIGGERS), flush=True)
    print("errors", len(ERRORS), flush=True)
    if ERRORS:
        print(ERRORS[0])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
