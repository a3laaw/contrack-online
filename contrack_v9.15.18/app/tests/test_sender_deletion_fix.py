# -*- coding: utf-8 -*-
"""V2.13: حذف الصف مؤجل لما بعد انتهاء إشارة الزر (لا انهيار).

زر × داخل خلية جدول كان يحذف نفسه أثناء clicked عبر removeRow
المباشر — use-after-free يُسقط البرنامج. الإصلاح: QTimer.singleShot.
"""
import os
import sys
import time

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service  # noqa: E402


def _drain(app, ms=400):
    end = time.time() + ms / 1000.0
    while time.time() < end:
        app.processEvents()
        time.sleep(0.02)


def main() -> None:
    database.init_db()
    customer_service.add_customer(Customer(
        customer_code="C-DEL1", name="عميل حذف", phone="9011"))

    from PySide6.QtWidgets import QApplication, QPushButton
    from ui.custody_center import CustodySettlementDialog
    from ui.vouchers import GroupedPaymentDialog

    app = QApplication.instance() or QApplication([])

    # ---- تصفية عهدة: إضافة بند ← حذف المحدد ← صفر (بلا عطل) ----
    dlg = CustodySettlementDialog()
    dlg.show()
    _drain(app)
    assert dlg.table.rowCount() == 0
    dlg._lines.append({"vdate": "2026-09-01", "expense_account_id": 1,
                       "acc_name": "مواد", "party": "",
                       "expense_customer_id": None, "cust_name": "",
                       "project_id": None, "contract_id": None,
                       "con_name": "", "amount": 50.0, "description": ""})
    dlg._refresh_lines()
    _drain(app)
    assert dlg.table.rowCount() == 1
    dlg._load_line(0)
    dlg.del_btn.click()  # الحذف خارج الجدول — لا حذف للمرسل أثناء الإشارة
    _drain(app)
    assert dlg.table.rowCount() == 0, "البند حُذف"
    assert "عدد البنود: 0" in dlg.total_lbl.text()
    dlg.close()

    # ---- سند: إضافة صف ← × ← حُذف ----
    v = GroupedPaymentDialog()
    v.show()
    _drain(app)
    v.add_btn.click()
    _drain(app)
    tables = [t for t in v._tab_tables.values() if t.rowCount() > 0]
    assert tables, "صف أُضيف"
    t = tables[0]
    n0 = t.rowCount()
    xb = None
    for c in range(t.columnCount()):
        w = t.cellWidget(n0 - 1, c)
        if isinstance(w, QPushButton) and w.text() == "×":
            xb = w
            break
    assert xb is not None
    xb.click()
    _drain(app)
    assert t.rowCount() == n0 - 1, "صف السند حُذف بعد انتهاء الإشارة"
    v.close()

    print("OK: حذف الصف مؤجل ولا انهيار")
    app.quit()


if __name__ == "__main__":
    main()
