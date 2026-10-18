# -*- coding: utf-8 -*-
"""V5.5 — حذف مقاول الباطن يحذف عقوده وسنداته معه.

سبب التعديل (تجربة V5.4 الميدانية): الحذف كان يترك العقود والسندات
وراءه — لأن عدّاد السندات كان يتجاهل **الملغاة**، فيمرّ الحذف بلا خيار
السندات وتبقى معلّقة بلا مالك.

يغطّي هذا الاختبار:
  * العدّاد يشمل كل السندات (فعّالة + ملغاة) والتفصيل يظهر في المعاينة.
  * بلا الخيار: يُرفض الحذف برسالة واضحة (عقود/سندات).
  * مع الخيار: لا تبقى أي بقايا — لا مقاول ولا عقود باطن ولا بنود ولا
    خطة ولا مصادر ولا مطالبات ولا سندات (حتى الملغاة).
  * **بنود عقد العميل نفسها لا تُحذف** — يُفكّ ارتباطها فقط.
  * الشاشة: الخيار **مفعّل افتراضيًا** للمقاول، وتفصيل المعاينة صحيح،
    والفتح من شاشة المقاولين يحدد السجل مسبقًا (ودخول للمطور فقط).
  * حذف عقد باطن واحد (المسار الآخر) ينظّف مراجع أوامر التغييري.
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
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import purge_service as pg  # noqa: E402
from services import addendum_service as adx  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

from PySide6.QtWidgets import QApplication, QMessageBox  # noqa: E402

app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True
QMessageBox.exec = lambda self: 0
QMessageBox.clickedButton = lambda self: None

from ui.purge_tool import PurgeDialog  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def add_voucher(num, sub_id, kid, sc_id, amount, cancelled=0):
    with db.get_connection() as conn:
        conn.execute(
            "INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
            "party_type, party_id, amount, contract_id, sub_contract_id, "
            "cancelled) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (num, "payment", "2026-03-01", "مقاول", "subcontractor", sub_id,
             amount, kid, sc_id, cancelled))


def count(sql, *params):
    with db.get_connection() as conn:
        return int(conn.execute(sql, params).fetchone()[0])


# ============================================================
print("=== V5.5.1 البذرة: مقاول بعقد + بنود + خطة + سندات (فعّالة وملغاة) ===")
cust = cs.add_customer(Customer(customer_code="C-1", name="عميل", phone="90000031"))
kid = ks.add_contract(
    Contract(contract_number="M-1", customer_id=cust, contract_date="2026-01-01",
             contract_type="", description="", amount=10000.0), manual_path=True)
b1 = lc.add_boq_item(kid, "بنية", 100, "م3", 40)
b2 = lc.add_boq_item(kid, "تشطيب", 50, "م2", 20)
sub = lc.add_subcontractor("SUB-1", "مقاول أول", "95555031")
sc = lc.add_sub_contract(sub, kid, None, 5000.0, boq_item_ids=[b1, b2])
with db.get_connection() as conn:
    lid = conn.execute(
        "INSERT INTO sub_payment_plan (sub_contract_id, title, due_date, "
        "amount, sort_order, triggered_at) VALUES (?,?,?,?,?,?)",
        (sc, "1. دفعة 1", "2026-02-01", 1000.0, 1,
         "2026-02-01 00:00:00")).lastrowid
    _cust_line = conn.execute(
        "INSERT INTO payment_plan (contract_id, title, due_date, amount, "
        "sort_order) VALUES (?,?,?,?,?)",
        (kid, "1. دفعة 1", "2026-02-01", 1000.0, 1)).lastrowid
    conn.execute("INSERT INTO sub_payment_sources (sub_line_id, cust_line_id)"
                 " VALUES (?, ?)", (lid, _cust_line))
add_voucher("PV-1", sub, kid, sc, 1000.0, 0)      # فعّال
add_voucher("PV-2", sub, kid, sc, 500.0, 1)       # ملغى
add_voucher("PV-3", sub, kid, None, 300.0, 1)     # ملغى بلا عقد باطن
aid = lc.add_addendum(kid, "2026-10-06", "حذف بند", "", 0.0, 0.0,
                      side="sub", sub_contract_id=sc, allow_zero=True)
adx.add_delete_part(aid, "sub", boq_item_id=b1, sub_contract_id=sc)
check("البذرة: 3 سندات (1 فعّال · 2 ملغى) مرتبطة بالمقاول",
      count("SELECT COUNT(*) FROM vouchers WHERE party_id=? AND "
            "party_type='subcontractor'", sub) == 3)
check("البذرة: مصدر دفعة مرتبط بخطة العميل",
      count("SELECT COUNT(*) FROM sub_payment_sources WHERE sub_line_id=?",
            lid) == 1)

# ============================================================
print("=== V5.5.2 المعاينة تُظهر كل السندات (بما فيها الملغاة) ===")
pv = pg.preview_subcontractor(sub)
check("المعاينة تعدّ العقود والبنود والخطة",
      pv["children"].get("sub_contracts") == 1
      and pv["children"].get("sub_contract_items") == 2
      and pv["children"].get("sub_payment_plan") == 1,
      pv["children"])
check("المعاينة تعدّ السندات كلها: 3",
      pv["children"].get("vouchers") == 3, pv["children"].get("vouchers"))
check("المعاينة تفصل الفعّال عن الملغى (1 · 2)",
      pv.get("vouchers_active") == 1 and pv.get("vouchers_cancelled") == 2,
      (pv.get("vouchers_active"), pv.get("vouchers_cancelled")))

# ============================================================
print("=== V5.5.3 بلا خيار: يُرفض — وسبب الرفض لا يترك شيئًا ===")
try:
    pg.purge_subcontractor(sub, "تجربة بلا خيار")
    refused, msg = False, "بلا رفض!"
except ValidationError as exc:
    refused, msg = True, str(exc)
check("رُفض الحذف وشُرح السبب", refused and ("عقد باطن" in msg),
      msg.replace("\n", " | "))
check("المقاول ما زال موجودًا",
      count("SELECT COUNT(*) FROM subcontractors WHERE id=?", sub) == 1)
check("السندات ما زالت كما هي",
      count("SELECT COUNT(*) FROM vouchers WHERE party_id=?", sub) == 3)
try:
    pg.purge_subcontractor(sub, "   ", delete_contracts=True,
                           delete_vouchers=True)
    m2 = "بلا رفض!"
except ValidationError as exc:
    m2 = str(exc)
check("السبب إلزامي", "سبب" in m2, m2)

# ============================================================
print("=== V5.5.4 برفض مقاول غير مطوّر (حماية الخدمة لا الواجهة) ===")
auth_service._current["role"] = "admin"
try:
    pg.purge_subcontractor(sub, "محاولة")
    m3 = "بلا رفض!"
except ValidationError as exc:
    m3 = str(exc)
check("غير المطوّر لا يستطيع الحذف", "مطور" in m3 or "رفض" in m3, m3)
auth_service._current["role"] = auth_service.ROLE_DEVELOPER

# ============================================================
print("=== V5.5.5 مع الخيار: حذف المقاول وعقوده وسنداته — بلا بقايا ===")
res = pg.purge_subcontractor(sub, "تنظيف تجريبي",
                            delete_contracts=True, delete_vouchers=True)
check("النتيجة تُبلّغ: 1 عقد · 3 سندات (منها 2 ملغى)",
      res["contracts"] == 1 and res["vouchers"] == 3
      and res["vouchers_cancelled"] == 2,
      res)
check("لا مقاول", count("SELECT COUNT(*) FROM subcontractors WHERE id=?",
                        sub) == 0)
check("لا عقود باطن",
      count("SELECT COUNT(*) FROM sub_contracts WHERE subcontractor_id=?",
            sub) == 0)
check("لا بنود ارتباط",
      count("SELECT COUNT(*) FROM sub_contract_items WHERE sub_contract_id=?",
            sc) == 0)
check("لا خطة دفعات",
      count("SELECT COUNT(*) FROM sub_payment_plan WHERE sub_contract_id=?",
            sc) == 0)
check("لا مصادر دفعات",
      count("SELECT COUNT(*) FROM sub_payment_sources WHERE sub_line_id=?",
            lid) == 0)
check("لا سندات — حتى الملغاة ولا سند بلا عقد باطن",
      count("SELECT COUNT(*) FROM vouchers WHERE (party_type='subcontractor' "
            "AND party_id=?) OR sub_contract_id=?", sub, sc) == 0)
check("لا مراجع معلّقة في بنود أوامر التغييري",
      count("SELECT COUNT(*) FROM addendum_items WHERE sub_contract_id=?",
            sc) == 0)
check("لا مراجع معلّقة في أوامر التغييري",
      count("SELECT COUNT(*) FROM addendums WHERE sub_contract_id=?",
            sc) == 0)
check("لا مطالبات معلّقة",
      count("SELECT COUNT(*) FROM claims WHERE sub_contract_id=?", sc) == 0)
check("بنود عقد العميل نفسها باقية (2)", lc.list_boq(kid) != []
      and count("SELECT COUNT(*) FROM boq_items WHERE contract_id=?",
                kid) == 2)
check("لم يبقَ أي سند على عقد العميل من سندات المقاول",
      count("SELECT COUNT(*) FROM vouchers WHERE contract_id=?", kid) == 0)
check("سجل التدقيق يحفظ اللقطة",
      count("SELECT COUNT(*) FROM purge_audit WHERE entity='subcontractor'")
      >= 1)

# ============================================================
print("=== V5.5.6 مقاول بلا حركة: الحذف بالاسم يعمل بلا خيارات ===")
sub0 = lc.add_subcontractor("SUB-9", "بلا حركة", "95555039")
res0 = pg.purge_subcontractor(sub0, "اسم مكرر")
check("حُذف بلا خيارات (لا عقود ولا سندات)",
      res0["contracts"] == 0 and res0["vouchers"] == 0
      and count("SELECT COUNT(*) FROM subcontractors WHERE id=?", sub0) == 0,
      res0)

# ============================================================
print("=== V5.5.7 الشاشة: الخيار مفعّل افتراضيًا ومعاينة تفصيلية ===")
sub2 = lc.add_subcontractor("SUB-2", "مقاول ثانٍ", "95555032")
lc.add_sub_contract(sub2, kid, None, 2000.0, boq_item_ids=[b2])
add_voucher("PV-8", sub2, kid, None, 400.0, 1)
d = PurgeDialog(None, "subcontractor")
# V5.8: خياران منفصلان بدل خيار واحد — كلاهما مفعّل افتراضيًا كمطلب V5.5
check("خيار عقود الباطن مفعّل افتراضيًا للمقاول",
      bool(d.cascade_c and d.cascade_c.isChecked()), )
check("خيار السندات مفعّل افتراضيًا للمقاول",
      bool(d.cascade_v and d.cascade_v.isChecked()))
check("نص الخيارين صريح",
      "افتراضيًا" in d.cascade_c.text() and "افتراضيًا" in d.cascade_v.text()
      and "عقود الباطن" in d.cascade_c.text()
      and "السندات" in d.cascade_v.text(),
      (d.cascade_c.text(), d.cascade_v.text()))
check("الخيار القديم الموحّد مخفي للمقاول", not d.cascade.isVisibleTo(d))
dc = PurgeDialog(None, "customer")
check("خيار العميل لم يتغيّر (سلوك سابق)", not dc.cascade.isChecked())
dp = PurgeDialog(None, "subcontractor", preset_id=sub2)
check("الفتح من شاشة المقاولين يحدد السجل مسبقًا",
      dp._selected_ids() == [sub2], dp._selected_ids())
txt = dp.preview_lbl.text()
check("المعاينة التفصيلية تذكر العقود والسندات",
      "عقد باطن" in txt and "سند" in txt and "ملغى" in txt, txt[:120])
check("المعاينة تطمئن أن بنود العقد لا تُحذف", "لا تُحذف" in txt)

# ============================================================
print("=== V5.5.8 حذف عقد باطن واحد (المسار الآخر) ينظّف مراجع الأوامر ===")
sub3 = lc.add_subcontractor("SUB-3", "مقاول ثالث", "95555033")
sc3 = lc.add_sub_contract(sub3, kid, None, 2000.0, boq_item_ids=[b2])
a3 = lc.add_addendum(kid, "2026-10-06", "حذف بند", "", 0.0, 0.0,
                     side="sub", sub_contract_id=sc3, allow_zero=True)
adx.add_delete_part(a3, "sub", boq_item_id=b2, sub_contract_id=sc3)
lc.delete_sub_contract(sc3)
check("حُذفت أسطر بنود الأمر المرتبطة بعقد الباطن",
      count("SELECT COUNT(*) FROM addendum_items WHERE sub_contract_id=?",
            sc3) == 0)
check("الأمر باقٍ في سجل العقد بلا ارتباط",
      count("SELECT COUNT(*) FROM addendums WHERE id=? AND "
            "sub_contract_id IS NULL", a3) == 1)

# ============================================================
print("=== V5.5.9 مدخل الحذف في شاشة المقاولين (للمطور فقط) ===")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "ui", "subcontractors.py"), encoding="utf-8").read()
# V5.8: المدخل صار «خيارات» (عقد · سند · السجل) بدل الحذف الكامل المباشر
check("قائمة المقاول فيها «حذف بيانات المقاول (عقود · سندات · السجل)»",
      "حذف بيانات المقاول" in src and "_delete_sub_data" in src)
check("المدخل يفتح شاشة الخيارات (وليست الحذف الكامل مباشرة)",
      "SubDeleteDialog" in src)
settings_src = open(os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "ui", "settings.py"), encoding="utf-8").read()
check("زر الإعدادات يوضّح العقود والسندات",
      "(مع عقوده وسنداته)" in settings_src)

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
