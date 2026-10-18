# -*- coding: utf-8 -*-
"""V4.5: دمج مستحقات المراحل في العملاء والأرصدة.

يغطي: خيار «بالمراحل» يعرض المسطح (عميل × عقد × مرحلة) ·
الخيارات القديمة تبقى شجرية · لا بطاقة منفصلة ولا مفتاح صلاحية.
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

from database import database

database.init_db()

from PySide6.QtWidgets import QApplication

_app = QApplication.instance() or QApplication(sys.argv)

from database.models import Contract, Customer
from services import contract_service as ks
from services import customer_service as cs
from services import report_service as rp
from ui.reports_page import _REPORTS, _data_customers

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  [PASS] " + name)
    else:
        FAIL += 1
        print("  [FAIL] " + name + " " + detail)


print("=== 1. التجهيز ===")
c1 = cs.add_customer(Customer(customer_code="V45-001", name="عميل الدمج",
                              phone="50000000"))
k1 = ks.add_contract(Contract(contract_number="V45-CT-001", customer_id=c1,
                              contract_name="فيلا الدمج",
                              contract_date="2026-09-26", amount=10000))
with database.get_connection() as conn:
    conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (k1,))
    conn.execute(
        "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
        " sort_order) VALUES (?,?,?,?,?)",
        (k1, "دفعة قديمة", "2026-01-01", 1000.0, 1))

print("=== 2. وضع بالمراحل مسطح ===")
flat = _data_customers(option="by_stages")
check("بلا شجرة", not flat.get("tree"), str(flat.get("tree")))
check("الأعمدة الثمانية", flat["heads"][0] == "العميل"
      and flat["heads"][2] == "المرحلة" and len(flat["heads"]) == 8,
      str(flat["heads"]))
eng = rp.stage_dues("all")
check("يطابق المحرك", len(flat["rows"]) == len(eng["rows"]) == eng["totals"]["n"]
      and len(flat["rows"]) >= 1, str(len(flat["rows"])))
check("صف واحد متأخر", len(flat["rows"]) == 1
      and flat["rows"][0][7] == "مستحقة", str(flat["rows"]))

print("=== 3. الوضع القديم شجري + البطاقة ===")
tree = _data_customers(option="all")
check("الشجرة باقية", tree.get("tree") is True
      and "row_kinds" in tree, str(tree.get("tree")))
keys = [r.get("key") for r in _REPORTS]
check("لا بطاقة منفصلة", "rep_stage_dues" not in keys, str(keys))
cust_card = [r for r in _REPORTS if r.get("key") == "rep_customers"][0]
modes = [v for _l, v in cust_card["options_filter"]["items"]]
check("خيار بالمراحل في البطاقة", "by_stages" in modes, str(modes))
check("الخيارات الأربعة باقية",
      {"all", "with_balance", "no_balance", "due_only"} <= set(modes),
      str(modes))

print("")
print("V4.5 merged: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
