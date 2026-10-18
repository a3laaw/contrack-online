# -*- coding: utf-8 -*-
"""اختبار شامل لسير العمل الكامل حسب المتطلبات (بدون واجهة رسومية)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# استخدام قاعدة بيانات مؤقتة للاختبار
import database.database as db
_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database.database import init_db, backup_db, restore_db, DatabaseError
from database.models import Customer, Contract, Invoice, Settings
from services import (customer_service, contract_service, invoice_service,
                      statement_service, settings_service)
from services.customer_service import ValidationError

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def expect_error(name: str, fn, *args):
    try:
        fn(*args)
        check(name, False, "(لم يُرفض كما هو متوقع)")
    except (ValidationError, DatabaseError) as exc:
        check(name, True)
        print(f"         الرسالة: {str(exc).splitlines()[0]}")


print("=== تهيئة قاعدة البيانات ===")
init_db()
check("إنشاء الجداول", True)

print("\n=== 1. إضافة عميل ===")
code = customer_service.next_customer_code()
check("توليد رقم العميل CUS-0001", code == "CUS-0001", f"got {code}")
cid = customer_service.add_customer(Customer(
    customer_code=code, name="شركة ABC", phone="99887766",
    address="الكويت - الأحمدي", email="info@abc.com", notes="عميل مهم"))
check("إضافة العميل", cid == 1)
expect_error("رفض عميل بدون اسم", customer_service.add_customer,
             Customer(customer_code="CUS-0002", name="  "))
expect_error("رفض رقم عميل مكرر", customer_service.add_customer,
             Customer(customer_code="CUS-0001", name="آخر"))

print("\n=== 2. إنشاء عقد بقيمة 5,000 ===")
con_no = contract_service.next_contract_number()
check("توليد رقم العقد CON-0001", con_no == "CON-0001", f"got {con_no}")
contract_id = contract_service.add_contract(Contract(
    contract_number=con_no, customer_id=cid, contract_date="2026-08-01",
    description="عقد صيانة سنوي", amount=5000.0))
c = contract_service.get_contract(contract_id)
check("قيمة العقد 5000", c.amount == 5000.0)
check("المتبقي 5000 قبل أي فاتورة", c.remaining == 5000.0)
expect_error("رفض عقد بقيمة صفر", contract_service.add_contract,
             Contract(contract_number="CON-0002", customer_id=cid,
                      contract_date="2026-08-01", amount=0))
expect_error("رفض عقد بقيمة سالبة", contract_service.add_contract,
             Contract(contract_number="CON-0003", customer_id=cid,
                      contract_date="2026-08-01", amount=-100))

print("\n=== 3-4. فاتورة 1,000 → المتبقي 4,000 ===")
inv_no = invoice_service.next_invoice_number()
check("توليد رقم الفاتورة INV-0001", inv_no == "INV-0001", f"got {inv_no}")
inv1 = invoice_service.add_invoice(Invoice(
    invoice_number=inv_no, customer_id=cid, contract_id=contract_id,
    invoice_date="2026-08-05", description="الدفعة الأولى", amount=1000.0))
fin = invoice_service.contract_financials(contract_id)
check("المتبقي = 4000", fin["remaining"] == 4000.0, f"got {fin['remaining']}")

print("\n=== 5-6. فاتورة 2,000 → المتبقي 2,000 ===")
inv_no2 = invoice_service.next_invoice_number()
check("توليد INV-0002", inv_no2 == "INV-0002", f"got {inv_no2}")
inv2 = invoice_service.add_invoice(Invoice(
    invoice_number=inv_no2, customer_id=cid, contract_id=contract_id,
    invoice_date="2026-08-10", description="الدفعة الثانية", amount=2000.0))
fin = invoice_service.contract_financials(contract_id)
check("المتبقي = 2000", fin["remaining"] == 2000.0, f"got {fin['remaining']}")

print("\n=== 7-8. رفض فاتورة 2,500 (أكبر من المتبقي) ===")
expect_error("رفض فاتورة تتجاوز المتبقي", invoice_service.add_invoice,
             Invoice(invoice_number="INV-0003", customer_id=cid,
                     contract_id=contract_id, invoice_date="2026-08-12",
                     amount=2500.0))
expect_error("رفض فاتورة بقيمة صفر", invoice_service.add_invoice,
             Invoice(invoice_number="INV-0004", customer_id=cid,
                     contract_id=contract_id, invoice_date="2026-08-12",
                     amount=0))
expect_error("رفض فاتورة بقيمة سالبة", invoice_service.add_invoice,
             Invoice(invoice_number="INV-0005", customer_id=cid,
                     contract_id=contract_id, invoice_date="2026-08-12",
                     amount=-50))

print("\n=== كشف الحساب (مدين / دائن) ===")
st = statement_service.build_statement(contract_id)
check("عدد صفوف الحركة = 3 (عقد + فاتورتان للعلم)", len(st["rows"]) == 3)
check("الصف الأول: قيمة العقد مدين 5000", st["rows"][0]["debit"] == 5000.0)
check("الصف الأول: دائن صفر", st["rows"][0]["credit"] == 0.0)
check("الصف الأول: رصيد 5000", st["rows"][0]["balance"] == 5000.0)
check("الصف الثاني: فاتورة للعلم (محايدة)",
      st["rows"][1]["credit"] == 0.0
      and "للعلم" in st["rows"][1]["description"])
check("الصف الثاني: الرصيد ثابت 5000", st["rows"][1]["balance"] == 5000.0)
check("الصف الثالث: فاتورة للعلم (محايدة)", st["rows"][2]["credit"] == 0.0)
check("الصف الثالث: الرصيد ثابت 5000", st["rows"][2]["balance"] == 5000.0)
check("إجمالي المدين = 5000", st["total_debit"] == 5000.0)
check("إجمالي الدائن = 0 (لا تحصيل بعد)", st["total_credit"] == 0.0)
check("إجمالي الفواتير = 3000", st["total_invoiced"] == 3000.0)
check("المتبقي = القيمة − المحصّل = 5000", st["remaining"] == 5000.0)

print("\n=== 9-10. إنشاء PDF (فاتورة + كشف حساب) ===")
settings_service.save_settings(Settings(
    company_name="شركة الاختبار للتجارة العامة",
    company_address="الكويت - الأحمدي - قطعة 4",
    company_phone="+965 2398 0000", company_email="info@test.com",
    logo_path="", currency="د.ك"))
from reports.invoice_pdf import generate_invoice_pdf
from reports.statement_pdf import generate_statement_pdf
inv_obj = invoice_service.get_invoice(inv1)
pdf1 = os.path.join(_tmpdir, "invoice.pdf")
generate_invoice_pdf(inv_obj, pdf1)
check("إنشاء فاتورة PDF", os.path.exists(pdf1) and os.path.getsize(pdf1) > 2000)
pdf2 = os.path.join(_tmpdir, "statement.pdf")
generate_statement_pdf(contract_id, pdf2)
check("إنشاء كشف حساب PDF", os.path.exists(pdf2) and os.path.getsize(pdf2) > 2000)

print("\n=== 11-12. تعديل الفاتورة وتحديث الرصيد ===")
inv_obj2 = invoice_service.get_invoice(inv2)
inv_obj2.amount = 1500.0
invoice_service.update_invoice(inv_obj2)
fin = invoice_service.contract_financials(contract_id)
check("بعد تعديل INV-0002 إلى 1500 → المتبقي 2500",
      fin["remaining"] == 2500.0, f"got {fin['remaining']}")
# تعديل بقيمة تتجاوز المتبقي يجب أن يُرفض
inv_obj2 = invoice_service.get_invoice(inv2)
inv_obj2.amount = 4500.0
expect_error("رفض تعديل فاتورة يتجاوز المتبقي", invoice_service.update_invoice, inv_obj2)
# لكن تعديلها إلى كامل المتبقي + قيمتها الحالية مسموح (استثناء الفاتورة نفسها)
inv_obj2 = invoice_service.get_invoice(inv2)
inv_obj2.amount = 4000.0  # 1000 + 4000 = 5000 = قيمة العقد
invoice_service.update_invoice(inv_obj2)
fin = invoice_service.contract_financials(contract_id)
check("تعديل لكامل المتبقي مسموح → المتبقي 0", fin["remaining"] == 0.0)
inv_obj2.amount = 1500.0
invoice_service.update_invoice(inv_obj2)

print("\n=== 13-14. حذف الفاتورة وتحديث الرصيد ===")
invoice_service.delete_invoice(inv2)
fin = invoice_service.contract_financials(contract_id)
check("بعد حذف INV-0002 → المتبقي 4000", fin["remaining"] == 4000.0)
st = statement_service.build_statement(contract_id)
check("كشف الحساب تحدّث تلقائيًا (صفّان)", len(st["rows"]) == 2)

print("\n=== منع الحذف المرتبط ===")
expect_error("منع حذف عميل مرتبط بعقد", customer_service.delete_customer, cid)
expect_error("منع حذف عقد مرتبط بفواتير", contract_service.delete_contract, contract_id)

print("\n=== 15. النسخ الاحتياطي والاستعادة ===")
bak = os.path.join(_tmpdir, "backup.sqlite")
backup_db(bak)
check("إنشاء نسخة احتياطية", os.path.exists(bak) and os.path.getsize(bak) > 0)
# إضافة عميل جديد ثم الاستعادة → يجب أن يختفي
customer_service.add_customer(Customer(customer_code="CUS-0099", name="مؤقت", phone="50990099"))
check("عدد العملاء قبل الاستعادة = 2", customer_service.count_customers() == 2)
restore_db(bak)
check("عدد العملاء بعد الاستعادة = 1", customer_service.count_customers() == 1)
expect_error("رفض استعادة ملف غير صالح", restore_db, pdf1)

print("\n=== الإحصائيات ===")
stats = contract_service.dashboard_stats()
check("عدد العملاء = 1", stats["customers"] == 1)
check("عدد العقود = 1", stats["contracts"] == 1)
check("إجمالي العقود = 5000", stats["total_contracts"] == 5000.0)
check("إجمالي الفواتير = 1000", stats["total_invoices"] == 1000.0)
check("إجمالي المتبقي = 4000", stats["total_remaining"] == 4000.0)

print("\n=== البحث ===")
check("بحث عملاء بالاسم", len(customer_service.list_customers("ABC")) == 1)
check("بحث عملاء بالهاتف", len(customer_service.list_customers("99887766")) == 1)
check("بحث عقود بالرقم", len(contract_service.list_contracts("CON-0001")) == 1)
check("بحث فواتير بالرقم", len(invoice_service.list_invoices("INV-0001")) == 1)
check("بحث بدون نتائج", len(customer_service.list_customers("xyz123")) == 0)

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
sys.exit(1 if FAIL else 0)
