# -*- coding: utf-8 -*-
"""V4.5.02: تجاوزات المرنة تُنشئ صفوفها + استبدال الدفعة الكاملة + عرض الفعلي."""
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
from database.models import Contract, Customer  # noqa: E402
from services import claims_service as clm  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


def _plan(cid):
    with get_connection() as c:
        return [dict(r) for r in c.execute(
            "SELECT id, title, amount, sort_order, stage_id, triggered_at,"
            " manual_amount FROM payment_plan WHERE contract_id=?"
            " ORDER BY sort_order, id", (cid,))]


cust = customer_service.add_customer(
    Customer(customer_code="C-4502", name="عميل المرنة", phone="90004502"))
cts.add_type("T4502", manual_track=True)   # V4.5.13: واجهة القالب لليدوي
s1 = wf.add_stage("contract", "مرحلة أولى 4502", contract_type="T4502")
s2 = wf.add_stage("contract", "مرحلة ثانية 4502", contract_type="T4502")
with get_connection() as c:
    for i, s in ((1, s1), (2, s2)):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("T4502", i, f"دفعة {i}", 0, 0, s))

print("=== 1. التجاوزات تُنشئ الصفوف وتستبدل الكاملة ===")
k = cs.add_contract(Contract(
    contract_number="CON-4502", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4502",
    description="x", amount=2500.0))
check("قبل: صف أمان واحد", len(_plan(k)) == 1
      and _plan(k)[0]["amount"] == 2500.0, _plan(k))
lc.update_plan_amount_overrides(k, {1: 1500.0, 2: 1000.0})
rows = _plan(k)
check("بعد: صفان بالمبلغين",
      [r["amount"] for r in rows] == [1500.0, 1000.0], rows)
check("بلا صف أمان ومرتبطان بمرحلتين",
      all("كاملة" not in (r["title"] or "") for r in rows)
      and len({r["stage_id"] for r in rows}) == 2, rows)
check("يدويان وغير مستحقين",
      all(r["manual_amount"] == 1 and not r["triggered_at"] for r in rows))

print("=== 2. السقف: المجموع لا يتجاوز القيمة ===")
try:
    lc.update_plan_amount_overrides(k, {1: 2000.0, 2: 1000.0})
    ok = False
except ValidationError:
    ok = True
check("الزيادة مرفوضة", ok)
check("الخطة لم تتغير", [r["amount"] for r in _plan(k)] == [1500.0, 1000.0])

print("=== 3. حارس المطالبات ===")
k2 = cs.add_contract(Contract(
    contract_number="CON-4502B", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4502",
    description="x", amount=2500.0))
_line2 = _plan(k2)[0]["id"]
clm.add_claim("out", k2, "مطالبة على الكاملة", 100.0, cust_line_id=_line2)
try:
    lc.update_plan_amount_overrides(k2, {1: 1500.0, 2: 1000.0})
    ok2 = False
except ValidationError as e:
    ok2 = "مطالبة" in str(e)
check("الاستبدال مرفوض مع مطالبة", ok2)
check("صف الأمان باقٍ", len(_plan(k2)) == 1, _plan(k2))

print("=== 4. المسار اليدوي يرى الدفعات ===")
pays = [it.get("pay") for g in wf.manual_path_groups(k)["groups"]
        for it in g["items"]]
check("كل مرحلة بدفعتها",
      len(pays) == 2 and all(p for p in pays)
      and sorted(p["amount"] for p in pays) == [1000.0, 1500.0], pays)

print("=== 5. إصلاح عقد قديم مكسور (CON-0234) ===")
k3 = cs.add_contract(Contract(
    contract_number="CON-4502C", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4502",
    description="x", amount=2500.0))
with get_connection() as c:
    c.execute("UPDATE payment_plan SET amount=500, manual_amount=1,"
              " triggered_at='2026-01-01' WHERE contract_id=?", (k3,))
wf.sync_plan_from_template(k3)
lc.update_plan_amount_overrides(k3, {1: 1500.0, 2: 1000.0})
rows3 = _plan(k3)
check("أُصلح لصفين صحيحين",
      [r["amount"] for r in rows3] == [1500.0, 1000.0]
      and all("كاملة" not in (r["title"] or "") for r in rows3), rows3)

print("=== 6. حوار التعديل يعرض الفعلي ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

from ui.contracts import ContractDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
dlg = ContractDialog(contract=cs.get_contract(k))
app.processEvents()
texts = [dlg.plan_table.item(r, 3).text()
         for r in range(dlg.plan_table.rowCount())]
check("الخلايا تعرض المبالغ الفعلية مباشرة (V5.3)",
      "1,500.000" in texts and "1,000.000" in texts
      and not any("الفعلي" in t for t in texts), texts)
check("المجموع والتحذير من الفعلي",
      "2,500.000" in dlg.plan_total_lbl.text()
      and "يساوي" in dlg.plan_total_lbl.text(),
      dlg.plan_total_lbl.text())

print("")
print(f"V4.5.02 flexible-plan: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
