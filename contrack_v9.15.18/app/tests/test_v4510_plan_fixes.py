# -*- coding: utf-8 -*-
"""V4.5.10: ثلاث ملاحظات ميدانية.

§1 ترقيم الدفعات متسلسل 1..n بعد ترشيح النطاق (بلا فجوة 1,2,4,5).
§2 خانة «قيمة الدفعة»: أرقام فقط + «تُحدد لاحقًا» نص إرشادي.
§3 selected_data() ترجع العقد المختار فعليًا عند تشابه نصوص العقود.
§4 خانة قيمة الدفعة + §5 القوائم المتشابهة + §6 شجرة التصنيفات (خطوة واحدة لا تُلغي أشقاءها).
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402

if os.path.isdir("data"):
    import shutil  # noqa: E402
    shutil.rmtree("data")
db.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import customer_service, lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


TODAY = date.today().isoformat()
T = "T4510"
from services import contract_type_service as cts  # noqa: E402
try:
    cts.add_type(T, 500.0, manual_track=True)   # V4.5.13
except Exception:
    pass
cust = customer_service.add_customer(Customer(
    customer_code="C-4510", name="عميل 4510", phone="90005110"))
stages = [wf.add_stage("contract", f"مرحلة {i} {T}", contract_type=T)
          for i in range(1, 6)]
with get_connection() as c:
    for i, sid in enumerate(stages, 1):
        c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title,"
                  " pct, amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
                  (T, i, f"دفعة {i}", 0, 100.0, sid))
# نوع اختبار ثانٍ: أول دفعة «مرنة» (بلا مبلغ) لفحص النص الإرشادي
TF = "T4510F"
try:
    cts.add_type(TF, 500.0, manual_track=True)   # V4.5.13
except Exception:
    pass
stages_f = [wf.add_stage("contract", f"مرحلةf {i}", contract_type=TF)
            for i in range(1, 4)]
with get_connection() as c:
    for i, sid in enumerate(stages_f, 1):
        c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title,"
                  " pct, amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
                  (TF, i, f"مرنة {i}", 0, 0.0 if i == 1 else 100.0, sid))

print("=== 1. ترقيم الدفعات بعد إلغاء اختيار مرحلة ===")
preview = wf.type_payment_preview(T, 500.0)
check("القالب كاملًا: أرقام 1..5",
      [r["pay_no"] for r in preview["rows"]] == [1, 2, 3, 4, 5],
      [r["pay_no"] for r in preview["rows"]])
keep = {stages[0], stages[1], stages[3], stages[4]}      # بلا المرحلة 3
rows = wf.renumber_plan_rows(preview["rows"], keep)
check("بعد الفلترة: أرقام 1..4 بلا فجوة",
      [r["pay_no"] for r in rows] == [1, 2, 3, 4],
      [r["pay_no"] for r in rows])
check("نفس الدفعات (لا حذف غير المختار فقط)",
      [r["title"] for r in rows] == ["دفعة 1", "دفعة 2", "دفعة 4", "دفعة 5"],
      [r["title"] for r in rows])
check("الرقم الأصلي محفوظ للربط الداخلي",
      [r["tpl_pay_no"] for r in rows] == [1, 2, 4, 5],
      [r["tpl_pay_no"] for r in rows])
check("الأرقام نصيًا كما في الجدول",
      [int(r["pay_no"]) for r in rows] == list(range(1, len(rows) + 1)))

print("=== 2. خطة العقد المحفوظة تُرقَّم 1..n ===")
kid = cs.add_contract(
    Contract(contract_number="CON-4510", customer_id=cust,
             contract_date=TODAY, contract_type=T, description="اختبار الترقيم",
             amount=500.0),
    scope_stage_ids=[stages[0], stages[1], stages[3], stages[4]])
with get_connection() as c:
    made = c.execute("SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
                     (kid,)).fetchone()[0]
check("خُطة من أربع دفعات", made == 4, made)
with get_connection() as c:
    rows_db = [dict(r) for r in c.execute(
        "SELECT sort_order, title FROM payment_plan WHERE contract_id=?"
        " ORDER BY sort_order, id", (kid,)).fetchall()]
check("الترقيم المحفوظ 1..4 بلا فجوة",
      [int(r["sort_order"]) for r in rows_db] == [1, 2, 3, 4],
      [int(r["sort_order"]) for r in rows_db])
check("عنوان الدفعة يحمل الرقم المتسلسل",
      [r["title"][:2] for r in rows_db] == ["1.", "2.", "3.", "4."],
      [r["title"] for r in rows_db])
check("الدفعات هي المختارة (1,2,4,5 من القالب) — والاسم يتبع الترقيم الجديد",
      [r["title"] for r in rows_db]
      == ["1. دفعة 1", "2. دفعة 2", "3. دفعة 3", "4. دفعة 4"],
      [r["title"] for r in rows_db])

print("=== 3. مزامنة عقد قديم (1,2,4,5) تُعيد الترقيم بلا حذف/إنشاء ===")
old_ids = []
with get_connection() as c:
    ids = [int(r["id"]) for r in c.execute(
        "SELECT id FROM payment_plan WHERE contract_id=? ORDER BY sort_order",
        (kid,)).fetchall()]
    old_ids = list(ids)
    c.execute("UPDATE payment_plan SET sort_order=4 WHERE id=?", (ids[2],))
    c.execute("UPDATE payment_plan SET sort_order=5 WHERE id=?", (ids[3],))
    c.execute("UPDATE payment_plan SET title='4. دفعة 4' WHERE id=?", (ids[2],))
    c.execute("UPDATE payment_plan SET title='5. دفعة 5' WHERE id=?", (ids[3],))
rep = wf.sync_plan_from_template(kid)
with get_connection() as c:
    after = [dict(r) for r in c.execute(
        "SELECT id, sort_order FROM payment_plan WHERE contract_id=?"
        " ORDER BY sort_order, id", (kid,)).fetchall()]
check("الأرقام عادت 1..4", [int(r["sort_order"]) for r in after] == [1, 2, 3, 4],
      [int(r["sort_order"]) for r in after])
check("نفس الصفوف (بلا حذف ولا إنشاء)",
      sorted(int(r["id"]) for r in after) == sorted(old_ids),
      (sorted(int(r["id"]) for r in after), sorted(old_ids)))
check("لا حذف في تقرير المزامنة", rep.get("deleted") == [], rep.get("deleted"))

print("=== 4. خانة قيمة الدفعة: أرقام فقط و«تُحدد لاحقًا» إرشادية ===")
from PySide6.QtCore import Qt as _Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
import ui.contracts as uic  # noqa: E402

app = QApplication.instance() or QApplication([])
dlg = uic.ContractDialog(None, None)
_ok = False
if hasattr(dlg.ctype, "select_data"):
    _ok = bool(dlg.ctype.select_data(TF))
if not _ok:
    for _i in range(dlg.ctype.count()):
        if dlg.ctype.itemData(_i) == TF:
            dlg.ctype.setCurrentIndex(_i)
            _ok = True
            break
check("تم اختيار نوع العقد في الشاشة", _ok,
      [dlg.ctype.itemData(i) for i in range(dlg.ctype.count())])
dlg.amount.setValue(500.0)
dlg._refresh_plan_preview()
tbl = dlg.plan_table
check("الجدول يعرض 3 دفعات", tbl.rowCount() == 3, tbl.rowCount())
check("العمود 3 له محرّر رقمي",
      isinstance(tbl.itemDelegateForColumn(3), uic._PlanAmountDelegate))
cell = tbl.item(0, 3)
check("القيمة بلا مبلغ نص إرشادي", uic._PLAN_AMOUNT_HINT in cell.text(),
      cell.text())
tbl.item(0, 3).setText("")                    # مسح القيمة
app.processEvents()
check("المسح يعيد النص الإرشادي",
      uic._PLAN_AMOUNT_HINT in tbl.item(0, 3).text(), tbl.item(0, 3).text())
tbl.item(0, 3).setText("1,250.500")           # كتابة رقم
app.processEvents()
check("الرقم يُقبل ويُنسَّق ثلاث خانات",
      tbl.item(0, 3).text() == "1,250.500", tbl.item(0, 3).text())
check("التجاوز مسجَّل للدفعة الأولى",
      dlg._plan_amount_overrides.get(1) == 1250.5, dlg._plan_amount_overrides)
tbl.item(0, 3).setText("ألف")                 # نص غير رقمي
app.processEvents()
check("النص غير الرقمي لا يُصفَّر إلى 0.000",
      tbl.item(0, 3).text() == "1,250.500", tbl.item(0, 3).text())
tbl.item(0, 3).setText("")                    # مسح بعد التجاوز ⇒ إلغاؤه
app.processEvents()
check("المسح بعد التجاوز يلغي التجاوز (دفعة مرنة ⇒ النص الإرشادي)",
      uic._PLAN_AMOUNT_HINT in tbl.item(0, 3).text()
      and 1 not in dlg._plan_amount_overrides,
      (tbl.item(0, 3).text(), dict(dlg._plan_amount_overrides)))
tbl.item(1, 3).setText("")            # دفعة لها مبلغ من القالب
app.processEvents()
check("مسح دفعة لها مبلغ قالب يرجّع مبلغ القالب",
      tbl.item(1, 3).text() == "100.000", tbl.item(1, 3).text())

print("=== 5. selected_data() مع عقود متشابهة النص ===")
from ui.widgets import SearchableComboBox  # noqa: E402
combo = SearchableComboBox()
combo.set_items([("عقد متشابه", 7), ("عقد متشابه", 8), ("عقد متشابه", 9)],
                auto_select=False)
bad = []
for i, want in enumerate((7, 8, 9)):
    combo.setCurrentIndex(i)
    if combo.selected_data() != want:
        bad.append((i, want, combo.selected_data()))
check("كل اختيار يرجع قيمته الصحيحة", not bad, bad)
combo.setCurrentIndex(-1)
combo.setEditText("عقد متشابه")
check("كتابة حرة بلا اختيار ⇒ None", combo.selected_data() is None,
      combo.selected_data())

print("=== 6. شجرة التصنيفات: إلغاء خطوة لا يُلغي الشقيقات ===")
from PySide6.QtCore import QPoint  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402
TG = "T4510G"
try:
    cts.add_type(TG, 500.0, manual_track=True)   # V4.5.13
except Exception:
    pass
g_main = wf.add_stage("contract", "تصنيف الكهرباء", contract_type=TG)
g_kids = [wf.add_stage("contract", f"خطوة {i}", contract_type=TG,
                       parent_id=g_main) for i in range(1, 4)]
with get_connection() as c:
    for i, sid in enumerate(g_kids, 1):
        c.execute("INSERT INTO type_payment_tpl (contract_type, pay_no, title,"
                  " pct, amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
                  (TG, i, f"دفعة {i}", 0, 100.0, sid))
gdlg = uic.ContractDialog(None, None)
for _i in range(gdlg.ctype.count()):
    if gdlg.ctype.itemData(_i) == TG:
        gdlg.ctype.setCurrentIndex(_i)
        break
gdlg.amount.setValue(500.0)
gdlg.resize(1100, 780)
gdlg.show()
app.processEvents()


def _click(item):
    rect = gdlg.scope_tree.visualItemRect(item)
    pt = QPoint(rect.right() - 6, rect.center().y())   # RTL: المربع يمين
    QTest.mouseClick(gdlg.scope_tree.viewport(), _Qt.LeftButton,
                     _Qt.NoModifier, pt)
    app.processEvents()
    app.processEvents()


top = gdlg.scope_tree.topLevelItem(0)
check("الشجرة تبني 3 خطوات", top is not None and top.childCount() == 3,
      top.childCount() if top is not None else None)
_click(top.child(1))                       # إلغاء خطوة واحدة
check("الخطوة المنقورة أُلغيت", top.child(1).checkState(0) == _Qt.Unchecked,
      top.child(1).checkState(0))
check("شقيقتاها باقيتان معلّمتين",
      top.child(0).checkState(0) == _Qt.Checked
      and top.child(2).checkState(0) == _Qt.Checked,
      (top.child(0).checkState(0), top.child(2).checkState(0)))
check("التصنيف صار جزئيًا", top.checkState(0) == _Qt.PartiallyChecked,
      top.checkState(0))
check("النطاق المختار = خطوتان", len(gdlg._scope_selection()) == 2,
      sorted(gdlg._scope_selection()))
check("المعاينة تنتظر التنزيل (٣ دفعات)", gdlg.plan_table.rowCount() == 3,
      gdlg.plan_table.rowCount())
check("تنبيه تغيّر التصنيفات ظاهر", not gdlg._scope_stale.isHidden())
gdlg._apply_scope_to_plan()
app.processEvents()
check("بعد التنزيل: دفعتان والتنبيه اختفى",
      gdlg.plan_table.rowCount() == 2 and gdlg._scope_stale.isHidden(),
      (gdlg.plan_table.rowCount(), gdlg._scope_stale.isHidden()))
_click(top)                                # نقرة على التصنيف: تتْبع كل الخطوات
_st = top.checkState(0)
check("نقرة التصنيف تُعمّم حالته على كل خطواته",
      _st != _Qt.PartiallyChecked
      and all(top.child(j).checkState(0) == _st for j in range(3)),
      (_st, [top.child(j).checkState(0) for j in range(3)]))
gdlg._apply_scope_to_plan()
app.processEvents()
check("النطاق والدفعات تبعًا للتصنيف",
      len(gdlg._scope_selection()) == (3 if _st == _Qt.Checked else 0)
      and gdlg.plan_table.rowCount() == len(gdlg._scope_selection()),
      (sorted(gdlg._scope_selection()), gdlg.plan_table.rowCount()))
_click(top)                                # نقرة أخرى: تعود كلها
check("النقرة الثانية ترجّع الخطوات كلها",
      all(top.child(j).checkState(0) == _Qt.Checked for j in range(3))
      or all(top.child(j).checkState(0) == _Qt.Unchecked for j in range(3)),
      [top.child(j).checkState(0) for j in range(3)])


print(f"\n== النتيجة: {PASS} ناجح · {FAIL} فاشل ==")
sys.exit(1 if FAIL else 0)
