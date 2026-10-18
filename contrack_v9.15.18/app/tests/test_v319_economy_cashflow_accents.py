# -*- coding: utf-8 -*-
"""V3.19: التقرير المالي وحده يحتفظ بتلوين إجمالياته في الاقتصادي."""
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
from services import lifecycle_service as lc  # noqa: E402
from services import settings_service as ss  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


c1 = cs.add_customer(Customer(customer_code="C-191", name="عميل التقرير المالي",
                              phone="55001122"))
k1 = ks.add_contract(Contract(contract_number="K-191", customer_id=c1,
                              contract_date="2026-05-01",
                              description="عقد التقرير المالي",
                              amount=30000.0, contract_type="مقاولة عامة"))
lc.add_voucher("receipt", "2026-06-01", "", "نقدًا", "", 20000.0,
               "دفعة من العقد", contract_id=k1,
               party_type="customer", party_id=c1)
lc.add_voucher("payment", "2026-06-02", "مورد المواد", "شيك", "", 5000.0,
               "مواد للموقع", contract_id=k1)
lc.add_voucher("transfer", "2026-06-03", "", "الصندوق", "البنك", 1000.0,
               "تغذية البنك")

from reports.tabular_pdf import generate_table_pdf as _real_gen  # noqa: E402
from ui import reports_page as rp  # noqa: E402

TINTS = {(220, 252, 231), (254, 226, 226), (219, 234, 254),
         (254, 243, 199), (237, 233, 254)}


def _tints_in(path):
    import pymupdf
    doc = pymupdf.open(path)
    found = set()
    for pg in doc:
        px = pg.get_pixmap(dpi=80)
        smp, n = px.samples, px.n
        for i in range(0, len(smp), n * 37):
            t = (smp[i], smp[i + 1], smp[i + 2])
            # تسامح ±2: العرض يقرّب القنوات (219 بدل 220 مثلًا).
            for tint in TINTS:
                if all(abs(a - b) <= 2 for a, b in zip(t, tint)):
                    found.add(tint)
                    break
    doc.close()
    return found


def _render(spec, path, **kw):
    _real_gen("t", spec["heads"], spec["widths"], spec["rows"], path,
              totals_row=spec.get("totals"),
              footer_note=spec.get("note") or "",
              color_cols=spec.get("color_cols") or {},
              row_kinds=spec.get("row_kinds"),
              number_cols=spec.get("number_cols"),
              accent_rows=spec.get("accent_rows"),
              orientation="portrait", **kw)


def _set_econ(on):
    s = ss.get_settings()
    s.print_economy = on
    ss.save_settings(s)


print("=== 1. الاستثناء يعمل (بكسل) ===")
cash = rp._data_cash_flow("detail", "", "")
_set_econ(True)
_p1 = os.path.join(_tmpdir, "econ_cash_keep.pdf")
_render(cash, _p1, keep_accents_in_economy=True)
_got = _tints_in(_p1)
check("المالي في الاقتصادي ملوّن", (220, 252, 231) in _got
      and (254, 226, 226) in _got, f"{len(_got)} تلوينات")
_p2 = os.path.join(_tmpdir, "econ_cash_plain.pdf")
_render(cash, _p2)
check("بدون الاستثناء يبقى أبيض", not _tints_in(_p2))
_set_econ(False)
_p3 = os.path.join(_tmpdir, "normal_cash.pdf")
_render(cash, _p3)
check("العادي ملوّن كما كان", bool(_tints_in(_p3)))
_set_econ(True)
cust = rp._data_customers("", "", "all")
_p4 = os.path.join(_tmpdir, "econ_cust.pdf")
_render(cust, _p4)
check("غير المالي في الاقتصادي أبيض", not _tints_in(_p4))

print("=== 2. الربط من الواجهة ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

_calls = []
_fake_tab = types.ModuleType("reports.tabular_pdf")
_fake_tab.generate_table_pdf = lambda *a, **k: (_calls.append(k),
                                                 a[4] if len(a) > 4 else "")[1]
sys.modules["reports.tabular_pdf"] = _fake_tab
_fake_prev = types.ModuleType("ui.pdf_preview")


class _FakePreview:
    def __init__(self, *a, **k):
        pass

    def exec(self):
        return 0


_fake_prev.PdfPreviewDialog = _FakePreview
sys.modules["ui.pdf_preview"] = _fake_prev

from services import auth_service  # noqa: E402
from ui.reports_page import ReportsPage  # noqa: E402

auth_service.set_current_user("admin")
pg = ReportsPage()
pg.show()
app.processEvents()
_pg_idx = {x["key"]: i for i, x in enumerate(pg._visible)}
pg.open_report(_pg_idx["rep_cashflow"])
app.processEvents()
pg.view._export_pdf()
check("التصدير يمرر الاستثناء للمالي",
      _calls and _calls[-1].get("keep_accents_in_economy") is True)
pg.open_report(_pg_idx["rep_customers"])
app.processEvents()
pg.view._export_pdf()
check("غير المالي بلا استثناء",
      _calls and _calls[-1].get("keep_accents_in_economy") is False)

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
