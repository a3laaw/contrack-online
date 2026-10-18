# -*- coding: utf-8 -*-
"""V4.11: اسم جزئي + نافذة 3 أيام + الأقرب تاريخيًا + تلميح عقد + ربط يدوي."""
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

db.DB_PATH = "/tmp/gw411.sqlite"
if os.path.exists("/tmp/gw411.sqlite"):
    os.remove("/tmp/gw411.sqlite")
db.init_db()
from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import gateway_service as gw  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import settlement_service as st  # noqa: E402


def _mkcust(code, name, phone):
    return customer_service.add_customer(Customer(
        customer_code=code, name=name, phone=phone))


def _mkcon(num, cid):
    return contract_service.add_contract(Contract(
        contract_number=num, customer_id=cid, contract_date="2026-09-01",
        description="ع", amount=10000.0, contract_type="مقاولة عامة"))


def _mkv(date, amount, cid, kid):
    lc.add_voucher("receipt", date, "", "KNET", "", amount, "رابط دفع",
                   contract_id=kid, party_type="customer", party_id=cid)


cA = _mkcust("C-A11", "أحمد محمد السالم", "99110011")
kA = _mkcon("K-411", cA)
_mkv("2026-09-10", 250.0, cA, kA)  # vA1
_mkv("2026-09-01", 250.0, cA, kA)  # vA2
_mkv("2026-09-08", 250.0, cA, kA)  # vA3
cB = _mkcust("C-B11", "سارة خالد", "99220022")
kB1 = _mkcon("CNT-100", cB)
kB2 = _mkcon("CNT-200", cB)
_mkv("2026-09-09", 300.0, cB, kB1)  # vB1
_mkv("2026-09-08", 300.0, cB, kB2)  # vB2
cC = _mkcust("C-C11", "خالد العتيبي", "99330033")
kC = _mkcon("K-413", cC)
_mkv("2026-09-10", 100.0, cC, kC)  # vC1
cD = _mkcust("C-D11", "نورة", "99440044")
kD = _mkcon("K-414", cD)
_mkv("2026-09-10", 400.0, cD, kD)  # vD1

rpm = {(r["customer_id"], r["vdate"], round(float(r["amount"]), 3)): r
       for r in gw.receipt_phones()}
vA1 = rpm[(cA, "2026-09-10", 250.0)]
vA3 = rpm[(cA, "2026-09-08", 250.0)]
vB1 = rpm[(cB, "2026-09-09", 300.0)]
vB2 = rpm[(cB, "2026-09-08", 300.0)]

print("=== 1. تشابه الأسماء ===")
check("جزء من الكل",
      gw.names_similar("محمد", "أحمد محمد السالم"))
check("بالعكس أيضًا",
      gw.names_similar("أحمد محمد السالم", "محمد"))
check("مختلف = لا",
      not gw.names_similar("سارة خالد", "أحمد محمد"))
check("فارغ = لا", not gw.names_similar("", "أحمد"))

print("=== 2. نافذة الاسم 3 أيام ===")
m = gw.match_settlement([
    {"customer": "خالد العتيبي", "phone": "", "amount": 100.0,
     "date": "2026-09-13", "ref": "W3", "row_no": 2},
    {"customer": "خالد العتيبي", "phone": "", "amount": 100.0,
     "date": "2026-09-14", "ref": "W4", "row_no": 3},
    {"customer": "", "phone": "99440044", "amount": 400.0,
     "date": "2026-09-15", "ref": "W5", "row_no": 4}])
check("فرق 3 أيام بالاسم = شركتي",
      m[0]["status"] == "mine" and m[0]["via"] == "الاسم", m[0])
check("فرق 4 أيام = فرق (النافذة 3)",
      m[1]["status"] == "diff" and "النافذة 3 أيام" in m[1]["note"],
      m[1])
check("الهاتف يبقى 5 أيام",
      m[2]["status"] == "mine" and "الهاتف" in m[2]["via"], m[2])

print("=== 3. الأقرب تاريخيًا يفوز ===")
m = gw.match_settlement([
    {"customer": "أحمد محمد السالم", "phone": "99110011", "amount": 250.0,
     "date": "2026-09-11", "ref": "N1", "row_no": 2},
    {"customer": "أحمد محمد السالم", "phone": "99110011", "amount": 250.0,
     "date": "2026-09-06", "ref": "N2", "row_no": 3}])
check("الأحدث للأحدث",
      m[0]["status"] == "mine"
      and m[0]["receipt_no"] == vA1["voucher_number"]
      and m[0]["via"] == "الهاتف والاسم", m[0])
check("الأقدم للأقدم",
      m[1]["status"] == "mine"
      and m[1]["receipt_no"] == vA3["voucher_number"], m[1])

print("=== 4. تلميح العقد ===")
m = gw.match_settlement([
    {"customer": "سارة خالد", "phone": "", "amount": 300.0,
     "date": "2026-09-10", "ref": "H1",
     "descr": "تحويل عقد CNT-200 دفعة أولى", "row_no": 2},
    {"customer": "سارة خالد", "phone": "", "amount": 999.0,
     "date": "2026-09-10", "ref": "H2",
     "descr": "عقد CNT-200", "row_no": 3},
    {"customer": "سارة خالد", "phone": "", "amount": 300.0,
     "date": "2026-09-10", "ref": "سداد CNT-100", "descr": "",
     "row_no": 4}])
