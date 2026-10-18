# -*- coding: utf-8 -*-
"""مطابقة بوابة الدفع: تطبيع الهاتف + مطابقة + شاشة + تصدير."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


import database.database as db  # noqa: E402

db.DB_PATH = "/tmp/gw.sqlite"
if os.path.exists("/tmp/gw.sqlite"):
    os.remove("/tmp/gw.sqlite")
db.init_db()
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import gateway_service as gw  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

print("=== 1. تطبيع الهاتف ===")
check("تجاهل رمز الدولة", gw.phones_match("+96599110011", "99110011"))
check("تجاهل الأصفار والمسافات",
      gw.phones_match("00965 9911 0011", "99110011"))
check("مختلف = لا", not gw.phones_match("99110011", "99220022"))
check("فارغ = لا", not gw.phones_match("", "99110011"))

print("=== 2. اكتشاف الأعمدة ===")
check("عربي", gw.detect_columns(["م", "رقم الهاتف", "المبلغ", "التاريخ"])
      == {"phone": 1, "amount": 2, "date": 3, "txn_date": 3})
check("إنجليزي", gw.detect_columns(["msisdn", "net", "ref"])
      == {"phone": 0, "amount": 1, "ref": 2})
check("ناقص = None", gw.detect_columns(["a", "b"]) is None)

print("=== 3. المطابقة ===")
c1 = customer_service.add_customer(Customer(
    customer_code="C-G1", name="عميل البوابة", phone="99110011"))
k1 = contract_service.add_contract(Contract(
    contract_number="K-G1", customer_id=c1, contract_date="2026-09-01",
    description="ع", amount=10000.0, contract_type="مقاولة عامة"))
lc.add_voucher("receipt", "2026-09-10", "", "KNET", "", 250.0,
               "رابط دفع", contract_id=k1, party_type="customer",
               party_id=c1)
rows = [{"phone": "99110011", "amount": 250.0, "date": "2026-09-11",
         "ref": "T1", "row_no": 2},
        {"phone": "+96599110011", "amount": 99.0, "date": "2026-09-11",
         "ref": "T2", "row_no": 3},
        {"phone": "90000000", "amount": 500.0, "date": "2026-09-11",
         "ref": "T3", "row_no": 4},
        {"phone": "", "amount": 10.0, "date": "", "ref": "T4",
         "row_no": 5}]
m = gw.match_settlement(rows)
check("مطابق = شركتي",
      m[0]["status"] == "mine" and m[0]["receipt_no"].startswith("RV-"),
      m[0])
check("فرق مبلغ = شركتي-فرق",
      m[1]["status"] == "diff" and "مختلف" in m[1]["note"], m[1])
check("غريب = ليست شركتي", m[2]["status"] == "other", m[2])
check("بلا هاتف = ليست شركتي", m[3]["status"] == "other", m[3])
s = gw.summary(m)
check("الملخص",
      s["mine"]["count"] == 1 and s["unmarked"]["count"] == 1
      and s["other"]["count"] == 2 and s["total"]["count"] == 4, s)

print("=== 4. قراءة ملف حقيقي ===")
from openpyxl import Workbook  # noqa: E402

wb = Workbook()
ws = wb.active
ws.append(["م", "رقم الهاتف", "المبلغ", "تاريخ التسوية", "المرجع"])
ws.append([1, "99110011", 250.0, "2026-09-11", "T1"])
ws.append([2, "90000000", 500.0, "2026-09-11", "T3"])
wb.save("/tmp/gw_settle.xlsx")
rd = gw.read_settlement_excel("/tmp/gw_settle.xlsx")
check("صفان مقروءان",
      len(rd) == 2 and rd[0]["amount"] == 250.0
      and rd[0]["date"] == "2026-09-11", rd)

print("=== 5. الشاشة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from services import settlement_service as st  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg.show()
check("استيراد الملف", pg.import_file("/tmp/gw_settle.xlsx") == 2)
app.processEvents()
check("الجدول يعرض الكل", pg.table.rowCount() == 2, pg.table.rowCount())
check("شارة شركتنا (تلقائي)", pg.table.item(0, 6).text() == "✅ شركتنا",
      pg.table.item(0, 6).text())
check("الغريب مقترح للأخرى + شارة",
      pg.table.item(1, 6).text() == "🏢 شركة أخرى"
      and "✨ مقترح: بلا سابقة" in pg.table.item(1, 10).text(),
      pg.table.item(1, 6).text() + pg.table.item(1, 10).text())
pg.set_filter("mine")
app.processEvents()
check("فلتر شركتنا", pg.table.rowCount() == 1, pg.table.rowCount())
pg.set_filter("unmarked")
app.processEvents()
check("فلتر غير مصنّف = صفر (الكل مقترح)",
      pg.table.rowCount() == 0, pg.table.rowCount())
pg.set_filter("other")
app.processEvents()
check("فلتر الأخرى = المقترح", pg.table.rowCount() == 1,
      pg.table.rowCount())
pg.set_filter("all")
pg.search.setText("90000000")
app.processEvents()
check("البحث", pg.table.rowCount() == 1, pg.table.rowCount())
pg.search.clear()
pg.set_filter("all")
app.processEvents()
pg._on_cell(1, 6)
check("التبديل ← غير مصنّف (ومسح الشارة)",
      pg.table.item(1, 6).text() == "⚪ غير مصنّف"
      and "✨" not in pg.table.item(1, 10).text(),
      pg.table.item(1, 6).text() + pg.table.item(1, 10).text())
pg._on_cell(1, 6)
check("التبديل ← شركتنا", pg.table.item(1, 6).text() == "✅ شركتنا",
      pg.table.item(1, 6).text())
pg._on_cell(1, 6)
check("التبديل ← شركة أخرى (قرار المستخدم)",
      pg.table.item(1, 6).text() == "🏢 شركة أخرى",
      pg.table.item(1, 6).text())
check("بلا أثر قبل التوزيع", st.other_dues_total() == 0.0,
      st.other_dues_total())
from ui import style as _style  # noqa: E402

_orig_ok = _style.success
_style.success = lambda *a, **k: None
try:
    pg.table.item(1, 0).setSelected(True)
    pg._distribute()
finally:
    _style.success = _orig_ok
check("الموزَّع اختفى", pg.table.rowCount() == 1, pg.table.rowCount())
check("المستحق = 500 بعد التوزيع",
      abs(st.other_dues_total() - 500.0) < 0.001,
      st.other_dues_total())
pg.search.clear()

print("=== 6. التصدير ===")
from reports.tabular_pdf import generate_table_excel  # noqa: E402

data = [[1, "99110011", 250.0, "2026-09-11", "T1", "✅ شركتي",
         m[0]["receipt_no"], "عميل البوابة", "مطابق"]]
generate_table_excel("اختبار", ["م", "الهاتف", "المبلغ", "التاريخ",
                                "المرجع", "الحالة", "سندنا", "العميل",
                                "ملاحظة"], data, "/tmp/gw_out.xlsx",
                     number_cols=[2])
check("ملف الإكسل موجود", os.path.exists("/tmp/gw_out.xlsx"))

print("=== 7. التسجيل في القائمة ===")
from ui.main_window import IDX_GATEWAY, PAGE_PERMS, MainWindow  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage as GP2  # noqa: E402
from ui.gateway_page import GatewayPage as GP_INNER  # noqa: E402

check("ثابت + صلاحية",  # V3.27: مفتاح مستقل
      IDX_GATEWAY == 14 and PAGE_PERMS[IDX_GATEWAY] == "screen_gateway")
from services import auth_service, feature_service  # noqa: E402

_op, _of = auth_service.has_permission, feature_service.enabled
auth_service.has_permission = lambda *a, **k: True
feature_service.enabled = lambda *a, **k: True
try:
    win = MainWindow()
    check("زر القائمة موجود",
          any("بوابة الدفع" in b.text()
              for b in win.nav_group.buttons()))
    gp = win.gateway_page
    check("الصفحة تُبنى",
          isinstance(gp, GP2) and isinstance(gp.match_tab, GP_INNER))
    check("بلا تبويب شركتنا (الموزَّع داخل التصنيف)",  # V4.30
          not hasattr(gp, "ours_tab")
          and "dist" in gp.match_tab._cards)
finally:
    auth_service.has_permission, feature_service.enabled = _op, _of

for f in ("/tmp/gw.sqlite", "/tmp/gw_settle.xlsx", "/tmp/gw_out.xlsx"):
    if os.path.exists(f):
        os.remove(f)
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
