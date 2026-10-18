# -*- coding: utf-8 -*-
"""V2.48: ضمانات الأداء — العدّادات + ذاكرة البناء + الدفعية."""
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

db.DB_PATH = "/tmp/v248.sqlite"
if os.path.exists("/tmp/v248.sqlite"):
    os.remove("/tmp/v248.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

c1 = customer_service.add_customer(Customer(
    customer_code="C-P1", name="عميل الأداء", phone="99110011"))
k1 = contract_service.add_contract(Contract(
    contract_number="K-P1", customer_id=c1, contract_date="2026-09-01",
    description="ع", amount=5000.0, contract_type="مقاولة عامة"))

print("=== 1. عدّادات الترقيم ===")
n1 = lc.next_voucher_number("receipt")
n2 = lc.next_voucher_number("receipt")
check("تسلسل بلا فجوات", n1 == "RV-0001" and n2 == "RV-0002", (n1, n2))
p1 = lc.next_voucher_number("receipt", _consume=False)
p2 = lc.next_voucher_number("receipt", _consume=False)
n3 = lc.next_voucher_number("receipt")
check("المعاينة لا تستهلك",
      p1 == p2 == "RV-0003" and n3 == "RV-0003", (p1, p2, n3))
lc.add_voucher("receipt", "2026-09-10", "", "نقدًا", "", 100.0, "ب",
               contract_id=k1, party_type="customer", party_id=c1)
with db.get_connection() as conn:
    got = conn.execute(
        "SELECT voucher_number FROM vouchers ORDER BY id DESC LIMIT 1"
    ).fetchone()[0]
check("الحفظ يستخدم العدّاد", got == "RV-0004", got)

print("=== 2. التوافق مع الأرقام القديمة ===")
with db.get_connection() as conn:
    conn.execute("DELETE FROM number_sequences")
lc.add_voucher("receipt", "2026-09-10", "", "نقدًا", "", 50.0, "ب",
               contract_id=k1, party_type="customer", party_id=c1,
               _voucher_number="RV-0007")
n4 = lc.next_voucher_number("receipt")
check("البذر من أعلى رقم", n4 == "RV-0008", n4)
lc._sync_counter("vouchers", "voucher_number", "PV", 12)
n5 = lc.next_voucher_number("payment")
check("المزامنة بعد الدفعات", n5 == "PV-0013", n5)

print("=== 3. ذاكرة البناء ===")
from services.qcache import build_cache, memo  # noqa: E402

calls = []
with build_cache():
    memo("k", lambda: calls.append(1) or {"a": [1]})
    r1 = memo("k", lambda: calls.append(1) or {"a": [1]})
    r1["a"].append(999)
    r2 = memo("k", lambda: calls.append(1) or {"a": [1]})
check("تنفيذ واحد + عزل النسخ",
      len(calls) == 1 and r2 == {"a": [1]}, (calls, r2))
with build_cache():
    with build_cache():
        memo("n", lambda: calls.append(1) or 1)
        inside = len(calls)
check("المتداخل يشارك", inside == 2, inside)
memo("k", lambda: calls.append(1) or 1)
check("خارج النطاق بلا تخزين", len(calls) == 3, calls)
con_a = contract_service.get_contract(k1)
with build_cache():
    con_b = contract_service.get_contract(k1)
    con_b.contract_number = "MUT"
    con_c = contract_service.get_contract(k1)
check("كائنات العقود معزولة",
      con_c.contract_number == con_a.contract_number, con_c.contract_number)

print("=== 4. التسميات الدفعية ===")
from services.extras_service import contract_label, contract_labels  # noqa: E402

k2 = contract_service.add_contract(Contract(
    contract_number="K-P2", customer_id=c1, contract_date="2026-09-02",
    description="ع2", amount=3000.0, contract_type="مقاولة عامة"))
m = contract_labels([k1, k2, 999999])
check("الدفعي يطابق المفرد",
      m.get(k1) == contract_label(k1) and m.get(k2) == contract_label(k2)
      and 999999 not in m, m)
check("الفارغ آمن", contract_labels([]) == {} and contract_labels(None) == {})

print("=== 5. تهيئة التعليقات مرة/مسار ===")
from services import comment_service  # noqa: E402

comment_service.stale_pinned()
check("العلم مضبوط", comment_service._ENSURED_FOR == db.DB_PATH,
      comment_service._ENSURED_FOR)

print("=== 6. دخان الصفحات ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from services import auth_service, feature_service  # noqa: E402

_op, _of = auth_service.has_permission, feature_service.enabled
auth_service.has_permission = lambda *a, **k: True
feature_service.enabled = lambda *a, **k: True
try:
    from ui.dealings import DealingsPage  # noqa: E402
    from ui.main_window import MainWindow  # noqa: E402

    win = MainWindow()
    win.dashboard.refresh()
    DealingsPage().refresh()
    win.open_contract_hub(k1)
    check("الرئيسية + العملاء + المركز تعمل", True)
except Exception as exc:  # noqa: BLE001
    check("الرئيسية + العملاء + المركز تعمل", False, repr(exc)[:200])
finally:
    auth_service.has_permission, feature_service.enabled = _op, _of

if os.path.exists("/tmp/v248.sqlite"):
    os.remove("/tmp/v248.sqlite")
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
