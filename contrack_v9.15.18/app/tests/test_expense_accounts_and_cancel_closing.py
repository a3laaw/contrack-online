# -*- coding: utf-8 -*-
"""مصروفات عامة مرتبطة بمشروع + إلغاء عقد/عقد باطن بمبلغ إغلاق."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service, lifecycle_service as lc  # noqa: E402


def main():
    cid = customer_service.add_customer(Customer(
        customer_code="CUS-CLOSE", name="عميل إغلاق", phone="55551000"))
    pid = lc.add_project(lc.next_project_code(), "مشروع مصروفات", cid)
    kid = contract_service.add_contract(Contract(
        contract_number="CON-CLOSE", customer_id=cid,
        contract_date=date.today().isoformat(), amount=1000,
        contract_type="غير محدد"))
    lc.update_contract_lifecycle(kid, project_id=pid)

    vid = lc.add_voucher(
        "payment", date.today().isoformat(), "مورد قرطاسية", "تحويل بنكي",
        "مصروفات إدارية", 25.500, "مصروف إداري مرتبط بعقد/مشروع",
        contract_id=kid, expense_customer_id=cid)
    with database.get_connection() as conn:
        v = conn.execute("SELECT * FROM vouchers WHERE id=?", (vid,)).fetchone()
        j = conn.execute("SELECT * FROM journal_entries WHERE source_id=? AND source_type='voucher_payment'", (vid,)).fetchone()
    assert v["project_id"] == pid and v["contract_id"] == kid
    assert v["expense_customer_id"] == cid
    assert v["account"] == "مصروفات إدارية"
    assert j["project_id"] == pid and j["debit_account"] == "مصروفات إدارية"

    lc.add_voucher("receipt", date.today().isoformat(), "", "نقدًا", "", 100,
                   "تحصيل قبل الإلغاء", contract_id=kid,
                   party_type="customer", party_id=cid)
    res = lc.change_contract_status(kid, "ملغى", "إلغاء باتفاق الطرفين", 900)
    assert res["cancel_close_amount"] == 900
    with database.get_connection() as conn:
        c = conn.execute("SELECT status, status_reason, cancel_close_amount FROM contracts WHERE id=?", (kid,)).fetchone()
    assert c["status"] == "ملغى" and c["cancel_close_amount"] == 900

    sid = lc.add_subcontractor(lc.next_sub_code(), "مقاول إغلاق")
    kid2 = contract_service.add_contract(Contract(
        contract_number="CON-SUB-CLOSE", customer_id=cid,
        contract_date=date.today().isoformat(), amount=2000,
        contract_type="غير محدد"))
    lc.update_contract_lifecycle(kid2, project_id=pid)
    scid = lc.add_sub_contract(sid, kid2, pid, 500, date.today().isoformat(), date.today().isoformat(), "باطن")
    lc.update_sub_contract(scid, 500, date.today().isoformat(), date.today().isoformat(),
                           "باطن", "ملغى", "إلغاء باتفاق", 350)
    with database.get_connection() as conn:
        sc = conn.execute("SELECT status, cancel_reason, cancel_close_amount FROM sub_contracts WHERE id=?", (scid,)).fetchone()
    assert sc["status"] == "ملغى" and sc["cancel_close_amount"] == 350
    print("OK: مصروفات المشاريع وحساباتها + إلغاء العقود بمبلغ إغلاق")


if __name__ == "__main__":
    main()
