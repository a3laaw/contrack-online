# -*- coding: utf-8 -*-
"""تعليق كلمة واحدة لا يجب أن يظهر كشريط فارغ ممتد بعرض الشاشة."""
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
        customer_code="CUS-COM-SHORT", name="عميل تعليق قصير", phone="55512345"))
    comment_service.add_comment(cid, "تم")

    from PySide6.QtWidgets import QApplication, QLabel, QFrame, QTextEdit
    from ui.archive import CustomerFileWidget

    app = QApplication.instance() or QApplication([])
    page = CustomerFileWidget(None, customer_service.get_customer(cid), embedded=True)
    page.resize(1400, 800)
    page.load_customer(customer_service.get_customer(cid), "comments")
    page.show()
    app.processEvents()
    page._relayout_comments()
    app.processEvents()

    assert page.comments_list.count() == 1
    item = page.comments_list.item(0)
    wrapper = page.comments_list.itemWidget(item)
    assert wrapper is not None
    card = wrapper.findChild(QFrame, "commentBubbleCard")
    assert card is not None, "يجب وجود كارت داخلي منفصل عن عرض القائمة"
    assert card.maximumWidth() <= 760, "لا يجب أن تتمدد فقاعة تعليق كلمة واحدة بعرض الشاشة"
    assert item.sizeHint().height() >= 58, "يجب أن يكون ارتفاع التعليق القصير مقروءًا"
    body = wrapper.findChild(QTextEdit, "commentBubbleBody")
    assert body is not None and body.toPlainText() == "تم", "نص التعليق القصير يجب أن يظهر داخل الفقاعة"
    assert body.height() >= 34, "جسم التعليق يجب أن يأخذ ارتفاعًا كافيًا ولا يُقص"
    print("OK: تعليق كلمة واحدة يظهر في فقاعة مقروءة غير ممتدة")


if __name__ == "__main__":
    main()
