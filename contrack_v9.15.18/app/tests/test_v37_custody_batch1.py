# -*- coding: utf-8 -*-
"""V3.7 دفعة 1: شاشة تصفيات العهد + العرض الداخلي + الزر الأيمن
+ عمود العهدة + إلغاء الطي."""
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

db.DB_PATH = "/tmp/v37.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v37.sqlite" + _s):
        os.remove("/tmp/v37.sqlite" + _s)
db.init_db()

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402

app = QApplication.instance() or QApplication([])

from services import auth_service  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import feature_service as feat  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

_op, _oa = auth_service.has_permission, auth_service.is_admin
auth_service.has_permission = lambda *a, **k: True  # noqa: E731
auth_service.is_admin = lambda: True  # noqa: E731

# ---------- البذور: عهدتان + تصفيتان ----------
root = ea.add_account("العهد", None, allow_posting=False)
acc1 = ea.add_account("عهدة أحمد", root, account_kind="advance")
acc2 = ea.add_account("عهدة سارة", root, account_kind="advance")
exp = ea.add_account("وقود ومواصفات", None, allow_posting=True)
lc.add_voucher("payment", "2026-04-01", "أحمد", "نقدًا", "عهدة أحمد",
               5000.0, "عهد: تسليم", custody_account_id=acc1)
lc.add_voucher("payment", "2026-04-02", "سارة", "نقدًا", "عهدة سارة",
               2000.0, "عهد: تسليم", custody_account_id=acc2)
r1 = lc.add_custody_settlement("2026-04-05", acc1, [
    {"vdate": "2026-04-05", "expense_account_id": exp, "party": "محطة",
     "expense_customer_id": None, "project_id": None,
     "contract_id": None, "amount": 1200.0, "description": "بنزين"},
    {"vdate": "2026-04-06", "expense_account_id": exp, "party": "ورشة",
     "expense_customer_id": None, "project_id": None,
     "contract_id": None, "amount": 300.0, "description": "صيانة"}],
    "تصفية أحمد الأولى")
r2 = lc.add_custody_settlement("2026-05-05", acc2, [
    {"vdate": "2026-05-05", "expense_account_id": exp, "party": "مكتبة",
     "expense_customer_id": None, "project_id": None,
     "contract_id": None, "amount": 150.0, "description": "قرطاسية"}],
    "تصفية سارة")
REF1, REF2 = r1["group_number"], r2["group_number"]

print("=== 1. شاشة التصفيات: القائمة ===")
from ui.custody_settlements import CustodySettlementsPage  # noqa: E402

sp = CustodySettlementsPage()
sp.show()
app.processEvents()
check("صَفّا تصفية", sp.table.rowCount() == 2, sp.table.rowCount())
check("عمود العهدة", sp.table.horizontalHeaderItem(2).text() == "العهدة")
_accs = {sp.table.item(r, 2).text() for r in range(2)}
check("العهدتان ظاهرتان",
      _accs == {"العهد / عهدة أحمد", "العهد / عهدة سارة"}, _accs)
check("الإجمالي 1,650", "1,650.000" in sp.total_lbl.text(),
      sp.total_lbl.text())
sp.account.setCurrentIndex(sp.account.findData(acc1))
app.processEvents()
check("فلتر الحساب", sp.table.rowCount() == 1, sp.table.rowCount())
sp.account.setCurrentIndex(0)
sp.search.setText("سارة")
sp.reload()
app.processEvents()
check("البحث", sp.table.rowCount() == 1, sp.table.rowCount())
sp.search.setText("")
sp.reload()
app.processEvents()

print("=== 2. اللوحة الداخلية ===")
check("تحديد تصفية", sp.select_settlement(REF1) is True)
check("الترويسة تحمل العهدة والمرجع",
      "عهدة أحمد" in sp.view_title.text()
      and REF1 in sp.view_title.text(), sp.view_title.text())
check("البنود", sp.lines.rowCount() == 2, sp.lines.rowCount())
check("إجمالي اللوحة 1,500", "1,500.000" in sp.view_total.text(),
      sp.view_total.text())
