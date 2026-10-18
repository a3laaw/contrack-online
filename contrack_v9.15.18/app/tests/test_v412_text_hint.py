# -*- coding: utf-8 -*-
"""V4.12: تلميح لفظي — وصف حسابي ↔ (بيان السند/اسم ووصف العقد)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


import database.database as db  # noqa: E402

db.DB_PATH = "/tmp/gw412.sqlite"
if os.path.exists("/tmp/gw412.sqlite"):
    os.remove("/tmp/gw412.sqlite")
db.init_db()
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import gateway_service as gw  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402


def _mkcust(code, name, phone):
    return customer_service.add_customer(Customer(
        customer_code=code, name=name, phone=phone))


def _mkcon(num, cid, ctype, descr):
    return contract_service.add_contract(Contract(
        contract_number=num, customer_id=cid, contract_date="2026-09-01",
        description=descr, amount=10000.0, contract_type=ctype))


def _mkv(date, amount, cid, kid, descr):
    return lc.add_voucher("receipt", date, "", "KNET", "", amount, descr,
                          contract_id=kid, party_type="customer",
                          party_id=cid)


print("=== 1. دالة text_hint ===")
check("اسم العقد",
      gw.text_hint("دفعة اشراف", "", "", "اشراف", ""))
check("وصف العقد",
      gw.text_hint("كتاب بلديه", "", "", "مقاولة", "اصدار كتاب بلديه"))
check("بيان السند",
      gw.text_hint("تاير", "", "ايصال تاير", "", ""))
check("عبر المرجع",
      gw.text_hint("", "INV-واجهات", "", "", "واجهات"))
check("بلا تشابه = لا",
      not gw.text_hint("دفعة نقدية", "", "تحويل بنكي", "اشراف", "واجهات"))
check("الـ التعريف (الواجهات/واجهات)",
      gw.text_hint("الواجهات", "", "", "", "واجهات"))
check("كلمات قصيرة تُتجاهل",
      not gw.text_hint("CD", "", "CD صوتي", "", ""))
check("وصف حسابي فارغ = لا",
      not gw.text_hint("", "", "دفعة", "اشراف", "واجهات"))

print("=== 2. مطابقة كاملة ===")
cA = _mkcust("C-A12", "عادل فرس", "99550011")
kA1 = _mkcon("K-421", cA, "اشراف", "اشراف واجهات الفيلا")
kA2 = _mkcon("K-422", cA, "مقاولة عامة", "توريد مواد")
_mkv("2026-09-08", 150.0, cA, kA1, "دفعة اشراف")  # vA1 ملمّح (بعيد)
_mkv("2026-09-10", 150.0, cA, kA2, "دفعة حساب")  # vA2 بلا تلميح (قريب)
rpm = {(r["customer_id"], r["vdate"], round(float(r["amount"]), 3)): r
       for r in gw.receipt_phones()}
vA1 = rpm[(cA, "2026-09-08", 150.0)]
vA2 = rpm[(cA, "2026-09-10", 150.0)]


def _row(descr, ref, amount, date="2026-09-10"):
    return {"customer": "عادل عبدالهادي فرس", "phone": "",
            "amount": amount, "date": date, "descr": descr, "ref": ref}


r1 = gw.match_settlement([_row("واجهات", "", 150.0)])[0]
check("الملمّح يفوز رغم بُعد تاريخه",
      r1["receipt_no"] == vA1["voucher_number"],
      f"got={r1['receipt_no']} want={vA1['voucher_number']}")
check("القناة «وصف + اسم جزئي»",
      r1["via"] == "وصف + اسم جزئي", f"got={r1['via']}")
r2 = gw.match_settlement([_row("تحويل", "", 150.0)])[0]
check("بلا تلميح: الأقرب يفوز وبلا بادئة وصف",
      r2["receipt_no"] == vA2["voucher_number"] and r2["via"] == "اسم جزئي",
      f"got={r2['receipt_no']}/{r2['via']}")
r3 = gw.match_settlement([_row("واجهات", "", 999.0)])[0]
check("المبلغ شرط أساسي رغم التلميح",
      r3["status"] == gw.STATUS_DIFF, f"got={r3['status']}")
r4 = gw.match_settlement([_row("", "K-421", 150.0)])[0]
check("تلميح الرقم القديم يعمل",
      r4["via"] == "عقد + اسم جزئي"
      and r4["receipt_no"] == vA1["voucher_number"],
      f"got={r4['via']}/{r4['receipt_no']}")

print(f"\nV4.12 text-hint: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
