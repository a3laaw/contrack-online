# -*- coding: utf-8 -*-
"""V4.45: المسار اليدوي للعقد — تشك-لست حر لكل تصنيف.

§1 التبديل والاستئناف · §2 التعليم المتوازي + التحفيز ·
§3 الحماية المتبادلة · §4 إعادة الفتح والسندات · §5 الواجهة.
"""
import os
import sys
import tempfile
from datetime import date
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v445_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui import style  # noqa: E402

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
    customer_code="M45-001", name="عميل يدوي", phone="50000000"))


def _mk(num):
    return contract_service.add_contract(Contract(
        contract_number=f"M45-CT-{num:03d}", customer_id=c1,
        contract_name=f"عقد يدوي {num}",
        contract_date=TODAY, amount=50000))


def _steps(cid):
    return sorted(
        [s for s in wf.get_contract_stages(cid) if s["level"] != 0],
        key=lambda s: (s.get("sort_order") or 0, s.get("id") or 0))


k1 = _mk(1)

print("=== §1 التبديل والاستئناف ===")
check("الوضع الافتراضي إجباري", wf.is_manual_path(k1) is False)
r = wf.set_contract_manual_path(k1, True)
check("التحويل لليدوي", r["manual"] is True and wf.is_manual_path(k1))
g = wf.manual_path_groups(k1)
check("3 تصنيفات تلقائية", len(g["groups"]) == 3, str(len(g["groups"])))
check("العناصر = الخطوات الثماني", g["total"] == 8, str(g["total"]))
check("التقدم صفر", g["done"] == 0 and g["pct"] == 0)
check("كل تصنيف: اسم + عناصر + عداد",
      all(gr["main"] and gr["items"] and gr["total"] == len(gr["items"])
          for gr in g["groups"]))
g0_cat = g["groups"][0]["main"]
A = g["groups"][0]["items"][0]
B = g["groups"][1]["items"][0]
check("A وB من تصنيفين مختلفين",
      g["groups"][0]["main"] != g["groups"][1]["main"])
first_step = _steps(k1)[0]["name"]
r = wf.set_contract_manual_path(k1, False)
check("الرجوع مع مؤشر قائم = بلا استئناف",
      r["manual"] is False and r["resumed"] is None, str(r))
cur = wf.get_current_stage(wf.TX_CONTRACT, k1)
check("المؤشر الخطي ما زال على أول خطوة",
      cur and cur["stage_name"] == first_step, str(cur))
# مسار الاستئناف الحقيقي: عقد أُغلقت أولى خطواته يدويًا
k2 = _mk(2)
wf.set_contract_manual_path(k2, True)
st2 = _steps(k2)
X = st2[3]
for s in st2:
    if s["id"] != X["id"]:
        wf.manual_close_stage(k2, s["id"], TODAY)
r2 = wf.set_contract_manual_path(k2, False)
check("الاستئناف يقفز للمتبقية الوحيدة",
      r2["resumed"] == X["name"], str(r2.get("resumed")))
# المسار المكتمل: لا شيء يُستأنف
k3 = _mk(3)
wf.set_contract_manual_path(k3, True)
for s in _steps(k3):
    wf.manual_close_stage(k3, s["id"], TODAY)
r3 = wf.set_contract_manual_path(k3, False)
check("اكتمال الكل = بلا استئناف (المسار مكتمل)",
      r3["resumed"] is None, str(r3.get("resumed")))

print("\n=== §2 التعليم المتوازي + التحفيز ===")
wf.set_contract_manual_path(k1, True)
with get_connection() as conn:
    conn.execute(
        "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
        " stage_id) VALUES (?,?,?,?,?)",
        (k1, "دفعة A", TODAY, 5000, A["id"]))
ra = wf.manual_close_stage(k1, A["id"], TODAY)
check("تعليم A يحفّز دفعتها", len(ra["triggered"]) == 1,
      str(ra["triggered"]))
rb = wf.manual_close_stage(k1, B["id"], TODAY)
check("تعليم B من تصنيف آخر بحرية (توازٍ)",
      rb["closed"] == B["name"] and not rb["triggered"])
g2 = wf.manual_path_groups(k1)
check("التقدم 2/8", g2["done"] == 2 and g2["total"] == 8,
      f"{g2['done']}/{g2['total']}")
check("عداد التصنيف الأول 1", g2["groups"][0]["done"] == 1)
check("اسم التصنيف الأول سليم",
      g2["groups"][0]["main"] == g0_cat, g2["groups"][0]["main"])
try:
    wf.manual_close_stage(k1, A["id"], TODAY)
    check("تعليم المنهاة مرفوض", False)
except Exception as e:
    check("تعليم المنهاة مرفوض", "منهاة بالفعل" in str(e), str(e))

print("\n=== §3 الحماية المتبادلة ===")
try:
    wf.advance_stage(wf.TX_CONTRACT, k1)
    check("الإنهاء الخطي محظور في اليدوي", False)
except Exception as e:
    check("الإنهاء الخطي محظور في اليدوي",
          "المسار اليدوي" in str(e), str(e))
try:
    wf.revert_contract_stage(k1, "x")
    check("التراجع الخطي محظور في اليدوي", False)
