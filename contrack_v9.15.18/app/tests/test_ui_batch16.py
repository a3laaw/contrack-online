# -*- coding: utf-8 -*-
"""اختبار الدفعة 16: إصلاحات V2.41 (الأخطاء 1-5 من الميدان)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


app = QApplication.instance() or QApplication([])
from database.database import init_db  # noqa: E402

init_db()
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

cid = customer_service.add_customer(Customer(
    customer_code="C-F16", name="عميل إصلاح", phone="9016"))
kid = contract_service.add_contract(Contract(
    contract_number="CON-F16", customer_id=cid,
    contract_date="2026-01-01", description="عقد إصلاح",
    amount=20000.0, contract_type="مقاولة عامة"))

print("=== 1. زر التعديل كامل ===")
from ui.archive import CustomerFileWidget  # noqa: E402

w = CustomerFileWidget(None, customer_service.get_customer(cid),
                       open_page="contracts")
w.show()
app.processEvents()
btn = w.cons_table.cellWidget(0, 3)
check("عمود التعديل يكفي الزر (76 + زر 64)",
      w.cons_table.columnWidth(3) == 76
      and btn.minimumWidth() == 64, w.cons_table.columnWidth(3))
check("النص غير مقطوع",
      btn.text() == "✎ تعديل"
      and btn.sizeHint().width() <= w.cons_table.columnWidth(3),
      btn.sizeHint().width())
check("النص غير مقطوع عموديًا",
      btn.sizeHint().height() <= w.cons_table.rowHeight(0),
      (btn.sizeHint().height(), w.cons_table.rowHeight(0)))

print("=== 2. أول فتح للكشف ===")
from services import auth_service, feature_service  # noqa: E402
from ui.main_window import IDX_STATEMENT, MainWindow  # noqa: E402
from ui.statement import StatementPage  # noqa: E402

_op, _of = auth_service.has_permission, feature_service.enabled
auth_service.has_permission = lambda *a, **k: True
feature_service.enabled = lambda *a, **k: True
try:
    win = MainWindow()
    win.show()
    app.processEvents()
    check("قبل الفتح holder",
          not isinstance(win.stack.widget(IDX_STATEMENT), StatementPage))
    win._open_statement(cid)
    app.processEvents()
    cur = win.stack.currentWidget()
    check("أول فتح يعرض الصفحة الحقيقية",
          isinstance(cur, StatementPage) and cur is win.statement_page)
    check("بيانات العميل محملة",
          cur.table.rowCount() > 0
          and cur.customer.selected_data() == cid,
          cur.table.rowCount())
finally:
    auth_service.has_permission, feature_service.enabled = _op, _of

print("=== 3. تحديث العهد ===")
from ui.custody_center import CustodyCenterPage  # noqa: E402

cu = CustodyCenterPage()
cu.show()
app.processEvents()
_real_acc = lc.custody_accounts
lc.custody_accounts = lambda: (_real_acc()
                               + [{"account": "عهدة وهمية",
                                   "account_id": 999999}])
try:
    rb = [b for b in cu.findChildren(QPushButton)
          if b.text() == "🔄 تحديث"]
    check("زر التحديث موجود", len(rb) == 1)
    rb[0].click()
    app.processEvents()
    texts = [cu.account.itemText(i) for i in range(cu.account.count())]
    check("التحديث يجلب الحسابات الجديدة", "عهدة وهمية" in texts, texts)
finally:
    lc.custody_accounts = _real_acc

print("=== 4. كشف مقاول الباطن ===")
from services import statement_service  # noqa: E402

sid = lc.add_subcontractor("S-F16", "مقاول إصلاح", "", "", "", "")
pid = None
try:
    from services import ui_data_service as ui_data  # noqa: E402
    pid = ui_data.contract_project_id(kid)
except Exception:
    pass
lc.add_sub_contract(sid, kid, pid, 8000.0, "2026-02-01",
                    "2026-12-31", "بند إصلاح")
lc.add_voucher("payment", "2026-03-01", "مقاول إصلاح", "نقدًا",
               "الصندوق", 3000.0, "دفعة مقاول",
               project_id=pid, contract_id=kid,
               party_type="subcontractor", party_id=sid)
d = statement_service.build_subcontractor_statement(sid)
check("الخدمة: مدين/دائن/متبقي",
      d["total_debit"] == 8000.0 and d["total_credit"] == 3000.0
      and d["remaining"] == 5000.0,
      (d["total_debit"], d["total_credit"], d["remaining"]))
pg = StatementPage()
pg.show()
pg.party_tabs.setCurrentData("sub")
app.processEvents()
check("وضع المقاول: 7 أعمدة",
      pg.table.columnCount() == 7
      and not pg.contract.isVisible()
      and pg.subcontractor.isVisible())
pg.subcontractor.select_data(sid)
app.processEvents()
check("صفوف المقاول", pg.table.rowCount() == len(d["rows"]),
      pg.table.rowCount())
check("تسميات المقاول", "مقاول إصلاح" in pg.lbl_customer.text()
      and "5000" in pg.lbl_remaining.text().replace(",", ""),
      (pg.lbl_customer.text(), pg.lbl_remaining.text()))
pg.party_tabs.setCurrentData("customer")
app.processEvents()
check("العودة للعميل", pg.contract.isVisible()
      and pg.customer.isVisible()
      and not pg.subcontractor.isVisible())

print("=== 5. طباعة المستندات ===")
from ui import customers as customers_ui  # noqa: E402

calls = []
_real_info = customers_ui.style.info
customers_ui.style.info = lambda *a, **k: calls.append(a)
_real_dlg = customers_ui.QFileDialog.getExistingDirectory
customers_ui.QFileDialog.getExistingDirectory = \
    lambda *a, **k: "/tmp/f16batch"
import services.batch_print_service as bps  # noqa: E402

_real_exp = bps.batch_export
bps.batch_export = lambda items, out: ([1], [])
try:
    customers_ui.batch_print_customer_documents(
        None, customer_service.get_customer(cid))
    check("بلا NameError + رسالة", len(calls) == 1, calls)
finally:
    customers_ui.style.info = _real_info
    customers_ui.QFileDialog.getExistingDirectory = _real_dlg
    bps.batch_export = _real_exp

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
