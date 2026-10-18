# -*- coding: utf-8 -*-
"""V2.09: تحصين مسار الإشراف — عناصر ناقصة لا تعطل تغيير الكمية/النوع."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import customer_service, contract_type_service as cts  # noqa: E402


def main() -> None:
    database.init_db()
    customer_service.add_customer(Customer(
        customer_code="C-SG9", name="عميل تحصين", phone="9209"))
    cts.add_type("إشراف هندسي", unit_label="شهر", unit_price=300.0,
                 pricing_mode="unit", is_supervision=True)
    app = QApplication.instance() or QApplication([])
    from ui import style
    old_err, old_info = style.error, style.info
    style.error = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("ERROR POPUP"))
    style.info = lambda *a, **k: None
    try:
        from ui.contracts import ContractDialog
        # 1) المسار السليم: إشراف + خصم
        d = ContractDialog(None, None)
        d.show()
        app.processEvents()
        d.ctype.setCurrentIndex(d.ctype.findData("إشراف هندسي"))
        app.processEvents()
        assert getattr(d, "_is_sup", False) is True
        d.qty.setValue(6)
        d.unit_price.setValue(350.0)
        app.processEvents()
        assert d.amount.value() == 2100.0, d.amount.value()
        d.sup_discount.setValue(100.0)
        app.processEvents()
        assert d.amount.value() == 2000.0, d.amount.value()
        # 2) حالة متضررة: عناصر الإشراف محذوفة ثم تبديل نوع + كمية
        d2 = ContractDialog(None, None)
        d2.show()
        app.processEvents()
        for a in ("sup_discount", "sup_discount_lbl", "sup_months",
                  "sup_monthly", "sup_value_lbl", "_sup_box"):
            if hasattr(d2, a):
                delattr(d2, a)
        d2.ctype.setCurrentIndex(d2.ctype.findData("إشراف هندسي"))
        app.processEvents()
        app.processEvents()
        for q in (6, 2, 12):
            d2.qty.setValue(q)
            app.processEvents()
        d2.unit_price.setValue(350.0)
        app.processEvents()
        assert d2.amount.value() == 4200.0, d2.amount.value()
        d2._sup_changed()
        app.processEvents()
        print("OK: الإشراف محصّن ضد العناصر الناقصة + الخصم يعمل")
    finally:
        style.error, style.info = old_err, old_info
    app.quit()


if __name__ == "__main__":
    main()
