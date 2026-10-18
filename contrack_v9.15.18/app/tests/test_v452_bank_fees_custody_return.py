# -*- coding: utf-8 -*-
"""V4.52: عمولات بنكية + إرجاع العهدة للصندوق.

يغطي: حساب «عمولات بنكية» وإرفاقه بسندات الرسوم التلقائية
(الفروع الثلاثة) وظهورها في تقرير المصروفات · سند عمولة التسوية
(إنشاء/منع ازدواج/حارس حذف) · نوع «إرجاع عهدة» (أرصدة/نقدية/
قيود/استبعاد إيرادي/سقف المتبقي/إلغاء/دفتر) + دخاني الواجهتين.
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

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import customer_service  # noqa: E402
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402
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


def _fee_vouchers():
    with get_connection() as _c:
        return [dict(r) for r in _c.execute(
            "SELECT * FROM vouchers WHERE COALESCE(notes,'') LIKE '%رسوم بنك%'"
            " AND COALESCE(cancelled,0)=0 ORDER BY id").fetchall()]


def _journal(vid):
    with get_connection() as _c:
        return [dict(r) for r in _c.execute(
            "SELECT * FROM journal_entries WHERE source_id=? "
            "AND source_type LIKE 'voucher_%' AND source_type!='voucher_cancel'"
            " ORDER BY id", (vid,)).fetchall()]


cust = customer_service.add_customer(Customer(
    customer_code="C-452", name="عميل 452", phone="90000452"))

print("=== 1. حساب العمولات ===")
aid, apath = lc.ensure_bank_commission_account()
check("يُنشأ مرة واحدة بمسار بنكي",
      aid > 0 and "عمولات بنكية" in apath, apath)
aid2, _p2 = lc.ensure_bank_commission_account()
check("تكرار الضمان بلا ازدواج", aid2 == aid)

print("=== 2. سند الرسوم التلقائي (بلا عقود) ===")
r1 = lc.add_voucher("receipt", "2026-09-20", "عميل 452", "تحويل بنكي",
                    "البنك", 500.0, "قبض 452")
_fv = _fee_vouchers()
check("سند رسوم واحد 0.150",
      len(_fv) == 1 and abs(float(_fv[0]["amount"]) - 0.150) < 0.0005
      and _fv[0]["parent_voucher_id"] == r1, _fv)
check("مربوط بحساب العمولات",
      _fv[0]["expense_account_id"] == aid
      and "عمولات بنكية" in (_fv[0]["expense_account_snapshot"] or ""))
_j = _journal(_fv[0]["id"])
check("القيد مدين عمولات بنكية",
      _j and "عمولات بنكية" in _j[0]["debit_account"], _j)
_exp = rep.expenses_report("2026-09-01", "2026-09-30")
check("يظهر في تقرير المصروفات بالحساب",
      any("عمولات بنكية" in (r.get("acc_path") or "")
          and abs(float(r.get("amount") or 0) - 0.150) < 0.0005
          for r in _exp["rows"]))

print("=== 3. فرعا العقد والتوزيع ===")
kid = cs.add_contract(Contract(
    contract_number="CON-452", customer_id=cust,
    contract_date="2026-09-21", contract_type="عام", amount=5000.0))
r2 = lc.add_voucher("receipt", "2026-09-21", "عميل 452", "تحويل بنكي",
                    "البنك", 200.0, "قبض بعقد", contract_id=kid)
_fv2 = [v for v in _fee_vouchers() if v["parent_voucher_id"] == r2]
check("فرع العقد المباشر بالحساب",
      len(_fv2) == 1 and _fv2[0]["expense_account_id"] == aid
      and _fv2[0]["contract_id"] == kid, _fv2)
r3 = lc.add_voucher("receipt", "2026-09-22", "عميل 452", "تحويل بنكي",
                    "البنك", 300.0, "قبض موزع")
_fv3 = [v for v in _fee_vouchers() if v["parent_voucher_id"] == r3]
check("فرع التوزيع كله بالحساب",
      len(_fv3) >= 1 and all(
          v["expense_account_id"] == aid for v in _fv3)
      and abs(sum(float(v["amount"]) for v in _fv3) - 0.150) < 0.002, _fv3)

print("=== 4. تسديد الأخرى: بلا سند صرف (V4.5.13) ===")
st.save_profile(None, "H452", "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops("H452", [
    {"date": "2026-09-10", "phone": "96660001", "amount": 100.0,
     "ref": "GA", "status": "other"},
    {"date": "2026-09-11", "phone": "96660002", "amount": 50.0,
     "ref": "GB", "status": "other"}], "f.csv")
st.distribute_rows("H452", [("2026-09-10", "96660001", 100.0, "GA"),
                            ("2026-09-11", "96660002", 50.0, "GB")])
_ids = st.op_ids_for("H452", [("2026-09-10", "96660001", 100.0, "GA"),
                              ("2026-09-11", "96660002", 50.0, "GB")])
with get_connection() as _c:
    _v0 = _c.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
tid = st.add_other_transfer("2026-09-25", 149.70, "ت452", "", "تحويل بنكي",
                            _ids, create_voucher=True)  # تُتجاهل الآن
_t = st.get_transfer(tid)
check("التسديد سُجّل بالصافي بلا سند",
      _t is not None and abs(float(_t["amount"]) - 149.70) < 0.001
      and int(_t["voucher_id"] or 0) == 0
      and not (_t["voucher_number"] or ""), _t)
check("لا سند عمولة للتحويل", st.transfer_fee_voucher(tid) is None)
with get_connection() as _c:
    _v1 = _c.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
    _n = _c.execute("SELECT COUNT(*) FROM gateway_fee_vouchers "
                    "WHERE transfer_id=?", (tid,)).fetchone()[0]
check("لم يُنشأ أي سند (ولا صف ربط)", _v1 == _v0 and _n == 0,
      (_v0, _v1, _n))
st.delete_other_transfer(tid)          # لا سند يحجبه الآن
check("الحذف متاح (لا سند يحجبه)", st.get_transfer(tid) is None)
with get_connection() as _c:
    _v2 = _c.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
check("الحذف لا يمسّ السندات", _v2 == _v0, (_v0, _v2))
tid2 = st.add_other_transfer("2026-09-26", 149.70, "ت452ب", "", "تحويل بنكي",
                             _ids, create_voucher=True)
check("إعادة التسوية: بلا سند عمولة كذلك",
      st.transfer_fee_voucher(tid2) is None)
with get_connection() as _c:
    _n2 = _c.execute("SELECT COUNT(*) FROM vouchers WHERE COALESCE(notes,'')"
                     " LIKE '%عمولة بوابات%' AND COALESCE(cancelled,0)=0"
                     ).fetchone()[0]
check("ولا سند عمولة بوابات فعّال", _n2 == 0, _n2)

print("=== 5. إرجاع العهدة ===")
_cust = next(a for a in ea.list_accounts()
             if (a.get("name") or "").strip() == "عهدة عامة")
_cid = int(_cust["id"])
_cash0 = lc.cash_account_balances()["total"]
lc.add_voucher("payment", "2026-09-15", "موظف", "الصندوق", "", 1000.0,
               "تسليم عهدة 452", custody_account_id=_cid)
_bal = {b["account_id"]: b for b in lc.custody_balances()}[_cid]
check("التسليم: ذمة 1000",
      abs(_bal["balance"] - 1000.0) < 0.001, _bal)
rid = lc.add_custody_return("2026-09-27", _cid, 300.0, "موظف", "الصندوق")
_bal2 = {b["account_id"]: b for b in lc.custody_balances()}[_cid]
check("الإرجاع: مرتجع 300 ومتبقي 700",
      abs(_bal2.get("returned") - 300.0) < 0.001
      and abs(_bal2["balance"] - 700.0) < 0.001, _bal2)
with get_connection() as _c:
    _rv = dict(_c.execute("SELECT * FROM vouchers WHERE id=?",
                          (rid,)).fetchone())
check("ترقيم CV ونوع إرجاع",
      _rv["vtype"] == "custody_return"
      and (_rv["voucher_number"] or "").startswith("CV-"), _rv)
_jr = _journal(rid)
check("القيد: مدين الصندوق دائن العهدة",
      _jr and "الصندوق" in _jr[0]["debit_account"]
      and "عهدة" in _jr[0]["credit_account"], _jr)
_cash1 = lc.cash_account_balances()["total"]
check("النقدية زادت 300 (1000−700)",
      abs((_cash1 - _cash0) - (-700.0)) < 0.001, (_cash0, _cash1))
try:
    lc.add_custody_return("2026-09-27", _cid, 800.0, "موظف", "الصندوق")
    _over = "accepted?!"
except Exception as ex:
    _over = str(ex)
check("تجاوز المتبقي مرفوض", "المتبقي" in _over, _over)
_exp2 = rep.expenses_report("2026-09-01", "2026-09-30")
_vp = rep.vouchers_period("2026-09-01", "2026-09-30")
check("خارج المصروفات والإجماليات",
      abs(_vp["total_in"] - 1000.0) < 0.001
      and all(abs(float(r.get("amount") or 0) - 300.0) > 0.001
              for r in _exp2["rows"])
      and any(r["vtype"] == "custody_return" for r in _vp["rows"]),
      (_vp["total_in"], len(_exp2["rows"])))
_led = lc.custody_ledger(_cid, "2026-09-01", "2026-09-30")
check("الدفتر يحمل الإرجاع منصرفًا",
      any(i.get("kind") == "return"
          and abs(float(i.get("out") or 0) - 300.0) < 0.001
          for i in _led["rows"]), len(_led["rows"]))
check("اسم النوع عربي", lc.voucher_type_label("custody_return") == "إرجاع عهدة")
lc.cancel_voucher(rid, "اختبار")
_bal3 = {b["account_id"]: b for b in lc.custody_balances()}[_cid]
_cash2 = lc.cash_account_balances()["total"]
check("إلغاء الإرجاع يعيد الذمة والنقدية",
      abs(_bal3["balance"] - 1000.0) < 0.001
      and abs((_cash2 - _cash0) - (-1000.0)) < 0.001, (_bal3, _cash2))

print("=== 6. دخاني الواجهتين ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.clearing_page import TransferDialog  # noqa: E402
from ui.custody_center import CustodyReturnDialog  # noqa: E402

td = TransferDialog(None, amount_preset=10.0, op_ids=_ids)
# V4.5.13: أُلغيت «إنشاء سند صرف تلقائي» — والمؤشر التلقائي للفارق حلّ مكانها
check("لا مربّع سند صرف في تسديد الشركة الأخرى",
      not hasattr(td, "voucher_chk"))
check("مؤشر الفارق يظهر ويسمّي العمولة",
      bool(td.diff_hint.text()) and "عمولة" in td.diff_hint.text(),
      td.diff_hint.text())
rd = CustodyReturnDialog(None, account_id=_cid)
check("نافذة الإرجاع تُبنى وتعرض المتبقي",
      rd.account.count() >= 1 and "1,000" in rd.balance_lbl.text(),
      rd.balance_lbl.text())

print("")
print(f"V4.52 bank-fees-custody-return: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
