# -*- coding: utf-8 -*-
"""V4.54: مراجعة التقرير المالي — إخفاء التصفية، تجميع العمولات شهريًا،
إلغاء الهاتف، قسم المسترد، وإصلاح المنطق (المرتجع داخل / الخصم خارج)."""
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

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} :: {extra}")


with get_connection() as c:
    c.execute("UPDATE settings SET opening_balance=0, opening_balance_cash=0,"
              " opening_balance_bank=0 WHERE id=1")
aid = ea.custody_items()[0][1]
exp = [a for a in ea.posting_items() if a[1]][0]
fee_acc = exp[1]

# عهدة: تسليم 1000 نقدًا + تصفية 600 + رد 300
lc.add_voucher("payment", "2026-09-01", "موظف", "نقدًا", "", 1000.0,
               "تسليم عهدة", custody_account_id=aid)
lc.add_custody_settlement(
    "2026-09-05", aid,
    [{"amount": 600.0, "expense_account_id": exp[1],
      "party": "مورد", "description": "بنزين"}])
lc.add_custody_return("2026-09-10", aid, 300.0, "موظف", "الصندوق")
# سلفة: 500 + رد 200 + خصم 100
e1 = lc.add_employee("سالم 454", "90000001")
lc.add_employee_advance("2026-09-02", e1, 500.0, "الصندوق")
lc.add_advance_cash_return("2026-09-12", e1, 200.0, "الصندوق")
lc.add_salary_deduction("2026-09-15", e1, 100.0)
# عمولات: 3 في سبتمبر (رسمان + بوابات) + 1 في أغسطس
lc.add_voucher("payment", "2026-09-20", "البنك", "تحويل بنكي", "البنك", 5.0,
               "رسوم", expense_account_id=fee_acc, notes="[رسوم بنك] اختبار")
lc.add_voucher("payment", "2026-09-21", "البنك", "تحويل بنكي", "البنك", 7.0,
               "رسوم", expense_account_id=fee_acc, notes="[رسوم بنك] اختبار")
lc.add_voucher("payment", "2026-09-22", "البنك", "تحويل بنكي", "البنك", 3.0,
               "عمولة", expense_account_id=fee_acc, notes="[عمولة بوابات] اختبار")
lc.add_voucher("payment", "2026-08-15", "البنك", "تحويل بنكي", "البنك", 4.0,
               "رسوم", expense_account_id=fee_acc, notes="[رسوم بنك] اختبار")
# إيراد سبتمبر
lc.add_voucher("receipt", "2026-09-25", "عميل", "نقدي", "الصندوق",
               2000.0, "تحصيل")

print("=== 1. التصفية غائبة ===")
d = rep.cash_flow_detail("2026-09-01", "2026-09-30")
check("لا سطور تصفية", not any(p.get("settlement") for p in d["payments"]),
      d["payments"])
check("المنصرف: تسليم + سلفة غير مسترجعة + عمولات = 1215 (المسترجع 300 خارج المصروف)",
      sorted(p["amount"] for p in d["payments"]) == [15.0, 200.0, 1000.0]
      and d["totals"]["out"] == 1215.0, d["totals"]["out"])

print("=== 2. العمولات مجمّعة شهريًا ===")
fees = [p for p in d["payments"] if p.get("fee_aggregate")]
check("سطر مجمّع واحد لسبتمبر = 15 عن 3 عمليات",
      len(fees) == 1 and fees[0]["amount"] == 15.0
      and "3" in fees[0]["note"] and "سبتمبر" in fees[0]["date"], fees)
da = rep.cash_flow_detail("2026-08-01", "2026-08-31")
fa = [p for p in da["payments"] if p.get("fee_aggregate")]
check("أغسطس سطر مستقل = 4",
      len(fa) == 1 and fa[0]["amount"] == 4.0, fa)

print("=== 3. المسترد نقد داخل ===")
check("استرداد نقدي للعهدة = 300 (رد السلفة والخصم خارجه)",
      len(d["recoveries"]) == 1
      and d["totals"]["recoveries"] == 300.0, d["totals"])
check("السلف المسترجعة = 300 (رد نقدي 200 + خصم راتب 100)",
      d["totals"]["advance_returned_total"] == 300.0, d["totals"])
check("الصافي = 2000 − 1215 + 300 − 100 (أثر السلفة) = 985", d["totals"]["net"] == 985.0,
      d["totals"]["net"])
check("الصندوق 1000 والبنك −19",
      d["totals"]["cash"] == 1000.0 and d["totals"]["bank"] == -19.0,
      (d["totals"]["cash"], d["totals"]["bank"]))

print("=== 4. الخصم خارج الكشف ===")
_all = d["receipts"] + d["payments"] + d["recoveries"] + d["transfers"]
check("لا سطر بمبلغ الخصم 100", not any(i["amount"] == 100.0 for i in _all),
      [i["amount"] for i in _all])

print("=== 5. الملخص ===")
m = rep.cash_flow_report("2026-09-01", "2026-09-30", "monthly")
r = m["rows"][0]
check("صف واحد شهري", len(m["rows"]) == 1, len(m["rows"]))
check("وارد/منصرف/مسترد", r["inflow"] == 2000.0 and r["outflow"] == 1215.0
      and r["recoveries"] == 300.0, r)
check("رسوم البنك تشمل النوعين = 15", r["bank_fees"] == 15.0, r["bank_fees"])
check("الصافي 985 والافتتاحي −4 والختامي 981",
      r["net"] == 985.0 and r["balance"] == 981.0
      and m["totals"]["opening"] == -4.0
      and m["totals"]["closing"] == 981.0,
      (m["totals"]["opening"], m["totals"]["closing"]))
m2 = rep.cash_flow_report("2026-09-11", "2026-09-30", "monthly")
check("ما قبل الفترة: مرتجع داخل وخصم مُتجاهَل = −1204",
      m2["totals"]["opening"] == -1204.0
      and m2["totals"]["closing"] == 981.0,
      (m2["totals"]["opening"], m2["totals"]["closing"]))

print("=== 6. الواجهة بلا هاتف ===")
from ui import reports_page  # noqa: E402

full = reports_page._data_cash_flow("detail", "2026-09-01", "2026-09-30")
check("6 أعمدة بلا هاتف", full["heads"] == ["م", "التاريخ", "العميل",
      "العقد", "المبلغ", "البيان"], full["heads"])
check("كل الصفوف 6", all(len(x) == 6 for x in full["rows"]),
      {len(x) for x in full["rows"]})
check("قسم المسترد وإجماليه",
      any("المسترد" in str(x[1]) for x in full["rows"])
      and "الإجمالي · المسترد" in full["accent_rows"], "")
ro = reports_page._data_cash_flow("recoveries_only")
check("كشف مسترد فقط", ro["heads"][4] == "المبلغ"
      and ro["totals"][4] == 500.0, ro["totals"])
per = reports_page._data_cash_flow("monthly", "2026-09-01", "2026-09-30")
check("الملخص 7 أعمدة بالمسترد", per["heads"] == ["الفترة", "الوارد",
      "المنصرف", "المسترد", "منها رسوم بنك", "صافي الفترة", "الرصيد"]
      and "المسترد" in per["note"], per["heads"])

print("=== 7. الضمانات ===")
ex = rep.expenses_report("2026-09-01", "2026-09-30")
check("التصفية باقية في المصروفات",
      any("بنزين" in str(x) for x in ex["rows"]), len(ex["rows"]))

print(f"\nV4.54 financial-report: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
