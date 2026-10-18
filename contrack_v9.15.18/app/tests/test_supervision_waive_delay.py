# -*- coding: utf-8 -*-
"""إلغاء مدة إشراف يجب أن يقلل نهاية المدة الكاملة والتأخير."""
from __future__ import annotations

import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import database
from database.models import Customer, Contract
from services import (
    contract_service as contracts,
    contract_type_service as types,
    customer_service as customers,
    supervision_service as supervision,
)


def main() -> None:
    database.init_db()
    ctype = "إشراف اختبار إلغاء مدة"
    types.add_type(ctype, 0, unit_label="شهر", unit_price=150,
                   pricing_mode="unit", is_supervision=True)
    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل إلغاء مدة", phone="50000000"))
    contract_id = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=customer_id,
        contract_date="2025-09-07", description="عقد إشراف", amount=300,
        contract_type=ctype, qty=2, unit_price=150,
    ))
    supervision.setup_supervision(contract_id, "2025-09-07", 2, 150)
    before = supervision.supervision_status(contract_id, today=date(2026, 9, 7))
    assert before["full_end"] == "2025-11-07"
    assert before["delay_value"] > 0

    supervision.waive_extension_months(contract_id, 6, "اختبار إلغاء مدة")
    after = supervision.supervision_status(contract_id, today=date(2026, 9, 7))
    assert after["waived_months"] == 6
    assert after["full_end"] == "2026-05-07"
    assert after["delay_value"] < before["delay_value"]
    print("OK: إلغاء مدة الإشراف يقلل التأخير ونهاية المدة الكاملة")


if __name__ == "__main__":
    main()
