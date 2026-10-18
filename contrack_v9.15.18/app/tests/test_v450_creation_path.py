# -*- coding: utf-8 -*-
"""V4.50: اختيار المسار عند الإنشاء + تنزيل الدفعات + الشارات + البوابة.

يغطي: صندوق المسار (ظهور/اخفاء حسب النوع) · ترشيح المعاينة
بالمختار + زر التنزيل + تعبئة القيمة · حفظ يدوي بلا دفعات مع
العلَم · شارات المسار (يدوي/إجباري/إشراف) · عمود إجمالي الملف +
صندوق شرح التسديد · ستايل مؤشرات الشجرة.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service  # noqa: E402
from services import settlement_service as st  # noqa: E402
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


from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

cts.add_type("T450")
s1 = wf.add_stage("contract", "مرحلة أولى", contract_type="T450")
s2 = wf.add_stage("contract", "مرحلة ثانية", contract_type="T450")
with get_connection() as _c:
    _c.execute(
        "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
        " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
        ("T450", 1, "دفعة 1", 0, 100.0, s1))
    _c.execute(
        "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
        " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
        ("T450", 2, "دفعة 2", 0, 50.0, s2))
cts.add_type("بلا قالب 450")
cts.add_type("إشراف 450", is_supervision=True)
cts.add_type("شامل 450", pricing_mode="bundle")
cust = customer_service.add_customer(Customer(
    customer_code="C-450", name="عميل 450", phone="90000450"))
cust2 = customer_service.add_customer(Customer(
    customer_code="C-451", name="عميل 451", phone="90000451"))

from ui.contracts import ContractDialog  # noqa: E402

print("=== 1. بلا صندوق مسار (V4.56) ===")
dlg = ContractDialog()
dlg.ctype.setCurrentIndex(dlg.ctype.findData("T450"))
app.processEvents()
check("لا صندوق مسار",
      not hasattr(dlg, "_path_box"))
# V4.5.13: النوع «التلقائي» لا يعرض سحب البنود/الدفعات إطلاقًا
# V4.5.14: التلقائي = نطاق مخفي + جدول القالب ظاهر (تعديل مبالغ)
check("التلقائي: النطاق مخفي وجدول القالب ظاهر (V4.5.14)",
      dlg._scope_box.isHidden() and not dlg._plan_box.isHidden()
      and not dlg.plan_summary_link.isHidden())
dlg.ctype.setCurrentIndex(dlg.ctype.findData("بلا قالب 450"))
app.processEvents()
check("النطاق مخفي بلا شجرة", dlg._scope_box.isHidden())

# ---- V4.5.13: واجهة التنزيل صارت للنوع «اليدوي» — نحوّل T450 يدويًا ----
_t450v13 = [t for t in cts.list_types(active_only=False)
            if t["name"] == "T450"][0]
cts.update_type(_t450v13["id"], "T450", _t450v13["default_amount"],
                _t450v13["notes"] or "",
                unit_label=_t450v13.get("unit_label") or "",
                unit_price=_t450v13.get("unit_price") or 0.0,
                pricing_mode=_t450v13.get("pricing_mode") or "",
                is_supervision=bool(_t450v13.get("is_supervision")),
                manual_track=True)
dlg = ContractDialog()
dlg.ctype.setCurrentIndex(dlg.ctype.findData("T450"))
app.processEvents()
check("اليدوي: النطاق والخطة ظاهران",
      not dlg._scope_box.isHidden()
      and not dlg._plan_box.isHidden()
      and dlg.plan_table.rowCount() == 2)
dlg._set_scope_all(False)
dlg._apply_scope_to_plan()
app.processEvents()
from ui import style as _st56  # noqa: E402
_errs56 = []
_orig_err56 = _st56.error
_st56.error = lambda *a, **k: _errs56.append(a[1] if len(a) > 1 else "")
from PySide6.QtWidgets import QTableWidgetItem as _QTWI56
try:
    dlg.customer.select_data(cust)
    dlg.number.setText("CON-450X")
    dlg.amount.setValue(500.0)
    dlg.items_table.setRowCount(1)
    dlg.items_table.setItem(0, 0, _QTWI56("بند اختبار"))
    dlg.items_table.setItem(0, 1, _QTWI56("500"))
    dlg._save()
    app.processEvents()
finally:
    _st56.error = _orig_err56
    dlg.items_table.setRowCount(0)
    dlg.amount.setValue(0)
with get_connection() as _c:
    _none56 = _c.execute(
        "SELECT COUNT(*) FROM contracts WHERE contract_number=?",
        ("CON-450X",)).fetchone()[0]
# V4.5.13: الرفض يسبقه حارس النطاق (اليدوي) أو رسالة المراحل — كلاهما رفض
check("الحفظ مرفوض بلا خطة",
      _none56 == 0 and any(("بلا مراحل" in e) or ("اختر تصنيفًا" in e)
                           for e in _errs56), _errs56)
dlg._set_scope_all(True)
dlg._apply_scope_to_plan()
dlg.amount.setValue(0)      # ليختبر القسم 2 تعبئة القيمة من المختار
app.processEvents()

print("=== 2. التنزيل من المختار ===")
dlg.scope_tree.topLevelItem(1).setCheckState(0, Qt.Unchecked)
app.processEvents()
check("سطر التنبيه ظهر", not dlg._scope_stale.isHidden())
check("المعاينة لم تتغير قبل التنزيل", dlg.plan_table.rowCount() == 2)
dlg._apply_scope_to_plan()
app.processEvents()
check("صف واحد موسوم من المختار",
      dlg.plan_table.rowCount() == 1
      and "من المختار" in dlg.plan_auto_lbl.text()
      and dlg._scope_stale.isHidden(),
      dlg.plan_auto_lbl.text())
check("القيمة اتعبّت 100",
      abs(dlg.amount.value() - 100.0) < 0.001, dlg.amount.value())
dlg._set_scope_all(False)
dlg._apply_scope_to_plan()
app.processEvents()
check("فارغ + تلميح",
      dlg.plan_table.rowCount() == 0
      and "لا مراحل مختارة" in dlg.plan_hint.text())
dlg._set_scope_all(True)
dlg._apply_scope_to_plan()
app.processEvents()
check("رجع الكل", dlg.plan_table.rowCount() == 2)

print("=== 3. حفظ يدوي من النوع (V4.56) ===")
_t450 = [t for t in cts.list_types(active_only=False)
        if t["name"] == "T450"][0]
cts.update_type(_t450["id"], "T450", _t450["default_amount"],
                _t450["notes"] or "",
                unit_label=_t450.get("unit_label") or "",
                unit_price=_t450.get("unit_price") or 0.0,
                pricing_mode=_t450.get("pricing_mode") or "",
                is_supervision=bool(_t450.get("is_supervision")),
                manual_track=True)
dlg.customer.select_data(cust)
dlg.number.setText("CON-450M")
dlg.amount.setValue(150.0)
dlg._save()
app.processEvents()
with get_connection() as _c:
    _m = _c.execute(
        "SELECT id, manual_path FROM contracts WHERE contract_number=?",
        ("CON-450M",)).fetchone()
    _mpay = _c.execute("SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
                       (_m["id"],)).fetchone()[0]
    _mst = _c.execute("SELECT COUNT(*) FROM contract_stages WHERE contract_id=?",
                      (_m["id"],)).fetchone()[0]
check("العلم = 1 والخطة مبنية والمراحل منسوخة",
      _m["manual_path"] == 1 and _mpay == 2 and _mst == 2,
      (_m["manual_path"], _mpay, _mst))

print("=== 4. التلقائي: القالب كاملًا بلا اختيار (V4.5.13) ===")
cts.update_type(_t450["id"], "T450", _t450["default_amount"],
                _t450["notes"] or "",
                unit_label=_t450.get("unit_label") or "",
                unit_price=_t450.get("unit_price") or 0.0,
                pricing_mode=_t450.get("pricing_mode") or "",
                is_supervision=bool(_t450.get("is_supervision")),
                manual_track=False)
dlg2 = ContractDialog()
dlg2.ctype.setCurrentIndex(dlg2.ctype.findData("T450"))
app.processEvents()
check("التلقائي: بلا نطاق ومع جدول قالب (V4.5.14)",
      dlg2._scope_box.isHidden() and not dlg2._plan_box.isHidden())
dlg2.customer.select_data(cust2)
dlg2.number.setText("CON-450S")
dlg2.amount.setValue(150.0)
dlg2._save()
app.processEvents()
with get_connection() as _c:
    _s = _c.execute(
        "SELECT id, manual_path FROM contracts WHERE contract_number=?",
        ("CON-450S",)).fetchone()
    _spay = _c.execute("SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
                       (_s["id"],)).fetchone()[0]
check("حُفظ بالقالب كاملًا (دفعتان) وبلا علم",
      _s["manual_path"] == 0 and _spay == 2, (_s["manual_path"], _spay))

print("=== 5. الشارات ===")
from ui.followup import FollowupPanel  # noqa: E402

p1 = FollowupPanel(None, wf.TX_CONTRACT, _m["id"],
                   show_chat=False, show_history=False)
app.processEvents()
check("شارة اليدوي", p1._path_badge() == "🔧 مسار يدوي · ")
p2 = FollowupPanel(None, wf.TX_CONTRACT, _s["id"],
                   show_chat=False, show_history=False)
app.processEvents()
check("شارة الإجباري", p2._path_badge() == "📏 مسار إجباري · ")
_sup_id = cs.add_contract(Contract(
    contract_number="CON-450U", customer_id=cust,
    contract_date="2026-09-30", contract_type="إشراف 450", amount=300.0))
p3 = FollowupPanel(None, wf.TX_CONTRACT, _sup_id,
                   show_chat=False, show_history=False)
app.processEvents()
check("شارة طابع الإشراف",
      p3._path_badge() == "🔧 طابع يدوي — إشراف · ", p3._path_badge())
with get_connection() as _c:
    _sup_flag = _c.execute("SELECT manual_path FROM contracts WHERE id=?",
                           (_sup_id,)).fetchone()[0]
check("الإشراف بلا علم فعلي", _sup_flag == 0)

print("=== 6. البوابة: الإجمالي للمعرفة ===")
st.save_profile(None, "H450", "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops("H450", [
    {"date": "2026-09-10", "phone": "96660001", "amount": 100.0,
     "ref": "GA", "status": "other"}], "f.csv")
st.distribute_rows("H450", [("2026-09-10", "96660001", 100.0, "GA")])
_got = {r["ref"]: r for r in st.unpaid_other_items()}
check("مفتاح الإجمالي = مبلغ الملف",
      _got["GA"]["gross"] == 100.0 and _got["GA"]["total"] == 99.85,
      _got["GA"])
from ui.due_items_page import DueItemsPage  # noqa: E402

dp = DueItemsPage()
check("10 أعمدة وإجمالي الملف@9",
      dp.table.columnCount() == 10
      and dp.table.horizontalHeaderItem(9).text() == "إجمالي الملف"
      and dp.table.item(0, 9).text() == "100.000")
_gids = st.op_ids_for("H450", [("2026-09-10", "96660001", 100.0, "GA")])
_bd = st.linked_ops_breakdown(_gids)
check("صندوق الشرح: 100 − 0.150 = 99.85",
      _bd == {"n": 1, "gross": 100.0, "fee": 0.15, "net": 99.85}, _bd)
from ui.clearing_page import TransferDialog  # noqa: E402

td = TransferDialog(None, amount_preset=99.85, op_ids=_gids)
check("نافذة التسديد تعرض التفصيل",
      any("إجمالي الملف" in (w.text() or "") and "99.850" in (w.text() or "")
          for w in td.findChildren(type(dp.totals))),
      [w.text() for w in td.findChildren(type(dp.totals))][:3])

print("=== 7. ستايل الشجرة ===")
from ui import style as _style  # noqa: E402

_sheet = ""
try:
    _sheet = _style.main_stylesheet() or ""
except Exception:
    try:
        _sheet = _style.stylesheet() or ""
    except Exception:
        _sheet = ""
if not _sheet:
    import inspect as _insp
    _src = _insp.getsource(_style)
    _sheet = _src
check("مؤشرات ثلاثية مميزة",
      "#scopeTree::indicator:checked" in _sheet
      and "#scopeTree::indicator:indeterminate" in _sheet
      and "#scopeTree::indicator:unchecked" in _sheet)
check("اسم الشجرة للستايل", dlg.scope_tree.objectName() == "scopeTree")

print("=== 8. التعديل (انحدار V4.51) ===")
# استثناءات الـslots تُبتلَع في Qt وتُطبع على stderr — نلتقطه للحكم.
import contextlib as _ctx
import io as _io

_con_s = cs.get_contract(_s["id"])
_buf = _io.StringIO()
with _ctx.redirect_stderr(_buf):
    dlg_e = ContractDialog(contract=_con_s)
    app.processEvents()
    dlg_e.ctype.setCurrentIndex(dlg_e.ctype.findData("بلا قالب 450"))
    app.processEvents()
    dlg_e.ctype.setCurrentIndex(dlg_e.ctype.findData("T450"))
    app.processEvents()
    _con_m = cs.get_contract(_m["id"])
    dlg_em = ContractDialog(contract=_con_m)
    app.processEvents()
_err = _buf.getvalue()
check("بناء التعديل وتبديل النوع بلا استثناء مبتلَع",
      "Traceback" not in _err and "Error" not in _err, _err[-200:])
check("V4.56: لا صندوق مسار في التعديل",
      not hasattr(dlg_e, "_path_box"))
check("V4.56: تعديل اليدوي بلا صندوق مسار",
      not hasattr(dlg_em, "_path_box"))

print("")
print(f"V4.50 creation-path: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
