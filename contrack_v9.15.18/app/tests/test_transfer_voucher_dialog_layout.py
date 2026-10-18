# -*- coding: utf-8 -*-
"""شاشة التحويل الداخلي: من حساب ثم إلى حساب بجانب بعض والبيان يتغير تلقائيًا."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402


def main():
    database.init_db()
    today = date.today().isoformat()
    lc.add_voucher("receipt", today, "رصيد بنكي", "البنك", "", 200, "رصيد البنك")

    from PySide6.QtWidgets import QApplication
    from ui.vouchers import VoucherDialog

    app = QApplication.instance() or QApplication([])
    dlg = VoucherDialog(None, "payment")
    idx = dlg.party_kind.findData("transfer")
    assert idx >= 0
    dlg.party_kind.setCurrentIndex(idx)
    app.processEvents()

    assert dlg.transfer_accounts_host.isVisible() or not dlg.transfer_accounts_host.isHidden()
    # V2.50: القوائم تبدأ فارغة — تُختار صراحة
    assert dlg.transfer_from.currentIndex() == -1
    assert dlg.transfer_to.currentIndex() == -1
    assert dlg.number.text().startswith("TV-"), "رقم التحويل الداخلي يجب أن يبدأ TV"
    assert dlg.method.isHidden() and dlg.expense_account.isHidden(), "لا نكرر حقول من/إلى عموديًا في التحويل"

    dlg.transfer_from.setCurrentText("البنك")
    dlg.transfer_to.setCurrentText("الصندوق")
    app.processEvents()
    assert dlg.description.toPlainText() == "تحويل داخلي من البنك إلى الصندوق"

    dlg.transfer_from.setCurrentText("الصندوق")
    dlg.transfer_to.setCurrentText("البنك")
    app.processEvents()
    assert dlg.description.toPlainText() == "تحويل داخلي من الصندوق إلى البنك"
    assert dlg.method.currentText() == "الصندوق"
    assert dlg.expense_account.currentText() == "البنك"
    print("OK: شاشة التحويل الداخلي مختصرة والبيان يتغير حسب من/إلى")


if __name__ == "__main__":
    main()
