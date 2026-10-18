# -*- coding: utf-8 -*-
"""كشف العميل الشامل (V2.25): أرقام ذهبية + مطابقة + واجهة + PDF."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database.database import init_db  # noqa: E402

init_db()

import sqlite3  # noqa: E402

N = "2026-09-19 08:00:00"
c = sqlite3.connect(db.DB_PATH)
c.execute("INSERT INTO customers (customer_code,name) VALUES ('C-001','عميل أ')")
c.execute("INSERT INTO customers (customer_code,name) VALUES ('C-002','عميل ب')")
c.execute("INSERT INTO contracts (contract_number,customer_id,contract_date,amount,contract_name)"
          " VALUES ('CT-1',1,'2026-01-10',100000,'عقد أول')")
c.execute("INSERT INTO contracts (contract_number,customer_id,contract_date,amount,contract_name)"
          " VALUES ('CT-2',1,'2026-04-01',50000,'عقد ثان')")
c.execute("INSERT INTO invoices (invoice_number,customer_id,contract_id,invoice_date,amount)"
          " VALUES ('INV-1',1,1,'2026-02-01',30000)")
c.execute("INSERT INTO invoices (invoice_number,customer_id,contract_id,invoice_date,amount)"
          " VALUES ('INV-2',1,2,'2026-05-01',20000)")
c.execute("INSERT INTO vouchers (voucher_number,vtype,vdate,party,party_type,party_id,contract_id,amount,created_at)"
          " VALUES ('RV-1','receipt','2026-02-15','عميل أ','customer',1,1,30000,?)", (N,))
c.execute("INSERT INTO vouchers (voucher_number,vtype,vdate,contract_id,amount,created_at)"
          " VALUES ('RV-2','receipt','2026-05-15',2,20000,?)", (N,))
c.execute("INSERT INTO addendums (addendum_number,contract_id,addendum_type,adate,reason,amount_add,"
          "amount_deduct,status,created_at) VALUES ('ADD-1',1,'أمر تغييري','2026-03-01','إضافي',10000,0,'معتمد',?)",
          (N,))
c.commit()
c.close()

from services import report_service, statement_service as st  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

PASS, FAIL = 0, 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== 1. الشامل = مجموع العقدين ===")
one1 = st.build_statement(1)
one2 = st.build_statement(2)
full = st.build_customer_statement(1)
check("متبقي CT-1 ذهبي", abs(one1["remaining"] - 80000.0) < 0.01, one1["remaining"])
check("متبقي CT-2 ذهبي", abs(one2["remaining"] - 30000.0) < 0.01, one2["remaining"])
check("متبقي الشامل = المجموع",
      abs(full["remaining"] - (one1["remaining"] + one2["remaining"])) < 0.01,
      full["remaining"])
check("مدين الشامل = المجموع",
      abs(full["total_debit"] - (one1["total_debit"] + one2["total_debit"])) < 0.01)
check("دائن الشامل = المجموع",
      abs(full["total_credit"] - (one1["total_credit"] + one2["total_credit"])) < 0.01)
kinds = [r["kind"] for r in full["rows"]]
check("صفّا فرعيين + إجمالي", kinds[-3:] == ["subtotal", "subtotal", "total"], kinds[-3:])
moves = [r for r in full["rows"] if r["kind"] == "move"]
check("الرصيد الجاري متسلسل زمنيًا",
      all(moves[i]["date"] <= moves[i + 1]["date"] for i in range(len(moves) - 1)))
check("ختامي الحركة = المتبقي", abs(moves[-1]["balance"] - full["remaining"]) < 0.01)
check("عمود العقد موسوم", all(r.get("contract_number") in ("CT-1", "CT-2") for r in moves))

print("=== 2. مطابقة تقرير العملاء والأرصدة ===")
rep = report_service.customers_balances()
mine = [r for r in rep["rows"] if r["code"] == "C-001"][0]
check("المتبقي يطابق التقرير", abs(mine["remaining"] - full["remaining"]) < 0.01,
      f"report={mine['remaining']} full={full['remaining']}")

print("=== 3. فلتر التاريخ ===")
f = st.build_customer_statement(1, date_from="2026-04-01")
check("افتتاحية ذهبية", abs(f["opening"] - 80000.0) < 0.01, f["opening"])
fmoves = [r for r in f["rows"] if r["kind"] == "move"]
check("كل الحركة داخل النطاق", all(r["date"] >= "2026-04-01" for r in fmoves))
check("الختامي ثابت", abs(f["remaining"] - 110000.0) < 0.01, f["remaining"])
check("صف الافتتاحية أولًا", f["rows"][0]["kind"] == "opening")
f2 = st.build_customer_statement(1, date_from="2026-04-01", date_to="2026-04-30")
fm2 = [r for r in f2["rows"] if r["kind"] == "move"]
check("حصر مزدوج", all("2026-04-01" <= r["date"] <= "2026-04-30" for r in fm2)
      and len(fm2) == 1 and fm2[0]["ref"] == "CT-2", len(fm2))

print("=== 4. فلتر العقد ===")
fl = st.build_customer_statement(1, contract_id=2)
check("متبقي الفلتر = العقد", abs(fl["remaining"] - one2["remaining"]) < 0.01)
check("صف فرعي واحد", sum(1 for r in fl["rows"] if r["kind"] == "subtotal") == 1)

print("=== 5. القاعدة الموحدة (المحصّل فقط) ===")
c = sqlite3.connect(db.DB_PATH)
c.execute("INSERT INTO vouchers (voucher_number,vtype,vdate,contract_id,amount,created_at)"
          " VALUES ('RV-3','receipt','2026-06-01',1,10000,?)", (N,))
c.commit()
c.close()
one1b = st.build_statement(1)
fullb = st.build_customer_statement(1)
check("CT-1 بالقاعدة الموحدة (محصّل 40)", abs(one1b["remaining"] - 70000.0) < 0.01,
      one1b["remaining"])
check("الشامل يتبع", abs(fullb["remaining"] - 100000.0) < 0.01, fullb["remaining"])

print("=== 6. أخطاء ===")
try:
    st.build_customer_statement(999)
    check("عميل وهمي مرفوض", False)
except ValidationError:
    check("عميل وهمي مرفوض", True)
try:
    st.build_customer_statement(2)
    check("عميل بلا عقود مرفوض", False)
except ValidationError:
    check("عميل بلا عقود مرفوض", True)

print("=== 7. الواجهة (offscreen) ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.statement import StatementPage  # noqa: E402

pg = StatementPage()
pg.refresh()
pg.select_customer(1)
app.processEvents()
check("وضع شامل افتراضي", pg._mode == "full" and pg.table.columnCount() == 7)
check("صفوف الشامل", pg.table.rowCount() == len(fullb["rows"]), pg.table.rowCount())
check("لا تاب عقد واحد", not hasattr(pg, "mode_tabs"))
pg.contract.select_data(1)
app.processEvents()
flt1 = st.build_customer_statement(1, contract_id=1)
check("فلتر العقد 7 أعمدة", pg.table.columnCount() == 7)
check("صفوف فلتر العقد", pg.table.rowCount() == len(flt1["rows"]), pg.table.rowCount())
check("تسمية العقد", "CT-1" in pg.lbl_contract.text(), pg.lbl_contract.text())
pg.contract.select_data(-1)
app.processEvents()
pg.period.setCurrentIndex(1)
app.processEvents()
check("فلتر الشهر يعمل", pg.table.rowCount() >= 0)
check("تسمية الافتتاحية", "أول الفترة" in pg.lbl_total_contract.text(),
      pg.lbl_total_contract.text())

print("=== 8. PDF ===")
from reports.statement_pdf import (generate_customer_statement_pdf,  # noqa: E402
                                   generate_statement_pdf)

p1 = os.path.join(_tmpdir, "full.pdf")
p2 = os.path.join(_tmpdir, "full_f.pdf")
p3 = os.path.join(_tmpdir, "one.pdf")
generate_customer_statement_pdf(1, p1)
generate_customer_statement_pdf(1, p2, date_from="2026-04-01", date_to="2026-12-31")
generate_statement_pdf(1, p3)
check("شامل PDF", os.path.getsize(p1) > 10000, os.path.getsize(p1))
check("مفلتر PDF", os.path.getsize(p2) > 10000)
check("العقد PDF (قديم سليم)", os.path.getsize(p3) > 10000)

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
