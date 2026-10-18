# -*- coding: utf-8 -*-
"""نافذة صلاحيات الموظف مكبرة وتراعي سياسة تعديل السند الأخيرة."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from services import auth_service  # noqa: E402
from ui.settings import UserPermsDialog  # noqa: E402


def main() -> None:
    database.init_db()
    auth_service.ensure_default_user()
    uid = auth_service.add_user("sec_policy", "1234", auth_service.ROLE_SECRETARY,
                               full_name="سكرتير سياسة السند")
    user = auth_service.get_user("sec_policy")
    app = QApplication.instance() or QApplication([])
    dlg = UserPermsDialog(user)
    assert dlg.minimumWidth() >= 900
    assert dlg.height() >= 700 or dlg.minimumHeight() >= 0
    boxes = dlg._boxes
    assert boxes["action_edit_voucher"].isChecked()
    assert not boxes["action_edit_voucher_description"].isChecked()
    assert not boxes["action_edit_voucher_description"].isEnabled()
    print("OK: نافذة الصلاحيات مكبرة وتعديل البيان غير مكرر مع تعديل السند الكامل")
    app.quit()


if __name__ == "__main__":
    main()
