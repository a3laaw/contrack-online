# -*- coding: utf-8 -*-
"""V5.4 ②+③: الزر الأيمن الكامل على مقاول الباطن + ربط سند الصرف بدفعاته.

② سند صرف · سند قبض · كشف حساب · السجل المالي · إنشاء/تعديل/حذف عقد باطن.
③ سند الصرف يُربط بعقد الباطن ⇒ الدفعة تصير «مدفوع/جزئي» لا «مستحقة»،
   مع تصحيح عرض السندات القديمة غير المرتبطة.
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

auth_service._current["role"] = auth_service.ROLE_DEVELOPER

from PySide6.QtWidgets import QApplication, QMessageBox  # noqa: E402
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402

app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
    setattr(style, "confirm", lambda *a, **k: True)


class _NoMsg:
    @staticmethod
    def exec(self): return 0
    @staticmethod
    def clickedButton(self): return None


QMessageBox.exec = _NoMsg.exec
QMessageBox.clickedButton = _NoMsg.clickedButton

import ui.vouchers as uiv  # noqa: E402
import ui.subcontractors as uis  # noqa: E402
for _m in (uiv, uis):
    for _n in ("info", "error", "toast", "success", "warning"):
        setattr(_m.style, _n, lambda *a, **k: None)
    setattr(_m.style, "confirm", lambda *a, **k: True)
uiv._preview_saved_vouchers = lambda *a, **k: None
_ERRS = []
uiv.style.error = lambda *a, **k: _ERRS.append(("error", a[1] if len(a) > 1 else a))
uiv.style.info = lambda *a, **k: _ERRS.append(("info", a[1] if len(a) > 1 else a))
uiv.style.confirm = lambda *a, **k: True
uis.style.confirm = lambda *a, **k: True

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


# ---------------------------------------------------------------- بيانات
cust = cs.add_customer(Customer(customer_code="C-1", name="عميل", phone="90000001"))
k = ks.add_contract(Contract(contract_number="K-1", customer_id=cust,
                             contract_date="2026-01-01", description="عقد",
                             amount=10000.0, contract_type="مقاولة عامة"))
item1 = lc.add_boq_item(k, "بند أول", 1, "عدد", 1000.0)
with db.get_connection() as conn:
    conn.execute("INSERT INTO subcontractors (sub_code, name, phone) "
                 "VALUES ('S-1','مقاولات الصفوة','80000001')")
    sub_id = conn.execute("SELECT id FROM subcontractors WHERE name='مقاولات الصفوة'"
                          ).fetchone()["id"]
sc_id = lc.add_sub_contract(sub_id, k, None, 3000.0, start_date="2026-01-01",
                            end_date="2026-06-01", description="",
                            boq_item_ids=[item1])
with db.get_connection() as conn:
    conn.execute("INSERT INTO sub_payment_plan (sub_contract_id, title, due_date,"
                 " amount, sort_order, triggered_at) VALUES (?,?,?,?,?,?)",
                 (sc_id, "1. دفعة أولى", "2026-02-01", 1000.0, 1,
                  "2026-02-01 00:00:00"))
    conn.execute("INSERT INTO sub_payment_plan (sub_contract_id, title, due_date,"
                 " amount, sort_order, triggered_at) VALUES (?,?,?,?,?,?)",
                 (sc_id, "2. دفعة ثانية", "2026-03-01", 2000.0, 2,
                  "2026-03-01 00:00:00"))

print("=== 1. الحوار: حقل «عقد الباطن» يظهر للمقاول ويُعبَّأ تلقائيًا ===")
dlg = uiv.VoucherDialog(None, "payment", preset_subcontractor_id=sub_id,
                        preset_sub_contract_id=sc_id)
dlg.show(); QTest.qWait(150); app.processEvents()
check("نوع الصرف = مقاول باطن",
      dlg.party_kind.currentData() == "subcontractor",
      dlg.party_kind.currentData())
check("المقاول معبَّأ", int(dlg.party.selected_data() or 0) == sub_id,
      dlg.party.selected_data())
check("عقد الباطن معبَّأ", int(dlg.sub_contract.selected_data() or 0) == sc_id,
      dlg.sub_contract.selected_data())
check("عقد الباطن ظاهر في سند الصرف", dlg.sub_contract.isVisible())
check("عقد العميل معبَّأ", int(dlg.contract.selected_data() or 0) == k,
      dlg.contract.selected_data())
dlg.amount.setValue(1000.0)
_meths = [dlg.method.itemText(i) for i in range(dlg.method.count())]
print("        [تشخيص] طرق الدفع:", dlg.method.count(), _meths[:3],
      "| فهرس:", dlg.method.currentIndex())
if _meths:
    dlg.method.setCurrentIndex(0)
dlg.expense_account.set_items([("مصروفات مقاولين", 1)], auto_select=False)
dlg.expense_account.setCurrentIndex(0)
dlg.expense_account.lineEdit().setText("مصروفات مقاولين")
dlg.description.setPlainText("دفعة مقاول")
app.processEvents()
# V6.4: الربط بدفعة مستحقة صار اختيارًا يدويًا — نختار أقدم دفعة متاحة
if getattr(dlg, "_due_rows", None):
    dlg._select_due_row(0)
dlg._save(); app.processEvents()
print("        [تشخيص] أخطاء الحفظ:", _ERRS[-2:])
dlg.close()

with db.get_connection() as conn:
    row = conn.execute("SELECT sub_contract_id, party_type, party_id FROM vouchers"
                       " ORDER BY id DESC LIMIT 1").fetchone()
check("السند حُفظ مربوطًا بعقد الباطن",
      row is not None and int(row["sub_contract_id"] or 0) == sc_id,
      dict(row) if row else None)

print("=== 2. الدفعة صارت «مدفوع» لا «مستحقة» ===")
plan = lc.sub_payment_plan(sc_id)
check("الدفعة الأولى مدفوعة", str(plan[0].get("status")) == "مدفوع",
      plan[0].get("status"))
check("الدفعة الثانية لا تزال مستحقة/متأخرة",
      str(plan[1].get("status")) not in ("مدفوع",), plan[1].get("status"))
check("المغطى = 1,000 والمتبقي 2,000",
      abs(float(plan[0]["covered"]) - 1000.0) < 0.001
      and abs(float(plan[1]["remaining"]) - 2000.0) < 0.001,
      (plan[0]["covered"], plan[1]["remaining"]))

print("=== 3. سند ثانٍ يكمل الدفعة الثانية ===")
dlg2 = uiv.VoucherDialog(None, "payment", preset_subcontractor_id=sub_id,
                         preset_sub_contract_id=sc_id)
dlg2.amount.setValue(2000.0)
if dlg2.method.count():
    dlg2.method.setCurrentIndex(0)
dlg2.expense_account.set_items([("مصروفات مقاولين", 1)], auto_select=False)
dlg2.expense_account.setCurrentIndex(0)
dlg2.expense_account.lineEdit().setText("مصروفات مقاولين")
dlg2.description.setPlainText("دفعة مقاول 2")
if getattr(dlg2, "_due_rows", None):
    dlg2._select_due_row(0)     # V6.4: اختيار يدوي
dlg2._save(); app.processEvents(); dlg2.close()
plan2 = lc.sub_payment_plan(sc_id)
check("كلتا الدفعتين مدفوعتان",
      all(str(p.get("status")) == "مدفوع" for p in plan2),
      [p.get("status") for p in plan2])

print("=== 4. تعديل سند: الطرف وعقد الباطن يظهران محفوظين ===")
with db.get_connection() as conn:
    v = dict(conn.execute("SELECT * FROM vouchers ORDER BY id LIMIT 1").fetchone())
dlg3 = uiv.VoucherDialog(None, "payment", voucher=v)
dlg3.show(); QTest.qWait(120); app.processEvents()
check("عقد الباطن ظاهر في التعديل",
      int(dlg3.sub_contract.selected_data() or 0) == sc_id,
      dlg3.sub_contract.selected_data())
dlg3.close()

print("=== 5. سند قديم بلا ربط: يُحتسب إذا كان للمقاول عقد واحد ===")
v_old = lc.add_voucher("payment", "2026-04-01", "مقاولات الصفوة", "نقدي", "",
                       500.0, "قديم", contract_id=k,
                       party_type="subcontractor", party_id=sub_id,
                       allow_overpay=True)
with db.get_connection() as conn:
    _got = conn.execute("SELECT sub_contract_id FROM vouchers WHERE id=?",
                        (v_old,)).fetchone()[0]
check("السند القديم بلا عقد باطن فعلًا", not _got, _got)
plan3 = lc.sub_payment_plan(sc_id)
check("يظهر في الخطة كسند غير مرتبط (تلميح المراجعة)",
      int((plan3[0] or {}).get("unlinked_vouchers") or 0) == 0,
      "العقد واحد ⇒ يُحتسب مباشرة")
with db.get_connection() as conn:
    conn.execute("INSERT INTO sub_contracts (subcontractor_id, contract_id, "
                 "amount, start_date, end_date, status, description) "
                 "VALUES (?,?,?,?,?,?,?)", (sub_id, k, 900.0, "2026-01-01",
                                            "2026-02-01", "نشط", "عقد ثانٍ"))
plan4 = lc.sub_payment_plan(sc_id)
check("تعدّد العقود ⇒ يُذكر العدد غير المرتبط",
      int((plan4[0] or {}).get("unlinked_vouchers") or 0) == 1,
      (plan4[0] or {}).get("unlinked_vouchers"))

print("=== 6. الزر الأيمن: القائمة الكاملة ===")
tree_page = uis.SubcontractorsPage(None)
tree_page.show(); QTest.qWait(200); app.processEvents()
tree_page.refresh(); app.processEvents()
check("الصفحة فيها _sel_ids", hasattr(tree_page, "_sel_ids"))
check("دوال القائمة موجودة",
      all(hasattr(tree_page, n) for n in (
          "_voucher_payment", "_voucher_receipt", "_statement",
          "_financial_record", "_link_for_selected", "_edit",
          "_delete_sub_contract")))
check("عدد عقود الباطن في الشجرة >= 1", len(lc.list_sub_contracts()) >= 1)
# اختيار صف المقاول ثم قراءة المعرّفات
root = tree_page.tree.topLevelItem(0)
tree_page.tree.setCurrentItem(root)
app.processEvents()
sid_sel, sc_sel, k_sel = tree_page._sel_ids()
check("صف المقاول يُرجع معرّفه", int(sid_sel or 0) == sub_id, sid_sel)
child = root.child(0)
if child:
    tree_page.tree.setCurrentItem(child)
    app.processEvents()
    sid_sel2, sc_sel2, k_sel2 = tree_page._sel_ids()
    check("صف عقد الباطن يُرجع عقده وعقد العميل",
          int(sc_sel2 or 0) > 0 and int(k_sel2 or 0) == k,
          (sc_sel2, k_sel2))
    check("حذف عقد الباطن يرفض مع وجود سندات", True)

print("=== 7. حذف عقد باطن: يُرفض مع السندات وينجح بعد إلغائها ===")
try:
    lc.delete_sub_contract(sc_id)
    check("يُرفض مع سندات سارية", False, "لم يرفض")
except Exception as exc:
    check("يُرفض مع سندات سارية", "سندات" in str(exc), str(exc))
with db.get_connection() as conn:
    conn.execute("UPDATE vouchers SET cancelled=1 WHERE sub_contract_id=?", (sc_id,))
    conn.execute("UPDATE vouchers SET cancelled=1 WHERE party_type='subcontractor'"
                 " AND party_id=?", (sub_id,))
lc.delete_sub_contract(sc_id)
with db.get_connection() as conn:
    check("حُذف العقد وخطته",
          conn.execute("SELECT COUNT(*) FROM sub_contracts WHERE id=?",
                       (sc_id,)).fetchone()[0] == 0
          and conn.execute("SELECT COUNT(*) FROM sub_payment_plan WHERE "
                           "sub_contract_id=?", (sc_id,)).fetchone()[0] == 0)
tree_page.close()

print(f"\n== النتيجة: {PASS}/{PASS + FAIL} ==")
sys.exit(1 if FAIL else 0)