check("المتبقي لدى الموظف 3,500", "3,500.000" in sp.view_sub.text(),
      sp.view_sub.text())
check("مرجع وهمي", sp.select_settlement("NOPE") is False)

print("=== 3. بوابات التعديل ===")
import ui.style as _style  # noqa: E402
auth_service.is_admin = lambda: False  # noqa: E731
sp2 = CustodySettlementsPage()
sp2.show()
app.processEvents()
check("غير المدير: زر التعديل مخفي",
      sp2.edit_btn.isHidden() is True)
auth_service.is_admin = lambda: True  # noqa: E731
feat.set_many({"settle_edit": False})
_infos = []
_oi = _style.info
_style.info = lambda *a, **k: _infos.append(a[-1])  # noqa: E731
try:
    sp._edit_current()
finally:
    _style.info = _oi
check("العلم المطفأ يرفض برسالة",
      bool(_infos) and "معطّل" in str(_infos[-1]), _infos[-1:])
feat.set_many({"settle_edit": True})

print("=== 4. الكشف: العمود والنقر والقائمة ===")
from ui.custody_center import CustodyCenterPage  # noqa: E402

pg = CustodyCenterPage()
pg.show()
app.processEvents()
check("8 أعمدة", pg.table.columnCount() == 8, pg.table.columnCount())
srow = next(i for i, m in enumerate(pg._visible)
            if m.get("item", {}).get("kind") == "settlement")
sref = pg._visible[srow]["item"].get("ref") or ""
_calls = []
pg._open_in_settlements = lambda ref: (_calls.append(ref), True)[1]
pg.table.selectRow(srow)
pg._cell_clicked(srow, 1)
check("النقر ينقل للتصفيات", _calls == [sref], _calls)
check("لا صفوف تفاصيل", not any(m.get("type") == "detail"
                                for m in pg._visible))
check("سطر الحساب", "الحساب:" in pg.sub_lbl.text()
      and "الحركات:" in pg.sub_lbl.text(), pg.sub_lbl.text())
check("سياسة الزر الأيمن",
      pg.table.contextMenuPolicy() == Qt.CustomContextMenu
      and sp.table.contextMenuPolicy() == Qt.CustomContextMenu
      and sp.lines.contextMenuPolicy() == Qt.CustomContextMenu)


class _FakeWin:
    def __init__(self):
        self.nav = []
        self._sp = CustodySettlementsPage()

    def _navigate(self, idx):
        self.nav.append(idx)

    @property
    def settlements_page(self):
        return self._sp


from ui.main_window import IDX_SETTLEMENTS  # noqa: E402

pg2 = CustodyCenterPage()
_fake = _FakeWin()
pg2.window = lambda: _fake  # noqa: E731
check("التنقل الحقيقي",
      pg2._open_in_settlements(REF2) is True
      and _fake.nav == [IDX_SETTLEMENTS]
      and _fake._sp._current_ref == REF2,
      (_fake.nav, _fake._sp._current_ref))

print("=== 5. التنقل والطباعة ===")
from ui.main_window import MainWindow  # noqa: E402

w = MainWindow()
w.show()
app.processEvents()
_names = [b.text() for b in w.findChildren(QPushButton)]
check("زر العهد الواحد", any("💰  العهد" in t for t in _names))
check("لا زر تصفيات منفصل",
      not any("📑  تصفيات العهد" in t for t in _names))
feat.set_many({"custody": False})
w2 = MainWindow()
w2.show()
app.processEvents()
_names2 = [b.text() for b in w2.findChildren(QPushButton)]
check("يختفي مع علم العهدة",
      not any("تصفيات العهد" in t for t in _names2))
feat.set_many({"custody": True})

import tempfile  # noqa: E402
from reports.custody_pdf import generate_custody_ledger_pdf  # noqa: E402

_tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
_tmp.close()
generate_custody_ledger_pdf(pg._ledger, _tmp.name,
                            include_details=True)
check("PDF الكشف يُبنى", os.path.getsize(_tmp.name) > 1000,
      os.path.getsize(_tmp.name))
os.remove(_tmp.name)

auth_service.has_permission, auth_service.is_admin = _op, _oa

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
