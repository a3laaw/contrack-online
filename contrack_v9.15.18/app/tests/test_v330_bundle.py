# -*- coding: utf-8 -*-
"""V3.30: العقد الشامل — مكوّنات النطاق + البناء المفلتر للمسار."""
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

from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication(sys.argv)

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui import style as _style  # noqa: E402
from ui.contracts import ContractDialog  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== 1. النوع الشامل ومكوّناته ===")
cts.add_type("شامل", pricing_mode="bundle")
check("النمط شامل", cts.type_config("شامل").get("is_bundle") is True)
try:
    cts.add_type("شامل إشرافي", pricing_mode="bundle", is_supervision=True)
    check("الشامل لا يقبل علامة إشراف", False)
except Exception as exc:
    check("الشامل لا يقبل علامة إشراف", "مكوّنًا" in str(exc), str(exc))
cts.save_bundle_components("شامل", [
    {"label": "واجهات", "kind": "qty", "default_enabled": True,
     "default_qty": 2, "unit_label": "واجهة", "ref_price": 150.0},
    {"label": "إشراف", "kind": "supervision", "default_enabled": True,
     "default_months": 6, "default_monthly": 200.0},
    {"label": "كهرباء", "kind": "items", "default_enabled": False},
])
_comps = {c["label"]: c for c in cts.list_bundle_components("شامل")}
check("3 مكوّنات بمفاتيح", len(_comps) == 3
      and all(_comps[k]["comp_key"] for k in _comps), str(_comps.keys()))
_FK, _SK, _EK = (_comps["واجهات"]["comp_key"], _comps["إشراف"]["comp_key"],
                 _comps["كهرباء"]["comp_key"])

print("=== 2. القالب الموسوم ===")
_m1 = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="شامل")
wf.add_stage(wf.TX_CONTRACT, "تصميم", contract_type="شامل", parent_id=_m1)
wf.add_stage(wf.TX_CONTRACT, "تنفيذ واجهات", contract_type="شامل",
             parent_id=_m1, component_key=_FK)
wf.add_stage(wf.TX_CONTRACT, "إشراف ميداني", contract_type="شامل",
             parent_id=_m1, component_key=_SK, is_supervision=True,
             sup_monthly=200.0)
wf.add_stage(wf.TX_CONTRACT, "تمديدات كهرباء", contract_type="شامل",
             parent_id=_m1, component_key=_EK)
_m2 = wf.add_stage(wf.TX_CONTRACT, "ملحق الواجهات", contract_type="شامل",
                   component_key=_FK)
wf.add_stage(wf.TX_CONTRACT, "تشطيب واجهات", contract_type="شامل",
             parent_id=_m2, component_key=_FK)
_tpl = wf.get_stages(wf.TX_CONTRACT, "شامل")
check("القالب كامل (7)", len(_tpl) == 7, str(len(_tpl)))

print("=== 3. الإنشاء: المطفأ غائب والإجمالي مقطوع ===")
_c1 = cs.add_customer(Customer(customer_code="C-301", name="عميل شامل",
                              phone="55301222"))
k1 = ks.add_contract(Contract(contract_number="K-301", customer_id=_c1,
                              contract_date="2026-01-01",
                              description="عقد", amount=750.0,
                              contract_type="شامل"),
                     components=[
                         {"comp_key": _FK, "label": "واجهات", "kind": "qty",
                          "enabled": True, "qty": 2},
                         {"comp_key": _SK, "label": "إشراف",
                          "kind": "supervision", "enabled": True,
                          "months": 6, "monthly": 200.0},
                         {"comp_key": _EK, "label": "كهرباء",
                          "kind": "items", "enabled": False}])
_names1 = [s["name"] for s in wf.get_contract_stages(k1)]
check("الكهرباء غائبة نهائيًا",
      "تمديدات كهرباء" not in _names1
      and "تنفيذ واجهات" in _names1
      and "إشراف ميداني" in _names1, str(_names1))
check("الملحق الواجهات حاضر",
      "ملحق الواجهات" in _names1 and "تشطيب واجهات" in _names1)
check("الجارية أول أساسية",
      wf.get_current_stage(wf.TX_CONTRACT, k1)["stage_name"] == "تصميم")
with db.get_connection() as _c:
    _amt = _c.execute("SELECT amount FROM contracts WHERE id=?",
                      (k1,)).fetchone()[0]
check("الإجمالي كما كُتب (750)", float(_amt) == 750.0, str(_amt))
_snap1 = {c["comp_key"]: c for c in ks.get_contract_components(k1)}
check("اللقطة محفوظة", len(_snap1) == 3
      and _snap1[_FK]["qty"] == 2 and _snap1[_SK]["months"] == 6
      and not _snap1[_EK]["enabled"])

print("=== 4. العنوان اليتيم يُحذف ولا يتحول لخطوة ===")
_c2 = cs.add_customer(Customer(customer_code="C-302", name="عميل بلا واجهات",
                              phone="55302222"))
