# -*- coding: utf-8 -*-
"""مراجعة حالات السند المجمع: نقص/زيادة/عدة عملاء/عميل واحد عدة عقود."""
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


def _customer(name, phone):
    return customers.add_customer(Customer(
        customer_code=customers.next_customer_code(), name=name, phone=phone))


def _contract(customer_id, name, amount=100.0):
    return contracts.add_contract(Contract(
        contract_number=contracts.next_contract_number(), customer_id=customer_id,
        contract_date=date.today().isoformat(), description=name, amount=amount,
        contract_type="تصميم"))


def _receipt_count():
    with database.get_connection() as conn:
        return conn.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='receipt'").fetchone()[0]


def main() -> None:
    database.init_db()

    # 1) دفع بالنقص: يسجل سندًا عاديًا ويبقى المتبقي صحيحًا.
    c_under = _customer("عميل دفع ناقص", "55110001")
    k_under = _contract(c_under, "عقد دفع ناقص", 100.0)
    c_pad = _customer("عميل مساعد", "55110002")
    k_pad = _contract(c_pad, "عقد مساعد", 100.0)
    res_under = lc.add_grouped_receipts(
        date.today().isoformat(), "نقدًا", "",
        [{"customer_id": c_under, "contract_id": k_under, "amount": 60.0},
         {"customer_id": c_pad, "contract_id": k_pad, "amount": 10.0}],
    )
    assert len(res_under["receipt_ids"]) == 2
    assert round(lc.customer_financial_summary(c_under)["collected"], 3) == 60.0
    assert round(lc.customer_financial_summary(c_under)["remaining"], 3) == 40.0

    # 2) دفع بالزيادة: بدون موافقة لا ينشئ أي سند جزئي، ومع الموافقة يسجل الزيادة.
    c_over = _customer("عميل دفع زائد", "55110003")
    k_over = _contract(c_over, "عقد دفع زائد", 100.0)
    c_over2 = _customer("عميل زائد مساعد", "55110004")
    k_over2 = _contract(c_over2, "عقد زائد مساعد", 100.0)
    before = _receipt_count()
    try:
        lc.add_grouped_receipts(
            date.today().isoformat(), "نقدًا", "",
            [{"customer_id": c_over, "contract_id": k_over, "amount": 120.0},
             {"customer_id": c_over2, "contract_id": k_over2, "amount": 10.0}],
            allow_overpay=False)
        raise AssertionError("كان يجب ظهور تحذير زيادة قبل الحفظ")
    except lc.OverpayWarning:
        pass
    assert _receipt_count() == before, "لا يجوز حفظ جزء من السند المجمع عند رفض/فشل الزيادة"
    res_over = lc.add_grouped_receipts(
        date.today().isoformat(), "نقدًا", "",
        [{"customer_id": c_over, "contract_id": k_over, "amount": 120.0},
         {"customer_id": c_over2, "contract_id": k_over2, "amount": 10.0}],
        allow_overpay=True)
    assert len(res_over["receipt_ids"]) == 2
    assert round(lc.customer_financial_summary(c_over)["collected"], 3) == 120.0

    # 3) دفع لأكثر من عميل مع أكثر من عقد.
    c_a = _customer("عميل متعدد أ", "55110005")
    c_b = _customer("عميل متعدد ب", "55110006")
    k_a = _contract(c_a, "عقد عميل أ", 200.0)
    k_b = _contract(c_b, "عقد عميل ب", 300.0)
    res_multi = lc.add_grouped_receipts(
        date.today().isoformat(), "نقدًا", "",
        [{"customer_id": c_a, "contract_id": k_a, "amount": 50.0},
         {"customer_id": c_b, "contract_id": k_b, "amount": 70.0}],
    )
    assert len(res_multi["receipt_ids"]) == 2
    assert round(lc.customer_financial_summary(c_a)["collected"], 3) == 50.0
    assert round(lc.customer_financial_summary(c_b)["collected"], 3) == 70.0

    # 4) دفع لعميل واحد على أكثر من عقد: مسموح، والمنع فقط لنفس العقد مرتين.
    c_one = _customer("عميل واحد عدة عقود", "55110007")
    k_one1 = _contract(c_one, "عقد أول لنفس العميل", 100.0)
    k_one2 = _contract(c_one, "عقد ثاني لنفس العميل", 100.0)
    res_one = lc.add_grouped_receipts(
        date.today().isoformat(), "نقدًا", "",
        [{"customer_id": c_one, "contract_id": k_one1, "amount": 30.0},
         {"customer_id": c_one, "contract_id": k_one2, "amount": 40.0}],
    )
    assert len(res_one["receipt_ids"]) == 2
    assert round(lc.customer_financial_summary(c_one)["collected"], 3) == 70.0
    try:
        lc.add_grouped_receipts(
            date.today().isoformat(), "نقدًا", "",
            [{"customer_id": c_one, "contract_id": k_one1, "amount": 5.0},
             {"customer_id": c_one, "contract_id": k_one1, "amount": 6.0}],
        )
        raise AssertionError("لا يجوز تكرار نفس العقد لنفس العميل")
    except customers.ValidationError:
        pass

    # البيان التلقائي لا يحتوي مرجعًا فنيًا ويقرأ منطق السند الفردي.
    with database.get_connection() as conn:
        descs = [r["description"] for r in conn.execute(
            "SELECT description FROM vouchers WHERE vtype='receipt' ORDER BY id").fetchall()]
    assert all("BT-" not in d and "تحويل بنكي مجمع" not in d for d in descs)
    assert any(d.startswith("سداد") for d in descs)
    print("OK: تمت مراجعة سيناريوهات السند المجمع: نقص/زيادة/عدة عملاء/عميل واحد عدة عقود")


if __name__ == "__main__":
    main()
