# -*- coding: utf-8 -*-
"""V4.7: تسجيل تحويلات الشركة الأخرى + المتبقي + تقرير التحويلات.

يغطي: التحقق (مبلغ/تاريخ) · الحفظ والعرض والمدى · الحذف ·
المستحق من التصفية · الرصيد (مستحق/محوَّل/متبقي).
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

from services import settlement_service as st  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


def raises_valueerror(fn):
    try:
        fn()
    except ValueError:
        return True
    except Exception:
        return False
    return False


print("=== 1. التحقق ===")
check("مبلغ صفر مرفوض",
      raises_valueerror(lambda: st.add_other_transfer("2026-09-01", 0)))
check("مبلغ سالب مرفوض",
      raises_valueerror(lambda: st.add_other_transfer("2026-09-01", -5)))
check("تاريخ فاسد مرفوض",
      raises_valueerror(lambda: st.add_other_transfer("not-a-date", 10)))

print("=== 2. مستحق عند التصنيف (بلا بنك) ===")
D = "2026-09-20"  # أحد — يوم عمل
st.save_profile(None, "T", "بنك T", "KNET", 0, 0.0)
st.save_gateway_ops("T", [{"date": D, "phone": "9999", "amount": 100.0,
                            "ref": "R1", "status": "other",
                            "receipt_no": "", "customer": ""}], "b1")
check("بلا مستحق قبل التوزيع", st.other_dues_total() == 0.0)
st.distribute_rows("T", [(D, "9999", 100.0, "R1")])
check("المستحق قبل البنك = 100",
      abs(st.other_dues_total() - 100.0) < 0.001,
      st.other_dues_total())
st.save_bank_lines("بنك T", [{"cdate": D, "amount": 100.0,
                              "descr": "تسوية"}], "b1")
stmt = st.other_statement(D, D)
check("الكشف يحمل نصيب الأخرى",
      len(stmt) == 1 and abs(stmt[0]["other_share"] - 100.0) < 0.001,
      str(stmt))
check("إجمالي المستحق = 100", abs(st.other_dues_total() - 100.0) < 0.001,
      st.other_dues_total())

print("=== 3. حفظ وعرض ومدى ===")
t1 = st.add_other_transfer("2026-09-21", 40.0, "HV-1", "حوالة")
t2 = st.add_other_transfer("2026-09-22", 10.0)
check("معرفان مختلفان", t1 != t2 and t1 > 0 and t2 > 0)
all_rows = st.list_other_transfers()
check("عرض الكل = 2", len(all_rows) == 2, str(all_rows))
rng = st.list_other_transfers("2026-09-21", "2026-09-21")
check("المدى = 1 بالمرجع",
      len(rng) == 1 and rng[0]["ref"] == "HV-1", str(rng))
check("إجمالي الكل = 50", abs(st.other_transfers_total() - 50.0) < 0.001)
check("إجمالي المدى = 40",
      abs(st.other_transfers_total("2026-09-21", "2026-09-21") - 40.0)
      < 0.001)

print("=== 4. الرصيد والحذف ===")
bal = st.other_balance()
check("الرصيد 100/50/50",
      abs(bal["dues"] - 100.0) < 0.001
      and abs(bal["paid"] - 50.0) < 0.001
      and abs(bal["remaining"] - 50.0) < 0.001, str(bal))
st.delete_other_transfer(t1)
check("بعد الحذف تحويل واحد", len(st.list_other_transfers()) == 1)
bal2 = st.other_balance()
check("المتبقي بعد الحذف = 90",
      abs(bal2["remaining"] - 90.0) < 0.001, str(bal2))

print("")
print("V4.7 transfers: " + str(PASS) + " passed, " + str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
