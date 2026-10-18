# -*- coding: utf-8 -*-
"""V2.07 بند 6 (يُحدَّث): زر تعديل أمام كل عقد + تحرير مالية العقد."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import (  # noqa: E402
    contract_service, customer_service, lifecycle_service as lc)
from ui import style  # noqa: E402
from ui.archive import CustomerFileWidget  # noqa: E402
from ui.contracts import ContractDialog  # noqa: E402


def main() -> None:
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code="C-CA1", name="عميل إجراءات", phone="9003"))
    kid = contract_service.add_contract(Contract(
        contract_number="CON-CA1", customer_id=cid,
        contract_date="2026-01-01", description="اختبار", amount=5000))
    app = QApplication.instance() or QApplication([])

    # زر تعديل أمام كل عقد في الجدول (بدل زر/قائمة إجراءات العقد)
    # (إلغاء الاختيار يعرض تنبيهًا إعلاميًا — نكتم النوافذ أثناء الفحص)
    old_info = style.info
    style.info = lambda *a, **k: None
    try:
        w = CustomerFileWidget(None, customer_service.get_customer(cid),
                               open_page="contracts")
        w.show()
        app.processEvents()
        assert not hasattr(w, "contract_actions_btn"), "زر إجراءات العقد محذوف"
        assert w.cons_table.columnCount() == 4
        assert w.cons_table.rowCount() >= 1
        for r in range(w.cons_table.rowCount()):
            cell = w.cons_table.cellWidget(r, 3)
            assert cell is not None and cell.text() == "✎ تعديل", \
                "كل عقد أمامه زر تعديل"
        assert "CON-CA1" in w.cons_table.cellWidget(0, 3).toolTip() or \
            "تعديل" in w.cons_table.cellWidget(0, 3).toolTip()
    finally:
        style.info = old_info

    # تحرير المالية: القيمة + الدفعات معًا ثم حفظ
    old_error = style.error
    style.error = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("ERROR POPUP"))
    try:
        d = ContractDialog(None, contract_service.get_contract(kid))
        d.show()
        app.processEvents()
        assert d.amount.isEnabled() and not d.amount.isReadOnly()
        d.focus_amount()
        d.focus_plan()
        app.processEvents()
        d.amount.setValue(7000.0)
        tbl = d.plan_table
        assert tbl.rowCount() > 0
        total = sum(float((tbl.item(r, 3).text() if tbl.item(r, 3) else "0"
                           ).replace(",", "") or 0)
                    for r in range(tbl.rowCount()))
        diff = round(7000.0 - total, 3)
        first = float((tbl.item(0, 3).text() or "0").replace(",", ""))
        tbl.item(0, 3).setText(f"{first + diff:,.3f}")
        app.processEvents()
        d._save()
        assert contract_service.get_contract(kid).amount == 7000.0
        plan_total = round(sum(float(p.get("amount") or 0)
                               for p in lc.contract_payment_plan(kid)), 3)
        assert plan_total == 7000.0, plan_total
    finally:
        style.error = old_error
    print("OK: زر تعديل أمام كل عقد + تحرير قيمة العقد ودفعاته")
    app.quit()


if __name__ == "__main__":
    main()
