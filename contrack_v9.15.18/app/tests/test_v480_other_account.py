# -*- coding: utf-8 -*-
"""V4.8: مركز حساب الشركة الأخرى — افتتاحي + كشف + ربط + مسدد مسبقًا + سند.

يغطي: الافتتاحي · المستحق والرصيد · تسديد مرتبط بعمليات ·
تعليم المسدد عند إعادة الرفع وتجاهله · الكشف الجاري ·
سند الصرف التلقائي ومنع حذف المرتبط · فك الربط بالحذف ·
تدفق التصنيف (معلّق + جماعي + مستحق فوري).
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
from services import settlement_service as st  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


def raises_valueerror(fn):
    try:
        fn()
    except ValueError:
        return True
    except Exception:
        return False
    return False


print("=== 1. الافتتاحي ===")
check("الافتراضي صفر", st.get_other_opening()["amount"] == 0)
check("السالب مرفوض", raises_valueerror(lambda: st.set_other_opening(-5)))
st.set_other_opening(2000.0, "قديم")
check("حفظ واسترجاع",
      st.get_other_opening() == {"amount": 2000.0, "note": "قديم"},
      str(st.get_other_opening()))

print("=== 2. المستحق والرصيد ===")
D = "2026-09-20"
st.save_profile(None, "T", "بنك T", "KNET", 0, 0.0)
st.save_gateway_ops("T", [
    {"date": D, "phone": "99110011", "amount": 100.0, "ref": "R1",
     "status": "other", "receipt_no": "", "customer": ""},
    {"date": D, "phone": "99220022", "amount": 50.0, "ref": "R2",
     "status": "other", "receipt_no": "", "customer": ""}], "b1")
st.save_bank_lines("بنك T", [{"cdate": D, "amount": 150.0, "descr": "x"}],
                   "b1")
st.distribute_rows("T", [(D, "99110011", 100.0, "R1"),
                         (D, "99220022", 50.0, "R2")])
check("المستحق 150", abs(st.other_dues_total() - 150.0) < 0.001)
bal = st.other_balance()
check("الرصيد يشمل الافتتاحي 2150/0/2150",
      abs(bal["dues"] - 2150.0) < 0.001 and bal["paid"] == 0
      and abs(bal["remaining"] - 2150.0) < 0.001, str(bal))

print("=== 3. تسديد مرتبط ===")
ids = st.op_ids_for("T", [(D, "99110011", 100.0, "R1"),
                           (D, "99220022", 50.0, "R2")])
check("معرفا العمليتين", len(ids) == 2, str(ids))
t1 = st.add_other_transfer("2026-09-21", 150.0, "HV-1", "", "تحويل بنكي",
                           ids, False)
check("التسديد غطى عمليتين", len(st.transfer_ops(t1)) == 2)
bal = st.other_balance()
check("المتبقي 2000", abs(bal["remaining"] - 2000.0) < 0.001, str(bal))

print("=== 4. مسدد مسبقًا ===")
again = [{"date": D, "phone": "99110011", "amount": 100.0, "ref": "R1"},
         {"date": D, "phone": "99220022", "amount": 50.0, "ref": "R2"}]
check("تعليم الصفين",
      st.mark_paid_before(again, "T") == 2
      and "تسديد #1" in (again[0].get("paid_before") or ""), str(again))
check("تجاهل المسدد من الربط",
      st.op_ids_for("T", [(D, "99110011", 100.0, "R1")]) == [])
check("ربط المسدد مرفوض",
      raises_valueerror(lambda: st.add_other_transfer(
          "2026-09-22", 100.0, "", "", "", ids[:1], False)))

print("=== 5. الكشف الجاري ===")
led = st.other_ledger("2026-09-01", "2026-09-26")
lines = led["lines"]
check("سطر مستحق + سطر تسديد", len(lines) == 2
      and lines[0]["kind"] == "due" and lines[1]["kind"] == "pay",
      str([(x["kind"], x["balance"]) for x in lines]))
check("الرصيد الجاري 2150 ← 2000",
      abs(lines[0]["balance"] - 2150.0) < 0.001
      and abs(lines[1]["balance"] - 2000.0) < 0.001)
check("الأول 2000 والنهائي 2000",
      abs(led["prior"] - 2000.0) < 0.001
      and abs(led["end"] - 2000.0) < 0.001, str((led["prior"], led["end"])))

print("=== 6. بلا سند صرف (V4.5.13) ===")
with get_connection() as conn:
    _v0 = conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
t2 = st.add_other_transfer("2026-09-23", 25.0, "HV-2", "", "تحويل بنكي",
                           [], True)      # create_voucher تُتجاهل الآن
tr = st.get_transfer(t2)
check("بلا سند صرف ولا رقم",
      int(tr["voucher_id"] or 0) == 0 and not (tr["voucher_number"] or ""),
      str(tr))
with get_connection() as conn:
    _v1 = conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
    acc = conn.execute("SELECT 1 FROM expense_accounts WHERE name=?",
                       (st.OTHER_EXPENSE_ACCOUNT,)).fetchone()
check("لم يُنشأ أي سند", _v1 == _v0, (_v0, _v1))
check("لا حساب مصروف للشركة الأخرى", not acc)
check("لا سند عمولة تبعي", st.transfer_fee_voucher(t2) is None)
check("الحذف متاح (لا سند يحجبه)", st.get_transfer(t2) is not None)
st.delete_other_transfer(t2)
check("حُذف التسديد الثاني", st.get_transfer(t2) is None)

print("=== 7. فك الربط ===")
st.delete_other_transfer(t1)
check("لا عمليات مسددة", st.paid_lookup("T") == {})
check("لا مدفوع بعد حذف التسديدين",
      abs(st.other_balance()["paid"]) < 0.001, st.other_balance())

print("=== 8. تدفق التصنيف ===")
_ids2 = st.op_ids_for("T", [(D, "99110011", 100.0, "R1"),
                             (D, "99220022", 50.0, "R2")])
st.add_other_transfer("2026-09-24", 150.0, "HV-3", "", "", _ids2, False)
from openpyxl import Workbook  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

wb = Workbook()
ws = wb.active
ws.append(["م", "رقم الهاتف", "المبلغ", "تاريخ التسوية", "المرجع"])
ws.append([1, "99110011", 100.0, D, "R1"])
ws.append([2, "99220022", 50.0, D, "R2"])
ws.append([3, "99330033", 75.0, "2026-09-22", "R9"])
_xlsx = os.path.join(_tmpdir, "gw2.xlsx")
wb.save(_xlsx)
_app = QApplication.instance() or QApplication([])
import ui.gateway_page as _gp  # noqa: E402

pg = _gp.GatewayPage(embedded=True)
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData("T"))
check("الاستيراد 3 صفوف", pg.import_file(_xlsx) == 3)
check("الموزَّعان مخفيان (الظاهر الجديد مقترحًا)",
      pg.table.rowCount() == 1
      and pg.table.item(0, 6).text() == "🏢 شركة أخرى"
      and "✨ مقترح" in pg.table.item(0, 10).text(),
      pg.table.rowCount())
pg.set_filter("dist")
check("المسددان خارج الموزَّع",
      all(pg.table.item(i, 5).text() not in ("R1", "R2")
          for i in range(pg.table.rowCount())))
pg.set_filter("unmarked")
check("فلتر المعلّق = صفر (الجديد مقترح)", pg.table.rowCount() == 0,
      pg.table.rowCount())
pg.set_filter("other")
check("فلتر الأخرى = الجديد المقترح", pg.table.rowCount() == 1,
      pg.table.rowCount())
from ui import style as _style  # noqa: E402

_orig_ok = _style.success
_style.success = lambda *a, **k: None
try:
    pg._bulk("other")
finally:
    _style.success = _orig_ok
check("الجماعي أكّد الجديد أخرى (ومسح الشارة)",
      pg.table.rowCount() == 1
      and "✨" not in pg.table.item(0, 10).text(),
      pg.table.rowCount())
check("بلا أثر قبل التوزيع",
      abs(st.other_dues_total() - 150.0) < 0.001,
      st.other_dues_total())
pg.set_filter("all")
_style.success = lambda *a, **k: None
try:
    pg._distribute()
finally:
    _style.success = _orig_ok
check("المستحق = 150 + 75 بعد التوزيع",
      abs(st.other_dues_total() - 225.0) < 0.001,
      st.other_dues_total())

print("")
print("V4.8 account: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
