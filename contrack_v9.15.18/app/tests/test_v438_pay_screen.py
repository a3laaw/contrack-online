# -*- coding: utf-8 -*-
"""V4.38: شاشة التسديد — تبويبا المستحق/المسدد + عمود الصافي + تصدير ظاهر.

§1 الخدمة (المسدد كاملًا + القديم) · §2 المستقلة (تبويبات/أعمدة/
تصدير) · §3 المضمّنة (تسمية/ربط/بيانات التصدير).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v438_")
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
        [(G, "2026-09-10", "92220001", 500.0, "P1", "other", "كامل",
          "B1.xlsx", 1, 1, 1, "2026-09-11 10:00:00"),
         (G, "2026-09-10", "92220002", 200.0, "P2", "other", "جزئي",
          "B1.xlsx", 1, 1, 1, "2026-09-11 10:00:00"),
         (G, "2026-09-12", "92220003", 100.0, "P3", "other", "جديد",
          "B1.xlsx", 1, 1, 1, "2026-09-13 10:00:00"),
         (G, "2026-09-11", "92220004", 300.0, "PT", "other", "قديم",
          "B1.xlsx", 1, 1, 1, "2026-09-11 10:00:00")])
    _ids = {r["ref"]: r["id"] for r in conn.execute(
        "SELECT id, ref FROM gateway_ops").fetchall()}
t1 = st.add_other_transfer("2026-09-15", 499.85, "TR1", "", "تحويل بنكي",
                           [_ids["P1"]])
st.add_other_transfer("2026-09-16", 100.0, "TR2", "", "نقدي",
                      [_ids["P2"]])
t3 = st.add_other_transfer("2026-09-20", 1000.0, "TR3", "", "تحويل بنكي",
                           [])
with database.get_connection() as conn:
    conn.execute("UPDATE gateway_ops SET paid_transfer_id=? WHERE id=?",
                 (t3, _ids["PT"]))

print("=== 1. الخدمة ===")
paid = st.paid_other_items()
check("مسددتان الأحدث أولًا", [o["ref"] for o in paid] == ["PT", "P1"],
      [o["ref"] for o in paid])
p1 = next(o for o in paid if o["ref"] == "P1")
check("الكاملة: صافي/مدفوع/تسديد",
      (p1["gross"], p1["fee"], p1["net"], p1["paid"])
      == (500.0, 0.15, 499.85, 499.85)
      and p1["transfer_id"] == t1 and p1["tdate"] == "2026-09-15"
      and p1["method"] == "تحويل بنكي",
      (p1["net"], p1["paid"], p1["transfer_id"]))
pt = next(o for o in paid if o["ref"] == "PT")
check("القديمة: المدفوع = الصافي",
      (pt["gross"], pt["net"], pt["paid"]) == (300.0, 299.85, 299.85)
      and pt["transfer_id"] == t3 and pt["tdate"] == "2026-09-20")

print("=== 2. المستقلة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.due_items_page import DueItemsPage  # noqa: E402

app = QApplication.instance() or QApplication([])
dp = DueItemsPage()
check("تبويبان والافتراضي المستحق",
      [b.text() for b in dp.view._buttons]
      == ["📌 المستحق", "✅ المسدد"]
      and dp.view.currentData() == "due")
check("المستحق: 10 أعمدة والصافي@5",  # V4.50: + إجمالي الملف
      dp.table.columnCount() == 10
      and dp.table.horizontalHeaderItem(5).text() == "الصافي"
      and dp.table.rowCount() == 2
      and dp.table.item(0, 3).text() == "جزئي"
      and dp.table.item(0, 5).text() == "199.850"
      and dp.table.item(0, 6).text() == "99.850"
      and dp.table.item(0, 7).text() == "100.000"
      and dp.table.item(0, 8).text() == "✅ 2026-09-13",
      dp.table.rowCount())
check("التصدير مخفي بلا رد", dp.export_btn.isHidden())
dp.view.setCurrentData("paid")
app.processEvents()
check("المسدد: 8 أعمدة بلا ☐",  # V4.41: بلا مرجع
      dp.table.columnCount() == 8
      and dp.table.horizontalHeaderItem(0).text() == "التاريخ"
      and dp.table.rowCount() == 2
      and dp.table.item(0, 1).text() == "قديم"
      and dp.table.item(0, 4).text() == "299.850"
      and dp.table.item(0, 5).text() == "299.850"
      and dp.table.item(0, 6).text() == f"ت{t3}"
      and dp.table.item(0, 7).text() == "2026-09-20"
      and dp.all_btn.isHidden()
      and dp.gw_combo2.isHidden())
dp.view.setCurrentData("due")
app.processEvents()
check("العودة للمستحق", dp.table.columnCount() == 10
      and not dp.all_btn.isHidden())
got: dict = {}
dp2 = DueItemsPage(on_export=lambda: got.update({"x": True}))
check("التصدير ظاهر بالرد", not dp2.export_btn.isHidden())
dp2.export_btn.click()
check("النقر ينادي الرد", got.get("x") is True)

print("=== 3. المضمّنة ===")
from ui import other_company_page as ocmod  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402

oc = OtherCompanyPage()
check("تبويبا التسديد",
      [b.text() for b in oc.mode._buttons][:3]
      == ["📌 المستحق", "✅ المسدد", "📊 التقرير"])
oc.mode.setCurrentData("due")
app.processEvents()
em = oc.dues_embed
check("المضمّنة مربوطة",
      not em.isHidden() and em.export_btn.isHidden()  # V4.42: مكرر
      and em.table.rowCount() == 2 and em.view.isHidden())
oc.mode.setCurrentData("paid")
app.processEvents()
check("المسدد مضمّنًا",
      em.table.rowCount() == 2
      and em.table.item(1, 1).text() == "كامل"
      and em.table.item(1, 6).text() == f"ت{t1}")
cap: dict = {}
_orig = ocmod.export_table_excel
ocmod.export_table_excel = lambda *a, **k: cap.update(
    {"title": a[1], "heads": a[2], "rows": a[3]})
try:
    oc._export_paid()
    _pcap = dict(cap)
    oc.mode.setCurrentData("due")
    app.processEvents()
    oc._export_dues()
    _dcap = dict(cap)
finally:
    ocmod.export_table_excel = _orig
check("تصدير المسدد: عناوين وصفوف",
      _pcap["heads"][4] == "الصافي" and len(_pcap["rows"]) == 2
      and _pcap["rows"][0][5] == 299.85,
      _pcap["heads"])
check("تصدير المستحق سليم",
      _dcap["heads"][4] == "المتبقي" and len(_dcap["rows"]) == 2
      and _dcap["rows"][0][4] == 99.85)

print("")
print(f"V4.38 pay-screen: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
