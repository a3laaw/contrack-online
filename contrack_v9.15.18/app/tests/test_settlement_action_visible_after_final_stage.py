# -*- coding: utf-8 -*-
"""زر تصفية وإغلاق العقد يظهر بعد إنهاء آخر مرحلة في كل العقود.

الظهور بعد اكتمال المراحل، أما التفعيل فيبقى مشروطًا بالتحصيل الكامل.
"""
from __future__ import annotations

import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from PySide6.QtWidgets import QApplication  # noqa: E402

from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import (contract_service as contracts, contract_type_service as types,
                      customer_service as customers, lifecycle_service as lifecycle,
                      workflow_service as workflow)  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402


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
    app = QApplication.instance() or QApplication([])
    database.init_db()
    ctype = "نوع اختبار ظهور زر التصفية"
    types.add_type(ctype, 1000)
    _clear_type_template(ctype)
    parent = workflow.add_stage(workflow.TX_CONTRACT, "مسار", contract_type=ctype)
    workflow.add_stage(workflow.TX_CONTRACT, "مرحلة نهائية", parent_id=parent,
                       expected_days=1, contract_type=ctype)

    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل زر التصفية", phone="50123456"))
    contract_id = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=customer_id,
        contract_date=date.today().isoformat(), description="عقد", amount=1000,
        contract_type=ctype,
    ))

    # قبل إنهاء المرحلة لا يظهر الزر.
    page = ContractHubPage(embedded=True)
    page.load_contract(contract_id)
    app.processEvents()
    assert not page.stage_settle_btn.isVisible()

    # بعد آخر مرحلة يظهر الزر، لكن يبقى معطلًا حتى التحصيل الكامل.
    workflow.advance_stage(workflow.TX_CONTRACT, contract_id)
    page.load_contract(contract_id)
    app.processEvents()
    assert page.stage_settle_btn.isVisible()
    assert not page.stage_settle_btn.isEnabled()

    lifecycle.add_voucher("receipt", date.today().isoformat(), "", "نقدًا", "",
                          1000, "سداد كامل", contract_id=contract_id,
                          party_type="customer", party_id=customer_id)
    page.load_contract(contract_id)
    app.processEvents()
    assert page.stage_settle_btn.isVisible()
    assert page.stage_settle_btn.isEnabled()
    print("OK: زر التصفية يظهر بعد آخر مرحلة ويتفعل بعد التحصيل الكامل")


if __name__ == "__main__":
    main()
