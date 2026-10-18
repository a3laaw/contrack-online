# -*- coding: utf-8 -*-
"""V5.3 (قرار 2026-10-06): ① شاشة تعديل العقد تعرض دفعات العقد الفعلية
المشمولة فقط — بمبالغها المحفوظة رقمًا واضحًا — وسطر «غير مشمول» لبقية
خطوات القالب · ② شاشة عقد الباطن تُخفي صندوق البنود لأي نوع له قالب
ولا بنود على العقد (بدل جدول فارغ ونص إرشادي مضلِّل).

قياس فعلي على قاعدة مؤقتة — لا يمسّ أي بيانات.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
t = tempfile.mkdtemp(prefix="v53_")
db.DATA_DIR = t
db.DB_PATH = os.path.join(t, "t.sqlite")
from database import database  # noqa: E402
database.init_db()
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service, lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


# ============ الإعداد: نوع «عقد كامل» — 3 تصنيفات و6 خطوات + قالب 6 دفعات
T = "عقد كامل (فحص 53)"
cts.add_type(T, 0.0, manual_track=True)
with get_connection() as c:
    _mains = {}
    for nm in ("الهيكل", "الصحي", "الكهرباء"):
        _mains[nm] = wf.add_stage("contract", nm, contract_type=T)
    _STEPS = [("الدور الأول", "الهيكل"), ("الدور التالي", "الهيكل"),
              ("تمديد البايات", "الصحي"), ("الفحص", "الصحي"),
              ("تمديد بايات الكهرباء", "الكهرباء"),
              ("فحص الكهرباء", "الكهرباء")]
    for i, (nm, parent) in enumerate(_STEPS):
        sid = wf.add_stage("contract", nm, contract_type=T,
                           parent_id=_mains[parent])
        c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                  " title, pct, amount_fixed, trigger_stage_id)"
                  " VALUES (?,?,?,?,?,?)", (T, i + 1, nm, 0, 0.0, sid))
T2 = "بلا قالب (فحص 53)"
cts.add_type(T2, 0.0, manual_track=True)
cust = customer_service.add_customer(Customer(
    customer_code="C-53", name="عميل فحص 53", phone="90000530"))
with get_connection() as c:
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-53", "مقاول فحص 53", "1"))
    sub = c.execute("SELECT id FROM subcontractors WHERE sub_code='S-53'"
                    ).fetchone()["id"]

from PySide6.QtWidgets import QApplication, QMessageBox, QDialog  # noqa: E402
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication([])
QMessageBox.exec = lambda self: 0
import ui.contracts as uic  # noqa: E402
from ui import style  # noqa: E402
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
    setattr(uic.style, _n, getattr(style, _n))
style.confirm = style.confirm_financial = lambda *a, **k: True
uic.style.confirm = uic.style.confirm_financial = style.confirm
import ui.subcontractors as scm  # noqa: E402
for _n in ("info", "error", "toast", "success"):
    setattr(scm.style, _n, getattr(style, _n))

SEL = ["الدور الأول", "تمديد البايات", "تمديد بايات الكهرباء"]
EXCLUDED = ["الدور التالي", "الفحص", "فحص الكهرباء"]

print("=== 1. الإنشاء: نطاق 3 خطوات من 6 + دفعات 1,000 لكل خطوة ===")
d = uic.ContractDialog(None, None)
d.show()
QTest.qWait(180)
d.ctype.setCurrentIndex(d.ctype.findData(T))
app.processEvents()
check("شجرة النطاق ظاهرة للنوع القالبي اليدوي", not d._scope_box.isHidden())
d.customer.select_data(cust)
d.number.setText("CON-53")
d.amount.setValue(3000.0)
app.processEvents()
for i in range(d.scope_tree.topLevelItemCount()):
    top = d.scope_tree.topLevelItem(i)
    for j in range(top.childCount()):
        top.child(j).setCheckState(0, Qt.Unchecked)
app.processEvents()


def _find_step(nm):
    for i in range(d.scope_tree.topLevelItemCount()):
        top = d.scope_tree.topLevelItem(i)
        for j in range(top.childCount()):
            if top.child(j).text(0).strip() == nm:
                return top.child(j)
    return None


for nm in SEL:
    _it = _find_step(nm)
    _it.setCheckState(0, Qt.Checked)
    d._sync_scope_tree(_it, 0)
app.processEvents()
d._apply_scope_to_plan(silent=True)
app.processEvents()
check("جدول الدفعات = 3 خطوات مختارة فقط", d.plan_table.rowCount() == 3,
      d.plan_table.rowCount())
for r in range(d.plan_table.rowCount()):
    d.plan_table.item(r, 3).setText("1,000.000")
    app.processEvents()
check("المجموع يطابق قيمة العقد", "3,000.000" in d.plan_total_lbl.text(),
      d.plan_total_lbl.text())
check("التجاوزات المسجلة 1..3",
      d._plan_amount_overrides == {1: 1000.0, 2: 1000.0, 3: 1000.0},
      d._plan_amount_overrides)
d._save()
app.processEvents()
d.close()
with get_connection() as c:
    _row = c.execute("SELECT id FROM contracts WHERE contract_number='CON-53'"
                     ).fetchone()
    cid = int(_row["id"])
    _plan = [dict(x) for x in c.execute(
        "SELECT sort_order, amount FROM payment_plan WHERE contract_id=?"
        " ORDER BY sort_order", (cid,)).fetchall()]
check("المحفوظ = 3 دفعات بمبالغها", len(_plan) == 3
      and all(abs(float(p["amount"]) - 1000.0) < 0.001 for p in _plan),
      _plan)
check("ترقيم الخطة 1..3",
      [int(p["sort_order"]) for p in _plan] == [1, 2, 3], _plan)

print("=== 2. التعديل: المشمول فقط + مبالغ واضحة + سطر «غير مشمول» ===")
con = cs.get_contract(cid)
d3 = uic.ContractDialog(None, con)
d3.show()
QTest.qWait(220)
app.processEvents()
check("وضع القالب في التعديل", bool(d3._plan_tpl_mode))
check("الجدول = 3 دفعات (لا 6)", d3.plan_table.rowCount() == 3,
      d3.plan_table.rowCount())
_col3 = [d3.plan_table.item(r, 3).text() for r in range(d3.plan_table.rowCount())]
check("المبالغ ظاهرة أرقامًا واضحة (بلا «الفعلي» مقصوصة)",
      all(x == "1,000.000" for x in _col3) and "الفعلي" not in " ".join(_col3),
      _col3)
_hint = d3.plan_hint.text()
check("سطر «غير مشمول» يعدّد الخطوات الثلاث",
      all(nm in _hint for nm in EXCLUDED) and "غير مشمول" in _hint,
      _hint.replace("\n", " || "))
check("لا تجاوزات مسبقة عند الفتح", not d3._plan_amount_overrides,
      d3._plan_amount_overrides)
check("المجموع ✓ مطابق لقيمة العقد", "3,000.000" in d3.plan_total_lbl.text()
      and "✓" in d3.plan_total_lbl.text(), d3.plan_total_lbl.text())
# تعديل خليتين مع الحفاظ على المجموع
d3.plan_table.item(0, 3).setText("1,200.000")
app.processEvents()
d3.plan_table.item(1, 3).setText("800.000")
app.processEvents()
check("التجاوزات 1=1200 و2=800",
      d3._plan_amount_overrides == {1: 1200.0, 2: 800.0},
      d3._plan_amount_overrides)
check("المجموع يبقى مطابقًا", "✓" in d3.plan_total_lbl.text(),
      d3.plan_total_lbl.text())
d3._save()
app.processEvents()
d3.close()
with get_connection() as c:
    _plan2 = [dict(x) for x in c.execute(
        "SELECT sort_order, amount FROM payment_plan WHERE contract_id=?"
        " ORDER BY sort_order", (cid,)).fetchall()]
check("الحفظ طبّق تعديل المبالغ على هذا العقد",
      [round(float(p["amount"]), 3) for p in _plan2] == [1200.0, 800.0, 1000.0],
      _plan2)
with get_connection() as c:
    _tpl = c.execute("SELECT amount_fixed FROM type_payment_tpl WHERE"
                     " contract_type=? AND pay_no=1", (T,)).fetchone()[0]
check("قالب النوع لم يُمس", abs(float(_tpl or 0)) < 0.001, _tpl)

print("=== 3. شاشة عقد الباطن: نوع يدوي له قالب ⇒ صندوق البنود ظاهر ===")
from ui.subcontractors import (LinkSubContractDialog,  # noqa: E402
                               EditSubContractDialog)
sd = LinkSubContractDialog(None, cid)
sd.show()
QTest.qWait(250)
app.processEvents()
# V8.1: اليدوي له قالب ⇒ البنود تظهر (المستخدم يختار يدويًا)
check("صندوق البنود ظاهر في الإنشاء (يدوي له قالب)", not sd.items_box.isHidden())
check("النص الإرشادي يوجّه لاختيار الدفعات",
      ("اختر البنود" in sd.items_hint.text() or "علّم الدفعات" in sd.items_hint.text())
      and "له قالب" in sd.items_hint.text(),
      sd.items_hint.text())
# V8.2: في وضع الخطة، الدفعات تظهر فقط بعد تحديدها
# الافتراضي غير محدد، поэтому الجدول فارغ
check("دفعات عقد الباطن (فارغ افتراضيًا)", sd.plan_table.rowCount() == 0,
      sd.plan_table.rowCount())
check("ترقيم صندوق الدفعات ③ (البنود ظاهرة)",
      sd.plan_box.title().startswith("③"), sd.plan_box.title())
sd.close()
# عقد باطن محفوظ ثم شاشة تعديله
lc.add_sub_contract(sub, cid, None, 3000.0, start_date="2026-10-06",
                    end_date="2027-01-06", description="", boq_item_ids=[])
_sc = None
for _s in lc.subcontractors_tree():
    for _cc in _s["contracts"]:
        if int(_cc.get("contract_id") or 0) == int(cid):
            _sc = _cc
            break
    if _sc:
        break
check("صف عقد الباطن متاح للتعديل", _sc is not None)
se = EditSubContractDialog(None, _sc)
se.show()
QTest.qWait(250)
app.processEvents()
# V8.1: اليدوي له قالب ⇒ البنود تظهر في التعديل أيضًا
check("صندوق البنود ظاهر في التعديل (يدوي له قالب)", not se.items_box.isHidden())
check("النص الإرشادي في التعديل يوجّه لاختيار البنود",
      "اختر البنود" in se.items_hint.text() or "له قالب" in se.items_hint.text()
      or "علّم الدفعات" in se.items_hint.text(),
      se.items_hint.text())
check("التعديل: ترقيم الدفعات ③ (البنود ظاهرة)",
      se.plan_box.title().startswith("③"),
      se.plan_box.title())
se.close()

print("=== 4. عقد بلا قالب وله بنود ⇒ الجدول ظاهر كما هو ===")
k2 = cs.add_contract(Contract(contract_number="CON-53B", customer_id=cust,
    contract_date="2026-10-06", contract_type=T2, description="",
    amount=500.0), manual_path=True)
for _d_, _q_, _p_ in (("بند أ", 2, 100.0), ("بند ب", 3, 100.0)):
    lc.add_boq_item(k2, _d_, _q_, "", _p_)
sd2 = LinkSubContractDialog(None, k2)
sd2.show()
QTest.qWait(250)
app.processEvents()
check("صندوق البنود ظاهر", not sd2.items_box.isHidden())
check("كل البنود معروضة (2)", sd2.items_table.rowCount() == 2,
      sd2.items_table.rowCount())
check("بلا تجاوز: النص يعرض البنود كاملة",
      "كل بنود العقد" in sd2.items_hint.text(), sd2.items_hint.text())
# فكّ تعليم بند واحد — الآخر يبقى معلَّمًا وكل البنود تبقى ظاهرة
# (طلب صاحب النظام: يعرض كل البنود حتى غير المختارة)
check("الافتراضي: كل بنود العقد معلَّمة", len(sd2._selected_item_ids()) == 2,
      sd2._selected_item_ids())
sd2.items_table.item(1, 0).setCheckState(Qt.Unchecked)
app.processEvents()
check("بعد فكّ بند: كل البنود ما زالت ظاهرة",
      sd2.items_table.rowCount() == 2)
check("المختار واحد", len(sd2._selected_item_ids()) == 1,
      sd2._selected_item_ids())
check("الصف غير المختار ما زال معروضًا", not sd2.items_table.isRowHidden(1))
sd2.close()

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
