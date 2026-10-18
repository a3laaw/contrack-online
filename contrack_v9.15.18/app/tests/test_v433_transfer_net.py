# -*- coding: utf-8 -*-
"""V4.33: التحويلات الداخلية اتجاهان + صافي (طرح لا جمع).

يغطي: وسم الاتجاه في الخدمة · صفوف الاتجاهين والصافي في الكشف الشامل ·
كشف التحويلات فقط (الصافي + التفصيل) · حالة العكس فقط (صافي سالب) ·
صف «نفس المحفظة» المشروط · عدم مساس الموازنات والصافي.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as contracts  # noqa: E402
from services import customer_service as customers  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import report_service as rep  # noqa: E402
from ui import reports_page as rp  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


D = "2026-09-20"
cid = customers.add_customer(Customer(
    customer_code=customers.next_customer_code(), name="عميل ص",
    phone="55770002"))
kid = contracts.add_contract(Contract(
    contract_number=contracts.next_contract_number(), customer_id=cid,
    contract_date=D, description="عقد ص", amount=9000.0,
    contract_type="تصميم"))
lc.add_voucher("receipt", D, "", "البنك", "", 2000.0, "دفعة بنكية",
               contract_id=kid, party_type="customer", party_id=cid)
lc.add_voucher("receipt", D, "", "نقدًا", "", 1000.0, "دفعة نقدية",
               contract_id=kid, party_type="customer", party_id=cid)
t1 = lc.add_voucher("transfer", D, "تحويل داخلي", "البنك", "الصندوق",
                    1000.0, "تمويل صندوق")
t2 = lc.add_voucher("transfer", D, "تحويل داخلي", "الصندوق", "البنك",
                    400.0, "تغذية بنك")
# تحويل قديم داخل نفس المحفظة (مرفوض في الواجهة — يُحاكى بصف مباشر).
with database.get_connection() as conn:
    _cur = conn.execute(
        "INSERT INTO vouchers (voucher_number, vtype, vdate, party, method, "
        "account, amount, description) VALUES (?,?,?,?,?,?,?,?)",
        ("TV-LEGACY-1", "transfer", D, "تحويل داخلي", "البنك",
         "تحويل بنكي", 70.0, "بين حسابين بنكيين"))
    t3 = _cur.lastrowid

print("=== 1. وسم الاتجاه والتقسيم ===")
d = rep.cash_flow_detail("2026-09-01", "2026-09-30")
_tags = [(i.get("from_wallet"), i.get("to_wallet"), i["amount"])
         for i in d["transfers"]]
check("3 تحويلات موسومة الاتجاه",
      sorted(_tags) == [("bank", "bank", 70.0), ("bank", "cash", 1000.0),
                        ("cash", "bank", 400.0)], _tags)
_a, _b, _s = rp._transfer_buckets(d["transfers"])
check("التقسيم 1000/400/70", (_a, _b, _s) == (1000.0, 400.0, 70.0),
      (_a, _b, _s))

print("=== 2. الكشف الشامل: اتجاهان + صافي ===")
spec = rp._data_cash_flow("detail", "2026-09-01", "2026-09-30")
_vals = {}
for r in spec["rows"]:
    if len(r) > 4 and isinstance(r[4], (int, float)):
        _vals[str(r[1])] = r[4]
check("صف الاتجاه بنك←صندوق = 1000",
      _vals.get("تحويلات من البنك إلى الصندوق") == 1000.0, _vals)
check("صف الاتجاه صندوق←بنك = 400",
      _vals.get("تحويلات من الصندوق إلى البنك") == 400.0, _vals)
check("صف نفس المحفظة = 70",
      _vals.get("تحويلات داخل نفس المحفظة") == 70.0, _vals)
check("الصافي = 600 (طرح لا جمع)",
      _vals.get("صافي التحويلات") == 600.0, _vals)
_cells = [str(c) for r in spec["rows"] for c in r]
check("لا إجمالي جامِع قديم",
      not any("الإجمالي · تحويلات" in c for c in _cells))
_net_note = [str(r[5]) for r in spec["rows"]
             if len(r) > 5 and str(r[1]) == "صافي التحويلات"]
check("بيان الصافي يشرح الطرح",
      _net_note and "ناقص" in _net_note[0], _net_note)
_acc = spec["accent_rows"] or {}
check("مفاتيح التمييز الأربعة بلا القديم",
      all(k in _acc for k in ("تحويلات من البنك إلى الصندوق",
                              "تحويلات من الصندوق إلى البنك",
                              "تحويلات داخل نفس المحفظة",
                              "صافي التحويلات"))
      and "الإجمالي · تحويلات" not in _acc, sorted(_acc))

print("=== 3. كشف التحويلات فقط ===")
to = rp._data_cash_flow("transfers_only", "2026-09-01", "2026-09-30")
check("صف الإجمالي صار صافيًا = 600",
      to["totals"][0] == "الصافي" and to["totals"][4] == 600.0,
      to["totals"])
check("الملاحظة تفصيلية مع بقاء العبارات",
      "من البنك إلى الصندوق: 1,000.000" in to["note"]
      and "من الصندوق إلى البنك: 400.000" in to["note"]
      and "الصافي (داخل الصندوق): 600.000" in to["note"]
      and "داخل نفس المحفظة: 70.000" in to["note"]
      and "تحويلات داخلية فقط" in to["note"]
      and "لا تُحسب ضمن المنصرف ولا الوارد" in to["note"],
      to["note"])

print("=== 4. الموازنات والصافي بلا مساس ===")
t = d["totals"]
check("البنك 1400 والصندوق 1600",
      t["bank"] == 1400.0 and t["cash"] == 1600.0,
      (t["bank"], t["cash"]))
check("صافي الحركة = الوارد فقط",
      t["in"] == 3000.0 and t["out"] == 0.0 and t["net"] == 3000.0, t)

print("=== 5. العكس فقط: صافي سالب ===")
lc.cancel_voucher(t1, "اختبار")
with database.get_connection() as conn:
    conn.execute("DELETE FROM vouchers WHERE id=?", (t3,))
d2 = rep.cash_flow_detail("2026-09-01", "2026-09-30")
spec2 = rp._data_cash_flow("detail", "2026-09-01", "2026-09-30")
_vals2 = {}
for r in spec2["rows"]:
    if len(r) > 4 and isinstance(r[4], (int, float)):
        _vals2[str(r[1])] = r[4]
check("الصافي −400",
      _vals2.get("صافي التحويلات") == -400.0, _vals2)
check("صف نفس المحفظة يختفي مع مفتاحه",
      "تحويلات داخل نفس المحفظة" not in _vals2
      and "تحويلات داخل نفس المحفظة"
      not in (spec2["accent_rows"] or {}))
to2 = rp._data_cash_flow("transfers_only", "2026-09-01", "2026-09-30")
check("كشف التحويلات: صافي سالب بلا عبارة نفس المحفظة",
      to2["totals"][4] == -400.0
      and "الصافي (داخل الصندوق): -400.000" in to2["note"]
      and "داخل نفس المحفظة" not in to2["note"], to2["note"])
check("الموازنات بعد الإلغاء: بنك 2400 وصندوق 600",
      d2["totals"]["bank"] == 2400.0 and d2["totals"]["cash"] == 600.0,
      (d2["totals"]["bank"], d2["totals"]["cash"]))

print("")
print("V4.33 transfer-net: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
