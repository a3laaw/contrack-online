# -*- coding: utf-8 -*-
"""V5.4 ④ — الأمر التغييري بجهتين (عميل / مقاول).

يغطّي:
  * «البنود المخفية/المتاحة» (بنود المظاريف التي لم تنزل في العقد + المحذوفة).
  * تابان: 👤 عميل (يؤثر على العقد والمالية مع المالك) ·
    🔨 مقاول (يؤثر على عقد الباطن وقيمته).
  * إضافة جزء يدويًا أو من المتاح، وحذف جزء بموافقة ✔.
  * البند المحذوف يُوسم «محذوف بأمر تغييري» ولا يُمحى، يُستثنى من المجاميع،
    ويعود كما كان عند إلغاء الأمر (مع ارتباطات عقد الباطن وقيمته).
  * الحمايات: لا خصم يجعل قيمة العقد أقل من المحصّل، ولا قيمة عقد باطن
    صفرًا/سالبة.
  * تاريخ افتراضي = اليوم (لا 1900-01-01).
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

from datetime import date  # noqa: E402

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import addendum_service as adx  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

from PySide6.QtWidgets import QApplication, QMessageBox  # noqa: E402
from PySide6.QtCore import Qt  # noqa: E402

app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True
QMessageBox.exec = lambda self: 0
QMessageBox.clickedButton = lambda self: None

from ui import addendum_dialog as ad  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def new_contract(num, phone, amount=10000.0):
    cust = cs.add_customer(Customer(customer_code=f"C-{num}", name=f"عميل {num}",
                                    phone=phone))
    return ks.add_contract(
        Contract(contract_number=num, customer_id=cust, contract_date="2026-01-01",
                 contract_type="", description="", amount=amount),
        manual_path=True), cust


def links(sc_id):
    with db.get_connection() as conn:
        return [int(r["boq_item_id"]) for r in conn.execute(
            "SELECT boq_item_id FROM sub_contract_items WHERE sub_contract_id=?",
            (sc_id,)).fetchall()]


# ============================================================
print("=== ④.1 البنود المخفية / المتاحة ===")
kid, cust = new_contract("M-1", "90000011")
b1 = lc.add_boq_item(kid, "بنية", 100, "م3", 40)     # 4000
b2 = lc.add_boq_item(kid, "تشطيب", 50, "م2", 20)     # 1000
with db.get_connection() as conn:
    q = conn.execute(
        "INSERT INTO quotations (quote_number, qdate, customer_id, status) "
        "VALUES ('Q-1','2025-12-01',?, 'مقبول')", (cust,)).lastrowid
    conn.execute("INSERT INTO quotation_items (quotation_id, description, qty, "
                 "unit, unit_price) VALUES (?,?,?,?,?)",
                 (q, "أعمال كهرباء", 10, "نقطة", 15))          # 150
    conn.execute("INSERT INTO quotation_items (quotation_id, description, qty, "
                 "unit, unit_price) VALUES (?,?,?,?,?)",
                 (q, "بنية", 100, "م3", 40))                    # نزلت في العقد

av = adx.available_items(kid, "client")
check("المتاح يعرض بند المظروف غير المنزل فقط",
      [x["description"] for x in av["quotation_items"]] == ["أعمال كهرباء"],
      [x["description"] for x in av["quotation_items"]])
check("قيمة البند المتاح محسوبة تلقائيًا",
      av["quotation_items"][0]["amount"] == 150.0,
      av["quotation_items"][0]["amount"])
check("المصدر يذكر عرض السعر",
      "Q-1" in av["quotation_items"][0]["source"],
      av["quotation_items"][0]["source"])

sub = lc.add_subcontractor("SUB-1", "مقاول أول", "95555011")
sub2 = lc.add_subcontractor("SUB-2", "مقاول ثانٍ", "95555012")
sc = lc.add_sub_contract(sub, kid, None, 5000.0, boq_item_ids=[b1])
sc2 = lc.add_sub_contract(sub2, kid, None, 2000.0, boq_item_ids=[b2])
avs = adx.available_items(kid, "sub", sc)
check("جهة المقاول: بند العميل غير المسنَد له متاح",
      [x["description"] for x in avs["contract_items"]] == ["تشطيب"],
      [x["description"] for x in avs["contract_items"]])
check("جهة المقاول: بنده الحالي معروض كـ«على عقد الباطن»",
      [x["description"] for x in avs["sub_items"]] == ["بنية"],
      [x["description"] for x in avs["sub_items"]])

# ============================================================
print("=== ④.2 الشاشة: تابان + تاريخ اليوم + الإجمالي التلقائي ===")
dlg = ad.ChangeOrderDialog(None, kid)
check("تابان: عميل / مقاول",
      [dlg.tabs.tabText(i) for i in range(dlg.tabs.count())]
      == ["👤 عميل", "🔨 مقاول"],
      [dlg.tabs.tabText(i) for i in range(dlg.tabs.count())])
check("التاريخ الافتراضي اليوم (لا 1900-01-01)",
      dlg.a_date.date().toString("yyyy-MM-dd") == date.today().isoformat(),
      dlg.a_date.date().toString("yyyy-MM-dd"))
dlg.m_qty.setValue(2)
dlg.m_price.setValue(123.5)
check("الإجمالي يُحسب تلقائيًا (كمية × سعر)",
      dlg.m_total.text() == "247.000", dlg.m_total.text())
check("جدول حذف العميل يعرض بنود العقد",
      dlg.del_table.rowCount() == 2,
      dlg.del_table.rowCount())
dlg.sub_combo.setCurrentIndex(dlg.sub_combo.findData(int(sub)))
dlg._sub_changed()
check("جدول حذف المقاول يعرض بنود عقد الباطن فقط",
      [dlg.sub_del_table.item(r, 1).text()
       for r in range(dlg.sub_del_table.rowCount())] == ["بنية"],
      [dlg.sub_del_table.item(r, 1).text()
       for r in range(dlg.sub_del_table.rowCount())])

# ============================================================
print("=== ④.3 الإضافة اليدوية ومن المتاح + الحذف ===")
dlg.a_reason.setText("تعديل تجريبي")
dlg.m_desc.setText("بند يدوي جديد")
dlg.m_qty.setValue(2)
dlg.m_price.setValue(100)
dlg._add_manual()
dlg.avail_table.item(0, 0).setCheckState(Qt.Checked)
dlg._add_selected_available()
for r in range(dlg.del_table.rowCount()):
    if dlg.del_table.item(r, 1).text() == "تشطيب":
        dlg.del_table.item(r, 0).setCheckState(Qt.Checked)
dlg._mark_delete()
dlg.tabs.setCurrentIndex(1)
for r in range(dlg.sub_del_table.rowCount()):
    if dlg.sub_del_table.item(r, 1).text() == "بنية":
        dlg.sub_del_table.item(r, 0).setCheckState(Qt.Checked)
dlg._mark_delete_sub()
t = adx.totals(dlg.addendum_id)
check("مجاميع جهة العميل صحيحة (إضافة 350 · خصم 1000)",
      (t["client"]["add"], t["client"]["deduct"]) == (350.0, 1000.0), t["client"])
check("مجاميع جهة المقاول صحيحة (خصم 4000)",
      (t["sub"]["add"], t["sub"]["deduct"]) == (0.0, 4000.0), t["sub"])
check("أجزاء الجهتين محفوظة تحت أمر واحد",
      len(adx.list_parts(dlg.addendum_id, "client")) == 3
      and len(adx.list_parts(dlg.addendum_id, "sub")) == 1)

# ============================================================
print("=== ④.4 الحماية: لا خصم يُنزل قيمة عقد الباطن ≤ 0 ===")
_notes = []
dlg.set_status = lambda m, bad=False: _notes.append((m, bad))
with db.get_connection() as conn:      # قيمة عقد الباطن 3000 < خصم 4000
    conn.execute("UPDATE sub_contracts SET amount=3000 WHERE id=?", (sc,))
dlg._save()
check("رُفض الحفظ برسالة واضحة عن قيمة عقد الباطن",
      bool(_notes) and "قيمة عقد الباطن" in _notes[-1][0], _notes[-1:])
check("لم يُطبَّق أي حذف (المحذوف موسم فقط)",
      [b["deleted"] for b in lc.list_boq(kid, include_deleted=True)]
      == [False, False],
      [b["deleted"] for b in lc.list_boq(kid, include_deleted=True)])
check("قيمة عقد العميل لم تتغيّر بعد الفشل",
      lc.contract_current_value(kid)["current"] == 10000.0,
      lc.contract_current_value(kid)["current"])

# ============================================================
print("=== ④.5 التنفيذ الكامل على الجهتين ===")
with db.get_connection() as conn:      # نرفع قيمة عقد الباطن لتسمح بالخصم
    conn.execute("UPDATE sub_contracts SET amount=6000 WHERE id=?", (sc,))
dlg._save()
check("تم الاعتماد والتنفيذ",
      "تم اعتماد" in _notes[-1][0], _notes[-1:])
check("البند اليدوي والمظروف دخلا العقد",
      [b["description"] for b in lc.list_boq(kid)]
      == ["بنية", "بند يدوي جديد", "أعمال كهرباء"],
      [b["description"] for b in lc.list_boq(kid)])
check("البند المحذوف موسوم لا مُمحى (ما زال في الجدول)",
      ("تشطيب", True) in [(b["description"], b["deleted"])
                          for b in lc.list_boq(kid, include_deleted=True)],
      [(b["description"], b["deleted"])
       for b in lc.list_boq(kid, include_deleted=True)])
check("قيمة العقد = 10000 + 350 − 1000",
      lc.contract_current_value(kid)["current"] == 9350.0,
      lc.contract_current_value(kid)["current"])
check("بند المقاول أُزيل من عقد الباطن وقيمته نقصت 4000",
      links(sc) == [] and lc.get_sub_contract(sc)["amount"] == 2000.0,
      (links(sc), lc.get_sub_contract(sc)["amount"]))
check("ارتباط البند المحذوف بالعميل انفك أيضًا (تشطيب من عقد الباطن 2)",
      links(sc2) == [], links(sc2))
row = lc.list_addendums(kid)[0]
check("صف الأمر: الجهة + عدد البنود + وسم التنفيذ",
      row["items_count"] == 4 and bool(row["applied_at"])
      and row["client_parts"] == 3 and row["sub_parts"] == 1,
      (row["items_count"], row["applied_at"], row["client_parts"],
       row["sub_parts"]))

# ============================================================
print("=== ④.6 الإلغاء: كل شيء يعود كما كان ===")
lc.cancel_addendum(row["id"], "العميل تراجع")
check("البند المحذوف رجع لبنود العقد",
      [b["description"] for b in lc.list_boq(kid)]
      == ["بنية", "تشطيب"], [b["description"] for b in lc.list_boq(kid)])
check("البنود المضافة بأمر تغييري أُزيلت (بلا بقايا)",
      "بند يدوي جديد" not in [b["description"] for b in lc.list_boq(kid)],
      [b["description"] for b in lc.list_boq(kid, include_deleted=True)])
check("ارتباط عقد الباطن الأول رجع",
      links(sc) == [int(b1)], links(sc))
check("ارتباط عقد الباطن الثاني رجع",
      links(sc2) == [int(b2)], links(sc2))
check("قيمة عقد الباطن رجعت 6000",
      lc.get_sub_contract(sc)["amount"] == 6000.0,
      lc.get_sub_contract(sc)["amount"])
after = lc.list_addendums(kid)[0]
check("قيم الأمر التغييري الملغى صُفّرت",
      after["amount_add"] == 0 and after["amount_deduct"] == 0
      and not after["applied_at"],
      (after["amount_add"], after["amount_deduct"], after["applied_at"]))
check("قيمة العقد رجعت للأصل",
      lc.contract_current_value(kid)["current"] == 10000.0,
      lc.contract_current_value(kid)["current"])
check("حالة الأمر «ملغى»",
      after["status"] == "ملغى", after["status"])

# ============================================================
print("=== ④.7 حماية: خصم عميل يجعل القيمة أقل من المحصّل ===")
kid2, cust2 = new_contract("M-2", "90000012", amount=1000.0)
bx = lc.add_boq_item(kid2, "بند كبير", 10, "وحدة", 100)   # 1000
with db.get_connection() as conn:
    conn.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
                 "amount, contract_id, cancelled) VALUES "
                 "('RV-1','receipt','2026-02-01','عميل',900,?,0)", (kid2,))
a2 = lc.add_addendum(kid2, "2026-10-06", "خصم", "", 0.0, 0.0,
                     allow_zero=True)
adx.add_delete_part(a2, "client", boq_item_id=bx)
try:
    lc.approve_addendum(a2)
    blocked = False
    err = ""
except ValidationError as exc:
    blocked, err = True, str(exc)
check("رُفض الخصم لأن القيمة ستصبح أقل من المحصّل",
      blocked and "المحصّل" in err, err)
check("البند لم يُوسم محذوفًا بعد الرفض",
      lc.list_boq(kid2)[0]["deleted"] is False, lc.list_boq(kid2, True)[0])
check("قيمة العقد سليمة",
      lc.contract_current_value(kid2)["current"] == 1000.0,
      lc.contract_current_value(kid2)["current"])

# ============================================================
print("=== ④.8 التحقق من المدخلات + المسار القديم ===")
def expect_error(fn, needle):
    try:
        fn()
        return False, "بلا خطأ"
    except ValidationError as exc:
        return (needle in str(exc)), str(exc)


ok, msg = expect_error(
    lambda: adx.add_part(a2, "client", "", 5, "م", 10), "وصف البند")
check("الوصف مطلوب في البند اليدوي", ok, msg)
ok, msg = expect_error(
    lambda: adx.add_part(a2, "client", "بند", 0, "م", 10), "كمية")
check("الكمية يجب أن تكون أكبر من صفر", ok, msg)
ok, msg = expect_error(
    lambda: adx.add_part(a2, "client", "بند", 1, "م", -5), "سعر الوحدة")
check("سعر الوحدة لا يكون سالبًا", ok, msg)
adx.add_part(a2, "client", "", 1, "وحدة", 100, boq_item_id=bx)
ok, msg = expect_error(
    lambda: adx.add_part(a2, "client", "", 1, "وحدة", 100, boq_item_id=bx),
    "بالفعل")
check("لا تكرار لنفس البند في الأمر", ok, msg)
for _p in adx.list_parts(a2, "client"):
    if _p["action"] == "add":
        adx.remove_part(_p["id"])      # ننظّف ليظل الاختبار التالي نظيفًا
ok, msg = expect_error(
    lambda: adx.add_delete_part(a2, "client", boq_item_id=bx), "")
check("لا حذف لنفس البند مرتين", ok, msg)

# المسار القديم (مبلغ فقط بلا بنود) لم يتغيّر
legacy = lc.add_addendum(kid2, "2026-10-06", "عقد إضافي", "", 500.0, 0.0,
                         addendum_type="عقد إضافي")
check("المسار القديم: عقد إضافي بمبلغ فقط يعمل",
      lc.list_addendums(kid2)[-1]["amount_add"] == 500.0
      and int(lc.list_addendums(kid2)[-1]["items_count"] or 0) == 0,
      lc.list_addendums(kid2)[-1])
check("بلا بنود: لا شيء يُنفَّذ inline (سلوك سابق كما هو)",
      adx.apply_parts(legacy) == {"already": False, "items": 0},
      adx.apply_parts(legacy))
ok, msg = expect_error(
    lambda: lc.add_addendum(kid2, "2026-10-06", "بلا مبلغ", "", 0.0, 0.0),
    "قيمة مضافة")
check("المسار القديم ما زال يطلب مبلغًا (لم تُرخَ الحماية)", ok, msg)

# ============================================================
print("=== ④.9 مركز العقد: عمودا الجهة/البنود ===")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "ui", "contract_hub.py"), encoding="utf-8").read()
check("جدول الملحقات يعرض «الجهة» و«بنود» و«مُنفَّذ»",
      '"الجهة"' in src and '"بنود"' in src and '"مُنفَّذ"' in src)
check("زر الأمر التغييري يفتح الشاشة الجديدة",
      "open_change_order" in src and "def _add_addendum_quick" in src)
sub_src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "ui", "subcontractors.py"), encoding="utf-8").read()
check("قائمة المقاول فيها 📎 أمر تغييري على عقد الباطن",
      "📎 أمر تغييري على عقد الباطن" in sub_src)

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
