# -*- coding: utf-8 -*-
"""V4.5.04: سطر الباطن المربوط بمصادر لا تحفزه المرحلة وحده."""
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
from services import customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


def _trig(table, lid):
    with get_connection() as c:
        r = c.execute(f"SELECT triggered_at FROM {table} WHERE id=?",
                      (lid,)).fetchone()
    return (r["triggered_at"] or "").strip()


TODAY = date.today().isoformat()
cust = customer_service.add_customer(
    Customer(customer_code="C-4504", name="عميل 4504", phone="90004504"))
s1 = wf.add_stage("contract", "مرحلة أولى 4504", contract_type="T4504")
s2 = wf.add_stage("contract", "مرحلة ثانية 4504", contract_type="T4504")
with get_connection() as c:
    for i, s in ((1, s1), (2, s2)):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("T4504", i, f"دفعة {i}", 0, 100.0, s))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-4504", "باطن 4504", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-4504",)).fetchone()["id"]

k = cs.add_contract(Contract(
    contract_number="CON-4504", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4504",
    description="x", amount=200.0), manual_path=True)
with get_connection() as c:
    C1 = c.execute("SELECT id FROM payment_plan WHERE contract_id=? AND "
                   "sort_order=1", (k,)).fetchone()["id"]
    C2 = c.execute("SELECT id FROM payment_plan WHERE contract_id=? AND "
                   "sort_order=2", (k,)).fetchone()["id"]
    S1 = c.execute("SELECT id FROM contract_stages WHERE contract_id=? "
                   "ORDER BY id LIMIT 1", (k,)).fetchone()["id"]
    S2 = c.execute("SELECT id FROM contract_stages WHERE contract_id=? "
                   "ORDER BY id LIMIT 1 OFFSET 1", (k,)).fetchone()["id"]
sub = lc.add_sub_contract(sub_id, k, None, 200.0, description="باطن")
Lx = lc.add_sub_plan_line(sub, "مصدر متقاطع", TODAY, 100.0, stage_id=S1)
lc.set_sub_line_sources(Lx, [C2])
Lo = lc.add_sub_plan_line(sub, "قديم بلا مصادر", TODAY, 50.0, stage_id=S1)

print("=== 1. المرحلة لا تحفز المربوط وحده ===")
wf.manual_close_stage(k, S1)
check("C1 مثارة", bool(_trig("payment_plan", C1)))
check("المتقاطع لم يُثر (مصدره مفتوح)", not _trig("sub_payment_plan", Lx),
      _trig("sub_payment_plan", Lx))
check("القديم أُثير بمرحلته", bool(_trig("sub_payment_plan", Lo)))

print("=== 2. اكتمال المصادر يحفزه ===")
wf.manual_close_stage(k, S2)
check("المتقاطع تبع مصدره", bool(_trig("sub_payment_plan", Lx)))

print("=== 3. الدورة المعتادة (نفس المرحلة) ===")
k2 = cs.add_contract(Contract(
    contract_number="CON-4504B", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4504",
    description="x", amount=200.0), manual_path=True)
with get_connection() as c:
    C1b = c.execute("SELECT id FROM payment_plan WHERE contract_id=? AND "
                    "sort_order=1", (k2,)).fetchone()["id"]
    S1b = c.execute("SELECT id FROM contract_stages WHERE contract_id=? "
                    "ORDER BY id LIMIT 1", (k2,)).fetchone()["id"]
sub2 = lc.add_sub_contract(sub_id, k2, None, 200.0, description="باطن2")
Lb = lc.add_sub_plan_line(sub2, "نفس المرحلة", TODAY, 100.0, stage_id=S1b)
lc.set_sub_line_sources(Lb, [C1b])
wf.manual_close_stage(k2, S1b)
check("العميل والباطن معًا",
      bool(_trig("payment_plan", C1b))
      and bool(_trig("sub_payment_plan", Lb)))

print("")
print(f"V4.5.04 sourced-gate: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
