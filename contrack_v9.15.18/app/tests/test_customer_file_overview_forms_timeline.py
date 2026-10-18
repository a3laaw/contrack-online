# -*- coding: utf-8 -*-
"""ملف العميل: زر اختيار نموذج في عام، والسجل الزمني بدل آخر الحركات."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication, QPushButton

from database import database
from database.models import Customer, Contract
from services import contract_service, customer_service, lifecycle_service
from ui.archive import CustomerFileWidget


def main() -> None:
    app = QApplication.instance() or QApplication([])
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code=customer_service.next_customer_code(),
        name="عميل النماذج والسجل", phone="55502020"))
    kid = contract_service.add_contract(Contract(
        contract_number=contract_service.next_contract_number(),
        customer_id=cid, contract_date="2026-01-01",
        contract_type="تصميم", description="عقد سجل", amount=1000))
    lifecycle_service.log_event(kid, "اختبار السجل", "حدث ظاهر في عام")

    widget = CustomerFileWidget(customer=customer_service.get_customer(cid), embedded=True)
    widget.show()
    app.processEvents()

    buttons = [b.text() for b in widget.findChildren(QPushButton)]
    assert any("اختيار نموذج" in t for t in buttons), "يجب وجود زر اختيار نموذج في ملف العميل"
    footer_buttons = [b.text() for b in widget.action_bar.findChildren(QPushButton)]
    assert "سند قبض" not in footer_buttons and "سند صرف" not in footer_buttons, "لا يجب تكرار أزرار السندات في شريط ملف العميل السفلي"
    assert hasattr(widget, "quick_comment_btn") and widget.quick_comment_btn is None, "التعليقات مدمجة داخل عام بلا زر عائم مكرر"
    assert "comments" not in widget._page_index, "لا يجب وجود تاب مستقل للتعليقات بعد دمجها في عام"
    assert hasattr(widget, "comments_list"), "يجب عرض التعليقات داخل صفحة عام بجانب الملخص"
    assert hasattr(widget, "customer_timeline_list"), "السجل الزمني يجب أن يكون في نظرة عامة/عام"
    assert not hasattr(widget, "last_table"), "آخر الحركات يجب أن تُحذف من نظرة عامة"
    texts = [widget.customer_timeline_list.item(i).text()
             for i in range(widget.customer_timeline_list.count())]
    assert any("اختبار السجل" in t for t in texts), "السجل الزمني لا يعرض أحداث العقود"

    print("OK: ملف العميل يحتوي اختيار نموذج والسجل الزمني بدل آخر الحركات")


if __name__ == "__main__":
    main()
