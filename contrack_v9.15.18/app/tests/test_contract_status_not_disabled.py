# -*- coding: utf-8 -*-
"""حالة العقد لا تظهر كحالة معطلة/قديمة في الواجهة."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import database
from database.models import Customer, Contract
from services import contract_service, customer_service, ui_data_service
from database.database import get_connection


def main() -> None:
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code=customer_service.next_customer_code(),
        name="عميل حالة العقد", phone="55501010"))
    kid = contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=cid, contract_date="2026-01-01",
        contract_type="تصميم", description="اختبار حالة", amount=1000))

    assert ui_data_service.contract_status(kid) == "نشط"
    with get_connection() as conn:
        conn.execute("UPDATE contracts SET status='معطلة' WHERE id=?", (kid,))
    assert ui_data_service.contract_status(kid) == "متوقف"
    assert ui_data_service.normalize_contract_status("") == "نشط"

    print("OK: حالة العقد الافتراضية نشطة والحالات القديمة لا تظهر كـ معطلة")


if __name__ == "__main__":
    main()
