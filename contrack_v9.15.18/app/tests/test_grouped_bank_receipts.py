# -*- coding: utf-8 -*-
"""تحويل بنكي مجمع: سندات قبض فردية وعمولة واحدة مقسمة بالتساوي."""
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
from services import lifecycle_service as lifecycle  # noqa: E402
from services import settings_service as settings  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402


def main() -> None:
    database.init_db()
    mid = next(m["id"] for m in settings.list_payment_methods() if m["name"] == "تحويل بنكي")
    settings.update_payment_method(mid, "تحويل بنكي", "amount", 0.300)
    c1 = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل مجمع 1", phone="50111111"))
    c2 = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل مجمع 2", phone="50222222"))
    k1 = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=c1,
        contract_date=date.today().isoformat(), description="عقد مجمع 1", amount=1000,
        contract_type="تصميم"))
    k2 = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=c2,
        contract_date=date.today().isoformat(), description="عقد مجمع 2", amount=1000,
        contract_type="تصميم"))
    k3 = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=c1,
        contract_date=date.today().isoformat(), description="عقد مجمع 3 لنفس العميل", amount=1000,
        contract_type="تصميم"))

    res = lifecycle.add_grouped_receipts(
        date.today().isoformat(), "تحويل بنكي", "",
        [{"customer_id": c1, "contract_id": k1, "amount": 300, "description": "قبض عقد 1"},
         {"customer_id": c2, "contract_id": k2, "amount": 200, "description": "قبض عقد 2"}],
    )
    assert res["group_number"].startswith("BT-")
    assert len(res["receipt_ids"]) == 2
    assert len(res["fee_ids"]) == 2
    assert abs(res["bank_fee"] - 0.300) < 0.001
    assert res["fee_each"] == [0.150, 0.150]

    with database.get_connection() as conn:
        receipts = conn.execute(
            "SELECT * FROM vouchers WHERE vtype='receipt' ORDER BY id").fetchall()
        fees = conn.execute(
            "SELECT * FROM vouchers WHERE vtype='payment' AND notes LIKE '%[رسوم بنك]%' ORDER BY id").fetchall()
    assert len(receipts) == 2
    assert len(fees) == 2
    assert sum(float(x["amount"]) for x in receipts) == 500
    assert round(sum(float(x["amount"]) for x in fees), 3) == 0.300
    assert all(res["group_number"] == (x["receipt_group_ref"] or "") for x in receipts)
    assert all(res["group_number"] not in (x["notes"] or "") for x in receipts)
    assert all("تحويل بنكي مجمع" not in (x["description"] or "") for x in receipts)
    assert all(res["group_number"] == (x["receipt_group_ref"] or "") for x in fees)
    assert all(res["group_number"] not in (x["notes"] or "") for x in fees)

    ok_same_customer = lifecycle.add_grouped_receipts(
        date.today().isoformat(), "تحويل بنكي", "",
        [{"customer_id": c1, "contract_id": k1, "amount": 10},
         {"customer_id": c1, "contract_id": k3, "amount": 20}],
    )
    assert len(ok_same_customer["receipt_ids"]) == 2
    with database.get_connection() as conn:
        auto_desc = conn.execute(
            "SELECT description FROM vouchers WHERE id=?",
            (ok_same_customer["receipt_ids"][0],)).fetchone()["description"]
    assert auto_desc.startswith("سداد") and "تحويل" not in auto_desc and "BT-" not in auto_desc

    try:
        lifecycle.add_grouped_receipts(
            date.today().isoformat(), "تحويل بنكي", "",
            [{"customer_id": c1, "contract_id": k1, "amount": 10},
             {"customer_id": c1, "contract_id": k1, "amount": 20}],
        )
        raise AssertionError("لم يُمنع تكرار نفس العقد لنفس العميل داخل السند المجمع")
    except ValidationError:
        pass

    d1 = lifecycle.customer_financial_summary(c1)
    d2 = lifecycle.customer_financial_summary(c2)
    assert round(d1["collected"], 3) == 330
    assert round(d2["collected"], 3) == 200
    print("OK: التحويل البنكي المجمع ينشئ سندات فردية وعمولة واحدة موزعة بالتساوي")


if __name__ == "__main__":
    main()
