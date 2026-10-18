# -*- coding: utf-8 -*-
"""V4.34/دفعة 1: تقرير الرفعات الموحد (خدمات) — تجميع بلا واجهة.

يغطي: صف كل رفعة (مستحق صافي/مسدد/متبقي/حالة/أسماء) · ملف كامل ·
جزئي · بلا تسديد · استبعاد (شركتنا/غير مصنف/منتظر/ملغى) · تفاصيل
الرفعة · الربط العكسي · الافتتاحي · غير المربوط · هويات المطابقة
مع other_balance · أمان إعادة الرفع · مفتاح مفقود.
V4.35: §12 الترويسة الجاهزة.
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


def _row(date, phone, amount, ref, status, customer, gw_paid=1):
    return {"date": date, "phone": phone, "amount": amount, "ref": ref,
            "status": status, "receipt_no": "", "customer": customer,
            "gw_paid": gw_paid, "gw_paid_date": "", "gw_token": ""}


st.save_profile(None, "KNET", "KW-1", "KNET", 1, 0.150)
st.save_profile(None, "Hesabe", "KW-2", "hesabe", 2, 0.0)

_A = [_row("2026-09-20", "99110011", 700.0, "INV-A1", "other", "أحمد"),
      _row("2026-09-21", "99220022", 200.0, "INV-A2", "other", "سارة")]
_B = [_row("2026-09-22", "99330033", 450.0, "INV-B1", "other", "خالد"),
      _row("2026-09-22", "99440044", 500.0, "INV-B2", "mine", "نورة"),
      _row("2026-09-22", "99550055", 100.0, "INV-B3", "unmarked", "مجهول")]
_C = [_row("2026-09-23", "99660066", 300.0, "INV-C1", "other", "فهد"),
      _row("2026-09-23", "99770077", 100.0, "INV-C2", "other", "منتظر",
           gw_paid=0)]
assert st.save_gateway_ops("KNET", _A, "SET-A.xlsx") == 2
assert st.save_gateway_ops("KNET", _B, "SET-B.xlsx") == 3
assert st.save_gateway_ops("Hesabe", _C, "SET-C.xlsx") == 2


def _key(r):
    return (r["date"], r["phone"], r["amount"], r["ref"])


st.distribute_rows("KNET", [_key(r) for r in _A])
st.distribute_rows("KNET", [_key(_B[0]), _key(_B[1])])
st.distribute_rows("Hesabe", [_key(_C[0])])
with database.get_connection() as conn:
    # صف شاذ قديم: موزَّع لكن غير محصّل (يُستبعد من المستحق).
    conn.execute("UPDATE gateway_ops SET distributed=1 WHERE ref='INV-C2'")
    conn.execute("UPDATE gateway_ops SET created_at='2026-09-25 10:00:00' "
                 "WHERE batch='SET-A.xlsx'")
    conn.execute("UPDATE gateway_ops SET created_at='2026-09-26 10:00:00' "
                 "WHERE batch='SET-B.xlsx'")
    conn.execute("UPDATE gateway_ops SET created_at='2026-09-27 10:00:00' "
                 "WHERE batch='SET-C.xlsx'")
    _ids = {}
    for _b in ("SET-A.xlsx", "SET-B.xlsx", "SET-C.xlsx"):
        _ids[_b] = [r[0] for r in conn.execute(
            "SELECT id FROM gateway_ops WHERE batch=? ORDER BY id",
            (_b,)).fetchall()]

t1 = st.add_other_transfer("2026-09-28", 899.7, "TR-A", "", "تحويل بنكي",
                           _ids["SET-A.xlsx"], False)
t2 = st.add_other_transfer("2026-09-28", 200.0, "TR-B", "", "تحويل بنكي",
                           [_ids["SET-B.xlsx"][0]], False)
st.add_other_transfer("2026-09-28", 50.0, "TR-FREE", "", "تحويل بنكي",
                      [], False)
st.set_other_opening(1000.0, "افتتاحي")

print("=== 1. شكل التقرير ===")
rep = st.upload_batches_report()
check("3 رفعات من الأحدث", [b["batch"] for b in rep]
      == ["SET-C.xlsx", "SET-B.xlsx", "SET-A.xlsx"],
      [b["batch"] for b in rep])
check("مفاتيح الصف كاملة",
      all(all(k in b for k in (
          "gateway", "batch", "day", "uploaded_at", "n_ops",
          "total_amount", "mine_total", "mine_net", "other_gross",
          "n_undistributed", "n_unmarked", "dues", "paid",
          "remaining", "status", "names")) for b in rep))
_by = {b["batch"]: b for b in rep}

print("=== 2. ملف مسدد بالكامل (مع غبار الرسوم) ===")
_a = _by["SET-A.xlsx"]
check("المستحق صافي 899.7", _a["dues"] == 899.7, _a["dues"])
check("المسدد 899.7 والمتبقي 0 والحالة paid",
      _a["paid"] == 899.7 and _a["remaining"] == 0.0
      and _a["status"] == "paid",
      (_a["paid"], _a["remaining"], _a["status"]))
check("الأسماء مرتبة", _a["names"] == ["أحمد", "سارة"], _a["names"])

print("=== 3. ملف جزئي + استبعادات ===")
_b = _by["SET-B.xlsx"]
check("449.85/200/249.85/partial",
      _b["dues"] == 449.85 and _b["paid"] == 200.0
      and _b["remaining"] == 249.85 and _b["status"] == "partial",
      (_b["dues"], _b["paid"], _b["remaining"], _b["status"]))
check("شركتنا خارج المستحق وداخل mine_total",
      _b["mine_total"] == 500.0 and _b["mine_net"] == 499.85
      and _b["other_gross"] == 450.0,
      (_b["mine_total"], _b["mine_net"], _b["other_gross"]))
check("غير المصنف معدود ومستبعد",
      _b["n_unmarked"] == 1 and _b["n_undistributed"] == 1,
      (_b["n_unmarked"], _b["n_undistributed"]))

print("=== 4. ملف بلا تسديد + منتظر مستبعد ===")
_c = _by["SET-C.xlsx"]
check("300/0/300/unpaid (المنتظر خارجها)",
      _c["dues"] == 300.0 and _c["paid"] == 0.0
      and _c["remaining"] == 300.0 and _c["status"] == "unpaid",
      (_c["dues"], _c["paid"], _c["remaining"], _c["status"]))

print("=== 5. تفاصيل الرفعة ===")
det = st.batch_detail("KNET", "SET-B.xlsx", "2026-09-26")
check("الترويسة = صف التقرير",
      det["header"] == _b and det["totals"] == {
          "dues": 449.85, "paid": 200.0, "remaining": 249.85},
      (det["header"] == _b, det["totals"]))
_ops = {o["ref"]: o for o in det["ops"]}
check("3 عمليات بحالات paid/partial/unpaid/na",
      len(det["ops"]) == 3
      and _ops["INV-B1"]["pay_status"] == "partial"
      and _ops["INV-B1"]["dues"] == 449.85
      and _ops["INV-B1"]["remaining"] == 249.85
      and _ops["INV-B2"]["pay_status"] == "na"
      and _ops["INV-B3"]["pay_status"] == "na",
      [(o["ref"], o["pay_status"]) for o in det["ops"]])
_pay = _ops["INV-B1"]["payments"]
check("تسديدة الجزئي مضمّنة بتفاصيلها",
      len(_pay) == 1 and _pay[0]["transfer_id"] == t2
      and _pay[0]["alloc"] == 200.0
      and _pay[0]["tdate"] == "2026-09-28"
      and _pay[0]["ref"] == "TR-B", _pay)

print("=== 6. الربط العكسي ===")
_op = st.op_payments(_ids["SET-A.xlsx"][0])
check("عملية A الأولى ← تسديدة 699.85",
      len(_op) == 1 and _op[0]["transfer_id"] == t1
      and _op[0]["alloc"] == 699.85
      and _op[0]["tdate"] == "2026-09-28", _op)
check("غير المسددة ← فارغ",
      st.op_payments(_ids["SET-C.xlsx"][0]) == [])

print("=== 7. هويات المطابقة مع other_balance ===")
bal = st.other_balance()
_sd = round(sum(b["dues"] for b in rep), 3)
_sp = round(sum(b["paid"] for b in rep), 3)
_un = st.unallocated_transfer_amount()
check("Σالمستحق + الافتتاحي = الكارت",
      _sd == 1649.55 and round(_sd + 1000.0, 3) == bal["dues"],
      (_sd, bal["dues"]))
check("Σالمسدد + غير المربوط = الكارت",
      _sp == 1099.7 and _un == 50.0
      and round(_sp + _un, 3) == bal["paid"],
      (_sp, _un, bal["paid"]))
check("المتبقي = 1499.85",
      bal["remaining"] == 1499.85, bal["remaining"])

print("=== 8. أمان إعادة الرفع ===")
check("لا جديد عند التكرار",
      st.save_gateway_ops("KNET", _A, "SET-A.xlsx") == 0)
rep2 = st.upload_batches_report()
check("التقرير ثابت",
      [(b["batch"], b["dues"], b["paid"]) for b in rep2]
      == [(b["batch"], b["dues"], b["paid"]) for b in rep])

print("=== 9. مفتاح مفقود ===")
_miss = st.batch_detail("KNET", "NOPE.xlsx", "2026-01-01")
check("أصفار بلا استثناء",
      _miss["ops"] == []
      and _miss["totals"] == {"dues": 0.0, "paid": 0.0,
                              "remaining": 0.0}, _miss["totals"])

print("=== 10. إكمال الجزئي ← paid ===")
st.add_other_transfer("2026-09-29", 249.85, "TR-B2", "", "تحويل بنكي",
                      [_ids["SET-B.xlsx"][0]], False)
_b2 = next(b for b in st.upload_batches_report()
           if b["batch"] == "SET-B.xlsx")
check("انقلاب الحالة (اكتمال صافي)",
      _b2["paid"] == 449.85 and _b2["remaining"] == 0.0
      and _b2["status"] == "paid",
      (_b2["paid"], _b2["remaining"], _b2["status"]))
bal2 = st.other_balance()
_sp2 = round(sum(b["paid"] for b in st.upload_batches_report()), 3)
check("الهويات بعد الإكمال",
      _sp2 == 1349.55 and bal2["paid"] == 1399.55
      and st.unallocated_transfer_amount() == 50.0
      and bal2["remaining"] == 1250.0,
      (bal2, st.unallocated_transfer_amount()))

print("=== 11. نطاق شركتنا (خدمة) ===")
_rep3 = st.upload_batches_report()
_by3 = {b["batch"]: b for b in _rep3}
check("n_mine وأسماء شركتنا",
      _by3["SET-A.xlsx"]["n_mine"] == 0
      and _by3["SET-A.xlsx"]["mine_names"] == []
      and _by3["SET-B.xlsx"]["n_mine"] == 1
      and _by3["SET-B.xlsx"]["mine_names"] == ["نورة"]
      and _by3["SET-C.xlsx"]["n_mine"] == 0,
      {k: (v["n_mine"], v["mine_names"]) for k, v in _by3.items()})
_md = st.batch_mine_detail("KNET", "SET-B.xlsx", "2026-09-26")
check("تفاصيل شركتنا: عملية + حالة اليوم",
      len(_md["ops"]) == 1 and _md["ops"][0]["ref"] == "INV-B2"
      and _md["ops"][0]["amount"] == 500.0
      and _md["ops"][0]["gateway"] == "KNET"
      and "day_status" in _md["ops"][0]
      and "bank_amount" in _md["ops"][0]
      and _md["ops"][0]["net"] == 499.85
      and _md["totals"] == {"n": 1, "total": 500.0, "fees": 0.15,
                            "net": 499.85},
      _md["totals"])
check("بلا شركتنا ← فارغ",
      st.batch_mine_detail("KNET", "SET-A.xlsx", "2026-09-25")["ops"]
      == []
      and st.batch_mine_detail("KNET", "NOPE.xlsx", "2026-01-01")
      == {"ops": [], "totals": {"n": 0, "total": 0.0, "fees": 0.0,
                                "net": 0.0}})
print("=== 12. الترويسة الجاهزة (V4.35) ===")
_rep4 = st.upload_batches_report()
_hdrB = next(b for b in _rep4 if b["batch"] == "SET-B.xlsx")
_d1 = st.batch_detail("KNET", "SET-B.xlsx", "2026-09-26")
_d2 = st.batch_detail("KNET", "SET-B.xlsx", "2026-09-26", header=_hdrB)
check("نفس النتيجة بالترويسة الجاهزة",
      _d1 == _d2 and _d2["header"] == _hdrB)
_hdrA = next(b for b in _rep4 if b["batch"] == "SET-A.xlsx")
_d3 = st.batch_detail("KNET", "SET-B.xlsx", "2026-09-26", header=_hdrA)
check("المخالفة تُتجاهل وتُعاد الحساب", _d3 == _d1, _d3["header"])
_calls = []
_raw = database._conn_store.conn._raw
_raw.set_trace_callback(lambda _s: _calls.append(_s))
st.batch_detail("KNET", "SET-B.xlsx", "2026-09-26")
q1 = len(_calls)
del _calls[:]
st.batch_detail("KNET", "SET-B.xlsx", "2026-09-26", header=_hdrB)
q2 = len(_calls)
_raw.set_trace_callback(None)
check("الجاهزة توفّر الاستعلامات", q2 < q1, (q1, q2))
print("")
print("V4.34 batch-report: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
