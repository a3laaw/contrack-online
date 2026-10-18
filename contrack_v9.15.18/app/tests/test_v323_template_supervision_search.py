# -*- coding: utf-8 -*-
"""V3.23: الطابع من قالب الإعدادات + بحث خانة العقود الضخمة."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


print("=== 1. القالب ← وراثة العقد الجديد ===")
cts.add_type("شامل الإشراف")
wf.add_stage(wf.TX_CONTRACT, "أعمال إشرافية", contract_type="شامل الإشراف",
             is_supervision=True, sup_monthly=1500.0)
wf.add_stage(wf.TX_CONTRACT, "توريد", contract_type="شامل الإشراف")
c1 = cs.add_customer(Customer(customer_code="C-231", name="عميل القالب",
                              phone="55111222"))
k1 = ks.add_contract(Contract(contract_number="K-231", customer_id=c1,
                              contract_date="2026-01-01",
                              description="عقد شامل", amount=90000.0,
                              contract_type="شامل الإشراف"))
wf.on_contract_signed(k1)
with db.get_connection() as _c:
    _st = {r["name"]: (r["is_supervision"], r["sup_monthly"])
           for r in _c.execute("SELECT name, is_supervision, sup_monthly"
                               " FROM contract_stages WHERE contract_id=?",
                               (k1,)).fetchall()}
check("الإشرافية موروثة بالقيمة",
      _st.get("أعمال إشرافية") == (1, 1500.0), str(_st))
check("العادية بلا طابع", _st.get("توريد") == (0, 0.0), str(_st))
try:
    wf.add_stage(wf.TX_CONTRACT, "سالبة", contract_type="شامل الإشراف",
                 sup_monthly=-5)
    check("القيمة السالبة مرفوضة", False)
except Exception:
    check("القيمة السالبة مرفوضة", True)

print("=== 2. نسخ الشجرة يحمل الطابع ===")
cts.add_type("شامل منسوخ")
wf.copy_contract_type_template("شامل الإشراف", "شامل منسوخ")
with db.get_connection() as _c2:
    _cp = _c2.execute("SELECT is_supervision, sup_monthly FROM workflow_stages"
                      " WHERE contract_type='شامل منسوخ'"
                      " AND stage_name='أعمال إشرافية'").fetchone()
check("المنسوخة إشرافية", tuple(_cp) == (1, 1500.0),
      str(tuple(_cp)) if _cp else "missing")

print("=== 3. Excel: جديد + قديم ===")
from openpyxl import Workbook  # noqa: E402

_new = os.path.join(_tmpdir, "new.xlsx")
wf.generate_stage_tree_template(_new)
wb = Workbook()
ws = wb.active
ws.title = "شجرة المراحل"
ws.append(["نوع العقد *", "المرحلة الرئيسية *", "المرحلة الفرعية",
           "الأيام المتوقعة", "اللون", "إشرافية؟", "قيمة الشهر"])
ws.append(["شامل الإشراف", "التنفيذ", "زيارات", 5, "أزرق", "نعم", 2000])
ws.append(["شامل الإشراف", "التنفيذ", "تقارير", 3, "أزرق", "", ""])
_fp = os.path.join(_tmpdir, "full.xlsx")
wb.save(_fp)
_prev = wf.read_stage_tree_file(_fp)
check("قراءة العمودين",
      any(r["sub"] == "زيارات" and r["sup"] == 1
          and r["sup_monthly"] == 2000.0 for r in _prev["rows"]))
wb2 = Workbook()
ws2 = wb2.active
ws2.title = "شجرة المراحل"
ws2.append(["نوع العقد *", "المرحلة الرئيسية *", "المرحلة الفرعية",
            "الأيام المتوقعة", "اللون"])
ws2.append(["شامل الإشراف", "قديمة", "", 2, "أخضر"])
_op = os.path.join(_tmpdir, "old.xlsx")
wb2.save(_op)
try:
    _prev2 = wf.read_stage_tree_file(_op)
    check("الملف القديم (5 أعمدة) مقبول", _prev2["row_count"] == 1
          and _prev2["rows"][0]["sup"] == 0)
except Exception as exc:
    check("الملف القديم (5 أعمدة) مقبول", False, str(exc)[:70])
wf.import_stage_tree_file(_fp)
with db.get_connection() as _c3:
    _im = _c3.execute("SELECT is_supervision, sup_monthly FROM workflow_stages"
                      " WHERE contract_type='شامل الإشراف'"
                      " AND stage_name='زيارات'").fetchone()
    _im2 = _c3.execute("SELECT is_supervision FROM workflow_stages"
                       " WHERE contract_type='شامل الإشراف'"
                       " AND stage_name='تقارير'").fetchone()
check("الاستيراد يطبق الطابع",
      tuple(_im) == (1, 2000.0) and _im2[0] == 0,
      f"{tuple(_im) if _im else None}/{_im2[0] if _im2 else None}")

print("=== 4. التجاوز اليدوي باقٍ ===")
from services import supervision_service as sup  # noqa: E402

with db.get_connection() as _c4:
    _sid = _c4.execute("SELECT id FROM contract_stages WHERE contract_id=?"
                       " AND name='توريد'", (k1,)).fetchone()[0]
sup.setup_stage_supervision(_sid, "2026-06-01", 500.0)
with db.get_connection() as _c5:
    _ov = _c5.execute("SELECT is_supervision FROM contract_stages WHERE id=?",
                      (_sid,)).fetchone()[0]
check("تجاوز المتابعة يعمل", _ov == 1)

print("=== 5. وضع البحث (offscreen) ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.widgets import SearchableComboBox  # noqa: E402

combo = SearchableComboBox(search_only=True, browse_on_empty=True)
_items = [(f"عميل {i} — K-{i:04d}", i) for i in range(1, 31)]
combo.set_items(_items, auto_select=False)
check("بحث-فقط منذ الولادة (V3.25: بلا تبديل)",
      combo._search_only and combo._completer is None
      and combo._suggest is not None)
check("الاقتراحات تطابق",
      combo._suggest_match_rows("K-0007") == [6],
      str(combo._suggest_match_rows("K-0007")))
combo.showPopup()
check("النقرة فارغة ← أعلى 30",
      combo.suggestions_visible()
      and combo.suggestion_count() == 30,
      str(combo.suggestion_count()))
from ui.followup import StageSupervisionDialog  # noqa: E402

check("حوار الطابع موجود", StageSupervisionDialog is not None)

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
