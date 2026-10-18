# -*- coding: utf-8 -*-
"""V4.1: بطاقة الإشراف مصدر التعهد الوحيد للشامل — لا صندوق ولا ازدواج."""
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

from PySide6.QtWidgets import QApplication, QDialog  # noqa: E402

_app = QApplication.instance() or QApplication(sys.argv)

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import supervision_service as sup  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui import followup as fu  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402
from ui.contracts import ContractDialog  # noqa: E402
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


cts.add_type("شامل41", pricing_mode="bundle")
cts.save_bundle_components("شامل41", [
    {"label": "واجهات", "kind": "qty", "default_enabled": True,
     "default_qty": 2, "unit_label": "واجهة", "ref_price": 150.0},
    {"label": "إشراف", "kind": "supervision", "default_enabled": True,
     "default_months": 6, "default_monthly": 200.0},
])
_m1 = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="شامل41")
wf.add_stage(wf.TX_CONTRACT, "بداية تعهد الإشراف", contract_type="شامل41",
             parent_id=_m1, is_supervision=True)
wf.add_stage(wf.TX_CONTRACT, "تنفيذ", contract_type="شامل41", parent_id=_m1)
wf.add_stage(wf.TX_CONTRACT, "انهاء الاشراف", contract_type="شامل41",
             parent_id=_m1, is_supervision=True)
cts.add_type("تصميم41")
_m2 = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="تصميم41")
wf.add_stage(wf.TX_CONTRACT, "بداية تعهد الإشراف", contract_type="تصميم41",
             parent_id=_m2, is_supervision=True)

_c1 = cs.add_customer(Customer(customer_code="C-411", name="عميل شامل",
                               phone="55411222"))


def _sup_card(dlg):
    for c in dlg._bundle_cards:
        if c["kind"] == "supervision":
            return c
    return None


