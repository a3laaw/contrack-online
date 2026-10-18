# -*- coding: utf-8 -*-
"""تعديل اسم العميل يجب أن ينعكس في سندات القبض المرتبطة به وبعقوده."""
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


def main() -> None:
    database.init_db()
    cid = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(),
        name="اسم عميل قديم", phone="56660000", address="الكويت"))
    kid = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=cid,
        contract_date=date.today().isoformat(), description="عقد تغيير اسم العميل",
        amount=1000, contract_type="تصميم"))
    v1 = lifecycle.add_voucher(
        "receipt", date.today().isoformat(), "", "البنك", "", 200,
        "قبض مرتبط بالعميل", contract_id=kid, party_type="customer", party_id=cid)
    v2 = lifecycle.add_voucher(
        "receipt", date.today().isoformat(), "اسم عميل قديم", "البنك", "", 100,
        "قبض قديم مرتبط بالعقد فقط", contract_id=kid)

    cust = customers.get_customer(cid)
    cust.name = "اسم عميل جديد"
    customers.update_customer(cust)

    with database.get_connection() as conn:
        stored = [r["party"] for r in conn.execute(
            "SELECT party FROM vouchers WHERE id IN (?, ?) ORDER BY id", (v1, v2)).fetchall()]
    assert stored == ["اسم عميل جديد", "اسم عميل جديد"], stored

    shown = lifecycle.list_vouchers(vtype="receipt")
    parties = {v["id"]: v["party"] for v in shown}
    assert parties[v1] == "اسم عميل جديد"
    assert parties[v2] == "اسم عميل جديد"
    print("OK: تعديل اسم العميل ينعكس في سندات القبض المرتبطة")


if __name__ == "__main__":
    main()
