# -*- coding: utf-8 -*-
"""V3.2: العقود والبوابات والعهد والهوية — المراحل 1-3."""
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

db.DB_PATH = "/tmp/v32.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v32.sqlite" + _s):
        os.remove("/tmp/v32.sqlite" + _s)
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service  # noqa: E402

cust = customer_service.add_customer(Customer(
    customer_code="C-321", name="عميل الفروقات", phone="90000001",
    address="الكويت", notes=""))

# عقد بفارق: مبلغ 150 ودفعتان 300+300 (حقن مباشر)
cid = contract_service.add_contract(Contract(
    contract_number="GAP-1", customer_id=cust, contract_date="2026-09-01",
    description="عقد فروقات", amount=150.0, contract_type="مقاولة عامة"))
with get_connection() as c:
    c.execute("INSERT INTO payment_plan (contract_id, title, due_date, "
              "amount) VALUES (?,?,?,?)",
              (cid, "دفعة 1", "2026-10-01", 300.0))
    c.execute("INSERT INTO payment_plan (contract_id, title, due_date, "
              "amount) VALUES (?,?,?,?)",
              (cid, "دفعة 2", "2026-11-01", 300.0))

print("=== 1. تقرير الفروقات + إعادة التوزيع ===")
gaps = report_service.contract_gaps_report()
check("رُصد فارق واحد", gaps["count"] == 1, gaps)
check("قيمة الفارق 450",
      gaps["rows"] and abs(gaps["rows"][0]["gap_plan"] - 450.0) < 0.01,
      gaps)
n = lc.rescale_payment_plan(cid, 150.0)
check("أُعيد توزيع دفعتين", n == 2, n)
rows = lc.contract_payment_plan(cid)
check("75 + 75 = 150",
      [float(r["amount"]) for r in rows] == [75.0, 75.0], rows)
check("لا فروقات بعد الإصلاح",
      report_service.contract_gaps_report()["count"] == 0)

print("=== 2. بوابة الدفع الموحدة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
app = QApplication.instance() or QApplication([])
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402
pg = PaymentGatewayPage()
check("تبويبا البوابة (V4.40: بلا مطابقة)", pg.stack.count() == 2)
check("الافتراضي مطابقة", pg.tabs.currentData() == "match")
pg.show_tab("other")
app.processEvents()
check("التبديل للأخرى يعمل", pg.stack.currentIndex() == 1)
try:
    import ui.main_window as mw
    check("IDX_CLEARING أُزيل", not hasattr(mw, "IDX_CLEARING"))
    check("صلاحية البوابة", mw.PAGE_PERMS[mw.IDX_GATEWAY] == "screen_gateway")  # V3.27
except Exception as exc:  # pragma: no cover
    check("تسجيل البوابة", False, exc)

print("=== 3. التقرير المجمع ===")
with get_connection() as c:
    c.execute("UPDATE settings SET opening_balance_cash=50000 WHERE id=1")
aid = ea.custody_items()[0][1]
exp = [a for a in ea.posting_items() if a[1]][0][1]
lc.add_voucher("payment", "2026-09-01", "موظف", "نقدًا", "", 5000.0,
               "تسليم", custody_account_id=aid)
lc.add_custody_settlement("2026-09-05", aid, [
    {"amount": 1200.0, "expense_account_id": exp, "party": "م",
     "description": "بند"}])
lc.add_custody_settlement("2026-09-10", aid, [
    {"amount": 800.0, "expense_account_id": exp, "party": "و",
     "description": "بند"}])
s = lc.settlements_summary("2026-09-01", "2026-09-30", aid)
check("تصفيتان", s["count"] == 2, s)
check("الإجمالي 2000", abs(s["total"] - 2000.0) < 0.01, s)
check("خارج الفترة فارغ",
      lc.settlements_summary("2026-08-01", "2026-08-31",
                             aid)["count"] == 0)
from ui.custody_center import SettlementsReportDialog  # noqa: E402
dlg = SettlementsReportDialog()
dlg.d1.setDate(dlg.d1.date().fromString("2026-09-01", "yyyy-MM-dd"))
dlg.d2.setDate(dlg.d2.date().fromString("2026-09-30", "yyyy-MM-dd"))
dlg.refresh()
app.processEvents()
check("صفوف الحوار 4", dlg.table.rowCount() == 4,
      dlg.table.rowCount())
check("صفوف التصدير 4", len(dlg._rows_export()) == 4)

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