_errs, _confs = [], []
_orig_err, _orig_conf = _style.error, _style.confirm
_style.error = lambda *a, **k: _errs.append(a[1] if len(a) > 1 else "")
_style.confirm = lambda *a, **k: (_confs.append(1), True)[1]
try:
    print("=== 1. الصندوق مخفي للشامل ظاهر لغيره ===")
    d = ContractDialog(None)
    d.show()
    _app.processEvents()
    d.customer.select_data(_c1)
    d.ctype.setCurrentIndex(d.ctype.findData("شامل41"))
    _app.processEvents()
    check("الشامل: الصندوق مخفي والبطاقات ظاهرة",
          d._sup_box.isHidden() and d._bundle_box.isVisible()
          and _sup_card(d) is not None)
    d.ctype.setCurrentIndex(d.ctype.findData("تصميم41"))
    _app.processEvents()
    check("غير الشامل: الصندوق ظاهر (لا انحدار)",
          d._sup_box.isVisible())
    d.close()

    print("=== 2. الإنشاء: البطاقة تفعّل التعهد ===")
    _errs.clear()
    d2 = ContractDialog(None)
    d2.show()
    _app.processEvents()
    d2.customer.select_data(_c1)
    d2.ctype.setCurrentIndex(d2.ctype.findData("شامل41"))
    _app.processEvents()
    _sc = _sup_card(d2)
    _sc["chk"].setChecked(True)
    _sc["months"].setValue(6)
    _sc["monthly"].setValue(200.0)
    d2.number.setText("K-411")
    d2.amount.setValue(750.0)
    d2._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k = _c.execute("SELECT id, amount, sup_months, sup_monthly "
                        "FROM contracts WHERE contract_number='K-411'"
                        ).fetchone()
    check("الحفظ نجح بلا نوافذ", _k is not None and not _errs,
          str(_errs[:1]))
    check("التعهد من البطاقة والقيمة intact",
          _k is not None and int(_k[2]) == 6 and float(_k[3]) == 200.0
          and float(_k[1]) == 750.0, str(tuple(_k)) if _k else "missing")
    check("البوابة مفتوحة للمرحلة المسماة",
          _k is not None and fu._should_ask_supervision_start(
              _k[0], "بداية تعهد الإشراف", True) is True)
    d2.close()

    print("=== 3. المطفأ بلا تعهد والناقص مرفوض ===")
    _errs.clear()
    d3 = ContractDialog(None)
    d3.show()
    _app.processEvents()
    d3.customer.select_data(_c1)
    d3.ctype.setCurrentIndex(d3.ctype.findData("شامل41"))
    _app.processEvents()
    _sup_card(d3)["chk"].setChecked(False)
    d3.number.setText("K-413")
    d3.amount.setValue(750.0)
    d3._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k3 = _c.execute("SELECT id, sup_months FROM contracts "
                         "WHERE contract_number='K-413'").fetchone()
    check("المطفأ يُحفظ بلا تعهد",
          _k3 is not None and int(_k3[1] or 0) == 0 and not _errs,
          str(_errs[:1]) if _errs else "")
    d3.close()
    _errs.clear()
    d4 = ContractDialog(None)
    d4.show()
    _app.processEvents()
    d4.customer.select_data(_c1)
    d4.ctype.setCurrentIndex(d4.ctype.findData("شامل41"))
    _app.processEvents()
    _sc4 = _sup_card(d4)
    _sc4["chk"].setChecked(True)
    _sc4["months"].setValue(6)
    _sc4["monthly"].setValue(0.0)
    d4.number.setText("K-414")
    d4.amount.setValue(750.0)
    d4._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k4 = _c.execute("SELECT id FROM contracts "
                         "WHERE contract_number='K-414'").fetchone()
    check("شهري صفر مرفوض ولا يُحفظ",
          _k4 is None and any("قيمة الشهر" in e for e in _errs),
          str(_errs[:1]))
    d4.close()

    print("=== 4. التعديل: تفعيل اللقطة لمرة واحدة ===")
    # عقد V3.30: لقطة بقيم بلا تعهد
    k5 = ks.add_contract(Contract(contract_number="K-415", customer_id=_c1,
                                  contract_date="2026-01-01",
                                  description="عقد", amount=750.0,
                                  contract_type="شامل41"),
                         components=[
                             {"comp_key": "m1", "label": "إشراف",
                              "kind": "supervision", "enabled": True,
                              "months": 6, "monthly": 200.0}])
    _errs.clear()
    de = ContractDialog(None, ks.get_contract(k5))
    de.show()
    _app.processEvents()
    check("التعديل: الصندوق مخفي أيضًا", de._sup_box.isHidden())
    de._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k5 = _c.execute("SELECT sup_months, sup_monthly, amount "
                         "FROM contracts WHERE id=?", (k5,)).fetchone()
    check("أول حفظ يفعّل التعهد من اللقطة",
          int(_k5[0]) == 6 and float(_k5[1]) == 200.0
          and float(_k5[2]) == 750.0 and not _errs,
          str(tuple(_k5)) if _k5 else "missing")
    de.close()

    print("=== 5. القائم لا يُكتب فوقه ===")
    k6 = ks.add_contract(Contract(contract_number="K-416", customer_id=_c1,
                                  contract_date="2026-01-01",
                                  description="عقد", amount=750.0,
                                  contract_type="شامل41"),
                         components=[
                             {"comp_key": "m1", "label": "إشراف",
                              "kind": "supervision", "enabled": True,
                              "months": 1, "monthly": 150.0}])
    sup.setup_supervision(k6, "", 6, 200.0, touch_amount=False)
    _errs.clear()
    de2 = ContractDialog(None, ks.get_contract(k6))
    de2.show()
    _app.processEvents()
    de2._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k6 = _c.execute("SELECT sup_months, sup_monthly FROM contracts "
                         "WHERE id=?", (k6,)).fetchone()
    check("حفظ المتعهد يُبقي 6×200 (لا 1×150)",
          int(_k6[0]) == 6 and float(_k6[1]) == 200.0 and not _errs,
          str(tuple(_k6)))
    de2.close()
finally:
    _style.error, _style.confirm = _orig_err, _orig_conf

print("=== 6. المركز يعبّئ من اللقطة ===")
_orig_exec = QDialog.exec
QDialog.exec = lambda self, *a, **k: 0
try:
    k7 = ks.add_contract(Contract(contract_number="K-417", customer_id=_c1,
                                  contract_date="2026-01-01",
                                  description="عقد", amount=900.0,
                                  contract_type="شامل41"),
                         components=[
                             {"comp_key": "m1", "label": "إشراف",
                              "kind": "supervision", "enabled": True,
                              "months": 4, "monthly": 120.0}])
    page = ContractHubPage(embedded=True)
    page.show()
    page.load_contract(k7)
    _app.processEvents()
    page._open_info_editor()
    _app.processEvents()
    check("التعبئة من البطاقة (4×120)",
          int(page.f_sup_months.value()) == 4
          and float(page.f_sup_monthly.value()) == 120.0)
    _saved = page._save_info()
    _app.processEvents()
    with db.get_connection() as _c:
        _k7 = _c.execute("SELECT sup_months, sup_monthly, amount "
                         "FROM contracts WHERE id=?", (k7,)).fetchone()
    check("حفظ المركز يفعّل التعهد بلا مساس بالقيمة",
          _saved and int(_k7[0]) == 4 and float(_k7[1]) == 120.0
          and float(_k7[2]) == 900.0, str(tuple(_k7)))
finally:
    QDialog.exec = _orig_exec

print(f"\nV4.1 bundle_pledge: PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
