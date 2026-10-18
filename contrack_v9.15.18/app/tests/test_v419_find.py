# -*- coding: utf-8 -*-
"""V4.19: العثور على الموزع — زر بعدّاد + ملخص قفز للوجهة.

يغطي: زر 🔒 الموزعة البارز بعدّاد المخفية · توافقه مع setChecked ·
ملخص ما بعد التوزيع (بلا حوار مشروط) · قفزتي شركتنا/الأخرى.
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

from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])


def _csv(name, rows):
    p = os.path.join(_tmpdir, name)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write("phone,amount,date,ref,customer\n")
        for r in rows:
            fh.write(f"{r[0]},{r[1]},{D},{r[2]},{r[3]}\n")
    return p


print("=== 1. الموزَّع كارت داخل التصنيف ===")  # V4.30
pg = GatewayPage()
from PySide6.QtWidgets import QLabel  # noqa: E402
check("كارت الموزَّع موجود بلا زر تبديل",
      "dist" in pg._cards
      and any(w.text() == "🔒 الموزَّع"
              for w in pg._card_frames["dist"].findChildren(QLabel))
      and not hasattr(pg, "show_dist"))
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
f1 = _csv("a.csv", [("92220001", 40.0, "F1", "ف")])
check("استيراد صف", pg.import_file(f1) == 1)
app.processEvents()
st.set_row_class(G, (D, "92220001", 40.0, "F1"), "mine")
pg._matched[0]["status"] = "mine"
pg._render()
pg._distribute()
app.processEvents()
dlg = pg._sum_dlg
lbl = " ".join(w.text() for w in dlg.findChildren(QLabel))
check("ملخص ظهر بلا تعليق",
      dlg is not None and dlg.isVisible()
      and "عملية واحدة شركتنا" in lbl, lbl)
texts = [b.text() for b in dlg.findChildren(QPushButton)]
check("بلا قفز في الوضع المنفرد", texts == ["✕ إغلاق"], texts)
check("سطر الملف يوثق التوزيع", "وُزّع" in pg.file_lbl.text(),
      pg.file_lbl.text())
dlg.close()
check("التوزيع مخفي بعد الاعتماد", pg.dist_btn.isHidden())
check("استيراد مجدد", pg.import_file(f1) == 1)
app.processEvents()
check("الجدول فارغ + التوثيق (في الموزَّع)",
      pg.table.rowCount() == 0
      and "1 موزَّعة مسبقًا (في الموزَّع)" in pg.file_lbl.text(),
      pg.file_lbl.text())
check("كارت الموزَّع عدّ (1)",
      pg._cards["dist"].text() == "عملية واحدة\n40.000 د.ك",
      pg._cards["dist"].text())
pg.set_filter("dist")
app.processEvents()
check("الموزَّع يعرضها بحالة اليوم",
      pg.table.rowCount() == 1
      and "🏦 يوم:" in pg.table.item(0, 10).text(),
      pg.table.rowCount())
pg.set_filter("all")

print("=== 2. القفز للوجهة ===")
mg = PaymentGatewayPage()
mt = mg.match_tab
mt.gw_combo.setCurrentIndex(mt.gw_combo.findData(G))
f2 = _csv("b.csv", [("92220002", 60.0, "F2", "غ"),
                     ("92220003", 30.0, "F3", "هـ")])
check("استيراد صفين", mt.import_file(f2) == 2)
app.processEvents()
mt._on_cell(0, 6)
mt._on_cell(0, 6)
check("الأول صار شركتنا",
      mt.table.item(0, 6).text() == "✅ شركتنا",
      mt.table.item(0, 6).text())
mt._distribute()
app.processEvents()
d2 = mt._sum_dlg
btns = {b.text(): b for b in d2.findChildren(QPushButton)}
check("زرّا القفز موجودان",  # V4.30
      "→ الموزَّع" in btns and "→ حساب الأخرى" in btns,
      sorted(btns))
btns["→ الموزَّع"].click()
app.processEvents()
check("القفزة نقلت للموزَّع داخل التصنيف",  # F1§1 + F2§2
      # V4.5.12.1: الموزَّع صار يشمل «شركة أخرى» (F3) ليظهر ويُرجَع
      mg.stack.currentIndex() == 0
      and mg.match_tab._filter == "dist"
      and mg.match_tab.table.rowCount() == 3
      and {mg.match_tab.table.item(i, 5).text() for i in range(3)}
      == {"F1", "F2", "F3"}
      and any(mg.match_tab.table.item(i, 7).text()
              == "🔒 موزَّعة — شركة أخرى" for i in range(3)),
      (mg.stack.currentIndex(), mg.match_tab.table.rowCount()))

print("")
print("V4.19 find-distributed: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
