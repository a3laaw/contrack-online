# -*- coding: utf-8 -*-
"""V2.10: فقاعة التعليق يمينًا والنص داخلها يمينًا (لا يسارًا).

انحدار ضد ثلاثة أسباب جذرية:
1) QTextDocument.adjustSize() كان يُسقط textWidth إلى عرض المحتوى
   فيلتف النص بعرض ضيق يسار الفقاعة — الآن textWidth ثابت كاملًا.
2) AlignRight بدون AlignAbsolute تُقرأ «نهاية السطر» في RTL فتظهر يسارًا.
3) عنصر القائمة كان أضيق من الفيوبورت وموضوعًا يسارًا تاركًا فجوة يمينًا.
"""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service, comment_service  # noqa: E402


def _ink_right_ratio(widget):
    """أقصى عمود فيه حبر / عرض الويدجت — إثبات بصري للمحاذاة."""
    img = widget.grab().toImage()
    w, h = img.width(), img.height()
    bg = img.pixelColor(2, 2)
    rightmost = -1

    def is_bg(x, y):
        c = img.pixelColor(x, y)
        return (abs(c.red() - bg.red()) + abs(c.green() - bg.green())
                + abs(c.blue() - bg.blue()) < 60)

    for y in range(2, h - 2, 2):
        for x in range(w - 3, 1, -2):
            if not is_bg(x, y):
                if x > rightmost:
                    rightmost = x
                break
    return (rightmost / w) if rightmost >= 0 else -1.0


def main():
    database.init_db()
    cid = customer_service.add_customer(Customer(
        customer_code="CUS-COM-RIGHT", name="عميل محاذاة", phone="55512345"))
    comment_service.add_comment(cid, "تم")
    comment_service.add_comment(
        cid, "[تعليق تلقائي] تم إصدار سند قبض رقم RP-11521 المبلغ "
             "125.000 د.ك وتم تحصيل كامل المستحق على العقد.")

    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import QApplication, QFrame, QTextEdit
    from ui.archive import CustomerFileWidget

    app = QApplication.instance() or QApplication([])
    page = CustomerFileWidget(None, customer_service.get_customer(cid), embedded=True)
    page.resize(1400, 800)
    page.load_customer(customer_service.get_customer(cid), "comments")
    page.show()
    app.processEvents()
    page._relayout_comments()
    app.processEvents()

    assert page.comments_list.count() == 2
    for i in range(2):
        item = page.comments_list.item(i)
        wrapper = page.comments_list.itemWidget(item)
        card = wrapper.findChild(QFrame, "commentBubbleCard")
        body = wrapper.findChild(QTextEdit, "commentBubbleBody")
        assert card is not None and body is not None

        # 1) عرض نص المستند ثابت كاملًا (لم ينهَر إلى عرض المحتوى)
        tw = body.document().textWidth()
        assert tw >= body.width() - 8, (
            "textWidth انهار إلى %.1f بدل %d" % (tw, body.width() - 6))

        # 2) محاذاة مطلقة لليمين
        al = body.alignment()
        assert (al & Qt.AlignRight) and (al & Qt.AlignAbsolute), (
            "محاذاة الجسم يجب أن تكون AlignRight|Absolute")

        # 3) الفقاعة ملتصقة بيمين العنصر (فجوة يمين صغيرة)
        right_gap = wrapper.width() - (card.x() + card.width())
        assert right_gap <= 12, "فجوة يمين الفقاعة كبيرة: %d" % right_gap

        # 4) إثبات بصري: الحبر يصل يمين الجسم
        ratio = _ink_right_ratio(body)
        assert ratio >= 0.80, "النص لا يصل يمين الفقاعة (%.2f)" % ratio

    print("OK: فقاعة التعليق يمينًا والنص داخلها يمينًا")


if __name__ == "__main__":
    main()
