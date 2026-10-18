# -*- coding: utf-8 -*-
"""V4.43: شاشة تسديدات الشركة — مجمعات التواريخ.

§1 الخدمة · §2 الصفحة · §3 التسجيل في القائمة.
"""
import os
import sys
import tempfile
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v443_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

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


G = "KNET"
st.save_profile(None, G, "بنك K", "KNET", 1, 0.150)
st.ensure_ops_table()
with database.get_connection() as conn:
    conn.executemany(
        "INSERT INTO gateway_ops (gateway, op_date, phone, amount, ref,"
        " status, customer, batch, gw_paid, distributed,"
        " classified_manual, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [(G, "2026-09-30", "92220001", 500.0, "A1", "other", "أول",
          "B1.xlsx", 1, 1, 1, "2026-10-01 10:00:00"),
         (G, "2026-10-01", "92220002", 300.0, "A2", "other", "ثانٍ",
          "B1.xlsx", 1, 1, 1, "2026-10-01 10:00:00"),
         (G, "2026-10-01", "92220003", 200.0, "A3", "other", "ثالث",
          "B1.xlsx", 1, 1, 1, "2026-10-01 10:00:00")])
    _ids = {r["ref"]: r["id"] for r in conn.execute(
        "SELECT id, ref FROM gateway_ops").fetchall()}
t1 = st.add_other_transfer("2026-10-02", 799.7, "TR1", "", "تحويل بنكي",
                           [_ids["A1"], _ids["A2"]])
t2 = st.add_other_transfer("2026-10-03", 500.0, "TR2", "", "نقدي", [])
t3 = st.add_other_transfer("2026-10-04", 100.0, "", "", "تحويل بنكي", [])
with database.get_connection() as conn:  # ربط قديم بلا توزيع
    conn.execute("UPDATE gateway_ops SET paid_transfer_id=? WHERE id=?",
                 (t2, _ids["A3"]))

print("=== 1. الخدمة ===")
summ = st.list_transfers_summary("2026-10-01", "2026-10-31")
check("3 تسديدات مرتبة",
      [t["id"] for t in summ] == [t1, t2, t3])
_by = {t["id"]: t for t in summ}
check("الحالات",
      (_by[t1]["status"], _by[t2]["status"], _by[t3]["status"])
      == ("full", "partial", "open"),
      [t["status"] for t in summ])
check("ت1: مربوط كامل بتاريخين",
      _by[t1]["alloc"] == 799.7 and _by[t1]["unalloc"] == 0.0
      and _by[t1]["n_ops"] == 2
      and _by[t1]["dates"] == ["2026-09-30", "2026-10-01"]
      and _by[t1]["dates_short"] == "30/09، 01/10",
      _by[t1]["dates_short"])
check("ت2: جزئي (200 مربوط من 500)",
      _by[t2]["alloc"] == 200.0 and _by[t2]["unalloc"] == 300.0
      and _by[t2]["n_ops"] == 1)
check("ت3: على الحساب",
      _by[t3]["alloc"] == 0.0 and _by[t3]["unalloc"] == 100.0
      and _by[t3]["n_ops"] == 0 and _by[t3]["dates_short"] == "")
cov = st.transfer_coverage(t1)
check("المجموعات",
      [(g["date"], g["n"], g["net"], g["paid"]) for g in cov["groups"]]
      == [("2026-09-30", 1, 499.85, 499.85),
          ("2026-10-01", 1, 299.85, 299.85)],  # التوزيع بالصافي
      cov["groups"])
check("الإجماليات",
      cov["totals"]["amount"] == 799.7
      and cov["totals"]["alloc"] == 799.7
      and cov["totals"]["unalloc"] == 0.0
      and cov["totals"]["n_ops"] == 2)

