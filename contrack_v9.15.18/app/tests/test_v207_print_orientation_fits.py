# -*- coding: utf-8 -*-
"""V2.07 بند 5: الطباعة تحترم الاتجاه + الكشف/الفاتورة بلا فيض."""
import os
import sys
import tempfile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtPdf import QPdfDocument  # noqa: E402
from PySide6.QtGui import QPageLayout  # noqa: E402
from PySide6.QtPrintSupport import (  # noqa: E402
    QPrintDialog as RealDialog, QPrinter as RealPrinter)
from database import database  # noqa: E402
from database.models import Customer, Contract, Invoice, Settings  # noqa: E402
from services import (  # noqa: E402
    contract_service, customer_service, invoice_service, settings_service)
from ui import pdf_preview  # noqa: E402


def _make_pdf(path, landscape_mode):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas as rl_canvas
    c = rl_canvas.Canvas(path, pagesize=landscape(A4) if landscape_mode else A4)
    c.drawString(100, 500, "orientation probe")
    c.save()


def _load_doc(app, path):
    doc = QPdfDocument(app)
    doc.load(path)
    for _ in range(400):
        app.processEvents()
        if doc.status() == QPdfDocument.Ready:
            return doc
    raise AssertionError("QPdfDocument لم يجهز")


class _FakePrinter:
    HighResolution = RealPrinter.HighResolution
    DevicePixel = RealPrinter.DevicePixel

    def __init__(self, *a, **k):
        self.orientations = []

    def setPageOrientation(self, o):
        self.orientations.append(o)


class _FakeDialog:
    Rejected = RealDialog.Rejected
    Accepted = RealDialog.Accepted

    def __init__(self, printer, parent=None):
        self._printer = printer

    def setWindowTitle(self, t):
        pass

    def exec(self):
        return RealDialog.Rejected


def _print_orientation(app, path):
    doc = _load_doc(app, path)
    dlg = pdf_preview.PdfPreviewDialog(None, path)
    dlg._doc = doc
    old_p, old_d = pdf_preview.QPrinter, pdf_preview.QPrintDialog
    pdf_preview.QPrinter, pdf_preview.QPrintDialog = _FakePrinter, _FakeDialog
    try:
        captured = {}

        def _fake_init(self, *a, **k):
            captured["printer"] = self
            self.orientations = []

        _FakePrinter.__init__ = _fake_init
        dlg._print()
        return captured["printer"].orientations
    finally:
        pdf_preview.QPrinter, pdf_preview.QPrintDialog = old_p, old_d


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    tmp = tempfile.mkdtemp()
    land, port = os.path.join(tmp, "l.pdf"), os.path.join(tmp, "p.pdf")
    _make_pdf(land, True)
    _make_pdf(port, False)
    assert _print_orientation(app, land) == [QPageLayout.Landscape]
    assert _print_orientation(app, port) == [QPageLayout.Portrait]
    print("OK: اتجاه الطابعة يتبع اتجاه الصفحة")

    LONG = "نص طويل جدا للاختبار " * 12
    settings_service.save_settings(Settings(
        company_name="شركة " + LONG, company_address="عنوان " + LONG,
        company_phone="+965 90000000", company_email="long@test.com",
        logo_path="", currency="د.ك"))
    cid = customer_service.add_customer(Customer(
        customer_code="C-PF1", name="عميل " + LONG, phone="911",
        address="سكن " + LONG))
    kid = contract_service.add_contract(Contract(
        contract_number="CTR-" + "9" * 40, customer_id=cid,
        contract_date="2026-01-01", description="وصف عقد " + LONG,
        amount=100000.0))
    inv = Invoice(contract_id=kid, customer_id=cid,
                  invoice_number="INV-" + "8" * 40,
                  invoice_date="2026-02-01", amount=5000.0,
                  description="بيان فاتورة " + LONG,
                  notes="ملاحظة مهمة " * 20 + "ونهاية الملاحظات")
    iid = invoice_service.add_invoice(inv)
    from reports.invoice_pdf import generate_invoice_pdf
    from reports.statement_pdf import generate_statement_pdf
    pi, ps = os.path.join(tmp, "i.pdf"), os.path.join(tmp, "s.pdf")
    generate_invoice_pdf(invoice_service.get_invoice(iid), pi)
    generate_statement_pdf(kid, ps)
    try:
        from pypdf import PdfReader
    except ImportError:
        print("SKIP: فحص التقصير يحتاج pypdf")
        return
    ti = PdfReader(pi).pages[0].extract_text()
    ts = PdfReader(ps).pages[0].extract_text()
    assert "…" in ti and "…" in ts, "التقصير لم يعمل"
    print("OK: الكشف والفاتورة يقصّران النص الطويل بلا فيض")
    app.quit()


if __name__ == "__main__":
    main()
