# -*- coding: utf-8 -*-
"""V3.22: الحذف النهائي للعقد — ترتيب آمن لا يكسر المفاتيح الأجنبية."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
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


def seed(full_chain=True):
    c1 = cs.add_customer(Customer(customer_code=f"C-{seed.n}",
                                  name=f"عميل التنظيف {seed.n}",
                                  phone=f"55{seed.n:06d}"))
    seed.n += 1
    k1 = ks.add_contract(Contract(contract_number=f"K-{seed.n}",
                                  customer_id=c1,
                                  contract_date="2026-01-01",
                                  description="عقد", amount=50000.0,
                                  contract_type="مقاولة عامة"))
    with db.get_connection() as c:
        c.execute("INSERT INTO contract_stages (contract_id, name, level,"
                  " sort_order) VALUES (?,?,?,?)", (k1, "مرحلة", 1, 1))
        sid = c.execute("SELECT id FROM contract_stages WHERE contract_id=?",
                        (k1,)).fetchone()[0]
        # دفعة مربوطة بمرحلة — تركيبة العطل الأصلية
        c.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
                  " amount, stage_id) VALUES (?,?,?,?,?)",
                  (k1, "دفعة", "2026-02-01", 5000.0, sid))
        c.execute("INSERT INTO contract_events (contract_id, event_type,"
                  " description) VALUES (?,?,?)", (k1, "ملاحظة", "حدث"))
        if full_chain:
            c.execute("INSERT INTO boq_items (contract_id, description, qty,"
                      " unit, unit_price) VALUES (?,?,?,?,?)",
                      (k1, "بند", 10.0, "م", 100.0))
            bid = c.execute("SELECT id FROM boq_items WHERE contract_id=?",
                            (k1,)).fetchone()[0]
            c.execute("INSERT INTO subcontractors (sub_code, name)"
                      " VALUES (?,?)", (f"S-{k1}", "مقاول"))
            sub = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                            (f"S-{k1}",)).fetchone()[0]
            c.execute("INSERT INTO sub_contracts (subcontractor_id,"
                      " contract_id, amount) VALUES (?,?,?)", (sub, k1, 3000.0))
            sc = c.execute("SELECT id FROM sub_contracts WHERE contract_id=?",
                           (k1,)).fetchone()[0]
            c.execute("INSERT INTO sub_contract_items (sub_contract_id,"
                      " boq_item_id) VALUES (?,?)", (sc, bid))
            c.execute("INSERT INTO quotations (quote_number, qdate,"
                      " customer_id, contract_id) VALUES (?,?,?,?)",
                      (f"Q-{k1}", "2026-01-01", c1, k1))
            qid = c.execute("SELECT id FROM quotations WHERE contract_id=?",
                            (k1,)).fetchone()[0]
            c.execute("INSERT INTO quotation_items (quotation_id,"
                      " description) VALUES (?,?)", (qid, "سطر"))
            c.execute("INSERT INTO vouchers (voucher_number, vtype, vdate,"
                      " amount, contract_id, boq_item_id, sub_contract_id)"
                      " VALUES (?,?,?,?,?,?,?)",
                      (f"V-{k1}", "payment", "2026-01-05", 1000.0,
                       k1, bid, sc))
    return k1


seed.n = 220

print("=== 1. حالة المستخدم: مراحل + دفعة مربوطة (بلا سندات) ===")
k_user = seed(full_chain=False)
pv = pg.preview_contract(k_user)
check("المعاينة ترى التوابع",
      pv["children"].get("contract_stages") == 1
      and pv["children"].get("payment_plan") == 1, str(pv["children"]))
try:
    r = pg.purge_contract(k_user, "تنظيف تجريبي")
    check("الحذف ينجح بلا FOREIGN KEY", r["deleted"] == 1)
except Exception as exc:
    check("الحذف ينجح بلا FOREIGN KEY", False, str(exc)[:80])
with db.get_connection() as c:
    left = c.execute("SELECT COUNT(*) FROM contracts WHERE id=?",
                     (k_user,)).fetchone()[0]
    orph = c.execute("SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
                     (k_user,)).fetchone()[0]
check("لا بقايا", left == 0 and orph == 0)

print("=== 2. السلسلة الكاملة + سندات مربوطة ببند/مقاولة ===")
k_full = seed(full_chain=True)
try:
    pg.purge_contract(k_full, "سبب")
    check("الحارس يرفض بلا خيار السندات", False)
except ValidationError as exc:
    check("الحارس يرفض بلا خيار السندات", "سند" in str(exc))
try:
    r2 = pg.purge_contract(k_full, "تنظيف تجريبي", delete_vouchers=True)
    check("الحذف مع السندات ينجح", r2["deleted"] == 1 and r2["vouchers"] == 1,
          str(r2))
except Exception as exc:
    check("الحذف مع السندات ينجح", False, str(exc)[:80])
snap = pg.audit_snapshot(pg.audit_log(limit=1)[0]["id"])
check("اللقطة فيها الأحفاد CASCADE",
      "quotation_items" in snap and "sub_contract_items" in snap
      and "payment_plan" in snap and "vouchers" in snap,
      str(sorted(snap.keys())))
with db.get_connection() as c2:
    gone = all(c2.execute(f"SELECT COUNT(*) FROM {t} WHERE contract_id=?",
                          (k_full,)).fetchone()[0] == 0
               for t in ("contract_stages", "payment_plan", "boq_items",
                         "sub_contracts", "quotations", "vouchers",
                         "contract_events"))
check("كل التوابع حُذفت", gone)

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
