# -*- coding: utf-8 -*-
"""V4.3: «المستحق الآن» الصارم + اللوحة باطن فقط (لا تكرار).

يغطي: مصفوفة السيناريوهات (متأخر/جزئي/اليوم/قريب/مستقبلي/منتظر/
متخطى/مدفوع/متعدد/بلا-خطة) · الفرق عن نافذة الـ7 أيام · تجميع
العقد والعميل · اللوحة بلا سطور عملاء.
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


TODAY = date.today()
ISO = TODAY.isoformat()
PAST = "2026-01-01"
FUT3 = (TODAY + timedelta(days=3)).isoformat()
FUT60 = (TODAY + timedelta(days=60)).isoformat()


def add_line(cid, title, due, amount, order, stage=None):
    with database.get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
            " sort_order, stage_id) VALUES (?,?,?,?,?,?)",
            (cid, title, due, amount, order, stage))
        return cur.lastrowid


print("=== 1. التجهيز: عقد بخطة كاملة السيناريوهات ===")
c1 = cs.add_customer(Customer(customer_code="V43-001", name="عميل المستحق",
                              phone="50000000"))
k1 = ks.add_contract(Contract(contract_number="V43-CT-001", customer_id=c1,
                              contract_name="فيلا المستحق",
                              contract_date=ISO, amount=30000))
with database.get_connection() as conn:
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (k1,))
stages = wf.stage_status(wf.TX_CONTRACT, k1)["path"]
S1 = stages[0]["stage"]["id"]
S2 = stages[1]["stage"]["id"]
add_line(k1, "متأخرة قديمة", PAST, 1000.0, 1)
add_line(k1, "تستحق اليوم", ISO, 2000.0, 2)
add_line(k1, "محركة بالمرحلة", FUT60, 6000.0, 3, stage=S1)
add_line(k1, "قريبة 3 أيام", FUT3, 3000.0, 4)
add_line(k1, "مستقبلية", FUT60, 5000.0, 5)
add_line(k1, "منتظرة المرحلة", FUT60, 4000.0, 6, stage=S2)
lc.add_voucher("receipt", ISO, "عميل المستحق", "نقدًا", "", 1500.0,
               "تحصيل جزئي", contract_id=k1,
               party_type="customer", party_id=c1)
wf.advance_stage(wf.TX_CONTRACT, k1)
plan = {l["title"]: l for l in lc.contract_payment_plan(k1)}
check("المحركة استحقت اليوم", (plan["محركة بالمرحلة"]["triggered_at"] or "")[:10] == ISO)
check("FIFO: القديمة غطيت كاملة", abs(plan["متأخرة قديمة"]["remaining"]) < 0.01)
check("FIFO: اليوم جزئي 1500",
      abs(plan["تستحق اليوم"]["remaining"] - 1500.0) < 0.01,
      str(plan["تستحق اليوم"]["remaining"]))

print("=== 2. المسار الصارم مقابل نافذة الأيام السبعة ===")
strict = [r for r in lc.overdue_plan_items(strict=True)
          if r["contract_id"] == k1]
loose = [r for r in lc.overdue_plan_items()
         if r["contract_id"] == k1]
st, lt = {r["title"] for r in strict}, {r["title"] for r in loose}
check("الصارم: اليوم + المحركة فقط",
      st == {"تستحق اليوم", "محركة بالمرحلة"}, str(st))
check("الفضفاض: + القريبة 3 أيام",
      lt == {"تستحق اليوم", "محركة بالمرحلة", "قريبة 3 أيام"}, str(lt))
check("الصارم يستبعد المنتظرة والمستقبلية والمدفوعة",
      not (st & {"منتظرة المرحلة", "مستقبلية", "متأخرة قديمة"}))

print("=== 3. تجميع العقد والعميل ===")
by_ct = rp.due_now_by_contract()
check("مستحق العقد = 1500 + 6000", abs(by_ct.get("V43-CT-001", 0) - 7500.0) < 0.01,
      str(by_ct.get("V43-CT-001")))
by_cu = rp.due_now_by_customer()
check("مستحق العميل = 7500", abs(by_cu.get("عميل المستحق", 0) - 7500.0) < 0.01,
      str(by_cu.get("عميل المستحق")))

print("=== 4. عقد بلا خطة: كامل المتبقي ===")
c2 = cs.add_customer(Customer(customer_code="V43-002", name="عميل بلا خطة",
                              phone="50000001"))
k2 = ks.add_contract(Contract(contract_number="V43-CT-002", customer_id=c2,
                              contract_name="فيلا بلا خطة",
                              contract_date=ISO, amount=9000))
with database.get_connection() as conn:
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (k2,))
by_ct = rp.due_now_by_contract()
check("بلا خطة = 9000 كاملة", abs(by_ct.get("V43-CT-002", 0) - 9000.0) < 0.01,
      str(by_ct.get("V43-CT-002")))
by_cu = rp.due_now_by_customer()
check("عميل بلا خطة = 9000", abs(by_cu.get("عميل بلا خطة", 0) - 9000.0) < 0.01,
      str(by_cu.get("عميل بلا خطة")))

print("=== 5. اللوحة باطن فقط (لا تكرار) ===")
sub = lc.add_subcontractor("V43-SUB", "مقاول اللوحة")
sc = lc.add_sub_contract(sub, k1, None, 3000.0, end_date=FUT60)
lc.add_sub_plan_line(sc, "دفعة باطن", FUT60, 3000.0)
board = rp.dues_board("all")["rows"]
check("سطور باطن موجودة", len(board) >= 1, str(len(board)))
check("لا سطور عملاء", all(b["side"] == "باطن" for b in board))
check("خيار العملاء فارغ", rp.dues_board("customers")["rows"] == [])
t = rp.dues_board("all")["totals"]
check("الإجماليات بلا تحصيل", "cust_remaining" not in t and t["n"] == len(board),
      str(t))

print("")
print("V4.3 duenow: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
