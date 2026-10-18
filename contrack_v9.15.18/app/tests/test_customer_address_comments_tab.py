# -*- coding: utf-8 -*-
"""عنوان العميل مفصول + التعليقات تبويب مستقل في ملف العميل."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service  # noqa: E402


def main():
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code="CUS-ADDR", name="عميل عنوان مفصل", phone="55001122",
        address_governorate="حولي", address_area="السالمية",
        address_block="10", address_plot="25"))
    c = customer_service.get_customer(cid)
    assert c.address_governorate == "حولي"
    assert c.address_area == "السالمية"
    assert c.address_block == "10"
    assert c.address_plot == "25"
    assert c.address == "حولي - السالمية - قطعة 10 - قسيمة 25"
    assert customer_service.list_customers("السالمية"), "البحث يجب أن يشمل خانات العنوان المفصلة"

    from PySide6.QtWidgets import QApplication, QLineEdit
    from ui.customers import CustomerDialog
    from ui.archive import CustomerFileWidget

    app = QApplication.instance() or QApplication([])
    dlg = CustomerDialog(None, c)
    assert hasattr(dlg, "address_governorate")
    assert hasattr(dlg, "address_area")
    assert hasattr(dlg, "address_block")
    assert hasattr(dlg, "address_plot")
    edits = dlg.findChildren(QLineEdit)
    assert dlg.address_governorate in edits and dlg.address_area in edits

    page = CustomerFileWidget(None, c, embedded=True)
    assert "comments" not in page._page_index, "لا يجب وجود تاب مستقل للتعليقات بعد دمجها في عام"
    page.load_customer(c, "comments")
    assert page._current_key() == "overview"
    assert hasattr(page, "comments_list"), "التعليقات يجب أن تُبنى داخل صفحة عام"
    assert page.quick_comment_btn is None, "لا نكرر زر تعليق سريع عائم بجوار تعليقات عام"
    print("OK: عنوان العميل مفصول والتعليقات مدمجة داخل عام")


if __name__ == "__main__":
    main()
