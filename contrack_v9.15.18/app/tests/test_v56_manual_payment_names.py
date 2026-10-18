# -*- coding: utf-8 -*-
"""V5.6 — العقد اليدوي: أسماء الدفعات + مقارنة القيمة بالدفعات في عقد الباطن.

من تجربة V5.4 الميدانية (صور المستخدم):
  ② عقد العميل يختار 4 مراحل من 5 (تُتجاهل «الفحص») لكن اسم الدفعة الأخيرة
     بقي «4. الدفعة الخامسة» — أثرٌ لدفعة متجاهَلة. المطلوب: الاسم يتبع
     المراحل المختارة فعلًا ⇒ «4. الدفعة الرابعة» — في العميل وفي باطن،
     وفي العقود القديمة عند المزامنة، وبلا مساس بأي اسم كتبه المستخدم.
  ③ لم تكن هناك مقارنة بين قيمة عقد الباطن ومجموع دفعاته (كانت تظهر فقط
     إذا كُتبت القيمة، وداخل تلميح رمادي بلا ألوان). المطلوب: سطر دائم
     ملوّن: ⚠ اكتب القيمة · ✓ مطابق (أخضر) · ⚠ الفرق (كهرماني).
     وكذلك: «⚖ توزيع تلقائي» يقترح أخذ مجموع دفعات العميل قيمةً إن كانت
     قيمة عقد الباطن غير مكتوبة.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db  # noqa: E402

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

from PySide6.QtWidgets import QApplication, QMessageBox  # noqa: E402

app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

_MSGS = []
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, (lambda n: (lambda *a, **k: _MSGS.append(
        (n, a[1] if len(a) > 1 else (a[0] if a else "")))))(_n))
style.confirm = lambda *a, **k: True
QMessageBox.exec = lambda self: 0
QMessageBox.clickedButton = lambda self: None

import ui.subcontractors as uis  # noqa: E402
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(uis.style, _n, (lambda n: (lambda *a, **k: _MSGS.append(
        (n, a[1] if len(a) > 1 else (a[0] if a else "")))))(_n))
uis.style.confirm = lambda *a, **k: True

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def titles(kid):
    with db.get_connection() as conn:
        return [r["title"] for r in conn.execute(
            "SELECT title FROM payment_plan WHERE contract_id=? "
            "ORDER BY sort_order, id", (kid,)).fetchall()]


STAGES = ["الدور الأول", "الدور الثاني", "تمديد البايات", "الفحص",
          "تمديد بابيات الكهرباء", "فحص الكهرباء"]
T = "عقد كامل"
cts.add_type(T, 0.0, manual_track=True)
with db.get_connection() as _c:
    _ids = []
    for _nm in STAGES:
        _ids.append(wf.add_stage("contract", _nm, contract_type=T))
    for _i, _sid in enumerate(_ids):
        wf.add_type_payment(T, _i + 1, "", 0, stage_id=_sid)   # اسم آلي
cust = cs.add_customer(Customer(customer_code="C-1", name="عميل", phone="90000071"))

# ============================================================
print("=== V5.6.1 إنشاء عقد باختيار 4 من 5 (تُتجاهل «الفحص») ===")
PICK = [_ids[0], _ids[1], _ids[2], _ids[4]]      # 1,2,3,5 — الرابع متجاهَل
kid = ks.add_contract(
    Contract(contract_number="M-1", customer_id=cust,
             contract_date="2026-10-06", contract_type=T, description="",
             amount=6000.0), scope_stage_ids=PICK, manual_path=True)
lc.update_plan_amount_overrides(kid, {1: 1500.0, 2: 1500.0, 3: 1500.0,
                                      4: 1500.0})
got = titles(kid)
check("4 دفعات محفوظة", len(got) == 4, got)
check("الترقيم المتسلسل 1..4", [t.split(".")[0] for t in got]
      == ["1", "2", "3", "4"], got)
check("لا أثر للدفعة المتجاهَلة «الخامسة»",
      all("الخامسة" not in t for t in got), got)
check("الأسماء تتبع المراحل المختارة (الأولى…الرابعة)",
      got == ["1. الدفعة الأولى", "2. الدفعة الثانية", "3. الدفعة الثالثة",
              "4. الدفعة الرابعة"], got)

# ============================================================
print("=== V5.6.2 عقد قديم باسم خاطئ: المزامنة تصحّحه ===")
with db.get_connection() as conn:
    conn.execute("UPDATE payment_plan SET title='4. الدفعة الخامسة' "
                 "WHERE contract_id=? AND sort_order=4", (kid,))
check("قبل المزامنة: الاسم القديم موجود",
      "4. الدفعة الخامسة" in titles(kid), titles(kid))
wf.sync_plan_from_template(kid)
check("بعد المزامنة: صار «4. الدفعة الرابعة»",
      "4. الدفعة الرابعة" in titles(kid), titles(kid))

print("=== V5.6.3 الاسم المخصص لا يتغيّر ===")
with db.get_connection() as conn:
    conn.execute("UPDATE payment_plan SET title='4. دفعة التسليم النهائي' "
                 "WHERE contract_id=? AND sort_order=4", (kid,))
wf.sync_plan_from_template(kid)
check("الاسم المخصص بقي كما هو ولم يتحول إلى «الدفعة الرابعة»",
      "4. دفعة التسليم النهائي" in titles(kid), titles(kid))

print("=== V5.6.4 أنماط الأسماء الآلية (منطق موحّد) ===")
cases = [("الدفعة الخامسة", "4. الدفعة الرابعة"),
         ("الدفعة 6", "4. الدفعة الرابعة"),
         ("دفعة 6", "4. دفعة 4"),
         ("5. الدفعة الخامسة", "4. الدفعة الرابعة"),
         ("", "4. الدفعة الرابعة"),
         ("دفعة التسليم النهائي", "4. دفعة التسليم النهائي")]
bad = [(t, wf._plan_title_for(4, {"title": t}), exp)
       for t, exp in cases if wf._plan_title_for(4, {"title": t}) != exp]
check("كل الأنماط تُبنى بالرقم الجديد", not bad, bad)

# ============================================================
print("=== V5.6.5 شاشة عقد الباطن: التسمية والمقارنة ===")
dlg = uis.LinkSubContractDialog(None)
dlg.customer.select_data(cust)
dlg._on_customer_changed()
dlg.contract.select_data(kid)
dlg._contract_changed()
rows = [r["title"] for r in dlg._plan_rows]
check("صفوف الدفعات تسمياتها صحيحة (بلا دفعة متجاهَلة)",
      rows[:3] == ["1. الدفعة الأولى", "2. الدفعة الثانية",
                   "3. الدفعة الثالثة"]
      and "الخامسة" not in " ".join(rows), rows)
check("سطر المقارنة موجود",
      hasattr(dlg, "plan_compare_lbl") and dlg.plan_compare_lbl.text() != "")
check("قيمة غير مكتوبة ⇒ تنبيه «اكتب قيمة عقد الباطن» كهرماني",
      "اكتب" in dlg.plan_compare_lbl.text()
      and style.WARN.lower() in dlg.plan_compare_lbl.styleSheet().lower(),
      (dlg.plan_compare_lbl.text(), dlg.plan_compare_lbl.styleSheet()))
dlg.amount.setValue(6000.0)
app.processEvents()
check("قيمة 6000 ومجموع الدفعات 0 ⇒ ⚠ الفرق كهرماني",
      "الفرق" in dlg.plan_compare_lbl.text()
      and style.WARN.lower() in dlg.plan_compare_lbl.styleSheet().lower(),
      dlg.plan_compare_lbl.text())
print("=== V5.6.6 توزيع تلقائي يوزّع ويطابق ===")
dlg._plan_distribute()
app.processEvents()
tot = round(sum(float(r.get("amount") or 0) for r in dlg._plan_rows), 3)
check("المجموع = قيمة عقد الباطن بعد التوزيع", tot == 6000.0, tot)
check("سطر المقارنة: ✓ مطابق بلون أخضر",
      dlg.plan_compare_lbl.text().startswith("✓")
      and style.OK_GREEN.lower() in dlg.plan_compare_lbl.styleSheet().lower(),
      (dlg.plan_compare_lbl.text(), dlg.plan_compare_lbl.styleSheet()))
dlg.amount.setValue(5000.0)
app.processEvents()
check("تغيير القيمة يُحدّث المقارنة فورًا (⚠ الفرق)",
      "الفرق" in dlg.plan_compare_lbl.text()
      and "+1,000.000" in dlg.plan_compare_lbl.text(),
      dlg.plan_compare_lbl.text())

# ============================================================
print("=== V5.6.7 توزيع تلقائي بلا قيمة مكتوبة (حالة الصورة) ===")
_MSGS.clear()
dlg2 = uis.LinkSubContractDialog(None)
dlg2.customer.select_data(cust)
dlg2._on_customer_changed()
dlg2.contract.select_data(kid)
dlg2._contract_changed()
dlg2.amount.setValue(0.0)
dlg2._plan_distribute()          # style.confirm ⇒ True في هذا الاختبار
app.processEvents()
check("القيمة أُخذت من مجموع دفعات العميل (6,000)",
      abs(dlg2.amount.value() - 6000.0) < 0.001, dlg2.amount.value())
check("والتوزيع تم فعلًا",
      round(sum(float(r.get("amount") or 0) for r in dlg2._plan_rows), 3)
      == 6000.0)
check("وسطر المقارنة أخضر مطابق",
      dlg2.plan_compare_lbl.text().startswith("✓"),
      dlg2.plan_compare_lbl.text())

# عقد آخر (المتبقي = قيمة العقد) ⇒ نفس العرض يُبنى من مجموع دفعات العميل
kid2 = ks.add_contract(
    Contract(contract_number="M-2", customer_id=cust,
             contract_date="2026-10-06", contract_type=T, description="",
             amount=4000.0), scope_stage_ids=PICK, manual_path=True)
_MSGS.clear()
dlg3 = uis.LinkSubContractDialog(None)
dlg3.customer.select_data(cust)
dlg3._on_customer_changed()
dlg3.contract.select_data(kid2)
dlg3._contract_changed()
dlg3.amount.setValue(0.0)
dlg3._plan_distribute()          # style.confirm ⇒ True
check("بلا قيمة مكتوبة: تُقترح قيمة العقد (4,000) ويوزّع",
      abs(dlg3.amount.value() - 4000.0) < 0.001
      and round(sum(float(r.get("amount") or 0) for r in dlg3._plan_rows),
                3) == 4000.0, dlg3.amount.value())

# ولو رفض المستخدم العرض: لا توزيع وتظهر رسالة توجيه
uis.style.confirm = lambda *a, **k: False
_MSGS.clear()
dlg4 = uis.LinkSubContractDialog(None)
dlg4.customer.select_data(cust)
dlg4._on_customer_changed()
dlg4.contract.select_data(kid2)
dlg4._contract_changed()
dlg4.amount.setValue(0.0)
dlg4._plan_distribute()
check("الرفض: بلا توزيع وبلا تغيير للقيمة",
      dlg4.amount.value() == 0.0, dlg4.amount.value())
check("الرفض: رسالة توجيه «اكتب قيمة عقد الباطن»",
      any("اكتب" in str(m) for _n, m in _MSGS if _n == "info"), _MSGS)
uis.style.confirm = lambda *a, **k: True

# ============================================================
print("=== V5.6.8 حوار التعديل: نفس السطر ونفس التسمية ===")
sub = lc.add_subcontractor("SUB-1", "مقاول أول", "95555071")
SID = lc.add_sub_contract(sub, kid, None, 6000.0, boq_item_ids=[])
ed = uis.EditSubContractDialog(None, lc.get_sub_contract(SID))
check("حوار التعديل فيه سطر المقارنة", hasattr(ed, "plan_compare_lbl"))
check("تُظهر الفرق بين القيمة (6,000) والدفعات (0)",
      "الفرق" in ed.plan_compare_lbl.text(), ed.plan_compare_lbl.text())
with db.get_connection() as conn:
    conn.execute("INSERT INTO sub_payment_plan (sub_contract_id, title, "
                 "due_date, amount, sort_order) VALUES (?,?,?,?,?)",
                 (SID, "4. الدفعة الخامسة", "2026-12-01", 1000.0, 4))
ed2 = uis.EditSubContractDialog(None, lc.get_sub_contract(SID))
check("اسم قديم في دفعات الباطن يُصحَّح عند الفتح",
      [r["title"] for r in ed2._plan_rows] == ["4. الدفعة الرابعة"],
      [r["title"] for r in ed2._plan_rows])

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
