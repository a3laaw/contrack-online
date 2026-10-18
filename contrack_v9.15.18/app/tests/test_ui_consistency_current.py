# -*- coding: utf-8 -*-
"""مراجعة اتساق الواجهة الحالية حسب ملاحظات التنظيف الأخيرة."""
import os
import sys
from pathlib import Path

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from database import database  # noqa: E402


def _ui_text() -> str:
    chunks = []
    for p in Path("ui").rglob("*.py"):
        chunks.append(p.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(chunks)


def main():
    database.init_db()
    from PySide6.QtWidgets import QApplication, QPushButton, QLineEdit
    from ui.word_forms_center import WordFormsCenterPage

    app = QApplication.instance() or QApplication([])
    page = WordFormsCenterPage()

    official = page.tabs.widget(0)
    general = page.tabs.widget(1)
    off_buttons = [b.text().strip() for b in official.findChildren(QPushButton)]
    gen_buttons = [b.text().strip() for b in general.findChildren(QPushButton)]
    for label in ("بحث باسم النموذج...",):
        assert label in [e.placeholderText().strip() for e in official.findChildren(QLineEdit)]
        assert label in [e.placeholderText().strip() for e in general.findChildren(QLineEdit)]
    for label in ("رفع Word", "📥 استيراد مجلد", "تعبئة", "ربط الحقول", "✎ تعديل البيانات", "أرشفة/استعادة", "🗑 حذف"):
        assert label in off_buttons, f"العقود وعروض الأسعار ناقص: {label}"
        assert label in gen_buttons, f"باقي النماذج ناقص: {label}"

    txt = _ui_text()
    for banned in ("توليد نموذج", "توليد النموذج", "الإجراءات الأساسية", "تنبيهات هذا العميل"):
        assert banned not in txt, f"عبارة واجهة قديمة ما زالت موجودة: {banned}"

    print("OK: اتساق الواجهة الحالي مطابق للملاحظات الأخيرة")


if __name__ == "__main__":
    main()
