# -*- coding: utf-8 -*-
"""V3.26: إخفاء «إجمالي المنصرف الفعلي» عن السكرتير (مثل الربح)."""
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

from database.models import Contract, Customer  # noqa: E402
from services import auth_service  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.contract_hub import ContractHubPage  # noqa: E402

c1 = cs.add_customer(Customer(customer_code="C-261", name="عميل المنصرف",
                              phone="55326111"))
k1 = ks.add_contract(Contract(contract_number="K-261", customer_id=c1,
                              contract_date="2026-01-01",
                              description="عقد", amount=750.0,
                              contract_type="x"))
with db.get_connection() as _c:
    _c.execute("INSERT INTO vouchers (voucher_number, vtype, vdate, amount,"
               " contract_id, party_type) VALUES (?,?,?,?,?,?)",
               ("PV-261", "payment", "2026-02-01", 100.0, k1,
                "subcontractor"))

auth_service._current["role"] = auth_service.ROLE_ADMIN
auth_service._current_perms = {}
page = ContractHubPage(embedded=True)
page.show()
page.load_contract(k1)
app.processEvents()
check("المدير يرى المنصرف",
      "payments" in page._dash
      and not page._dash["payments"].isHidden()
      and page._dash["payments"].text() != "—",
      page._dash.get("payments").text() if "payments" in page._dash
      else "no-dash")

auth_service._current["role"] = auth_service.ROLE_SECRETARY
auth_service._current_perms = {}
page.load_contract(k1)
app.processEvents()
check("السكرتير: المنصرف مخفي",
      page._dash["payments"].isHidden()
      and page._dash_labels["payments"].isHidden())
check("الربح ما زال مخفيًا",
      page._dash["profit"].isHidden()
      and page._dash["expected_profit"].isHidden())
check("بياناته العادية ظاهرة",
      not page._dash["current"].isHidden()
      and not page._dash["original"].isHidden())
auth_service._current["role"] = auth_service.ROLE_ADMIN
auth_service._current_perms = None
page.close()

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
