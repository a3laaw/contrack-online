# -*- coding: utf-8 -*-
"""شاشة سند القبض تحدث بيان الدفعة الكاملة عند تغيير المبلغ إلى زيادة/نقص."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import customer_service as customers  # noqa: E402
from services import contract_service as contracts  # noqa: E402
from ui.vouchers import VoucherDialog  # noqa: E402


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    cid = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل تحديث بيان", phone="55770001"))
    kid = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=cid,
        contract_date=date.today().isoformat(), description="عقد دفعة كاملة 100", amount=100,
        contract_type="تصميم"))
    dlg = VoucherDialog(None, "receipt")
    dlg.party_kind.setCurrentIndex(dlg.party_kind.findData("customer"))
    dlg.party.select_data(cid)
    dlg._reload_contracts()
    dlg.contract.select_data(kid)
    dlg.amount.setValue(80)
    dlg._auto_description()
    assert "سداد دفعة أولى" in dlg.description.toPlainText(), dlg.description.toPlainText()
    dlg.amount.setValue(150)
    dlg._auto_description()
    assert "وزيادة مقدمة" in dlg.description.toPlainText() and "50.000" not in dlg.description.toPlainText(), dlg.description.toPlainText()
    print("OK: واجهة سند القبض تحدث بيان الدفعة الكاملة للزيادة والنقص")
    app.quit()


if __name__ == "__main__":
    main()
