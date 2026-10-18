# -*- coding: utf-8 -*-
"""V3.29: بوابة التعهد العقدي القديم + حفظ العقد المعروض بعد التحديث."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication(sys.argv)

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import supervision_service as sup  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from ui import followup as fu  # noqa: E402
from ui.archive import CustomerFileWidget  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


def _mk(code, name, phone, ctype, amount=60000.0):
    c = cs.add_customer(Customer(customer_code=code, name=name, phone=phone))
    k = ks.add_contract(Contract(contract_number=f"K-{code}",
                                 customer_id=c,
                                 contract_date="2026-01-01",
                                 description="عقد", amount=amount,
                                 contract_type=ctype))
    wf.on_contract_signed(k)
    return c, k


cts.add_type("بوابة")
_main = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="بوابة")
for _nm in ("بداية الإشراف", "تنفيذ", "نهاية الإشراف"):
    wf.add_stage(wf.TX_CONTRACT, _nm, contract_type="بوابة",
                 parent_id=_main)

print("=== 1. عقد تصميم: لا حوار ولا كسر ===")
_c1, k1 = _mk("C-291", "عميل بوابة", "55291222", "بوابة")
check("البداية لا تُسأل بلا مدة",
      fu._should_ask_supervision_start(k1, "بداية الإشراف", False) is False)
check("التلميح يقترح الطابع",
      "طابع" in (fu._supervision_hint(k1, "بداية الإشراف", False) or ""))
wf.advance_stage(wf.TX_CONTRACT, k1)
with db.get_connection() as _c:
    _sup_start = _c.execute(
        "SELECT sup_start_date FROM contracts WHERE id=?", (k1,)).fetchone()[0]
check("الإنهاء نجح بلا تعهد",
      wf.get_current_stage(wf.TX_CONTRACT, k1)["stage_name"] == "تنفيذ"
      and not (_sup_start or "").strip())
wf.advance_stage(wf.TX_CONTRACT, k1)
check("النهاية لا تُسأل بلا مدة",
      fu._should_ask_supervision_end(k1, "نهاية الإشراف", False) is False)
try:
    wf.advance_stage(wf.TX_CONTRACT, k1)
    _end_ok = wf.get_current_stage(wf.TX_CONTRACT, k1) is None
except Exception as exc:
    _end_ok, _end_err = False, str(exc)
check("إنهاء «نهاية الإشراف» لا يكسر المسار (كان يفشل)",
      _end_ok, "" if _end_ok else _end_err)

print("=== 2. الموسومة صامتة للمحرك الجديد ===")
_c2, k2 = _mk("C-292", "عميل موسوم", "55292222", "بوابة")
_sid2 = wf.get_current_stage(wf.TX_CONTRACT, k2)["id"]
sup.setup_stage_supervision(_sid2, "2026-12-31", 100.0)
sup.set_stage_sup_start(_sid2, "2026-01-15")
check("الموسومة: لا سؤال ولا تلميح",
      fu._should_ask_supervision_start(k2, "بداية الإشراف", True) is False
      and fu._should_ask_supervision_end(k2, "نهاية الإشراف", True) is False
      and fu._supervision_hint(k2, "بداية الإشراف", True) is None)
check("حالة المرحلة الإشرافية تعمل",
      sup.stage_supervision_status(_sid2) is not None)

print("=== 3. الإشرافي القديم يعمل كما هو ===")
cts.add_type("إشراف قديم", 0.0, "", "شهر", 200.0, "unit",
             is_supervision=True)
_m3 = wf.add_stage(wf.TX_CONTRACT, "التنفيذ", contract_type="إشراف قديم")
for _nm in ("بداية الإشراف", "نهاية الإشراف"):
    wf.add_stage(wf.TX_CONTRACT, _nm, contract_type="إشراف قديم",
                 parent_id=_m3)
_c3, k3 = _mk("C-293", "عميل إشراف", "55293222", "إشراف قديم", 1200.0)
sup.setup_supervision(k3, "", 6, 200.0)
check("بمدة مضبوطة: البداية تُسأل",
      fu._should_ask_supervision_start(k3, "بداية الإشراف", False) is True)
check("بمدة مضبوطة: النهاية تُسأل",
      fu._should_ask_supervision_end(k3, "نهاية الإشراف", False) is True)
_c4, k4 = _mk("C-294", "عميل بلا مدة", "55294222", "إشراف قديم", 1200.0)
check("بلا مدة: لا سؤال",
      fu._should_ask_supervision_start(k4, "بداية الإشراف", False) is False)
check("التلميح يدل على ضبط المدة",
      "مدة الإشراف" in (fu._supervision_hint(k4, "بداية الإشراف", False)
                        or ""))
check("مرحلة عادية: لا شيء",
      fu._should_ask_supervision_start(k1, "تنفيذ", False) is False
      and fu._supervision_hint(k1, "تنفيذ", False) is None)

print("=== 4. التحديث يحفظ العقد المعروض ===")
_c5 = cs.add_customer(Customer(customer_code="C-295", name="عميل قائمة",
                              phone="55295222"))
_kids = []
for i in range(3):
    _kids.append(ks.add_contract(Contract(
        contract_number=f"K-L{i}", customer_id=_c5,
        contract_date="2026-01-01", description="عقد", amount=1000.0,
        contract_type="بوابة")))
w = CustomerFileWidget(None, cs.get_customer(_c5), open_page="contracts")
w.show()
_app.processEvents()
w.cons_table.setCurrentCell(1, 0)
w._load_selected_contract_detail(silent=True)
_app.processEvents()
_ids0 = [c["id"] for c in w._visible_contracts]
_shown = getattr(w.contract_detail, "contract_id", None)
check("عرض عقد الصف الأوسط", _shown == _ids0[1],
      f"shown={_shown} ids={_ids0}")
w._sec_contracts()  # أي تحديث (تعديل/سند/فلتر)
_app.processEvents()
_row = w.cons_table.currentRow()
_ids = [c["id"] for c in w._visible_contracts]
check("بعد التحديث: نفس العقد معروض (لا قفز لأول صف)",
      0 <= _row < len(_ids) and _ids[_row] == _shown
      and getattr(w.contract_detail, "contract_id", None) == _shown,
      f"row={_row} ids={_ids} shown={_shown}")
# سقوط آمن: عقد خارج القائمة بعد فلتر يعرض أول صف كالسابق
w.con_filter.setCurrentIndex(w.con_filter.findData("closed"))
_app.processEvents()
w._sec_contracts()
_app.processEvents()
check("فلتر بلا نتائج يخفي التفاصيل",
      w.contract_detail.isHidden() and w.no_contract_lbl.isVisible())
w.con_filter.setCurrentIndex(w.con_filter.findData("all"))
_app.processEvents()
w._sec_contracts()
_app.processEvents()
_ids2 = [c["id"] for c in w._visible_contracts]
check("عودة الفلتر تستعيد العقد السابق",
      0 <= w.cons_table.currentRow() < len(_ids2)
      and _ids2[w.cons_table.currentRow()] == _shown
      and getattr(w.contract_detail, "contract_id", None) == _shown)

print(f"\nV3.29 GATE: PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
