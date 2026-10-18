# -*- coding: utf-8 -*-
"""V3.17: لا قطع كلمات (…) في أي تقرير جدولي — تدقيق كل التقارير."""
import os
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
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import supervision_service as sup  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


# ---------- بيانات طويلة واقعية ----------
LONG1 = "عبدالله محمد الخالدي العتيبي"
LONG2 = "سعود حمود الرشيدي المطيري"
c1 = cs.add_customer(Customer(customer_code="C-171", name=LONG1,
                              phone="51511111"))
c2 = cs.add_customer(Customer(customer_code="C-172", name=LONG2,
                              phone="66444881"))
cs.add_customer(Customer(customer_code="C-173",
                        name="عميل مستقبلي بلا عقود للفرص البيعية",
                        phone="99001122"))
k1 = ks.add_contract(Contract(
    contract_number="K-171", customer_id=c1,
    contract_date="2026-01-05",
    description="عقد مقاولة عامة لبناء فيلا سكنية مع الملحق الخارجي",
    amount=50000.0, contract_type="مقاولة عامة"))
k2 = ks.add_contract(Contract(
    contract_number="K-172", customer_id=c2,
    contract_date="2026-02-05",
    description="عقد إشراف هندسي شهري على مشروع المجمع التجاري",
    amount=12000.0, contract_type="إشراف"))
sup.setup_supervision(k2, "2026-02-05", 12, 1000.0)
root = ea.add_account("العهد", None, allow_posting=False)
a1 = ea.add_account("عهدة المهندس سعد الشمري", root, account_kind="advance")
mat = ea.add_account("مواد بناء وتشطيبات للموقع", None, allow_posting=True)
sub = lc.add_subcontractor("SUB-17", "مؤسسة النور للمقاولات الكهربائية",
                           phone="66000011", activity="كهرباء وتمديدات")
lc.add_sub_contract(sub, k1, None, 8000.0, "2026-02-01", "2026-06-01",
                    "أعمال الكهرباء والتمديدات للفيلا")
lc.add_voucher("receipt", "2026-03-01", "", "نقدًا", "", 20000.0,
               "الدفعة الأولى من قيمة العقد حسب الاتفاق المبرم",
               contract_id=k1, party_type="customer", party_id=c1)
lc.add_voucher("payment", "2026-03-05", "شركة الخليج لمواد البناء",
               "شيك", "", 5000.0, "شراء مواد بناء وتشطيبات للموقع",
               contract_id=k1, expense_account_id=mat)
lc.add_voucher("payment", "2026-03-06", "", "نقدًا", "", 2000.0,
               "دفعة مقدمة لمقاول الباطن عن أعمال الكهرباء",
               contract_id=k1, party_type="subcontractor", party_id=sub)
lc.add_voucher("transfer", "2026-03-07", "", "الصندوق", "البنك", 1000.0,
               "تغذية الحساب البنكي من الصندوق الرئيسي")
lc.add_voucher("payment", "2026-03-08", "المهندس سعد", "نقدًا", "", 3000.0,
               "تسليم عهدة للموقع", custody_account_id=a1)
lc.add_custody_settlement("2026-03-09", a1, [
    {"vdate": "2026-03-09", "expense_account_id": mat,
     "party": "محطة الوقود المركزية", "contract_id": k1,
     "amount": 500.0, "description": "بنزين ومحروقات لمعدات الموقع"},
    {"vdate": "2026-03-09", "expense_account_id": mat,
     "party": "ورشة النور للإصلاح والصيانة", "contract_id": k1,
     "amount": 300.0, "description": "إصلاح وصيانة المعدات المتعطلة"}],
    "تصفية مصروفات الموقع الشهرية")

# ---------- التدقيق ----------
from reports.tabular_pdf import generate_table_pdf  # noqa: E402
from ui import reports_page as rp  # noqa: E402


def _pdf_text(path):
    from pypdf import PdfReader
    rdr = PdfReader(path)
    return "\n".join((pg.extract_text() or "") for pg in rdr.pages)