k2 = ks.add_contract(Contract(contract_number="K-302", customer_id=_c2,
                              contract_date="2026-01-01",
                              description="عقد", amount=500.0,
                              contract_type="شامل"),
                     components=[
                         {"comp_key": _FK, "label": "واجهات", "kind": "qty",
                          "enabled": False, "qty": 0},
                         {"comp_key": _SK, "label": "إشراف",
                          "kind": "supervision", "enabled": True,
                          "months": 6, "monthly": 200.0},
                         {"comp_key": _EK, "label": "كهرباء",
                          "kind": "items", "enabled": False}])
_names2 = [s["name"] for s in wf.get_contract_stages(k2)]
check("لا واجهات ولا ملحق",
      "تنفيذ واجهات" not in _names2
      and "ملحق الواجهات" not in _names2
      and "تشطيب واجهات" not in _names2, str(_names2))
_lvls = {s["name"]: s["level"] for s in wf.get_contract_stages(k2)}
check("التنفيذ عنوان والتصميم خطوة",
      _lvls.get("التنفيذ") == 0 and _lvls.get("تصميم") == 1, str(_lvls))

print("=== 5. السحب يحترم المكوّنات ===")
wf.add_stage(wf.TX_CONTRACT, "اختبار كهرباء", contract_type="شامل",
             parent_id=_m1, component_key=_EK)
wf.add_stage(wf.TX_CONTRACT, "صيانة واجهات", contract_type="شامل",
             parent_id=_m1, component_key=_FK)
_pv = wf.preview_missing_stages(k1)
check("المطفأ لا يُسحب",
      [m["name"] for m in _pv["missing"]] == ["صيانة واجهات"],
      str([m["name"] for m in _pv["missing"]]))
ks.save_contract_components(k1, [
    {"comp_key": _FK, "label": "واجهات", "kind": "qty", "enabled": True,
     "qty": 2},
    {"comp_key": _SK, "label": "إشراف", "kind": "supervision",
     "enabled": True, "months": 6, "monthly": 200.0},
    {"comp_key": _EK, "label": "كهرباء", "kind": "items", "enabled": True}])
_pv2 = wf.preview_missing_stages(k1)
check("بعد التفعيل يُسحبان",
      sorted(m["name"] for m in _pv2["missing"])
      == ["اختبار كهرباء", "تمديدات كهرباء", "صيانة واجهات"],
      str([m["name"] for m in _pv2["missing"]]))
_rep = wf.pull_missing_stages(k1)
check("السحب أدخل الكهرباء",
      "تمديدات كهرباء" in _rep["inserted"]
      and "اختبار كهرباء" in [s["name"]
                              for s in wf.get_contract_stages(k1)])
check("غير الشامل بلا فلتر",
      wf._enabled_bundle_keys(k1, "تصميم") is None)

print("=== 6. النافذة: بطاقات + حفظ ===")
_errs, _confs = [], []
_orig_err, _orig_conf = _style.error, _style.confirm
_style.error = lambda *a, **k: _errs.append(a[1] if len(a) > 1 else "")
_style.confirm = lambda *a, **k: (_confs.append(1), True)[1]
try:
    d = ContractDialog(None)
    d.show()
    _app.processEvents()
    d.customer.select_data(_c1)
    d.ctype.setCurrentIndex(d.ctype.findData("شامل"))
    _app.processEvents()
    check("صندوق المكوّنات ظاهر", d._bundle_box.isVisible())
    check("3 بطاقات", len(d._bundle_cards) == 3,
          str(len(d._bundle_cards)))
    check("البنود مخفية (كهرباء مطفأة)",
          d._items_box.isHidden())
    check("الخطة ظاهرة للشامل", d._plan_box.isVisible())
    check("المبلغ قابل للكتابة", not d.amount.isReadOnly())
    # فعّل الكهرباء ← جدول البنود يظهر
    for _card in d._bundle_cards:
        if _card["kind"] == "items":
            _card["chk"].setChecked(True)
    _app.processEvents()
    check("تفعيل البنود يُظهر الجدول", d._items_box.isVisible())
    d.number.setText("K-303")
    d.amount.setValue(900.0)
    d._save()
    _app.processEvents()
    with db.get_connection() as _c:
        _k3 = _c.execute("SELECT id, amount FROM contracts "
                         "WHERE contract_number='K-303'").fetchone()
    check("الحفظ نجح بلا نوافذ", _k3 is not None and not _errs,
          str(_errs[:1]))
    _names3 = [s["name"] for s in wf.get_contract_stages(_k3[0])]
    check("المسار مفلتر (الكهرباء حاضرة الآن)",
          "تمديدات كهرباء" in _names3, str(_names3))
    check("المبلغ المكتوب محفوظ", float(_k3[1]) == 900.0)
    # وضع التعديل: للعرض فقط
    de = ContractDialog(None, ks.get_contract(_k3[0]))
    de.show()
    _app.processEvents()
    check("التعديل يعرض اللقطة",
          de._bundle_box.isVisible() and len(de._bundle_cards) == 3)
    check("البطاقات مقفلة في التعديل",
          all(not c["chk"].isEnabled() for c in de._bundle_cards))
finally:
    _style.error, _style.confirm = _orig_err, _orig_conf

print(f"\nV3.30 BUNDLE: PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
