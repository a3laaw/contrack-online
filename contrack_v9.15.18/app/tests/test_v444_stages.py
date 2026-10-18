# -*- coding: utf-8 -*-
"""V4.44: مراحل رئيسية بدفعاتها + دفعة مقاول مع كل مرحلة.

§1 خدمة المراحل · §2 التوزيع النسبي + المصدر · §3 الواجهة.
"""
import os
import sys
import tempfile
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v444_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.database import get_connection  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


cts.add_type("شامل44", pricing_mode="bundle")
cts.add_type("مقطوع44")
cts.add_type("شامل-قالب44", pricing_mode="bundle")
cts.clear_cache()
with get_connection() as conn:
    conn.execute("INSERT INTO customers (customer_code, name)"
                 " VALUES ('C44', 'عميل44')")
    conn.execute("INSERT INTO subcontractors (sub_code, name)"
                 " VALUES ('S44', 'مقاول44')")
    conn.execute("INSERT INTO contracts (contract_number, customer_id,"
                 " contract_date, amount, contract_type)"
                 " VALUES ('K44', 1, '2026-09-01', 10000.0, 'شامل44')")
    conn.execute("INSERT INTO contracts (contract_number, customer_id,"
                 " contract_date, amount, contract_type)"
                 " VALUES ('K45', 1, '2026-09-01', 10000.0, 'مقطوع44')")
    conn.execute("INSERT INTO contracts (contract_number, customer_id,"
                 " contract_date, amount, contract_type)"
                 " VALUES ('K46', 1, '2026-09-01', 10000.0, 'شامل-قالب44')")
    conn.execute("INSERT INTO type_payment_tpl (contract_type, pay_no,"
                 " title, pct) VALUES ('شامل-قالب44', 1, 'دفعة', 100.0)")


def raises_ve(fn):
    try:
        fn()
    except ValidationError as exc:
        return str(exc)
    return ""


print("=== 1. المراحل ===")
ids = lc.add_contract_main_stages(1, [
    {"name": "تأسيس", "amount": 6000.0, "days": 30},
    {"name": "تشطيب", "amount": 4000.0, "days": 60}])
check("مرحلتان", len(ids) == 2)
with get_connection() as conn:
    _st = [dict(r) for r in conn.execute(
        "SELECT * FROM contract_stages WHERE contract_id=1"
        " ORDER BY sort_order").fetchall()]
    _pl = [dict(r) for r in conn.execute(
        "SELECT * FROM payment_plan WHERE contract_id=1"
        " ORDER BY sort_order").fetchall()]
check("المراحل: رئيسية + نسبة + ترتيب",
      [_s["name"] for _s in _st] == ["تأسيس", "تشطيب"]
      and all(_s["level"] == 1 for _s in _st)
      and [_s["pay_pct"] for _s in _st] == [60.0, 40.0]
      and [_s["expected_days"] for _s in _st] == [30, 60])
check("الدفعات: عنوان + ربط + استحقاق",
      [_p["title"] for _p in _pl] == ["دفعة تأسيس", "دفعة تشطيب"]
      and [_p["stage_id"] for _p in _pl] == ids
      and [_p["due_date"] for _p in _pl]
      == ["2026-10-01", "2026-10-31"]
      and all(_p["manual_amount"] == 1 for _p in _pl))
check("المتبقي صفر",
      lc.manual_stages_remaining(1) == {"amount": 10000.0,
                                        "planned": 10000.0,
                                        "remaining": 0.0})
check("التجاوز مرفوض",
      "يتجاوز المتبقي" in raises_ve(
          lambda: lc.add_contract_main_stages(
              1, [{"name": "زائدة", "amount": 1.0, "days": 0}])))
check("غير الشامل مرفوض",
      "للعقد الشامل فقط" in raises_ve(
          lambda: lc.add_contract_main_stages(
              2, [{"name": "x", "amount": 1.0, "days": 0}])))
check("ذو القالب مرفوض",
      "بلا قالب" in raises_ve(
          lambda: lc.add_contract_main_stages(
              3, [{"name": "x", "amount": 1.0, "days": 0}])))
check("الفارغ يُتجاهل",
      lc.add_contract_main_stages(
          1, [{"name": "", "amount": 0, "days": 0}]) == [])

