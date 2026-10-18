# -*- coding: utf-8 -*-
"""اختبار شامل: عقود الإشراف + واتساب المهام."""
import os, sys, tempfile
from datetime import date
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db
_tmp = tempfile.mkdtemp()
db.DATA_DIR = _tmp
db.DB_PATH = os.path.join(_tmp, "sup.sqlite")
from database.database import init_db, get_connection
init_db()

PASS = FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  [PASS] {name}")
    else: FAIL += 1; print(f"  [FAIL] {name} — {detail}")

def expect_err(name, fn, *a, **kw):
    from services.customer_service import ValidationError
    try:
        fn(*a, **kw)
        check(name, False, "قُبل والمفروض يُرفض")
    except ValidationError:
        check(name, True)

from database.models import Customer, Contract
from services import customer_service, contract_service, settings_service
from services import lifecycle_service as lc
from services import supervision_service as sup
from services import task_service

cid = customer_service.add_customer(Customer(
    customer_code="CUS-0001", name="بدر ناصر العتيبي", phone="99887766"))

print("=== 1. إنشاء عقد إشراف ===")
# عقد اتفق عليه 2026-01-01 لكن تعهد الإشراف صدر 2026-03-10
con_id = contract_service.add_contract(Contract(
    contract_number="CON-0001", customer_id=cid,
    contract_date="2026-01-01", contract_name="إشراف فيلا العارضية",
    description="إشراف هندسي", amount=800.0))
sup.setup_supervision(con_id, "2026-03-10", 4, 200.0)
c = contract_service.get_contract(con_id)
check("قيمة العقد = المدة × الشهرية", abs(c.amount - 800.0) < 0.001, str(c.amount))
check("sup_start_date محفوظ", c.sup_start_date == "2026-03-10")

print("=== 2. الحالة داخل المدة الأساسية ===")
st = sup.supervision_status(con_id, today=date(2026, 5, 1))
check("لم يدخل التمديد بعد", not st["in_extension"])
check("لا أشهر تمديد", st["extension_months"] == 0)
check("المستحق = الأساس فقط", abs(st["total_due"] - 800.0) < 0.001)
check("نهاية المدة الأساسية = 2026-07-10", st["base_end"] == "2026-07-10",
      st["base_end"])

print("=== 3. التمديد: يوم واحد بعد النهاية = شهر كامل ===")
st = sup.supervision_status(con_id, today=date(2026, 7, 10))
check("يوم النهاية نفسه = دخل التمديد بشهر", st["extension_months"] == 1,
      str(st["extension_months"]))
st = sup.supervision_status(con_id, today=date(2026, 7, 11))
check("يوم بعد النهاية = شهر تمديد واحد", st["extension_months"] == 1)
check("مديونية التمديد = 200", abs(st["extension_value"] - 200.0) < 0.001)
check("المستحق الكلي = 1000", abs(st["total_due"] - 1000.0) < 0.001)

st = sup.supervision_status(con_id, today=date(2026, 8, 15))
check("شهر وخمسة أيام = شهران تمديد", st["extension_months"] == 2,
      str(st["extension_months"]))
st = sup.supervision_status(con_id, today=date(2026, 10, 9))
check("قبل اكتمال الشهر الرابع = 3 أشهر", st["extension_months"] == 3)
st = sup.supervision_status(con_id, today=date(2026, 10, 10))
check("بداية الشهر الرابع = 4 أشهر", st["extension_months"] == 4)

print("=== 4. سند القبض يقبل مديونية التمديد ===")
# اليوم الفعلي 2026-08-20 → شهران تمديد → المستحق 1200
real_st = sup.supervision_status(con_id)
print("   (اليوم الفعلي: تمديد", real_st["extension_months"], "شهر — مستحق",
      real_st["total_due"], ")")
v1 = lc.add_voucher("receipt", "2026-08-20", "بدر ناصر العتيبي", "نقدًا",
                    "الصندوق", 800.0, "", contract_id=con_id,
                    party_type="customer", party_id=cid)
check("سداد الأساس كاملًا يُقبل", v1 > 0)
expect_err("سند يتجاوز الأساس+التمديد يُرفض",
           lc.add_voucher, "receipt", "2026-08-20", "بدر ناصر العتيبي",
           "نقدًا", "الصندوق", real_st["total_due"] - 800.0 + 250.0,
           "تجاوز", contract_id=con_id, party_type="customer", party_id=cid)
ext_due = real_st["total_due"] - 800.0
if ext_due > 0:
    v2 = lc.add_voucher("receipt", "2026-08-20", "بدر ناصر العتيبي", "نقدًا",
                        "الصندوق", ext_due, "", contract_id=con_id,
                        party_type="customer", party_id=cid)
    check("سداد التمديد بالضبط يُقبل", v2 > 0)
    lc.cancel_voucher(v2, "لإكمال الاختبارات")

