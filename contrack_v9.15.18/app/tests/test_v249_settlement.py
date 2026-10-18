# -*- coding: utf-8 -*-
"""V2.49: تصفية البوابات مع البنك — الأيام + البنك + المحرك + الشاشة."""
import os
import sys
from datetime import date

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

db.DB_PATH = "/tmp/v249.sqlite"
if os.path.exists("/tmp/v249.sqlite"):
    os.remove("/tmp/v249.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import settlement_service as st  # noqa: E402

print("=== 1. أيام العمل ===")
thu = date(2026, 9, 10)  # خميس
check("الخميس + 1 = الأحد",
      st.add_business_days(thu, 1) == date(2026, 9, 13),
      st.add_business_days(thu, 1))
check("الجمعة عطلة", not st.is_workday(date(2026, 9, 11)))
check("الأحد عمل", st.is_workday(date(2026, 9, 13)))

print("=== 2. ملفات البوابات ===")
pid = st.save_profile(None, "KNET", "KW-001", "KNET,رابط", 1, 0.150)
check("حفظ + قراءة",
      st.get_profile(pid)["fee_fixed"] == 0.150)
st.save_profile(pid, "KNET", "KW-001", "KNET,رابط", 2, 0.200)
check("تعديل", st.get_profile(pid)["lag_days"] == 2)
st.save_profile(pid, "KNET", "KW-001", "KNET,رابط", 1, 0.150)

print("=== 3. استيراد كشف البنك ===")
from openpyxl import Workbook  # noqa: E402

wb = Workbook()
ws = wb.active
ws.append(["التاريخ", "البيان", "مدين", "دائن"])
ws.append(["2026-09-13", "تحويل بوابة", 0, 299.700])
ws.append(["2026-09-13", "سحب", 50.0, 0])
wb.save("/tmp/v249_bank.xlsx")
lines = st.read_bank_excel("/tmp/v249_bank.xlsx")
check("الإيداعات فقط",
      len(lines) == 1 and lines[0]["amount"] == 299.7, lines)
n = st.save_bank_lines("KW-001", lines, "b1")
n2 = st.save_bank_lines("KW-001", lines, "b1")
check("منع التكرار", n == 1 and n2 == 0, (n, n2))

print("=== 4. المحرك الثلاثي ===")
c1 = customer_service.add_customer(Customer(
    customer_code="C-S1", name="عميل التسوية", phone="99110011"))
k1 = contract_service.add_contract(Contract(
    contract_number="K-S1", customer_id=c1, contract_date="2026-09-01",
    description="ع", amount=5000.0, contract_type="مقاولة عامة"))
lc.add_voucher("receipt", "2026-09-10", "", "KNET", "", 300.0, "رابط",
               contract_id=k1, party_type="customer", party_id=c1)
st.save_gateway_ops("KNET", [
    {"phone": "99110011", "amount": 300.0, "date": "2026-09-10",
     "ref": "R1", "status": "mine", "receipt_no": "RV-0001",
     "customer": "عميل التسوية"},
    {"phone": "90000000", "amount": 100.0, "date": "2026-09-10",
     "ref": "R2", "status": "other", "receipt_no": "",
     "customer": ""},
], "g1")
st.distribute_rows("KNET", [("2026-09-10", "99110011", 300.0, "R1"),
                            ("2026-09-10", "90000000", 100.0, "R2")])
rows = st.daily_clearing("2026-09-01", "2026-09-30", "KNET")
r = [x for x in rows if x["day"] == "2026-09-10"][0]
check("وارد السيستم والبوابة", r["sys"] == 300.0 and r["g_mine"] == 300.0, r)
check("المتوقع = 400 − 2×0.150",
      r["expect"] == 399.7, r["expect"])
check("التسوية T+1 = الأحد", r["settle_date"] == "2026-09-13",
      r["settle_date"])
# البنك 299.7 لا يطابق 399.7 → نضيف الحركة الصحيحة
st.save_bank_lines("KW-001", [{"cdate": "2026-09-13", "amount": 399.7,
                               "descr": "SET"}], "b2")
rows = st.daily_clearing("2026-09-01", "2026-09-30", "KNET")
r = [x for x in rows if x["day"] == "2026-09-10"][0]
check("مربوط ومكتمل",
      r["status"] == "done" and r["bank_amount"] == 399.7, r)
check("التقسيم",
      r["my_share"] == 299.85 and r["other_share"] == 99.85, r)
un = st.unmatched_bank("2026-09-01", "2026-09-30", "KNET")
check("البنك بلا ربط", len(un) == 1 and un[0]["amount"] == 299.7, un)
os_stmt = st.other_statement("2026-09-01", "2026-09-30")
check("كشف الأخرى",
      len(os_stmt) == 1 and os_stmt[0]["cumulative"] == 99.85, os_stmt)
check("بلا متأخرات", st.late_settlements() == [])
d = st.day_detail("KNET", "2026-09-10")
check("تفاصيل اليوم",
      len(d["ops"]) == 2 and len(d["vouchers"]) == 1, d)

print("=== 5. الشاشة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.clearing_page import ClearingPage, GatewayProfilesDialog  # noqa: E402

pg = ClearingPage()
pg.show()
app.processEvents()
check("صفوف التصفية", pg.table.rowCount() >= 1, pg.table.rowCount())
pg.views.setCurrentData("other")
app.processEvents()
check("كشف الأخرى", pg.table.rowCount() == 1, pg.table.rowCount())
pg.views.setCurrentData("bank")
app.processEvents()
check("بنك بلا ربط", pg.table.rowCount() == 1, pg.table.rowCount())
dlg = GatewayProfilesDialog()
check("حوار البوابات", dlg.table.rowCount() >= 1, dlg.table.rowCount())

print("=== 6. التثبيت من شاشة البوابة ===")
from ui.gateway_page import GatewayPage  # noqa: E402

wb2 = Workbook()
ws2 = wb2.active
ws2.append(["رقم الهاتف", "المبلغ", "تاريخ التسوية", "المرجع"])
ws2.append(["99110011", 300.0, "2026-09-10", "R1"])
wb2.save("/tmp/v249_gw.xlsx")
gp = GatewayPage()
i = gp.gw_combo.findData("KNET")
gp.gw_combo.setCurrentIndex(i)
check("استيراد + تثبيت", gp.import_file("/tmp/v249_gw.xlsx") == 1)
with db.get_connection() as conn:
    cnt = conn.execute(
        "SELECT COUNT(*) FROM gateway_ops WHERE gateway='KNET'").fetchone()[0]
check("مثبت بلا تكرار", cnt == 2, cnt)

print("=== 7. الدمج في بوابة الدفع ===")
from ui.main_window import IDX_GATEWAY, PAGE_PERMS  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

check("ثابت + صلاحية",
      IDX_GATEWAY == 14 and PAGE_PERMS[IDX_GATEWAY] == "screen_gateway")  # V3.27
mg = PaymentGatewayPage()
check("تبويبان بلا مطابقة (V4.40)",
      mg.stack.count() == 2 and mg.tabs.count() == 2
      and mg.tabs.currentData() == "match"
      and not hasattr(mg, "ours_tab")
      and not hasattr(mg, "clear_tab"))
mg.show_tab("match")
mg.match_tab.set_filter("dist")
app.processEvents()
check("الموزَّع عرض داخل التصنيف",
      mg.stack.currentIndex() == 0
      and mg.match_tab._filter == "dist")
check("ملفات البوابات في ⋯ التصنيف",
      "⚙️ ملفات البوابات"
      in [a.text() for a in mg.match_tab.more_btn.menu().actions()]
      and hasattr(mg.match_tab, "_open_profiles"))
mg.show_tab("other")
app.processEvents()
check("التبديل للشركة الأخرى", mg.stack.currentIndex() == 1)
mg.show_tab("other", "due")
app.processEvents()
check("المستحق تبويب داخل الأخرى",
      mg.stack.currentIndex() == 1
      and mg.other_tab.mode.currentData() == "due")

for f in ("/tmp/v249.sqlite", "/tmp/v249_bank.xlsx", "/tmp/v249_gw.xlsx"):
    if os.path.exists(f):
        os.remove(f)
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
