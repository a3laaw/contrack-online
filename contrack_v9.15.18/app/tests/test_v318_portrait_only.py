# -*- coding: utf-8 -*-
"""V3.18: طباعة التقارير رأسية فقط ومباشرة — بلا رسالة سؤال."""
import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


c1 = cs.add_customer(Customer(customer_code="C-181", name="عميل الطباعة",
                              phone="55001122"))
ks.add_contract(Contract(contract_number="K-181", customer_id=c1,
                         contract_date="2026-04-01",
                         description="عقد اختبار الطباعة الرأسية",
                         amount=9000.0, contract_type="مقاولة عامة"))

print("=== 1. بلا سؤال اتجاه (استاتيكي) ===")
_src = open(os.path.join(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))),
    "ui", "reports_page.py"), encoding="utf-8").read()
check("دالة السؤال محذوفة", "_ask_orientation" not in _src)
check("الرأسي ثابت في التصدير", 'orientation="portrait"' in _src)

print("=== 2. تصدير مباشر رأسي (ديناميكي) ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

_captured = {}
_fake = types.ModuleType("ui.pdf_preview")


class _FakePreview:
    def __init__(self, parent, path, title="", save_name=""):
        _captured["path"] = path

    def exec(self):
        _captured["exec"] = True
        return 0


_fake.PdfPreviewDialog = _FakePreview
sys.modules["ui.pdf_preview"] = _fake

from services import auth_service  # noqa: E402
from ui.reports_page import ReportsPage  # noqa: E402

auth_service.set_current_user("admin")
pg = ReportsPage()
pg.show()
app.processEvents()
idx = next(i for i, x in enumerate(pg._visible) if x["key"] == "rep_customers")
pg.open_report(idx)
app.processEvents()
check("التقرير محمّل", pg.view._spec is not None)
# لو ظهر أي QMessageBox هنا لعلّق الاختبار — العودة برهان الغيابه.
pg.view._export_pdf()
app.processEvents()
check("وصل للمعاينة بلا حوار", _captured.get("exec") is True)
from pypdf import PdfReader  # noqa: E402

_box = PdfReader(_captured["path"]).pages[0].mediabox
check("الصفحة رأسية فعلًا", float(_box.width) < float(_box.height),
      f"{float(_box.width):.0f}×{float(_box.height):.0f}")

print("=== 3. الرأسي الضيق بلا قطع (بيانات طويلة) ===")
from services import expense_account_service as ea  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402

c2 = cs.add_customer(Customer(customer_code="C-182",
                              name="عبدالله محمد الخالدي العتيبي",
                              phone="51511111"))
k2 = ks.add_contract(Contract(
    contract_number="K-182", customer_id=c2,
    contract_date="2026-01-05",
    description="عقد مقاولة عامة لبناء فيلا سكنية مع الملحق الخارجي",
    amount=50000.0, contract_type="مقاولة عامة"))
_mat = ea.add_account("مواد بناء وتشطيبات للموقع", None, allow_posting=True)
lc.add_voucher("receipt", "2026-03-01", "", "نقدًا", "", 20000.0,
               "الدفعة الأولى من قيمة العقد حسب الاتفاق المبرم",
               contract_id=k2, party_type="customer", party_id=c2)
lc.add_voucher("payment", "2026-03-05", "شركة الخليج لمواد البناء",
               "شيك", "", 5000.0, "شراء مواد بناء وتشطيبات للموقع",
               contract_id=k2, expense_account_id=_mat)
from reports.tabular_pdf import generate_table_pdf  # noqa: E402
from ui import reports_page as rp  # noqa: E402


def _port_ellipsis(name, spec):
    _p = os.path.join(_tmpdir, f"p_{name}.pdf")
    generate_table_pdf(
        name, spec["heads"], spec["widths"], spec["rows"], _p,
        totals_row=spec.get("totals"), footer_note=spec.get("note") or "",
        color_cols=spec.get("color_cols") or {},
        row_kinds=spec.get("row_kinds"),
        number_cols=spec.get("number_cols"),
        accent_rows=spec.get("accent_rows"), orientation="portrait")
    _t = "\n".join((pg.extract_text() or "")
                   for pg in PdfReader(_p).pages)
    return _t.count("…")


for _name, _fn in [("customers", lambda: rp._data_customers("", "", "all")),
                   ("vouchers",
                    lambda: rp._data_vouchers_unified("", "", None))]:
    _n = _port_ellipsis(_name, _fn())
    check(f"رأسي بلا قطع: {_name}", _n == 0, f"{_n}× …")

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