print("=== 5. النص الذكي للإشراف ===")
lc.cancel_voucher(v1, "إعادة")
d = __import__("services.extras_service", fromlist=["smart_receipt_description"]).smart_receipt_description(con_id, 800.0)
check("سداد الأساس كاملًا: نص عقد الإشراف", "عقد الإشراف" in d and "كامل" in d, d)
check("النص بلا نسب وبلا أرقام", "%" not in d and "CON-" not in d, d)
d = __import__("services.extras_service", fromlist=["smart_receipt_description"]).smart_receipt_description(con_id, 200.0)
check("سداد 200: شهر واحد من العقد", "شهر" in d, d)
v1 = lc.add_voucher("receipt", "2026-08-20", "بدر ناصر العتيبي", "نقدًا",
                    "الصندوق", 800.0, "سداد الأساس", contract_id=con_id,
                    party_type="customer", party_id=cid)
d = __import__("services.extras_service", fromlist=["smart_receipt_description"]).smart_receipt_description(con_id, 200.0)
check("بعد سداد الأساس: النص يذكر التمديد", "تمديد" in d, d)

print("=== 6. إلغاء أشهر (تنازل المدير) ===")
st = sup.supervision_status(con_id)
billable = st["billable_extension"]
if billable >= 1:
    expect_err("رفض إلغاء أشهر أكثر من المحسوب",
               sup.waive_extension_months, con_id, billable + 5)
    new_st = sup.waive_extension_months(con_id, 1, "تنازل ود")
    check("الإلغاء خصم شهرًا", new_st["billable_extension"] == billable - 1)
    check("المتبقي انخفض بقيمة شهر",
          abs((st["remaining"] - 200.0) - new_st["remaining"]) < 0.001,
          f"{st['remaining']} → {new_st['remaining']}")
else:
    print("   (لا تمديد كافٍ اليوم — تخطي جزئي)")

print("=== 7. المخالصة الكاملة تختفي من التنبيهات ===")
st = sup.supervision_status(con_id)
if st["remaining"] > 0.001:
    lc.add_voucher("receipt", "2026-08-20", "بدر ناصر العتيبي", "نقدًا",
                   "الصندوق", st["remaining"], "مخالصة نهائية",
                   contract_id=con_id, party_type="customer", party_id=cid)
in_ext = sup.contracts_in_extension()
check("بعد المخالصة: العقد ليس في تنبيهات التمديد",
      all(s["contract_id"] != con_id for s in in_ext))

print("=== 8. كشف الحساب يتضمن التمديد ===")
# عقد إشراف ثانٍ بمديونية تمديد قائمة
con2 = contract_service.add_contract(Contract(
    contract_number="CON-0002", customer_id=cid,
    contract_date="2025-01-01", contract_name="إشراف بيت سلوى",
    description="", amount=600.0))
sup.setup_supervision(con2, "2025-06-01", 3, 200.0)
from services import statement_service
st2 = statement_service.build_statement(con2)
has_ext_row = any("تمديد" in (r["description"] or "") for r in st2["rows"])
check("كشف الحساب فيه سطر تمديد إشراف", has_ext_row)
sup_st2 = sup.supervision_status(con2)
check("رصيد الكشف = مستحق الإشراف كاملًا",
      abs(st2["remaining"] - sup_st2["total_due"]) < 0.001,
      f"كشف={st2['remaining']}, إشراف={sup_st2['total_due']}")

print("=== 9. عقد عادي لا يتأثر ===")
con3 = contract_service.add_contract(Contract(
    contract_number="CON-0003", customer_id=cid,
    contract_date="2026-01-01", description="مقاولة عادية", amount=5000.0))
check("عقد عادي: supervision_status = None",
      sup.supervision_status(con3) is None)
expect_err("عقد عادي: السقف ما زال قيمته",
           lc.add_voucher, "receipt", "2026-08-20", "بدر ناصر العتيبي",
           "نقدًا", "الصندوق", 5001.0, "تجاوز", contract_id=con3,
           party_type="customer", party_id=cid)

print("=== 10. واتساب المهام ===")
s = settings_service.get_settings()
s.manager_phone = "99112233"
settings_service.save_settings(s)
check("حفظ رقم المدير", settings_service.get_settings().manager_phone == "99112233")

tid = task_service.add_task("موعد معاينة الموقع", "2026-08-25 10:30",
                            "إحضار المخططات", customer_id=cid)
t = [x for x in task_service.list_tasks() if x["id"] == tid][0]
msg_mgr = task_service.task_whatsapp_message(t, for_customer=False)
check("رسالة المدير فيها المهمة والعميل",
      "موعد معاينة الموقع" in msg_mgr and "بدر ناصر العتيبي" in msg_mgr, msg_mgr[:60])
