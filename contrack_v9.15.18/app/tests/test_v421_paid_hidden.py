# -*- coding: utf-8 -*-
"""V4.21: المسدد يختفي من شاشة التصنيف (مغلق — لا إجراء عليه).

يغطي: إسقاط المسدد من المعروض حتى مع زر الموزعة · توثيق
المخفاة في سطر الملف · العدّاد والبطاقات بلا مسدد · الوجهات
كما هي (المستحق/الدفتر/التقرير).
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


G = "Hesabe"
D = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops(G, [
    {"date": D, "phone": "94440001", "amount": 100.0, "ref": "PA",
     "status": "other"},
    {"date": D, "phone": "94440002", "amount": 50.0, "ref": "UB",
     "status": "other"},
    {"date": D, "phone": "94440003", "amount": 70.0, "ref": "UM",
     "status": "mine"}], "f.csv")
st.distribute_rows(G, [(D, "94440001", 100.0, "PA"),
                       (D, "94440002", 50.0, "UB"),
                       (D, "94440003", 70.0, "UM")])
_ids = st.op_ids_for(G, [(D, "94440001", 100.0, "PA")])
st.add_other_transfer("2026-09-21", 99.85, op_ids=_ids)

from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "p.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "94440001,100.0,2026-09-20,PA,أ\n"
             "94440002,50.0,2026-09-20,UB,ب\n"
             "94440003,70.0,2026-09-20,UM,ج\n")

print("=== 1. المسدد خارج الشاشة ===")
check("استيراد 3", pg.import_file(csv_path) == 3)
app.processEvents()
check("المعروض 2 (المسدد مُسقط)",
      len(pg._matched) == 2
      and all(r["ref"] != "PA" for r in pg._matched),
      len(pg._matched))
check("الجدول فارغ (موزع مخفي)",
      pg.table.rowCount() == 0, pg.table.rowCount())
check("السطر يوثق المخفاة",
      "2 موزَّعة مسبقًا (في الموزَّع)" in pg.file_lbl.text()
      and "1 مسددة مسبقًا (مخفاة)" in pg.file_lbl.text(),
      pg.file_lbl.text())
check("بطاقة الكل = 2",
      pg._cards["total"].text() == "عمليتان\n120.000 د.ك",
      pg._cards["total"].text())
check("كارت الموزَّع = UM + UB معًا والمسدَّد PA مخفي",  # V4.30 + V4.5.12.1
      pg._cards["dist"].text() == "عمليتان\n120.000 د.ك"
      and "موزَّع على شركتنا: عملية واحدة" in pg._cards["dist"].toolTip()
      and "موزَّع على شركة أخرى: عملية واحدة" in pg._cards["dist"].toolTip(),
      (pg._cards["dist"].text(), pg._cards["dist"].toolTip()))
pg.set_filter("dist")
app.processEvents()
check("الموزَّع يكشف UM بحالة يومها وصاحبته UB بشارة الأخرى",
      # V4.5.12.1: صف «شركة أخرى» الموزَّع صار ظاهرًا للتحديد والإرجاع
      pg.table.rowCount() == 2
      and pg.table.item(0, 5).text() == "UM"
      and pg.table.item(0, 6).text() == "✅ شركتنا"
      and "🏦 يوم:" in pg.table.item(0, 10).text()
      and pg.table.item(1, 5).text() == "UB"
      and pg.table.item(1, 6).text() == "🏢 شركة أخرى"
      and pg.table.item(1, 7).text() == "🔒 موزَّعة — شركة أخرى",
      [(pg.table.item(i, 5).text(), pg.table.item(i, 6).text())
       for i in range(pg.table.rowCount())])
pg.set_filter("all")

print("=== 2. الوجهات سليمة ===")
check("المستحق = UB فقط",
      [r["ref"] for r in st.unpaid_other_items()] == ["UB"])
check("الموزع-لنا = UM فقط",
      [r["ref"] for r in st.distributed_mine_rows()] == ["UM"])

print("")
print("V4.21 paid-hidden: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
