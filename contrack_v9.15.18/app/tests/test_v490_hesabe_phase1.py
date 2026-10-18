# -*- coding: utf-8 -*-
"""V4.9 (مرحلة 1): ملف حسابي CSV + مطابقة الاسم + لماذا + تحقق + معالج.

يغطي: قراءة CSV واستبعاد غير المدفوع · تاريخ Hesabe ·
المطابقة بالاسم العربي · أسباب عدم المطابقة · قائمة التحقق ·
كشف بنك CSV · تدفق المعالج.
"""
import csv
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

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import gateway_service as gw  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
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


print("=== 1. تواريخ وأسماء ===")
check("تاريخ حسابي",
      gw.parse_date("'26-Sep-2026 18:58 PM") == "2026-09-26")
check("القديم سليم", gw.parse_date("2026-09-11") == "2026-09-11")
check("توحيد الألف", gw.names_match("أحمد", "احمد"))
check("توحيد التاء", gw.names_match("فاطمة", "فاطمه"))
check("تجاهل التشكيل", gw.names_match("خالد", "خالِد"))
check("القصير لا يطابق", not gw.names_match("س", "س"))

print("=== 2. ملف حسابي ===")
c1 = cs.add_customer(Customer(customer_code="H1",
                              name="ناصر ماضي راضي الشمري",
                              phone="99000000"))
k1 = ks.add_contract(Contract(
    contract_number="KH1", customer_id=c1, contract_date="2026-09-01",
    description="ع", amount=5000.0, contract_type="مقاولة عامة"))
lc.add_voucher("receipt", "2026-09-25", "", "KNET", "", 300.0, "دفعة",
               contract_id=k1, party_type="customer", party_id=c1)
cs.add_customer(Customer(customer_code="H2", name="فهد العتيبي",
                         phone="99111111"))
st.save_profile(None, "حسابي", "", "KNET", 1, 0.0)
_csv = os.path.join(_tmpdir, "hesabe.csv")
with open(_csv, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Created Date", "Customer Name", "Mobile Number",
                "Invoice Type", "Invoice Number", "Description", "Amount",
                "Invoice Status", "Payment Status", "Transaction Token",
                "Transaction Date"])
    w.writerow(["'26-Sep-2026 18:58 PM", "ناصر ماضي راضي الشمري", "", "URL",
                "80252077410", "الدفعه الاولي", "300", "Paid", "Success",
                "'8025179043832793572077'", "'26-Sep-2026 19:04 PM"])
    w.writerow(["'26-Sep-2026 16:45 PM", "محمد سيف البالود", "", "URL",
                "80254687234", "الدفعه الاولي", "300", "Not Paid", "",
                "", ""])
    w.writerow(["'26-Sep-2026 10:00 AM", "ناصر ماضي راضي الشمري", "", "URL",
                "80252077001", "دفعة", "250", "Paid", "Success",
                "'tok2'", "'26-Sep-2026 10:05 AM"])
    w.writerow(["'01-Sep-2026 10:00 AM", "ناصر ماضي راضي الشمري", "", "URL",
                "80252077002", "دفعة", "300", "Paid", "Success",
                "'tok3'", "'01-Sep-2026 10:05 AM"])
    w.writerow(["'26-Sep-2026 09:00 AM", "فهد العتيبي", "", "URL",
                "80252077003", "دفعة", "100", "Paid", "Success",
                "'tok4'", "'26-Sep-2026 09:05 AM"])
    w.writerow(["'26-Sep-2026 09:00 AM", "", "", "URL",
                "80252077004", "دفعة", "50", "Paid", "Success",
                "'tok5'", "'26-Sep-2026 09:05 AM"])
rows = gw.read_settlement_file(_csv)
info = gw.last_read_info()
check("6 صفوف + استبعاد 0 (المعلق محفوظ)",
      len(rows) == 6 and info["skipped_unpaid"] == 0, str(info))
check("حالة التحصيل",
      rows[0]["gw_paid"] == 1
      and rows[0]["gw_paid_date"] == "2026-09-26"
      and rows[1]["gw_paid"] == 0, str(rows[1]))
