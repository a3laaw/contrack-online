# -*- coding: utf-8 -*-
"""انحدار V2.42: تصفية العهدة توزيع داخلي — لا تخصم من البنك/الصندوق مرة ثانية."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


import database.database as db  # noqa: E402

db.DB_PATH = "/tmp/custfix.sqlite"
if os.path.exists("/tmp/custfix.sqlite"):
    os.remove("/tmp/custfix.sqlite")
db.init_db()
from database.database import get_connection  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402

with get_connection() as c:
    c.execute("UPDATE settings SET opening_balance=10000, opening_balance_cash=10000,"
              " opening_balance_bank=0 WHERE id=1")

aid = ea.custody_items()[0][1]
exp = [a for a in ea.posting_items() if a[1]][0]
snap = ea.get_account(aid)
csnap = (snap.get("full_path") or snap.get("name") or "").strip()

print("=== 1. خصم واحد فقط ===")
lc.add_voucher("payment", "2026-09-01", "موظف", "نقدًا", "", 1000.0,
               "تسليم عهدة", custody_account_id=aid)
lc.add_custody_settlement(
    "2026-09-05", aid,
    [{"amount": 1000.0, "expense_account_id": exp[1],
      "party": "مورد", "description": "بنزين"}])
b = lc.cash_account_balances()
check("الصندوق 9000 (لا خصم مزدوج)", b["cash"] == 9000.0, b)
t = rep.cash_flow_report()["totals"]
check("الملخص: خارج 1000 ورصيد 9000",
      t["outflow"] == 1000.0 and t["closing"] == 9000.0, t)
d = rep.custody_settlement("x") if False else rep.cash_flow_detail()
check("التفصيلي: خارج 1000 وصندوق 9000",
      d["totals"]["out"] == 1000.0 and d["totals"]["cash"] == 9000.0,
      d["totals"])
sett_rows = [p for p in d["payments"] if p.get("settlement")]
check("V4.54: بند التصفية لا يظهر في التقرير المالي",
      len(sett_rows) == 0 and len(d["payments"]) == 1
      and d["payments"][0]["amount"] == 1000.0, len(d["payments"]))

print("=== 2. القيود ===")
with get_connection() as c:
    js = [dict(j) for j in c.execute(
        "SELECT debit_account d, credit_account c FROM journal_entries ORDER BY id")]
check("التسليم: مدين العهدة دائن الخزينة",
      js[0]["d"] == csnap and js[0]["c"] == "البنك / الصندوق", js[0])
check("التصفية: مدين المصروف دائن العهدة",
      "مصروف" in (js[1]["d"] or "") and js[1]["c"] == csnap, js[1])

print("=== 3. التحويل الداخلي يرى الرصيد الصحيح ===")
try:
    lc.add_voucher("transfer", "2026-09-06", "", "الصندوق", "البنك",
                   9000.0, "تحويل اختبار")
    check("تحويل 9000 نجح (الرصيد الحقيقي)", True)
except Exception as e:
    check("تحويل 9000 نجح (الرصيد الحقيقي)", False, e)
try:
    lc.add_voucher("transfer", "2026-09-06", "", "الصندوق", "البنك",
                   9000.0, "تحويل مرفوض")
    check("تحويل ثانٍ مرفوض (الرصيد نفد)", False, "قُبِل خطأً")
except Exception:
    check("تحويل ثانٍ مرفوض (الرصيد نفد)", True)

print("=== 4. لا كسر للسلوك الطبيعي ===")
lc.add_voucher("payment", "2026-09-07", "مورد", "تحويل بنكي", "مصروف / إيجار",
               500.0, "إيجار", expense_account_id=exp[1])
b2 = lc.cash_account_balances()
check("مصروف بنكي عادي يُخصم من البنك",
      b2["bank"] == 8500.0 and b2["cash"] == 0.0, b2)

print("=== 5. سطر قديم بعلامة الملاحظات ===")
with get_connection() as c:
    c.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, party, method,"
              " account, amount, description, notes, expense_account_id)"
              " VALUES ('PV-LEG','payment','2026-09-08','مورد','نقدًا','مصروف',200,"
              "'قديم','سطر\nتصفية عهدة من حساب: عهدة عامة',?)", (exp[1],))
b3 = lc.cash_account_balances()
check("السطر القديم لا يخصم من الصندوق", b3["cash"] == 0.0, b3)

os.remove("/tmp/custfix.sqlite")
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