print("=== 2. التوزيع ===")
with get_connection() as conn:
    conn.execute("INSERT INTO contract_stages (contract_id, name, level,"
                 " parent_name, sort_order) VALUES (1, 'فرعية', 2,"
                 " 'تأسيس', 3)")
    _c1 = conn.execute("SELECT id FROM contract_stages WHERE name='فرعية'"
                       ).fetchone()["id"]
    conn.execute("UPDATE payment_plan SET amount=5000.0"
                 " WHERE contract_id=1 AND title='دفعة تأسيس'")
    conn.execute("INSERT INTO payment_plan (contract_id, title, due_date,"
                 " amount, sort_order, stage_id) VALUES (1, 'دفعة فرعية',"
                 " '2026-10-15', 1000.0, 3, ?)", (_c1,))
    conn.execute("INSERT INTO sub_contracts (subcontractor_id, contract_id,"
                 " amount, end_date) VALUES (1, 1, 5000.0, '2026-12-31')")
    conn.execute("INSERT INTO sub_contracts (subcontractor_id, contract_id,"
                 " amount) VALUES (1, 3, 2000.0)")
n = lc.distribute_sub_plan(1)
# V6.1: عقد العميل هو الأساس — صف لكل دفعة عميل (لا صف لكل مرحلة عامة).
check("ثلاث دفعات (دفعة تأسيس + دفعة فرعية + دفعة تشطيب)", n == 3)
lines = lc.sub_payment_plan(1)
check("النسب لا التساوي (5000/1000/4000 ← 2500/500/2000)",
      sorted(l["amount"] for l in lines) == [500.0, 2000.0, 2500.0]
      and round(sum(l["amount"] for l in lines), 3) == 5000.0,
      [(l["title"], l["amount"]) for l in lines])
_big = next(l for l in lines if l["amount"] == 2500.0)
_src = lc.get_sub_line_sources(_big["id"])
check("ربط 1:1 — كل صف مصدره دفعة عميل واحدة",
      [s["title"] for s in _src] == ["دفعة تأسيس"],
      [s["title"] for s in _src])
n2 = lc.distribute_sub_plan(2)
check("بلا مراحل ← سطر أيام واحد",
      n2 == 1 and lc.sub_payment_plan(2)[0]["stage_id"] is None
      and lc.sub_payment_plan(2)[0]["amount"] == 2000.0)
with get_connection() as conn:
    conn.execute("UPDATE sub_payment_plan SET triggered_at='2026-10-01'"
                 " WHERE id=?", (lines[0]["id"],))
check("المفعّل يمنع التوزيع",
      "قبل التفعيل" in raises_ve(lambda: lc.distribute_sub_plan(1)))

print("=== 3. الواجهة ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.contracts import ContractDialog  # noqa: E402
from ui.subcontractors import SubPlanDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
with get_connection() as conn:
    conn.execute("UPDATE sub_payment_plan SET triggered_at=''"
                 " WHERE sub_contract_id=1")
    conn.execute("DELETE FROM sub_payment_plan WHERE sub_contract_id=1")
    conn.execute("DELETE FROM sub_payment_sources")
dlg = SubPlanDialog(None, 1)
from PySide6.QtWidgets import QPushButton as _PB  # noqa: E402
check("زر التوزيع الجديد",
      any("توزيع تلقائي" in b.text()
          for b in dlg.findChildren(_PB)))
import ui.subcontractors as _submod  # noqa: E402

with mock.patch.object(_submod.style, "confirm", return_value=True), \
        mock.patch.object(_submod.style, "toast"):
    dlg._distribute()
# V6.1: التوزيع من الشاشة = صف لكل دفعة عميل (3 دفعات).
check("التوزيع من الشاشة",
      dlg.table.rowCount() == 3
      and {dlg.table.item(r, 3).text() for r in range(3)}
      == {"2,500.000", "500.000", "2,000.000"})
dlg.close()

from services import contract_service  # noqa: E402

con = contract_service.get_contract(1)
ed = ContractDialog(contract=con)
app.processEvents()
check("المحرر ظاهر للشامل",
      getattr(ed, "_mode", "") == "bundle"
      and not ed._stages_box.isHidden())
ed._add_manual_stage_row("ملحق", 500.0, 10)
check("الجمع والمتبقي",
      ed._manual_stage_rows()
      == [{"name": "ملحق", "amount": 500.0, "days": 10}]
      and "-500.000" in ed.stages_remaining.text(),
      ed.stages_remaining.text())
ed._drop_manual_stage_row(ed._stage_rows[0])
ed._save()
with get_connection() as conn:
    _n = conn.execute("SELECT COUNT(*) AS c FROM contract_stages"
                      " WHERE contract_id=1").fetchone()["c"]
check("الحفظ بلا صفوف = بلا مراحل جديدة", _n == 3)
ed2 = ContractDialog(contract=contract_service.get_contract(2))
app.processEvents()
check("مخفي لغير الشامل", ed2._stages_box.isHidden())

print("")
print(f"V4.44 stages: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
