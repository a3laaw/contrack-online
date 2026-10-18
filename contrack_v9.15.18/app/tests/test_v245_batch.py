# -*- coding: utf-8 -*-
"""انحدار V2.45: ذرية الحفظ + تسوية الرسوم عند التعديل + أعمدة التقرير."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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

db.DB_PATH = "/tmp/v245.sqlite"
if os.path.exists("/tmp/v245.sqlite"):
    os.remove("/tmp/v245.sqlite")
db.init_db()
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402
from services import settings_service as st  # noqa: E402

mid = next(m["id"] for m in st.list_payment_methods() if m["name"] == "تحويل بنكي")
st.update_payment_method(mid, "تحويل بنكي", "amount", 0.300)

c1 = customer_service.add_customer(Customer(
    customer_code="C-45A", name="عميل تجربة", phone="99110011"))
k1 = contract_service.add_contract(Contract(
    contract_number="K-45A", customer_id=c1, contract_date="2026-01-01",
    description="عقد تجربة", amount=10000.0, contract_type="مقاولة عامة"))

print("=== 1. الذرية: فشل في المنتصف = rollback كامل ===")
_real_journal = lc._insert_voucher_journal
lc._insert_voucher_journal = lambda *a, **k: (_ for _ in ()).throw(
    RuntimeError("عطل مصطنع"))
try:
    lc.add_voucher("receipt", "2026-03-01", "", "نقدًا", "", 500.0,
                   "لن يُحفظ", contract_id=k1, party_type="customer",
                   party_id=c1)
    check("الفشل يرفع خطأ", False, "لم يرفع!")
except RuntimeError:
    check("الفشل يرفع خطأ", True)
finally:
    lc._insert_voucher_journal = _real_journal
with get_connection() as c:
    n = c.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
check("لا سند جزئي بعد الفشل", n == 0, n)
check("العمق عاد لصفر", get_connection()._depth == 0,
      get_connection()._depth)

print("=== 2. تسوية الرسوم — سند مفرد ===")
vid = lc.add_voucher("receipt", "2026-03-01", "", "نقدًا", "", 1000.0,
                     "دفعة", contract_id=k1, party_type="customer",
                     party_id=c1)


def kids(v):
    with get_connection() as c:
        return [(float(r["amount"]), int(r["cancelled"])) for r in c.execute(
            "SELECT amount, cancelled FROM vouchers WHERE parent_voucher_id=? "
            "ORDER BY id", (v,)).fetchall()]


check("نقدًا: بلا رسوم", kids(vid) == [])
lc.update_voucher(vid, "2026-03-01", "تحويل بنكي", 1000.0, "دفعة",
                  contract_id=k1, party_type="customer", party_id=c1)
check("تحويل: رسوم 0.300 نشطة", kids(vid) == [(0.3, 0)], kids(vid))
lc.update_voucher(vid, "2026-03-02", "تحويل بنكي", 2000.0, "دفعة",
                  contract_id=k1, party_type="customer", party_id=c1)
check("تعديل المبلغ: قديم ملغى + جديد نشط",
      kids(vid) == [(0.3, 1), (0.3, 0)], kids(vid))
lc.update_voucher(vid, "2026-03-02", "نقدًا", 2000.0, "دفعة",
                  contract_id=k1, party_type="customer", party_id=c1)
check("عودة لنقدًا: الكل ملغى",
      kids(vid) and all(c == 1 for _, c in kids(vid)), kids(vid))

print("=== 3. تسوية الرسوم — مجمع ===")
c2 = customer_service.add_customer(Customer(
    customer_code="C-45B", name="عميل ثان", phone="99220022"))
k2 = contract_service.add_contract(Contract(
    contract_number="K-45B", customer_id=c2, contract_date="2026-01-01",
    description="ع", amount=10000.0, contract_type="مقاولة عامة"))
g = lc.add_grouped_receipts(
    "2026-04-01", "تحويل بنكي", "",
    [{"customer_id": c1, "contract_id": k1, "amount": 300,
      "description": "س1"},
     {"customer_id": c2, "contract_id": k2, "amount": 200,
      "description": "س2"}])
check("المجموعة: رسمان 0.150",
      g["fee_each"] == [0.150, 0.150] and len(g["fee_ids"]) == 2,
      g["fee_each"])
r1 = g["receipt_ids"][0]
lc.update_voucher(r1, "2026-04-01", "تحويل بنكي", 500.0, "س1 معدل",
                  contract_id=k1, party_type="customer", party_id=c1)
with get_connection() as c:
    act = [float(r["amount"]) for r in c.execute(
        "SELECT amount FROM vouchers WHERE parent_voucher_id IN "
        "(SELECT id FROM vouchers WHERE receipt_group_ref=? AND vtype='receipt') "
        "AND COALESCE(cancelled,0)=0 ORDER BY id",
        (g["group_number"],)).fetchall()]
check("إعادة التوزيع: قسمان نشطان بمجموع 0.300",
      len(act) == 2 and abs(sum(act) - 0.300) < 0.001, act)

print("=== 4. أعمدة التقرير ===")
d = rep.cash_flow_detail()
rec = [r for r in d["receipts"] if r["amount"] == 2000.0][0]
check("الهاتف في التفصيلي", rec.get("phone") == "99110011",
      rec.get("phone"))
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui import reports_page  # noqa: E402

app = QApplication.instance() or QApplication([])
spec = reports_page._data_cash_flow("receipts_only")
check("رؤوس الإكسل 6 أعمدة (V4.54: بلا هاتف)",
      spec["heads"] == ["م", "التاريخ", "العميل", "العقد",
                        "المبلغ", "البيان"], spec["heads"])
check("طول الصفوف يطابق الرؤوس",
      all(len(r) == 6 for r in spec["rows"]) and len(spec["totals"]) == 6)
spec_d = reports_page._data_cash_flow("detail")
check("التفصيلي 6 أعمدة",
      len(spec_d["heads"]) == 6
      and all(len(r) == 6 for r in spec_d["rows"]), len(spec_d["heads"]))

os.remove("/tmp/v245.sqlite")
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
