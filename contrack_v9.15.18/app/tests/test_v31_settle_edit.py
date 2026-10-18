# -*- coding: utf-8 -*-
"""V3.1: تصفية العهد قابلة للتعديل من المدير (بنود + حذف + حساب)."""
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

db.DB_PATH = "/tmp/v31.sqlite"
for _f in ("/tmp/v31.sqlite", "/tmp/v31.sqlite-shm", "/tmp/v31.sqlite-wal"):
    if os.path.exists(_f):
        os.remove(_f)
db.init_db()

from database.database import get_connection  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

with get_connection() as c:
    c.execute("UPDATE settings SET opening_balance_cash=10000 WHERE id=1")

aid = ea.custody_items()[0][1]
exps = [a for a in ea.posting_items() if a[1]]
lc.add_voucher("payment", "2026-09-01", "موظف", "نقدًا", "", 1000.0,
               "تسليم عهدة", custody_account_id=aid)
res = lc.add_custody_settlement(
    "2026-09-05", aid,
    [{"amount": 600.0, "expense_account_id": exps[0][1],
      "party": "مورد", "description": "بنزين"},
     {"amount": 400.0, "expense_account_id": exps[0][1],
      "party": "ورشة", "description": "صيانة"}])
ref = res["group_number"]

print("=== 1. الخدمة: تعديل بند ===")
lines = lc.list_custody_group_lines(ref)
check("بندان نشطان", len(lines) == 2, len(lines))
v0 = dict(next(v for v in lines if v["description"] == "بنزين"))
new_acc = exps[1][1] if len(exps) > 1 else exps[0][1]
lc.update_voucher(v0["id"], v0["vdate"], v0["method"], 650.0, "بنزين معدّل",
                  notes=v0["notes"] or "", contract_id=v0["contract_id"],
                  party_type=v0["party_type"] or "",
                  party_id=v0["party_id"],
                  project_id=v0["project_id"], party=v0["party"],
                  expense_customer_id=v0["expense_customer_id"],
                  expense_account_id=new_acc)
got = lc.get_voucher(v0["id"])
check("المبلغ والبيان والحساب",
      got["amount"] == 650.0 and got["description"] == "بنزين معدّل"
      and got["expense_account_id"] == new_acc, got)

print("=== 2. الحوار: بناء + حفظ ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui import style as _style  # noqa: E402
from ui.custody_center import CustodyCenterPage, SettlementEditDialog  # noqa: E402

dlg = SettlementEditDialog(None, ref)
dlg.show()
app.processEvents()
check("صفان في الحوار", dlg.table.rowCount() == 2, dlg.table.rowCount())
check("الإجمالي 1050", "1,050.000" in dlg.total_lbl.text(),
      dlg.total_lbl.text())
dlg.table.cellWidget(0, 5).setValue(700.0)
_msgs, _errs = [], []
_o_ok, _o_err = _style.success, _style.error
_style.success = lambda *a, **k: _msgs.append(a[1] if len(a) > 1 else "")
_style.error = lambda *a, **k: _errs.append(a[1] if len(a) > 1 else "")
try:
    dlg._save()
finally:
    _style.success, _style.error = _o_ok, _o_err
check("الحفظ نجح", dlg.result() == 1 and not _errs, _errs)
_syan = next(v for v in lc.list_custody_group_lines(ref)
               if v["description"] == "صيانة")
check("المبلغ في القاعدة (صف 0 = الصيانة)",
      _syan["amount"] == 700.0, _syan["amount"])

print("=== 3. حذف بند ===")
dlg2 = SettlementEditDialog(None, ref)
dlg2.show()
app.processEvents()
btn = dlg2.table.cellWidget(1, 7)
dlg2._drop_row(btn)
_style.success = lambda *a, **k: _msgs.append("")
_style.error = lambda *a, **k: _errs.append(a[1] if len(a) > 1 else "")
try:
    dlg2._save()
finally:
    _style.success, _style.error = _o_ok, _o_err
left = [v for v in lc.list_custody_group_lines(ref)
        if not (v.get("cancelled") or 0)]
check("بقي بند واحد نشط", len(left) == 1, len(left))
_del_id = v0["id"]  # صف 1 في الحوار = البنزين (650)
with get_connection() as conn:
    reason = conn.execute(
        "SELECT cancel_reason FROM vouchers WHERE id=?",
        (_del_id,)).fetchone()[0]
check("الحذف موثق", "تعديل التصفية" in (reason or ""), reason)

print("=== 4. البوابة: المدير فقط + ربط الصفوف ===")
from services import auth_service  # noqa: E402

auth_service.ensure_default_user()
auth_service.add_user("sec31", "1234", "secretary")
pg = CustodyCenterPage()
pg.show()
pg.reload()
app.processEvents()
auth_service.set_current_user("sec31")
pg.reload()
app.processEvents()
check("الزر مخفي لغير المدير", pg.edit_btn.isHidden())
pg._edit_selected()  # توست فقط — بلا حوارات
app.processEvents()
check("رفض هادئ لغير المدير", True)
auth_service.set_current_user("admin")
pg.reload()
app.processEvents()
# V3.7: بلا طي — النقر ينقل لشاشة التصفيات ولوحتها تعرض البنود
rows = pg._ledger.get("rows") or []
srow = next((i for i, w in enumerate(pg._visible)
             if (w.get("item") or {}).get("kind") == "settlement"), None)
check("صف التصفية موجود", srow is not None)
if srow is not None:
    sref = (pg._visible[srow].get("item") or {}).get("ref") or ""
    _calls = []
    pg._open_in_settlements = lambda ref: (_calls.append(ref), True)[1]
    pg._cell_clicked(srow, 1)
    app.processEvents()
    check("النقر ينقل للتصفيات", _calls == [sref], _calls)
    from ui.custody_settlements import CustodySettlementsPage
    _sp = CustodySettlementsPage()
    _sp.show()
    app.processEvents()
    check("اللوحة تعرض البنود",
          _sp.select_settlement(sref) is True
          and _sp.lines.rowCount() >= 1
          and all(_sp._line_ids), _sp.lines.rowCount())

for _f in ("/tmp/v31.sqlite", "/tmp/v31.sqlite-shm", "/tmp/v31.sqlite-wal"):
    if os.path.exists(_f):
        os.remove(_f)
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
