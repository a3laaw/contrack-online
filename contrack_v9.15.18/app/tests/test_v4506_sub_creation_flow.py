# -*- coding: utf-8 -*-
"""V4.5.11: دورة عمل عقد المقاول في شاشة واحدة (بلا خطوات وبلا «التالي»).

① البيانات · ② بنود عقد العميل (التعليم داخل الجدول نفسه — V4.5.15) ·
③ دفعات عقد الباطن (المبالغ تُكتب يدويًا) — حفظ واحد.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402

if os.path.isdir("data"):
    import shutil  # noqa: E402
    shutil.rmtree("data")
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import customer_service, workflow_service as wf  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


TODAY = date.today().isoformat()
cust = customer_service.add_customer(
    Customer(customer_code="C-4506", name="عميل 4506", phone="90004606"))
s1 = wf.add_stage("contract", "مرحلة أولى 4506", contract_type="T4506")
s2 = wf.add_stage("contract", "مرحلة ثانية 4506", contract_type="T4506")
with get_connection() as c:
    for i, s in ((1, s1), (2, s2)):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("T4506", i, f"دفعة {i}", 0, 100.0, s))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-4506", "مقاول 4506", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-4506",)).fetchone()["id"]

k = cs.add_contract(Contract(
    contract_number="CON-4506", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4506",
    description="x", amount=200.0), manual_path=True)
i1 = lc.add_boq_item(k, "بند أول", 1, "", 120.0)
i2 = lc.add_boq_item(k, "بند ثاني", 1, "", 80.0)


def _reset_plan(contract_id, titles=("دفعة أولى", "دفعة ثانية"),
                amounts=(60.0, 140.0)):
    with get_connection() as c:
        c.execute("DELETE FROM payment_plan WHERE contract_id=?", (contract_id,))
        for i, (t, a) in enumerate(zip(titles, amounts), 1):
            c.execute(
                "INSERT INTO payment_plan (contract_id, title, amount,"
                " due_date, sort_order, stage_id) VALUES (?,?,?,?,?,?)",
                (contract_id, t, a, "2026-0%d-01" % (i + 1), i, None))


_reset_plan(k)

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QDialog  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402
import ui.subcontractors as scm  # noqa: E402
from ui.subcontractors import LinkSubContractDialog, EditSubContractDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
_msgs = []
scm.style.success = lambda *a, **kk: _msgs.append(("ok", a[1] if len(a) > 1 else ""))
scm.style.error = lambda *a, **kk: _msgs.append(
    ("err", a[1] if len(a) > 1 else ""))
scm.style.info = lambda *a, **kk: _msgs.append(("info", ""))
scm.style.toast = lambda *a, **kk: _msgs.append(("toast", ""))

print("=== 1. شاشة واحدة: البيانات والبنود والدفعات معًا ===")
dlg = LinkSubContractDialog(None, k)
dlg.show()                     # الجداول الظاهرة فقط تقبل التحديد بالنقر
QTest.qWait(200)
app.processEvents()
check("لا صفحات متعددة ولا زر «التالي»",
      not hasattr(dlg, "stack") and not hasattr(dlg, "_next_btn"))
check("بنود عقد العميل ظاهرة فورًا", dlg.items_table.rowCount() == 2,
      dlg.items_table.rowCount())
check("دفعات عقد العميل ظاهرة فورًا", dlg.plan_table.rowCount() == 2,
      dlg.plan_table.rowCount())
check("المبالغ فارغة بنص إرشادي",
      all("تُحدد لاحقًا" in dlg.plan_table.item(r, 3).text()
          for r in range(dlg.plan_table.rowCount())),
      [dlg.plan_table.item(r, 3).text() for r in range(2)])
check("كل دفعة مربوطة بمصدر دفعة العميل",
      all(r.get("sources") for r in dlg._plan_rows),
      [r.get("sources") for r in dlg._plan_rows])
# V6.1: العمود صار «حالة دفعة العميل» — نص واضح بدل رموز المصادر.
check("عمود «حالة دفعة العميل» ظاهر ومفهوم",
      dlg.plan_table.item(0, 5).text() in ("✓ محصّلة", "⏳ لم تُحصَّل")
      and dlg.plan_table.horizontalHeaderItem(5).text()
      == "حالة دفعة العميل",
      dlg.plan_table.item(0, 5).text())

print("=== 2. V4.5.15: الاختيار داخل جدول البنود نفسه (بلا صندوق ثالث) ===")
check("يوجد جدول «بنود مختارة» منفصل (V6.6)",
      hasattr(dlg, "chosen_table") and dlg.chosen_table.columnCount() == 5)
check("افتراضيًا كل بند غير مرتبط مختار",
      dlg._selected_item_ids() == [i1, i2], dlg._selected_item_ids())
check("البند الأول محدد (checkbox)",
      dlg.items_table.item(0, 0).checkState() == Qt.Checked,
      "Checked" if dlg.items_table.item(0, 0).checkState() == Qt.Checked else "Unchecked")
dlg.items_table.item(1, 0).setCheckState(Qt.Unchecked)
app.processEvents()
check("إلغاء التعليم يزيل البند من المختار",
      dlg._selected_item_ids() == [i1], dlg._selected_item_ids())
check("البند الثاني غير محدد (checkbox)",
      dlg.items_table.item(1, 0).checkState() == Qt.Unchecked,
      "Unchecked" if dlg.items_table.item(1, 0).checkState() == Qt.Unchecked else "Checked")
check("العدّاد يعرض المختار ومجموعه",
      "1 بند" in dlg.items_total_lbl.text()
      and "120" in dlg.items_total_lbl.text(), dlg.items_total_lbl.text())
dlg.items_table.item(1, 0).setCheckState(Qt.Checked)
app.processEvents()
check("إعادة التعليم تُرجعه للمختار",
      dlg._selected_item_ids() == [i1, i2])
# نقرة حقيقية على الصف في نفس الجدول ثم «↑ إرجاع المحدد»
_rect = dlg.items_table.visualRect(
    dlg.items_table.model().index(0, 1))
QTest.mouseClick(dlg.items_table.viewport(), Qt.LeftButton, Qt.NoModifier,
                 _rect.center())            # نقرة حقيقية (كما يفعل المستخدم)
app.processEvents()
dlg._return_selected()
app.processEvents()
check("زر «↑ إرجاع المحدد» يُلغي تعليم الصف المحدد",
      dlg._selected_item_ids() == [i2], dlg._selected_item_ids())

print("=== 3. الدفعات يدويًا + الحفظ مرة واحدة ===")
dlg.plan_table.item(0, 3).setText("60")
app.processEvents()
check("كتابة القيمة تُنسَّق وتُخزَّن",
      dlg.plan_table.item(0, 3).text() == "60.000"
      and dlg._plan_rows[0]["amount"] == 60.0,
      (dlg.plan_table.item(0, 3).text(), dlg._plan_rows[0]["amount"]))
dlg.plan_table.item(0, 3).setText("ألف")
app.processEvents()
check("النص غير الرقمي لا يُفسد القيمة",
      dlg._plan_rows[0]["amount"] == 60.0, dlg.plan_table.item(0, 3).text())
dlg.sub.select_data(sub_id)
dlg.amount.setValue(200.0)
_msgs.clear()
dlg._save()
check("الحفظ مرفوض مع دفعة بلا قيمة",
      dlg.result() != QDialog.Accepted and _msgs
      and "بلا قيمة" in _msgs[-1][1], _msgs[-1] if _msgs else None)
dlg.plan_table.item(1, 3).setText("140")
app.processEvents()
_msgs.clear()
dlg._save()
check("الحفظ نجح برسالة واضحة",
      dlg.result() == QDialog.Accepted and _msgs and _msgs[-1][0] == "ok",
      _msgs[-1] if _msgs else None)
with get_connection() as c:
    sc = c.execute("SELECT id FROM sub_contracts WHERE contract_id=?",
                   (k,)).fetchone()
    sid = int(sc["id"]) if sc else 0
    items = [int(r[0]) for r in c.execute(
        "SELECT boq_item_id FROM sub_contract_items WHERE sub_contract_id=?",
        (sid,)).fetchall()]
    lines = c.execute(
        "SELECT COUNT(*) FROM sub_payment_plan WHERE sub_contract_id=?",
        (sid,)).fetchone()[0]
    srcs = c.execute(
        "SELECT COUNT(*) FROM sub_payment_sources sps JOIN sub_payment_plan"
        " sp ON sp.id = sps.sub_line_id WHERE sp.sub_contract_id=?",
        (sid,)).fetchone()[0]
    amts = [float(r[0]) for r in c.execute(
        "SELECT amount FROM sub_payment_plan WHERE sub_contract_id=? "
        "ORDER BY sort_order", (sid,)).fetchall()]
check("عقد الباطن أُنشئ", bool(sid))
check("البند المحدد فقط ارتبط", items == [i2], items)
check("سطرا الدفعات أُنشئا بقيمهما اليدوية", lines == 2 and amts == [60.0, 140.0],
      (lines, amts))
check("مصادر السطور محفوظة", srcs == 2, srcs)

print("=== 4. عقد عميل بلا دفعات: إرشاد بلا فشل ===")
k2 = cs.add_contract(Contract(
    contract_number="CON-4506B", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4506",
    description="x", amount=100.0), manual_path=True)
with get_connection() as c:
    c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k2,))
dlg2 = LinkSubContractDialog(None, k2)
dlg2.show()
QTest.qWait(200)
app.processEvents()
dlg2.sub.select_data(sub_id)
dlg2.customer.select_data(cust)
app.processEvents()
dlg2.contract.select_data(k2)
dlg2.amount.setValue(100.0)
check("رسالة إرشادية لعقد بلا دفعات", "يدويًا" in dlg2.plan_hint.text(),
      dlg2.plan_hint.text()[:70])
check("لا صفوف دفعات", dlg2._plan_rows == [])
dlg2._save()
with get_connection() as c:
    n2 = c.execute("SELECT COUNT(*) FROM sub_contracts WHERE contract_id=?",
                   (k2,)).fetchone()[0]
check("العقد حُفظ بلا خطة", n2 == 1, n2)

print("=== 5. شاشة التعديل موحّدة بنفس الشكل ===")
sc_row = lc.get_sub_contract(sid)
ed = EditSubContractDialog(None, sc_row)
ed.show()
app.processEvents()
check("التعديل شاشة واحدة بلا خطوات", not hasattr(ed, "stack"))
check("بنود عقد العميل ظاهرة والمختار معلَّم",
      ed.items_table.rowCount() == 2 and ed._selected_item_ids() == [i2],
      (ed.items_table.rowCount(), ed._selected_item_ids()))
check("دفعات الباطن بقيمها",
      ed.plan_table.rowCount() == 2
      and ed.plan_table.item(0, 3).text() == "60.000",
      [ed.plan_table.item(r, 3).text() for r in range(2)])
ed.plan_table.item(0, 3).setText("75")
app.processEvents()
ed._save()
with get_connection() as c:
    a0 = c.execute("SELECT amount FROM sub_payment_plan WHERE sub_contract_id=?"
                   " ORDER BY sort_order LIMIT 1", (sid,)).fetchone()[0]
check("تعديل القيمة من الشاشة يُحفظ في القاعدة", float(a0) == 75.0, a0)

print("=== 6. شاشة التعديل تُبنى من بيانات شجرة المقاولين نفسها ===")
tree = lc.subcontractors_tree()
crow = None
for node in tree:
    for c_ in node["contracts"]:
        if int(c_.get("id")) == sid:
            crow = c_
check("صف العقد موجود في شجرة المقاولين", crow is not None)
if crow is not None:
    ed2 = EditSubContractDialog(None, crow)
    ed2.show()
    app.processEvents()
    check("التعديل من الشجرة يفتح بقيمه ودفعاته",
          ed2.contract_id == k and ed2.plan_table.rowCount() == 2,
          (ed2.contract_id, ed2.plan_table.rowCount()))

print("")
print(f"V4.5.11 sub single-screen flow: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
