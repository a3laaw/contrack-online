# -*- coding: utf-8 -*-
"""سند قبض العميل يجب أن يرتبط بعقد حتى يسمع في ملخص العقد."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication

from database import database
from database.models import Customer, Contract
from services import contract_service, customer_service
from ui.vouchers import VoucherDialog


def _customer(name: str, phone: str) -> int:
    return customer_service.add_customer(
        Customer(customer_code=customer_service.next_customer_code(), name=name, phone=phone))


def _contract(customer_id: int, desc: str) -> int:
    return contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=customer_id, contract_date="2026-01-01",
        contract_type="تصميم", description=desc, amount=1000))


def main() -> None:
    app = QApplication.instance() or QApplication([])
    database.init_db()

    one_cust = _customer("عميل عقد واحد", "55500001")
    one_contract = _contract(one_cust, "عقد وحيد")
    dlg = VoucherDialog(None, "receipt")
    dlg.party.select_data(one_cust)
    dlg._reload_contracts()
    app.processEvents()
    assert dlg.contract.selected_data() == one_contract, \
        "إذا كان للعميل عقد واحد يجب اختيار العقد تلقائيًا"

    multi_cust = _customer("عميل أكثر من عقد", "55500002")
    _contract(multi_cust, "العقد الأول")
    _contract(multi_cust, "العقد الثاني")
    dlg2 = VoucherDialog(None, "receipt")
    dlg2.party.select_data(multi_cust)
    dlg2._reload_contracts()
    app.processEvents()
    assert len(dlg2._available_contract_ids()) == 2
    assert dlg2.contract.selected_data() is None, \
        "عند وجود أكثر من عقد يجب أن يختار المستخدم العقد صراحة"

    print("OK: سند قبض العميل يختار العقد الوحيد تلقائيًا ويطلب التحديد عند تعدد العقود")


if __name__ == "__main__":
    main()
