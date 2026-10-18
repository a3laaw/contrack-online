# -*- coding: utf-8 -*-
"""V3.13: شاشة التصفية (نموذج + قائمة) + زر طباعة الصف + حذف التقرير المكرر."""
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

db.DB_PATH = "/tmp/v313.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v313.sqlite" + _s):
        os.remove("/tmp/v313.sqlite" + _s)
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

c = customer_service.add_customer(Customer(
    customer_code="C-313", name="عميل تصفية", phone="91313001"))
k = contract_service.add_contract(Contract(
    contract_number="S-313", customer_id=c, contract_date="2026-09-01",
    description="ع", amount=9000.0))
root = ea.add_account("العهد", None, allow_posting=False)
a1 = ea.add_account("عهدة أحمد", root, account_kind="advance")
exp = ea.add_account("مواد", None, allow_posting=True)
lc.add_voucher("payment", "2026-09-01", "أحمد", "نقدًا",
               "عهدة أحمد", 1500.0, "عهد: تسليم", custody_account_id=a1)

from PySide6.QtWidgets import QApplication  # noqa: E402
app = QApplication.instance() or QApplication([])
from ui.custody_center import CustodySettlementDialog  # noqa: E402
import ui.style as _style  # noqa: E402

_orig_err, _orig_info, _orig_ok = (_style.error, _style.info,
                                   _style.success)

print("=== 1. البناء: نموذج + قائمة فارغة ===")
d = CustodySettlementDialog(None)
d.show()
app.processEvents()
check("7 أعمدة قراءة فقط",
      d.table.columnCount() == 7 and d.table.rowCount() == 0)
check("الإجمالي صفر", "عدد البنود: 0" in d.total_lbl.text(),
      d.total_lbl.text())
check("الرصيد شرطة قبل الاختيار", "—" in d.balance_lbl.text())

print("=== 2. اختيار العهدة يُظهر الرصيد ===")
d.custody.setCurrentIndex(d.custody.findData(a1))
app.processEvents()
check("الرصيد 1,500", "1,500.000" in d.balance_lbl.text(),
      d.balance_lbl.text())
check("بعد التصفية = الرصيد (بلا بنود)",
      "1,500.000" in d.after_lbl.text(), d.after_lbl.text())


def _fill(acc_id, amount, party="", desc=""):
    d.f_acc.setCurrentIndex(d.f_acc.findData(acc_id))
    d.f_amount.setValue(amount)
    d.f_party.setText(party)
    d.f_desc.setText(desc)
    app.processEvents()


print("=== 3. إضافة بندين عبر النموذج ===")
_fill(exp, 250.0, "محطة الوقود", "بنزين")
d.add_btn.click()
app.processEvents()
_fill(exp, 100.0, "ورشة", "إصلاح")
d.add_btn.click()
app.processEvents()
check("صفّان", d.table.rowCount() == 2)
check("الإجمالي 350", "350.000" in d.total_lbl.text()
      and "عدد البنود: 2" in d.total_lbl.text(), d.total_lbl.text())
check("بعد التصفية 1,150 أخضر",
      "1,150.000" in d.after_lbl.text()
      and "#166534" in d.after_lbl.styleSheet())
check("النموذج يتفضّى بعد الإضافة",
      d.f_amount.value() == 0 and d.f_party.text() == "")

print("=== 4. تعديل بند بالضغط عليه ===")
d._load_line(0)
app.processEvents()
check("زر التحديث", d.add_btn.text() == "✔ تحديث البند",
      d.add_btn.text())
check("النموذج تحمّل", d.f_amount.value() == 250.0
      and d.f_party.text() == "محطة الوقود")
d.f_amount.setValue(300.0)
d.add_btn.click()
app.processEvents()
check("حُدّث وبقيا صفّين",
      d.table.rowCount() == 2 and "400.000" in d.total_lbl.text(),
      d.total_lbl.text())

