# -*- coding: utf-8 -*-
"""V4.39: توسيع لوحة مراحل التنفيذ + الاسم الكامل بالتلميح.

§1 عتبات العرض الجديدة · §2 شرائح الخطوات تحمل النص الكامل ·
§3 تسمية المرحلة الحالية · §4 وحدة الشريحة.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v439_")
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import (contract_service, contract_type_service,  # noqa: E402
                      customer_service, workflow_service as wf)

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


contract_type_service.add_type("إشراف شهري اختبار العرض", 0,
                               unit_label="شهر", unit_price=150,
                               pricing_mode="unit", is_supervision=True)
wf.ensure_type_stage_template("إشراف شهري اختبار العرض")
cid = customer_service.add_customer(
    Customer(customer_code=customer_service.next_customer_code(),
             name="عميل العرض", phone="50000000"))
sup_id = contract_service.add_contract(Contract(
    contract_number=contract_service.next_contract_number(),
    customer_id=cid, contract_date="2026-01-01",
    contract_type="إشراف شهري اختبار العرض",
    description="إشراف شهري", amount=300,
    qty=2, unit_price=150))

from PySide6.QtWidgets import QApplication, QLabel  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402
from ui.followup import _state_chip  # noqa: E402

app = QApplication.instance() or QApplication([])
page = ContractHubPage(embedded=True)
page.load_contract(sup_id)
app.processEvents()

print("=== 1. صفحة المراحل الكاملة (V4.56) ===")
check("صفحة المراحل أول صفحة",
      list(page._page_index)[:1] == ["stages"],
      list(page._page_index)[:3])
page.show()
page.nav.select("stages")
app.processEvents()
check("التنقل للمراحل يعرض اللوحة",
      page.stack.currentIndex() == page._page_index["stages"]
      and page.followup_panel.isVisibleTo(page))
page.resize(400, 800)
app.processEvents()
check("بلا عمود جانبي قديم",
      not hasattr(page, "left_followup_panel")
      and not hasattr(page, "_apply_responsive_layout"))

print("=== 2. الشرائح ===")
chips = []
lay = page.followup_panel.steps
for i in range(lay.count()):
    it = lay.itemAt(i)
    wdg = it.widget() if it is not None else None
    import re as _re
    if isinstance(wdg, QLabel) and _re.match(
            r"^(السابقة|الحالية|التالية|سابقة)\s*:",
            (wdg.text() or "").strip()):
        chips.append(wdg)
check("شرائح موجودة", len(chips) >= 1, len(chips))
check("التلميح = النص الكامل",
      all(c.toolTip() == c.text() and c.text().strip() for c in chips))

print("=== 3. الحالية ===")
cur = page.followup_panel.current_lbl
check("تلميح الحالية",
      cur.text().strip() != "" and cur.toolTip() == cur.text(),
      cur.text())

print("=== 4. الوحدة ===")
long_txt = "الحالية: 🔵 " + "مرحلة ذات اسم طويل جدًا للاختبار " * 3
c = _state_chip(long_txt, "current")
check("الشريحة تحفظ النص والتلميح",
      c.text() == long_txt and c.toolTip() == long_txt)

print("")
print(f"V4.39 stages-width: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
