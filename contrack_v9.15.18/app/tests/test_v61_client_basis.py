# -*- coding: utf-8 -*-
"""V6.1: عقد العميل هو الأساس في كل شيء.

① التوزيع التلقائي لدفعات عقد الباطن = صف لكل دفعة من دفعات عقد العميل
   (العدد والأسماء والمبالغ والاستحقاق والربط 1:1) — بلا أي مرحلة أو بند
   خارج عقد العميل.
② الواجهة: «مصادر المحدد/الدفعة» أُزيلت · «دفعة العميل» إلزامية ·
   الاستحقاق تلقائي مقفول · عمود «حالة دفعة العميل» بدل «المصادر».
③ سند الصرف: اسم عقد الباطن (لا رقم ومبلغ) + البيان التلقائي مثل سند القبض.

الاختبارات على قاعدة مؤقتة تمامًا — لا تمس أي بيانات حقيقية.
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db
_t = tempfile.mkdtemp(prefix="v61_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication  # noqa: E402
app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402
for _n in ("info", "error", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.confirm = lambda *a, **k: True
style.require_admin = lambda *a, **k: True

from PySide6.QtWidgets import QDateEdit, QPushButton  # noqa: E402
from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service, contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import extras_service as xs  # noqa: E402

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


# ============ التهيئة ============
cust = cs.add_customer(Customer(customer_code="C-61", name="عميل V6.1",
                                phone="90000610"))
for _nm in ("الهيكل", "الكهرباء", "مرحلة غير معتمدة"):
    wf.add_stage("contract", _nm, contract_type="T61")
with get_connection() as c:
    for i, _nm in ((1, "الهيكل"), (2, "الكهرباء")):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("T61", i, f"قالب {i}", 0, 1000.0, None))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-61", "مقاول V6.1", "1"))
    sub_party = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                          ("S-61",)).fetchone()["id"]

k = ks.add_contract(Contract(
    contract_number="CON-61", customer_id=cust, contract_date="2026-01-01",
    contract_type="T61", description="عقد العميل", amount=2000.0),
    manual_path=True)
k2 = ks.add_contract(Contract(
    contract_number="CON-61B", customer_id=cust, contract_date="2026-01-01",
    contract_type="", description="عقد بلا دفعات", amount=500.0),
    manual_path=True)

with get_connection() as c:
    _st = {r["name"]: int(r["id"]) for r in c.execute(
        "SELECT id, name FROM contract_stages WHERE contract_id=?",
        (k,)).fetchall()}
with get_connection() as c:
    c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k,))
    _plan = [("الدفعة الأولى", "2026-02-01", 1000.0, _st.get("الهيكل")),
             ("الدفعة الثانية", "2026-04-01", 500.0, _st.get("الكهرباء")),
             ("الدفعة الثالثة", "2026-06-01", 300.0, _st.get("الكهرباء")),
             ("الدفعة الرابعة", "2026-08-01", 200.0, None)]
    for _i, (_t, _d, _a, _sid) in enumerate(_plan, 1):
        c.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
                  " amount, sort_order, stage_id) VALUES (?,?,?,?,?,?)",
                  (k, _t, _d, _a, _i, _sid))
    _pid = {r["title"]: int(r["id"]) for r in c.execute(
        "SELECT id, title FROM payment_plan WHERE contract_id=?",
        (k,)).fetchall()}

sub = lc.add_sub_contract(sub_party, k, None, 1000.0, "2026-01-01",
                          "2026-12-31", "عقد كامل")

print("=" * 70)
print("① التوزيع التلقائي = صف لكل دفعة عميل (عقد العميل هو الأساس)")
print("=" * 70)
n = lc.distribute_sub_plan(sub)
lines = lc.sub_payment_plan(sub)
check("عدد الصفوف = عدد دفعات عقد العميل (4)",
      n == 4 and len(lines) == 4, (n, len(lines)))
check("ترتيب الصفوف = ترتيب دفعات العميل",
      [l["title"] for l in lines]
      == ["الدفعة الأولى", "الدفعة الثانية", "الدفعة الثالثة",
          "الدفعة الرابعة"],
      [l["title"] for l in lines])
check("المبالغ بنسبة الدفعات (1000/500/300/200 ← 500/250/150/100)",
      [round(float(l["amount"]), 3) for l in lines]
      == [500.0, 250.0, 150.0, 100.0]
      and round(sum(float(l["amount"]) for l in lines), 3) == 1000.0,
      [(l["title"], l["amount"]) for l in lines])
check("الاستحقاق من دفعة العميل نفسها",
      [(l["due_date"] or "")[:10] for l in lines]
      == ["2026-02-01", "2026-04-01", "2026-06-01", "2026-08-01"],
      [l["due_date"] for l in lines])
check("ربط 1:1 — كل صف مصدره دفعة عميل واحدة",
      all(len(lc.get_sub_line_sources(l["id"])) == 1 for l in lines)
      and {lc.get_sub_line_sources(l["id"])[0]["id"] for l in lines}
      == set(_pid.values()),
      [(l["title"], [s["title"] for s in lc.get_sub_line_sources(l["id"])])
       for l in lines])
check("لا صف لمرحلة غير معتمدة في عقد العميل",
      all("مرحلة غير معتمدة" != (l.get("stage_name") or "")
          for l in lines),
      [l.get("stage_name") for l in lines])
check("الدفعة بلا مرحلة تبقى بلا ربط مرحلة",
      lines[3]["stage_id"] is None, lines[3]["stage_id"])
check("مرحلة الكهرباء مرتبطة بالدفعتين الثانية والثالثة",
      lines[1]["stage_id"] == _st.get("الكهرباء")
      and lines[2]["stage_id"] == _st.get("الكهرباء"))

# عقد بلا قالب: add_contract ينشئ دفعة واحدة افتراضية ⇒ صف باطن واحد.
sub2 = lc.add_sub_contract(sub_party, k2, None, 300.0, "2026-01-01",
                           "2026-12-31", "باطن بلا قالب")
n2 = lc.distribute_sub_plan(sub2)
l2 = lc.sub_payment_plan(sub2)
check("عقد عميل بدفعة واحدة ⇒ سطر باطن واحد",
      n2 == 1 and len(l2) == 1
      and round(float(l2[0]["amount"]), 3) == 300.0,
      [(l.get("title"), l.get("amount")) for l in l2])
check("ومربوط بدفعة العميل الوحيدة",
      len(lc.get_sub_line_sources(l2[0]["id"])) == 1)

# عقد بلا أي خطة دفعات (حالة العقود القديمة) ⇒ سطر واحد بلا مصدر.
with get_connection() as c:
    c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k2,))
sub3 = lc.add_sub_contract(sub_party, k2, None, 100.0, "2026-01-01",
                           "2026-12-31", "باطن قديم")
n3 = lc.distribute_sub_plan(sub3)
l3 = lc.sub_payment_plan(sub3)
check("عقد عميل بلا أي دفعات ⇒ سطر أيام واحد بلا مصدر",
      n3 == 1 and len(l3) == 1 and l3[0]["stage_id"] is None
      and lc.get_sub_line_sources(l3[0]["id"]) == [],
      [(l.get("title"), l.get("stage_id")) for l in l3])

print("=" * 70)
print("② الواجهة: بلا أزرار مربكة — «دفعة العميل» إلزامية")
print("=" * 70)
from ui.subcontractors import SubPlanDialog  # noqa: E402
from ui.sub_plan_editor import SubPlanLineDialog  # noqa: E402

dlg = SubPlanDialog(None, sub)
app.processEvents()
_texts = [b.text() for b in dlg.findChildren(QPushButton)]
check("زر «مصادر الدفعة» أُزيل", "🔗 مصادر الدفعة" not in _texts, _texts)
check("زر التوزيع التلقائي موجود", "⚖ توزيع تلقائي" in _texts, _texts)
check("عمود «تحصيل العميل» بدل «المصادر»",
      dlg.table.horizontalHeaderItem(7).text() == "تحصيل العميل",
      dlg.table.horizontalHeaderItem(7).text())
check("الجدول بلا عمود «المصادر»",
      all("المصادر" != dlg.table.horizontalHeaderItem(i).text()
          for i in range(dlg.table.columnCount())))
check("قائمة «دفعة العميل» تحمل دفعات العقد (4)",
      dlg.payment.count() == 4, dlg.payment.count())
check("لا يوجد تاريخ استحقاق يدوي في النموذج",
      not dlg.findChildren(QDateEdit))
_er = []
_old_err = style.error
style.error = lambda *a, **k: _er.append(a[1] if len(a) > 1 else "")
dlg.payment.setCurrentIndex(-1)
dlg.title.setText("دفعة بلا ربط")
dlg.amount.setValue(50.0)
_before = dlg.table.rowCount()
dlg._add()
check("رفض الإضافة بلا دفعة عميل", dlg.table.rowCount() == _before
      and any("دفعة العميل" in str(e) for e in _er), _er)
dlg.payment.setCurrentIndex(0)
_check_title = dlg.title.text()
dlg._add()
check("الإضافة مع دفعة عميل تنجح",
      dlg.table.rowCount() == _before + 1
      and len(lc.sub_payment_plan(sub)) == 5,
      dlg.table.rowCount())
_new = [l for l in lc.sub_payment_plan(sub)
        if l["title"].startswith("دفعة بلا ربط")]
check("الربط التلقائي بدفعة العميل مصدرًا واحدًا",
      _new and [s["id"] for s in lc.get_sub_line_sources(_new[0]["id"])]
      == [_pid["الدفعة الأولى"]],
      [s["title"] for s in lc.get_sub_line_sources(_new[0]["id"])]
      if _new else None)
style.error = _old_err
dlg.close()

ld = SubPlanLineDialog(None, k)
check("نموذج السطر: بلا استحقاق يدوي", not ld.findChildren(QDateEdit))
ld.payment.setCurrentIndex(2)
check("عنوان الدفعة يُملأ من دفعة العميل",
      ld.title.text() == "الدفعة الثالثة", ld.title.text())
check("المرحلة والاستحقاق تلقائيان (مقفولان)",
      ld.stage_lbl.text() == "الكهرباء" and ld.due_lbl.text() == "2026-06-01",
      (ld.stage_lbl.text(), ld.due_lbl.text()))
ld.amount.setValue(50.0)
check("values() مشتقة من دفعة العميل",
      ld.values() == ("الدفعة الثالثة", "2026-06-01", 50.0,
                      _st.get("الكهرباء")),
      ld.values())
check("sources() = دفعة العميل المختارة",
      ld.sources() == [_pid["الدفعة الثالثة"]], ld.sources())
ld.close()

from ui.subcontractors import LinkSubContractDialog  # noqa: E402
ld2 = SubPlanLineDialog(None, k, line={"title": "قديمة", "amount": 10.0},
                        sources=[_pid["الدفعة الثانية"]])
check("التعديل يسترجع الدفعة المربوطة والاستحقاق",
      ld2.payment.selected_data() == _pid["الدفعة الثانية"]
      and ld2.due_lbl.text() == "2026-04-01"
      and ld2.title.text() == "قديمة",
      (ld2.payment.selected_data(), ld2.due_lbl.text(), ld2.title.text()))
ld2.close()

print("=" * 70)
print("③ سند الصرف: اسم العقد + البيان التلقائي")
print("=" * 70)
from ui.vouchers import VoucherDialog  # noqa: E402

vd = VoucherDialog(None, "payment")
vd.party_kind.setCurrentIndex(1)          # مقاول باطن
app.processEvents()
vd.party.select_data(int(sub_party))
vd._reload_sub_contracts(keep=False)
_items = vd._sub_contract_items()
_lbl = [t for t, v in _items if v == int(sub)]
check("قائمة عقد الباطن تعرض الاسم لا الرقم والمبلغ",
      _lbl and "عقد كامل" in _lbl[0] and "1,000.000" not in _lbl[0],
      _lbl)
vd.sub_contract.set_items(_items, auto_select=False)
vd.sub_contract.select_data(int(sub))
vd._toggle_sub_contract_row()
vd.amount.setValue(500.0)
vd._auto_description()
_d = vd.description.toPlainText()
check("البيان التلقائي لسند الصرف يعمل",
      _d.startswith("صرف") and "مقاول الباطن" in _d and "عقد كامل" in _d,
      _d)
check("البيان يوضح أنه سداد دفعة العميل",
      ("سداد الدفعة الأولى" in _d) and "500.000" in _d, _d)
vd.description.setPlainText("تعديل يدوي")
vd._auto_description()
check("لا يدوس على تعديل المستخدم",
      vd.description.toPlainText() == "تعديل يدوي",
      vd.description.toPlainText())
vd.close()

vd2 = VoucherDialog(None, "payment")
vd2.amount.setValue(100.0)
vd2._auto_description()
check("بلا عقد: لا بيان مُختلق", vd2.description.toPlainText() == "",
      vd2.description.toPlainText())
vd2.close()

vd3 = VoucherDialog(None, "receipt")
vd3.contract.set_items([("CON-61 · تجريبي", int(k))], auto_select=False)
vd3.contract.select_data(int(k))
vd3.amount.setValue(100.0)
vd3.link_due.setChecked(False)          # بلا ربط بدفعة ⇒ مسار V6.1 كما هو
vd3._auto_description()
check("سند القبض بلا ربط بدفعة: البيان القديم كما هو",
      vd3.description.toPlainText().startswith("رسوم سداد"),
      vd3.description.toPlainText())
vd3.link_due.setChecked(True)           # V6.2: مع الربط ⇒ البيان الموحّد
if vd3._due_rows:                       # V6.4: الاختيار يدوي
    vd3._select_due_row(0)
vd3._auto_description()
check("سند القبض مع ربط بدفعة: يتقدّم البيان الموحّد V6.2",
      (not vd3._due_rows
       or vd3.description.toPlainText().startswith("قبض الدفعة")),
      (len(vd3._due_rows), vd3.description.toPlainText()))
vd3.close()

check("دالة البيان المباشرة: صرف لمقاول باطن",
      xs.smart_payment_description(contract_id=k, sub_contract_id=sub,
                                   amount=100.0).startswith("صرف"))
check("دالة البيان المباشرة: صرف على عقد عميل",
      "صرف على" in xs.smart_payment_description(contract_id=k, amount=100.0))
check("دالة البيان المباشرة: بلا عقود ⇒ فارغ",
      xs.smart_payment_description(amount=100.0) == "")

print()
print(f"V6.1 client basis: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