def _render(name, spec, **kw):
    path = os.path.join(_tmpdir, f"{name}.pdf")
    generate_table_pdf(
        name, spec["heads"], spec["widths"], spec["rows"], path,
        totals_row=spec.get("totals"),
        footer_note=spec.get("note") or "",
        color_cols=spec.get("color_cols") or {},
        row_kinds=spec.get("row_kinds"),
        right_align_cols=tuple(spec.get("right_align_cols") or ()),
        number_cols=spec.get("number_cols"),
        accent_rows=spec.get("accent_rows"), **kw)
    return _pdf_text(path)


CASES = [
    ("customers-all", rp._data_customers("", "", "all")),
    ("customers-with_balance", rp._data_customers("", "", "with_balance")),
    ("customers-no_balance", rp._data_customers("", "", "no_balance")),
    ("customers-due_only", rp._data_customers("", "", "due_only")),
    ("supervision-unpaid", rp._data_supervision_delays("unpaid")),
    ("supervision-all", rp._data_supervision_delays("all")),
    ("subcontractors", rp._data_subcontractors()),
    ("vouchers-all", rp._data_vouchers_unified("", "", None)),
    ("vouchers-receipt", rp._data_vouchers_unified("", "", "receipt")),
    ("vouchers-payment", rp._data_vouchers_unified("", "", "payment")),
    ("profitability", rp._data_profitability()),
    ("customer_profitability", rp._data_customer_profitability()),
    ("prospects", rp._data_prospects("", "")),
    ("cashflow-detail", rp._data_cash_flow("detail", "", "")),
    ("cashflow-receipts", rp._data_cash_flow("receipts_only", "", "")),
    ("cashflow-payments", rp._data_cash_flow("payments_only", "", "")),
    ("cashflow-transfers", rp._data_cash_flow("transfers_only", "", "")),
    ("cashflow-auto", rp._data_cash_flow("auto", "", "")),
    ("cashflow-monthly", rp._data_cash_flow("monthly", "", "")),
    ("contracts-all", rp._data_contracts("all", "", "")),
    ("contracts-by_type", rp._data_contracts("by_type", "", "")),
    ("contracts-profitability", rp._data_contracts("profitability", "", "")),
    ("contracts-expiring", rp._data_contracts("expiring", "", "")),
    ("execution-current", rp._data_execution("current")),
    ("execution-all", rp._data_execution("all")),
    ("journal", rp._data_journal("", "")),
    ("expenses", rp._data_expenses("", "")),
]

print("=== 1. تقارير المركز (27 مواصفة) ===")
bad = {}
for name, spec in CASES:
    try:
        text = _render(name, spec)
    except Exception as exc:
        bad[name] = f"EXC {exc}"
        continue
    n = text.count("…")
    if n:
        bad[name] = f"{n}× …"
for name, spec in CASES:
    check(f"بلا قطع: {name}", name not in bad, bad.get(name, ""))
print(f"    --- المتقطعة: {len(bad)} / {len(CASES)} ---")

print("=== 2. مطبوعات العهد ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.custody_center import CustodyReportsWidget  # noqa: E402

w = CustodyReportsWidget(None)
app.processEvents()
_cust = [
    ("custody-settlements", w.HEADS, [26, 20, 30, 14, 20, 52],
     w._rows_export(),
     {"number_cols": [4]}),
    ("custody-balances", w.BAL_HEADS, [44, 22, 22, 24, 16, 18],
     w._balances_export(), {}),
    ("custody-open", w.OPEN_HEADS, [36, 20, 20, 20, 20, 14, 16],
     w._open_export(), {}),
]
for name, heads, widths, rows, kw in _cust:
    path = os.path.join(_tmpdir, f"{name}.pdf")
    generate_table_pdf(name, heads, widths, rows, path, **kw)
    n = _pdf_text(path).count("…")
    check(f"بلا قطع: {name}", n == 0, f"{n}× …")

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
