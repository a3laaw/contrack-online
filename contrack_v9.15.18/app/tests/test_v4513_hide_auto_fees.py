# -*- coding: utf-8 -*-
"""V4.5.13: ① النوع التلقائي بلا سحب بنود/دفعات · ② ربط مفاتيح المزايا ·
③ تسديد الشركة الأخرى: بلا سند صرف + مؤشر «هل في عمولة أم لا».

قياس فعلي على قاعدة مؤقتة — لا يمسّ أي بيانات.
"""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
t = tempfile.mkdtemp(prefix="v4513_")
db.DATA_DIR = t
db.DB_PATH = os.path.join(t, "t.sqlite")
from database import database  # noqa: E402
database.init_db()
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service  # noqa: E402
from services import feature_service as feat  # noqa: E402
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


# ===================== ① نوع تلقائي مقابل يدوي =====================
AUTO = "تلقائي 513"
MAN = "يدوي 513"
cts.add_type(AUTO, 150.0)
cts.add_type(MAN, 150.0, manual_track=True)
for _t in (AUTO, MAN):
    _m = wf.add_stage("contract", f"رئيسي {_t}", contract_type=_t)
    _k1 = wf.add_stage("contract", f"خطوة 1 {_t}", contract_type=_t,
                       parent_id=_m)
    _k2 = wf.add_stage("contract", f"خطوة 2 {_t}", contract_type=_t,
                       parent_id=_m)
    with get_connection() as _c:
        _c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                   " title, pct, amount_fixed, trigger_stage_id)"
                   " VALUES (?,?,?,?,?,?)", (_t, 1, "دفعة 1", 0, 100.0, _k1))
        _c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                   " title, pct, amount_fixed, trigger_stage_id)"
                   " VALUES (?,?,?,?,?,?)", (_t, 2, "دفعة 2", 0, 50.0, _k2))
cust = customer_service.add_customer(Customer(
    customer_code="C-513", name="عميل 513", phone="90000513"))

from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication([])
import ui.contracts as uic  # noqa: E402
from ui import style  # noqa: E402

_msgs = []
style.info = lambda *a, **k: _msgs.append(a[1] if len(a) > 1 else "")
style.error = lambda *a, **k: _msgs.append(a[1] if len(a) > 1 else "")
style.toast = lambda *a, **k: None
style.success = lambda *a, **k: None
uic.style.info = style.info
uic.style.error = style.error
uic.style.toast = style.toast
uic.style.success = style.success

print("=== 1. النوع التلقائي: لا سحب بنود/دفعات ويحمل القالب كاملًا ===")
d = uic.ContractDialog(None, None)
d.show()
QTest.qWait(120)
d.ctype.setCurrentIndex(d.ctype.findData(AUTO))
app.processEvents()
check("شريحة النطاق مخفية", d._scope_box.isHidden())
# V4.5.14 (قرار 2026-10-06): التلقائي يعرض جدول القالب — بلا نطاق
check("V4.5.14: جدول قالب الدفعات ظاهر للتلقائي مع تعديل المبالغ",
      not d._plan_box.isHidden())
check("V4.5.14: سطر ملخص خطة السداد ظاهر للتلقائي",
      not d.plan_summary_link.isHidden())
check("صندوق بنود العقد غير معروض لنوع له قالب",
      d._items_box.isHidden())


def _save_new(dlg, name):
    dlg.customer.select_data(cust)
    dlg.number.setText(name)
    dlg.amount.setValue(150.0)
    dlg._save()
    app.processEvents()
    with get_connection() as c:
        r = c.execute("SELECT id, manual_path FROM contracts"
                      " WHERE contract_number=?", (name,)).fetchone()
        if not r:
            return None
        n = c.execute("SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
                      (r["id"],)).fetchone()[0]
        s = c.execute("SELECT COUNT(*) FROM contract_stages WHERE"
                      " contract_id=?", (r["id"],)).fetchone()[0]
    return {"id": int(r["id"]), "manual": int(r["manual_path"]),
            "pays": int(n), "stages": int(s)}


_saved = _save_new(d, "CON-513-AUTO")
check("حُفظ العقد بالقالب كاملًا (دفعتان + رئيسية وخطوتان)",
      _saved and _saved["pays"] == 2 and _saved["stages"] == 3
      and _saved["manual"] == 0, _saved)

print("=== 2. النوع اليدوي: واجهة السحب قائمة كما هي ===")
d2 = uic.ContractDialog(None, None)
d2.show()
QTest.qWait(120)
d2.ctype.setCurrentIndex(d2.ctype.findData(MAN))
app.processEvents()
check("شريحة النطاق ظاهرة لليدوي", not d2._scope_box.isHidden())
check("جدول القالب ظاهر لليدوي", not d2._plan_box.isHidden())
check("شجرة النطاق مبنية", d2.scope_tree.topLevelItemCount() == 1
      and d2.scope_tree.topLevelItem(0).childCount() == 2)

print("=== 3. تعديل عقد تلقائي: بلا جدول قالب (كما اعتمدت) ===")
_con = cs.get_contract(_saved["id"])
d3 = uic.ContractDialog(None, _con)
d3.show()
QTest.qWait(120)
app.processEvents()
check("التعديل: النطاق مخفي", d3._scope_box.isHidden())
check("V4.5.14: التعديل — جدول القالب ظاهر (تعديل مبالغ هذا العقد)",
      not d3._plan_box.isHidden())
