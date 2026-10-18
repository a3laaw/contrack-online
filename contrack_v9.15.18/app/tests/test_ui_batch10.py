# -*- coding: utf-8 -*-
"""اختبار الدفعة 10: مركز النماذج (توحيد + رئيسي واحد) — §10."""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import (QApplication, QPushButton,  # noqa: E402
                               QTableWidget)

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
from database.database import init_db  # noqa: E402

init_db()
from services import form_service as fs  # noqa: E402
from services import word_forms_service as wfs  # noqa: E402
from ui import style  # noqa: E402
from ui.word_forms_center import WordFormsCenterPage  # noqa: E402

LABELS = ("رفع Word", "📥 استيراد مجلد", "تعبئة", "ربط الحقول",
          "✎ تعديل البيانات", "أرشفة/استعادة", "🗑 حذف")

print("=== 1. الرأس والتبويبات ===")
pg = WordFormsCenterPage()
check("العنوان", pg.title_lbl.text() == "مركز النماذج"
      and pg.title_lbl.property("pageTitle") is True)
check("الوصف", pg.desc_lbl.property("pageDesc") is True
      and len(pg.desc_lbl.text()) > 10)
check("التبويبان", [pg.tabs.tabText(i) for i in range(pg.tabs.count())]
      == ["العقود وعروض الأسعار", "باقي النماذج"])
off, gen = pg.tabs.widget(0), pg.tabs.widget(1)
off_texts = [b.text().strip() for b in off.findChildren(QPushButton)]
gen_texts = [b.text().strip() for b in gen.findChildren(QPushButton)]
check("أزرار الرسمي السبعة", all(x in off_texts for x in LABELS),
      off_texts)
check("أزرار العام السبعة", all(x in gen_texts for x in LABELS),
      gen_texts)

print("=== 2. الرئيسي الواحد والتلميحات ===")
off_prim = [b for b in off.findChildren(QPushButton)
            if b.objectName() == "btnPrimary"]
gen_prim = [b for b in gen.findChildren(QPushButton)
            if b.objectName() == "btnPrimary"]
check("رئيسي الرسمي = تعبئة", len(off_prim) == 1
      and off_prim[0].text() == "تعبئة",
      [b.text() for b in off_prim])
check("رئيسي العام = تعبئة", len(gen_prim) == 1
      and gen_prim[0].text() == "تعبئة",
      [b.text() for b in gen_prim])
uploads = [b for b in pg.findChildren(QPushButton)
           if b.text() == "رفع Word"]
check("الرفع ثانوي", len(uploads) == 2
      and all(b.property("flat") is True
              and b.objectName() != "btnPrimary" for b in uploads))
off_tips = [b.toolTip() for b in off.findChildren(QPushButton)
            if b.text().strip() in LABELS]
gen_tips = [b.toolTip() for b in gen.findChildren(QPushButton)
            if b.text().strip() in LABELS]
check("تلميحات الرسمي", len(off_tips) == 7
      and all(len(x) > 5 for x in off_tips), off_tips)
check("تلميحات العام", len(gen_tips) == 7
      and all(len(x) > 5 for x in gen_tips), gen_tips)

print("=== 3. الجداول والحالات ===")
check("بحث التبويبين",
      pg.official_search.placeholderText() == "بحث باسم النموذج..."
      and pg.search.placeholderText() == "بحث باسم النموذج...")
check("أعمدة الرسمي", [pg.official_table.horizontalHeaderItem(i).text()
                       for i in range(4)]
      == ["النوع", "النموذج", "النطاق", "المسار"])
check("أعمدة العام", [pg.table.horizontalHeaderItem(i).text()
                      for i in range(6)]
      == ["النموذج", "الإصدار", "الحالة", "الحقول",
          "آخر تعديل", "مسار Word"])
from docx import Document  # noqa: E402

tmp = "/tmp/b10tpl.docx"
d = Document()
d.add_paragraph("عقد {{اسم_العميل}} بمبلغ {{المبلغ}}")
d.save(tmp)
tids = []
try:
    for name, st in (("نموذج مسودة ب10", "مسودة"),
                     ("نموذج معتمد ب10", "معتمد"),
                     ("نموذج مؤرشف ب10", "مؤرشف")):
        tid = wfs.import_docx(name, tmp, "وصف ب10")["id"]
        wfs.set_template_status(tid, st, updated_by="اختبار")
        tids.append(tid)
    pg.refresh()
    app.processEvents()
    rows = {pg.table.item(r, 0).text(): r
            for r in range(pg.table.rowCount())}
    for name, st in (("نموذج مسودة ب10", "مسودة"),
                     ("نموذج معتمد ب10", "معتمد"),
                     ("نموذج مؤرشف ب10", "مؤرشف")):
        r = rows.get(name)
        want = style.STATUS_COLORS.get(st, style.STATUS_DEFAULT).upper()
        got = pg.table.item(r, 2).foreground().color().name().upper() \
            if r is not None else None
        check(f"لون الحالة: {st}",
              r is not None and pg.table.item(r, 2).text() == st
              and got == want, (r, got, want))
finally:
    for tid in tids:
        shutil.rmtree(os.path.join(fs._tpl_dir(), f"tpl-{tid}"),
                      ignore_errors=True)
    if os.path.exists(tmp):
        os.remove(tmp)

print("=== 4. السلوك المحفوظ ===")
check("القوائم اليمنى",
      pg.official_table.contextMenuPolicy() == Qt.CustomContextMenu
      and pg.table.contextMenuPolicy() == Qt.CustomContextMenu)
check("بلا تحرير مباشر",
      pg.official_table.editTriggers() == QTableWidget.NoEditTriggers
      and pg.table.editTriggers() == QTableWidget.NoEditTriggers)
check("تحديد صفوف + تناوب",
      pg.table.selectionBehavior() == QTableWidget.SelectRows
      and pg.table.alternatingRowColors()
      and pg.official_table.alternatingRowColors())

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
