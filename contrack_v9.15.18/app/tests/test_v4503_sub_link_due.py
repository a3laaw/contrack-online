# -*- coding: utf-8 -*-
"""V4.5.03: إجبار مصادر الباطن + لافتة «مستحقة» + تعليقات اليدوي + تحفيز رجعي."""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db  # noqa: E402

if os.path.isdir("data"):
    import shutil  # noqa: E402
    shutil.rmtree("data")
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
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


TODAY = date.today().isoformat()
cust = customer_service.add_customer(
    Customer(customer_code="C-4503", name="عميل 4503", phone="90004503"))
cts.add_type("T4503", 1000.0, manual_track=True)
s1 = wf.add_stage("contract", "مرحلة أولى 4503", contract_type="T4503")
s2 = wf.add_stage("contract", "مرحلة ثانية 4503", contract_type="T4503")
with get_connection() as c:
    for i, s in ((1, s1), (2, s2)):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("T4503", i, f"دفعة {i}", 0, 0, s))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-4503", "باطن 4503", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-4503",)).fetchone()["id"]

k = cs.add_contract(Contract(
    contract_number="CON-4503", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4503",
    description="x", amount=1000.0), manual_path=True)
lc.update_plan_amount_overrides(k, {1: 500.0, 2: 500.0})
with get_connection() as c:
    C1 = c.execute("SELECT id FROM payment_plan WHERE contract_id=? AND "
                   "sort_order=1", (k,)).fetchone()["id"]
    C2 = c.execute("SELECT id FROM payment_plan WHERE contract_id=? AND "
                   "sort_order=2", (k,)).fetchone()["id"]
    S1 = c.execute("SELECT id FROM contract_stages WHERE contract_id=? AND "
                   "name=?", (k, "مرحلة أولى 4503")).fetchone()["id"]
    S2 = c.execute("SELECT id FROM contract_stages WHERE contract_id=? AND "
                   "name=?", (k, "مرحلة ثانية 4503")).fetchone()["id"]
sub = lc.add_sub_contract(sub_id, k, None, 800.0, description="باطن")
L1 = lc.add_sub_plan_line(sub, "بند باطن 1", TODAY, 400.0, stage_id=S1)
L2 = lc.add_sub_plan_line(sub, "بند باطن 2", TODAY, 400.0, stage_id=S2)

print("=== 1. المصدر إجباري ===")
try:
    lc.set_sub_line_sources(L1, [])
    ok = False
except ValidationError as e:
    ok = "مصدر" in str(e)
check("الفارغة مرفوضة", ok)
lc.set_sub_line_sources(L1, [C1])
try:
    lc.set_sub_line_sources(L1, [])
    ok2 = False
except ValidationError:
    ok2 = True
check("لا مسح بعد الربط", ok2)
with get_connection() as c:
    n = c.execute("SELECT COUNT(*) FROM sub_payment_sources WHERE "
                  "sub_line_id=?", (L1,)).fetchone()[0]
check("الربط باقٍ", n == 1, n)

print("=== 2. القديم بلا مصادر يستحق بمرحلته ===")
_pre = {int(x["sort_order"]): x for x in lc.contract_payment_plan(k)}
check("قبل الإغلاق: بانتظار إنجاز المرحلة",
      _pre[1]["status"] == "بانتظار إنجاز المرحلة", _pre[1]["status"])
st0 = lc.sub_sources_status(sub).get(L1, {})
check("L1 ينتظر C1", st0.get("ready") is False, st0)
wf.manual_close_stage(k, S2)
with get_connection() as c:
    t2 = c.execute("SELECT triggered_at FROM sub_payment_plan WHERE id=?",
                   (L2,)).fetchone()["triggered_at"]
check("L2 المثار بمرحلته (بلا مصادر)", bool((t2 or "").strip()), t2)

print("=== 3. السلسلة: عميل ← باطن ===")
wf.manual_close_stage(k, S1)
with get_connection() as c:
    tc1 = c.execute("SELECT triggered_at FROM payment_plan WHERE id=?",
                    (C1,)).fetchone()["triggered_at"]
    tl1 = c.execute("SELECT triggered_at FROM sub_payment_plan WHERE id=?",
                    (L1,)).fetchone()["triggered_at"]
check("C1 مثارة بإغلاق مرحلتها", bool((tc1 or "").strip()), tc1)
check("L1 تبعت مصادرها", bool((tl1 or "").strip()), tl1)

print("=== 4. لافتة «مستحقة» ===")
items = {int(x["sort_order"]): x for x in lc.contract_payment_plan(k)}
check("الأولى مستحقة", items[1]["status"] == "مستحقة",
      items[1]["status"])
check("الثانية مستحقة أيضًا", items[2]["status"] == "مستحقة",
      items[2]["status"])
subs = {x["title"]: x for x in lc.sub_payment_plan(sub)}
check("الباطن مثارة اللافتة", subs["بند باطن 1"]["status"] == "مستحقة",
      subs["بند باطن 1"]["status"])

print("=== 5. تعليقات اليدوي ===")
with get_connection() as c:
    bodies = [r["body"] for r in c.execute(
        "SELECT body FROM customer_comments WHERE contract_id=? "
        "ORDER BY id", (k,))]
check("تعليق الإغلاق بالدفعة",
      any("أنهى" in b and "مستحقة" in b for b in bodies), len(bodies))
wf.manual_reopen_stage(k, S1, reason="مراجعة")
with get_connection() as c:
    bodies2 = [r["body"] for r in c.execute(
        "SELECT body FROM customer_comments WHERE contract_id=? "
        "ORDER BY id", (k,))]
check("تعليق إعادة الفتح",
      any("أعاد" in b and "فتح" in b for b in bodies2), len(bodies2))

print("=== 6. التحفيز الرجعي ===")
k3 = cs.add_contract(Contract(
    contract_number="CON-4503C", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4503",
    description="x", amount=1000.0), manual_path=True)
with get_connection() as c:
    S3 = c.execute("SELECT id FROM contract_stages WHERE contract_id=? "
                   "ORDER BY id LIMIT 1", (k3,)).fetchone()["id"]
wf.manual_close_stage(k3, S3)
lc.update_plan_amount_overrides(k3, {1: 500.0, 2: 500.0})
with get_connection() as c:
    r1 = c.execute("SELECT triggered_at, due_date, notes FROM payment_plan "
                   "WHERE contract_id=? AND sort_order=1", (k3,)).fetchone()
    r2 = c.execute("SELECT triggered_at FROM payment_plan WHERE "
                   "contract_id=? AND sort_order=2", (k3,)).fetchone()
check("المولود لمغلقة مثار بتاريخها",
      (r1["triggered_at"] or "")[:10] == TODAY
      and "مستحقة لانتهاء" in (r1["notes"] or ""), dict(r1))
check("المفتوحة تقديرية", not (r2["triggered_at"] or "").strip(),
      r2["triggered_at"])

print("=== 7. المقارنة متسقة ===")
cmpd = lc.contract_payment_compare(k)
check("المستحق = المثار فقط",
      cmpd["client"]["due"] == 500.0
      and cmpd["client"]["remaining"] == 500.0, cmpd["client"])

print("")
print(f"V4.5.03 sub-link-due: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
