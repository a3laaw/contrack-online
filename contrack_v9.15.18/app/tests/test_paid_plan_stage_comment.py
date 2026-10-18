# -*- coding: utf-8 -*-
"""دفعة مسددة قبل إنهاء مرحلتها لا يجب أن تظهر كأنها مطالبة جديدة."""
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
            conn.execute(
                f"DELETE FROM type_payment_stages WHERE stage_id IN ({marks})",
                ids,
            )
            conn.execute(
                "DELETE FROM type_payment_tpl WHERE contract_type=?", (type_name,)
            )
            conn.execute(f"DELETE FROM workflow_stages WHERE id IN ({marks})", ids)


def main() -> None:
    database.init_db()
    contract_type = "نوع اختبار تعليق الدفعة المدفوعة"
    types.add_type(contract_type, 1000)
    _clear_type_template(contract_type)

    main_stage = workflow.add_stage(
        workflow.TX_CONTRACT, "رئيسية", contract_type=contract_type
    )
    workflow.add_stage(
        workflow.TX_CONTRACT,
        "مرحلة الدفعة الأولى",
        parent_id=main_stage,
        expected_days=1,
        contract_type=contract_type,
        payment_pct=100,
        pay_kind="achieve",
    )

    customer_id = customers.add_customer(
        Customer(
            customer_code=customers.next_customer_code(),
            name="عميل اختبار تعليق الدفعة",
            phone="50000000",
        )
    )
    contract_id = contracts.add_contract(
        Contract(
            contract_number=contracts.next_contract_number(),
            customer_id=customer_id,
            contract_date=date.today().isoformat(),
            description="عقد اختبار تعليق الدفعة",
            amount=1000,
            contract_type=contract_type,
        )
    )

    lifecycle.add_voucher(
        "receipt",
        date.today().isoformat(),
        "",
        "نقدًا",
        "",
        1000,
        "سداد الدفعة الأولى قبل إنهاء مرحلتها",
        contract_id=contract_id,
        party_type="customer",
        party_id=customer_id,
    )

    result = workflow.advance_stage(workflow.TX_CONTRACT, contract_id)
    assert result["triggered_payments"][0]["already_paid"] is True

    with database.get_connection() as conn:
        plan = conn.execute(
            "SELECT notes FROM payment_plan WHERE contract_id=?", (contract_id,)
        ).fetchone()
        comment = conn.execute(
            "SELECT body FROM customer_comments WHERE contract_id=? "
            "ORDER BY id DESC LIMIT 1",
            (contract_id,),
        ).fetchone()

    assert "مسددة مسبقًا" in plan["notes"]
    assert "مسددة مسبقًا" in comment["body"]
    assert "أصبحت مستحقة" not in comment["body"]

    duplicates = contracts.existing_active_contracts_for_customer_type(
        customer_id, contract_type)
    assert len(duplicates) == 1
    assert duplicates[0].id == contract_id

    with database.get_connection() as conn:
        voucher = conn.execute(
            "SELECT id FROM vouchers WHERE contract_id=? AND vtype='receipt'",
            (contract_id,),
        ).fetchone()["id"]
    lifecycle.cancel_voucher(voucher, "اختبار عودة الاستحقاق")
    with database.get_connection() as conn:
        plan_after_cancel = conn.execute(
            "SELECT notes FROM payment_plan WHERE contract_id=?", (contract_id,)
        ).fetchone()
        cancel_comment = conn.execute(
            "SELECT body FROM customer_comments WHERE contract_id=? "
            "ORDER BY id DESC LIMIT 1",
            (contract_id,),
        ).fetchone()
    assert "عادت مستحقة" in plan_after_cancel["notes"]
    assert "عادت الدفعة" in cancel_comment["body"]
    assert "كمستحقة مرة أخرى" in cancel_comment["body"]
    print("OK: الدفعة المسددة قبل إنهاء المرحلة لا تظهر كمطالبة جديدة ثم تعود مستحقة عند إلغاء السند")


if __name__ == "__main__":
    main()
