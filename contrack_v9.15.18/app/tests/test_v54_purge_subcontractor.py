# -*- coding: utf-8 -*-
"""V5.4 ①: تنظيف البيانات — حذف مقاول باطن وحركاته.

يغطي: ظهور النوع والبحث · رفض الحذف بلا تفعيل صريح (عقود/سندات) ·
الحذف الكامل مع السلامة (بنود عقد العميل تبقى) · لقطة سجل التدقيق ·
بقاء حساب المصروف بلا ارتباط.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db  # noqa: E402

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import purge_service as pg  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def seed(sub_name="مقاولات الصفوة"):
    c = cs.add_customer(Customer(customer_code=f"C-{seed.n}", name=f"عميل {seed.n}",
                                 phone=f"9{seed.n:07d}"))
    k = ks.add_contract(Contract(contract_number=f"K-{seed.n}", customer_id=c,
                                 contract_date="2026-01-01", description="عقد",
                                 amount=10000.0, contract_type="مقاولة عامة"))
    seed.n += 1
    items = []
    for i in range(2):
        items.append(lc.add_boq_item(k, f"بند {i + 1}", 1, "عدد", 1000.0))
    with db.get_connection() as conn:
        conn.execute("INSERT INTO subcontractors (sub_code, name, phone) "
                     "VALUES (?,?,?)",
                     (f"S-{seed.n}", sub_name, f"8{seed.n:07d}"))
        sid = conn.execute("SELECT id FROM subcontractors WHERE name=?",
                           (sub_name,)).fetchone()["id"]
    sc = lc.add_sub_contract(sid, k, None, 1500.0, start_date="2026-01-01",
                             end_date="2026-06-01", description="",
                             boq_item_ids=[items[0]])
    with db.get_connection() as conn:
        conn.execute("INSERT INTO sub_payment_plan (sub_contract_id, title, "
                     "due_date, amount) VALUES (?,?,?,?)",
                     (sc, "1. دفعة", "2026-02-01", 1500.0))
        line = conn.execute("SELECT id FROM sub_payment_plan WHERE "
                            "sub_contract_id=?", (sc,)).fetchone()["id"]
    return {"customer": c, "contract": k, "sub": sid, "sc": sc,
            "items": items, "line": line}


seed.n = 1
print("=== 1. نوع «مقاول باطن» في أداة التنظيف ===")
d = seed()
rows = pg.list_entities("subcontractor")
check("النوع يظهر في القائمة", len(rows) == 1 and rows[0]["name"] == "مقاولات الصفوة",
      rows)
check("البحث بالكود يعمل",
      len(pg.list_entities("subcontractor", rows[0]["sub_code"])) == 1,
      rows[0]["sub_code"])
pv = pg.preview_subcontractor(d["sub"])
check("المعاينة تجمع الأبناء",
      pv.get("children", {}).get("sub_contracts") == 1
      and pv["children"].get("sub_contract_items") == 1
      and pv["children"].get("sub_payment_plan") == 1, pv.get("children"))

print("=== 2. سند صرف على المقاول (وتصحيح ظهوره في الدفعات) ===")
v1 = lc.add_voucher("payment", "2026-02-05", "مقاولات الصفوة", "نقدي", "",
                    500.0, "دفعة مقاول", contract_id=d["contract"],
                    party_type="subcontractor", party_id=d["sub"])
pv2 = pg.preview_subcontractor(d["sub"])
check("المعاينة ترى السند والمبلغ", pv2["children"].get("vouchers") == 1
      and abs(float(pv2.get("vouchers_total") or 0) - 500.0) < 0.001, pv2)

print("=== 3. رفض الحذف بلا تفعيل صريح ===")
try:
    pg.purge_subcontractor(d["sub"], "تجربة")
    check("رفض بلا خيارات", False, "لم يرفض")
except ValidationError as exc:
    check("رفض بلا خيارات", "عقد باطن" in str(exc), str(exc))

print("=== 4. بند عقد العميل محفوظ قبل الحذف ===")
before = lc.list_boq(d["contract"])
check("بندان على عقد العميل", len(before) == 2, len(before))

print("=== 5. الحذف الكامل مع الخيارات ===")
res = pg.purge_subcontractor(d["sub"], "بيانات تجريبية",
                             delete_contracts=True, delete_vouchers=True)
check("حُذف المقاول", res["deleted"] == 1 and res["contracts"] == 1
      and res["vouchers"] == 1, res)
with db.get_connection() as conn:
    check("لا مقاول في الجدول", conn.execute(
        "SELECT COUNT(*) FROM subcontractors WHERE id=?", (d["sub"],)
    ).fetchone()[0] == 0)
    check("لا عقود باطن", conn.execute(
        "SELECT COUNT(*) FROM sub_contracts WHERE subcontractor_id=?",
        (d["sub"],)).fetchone()[0] == 0)
    check("لا دفعات باطن", conn.execute(
        "SELECT COUNT(*) FROM sub_payment_plan WHERE sub_contract_id=?",
        (d["sc"],)).fetchone()[0] == 0)
    check("لا سندات للمقاول", conn.execute(
        "SELECT COUNT(*) FROM vouchers WHERE party_type='subcontractor' "
        "AND party_id=?", (d["sub"],)).fetchone()[0] == 0)
after = lc.list_boq(d["contract"])
check("بنود عقد العميل سليمة (بندان)", len(after) == 2, len(after))
with db.get_connection() as conn:
    check("ارتباط البنود بالمقاول حُذف", conn.execute(
        "SELECT COUNT(*) FROM sub_contract_items WHERE sub_contract_id=?",
        (d["sc"],)).fetchone()[0] == 0)

print("=== 6. لقطة سجل التدقيق ===")
log = pg.audit_log(entity="subcontractor")
check("سجل الحذف يحتوي العملية", len(log) == 1
      and "مقاولات الصفوة" in log[0]["label"], log)
snap = pg.audit_snapshot(log[0]["id"])
check("اللقطة تحمل المقاول والعقود والسندات",
      len(snap.get("subcontractors", [])) == 1
      and len(snap.get("sub_contracts", [])) == 1
      and len(snap.get("vouchers", [])) == 1, list(snap.keys()))
check("اللقطة تحمل دفعات الباطن", len(snap.get("sub_payment_plan", [])) == 1)

print("=== 7. مقاول بلا أي حركة يُحذف بلا خيارات ===")
d2 = seed("مقاول فاضي")
with db.get_connection() as conn:
    conn.execute("DELETE FROM sub_contract_items WHERE sub_contract_id=?",
                 (d2["sc"],))
    conn.execute("DELETE FROM sub_payment_plan WHERE sub_contract_id=?",
                 (d2["sc"],))
    conn.execute("DELETE FROM sub_contracts WHERE id=?", (d2["sc"],))
res2 = pg.purge_subcontractor(d2["sub"], "مقاول بلا حركة")
check("حُذف بلا خيارات", res2["deleted"] == 1 and res2["contracts"] == 0, res2)

print("=== 8. القيود المحاسبية المرتبطة تُحذف مع لقطتها ===")
d3 = seed("مقاول بقيود")
pg.purge_subcontractor(d3["sub"], "تنظيف", delete_contracts=True,
                       delete_vouchers=True)
with db.get_connection() as conn:
    for tbl, col in (("journal_entries", "sub_contract_id"),):
        n = conn.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col}=?",
                         (d3["sc"],)).fetchone()[0]
        check(f"لا صفوف متبقية في {tbl} تشير لعقد الباطن", n == 0, n)

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
