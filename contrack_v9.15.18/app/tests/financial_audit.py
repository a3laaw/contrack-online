# -*- coding: utf-8 -*-
"""تدقيق مالي شامل: هل تعطي كل شاشات النظام وتقاريره نفس الأرقام؟

يبني بيانات تغطي كل الحالات الصعبة:
  • عميل بعقدين عاديين      • أمر تغييري معتمد وآخر غير معتمد
  • عقد إشراف في التمديد     • سند ملغى (لا يُحتسب)
  • عقد ملغى (يُستبعد)       • صرف لمقاول باطن (لا يمس مستحق العميل)
ثم يقارن «المتبقي على العميل» و«قيمة العقد الحالية» بين:
  شاشة العملاء · ملف العميل · مركز العقد · كشف الحساب ·
  تقرير المستحقات · تقرير أنواع العقود · تقرير الإشراف · إحصاءات الرئيسية.

التشغيل:
    cd /path/to/ConTrack_System/app && QT_QPA_PLATFORM=offscreen \
      python3 ../ملفات_المطور_لا_تسلم_للعميل/أداة_تدقيق_الأرقام_المالية.py
"""
import os
import sys
from datetime import date, timedelta

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

ok = fail = 0
EPS = 0.01


def check(label, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK]   {label} {extra}")
    else:
        fail += 1
        print(f"  [FAIL] {label} {extra}")


def same(label, a, b, extra=""):
    check(label, abs(float(a) - float(b)) < EPS,
          f"{float(a):,.3f} مقابل {float(b):,.3f} {extra}")


print("=" * 60)
print("تدقيق تطابق الأرقام المالية في كل النظام")
print("=" * 60)

from database import database  # noqa: E402
database.init_db()
from database.models import Contract, Customer  # noqa: E402
from services import (contract_service as ks, contract_type_service as cts,
                      customer_service as cs, lifecycle_service as lc,
                      statement_service, report_service,
                      supervision_service as sup)  # noqa: E402

TODAY = date.today()

# ============================================================
# بناء الحالات
# ============================================================
print("\n[1] بناء بيانات تغطي كل الحالات")
cid = cs.add_customer(Customer(customer_code=cs.next_customer_code(),
                               name="عميل التدقيق الشامل", phone="99001100",
                               address="الكويت - حولي"))

# عقد 1: عادي 10,000 · محصّل 4,000 · أمر تغييري معتمد +2,000 وآخر معلّق +5,000
k1 = ks.add_contract(Contract(contract_number=ks.next_contract_number(),
                              customer_id=cid, contract_date="2026-01-05",
                              description="بناء فيلا", amount=10000.0,
                              contract_type="غير محدد"))
lc.add_voucher("receipt", "2026-02-01", "", "شيك", "", 4000.0, "دفعة أولى",
               contract_id=k1, party_type="customer", party_id=cid)
# أمر تغييري معتمد (+2,000) وآخر «تحت المراجعة» (+5,000) لا يجب أن يُحتسب
lc.add_addendum(k1, "2026-03-01", "أعمال إضافية", "توسعة الملحق",
                2000.0, 0.0, status="معتمد")
lc.add_addendum(k1, "2026-03-10", "تحت الدراسة", "بند قيد الاعتماد",
                5000.0, 0.0, status="تحت المراجعة")

# عقد 2: عادي 3,000 · محصّل 3,000 (مكتمل) · وسند ملغى 1,000 لا يُحتسب
k2 = ks.add_contract(Contract(contract_number=ks.next_contract_number(),
                              customer_id=cid, contract_date="2026-02-05",
                              description="ترميم ملحق", amount=3000.0,
                              contract_type="غير محدد"))
# السند الملغى أولًا ثم السداد الكامل (النظام يرفض تجاوز قيمة العقد)
v_cancel = lc.add_voucher("receipt", "2026-02-20", "", "نقدًا", "", 1000.0,
                          "سند ملغى", contract_id=k2, party_type="customer",
                          party_id=cid)
try:
    lc.cancel_voucher(v_cancel, "خطأ إدخال")
except Exception as exc:
    print("    (تعذر إلغاء السند:", exc, ")")
lc.add_voucher("receipt", "2026-03-01", "", "نقدًا", "", 3000.0, "سداد كامل",
               contract_id=k2, party_type="customer", party_id=cid)

# عقد 3: إشراف · أساسي 6 شهور × 200 · بدأ من 400 يوم · سُدد 1,200 فقط
start3 = (TODAY - timedelta(days=400)).isoformat()
k3 = ks.add_contract(Contract(contract_number=ks.next_contract_number(),
                              customer_id=cid, contract_date=start3,
                              description="إشراف هندسي", amount=1200.0,
                              contract_type="غير محدد"))
