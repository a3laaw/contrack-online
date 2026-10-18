# -*- coding: utf-8 -*-
"""اختبار أداة التنظيف الشاملة — V8.1"""
import os, sys, tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_APP = os.path.dirname(_HERE)
if _APP not in sys.path:
    sys.path.insert(0, _APP)

os.environ["QT_QPA_PLATFORM"] = "offscreen"
_DB = tempfile.mkdtemp()
os.environ.setdefault("CONTRACK_DB_PATH", os.path.join(_DB, "test.db"))

from PySide6.QtWidgets import QApplication
app = QApplication(sys.argv)

from database.database import init_db, get_connection
init_db()

# تجاوز فحص المطور للاختبار
from services import auth_service
auth_service._dev_override = True
_orig_is_dev = auth_service.is_developer
auth_service.is_developer = lambda: True
auth_service.display_name = lambda: "مطور اختبار"
auth_service.current_username = lambda: "test_dev"

from services import cleanup_service as cs
from services.customer_service import ValidationError

PASS = FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} | {detail}")


# === إعداد بيانات تجريبية ===
conn = get_connection()

# عميل + عقد + سند
conn.execute("INSERT INTO customers (customer_code, name, phone) "
             "VALUES ('C001', 'عميل تجريبي', '12345678')")
conn.execute("INSERT INTO contracts (contract_number, customer_id, amount, description, contract_date) "
             "VALUES ('CON-001', 1, 50000, 'عقد تجريبي', '2026-01-01')")
conn.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, party, amount, contract_id) "
             "VALUES ('V001', 'receipt', '2026-01-01', 'عميل تجريبي', 10000, 1)")

# مقاول + عقد باطن
conn.execute("INSERT INTO subcontractors (sub_code, name, phone, activity) "
             "VALUES ('S001', 'مقاول تجريبي', '87654321', 'بناء')")
conn.execute("INSERT INTO sub_contracts (subcontractor_id, contract_id, amount, description) "
             "VALUES (1, 1, 30000, 'عقد باطن تجريبي')")
conn.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, party, amount, sub_contract_id) "
             "VALUES ('V002', 'payment', '2026-01-02', 'مقاول تجريبي', 5000, 1)")

conn.commit()
conn.close()


# === اختبار البحث ===
print("=== 1. البحث الشامل ===")
results = cs.search_all("تجريبي")
check("البحث يجد العملاء", "العملاء" in results)
check("البحث يجد المقاولين", "المقاولون" in results)
check("العدد صحيح", len(results["العملاء"]) == 1 and len(results["المقاولون"]) == 1)


# === اختبار تفاصيل العميل ===
print("\n=== 2. تفاصيل العميل ===")
details = cs.customer_details(1)
check("تفاصيل العميل موجودة", bool(details))
check("يوجد عميل", "عميل" in details)
check("العقود موجودة", "العقود" in details.get("المرتبطة", {}))
check("السندات موجودة", "السندات" in details.get("المرتبطة", {}))
check("الإحصائيات موجودة", bool(details.get("إحصائيات")))


# === اختبار تفاصيل المقاول ===
print("\n=== 3. تفاصيل المقاول ===")
details = cs.subcontractor_details(1)
check("تفاصيل المقاول موجودة", bool(details))
check("يوجد مقاول", "مقاول" in details)
check("عقود الباطن موجودة", "عقود_الباطن" in details.get("المرتبطة", {}))
check("السندات موجودة", "السندات" in details.get("المرتبطة", {}))


# === اختبار معاينة الحذف ===
print("\n=== 4. معاينة الحذف ===")
preview = cs.preview_delete_customer(1)
check("المعاينة موجودة", bool(preview))
check("تحتوي تحذيرات", bool(preview.get("warnings")))
check("تحتوي إحصائيات", bool(preview.get("stats")))

preview_sub = cs.preview_delete_subcontractor(1)
check("معاينة المقاول موجودة", bool(preview_sub))
check("تحتوي تحذيرات", bool(preview_sub.get("warnings")))


# === اختبار التقرير ===
print("\n=== 5. التقرير الشامل ===")
report = cs.developer_report()
check("التقرير موجود", bool(report))
check("يوجد كيانات رئيسية", bool(report.get("كيانات_رئيسية")))
check("يوجد أنواع عقود", bool(report.get("أنواع_العقود")))
check("يوجد مراحل عمل", bool(report.get("مراحل_العمل")))
check("يوجد حسابات مصروفات", bool(report.get("حسابات_المصروفات")))
check("يوجد طرق دفع", bool(report.get("طرق_الدفع")))
check("يوجد إعدادات", bool(report.get("الإعدادات")))


# === اختبار الحذف ===
print("\n=== 6. حذف المقاول ===")
# محاولة حذف بدون سبب
try:
    cs.delete_subcontractor(1, "")
    check("يرفض بدون سبب", False)
except ValidationError:
    check("يرفض بدون سبب", True)

# حذف مع سبب
try:
    result = cs.delete_subcontractor(1, "اختبار حذف", True, True)
    check("حذف المقاول ناجح", result.get("المقاول") == 1)
    check("حذف عقود الباطن", result.get("عقود_باطن", 0) >= 1)
except Exception as e:
    check("حذف المقاول ناجح", False, str(e))

# التحقق من الحذف
conn = get_connection()
n = conn.execute("SELECT COUNT(*) FROM subcontractors").fetchone()[0]
check("المقاول محذوف", n == 0)
n = conn.execute("SELECT COUNT(*) FROM sub_contracts").fetchone()[0]
check("عقود الباطن محذوفة", n == 0)
conn.close()


# === اختبار حذف العميل ===
print("\n=== 7. حذف العميل ===")
try:
    result = cs.delete_customer(1, "اختبار حذف عميل", True, True)
    check("حذف العميل ناجح", result.get("العميل") == 1)
except Exception as e:
    check("حذف العميل ناجح", False, str(e))

# التحقق
conn = get_connection()
n = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
check("العميل محذوف", n == 0)
n = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0]
check("العقود محذوفة", n == 0)
n = conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
check("السندات محذوفة", n == 0)
conn.close()


# === اختبار سجل التدقيق ===
print("\n=== 8. سجل التدقيق ===")
from services import purge_service as pg
pg._ensure_audit_table()
log = pg.audit_log(10)
check("سجل التدقيق موجود", len(log) >= 2)
check("يحتوي حذف مقاول", any(r.get("entity") == "subcontractor" for r in log))
check("يحتوي حذف عميل", any(r.get("entity") == "customer" for r in log))


# === النتيجة ===
print(f"\n{'=' * 50}")
print(f"النتيجة: {PASS}/{PASS + FAIL} {'✅' if FAIL == 0 else '❌'}")
if FAIL:
    sys.exit(1)