check("التلميح يغلب الأقرب",
      m[0]["status"] == "mine"
      and m[0]["receipt_no"] == vB2["voucher_number"]
      and m[0]["via"].startswith("عقد + "), m[0])
check("المبلغ أساسي رغم التلميح",
      m[1]["status"] != "mine", m[1])
check("التلميح من المرجع أيضًا",
      m[2]["status"] == "mine"
      and m[2]["receipt_no"] == vB1["voucher_number"], m[2])

print("=== 5. اسم جزئي ===")
m = gw.match_settlement([
    {"customer": "أحمد السالم", "phone": "", "amount": 250.0,
     "date": "2026-09-10", "ref": "P1", "row_no": 2},
    {"customer": "أحمد الغريب", "phone": "", "amount": 250.0,
     "date": "2026-09-10", "ref": "P2", "row_no": 3}])
check("الجزئي يطابق الأقرب",
      m[0]["status"] == "mine" and m[0]["via"] == "اسم جزئي"
      and m[0]["receipt_no"] == vA1["voucher_number"], m[0])
check("الغريب = ليست شركتي", m[1]["status"] == "other", m[1])

print("=== 6. ربط يدوي وروابط محفوظة ===")
gw.save_alias("96555555555", "اسم الملف الغريب", cB)
check("حفظ واسترجاع الرابط",
      (gw.find_alias("55555555", "اسم الملف الغريب") or {})
      .get("customer_id") == cB)
m = gw.match_settlement([
    {"customer": "اسم الملف الغريب", "phone": "55555555", "amount": 300.0,
     "date": "2026-09-09", "ref": "A1", "row_no": 2}])
check("الرابط المحفوظ يطابق",
      m[0]["status"] == "mine" and m[0]["via"] == "رابط محفوظ"
      and m[0]["receipt_no"] == vB1["voucher_number"], m[0])
item = {"date": "2026-09-09", "phone": "55555555", "amount": 300.0,
        "ref": "M1", "customer": "اسم الملف الغريب", "status": "diff",
        "receipt_no": "", "note": "x"}
check("تثبيت العملية",
      st.save_gateway_ops("Hesabe", [item], "t.csv") == 1)
key = ("2026-09-09", "55555555", 300.0, "M1")
info = gw.link_row_manual("Hesabe", key, vB2["id"])
check("الربط يرجع التفاصيل",
      info["voucher_number"] == vB2["voucher_number"], info)
with db.get_connection() as conn:
    op = conn.execute(
        "SELECT status, receipt_no, customer FROM gateway_ops "
        "WHERE gateway='Hesabe' AND ref='M1'").fetchone()
check("المثبتة = شركتي مع حفظ اسم الملف",
      op["status"] == "mine"
      and op["receipt_no"] == vB2["voucher_number"]
      and op["customer"] == "اسم الملف الغريب", dict(op))
gw.unlink_row_manual("Hesabe", key)
with db.get_connection() as conn:
    op = conn.execute(
        "SELECT status, receipt_no, customer FROM gateway_ops "
        "WHERE gateway='Hesabe' AND ref='M1'").fetchone()
check("الفك يعيد للأخرى ويحفظ الاسم",
      op["status"] == "other" and op["receipt_no"] == ""
      and op["customer"] == "اسم الملف الغريب", dict(op))
check("الفك يحذف الرابط",
      gw.find_alias("55555555", "اسم الملف الغريب") is None)
gw.save_alias("55555555", "أ", cA)
gw.save_alias("55555555", "ب", cB)
gw.delete_alias_phone("55555555")
check("حذف روابط الهاتف",
      gw.find_alias("55555555", "أ") is None
      and gw.find_alias("55555555", "ب") is None)

print("=== 7. مرشحو الربط ===")
check("فلتر المبلغ",
      len(gw.candidate_receipts(amount=250.0)) == 3)
check("فلتر البحث",
      len(gw.candidate_receipts(query="سارة")) == 2)
check("مشترك",
      len(gw.candidate_receipts(amount=300.0, query="RV-")) == 2)

print("=== 8. الشاشة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.gateway_page import GatewayPage  # noqa: E402

gp = GatewayPage()
check("الجماعي في قائمة ⋯",  # V4.40: ملفات البوابات بدل المطابقة
      [a.text() for a in gp.more_btn.menu().actions()]
      == ["تعليم الكل: شركتنا", "تعليم الكل: شركة أخرى",
          "📤 تصدير", "🗑 مسح بيانات البوابات",
          "↩ إرجاع المحدد للتوزيع", "⚙️ ملفات البوابات"])
gp.set_filter("unmarked")
check("فلتر غير مصنّف", gp._filter == "unmarked")
check("أزرار الربط القديمة محذوفة",
      not any(hasattr(gp, b) for b in
              ("link_btn", "unlink_btn", "review_btn", "rematch_btn",
               "pay_btn", "select_btn")))

if os.path.exists("/tmp/gw411.sqlite"):
    os.remove("/tmp/gw411.sqlite")
print(f"\nV4.11 matching: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
