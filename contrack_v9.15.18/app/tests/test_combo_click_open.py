# -*- coding: utf-8 -*-
"""النقر في أي مكان داخل خانة القوائم القصيرة يفتح قائمة الخيارات.

- قوائم make_searchable + قائمة حساب المصروف: نقرة يسرى ← القائمة تظهر.
- الكتابة بعد النقر تُرشّح · والاختيار بـ Enter يثبّت القيمة.
- القوائم الكبيرة (Searchable افتراضيًا): تبقى «اكتب أولًا» ولا تفتح بالنقر.
"""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402


def main():
    from PySide6.QtCore import Qt
    from PySide6.QtTest import QTest
    from PySide6.QtWidgets import QApplication
    from ui.vouchers import VoucherDialog

    database.init_db()
    app = QApplication.instance() or QApplication([])

    # --- 1) سند صرف: الطريقة (قصيرة) تفتح بالنقر ---
    dlg = VoucherDialog(None, "payment")
    if dlg.method.count() == 0:
        dlg.method.addItems(["نقدًا", "تحويل بنكي", "شيك"])
    dlg.show()
    app.processEvents()
    le = dlg.method.lineEdit()
    le.setText("")
    QTest.mouseClick(le, Qt.LeftButton)
    app.processEvents(); app.processEvents()
    assert dlg.method.completer().popup().isVisible(), \
        "النقر داخل الخانة يجب أن يفتح القائمة"
    print("OK: النقر يفتح قائمة طريقة الدفع")

    # --- 2) الكتابة الحقيقية تُرشّح (أحرف لاتينية: QTest لا يدعم العربية) ---
    from PySide6.QtWidgets import QComboBox
    from ui.widgets import make_searchable
    mini = QComboBox()
    mini.addItems(["alpha", "beta", "gamma", "alphabet"])
    make_searchable(mini)
    mini.show()
    app.processEvents()
    mini.setCurrentIndex(2)  # gamma — حتى يكون الاختيار انتقالًا حقيقيًا
    mini.lineEdit().setText("")
    QTest.keyClicks(mini.lineEdit(), "alph")
    app.processEvents()
    assert mini.completer().completionCount() == 2, \
        mini.completer().completionCount()
    # --- 3) النقر على صف في القائمة يثبّت الاختيار ---
    popup = mini.completer().popup()
    assert popup.isVisible()
    rect = popup.visualRect(popup.model().index(0, 0))
    assert rect.isValid(), "صف النتيجة الأول ظاهر"
    QTest.mouseClick(popup.viewport(), Qt.LeftButton, pos=rect.center())
    app.processEvents(); app.processEvents()
    assert mini.currentText() == "alpha", \
        (mini.currentIndex(), mini.currentText())
    assert mini.currentIndex() == 0
    print("OK: الكتابة تُرشّح والنقر على النتيجة يثبّتها")
    mini.close()

    # --- 4) قائمة حساب المصروف تفتح بالنقر ---
    dlg.expense_account.set_items([("مصروفات إدارية / قرطاسية", 1),
                                   ("مشاريع / حديد", 2)])
    le2 = dlg.expense_account.lineEdit()
    le2.setText("")
    QTest.mouseClick(le2, Qt.LeftButton)
    app.processEvents(); app.processEvents()
    assert dlg.expense_account.completer().popup().isVisible()
    print("OK: النقر يفتح قائمة حساب المصروف")

    # --- 5) القوائم الكبيرة تبقى «اكتب أولًا» (حسب القرار) ---
    from ui.widgets import SearchableComboBox
    big = SearchableComboBox()
    big.set_items([(f"Customer {i}", i) for i in range(1, 51)])
    big.show()
    app.processEvents()
    QTest.mouseClick(big.lineEdit(), Qt.LeftButton)
    app.processEvents(); app.processEvents()
    assert not big.completer().popup().isVisible(), \
        "القوائم الكبيرة لا تفتح بالنقر (اكتب أولًا)"
    big.lineEdit().setText("")
    QTest.keyClicks(big.lineEdit(), "Customer 5")
    app.processEvents()
    n2 = big.completer().completionCount()
    assert n2 == 2, f"كتابة البحث تُرشّح الكبيرة: {n2}"
    print("OK: الكبيرة لا تفتح بالنقر لكن الكتابة تُرشّحها")

    # --- 6) انحدار: المسح ما زال يلغي التحديد ---
    dlg2 = VoucherDialog(None, "receipt")
    dlg2.show()
    app.processEvents()
    alloc = dlg2.allocation
    alloc.setCurrentIndex(0)
    assert alloc.currentData() is not None
    alloc.lineEdit().setText("")
    alloc.lineEdit().textEdited.emit("")
    app.processEvents()
    assert alloc.currentIndex() == -1 and alloc.currentData() is None
    print("OK: المسح ما زال يلغي التحديد")

    dlg.close(); dlg2.close(); big.close()
    print("PASS")


if __name__ == "__main__":
    main()
