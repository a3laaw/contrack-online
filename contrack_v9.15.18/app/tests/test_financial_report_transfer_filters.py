# -*- coding: utf-8 -*-
"""التقرير المالي يوفر كشف وارد فقط/منصرف فقط/تحويلات داخلية فقط."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
database.init_db()

from services import lifecycle_service as lc  # noqa: E402
from ui import reports_page  # noqa: E402


def main():
    today = date.today().isoformat()
    lc.add_voucher("receipt", today, "عميل", "البنك", "", 200, "إيراد")
    lc.add_voucher("payment", today, "مورد", "البنك", "مصروف إداري", 50, "مصروف")
    lc.add_voucher("transfer", today, "تحويل داخلي", "البنك", "الصندوق", 100, "تحويل")

    income = reports_page._data_cash_flow("receipts_only")
    expense = reports_page._data_cash_flow("payments_only")
    transfers = reports_page._data_cash_flow("transfers_only")
    full = reports_page._data_cash_flow("detail")

    assert "وارد فقط" in income["note"] and len(income["rows"]) == 1
    assert "منصرف فقط" in expense["note"] and len(expense["rows"]) == 1
    assert "تحويلات داخلية فقط" in transfers["note"] and len(transfers["rows"]) == 1
    assert "لا تُحسب ضمن المنصرف ولا الوارد" in transfers["note"]
    assert any("تحويلات داخلية" in str(r) for r in full["rows"])

    opts = next(r for r in reports_page._REPORTS if r["key"] == "rep_cashflow")["options_filter"]["items"]
    values = [v for _, v in opts]
    assert "receipts_only" in values and "payments_only" in values and "transfers_only" in values
    print("OK: التقرير المالي يدعم وارد فقط ومنصرف فقط وتحويلات داخلية فقط")


if __name__ == "__main__":
    main()
