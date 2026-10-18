# -*- coding: utf-8 -*-
"""تعديل بيان السند فقط دون تغيير مالي أو طرف/عقد."""
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
from services import lifecycle_service as lc  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402


def main() -> None:
    database.init_db()
    cid = customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name="عميل بيان فقط", phone="55990001"))
    kid = contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=cid,
        contract_date=date.today().isoformat(), description="عقد بيان فقط", amount=500,
        contract_type="تصميم"))
    vid = lc.add_voucher("receipt", date.today().isoformat(), "", "نقدًا", "", 100,
                         "بيان قديم", contract_id=kid, party_type="customer", party_id=cid)
    lc.update_voucher_description(vid, "بيان جديد فقط")
    with database.get_connection() as conn:
        v = conn.execute("SELECT * FROM vouchers WHERE id=?", (vid,)).fetchone()
        j = conn.execute("SELECT * FROM journal_entries WHERE source_id=? AND source_type LIKE 'voucher%'", (vid,)).fetchone()
    assert v["description"] == "بيان جديد فقط"
    assert float(v["amount"]) == 100
    assert v["contract_id"] == kid
    assert v["party_id"] == cid
    assert j and "بيان جديد فقط" in j["description"] and float(j["amount"]) == 100
    try:
        lc.update_voucher_description(vid, "")
        raise AssertionError("يجب منع البيان الفارغ")
    except ValidationError:
        pass
    print("OK: تعديل البيان فقط لا يغير بيانات السند المالية")


if __name__ == "__main__":
    main()
