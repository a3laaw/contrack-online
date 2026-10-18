# -*- coding: utf-8 -*-
"""V4.0: التعهد يفوز — نوافذ عقد الإشراف للمراحل المسماة + أسبقية بلا ازدواج."""
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

from PySide6.QtCore import QPoint, Qt  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402
from PySide6.QtWidgets import QApplication, QDialog  # noqa: E402

_app = QApplication.instance() or QApplication(sys.argv)

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import report_service as rep  # noqa: E402
from services import supervision_service as sup  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui import followup as fu  # noqa: E402
from ui.archive import CustomerFileWidget  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402
from ui.contracts import ContractDialog  # noqa: E402
from ui.followup import FollowupPanel  # noqa: E402
from ui import style as _style  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def _mk(code, name, phone, ctype, amount=750.0):
    c = cs.add_customer(Customer(customer_code=code, name=name, phone=phone))
    k = ks.add_contract(Contract(contract_number=f"K-{code}",
                                 customer_id=c,
                                 contract_date="2026-01-01",
                                 description="عقد", amount=amount,
                                 contract_type=ctype))
    wf.on_contract_signed(k)
    return c, k


cts.add_type("تصميم4")
cts.add_type("عادي4")
_main = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="تصميم4")
wf.add_stage(wf.TX_CONTRACT, "بداية تعهد الإشراف", contract_type="تصميم4",
             parent_id=_main, is_supervision=True)
wf.add_stage(wf.TX_CONTRACT, "تنفيذ", contract_type="تصميم4",
             parent_id=_main)
wf.add_stage(wf.TX_CONTRACT, "انهاء الاشراف", contract_type="تصميم4",
             parent_id=_main, is_supervision=True)
check("القالب إشرافي", wf.template_has_supervision("تصميم4") is True)
check("العادي بلا إشراف", wf.template_has_supervision("عادي4") is False)

_c1, kP = _mk("C-401", "عميل متعهد", "55401222", "تصميم4")
sup.setup_supervision(kP, "", 6, 200.0, touch_amount=False)
_c2, kN = _mk("C-402", "عميل بلا مدة", "55402222", "تصميم4")

print("=== 1. مصفوفة البوابة (موسومة/غير × بمدة/بلا) ===")
check("بداية: موسومة + مدة ← حوار",
      fu._should_ask_supervision_start(kP, "بداية تعهد الإشراف", True) is True)
check("بداية: موسومة بلا مدة ← صمت",
      fu._should_ask_supervision_start(kN, "بداية تعهد الإشراف", True) is False)
check("بداية: غير موسومة + مدة ← حوار",
      fu._should_ask_supervision_start(kP, "بداية تعهد الإشراف", False) is True)
check("بداية: غير موسومة بلا مدة ← صمت",
      fu._should_ask_supervision_start(kN, "بداية تعهد الإشراف", False) is False)
check("نهاية: موسومة + مدة ← حوار",
      fu._should_ask_supervision_end(kP, "انهاء الاشراف", True) is True)
check("نهاية: موسومة بلا مدة ← صمت",
      fu._should_ask_supervision_end(kN, "انهاء الاشراف", True) is False)
check("نهاية: غير موسومة + مدة ← حوار",
      fu._should_ask_supervision_end(kP, "انهاء الاشراف", False) is True)
check("نهاية: غير موسومة بلا مدة ← صمت",
      fu._should_ask_supervision_end(kN, "انهاء الاشراف", False) is False)

print("=== 2. التلميح يوجه للمسارين ===")
check("المتعهد بلا تلميح (الحوار سيظهر)",
      fu._supervision_hint(kP, "بداية تعهد الإشراف", True) is None)
check("الموسوم بلا مدة بلا تلميح (للمحرك المرحلي)",
      fu._supervision_hint(kN, "بداية تعهد الإشراف", True) is None)
_h = fu._supervision_hint(kN, "بداية تعهد الإشراف", False) or ""
check("غير المفعّل يُرشَد للمسارين معًا",
      "مدة الإشراف" in _h and "طابع" in _h, _h[:60])

print("=== 3. المدة تُحفظ وقيمة العقد لا تُمس ===")
with db.get_connection() as _c:
    _row = _c.execute("SELECT sup_months, sup_monthly, amount FROM contracts "
                      "WHERE id=?", (kP,)).fetchone()
