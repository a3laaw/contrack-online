# -*- coding: utf-8 -*-
"""V4.55: إصلاحات المراجعة المحاسبية (1-6)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402

if os.path.isdir("data"):
    import shutil  # noqa: E402
    shutil.rmtree("data")
db.init_db()
from database.database import get_connection  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} :: {extra}")


def J(vid):
    with get_connection() as c:
        return c.execute(
            "SELECT debit_account d, credit_account c, amount a "
            "FROM journal_entries WHERE source_id=? "
            "AND source_type!='voucher_cancel'", (vid,)).fetchall()


aid = ea.custody_items()[0][1]
exp = [a for a in ea.posting_items() if a[1]][0]

print("=== 1. المصروفات تستبعد التسليم والشريك ===")
lc.add_voucher("payment", "2026-09-01", "موظف", "نقدًا", "", 1000.0,
               "تسليم عهدة", custody_account_id=aid)
lc.add_custody_settlement(
    "2026-09-05", aid,
    [{"amount": 600.0, "expense_account_id": exp[1],
      "party": "مورد", "description": "بنزين"}])
lc.add_voucher("payment", "2026-09-06", "الشريك", "تحويل بنكي",
               "جاري الشريك", 200.0, "مسحوبات", party_type="partner")
lc.add_voucher("payment", "2026-09-07", "مورد", "نقدي", "الصندوق", 150.0,
               "قرطاسية", expense_account_id=exp[1])
ex = rep.expenses_report("2026-09-01", "2026-09-30")
check("الإجمالي 750 (600 + 150)",
      abs(ex["total"] - 750.0) < 0.001, ex["total"])
check("لا تسليم ولا مسحوبات",
      not any(r["amount"] in (1000.0, 200.0) for r in ex["rows"]),
      [r["amount"] for r in ex["rows"]])
check("التصفية باقية", any("بنزين" in str(r) for r in ex["rows"]), "")

print("=== 2. تعديل الشريك يحفظ القيد ===")
pr = lc.add_voucher("receipt", "2026-09-10", "الشريك", "تحويل بنكي",
                    "جاري الشريك", 1000.0, "تمويل", party_type="partner")
lc.update_voucher(pr, "2026-09-10", "تحويل بنكي", 900.0, "تمويل",
                  party_type="partner", party="الشريك",
                  account="جاري الشريك")
_j = [tuple(x) for x in J(pr)]
check("قيد التمويل بعد التعديل",
      _j == [("البنك", "جاري الشريك", 900.0)], _j)
pp = lc.add_voucher("payment", "2026-09-11", "الشريك", "تحويل بنكي",
                    "جاري الشريك", 200.0, "مسحوبات", party_type="partner")
lc.update_voucher(pp, "2026-09-11", "تحويل بنكي", 150.0, "مسحوبات",
                  party_type="partner", party="الشريك",
                  account="جاري الشريك")
_j2 = [tuple(x) for x in J(pp)]
check("قيد المسحوبات بعد التعديل",
      _j2 == [("جاري الشريك", "البنك", 150.0)], _j2)

print("=== 3. منع تعديل المرتجع/الخصم ===")
e1 = lc.add_employee("فهد 455", "90000001")
lc.add_employee_advance("2026-09-02", e1, 500.0, "الصندوق")
cr = lc.add_custody_return("2026-09-12", aid, 100.0, "موظف", "الصندوق")
sd = lc.add_salary_deduction("2026-09-13", e1, 50.0)
for _vid, _name in ((cr, "المرتجع"), (sd, "الخصم")):
    try:
        lc.update_voucher(_vid, "2026-09-12", "الصندوق", 10.0, "x")
        check(f"تعديل {_name} ممنوع", False, "no raise")
    except ValidationError:
        check(f"تعديل {_name} ممنوع", True)
lc.update_voucher_description(cr, "رد معدل البيان")
with get_connection() as c:
    _d = c.execute("SELECT description FROM vouchers WHERE id=?",
                   (cr,)).fetchone()[0]
check("تعديل البيان فقط مسموح", _d == "رد معدل البيان", _d)

print("=== 4. حارس إلغاء التسليم/السلفة ===")
with get_connection() as c:
    _h = c.execute("SELECT id FROM vouchers WHERE description='تسليم عهدة'"
                   ).fetchone()[0]
    _lines = [r[0] for r in c.execute(
        "SELECT id FROM vouchers WHERE custody_account_id=? "
        "AND COALESCE(expense_group_ref,'')<>'' "
        "AND COALESCE(cancelled,0)=0", (aid,))]
try:
    lc.cancel_voucher(_h, "اختبار")
    check("إلغاء التسليم مع التصفية ممنوع", False, "no raise")
except ValidationError:
    check("إلغاء التسليم مع التصفية ممنوع", True)
h2 = lc.add_voucher("payment", "2026-09-14", "موظف", "نقدًا", "", 500.0,
                    "تسليم2", custody_account_id=aid)
r2 = lc.add_custody_return("2026-09-15", aid, 50.0, "موظف", "الصندوق")
try:
    lc.cancel_voucher(h2, "اختبار")
    check("إلغاء التسليم مع الرد ممنوع", False, "no raise")
except ValidationError:
    check("إلغاء التسليم مع الرد ممنوع", True)
with get_connection() as c:
    _a = c.execute("SELECT id FROM vouchers WHERE advance_employee_id=? "
                   "AND vtype='payment'", (e1,)).fetchone()[0]
try:
    lc.cancel_voucher(_a, "اختبار")
    check("إلغاء السلفة مع الرد/الخصم ممنوع", False, "no raise")
except ValidationError:
    check("إلغاء السلفة مع الرد/الخصم ممنوع", True)
# الترتيب الصحيح يعمل: رد ← خصم ← تصفية ← تسليم/سلفة
lc.cancel_voucher(r2, "t")
lc.cancel_voucher(cr, "t")
lc.cancel_voucher(sd, "t")
for _lid in _lines:
    lc.cancel_voucher(_lid, "t")
lc.cancel_voucher(h2, "t")
lc.cancel_voucher(_h, "t")
lc.cancel_voucher(_a, "t")
check("الإلغاء بالترتيب يعمل",
      all(b["balance"] == 0.0 for b in lc.custody_balances())
      and lc.employee_balance(e1) == 0.0, "")

print("=== 5. إجماليات السندات ===")
lc.add_voucher("receipt", "2026-10-01", "عميل", "نقدي", "الصندوق",
               2000.0, "تحصيل")
lc.add_voucher("payment", "2026-10-02", "مورد", "نقدي", "الصندوق", 300.0,
               "مصروف", expense_account_id=exp[1])
lc.add_voucher("payment", "2026-10-03", "موظف", "نقدًا", "", 500.0,
               "تسليم أكتوبر", custody_account_id=aid)
lc.add_custody_settlement(
    "2026-10-04", aid,
    [{"amount": 200.0, "expense_account_id": exp[1],
      "party": "مورد", "description": "ديزل"}])
lc.add_custody_return("2026-10-05", aid, 100.0, "موظف", "الصندوق")
lc.add_voucher("receipt", "2026-10-06", "الشريك", "تحويل بنكي",
               "جاري الشريك", 700.0, "تمويل", party_type="partner")
lc.add_voucher("payment", "2026-10-07", "الشريك", "تحويل بنكي",
               "جاري الشريك", 100.0, "مسحوبات", party_type="partner")
lc.add_employee_advance("2026-10-08", e1, 400.0, "الصندوق")
lc.add_salary_deduction("2026-10-09", e1, 50.0)
vp = rep.vouchers_period("2026-10-01", "2026-10-31")
check("الوارد 2000 (الشريك مستبعد)", vp["total_in"] == 2000.0,
      vp["total_in"])
check("المنصرف 1200 (بلا تصفية/شريك)", vp["total_out"] == 1200.0,
      vp["total_out"])
check("المسترد 100 والصافي 900",
      vp["recoveries"] == 100.0 and vp["net"] == 900.0,
      (vp["recoveries"], vp["net"]))
from ui import reports_page  # noqa: E402

vn = reports_page._data_vouchers_unified("2026-10-01", "2026-10-31")
check("الملاحظة تعرض الأربعة",
      "المسترد" in vn["note"] and "900.000" in vn["note"], vn["note"])

print("=== 6. مزامنة أطفال التحويل ===")
lc.add_voucher("receipt", "2026-10-15", "عميل", "نقدي", "الصندوق",
               10000.0, "تمويل تحويل")
tr = lc.add_voucher("transfer", "2026-10-16", "", "الصندوق", "البنك",
                    1000.0, "تحويل داخلي")
kid = lc.add_voucher("payment", "2026-10-16", "بوابة", "الصندوق",
                     "البنك", 20.0, "عمولة", expense_account_id=exp[1],
                     notes="[عمولة بوابات]", parent_voucher_id=tr)
lc.update_voucher(tr, "2026-10-17", "نقدًا", 1000.0, "تحويل داخلي",
                  account="البنك")
with get_connection() as c:
    _k = c.execute("SELECT vdate, method, amount FROM vouchers WHERE id=?",
                   (kid,)).fetchone()
    _kj = c.execute("SELECT entry_date, amount FROM journal_entries "
                    "WHERE source_id=? AND source_type!='voucher_cancel'",
                    (kid,)).fetchone()
check("التابع تزامن تاريخ/طريقة والمبلغ ثابت",
      tuple(_k) == ("2026-10-17", "نقدًا", 20.0)
      and tuple(_kj) == ("2026-10-17", 20.0), (tuple(_k), tuple(_kj)))

print("=== 7. الإلغاء العادي سليم ===")
px = lc.add_voucher("payment", "2026-09-20", "مورد", "نقدي", "الصندوق",
                    150.0, "عادي", expense_account_id=exp[1])
lc.cancel_voucher(px, "t")
with get_connection() as c:
    _rc = c.execute("SELECT COUNT(*) FROM journal_entries "
                    "WHERE source_type='voucher_cancel' AND source_id=?",
                    (px,)).fetchone()[0]
check("قيد عكسي للإلغاء العادي", _rc == 1, _rc)

print(f"\nV4.55 accounting-review: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