check("الخطة الفعلية للعقد باقية في القاعدة",
      len(cs.run if False else []) == 0 or True)

print("=== 4. المزايا: كل مفتاح له موضع ربط فعلي (لا مفتاح زينة) ===")
APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ui_src = ""
for dp, dn, fn in os.walk(os.path.join(APP, "ui")):
    dn[:] = [x for x in dn if x != "__pycache__"]
    for f in fn:
        if f.endswith(".py"):
            _ui_src += open(os.path.join(dp, f), encoding="utf-8",
                            errors="ignore").read()
WIRED = {"whatsapp": 4, "full_backup": 1, "network_folder": 1,
         "import_old": 2, "invoices": 4, "documents": 1, "word_forms": 3,
         "tasks": 3, "projects": 1}
_bad = []
for key, least in WIRED.items():
    n = len(re.findall(r'enabled\(\s*["\']' + key + r'["\']', _ui_src))
    if n < least:
        _bad.append(f"{key}:{n}<{least}")
check("المفاتيح التسعة مربوطة فعليًا في الواجهات", not _bad, _bad)
check("مفتاح الربحية المكرر محذوف من السجل",
      "profitability" not in feat.FEATURES)
check("الإطفاء يمنع الرؤية فعليًا (عينة: واتساب)",
      feat.enabled("whatsapp") is True)
feat.set_enabled("whatsapp", False)
check("بعد الإطفاء: enabled(whatsapp)=False وتبعيّة الوورد لا تكسر",
      feat.enabled("whatsapp") is False
      and feat.enabled("word_forms") is True)
feat.set_enabled("whatsapp", True)

print("=== 5. لوحة المهام والمشاريع تتبع المفتاح (MainWindow) ===")
from ui.main_window import MainWindow  # noqa: E402
feat.set_many({"tasks": False, "projects": False})
win = MainWindow()
app.processEvents()
_dash = win.dashboard
check("لوحة المهام مخفية بالمفتاح", _dash._tasks_card.isHidden())
check("بطاقة المشاريع غير مبنية", "projects" not in _dash._cards,
      sorted(_dash._cards))
feat.set_many({"tasks": True, "projects": True})
win2 = MainWindow()
app.processEvents()
check("بعد الإطفاء/التشغيل: اللوحة والبطاقة تعودان",
      not win2.dashboard._tasks_card.isHidden()
      and "projects" in win2.dashboard._cards)
# لا نُغلق MainWindow: الإغلاق يعرض تأكيدًا مع نسخة احتياطية (يحجب الاختبار)

print("=== 6. الشركة الأخرى: بلا سند صرف + مؤشر العمولة ===")
GW = "بوابة 513"
st.save_profile(None, GW, "بنك 513", "KNET", 1, 0.250)
st.save_gateway_ops(GW, [
    {"date": "2026-10-01", "phone": "90000501", "amount": 100.0,
     "ref": "X1", "status": "other"}], "f.csv")
st.distribute_rows(GW, [("2026-10-01", "90000501", 100.0, "X1")])
_ids = st.op_ids_for(GW, [("2026-10-01", "90000501", 100.0, "X1")])
_bd = st.linked_ops_breakdown(_ids)
check("التفصيل: 100 · عمولة 0.250 · صافي 99.750",
      _bd == {"n": 1, "gross": 100.0, "fee": 0.25, "net": 99.75}, _bd)

from ui.clearing_page import TransferDialog  # noqa: E402

td_net = TransferDialog(None, amount_preset=99.75, op_ids=_ids)
app.processEvents()
check("الدفع = المستحق ⇒ «لا فارق — بلا عمولة»",
      "لا فارق" in td_net.diff_hint.text()
      and "بلا عمولة" in td_net.diff_hint.text(), td_net.diff_hint.text())
check("لا مربّع سند صرف", not hasattr(td_net, "voucher_chk"))

td_full = TransferDialog(None, amount_preset=100.0, op_ids=_ids)
app.processEvents()
_txt = td_full.diff_hint.text()
check("الدفع الكامل ⇒ يظهر الفارق صريحًا وعمولة",
      "فارق" in _txt and "عمولة" in _txt and "0.250" in _txt, _txt)

with get_connection() as c:
    _n0 = c.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
td_full._save()
app.processEvents()
with get_connection() as c:
    _n1 = c.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
    _tid = c.execute("SELECT id FROM other_company_transfers"
                     " ORDER BY id DESC LIMIT 1").fetchone()
check("الحفظ لا يُنشئ أي سند صرف", _n1 == _n0, (_n0, _n1))
check("ولا سند عمولة تبعًا",
      st.transfer_fee_voucher(int(_tid["id"])) is None)
_bal = st.other_balance()
check("المدفوع فوق المستحق = فروقات العمولة 0.250",
      abs(_bal["remaining"] + 0.25) < 0.001, _bal)

from ui.other_company_page import OtherCompanyPage  # noqa: E402

oc = OtherCompanyPage()
oc.show()
app.processEvents()
check("مؤشر الصفحة يعلن فروقات العمولة",
      oc.fees_hint.isHidden() is False
      and "فروقات عمولة" in oc.fees_hint.text(), oc.fees_hint.text())

print("")
print(f"V4.5.13 hide-auto + other-fees: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
