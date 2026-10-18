# -*- coding: utf-8 -*-
"""V2.07 بند 1: سند القبض المجمع بتابي عميل/مقاول باطن + حفظ مختلط."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service, lifecycle_service as lc  # noqa: E402
from ui import vouchers  # noqa: E402


def main() -> None:
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code="C-GT1", name="عميل مجمع", phone="9001"))
    sid = lc.add_subcontractor("SUB-GT1", "مقاول مجمع")
    app = QApplication.instance() or QApplication([])

    dlg = vouchers.VoucherDialog(None, "receipt")
    # التابات موجودة + لا لافتة تحويل داخلي في القبض
    assert hasattr(dlg, "group_tabs") and dlg.group_tabs.count() == 2
    names = [b.text() for b in dlg.group_tabs._buttons]
    assert names == ["عميل", "مقاول باطن"], names
    labels = [w.text() for w in dlg.findChildren(
        __import__("PySide6.QtWidgets", fromlist=["QLabel"]).QLabel)]
    assert not any("التحويل الداخلي" in t for t in labels)
    dlg.grouped_receipt_check.setChecked(True)
    assert dlg.group_table is dlg._group_tables["customer"]

    # سطر عميل في التاب الأول
    t_cust = dlg._group_tables["customer"]
    while t_cust.rowCount() < 1:
        dlg.group_tabs.setCurrentIndex(0)
        dlg._add_group_row(False)
    box = t_cust.cellWidget(0, 0)
    box.setCurrentIndex(box.findData(cid))
    t_cust.cellWidget(0, 2).setValue(100.0)

    # سطر مقاولة في التاب الثاني + تبديل الاسم المستعار
    dlg.group_tabs.setCurrentIndex(1)
    assert dlg.group_table is dlg._group_tables["subcontractor"]
    t_sub = dlg._group_tables["subcontractor"]
    dlg._add_group_row(False)
    box2 = t_sub.cellWidget(0, 0)
    assert box2.findData(sid) >= 0
    box2.setCurrentIndex(box2.findData(sid))
    t_sub.cellWidget(0, 2).setValue(200.0)
    names = [b.text() for b in dlg.group_tabs._buttons]
    assert names == ["عميل (1)", "مقاول باطن (1)"], names

    rows = dlg._grouped_rows_data()
    assert len(rows) == 2
    by_type = {r["party_type"]: r for r in rows}
    assert by_type["customer"]["party_id"] == cid
    assert by_type["subcontractor"]["party_id"] == sid

    # حفظ خلفي مختلط: سندان بأنواع صحيحة
    res = lc.add_grouped_receipts("2026-09-01", "تحويل بنكي", "", rows)
    assert len(res["receipt_ids"]) == 2
    got = {}
    with database.get_connection() as conn:
        for vid in res["receipt_ids"]:
            row = conn.execute(
                "SELECT party_type, party_id, amount FROM vouchers WHERE id=?",
                (vid,)).fetchone()
            got[row["party_type"]] = (row["party_id"], row["amount"])
    assert got["customer"] == (cid, 100.0), got
    assert got["subcontractor"] == (sid, 200.0), got
    print("OK: تابا القبض المجمع + حفظ مختلط بنوعي الطرف")
    app.quit()


if __name__ == "__main__":
    main()
