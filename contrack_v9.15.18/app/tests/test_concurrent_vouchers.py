# -*- coding: utf-8 -*-
"""اختبار عملي: موظفان/عمليتان يحفظان سند قبض في نفس اللحظة.

الشاشة قد تعرض رقمًا مبدئيًا لكل موظف، لكن add_voucher يحجز الرقم الرسمي وقت
الحفظ من القاعدة المشتركة. المطلوب: لا يتكرر voucher_number.
"""
import os
import sys
import threading
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import database
from database.models import Customer, Contract
from services import customer_service as cs
from services import contract_service as ks
from services import lifecycle_service as lc


def main():
    database.init_db()
    cid = cs.add_customer(Customer(
        customer_code=cs.next_customer_code(),
        name="عميل اختبار التزامن",
        phone="55550001",
        address="الكويت",
    ))
    kid = ks.add_contract(Contract(
        contract_number=ks.next_contract_number(),
        customer_id=cid,
        contract_date=date.today().isoformat(),
        description="عقد اختبار سندات متزامنة",
        amount=100000.0,
        contract_type="غير محدد",
    ))

    # محاكاة أن النافذتين رأتا نفس الرقم قبل الحفظ، لكن الرقم الرسمي يحجز عند الحفظ.
    preview_1 = lc.next_voucher_number("receipt")
    preview_2 = lc.next_voucher_number("receipt")
    print("preview numbers before save:", preview_1, preview_2)

    barrier = threading.Barrier(2)
    results = []
    errors = []
    lock = threading.Lock()

    def worker(i):
        try:
            barrier.wait()
            vid = lc.add_voucher(
                "receipt", date.today().isoformat(), "", "نقدًا", "",
                10.0, f"سند متزامن {i}", contract_id=kid,
                party_type="customer", party_id=cid,
            )
            with database.get_connection() as conn:
                row = conn.execute("SELECT voucher_number FROM vouchers WHERE id=?", (vid,)).fetchone()
            with lock:
                results.append(row["voucher_number"])
        except Exception as exc:
            with lock:
                errors.append(str(exc))

    t1 = threading.Thread(target=worker, args=(1,))
    t2 = threading.Thread(target=worker, args=(2,))
    t1.start(); t2.start(); t1.join(); t2.join()

    print("saved numbers:", sorted(results))
    print("errors:", errors)
    assert not errors, errors
    assert len(results) == 2
    assert len(set(results)) == 2, "تكرر رقم السند"
    print("OK: لا يوجد تكرار في أرقام السندات عند الحفظ المتزامن")


if __name__ == "__main__":
    main()
