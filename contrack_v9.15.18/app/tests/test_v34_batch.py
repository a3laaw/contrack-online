# -*- coding: utf-8 -*-
"""V3.4: التقرير المجمع + التاريخ اليوم + كتابته + إلغاء عقد واحد + تصفية الإشعارات."""
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

db.DB_PATH = "/tmp/v34.sqlite"
for _s in ("", "-shm", "-wal"):
    if os.path.exists("/tmp/v34.sqlite" + _s):
        os.remove("/tmp/v34.sqlite" + _s)
db.init_db()

from PySide6.QtCore import QDate  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402
from PySide6.QtWidgets import QApplication, QDateTimeEdit as DTE  # noqa: E402
from PySide6.QtCore import Qt  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.widgets import SafeDateEdit  # noqa: E402

_TODAY = QDate.currentDate().toString("yyyy-MM-dd")

print("=== 1. التاريخ يبدأ من اليوم ===")
e = SafeDateEdit()
e.setDisplayFormat("yyyy-MM-dd")
check("الافتراضي اليوم", e.date().toString("yyyy-MM-dd") == _TODAY,
      e.date().toString("yyyy-MM-dd"))

print("=== 2. الكتابة السلسة ===")
e.setDate(QDate(2026, 9, 21))
e.show()
e.setFocus()
app.processEvents()
check("الدخول يعلّم أول خانة",
      e.currentSection() == DTE.YearSection, e.currentSection())
QTest.keyClick(e, Qt.Key_Backspace)
app.processEvents()
check("المسح يعلّم الكل (بلا إفساد)",
      e.lineEdit().selectedText() == "2026-09-21",
      repr(e.lineEdit().selectedText()))
QTest.keyClicks(e, "2025")
app.processEvents()
check("الكتابة تبدأ من السنة",
      e.date().toString("yyyy-MM-dd") == "2025-09-21"
      and e.currentSection() == DTE.MonthSection,
      (e.date().toString("yyyy-MM-dd"), e.currentSection()))
QTest.keyClicks(e, "12")
app.processEvents()
QTest.keyClicks(e, "05")
app.processEvents()
check("إعادة كتابة كاملة سليمة",
      e.date().toString("yyyy-MM-dd") == "2025-12-05"
      and e.lineEdit().text() == "2025-12-05",
      (e.date().toString("yyyy-MM-dd"), e.lineEdit().text()))
e2 = SafeDateEdit()
e2.setDisplayFormat("yyyy-MM-dd")
e2.setDate(QDate(2026, 9, 21))
e2.show()
e2.setFocus()
app.processEvents()
QTest.keyClicks(e2, "2026-10-01")
app.processEvents()
check("الفاصل يقفز للقسم التالي",
      e2.date().toString("yyyy-MM-dd") == "2026-10-01",
      e2.date().toString("yyyy-MM-dd"))

print("=== 3. التقرير المجمع يعمل من اليوم ===")
from database.database import get_connection  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

with get_connection() as c:
    c.execute("UPDATE settings SET opening_balance_cash=50000 WHERE id=1")
aid = ea.custody_items()[0][1]
exp = [a for a in ea.posting_items() if a[1]][0][1]
lc.add_voucher("payment", _TODAY, "موظف", "نقدًا", "", 5000.0,
               "تسليم", custody_account_id=aid)
lc.add_custody_settlement(_TODAY, aid, [
    {"amount": 1500.0, "expense_account_id": exp, "party": "م",
     "description": "بند"}])
from ui.custody_center import SettlementsReportDialog  # noqa: E402
dlg = SettlementsReportDialog()
app.processEvents()
check("من/إلى = اليوم",
      dlg.d1.date().toString("yyyy-MM-dd") == _TODAY
      and dlg.d2.date().toString("yyyy-MM-dd") == _TODAY)
check("تصفية اليوم ظاهرة", dlg.table.rowCount() == 2,
      dlg.table.rowCount())

print("=== 4. لا تاب عقد واحد ===")
from ui.statement import StatementPage  # noqa: E402
pg = StatementPage()
app.processEvents()
check("التاب محذوف", not hasattr(pg, "mode_tabs"))
check("7 أعمدة ثابتة", pg.table.columnCount() == 7)

print("=== 5. تصفية الإشعارات ===")
from services import auth_service  # noqa: E402
from services import workflow_service as wf  # noqa: E402

auth_service.ensure_default_user()
auth_service.set_current_user(auth_service.get_username() or "admin")
_uid = auth_service.current_user_id()
assert _uid, "no current user"
with get_connection() as c:
    _old = "2020-01-01 08:00:00"
    _now = "2026-09-21 08:00:00"
    for _rd, _ts in ((0, _now), (1, _now), (0, _old), (1, _old)):
        c.execute("INSERT INTO notifications (user_id, transaction_type,"
                  " transaction_id, type, text, is_read, created_at)"
                  " VALUES (?,?,?,?,?,?,?)",
                  (_uid, "contract", 1, "msg", "ت", _rd, _ts))
check("غير المقروء 2", wf.unread_count() == 2, wf.unread_count())
n = wf.clear_old_notifications()
check("مُسح 3 (مقروءتان + قديمة)", n == 3, n)
check("الباقي حديثة غير مقروءة", wf.unread_count() == 1)

print("=== 6. زر التصفية في قائمة الجرس ===")
from services import feature_service  # noqa: E402
from ui import style as _style  # noqa: E402

_op, _of = auth_service.has_permission, feature_service.enabled
auth_service.has_permission = lambda *a, **k: True
feature_service.enabled = lambda *a, **k: True
_oc, _oi = _style.confirm, _style.info
_style.confirm = lambda *a, **k: True
_style.info = lambda *a, **k: None
try:
    from ui.main_window import MainWindow  # noqa: E402
    win = MainWindow()
    app.processEvents()
    kinds = [k for k, _t, _d in win._notification_menu_items()]
    check("بند المسح موجود", "clear" in kinds, kinds)
    win._handle_notification_choice({"__clear__": True})
    app.processEvents()
    check("الباقي 1 بعد المسح من القائمة", wf.unread_count() == 1,
          wf.unread_count())
finally:
    auth_service.has_permission, feature_service.enabled = _op, _of
    _style.confirm, _style.info = _oc, _oi

print(f"\nالنتيجة: نجح {passed} / فشل {failed}")
os._exit(1 if failed else 0)
