# -*- coding: utf-8 -*-
"""V4.25: غير المدفوع مستبعد خالص + تاريخ الدفع = Updated.

يغطي: إسقاط Not Paid من العرض (مع العدّاد) · تاريخ العملية من
Updated للمدفوع · التوكن سجلًا · دمج إعادة الرفع بالمرجع بلا
تكرار · حراس التوزيع/الربط/التسديد · المستحق = محصَّل فقط ·
التقرير خارج منه الانتظار.
"""
import csv
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
    return False


G = "Hesabe"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.0)

HEADS = ["Created Date", "Customer Name", "Mobile Number", "Invoice Type",
         "Invoice Number", "Description", "Amount", "Invoice Status",
         "Updated Date", "Payment Status", "Payment Method",
         "Transaction Token", "Transaction Date"]


def _csv(name, rows):
    p = os.path.join(_tmpdir, name)
    with open(p, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADS)
        w.writerows(rows)
    return p


day1 = _csv("d1.csv", [
    ["'20-Sep-2026 10:00 AM", "عميل أ", "94440001", "SMS", "PA", "دفعة",
     "100", "Paid", "'21-Sep-2026 10:00 AM", "Success", "KNET",
     "'TKA123'", "'22-Sep-2026 09:00 AM"],
    ["'20-Sep-2026 11:00 AM", "عميل ب", "94440002", "SMS", "UB", "دفعة",
     "50", "Not Paid", "'20-Sep-2026 11:00 AM", "", "", "", ""],
    ["'20-Sep-2026 12:00 PM", "عميل ج", "94440003", "SMS", "CX", "دفعة",
     "30", "Cancelled", "'20-Sep-2026 12:00 PM", "", "", "", ""]])

from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.due_items_page import DueItemsPage  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))

print("=== 1. الاستيراد: إسقاط + تاريخ الدفع ===")
check("3 صفوف", pg.import_file(day1) == 3)
app.processEvents()
check("المعروض المدفوع فقط",
      len(pg._matched) == 1 and pg._nunpaid == 1
      and pg._ncancelled == 1
      and "1 غير مدفوعة (مستبعدة)" in pg.file_lbl.text()
      and "1 ملغاة (مستبعدة)" in pg.file_lbl.text(),
      pg.file_lbl.text())
_a = pg._matched[0]
check("التاريخ من Updated (21 لا 22)",
      _a["date"] == "2026-09-21"
      and _a["gw_paid_date"] == "2026-09-22"
      and _a["gw_token"] == "TKA123", str(_a))
with get_connection() as _c:
    _n = _c.execute("SELECT COUNT(*) FROM gateway_ops").fetchone()[0]
check("المحفوظ واحد فقط", _n == 1, _n)

print("=== 2. حراس التوزيع والربط ===")
st.distribute_rows(G, [("2026-09-21", "94440001", 100.0, "PA")])
st.save_gateway_ops(G, [{"date": "2026-09-20", "phone": "94440002",
                         "amount": 50.0, "ref": "UB",
                         "status": "other", "gw_paid": 0}], "x.csv")
check("توزيع غير المحصَّل مرفوض",
      st.distribute_rows(
          G, [("2026-09-20", "94440002", 50.0, "UB")])["skipped"] == 1)
check("ربطه مرفوض",
      st.op_ids_for(G, [("2026-09-20", "94440002", 50.0, "UB")]) == [])
with get_connection() as _c:
    _bid = _c.execute("SELECT id FROM gateway_ops "
                      "WHERE ref='UB'").fetchone()[0]
check("تسديده مرفوض",
      raises_valueerror(
          lambda: st.add_other_transfer("2026-09-23", 50.0,
                                        op_ids=[_bid])))

print("=== 3. إعادة الرفع: دخول ودمج بلا تكرار ===")
day2 = _csv("d2.csv", [
    ["'20-Sep-2026 11:00 AM", "عميل ب", "94440002", "SMS", "UB", "دفعة",
     "50", "Paid", "'23-Sep-2026 10:00 AM", "Success", "KNET",
     "'TKB456'", "'24-Sep-2026 10:00 AM"]])
pg.import_file(day2)
app.processEvents()
check("ظهر بعد الدفع",
      len(pg._matched) == 1 and pg._matched[0]["ref"] == "UB"
      and pg._matched[0]["date"] == "2026-09-23",
      len(pg._matched))
st.distribute_rows(G, [("2026-09-23", "94440002", 50.0, "UB")])
day1b = _csv("d1b.csv", [
    ["'20-Sep-2026 10:00 AM", "عميل أ", "94440001", "SMS", "PA", "دفعة",
     "100", "Paid", "'25-Sep-2026 10:00 AM", "Success", "KNET",
     "'TKA123'", "'26-Sep-2026 09:00 AM"]])
