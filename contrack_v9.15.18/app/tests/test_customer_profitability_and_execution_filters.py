# -*- coding: utf-8 -*-
"""تقارير: ربحية العميل + فلاتر وشكل تقرير مراحل التنفيذ."""
import os
import sys
from datetime import date, timedelta

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import customer_service as customers  # noqa: E402
from services import contract_service as contracts  # noqa: E402
from services import contract_type_service as types  # noqa: E402
from services import workflow_service as workflow  # noqa: E402
from services import lifecycle_service as lifecycle  # noqa: E402
from ui import reports_page  # noqa: E402


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
    ctype = "نوع تقرير تنفيذ وربحية"
    try:
        types.add_type(ctype, 1000)
    except Exception:
        pass
    _clear_type_template(ctype)
    parent = workflow.add_stage(workflow.TX_CONTRACT, "مسار التقرير", contract_type=ctype)
    workflow.add_stage(workflow.TX_CONTRACT, "مرحلة أولى", parent_id=parent, expected_days=5, contract_type=ctype)
    workflow.add_stage(workflow.TX_CONTRACT, "مرحلة ثانية", parent_id=parent, expected_days=7, contract_type=ctype)

    customer_id = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل ربحية التنفيذ", phone="51110000"))
    contract_ids = []
    for i, amount in enumerate((1000.0, 500.0), 1):
        contract_ids.append(contracts.add_contract(Contract(
            contract_number=contracts.next_contract_number(), customer_id=customer_id,
            contract_date=date.today().isoformat(), description=f"عقد ربحية {i}",
            amount=amount, contract_type=ctype)))

    lifecycle.add_voucher("receipt", date.today().isoformat(), "عميل ربحية التنفيذ", "البنك", "", 800, "قبض", contract_id=contract_ids[0])
    lifecycle.add_voucher("payment", date.today().isoformat(), "مصروف", "الصندوق", "مصروف", 120, "صرف", contract_id=contract_ids[0])

    with database.get_connection() as conn:
        for kid in contract_ids:
            st = conn.execute(
                "SELECT id FROM contract_stages WHERE contract_id=? AND level=1 ORDER BY sort_order, id LIMIT 1",
                (kid,),
            ).fetchone()
            conn.execute("UPDATE contract_stages SET start_date=?, closed_by=? WHERE id=?",
                         ((date.today() - timedelta(days=2)).isoformat(), "مسؤول الاختبار", st["id"]))

    cust_profit = reports_page._data_customer_profitability(customer_id, None)
    assert cust_profit["heads"][:2] == ["العميل", "العقد"]
    assert any(r[1] == "إجمالي العميل" for r in cust_profit["rows"])
    assert any(str(r[1]).strip().startswith("↳") or "↳" in str(r[1]) for r in cust_profit["rows"])

    stage_spec = reports_page._data_execution("current", contract_type=ctype, stage_name="مرحلة أولى")
    # V3.6: الرقم والاسم مدمجان في عمود «العقد» (لا فقدان معلومة) — متسق مع تقرير العقود.
    # V5.9: أُضيف عمود «آخر ملاحظة» (النوت الصغير على المعاملة) في آخر التقرير.
    assert stage_spec["heads"] == ["العميل", "العقد", "المرحلة الحالية", "المرحلة التالية", "متى بدأت المرحلة الحالية", "بقالها كم يوم", "المتوقع", "الحالة", "المسؤول", "آخر ملاحظة"]
    assert "نوع العقد أصبح فلترًا" in stage_spec["note"]
    assert all(r[2] == "مرحلة أولى" for r in stage_spec["rows"])
    assert all(r[3] == "مرحلة ثانية" for r in stage_spec["rows"])
    assert all(r[8] == "مسؤول الاختبار" for r in stage_spec["rows"])
    num0 = contracts.get_contract(contract_ids[0]).contract_number
    assert any(num0 in str(r[1]) for r in stage_spec["rows"])

    contract_spec = reports_page._data_contracts("all", "", "")
    assert contract_spec["heads"][:3] == ["العميل", "العقد", "تاريخ العقد"]
    print("OK: ربحية العميل وفلاتر مراحل التنفيذ وترتيب أعمدة العميل تعمل")


if __name__ == "__main__":
    main()
