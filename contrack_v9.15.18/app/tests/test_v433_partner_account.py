# -*- coding: utf-8 -*-
"""V4.33: حساب جارٍ للشريك — تمويل/مسحوبات (رصيد بلا إيراد) + ترحيل V4.32.

يغطي: حفظ قبض/صرف بطرف شريك · القيد مقابل جاري الشريك · بلا رسوم بنك ·
الاستبعاد من الوارد/المنصرف/الربحية · الرصيد والموازنات · الحوار · الإلغاء ·
ترحيل بيانات «المالك» القديمة (مرة واحدة، آمن للتكرار).
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

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as contracts  # noqa: E402
from services import customer_service as customers  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


D = "2026-09-20"


def _journal(vid, vtype):
    with database.get_connection() as conn:
        return conn.execute(
            "SELECT debit_account, credit_account FROM journal_entries "
            "WHERE source_type=? AND source_id=?",
            (f"voucher_{vtype}", vid)).fetchone()


print("=== 1. الحفظ والقيد ===")
rid = lc.add_voucher("receipt", D, "الشريك", "تحويل بنكي", "جاري الشريك",
                     1000.0, "تمويل من الشريك", party_type="partner",
                     party_id=None)
with database.get_connection() as conn:
    n_v = conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
check("تمويل محفوظ بلا رسوم بنك", rid > 0 and n_v == 1, n_v)
pid = lc.add_voucher("payment", D, "الشريك", "تحويل بنكي", "جاري الشريك",
                     200.0, "مسحوبات للشريك", party_type="partner",
                     party_id=None)
check("مسحوبات بلا طرف مرتبط", pid > 0)
check("رصيد الجاري 800", lc.partner_balance() == 800.0,
      lc.partner_balance())
jr = _journal(rid, "receipt")
check("قيد التمويل: مدين البنك دائن الجاري",
      jr and jr[0] == "البنك" and jr[1] == "جاري الشريك",
      tuple(jr) if jr else None)
jp = _journal(pid, "payment")
check("قيد المسحوبات: مدين الجاري دائن البنك",
      jp and jp[0] == "جاري الشريك" and jp[1] == "البنك",
      tuple(jp) if jp else None)
try:
    lc.add_voucher("payment", D, "", "نقدًا", "x", 10.0, "t",
                   party_type="customer", party_id=None)
    _raised = False
except Exception:
    _raised = True
check("انحدار: عميل بلا ربط مرفوض", _raised)
lc.update_voucher(pid, D, "تحويل بنكي", 300.0, "مسحوبات للشريك",
                  party_type="partner", party_id=None, party="الشريك",
                  account="جاري الشريك")
check("تعديل المسحوبات → الجاري 700", lc.partner_balance() == 700.0,
      lc.partner_balance())

print("=== 2. التقارير ===")
cid = customers.add_customer(Customer(
    customer_code=customers.next_customer_code(), name="عميل ر",
    phone="55770001"))
kid = contracts.add_contract(Contract(
    contract_number=contracts.next_contract_number(), customer_id=cid,
    contract_date=D, description="عقد ر", amount=5000.0,
    contract_type="تصميم"))
lc.add_voucher("receipt", D, "", "نقدًا", "", 500.0, "دفعة",
               contract_id=kid, party_type="customer", party_id=cid)
d = rep.cash_flow_detail("2026-09-01", "2026-09-30")
t = d["totals"]
check("التفصيلي: وارد/منصرف بلا شريك",
      t["in"] == 500.0 and t["out"] == 0.0 and t["net"] == 500.0, t)
check("قسم الشريك + صافيه",
      len(d["partner_moves"]) == 2 and t["partner_net"] == 700.0
      and t["partner_balance"] == 700.0,
      (len(d["partner_moves"]), t["partner_net"]))
check("الموازنات تشمل الشريك",
      t["bank"] == 700.0 and t["cash"] == 500.0
      and t["closing"] == 1200.0, (t["bank"], t["cash"]))
b = rep.cash_flow_report("2026-09-01", "2026-09-30", "monthly")
bt = b["totals"]
check("الفترات: داخل/خارج نظيف + رصيد صحيح",
      bt["inflow"] == 500.0 and bt["outflow"] == 0.0
      and bt["partner_net"] == 700.0 and bt["closing"] == 1200.0, bt)
pr = rep.profitability_report()
check("الربحية: محصّل العقد فقط",
      pr["totals"]["collected"] == 500.0
      and pr["totals"]["profit"] == 500.0,
      pr["totals"])

print("=== 3. الحوار ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.vouchers import VoucherDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
dr = VoucherDialog(None, "receipt")
check("القبض: الشريك ثالثًا",
      [dr.party_kind.itemData(i)
       for i in range(dr.party_kind.count())]
      == ["customer", "subcontractor", "partner"])
dr.party_kind.setCurrentData("partner")
app.processEvents()
check("وضع الشريك: بلا طرف/عقد/مجمّع + بيان تلقائي",
      dr.party.isHidden() and dr.contract.isHidden()
      and not dr.method.isHidden()
      and dr.grouped_receipt_check.isHidden()
      and dr.description.toPlainText() == "تمويل من الشريك",
      dr.description.toPlainText())
dp = VoucherDialog(None, "payment")
check("الصرف: الشريك خامسًا",
      [dp.party_kind.itemData(i)
       for i in range(dp.party_kind.count())]
      == ["customer", "subcontractor", "", "transfer", "partner"])
dp.party_kind.setCurrentData("partner")
app.processEvents()
check("الصرف: حساب المصروف مخفي + بيان مسحوبات",
      dp.expense_account.isHidden()
      and dp.description.toPlainText() == "مسحوبات للشريك")
_meths = [dr.method.itemText(i) for i in range(dr.method.count())]
dr.method.setCurrentText("نقدًا" if "نقدًا" in _meths else _meths[0])
dr.amount.setValue(100.0)
dr._execute_save()
app.processEvents()
with database.get_connection() as conn:
    _orow = conn.execute(
        "SELECT * FROM vouchers "
        "WHERE amount=100.0 AND vtype='receipt'").fetchone()
check("حفظ الحوار: شريك بلا عقد",
      _orow and _orow["party"] == "الشريك"
      and _orow["party_type"] == "partner"
      and _orow["account"] == "جاري الشريك"
      and _orow["contract_id"] is None
      and lc.partner_balance() == 800.0,
      tuple(_orow) if _orow else None)
de = VoucherDialog(None, "receipt", voucher=dict(_orow))
check("وضع التعديل يختار الشريك",
      de.party_kind.currentData() == "partner")

print("=== 4. قسم التقرير ===")
from ui.reports_page import _data_cash_flow  # noqa: E402
spec = _data_cash_flow("detail", "2026-09-01", "")  # بلا نهاية: تاريخ الحوار = اليوم
_cells = [str(c) for r in spec["rows"] for c in r]
check("قسم حركات الشريك + رصيد الجاري",
      "◀ حركات الشريك — لا تُدخل ضمن الوارد/المنصرف" in _cells
      and "رصيد جاري الشريك" in _cells
      and "جاري الشريك 800.000" in spec["note"])
check("مفتاح التمييز مشروط بالقسم",
      "الإجمالي · حركات الشريك" in (spec["accent_rows"] or {}))

print("=== 5. الإلغاء ===")
lc.cancel_voucher(pid, "اختبار")
check("الإلغاء يستبعد من الجاري", lc.partner_balance() == 1100.0,
      lc.partner_balance())
with database.get_connection() as conn:
    _rev = conn.execute(
        "SELECT 1 FROM journal_entries WHERE source_type='voucher_cancel' "
        "AND source_id=?", (pid,)).fetchone()
check("قيد عكسي للملغي", _rev is not None)

print("=== 6. ترحيل بيانات V4.32 (مالك ← شريك) ===")
mid = lc.add_voucher("receipt", D, "الشريك", "تحويل بنكي", "جاري الشريك",
                     250.0, "تمويل من الشريك", party_type="partner",
                     party_id=None)
mid2 = lc.add_voucher("payment", D, "الشريك", "تحويل بنكي", "جاري الشريك",
                      50.0, "مسحوبات للشريك", party_type="partner",
                      party_id=None)
with database.get_connection() as conn:
    # محاكاة صفي V4.32: إعادة القيم القديمة يدويًا (بصيغتي الألف واللام).
    conn.execute("UPDATE vouchers SET party_type='owner', party='المالك', "
                 "account='جاري المالك', description='تمويل من المالك' "
                 "WHERE id=?", (mid,))
    conn.execute("UPDATE vouchers SET party_type='owner', party='المالك', "
                 "account='جاري المالك', description='مسحوبات للمالك' "
                 "WHERE id=?", (mid2,))
    for _vid in (mid, mid2):
        conn.execute("UPDATE journal_entries SET debit_account='جاري المالك' "
                     "WHERE source_id=? AND debit_account='جاري الشريك'",
                     (_vid,))
        conn.execute("UPDATE journal_entries SET credit_account='جاري المالك' "
                     "WHERE source_id=? AND credit_account='جاري الشريك'",
                     (_vid,))
check("قبل الترحيل: الصف القديم خارج الرصيد",
      lc.partner_balance() == 1100.0, lc.partner_balance())
_mig = lc.migrate_owner_to_partner()
with database.get_connection() as conn:
    _mrow = conn.execute(
        "SELECT party_type, party, account, description FROM vouchers "
        "WHERE id=?", (mid,)).fetchone()
    _mrow2 = conn.execute(
        "SELECT party_type, party, account, description FROM vouchers "
        "WHERE id=?", (mid2,)).fetchone()
    _mj = conn.execute(
        "SELECT COUNT(*) FROM journal_entries "
        "WHERE (debit_account='جاري المالك' "
        "OR credit_account='جاري المالك')").fetchone()[0]
check("السند رُحّل كاملًا (بصيغتي الألف واللام)",
      tuple(_mrow) == ("partner", "الشريك", "جاري الشريك",
                       "تمويل من الشريك")
      and tuple(_mrow2) == ("partner", "الشريك", "جاري الشريك",
                            "مسحوبات للشريك") and _mj == 0,
      (tuple(_mrow), tuple(_mrow2), _mj))
check("العدادات + الرصيد بعد الترحيل",
      _mig["vouchers"] >= 8 and _mig["journals"] >= 2
      and lc.partner_balance() == 1300.0,
      (_mig, lc.partner_balance()))
_mig2 = lc.migrate_owner_to_partner()
check("آمن للتكرار: صفر ثاني مرة",
      _mig2 == {"vouchers": 0, "journals": 0}, _mig2)

print("")
print("V4.33 partner-account: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
