# -*- coding: utf-8 -*-
"""V6.2 (الجزءان ٢ و٣): ربط سند القبض والصرف بالدفعات المستحقة — منطق مشترك.

① المستحقة فقط (مرحلتها وصلت وباقي عليها) · الافتراضي أقدم دفعة · التعبئة
   التلقائية للبيان/المبلغ · الحالات: جزئي/مدفوع/أكبر من المتبقي.
② الحفظ والرجوع: الربط بعلاقة id · transaction واحد · الإلغاء يرجّع الحالة ·
   idempotent · منع ربط غير المستحقة/المدفوعة.
③ سند الصرف: يظهر لمقاول الباطن فقط · بوابة «تحصيل العميل» باهتة + تلميح ·
   منع الصرف قبل التحصيل.

كل الاختبارات على قاعدة مؤقتة — لا تمس أي بيانات حقيقية.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["HOME"] = tempfile.mkdtemp()
import database.database as db  # noqa: E402

_t = tempfile.mkdtemp(prefix="v62vl_")
db.DATA_DIR = _t
db.DB_PATH = os.path.join(_t, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication  # noqa: E402
app = QApplication.instance() or QApplication(sys.argv)
from ui import style  # noqa: E402

_ERRORS = []
for _n in ("info", "toast", "success", "warning"):
    setattr(style, _n, lambda *a, **k: None)
style.error = lambda *a, **k: _ERRORS.append(str(a[1] if len(a) > 1 else a))
style.confirm = lambda *a, **k: True
style.require_admin = lambda *a, **k: True

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service, contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import voucher_payment_link_service as vpl  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402
import ui.vouchers as uv  # noqa: E402
from ui.vouchers import VoucherDialog  # noqa: E402

uv._preview_saved_vouchers = lambda *a, **k: None
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


def _line(kind, **kw):
    """مفتاح = رقم الدفعة (1 = الأولى…) — لا نفترض قيم ids الصفوف."""
    return {int(r["number"]): r for r in vpl.plan_rows(kind, **kw)}


def _links_of(voucher_id):
    with get_connection() as c:
        return [dict(r) for r in c.execute(
            "SELECT line_id, amount, kind FROM voucher_payment_links "
            "WHERE voucher_id=?", (int(voucher_id),)).fetchall()]


# ============ التهيئة ============
cust = cs.add_customer(Customer(customer_code="C-V62", name="عميل السندات",
                                phone="9000622"))
k = ks.add_contract(Contract(
    contract_number="CON-0231", customer_id=cust, contract_date="2026-01-01",
    contract_type="", description="عقد السندات", amount=10000.0),
    manual_path=True)
with get_connection() as c:
    c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k,))
    plan = [("الدفعة الأولى", "2026-01-01", 1000.0),
            ("الدفعة الثانية", "2026-11-01", 2000.0),
            ("الدفعة الثالثة", "2026-12-01", 2000.0),
            ("الدفعة الرابعة", "2026-04-01", 2000.0),
            ("الدفعة الخامسة", "2027-01-01", 3000.0)]
    for i, (t, d, a) in enumerate(plan, 1):
        c.execute("INSERT INTO payment_plan (contract_id, title, due_date, "
                  "amount, sort_order) VALUES (?,?,?,?,?)", (k, t, d, a, i))
    c.execute("INSERT INTO subcontractors (sub_code, name, phone) VALUES "
              "(?,?,?)", ("S-V62", "سمير", "1"))
    sub_party = int(c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                              ("S-V62",)).fetchone()["id"])

def _save_blocked(d):
    """V6.4: «نعم» بلا دفعة محددة يدويًا ⇒ لا يُنشأ سند + رسالة واضحة."""
    try:
        if d.method.count():
            d.method.setCurrentIndex(0)
        if hasattr(d, "expense_account") and d.vtype == "payment" \
                and not d.expense_account.selected_data():
            d.expense_account.setCurrentIndex(0)
        if d.amount.value() <= 0:
            d.amount.setValue(1.0)
    except Exception:
        pass
    with get_connection() as _c:
        _n0 = int(_c.execute("SELECT COUNT(*) FROM vouchers WHERE vtype=?",
                             (d.vtype,)).fetchone()[0])
    _ERRORS.clear()
    try:
        d._save()
    except Exception:
        pass
    with get_connection() as _c:
        _n1 = int(_c.execute("SELECT COUNT(*) FROM vouchers WHERE vtype=?",
                             (d.vtype,)).fetchone()[0])
    return _n1 == _n0 and any("اختر دفعة مستحقة" in str(m)
                              or "اختر الدفعة" in str(m) for m in _ERRORS)


print("=" * 70)
print("① المستحقة فقط + الاختيار اليدوي + التعبئة بعده + الحالات")
print("=" * 70)
check("بوابة تحصيل العميل مفعّلة افتراضيًا", vpl.gate_enabled() is True)
_before = ks.get_contract(k)
print("   (عقد بقيمة 10,000 · 5 دفعات)")

rows = vpl.plan_rows("receipt", contract_id=k)
eli = [r["number"] for r in rows if r["eligible"]]
check("المستحق = الأولى والرابعة فقط (من 5 دفعات)", eli == [1, 4], eli)
check("الافتراضي = أقدم دفعة مستحقة (الأولى)",
      int(vpl.default_line(vpl.due_lines("receipt", contract_id=k))["number"])
      == 1)
_r4 = next(r for r in rows if int(r["number"]) == 4)
check("البيان الموحّد: «قبض الدفعة الرابعة – ... – العقد CON-0231»",
      vpl.describe("receipt", _r4, contract_number="CON-0231")
      == "قبض الدفعة الرابعة – العقد CON-0231",
      vpl.describe("receipt", _r4, contract_number="CON-0231"))

dlg = VoucherDialog(None, "receipt", preset_contract_id=k)
check("خانة «ربط بدفعة مستحقة؟» ظاهرة ومفعّلة افتراضيًا",
      (not dlg.link_due.isHidden()) and dlg.link_due.isChecked())
check("جدول المستحقة يعرض الدفعتين فقط", dlg.due_table.rowCount() == 2,
      dlg.due_table.rowCount())
check("V6.4: لا تحديد تلقائي — الاختيار يدوي (لا دفعة محددة بلا لمس)",
      dlg._picked_line is None, dlg._picked_line)
check("تلميحة الاختيار اليدوي ظاهرة تحت الجدول",
      "اضغط على سطر الدفعة" in dlg.due_info.text(), dlg.due_info.text())
check("الحفظ قبل الاختيار مرفوض برسالة واضحة", _save_blocked(dlg))
_i1 = next(i for i, r in enumerate(dlg._due_rows)
           if int(r["number"]) == 1)
dlg._select_due_row(_i1)
check("اختيار الدفعة الأولى يدويًا يعبّئ البيان",
      "قبض الدفعة الأولى" in dlg.description.toPlainText(),
      dlg.description.toPlainText())
_i4 = next(i for i, r in enumerate(dlg._due_rows)
           if int(r["number"]) == 4)
dlg._select_due_row(_i4)
check("تغيير الدفعة يحدّث البيان فورًا",
      "قبض الدفعة الرابعة" in dlg.description.toPlainText(),
      dlg.description.toPlainText())
check("المبلغ الافتراضي = المتبقي (2,000)",
      abs(dlg.amount.value() - 2000.0) < 0.001, dlg.amount.value())
check("سطر معلومات الدفعة يعرض الرقم والمرحلة والمتبقي",
      "رقم 4" in dlg.due_info.text() and "المتبقي" in dlg.due_info.text(),
      dlg.due_info.text())

print()
print("=" * 70)
print("② الحفظ والرجوع: العلاقة بالـid · الإلغاء يرجّع · idempotent")
print("=" * 70)
dlg.method.setCurrentIndex(0)
dlg._save()
with get_connection() as c:
    vid4 = int(c.execute("SELECT id FROM vouchers WHERE vtype='receipt' "
                         "AND contract_id=? ORDER BY id DESC LIMIT 1",
                         (k,)).fetchone()["id"])
_l = _line("receipt", contract_id=k)
check("الربط اتخزن كعلاقة (id) للدفعة الرابعة",
      _links_of(vid4) and int(_links_of(vid4)[0]["line_id"]) == _l[4]["line_id"],
      _links_of(vid4))
check("الدفعة الرابعة أصبحت «مدفوع» والمتبقي صفر",
      _l[4]["status"] == "مدفوع" and _l[4]["remaining"] <= 0.001,
      (_l[4]["status"], _l[4]["remaining"]))
check("الدفعة الأولى لم تتأثر (المتبقي 1,000)",
      abs(_l[1]["remaining"] - 1000.0) < 0.001, _l[1]["remaining"])

lc.cancel_voucher(vid4, "إلغاء اختبار")
_l = _line("receipt", contract_id=k)
check("إلغاء السند يرجّع الدفعة لحالتها السابقة",
      _l[4]["status"] in ("متأخر", "مستحقة")
      and abs(_l[4]["remaining"] - 2000.0) < 0.001, _l[4])

# جزئي ثم مدفوع
d2 = VoucherDialog(None, "receipt", preset_contract_id=k)
d2._select_due_row(next(i for i, r in enumerate(d2._due_rows)
                            if int(r["number"]) == 4))
d2.amount.setValue(500.0)
d2.method.setCurrentIndex(0)
d2._save()
_l = _line("receipt", contract_id=k)
check("مبلغ أقل من المتبقي ⇒ تغطية جزئية (المتبقي 1,500)",
      abs(_l[4]["remaining"] - 1500.0) < 0.001,
      (_l[4]["status"], _l[4]["remaining"]))
# سلوك V4.5.03 محفوظ عن قصد: دفعة متأخرة بتغطية جزئية تبقى «متأخر»
check("دفعة متأخرة جزئية تبقى «متأخر» (حفاظًا على تنبيهات التأخير)",
      _l[4]["status"] == "متأخر", _l[4]["status"])

# أكبر من المتبقي: إلزامية الاختيار
uv._ask_extra_handling = lambda parent, excess, next_title="": ""
_cnt_before = len(_links_of(0)) if False else None
with get_connection() as c:
    _n_before = int(c.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='receipt' "
                              "AND contract_id=?", (k,)).fetchone()[0])
_ERRORS.clear()
d3 = VoucherDialog(None, "receipt", preset_contract_id=k)
d3._select_due_row(next(i for i, r in enumerate(d3._due_rows)
                            if int(r["number"]) == 4))
d3.amount.setValue(9000.0)
d3.method.setCurrentIndex(0)
d3._save()
with get_connection() as c:
    _n_after = int(c.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='receipt' "
                             "AND contract_id=?", (k,)).fetchone()[0])
check("لا يتحفظ بدون قرار للزيادة (تنبيه إلزامي)",
      _n_after == _n_before and _ERRORS
      and "أكبر من متبقي الدفعة" in _ERRORS[-1], _ERRORS)
d3.close()

# التوزيع على الدفعة التالية (الأولى 1000 متبقية ولها تالية الرابعة)
uv._ask_extra_handling = lambda parent, excess, next_title="": "spread"
d4 = VoucherDialog(None, "receipt", preset_contract_id=k)
d4._select_due_row(next(i for i, r in enumerate(d4._due_rows)
                            if int(r["number"]) == 1))
d4.amount.setValue(1500.0)
d4.method.setCurrentIndex(0)
d4._save()
with get_connection() as c:
    _vidsp = int(c.execute("SELECT id FROM vouchers WHERE vtype='receipt' "
                           "AND contract_id=? ORDER BY id DESC LIMIT 1",
                           (k,)).fetchone()["id"])
_sp = sorted((int(x["line_id"]), float(x["amount"]))
             for x in _links_of(_vidsp))
_l = _line("receipt", contract_id=k)
check("الزيادة اتوزعت على الدفعة المستحقة التالية بالترتيب",
      _sp == sorted([(_l[1]["line_id"], 1000.0), (_l[4]["line_id"], 500.0)]),
      _sp)
check("الأولى صارت مدفوعًا والرابعة انخفض متبقيها إلى 1,000",
      _l[1]["status"] == "مدفوع" and abs(_l[4]["remaining"] - 1000.0) < 0.001,
      (_l[1]["status"], _l[4]["remaining"]))

# رصيد/سلفة: الرابعة (متبقي 1000) بمبلغ 1600 ⇒ الزيادة 600 رصيد
uv._ask_extra_handling = lambda parent, excess, next_title="": "advance"
d5 = VoucherDialog(None, "receipt", preset_contract_id=k)
d5._select_due_row(next(i for i, r in enumerate(d5._due_rows)
                            if int(r["number"]) == 4))
d5.amount.setValue(1600.0)
d5.method.setCurrentIndex(0)
d5._save()
with get_connection() as c:
    _r5 = c.execute("SELECT id, COALESCE(advance_amount,0) AS a FROM vouchers "
                    "WHERE vtype='receipt' AND contract_id=? "
                    "ORDER BY id DESC LIMIT 1", (k,)).fetchone()
check("زيادة بلا دفعة تالية ⇒ تُسجَّل رصيدًا/سلفة على السند",
      abs(float(_r5["a"]) - 600.0) < 0.001, float(_r5["a"]))

cnt = None
try:
    lc.add_voucher("receipt", "2026-10-07", "عميل السندات", "نقدًا", "البنك",
                   500.0, "ربط بدفعة غير مستحقة", contract_id=k,
                   party_type="customer", party_id=cust,
                   payment_link={"selections": [(_l[2]["line_id"], 500.0)]})
except ValidationError as exc:
    cnt = str(exc)
check("منع الربط بدفعة غير مستحقة/مدفوعة بالكامل", cnt is not None, cnt)

# idempotent: تعديل السند بنفس الربط مرتين ⇒ صف واحد لكل دفعة
lc.update_voucher(_vidsp, "2026-10-07", "نقدًا", 1500.0,
                  "قبض الدفعة الأولى – العقد CON-0231",
                  contract_id=k, party_type="customer", party_id=cust,
                  payment_links=[(_l[1]["line_id"], 1000.0),
                                 (_l[4]["line_id"], 500.0)])
lc.update_voucher(_vidsp, "2026-10-07", "نقدًا", 1500.0,
                  "قبض الدفعة الأولى – العقد CON-0231",
                  contract_id=k, party_type="customer", party_id=cust,
                  payment_links=[(_l[1]["line_id"], 1000.0),
                                 (_l[4]["line_id"], 500.0)])
_sp2 = _links_of(_vidsp)
check("إعادة الحفظ لا تُكرّر الربط (idempotent)",
      len(_sp2) == 2 and len({int(x["line_id"]) for x in _sp2}) == 2, _sp2)

print()
print("=" * 70)
print("③ سند الصرف: للمقاول فقط + بوابة تحصيل العميل")
print("=" * 70)
# إلغاء سند السلفة يرجّع دفعة العميل الرابعة لمتبقٍ 1,000 ⇒ بوابة المقاول
# المقابلة تبقى موقوفة — وهو وضع الاختبار المقصود هنا.
lc.cancel_voucher(int(_r5["id"]), "اختبار البوابة")
sub = lc.add_sub_contract(sub_party, k, None, 5000.0, "2026-01-01",
                          "2026-12-31", "باطن سمير")
lc.distribute_sub_plan(sub)
srows = vpl.plan_rows("payment", sub_contract_id=sub)
_seli = [r["number"] for r in srows if r["eligible"]]
check("دفعات المقاول المستحقة من عقد الباطن (الأولى والرابعة)",
      _seli == [1, 4], _seli)
_s4g = next(r for r in srows if int(r["number"]) == 4)
check("البوابة: دفعة المقاول الرابعة موقوفة بانتظار تحصيل دفعة العميل",
      _s4g["gated"] and "تحصيل" in _s4g["gate_reason"], _s4g["gate_reason"])
with get_connection() as _c:
    _np_before = int(_c.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='payment' "
                                "AND sub_contract_id=?", (sub,)).fetchone()[0])
try:
    _err = None
    lc.add_voucher("payment", "2026-10-07", "سمير", "نقدًا", "مصروف",
                   100.0, "دفعة موقوفة", contract_id=k,
                   party_type="subcontractor", party_id=sub_party,
                   sub_contract_id=sub,
                   payment_link={"selections": [(_s4g["line_id"],
                                                 _s4g["remaining"])]})
except ValidationError as exc:
    _err = str(exc)
check("منع الصرف قبل تحصيل دفعة العميل المقابلة", _err is not None, _err)
with get_connection() as _c:
    _np_after = int(_c.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='payment' "
                               "AND sub_contract_id=?", (sub,)).fetchone()[0])
check("المنع لا يحفظ سندًا ناقصًا (معاملة واحدة)",
      _np_after == _np_before, (_np_before, _np_after))

vpl.set_gate(False)
srows = vpl.plan_rows("payment", sub_contract_id=sub)
_s4g = next(r for r in srows if int(r["number"]) == 4)
check("إيقاف البوابة من الإعدادات يفتح الدفعات", not _s4g["gated"])
_s1 = srows[0]
vid_s1 = lc.add_voucher("payment", "2026-10-07", "سمير", "نقدًا",
                        "مصروف تشغيلي", _s1["remaining"], "صرف الدفعة الأولى",
                        contract_id=k, party_type="subcontractor",
                        party_id=sub_party, sub_contract_id=sub,
                        payment_link={"selections": [(_s1["line_id"],
                                                      _s1["remaining"])]})
_sl = _line("payment", sub_contract_id=sub)
check("سند الصرف يسدّد دفعة المقاول الأولى",
      _sl[1]["status"] == "مدفوع", _sl[1]["status"])
vpl.set_gate(True)

# تحصيل دفعة العميل الرابعة بالكامل ⇒ تُفتح دفعة المقاول المقابلة
_l = _line("receipt", contract_id=k)
lc.add_voucher("receipt", "2026-10-07", "عميل السندات", "نقدًا", "البنك",
               1000.0, "تحصيل الدفعة الرابعة", contract_id=k,
               party_type="customer", party_id=cust,
               payment_link={"selections": [(_l[4]["line_id"], 1000.0)]})
srows = vpl.plan_rows("payment", sub_contract_id=sub)
_s4 = next(r for r in srows if int(r["number"]) == 4)
check("بعد تحصيل العميل: دفعة المقاول الرابعة غير موقوفة",
      _s4["eligible"] and not _s4["gated"], (_s4["eligible"], _s4["gated"]))

d6 = VoucherDialog(None, "payment", preset_subcontractor_id=sub_party,
                   preset_sub_contract_id=sub)
check("خانة الربط تظهر في سند الصرف للمقاول",
      (not d6.link_due.isHidden()) and d6.link_due.isChecked(),
      d6.link_due.isHidden())
check("جدول الدفعات = الدفعة الرابعة فقط (الأولى مدفوعة)",
      d6.due_table.rowCount() == 1 and d6._picked_line is None,
      (d6.due_table.rowCount(), d6._picked_line))
check("V6.4: الحفظ قبل الاختيار اليدوي مرفوض", _save_blocked(d6))
d6._select_due_row(0)
check("البيان التلقائي لسند الصرف يحمل رقم الدفعة والمقاول",
      "صرف الدفعة الرابعة" in d6.description.toPlainText()
      and "سمير" in d6.description.toPlainText()
      and "باطن" in d6.description.toPlainText(),
      d6.description.toPlainText())
d6.expense_account.setCurrentIndex(0)
d6.method.setCurrentIndex(0)
d6._save()
_sl = _line("payment", sub_contract_id=sub)
_with_links = _sl
check("دفعة المقاول الرابعة اتسدّدت بالربط",
      _with_links[4]["status"] == "مدفوع", _with_links[4]["status"])
with get_connection() as c:
    _vidp = int(c.execute("SELECT id FROM vouchers WHERE vtype='payment' AND "
                          "sub_contract_id=? ORDER BY id DESC LIMIT 1",
                          (sub,)).fetchone()["id"])
check("الربط مخزّن لدفعة المقاول (id)",
      _links_of(_vidp)
      and int(_links_of(_vidp)[0]["line_id"]) == _s4["line_id"],
      _links_of(_vidp))
lc.cancel_voucher(_vidp, "إلغاء اختبار")
_sl = _line("payment", sub_contract_id=sub)
check("إلغاء سند الصرف يرجّع دفعة المقاول",
      _sl[4]["status"] != "مدفوع", _sl[4]["status"])

print()
print("=" * 70)
print("④ V6.3: البيان والملاحظة يتبعان الدفعة المختارة · لا حفظ صامت")
print("=" * 70)
# مرحلتان لعقد العميل + دفعتان مفعّلتان — ليكون اختيار الدفعة مرئي الأثر
with get_connection() as c:
    for _i, _nm in enumerate(("الدور الأول", "تمديد بيايات الكهرباء"), 1):
        c.execute("INSERT INTO contract_stages (contract_id, name, sort_order) "
                  "VALUES (?,?,?)", (k, _nm, _i))
with get_connection() as c:
    _st_rows = {r["name"]: int(r["id"]) for r in c.execute(
        "SELECT id, name FROM contract_stages WHERE contract_id=? "
        "AND name IN ('الدور الأول','تمديد بيايات الكهرباء')", (k,))}
_p2 = next(r["line_id"] for r in vpl.plan_rows("receipt", contract_id=k)
           if int(r["number"]) == 2)
_p5 = next(r["line_id"] for r in vpl.plan_rows("receipt", contract_id=k)
           if int(r["number"]) == 5)
with get_connection() as c:
    c.execute("UPDATE payment_plan SET stage_id=?, triggered_at='2026-10-01' "
              "WHERE id=?", (_st_rows.get("الدور الأول"), _p2))
    c.execute("UPDATE payment_plan SET stage_id=?, triggered_at='2026-10-01' "
              "WHERE id=?", (_st_rows.get("تمديد بيايات الكهرباء"), _p5))

d8 = VoucherDialog(None, "receipt", preset_contract_id=k)
print("   (الدفعات المؤهلة في الجدول:",
      [(r["number"], r["stage"]) for r in d8._due_rows], ")")
check("V6.4: بلا تحديد تلقائي في جدول المستحقة",
      d8._picked_line is None, d8._picked_line)
_i2 = next(i for i, r in enumerate(d8._due_rows) if int(r["number"]) == 2)
d8._select_due_row(_i2)
check("بعد الاختيار اليدوي: البيان الموحّد يشمل نص المرحلة (V6.3)",
      "تمديد بيايات الكهرباء" in d8.description.toPlainText()
      or "الدور الأول" in d8.description.toPlainText(),
      d8.description.toPlainText())
check("الملاحظة «مرحلة العمل» تتبع الدفعة المختارة يدويًا",
      "مرحلة العمل:" in d8.notes.text(), d8.notes.text())
_i5 = next(i for i, r in enumerate(d8._due_rows) if int(r["number"]) == 5)
d8._select_due_row(_i5)
check("تغيير الدفعة يحدّث البيان فورًا بالمرحلة الجديدة",
      "تمديد بيايات الكهرباء" in d8.description.toPlainText(),
      d8.description.toPlainText())
check("تغيير الدفعة يحدّث «مرحلة العمل» فورًا",
      "تمديد بيايات الكهرباء" in d8.notes.text(), d8.notes.text())
d8.close()

# لا حفظ صامت: خانة «نعم» بلا أي دفعة قابلة للربط
# (نسدّد ما تبقّى من دفعة المقاول الرابعة أولًا فلا تبقى دفعة مؤهّلة)
vpl.set_gate(False)
_s4c = next(r for r in vpl.plan_rows("payment", sub_contract_id=sub)
            if int(r["number"]) == 4)
lc.add_voucher("payment", "2026-10-07", "سمير", "نقدًا", "مصروف تشغيلي",
               _s4c["remaining"], "تصفية ما تبقّى من الدفعة الرابعة",
               contract_id=k, party_type="subcontractor", party_id=sub_party,
               sub_contract_id=sub,
               payment_link={"selections": [(_s4c["line_id"],
                                             _s4c["remaining"])]})
vpl.set_gate(True)
d9 = VoucherDialog(None, "payment", preset_subcontractor_id=sub_party,
                   preset_sub_contract_id=sub)
d9.expense_account.setCurrentIndex(0)
d9.method.setCurrentIndex(0)
d9.amount.setValue(50.0)
d9.link_due.setChecked(True)          # المستخدم يفرض «نعم» بلا دفعات
with get_connection() as _c9:
    _np9 = int(_c9.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='payment' "
                           "AND sub_contract_id=?", (sub,)).fetchone()[0])
_ERRORS.clear()
d9._save()
with get_connection() as _c9:
    _np9b = int(_c9.execute("SELECT COUNT(*) FROM vouchers WHERE vtype='payment' "
                            "AND sub_contract_id=?", (sub,)).fetchone()[0])
check("«نعم» بلا دفعات قابلة للربط ⇒ لا يُحفظ بصمت + رسالة واضحة",
      _np9b == _np9 and _ERRORS
      and "لا توجد دفعات مستحقة للربط" in _ERRORS[-1], _ERRORS[-1:])
check("سطر السبب ظاهر للمستخدم بدل الإخفاء الصامت",
      "لا توجد دفعات مستحقة للربط" in d9.due_info.text(), d9.due_info.text())
d9.close()

print()
print("=" * 70)
print("⑤ V6.3: سند الصرف — التحديث التلقائي عند اختيار الدفعة (مثل سند القبض)")
print("=" * 70)
with get_connection() as c:
    c.execute("UPDATE sub_payment_plan SET stage_id=?, triggered_at='2026-10-01' "
              "WHERE sub_contract_id=? AND title='الدفعة الثانية'",
              (_st_rows.get("الدور الأول"), sub))
    c.execute("UPDATE sub_payment_plan SET stage_id=?, triggered_at='2026-10-01' "
              "WHERE sub_contract_id=? AND title='الدفعة الخامسة'",
              (_st_rows.get("تمديد بيايات الكهرباء"), sub))
_l2 = next(r for r in vpl.plan_rows("receipt", contract_id=k)
           if int(r["number"]) == 2)
lc.add_voucher("receipt", "2026-10-07", "عميل السندات", "نقدًا", "البنك",
               _l2["remaining"], "تحصيل الدفعة الثانية", contract_id=k,
               party_type="customer", party_id=cust,
               payment_link={"selections": [(_l2["line_id"],
                                             _l2["remaining"])]})
d10 = VoucherDialog(None, "payment", preset_subcontractor_id=sub_party,
                    preset_sub_contract_id=sub)
d10.expense_account.setCurrentIndex(0)
d10.method.setCurrentIndex(0)
print("   (دفعات المقاول المتاحة:",
      [(r["number"], r["stage"] or "—", r["remaining"], r["gated"])
       for r in d10._due_rows], ")")
check("سند الصرف: بلا تحديد تلقائي — الاختيار يدوي (V6.4)",
      d10._picked_line is None, d10._picked_line)
check("سند الصرف: الحفظ قبل الاختيار مرفوض", _save_blocked(d10))
_i2p = next(i for i, r in enumerate(d10._due_rows)
            if int(r["number"]) == 2)
d10._select_due_row(_i2p)
check("سند الصرف: بعد الاختيار اليدوي — البيان يحمل الرقم والمرحلة والمقاول",
      "صرف الدفعة الثانية" in d10.description.toPlainText()
      and "الدور الأول" in d10.description.toPlainText()
      and "سمير" in d10.description.toPlainText(),
      d10.description.toPlainText())
check("سند الصرف: المبلغ = متبقي الدفعة المختارة يدويًا",
      abs(d10.amount.value()
          - float(d10._picked_line["remaining"])) < 0.001,
      d10.amount.value())
_s5g = next(r for r in d10._due_rows if int(r["number"]) == 5)
check("بوابة العميل: دفعة المقاول الخامسة موقوفة قبل تحصيل نظيرها",
      _s5g["gated"] and "تحصيل" in _s5g["gate_reason"],
      _s5g["gate_reason"])
# تحصيل دفعة العميل الخامسة ⇒ يُفتح سطر المقاول الخامس فتتاح دفعتان للتبديل
_l5 = next(r for r in vpl.plan_rows("receipt", contract_id=k)
           if int(r["number"]) == 5)
lc.add_voucher("receipt", "2026-10-07", "عميل السندات", "نقدًا", "البنك",
               _l5["remaining"], "تحصيل الدفعة الخامسة", contract_id=k,
               party_type="customer", party_id=cust,
               payment_link={"selections": [(_l5["line_id"],
                                             _l5["remaining"])]})
d10b = VoucherDialog(None, "payment", preset_subcontractor_id=sub_party,
                     preset_sub_contract_id=sub)
d10b.expense_account.setCurrentIndex(0)
d10b.method.setCurrentIndex(0)
print("   (بعد التحصيل:",
      [(r["number"], r["stage"] or "—", r["remaining"], r["gated"])
       for r in d10b._due_rows], ")")
_i5p = next(i for i, r in enumerate(d10b._due_rows)
            if int(r["number"]) == 5)
d10b._select_due_row(_i5p)
check("سند الصرف: تغيير الدفعة يحدّث البيان فورًا (الرقم + المرحلة)",
      "صرف الدفعة الخامسة" in d10b.description.toPlainText()
      and "تمديد بيايات الكهرباء" in d10b.description.toPlainText()
      and "سمير" in d10b.description.toPlainText(),
      d10b.description.toPlainText())
check("سند الصرف: تغيير الدفعة يحدّث المبلغ فورًا (1,500)",
      abs(d10b.amount.value() - 1500.0) < 0.001, d10b.amount.value())
check("سند الصرف: سطر معلومات الدفعة يعرض الرقم والمتبقي",
      "رقم 5" in d10b.due_info.text() and "المتبقي" in d10b.due_info.text(),
      d10b.due_info.text())
check("سند الصرف يفتح بحجم كافٍ لرؤية كل الأقسام (بلا تكبير يدوي)",
      d10b.minimumWidth() >= 600 and d10b.width() >= 600
      and d10b.height() >= 500,
      (d10b.minimumWidth(), d10b.width(), d10b.height()))
d10b.close()
d10.close()

d7 = VoucherDialog(None, "payment", preset_subcontractor_id=sub_party,
                   preset_sub_contract_id=sub)
d7.party_kind.setCurrentIndex(d7.party_kind.findData(""))  # مصروف عام/مورد
d7._reload_due()
check("الخانة تختفي لو السند لمصروف عام/مورد (بلا مقاول)",
      d7.link_due.isHidden())
d7.close()
d6.close()
d2.close()
d4.close()
d5.close()
dlg.close()

print(f"\nV6.2 voucher links: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