check("المدة والقيمة محفوظتان",
      int(_row[0]) == 6 and float(_row[1]) == 200.0, str(tuple(_row)))
check("قيمة العقد intact (750)",
      float(_row[2]) == 750.0, str(tuple(_row)))

print("=== 4. الأسبقية: المحرك المرحلي يقف مع التعهد ===")
_sidP = wf.get_current_stage(wf.TX_CONTRACT, kP)["id"]
sup.setup_stage_supervision(_sidP, "2025-06-30", 200.0)
sup.set_stage_sup_start(_sidP, "2025-01-01")
check("المتعهد: حالة المرحلة None رغم اكتمال بياناتها",
      sup.stage_supervision_status(_sidP) is None)
_sidN = wf.get_current_stage(wf.TX_CONTRACT, kN)["id"]
sup.setup_stage_supervision(_sidN, "2025-06-30", 200.0)
sup.set_stage_sup_start(_sidN, "2025-01-01")
_stN = sup.stage_supervision_status(_sidN)
check("بلا مدة: المحرك حي ويحسب التمديد",
      _stN is not None and _stN["delay_months"] > 0,
      str(_stN["delay_months"]) if _stN else "None")
_rep = rep.supervision_delays_report()
_rows = _rep["rows"] if isinstance(_rep, dict) else _rep
_ids = [r.get("contract_id") for r in _rows]
check("التقرير يستبعد المتعهد ويُبقي الآخر",
      kP not in _ids and kN in _ids, str(_ids))

print("=== 5. زر الطابع ينحسر مع التعهد ===")
pP = FollowupPanel(None, wf.TX_CONTRACT, kP)
pP.show()
pP.refresh()
_app.processEvents()
check("المتعهد: زر الطابع مخفي", pP.sup_btn.isHidden())
pN = FollowupPanel(None, wf.TX_CONTRACT, kN)
pN.show()
pN.refresh()
_app.processEvents()
check("بلا مدة: زر الطابع ظاهر", pN.sup_btn.isVisible())

print("=== 6. نافذة العقد: حقول المدة + حفظ ===")
_errs, _confs = [], []
_orig_err, _orig_conf = _style.error, _style.confirm
_style.error = lambda *a, **k: _errs.append(a[1] if len(a) > 1 else "")
_style.confirm = lambda *a, **k: (_confs.append(1), True)[1]
try:
    d = ContractDialog(None)
    d.show()
    _app.processEvents()
    d.customer.select_data(_c1)
    d.ctype.setCurrentIndex(d.ctype.findData("تصميم4"))
    _app.processEvents()
    check("صندوق الإشراف ظاهر للقالب الإشرافي",
          d._sup_box.isVisible())
    check("حقول المدة ظاهرة وتبدأ صفرًا",
          d.sup_months.isVisible() and d.sup_months.value() == 0
          and d.sup_monthly.value() == 0.0)
    d.ctype.setCurrentIndex(d.ctype.findData("عادي4"))
    _app.processEvents()
    check("الصندوق مخفي للنوع العادي", d._sup_box.isHidden())
    d.ctype.setCurrentIndex(d.ctype.findData("تصميم4"))
    _app.processEvents()
    d.number.setText("K-404")
    d.amount.setValue(750.0)
    d.sup_months.setValue(6)
    d.sup_monthly.setValue(200.0)
    d._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k4 = _c.execute("SELECT id, amount, sup_months, sup_monthly "
                         "FROM contracts WHERE contract_number='K-404'"
                         ).fetchone()
    check("الحفظ بالمدة نجح بلا نوافذ", _k4 is not None and not _errs,
          str(_errs[:1]))
    check("المدة محفوظة والقيمة intact",
          _k4 is not None and int(_k4[2]) == 6 and float(_k4[3]) == 200.0
          and float(_k4[1]) == 750.0, str(tuple(_k4)) if _k4 else "missing")
    # عدم التطابق يُرفض
    _errs.clear()
    d2 = ContractDialog(None)
    d2.show()
    _app.processEvents()
    d2.customer.select_data(_c1)
    d2.ctype.setCurrentIndex(d2.ctype.findData("تصميم4"))
    _app.processEvents()
    d2.number.setText("K-404X")
    d2.amount.setValue(750.0)
    d2.sup_months.setValue(6)
    d2.sup_monthly.setValue(0.0)
    d2._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _kx = _c.execute("SELECT id FROM contracts "
                         "WHERE contract_number='K-404X'").fetchone()
    check("مدة بلا قيمة تُرفض ولا تُحفظ",
          _kx is None and any("معًا" in e for e in _errs), str(_errs[:1]))
    # صفر/صفر يُحفظ بلا تعهد
    _errs.clear()
    d3 = ContractDialog(None)
    d3.show()
    _app.processEvents()
    d3.customer.select_data(_c1)
    d3.ctype.setCurrentIndex(d3.ctype.findData("تصميم4"))
    _app.processEvents()
    d3.number.setText("K-404Z")
    d3.amount.setValue(750.0)
    d3._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _kz = _c.execute("SELECT id, sup_months FROM contracts "
                         "WHERE contract_number='K-404Z'").fetchone()
    check("صفر/صفر يُحفظ بلا تعهد",
          _kz is not None and int(_kz[1] or 0) == 0 and not _errs,
          str(_errs[:1]) if _errs else (str(tuple(_kz)) if _kz else "missing"))
