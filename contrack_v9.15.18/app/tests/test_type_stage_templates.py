# -*- coding: utf-8 -*-
"""محاكاة: كل نوع عقد له شجرة مراحل مستقلة، والعقد ينسخ شجرة نوعه فقط."""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import database
from database.models import Customer, Contract
from services import contract_type_service as cts
from services import customer_service as cs
from services import contract_service as ks
from services import workflow_service as wf


def _clear_type_template(type_name: str) -> None:
    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM workflow_stages WHERE transaction_type=? AND COALESCE(contract_type,'')=?",
            (wf.TX_CONTRACT, type_name)).fetchall()
        ids = [str(r["id"]) for r in rows]
        if ids:
            marks = ",".join("?" for _ in ids)
            conn.execute(f"DELETE FROM type_payment_stages WHERE stage_id IN ({marks})", ids)
            conn.execute("DELETE FROM type_payment_tpl WHERE contract_type=?", (type_name,))
            conn.execute(f"DELETE FROM workflow_stages WHERE id IN ({marks})", ids)


def main():
    database.init_db()
    cts.add_type("تصميم", 1000)
    cts.add_type("إشراف", 1000)

    # ابدأ بقالبين مخصصين مختلفين تمامًا لإثبات عدم وجود شجرة واحدة مشتركة.
    _clear_type_template("تصميم")
    _clear_type_template("إشراف")
    m1 = wf.add_stage(wf.TX_CONTRACT, "تصميم - رئيسية", contract_type="تصميم")
    wf.add_stage(wf.TX_CONTRACT, "تصميم - رفع مساحي", parent_id=m1,
                 expected_days=3, contract_type="تصميم", payment_pct=20,
                 pay_kind="achieve")
    m2 = wf.add_stage(wf.TX_CONTRACT, "إشراف - رئيسية", contract_type="إشراف")
    wf.add_stage(wf.TX_CONTRACT, "إشراف - زيارة موقع", parent_id=m2,
                 expected_days=7, contract_type="إشراف", payment_pct=10,
                 pay_kind="achieve")

    assert [s["stage_name"] for s in wf.stage_path(wf.TX_CONTRACT, "تصميم")] == ["تصميم - رفع مساحي"]
    assert [s["stage_name"] for s in wf.stage_path(wf.TX_CONTRACT, "إشراف")] == ["إشراف - زيارة موقع"]

    cid = cs.add_customer(Customer(customer_code=cs.next_customer_code(), name="عميل ربط النوع", phone="50123456"))
    kid_design = ks.add_contract(Contract(contract_number=ks.next_contract_number(), customer_id=cid,
                                          contract_date=date.today().isoformat(), description="عقد تصميم",
                                          amount=1000, contract_type="تصميم"))
    kid_super = ks.add_contract(Contract(contract_number=ks.next_contract_number(), customer_id=cid,
                                         contract_date=date.today().isoformat(), description="عقد إشراف",
                                         amount=1000, contract_type="إشراف"))
    design_current = wf.stage_status(wf.TX_CONTRACT, kid_design)["current"]["stage_name"]
    super_current = wf.stage_status(wf.TX_CONTRACT, kid_super)["current"]["stage_name"]
    print("design_current:", design_current)
    print("supervision_current:", super_current)
    assert design_current == "تصميم - رفع مساحي"
    assert super_current == "إشراف - زيارة موقع"
    print("OK: كل عقد دخل شجرة نوعه فقط ولا توجد شجرة واحدة مبعثرة")


if __name__ == "__main__":
    main()
