# -*- coding: utf-8 -*-
"""V2.07 بند 3: النوافذ تكبر وتصغر مع المحتوى (صفوف/تبديل أوضاع)."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service  # noqa: E402
from ui import vouchers  # noqa: E402


def main() -> None:
    database.init_db()
    customer_service.add_customer(Customer(
        customer_code="C-DS1", name="عميل تحجيم", phone="9002"))
    app = QApplication.instance() or QApplication([])
    old_confirm = vouchers.style.confirm
    vouchers.style.confirm = lambda *a, **k: True
    try:
        dlg = vouchers.VoucherDialog(None, "receipt")
        dlg.show()
        app.processEvents()
        h_single = dlg.height()
        dlg.grouped_receipt_check.setChecked(True)
        app.processEvents()
        h_group1 = dlg.height()
        assert h_group1 > h_single, (h_single, h_group1)
        for _ in range(5):
            dlg._add_group_row(False)
        app.processEvents()
        h_group6 = dlg.height()
        assert h_group6 > h_group1, (h_group1, h_group6)
        t = dlg._group_tables["customer"]
        for _ in range(4):
            dlg._remove_group_row(t.cellWidget(t.rowCount() - 1, 4))
            app.processEvents()
        h_group2 = dlg.height()
        assert h_group2 < h_group6, (h_group6, h_group2)

        g = vouchers.GroupedPaymentDialog(None)
        g.show()
        app.processEvents()
        g1 = g.height()
        for _ in range(4):
            g._add_row()
        app.processEvents()
        assert g.height() > g1, (g1, g.height())
    finally:
        vouchers.style.confirm = old_confirm
    print("OK: النمو والانكماش الديناميكي للنوافذ")
    app.quit()


if __name__ == "__main__":
    main()
