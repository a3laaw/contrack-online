# -*- coding: utf-8 -*-
"""V6.2 (الجزء ١): شاشة الأمر التغييري — البنية الجديدة.

① تابان رئيسيان (عميل/مقاول) + تابان فرعيان لكل جهة + جدول مشترك بالأسفل.
② عميل ← إضافة: من بنود العميل التلقائية (المتبقي من المقايسة) + بند يدوي.
③ مقاول: اختيار المقاول داخل التاب · إسناد بند محفوظ بسعره المستقل ·
   منع تكرار البند لنفس المقاول · السماح به لمقاول آخر.
④ عميل ← حذف: عمود «المصدر» + تنبيه قبل فك ارتباط المقاولين.
⑤ الحفظ: معاملة واحدة — البند اليدوي يُعتمد في العقد · يُنشأ عقد باطن للمقاول
   الجديد بقيمة التعديلات · القيم تتحدث لحظيًا.
⑥ حالات حدية: عقد بلا بنود · تاب المقاول لا يعرض ما لم يُحفظ.

كل الاختبارات على قاعدة مؤقتة — لا تمس أي بيانات حقيقية.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db  # noqa: E402

_t = tempfile.mkdtemp(prefix="v62co_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication  # noqa: E402
app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

_CONFIRMS = []
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.require_admin = lambda *a, **k: True


def _confirm_stub(parent, msg, title=""):
    _CONFIRMS.append(str(msg))
    return True


style.confirm = _confirm_stub

from PySide6.QtCore import Qt  # noqa: E402
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service, contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import addendum_service as adx  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402
from ui import addendum_dialog as uad  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_DEVELOPER
PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def _ins_quote(customer_id, items, number="Q-62"):
    """بند من المقايسة لم ينزل في العقد (يظهر «من بنود العميل التلقائية»)."""
    with get_connection() as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(quotations)")}
        val = {"customer_id": customer_id}
        if "quote_number" in cols:
            val["quote_number"] = number
        if "qdate" in cols:
            val["qdate"] = "2026-01-01"
        if "status" in cols:
            val["status"] = "معتمد"
        k = ",".join(val)
        m = ",".join("?" * len(val))
        qid = c.execute(f"INSERT INTO quotations ({k}) VALUES ({m})",
                        tuple(val.values())).lastrowid
        icols = {r[1] for r in c.execute("PRAGMA table_info(quotation_items)")}
        for d in items:
            iv = {"quotation_id": qid, "description": d["description"],
                  "qty": d.get("qty", 1), "unit": d.get("unit", ""),
                  "unit_price": d.get("unit_price", 0)}
            iv = {kk: vv for kk, vv in iv.items() if kk in icols}
            c.execute(f"INSERT INTO quotation_items ({','.join(iv)}) "
                      f"VALUES ({','.join('?' * len(iv))})", tuple(iv.values()))
    return qid


# ============ التهيئة ============
cust = cs.add_customer(Customer(customer_code="C-62", name="عميل الأوامر",
                                phone="900062"))
k = ks.add_contract(Contract(
    contract_number="CON-62", customer_id=cust, contract_date="2026-01-01",
    contract_type="", description="عقد الأوامر", amount=5000.0),
    manual_path=True)
with get_connection() as c:
    for nm, pr in (("بنية", 1000.0), ("تشطيب", 800.0), ("كهرباء", 700.0)):
        c.execute("INSERT INTO boq_items (contract_id, description, qty, unit,"
                  " unit_price) VALUES (?,?,?,?,?)", (k, nm, 1, "", pr))
    for nm in ("سمير", "خالد"):
        c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
                  " VALUES (?,?,?)", (f"S-62{nm[:1]}", nm, "1"))
    subs = {r["name"]: int(r["id"]) for r in c.execute(
        "SELECT id, name FROM subcontractors").fetchall()}
    boq = {r["description"]: int(r["id"]) for r in c.execute(
        "SELECT id, description FROM boq_items WHERE contract_id=?",
        (k,)).fetchall()}
# عقود باطن تمهيدية حتى تظهر في القائمة المنسدلة (JOIN)
sc_samir = lc.add_sub_contract(subs["سمير"], k, None, 800.0,
                               "2026-01-01", "2026-12-31", "باطن سمير",
                               boq_item_ids=[boq["تشطيب"]])
sc_khaled = lc.add_sub_contract(subs["خالد"], k, None, 700.0,
                                "2026-01-01", "2026-12-31", "باطن خالد",
                                boq_item_ids=[boq["كهرباء"]])
_ins_quote(cust, [{"description": "بند مقايسة أ", "qty": 2, "unit": "م",
                   "unit_price": 300.0},
                  {"description": "بند مقايسة ب", "qty": 1, "unit": "",
                   "unit_price": 450.0}])

print("=" * 70)
print("① البنية: تاب إضافة/حذف مباشر · جدول مشترك")
print("=" * 70)
dlg = uad.ChangeOrderDialog(None, k)
check("الجهة النشطة = عميل (الافتراضي)",
      dlg._active_side == "client",
      dlg._active_side)
check("الجزء العلوي ثابت: النوع · التاريخ · السبب · الوصف",
      all(hasattr(dlg, x) for x in ("a_type", "a_date", "a_reason", "a_desc")))
check("تاب العميل: تابان فرعيان (إضافة/حذف) مباشرة",
      dlg.cli_tabs.count() == 2
      and all(t in dlg.cli_tabs.tabText(0) + dlg.cli_tabs.tabText(1)
              for t in ("إضافة", "حذف")))
check("المقاول يُختار داخل الجهة النشطة",
      dlg.sub_combo.parent() is not None and dlg.sub_combo.count() == 3,
      dlg.sub_combo.count())
check("الجدول المشترك واحد بالأسفل (بلا جدول لكل جهة)",
      not hasattr(dlg, "p_client_sheet")
      and dlg.parts_table.columnCount() == 5
      and "النوع" in dlg.parts_table.horizontalHeaderItem(0).text())
check("بنود العميل التلقائية = المتبقي من المقايسة (2)",
      dlg.avail_table.rowCount() == 2,
      [dlg.avail_table.item(r, 1).text()
       for r in range(dlg.avail_table.rowCount())])
check("جدول حذف العميل فيه عمود «المصدر» (تلقائي/يدوي)",
      dlg.del_table.columnCount() == 7
      and "المصدر" in dlg.del_table.horizontalHeaderItem(6).text()
      and dlg.del_table.item(0, 6).text() == "تلقائي")

print()
print("=" * 70)
print("② عميل ← إضافة: من التلقائية + بند يدوي (لا يظهر للمقاول قبل الحفظ)")
print("=" * 70)
for r in range(dlg.avail_table.rowCount()):
    dlg.avail_table.item(r, 0).setCheckState(Qt.Checked)
dlg._add_selected_available()
check("أُضيفت بنود المقايسة المتبقية (2)",
      adx.totals(dlg.addendum_id)["client"]["add_n"] == 2,
      adx.totals(dlg.addendum_id)["client"])
check("الجدول المشترك يعرض النوع «عميل / إضافة»",
      dlg.parts_table.rowCount() == 2
      and "عميل / إضافة" in dlg.parts_table.item(0, 0).text(),
      dlg.parts_table.item(0, 0).text())
dlg.m_desc.setText("بند يدوي خاص")
dlg.m_qty.setValue(2)
dlg.m_price.setValue(150.0)
dlg._add_manual()
check("البند اليدوي أُضيف كبند عميل (3 أجزاء)",
      dlg.parts_table.rowCount() == 3
      and adx.totals(dlg.addendum_id)["client"]["add_n"] == 3)
check("البند اليدوي لا يظهر في تاب المقاول قبل الحفظ",
      all(dlg.sub_add_table.item(r, 1).text() != "بند يدوي خاص"
          for r in range(dlg.sub_add_table.rowCount())))
check("إجمالي العقد يتحدث لحظيًا بالأسفل (5,000 + 1,350)",
      "قيمة العقد بعد الأمر" in dlg.foot.text()
      and "6,350.000" in dlg.foot.text(),
      dlg.foot.text())

print()
print("=" * 70)
print("③ مقاول ← إضافة: سعر مستقل · منع التكرار لنفس المقاول")
print("=" * 70)
idx = dlg.sub_combo.findData(subs["سمير"])
dlg.sub_combo.setCurrentIndex(idx)
rows = [r for r in range(dlg.sub_add_table.rowCount())
        if dlg.sub_add_table.item(r, 1).text() == "بنية"]
check("بنية معروض للمقاول (من بنود العميل المحفوظة)", bool(rows))
r0 = rows[0]
dlg.sub_add_table.item(r0, 5).setText("900.000")     # سعر المقاول
check("عمود «سعر المقاول» يعيد حساب الإجمالي",
      dlg.sub_add_table.item(r0, 6).text() == "900.000",
      dlg.sub_add_table.item(r0, 6).text())
dlg.sub_add_table.item(r0, 0).setCheckState(Qt.Checked)
dlg._add_selected_sub()
check("أُسند للمقاول بنوع «مقاول / إضافة — سمير»",
      dlg.parts_table.rowCount() == 4
      and "مقاول / إضافة" in dlg.parts_table.item(3, 0).text()
      and "سمير" in dlg.parts_table.item(3, 0).text(),
      dlg.parts_table.item(3, 0).text())
try:
    adx.add_part(dlg.addendum_id, "sub", "بنية", 1, "", 900.0,
                 boq_item_id=boq["بنية"], subcontractor_id=subs["سمير"])
    _dup_blocked = False
except ValidationError:
    _dup_blocked = True
check("تكرار نفس البند لنفس المقاول ممنوع", _dup_blocked)
idx2 = dlg.sub_combo.findData(subs["خالد"])
dlg.sub_combo.setCurrentIndex(idx2)
rows2 = [r for r in range(dlg.sub_add_table.rowCount())
         if dlg.sub_add_table.item(r, 1).text() == "بنية"]
check("نفس البند يظهر لمقاول آخر (خالد)", bool(rows2))
dlg.sub_add_table.item(rows2[0], 5).setText("950.000")
dlg.sub_add_table.item(rows2[0], 0).setCheckState(Qt.Checked)
dlg._add_selected_sub()
check("نفس بند العميل مسموح لمقاولين بسعرين مستقلين",
      adx.totals(dlg.addendum_id)["sub"]["add"] == 1850.0,
      adx.totals(dlg.addendum_id)["sub"])
check("سطرا المقاول يظهران باسم كل مقاول",
      sum(1 for r in range(dlg.parts_table.rowCount())
          if "مقاول / إضافة" in dlg.parts_table.item(r, 0).text()) == 2)

print()
print("=" * 70)
print("④ عميل ← حذف: عمود المصدر + تنبيه فك ارتباط المقاولين")
print("=" * 70)
# عقد الباطن لسمير مُنشأ مسبقًا في التهيئة (sc_samir)
_CONFIRMS.clear()
for r in range(dlg.del_table.rowCount()):
    if dlg.del_table.item(r, 1).text() == "تشطيب":
        dlg.del_table.item(r, 0).setCheckState(Qt.Checked)
dlg._mark_delete()
check("تنبيه قبل فكّ ارتباط المقاول ظهر",
      any("سمير" in m and "فكّ" in m for m in _CONFIRMS),
      _CONFIRMS)
check("بند الحذف أُضيف بنوع «عميل / حذف»",
      adx.totals(dlg.addendum_id)["client"]["del_n"] == 1
      and any("عميل / حذف" in dlg.parts_table.item(r, 0).text()
              for r in range(dlg.parts_table.rowCount())))

print()
print("=" * 70)
print("⑤ الحفظ: معاملة واحدة — الاعتماد + عقد الباطن الجديد + فك الارتباط")
print("=" * 70)
dlg.a_reason.setText("توسعة مظاريف")
dlg._save()
with get_connection() as c:
    arow = c.execute("SELECT status, applied_at FROM addendums WHERE id=?",
                     (dlg.addendum_id,)).fetchone()
    manual = c.execute(
        "SELECT id FROM boq_items WHERE contract_id=? AND description=?",
        (k, "بند يدوي خاص")).fetchone()
    scs = {r["id"]: dict(r) for r in c.execute(
        "SELECT id, subcontractor_id, amount, description FROM sub_contracts "
        "WHERE contract_id=?", (k,)).fetchall()}
    links_samir = {r["boq_item_id"] for r in c.execute(
        "SELECT boq_item_id FROM sub_contract_items WHERE sub_contract_id=?",
        (sc_samir,)).fetchall()}
check("الأمر اعتمد ونُفّذ", arow and arow["status"] == "معتمد"
      and (arow["applied_at"] or "").strip() != "", dict(arow) if arow else None)
check("البند اليدوي أصبح بندًا معتمدًا في عقد العميل", manual is not None)
check("عقد الباطن سمير تحدث بقيمة الإسناد (+900)",
      any(abs(float(s["amount"]) - 1700.0) < 0.001 for s in scs.values()),
      [s["amount"] for s in scs.values()])
check("عقد باطن خالد تحدث بقيمة الإسناد (+950 → 1650)",
      any(int(s["subcontractor_id"]) == subs["خالد"]
          and abs(float(s["amount"]) - 1650.0) < 0.001
          for s in scs.values()),
      [(s["subcontractor_id"], s["amount"]) for s in scs.values()])
check("بند «تشطيب» فُكّ ارتباطه بعقد الباطن (حذف من العميل)",
      boq["تشطيب"] not in links_samir, links_samir)
check("قيمة العقد تحدثت (5,000 + المستحق)",
      abs(float(lc.contract_current_value(k)["current"]) - 5000.0) >= 0.001,
      lc.contract_current_value(k)["current"])
dlg2 = uad.ChangeOrderDialog(None, k)
names2 = [dlg2.sub_add_table.item(r, 1).text()
          for r in range(dlg2.sub_add_table.rowCount())]
check("بعد الحفظ: البند اليدوي ظهر لقائمة المقاول (بند محفوظ معتمد)",
      "بند يدوي خاص" in names2, names2)
dlg2.close()

print()
print("=" * 70)
print("⑥ حالات حدية: عقد بلا بنود · تاب المقاول بلا عقود")
print("=" * 70)
k2 = ks.add_contract(Contract(contract_number="CON-62B", customer_id=cust,
                              contract_date="2026-01-01", contract_type="",
                              description="عقد فاضي", amount=1000.0),
                     manual_path=True)
# V8.9: نحذف الدفعات والمراحل التلقائية حتى يكون العقد فاضيًا فعلاً
from database.database import get_connection as _gconn
with _gconn() as _c:
    _c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k2,))
    _c.execute("DELETE FROM contract_stages WHERE contract_id=?", (k2,))
d2 = uad.ChangeOrderDialog(None, k2)
d2.cli_tabs.setCurrentIndex(1)
check("عقد بلا بنود: رسالة صريحة في الحذف",
      d2.del_table.rowCount() == 0 and d2.del_empty.isVisibleTo(d2)
      and "لا بنود على هذا العقد بعد" in d2.del_empty.text(),
      d2.del_empty.text())
check("عقد بلا مقاولين متعاقدين: فقط خيار «جديد»",
      d2.sub_combo.count() == 1
      and "جديد" in d2.sub_combo.itemText(0),
      [d2.sub_combo.itemText(i) for i in range(d2.sub_combo.count())])
d2.close()
dlg.close()

print(f"\nV6.2 change order v2: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