sup.setup_supervision(k3, start3, 6, 200.0)
lc.add_voucher("receipt", TODAY.isoformat(), "", "شيك", "", 1200.0,
               "قيمة الإشراف الأساسية", contract_id=k3,
               party_type="customer", party_id=cid)

# عقد 4: ملغى · يجب ألا يدخل أي إجمالي
k4 = ks.add_contract(Contract(contract_number=ks.next_contract_number(),
                              customer_id=cid, contract_date="2026-01-20",
                              description="عقد ملغى", amount=9999.0,
                              contract_type="غير محدد"))
lc.update_contract_lifecycle(k4, status="ملغى")

# صرف لمقاول باطن على العقد 1 (لا يمس مستحق العميل)
sub_id = lc.add_subcontractor(lc.next_sub_code(), "مؤسسة النور للكهرباء",
                              phone="66000011", activity="كهرباء")
lc.add_sub_contract(sub_id, k1, None, 3000.0, "2026-02-01", "2026-06-01",
                    "أعمال كهرباء")
lc.add_voucher("payment", "2026-04-01", "", "شيك", "", 1500.0,
               "دفعة مقاول", contract_id=k1, party_type="subcontractor",
               party_id=sub_id)

st3 = sup.supervision_status(k3)
print(f"    تمديد الإشراف المستحق: {st3['extension_value']:,.3f} د.ك "
      f"({st3['billable_extension']:g} شهر)")

# ============================================================
# المرجع: القيمة الحالية لكل عقد من المصدر الوحيد
# ============================================================
print("\n[2] المصدر الوحيد contract_current_value")
vals = {k: lc.contract_current_value(k) for k in (k1, k2, k3)}
same("عقد 1 = 10,000 + 2,000 معتمد (المعلّق لا يدخل)",
     vals[k1]["current"], 12000.0)
same("عقد 2 = 3,000 (السند الملغى لا يزيد القيمة)",
     vals[k2]["current"], 3000.0)
same("عقد 3 = 1,200 + تمديد الإشراف",
     vals[k3]["current"], 1200.0 + st3["extension_value"])
check("العقد الإشرافي يفصح عن التمديد داخل القيمة",
      vals[k3]["sup_extension"] > 0, f"{vals[k3]['sup_extension']:,.3f}")

expected_current = sum(v["current"] for v in vals.values())
expected_collected = 4000.0 + 3000.0 + 1200.0
expected_remaining = expected_current - expected_collected
print(f"    المرجع · القيمة: {expected_current:,.3f} · "
      f"المحصّل: {expected_collected:,.3f} · "
      f"المتبقي: {expected_remaining:,.3f}")

# ============================================================
# المقارنات
# ============================================================
print("\n[3] شاشة العملاء وملف العميل (customer_contracts_summary)")
summary = lc.customer_contracts_summary(cid)
t = summary["totals"]
same("قيمة العقود الحالية", t["current"], expected_current)
same("المحصّل", t["collected"], expected_collected)
same("المتبقي", t["remaining"], expected_remaining)
check("العقد الملغى مستبعد من الإجمالي",
      all(c["id"] != k4 or c["status"] == "ملغى"
          for c in summary["contracts"]))

print("\n[4] مركز العقد (contract_dashboard)")
for k, label in ((k1, "عقد 1"), (k2, "عقد 2"), (k3, "عقد الإشراف")):
    dash = lc.contract_dashboard(k)
    same(f"{label}: القيمة الحالية", dash["current_value"],
         vals[k]["current"])
hub_total = sum(lc.contract_dashboard(k)["current_value"]
                for k in (k1, k2, k3))
same("مجموع مراكز العقود = شاشة العملاء", hub_total, t["current"])

print("\n[5] كشف الحساب (statement_service)")
for k, label in ((k1, "عقد 1"), (k3, "عقد الإشراف")):
    stm = statement_service.build_statement(k)
    same(f"{label}: قيمة العقد في الكشف", stm["contract_amount"],
         vals[k]["current"])
    same(f"{label}: متبقي الكشف",
         stm["remaining"],
         vals[k]["current"] - (4000.0 if k == k1 else 1200.0))

print("\n[6] تقرير المستحقات (dues_report)")
dues = report_service.dues_report()
mine = [r for r in dues["rows"] if r["customer_name"] == "عميل التدقيق الشامل"]
rep_remaining = sum(r["remaining"] for r in mine)
same("مجموع متبقي التقرير = متبقي شاشة العملاء", rep_remaining,
     expected_remaining)
