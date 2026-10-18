# -*- coding: utf-8 -*-
"""تبويب العقود وعروض الأسعار يجب أن يملك أزرار إجراءات مثل باقي النماذج."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from database import database  # noqa: E402


def main():
    database.init_db()
    from PySide6.QtWidgets import QApplication, QPushButton, QLineEdit, QGridLayout
    from ui.word_forms_center import WordFormsCenterPage

    app = QApplication.instance() or QApplication([])
    page = WordFormsCenterPage()
    official_tab = page.tabs.widget(0)
    texts = [b.text().strip() for b in official_tab.findChildren(QPushButton)]
    for label in ("رفع Word", "📥 استيراد مجلد", "تعبئة", "ربط الحقول", "✎ تعديل البيانات", "أرشفة/استعادة", "🗑 حذف"):
        assert label in texts, f"زر {label} غير موجود في تبويب العقود وعروض الأسعار"
    placeholders = [e.placeholderText().strip() for e in official_tab.findChildren(QLineEdit)]
    assert "بحث باسم النموذج..." in placeholders, "بحث باسم النموذج غير موجود في تبويب العقود وعروض الأسعار"
    assert page.official_table.contextMenuPolicy().name == "CustomContextMenu"

    from services import word_service
    from ui.word_forms_center import OfficialTemplateFillDialog
    path = word_service.create_sample_template("contract")
    tpl = {"path": path, "name": "نموذج اختبار", "kind": "contract"}
    fields_before = word_service.official_template_fields(path)
    assert fields_before, "قوالب العقود يجب أن تُدار بحقول قابلة للربط مثل باقي النماذج"
    first = fields_before[0]
    word_service.update_official_field_mapping(
        path, first["placeholder"], source_type="auto", source_entity="system",
        source_key="today", context="", field_type="date", required=1)
    fields_after = word_service.official_template_fields(path)
    mapped = next(f for f in fields_after if f["placeholder"] == first["placeholder"])
    assert mapped["source_type"] == "auto" and mapped["source_key"] == "today"
    # تنظيف ربط الاختبار حتى لا تُسلَّم النسخة وبها تعديل اختبار على القالب النموذجي.
    import json
    maps_path = word_service._official_maps_path()
    if os.path.exists(maps_path):
        with open(maps_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.pop(word_service._official_map_key(path), None)
        with open(maps_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    dlg = OfficialTemplateFillDialog(tpl, page)
    assert dlg.windowTitle() == "تعبئة بيانات النموذج المختار"
    assert "اسم_العميل" in dlg._inputs, "شاشة التعبئة يجب أن تعرض حقول Word للتعديل اليدوي"
    assert dlg.output_format.count() >= 2
    assert first["placeholder"] in dlg._inputs, "شاشة العقود تستخدم نفس حقول الربط المحفوظة"
    assert isinstance(dlg.fields_form, QGridLayout), "حقول العقود/العروض يجب أن تُعرض في شبكة خانتين في الصف بدل قائمة طويلة"
    if len(dlg._inputs) >= 2:
        assert dlg.fields_form.rowCount() < len(dlg._inputs), "الشبكة يجب أن تقلل الطول بعرض خانتين في الصف"
    print("OK: تبويب العقود وعروض الأسعار مطابق لباقي النماذج: تعبئة + ربط مصادر تلقائية/يدوية + شبكة حقول")


if __name__ == "__main__":
    main()
