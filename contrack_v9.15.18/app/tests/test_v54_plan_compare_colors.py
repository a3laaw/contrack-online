# -*- coding: utf-8 -*-
"""V5.4 ⑤+⑥+⑦.

⑤ سطر مقارنة بنود عقد الباطن بقيمته (مثل عقد العميل تمامًا).
⑥ ألوان موحدة: مدفوع أخضر · مستحق أحمر · جزئي أصفر · بانتظار رمادي.
⑦ عنوان الدفعة المحفوظ يتبع الترقيم الجديد (1,2,3 لا 1,3,6).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db  # noqa: E402

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

from PySide6.QtWidgets import QApplication, QMessageBox  # noqa: E402
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True
QMessageBox.exec = lambda self: 0
QMessageBox.clickedButton = lambda self: None

import ui.contracts as uic  # noqa: E402
import ui.subcontractors as uis  # noqa: E402
for _m in (uic, uis):
    for _n in ("info", "error", "toast", "success", "warning"):
        setattr(_m.style, _n, lambda *a, **k: None)
    setattr(_m.style, "confirm", lambda *a, **k: True)

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


T = "يدوي 6"
cts.add_type(T, 0.0, manual_track=True)
with db.get_connection() as conn:
    _steps = []
    for nm in ("بند أول", "بند ثاني", "بند ثالث", "بند رابع",
               "بند خامس", "بند سادس"):
        _steps.append(wf.add_stage("contract", nm, contract_type=T))
    for i, sid in enumerate(_steps):
        conn.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                     " title, pct, amount_fixed, trigger_stage_id)"
                     " VALUES (?,?,?,?,?,?)", (T, i + 1, f"دفعة {i + 1}", 0,
                                               0.0, sid))
    # دفعة باسم مخصص كتبه المستخدم — يجب أن يبقى كما هو
    conn.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                 " title, pct, amount_fixed, trigger_stage_id)"
                 " VALUES (?,?,?,?,?,?)", (T, 7, "دفعة التسليم النهائي", 0,
                                           0.0, None))
cust = cs.add_customer(Customer(customer_code="C-1", name="عميل", phone="90000001"))

print("=== ⑦ عنوان الدفعة: اختيار 3 من 7 ⇒ 1,2,3 ===")
dlg = uic.ContractDialog(None, None)
dlg.show(); QTest.qWait(150); app.processEvents()
dlg.ctype.setCurrentIndex(dlg.ctype.findData(T)); app.processEvents()
dlg.customer.select_data(cust)
dlg.number.setText("M-1"); dlg.amount.setValue(4000.0)
app.processEvents()
for i in range(dlg.scope_tree.topLevelItemCount()):
    dlg.scope_tree.topLevelItem(i).setCheckState(0, Qt.Unchecked)
app.processEvents()
for i in (0, 2, 5):                      # الأولى والثالثة والسادسة
    it = dlg.scope_tree.topLevelItem(i)
    it.setCheckState(0, Qt.Checked)
    try:
        dlg._sync_scope_tree(it, 0)
    except Exception:
        pass
app.processEvents()
dlg._apply_scope_to_plan(silent=True); app.processEvents()
for r in range(dlg.plan_table.rowCount()):
    dlg.plan_table.item(r, 3).setText("1,000.000")
app.processEvents()
_ERRS = []
uic.style.error = lambda *a, **k: _ERRS.append(("error", a[1] if len(a) > 1 else a))
uic.style.info = lambda *a, **k: _ERRS.append(("info", a[1] if len(a) > 1 else a))
uic.style.toast = lambda *a, **k: _ERRS.append(("toast", a[1] if len(a) > 1 else a))
print("        [تشخيص] صفوف الجدول:", dlg.plan_table.rowCount(),
      "| تجاوزات:", getattr(dlg, "_plan_amount_overrides", None),
      "| النطاق:", sorted(getattr(dlg, "_plan_scope_ids", None) or []))
dlg._save(); app.processEvents()
if _ERRS:
    print("        [تشخيص] أخطاء الحفظ:", _ERRS[-2:])
dlg.close()
with db.get_connection() as conn:
    kid = int(conn.execute("SELECT id FROM contracts WHERE contract_number='M-1'"
                           ).fetchone()["id"])
    titles = [r["title"] for r in conn.execute(
        "SELECT title FROM payment_plan WHERE contract_id=? "
        "ORDER BY sort_order, id", (kid,)).fetchall()]
check("الترقيم في الأسماء 1,2,3(,4) لا 1,3,6",
      titles == ["1. دفعة 1", "2. دفعة 2", "3. دفعة 3",
                 "4. دفعة التسليم النهائي"], titles)

print("=== ⑦ اسم مخصص يبقى كما هو عبر المزامنة ===")
wf.sync_plan_from_template(kid)
with db.get_connection() as conn:
    after = [r["title"] for r in conn.execute(
        "SELECT title FROM payment_plan WHERE contract_id=? "
        "ORDER BY sort_order", (kid,)).fetchall()]
check("الاسم المخصص باقٍ ولم يصبح «دفعة 4»",
      "4. دفعة التسليم النهائي" in after, after)
check("الترقيم غابت عنه أرقام القالب القديمة",
      not any(x.startswith(("5.", "6.", "7.")) for x in after), after)

print("=== ⑤ سطر مقارنة البنود بقيمة عقد الباطن ===")
items = []
for i, nm in enumerate(("بند أول", "بند ثاني", "بند ثالث")):
    items.append(lc.add_boq_item(kid, nm, 1, "عدد", 1000.0))
with db.get_connection() as conn:
    conn.execute("INSERT INTO subcontractors (sub_code, name, phone) "
                 "VALUES ('S-1','مقاول','80000001')")
    sub_id = int(conn.execute("SELECT id FROM subcontractors").fetchone()["id"])
sd = uis.LinkSubContractDialog(None, kid)
sd.show(); QTest.qWait(200); app.processEvents()
sd.sub.setCurrentIndex(0) if sd.sub.count() else None
sd.sub.select_data(sub_id) if hasattr(sd.sub, "select_data") else None
app.processEvents()
sd.amount.setValue(2500.0)                    # أقل من البنود بـ 500
sd._check_all(Qt.Checked); app.processEvents()
txt = sd.items_total_lbl.text()
check("السطر يذكر مجموع بنود عقد العميل", "مجموع بنود عقد العميل" in txt, txt)
check("السطر يذكر المختار", "المختار لهذا المقاول: 3 بند" in txt, txt)
check("السطر يذكر قيمة عقد الباطن", "قيمة عقد الباطن: 2,500.000" in txt, txt)
check("الفرق ظاهر بإشارته", "الفرق: +500.000" in txt, txt)
check("لون الفرق كهرماني عند عدم التطابق",
      style.WARN in sd.items_total_lbl.styleSheet(), sd.items_total_lbl.styleSheet())
sd.amount.setValue(3000.0); app.processEvents()
txt2 = sd.items_total_lbl.text()
check("عند التطابق: ✓ مطابق", "✓ مطابق لقيمة عقد الباطن" in txt2, txt2)
check("لون التطابق أخضر",
      style.OK_GREEN in sd.items_total_lbl.styleSheet(),
      sd.items_total_lbl.styleSheet())
sd.close()

print("=== ⑥ الألوان الموحدة ===")
check("مدفوع ⇒ أخضر", style.status_color("مدفوع") == style.OK_GREEN)
check("مستحقة ⇒ أحمر", style.status_color("مستحقة") == style.DANGER)
check("متأخر ⇒ أحمر", style.status_color("متأخر") == style.DANGER)
check("جزئي ⇒ أصفر", style.status_color("جزئي") == style.WARN)
check("بانتظار إنجاز المرحلة ⇒ رمادي",
      style.status_color("بانتظار إنجاز المرحلة") == style.NEUTRAL)
check("حالة غير معروفة ⇒ رمادي افتراضي",
      style.status_color("شيء آخر") == style.STATUS_DEFAULT)
import ui.contract_hub as uch  # noqa: E402
_src = open(os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "ui", "contract_hub.py"), encoding="utf-8").read()
check("مركز العقد يستعمل الدالة (لا خريطة مكررة)",
      "style.status_color" in _src
      and '"مستحقة": style.WARN' not in _src)

print("=== ⑦ ألوان جدول خطة عقد الباطن في مركز العقد ===")
_sc_id = lc.add_sub_contract(
    sub_id, kid, None, 3000.0, start_date="2026-01-01", end_date="2026-06-01",
    description="", boq_item_ids=[items[0]])
with db.get_connection() as conn:
    conn.execute("INSERT INTO sub_payment_plan (sub_contract_id, title,"
                 " due_date, amount, sort_order, triggered_at)"
                 " VALUES (?,?,?,?,?,?)",
                 (_sc_id, "1. دفعة 1", "2026-02-01", 1000.0, 1,
                  "2026-02-01 00:00:00"))
plan = lc.sub_payment_plan(_sc_id)
check("الخطة تُبنى", len(plan) >= 1, len(plan))
check("حالة معلومة لها لون من الدالة",
      style.status_color(plan[0].get("status") or "") in (
          style.OK_GREEN, style.DANGER, style.WARN, style.NEUTRAL),
      plan[0].get("status"))

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