check("رسالة المدير فيها الوقت (عربي)", "10:30" in msg_mgr and ("ص" in msg_mgr or "م" in msg_mgr), msg_mgr)
msg_cust = task_service.task_whatsapp_message(t, for_customer=True)
check("رسالة العميل تبدأ بالسلام", msg_cust.startswith("السلام"), msg_cust[:30])
check("رسالة العميل فيها الموعد (تاريخ عربي)",
      "25 أغسطس 2026" in msg_cust and "10:30" in msg_cust)
check("الرسائل بلا أرقام عملاء", "CUS-" not in msg_mgr and "CUS-" not in msg_cust)
phone = task_service.task_customer_phone(t)
check("هاتف العميل من المهمة", phone == "99887766", phone)
from services.extras_service import whatsapp_url
url = whatsapp_url("99112233", msg_mgr)
check("رابط wa.me للمدير سليم", url.startswith("https://wa.me/96599112233"), url[:40])

print("=== 11. الإلغاء يتحدث بعد السداد (كسور الشهر) ===")
# سيناريو التسوية: عقد 1000 (5×200) دخل التمديد — سداد جزئي ثم إلغاء
from datetime import date as _date, timedelta as _td

def _sub_months(d, m):
    y, mo = d.year, d.month - m
    while mo <= 0:
        mo += 12; y -= 1
    return _date(y, mo, min(d.day, 28))

_start = _sub_months(_date.today(), 8)
con_w = contract_service.add_contract(Contract(
    contract_number="CON-0090", customer_id=cid,
    contract_date=_start.isoformat(), contract_name="إشراف تسوية",
    amount=1000.0))
sup.setup_supervision(con_w, _start.isoformat(), 5, 200.0)
st_w = sup.supervision_status(con_w)
ext_m = st_w["extension_months"]
check("العقد دخل التمديد", ext_m >= 1, str(ext_m))
# سداد الأساس + 300 من التمديد (شهر ونصف)
lc.add_voucher("receipt", _date.today().isoformat(), "بدر ناصر العتيبي",
               "نقدًا", "الصندوق", 1000.0, "الأساس", contract_id=con_w,
               party_type="customer", party_id=cid)
lc.add_voucher("receipt", _date.today().isoformat(), "بدر ناصر العتيبي",
               "نقدًا", "الصندوق", 300.0, "تسوية جزئية", contract_id=con_w,
               party_type="customer", party_id=cid)
st_w = sup.supervision_status(con_w)
check("غير المسدد = التمديد - 1.5 شهر",
      abs(st_w["unpaid_extension_months"] - (ext_m - 1.5)) < 0.001,
      str(st_w["unpaid_extension_months"]))
expect_err("إلغاء كل الأشهر يُرفض بعد سداد جزء منها",
             sup.waive_extension_months, con_w, ext_m)
new_w = sup.waive_extension_months(con_w, ext_m - 1.5, "تسوية")
check("إلغاء الكسر المتبقي يقبل ويصفّر المتبقي",
      abs(new_w["remaining"]) < 0.001, str(new_w["remaining"]))
check("المدة الباقية نصية بالأشهر والأيام",
      "time_left_text" in new_w and bool(new_w["time_left_text"]))

print("=== 12. الإلغاء لا يرجع القيمة للأصلية ===")
# عقد قديم — سداد أساس + جزء تمديد — إلغاء الباقي:
# القيمة = الأساس + التمديد المسدد (لا ترجع للأصلية ولا يظهر متبق سالب)
_start12 = _sub_months(_date.today(), 8)
con_v = contract_service.add_contract(Contract(
    contract_number="CON-0091", customer_id=cid,
    contract_date=_start12.isoformat(), contract_name="إشراف قيمة",
    amount=1000.0))
sup.setup_supervision(con_v, _start12.isoformat(), 5, 200.0)
st_v = sup.supervision_status(con_v)
_ext_m = st_v["extension_months"]
lc.add_voucher("receipt", _date.today().isoformat(), "", "نقدًا", "", 1300.0,
               "أساس + 1.5 شهر تمديد", contract_id=con_v,
               party_type="customer", party_id=cid)
sup.waive_extension_months(con_v, _ext_m - 1.5, "تسوية")
st_v = sup.supervision_status(con_v)
check("بعد الإلغاء: المستحق = 1300 وليس 1000",
      abs(st_v["total_due"] - 1300.0) < 0.001, str(st_v["total_due"]))
check("المتبقي صفر (لا سالب)", abs(st_v["remaining"]) < 0.001)
_em = sup.extensions_map()
check("extensions_map تشمل العقد بعد المخالصة (للقيمة بالعروض)",
      con_v in _em and abs(_em[con_v]["extension_value"] - 300.0) < 0.001)
check("لا تنبيه تمديد بعد المخالصة",
      all(s["contract_id"] != con_v for s in sup.contracts_in_extension()))

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
sys.exit(1 if FAIL else 0)
