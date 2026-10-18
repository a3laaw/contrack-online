# -*- coding: utf-8 -*-
"""V4.26: أرقام ومبالغ مفهومة في شاشة التصنيف.

يغطي: صياغة العدد عربيًا · البطاقات بسطرين (عدد + مبلغ بوحدة) ·
عدّاد زر التوزيع الحي (الظاهر/المحدد) · زر الموزعة بعدد موصوف.
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
from ui.gateway_page import GatewayPage, _ops, _row_key  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


print("=== 1. صياغة العدد ===")
check("واحدة", _ops(1) == "عملية واحدة", _ops(1))
check("اثنتان", _ops(2) == "عمليتان", _ops(2))
check("جمع قلة", _ops(5) == "5 عمليات", _ops(5))
check("جمع كثرة", _ops(16) == "16 عملية", _ops(16))

print("=== 2. البطاقات والعداد ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

G = "Hesabe"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "c.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "94440001,100.0,2026-09-20,A1,أ\n"
             "94440002,200.0,2026-09-20,A2,ب\n"
             "94440003,300.0,2026-09-20,A3,ج\n")
check("استيراد 3", pg.import_file(csv_path) == 3)
app.processEvents()
check("بطاقة الكل سطران بوحدة",
      pg._cards["total"].text() == "3 عمليات\n600.000 د.ك",
      repr(pg._cards["total"].text()))
for r in pg._matched:  # تصنيف مباشر بلا نوافذ
    st.set_row_class(G, _row_key(r), "other")
    r["status"] = "other"
pg._render()
app.processEvents()
check("عدّاد التوزيع (الكل)",
      pg.dist_btn.text() == "◆ توزيع (3 عمليات)",
      pg.dist_btn.text())
from PySide6.QtCore import QItemSelectionModel as SM  # noqa: E402
# ملاحظة: selectRow() مكسور مع RTL في Qt — التحديد عبر selectionModel
pg.table.selectionModel().select(
    pg.table.model().index(0, 0), SM.Select | SM.Rows)
app.processEvents()
check("عدّاد التوزيع (المحدد)",
      pg.dist_btn.text() == "◆ توزيع (عملية واحدة)",
      pg.dist_btn.text())
pg.table.clearSelection()
app.processEvents()
check("العداد يعود للكل",
      pg.dist_btn.text() == "◆ توزيع (3 عمليات)",
      pg.dist_btn.text())

print(f"\nV4.26 labels: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