print("=== 2. الصفحة ===")
from PySide6.QtWidgets import QApplication, QFileDialog  # noqa: E402
from ui.other_transfers_page import OtherTransfersPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = OtherTransfersPage()
pg.d1.setDate(pg.d1.date().fromString("2026-10-01", "yyyy-MM-dd"))
pg.d2.setDate(pg.d2.date().fromString("2026-10-31", "yyyy-MM-dd"))
app.processEvents()
check("3 صفوف + إجمالي",
      pg.table.columnCount() == 9
      and pg.table.rowCount() == 4
      and pg.table.item(0, 0).text() == f"ت{t1}"
      and pg.table.item(0, 1).text() == "2026-10-02"
      and pg.table.item(0, 7).text() == "30/09، 01/10"
      and pg.table.item(0, 8).text() == "🟢 مربوط كامل"
      and pg.table.item(1, 8).text() == "🟡 مربوط جزئي"
      and pg.table.item(2, 8).text() == "🔵 على الحساب"
      and pg.table.item(3, 1).text() == "⚖️ الإجمالي"
      and pg.table.item(3, 3).text() == "1,399.700")
pg.status.setCurrentData("full")
app.processEvents()
check("فلتر المربوط كامل",
      pg.table.rowCount() == 2
      and pg.table.item(0, 0).text() == f"ت{t1}")
pg.status.setCurrentData("open")
app.processEvents()
check("فلتر على الحساب",
      pg.table.rowCount() == 2
      and pg.table.item(0, 0).text() == f"ت{t3}")
pg.status.setCurrentData("all")
pg.search.setText("نقدي")
app.processEvents()
check("البحث بالطريقة",
      pg.table.rowCount() == 2
      and pg.table.item(0, 0).text() == f"ت{t2}")
pg.search.setText("")
app.processEvents()
pg._on_row_click(0, 0)
app.processEvents()
check("تفصيل المجموعات",
      not pg.detail_box.isHidden()
      and pg.groups_table.rowCount() == 3
      and pg.groups_table.item(0, 0).text() == "2026-09-30"
      and pg.groups_table.item(1, 0).text() == "2026-10-01"
      and pg.groups_table.item(2, 0).text() == "⚖️ الإجمالي"
      and pg.groups_table.item(2, 3).text() == "799.700"
      and f"ت{t1}" in pg.detail_info.text()
      and "الباقي: 0.000" in pg.detail_info.text())
_calls: list = []
with mock.patch.object(QFileDialog, "getSaveFileName",
                       return_value=(os.path.join(_tmpdir, "x"),
                                     "")), \
        mock.patch("reports.tabular_pdf.generate_table_excel",
                   side_effect=lambda *a, **k: _calls.append(("x", a))), \
        mock.patch("reports.tabular_pdf.generate_table_pdf",
                   side_effect=lambda *a, **k: _calls.append(("p", a))), \
        mock.patch("ui.style.info"), \
        mock.patch("ui.invoices.open_file_externally"):
    pg._export_excel()
    pg._print_pdf()
check("تصدير + طباعة",
      [c[0] for c in _calls] == ["x", "p"]
      and _calls[0][1][0] == "تسديدات الشركة الأخرى"
      and len(_calls[0][1][2]) == 4
      and _calls[1][1][0] == "تسديدات الشركة الأخرى")

print("=== 3. التسجيل ===")
from ui.main_window import IDX_TRANSFERS, PAGE_PERMS, MainWindow  # noqa: E402
from ui.other_transfers_page import OtherTransfersPage as TP2  # noqa: E402

check("ثابت + صلاحية",
      IDX_TRANSFERS == 16 and PAGE_PERMS[IDX_TRANSFERS]
      == "screen_gateway")
from services import auth_service, feature_service  # noqa: E402

_op, _of = auth_service.has_permission, feature_service.enabled
auth_service.has_permission = lambda *a, **k: True
feature_service.enabled = lambda *a, **k: True
try:
    win = MainWindow()
    check("زر القائمة موجود",
          any("تسديدات الشركة" in b.text()
              for b in win.nav_group.buttons()))
    tp = win.transfers_page
    check("الصفحة تُبنى", isinstance(tp, TP2))
finally:
    auth_service.has_permission, feature_service.enabled = _op, _of

print("")
print(f"V4.43 transfers: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
