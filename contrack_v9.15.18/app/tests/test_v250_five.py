# -*- coding: utf-8 -*-
"""V2.49→V2.50: البنود الخمسة (تجمد البحث/القوائم الفارغة/تعدد المقاولين/
تعديل العهد للمدير/إعادة البناء عند تغيير النوع)."""
import os
import sys
import time

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

db.DB_PATH = "/tmp/v250.sqlite"
if os.path.exists("/tmp/v250.sqlite"):
    os.remove("/tmp/v250.sqlite")
db.init_db()

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

print("=== 1. البند 5: البحث بلا تجمد ===")
from ui.widgets import RequiredValidator, SearchableComboBox  # noqa: E402

c = SearchableComboBox(search_only=True)
c.set_items([(f"عميل {i}", i, f"777{i:05d}") for i in range(3000)],
            auto_select=False)
t0 = time.perf_counter()
for q in ("ع", "عم", "عمي", "7771", "zzz"):
    c._suggest_match_rows(q)
dt = (time.perf_counter() - t0) * 1000
check("5 استعلامات على 3000 عميل < 100ms", dt < 100, f"{dt:.1f}ms")
check("النافذة بلا خطف تفعيل",
      bool(c._suggest.testAttribute(Qt.WA_ShowWithoutActivating)))
c._suggest_refresh("عميل 7")
app.processEvents()
check("اقتراحات محدودة وظاهرة",
      0 < c.suggestion_count() <= 30 and c.suggestions_visible(),
      c.suggestion_count())

print("=== 2. البند 4: القوائم الفارغة ===")
from ui.contracts import ContractDialog  # noqa: E402
from ui.tasks import TaskDialog  # noqa: E402
from ui.vouchers import GroupedPaymentDialog, VoucherDialog  # noqa: E402

d = VoucherDialog(None, "payment")
check("طريقة الصرف فارغة", d.method.currentIndex() == -1)
check("الطريقة إجبارية",
      RequiredValidator._is_empty(d.method, None))
i = d.party_kind.findData("transfer")
d.party_kind.setCurrentIndex(i)
app.processEvents()
check("حسابا التحويل فارغان",
      d.transfer_from.currentIndex() == -1
      and d.transfer_to.currentIndex() == -1)
g = GroupedPaymentDialog(None)
check("طريقة المجمّع فارغة", g.method.currentIndex() == -1)
t = TaskDialog(None)
check("نوع المهمة والتذكير فارغان",
      t.task_type.currentIndex() == -1 and t.remind.currentIndex() == -1)

print("=== 3. البند 1: أكثر من مقاول للعقد ===")
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

cu = customer_service.add_customer(Customer(
    customer_code="C-F1", name="عميل الخمسة", phone="99110011"))
cd = ContractDialog(None)
check("نوع العقد فارغ (جديد)", cd.ctype.currentIndex() == -1)
k = contract_service.add_contract(Contract(
    contract_number="K-F1", customer_id=cu, contract_date="2026-09-01",
    description="ع", amount=10000.0, contract_type="مقاولة عامة"))
s1 = lc.add_subcontractor("S-F1", "مقاول أول", "911")
s2 = lc.add_subcontractor("S-F2", "مقاول ثان", "922")
lc.add_sub_contract(s1, k, None, 4000.0)
lc.add_sub_contract(s2, k, None, 3000.0)
check("ربطان لنفس العقد", len(lc.list_sub_contracts(k)) == 2)
lc.add_voucher("payment", "2026-09-10", "", "نقدًا", "", 1000.0, "دفعة",
               contract_id=k, party_type="subcontractor", party_id=s1)
lc.add_voucher("payment", "2026-09-11", "", "نقدًا", "", 500.0, "دفعة",
               contract_id=k, party_type="subcontractor", party_id=s2)
with db.get_connection() as conn:
    nv = conn.execute(
        "SELECT COUNT(*) FROM vouchers WHERE contract_id=? "
        "AND vtype='payment'", (k,)).fetchone()[0]
check("سند صرف لكل مقاول", nv == 2, nv)
_src = open("ui/subcontractors.py", encoding="utf-8").read()
check("سطر المنع أُزيل",
      "لا يمكن ربط نفس العقد الرئيسي بأكثر من مقاول باطن" not in _src)

print("=== 4. البند 2: تعديل العهد للمدير ===")
from services import auth_service  # noqa: E402
from ui.custody_center import CustodyCenterPage  # noqa: E402

auth_service.ensure_default_user()
sec_id = auth_service.add_user("sec_t", "1234", "secretary")
auth_service.set_current_user("admin")
pg = CustodyCenterPage()
pg.show()
pg.reload()
app.processEvents()
check("الزر ظاهر للمدير", pg.edit_btn.isVisible())
auth_service.set_current_user("sec_t")
pg.reload()
app.processEvents()
check("الزر مخفي لغير المدير", pg.edit_btn.isHidden())
auth_service.set_current_user("admin")

print("=== 5. البند 3: إعادة البناء ===")
from services import workflow_service as wf  # noqa: E402

k2 = contract_service.add_contract(Contract(
    contract_number="K-F2", customer_id=cu, contract_date="2026-09-01",
    description="ع", amount=6000.0, contract_type="نوع قديم"))
lc.add_plan_item(k2, "دفعة قديمة 1", "2026-10-01", 3000.0)
lc.add_plan_item(k2, "دفعة قديمة 2", "2026-11-01", 3000.0)
with db.get_connection() as conn:
    conn.execute(
        "INSERT INTO contract_stages (contract_id, name, level, sort_order)"
        " VALUES (?, 'مرحلة قديمة', 1, 1)", (k2,))
lc.add_voucher("receipt", "2026-09-10", "", "نقدًا", "", 3000.0, "تحصيل",
               contract_id=k2, party_type="customer", party_id=cu)
imp = wf.schedule_impact(k2)
check("الأثر: 2/1/1",
      imp == {"plan": 2, "stages": 1, "vouchers": 1}, imp)
wf.ensure_type_stage_template("نوع جديد")
contract_service.set_contract_type(k2, "نوع جديد")
rep = wf.rebuild_contract_schedule(k2, "نوع قديم")
check("التقرير قبل/بعد",
      len(rep["old_plan"]) == 2 and rep["vouchers_kept"] == 1, rep)
check("القديم حُذف والجديد بُني",
      all("قديمة" not in x["title"] for x in rep["new_plan"])
      and len(rep["new_plan"]) >= 1, rep["new_plan"])
with db.get_connection() as conn:
    kept = conn.execute(
        "SELECT COUNT(*) FROM vouchers WHERE contract_id=? "
        "AND COALESCE(cancelled,0)=0", (k2,)).fetchone()[0]
    ntype = conn.execute(
        "SELECT contract_type FROM contracts WHERE id=?", (k2,)).fetchone()[0]
check("السندات باقية والنوع جديد", kept == 1 and ntype == "نوع جديد")

if os.path.exists("/tmp/v250.sqlite"):
    os.remove("/tmp/v250.sqlite")
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
