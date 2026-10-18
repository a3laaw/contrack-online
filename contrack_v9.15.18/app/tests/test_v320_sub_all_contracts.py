# -*- coding: utf-8 -*-
"""V3.20: استثناء مقاول الباطن — إظهار كل العملاء/المشاريع في السندات."""
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import ui_data_service as ui_data  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== 1. العمود والخدمة ===")
with db.get_connection() as _c:
    _cols = {r[1] for r in _c.execute("PRAGMA table_info(subcontractors);")}
check("العمود موجود", "show_all_contracts" in _cols)
s1 = lc.add_subcontractor("SUB-201", "مقاول عادي")
s2 = lc.add_subcontractor("SUB-202", "مقاول مستثنى", show_all_contracts=True)
check("الافتراضي مطفأ", not lc.get_subcontractor(s1)["show_all_contracts"])
check("الإضافة مع التفعيل", bool(lc.get_subcontractor(s2)["show_all_contracts"]))
lc.update_subcontractor(s1, show_all_contracts=True)
check("التعديل يفعّل", bool(lc.get_subcontractor(s1)["show_all_contracts"]))
lc.update_subcontractor(s1, show_all_contracts=False)
check("التعديل يلغي", not lc.get_subcontractor(s1)["show_all_contracts"])

print("=== 2. ترحيل قاعدة قديمة ===")
_old = os.path.join(_tmpdir, "old.sqlite")
_con = sqlite3.connect(_old)
_con.executescript(
    "CREATE TABLE subcontractors (id INTEGER PRIMARY KEY AUTOINCREMENT,"
    " sub_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,"
    " phone TEXT DEFAULT '', email TEXT DEFAULT '',"
    " activity TEXT DEFAULT '', notes TEXT DEFAULT '',"
    " created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));"
    "INSERT INTO subcontractors (sub_code, name) VALUES ('SUB-0','قديم');")
_con.commit()
_con.close()
db.DB_PATH = _old
db.init_db()
with db.get_connection() as _c2:
    _cols2 = {r[1] for r in _c2.execute("PRAGMA table_info(subcontractors);")}
    _row = _c2.execute("SELECT name, show_all_contracts FROM subcontractors"
                       ).fetchone()
check("الترحيل يضيف العمود", "show_all_contracts" in _cols2)
check("بيانات القديمة محفوظة", tuple(_row) == ("قديم", 0), str(tuple(_row)))
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

print("=== 3. الفلترة في السندات ===")
c1 = cs.add_customer(Customer(customer_code="C-201", name="عميل أول",
                              phone="55001122"))
c2 = cs.add_customer(Customer(customer_code="C-202", name="عميل ثان",
                              phone="55003344"))
k1 = ks.add_contract(Contract(contract_number="K-201", customer_id=c1,
                              contract_date="2026-01-01", description="عقد أول",
                              amount=10000.0, contract_type="مقاولة عامة"))
k2 = ks.add_contract(Contract(contract_number="K-202", customer_id=c2,
                              contract_date="2026-01-01", description="عقد ثان",
                              amount=20000.0, contract_type="مقاولة عامة"))
lc.add_sub_contract(s1, k1, None, 5000.0, "2026-01-01", "2026-06-01", "")
_ids_plain = {it[1] for it in ui_data.subcontractor_contract_items(s1)}
check("بدون استثناء: عقوده فقط", _ids_plain == {k1}, str(_ids_plain))
lc.update_subcontractor(s1, show_all_contracts=True)
_ids_all = {it[1] for it in ui_data.subcontractor_contract_items(s1)}
check("مع الاستثناء: كل العقود", _ids_all == {k1, k2}, str(_ids_all))
check("العرض يذكر العميل",
      all("—" in it[0] for it in ui_data.subcontractor_contract_items(s1)))

print("=== 4. حوار المقاول (offscreen) ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.subcontractors import SubcontractorDialog  # noqa: E402

dlg = SubcontractorDialog()
check("الخانة موجودة", hasattr(dlg, "show_all"))
check("الافتراضي غير مفعّلة", not dlg.show_all.isChecked())
dlg.code.setText("SUB-203")
dlg.name.setText("مقاول الحوار")
dlg.show_all.setChecked(True)
dlg._save()
s3 = lc.list_subcontractors("SUB-203")[0]
check("الحفظ مع التفعيل", bool(s3["show_all_contracts"]))
dlg2 = SubcontractorDialog(sub=s3)
check("التعديل يعرض التفعيل", dlg2.show_all.isChecked())
dlg2.show_all.setChecked(False)
dlg2._save()
check("الحفظ يلغي التفعيل",
      not lc.get_subcontractor(s3["id"])["show_all_contracts"])

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
