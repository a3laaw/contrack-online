# -*- coding: utf-8 -*-
"""ملخص العقد يستغل المساحة ولا يترك فراغًا كبيرًا، مع بقاء التفاصيل مطوية."""
from __future__ import annotations

import os
import sys
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from PySide6.QtWidgets import QApplication, QScrollArea, QSizePolicy  # noqa: E402

from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from ui.contract_hub import ContractHubPage  # noqa: E402


def main() -> None:
    app = QApplication.instance() or QApplication([])
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code=customer_service.next_customer_code(),
        name="عميل عرض الملخص", phone="50987654"))
    contract_id = contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=cid, contract_date=date.today().isoformat(),
        description="عقد اختبار عرض الملخص", amount=400))
    page = ContractHubPage(embedded=True)
    page.resize(1200, 720)
    page.load_contract(contract_id)
    app.processEvents()
    scroll = page.stack.currentWidget().findChild(QScrollArea)
    assert scroll is not None
    host = scroll.widget()
    assert host is not None
    assert host.maximumWidth() > 10000, "لا يجب حصر ملخص العقد في عرض ضيق يترك فراغًا بالمنتصف"
    assert host.sizePolicy().horizontalPolicy() == QSizePolicy.Expanding
    assert not page.details_host.isVisible(), "تفاصيل الملخص يجب أن تكون مطوية افتراضيًا"
    print("OK: ملخص العقد يستغل المساحة المتاحة ولا يترك فراغًا كبيرًا والتفاصيل مطوية")


if __name__ == "__main__":
    main()
