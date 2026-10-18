# -*- coding: utf-8 -*-
"""V4.53: سلف الموظفين — صرف/رد/خصم + الاسترداد يخفض المصروف.

يغطي: الموظفين (إضافة/تفرد/إيقاف) · السلفة مصروفًا · الرد النقدي
(خزينة + تخفيض مصروف بلا إيراد) · الخصم (رواتب/تخفيض سلفة بلا
نقدية) · سقوف المتبقي · القيود · الدفتر · الترحيل · دخاني الشاشة.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.database import get_connection  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


def _journal(vid):
    with get_connection() as _c:
        return [dict(r) for r in _c.execute(
            "SELECT * FROM journal_entries WHERE source_id=? "
            "AND source_type LIKE 'voucher_%' AND source_type!='voucher_cancel'"
            " ORDER BY id", (vid,)).fetchall()]


def _exp_total():
    return rep.expenses_report("2026-09-01", "2026-09-30")["total"]


print("=== 1. الموظفون والحسابات ===")
e1 = lc.add_employee("أحمد السلفة", "90000453", "اختبار")
check("إضافة موظف", e1 > 0 and lc.get_employee(e1)["name"] == "أحمد السلفة")
try:
    lc.add_employee("أحمد السلفة")
    _dup = "accepted?!"
except Exception as ex:
    _dup = str(ex)
check("الاسم فريد", "موجود" in _dup, _dup)
_sid, _spath = lc.ensure_employee_advance_account()
_rid, _rpath = lc.ensure_salary_account()
check("حسابا السلف والرواتب",
      _sid > 0 and _rid > 0 and "سلف" in _spath and "رواتب" in _rpath,
      (_spath, _rpath))

print("=== 2. السلفة مصروف ===")
_cash0 = lc.cash_account_balances()["total"]
_exp0 = _exp_total()
a1 = lc.add_employee_advance("2026-09-10", e1, 500.0, "الصندوق")
check("الرصيد 500", abs(lc.employee_balance(e1) - 500.0) < 0.001)
check("النقدية خرجت 500",
      abs(lc.cash_account_balances()["total"] - _cash0 + 500.0) < 0.001)
check("المصروف زاد 500", abs(_exp_total() - _exp0 - 500.0) < 0.001)
_ja = _journal(a1)
check("قيد السلفة: مدين سلف دائن صندوق",
      _ja and "سلف" in _ja[0]["debit_account"]
      and "الصندوق" in _ja[0]["credit_account"], _ja)
with get_connection() as _c:
    _av = dict(_c.execute("SELECT * FROM vouchers WHERE id=?",
                          (a1,)).fetchone())
check("سند صرف PV مربوط بالموظف",
      _av["vtype"] == "payment" and _av["advance_employee_id"] == e1
      and (_av["voucher_number"] or "").startswith("PV-"), _av)

print("=== 3. الرد النقدي يخفض المصروف ===")
r1 = lc.add_advance_cash_return("2026-09-15", e1, 200.0, "الصندوق")
check("المتبقي 300", abs(lc.employee_balance(e1) - 300.0) < 0.001)
check("النقدية عادت 200",
      abs(lc.cash_account_balances()["total"] - _cash0 + 300.0) < 0.001)
check("المصروف انخفض 200", abs(_exp_total() - _exp0 - 300.0) < 0.001)
_jr = _journal(r1)
check("قيد الرد: مدين صندوق دائن سلف",
      _jr and "الصندوق" in _jr[0]["debit_account"]
      and "سلف" in _jr[0]["credit_account"], _jr)
_vp = rep.vouchers_period("2026-09-01", "2026-09-30")
check("بلا أثر إيرادي", abs(_vp["total_in"]) < 0.001, _vp["total_in"])
try:
    lc.add_advance_cash_return("2026-09-15", e1, 400.0, "الصندوق")
    _over = "accepted?!"
except Exception as ex:
    _over = str(ex)
check("تجاوز المتبقي مرفوض", "المتبقي" in _over, _over)

print("=== 4. الخصم من الراتب ===")
d1 = lc.add_salary_deduction("2026-09-25", e1, 100.0)
check("المتبقي 200", abs(lc.employee_balance(e1) - 200.0) < 0.001)
check("النقدية ثابتة",
      abs(lc.cash_account_balances()["total"] - _cash0 + 300.0) < 0.001)
_ex = rep.expenses_report("2026-09-01", "2026-09-30")
_salf = sum(float(r["amount"]) for r in _ex["rows"] if "سلف" in (r.get("acc_path") or ""))
_raw = sum(float(r["amount"]) for r in _ex["rows"] if "رواتب" in (r.get("acc_path") or ""))
check("السلف صافي 200 والرواتب 100",
      abs(_salf - 200.0) < 0.001 and abs(_raw - 100.0) < 0.001,
      (_salf, _raw))
_jd = _journal(d1)
check("قيد الخصم: مدين رواتب دائن سلف",
      _jd and "رواتب" in _jd[0]["debit_account"]
      and "سلف" in _jd[0]["credit_account"], _jd)
with get_connection() as _c:
    _dv = dict(_c.execute("SELECT * FROM vouchers WHERE id=?",
                          (d1,)).fetchone())
check("ترقيم SD", (_dv["voucher_number"] or "").startswith("SD-"), _dv)
check("اسم النوع عربي",
      lc.voucher_type_label("salary_deduction") == "خصم من راتب")
_bals = {b["employee_id"]: b for b in lc.employee_balances()}
check("ملخص الأرصدة",
      abs(_bals[e1]["advanced"] - 500.0) < 0.001
      and abs(_bals[e1]["recovered"] - 200.0) < 0.001
      and abs(_bals[e1]["deducted"] - 100.0) < 0.001, _bals[e1])
_led = lc.employee_ledger(e1, "2026-09-01", "2026-09-30")
check("الدفتر 3 حركات ورصيد 200",
      len(_led["rows"]) == 3 and abs(_led["balance"] - 200.0) < 0.001
      and [i["kind"] for i in _led["rows"]] == ["advance", "recover",
                                               "deduct"],
      [(i["kind"], i["balance"]) for i in _led["rows"]])
lc.cancel_voucher(d1, "اختبار")
check("إلغاء الخصم يعيد 300", abs(lc.employee_balance(e1) - 300.0) < 0.001)

print("=== 5. القديم بلا موظف ===")
_old = lc.add_voucher("payment", "2026-09-12", "موظف قديم", "الصندوق",
                      "", 50.0, "سلفة قديمة بلا ربط",
                      expense_account_id=_sid)
check("القديم مصروف عادٍ بلا ربط",
      abs(_exp_total() - _exp0 - 350.0) < 0.001
      and e1 is not None
      and all(b["employee_id"] != 999999 for b in lc.employee_balances()))
with get_connection() as _c:
    _ov = dict(_c.execute("SELECT * FROM vouchers WHERE id=?",
                          (_old,)).fetchone())
check("بلا عمود موظف", _ov["advance_employee_id"] is None)

print("=== 6. دخاني الشاشة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.advances_page import (AdvanceDialog, AdvancesPage,  # noqa: E402
                              CashReturnDialog, DeductDialog)

pg = AdvancesPage()
check("الصفحة تُبنى وتعرض المتبقي 300",
      pg.employee.count() >= 1 and "300" in pg.card_b[1].text(),
      pg.card_b[1].text())
check("جدول صفان (الخصم ملغى)", pg.table.rowCount() == 2, pg.table.rowCount())
ad = AdvanceDialog(None, employee_id=e1)
rd = CashReturnDialog(None, employee_id=e1)
dd = DeductDialog(None, employee_id=e1)
check("النوافذ الثلاث تُبنى",
      "300" in rd.balance_lbl.text() and "300" in dd.balance_lbl.text()
      and abs(rd.amount.maximum() - 300.0) < 0.001)
check("السلفة بلا سقف متبقي", ad.amount.maximum() > 999999.0)

print("")
print(f"V4.53 employee-advances: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