pg.import_file(day1b)
app.processEvents()
with get_connection() as _c:
    _rows = _c.execute("SELECT op_date FROM gateway_ops "
                       "WHERE ref='PA'").fetchall()
check("اندمج بالتاريخ الجديد بلا تكرار",
      len(_rows) == 1 and _rows[0][0] == "2026-09-25",
      str([dict(r) for r in _rows]))

print("=== 4. المستحق = محصَّل فقط ===")
st.save_gateway_ops(G, [{"date": "2026-09-20", "phone": "94440004",
                         "amount": 20.0, "ref": "UD",
                         "status": "other"}], "y.csv")
st.distribute_rows(G, [("2026-09-20", "94440004", 20.0, "UD")])
dp = DueItemsPage()
check("الإجمالي 170",
      dp.totals.text() == "3 بند · 170.000 د.ك", dp.totals.text())
dp.gw_combo2.setCurrentIndex(dp.gw_combo2.findData(1))
app.processEvents()
check("فلتر المحصَّل = 3", dp.table.rowCount() == 3,  # V4.41: محسوب
      dp.table.rowCount())
dp.gw_combo2.setCurrentIndex(dp.gw_combo2.findData(0))
app.processEvents()
check("فلتر غير المحصَّل = 0", dp.table.rowCount() == 0,
      dp.table.rowCount())
dp.gw_combo2.setCurrentIndex(dp.gw_combo2.findData(None))
app.processEvents()
_tok = ""
for _i, _r in enumerate(dp._shown):
    if _r["ref"] == "PA":
        _tok = dp.table.item(_i, 4).toolTip()
check("التوكن في التلميح", "TKA123" in _tok, _tok)

import ui.due_items_page as _dpmod  # noqa: E402

captured: dict = {}


class _FakeDlg:
    def __init__(self, parent, amount_preset=0.0, op_ids=None):
        captured["preset"] = amount_preset
        captured["ops"] = list(op_ids or [])

    def exec(self):
        return 0


from PySide6.QtCore import Qt  # noqa: E402

_orig_d = _dpmod.TransferDialog
_dpmod.TransferDialog = _FakeDlg
try:
    for _i, _r in enumerate(dp._shown):
        if _r["ref"] == "UD":
            dp.table.item(_i, 0).setCheckState(Qt.Checked)
    dp._pay_selected()
finally:
    _dpmod.TransferDialog = _orig_d
check("تسديد اليدوي يعمل",  # V4.41
      abs(captured.get("preset", 0) - 20.0) < 0.001
      and len(captured.get("ops", [])) == 1, str(captured))

print("=== 5. الشبح والتقرير ===")
st.save_gateway_ops(G, [{"date": "2026-09-20", "phone": "94440005",
                         "amount": 20.0, "ref": "U2",
                         "status": "other"}], "z.csv")
st.distribute_rows(G, [("2026-09-20", "94440005", 20.0, "U2")])
ghost = _csv("g.csv", [
    ["'20-Sep-2026 10:00 AM", "شبح", "94440005", "SMS", "U2", "دفعة",
     "20", "Not Paid", "'20-Sep-2026 10:00 AM", "", "", "", ""]])
pg.import_file(ghost)
app.processEvents()
check("الشبح خارج المستحق",
      "U2" not in {r["ref"] for r in st.unpaid_other_items()})
rep = st.other_external_report("2026-09-01", "2026-09-30")
check("التقرير (3 صفوف + انتظار 20)",
      len(rep["rows"]) == 3 and rep["pending"] == 20.0
      and rep["transferred"] == 150.0,
      str((len(rep["rows"]), rep["pending"], rep["transferred"])))
with get_connection() as _c:
    _gid = _c.execute("SELECT id FROM gateway_ops "
                      "WHERE ref='U2'").fetchone()[0]
check("تسديد الشبح مرفوض",
      raises_valueerror(
          lambda: st.add_other_transfer("2026-09-24", 20.0,
                                        op_ids=[_gid])))

print("=== 6. المسدد يُستثنى ===")
_ids = st.op_ids_for(G, [("2026-09-25", "94440001", 100.0, "PA")])
st.add_other_transfer("2026-09-26", 100.0, op_ids=_ids)
flip = _csv("f.csv", [
    ["'20-Sep-2026 10:00 AM", "عميل أ", "94440001", "SMS", "PA", "دفعة",
     "100", "Not Paid", "'20-Sep-2026 10:00 AM", "", "", "", ""]])
pg.import_file(flip)
app.processEvents()
check("بقي مسددًا",
      ("2026-09-25", "94440001", 100.0, "PA") in st.paid_lookup(G))

print("")
print("V4.25 exclusion: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
