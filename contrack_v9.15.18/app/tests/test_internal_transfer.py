# -*- coding: utf-8 -*-
"""التحويل الداخلي بين البنك والصندوق لا يُحسب كمنصرف ولا يتجاوز الرصيد."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
database.init_db()

from services import lifecycle_service as lc, report_service  # noqa: E402


def main():
    today = date.today().isoformat()
    try:
        lc.add_voucher("transfer", today, "تحويل داخلي", "البنك", "الصندوق", 100, "غير صحيح")
        raise AssertionError("يجب منع التحويل من بنك رصيده صفر")
    except Exception as exc:
        assert "رصيد" in str(exc) and "البنك" in str(exc)

    # إدخال وارد بنكي لتكوين رصيد فعلي في البنك قبل التحويل.
    lc.add_voucher("receipt", today, "رصيد بنكي", "البنك", "", 100.000, "رصيد اختبار")

    try:
        lc.add_voucher("transfer", today, "تحويل داخلي", "البنك", "الصندوق", 150, "أكبر من الرصيد")
        raise AssertionError("يجب منع التحويل الأكبر من رصيد الحساب المصدر")
    except Exception as exc:
        assert "أكبر من رصيد" in str(exc)

    vid = lc.add_voucher(
        "transfer", today, "تحويل داخلي", "البنك", "الصندوق",
        100.000, "تحويل داخلي من البنك إلى الصندوق")
    with database.get_connection() as conn:
        v = conn.execute("SELECT * FROM vouchers WHERE id=?", (vid,)).fetchone()
        j = conn.execute("SELECT * FROM journal_entries WHERE source_id=? AND source_type='voucher_transfer'", (vid,)).fetchone()
    assert v["vtype"] == "transfer"
    assert v["party_type"] == "transfer"
    assert v["method"] == "البنك" and v["account"] == "الصندوق"
    assert not v["contract_id"] and not v["project_id"]
    assert j["debit_account"] == "الصندوق" and j["credit_account"] == "البنك"

    try:
        lc.add_voucher("transfer", today, "تحويل داخلي", "البنك", "البنك", 10, "غير صحيح")
        raise AssertionError("يجب منع التحويل بين الحساب نفسه")
    except Exception as exc:
        assert "نفس" in str(exc)
    try:
        lc.add_voucher("transfer", today, "تحويل داخلي", "البنك", "الصندوق", 0, "غير صحيح")
        raise AssertionError("يجب منع المبلغ الصفري")
    except Exception as exc:
        assert "أكبر من صفر" in str(exc)

    d = report_service.cash_flow_detail()
    assert len(d["receipts"]) == 1
    assert len(d["transfers"]) == 1
    assert d["totals"]["out"] == 0, "التحويل الداخلي لا يدخل ضمن المنصرف"
    assert d["totals"]["in"] == 100, "الوارد فقط هو الإيراد"
    assert d["totals"]["net"] == 100, "التحويل الداخلي لا يؤثر على صافي الحركة"
    assert d["totals"]["bank"] == 0
    assert d["totals"]["cash"] == 100

    lc.update_voucher(vid, today, "البنك", 40.0, "تحويل داخلي معدل", account="الصندوق", party_type="transfer")
    with database.get_connection() as conn:
        j2 = conn.execute("SELECT * FROM journal_entries WHERE source_id=? AND source_type='voucher_transfer'", (vid,)).fetchone()
    assert j2["debit_account"] == "الصندوق" and j2["credit_account"] == "البنك" and float(j2["amount"]) == 40.0
    d2 = report_service.cash_flow_detail()
    assert d2["totals"]["out"] == 0 and d2["totals"]["net"] == 100
    assert d2["totals"]["bank"] == 60 and d2["totals"]["cash"] == 40

    lc.cancel_voucher(vid, "اختبار الإلغاء")
    d3 = report_service.cash_flow_detail()
    assert len(d3["transfers"]) == 0
    assert d3["totals"]["bank"] == 100 and d3["totals"]["cash"] == 0
    with database.get_connection() as conn:
        rev = conn.execute("SELECT * FROM journal_entries WHERE source_id=? AND source_type='voucher_cancel'", (vid,)).fetchone()
    assert rev is not None, "الإلغاء يجب أن ينشئ قيدًا عكسيًا ولا يحذف أثر اليومية"
    print("OK: التحويل الداخلي لا يُحسب كمنصرف ولا يتجاوز رصيد الحساب المصدر")


if __name__ == "__main__":
    main()
