# -*- coding: utf-8 -*-
"""خيار دفعة كاملة / بدون ترتيب في نافذة دفعة جديدة."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from ui.type_workflow import PaymentEditDialog  # noqa: E402


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    dlg = PaymentEditDialog(None, "نوع اختبار دفعة كاملة")
    dlg.full_payment.setChecked(True)
    assert dlg.title.text() == "دفعة كاملة"
    assert not dlg.title.isEnabled()
    assert not dlg.no.isEnabled()
    assert dlg.pct_value() == 100.0
    assert dlg.selected_stage_ids() == []
    assert dlg.trigger_value() == 0
    assert dlg.days.value() == 0
    dlg.full_payment.setChecked(False)
    assert dlg.title.isEnabled()
    assert dlg.no.isEnabled()
    print("OK: خيار دفعة كاملة يعطل رقم/اسم الدفعة ويكتب دفعة كاملة")
    app.quit()


if __name__ == "__main__":
    main()
