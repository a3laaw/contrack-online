# -*- coding: utf-8 -*-
"""V4.36: علامة التوزيع + الصافي بعد العمولة.

§1 مساعد الشارة (الحالات الأربع) · §2 شاشة المطابقة (عمودا الصافي
والحالة + سطر العمولة + عدّاد الجاهزة/المتخطاة) · §3 الخدمة (صافي
شركتنا) · §4 نطاق شركتنا (الكامل والصافي شاشة ومصنفًا).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v436_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


from database import database  # noqa: E402
from services import settlement_service as st  # noqa: E402

database.init_db()

print("=== 1. مساعد الشارة ===")
from ui.gateway_page import _dist_badge  # noqa: E402

check("موزعة", _dist_badge({"distributed": 1}) == "🔒 موزَّعة")
check("مسددة", _dist_badge({"paid_before": 1}) == "⏭ مسددة")
check("جاهزة شركتنا", _dist_badge({"status": "mine"}) == "✓ جاهزة")
check("جاهزة أخرى", _dist_badge({"status": "other"}) == "✓ جاهزة")
check("تُتخطى", _dist_badge({"status": "unmarked"}) == "… تُتخطى")
check("مجهول يُتخطى", _dist_badge({}) == "… تُتخطى")

print("=== 2. شاشة المطابقة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

G = "KNET"
st.save_profile(None, G, "بنك K", "KNET", 1, 0.150)
app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "m.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "95550001,100.0,2026-09-20,R1,أ\n"
             "95550002,200.0,2026-09-20,R2,ب\n"
             "95550003,300.0,2026-09-20,R3,ج\n")
check("استيراد 3", pg.import_file(csv_path) == 3)
app.processEvents()
check("11 عمودًا: الصافي@3 والحالة@7 والتصنيف@6",
      pg.table.columnCount() == 11
      and pg.table.horizontalHeaderItem(3).text() == "الصافي"
      and pg.table.horizontalHeaderItem(6).text() == "التصنيف"
      and pg.table.horizontalHeaderItem(7).text() == "الحالة",
      pg.table.columnCount())
check("الصافي = المبلغ − 0.150",
      pg.table.item(0, 3).text() == "99.850"
      and pg.table.item(1, 3).text() == "199.850",
      pg.table.item(0, 3).text())
check("تلقائي الغريب ← أخرى جاهزة",
      all(pg.table.item(i, 6).text() == "🏢 شركة أخرى"
          for i in range(3))
      and all(pg.table.item(i, 7).text() == "✓ جاهزة"
              for i in range(3))
      and pg.dist_btn.text() == "◆ توزيع (3 عمليات)",
      pg.dist_btn.text())
check("سطر العمولة من الملف",
      "0.150" in pg.fee_lbl.text() and G in pg.fee_lbl.text(),
      pg.fee_lbl.text())
pg._on_cell(2, 6)  # أخرى ← بدون
app.processEvents()
check("إلغاء التصنيف يُظهر المتخطاة",
      pg.table.item(2, 6).text() == "⚪ غير مصنّف"
      and pg.table.item(2, 7).text() == "… تُتخطى"
      and pg.dist_btn.text() == "◆ توزيع (عمليتان · ⏭ 1)",
      pg.dist_btn.text())
pg._on_cell(2, 6)  # بدون ← شركتنا
pg._on_cell(0, 6)  # أخرى ← بدون
pg._on_cell(0, 6)  # بدون ← شركتنا
app.processEvents()
check("التصنيف شركتنا يُجهّز",
      pg.table.item(0, 6).text() == "✅ شركتنا"
      and pg.table.item(2, 6).text() == "✅ شركتنا"
      and pg.table.item(0, 7).text() == "✓ جاهزة"
      and pg.dist_btn.text() == "◆ توزيع (3 عمليات)",
      pg.dist_btn.text())
pg._distribute()
app.processEvents()
pg.set_filter("dist")
app.processEvents()
check("الموزَّع: شركتنا بشارة القفل والصافي + صف «شركة أخرى» ظاهر",
      # V4.5.12.1: صف شركة أخرى الموزَّع صار ظاهرًا بشارته الخاصة
      pg.table.rowCount() == 3
      and {pg.table.item(i, 7).text() for i in range(3)}
      == {"🔒 موزَّعة", "🔒 موزَّعة — شركة أخرى"}
      and {pg.table.item(i, 3).text() for i in range(2)}
      == {"99.850", "299.850"}
      and pg.table.item(2, 7).text() == "🔒 موزَّعة — شركة أخرى",
      [(pg.table.item(i, 3).text(), pg.table.item(i, 7).text())
       for i in range(pg.table.rowCount())])

print("=== 3. صافي شركتنا (خدمة) ===")
with database.get_connection() as conn:
    conn.executemany(
        "INSERT INTO gateway_ops (gateway, op_date, phone, amount, ref,"
        " status, customer, batch, gw_paid, distributed,"
        " classified_manual, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [(G, "2026-09-15", "95550001", 100.0, "S1", "mine", "نورة",
          "F436.xlsx", 1, 1, 1, "2026-09-26 10:00:00"),
         (G, "2026-09-15", "95550002", 200.0, "S2", "mine", "نورة",
          "F436.xlsx", 1, 1, 1, "2026-09-26 10:00:00")])
_md = st.batch_mine_detail(G, "F436.xlsx", "2026-09-26")
check("الصافي عملية-عملية",
      [_o["net"] for _o in _md["ops"]] == [99.85, 199.85],
      [o["net"] for o in _md["ops"]])
check("الإجماليات: كامل/عمولة/صافي",
      _md["totals"] == {"n": 2, "total": 300.0, "fees": 0.3,
                        "net": 299.7},
      _md["totals"])
_rep = st.upload_batches_report()
_rb = next(b for b in _rep if b["batch"] == "F436.xlsx")
check("mine_net في التقرير",
      _rb["mine_total"] == 300.0 and _rb["mine_net"] == 299.7
      and _rb["n_mine"] == 2,
      (_rb["mine_total"], _rb["mine_net"]))

print("=== 4. تقرير العمليات (شاشة ومصنف) ===")  # V4.40: بدل نطاق شركتنا
from ui.other_company_page import OtherCompanyPage  # noqa: E402

oc = OtherCompanyPage()
oc.mode.setCurrentData("ops")
app.processEvents()
check("عملية الأخرى وحدها بالصافي",
      oc.table.columnCount() == 8
      and oc.table.rowCount() == 2
      and oc.table.item(0, 1).text() == "ب"
      and oc.table.item(0, 4).text() == "199.850"
      and oc.table.item(0, 7).text() == "📌 مستحق"
      and oc.table.item(1, 1).text() == "⚖️ الإجمالي"
      and oc.table.item(1, 4).text() == "199.850",
      oc.table.rowCount())
_w = oc._ops_workbook_data()
check("المصنف: ورقة العمليات بالإجمالي",
      _w[0]["name"] == "العمليات" and len(_w[0]["heads"]) == 8
      and _w[0]["rows"][-1][4] == 199.85
      and _w[0]["rows"][-1][6] == 199.85,
      _w[0]["rows"][-1])

print("")
print(f"V4.36 dist-marks: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
