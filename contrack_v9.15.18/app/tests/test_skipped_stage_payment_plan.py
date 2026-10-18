# -*- coding: utf-8 -*-
"""تخطي مرحلة مرتبطة بدفعة يجب أن يظهر في خطة السداد كمرحلة متخطاة لا مطالبة مستحقة."""
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
    workflow_service as workflow,
)


def _clear_type_template(type_name: str) -> None:
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM workflow_stages WHERE transaction_type=? "
            "AND COALESCE(contract_type,'')=?",
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
    contract_type = "نوع اختبار تخطي مرحلة بدفعة"
    types.add_type(contract_type, 1000)
    _clear_type_template(contract_type)
    parent = workflow.add_stage(workflow.TX_CONTRACT, "رئيسية", contract_type=contract_type)
    workflow.add_stage(
        workflow.TX_CONTRACT, "مرحلة يتم تخطيها", parent_id=parent,
        expected_days=1, contract_type=contract_type, payment_pct=100,
        pay_kind="achieve",
    )
    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(),
        name="عميل اختبار التخطي", phone="50000000"))
    contract_id = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(),
        customer_id=customer_id,
        contract_date=date.today().isoformat(),
        description="عقد اختبار التخطي", amount=1000,
        contract_type=contract_type,
    ))

    result = workflow.advance_stage(workflow.TX_CONTRACT, contract_id, skip=True)
    assert result["skipped_payments"]
    plan = lifecycle.contract_payment_plan(contract_id)
    assert plan[0]["status"] == "مرحلة متخطاة"
    assert "غير مستحقة" in plan[0]["notes"]
    with database.get_connection() as conn:
        comment = conn.execute(
            "SELECT body FROM customer_comments WHERE contract_id=? ORDER BY id DESC LIMIT 1",
            (contract_id,),
        ).fetchone()["body"]
    assert "غير مستحقة لأن المرحلة تم تخطيها" in comment
    print("OK: تخطي المرحلة المرتبطة بدفعة يظهر كغير مستحق في الخطة والتعليقات")


if __name__ == "__main__":
    main()