finally:
    _style.error, _style.confirm = _orig_err, _orig_conf

print("=== 7. مركز العقد: صفوف التعديل تُظهر وتَحفظ ===")
_orig_exec = QDialog.exec
QDialog.exec = lambda self, *a, **k: 0
try:
    page = ContractHubPage(embedded=True)
    page.show()
    page.load_contract(kN)
    _app.processEvents()
    page._open_info_editor()
    _app.processEvents()
    check("صفوف الإشراف ظاهرة للقالب الإشرافي",
          bool(getattr(page, "_sup_rows_shown", False)))
    page.f_sup_months.setValue(6)
    page.f_sup_monthly.setValue(200.0)
    _saved = page._save_info()
    _app.processEvents()
    with db.get_connection() as _c:
        _kh = _c.execute("SELECT sup_months, sup_monthly, amount "
                         "FROM contracts WHERE id=?", (kN,)).fetchone()
    check("حفظ المركز يضبط المدة بلا مساس بالقيمة",
          _saved and int(_kh[0]) == 6 and float(_kh[1]) == 200.0
          and float(_kh[2]) == 750.0, str(tuple(_kh)))
    _c3, kO = _mk("C-403", "عميل عادي", "55403222", "عادي4")
    page.load_contract(kO)
    _app.processEvents()
    page._open_info_editor()
    _app.processEvents()
    check("النوع العادي: الصفوف مخفية",
          not getattr(page, "_sup_rows_shown", True))
finally:
    QDialog.exec = _orig_exec

print("=== 8. زر التعديل لا ينقل العرض ===")
_c4 = cs.add_customer(Customer(customer_code="C-404", name="عم",
                               phone="55404222"))
for _i in range(3):
    ks.add_contract(Contract(contract_number=f"K-E{_i}", customer_id=_c4,
                             contract_date="2026-01-01", description="x",
                             amount=1000.0))
w = CustomerFileWidget(None, cs.get_customer(_c4), open_page="contracts")
w.show()
_app.processEvents()
w._edit_contract_row = lambda row: None
w.cons_table.setCurrentCell(1, 0)
w._load_selected_contract_detail(silent=True)
_app.processEvents()
_before = (w.cons_table.currentRow(),
           getattr(w.contract_detail, "contract_id", None))
QTest.mouseClick(w.cons_table.cellWidget(0, 3), Qt.LeftButton,
                 Qt.NoModifier, QPoint(10, 10))
_app.processEvents()
_after = (w.cons_table.currentRow(),
          getattr(w.contract_detail, "contract_id", None))
check("نقرة تعديل حقيقية لا تنقل التحديد/العرض",
      _after == _before, f"{_before} -> {_after}")
QTest.mouseClick(w.cons_table.viewport(), Qt.LeftButton, Qt.NoModifier,
                 w.cons_table.visualItemRect(w.cons_table.item(2, 0)).center())
_app.processEvents()
_shown = getattr(w.contract_detail, "contract_id", None)
check("النقر على الصف ما زال يعرض عقده",
      _shown == w._visible_contracts[2]["id"], str(_shown))

print(f"\nV4.0 pledge_wins: PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
