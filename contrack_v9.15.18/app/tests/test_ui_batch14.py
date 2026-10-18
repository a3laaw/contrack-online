# -*- coding: utf-8 -*-
"""اختبار الدفعة 14: معاينة PDF — §10."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


app = QApplication.instance() or QApplication([])
from ui.pdf_preview import PdfPreviewDialog  # noqa: E402


def _make_pdf(pages=2):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rl_canvas
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    c = rl_canvas.Canvas(path, pagesize=A4)
    for i in range(pages):
        c.drawString(100, 500, f"page {i + 1}")
        c.showPage()
    c.save()
    return path


path = _make_pdf(2)
dlg = PdfPreviewDialog(None, path, title="معاينة اختبار")
app.processEvents()
check("العنوان", dlg.windowTitle() == "معاينة اختبار")
by_text = {b.text(): b for b in dlg.findChildren(QPushButton)}
for want in ("🖨 طباعة", "💾 حفظ PDF", "تكبير +", "تصغير −", "✕ إغلاق"):
    check(f"زر: {want}", want in by_text)
check("الرئيسي طباعة فقط",
      by_text["🖨 طباعة"].objectName() == "btnPrimary"
      and all(by_text[w].objectName() != "btnPrimary"
              for w in ("💾 حفظ PDF", "تكبير +", "تصغير −", "✕ إغلاق")))
tips = [by_text[w].toolTip() for w in
        ("🖨 طباعة", "💾 حفظ PDF", "تكبير +", "تصغير −", "✕ إغلاق")]
check("التلميحات", all(len(x) > 5 for x in tips), tips)
check("لا أرشيف افتراضيًا", "📁 حفظ في ملف العميل" not in by_text)
check("الصفحات", dlg._pages_lbl.text() == "2 صفحات",
      dlg._pages_lbl.text())
check("التكبير الابتدائي", dlg._zoom_lbl.text() == "100%")
dlg._set_zoom(1.5)
check("تحديث النسبة", dlg._zoom_lbl.text() == "150%")
dlg._set_zoom(99.0)
check("سقف التكبير", dlg._zoom == 3.0 and dlg._zoom_lbl.text() == "300%")
dlg._set_zoom(0.01)
check("أرضية التكبير", dlg._zoom == 0.4 and dlg._zoom_lbl.text() == "40%")

dlg2 = PdfPreviewDialog(None, path, archive_customer=1)
app.processEvents()
by2 = {b.text(): b for b in dlg2.findChildren(QPushButton)}
check("زر الأرشيف", "📁 حفظ في ملف العميل" in by2
      and by2["📁 حفظ في ملف العميل"].property("flat") is True
      and len(by2["📁 حفظ في ملف العميل"].toolTip()) > 5)

os.remove(path)
print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
