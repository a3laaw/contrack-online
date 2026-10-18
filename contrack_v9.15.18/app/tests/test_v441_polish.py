# -*- coding: utf-8 -*-
"""V4.41: بلا لوحة سفلية/مرجع/رجوع + التحصيل محسوب من التاريخ.

§1 قاعدة التحصيل · §2 شاشة المستحق · §3 الحذوفات.
"""
import os
import sys
import tempfile
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v441_")
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


print("=== 1. القاعدة ===")
check("أحد←اثنين", st.expected_collection_date("2026-09-06")
      == "2026-09-07")
check("أربعاء←خميس", st.expected_collection_date("2026-09-09")
      == "2026-09-10")
for _d, _lbl in (("2026-09-10", "خميس"), ("2026-09-11", "جمعة"),
                 ("2026-09-12", "سبت")):
    check(f"{_lbl}←الأحد", st.expected_collection_date(_d)
          == "2026-09-13", st.expected_collection_date(_d))
check("المخزَّن أولًا",
      st.collection_status("2026-09-10", "2026-09-10", 1, "2026-09-11")
      == (True, "2026-09-11"))
check("تلقائي بعد الموعد",
      st.collection_status("2026-09-10", "2026-09-13")
      == (True, "2026-09-13"))
check("غير محصَّل قبل الموعد",
      st.collection_status("2026-09-10", "2026-09-12")
      == (False, "2026-09-13"))

print("=== 2. المستحق ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.due_items_page import DueItemsPage  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402

G = "KNET"
TODAY = date.today().isoformat()
OLD = (date.today() - timedelta(days=10)).isoformat()
st.save_profile(None, G, "بنك K", "KNET", 1, 0.150)
st.ensure_ops_table()
with database.get_connection() as conn:
    conn.executemany(
        "INSERT INTO gateway_ops (gateway, op_date, phone, amount, ref,"
        " status, customer, batch, gw_paid, distributed,"
        " classified_manual, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [(G, OLD, "92220001", 100.0, "OLD", "other", "قديمة",
          "B1.xlsx", None, 1, 1, OLD + " 10:00:00"),
         (G, TODAY, "92220002", 200.0, "NEW", "other", "جديدة",
          "B1.xlsx", None, 1, 1, TODAY + " 10:00:00")])
app = QApplication.instance() or QApplication([])
dp = DueItemsPage()
check("10 أعمدة (إجمالي الملف@9)",
      dp.table.columnCount() == 10
      and dp.table.horizontalHeaderItem(8).text() == "التحصيل")
check("القديمة محصَّلة بالتاريخ المحسوب",
      dp.table.item(0, 8).text()
      == "✅ " + st.expected_collection_date(OLD),
      dp.table.item(0, 8).text())
check("الجديدة غير محصَّلة",
      dp.table.item(1, 8).text() == "⏳ غير محصَّل",
      dp.table.item(1, 8).text())
check("تلميح القاعدة",
      "الأحد" in dp.table.item(0, 8).toolTip())
dp.gw_combo2.setCurrentIndex(dp.gw_combo2.findData(1))
app.processEvents()
check("فلتر المحصَّل",
      dp.table.rowCount() == 1
      and dp.table.item(0, 3).text() == "قديمة")
dp.gw_combo2.setCurrentIndex(dp.gw_combo2.findData(0))
app.processEvents()
check("فلتر غير المحصَّل",
      dp.table.rowCount() == 1
      and dp.table.item(0, 3).text() == "جديدة")
dp.gw_combo2.setCurrentIndex(dp.gw_combo2.findData(None))
_rows = st.unpaid_other_items()
_ids = {r["ref"]: r["id"] for r in _rows}
_t = st.add_other_transfer(TODAY, 99.85, "", "", "نقدي",
                           [_ids["OLD"]])
dp.refresh()
dp.view.setCurrentData("paid")
app.processEvents()
check("المسدد 8 أعمدة + تلميح التسديد",
      dp.table.columnCount() == 8
      and dp.table.horizontalHeaderItem(7).text() == "تاريخ التسديد"
      and dp.table.item(0, 6).text() == f"ت{_t}"
      and f"تسديد رقم {_t}" in dp.table.item(0, 6).toolTip()
      and dp.table.item(0, 7).text() == TODAY)

print("=== 3. الحذوفات ===")
oc = OtherCompanyPage()
check("بلا زر رجوع", not hasattr(oc, "back_btn"))
check("بلا تفاصيل عمليات",
      not hasattr(oc, "_on_ops_click")
      and not hasattr(oc, "_render_op_detail")
      and not hasattr(oc, "_open_pay"))
oc.d1.setDate(oc.d1.date().fromString(OLD, "yyyy-MM-dd"))
oc.mode.setCurrentData("ops")
app.processEvents()
oc._on_table_click(0, 0)
app.processEvents()
check("النقر لا يفتح لوحة", oc.detail_box.isHidden())

print("")
print(f"V4.41 polish: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
