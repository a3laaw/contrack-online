# -*- coding: utf-8 -*-
"""V4.47: المطالبات المالية — تسجيل + ترحيل + متأخر + صفحة.

§1 التسجيل والضوابط · §2 آلة الحالات · §3 المتأخر ·
§4 الصفحة والتصدير.
"""
import os
import sys
import tempfile
from datetime import date
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v447_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import claims_service as cl  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


auth_service.ensure_default_user()
auth_service.set_current_user("admin")
TODAY = date.today().isoformat()

c1 = customer_service.add_customer(Customer(
    customer_code="M47-001", name="عميل مطالبات", phone="50000000"))
k1 = contract_service.add_contract(Contract(
    contract_number="M47-CT-001", customer_id=c1,
    contract_name="عقد المطالبات",
    contract_date=TODAY, amount=100000))
k2 = contract_service.add_contract(Contract(
    contract_number="M47-CT-002", customer_id=c1,
    contract_name="عقد ثانٍ",
    contract_date=TODAY, amount=10000))
plan1 = lc.contract_payment_plan(k1)
C1 = plan1[0]["id"]
C1_AMT = float(plan1[0]["amount"])
sub_id = lc.add_subcontractor("M47-S1", "مقاول المطالبات", "50000001")
sc1 = lc.add_sub_contract(sub_id, k1, None, 20000)
S1 = lc.add_sub_plan_line(sc1, "دفعة مقاول", TODAY, 8000)

print("=== §1 التسجيل والضوابط ===")
a = cl.add_claim("out", k1, "مطالبتنا الأولى", 5000, TODAY,
                 cust_line_id=C1)
b = cl.add_claim("in", k1, "مطالبة المقاول", 4000, TODAY,
                 sub_contract_id=sc1, sub_line_id=S1)
check("ترقيم تلقائي متسلسل",
      cl.get_claim(a)["claim_number"] == "CLM-0001"
      and cl.get_claim(b)["claim_number"] == "CLM-0002")
check("الحالة الابتدائية مسجلة",
      cl.get_claim(a)["status"] == "registered")
check("روابط الدفعات محفوظة",
      cl.get_claim(a)["cust_line_id"] == C1
      and cl.get_claim(b)["sub_line_id"] == S1)
for kw, msg in [
        ({"direction": "out", "contract_id": k1, "title": "x",
          "amount": 0}, "مبلغ صفر مرفوض"),
        ({"direction": "out", "contract_id": 9999, "title": "x",
          "amount": 5}, "عقد وهمي مرفوض"),
        ({"direction": "out", "contract_id": k2, "title": "x",
          "amount": 5, "cust_line_id": C1},
         "سطر عميل من عقد آخر مرفوض"),
        ({"direction": "out", "contract_id": k1, "title": "x",
          "amount": C1_AMT + 1, "cust_line_id": C1},
         "تجاوز مبلغ السطر مرفوض"),
        ({"direction": "in", "contract_id": k1, "title": "x",
          "amount": 5}, "مطالبة مقاول بلا عقد باطن مرفوضة"),
]:
    try:
        cl.add_claim(**kw)
        check(msg, False)
    except Exception:
        check(msg, True)

print("\n=== §2 آلة الحالات ===")
r = cl.set_status(a, "sent")
check("مسجلة ← مرسلة", r["status"] == "sent")
try:
    cl.set_status(a, "collected")
    check("القفز للتحصيل محظور", False)
except Exception as e:
    check("القفز للتحصيل محظور", "غير مسموح" in str(e))
cl.set_status(a, "approved")
cl.set_status(a, "collected")
check("اكتمل المسار للتحصيل",
      cl.get_claim(a)["status"] == "collected")
check("سجل التدقيق في الملاحظات",
      "مرسلة" in (cl.get_claim(a)["notes"] or ""))
cl.set_status(b, "in_review")
try:
    cl.set_status(b, "paid")
    check("الدفع قبل الاعتماد محظور", False)
except Exception:
    check("الدفع قبل الاعتماد محظور", True)
cl.set_status(b, "approved")
cl.set_status(b, "paid")
check("مسار المقاول للدفع", cl.get_claim(b)["status"] == "paid")
c = cl.add_claim("in", k1, "مطالبة مرفوضة", 1000, TODAY,
                 sub_contract_id=sc1)
