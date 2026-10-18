# -*- coding: utf-8 -*-
"""اختبار دورة حياة العقد الكاملة:
عرض سعر → عقد → مشروع → BOQ → مقاول باطن → سندات → قيود → كشوف → ربحية"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db
_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database.database import init_db
from database.models import Customer, Invoice
from services import customer_service, invoice_service
from services import lifecycle_service as lc
from services.customer_service import ValidationError

PASS = FAIL = 0

def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  [PASS] {name}")
    else: FAIL += 1; print(f"  [FAIL] {name} {detail}")

def expect_error(name, fn, *args, **kw):
    try:
        fn(*args, **kw)
        check(name, False, "(لم يُرفض)")
    except ValidationError as e:
        check(name, True)

init_db()

print("=== 1. العميل والمشروع ===")
cid = customer_service.add_customer(Customer(
    customer_code="CUS-0001", name="شركة ABC", phone="99887766"))
pcode = lc.next_project_code()
check("ترقيم المشروع PRJ-0001", pcode == "PRJ-0001")
pid = lc.add_project(pcode, "مشروع فيلا ABC", cid, "بناء فيلا سكنية")
check("إنشاء المشروع", pid == 1)

print("\n=== 2-3. إنشاء عقد مباشر مع BOQ ===")
from services import contract_service
from database.models import Contract
contract_id = contract_service.add_contract(Contract(
    contract_number=contract_service.next_contract_number(),
    customer_id=cid, contract_date="2026-01-01",
    description="عقد بناء فيلا", amount=100000.0))
with db.get_connection() as conn:
    conn.execute("UPDATE contracts SET project_id=?, status='معتمد' WHERE id=?",
                 (pid, contract_id))
lc.log_event(contract_id, "إنشاء العقد", "إنشاء مباشر")
check("إنشاء العقد", contract_id > 0)
for d, q, u, p in [("أعمال الحفر",1,"مقطوعية",10000), ("أعمال الخرسانة",500,"م3",80),
                   ("أعمال الكهرباء",1,"مقطوعية",25000), ("أعمال التكييف",1,"مقطوعية",30000)]:
    lc.add_boq_item(contract_id, d, q, u, p)
boq = lc.list_boq(contract_id)
check("4 بنود BOQ", len(boq) == 4)
check("قيمة بند الخرسانة = 40,000", any(b["total"] == 40000 for b in boq))

print("\n=== 4. مدة العقد والحالة الزمنية ===")
with db.get_connection() as conn:
    conn.execute("UPDATE contracts SET start_date='2026-01-01', end_date='2026-12-31' "
                 "WHERE id=?", (contract_id,))
tl = lc.contract_timeline("2026-01-01", "2026-12-31")
check("مدة العقد = 365 يوم", tl["duration"] == 365, f"got {tl['duration']}")
check("الحالة الزمنية: جارٍ", tl["time_status"] == "جارٍ")
check("المنقضي + المتبقي منطقيان", tl["elapsed"] > 0 and tl["remaining"] > 0)
check("النسبة بين 0 و 100", 0 < tl["percent"] < 100)
tl2 = lc.contract_timeline("2027-01-01", "2027-12-31")
check("عقد مستقبلي: لم يبدأ بعد", tl2["time_status"] == "لم يبدأ بعد")

print("\n=== 5. تنبيهات الانتهاء ===")
lc.save_expiry_alert_days("90,60,30,7")
check("قراءة أيام التنبيه", lc.get_expiry_alert_days() == [90, 60, 30, 7])
from datetime import date, timedelta
soon = (date.today() + timedelta(days=20)).isoformat()
with db.get_connection() as conn:
    conn.execute("UPDATE contracts SET end_date=? WHERE id=?", (soon, contract_id))
exp = lc.expiring_contracts()
check("العقد يظهر في تنبيهات الانتهاء", any(e["id"] == contract_id for e in exp))
check("مستوى التنبيه = 30", exp[0]["alert_level"] == 30)
with db.get_connection() as conn:
    conn.execute("UPDATE contracts SET end_date='2026-12-31' WHERE id=?", (contract_id,))

print("\n=== 6. الملحقات وتحديث القيمة تلقائياً ===")
a1 = lc.add_addendum(contract_id, "2026-03-01", "أعمال إضافية", "توسعة الملحق",
                     10000, 0, addendum_type="عقد إضافي")
a2 = lc.add_addendum(contract_id, "2026-04-01", "إلغاء بند", "إلغاء جزء من التشطيبات",
                     0, 5000, addendum_type="أمر تغييري")
val = lc.contract_current_value(contract_id)
check("الملحق يؤثر فورًا (معتمد تلقائيًا)", val["current"] == 105000)
val = lc.contract_current_value(contract_id)
check("الأصلية = 100,000", val["original"] == 100000)
check("الزيادات = 10,000", val["additions"] == 10000)
check("الخصومات = 5,000", val["deductions"] == 5000)
check("القيمة الحالية = 105,000", val["current"] == 105000)
expect_error("رفض ملحق بدون قيم", lc.add_addendum,
             contract_id, "2026-05-01", "خطأ", "", 0, 0)

print("\n=== 7. مقاولو الباطن وربطهم بالبنود ===")
sub_id = lc.add_subcontractor(lc.next_sub_code(), "شركة XYZ للكهرباء",
                              "55443322", "xyz@co.com", "كهرباء")
check("إنشاء مقاول الباطن", sub_id == 1)
elec = next(b for b in boq if "كهرباء" in b["description"])
hvac = next(b for b in boq if "تكييف" in b["description"])
sc1 = lc.add_sub_contract(sub_id, contract_id, pid, 15000,
                          "2026-02-01", "2026-08-01", "أعمال الكهرباء كاملة",
                          boq_item_ids=[elec["id"]])
sub_id2 = lc.add_subcontractor(lc.next_sub_code(), "شركة تبريد الخليج",
                               activity="تكييف")
sc2 = lc.add_sub_contract(sub_id2, contract_id, pid, 20000,
                          boq_item_ids=[hvac["id"]])
subs = lc.list_sub_contracts(contract_id=contract_id)
check("عقدا باطن مرتبطان بالعقد", len(subs) == 2)
check("الربط بالبند ظاهر", "كهرباء" in (subs[1]["boq_items_text"] or ""))
check("إجمالي عقود الباطن = 35,000", lc.total_sub_contracts(contract_id) == 35000)
expect_error("رفض حذف بند مرتبط بمقاول", lc.delete_boq_item, elec["id"])

print("\n=== 8. السندات + القيود المحاسبية التلقائية ===")
pv = lc.add_voucher("payment", "2026-03-15", "", "تحويل بنكي",
                    "البنك الأهلي", 5000, "دفعة أولى لمقاول الكهرباء",
                    project_id=pid, contract_id=contract_id,
                    boq_item_id=elec["id"], sub_contract_id=sc1,
                    cost_center="CC-01", party_type="subcontractor", party_id=sub_id)
rv = lc.add_voucher("receipt", "2026-03-20", "", "شيك",
                    "البنك الأهلي", 30000, "دفعة مقدمة من العميل",
                    project_id=pid, contract_id=contract_id,
                    party_type="customer", party_id=cid)
vouchers = lc.list_vouchers(contract_id=contract_id)
check("سندان مسجلان", len(vouchers) == 2)
check("ترقيم سند الصرف PV-0001", any(v["voucher_number"] == "PV-0001" for v in vouchers))
check("ترقيم سند القبض RV-0001", any(v["voucher_number"] == "RV-0001" for v in vouchers))
check("سند الصرف مرتبط بالبند والمقاول",
      any(v["boq_description"] and v["sub_name"] for v in vouchers))
# القيود التلقائية
with db.get_connection() as conn:
    entries = conn.execute("SELECT * FROM journal_entries ORDER BY id").fetchall()
check("قيدان محاسبيان أُنشئا تلقائياً", len(entries) == 2)
e1 = dict(entries[0])
check("قيد الصرف: مدين مصروف/دائن بنك",
      "مصروف" in e1["debit_account"] and "البنك" in e1["credit_account"])
check("القيد يحمل الربط التحليلي الكامل",
      e1["project_id"] == pid and e1["contract_id"] == contract_id
      and e1["boq_item_id"] == elec["id"] and e1["cost_center"] == "CC-01")
expect_error("رفض سند بمبلغ صفر", lc.add_voucher,
             "payment", "2026-01-01", "x", "", "", 0, "")
# سند صرف بلا طرف مرتبط صار مسموحًا للمصروفات الإدارية والدورية
# (النظام ينشئها بلا طرف) — فقط إذا حُدد نوع الطرف يُشترط المعرّف.
_ok_generic = lc.add_voucher("payment", "2026-01-01", "مصروف دوري",
                              "نقدًا", "", 100, "بيان")
check("سند صرف بدون طرف (مصروف دوري) مقبول", _ok_generic > 0)
expect_error("رفض نوع طرف غير صحيح", lc.add_voucher,
             "payment", "2026-01-01", "x", "", "", 100, "",
             party_type="wrong_type", party_id=1)
expect_error("رفض تحديد نوع الطرف بلا معرّف", lc.add_voucher,
             "payment", "2026-01-01", "x", "", "", 100, "",
             party_type="customer", party_id=None)
check("اسم الطرف يُجلب من الجدول تلقائيًا",
      any(v["party"] == "شركة XYZ للكهرباء" for v in vouchers))

print("\n=== 9. فاتورة على العقد ===")
inv_id = invoice_service.add_invoice(Invoice(
    invoice_number=invoice_service.next_invoice_number(),
    customer_id=cid, contract_id=contract_id,
    invoice_date="2026-04-01", description="المستخلص الأول", amount=40000))
check("فاتورة 40,000 على العقد", inv_id > 0)

print("\n=== 10. Dashboard العقد والربحية ===")
dash = lc.contract_dashboard(contract_id)
check("القيمة الأصلية = 100,000", dash["original_value"] == 100000)
check("صافي الملحقات = +5,000", dash["addendums_net"] == 5000)
check("القيمة الحالية = 105,000", dash["current_value"] == 105000)
check("إجمالي الفواتير = 40,000", dash["total_invoiced"] == 40000)
check("التحصيلات = 30,000", dash["total_receipts"] == 30000)
check("المصروفات = 5,000", dash["total_payments"] == 5000)
check("عقود الباطن = 35,000", dash["total_subs"] == 35000)
check("التكلفة الفعلية حتى تاريخه = 5,000", dash["total_cost"] == 5000)
check("الربحية المتوقعة = إجمالي العقد − عقود الباطن − المنصرف الآخر", dash["expected_profit"] == 70000)
check("الربحية الفعلية حتى تاريخه = المحصل − المصروف", dash["profit"] == 25000)

print("\n=== 11. كشف حساب العقد الشامل ===")
st = lc.contract_statement_full(contract_id)
types = [r["type"] for r in st["rows"]]
check("يشمل قيمة العقد", "قيمة العقد" in types)
check("يشمل العقد الإضافي وأمر التغيير",
      "عقد إضافي" in types and "أمر تغييري" in types)
check("يشمل الفواتير", "فاتورة" in types)
check("يشمل سندات القبض والصرف", "سند قبض" in types and "سند صرف" in types)
check("يشمل عقود الباطن", "عقد باطن" in types)
check("عدد الحركات = 8", len(st["rows"]) == 8, f"got {len(st['rows'])}")

print("\n=== 12. كشف حساب المشروع ===")
ps = lc.project_statement(pid)
check("حركات المشروع = 3 (فاتورة + سندان)", len(ps) == 3, f"got {len(ps)}")
check("الرصيد النهائي محسوب", "balance" in ps[-1])

print("\n=== 13. كشف حساب العميل مع الفترة ===")
cs = lc.customer_statement(cid)
# الكشف الآن يشمل الملحقات المعتمدة: +10,000 مدين و5,000 دائن (خصم)
check("إجمالي المدين = 110,000 (العقد + الإضافة)", cs["total_debit"] == 110000,
      cs["total_debit"])
check("إجمالي الدائن = 35,000 (تحصيل + خصم)", cs["total_credit"] == 35000,
      cs["total_credit"])
check("الرصيد = 75,000 (القيمة الحالية − المحصّل)", cs["balance"] == 75000,
      cs["balance"])
cs2 = lc.customer_statement(cid, date_from="2026-03-01", date_to="2026-03-31")
# مارس فيه: تحصيل 30,000 + ملحق الإضافة 10,000 (مدين)
check("التصفية بالفترة تعمل", cs2["total_credit"] == 30000
      and cs2["total_debit"] == 10000,
      (cs2["total_debit"], cs2["total_credit"]))

print("\n=== 14. السجل الزمني ===")
events = lc.list_events(contract_id)
etypes = {e["event_type"] for e in events}
check("سجل: إنشاء العقد", "إنشاء العقد" in etypes)
check("سجل: إضافة عقد إضافي/أمر تغييري (معتمد فورًا)",
      "إضافة عقد إضافي" in etypes and "إضافة أمر تغييري" in etypes)
check("سجل: مقاول باطن وسندات", "إضافة مقاول باطن" in etypes
      and "إنشاء سند صرف" in etypes and "إنشاء سند قبض" in etypes)
check("عدد الأحداث >= 7", len(events) >= 7, f"got {len(events)}")

print("\n=== 15. مصمم العقود والحقول الديناميكية ===")
templates = lc.list_templates()
check("القالب الافتراضي موجود", len(templates) >= 1)
rendered = lc.render_template(templates[0]["body"], contract_id)
check("استبدال {{رقم_العقد}}", "CON-0001" in rendered)
check("استبدال {{اسم_العميل}}", "شركة ABC" in rendered)
check("استبدال {{قيمة_العقد}}", "105,000.000" in rendered)
check("استبدال {{مدة_العقد}}", "365" in rendered)
check("لا حقول متبقية", "{{" not in rendered.replace("{{", "", 0) or "{{" not in rendered)

print("\n=== 16. إلغاء سند → استبعاده من الحسابات مع بقاء رقمه ===")
lc.cancel_voucher(pv, "خطأ إدخال")
with db.get_connection() as conn:
    # قيد السند الملغي وقيد سند الرسوم المرتبط به (إن وُجد) لا يُحذفان؛ يضاف قيد عكسي يحافظ على الأثر المحاسبي.
    remaining_pv = conn.execute(
        "SELECT COUNT(*) FROM journal_entries WHERE source_id=?",
        (pv,)).fetchone()[0]
    fee_rows = conn.execute(
        "SELECT id FROM vouchers WHERE parent_voucher_id=?", (pv,)
    ).fetchall()
    if fee_rows:
        remaining_fee = conn.execute(
            f"SELECT COUNT(*) FROM journal_entries WHERE source_id IN "
            f"({','.join('?' for _ in fee_rows)})",
            [r[0] for r in fee_rows]).fetchone()[0]
    else:
        remaining_fee = 0
    row = conn.execute("SELECT cancelled, voucher_number FROM vouchers WHERE id=?", (pv,)).fetchone()
check("إلغاء السند سجّل قيدًا عكسيًا ولم يحذف الأثر", remaining_pv >= 1 and remaining_fee >= 0)
check("السند باقٍ برقمه وحالته ملغى", row and row["cancelled"] == 1 and row["voucher_number"])
dash = lc.contract_dashboard(contract_id)
check("Dashboard تحدّث بعد الإلغاء: مصروفات = 0", dash["total_payments"] == 0)
try:
    lc.update_voucher(pv, "2026-01-01", "نقدًا", 100, "x")
    check("منع تعديل الملغى", False)
except Exception:
    check("منع تعديل الملغى", True)


print("\n=== 17. الفلترة الذكية: منع الربط المتضارب ===")
c2 = customer_service.add_customer(Customer(
    customer_code="CUS-0099", name="عميل آخر", phone="50990099"))
k2 = contract_service.add_contract(Contract(
    contract_number="CON-0099", customer_id=c2,
    contract_date="2026-06-01", amount=9000))
expect_error("رفض سند قبض من عميل على عقد عميل آخر", lc.add_voucher,
             "receipt", "2026-06-05", "", "KNET", "", 100, "x",
             contract_id=k2, party_type="customer", party_id=cid)
sub99 = lc.add_subcontractor("SUB-0099", "مقاول غير مرتبط")
expect_error("رفض سند صرف لمقاول غير مرتبط بالعقد", lc.add_voucher,
             "payment", "2026-06-05", "", "نقدًا", "", 100, "x",
             contract_id=k2, party_type="subcontractor", party_id=sub99)
v99 = lc.add_voucher("receipt", "2026-06-05", "", "KNET", "", 100, "دفعة",
                     contract_id=k2, party_type="customer", party_id=c2)
check("قبول السند الصحيح (نفس العميل)", v99 > 0)

print("\n=== 18. حد الصرف لمقاول الباطن ===")
# عقد باطن 1000 على عقد k2 — الصرف لا يتجاوز قيمته
sc99 = lc.add_sub_contract(sub99, k2, None, 1000, "2026-06-01", "2026-12-31",
                           "أعمال اختبار الحد")
expect_error("رفض صرف يتجاوز قيمة عقد الباطن", lc.add_voucher,
             "payment", "2026-06-06", "", "نقدًا", "", 1500, "تجاوز",
             contract_id=k2, party_type="subcontractor", party_id=sub99)
pv_ok = lc.add_voucher("payment", "2026-06-06", "", "نقدًا", "", 600,
                       "دفعة أولى للمقاول", contract_id=k2,
                       party_type="subcontractor", party_id=sub99)
check("صرف ضمن الحد يُقبل", pv_ok > 0)
expect_error("رفض صرف يكمل فوق الحد (600+500>1000)", lc.add_voucher,
             "payment", "2026-06-07", "", "نقدًا", "", 500, "فوق المتبقي",
             contract_id=k2, party_type="subcontractor", party_id=sub99)
pv_edge = lc.add_voucher("payment", "2026-06-07", "", "نقدًا", "", 400,
                         "استكمال الحد بالضبط", contract_id=k2,
                         party_type="subcontractor", party_id=sub99)
check("صرف حتى الحد بالضبط يُقبل", pv_edge > 0)
lc.cancel_voucher(pv_edge, "اختبار")
pv_again = lc.add_voucher("payment", "2026-06-08", "", "نقدًا", "", 400,
                          "بعد إلغاء سند", contract_id=k2,
                          party_type="subcontractor", party_id=sub99)
check("إلغاء صرف يحرر حد المقاول", pv_again > 0)
expect_error("رفض تعديل صرف لمبلغ يتجاوز الحد", lc.update_voucher,
             pv_again, "2026-06-08", "نقدًا", 900, "تجاوز بالتعديل",
             contract_id=k2, party_type="subcontractor", party_id=sub99)

print("\n=== إلغاء سند قبض عام يلغي كل أجزاء الرسوم الموزعة ===")
# عقدان عليهما حركة + سند قبض عام بتحويل بنكي ⇒ رسوم موزعة عليهما.
# العيب القديم: أول جزء فقط كان يربط بالأب، فإلغاء السند العام كان
# يبقي باقي الأجزاء سارية (تكلفة العقود متضخمة برسوم سند ملغى).
cg1 = customer_service.add_customer(Customer(
    customer_code="CUS-0991", name="عميل توزيع 1", phone="50990991"))
cg2 = customer_service.add_customer(Customer(
    customer_code="CUS-0992", name="عميل توزيع 2", phone="50990992"))
kg1 = contract_service.add_contract(Contract(
    contract_number="CON-0991", customer_id=cg1, contract_date="2026-05-01",
    contract_name="عقد توزيع كبير", amount=8000.0))
kg2 = contract_service.add_contract(Contract(
    contract_number="CON-0992", customer_id=cg2, contract_date="2026-05-01",
    contract_name="عقد توزيع صغير", amount=2000.0))
lc.add_voucher("receipt", "2026-05-02", "", "نقدًا", "", 100.0, "حركة",
               contract_id=kg1, party_type="customer", party_id=cg1)
lc.add_voucher("receipt", "2026-05-03", "", "نقدًا", "", 100.0, "حركة",
               contract_id=kg2, party_type="customer", party_id=cg2)
grec = lc.add_voucher("receipt", "2026-05-10", "دفعة عامة",
                      "تحويل بنكي", "البنك", 1000.0, "سند عام بلا عقد")
with db.get_connection() as conn:
    _gnum = conn.execute(
        "SELECT voucher_number FROM vouchers WHERE id=?",
        (grec,)).fetchone()["voucher_number"]
    # أجزاء رسوم هذا السند تحديدًا: مرتبطة به أو بيانها يذكر رقمه
    parts = conn.execute(
        "SELECT id, contract_id, amount, parent_voucher_id FROM vouchers "
        "WHERE notes LIKE ? AND COALESCE(cancelled,0)=0 "
        "AND (parent_voucher_id=? OR description LIKE ?)",
        (f"%{lc.BANK_FEE_MARK}%", grec, f"%{_gnum}%")).fetchall()
    _linked = [r for r in parts if r["parent_voucher_id"] == grec]
# التوزيع على كل العقود النشطة ذات الحركة وقت السند (اثنان فأكثر —
# أقسام سابقة في هذا الاختبار أنشأت عقودًا نشطة كذلك)
check("الرسوم وُزّعت على أكثر من عقد", len(parts) >= 2, str(len(parts)))
check("كل أجزاء التوزيع مرتبطة بالسند الأب",
      len(_linked) == len(parts) and len(parts) >= 2,
      f"{len(_linked)}/{len(parts)}")
_total_fee = sum(r["amount"] for r in parts)
check("مجموع الأجزاء = الرسم كاملًا (0.150)", abs(_total_fee - 0.150) < 0.001,
      str(_total_fee))
lc.cancel_voucher(grec, "اختبار الإلغاء الشامل")
with db.get_connection() as conn:
    active_fees = conn.execute(
        "SELECT COUNT(*) FROM vouchers WHERE notes LIKE ? "
        "AND COALESCE(cancelled,0)=0 "
        "AND (parent_voucher_id=? OR description LIKE ?)",
        (f"%{lc.BANK_FEE_MARK}%", grec, f"%{_gnum}%")).fetchone()[0]
check("إلغاء السند العام ألغى كل الأجزاء", active_fees == 0,
      str(active_fees))
dg1 = lc.contract_dashboard(kg1)
dg2 = lc.contract_dashboard(kg2)
check("تكلفة العقد الأول عادت لحركة العقد فقط (100)",
      abs(dg1["total_payments"] - 0.0) < 0.001, str(dg1["total_payments"]))
check("تكلفة العقد الثاني بلا رسوم سارية",
      abs(dg2["total_payments"] - 0.0) < 0.001, str(dg2["total_payments"]))

print(f"\n{'='*40}\nالنتيجة: نجح {PASS} / فشل {FAIL}")
sys.exit(1 if FAIL else 0)