print("=== 5. حذف البند المحدد ===")
d._load_line(1)
d.del_btn.click()
app.processEvents()
check("بقي صف واحد", d.table.rowCount() == 1
      and "300.000" in d.total_lbl.text())
_infos = []
_style.info = lambda *a, **k: _infos.append(a[-1])
try:
    d._selected = None
    d.del_btn.click()
    app.processEvents()
finally:
    _style.info = _orig_info
check("الحذف بلا تحديد ينبّه", bool(_infos), _infos)

print("=== 6. التحقق من البند ===")
_errs = []
_style.error = lambda *a, **k: _errs.append(a[-1])
try:
    d._clear_form()
    d.add_btn.click()
    app.processEvents()
    _fill(exp, 0.0)
    d.add_btn.click()
    app.processEvents()
finally:
    _style.error = _orig_err
check("خطأ الحساب والمبلغ",
      any("حساب المصروف" in e for e in _errs)
      and any("أكبر من صفر" in e for e in _errs), _errs)
check("لا صفوف زائفة", d.table.rowCount() == 1)

print("=== 7. العميل ← العقود ===")
d.f_cust.select_data(c)
app.processEvents()
check("عقود العميل محمّلة",
      d.f_con.count() >= 1
      and any(d.f_con.itemData(i) == k
              for i in range(d.f_con.count())))
d.f_cust.setCurrentIndex(-1)
d.f_cust.lineEdit().setText("")
app.processEvents()

print("=== 8. تجاوز الرصيد أحمر (عرض فقط) ===")
_fill(exp, 2000.0, "مورد", "كبير")
d.add_btn.click()
app.processEvents()
check("بعد التصفية سالب أحمر",
      "-800.000" in d.after_lbl.text()
      and "#991B1B" in d.after_lbl.styleSheet(), d.after_lbl.text())
d._load_line(1)
d.del_btn.click()
app.processEvents()

print("=== 9. الحفظ ===")
_errs2, _oks = [], []
_style.error = lambda *a, **k: _errs2.append(a[-1])
_style.success = lambda *a, **k: _oks.append(a[-1])
try:
    d2 = CustodySettlementDialog(None)
    d2.show()
    app.processEvents()
    d2.custody.setCurrentIndex(d2.custody.findData(a1))
    d2._save()
    app.processEvents()
    check("الحفظ الفارغ مرفوض",
          any("بندًا واحدًا" in e for e in _errs2), _errs2)
    d._save()
    app.processEvents()
finally:
    _style.error = _orig_err
    _style.success = _orig_ok
check("نجاح بالمرجع", d.result() == 1 and bool(_oks)
      and "المرجع" in _oks[-1], _oks[-1:])
_bal = [b for b in lc.custody_balances() if b["account_id"] == a1][0]
check("المنصرف في القاعدة 300", _bal["spent"] == 300.0
      and _bal["balance"] == 1200.0, (_bal["spent"], _bal["balance"]))

print("=== 10. زر طباعة الصف احترافي + لا تقرير مكرر ===")
from ui.custody_center import CustodyCenterPage  # noqa: E402
from PySide6.QtWidgets import QHeaderView as _QHV  # noqa: E402
pg = CustodyCenterPage()
pg.show()
app.processEvents()
check("لا زر تقرير مكرر", not hasattr(pg, "report_btn"))
check("عمود الطباعة ثابت 96",
      pg.table.columnWidth(7) == 96
      and pg.table.horizontalHeader().sectionResizeMode(7) == _QHV.Fixed,
      pg.table.columnWidth(7))
_btn = pg.table.cellWidget(0, 7)
check("نص كامل غير مقطوع", _btn.text() == "🖨 طباعة",
      _btn.text() if _btn else None)

print("=== 11. تاب التقارير العلوي يعمل ===")
from ui.custody_center import CustodyUnifiedPage  # noqa: E402
u = CustodyUnifiedPage()
u.show_section("reports")
app.processEvents()
check("تاب التقارير يُبنى",
      u.tabs.count() == 3 and u.tabs.currentWidget() is u.reports)

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
