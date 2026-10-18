# -*- coding: utf-8 -*-
"""V2.47: التسميات المحاسبية (الوارد/المنصرف) + تمييز صفوف الأرصدة + توحيد الخط."""
import os
import sys
from types import SimpleNamespace

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

db.DB_PATH = "/tmp/v247.sqlite"
if os.path.exists("/tmp/v247.sqlite"):
    os.remove("/tmp/v247.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from ui import reports_page as rp  # noqa: E402

c1 = customer_service.add_customer(Customer(
    customer_code="C-247", name="عميل التسميات", phone="99110011"))
k1 = contract_service.add_contract(Contract(
    contract_number="K-247", customer_id=c1, contract_date="2026-09-01",
    description="ع", amount=5000.0, contract_type="مقاولة عامة"))
lc.add_voucher("receipt", "2026-09-10", "", "تحويل بنكي", "", 1000.0,
               "دفعة", contract_id=k1, party_type="customer", party_id=c1)
lc.add_voucher("payment", "2026-09-11", "", "نقدًا", "", 200.0,
               "صرف", contract_id=k1, party_type="customer", party_id=c1)
lc.add_voucher("transfer", "2026-09-12", "تحويل داخلي", "البنك",
               "الصندوق", 100.0, "تحويل")

print("=== 1. تسميات الكشف الشامل ===")
d = rp._data_cash_flow("detail", "2026-09-01", "2026-09-30")
labels = [str(r[1]) for r in d["rows"]]
check("قسم الوارد", "◀ الوارد" in labels, labels)
check("قسم المنصرف", "◀ المنصرف" in labels)
check("إجمالي الوارد", "الإجمالي · الوارد" in labels)
check("إجمالي المنصرف", "الإجمالي · المنصرف" in labels)
check("صافي الحركة", "صافي الحركة" in labels)
check("رصيد البنك", "رصيد البنك" in labels)
check("رصيد الصندوق", "رصيد الصندوق" in labels)
check("لا مقبوض/مصروف قديم",
      not any("المقبوض" in s or "المصروف" in s for s in labels
              if "المنصرف" not in s), labels)
check("الملاحظة محاسبية",
      "الوارد" in d["note"] and "المنصرف" in d["note"]
      and "صافي الحركة" in d["note"] and "رصيد البنك" in d["note"],
      d["note"])

print("=== 2. الكشوف الفرعية ===")
ri = rp._data_cash_flow("receipts_only", "2026-09-01", "2026-09-30")
check("وارد فقط", "وارد فقط" in ri["note"] and "إجمالي الوارد" in ri["note"],
      ri["note"])
po = rp._data_cash_flow("payments_only", "2026-09-01", "2026-09-30")
check("منصرف فقط",
      "منصرف فقط" in po["note"] and "إجمالي المنصرف" in po["note"],
      po["note"])
mo = rp._data_cash_flow("monthly", "2026-09-01", "2026-09-30")
check("أعمدة الفترات", "الوارد" in mo["heads"] and "المنصرف" in mo["heads"],
      mo["heads"])
vu = rp._data_vouchers_unified("2026-09-01", "2026-09-30")
check("ملاحظة حركة السندات",
      "إجمالي الوارد" in vu["note"] and "إجمالي المنصرف" in vu["note"]
      and "صافي الحركة" in vu["note"], vu["note"])
sc = rp._data_subcontractors()
check("المنصرف له", "المنصرف له" in sc["heads"], sc["heads"])

print("=== 3. التمييز اللوني والخط الأكبر ===")
from PySide6.QtWidgets import QApplication, QLabel, QTableWidget  # noqa: E402

app = QApplication.instance() or QApplication([])
ns = SimpleNamespace(table=QTableWidget(), _spec=d, _collapsed=set(),
                     note_lbl=QLabel(), note_card=QLabel(),
                     pager=SimpleNamespace(slice=lambda rows: rows))
rp._ReportView._redraw_page(ns)
tbl = ns.table
base = tbl.font().pointSizeF()
found = {}
for i in range(tbl.rowCount()):
    t = tbl.item(i, 1).text()
    if t in (d["accent_rows"] or {}):
        found[t] = i
check("الصفوف العشرة مرسومة (V4.54: + المسترد)", len(found) == 10, sorted(found))
ok = True
bgs = set()
for t, i in found.items():
    it = tbl.item(i, 1)
    f = it.font()
    if not (f.bold() and f.pointSizeF() > base):
        ok = False
    bgs.add(it.background().color().name())
check("عريض + أكبر", ok)
check("كل صف لون مختلف", len(bgs) == 10, bgs)

print("=== 4. توحيد خط صف العميل ===")
dc = rp._data_customers("2026-09-01", "2026-09-30")
ns2 = SimpleNamespace(table=QTableWidget(), _spec=dc, _collapsed=set(),
                      note_lbl=QLabel(), note_card=QLabel(),
                      pager=SimpleNamespace(slice=lambda rows: rows))
rp._ReportView._redraw_page(ns2)
t2 = ns2.table
tb = t2.font().pointSizeF()
cust_ok = True
for i in range(t2.rowCount()):
    it = t2.item(i, 0)
    if it and it.font().bold():
        if abs(it.font().pointSizeF() - tb) > 0.01:
            cust_ok = False
check("صف العميل بنفس حجم خط الجدول", tb >= 10.5 and cust_ok, tb)

print("=== 5. نافذة الصرف ===")
from ui.vouchers import VoucherDialog  # noqa: E402

dlg = VoucherDialog(None, "payment")
check("جهة الصرف",
      "جهة الصرف" in dlg.party_text.placeholderText(),
      dlg.party_text.placeholderText())

if os.path.exists("/tmp/v247.sqlite"):
    os.remove("/tmp/v247.sqlite")
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
