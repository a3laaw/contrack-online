# -*- coding: utf-8 -*-
"""V4.6: ربط دفعات الباطن بدفعات عقد العميل (AND).

يغطي: الاستحقاق باكتمال كل المصادر · الأحادية تُحرَّك أولًا ·
التحقق من العقد الأب · التراجع يعكس الناقصة ويحتفظ بذات السند ·
عمود المصادر في اللوحة.
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
from services.customer_service import ValidationError

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
FUT60 = (date.today() + timedelta(days=60)).isoformat()


def cust_line_id(cid, title):
    with database.get_connection() as conn:
        r = conn.execute("SELECT id FROM payment_plan WHERE contract_id=?"
                         " AND title=?", (cid, title)).fetchone()
        return int(r["id"])


def sub_line(cid, title):
    with database.get_connection() as conn:
        r = conn.execute("SELECT * FROM sub_payment_plan WHERE "
                         "sub_contract_id=? AND title=?", (cid, title)).fetchone()
        return dict(r)


print("=== 1. التجهيز: عميل بمرحلتين + باطن بمصادر ===")
c1 = cs.add_customer(Customer(customer_code="V46-001", name="عميل المصادر",
                              phone="50000000"))
k1 = ks.add_contract(Contract(contract_number="V46-CT-001", customer_id=c1,
                              contract_name="فيلا المصادر",
                              contract_date=ISO, amount=30000))
with database.get_connection() as conn:
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (k1,))
path = wf.stage_status(wf.TX_CONTRACT, k1)["path"]
S1, S2 = (path[i]["stage"]["id"] for i in (0, 1))
with database.get_connection() as conn:
    conn.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
                 " amount, sort_order, stage_id) VALUES (?,?,?,?,?,?)",
                 (k1, "دفعة العميل 1", FUT60, 5000.0, 1, S1))
    conn.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
                 " amount, sort_order, stage_id) VALUES (?,?,?,?,?,?)",
                 (k1, "دفعة العميل 2", FUT60, 5000.0, 2, S2))
C1, C2 = cust_line_id(k1, "دفعة العميل 1"), cust_line_id(k1, "دفعة العميل 2")
sub = lc.add_subcontractor("V46-SUB", "مقاول المصادر")
sc = lc.add_sub_contract(sub, k1, None, 10000.0, end_date=FUT60)
sl1 = lc.add_sub_plan_line(sc, "دفعة الباطن الكبرى", FUT60, 3000.0)
sl2 = lc.add_sub_plan_line(sc, "دفعة الباطن الصغرى", FUT60, 1000.0)
lc.set_sub_line_sources(sl1, [C1, C2])
lc.set_sub_line_sources(sl2, [C1])
check("المصادر حُفظت",
      [s["id"] for s in lc.get_sub_line_sources(sl1)] == sorted([C1, C2])
      and len(lc.get_sub_line_sources(sl2)) == 1)
check("خريطة المصادر",
      lc.sub_sources_map(sc).get(sl1) == ["دفعة العميل 1", "دفعة العميل 2"])

print("=== 2. الاستحقاق باكتمال الكل (AND) ===")
wf.advance_stage(wf.TX_CONTRACT, k1)
check("الأحادية تحركت أولا",
      bool(sub_line(sc, "دفعة الباطن الصغرى")["triggered_at"]))
check("الثنائية تنتظر الثاني",
      not sub_line(sc, "دفعة الباطن الكبرى")["triggered_at"])
wf.advance_stage(wf.TX_CONTRACT, k1)
big = sub_line(sc, "دفعة الباطن الكبرى")
check("الثنائية تحركت", bool((big["triggered_at"] or "").strip()))
check("ملاحظة المصادر", "اكتمال مصادرها" in (big["notes"] or ""),
      repr(big["notes"]))
check("الاستحقاق = اليوم", big["due_date"] == ISO, big["due_date"])

print("=== 3. التحقق من العقد الأب ===")
k2 = ks.add_contract(Contract(contract_number="V46-CT-002", customer_id=c1,
                              contract_name="فيلا أخرى",
                              contract_date=ISO, amount=5000))
with database.get_connection() as conn:
    conn.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
                 " amount, sort_order) VALUES (?,?,?,?,?)",
                 (k2, "دفعة غريبة", FUT60, 500.0, 1))
other = cust_line_id(k2, "دفعة غريبة")
try:
    lc.set_sub_line_sources(sl1, [other])
    check("مصدر من عقد آخر مرفوض", False)
except ValidationError as e:
    check("مصدر من عقد آخر مرفوض", "من عقد العميل نفسه" in str(e), str(e))
check("المرفوض لا يمسح القديم",
      len(lc.get_sub_line_sources(sl1)) == 2)

print("=== 4. التراجع يعكس الناقصة ===")
r = wf.revert_contract_stage(k1, "اختبار")
check("الكبرى عادت تقديرية",
      not sub_line(sc, "دفعة الباطن الكبرى")["triggered_at"])
check("الصغرى باقية (مصدرها مكتمل)",
      bool(sub_line(sc, "دفعة الباطن الصغرى")["triggered_at"]))
check("المرتجعة مذكورة",
      any("الكبرى" in p["title"] for p in r.get("reverted_payments", [])),
      str(r.get("reverted_payments")))

print("=== 5. حارس السند المحتفظ به ===")
lc.add_voucher("payment", ISO, "مقاول المصادر", "نقدًا", "", 1000.0,
               "صرف الصغرى", sub_contract_id=sc,
               party_type="subcontractor", party_id=sub)
r = wf.revert_contract_stage(k1, "اختبار")
check("الصغرى محفوظة بالسند",
      bool(sub_line(sc, "دفعة الباطن الصغرى")["triggered_at"]))
check("المحفوظة مذكورة",
      any("الصغرى" in p["title"] for p in r.get("kept_payments", [])),
      str(r.get("kept_payments")))

print("=== 6. عمود المصادر في اللوحة ===")
rows = rp.dues_board("all")["rows"]
mine = [b for b in rows if b["title"] == "دفعة الباطن الكبرى"]
check("سطر اللوحة يحمل المصدرين", len(mine) == 1
      and "دفعة العميل 1" in mine[0]["sources"]
      and "دفعة العميل 2" in mine[0]["sources"],
      str(mine[0]["sources"]) if mine else "مفقود")

print("")
print("V4.6 sources: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
