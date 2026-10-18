# -*- coding: utf-8 -*-
"""V4.13: سبق التعامل عند إعادة الرفع — مطابقة مسبقًا/بانتظار السداد.

يغطي: تعليم صفوف شركتي المثبتة مسبقًا · تعليم الأخرى غير المسددة ·
تجاهل المسددة (تُترك لتعليم paid_before) · تحديث الحالة عند إعادة
الاستيراد (الربط اليدوي 🔗) مع حماية المسدد · عدم التكرار ·
حساسية المفتاح (المرجع Invoice Number + تاريخ + هاتف + مبلغ).
"""
import copy
import os
import sys
import tempfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from services import gateway_service as gw  # noqa: E402
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


G = "Hesabe"


def _row(dt, phone, amount, ref, status, cust="", rcpt=""):
    return {"date": dt, "phone": phone, "amount": amount, "ref": ref,
            "status": status, "customer": cust, "receipt_no": rcpt,
            "note": ""}


print("=== 1. التثبيت الأول ===")
first = [
    _row("2026-09-20", "90000001", 100.0, "80252077410",
         gw.STATUS_MINE, "عميلنا", "R-1"),
    _row("2026-09-20", "90000002", 55.5, "80252077411",
         gw.STATUS_DIFF, "عميل فرق"),
    _row("2026-09-20", "90000003", 200.0, "80252077412",
         gw.STATUS_OTHER, "غريب"),
    _row("2026-09-20", "90000004", 300.0, "80252077413",
         gw.STATUS_OTHER, "غريب2"),
]
check("تثبيت 4 جديدة", st.save_gateway_ops(G, first, "f1.csv") == 4)

print("=== 2. إعادة الرفع تُعلَّم سبق التعامل ===")
again = copy.deepcopy(first)
for r in again:
    r.pop("receipt_no", None)
n = st.mark_seen_before(again, G)
check("عُلّم 4", n == 4, n)
check("شركتي = mine", again[0]["seen_before"] == gw.STATUS_MINE,
      again[0].get("seen_before"))
check("القديم diff يُقرأ غير مصنّف",
      again[1]["seen_before"] == gw.STATUS_UNMARKED,
      again[1].get("seen_before"))
check("الأخرى = other", again[2]["seen_before"] == gw.STATUS_OTHER)

print("=== 3. لا تكرار عند إعادة التثبيت ===")
check("صفر جديدة", st.save_gateway_ops(G, copy.deepcopy(first),
                                       "f1.csv") == 0)

print("=== 4. تحديث الحالة (ربط يدوي 🔗 لاحق) ===")
linked = copy.deepcopy(first[2])
linked["status"] = gw.STATUS_MINE
linked["receipt_no"] = "R-9"
check("التحديث لا يُحسب جديدًا",
      st.save_gateway_ops(G, [linked], "f2.csv") == 0)
look = st.seen_lookup(G)
check("الحالة أصبحت mine",
      look[("2026-09-20", "90000003", 200.0, "80252077412")] ==
      gw.STATUS_MINE, str(look))

print("=== 5. المسدد محمي + يُترك لتعليم paid_before ===")
keys = [(r["date"], r["phone"], round(r["amount"], 3), r["ref"])
        for r in first]
st.distribute_rows(G, [keys[3]])
ids = st.op_ids_for(G, [keys[3]])
check("id واحد غير مسدد", len(ids) == 1, ids)
tid = st.add_other_transfer(date.today().isoformat(), 300.0, ref="T-1",
                            op_ids=ids)
check("تسديد برقم", tid > 0, tid)
repaid = copy.deepcopy(first[3])
repaid["status"] = gw.STATUS_MINE  # محاولة تغيير حالة مسدد
st.save_gateway_ops(G, [repaid], "f3.csv")
look2 = st.seen_lookup(G)
check("حالة المسدد لم تتغير",
      look2[("2026-09-20", "90000004", 300.0, "80252077413")] ==
      gw.STATUS_OTHER, str(look2))
mix = [_row("2026-09-20", "90000004", 300.0, "80252077413",
            gw.STATUS_OTHER)]
check("تعليم مسدد = 1", st.mark_paid_before(mix, G) == 1)
check("نص التسديد يحمل الرقم", f"#{tid}" in mix[0]["paid_before"],
      mix[0].get("paid_before"))
check("seen يتخطى المسدد", st.mark_seen_before(mix, G) == 0)
check("لا seen_before للمسدد", "seen_before" not in mix[0])

print("=== 6. حساسية المفتاح ===")
stranger = [_row("2026-09-20", "90000001", 100.0, "99999999999",
                 gw.STATUS_OTHER)]
check("مرجع مختلف = غير مُعلَّم",
      st.mark_seen_before(stranger, G) == 0)
check("بوابة مختلفة = غير مُعلَّم",
      st.mark_seen_before(copy.deepcopy(first[:1]), "KNET") == 0)
check("بوابة فارغة = صفر",
      st.mark_seen_before(copy.deepcopy(first[:1]), "") == 0)

print("")
print("V4.13 seen-before: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
