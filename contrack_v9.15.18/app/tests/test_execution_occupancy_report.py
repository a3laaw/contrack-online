# -*- coding: utf-8 -*-
"""محاكاة تقرير مراحل التنفيذ الجديد.

يبني 3 عقود في مراحل جارية مختلفة ويثبت أن التقرير لا يرجع المتأخرين فقط،
بل يعرض كل الموجودين في المراحل مع عدد الأيام.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import database
from database.models import Customer, Contract
from services import customer_service as cs
from services import contract_service as ks
from services import contract_type_service as cts
from services import workflow_service as wf


def _make_customer(i):
    return cs.add_customer(Customer(
        customer_code=cs.next_customer_code(),
        name=f"عميل مراحل التنفيذ {i}",
        phone=f"5500000{i}",
        address="الكويت",
    ))


def _make_contract(i, cid):
    return ks.add_contract(Contract(
        contract_number=ks.next_contract_number(),
        customer_id=cid,
        contract_date=date.today().isoformat(),
        description=f"عقد اختبار مراحل {i}",
        amount=1000.0 + i,
        contract_type="تصميم",
    ))


def main():
    database.init_db()
    try:
        cts.add_type("تصميم", 1000)
    except Exception:
        pass
    try:
        wf.restore_default_for_type("تصميم")
    except Exception:
        pass

    ids = []
    for i in range(1, 4):
        cid = _make_customer(i)
        kid = _make_contract(i, cid)
        ids.append(kid)

    # اجعل العقود في مراحل مختلفة: الأول ضمن الوقت، الثاني قريب، الثالث متأخر.
    with database.get_connection() as conn:
        for i, kid in enumerate(ids, 1):
            stages = conn.execute(
                "SELECT id, expected_days FROM contract_stages "
                "WHERE contract_id=? AND level=1 ORDER BY sort_order, id",
                (kid,)).fetchall()
            assert stages, "العقد بلا مراحل"
            # انقل عقد 2 و3 للمرحلة الثانية لبيان التجميع حسب المرحلة
            if i in (2, 3) and len(stages) > 1:
                conn.execute("UPDATE contract_stages SET end_date=? WHERE id=?",
                             (date.today().isoformat(), stages[0]["id"]))
                conn.execute("UPDATE contract_stages SET start_date=? WHERE id=?",
                             (date.today().isoformat(), stages[1]["id"]))
                cur = stages[1]
            else:
                cur = stages[0]
            expected = int(cur["expected_days"] or 5)
            if i == 1:
                days = max(1, expected // 2)
            elif i == 2:
                days = max(0, expected - 1)
            else:
                days = expected + 4
            start = (date.today() - timedelta(days=days)).isoformat()
            conn.execute("UPDATE contract_stages SET start_date=?, end_date='' WHERE id=?",
                         (start, cur["id"]))

    rep = wf.execution_occupancy_report("current")
    print("count:", rep["count"])
    print("totals:", rep["totals"])
    for r in rep["rows"]:
        print(r["stage"], r["customer_name"], r["contract_number"],
              r["days_in"], r["expected"], r["status_label"])

    assert rep["count"] >= 3
    assert rep["totals"]["ok"] >= 1
    assert rep["totals"]["near"] >= 1
    assert rep["totals"]["delayed"] >= 1
    print("OK: تقرير مراحل التنفيذ يعرض كل الموجودين في المراحل وليس المتأخرين فقط")


if __name__ == "__main__":
    main()