check("مرجع الفاتورة", rows[0]["ref"] == "80252077410", rows[0])
check("تاريخ الدفع", rows[0]["date"] == "2026-09-26", rows[0])

print("=== 3. المطابقة والأسباب ===")
m = gw.match_settlement(rows)
check("مطابق بالاسم",
      m[0]["status"] == "mine" and m[0].get("via") == "وصف + الاسم"
      and "الاسم" in m[0]["note"], m[0])
check("المعلق للشركة الأخرى",
      m[1]["status"] == "other" and m[1]["gw_paid"] == 0, m[1])
check("فرق مبلغ يوضح الفرق",
      m[2]["status"] == "diff" and "مختلف" in m[2]["note"]
      and "فرق" in m[2]["note"], m[2])
check("فرق تاريخ يوضح النافذة",
      m[3]["status"] == "diff" and "النافذة" in m[3]["note"], m[3])
check("عميلنا بلا سند",
      m[4]["status"] == "diff" and "لا سند" in m[4]["note"], m[4])
check("بلا هوية",
      m[5]["status"] == "other" and "بلا هاتف ولا اسم" in m[5]["note"],
      m[5])

print("=== 4. كشف بنك CSV ===")
_b = os.path.join(_tmpdir, "bank.csv")
with open(_b, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["التاريخ", "المبلغ", "البيان"])
    w.writerow(["2026-09-27", "450", "إيداع"])
bl = st.read_bank_file(_b)
check("سطر بنكي", len(bl) == 1 and bl[0]["cdate"] == "2026-09-27", bl)

print("=== 5. الشاشة والتسوية الجديدة ===")
from PySide6.QtWidgets import QApplication, QFileDialog  # noqa: E402

_app = QApplication.instance() or QApplication([])
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

pg = PaymentGatewayPage()
check("استيراد CSV", pg.match_tab.import_file(_csv) == 6)
pg.match_tab._auto(silent=True)
check("قائمة التحقق ظاهرة وتحذر",
      "لا هواتف" in pg.match_tab.checklist.text()
      and "بلا هاتف ولا اسم" in pg.match_tab.checklist.text(),
      pg.match_tab.checklist.text()[:160])
_orig = QFileDialog.getOpenFileName
QFileDialog.getOpenFileName = lambda *a, **k: (_csv, "")
try:
    pg._open_wizard()
    check("التسوية الجديدة تستورد وتقفز للتصنيف",
          pg.tabs.currentData() == "match"
          and pg.match_tab.table.rowCount() == 5
          and pg.match_tab._nunpaid == 1
          and "1 غير مدفوعة (مستبعدة)" in pg.match_tab.file_lbl.text(),
          pg.match_tab.table.rowCount())
finally:
    QFileDialog.getOpenFileName = _orig

print("=== 6. قنوات المطابقة (الترتيب) ===")
m2 = gw.match_settlement([
    {"phone": "99000000", "customer": "ناصر ماضي راضي الشمري",
     "amount": 300.0, "date": "2026-09-26", "ref": "B1", "row_no": 1},
    {"phone": "99000000", "customer": "فهد العتيبي",
     "amount": 300.0, "date": "2026-09-26", "ref": "B2", "row_no": 2},
    {"phone": "", "customer": "ناصر ماضي راضي الشمري",
     "amount": 300.0, "date": "2026-09-26", "ref": "B3", "row_no": 3}])
check("هاتف+اسم ← القناة المزدوجة",
      m2[0]["status"] == "mine" and m2[0].get("via") == "الهاتف والاسم",
      m2[0])
check("الهاتف يكفي رغم اختلاف الاسم",
      m2[1]["status"] == "mine" and m2[1].get("via") == "الهاتف"
      and m2[1]["customer"] == "ناصر ماضي راضي الشمري", m2[1])
check("الاسم يكفي بلا هاتف",
      m2[2]["status"] == "mine" and m2[2].get("via") == "الاسم", m2[2])

print("")
print("V4.9 hesabe: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
