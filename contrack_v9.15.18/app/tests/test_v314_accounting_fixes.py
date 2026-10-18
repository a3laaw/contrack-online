# -*- coding: utf-8 -*-
"""V3.14: قفل إصلاحات المراجعة المحاسبية الخمسة."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer, Invoice  # noqa: E402
from services import (auth_service, contract_service as ks,  # noqa: E402
                      customer_service as cs,
                      expense_account_service as ea,
                      invoice_service as invs,
                      lifecycle_service as lc, report_service as rep,
                      statement_service as stm)

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


cid = cs.add_customer(Customer(customer_code="C-14", name="عميل 14", phone="1"))
k1 = ks.add_contract(Contract(contract_number="K-14", customer_id=cid,
                              contract_date="2026-01-05", description="عقد 14",
                              amount=10000.0))
root = ea.add_account("العهد", None, allow_posting=False)
a1 = ea.add_account("عهدة سعد", root, account_kind="advance")
mat = ea.add_account("مواد", None, allow_posting=True)  # بلا كلمة «مصروف»!

print("=== 1. القاعدة الموحدة (فاتورة > محصّل + حسمية) ===")
invs.add_invoice(Invoice(invoice_number=invs.next_invoice_number(),
                         customer_id=cid, contract_id=k1,
                         invoice_date="2026-02-01", description="أعمال",
                         amount=6000.0, notes=""))
lc.add_voucher("receipt", "2026-02-02", "", "نقدًا", "", 2000.0, "دفعة",
               contract_id=k1, party_type="customer", party_id=cid)
lc.add_addendum(k1, "2026-02-03", "حسمية", "خصم", 0.0, 1000.0,
                status="معتمد")
st = stm.build_statement(k1)
dues = [r for r in rep.dues_report()["rows"]
        if r["contract_number"] == "K-14"][0]
check("الكشف = 7000", st["remaining"] == 7000.0, st["remaining"])
check("المستحقات = الكشف", dues["remaining"] == st["remaining"])
check("الجاري الأخير = المتبقي",
      st["rows"][-1]["balance"] == st["remaining"])
check("بلا صف تسوية ازدواج",
      not any("تسوية" in r["description"] for r in st["rows"]))
check("الفواتير محايدة", all("للعلم" in r["description"]
      and not r["credit"] for r in st["rows"] if r["ref"].startswith("INV-")))
check("الدائن = المحصّل + الحسمية", st["total_credit"] == 3000.0,
      st["total_credit"])

print("=== 2. قيد الصرف بلا بوابة الاسم ===")

def _journal(vid):
    with get_connection() as x:
        return [dict(r) for r in x.execute(
            "SELECT * FROM journal_entries WHERE source_id=? ORDER BY id",
            (vid,)).fetchall()]

lc.add_voucher("payment", "2026-02-04", "سعد", "نقدًا", "", 1500.0, "تسليم",
               custody_account_id=a1)
s = lc.add_custody_settlement("2026-02-05", a1, [
    {"vdate": "2026-02-05", "expense_account_id": mat, "party": "مورد",
     "contract_id": k1, "amount": 900.0, "description": "مواد موقع"}], "تصفية")
with get_connection() as x:
    sid = x.execute("SELECT id FROM vouchers WHERE expense_group_ref=?",
                    (s["group_number"],)).fetchone()[0]
j = _journal(sid)
check("تصفية بحساب «مواد»: مدين مواد دائن عهدة",
      len(j) == 1 and j[0]["debit_account"] == "مواد"
      and "عهدة" in j[0]["credit_account"], j)
lc.update_voucher(sid, "2026-02-05", "تصفية عهدة", 800.0, "مواد موقع",
                  party_type="", party_id=None, contract_id=k1)
j = _journal(sid)
check("بعد التعديل: القيد مصحح دائن عهدة",
      len(j) == 1 and "عهدة" in j[0]["credit_account"]
      and j[0]["amount"] == 800.0, j)
p1 = lc.add_voucher("payment", "2026-02-06", "مورد", "نقدًا", "", 100.0,
                    "شراء", contract_id=k1, expense_account_id=mat)
j = _journal(p1)
check("صرف عادي بحساب «مواد»: مدين مواد دائن خزينة",
      len(j) == 1 and j[0]["debit_account"] == "مواد"
      and j[0]["credit_account"] == "البنك / الصندوق", j)

print("=== 3. دفتر اليومية ===")
jr = rep.journal_report("2026-02-01", "2026-02-28")
check("صفوف + متوازن",
      len(jr["rows"]) >= 3 and jr["totals"]["balanced"]
      and jr["totals"]["debit"] == jr["totals"]["credit"])
with get_connection() as x:
    n = x.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
check("بلا فترة = كل القيود",
      rep.journal_report()["totals"]["count"] == n)
from ui.reports_page import _data_journal, _REPORTS  # noqa: E402
spec = _data_journal("2026-02-01", "2026-02-28")
check("مواصفة العرض سليمة",
      spec["heads"] == ["م", "التاريخ", "البيان", "مدين", "دائن", "المبلغ"]
      and len(spec["rows"]) == len(jr["rows"]))
check("مسجل في المركز", any(r["key"] == "rep_journal" for r in _REPORTS))
check("صلاحية + علم",
      "rep_journal" in auth_service.PERMISSIONS
      and auth_service.PERMISSIONS["rep_journal"]["group"] == "التقارير")

print("=== 4. علم الربحية يعمل ===")
before = rep.profitability_report(contract_id=k1)["rows"][0]["cost"]
with get_connection() as x:
    x.execute("UPDATE expense_accounts SET include_in_profitability=0 "
              "WHERE id=?", (mat,))
after = rep.profitability_report(contract_id=k1)["rows"][0]["cost"]
check("المستبعد يُخصم من التكلفة", after == before - 900.0,
      f"{before} → {after}")
with get_connection() as x:
    x.execute("UPDATE expense_accounts SET include_in_profitability=1 "
              "WHERE id=?", (mat,))

print("=== 5. التطهير ينظف القيود ===")
from services import purge_service  # noqa: E402
auth_service.ensure_developer_user()
auth_service.set_current_user("developer")
jn_before = _journal(p1)
check("للسند قيد قبل الحذف", len(jn_before) == 1)
purge_service.purge_vouchers([p1], "اختبار تنظيف")
check("القيد حُذف مع السند", _journal(p1) == [])
with get_connection() as x:
    gone = x.execute("SELECT COUNT(*) FROM vouchers WHERE id=?",
                     (p1,)).fetchone()[0]
check("السند حُذف", gone == 0)

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
