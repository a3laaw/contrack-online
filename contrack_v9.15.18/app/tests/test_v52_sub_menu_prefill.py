# -*- coding: utf-8 -*-
"""V5.2 (قرار 2026-10-06): إنشاء عقد باطن من الزر الأيمن في شجرة المقاولين —
والمقاول يُعبَّأ تلقائيًا في خانة «مقاول الباطن» · وكذلك زر «＋ عقد باطن جديد»
في مركز العقد يعبّئ صف المقاول المحدد.

قياس فعلي على قاعدة مؤقتة — لا يمسّ أي بيانات.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
t = tempfile.mkdtemp(prefix="v52_")
db.DATA_DIR = t
db.DB_PATH = os.path.join(t, "t.sqlite")
from database import database  # noqa: E402
database.init_db()
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service, lifecycle_service as lc  # noqa: E402

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
cts.add_type("يدوي 52", 1000.0, manual_track=True)
cust = customer_service.add_customer(Customer(
    customer_code="C-52", name="عميل 52", phone="90000520"))
with get_connection() as c:
    c.execute("INSERT INTO subcontractors (sub_code, name, phone, activity)"
              " VALUES (?,?,?,?)", ("S-52-A", "مقاول ألفا", "1", "تشطيبات"))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone, activity)"
              " VALUES (?,?,?,?)", ("S-52-B", "مقاول بيتا", "2", "كهرباء"))
    sub_a = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                      ("S-52-A",)).fetchone()["id"]
    sub_b = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                      ("S-52-B",)).fetchone()["id"]

k = cs.add_contract(Contract(contract_number="CON-0052", customer_id=cust,
    contract_date="2026-10-06", contract_type="يدوي 52", description="",
    amount=1000.0), manual_path=True)
lc.add_boq_item(k, "بند 52", 1, "", 1000.0)
lc.add_plan_item(k, "دفعة 52", "2026-11-01", 1000.0)

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QDialog  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication([])
import ui.subcontractors as scm  # noqa: E402
from ui.subcontractors import (LinkSubContractDialog,  # noqa: E402
                               SubcontractorsPage)

scm.style.success = lambda *a, **kk: None
scm.style.error = lambda *a, **kk: None
scm.style.info = lambda *a, **kk: None
scm.style.toast = lambda *a, **kk: None

print("=== 1. شاشة الإنشاء تستقبل المقاول وتعبّئه تلقائيًا ===")
d = LinkSubContractDialog(None, k, preset_sub_id=sub_b)
d.show()
QTest.qWait(250)
app.processEvents()
check("خانة «مقاول الباطن» معبَّأة بالمقاول المطلوب",
      d.sub.selected_data() == sub_b, d.sub.selected_data())
check("عقد العميل معبَّأ (الممرَّر)",
      d.contract.selected_data() == k, d.contract.selected_data())
check("الاختيار اليدوي ما زال يعمل",
      d.sub.select_data(sub_a) and d.sub.selected_data() == sub_a)

print("=== 2. بلا تمرير مقاول: الخانة تبقى فارغة كما كانت ===")
d0 = LinkSubContractDialog(None, k)
d0.show()
QTest.qWait(200)
app.processEvents()
check("بلا preset: خانة المقاول فارغة", not d0.sub.selected_data(),
      d0.sub.selected_data())
d0.close()

print("=== 3. الزر الأيمن في شجرة المقاولين: الخيار موجود ويعمل ===")
page = SubcontractorsPage()
page.show()
page.refresh()             # الشجرة تُبنى عند التحديث
QTest.qWait(250)
app.processEvents()
_captured = {}
_orig_exec = QDialog.exec


def _fake_exec(self):
    """نلتقط النموذج المفتوح بدل تنفيذ نافذة حقيقية."""
    if isinstance(self, LinkSubContractDialog):
        _captured["dlg"] = self
        return QDialog.Rejected
    return QDialog.Rejected


QDialog.exec = _fake_exec
try:
    # (أ) على صف مقاول
    _found = None
    for i in range(page.tree.topLevelItemCount()):
        it = page.tree.topLevelItem(i)
        if it.data(0, Qt.UserRole + 1) == sub_a:
            _found = it
            break
    check("المقاول ظاهر في الشجرة", _found is not None)
    page.tree.setCurrentItem(_found)
    app.processEvents()
    kind, data = page._selected()
    check("المحدد = نوع «مقاول»", kind == "sub" and int(data) == sub_a,
          (kind, data))
    page._link_for_selected()
    app.processEvents()
    _dlg = _captured.get("dlg")
    check("الزر الأيمن يفتح نموذج عقد الباطن", _dlg is not None)
    check("النموذج فُتح والمقاول معبَّأ تلقائيًا",
          _dlg is not None and _dlg.sub.selected_data() == sub_a,
          _dlg.sub.selected_data() if _dlg else None)

    # (ب) على صف عقد باطن (بعد إنشاء عقد للمقاول ألفا)
    _captured.clear()
    lc.add_sub_contract(sub_a, k, None, 1000.0, start_date="2026-10-06",
                        end_date="2027-01-06", description="", boq_item_ids=[])
    page.refresh()
    app.processEvents()
    _child = None
    for i in range(page.tree.topLevelItemCount()):
        it = page.tree.topLevelItem(i)
        if it.data(0, Qt.UserRole + 1) == sub_a:
            if it.childCount():
                _child = it.child(0)
            break
    check("عقد الباطن ظاهر تحت المقاول", _child is not None)
    page.tree.setCurrentItem(_child)
    app.processEvents()
    kind2, data2 = page._selected()
    check("المحدد = نوع «عقد باطن»", kind2 == "sub_contract", kind2)
    page._link_for_selected()
    QTest.qWait(200)          # اختيار عقد العميل يتم بمؤقت قصير داخل النموذج
    app.processEvents()
    _dlg2 = _captured.get("dlg")
    check("من صف عقد الباطن: المقاول معبَّأ أيضًا",
          _dlg2 is not None and _dlg2.sub.selected_data() == sub_a,
          _dlg2.sub.selected_data() if _dlg2 else None)
    check("ومعه عقد العميل الأب",
          _dlg2 is not None and _dlg2.contract.selected_data() == k,
          _dlg2.contract.selected_data() if _dlg2 else None)

    # (ج) بلا تحديد: رسالة إرشاد بلا فتح نموذج
    _captured.clear()
    page.tree.setCurrentItem(None) if hasattr(page.tree, "setCurrentItem") else None
    page.tree.clearSelection()
    page.tree.setCurrentItem(None)
    app.processEvents()
    page._link_for_selected()
    app.processEvents()
    check("بلا تحديد: لا يُفتح نموذج", _captured.get("dlg") is None)
finally:
    QDialog.exec = _orig_exec
page.close()

print("=== 4. مركز العقد: زر «＋ عقد باطن جديد» يعبّئ صف المقاول المحدد ===")
import ui.contract_hub as hub  # noqa: E402
_orig_hub_exec = QDialog.exec
_hub_cap = {}


def _hub_exec(self):
    if isinstance(self, LinkSubContractDialog):
        _hub_cap["dlg"] = self
    return QDialog.Rejected


QDialog.exec = _hub_exec
try:
    h = hub.ContractHubPage(None)
    h.load_contract(k, open_page="pay")
    h.show()
    QTest.qWait(350)
    app.processEvents()
    h._switch_page("pay")
    QTest.qWait(350)
    app.processEvents()
    # V6.5: الجداول موحّدة (كتلة لكل مقاول) ⇒ نبحث عن وسم المقاول
    #       في أي جدول، ويقبل الوسم على صف أو رأس الكتلة
    _row = _tab = None
    for _tb in h.pay_tables:
        for r in range(_tb.rowCount()):
            _it = _tb.item(r, 0)
            if _it is not None and _it.data(Qt.UserRole) == sub_a:
                _row, _tab = r, _tb
                break
        if _row is not None:
            break
    check("صف المقاول موسوم بمعرّفه في جدول المركز",
          _row is not None,
          [[b["table"].item(r, 0).text()
            for r in range(b["table"].rowCount())] for b in h._pay_blocks])
    if _tab is not None:
        if _row == 0:          # وسم رأس الكتلة (بلا دفعات بعد)
            _tab.setCurrentCell(0, 0)
        else:
            _tab.setCurrentCell(_row, 1)
        app.processEvents()
    h._add_sub()
    QTest.qWait(200)      # تمرير عقد العميل يتم بمؤقت قصير داخل النموذج
    app.processEvents()
    _dlg3 = _hub_cap.get("dlg")
    check("زر المركز فتح النموذج", _dlg3 is not None)
    check("والمقاول (المحدد في الجدول) معبَّأ تلقائيًا",
          _dlg3 is not None and _dlg3.sub.selected_data() == sub_a,
          _dlg3.sub.selected_data() if _dlg3 else None)
    check("وعقد العميل الحالي معبَّأ",
          _dlg3 is not None and _dlg3.contract.selected_data() == k,
          _dlg3.contract.selected_data() if _dlg3 else None)
    # بلا تحديد صف: يبقى السلوك القديم (عقد العميل فقط)
    _hub_cap.clear()
    for _tb in h.pay_tables:
        _tb.clearSelection()
        _tb.setCurrentCell(-1, -1)
    app.processEvents()
    h._add_sub()
    app.processEvents()
    _dlg4 = _hub_cap.get("dlg")
    check("بلا صف محدد: يُفتح النموذج بلا مقاول (كما كان)",
          _dlg4 is not None and not _dlg4.sub.selected_data(),
          _dlg4.sub.selected_data() if _dlg4 else None)
    h.close()
except Exception as _exc:
    check("مركز العقد: الفحص بلا استثناء", False, repr(_exc))

QDialog.exec = _orig_hub_exec

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
