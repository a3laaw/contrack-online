# -*- coding: utf-8 -*-
"""التعليقات الطويلة لا تُقص من النهاية أو الأسفل داخل ملف العميل."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service, comment_service  # noqa: E402


def main():
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code="CUS-COM-LONG", name="عميل تعليق طويل", phone="55598765"))
    txt = (
        "تم إصدار سند قبض رقم RV-0003 على العقد CON-0003 بمبلغ 175.000 د.ك "
        "بطريقة السداد: تحويل بنكي. الرصيد بعد السند صفر، وتم تحصيل كامل المبلغ "
        "مع ملاحظة متابعة العميل بعد اعتماد المرحلة والتأكد من ظهور التعليق كاملًا بدون قص."
    )
    for _ in range(3):
        comment_service.add_comment(cid, txt)

    from PySide6.QtWidgets import QApplication, QFrame, QTextEdit
    from ui.archive import CustomerFileWidget

    app = QApplication.instance() or QApplication([])
    page = CustomerFileWidget(None, customer_service.get_customer(cid), embedded=True)
    page.resize(980, 760)
    page.load_customer(customer_service.get_customer(cid), "comments")
    page.show()
    app.processEvents()
    page._relayout_comments()
    app.processEvents()

    assert page.comments_list.count() == 3
    for i in range(page.comments_list.count()):
        item = page.comments_list.item(i)
        wrapper = page.comments_list.itemWidget(item)
        card = wrapper.findChild(QFrame, "commentBubbleCard")
        body = wrapper.findChild(QTextEdit, "commentBubbleBody")
        assert card is not None and body is not None
        assert body.toPlainText() == txt
        assert body.document().size().height() + 10 <= body.height(), "ارتفاع نص التعليق غير كافٍ"
        assert item.sizeHint().height() >= card.sizeHint().height(), "ارتفاع عنصر القائمة لا يستوعب الفقاعة"
    print("OK: التعليقات الطويلة تظهر كاملة بدون قص أفقي أو سفلي")


if __name__ == "__main__":
    main()
