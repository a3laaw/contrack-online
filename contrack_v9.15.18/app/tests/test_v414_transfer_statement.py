# -*- coding: utf-8 -*-
"""V4.14: كشف التسديد للشركة الأخرى — بيانات + أسماء + إجمالي + عرض.

يغطي: transfer_statement (بيانات التسديد + عملياته بأسماء العملاء +
الإجمالي) · تسديد بلا عمليات · رقم مجهول · نافذة التفاصيل تعرض
عمود اسم العميل و6 أعمدة.
"""
import os
import sys
import tempfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from services import gateway_service as gw  # noqa: E402
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
ops = [
    {"date": "2026-09-20", "phone": "90000001", "amount": 100.0,
     "ref": "80252077410", "status": gw.STATUS_OTHER,
     "customer": "فلان الفلاني", "receipt_no": ""},
    {"date": "2026-09-21", "phone": "90000002", "amount": 55.5,
     "ref": "80252077411", "status": gw.STATUS_OTHER,
     "customer": "علان العلاني", "receipt_no": ""},
    {"date": "2026-09-21", "phone": "90000003", "amount": 300.0,
     "ref": "80252077412", "status": gw.STATUS_OTHER,
     "customer": "ثالث غير مسدد", "receipt_no": ""},
]

print("=== 1. تجهيز: تثبيت + تسديد عمليتين ===")
check("تثبيت 3", st.save_gateway_ops(G, ops, "f.csv") == 3)
keys = [(o["date"], o["phone"], round(o["amount"], 3), o["ref"])
        for o in ops]
st.distribute_rows(G, keys)
ids = st.op_ids_for(G, keys[:2])
check("id لعمليتين", len(ids) == 2, ids)
tid = st.add_other_transfer("2026-09-22", 155.5, ref="T-99",
                            method="تحويل", op_ids=ids)
check("تسديد برقم", tid > 0, tid)

print("=== 2. كشف التسديد ===")
stmt = st.transfer_statement(tid)
check("بيانات التسديد", stmt["transfer"].get("tdate") == "2026-09-22"
      and stmt["transfer"].get("ref") == "T-99",
      str(stmt["transfer"]))
check("عمليتان مغطاتان", len(stmt["ops"]) == 2, len(stmt["ops"]))
names = {o["customer"] for o in stmt["ops"]}
check("أسماء العملاء", names == {"فلان الفلاني", "علان العلاني"},
      str(names))
check("الإجمالي 155.5", stmt["total"] == 155.5, stmt["total"])
check("غير المسدد خارج الكشف",
      all(o["customer"] != "ثالث غير مسدد" for o in stmt["ops"]))

print("=== 3. حالات حدّية ===")
tid2 = st.add_other_transfer("2026-09-23", 50.0)
s2 = st.transfer_statement(tid2)
check("بلا عمليات = صفر", s2["ops"] == [] and s2["total"] == 0,
      str(s2))
s3 = st.transfer_statement(999999)
check("مجهول = فارغ",
      s3 == {"transfer": {}, "ops": [], "total": 0}, str(s3))

print("=== 4. نافذة التفاصيل ===")
from PySide6.QtWidgets import (QApplication, QPushButton,  # noqa: E402
                                 QTableWidget)
from ui.other_company_page import TransferDetailDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
dlg = TransferDetailDialog(None, tid)
tbls = dlg.findChildren(QTableWidget)
check("جدول واحد", len(tbls) == 1, len(tbls))
heads = [tbls[0].horizontalHeaderItem(c).text()
         for c in range(tbls[0].columnCount())]
check("6 أعمدة", tbls[0].columnCount() == 6, str(heads))
check("عمود اسم العميل", "اسم العميل" in heads, str(heads))
check("صفان معروضان", tbls[0].rowCount() == 2, tbls[0].rowCount())
cell_names = {tbls[0].item(r, heads.index("اسم العميل")).text()
              for r in range(2)}
check("الأسماء ظاهرة", cell_names == {"فلان الفلاني", "علان العلاني"},
      str(cell_names))
btns = [b.text() for b in dlg.findChildren(QPushButton)]
check("زر تصدير الكشف", "📤 تصدير الكشف" in btns, str(btns))

print("")
print("V4.14 statement: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
