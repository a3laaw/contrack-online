# -*- coding: utf-8 -*-
"""افتراضيات نافذة ربط مراحل ودفعات النوع: مبلغ يدوي + ربط بمرحلة."""
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
    dlg = PaymentEditDialog(None, "نوع افتراضيات الدفعات")
    assert dlg.use_fixed.isChecked(), "طريقة قيمة الدفعة يجب أن تبدأ على مبلغ يدوي"
    assert not dlg.use_pct.isChecked()
    assert dlg.link_stage.isChecked(), "طريقة الاستحقاق يجب أن تبدأ على ربط الدفعة بمرحلة"
    assert not dlg.link_manual.isChecked()
    print("OK: افتراضيات الدفعة مبلغ يدوي وربط بمرحلة")
    app.quit()


if __name__ == "__main__":
    main()
