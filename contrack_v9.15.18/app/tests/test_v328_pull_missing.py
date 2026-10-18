# -*- coding: utf-8 -*-
"""V3.28: سحب المراحل الناقصة من قالب النوع + تضييق زر الطابع."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from datetime import date  # noqa: E402

from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication(sys.argv)

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import supervision_service as sup  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui.followup import FollowupPanel  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def _mk(code, name, phone, ctype):
    c = cs.add_customer(Customer(customer_code=code, name=name, phone=phone))
    k = ks.add_contract(Contract(contract_number=f"K-{code}",
                                 customer_id=c,
                                 contract_date="2026-01-01",
                                 description="عقد", amount=60000.0,
                                 contract_type=ctype))
    wf.on_contract_signed(k)
    return k


def _steps(k):
    return [s for s in wf.get_contract_stages(k) if s["level"] == 1]


cts.add_type("سحب")
_main = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="سحب")
_sa = wf.add_stage(wf.TX_CONTRACT, "أ", contract_type="سحب",
                   parent_id=_main)
_sb = wf.add_stage(wf.TX_CONTRACT, "ب", contract_type="سحب",
                   parent_id=_main)
wf.add_stage(wf.TX_CONTRACT, "ج", contract_type="سحب", parent_id=_main,
             is_supervision=True, sup_monthly=100.0)

print("=== 1. اكتمال المسار ثم السحب (حالة المستخدم) ===")
k1 = _mk("C-281", "عميل سحب", "55281222", "سحب")
check("التوقيع يفتح أول خطوة",
      wf.get_current_stage(wf.TX_CONTRACT, k1)["stage_name"] == "أ")
for _ in range(3):
    wf.advance_stage(wf.TX_CONTRACT, k1)
check("المسار مكتمل ولا جارية",
      wf.get_current_stage(wf.TX_CONTRACT, k1) is None)
# مراحل جديدة في القالب بعد اكتمال العقد
wf.add_stage(wf.TX_CONTRACT, "د", contract_type="سحب", parent_id=_main,
             is_supervision=True, sup_monthly=250.0)
wf.add_stage(wf.TX_CONTRACT, "هـ", contract_type="سحب", parent_id=_main)
pv = wf.preview_missing_stages(k1)
check("المعاينة: مرحلتان ناقصتان بترتيب القالب",
      [m["name"] for m in pv["missing"]] == ["د", "هـ"], str(pv["missing"]))
check("المعاينة: إعادة فتح والموضع بعد ج",
      pv["reopen"] is True and pv["missing"][0]["after"] == "ج"
      and pv["current"] is None, str(pv))
check("القالب فيه إشراف", wf.template_has_supervision("سحب") is True)
check("قالب بلا إشراف", wf.template_has_supervision("نوع بلا") is False)
with db.get_connection() as _c:
    _plan_before = _c.execute(
        "SELECT title, due_date, amount, sort_order, stage_id, notes,"
        " triggered_at FROM payment_plan WHERE contract_id=?", (k1,)).fetchall()
rep = wf.pull_missing_stages(k1)
check("السحب أدرج وأعاد الفتح على د",
      rep["inserted"] == ["د", "هـ"] and rep["reopened"] == "د", str(rep))
_names = [s["name"] for s in _steps(k1)]
check("ترتيب القالب محفوظ", _names == ["أ", "ب", "ج", "د", "هـ"],
      str(_names))
_old = {s["name"]: s for s in _steps(k1)}
check("التقدم القديم intact",
      all(_old[n]["end_date"] for n in ("أ", "ب", "ج"))
      and _old["د"]["start_date"] == date.today().isoformat()
      and not _old["د"]["end_date"] and not _old["هـ"]["start_date"])
check("وراثة الطابع والقيمة", _old["د"]["is_supervision"] == 1
      and float(_old["د"]["sup_monthly"] or 0) == 250.0)
check("الجارية الجديدة د",
      wf.get_current_stage(wf.TX_CONTRACT, k1)["stage_name"] == "د")
with db.get_connection() as _c:
    _plan_after = _c.execute(
        "SELECT title, due_date, amount, sort_order, stage_id, notes,"
        " triggered_at FROM payment_plan WHERE contract_id=?", (k1,)).fetchall()
    _evts = _c.execute(
        "SELECT event_type FROM contract_events WHERE contract_id=?",
        (k1,)).fetchall()
check("خطة الدفع لم تُمس",
      [tuple(r) for r in _plan_before] == [tuple(r) for r in _plan_after])
_types = [r[0] for r in _evts]
check("حدثا السحب وإعادة الفتح مسجلان",
      "سحب مراحل من القالب" in _types
      and "إعادة فتح المسار" in _types, str(_types))
check("سحب ثانٍ فارغ",
      wf.pull_missing_stages(k1)["inserted"] == [])

print("=== 2. التثبيت بعد التقدم ===")
k2 = _mk("C-282", "عميل تثبيت", "55282222", "سحب")
wf.advance_stage(wf.TX_CONTRACT, k2)  # الجارية = ب
_sf = wf.add_stage(wf.TX_CONTRACT, "و", contract_type="سحب",
                   parent_id=_main)
wf.reorder_stages(wf.TX_CONTRACT,
                  [_main, _sa, _sf, _sb] +
                  [t["id"] for t in wf.get_stages(wf.TX_CONTRACT, "سحب")
                   if t["id"] not in (_main, _sa, _sf, _sb)])
pv2 = wf.preview_missing_stages(k2)
check("و قبل التقدم تُثبت وتُعلن",
      [m["name"] for m in pv2["missing"]] == ["و"]
      and pv2["clamped"] == ["و"] and pv2["reopen"] is False
      and pv2["current"] == "ب", str(pv2))
wf.pull_missing_stages(k2)
check("الجارية بقيت ب",
      wf.get_current_stage(wf.TX_CONTRACT, k2)["stage_name"] == "ب")
_names2 = [s["name"] for s in _steps(k2)]
check("و بعد ب مباشرة",
      _names2.index("و") == _names2.index("ب") + 1, str(_names2))
wf.advance_stage(wf.TX_CONTRACT, k2)
check("إنهاء ب يفتح و",
      wf.get_current_stage(wf.TX_CONTRACT, k2)["stage_name"] == "و")

print("=== 3. منطق التأخير يعمل على المسحوبة ===")
_did = next(s["id"] for s in _steps(k1) if s["name"] == "د")
sup.setup_stage_supervision(_did, "2026-03-01", 250.0)
sup.set_stage_sup_start(_did, "2026-01-15")
_sst = sup.stage_supervision_status(_did)
check("تأخير محسوب وقيمة موجبة",
      _sst["delay_months"] > 0 and _sst["delay_value"] > 0, str(_sst))

print("=== 4. الواجهة: زر السحب + تضييق الطابع ===")
cts.add_type("عادي")
_m2 = wf.add_stage(wf.TX_CONTRACT, "تنفيذ", contract_type="عادي")
wf.add_stage(wf.TX_CONTRACT, "خطوة 1", contract_type="عادي",
             parent_id=_m2)
wf.add_stage(wf.TX_CONTRACT, "خطوة 2", contract_type="عادي",
             parent_id=_m2)
k3 = _mk("C-283", "عميل عادي", "55283222", "عادي")
p1 = FollowupPanel(None, wf.TX_CONTRACT, k1)
p1.show()
p1.refresh()
_app.processEvents()
# القالب تغير في القسم 2 (أُضيفت و) — اللوحة تكتشف الناقص الجديد
check("ناقص جديد يظهر زر السحب بالعدد",
      p1.pull_btn.isVisible() and "(1)" in p1.pull_btn.text(),
      p1.pull_btn.text())
check("الطابع ظاهر للجارية الموسومة", p1.sup_btn.isVisible())
wf.pull_missing_stages(k1)
p1.refresh()
_app.processEvents()
check("بعد السحب: زر السحب مخفي", p1.pull_btn.isHidden())
p3 = FollowupPanel(None, wf.TX_CONTRACT, k3)
p3.show()
p3.refresh()
_app.processEvents()
check("قالب بلا إشراف + جارية عادية: الطابع مخفي",
      p3.sup_btn.isHidden())
check("بلا نواقص: السحب مخفي", p3.pull_btn.isHidden())
_sid3 = wf.get_current_stage(wf.TX_CONTRACT, k3)["id"]
sup.setup_stage_supervision(_sid3, "2026-12-31", 50.0)
p3.refresh()
_app.processEvents()
check("بعد وسم الجارية: الطابع ظاهر", p3.sup_btn.isVisible())
k5 = _mk("C-285", "عميل ناقص", "55285222", "عادي")
wf.add_stage(wf.TX_CONTRACT, "خطوة 3", contract_type="عادي",
             parent_id=_m2)
p5 = FollowupPanel(None, wf.TX_CONTRACT, k5)
p5.show()
p5.refresh()
_app.processEvents()
check("زر السحب ظاهر بالعدد",
      p5.pull_btn.isVisible() and "(1)" in p5.pull_btn.text(),
      p5.pull_btn.text())
# عقد ملغى: السحب مرفوض مثل الإنهاء
with db.get_connection() as _c:
    _c.execute("UPDATE contracts SET status='ملغى' WHERE id=?", (k5,))
try:
    wf.pull_missing_stages(k5)
    check("الملغى يرفض السحب", False)
except Exception as exc:
    check("الملغى يرفض السحب", "مجمّد" in str(exc) or "ملغى" in str(exc),
          str(exc))

print(f"\nV3.28 PULL: PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
