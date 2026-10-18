# -*- coding: utf-8 -*-
"""V4.5.01: الحذف النهائي يشمل النطاق والمطالبات والمكوّنات + ترتيب الباطن."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db  # noqa: E402

if os.path.isdir("data"):
    import shutil  # noqa: E402
    shutil.rmtree("data")
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import claims_service as clm  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import purge_service as pg  # noqa: E402
from services import workflow_service as wf  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


cid = customer_service.add_customer(
    Customer(customer_code="C-4501", name="عميل الحذف", phone="90004501"))
s1 = wf.add_stage("contract", "مرحلة الحذف", contract_type="T4501")
with get_connection() as c:
    c.execute(
        "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
        " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
        ("T4501", 1, "دفعة 1", 0, 1000.0, s1))
k = cs.add_contract(
    Contract(contract_number="CON-4501", customer_id=cid,
             contract_date="2026-01-01", contract_type="T4501",
             description="عقد الحذف", amount=1000.0),
    components=[{"comp_key": "k1", "label": "مكوّن 1", "kind": "items",
                 "enabled": 1, "qty": 1, "months": 0, "monthly": 0}],
    scope_stage_ids=[s1])
with get_connection() as c:
    line = c.execute("SELECT id FROM payment_plan WHERE contract_id=?",
                     (k,)).fetchone()["id"]
    stage = c.execute("SELECT id FROM contract_stages WHERE contract_id=?",
                      (k,)).fetchone()["id"]
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-4501", "باطن الحذف", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-4501",)).fetchone()["id"]
clm.add_claim("out", k, "مطالبة الحذف", 100.0, cust_line_id=line)
sub = lc.add_sub_contract(sub_id, k, None, 500.0, description="باطن")
lc.add_sub_plan_line(sub, "بند باطن", "2026-02-01", 500.0, stage_id=stage)

print("=== 1. المعاينة تشمل الجديد ===")
pv = pg.preview_contract(k)
check("النطاق والمطالبة والمكوّن في المعاينة",
      pv["children"].get("contract_scope") == 1
      and pv["children"].get("claims") == 1
      and pv["children"].get("contract_components") == 1,
      pv["children"])

print("=== 2. الحذف ينجح بلا FOREIGN KEY ===")
try:
    res = pg.purge_contract(k, "اختبار V4.5.01")
    ok, err = res.get("deleted") == 1, ""
except Exception as e:  # noqa: BLE001
    ok, err = False, e
check("حذف ناجح", ok, err)

print("=== 3. لا بقايا واللقطة كاملة ===")
with get_connection() as c:
    left = 0
    for t, col in (("contracts", "id"), ("contract_scope", "contract_id"),
                   ("claims", "contract_id"),
                   ("contract_components", "contract_id"),
                   ("payment_plan", "contract_id"),
                   ("contract_stages", "contract_id"),
                   ("sub_contracts", "contract_id")):
        left += c.execute(f"SELECT COUNT(*) FROM {t} WHERE {col}=?",
                          (k,)).fetchone()[0]
    left += c.execute("SELECT COUNT(*) FROM sub_payment_plan WHERE "
                      "sub_contract_id=?", (sub,)).fetchone()[0]
check("لا صفوف متبقية", left == 0, left)
snap = pg.audit_snapshot(pg.audit_log(1, "contract")[0]["id"])
check("اللقطة تحوي الكل",
      all(key in snap for key in ("contracts", "contract_scope", "claims",
                                  "contract_components", "sub_payment_plan")),
      sorted(snap))

print("")
print(f"V4.5.01 purge-scope: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