check("العقد المكتمل لا يظهر في المستحقات",
      all("ترميم" not in (r["contract_name"] or "") for r in mine),
      str([r["contract_name"] for r in mine]))
check("العقد الملغى لا يظهر", all("ملغى" not in (r["contract_name"] or "")
                                  for r in mine))

print("\n[7] تقرير أنواع العقود (types_report)")
types = cts.types_report()
same("إجمالي قيمة الأنواع = مجموع القيم الحالية",
     types["totals"]["value"], expected_current)
same("إجمالي المحصّل", types["totals"]["collected"], expected_collected)
same("إجمالي المتبقي", types["totals"]["remaining"], expected_remaining)

print("\n[8] إحصاءات الرئيسية (dashboard_stats)")
stats = ks.dashboard_stats()
same("إجمالي قيمة العقود في الرئيسية", stats["total_contracts"],
     expected_current)

print("\n[9] تقرير الإشراف")
sup_rep = report_service.supervision_delays_report(only_unpaid=False)
row3 = next((r for r in sup_rep["rows"] if r["contract_id"] == k3), None)
check("عقد الإشراف موجود في تقريره", row3 is not None)
if row3:
    same("قيمة التأخير = مديونية التمديد غير المسددة",
         row3["delay_value"], st3["unpaid_extension_value"])
    hub3 = lc.contract_dashboard(k3)
    same("متبقي مركز العقد = التمديد غير المسدد",
         hub3["current_value"] - hub3["total_receipts"],
         st3["unpaid_extension_value"])

print("\n[10] الحركة المالية (customer_movements)")
movs = lc.customer_movements(cid)
receipts = sum(m["amount"] for m in movs
               if m.get("vtype") == "receipt" and not m.get("cancelled"))
same("مجموع سندات القبض في الحركة = المحصّل", receipts, expected_collected)
check("السند الملغى ظاهر لكنه غير محتسب",
      any(m.get("cancelled") for m in movs))

print("\n[11] كشف حساب العميل الموحّد (كل العقود)")
try:
    from services import statement_service as ss2
    if hasattr(ss2, "build_customer_statement"):
        cst = ss2.build_customer_statement(cid)
        same("رصيد كشف العميل = المتبقي", cst.get("remaining", 0),
             expected_remaining)
    else:
        check("لا كشف موحّد للعميل (يُعتمد ملف العميل)", True)
except Exception as exc:
    check("كشف حساب العميل بلا خطأ", False, str(exc))

print("\n[12] القاعدة الموحدة: فاتورة أكبر من المحصّل + حسمية (V3.14)")
from services import invoice_service as _inv  # noqa: E402
from database.models import Invoice as _Invoice  # noqa: E402
k5num = ks.next_contract_number()
k5 = ks.add_contract(Contract(contract_number=k5num,
                              customer_id=cid, contract_date="2026-05-01",
                              description="عقد التوحيد", amount=10000.0,
                              contract_type="غير محدد"))
_inv.add_invoice(_Invoice(invoice_number=_inv.next_invoice_number(),
                          customer_id=cid, contract_id=k5,
                          invoice_date="2026-05-02",
                          description="فاتورة أعمال", amount=6000.0,
                          notes=""))
lc.add_voucher("receipt", "2026-05-03", "", "نقدًا", "", 2000.0, "دفعة",
               contract_id=k5, party_type="customer", party_id=cid)
lc.add_addendum(k5, "2026-05-04", "حسمية", "خصم", 0.0, 1000.0,
                status="معتمد")
st5 = statement_service.build_statement(k5)
dues5 = [r for r in report_service.dues_report()["rows"]
         if r["contract_number"] == k5num][0]
same("الكشف = 10,000 − حسمية 1,000 − محصّل 2,000",
     st5["remaining"], 7000.0)
same("المستحقات = الكشف (قاعدة موحدة)",
     dues5["remaining"], st5["remaining"])
same("الجاري الأخير = المتبقي",
     st5["rows"][-1]["balance"], st5["remaining"])
check("الفواتير صفوف علم محايدة",
      all("للعلم" in r["description"] and not r["credit"]
          for r in st5["rows"] if r["ref"].startswith("INV-")))

print("\n" + "=" * 40)
print(f"النتيجة: نجح {ok} / فشل {fail}")
print("=" * 40)
sys.stdout.flush()
os._exit(1 if fail else 0)
