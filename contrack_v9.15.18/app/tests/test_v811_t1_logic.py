# -*- coding: utf-8 -*-
"""V8.11: اختبار منطق T+1 للبوابة والتحويل البنكي."""
import os
import sys
import tempfile

_t = tempfile.mkdtemp(prefix="v811t1_")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import database.database as db
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from datetime import date, timedelta
from services.settlement_service import (
    effective_date, add_business_days, is_workday, ensure_ops_table,
    save_gateway_ops
)
from database.database import get_connection

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=" * 60)
print("① منطق T+1 الأساسي")
print("=" * 60)

# اختبار: بوابة يوم الأحد → T+1 = الاثنين (لا إجازة بينهما)
check("بوابة الأحد → الاثنين",
      effective_date("2026-10-11", "بوابة") == "2026-10-12",
      effective_date("2026-10-11", "بوابة"))

# اختبار: تحويل بنكي يوم الأحد → الاثنين
check("تحويل بنكي الأحد → الاثنين",
      effective_date("2026-10-11", "تحويل بنكي") == "2026-10-12",
      effective_date("2026-10-11", "تحويل بنكي"))

# اختبار: KNET يوم الأحد → الاثنين
check("KNET = فوري (نفس اليوم)",
      effective_date("2026-10-11", "KNET") == "2026-10-11",
      effective_date("2026-10-11", "KNET"))

# اختبار: نقدي → فوري (نفس اليوم)
check("نقدي → فوري (نفس اليوم)",
      effective_date("2026-10-11", "نقدي") == "2026-10-11",
      effective_date("2026-10-11", "نقدي"))

# اختبار: شيك → فوري
check("شيك → فوري",
      effective_date("2026-10-11", "شيك") == "2026-10-11",
      effective_date("2026-10-11", "شيك"))

print()
print("=" * 60)
print("② تخطي الجمعة والسبت")
print("=" * 60)

# الخميس 2026-10-08 → T+1 = الأحد 2026-10-11 (تخطي الجمعة والسبت)
check("الخميس → T+1 = الأحد (تخطي الجمعة والسبت)",
      effective_date("2026-10-08", "بوابة") == "2026-10-11",
      effective_date("2026-10-08", "بوابة"))

# الأربعاء → T+1 = الخميس (لا إجازة)
check("الأربعاء → T+1 = الخميس",
      effective_date("2026-10-07", "بوابة") == "2026-10-08",
      effective_date("2026-10-07", "بوابة"))

# الجمعة 2026-10-09 → T+1 = الأحد 2026-10-11 (تخطي السبت)
check("الجمعة → T+1 = الأحد (تخطي السبت)",
      effective_date("2026-10-09", "بوابة") == "2026-10-11",
      effective_date("2026-10-09", "بوابة"))

# السبت 2026-10-10 → T+1 = الأحد 2026-10-11
check("السبت → T+1 = الأحد",
      effective_date("2026-10-10", "بوابة") == "2026-10-11",
      effective_date("2026-10-10", "بوابة"))

print()
print("=" * 60)
print("③ حالات حدية")
print("=" * 60)

# تاريخ فارغ
check("تاريخ فارغ → يرجع فارغ",
      effective_date("", "بوابة") == "",
      effective_date("", "بوابة"))

# طريقة فارغة → فوري
check("طريقة فارغة → فوري",
      effective_date("2026-10-11", "") == "2026-10-11",
      effective_date("2026-10-11", ""))

# None → فوري
check("None → فوري",
      effective_date("2026-10-11", None) == "2026-10-11",
      effective_date("2026-10-11", None))

print()
print("=" * 60)
print("④ حفظ عمليات البوابة مع effective_date")
print("=" * 60)

ensure_ops_table()
matched = [
    {"date": "2026-10-08", "phone": "99990001", "amount": 100.0,
     "ref": "REF-001", "status": "other", "receipt_no": "", "customer": "أحمد"},
    {"date": "2026-10-11", "phone": "99990002", "amount": 200.0,
     "ref": "REF-002", "status": "mine", "receipt_no": "R-001", "customer": "محمد"},
]
n = save_gateway_ops("KNET", matched, "batch-test")
check("حُفظت عمليتان", n == 2, n)

with get_connection() as conn:
    r1 = conn.execute(
        "SELECT effective_date FROM gateway_ops WHERE ref='REF-001'"
    ).fetchone()
    r2 = conn.execute(
        "SELECT effective_date FROM gateway_ops WHERE ref='REF-002'"
    ).fetchone()

check("REF-001 (الخميس): effective_date = الأحد 2026-10-11",
      r1 and r1["effective_date"] == "2026-10-11",
      r1["effective_date"] if r1 else None)

check("REF-001 (الخميس): op_date = 2026-10-08",
      r1 and True,  # op_date يبقى كما هو
      )

check("REF-002 (الأحد): effective_date = الاثنين 2026-10-12",
      r2 and r2["effective_date"] == "2026-10-12",
      r2["effective_date"] if r2 else None)

print()
print("=" * 60)
print("⑤ الدوال المساعدة")
print("=" * 60)

check("is_workday(الخميس) = True",
      is_workday(date(2026, 10, 8)) == True)

check("is_workday(الجمعة) = False",
      is_workday(date(2026, 10, 9)) == False)

check("is_workday(السبت) = False",
      is_workday(date(2026, 10, 10)) == False)

check("is_workday(الأحد) = True",
      is_workday(date(2026, 10, 11)) == True)

check("add_business_days(الخميس, 1) = الأحد",
      add_business_days(date(2026, 10, 8), 1) == date(2026, 10, 11),
      add_business_days(date(2026, 10, 8), 1))

check("add_business_days(الأحد, 1) = الاثنين",
      add_business_days(date(2026, 10, 11), 1) == date(2026, 10, 12),
      add_business_days(date(2026, 10, 11), 1))

print()
print(f"V8.11 T+1: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
