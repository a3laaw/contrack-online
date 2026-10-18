# -*- coding: utf-8 -*-
"""بيان سند القبض لعقود الدفعة الكاملة يقرأ النقص/الكامل/الزيادة."""
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
from services.extras_service import smart_receipt_description  # noqa: E402


def _contract(name: str, amount: float = 225.0, with_plan: bool = False) -> int:
    cid = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name=f"عميل {name}",
        phone=str(55880000 + len(customers.list_customers()))))
    kid = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=cid,
        contract_date=date.today().isoformat(), description=name, amount=amount,
        contract_type="تصميم"))
    if with_plan:
        with database.get_connection() as conn:
            conn.execute(
                "INSERT INTO payment_plan (contract_id, title, due_date, amount, sort_order) "
                "VALUES (?,?,?,?,?)",
                (kid, "1. دفعة كاملة", date.today().isoformat(), amount, 1))
    return kid


def main() -> None:
    database.init_db()
    under = smart_receipt_description(_contract("عقد دفعة كاملة ناقصة", 100.0), 80.0)
    assert "سداد دفعة أولى" in under and "20.000" not in under, under

    exact = smart_receipt_description(_contract("عقد دفعة كاملة تامة", 100.0), 100.0)
    assert "سداد كامل قيمة العقد" in exact and "كاملة كاملة" not in exact, exact

    over = smart_receipt_description(_contract("عقد دفعة كاملة زائدة", 100.0), 150.0)
    assert "وزيادة مقدمة" in over and "50.000" not in over, over

    planned_under = smart_receipt_description(_contract("عقد خطة دفعة كاملة", with_plan=True), 150.0)
    assert "جزء من الدفعة رقم 1" in planned_under and "75.000" not in planned_under, planned_under

    print("OK: بيان الدفعة الكاملة يقرأ الدفع الناقص والكامل والزائد")


if __name__ == "__main__":
    main()
