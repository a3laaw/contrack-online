# -*- coding: utf-8 -*-
"""تصفية وإغلاق العقد تظهر فقط بعد التحصيل الكامل واكتمال مسار المراحل."""
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
    extras_service as extras,
    lifecycle_service as lifecycle,
    workflow_service as workflow,
)
from services.customer_service import ValidationError


def _clear_type_template(type_name: str) -> None:
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM workflow_stages WHERE transaction_type=? AND COALESCE(contract_type,'')=?",
            (workflow.TX_CONTRACT, type_name),
        ).fetchall()
        ids = [str(r["id"]) for r in rows]
        if ids:
            marks = ",".join("?" for _ in ids)
            conn.execute(f"DELETE FROM type_payment_stages WHERE stage_id IN ({marks})", ids)
            conn.execute("DELETE FROM type_payment_tpl WHERE contract_type=?", (type_name,))
            conn.execute(f"DELETE FROM workflow_stages WHERE id IN ({marks})", ids)


def main() -> None:
    database.init_db()
    ctype = "نوع اختبار إغلاق بالمراحل"
    types.add_type(ctype, 1000)
    _clear_type_template(ctype)
    parent = workflow.add_stage(workflow.TX_CONTRACT, "رئيسية", contract_type=ctype)
    workflow.add_stage(workflow.TX_CONTRACT, "مرحلة واحدة", parent_id=parent,
                       expected_days=1, contract_type=ctype)

    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل إغلاق", phone="50000000"))
    contract_id = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=customer_id,
        contract_date=date.today().isoformat(), description="عقد", amount=1000,
        contract_type=ctype,
    ))
    lifecycle.add_voucher("receipt", date.today().isoformat(), "", "نقدًا", "",
                          1000, "سداد كامل", contract_id=contract_id,
                          party_type="customer", party_id=customer_id)

    info = extras.contract_settlement(contract_id)
    assert info["fully_collected"] is True
    assert info["stages_complete"] is False
    assert info["closable"] is False
    try:
        extras.close_contract(contract_id)
    except ValidationError as exc:
        assert "مسار المراحل" in str(exc)
    else:
        raise AssertionError("لا يجب إغلاق العقد قبل اكتمال المراحل")

    workflow.advance_stage(workflow.TX_CONTRACT, contract_id)
    info = extras.contract_settlement(contract_id)
    assert info["stages_complete"] is True
    assert info["closable"] is True
    extras.close_contract(contract_id)
    with database.get_connection() as conn:
        status = conn.execute("SELECT status FROM contracts WHERE id=?", (contract_id,)).fetchone()["status"]
    assert status == "مغلق"
    print("OK: تصفية العقد مربوطة بالتحصيل الكامل واكتمال المراحل")


if __name__ == "__main__":
    main()