except Exception as e:
    check("التراجع الخطي محظور في اليدوي",
          "المسار اليدوي" in str(e), str(e))
wf.set_contract_manual_path(k1, False)
try:
    wf.manual_close_stage(k1, B["id"], TODAY)
    check("التعليم اليدوي محظور في الإجباري", False)
except Exception as e:
    check("التعليم اليدوي محظور في الإجباري",
          "المسار الإجباري" in str(e), str(e))
cur3 = wf.get_current_stage(wf.TX_CONTRACT, k1)
r = wf.advance_stage(wf.TX_CONTRACT, k1)
check("الإجباري يعمل بعد الرجوع",
      cur3 and r["closed"] == cur3["stage_name"],
      str(r.get("closed")))

print("\n=== §4 إعادة الفتح والسندات ===")
wf.set_contract_manual_path(k1, True)


def _trig():
    with get_connection() as conn:
        row = conn.execute(
            "SELECT triggered_at FROM payment_plan WHERE contract_id=?"
            " AND stage_id=?", (k1, A["id"])).fetchone()
    return (row["triggered_at"] or "").strip()


check("دفعة A مستحقة قبل إعادة الفتح", bool(_trig()), _trig())
rr = wf.manual_reopen_stage(k1, A["id"])
check("إلغاء التعليم يعيد الدفعة تقديرية",
      not _trig() and "دفعة A" in [x["title"] for x in rr["reverted"]]
      and not rr["kept"] and rr["reopened"] == A["name"],
      f"trig={_trig()} rev={rr['reverted']}")
check("المرحلة انفتحت", not wf.manual_path_groups(k1)["groups"][0]
      ["items"][0]["closed"])
wf.manual_close_stage(k1, A["id"], TODAY)
check("أُعيد تعليمها فاستُحقت", bool(_trig()))
with get_connection() as conn:
    conn.execute(
        "INSERT INTO vouchers (voucher_number, vtype, vdate, amount,"
        " contract_id) VALUES (?,?,?,?,?)",
        ("M45-R1", "receipt", TODAY, 1000, k1))
rr2 = wf.manual_reopen_stage(k1, A["id"])
check("سند لاحق = الدفعة تبقى مستحقة",
      bool(_trig()) and "دفعة A" in [x["title"] for x in rr2["kept"]]
      and not rr2["reverted"], f"trig={_trig()} kept={rr2['kept']}")
try:
    wf.manual_reopen_stage(k1, A["id"])
    check("إعادة فتح المفتوحة مرفوضة", False)
except Exception as e:
    check("إعادة فتح المفتوحة مرفوضة", "مفتوحة بالفعل" in str(e),
          str(e))

print("\n=== §5 الواجهة ===")
from PySide6.QtWidgets import QApplication, QCheckBox  # noqa: E402

from ui.followup import FollowupPanel  # noqa: E402

app = QApplication.instance() or QApplication([])
with mock.patch.object(style, "confirm", return_value=True):
    panel = FollowupPanel(None, wf.TX_CONTRACT, k1)
    panel.refresh()
    check("V4.56: الخطي مخفي واليدوي ظاهر",
          panel.stage_card.isHidden()
          and panel.manual_card.isVisibleTo(panel))
    check("V4.56: تاب لكل رئيسية",
          panel.manual_tabs.count() == len(
              wf.manual_path_groups(k1)["groups"]),
          panel.manual_tabs.count())
    check("الأزرار الخطية معطّلة في اليدوي",
          not panel.finish_btn.isEnabled()
          and not panel.skip_btn.isEnabled()
          and not panel.revert_btn.isEnabled()
          and not panel.sup_btn.isEnabled())
    check("زر السحب من القالب يبقى فعالًا",
          panel.pull_btn.isEnabled())
    boxes = panel.manual_tabs.findChildren(QCheckBox)
    check("تشك-بوكس لكل عنصر", len(boxes) == 8, str(len(boxes)))
    box_a = next(b for b in boxes
                 if int(b.property("manualStageId")) == A["id"])
    check("مربع A غير معلّم (أُعيد فتحه)", not box_a.isChecked())
    box_a.setChecked(True)
    app.processEvents()
    st_a = next(s for s in wf.get_contract_stages(k1)
                if s["id"] == A["id"])
    check("التعليم من الواجهة يغلق المرحلة",
          bool(st_a["end_date"]), str(st_a["end_date"]))
    boxes2 = panel.manual_tabs.findChildren(QCheckBox)
    box_a2 = next(b for b in boxes2
                  if int(b.property("manualStageId")) == A["id"])
    box_a2.setChecked(False)
    app.processEvents()
    st_a2 = next(s for s in wf.get_contract_stages(k1)
                 if s["id"] == A["id"])
    check("إلغاء التعليم من الواجهة يعيد الفتح",
          not st_a2["end_date"], str(st_a2["end_date"]))
    cpanel = FollowupPanel(None, wf.TX_CUSTOMER, c1)
    cpanel.refresh()
    check("اليدوي مخفي لغير العقود",
          cpanel.manual_card.isHidden()
          and not cpanel.stage_card.isHidden())

print("")
print(f"V4.45 manual: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
