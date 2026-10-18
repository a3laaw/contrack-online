# -*- coding: utf-8 -*-
"""V4.4: بطاقة مستحقات المراحل — عميل × عقد × مرحلة.

يغطي: حالات المرحلة الأربع (مستحقة/مسددة/غير مستحقة/لم تستحق)
+ تاريخ الانتهاء + تجميع الدفعات + عقد بلا خطة + الفلاتر والفرز.
"""
import os
import sys
import tempfile
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database

database.init_db()

from database.models import Contract, Customer
from services import contract_service as ks
from services import customer_service as cs
from services import lifecycle_service as lc
from services import report_service as rp
from services import workflow_service as wf

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  [PASS] " + name)
    else:
        FAIL += 1
        print("  [FAIL] " + name + " " + detail)


ISO = date.today().isoformat()
PAST = "2026-01-01"
FUT60 = (date.today() + timedelta(days=60)).isoformat()


def add_line(cid, title, due, amount, order, stage=None):
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
            " sort_order, stage_id) VALUES (?,?,?,?,?,?)",
            (cid, title, due, amount, order, stage))
        return cur.lastrowid


print("=== 1. التجهيز: كل حالات المرحلة ===")
c1 = cs.add_customer(Customer(customer_code="V44-001", name="عميل المراحل",
                              phone="50000000"))
k1 = ks.add_contract(Contract(contract_number="V44-CT-001", customer_id=c1,
                              contract_name="فيلا المراحل",
                              contract_date=ISO, amount=30000))
with database.get_connection() as conn:
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (k1,))
path = wf.stage_status(wf.TX_CONTRACT, k1)["path"]
S1, S2, S3 = (path[i]["stage"]["id"] for i in (0, 1, 2))
N1 = path[0]["stage"].get("stage_name") or path[0]["stage"].get("name")
add_line(k1, "قديمة مدفوعة", PAST, 500.0, 1)
add_line(k1, "دفعة المرحلة الأولى", FUT60, 6000.0, 2, stage=S1)
add_line(k1, "مستقبلية غير مربوطة", FUT60, 2000.0, 3)
add_line(k1, "دفعة الثانية", FUT60, 4000.0, 4, stage=S2)
add_line(k1, "دفعة الثالثة", FUT60, 3000.0, 5, stage=S3)
lc.add_voucher("receipt", ISO, "عميل المراحل", "نقدًا", "", 1200.0,
               "تحصيل جزئي", contract_id=k1,
               party_type="customer", party_id=c1)
wf.advance_stage(wf.TX_CONTRACT, k1)
wf.advance_stage(wf.TX_CONTRACT, k1, skip=True)
c2 = cs.add_customer(Customer(customer_code="V44-002", name="عميل بلا خطة",
                              phone="50000001"))
k2 = ks.add_contract(Contract(contract_number="V44-CT-002", customer_id=c2,
                              contract_name="فيلا بلا خطة",
                              contract_date=ISO, amount=9000))
with database.get_connection() as conn:
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (k2,))

print("=== 2. صفوف المراحل ===")
rows = rp.stage_dues("all")["rows"]
g = {(r["contract"], r["stage"]): r for r in rows}
r1 = g.get(("V44-CT-001", N1))
check("الأولى مستحقة 5300", r1 and r1["status"] == "مستحقة"
      and abs(r1["due"] - 5300.0) < 0.01, str(r1))
check("انتهت بتاريخ اليوم", r1 and r1["ended"] == ISO,
      r1["ended"] if r1 else "")
check("الدفعات مجمعة", r1 and "دفعة المرحلة الأولى" in r1["titles"],
      r1["titles"] if r1 else "")
skipped = [r for r in rows if r["contract"] == "V44-CT-001"
           and r["status"] == "غير مستحقة"]
check("المتخطاة غير مستحقة", len(skipped) == 1, str(len(skipped)))
waiting = [r for r in rows if r["contract"] == "V44-CT-001"
           and r["status"] == "لم تستحق بعد"]
check("المنتظرة + غير المربوطة لم تستحق",
      len(waiting) == 2, str([r["stage"] for r in waiting]))
free = g.get(("V44-CT-001", "—"))
check("غير المربوطة: باقي 2000 بلا مستحق",
      free and abs(free["remaining"] - 2000.0) < 0.01
      and abs(free["due"]) < 0.01, str(free))
noplan = g.get(("V44-CT-002", "—"))
check("بلا خطة: مستحقة 9000", noplan and noplan["status"] == "مستحقة"
      and abs(noplan["due"] - 9000.0) < 0.01, str(noplan))

print("=== 3. الفلاتر والفرز والإجماليات ===")
due_only = rp.stage_dues("due_only")["rows"]
check("فلتر المستحق: صفان", len(due_only) == 2
      and all(r["due"] > 0.001 for r in due_only),
      str([(r["contract"], r["stage"]) for r in due_only]))
od = rp.stage_dues("overdue_only")["rows"]
check("فلتر المتأخر: بلا-الخطة", len(od) == 1 and od[0]["contract"] == "V44-CT-002",
      str([(r["contract"], r["stage"]) for r in od]))
check("المتأخر أولا", rows and rows[0]["overdue"], str(rows[0]) if rows else "")
t = rp.stage_dues("all")["totals"]
check("الإجماليات", t["n"] == len(rows)
      and abs(t["due_now"] - 14300.0) < 0.01, str(t))

print("")
print("V4.4 stagedues: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
