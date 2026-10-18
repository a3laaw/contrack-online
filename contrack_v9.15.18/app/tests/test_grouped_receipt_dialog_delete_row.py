# -*- coding: utf-8 -*-
"""حذف سطر محدد من جدول سند القبض المجمع مع تأكيد."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from ui import vouchers  # noqa: E402


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    dlg = vouchers.VoucherDialog(None, "receipt")
    dlg.grouped_receipt_check.setChecked(True)
    while dlg.group_table.rowCount() < 3:
        dlg._add_group_row(False)
    calls = []
    old_confirm = vouchers.style.confirm
    try:
        vouchers.style.confirm = lambda parent, text, title="تأكيد": calls.append((text, title)) or True
        btn = dlg.group_table.cellWidget(1, 4)
        dlg._remove_group_row(btn)
    finally:
        vouchers.style.confirm = old_confirm
    assert dlg.group_table.rowCount() == 2
    assert calls and "حذف السطر رقم 2" in calls[0][0]
    print("OK: حذف سطر محدد من السند المجمع يتطلب تأكيدًا")
    app.quit()


if __name__ == "__main__":
    main()
