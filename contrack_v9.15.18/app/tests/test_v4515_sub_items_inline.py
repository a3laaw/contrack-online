# -*- coding: utf-8 -*-
"""V4.5.15 (قرار 2026-10-06): شاشة عقد الباطن — بنود عقد العميل في جدول واحد
(الاختيار داخل الجدول، بلا صندوق «البنود المختارة») · العقد التلقائي يُخفى
صندوق بنوده ويُكتفى بدفعات عقد الباطن.

قياس فعلي على قاعدة مؤقتة — لا يمسّ أي بيانات.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
t = tempfile.mkdtemp(prefix="v4515_")
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


# ================= الإعداد =================
MAN = "يدوي 515"
AUTO = "تلقائي 515"
cts.add_type(MAN, 1000.0, manual_track=True)
cts.add_type(AUTO, 1000.0)
_m = wf.add_stage("contract", "رئيسي", contract_type=AUTO)
_k = wf.add_stage("contract", "خطوة", contract_type=AUTO, parent_id=_m)
with get_connection() as c:
    c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title,"
              " pct, amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
              (AUTO, 1, "دفعة 1", 100, 0.0, _k))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-515", "مقاول 515", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-515",)).fetchone()["id"]
cust = customer_service.add_customer(Customer(
    customer_code="C-515", name="عميل 515", phone="90000515"))

# عقد يدوي بثلاثة بنود
kman = cs.add_contract(Contract(contract_number="CON-515-M", customer_id=cust,
    contract_date="2026-10-01", contract_type=MAN, description="",
    amount=1000.0), manual_path=True)
b1 = lc.add_boq_item(kman, "بند أول 515", 1, "", 500.0)
b2 = lc.add_boq_item(kman, "بند ثاني 515", 2, "", 150.0)
b3 = lc.add_boq_item(kman, "بند ثالث 515", 1, "", 200.0)
lc.add_plan_item(kman, "دفعة أولى 515", "2026-11-01", 300.0)
lc.add_plan_item(kman, "دفعة ثانية 515", "2026-12-01", 700.0)

# عقد تلقائي بلا بنود (حالة صاحب النظام: CON-0231)
kauto = cs.add_contract(Contract(contract_number="CON-515-A", customer_id=cust,
    contract_date="2026-10-01", contract_type=AUTO, description="",
    amount=1000.0))

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication([])
import ui.subcontractors as scm  # noqa: E402
from ui.subcontractors import (LinkSubContractDialog,  # noqa: E402
                               EditSubContractDialog)

scm.style.success = lambda *a, **kk: None
scm.style.error = lambda *a, **kk: None
scm.style.info = lambda *a, **kk: None
scm.style.toast = lambda *a, **kk: None

print("=== 1. العقد اليدوي: كل البنود كما هي + التعليم داخل الجدول ===")
d = LinkSubContractDialog(None, kman)
d.show()
QTest.qWait(250)
app.processEvents()
check("صندوق بنود عقد العميل ظاهر", not d.items_box.isHidden())
check("يوجد جدول «بنود مختارة» منفصل (V6.6)",
      hasattr(d, "chosen_table") and d.chosen_table.columnCount() == 5)
check("كل بنود العقد ظاهرة كما هي (3)",
      d.items_table.rowCount() == 3, d.items_table.rowCount())
check("الأعمدة: ✔ · البند · الكمية · الوحدة · سعر الوحدة · الإجمالي",
      [d.items_table.horizontalHeaderItem(i).text()
       for i in range(6)] == ["✔", "البند", "الكمية", "الوحدة",
                              "سعر الوحدة", "الإجمالي"])
check("قيم البنود كما هي (500/300/200)",
      [d.items_table.item(r, 5).text() for r in range(3)]
      == ["500.000", "300.000", "200.000"],
      [d.items_table.item(r, 5).text() for r in range(3)])

print("=== 2. الاختيار: العدّاد والمجموع والإرجاع داخل نفس الصندوق ===")
check("افتراضيًا كل البنود مختارة",
      sorted(d._selected_item_ids()) == sorted([b1, b2, b3]),
      d._selected_item_ids())
check("العدّاد يعرض العدد والمجموع",
      "3 بند" in d.items_total_lbl.text()
      and "1,000.000" in d.items_total_lbl.text(), d.items_total_lbl.text())
d.items_table.item(2, 0).setCheckState(Qt.Unchecked)   # إلغاء «بند ثالث»
app.processEvents()
check("إلغاء التعليم يُخرجه من المختار",
      d._selected_item_ids() == [b1, b2], d._selected_item_ids())
check("البند الثالث غير محدد (checkbox)",
      d.items_table.item(2, 0).checkState() == Qt.Unchecked,
      "Unchecked" if d.items_table.item(2, 0).checkState() == Qt.Unchecked else "Checked")
check("العدّاد تبع التغيير (2 بند · 800.000)",
      "2 بند" in d.items_total_lbl.text()
      and "800.000" in d.items_total_lbl.text(), d.items_total_lbl.text())
# نقرة حقيقية على الصف (كما يفعل المستخدم) — عمود 1 (لا يعبث بالتعليم)
_rect = d.items_table.visualRect(d.items_table.model().index(0, 1))
QTest.mouseClick(d.items_table.viewport(), Qt.LeftButton, Qt.NoModifier,
                 _rect.center())
app.processEvents()
d._return_selected()
app.processEvents()
check("زر «↑ إرجاع المحدد» يُلغي تعليم الصف المحدد (بنقرة حقيقية)",
      d._selected_item_ids() == [b2], d._selected_item_ids())
# تمييز الصف المختار
_brush = d.items_table.item(1, 1).background()
check("الصف المختار مميّز بلون",
      _brush.color().name().upper() in ("#E0E7FF", "#E1E7FF"),
      _brush.color().name())

print("=== 3. الحفظ: بنود مختارة + دفعات (شاشة واحدة) ===")
d.items_table.item(0, 0).setCheckState(Qt.Checked)
app.processEvents()
d.sub.select_data(sub_id)
d.amount.setValue(800.0)
QTest.qWait(80)
for r in range(d.plan_table.rowCount()):
    d.plan_table.item(r, 3).setText("400")
app.processEvents()
d._save()
app.processEvents()
with get_connection() as c:
    _sc = c.execute("SELECT * FROM sub_contracts WHERE contract_id=?",
                    (kman,)).fetchone()
    _its = c.execute("SELECT boq_item_id FROM sub_contract_items WHERE"
                     " sub_contract_id=?", (_sc["id"],)).fetchall()
    _pl = c.execute("SELECT COUNT(*) FROM sub_payment_plan WHERE"
                    " sub_contract_id=?", (_sc["id"],)).fetchone()[0]
check("حُفظ عقد الباطن ببنود مختارة (b1, b2)",
      _sc is not None and sorted(int(x[0]) for x in _its) == sorted([b1, b2]),
      [int(x[0]) for x in (_its or [])])
check("وحُفظت خطته (دفعتان)", _pl == 2, _pl)

print("=== 4. العقد التلقائي: يُخفى صندوق بنود عقد العميل ===")
da = LinkSubContractDialog(None, kauto)
da.show()
QTest.qWait(250)
app.processEvents()
check("صندوق بنود عقد العميل مخفي (تلقائي بلا بنود)",
      da.items_box.isHidden())
check("النص الإرشادي يوضح السبب",
      "تلقائي" in da.items_hint.text(), da.items_hint.text())
check("دفعات عقد الباطن ظاهرة من دفعات العميل",
      da.plan_table.rowCount() == 1, da.plan_table.rowCount())
check("لا بنود مختارة (يُحفظ بلا بنود)",
      da._selected_item_ids() == [], da._selected_item_ids())
da.sub.select_data(sub_id)
da.amount.setValue(500.0)
QTest.qWait(80)
da.plan_table.item(0, 3).setText("500")
app.processEvents()
da._save()
app.processEvents()
with get_connection() as c:
    _sc2 = c.execute("SELECT * FROM sub_contracts WHERE contract_id=?",
                     (kauto,)).fetchone()
    _n_items = c.execute("SELECT COUNT(*) FROM sub_contract_items WHERE"
                         " sub_contract_id=?",
                         (_sc2["id"],)).fetchone()[0]
    _n_pl = c.execute("SELECT COUNT(*) FROM sub_payment_plan WHERE"
                      " sub_contract_id=?", (_sc2["id"],)).fetchone()[0]
check("حُفظ عقد الباطن للتلقائي بلا بنود وبخطة واحدة",
      _sc2 is not None and _n_items == 0 and _n_pl == 1,
      (_n_items, _n_pl))

print("=== 5. تعديل عقد باطن: نفس الشكل (بلا صندوق ثالث) ===")
_sc_row = dict(lc.list_sub_contracts(contract_id=kman)[0])
de = EditSubContractDialog(None, _sc_row)
de.show()
QTest.qWait(250)
app.processEvents()
check("التعديل: يوجد جدول «بنود مختارة» (V6.6)",
      hasattr(de, "chosen_table") and de.chosen_table.columnCount() == 5)
check("التعديل: بنود العقد ظاهرة", de.items_table.rowCount() == 3,
      de.items_table.rowCount())
check("التعديل: المختار المحفوظ ظاهر معلَّمًا",
      sorted(de._selected_item_ids()) == sorted([b1, b2]),
      de._selected_item_ids())
check("التعديل: صّف الترقيم صار ③ للدفعات",
      "③" in de.plan_table.parent().title(),
      de.plan_table.parent().title())
de.close()

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
