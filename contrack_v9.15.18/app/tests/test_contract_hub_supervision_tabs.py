# -*- coding: utf-8 -*-
"""عقد الإشراف لا يعرض تاب الأوامر التغييرية في مركز العقد."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication, QPushButton

from database import database
from database.models import Customer, Contract
from services import contract_service, contract_type_service, customer_service
from ui.contract_hub import ContractHubPage


def _add_customer(name: str) -> int:
    return customer_service.add_customer(
        Customer(customer_code=customer_service.next_customer_code(), name=name, phone="50000000"))


def main() -> None:
    app = QApplication.instance() or QApplication([])
    database.init_db()

    contract_type_service.add_type("إشراف شهري اختبار التابات", 0,
                                   unit_label="شهر", unit_price=150,
                                   pricing_mode="unit", is_supervision=True)
    cid = _add_customer("عميل إشراف التابات")
    sup_id = contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=cid, contract_date="2026-01-01",
        contract_type="إشراف شهري اختبار التابات",
        description="إشراف شهري", amount=300,
        qty=2, unit_price=150))

    page = ContractHubPage(embedded=True)
    page.show()
    page.load_contract(sup_id)
    app.processEvents()

    add_btn = page.nav.buttons.get("addendums")
    assert add_btn is not None
    assert add_btn.isHidden() or not add_btn.parentWidget().isVisible(), \
        "تاب الأوامر التغييرية يجب أن يختفي لعقد الإشراف"
    assert page._current_key() == "info"
    page.nav.select("stages")
    app.processEvents()
    assert page.stack.currentIndex() == page._page_index["stages"], "مراحل التنفيذ صفحة كاملة متاحة دائمًا"
    assert not hasattr(page, "timeline_list"), "السجل الزمني لا يجب أن يظهر داخل ملخص العقد"
    assert hasattr(page, "stage_edit_btn"), "أزرار ملخص العقد يجب أن تنتقل إلى لوحة المراحل"
    # V6.4: سند القبض/الصرف خرجا من قائمة الإجراءات (لهما زرّان فوق جدولي
    # الدفعات) — يبقى التعديل وكشف الحساب في القائمة.
    assert hasattr(page, "stage_edit_btn") and hasattr(page, "stage_statement_btn")
    assert page.stage_receipt_btn is None and page.stage_payment_btn is None
    summary_buttons = [b.text() for b in page.stack.currentWidget().findChildren(QPushButton)]
    assert "تعديل بيانات العقد" not in summary_buttons, \
        "ملخص العقد يجب أن يبقى قراءة فقط بدون زر تعديل داخله"

    page.resize(560, 720)
    page.nav.select("stages")
    app.processEvents()
    assert page.stack.currentIndex() == page._page_index["stages"], "لا يجوز إخفاء المراحل عند ضيق العرض"

    print("OK: عقد الإشراف يخفي تاب الأوامر التغييرية مع بقاء مراحل التنفيذ ظاهرة")


if __name__ == "__main__":
    main()
