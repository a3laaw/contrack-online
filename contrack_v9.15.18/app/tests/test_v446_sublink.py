# -*- coding: utf-8 -*-
"""V4.46: الربط الخلفي لدفعات الباطن + لوحة المقارنة في الأب.

§1 حالة المصادر · §2 بوابة الاستحقاق (AND) · §3 حوار الباطن ·
§4 لوحة المقارنة.
"""
import os
import sys
import tempfile
from datetime import date
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v446_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.database import get_connection  # noqa: E402
from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import workflow_service as wf  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


auth_service.ensure_default_user()
auth_service.set_current_user("admin")
TODAY = date.today().isoformat()

c1 = customer_service.add_customer(Customer(
    customer_code="M46-001", name="عميل باطن", phone="50000000"))
k1 = contract_service.add_contract(Contract(
    contract_number="M46-CT-001", customer_id=c1,
    contract_name="عقد الربط الخلفي",
    contract_date=TODAY, amount=100000))
steps = sorted(
    [s for s in wf.get_contract_stages(k1) if s["level"] != 0],
    key=lambda s: (s.get("sort_order") or 0, s.get("id") or 0))

with get_connection() as conn:
    conn.execute(
        "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
        " stage_id) VALUES (?,?,?,?,?)",
        (k1, "دفعة مصدر 1", TODAY, 10000, steps[0]["id"]))
    conn.execute(
        "INSERT INTO payment_plan (contract_id, title, due_date, amount,"
        " stage_id) VALUES (?,?,?,?,?)",
        (k1, "دفعة مصدر 2", TODAY, 20000, steps[1]["id"]))
plan = lc.contract_payment_plan(k1)
C1 = next(x["id"] for x in plan if x["title"] == "دفعة مصدر 1")
C2 = next(x["id"] for x in plan if x["title"] == "دفعة مصدر 2")

sub_id = lc.add_subcontractor("M46-S1", "مقاول الربط", "50000001")
sc1 = lc.add_sub_contract(sub_id, k1, None, 25000)
L1 = lc.add_sub_plan_line(sc1, "دفعة مقاول 1", TODAY, 15000)
lc.set_sub_line_sources(L1, [C1, C2])

print("=== §1 حالة المصادر ===")
st = lc.sub_sources_status(sc1)
check("سطر واحد بحالتين", len(st) == 1 and L1 in st, str(st))
check("قبل الاكتمال: 0/2 وغير جاهز",
      st[L1]["total"] == 2 and st[L1]["done"] == 0
      and st[L1]["ready"] is False
      and st[L1]["pending"] == ["دفعة مصدر 1", "دفعة مصدر 2"],
      str(st[L1]))

print("\n=== §2 بوابة الاستحقاق (AND) ===")
wf.set_contract_manual_path(k1, True)
wf.manual_close_stage(k1, steps[0]["id"], TODAY)
st1 = lc.sub_sources_status(sc1)[L1]
check("بعد مصدر واحد: 1/2 وما زال غير جاهز",
      st1["done"] == 1 and st1["ready"] is False
      and st1["pending"] == ["دفعة مصدر 2"], str(st1))


def _sub_trig():
    with get_connection() as conn:
        row = conn.execute(
            "SELECT triggered_at FROM sub_payment_plan WHERE id=?",
            (L1,)).fetchone()
    return (row["triggered_at"] or "").strip()


check("دفعة الباطن لم تُستحق بمصدر ناقص", not _sub_trig(), _sub_trig())
wf.manual_close_stage(k1, steps[1]["id"], TODAY)
check("اكتملت المصادر فاستُحقت تلقائيًا", bool(_sub_trig()),
      _sub_trig())
check("الحالة: جاهز 2/2",
      lc.sub_sources_status(sc1)[L1]["ready"] is True)

print("\n=== §3 حوار الباطن ===")
from PySide6.QtWidgets import QApplication  # noqa: E402

from ui.subcontractors import SourcePickerDialog, SubPlanDialog  # noqa: E402

app = QApplication.instance() or QApplication([])
dlg = SubPlanDialog(None, sc1)
app.processEvents()
cell = dlg.table.item(0, 7)
# V6.1: العمود صار «تحصيل العميل» — نص واضح بدل رموز المصادر.
check("عمود تحصيل العميل يعرض ✓ محصّلة",
      cell and cell.text().strip() == "✓ محصّلة",
      cell.text() if cell else None)
