# -*- coding: utf-8 -*-
"""V5.7 → V6.2: شاشة الأمر التغييري أوضح — تاب للجهة ← تابان فرعيان
(➕ إضافة / ➖ حذف) مع عدّادات في العناوين، والجدول المشترك بالأسفل،
ورسائل صريحة عند فراغ قائمة الإضافة أو الحذف.

حُدّث في V6.2 بعد إعادة بناء الشاشة:
  * الأدوات صارت على الحوار مباشرة (cli_tabs/sub_tabs/del_table/...).
  * العدّادات = أجزاء هذا الأمر التغييري (لا صفوف القوائم).
  * المقاول يُختار داخل تاب المقاول، وقائمة إضافته = بنود العميل المحفوظة.
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db
_t = tempfile.mkdtemp(prefix="v57_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt
app = QApplication.instance() or QApplication(sys.argv)
from ui import style
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True

from database.models import Contract, Customer
from services import (auth_service, contract_service as ks, customer_service as cs,
                      lifecycle_service as lc)
import ui.addendum_dialog as uad

auth_service._current["role"] = auth_service.ROLE_DEVELOPER
PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


cust = cs.add_customer(Customer(customer_code="C-57", name="عميل V5.7",
                                phone="90000571"))
# ===== عقد ببنود =====
kid = ks.add_contract(Contract(contract_number="CO-57A", customer_id=cust,
                               contract_date="2026-10-06", contract_type="",
                               description="", amount=6000.0))
for _d, _p in (("أعمال الهيكل", 3000.0), ("أعمال الصحي", 2000.0),
               ("أعمال الكهرباء", 1000.0)):
    lc.add_boq_item(kid, _d, 1, "", _p)
sub_id = lc.add_subcontractor("SUB-57", "مقاول V5.7", phone="90000572")
_boq1 = lc.list_boq(kid)[0]["id"]
SID = lc.add_sub_contract(sub_id, kid, None, 3000.0, boq_item_ids=[_boq1])

print("=== V5.7.1 الشكل: تاب جهة ← تابان (+ إضافة / - حذف) بعدّادات ===")
dlg = uad.ChangeOrderDialog(None, kid)
check("تابان رئيسيان: عميل · مقاول", dlg.tabs.count() == 2
      and "عميل" in dlg.tabs.tabText(0) and "مقاول" in dlg.tabs.tabText(1),
      [dlg.tabs.tabText(i) for i in range(2)])
for _tag, _tabs in (("عميل", dlg.cli_tabs), ("مقاول", dlg.sub_tabs)):
    _txt = [_tabs.tabText(i) for i in range(_tabs.count())]
    check(f"جهة {_tag}: تابا فرعيان (إضافة/حذف)",
          _tabs.count() == 2 and "إضافة" in _txt[0] and "حذف" in _txt[1], _txt)

print("=== V5.7.2 جهة العميل: الحذف يعرض بنود العقد · الإضافة ترشد للفراغ ===")
check("جدول الحذف يعرض 3 بنود", dlg.del_table.rowCount() == 3,
      dlg.del_table.rowCount())
check("بلا عدّاد حذف قبل أي وسم (الجدول للعرض والوسم فقط)",
      "(" not in dlg.cli_tabs.tabText(1), dlg.cli_tabs.tabText(1))
check("لا بنود متاحة (لا مظاريف) ⇒ رسالة ترشد للبند اليدوي",
      dlg.avail_table.rowCount() == 0
      and "يدوي" in dlg.avail_hint.text(), dlg.avail_hint.text())
check("عدّاد الإضافة لا يظهر قبل أي إضافة",
      "(" not in dlg.cli_tabs.tabText(0), dlg.cli_tabs.tabText(0))

print("=== V5.7.3 جهة المقاول: المعروض = بنود العميل المحفوظة · الحذف = المسنَد ===")
dlg.tabs.setCurrentIndex(1)
dlg.sub_combo.setCurrentIndex(dlg.sub_combo.findData(int(sub_id)))
dlg._sub_changed()
_add = [dlg.sub_add_table.item(r, 1).text()
        for r in range(dlg.sub_add_table.rowCount())]
_dl = [dlg.sub_del_table.item(r, 1).text()
       for r in range(dlg.sub_del_table.rowCount())]
check("المعروض للمقاول = بنود العميل المحفوظة (3)", len(_add) == 3
      and "أعمال الصحي" in _add and "أعمال الكهرباء" in _add, _add)
_marked = next(r for r in range(dlg.sub_add_table.rowCount())
               if dlg.sub_add_table.item(r, 1).text() == "أعمال الهيكل")
check("المشغول على عقد الباطن موسوم بتلميح منع التكرار",
      "بالفعل" in (dlg.sub_add_table.item(_marked, 0).toolTip() or ""),
      dlg.sub_add_table.item(_marked, 0).toolTip())
check("للحذف = البند المسنَد لعقد الباطن فقط", _dl == ["أعمال الهيكل"], _dl)
check("لا عدّادات على جهة المقاول قبل الإسناد",
      "(" not in dlg.sub_tabs.tabText(0)
      and "(" not in dlg.sub_tabs.tabText(1),
      [dlg.sub_tabs.tabText(i) for i in range(2)])

print("=== V5.7.4 الإضافة اليدوية تعمل من تاب الإضافة ===")
dlg.tabs.setCurrentIndex(0)
dlg.cli_tabs.setCurrentIndex(0)
dlg.m_desc.setText("بند إضافي بالاتفاق")
dlg.m_qty.setValue(2)
dlg.m_price.setValue(250.0)
dlg._add_manual()
check("الجزء أُضيف إلى الجدول المشترك",
      dlg.parts_table.rowCount() == 1
      and "بند إضافي بالاتفاق" in dlg.parts_table.item(0, 1).text(),
      dlg.parts_table.rowCount())
check("المجموع = 500.000 بالأسفل", "+500.000" in dlg.foot.text(),
      dlg.foot.text())
check("عدّاد إضافة العميل صار (1)", "(1)" in dlg.cli_tabs.tabText(0),
      dlg.cli_tabs.tabText(0))
for _r in range(dlg.del_table.rowCount()):
    if dlg.del_table.item(_r, 1).text() == "أعمال الكهرباء":
        dlg.del_table.item(_r, 0).setCheckState(Qt.Checked)
dlg._mark_delete()
check("وسم بند حذف يرفع العدّاد ويعرضه في الجدول المشترك",
      "(1)" in dlg.cli_tabs.tabText(1)
      and dlg.parts_table.rowCount() == 2,
      (dlg.cli_tabs.tabText(1), dlg.parts_table.rowCount()))
dlg.close()

print("=== V5.7.5 عقد بلا بنود: رسالة صريحة لا جدول فارغ مبهم ===")
kid2 = ks.add_contract(Contract(contract_number="CO-57B", customer_id=cust,
                                contract_date="2026-10-06", contract_type="",
                                description="", amount=4000.0))
d2 = uad.ChangeOrderDialog(None, kid2)
d2.cli_tabs.setCurrentIndex(1)
check("رسالة «لا بنود على هذا العقد بعد» + مكان إدخالها",
      d2.del_table.rowCount() == 0
      and d2.del_empty.isVisibleTo(d2.p_client)
      and "لا بنود على هذا العقد بعد" in d2.del_empty.text(),
      d2.del_empty.text())
check("بلا عدّاد (0) على تاب الحذف", "(" not in d2.cli_tabs.tabText(1),
      d2.cli_tabs.tabText(1))
d2.close()

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
