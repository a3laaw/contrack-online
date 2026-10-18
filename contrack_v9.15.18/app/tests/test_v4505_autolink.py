# -*- coding: utf-8 -*-
"""V4.5.05: (أ) الإنهاء اليدوي يبث changed (تحديث الدفعات/المقارنة فورًا).

(ب) ربط دفعات الباطن عند الإنشاء: فحص الشروط + توزيع وربط تلقائي.
"""
import os
import sys

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
from services import customer_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
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


cust = customer_service.add_customer(
    Customer(customer_code="C-4505", name="عميل 4505", phone="90004505"))
with get_connection() as c:
    c.execute("INSERT INTO subcontractors (sub_code, name, phone)"
              " VALUES (?,?,?)", ("S-4505", "باطن 4505", "1"))
    sub_id = c.execute("SELECT id FROM subcontractors WHERE sub_code=?",
                       ("S-4505",)).fetchone()["id"]

print("=== 1. فحص الشروط: عقد بلا مراحل ولا خطة ===")
k0 = cs.add_contract(Contract(
    contract_number="CON-4505E", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4505E",
    description="x", amount=100.0), manual_path=True)
g0 = lc.sub_plan_autolink_guard(k0)
check("نقصان مذكوران", len(g0) == 2, g0)

print("=== 2. فحص الشروط: مراحل بلا خطة عميل ===")
wf.add_stage("contract", "مرحلة وحيدة 4505", contract_type="T4505P")
k1 = cs.add_contract(Contract(
    contract_number="CON-4505P", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4505P",
    description="x", amount=100.0), manual_path=True)
with get_connection() as c:  # محاكاة: مراحل بلا خطة عميل
    c.execute("DELETE FROM payment_plan WHERE contract_id=?", (k1,))
g1 = lc.sub_plan_autolink_guard(k1)
check("نقص واحد (خطة العميل)", len(g1) == 1 and "العميل" in g1[0], g1)

print("=== 3. عقد مكتمل: التوزيع يربط المصادر تلقائيًا ===")
s1 = wf.add_stage("contract", "مرحلة أولى 4505", contract_type="T4505")
s2 = wf.add_stage("contract", "مرحلة ثانية 4505", contract_type="T4505")
with get_connection() as c:
    for i, s in ((1, s1), (2, s2)):
        c.execute(
            "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
            " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
            ("T4505", i, f"دفعة {i}", 0, 100.0, s))
k2 = cs.add_contract(Contract(
    contract_number="CON-4505", customer_id=cust,
    contract_date="2026-01-01", contract_type="T4505",
    description="x", amount=200.0), manual_path=True)
check("الشروط مكتملة", lc.sub_plan_autolink_guard(k2) == [])
sub2 = lc.add_sub_contract(sub_id, k2, None, 200.0, description="باطن")
n = lc.distribute_sub_plan(sub2)
with get_connection() as c:
    lines = c.execute(
        "SELECT id, stage_id FROM sub_payment_plan WHERE sub_contract_id=?",
        (sub2,)).fetchall()
    srcs = c.execute(
        "SELECT COUNT(*) FROM sub_payment_sources sps JOIN sub_payment_plan sp"
        " ON sp.id = sps.sub_line_id WHERE sp.sub_contract_id=?",
        (sub2,)).fetchone()[0]
check("سطر لكل مرحلة", n == 2 and len(lines) == 2, (n, len(lines)))
check("كل سطر له مصدر عميل", srcs >= 2, srcs)

print("=== 4-5. اختبارات الواجهة (تُتخطى آليًا بدون Qt) ===")
try:
    from PySide6.QtWidgets import QApplication  # noqa: E402
    from ui.followup import FollowupPanel  # noqa: E402
    from ui.subcontractors import LinkSubContractDialog  # noqa: E402
    _QT = True
except ImportError as _e:
    _QT = False
    print("  SKIP Qt غير متاح في هذه البيئة")
if _QT:
    app = QApplication.instance() or QApplication([])
    with get_connection() as c:
        S_UI = c.execute(
            "SELECT id FROM contract_stages WHERE contract_id=? ORDER BY id"
            " LIMIT 1", (k1,)).fetchone()["id"]
    panel = FollowupPanel(None, wf.TX_CONTRACT, k1,
                          show_chat=False, show_history=False)
    fired = []
    panel.changed.connect(lambda: fired.append(True))
    panel._manual_tick(S_UI, True)
    with get_connection() as c:
        closed = (c.execute(
            "SELECT end_date FROM contract_stages WHERE id=?",
            (S_UI,)).fetchone()["end_date"] or "").strip()
    check("المرحلة أُغلقت", bool(closed), closed)
    check("الإشارة changed بُثت", len(fired) == 1, len(fired))

    # V4.5.11: حوار الإنشاء صار شاشة واحدة (بلا خطوات وبلا «التالي»)
    # (الاختبار الكامل في test_v4506_sub_creation_flow.py)
    dlg = LinkSubContractDialog(None)
    # V4.5.15: صندوق «البنود المختارة» أُلغي — التعليم داخل جدول البنود
    check("حوار الإنشاء شاشة واحدة: بيانات وبنود ودفعات وحفظ واحد",
          not hasattr(dlg, "stack") and not hasattr(dlg, "_next_btn")
          and hasattr(dlg, "items_table") and hasattr(dlg, "items_box")
          and hasattr(dlg, "chosen_table")
          and hasattr(dlg, "plan_table") and dlg._save_btn.text() == "💾 حفظ")

print("")
print(f"V4.5.05 autolink+refresh: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
