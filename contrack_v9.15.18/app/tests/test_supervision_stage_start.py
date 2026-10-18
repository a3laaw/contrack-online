# -*- coding: utf-8 -*-
"""بداية تعهد الإشراف تُحدد من مرحلة بداية الإشراف وتدخل في الحسابات."""
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
    lifecycle_service as lifecycle,
    supervision_service as supervision,
    workflow_service as workflow,
)


def main() -> None:
    database.init_db()
    ctype = "إشراف اختبار بداية مرحلة"
    types.add_type(ctype, 0, unit_label="شهر", unit_price=200,
                   pricing_mode="unit", is_supervision=True)
    workflow.replace_contract_type_template(ctype, mode="default")
    path = [s["stage_name"] for s in workflow.stage_path(workflow.TX_CONTRACT, ctype)]
    assert path == ["بداية الإشراف", "إنهاء الإشراف"], path
    pays = workflow.type_payments(ctype)
    assert len(pays) == 1
    assert pays[0]["title"] == "كامل قيمة العقد"
    assert float(pays[0]["pct"] or 0) == 100.0
    assert [s["stage_name"] for s in pays[0]["stages"]] == ["إنهاء الإشراف"]

    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل إشراف", phone="50000000"))
    contract_id = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=customer_id,
        contract_date=date.today().isoformat(), description="عقد إشراف", amount=1200,
        contract_type=ctype, qty=6, unit_price=200,
    ))
    supervision.setup_supervision(contract_id, "", 6, 200)
    assert supervision.supervision_status(contract_id) is None

    supervision.set_supervision_start_from_stage(contract_id, "2026-01-10")
    workflow.advance_stage(workflow.TX_CONTRACT, contract_id, action_date="2026-01-10")
    status = supervision.supervision_status(contract_id, today=date(2026, 3, 1))
    assert status is not None
    assert status["start"] == "2026-01-10"
    assert status["base_value"] == 1200
    with database.get_connection() as conn:
        row = conn.execute("SELECT start_date, end_date FROM contracts WHERE id=?",
                           (contract_id,)).fetchone()
    assert row["start_date"] == "2026-01-10"
    assert row["end_date"] == supervision.base_end_date(contract_id)

    workflow.advance_stage(workflow.TX_CONTRACT, contract_id, action_date="2026-09-10")
    stopped = supervision.supervision_status(contract_id, today=date(2027, 1, 1))
    assert stopped["actual_end"] == "2026-09-10"
    assert stopped["calculation_date"] == "2026-09-10"
    assert stopped["extension_months"] < 12

    lifecycle.add_voucher(
        "receipt", "2026-09-10", "", "نقدًا", "", 500,
        "سداد جزئي بعد إنهاء الإشراف", contract_id=contract_id,
        party_type="customer", party_id=customer_id)
    dash = lifecycle.contract_dashboard(contract_id)
    assert dash["total_receipts"] == 500
    assert dash["current_value"] - dash["total_receipts"] < dash["current_value"]

    with database.get_connection() as conn:
        end_row = conn.execute("SELECT end_date FROM contracts WHERE id=?",
                               (contract_id,)).fetchone()
    assert end_row["end_date"] == "2026-09-10"
    print("OK: بداية ونهاية الإشراف من المراحل تُحدث الحسابات وتوقف الأيام")


if __name__ == "__main__":
    main()