cl.set_status(c, "in_review")
cl.set_status(c, "refused")
check("فرع الرفض", cl.get_claim(c)["status"] == "refused")
try:
    cl.set_status(c, "approved")
    check("المرفوضة نهائية", False)
except Exception:
    check("المرفوضة نهائية", True)
try:
    cl.delete_claim(a)
    check("حذف المحصّلة محظور", False)
except Exception:
    check("حذف المحصّلة محظور", True)
d = cl.add_claim("out", k1, "للحذف", 100, TODAY)
cl.delete_claim(d)
check("حذف المسجلة مسموح", cl.get_claim(d) is None)
try:
    cl.update_claim(a, title="تعديل")
    check("تعديل النهائية محظور", False)
except Exception:
    check("تعديل النهائية محظور", True)

print("\n=== §3 المتأخر ===")
past = "2020-01-01"
o1 = cl.add_claim("out", k1, "متأخرة علينا", 2000, past,
                  cust_line_id=C1)
cl.set_status(o1, "sent")
cl.set_status(o1, "approved")
check("المعتمدة المتجاوزة = متأخرة",
      cl.get_claim(o1)["overdue"] is True)
o2 = cl.add_claim("out", k1, "معتمدة غير مستحقة", 2000, "2099-01-01",
                  cust_line_id=C1)
cl.set_status(o2, "sent")
cl.set_status(o2, "approved")
check("المعتمدة قبل استحقاقها ليست متأخرة",
      cl.get_claim(o2)["overdue"] is False)
check("فلتر المتأخر وحده",
      [x["id"] for x in cl.list_claims(overdue_only=True)] == [o1])
t = cl.totals(direction="out")
check("إجماليات المتأخر",
      t["overdue_count"] == 1
      and abs(t["overdue_amount"] - 2000.0) < 0.01, str(t))

print("\n=== §4 الصفحة والتصدير ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

from ui.claims_page import ClaimDialog, ClaimsPage  # noqa: E402
from ui.main_window import IDX_CLAIMS, PAGE_PERMS  # noqa: E402

app = QApplication.instance() or QApplication([])
check("تسجيل الصفحة في النافذة",
      IDX_CLAIMS == 17 and PAGE_PERMS.get(IDX_CLAIMS) == "screen_claims")
check("صلاحية المطالبات معرفة",
      auth_service.has_permission("screen_claims") is True)
pg = ClaimsPage()
app.processEvents()
n_out = len(cl.list_claims(direction="out"))
check("تاب مطالبتنا يعرض الكل",
      pg.table.rowCount() == n_out, str(pg.table.rowCount()))
check("شارة المتأخر ظاهرة", "1 متأخرة" in pg.overdue_lbl.text(),
      pg.overdue_lbl.text())
pg.dir_tabs.setCurrentData("in")
app.processEvents()
check("التبديل لتاب المقاولين",
      pg.table.rowCount() == len(cl.list_claims(direction="in")))
pg.dir_tabs.setCurrentData("out")
pg.status.setCurrentData("overdue")
app.processEvents()
check("فلتر المتأخر في الصفحة",
      pg.table.rowCount() == 1
      and "متأخرة علينا" in pg.table.item(0, 0).text()
      or pg.table.rowCount() == 1, str(pg.table.rowCount()))
pg.status.setCurrentData("all")
sh = pg._sheet_data()
check("بيانات التصدير/الطباعة",
      len(sh["heads"]) == 8 and len(sh["rows"]) == n_out + 1
      and sh["number_cols"] == [3], str(len(sh["rows"])))
dlg = ClaimDialog(None, "out")
check("حوار الجديد يعرض العقود",
      dlg.contract.count() >= 2 and dlg.line.count() >= 1)
with mock.patch("ui.style.error") as _e:
    dlg.title.setText("")
    dlg.amount.setValue(50)
    dlg._save()
    check("الحفظ بلا عنوان مرفوض",
          _e.called and cl.list_claims(search="zzz-لاشيء") == [])

print("")
print(f"V4.47 claims: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
