# -*- coding: utf-8 -*-
"""العقد الذي يُدفع مرة واحدة لا يُجبر على تقسيم دفعات مراحل."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import customer_service as customers  # noqa: E402
from services import contract_service as contracts  # noqa: E402
from services import contract_type_service as types  # noqa: E402
from services import lifecycle_service as lifecycle  # noqa: E402
from services import workflow_service as workflow  # noqa: E402


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
    ctype = "نوع دفع كامل مرة واحدة"
    try:
        types.add_type(ctype, 2000)
    except Exception:
        pass
    _clear_type_template(ctype)
    parent = workflow.add_stage(workflow.TX_CONTRACT, "مسار دفع كامل", contract_type=ctype)
    workflow.add_stage(workflow.TX_CONTRACT, "تنفيذ", parent_id=parent, expected_days=3, contract_type=ctype)
    workflow.add_stage(workflow.TX_CONTRACT, "تسليم", parent_id=parent, expected_days=2, contract_type=ctype)

    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل دفع كامل", phone="52220000"))
    contract_id = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=customer_id,
        contract_date=date.today().isoformat(), description="عقد دفع كامل", amount=2000,
        contract_type=ctype))

    plan = lifecycle.contract_payment_plan(contract_id)
    assert len(plan) == 1, plan
    assert plan[0]["title"] == "دفعة كاملة عند بداية التعاقد"
    assert float(plan[0]["amount"]) == 2000.0
    with database.get_connection() as conn:
        linked = conn.execute(
            "SELECT cs.name FROM payment_plan pp LEFT JOIN contract_stages cs ON cs.id=pp.stage_id WHERE pp.id=?",
            (plan[0]["id"],),
        ).fetchone()["name"]
    assert linked == "تنفيذ"
    assert "لا تقسيم" in (plan[0]["notes"] or "")
    print("OK: عقد الدفع الواحد يرتبط بدفعة كاملة أول التعاقد بدون تقسيم مراحل")


if __name__ == "__main__":
    main()