check("تلميح الاكتمال", cell and "قابلة للاستحقاق" in cell.toolTip(),
      cell.toolTip() if cell else None)
L2 = lc.add_sub_plan_line(sc1, "دفعة مقاول 2", TODAY, 5000)
lc.set_sub_line_sources(L2, [C1])
with get_connection() as conn:
    conn.execute("UPDATE payment_plan SET triggered_at='', notes=''"
                 " WHERE id=?", (C1,))
    conn.execute("UPDATE sub_payment_plan SET triggered_at='', notes=''"
                 " WHERE id=?", (L1,))
dlg2 = SubPlanDialog(None, sc1)
app.processEvents()
texts = {(dlg2.table.item(r, 0).text()
          if dlg2.table.item(r, 0) else ""): (
          dlg2.table.item(r, 7).text()
          if dlg2.table.item(r, 7) else "")
         for r in range(dlg2.table.rowCount())}
check("سطر لم تُحصَّل دفعته يعرض ⏳",
      texts.get("دفعة مقاول 2", "").strip() == "⏳ لم تُحصَّل",
      str(texts))
pk = SourcePickerDialog(None, k1, [C1])
marks = [pk.list.item(i).text() for i in range(pk.list.count())]
check("الحوار يبين المستحقة والتقديرية",
      any("✓ مستحقة" in m for m in marks)
      and any("○ تقديرية" in m for m in marks), str(marks))
check("المعلمة مسبقًا محفوظة",
      C1 in [pk.list.item(i).data(0x0100)
             for i in range(pk.list.count())
             if pk.list.item(i).checkState().value == 2])

print("\n=== §4 لوحة المقارنة ===")
cmpd = lc.contract_payment_compare(k1)
check("مستحق العميل = المحرك فقط (تلقائية العقد + مصدر 2)",
      abs(cmpd["client"]["due"] - 120000.0) < 0.01
      and cmpd["client"]["collected"] == 0, str(cmpd["client"]))
check("صف مقاول واحد بسطرين ناقصين",
      len(cmpd["subs"]) == 1 and cmpd["subs"][0]["due"] == 0
      and cmpd["subs"][0]["waiting"] == 2, str(cmpd["subs"]))
with mock.patch.object(lc, "contract_payment_plan",
                       wraps=lc.contract_payment_plan):
    from ui.contract_hub import ContractHubPage  # noqa: E402

    hub = ContractHubPage(embedded=True)
    hub.load_contract(k1)
    hub._switch_page("pay")  # V4.5.06: التاب الموحد
    app.processEvents()
    check("شارة المسار اليدوي ظاهرة",
          "🔧 مسار يدوي" in hub.pay_mode_lbl.text()
          and "المنجز 2 من 8" in hub.pay_mode_lbl.text(),
          hub.pay_mode_lbl.text())
    # V4.5.07: جدولان — دفعاتنا على العميل، ودفعات المقاولين علينا
    # V6.5: جدول موحّد لكل مقاول — اسم المقاول في رأس مجموعة الكتلة،
    #       ودفعات العميل في العمود الأول من نفس الجدول
    ct, st_ = hub.client_table, hub.sub_table
    c_names = [ct.item(r, 0).text() for r in range(ct.rowCount())
               if ct.item(r, 0) and ct.item(r, 0).text().strip()]
    s_names = [b["title"] for b in hub._pay_blocks]
    for _tb in hub.pay_tables:
        for r in range(_tb.rowCount()):
            _it = _tb.item(r, 5) or _tb.item(r, 0)
            if _it is not None and _it.text().strip():
                s_names.append(_it.text())
    check("جدول العميل: دفعات الخطة",
          len(c_names) >= 3 and all(x.strip() for x in c_names), c_names)
    check("جدول المقاولين: مجموعة مقاول الربط",
          any("مقاول الربط" in x for x in s_names), s_names)
    wf.set_contract_manual_path(k1, False)
    hub.load_contract(k1)
    hub._switch_page("pay")
    app.processEvents()
    check("شارة المسار الإجباري بعد الرجوع",
          "📏 مسار إجباري" in hub.pay_mode_lbl.text(),
          hub.pay_mode_lbl.text())

print("")
print(f"V4.46 sublink: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
