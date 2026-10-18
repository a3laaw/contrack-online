# -*- coding: utf-8 -*-
"""V3.25: خانة العقود بحث-فقط منذ الولادة + حجب الربح + حذف خيارات."""
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


from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])

c1 = cs.add_customer(Customer(customer_code="C-251", name="عميل السندات",
                              phone="5531222"))
with db.get_connection() as _c:
    _c.execute("INSERT INTO subcontractors (sub_code, name, show_all_contracts)"
               " VALUES ('S-251','مستثنى',1)")
    _c.execute("INSERT INTO subcontractors (sub_code, name)"
               " VALUES ('S-252','عادي')")
    _sub_ex = _c.execute("SELECT id FROM subcontractors WHERE sub_code='S-251'"
                         ).fetchone()[0]
    _sub_no = _c.execute("SELECT id FROM subcontractors WHERE sub_code='S-252'"
                         ).fetchone()[0]
_ids = {}
for i in range(1, 31):
    _k = ks.add_contract(Contract(contract_number=f"K-{i:04d}",
                                  customer_id=c1,
                                  contract_date="2026-01-01",
                                  description=f"مشروع {i}", amount=1000.0,
                                  contract_type="x"))
    _ids[f"K-{i:04d}"] = _k
with db.get_connection() as _c2:
    for _kk in ("K-0001", "K-0002"):
        _c2.execute("INSERT INTO sub_contracts (subcontractor_id, contract_id,"
                    " amount) VALUES (?,?,?)", (_sub_no, _ids[_kk], 100.0))

from ui.vouchers import VoucherDialog  # noqa: E402

print("=== 1. المستثنى: كتابة حقيقية + إنتر ===")
dlg = VoucherDialog(None, "payment")
dlg.show()
app.processEvents()
dlg.party_kind.setCurrentIndex(1)
app.processEvents()
dlg.party.select_data(_sub_ex)
app.processEvents()
check("بحث-فقط منذ الولادة",
      dlg.contract._search_only and dlg.contract.count() == 31,
      f"{dlg.contract.count()}")
_le = dlg.contract.lineEdit()
_le.setFocus()
QTest.keyClicks(_le, "K-0007")
app.processEvents()
app.processEvents()
check("الكتابة تُظهر اقتراحًا", dlg.contract.suggestion_count() >= 1
      and _le.text() == "K-0007",
      f"{_le.text()}/{dlg.contract.suggestion_count()}")
QTest.keyClick(_le, Qt.Key_Return)
app.processEvents()
check("إنتر يختار العقد الصحيح",
      dlg.contract.selected_data() == _ids["K-0007"],
      str(dlg.contract.selected_data()))
_le.setText("")
app.processEvents()
dlg.contract.showPopup()
app.processEvents()
check("النقرة فارغة ← أعلى 30",
      dlg.contract.suggestions_visible()
      and dlg.contract.suggestion_count() == 30,
      str(dlg.contract.suggestion_count()))

print("=== 2. القصيرة: النقرة تعرض الكل ===")
dlg.party.select_data(_sub_no)
app.processEvents()
check("عقدان + بدون", dlg.contract.count() == 3,
      str(dlg.contract.count()))
dlg.contract.showPopup()
app.processEvents()
check("النقرة تعرض 3", dlg.contract.suggestions_visible()
      and dlg.contract.suggestion_count() == 3,
      str(dlg.contract.suggestion_count()))
dlg.close()

print("=== 3. حجب الربح حسب الدور ===")
from ui.contract_hub import ContractHubPage  # noqa: E402

auth_service._current["role"] = auth_service.ROLE_ADMIN
auth_service._current_perms = {}
page = ContractHubPage(embedded=True)
page.show()
page.load_contract(_ids["K-0001"])
app.processEvents()
check("المدير يرى الربح",
      "profit" in page._dash and not page._dash["profit"].isHidden()
      and page._dash["profit"].text() != "—",
      page._dash.get("profit").text() if "profit" in page._dash else "no-dash")
auth_service._current["role"] = auth_service.ROLE_SECRETARY
auth_service._current_perms = {}
page.load_contract(_ids["K-0001"])
app.processEvents()
check("السكرتير: الصفّان مخفيان",
      page._dash["profit"].isHidden()
      and page._dash["expected_profit"].isHidden())
check("بياناته العادية ظاهرة",
      not page._dash["current"].isHidden()
      and not page._dash["receipts"].isHidden())
auth_service._current["role"] = auth_service.ROLE_ADMIN
auth_service._current_perms = None
page.close()

print("=== 4. زر خيارات العقود محذوف ===")
from ui.archive import CustomerFileWidget  # noqa: E402

check("بلا قائمة ولا معالجات",
      not hasattr(CustomerFileWidget, "_contracts_more_menu")
      and not hasattr(CustomerFileWidget, "_group_contracts_dialog")
      and not hasattr(CustomerFileWidget, "_show_contract_groups")
      and not hasattr(CustomerFileWidget, "_open_statement")
      and not hasattr(CustomerFileWidget, "_export_contracts"))

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
