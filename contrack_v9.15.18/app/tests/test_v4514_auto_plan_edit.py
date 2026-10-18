# -*- coding: utf-8 -*-
"""V4.5.14 (قرار 2026-10-06): ① النوع التلقائي يعرض جدول القالب أسفل شاشة
العقد مع تعديل مبالغ هذا العقد فقط · ② نافذة الدفعة: لا تُفرَّغ طريقة القيمة
(رزّي راديو) + تأكيد عند الحفظ بلا قيمة + عرض «مرنة (تُحدد لاحقًا)».

قياس فعلي على قاعدة مؤقتة — لا يمسّ أي بيانات.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
t = tempfile.mkdtemp(prefix="v4514_")
db.DATA_DIR = t
db.DB_PATH = os.path.join(t, "t.sqlite")
from database import database  # noqa: E402
database.init_db()
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service  # noqa: E402
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


# ================= الإعداد: نوع تلقائي بقالب =================
AUTO = "تلقائي 514"
cts.add_type(AUTO, 1000.0)
_m = wf.add_stage("contract", "رئيسي 514", contract_type=AUTO)
_k1 = wf.add_stage("contract", "خطوة 1", contract_type=AUTO, parent_id=_m)
_k2 = wf.add_stage("contract", "خطوة 2", contract_type=AUTO, parent_id=_m)
with get_connection() as _c:
    _c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title,"
               " pct, amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
               (AUTO, 1, "دفعة 1", 0, 400.0, _k1))
    _c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title,"
               " pct, amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
               (AUTO, 2, "دفعة 2", 0, 200.0, _k2))
cust = customer_service.add_customer(Customer(
    customer_code="C-514", name="عميل 514", phone="90000514"))

from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication([])
import ui.contracts as uic  # noqa: E402
from ui import style  # noqa: E402
from ui.type_workflow import PaymentEditDialog  # noqa: E402

# صمام أمان ضد أي نافذة مودالية غير متوقعة (تعود فورًا كـ«إلغاء»)
from PySide6.QtWidgets import QMessageBox as _QMB  # noqa: E402
_QMB.exec = lambda self: 0

_msgs = []
style.info = lambda *a, **k: _msgs.append(a[1] if len(a) > 1 else "")
style.error = lambda *a, **k: _msgs.append(a[1] if len(a) > 1 else "")
style.toast = lambda *a, **k: None
style.success = lambda *a, **k: None
style.warning = lambda *a, **k: None
uic.style.info = style.info
uic.style.error = style.error
uic.style.toast = style.toast
uic.style.success = style.success
# تأكيدات الحفظ: تُجاب تلقائيًا بـ«نعم» في هذا الاختبار (بلا نوافذ مودالية)
style.confirm = lambda *a, **k: True
style.confirm_financial = lambda *a, **k: True
uic.style.confirm = style.confirm
uic.style.confirm_financial = style.confirm_financial

print("=== 1. النوع التلقائي: جدول القالب ظاهر + المبالغ قابلة للتعديل ===")
d = uic.ContractDialog(None, None)
d.show()
QTest.qWait(120)
d.ctype.setCurrentIndex(d.ctype.findData(AUTO))
app.processEvents()
check("النطاق مخفي (كما اعتمدت)", d._scope_box.isHidden())
check("جدول القالب ظاهر", not d._plan_box.isHidden())
check("سطر الملخص ظاهر", not d.plan_summary_link.isHidden())
check("صفوف الجدول = دفعات القالب (2)", d.plan_table.rowCount() == 2,
      d.plan_table.rowCount())
_cell = d.plan_table.item(0, 3)
check("خلية «قيمة الدفعة» قابلة للتعديل",
      _cell is not None and bool(_cell.flags() & Qt.ItemIsEditable))
check("بقية الخلايا غير قابلة للتعديل",
      not (d.plan_table.item(0, 1).flags() & Qt.ItemIsEditable))

print("=== 2. تعديل المبلغ داخل الجدول ثم الحفظ ===")
d.customer.select_data(cust)
d.number.setText("CON-514-AUTO")
d.amount.setValue(850.0)
app.processEvents()
d.plan_table.item(0, 3).setText("650.000")
app.processEvents()
check("التجاوز سُجّل للدفعة 1 (650)",
      abs(float(d._plan_amount_overrides.get(1, 0)) - 650.0) < 0.001,
      d._plan_amount_overrides)
d._save()
app.processEvents()
with get_connection() as c:
    _r = c.execute("SELECT id, manual_path FROM contracts WHERE"
                   " contract_number=?", ("CON-514-AUTO",)).fetchone()
    _plan = c.execute("SELECT sort_order, amount FROM payment_plan WHERE"
                      " contract_id=? ORDER BY sort_order",
                      (_r["id"],)).fetchall()
check("حُفظ العقد بالقالب كاملًا (دفعتان)",
      _r is not None and len(_plan) == 2, [dict(x) for x in _plan or []])
check("مبلغ الدفعة 1 = 650 (تعديل هذا العقد فقط)",
      any(abs(float(x["amount"]) - 650.0) < 0.001 for x in _plan),
      [dict(x) for x in _plan])
check("قالب النوع لم يُمس (باقٍ 400)",
      abs(float([p for p in wf.type_payments(AUTO)
                 if int(p["pay_no"]) == 1][0]["amount_fixed"]) - 400.0) < 0.001)

print("=== 3. التعديل: جدول القالب ظاهر بزرّي إضافة/حذف مخفيين ===")
_con = cs.get_contract(int(_r["id"]))
d3 = uic.ContractDialog(None, _con)
d3.show()
QTest.qWait(150)
app.processEvents()
check("التعديل: جدول القالب ظاهر", not d3._plan_box.isHidden())
check("التعديل: النطاق مخفي", d3._scope_box.isHidden())
check("التعديل: «إضافة دفعة» مخفية (وضع القالب)",
      d3.plan_add_btn.isHidden() and d3.plan_del_btn.isHidden())
d3.close()

print("=== 4. نافذة الدفعة: لا تُفرَّغ طريقة القيمة ===")
dlg = PaymentEditDialog(None, AUTO)
dlg.show()
QTest.qWait(120)
check("الافتراضي «مبلغ يدوي» مُعلَّم", dlg.use_fixed.isChecked())
QTest.mouseClick(dlg.use_fixed, Qt.LeftButton)      # نقر على المُعلَّم
QTest.qWait(60)
check("النقر على «مبلغ يدوي» المُعلَّم لا يلغيه",
      dlg.use_fixed.isChecked() and not dlg.use_pct.isChecked())
dlg.fixed.setValue(250.0)
QTest.qWait(60)
check("القيمة المكتوبة تبقى محسوبة", dlg.fixed_value() == 250.0)
QTest.mouseClick(dlg.use_pct, Qt.LeftButton)        # التبديل للنسبة
QTest.qWait(60)
check("التبديل للنسبة يُلغي «مبلغ يدوي» تلقائيًا",
      dlg.use_pct.isChecked() and not dlg.use_fixed.isChecked())
QTest.mouseClick(dlg.use_pct, Qt.LeftButton)        # نقر على المُعلَّم
QTest.qWait(60)
check("«نسبة» المُعلَّمة لا تُفرَّغ أيضًا", dlg.use_pct.isChecked())
dlg.close()

print("=== 5. تأكيد الحفظ بلا قيمة + عرض «مرنة» ===")
_asked = {"n": 0}
_orig_confirm = style.confirm
style.confirm = lambda *a, **k: (_asked.__setitem__("n", _asked["n"] + 1)
                                 or True)
dlg2 = PaymentEditDialog(None, AUTO)
dlg2.show()
QTest.qWait(120)
dlg2.accept()          # بلا قيمة (مبلغ يدوي = 0)
check("طلب تأكيد عند الحفظ بلا قيمة", _asked["n"] == 1, _asked)
dlg2.close()
_asked["n"] = 0
style.confirm = lambda *a, **k: (_asked.__setitem__("n", _asked["n"] + 1)
                                 or False)
dlg3 = PaymentEditDialog(None, AUTO)
dlg3.show()
QTest.qWait(120)
dlg3.accept()
check("الرفض يمنع الإغلاق/الحفظ", _asked["n"] == 1 and dlg3.isVisible())
dlg3.close()
style.confirm = _orig_confirm

from ui.type_workflow import TypeWorkflowDialog  # noqa: E402
_tw = TypeWorkflowDialog(None, AUTO) if True else None
try:
    _tw.show()
    QTest.qWait(200)
    app.processEvents()
    with get_connection() as c:
        c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                  " title, pct, amount_fixed) VALUES (?,?,?,?,?)",
                  (AUTO, 9, "دفعة مرنة", 0, 0.0))
    _tw._reload_payments()
    app.processEvents()
    _txt = [_tw.pay_table.item(r, 2).text()
            for r in range(_tw.pay_table.rowCount())]
    check("عمود القيمة يعرض «مرنة (تُحدد لاحقًا)» بدل «0%»",
          any("مرنة" in x for x in _txt) and not any(x == "0%" for x in _txt),
          _txt)
    _sum = _tw.total_lbl.text()
    check("سطر المجاميع يذكر عدد المرنة",
          "مرنة" in _sum and "1 مرنة" in _sum, _sum)
    _tw.close()
except NameError:
    pass

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
