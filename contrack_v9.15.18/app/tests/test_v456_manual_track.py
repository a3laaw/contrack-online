# -*- coding: utf-8 -*-
"""V4.56: المسار من الإعدادات — علامة النوع، وراثة المسار، خطة إجبارية،
تابات اليدوي بتاريخ تلقائي، والمراحل صفحة كاملة."""
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
from unittest import mock  # noqa: E402

from database.database import get_connection  # noqa: E402
from PySide6.QtWidgets import QApplication, QCheckBox  # noqa: E402
from services import contract_service as cs  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import customer_service  # noqa: E402
from services import workflow_service as wf  # noqa: E402
from services.contract_service import Contract  # noqa: E402
from services.customer_service import Customer  # noqa: E402
from ui import style  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} :: {extra}")


app = QApplication.instance() or QApplication([])
TODAY = date.today().isoformat()
cust = customer_service.add_customer(Customer(
    customer_code="C-456", name="عميل 456", phone="90000456"))

print("=== 1. علامة النوع ===")
cts.add_type("يدوي 456", 1000.0, manual_track=True)
cts.add_type("تلقائي 456", 1000.0)
check("التكوين يحمل العلامة",
      cts.type_config("يدوي 456").get("manual_track") is True
      and cts.type_config("تلقائي 456").get("manual_track") is False)
_t = [t for t in cts.list_types(active_only=False)
      if t["name"] == "يدوي 456"][0]
check("القائمة تحمل العلامة", _t.get("manual_track") == 1, _t.get("manual_track"))
cts.update_type(_t["id"], "يدوي 456", 1000.0, "", manual_track=False)
check("التعديل يقلب العلامة",
      cts.type_config("يدوي 456").get("manual_track") is False)
cts.update_type(_t["id"], "يدوي 456", 1000.0, "", manual_track=True)
with get_connection() as c:
    _cols = [r[1] for r in c.execute("PRAGMA table_info(contract_types)")]
check("العمود موجود", "manual_track" in _cols)

print("=== 2. الوراثة والخطة الإجبارية ===")
s1 = wf.add_stage("contract", "رئيسية أولى", contract_type="يدوي 456")
s2 = wf.add_stage("contract", "رئيسية ثانية", contract_type="يدوي 456")
with get_connection() as c:
    c.execute(
        "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
        " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
        ("يدوي 456", 1, "دفعة 1", 0, 600.0, s1))
    c.execute(
        "INSERT INTO type_payment_tpl (contract_type, pay_no, title, pct,"
        " amount_fixed, trigger_stage_id) VALUES (?,?,?,?,?,?)",
        ("يدوي 456", 2, "دفعة 2", 0, 400.0, s2))
from ui.contracts import ContractDialog  # noqa: E402

dlg = ContractDialog()
dlg.ctype.setCurrentIndex(dlg.ctype.findData("يدوي 456"))
app.processEvents()
dlg.customer.select_data(cust)
dlg.number.setText("CON-456M")
dlg.amount.setValue(1000.0)
dlg._save()
app.processEvents()
with get_connection() as c:
    _m = c.execute(
        "SELECT id, manual_path FROM contracts WHERE contract_number=?",
        ("CON-450M".replace("450", "456"),)).fetchone()
    _mpay = c.execute("SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
                      (_m["id"],)).fetchone()[0]
check("العلم موروث والخطة مبنية",
      _m["manual_path"] == 1 and _mpay == 2, (_m["manual_path"], _mpay))

print("=== 3. التابات والتاريخ التلقائي ===")
from ui.followup import FollowupPanel  # noqa: E402

mp = FollowupPanel(None, wf.TX_CONTRACT, _m["id"],
                   show_chat=False, show_history=False)
mp.refresh()
app.processEvents()
_g = wf.manual_path_groups(_m["id"])["groups"]
check("تاب لكل رئيسية والخطي مخفي",
      mp.manual_tabs.count() == len(_g)
      and mp.stage_card.isHidden()
      and not mp.manual_card.isHidden(),
      mp.manual_tabs.count())
check("بلا حقل تاريخ", not hasattr(mp, "manual_date"))
with mock.patch.object(style, "confirm", return_value=True):
    _boxes = mp.manual_tabs.findChildren(QCheckBox)
    _first = sorted(_boxes, key=lambda b: int(b.property("manualStageId")))[0]
    _sid = int(_first.property("manualStageId"))
    _first.setChecked(True)
    app.processEvents()
with get_connection() as c:
    _st = c.execute("SELECT end_date FROM contract_stages WHERE id=?",
                    (_sid,)).fetchone()
check("التعليم يختم اليوم تلقائيًا", (_st["end_date"] or "")[:10] == TODAY,
      _st["end_date"])
ap = FollowupPanel(None, wf.TX_CONTRACT, _m["id"],
                   show_chat=False, show_history=False)
wf.set_contract_manual_path(_m["id"], False)
ap.refresh()
app.processEvents()
check("التلقائي: خطي ظاهر ويدوي مخفي",
      not ap.stage_card.isHidden() and ap.manual_card.isHidden())
wf.set_contract_manual_path(_m["id"], True)

print("=== 4. مركز العقد ===")
from ui.contract_hub import ContractHubPage  # noqa: E402

hub = ContractHubPage(None, embedded=True)
hub.load_contract(_m["id"])
app.processEvents()
check("اليدوي يفتح على المراحل",
      hub.stack.currentIndex() == hub._page_index["stages"])
check("لا عمود جانبي", not hasattr(hub, "left_followup_panel"))
c2 = cs.add_contract(Contract(
    contract_number="CON-456A", customer_id=cust, contract_date=TODAY,
    description="x", amount=1000.0, contract_type="تلقائي 456"))
hub.load_contract(c2)
app.processEvents()
check("التلقائي يفتح على الملخص",
      hub.stack.currentIndex() == hub._page_index["info"])

print("=== 5. حوار تعديل النوع ===")
from ui.settings import _ContractTypeDialog  # noqa: E402

_t2 = [t for t in cts.list_types(active_only=False)
       if t["name"] == "يدوي 456"][0]
d = _ContractTypeDialog(None, _t2)
check("خانة المسار موجودة ومعلّمة",
      hasattr(d, "manual") and d.manual.isChecked())

print(f"\nV4.56 manual-track: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
