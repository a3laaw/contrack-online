# -*- coding: utf-8 -*-
"""V3.3 (يُحدَّث في V3.11): القالب هو الوضع الوحيد في تعديل العقد.

V3.11: لا زر تحرير يدوي ولا حذف صف لأنواع القوالب — العرض الكامل
للقالب + تعديل مبلغ الخلية فقط + مزامنة عند الحفظ بتأكيد قبل/بعد.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


import database.database as db  # noqa: E402

db.DB_PATH = "/tmp/v33.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v33.sqlite" + _s):
        os.remove("/tmp/v33.sqlite" + _s)
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

c = customer_service.add_customer(Customer(
    customer_code="C-331", name="عميل القالب", phone="91111001"))
cts.add_type("نوع القالب", manual_track=True)   # V4.5.13: واجهة السحب لليدوي
cts.add_type("بلا نظام")
cts.add_type("شجرة بلا دفعات", manual_track=True)
for _st in ("مرحلة أ", "مرحلة ب"):
    wf.add_stage("contract", _st, contract_type="نوع القالب")
wf.add_stage("contract", "مرحلة وحيدة", contract_type="شجرة بلا دفعات")
with get_connection() as x:
    x.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct)"
              " VALUES (?,?,?,?)", ("نوع القالب", 1, "دفعة أولى", 50.0))
    x.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct)"
              " VALUES (?,?,?,?)", ("نوع القالب", 2, "دفعة ثانية", 50.0))
k1 = contract_service.add_contract(Contract(
    contract_number="T-1", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=1000.0, contract_type="نوع القالب"))
k2 = contract_service.add_contract(Contract(
    contract_number="T-2", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=500.0, contract_type="بلا نظام"))
k3 = contract_service.add_contract(Contract(
    contract_number="T-3", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=700.0, contract_type="شجرة بلا دفعات"))

from PySide6.QtWidgets import QApplication  # noqa: E402
app = QApplication.instance() or QApplication([])
from ui.contracts import ContractDialog  # noqa: E402
from PySide6.QtWidgets import QMessageBox as _QMB33  # noqa: E402
_QMB33.exec = lambda self: 0       # V5.3: خيار «حفظ بالفرق» تلقائيًا
_QMB33.clickedButton = lambda self: next(
    (b for b in self.buttons() if "حفظ بالفرق" in (b.text() or "")), None)
import ui.style as _style  # noqa: E402

print("=== 1. وضع القالب عند وجود شجرة (بلا أي زر يدوي) ===")
d1 = ContractDialog(None, contract_service.get_contract(k1))
app.processEvents()
check("وضع القالب مفعّل", d1._plan_tpl_mode is True)
check("زر الإضافة مخفي", d1.plan_add_btn.isHidden())
check("زر الحذف مخفي", d1.plan_del_btn.isHidden())
check("لا زر فك يدوي", not hasattr(d1, "plan_unlock_btn"))
check("العنوان قالب", "القالب" in d1.plan_title.text(),
      d1.plan_title.text())
check("صفان من القالب 500/500",
      d1.plan_table.rowCount() == 2
      and d1.plan_table.item(0, 3).text() == "500.000"
      and d1.plan_table.item(1, 3).text() == "500.000")
check("شارة القالب تذكر المزامنة",
      d1.plan_hint.text().startswith("🗂")
      and "تُزامَن الخطة عند الحفظ" in d1.plan_hint.text(),
      d1.plan_hint.text()[:60])
check("لا أثر للفلترة القديمة",
      "محذوفة من الفعلي" not in d1.plan_auto_lbl.text())

print("=== 2. تجاوز الحفظ لهذا العقد فقط (بلا تأكيد — لا فرق مادي) ===")
_conf_calls = []
_orig_conf = _style.confirm
_style.confirm = lambda *a, **k: (_conf_calls.append(a[1] if len(a) > 1 else ""), True)[1]
try:
    d1.plan_table.item(0, 3).setText("400.000")
    app.processEvents()
    d1.plan_table.item(1, 3).setText("600.000")
    app.processEvents()
    d1._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
_amounts = [float(r["amount"]) for r in lc.contract_payment_plan(k1)]
check("حُفظ 400/600", _amounts == [400.0, 600.0], _amounts)
check("لا حوار مزامنة (الفعلي = القالب)",
      not any("تختلف عن قالب" in t for t in _conf_calls), _conf_calls)
with get_connection() as x:
    _tpl = x.execute("SELECT pct FROM type_payment_tpl WHERE "
                     "contract_type=? ORDER BY pay_no",
                     ("نوع القالب",)).fetchall()
check("قالب الإعدادات لم يتغير",
      [float(r["pct"]) for r in _tpl] == [50.0, 50.0])
with get_connection() as x:
    _ev = x.execute("SELECT event_type FROM contract_events WHERE "
                    "contract_id=? ORDER BY id DESC LIMIT 1",
                    (k1,)).fetchone()
check("توثيق التحرير من القالب",
      _ev and _ev["event_type"] == "تحرير دفعات من القالب", _ev)

print("=== 3. الزوائد تُنظَّف بالمزامنة عند الحفظ (قبل/بعد + نسخة) ===")
from services.backup_service import get_backup_dir  # noqa: E402
_bdir = get_backup_dir()
_before_files = set(os.listdir(_bdir)) if os.path.isdir(_bdir) else set()
k5 = contract_service.add_contract(Contract(
    contract_number="T-5", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=1000.0, contract_type="نوع القالب"))
with get_connection() as x:
    x.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
              " amount, sort_order) VALUES (?,?,?,?,?)",
              (k5, "دفعة زائدة", "2026-10-01", 250.0, 3))
    x.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
              " amount, sort_order) VALUES (?,?,?,?,?)",
              (k5, "صف مكرر", "2026-10-01", 10.0, 1))
check("الإعداد: 4 صفوف فعلية",
      len(lc.contract_payment_plan(k5)) == 4)
d1b = ContractDialog(None, contract_service.get_contract(k5))
app.processEvents()
# V5.3: تُعرض الصفوف الفعلية (4) بمبالغها بدل صفّي القالب
check("الصفوف الفعلية الأربعة معروضة",
      d1b.plan_table.rowCount() == 4, d1b.plan_table.rowCount())
_conf_texts, _infos = [], []
_style.confirm = lambda *a, **k: (_conf_texts.append(a[1] if len(a) > 1 else ""), True)[1]
_orig_info = _style.info
_style.info = lambda *a, **k: _infos.append(a[1] if len(a) > 1 else "")
try:
    d1b._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
    _style.info = _orig_info
_after = sorted(float(r["amount"]) for r in lc.contract_payment_plan(k5))
check("نُظّف الفعلي = القالب 500/500", _after == [500.0, 500.0], _after)
check("التأكيد يعرض قبل/بعد",
      any("قبل:" in t and "بعد:" in t for t in _conf_texts), _conf_texts)
check("التأكيد يذكر النسخة",
      any("نسخة احتياطية" in t for t in _conf_texts))
_new_files = [f for f in (set(os.listdir(_bdir)) - _before_files)
              if f.startswith("pre_plan_sync_")] if os.path.isdir(_bdir) else []
check("نُسخة احتياطية قبل المزامنة", len(_new_files) == 1, _new_files)
check("تقرير بعد المزامنة يذكر النسخة",
      any("النسخة الاحتياطية" in t for t in _infos), _infos[-1:])
for f in _new_files:
    os.remove(os.path.join(_bdir, f))

print("=== 4. رفض المزامنة يُلغي الحفظ كاملًا (لا حفظ جزئي) ===")
with get_connection() as x:
    x.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
              " amount, sort_order) VALUES (?,?,?,?,?)",
              (k5, "زائدة ثانية", "2026-11-01", 100.0, 4))
d1c = ContractDialog(None, contract_service.get_contract(k5))
app.processEvents()
d1c.description.setPlainText("تعديل مرفوض")
_style.confirm = lambda *a, **k: False
try:
    d1c._save()
    app.processEvents()
finally:
    _style.confirm = _orig_conf
check("البيانات لم تتغير (لا حفظ جزئي)",
      contract_service.get_contract(k5).description == "ع",
      contract_service.get_contract(k5).description)
check("الخطة لم تتغير",
      len(lc.contract_payment_plan(k5)) == 3)

print("=== 5. لا مخرج يدوي + اليدوي لبلا-قالب فقط ===")
check("بلا دالة فك", not hasattr(d1b, "_plan_unlock_manual"))
check("بلا علم يدوي", not hasattr(d1b, "_manual_unlocked"))
check("بلا حذف-صف-قالب", not hasattr(d1b, "_plan_delete_template_item"))
d2 = ContractDialog(None, contract_service.get_contract(k2))
app.processEvents()
check("بلا شجرة ← يدوي بأزرار ظاهرة",
      d2._plan_tpl_mode is False and not d2.plan_add_btn.isHidden()
      and not d2.plan_del_btn.isHidden())

print("=== 6. شجرة بلا دفعات ← قالب فارغ + تنبيه ===")
d3 = ContractDialog(None, contract_service.get_contract(k3))
app.processEvents()
check("وضع القالب",
      d3._plan_tpl_mode is True and d3.plan_add_btn.isHidden()
      and d3.plan_del_btn.isHidden())
check("جدول فارغ + تنبيه",
      d3.plan_table.rowCount() == 0
      and "لا يوجد قالب دفعات" in d3.plan_hint.text(),
      d3.plan_hint.text()[:50])
check("لا زر فك", not hasattr(d3, "plan_unlock_btn"))

print("=== 7. تبديل النوع يعيد التقييم ===")
d2.ctype.setCurrentIndex(d2.ctype.findData("نوع القالب"))
app.processEvents()
check("يدوي ← قالب", d2._plan_tpl_mode is True)
d2.ctype.setCurrentIndex(d2.ctype.findData("بلا نظام"))
app.processEvents()
check("قالب ← يدوي", d2._plan_tpl_mode is False)

print("=== 8. العقد بلا نوع ← يدوي (شجرة غير محدد ليست نظامًا) ===")
k4 = contract_service.add_contract(Contract(
    contract_number="T-4", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=300.0))
d4 = ContractDialog(None, contract_service.get_contract(k4))
app.processEvents()
check("وضع يدوي",
      d4._plan_tpl_mode is False and not d4.plan_add_btn.isHidden())

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
