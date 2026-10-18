# -*- coding: utf-8 -*-
"""V4.2 (P1): محرك استحقاق الباطن + البوابات + لوحة المستحقات + قاعدة التمديد.

يغطي: تحريك السطور بإنهاء مرحلة الأب · التخطي (P1-1) · التراجع وحارس
السندات المحتفظ بها · بوابة إغلاق الباطن (P1-3أ) · تحذير تسوية العميل
(P1-3ب) · لوحة المستحقات (سطور/مشتق/فلاتر/فرز/شارات المصدر) ·
المحاسبة الأحادية للتمديد (P1-2).
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
from services import contract_type_service as cts
from services import customer_service as cs
from services import extras_service as ex
from services import lifecycle_service as lc
from services import report_service as rp
from services import supervision_service as sup
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


TODAY = date.today().isoformat()
FUTURE = (date.today() + timedelta(days=60)).isoformat()
PAST = "2026-01-01"

print("=== 1. التجهيز: عميل + عقد + باطن + خطة مربوطة بالمراحل ===")
c1 = cs.add_customer(Customer(customer_code="V42-001", name="عميل المستحقات",
                              phone="50000000"))
k1 = ks.add_contract(Contract(contract_number="V42-CT-001", customer_id=c1,
                              contract_name="فيلا المستحقات",
                              contract_date=TODAY, amount=28000))
sub = lc.add_subcontractor("V42-SUB", "مقاول الباطن")
sc = lc.add_sub_contract(sub, k1, None, 10000.0, start_date=TODAY,
                         end_date=FUTURE, description="أعمال اختبار")
parents = lc.sub_parent_stages(sc)
check("مراحل الأب متاحة للربط", len(parents) >= 2, str(len(parents)))
S1, S2 = parents[0]["id"], parents[1]["id"]
l1 = lc.add_sub_plan_line(sc, "دفعة الأساسات", FUTURE, 4000.0, stage_id=S1)
l2 = lc.add_sub_plan_line(sc, "دفعة الهيكل", FUTURE, 6000.0, stage_id=S2)
check("سطور الخطة أنشئت", all([l1, l2]))
plan = lc.sub_payment_plan(sc)
st1 = [l for l in plan if l["id"] == l1][0]
check("قبل الإنهاء: بانتظار إنجاز المرحلة",
      st1["status"] == "بانتظار إنجاز المرحلة", st1["status"])

print("=== 2. الدفع المسبق + التحريك بإنهاء المرحلة ===")
lc.add_voucher("payment", TODAY, "مقاول الباطن", "نقدًا", "", 1500.0,
               "دفعة مقدمة", sub_contract_id=sc,
               party_type="subcontractor", party_id=sub)
r = wf.advance_stage(wf.TX_CONTRACT, k1)
check("إنهاء المرحلة الأولى", r["closed"] == parents[0]["name"], str(r))
plan = lc.sub_payment_plan(sc)
g = {l["id"]: l for l in plan}
check("السطر تحرك بتاريخ اليوم", (g[l1]["triggered_at"] or "")[:10] == TODAY,
      repr(g[l1]["triggered_at"]))
check("الاستحقاق الفعلي = تاريخ الإنهاء", g[l1]["due_date"] == TODAY,
      g[l1]["due_date"])
check("صيغة الملاحظة", "مستحقة لانتهاء مرحلة" in (g[l1]["notes"] or ""),
      repr(g[l1]["notes"]))
check("FIFO: المغطى 1500 والمتبقي 2500",
      abs(g[l1]["covered"] - 1500.0) < 0.01
      and abs(g[l1]["remaining"] - 2500.0) < 0.01,
      str(g[l1]["covered"]) + "/" + str(g[l1]["remaining"]))
check("الحالة جزئي", g[l1]["status"] == "جزئي", g[l1]["status"])

print("=== 3. التخطي (P1-1): غير مستحقة ===")
r = wf.advance_stage(wf.TX_CONTRACT, k1, skip=True)
check("تخطي المرحلة الثانية", r["closed"] == parents[1]["name"], str(r))
g = {l["id"]: l for l in lc.sub_payment_plan(sc)}
check("المتخطاة موسومة", g[l2]["status"] == "مرحلة متخطاة",
      g[l2]["status"])
check("ملاحظة التخطي", "تم تخطيها" in (g[l2]["notes"] or ""),
      repr(g[l2]["notes"]))
check("المتخطاة بلا تحريك", not (g[l2]["triggered_at"] or "").strip())

print("=== 4. بوابة إغلاق الباطن (P1-3أ) + تحذير التسوية (P1-3ب) ===")
try:
    lc.update_sub_contract(sc, 10000.0, status="منتهي")
    check("الإغلاق محظور مع مستحق غير مسدد", False)
except ValidationError as e:
    check("الإغلاق محظور مع مستحق غير مسدد", "غير مسددة" in str(e), str(e))
sd = ex.contract_sub_dues(k1)
check("تحذير التسوية: سطر واحد", sd["count"] == 1, str(sd))
check("تحذير التسوية: 2500", abs(sd["unpaid"] - 2500.0) < 0.01, str(sd))
lc.add_voucher("payment", TODAY, "مقاول الباطن", "نقدًا", "", 2500.0,
               "استكمال الدفعة", sub_contract_id=sc,
               party_type="subcontractor", party_id=sub)
sd = ex.contract_sub_dues(k1)
check("بعد السداد: لا تحذير", sd["count"] == 0, str(sd))
try:
    lc.update_sub_contract(sc, 10000.0, status="منتهي")
    check("الإغلاق يتم بعد السداد الكامل", True)
except ValidationError as e:
    check("الإغلاق يتم بعد السداد الكامل", False, str(e))

print("=== 5. لوحة المستحقات المرحلية ===")
l3 = lc.add_sub_plan_line(sc, "دفعة متأخرة قديمة", PAST, 5000.0)
check("سطر الأقدمية أنشئ", bool(l3))
sub2 = lc.add_subcontractor("V42-SUB2", "مقاول بلا خطة")
sc2 = lc.add_sub_contract(sub2, k1, None, 3000.0, end_date=FUTURE)
lc.add_voucher("payment", TODAY, "مقاول بلا خطة", "نقدًا", "", 1000.0,
               "صرف جزئي", sub_contract_id=sc2,
               party_type="subcontractor", party_id=sub2)
board = rp.dues_board("all")
brows = board["rows"]
derived = [b for b in brows if b["source"] == "مشتق"]
check("سطر مشتق لمن بلا خطة", len(derived) == 1, str(len(derived)))
check("المشتق: 3000/1000/2000",
      derived and abs(derived[0]["amount"] - 3000.0) < 0.01
      and abs(derived[0]["paid"] - 1000.0) < 0.01
      and abs(derived[0]["remaining"] - 2000.0) < 0.01,
      str(derived[0]) if derived else "")
badges = {b["source"] for b in brows}
check("شارات المصدر (مرحلة/أيام/مشتق)",
      {"مرحلة", "أيام", "مشتق"} <= badges, str(badges))
subs_only = rp.dues_board("subs")["rows"]
check("فلتر الباطن فقط", subs_only
      and all(b["side"] == "باطن" for b in subs_only),
      str(len(subs_only)))
od = rp.dues_board("overdue_only")["rows"]
check("فلتر المتأخر", od and all(b["status"] == "متأخر" for b in od)
      and any(b["title"] == "دفعة متأخرة قديمة" for b in od),
      str([b["title"] for b in od]))
check("المتأخر أولا", brows and brows[0]["status"] == "متأخر",
      brows[0]["status"] if brows else "بلا سطور")
t = board["totals"]
check("الإجماليات", t["n"] == len(brows) and t["overdue_n"] >= 1, str(t))

print("=== 6. التراجع: المحتفظ به يحمى (P1-1) ===")
r1 = wf.revert_contract_stage(k1, "اختبار تراجع 1")
check("التراجع الأول يعيد الثانية جارية",
      r1["to"] == parents[1]["name"], str(r1))
r2 = wf.revert_contract_stage(k1, "اختبار تراجع 2")
check("التراجع الثاني يعيد الأولى جارية",
      r2["to"] == parents[0]["name"], str(r2))
kept = [p for p in r2.get("kept_payments", []) if "باطن" in p["title"]]
check("المحركة بسند لاحق محفوظة", len(kept) == 1, str(r2))
g = {l["id"]: l for l in lc.sub_payment_plan(sc)}
check("المحفوظة تبقى مستحقة", bool((g[l1]["triggered_at"] or "").strip()))

print("=== 7. المحاسبة الأحادية للتمديد (P1-2) ===")
ctype = "إشراف اختبار 42"
cts.add_type(ctype, 0, unit_label="شهر", unit_price=150,
             pricing_mode="unit", is_supervision=True)
c2 = cs.add_customer(Customer(customer_code="V42-002", name="عميل إشراف",
                              phone="50000001"))
k2 = ks.add_contract(Contract(
    contract_number="V42-CT-002", customer_id=c2, contract_date="2025-09-07",
    description="عقد إشراف", amount=300, contract_type=ctype,
    qty=2, unit_price=150))
sup.setup_supervision(k2, "2025-09-07", 2, 150)
st = sup.supervision_status(k2)
check("تمديد محسوب", st and st["extension_value"] > 0,
      str(st["extension_value"]) if st else "None")
val = lc.contract_current_value(k2)
check("القيمة = الأساس + التمديد مرة واحدة",
      abs(val["current"] - (val["base_current"] + val["sup_extension"])) < 0.01
      and abs(val["sup_extension"] - st["extension_value"]) < 0.01,
      str(val))
before = val["current"]
sup.waive_extension_months(k2, 2, "اختبار وحدة المحاسبة")
after = lc.contract_current_value(k2)["current"]
check("التنازل يخصم مرة واحدة (300)", abs((before - after) - 300.0) < 0.01,
      str(before) + " -> " + str(after))
stl = ex.contract_settlement(k2)
check("التسوية تستخدم القيمة مرة واحدة",
      abs(stl["remaining"] - (after - stl["collected"])) < 0.01, str(stl))

print("")
print("V4.2 dues: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
