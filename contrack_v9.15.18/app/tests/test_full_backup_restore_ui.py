# -*- coding: utf-8 -*-
"""حماية زر استعادة النسخة الكاملة: لا يطلب اختيارًا رغم وجود نسخ.

كانت المشكلة العملية أن المستخدم يضغط «استعادة النسخة المحددة» والجدول
أمامه يحتوي نسخًا، لكن لا يوجد صف current في Qt فيظهر تنبيه «اختر نسخة».
الاختبار يثبت أن الجدول يحدد أحدث نسخة تلقائيًا بعد التعبئة.
"""
import os
import sys
import tempfile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from database import database  # noqa: E402


def main():
    database.init_db()
    from PySide6.QtWidgets import QApplication
    from services import full_backup_service as fbs
    from ui.settings import SettingsPage

    app = QApplication.instance() or QApplication([])
    folder = tempfile.mkdtemp(prefix="ctrack_full_bkp_")
    fbs.create_backup(monthly=False, custom_folder=folder)
    fbs.create_backup(monthly=True, custom_folder=folder)
    fbs.save_config(True, 7, 4, 3, folder, weekday=fbs.WEEKDAY_ORDER[0])

    page = SettingsPage()
    # قد لا تظهر أدوات المطور حسب الحساب في الاختبار؛ نستدعي الكارت مباشرة.
    card = page._full_backup_card()
    page._test_full_backup_card = card  # أبقِ الكارت حيًا أثناء فحص الجدول
    assert page.fb_table.rowCount() >= 2
    assert page.fb_table.currentRow() == 0
    assert getattr(page, "_fb_items", [])[0]["path"]
    print("OK: زر الاستعادة يجد أحدث نسخة محددة تلقائيًا")


if __name__ == "__main__":
    main()
