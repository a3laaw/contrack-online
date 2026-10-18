# -*- coding: utf-8 -*-
"""واجهة سند الصرف العام: جهة مصروف + عميل اختياري ثم عقود/مشاريع العميل فقط."""
import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
database.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service, customer_service, lifecycle_service as lc  # noqa: E402


def main():
    from PySide6.QtWidgets import QApplication
    from ui.vouchers import VoucherDialog

    app = QApplication.instance() or QApplication([])
    cid = customer_service.add_customer(Customer(
        customer_code="CUS-EXPUI", name="عميل مصروف عام", phone="55559999"))
    other_cid = customer_service.add_customer(Customer(
        customer_code="CUS-OTHER", name="عميل آخر", phone="55550001"))
    pid = lc.add_project(lc.next_project_code(), "مشروع العميل المختار", cid)
    other_pid = lc.add_project(lc.next_project_code(), "مشروع عميل آخر", other_cid)
    kid = contract_service.add_contract(Contract(
        contract_number="CON-EXPUI-1", customer_id=cid,
        contract_date=date.today().isoformat(), amount=1000,
        contract_type="غير محدد", contract_name="عقد/مشروع العميل المختار"))
    other_kid = contract_service.add_contract(Contract(
        contract_number="CON-OTHER-1", customer_id=other_cid,
        contract_date=date.today().isoformat(), amount=1000,
        contract_type="غير محدد", contract_name="عقد/مشروع عميل آخر"))
    lc.update_contract_lifecycle(kid, project_id=pid)
    lc.update_contract_lifecycle(other_kid, project_id=other_pid)

    dlg = VoucherDialog(None, "payment")
    idx = dlg.party_kind.findData("")
    assert idx >= 0, "يجب وجود اختيار مصروف عام / مورد"
    dlg.party_kind.setCurrentIndex(idx)
    dlg._toggle_party_mode()
    dlg._reload_contracts()

    assert not dlg.party_text.isHidden(), "في المصروف العام تظهر جهة الصرف"
    assert not dlg.expense_customer.isHidden(), "في المصروف العام يظهر العميل الاختياري"
    assert dlg.party.isHidden(), "في المصروف العام لا نطلب عميل/مقاول كمستفيد"
    assert dlg.contract.isEnabled(), "العقد هو المشروع: في المصروف العام نربط بعقد/مشروع اختياري"
    assert "العقد/المشروع" in dlg.contract_label.text()
    assert dlg.project.isHidden(), "لا نعرض مشروعًا منفصلًا لأن العقد هو المشروع"

    assert dlg.expense_customer.currentIndex() == -1 and dlg.expense_customer.currentText() == "", "حقل العميل الاختياري يظهر فارغًا ولا يفرض حذف نص افتراضي"
    assert dlg.contract.currentIndex() == -1 and dlg.contract.currentText() == "", "حقل العقد/المشروع يظهر فارغًا ولا يفرض حذف نص افتراضي"
    assert dlg.contract.count() == 0, "لا تعرض كل مشاريع النظام قبل اختيار العميل"

    dlg.expense_customer.select_data(cid)
    assert dlg.expense_customer.selected_data() == cid
    dlg._reload_contracts()
    values = [dlg.contract.itemData(i) for i in range(dlg.contract.count())]
    assert kid in values, "بعد اختيار العميل تظهر عقوده/مشاريعه"
    assert other_kid not in values, "لا تظهر عقود/مشاريع العملاء الآخرين"
    print("OK: المصروف العام يختار العميل أولًا ثم يعرض عقود/مشاريع هذا العميل فقط")


if __name__ == "__main__":
    main()
