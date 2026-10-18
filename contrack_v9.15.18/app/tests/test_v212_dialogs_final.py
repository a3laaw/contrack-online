# -*- coding: utf-8 -*-
"""V2.12: الحالة النهائية للنافذتين.

الدفعة: صندوقا نسبة/مبلغ + خانة ظاهرة واحدة (V2.10) + إخفاء الأيام
في وضع المرحلة (قيمة مخفية تُحسب وتُحفظ).
العقود: زر تعديل أمام كل عقد بدل قائمة إجراءات العقد.
"""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import contract_service, customer_service  # noqa: E402
from services import contract_type_service as cts  # noqa: E402
from services import workflow_service as wf  # noqa: E402


def main() -> None:
    database.init_db()
    cts.add_type("نوع نهائي", 10000)
    m = wf.add_stage(wf.TX_CONTRACT, "رئيسية", contract_type="نوع نهائي")
    s1 = wf.add_stage(wf.TX_CONTRACT, "تجهيز", parent_id=m, expected_days=10,
                      contract_type="نوع نهائي")
    s2 = wf.add_stage(wf.TX_CONTRACT, "تنفيذ", parent_id=m, expected_days=5,
                      contract_type="نوع نهائي")
    cid = customer_service.add_customer(Customer(
        customer_code="C-FIN1", name="عميل نهائي", phone="9004"))
    contract_service.add_contract(Contract(
        contract_number="CON-FIN1", customer_id=cid,
        contract_date="2026-01-01", description="نهائي", amount=5000))

    from PySide6.QtWidgets import QApplication, QDialog, QLabel
    from ui.archive import CustomerFileWidget
    from ui.type_workflow import PaymentEditDialog

    app = QApplication.instance() or QApplication([])

    # ---- نافذة الدفعة: V2.10 + إخفاء الأيام ----
    dlg = PaymentEditDialog(None, "نوع نهائي")
    dlg.show()
    app.processEvents()
    labels = [w.text() for w in dlg.findChildren(QLabel)]
    assert any("طريقة قيمة الدفعة" in t for t in labels), "صف الطريقة موجود"
    assert dlg.use_fixed.isChecked() and not dlg.use_pct.isChecked()
    assert dlg.fixed.isVisible() and dlg.pct.isHidden(), "خانة واحدة ظاهرة"
    assert dlg._pct_label.isHidden(), "تسمية الحقل المخفي مخفية معه"
    assert dlg.value_mode.isHidden(), "الكومبو الداخلي لا يظهر أبدًا"
    # V4.5.14: للنافذة قبول خاص — تأكيد فقط عند الحفظ بلا قيمة
    assert type(dlg).accept is not QDialog.accept, \
        "حماية «بلا قيمة» عند القبول (V4.5.14)"
    dlg.use_pct.setChecked(True)
    app.processEvents()
    assert dlg.pct.isVisible() and dlg.fixed.isHidden()
    assert dlg.fixed.value() == 0, "التبديل يصفّر الحقل الآخر"
    assert dlg.link_stage.isChecked()
    assert dlg.days.isHidden() and dlg._days_label.isHidden(), \
        "الأيام مخفية في وضع المرحلة"
    dlg.link_manual.setChecked(True)
    app.processEvents()
    assert dlg.days.isVisible() and dlg._days_label.isVisible()
    dlg.link_stage.setChecked(True)
    dlg.stage_ids = [s1, s2]
    dlg.trigger.setCurrentIndex(dlg.trigger.findData(s2))
    dlg._trigger_changed()
    assert dlg.days.isHidden() and dlg.days.value() == 15
    pid = wf.add_type_payment(
        "نوع نهائي", dlg.no.value(), "دفعة مرحلية",
        dlg.pct_value(), dlg.selected_stage_ids(),
        dlg.days.value(), dlg.trigger_value(), dlg.fixed_value())
    saved = [p for p in wf.type_payments("نوع نهائي") if p["id"] == pid][0]
    assert saved["days_offset"] == 15 and saved["kind"] == "إنجاز"

    # ---- جدول العقود: زر تعديل لكل صف ----
    w = CustomerFileWidget(None, customer_service.get_customer(cid),
                           open_page="contracts")
    w.show()
    app.processEvents()
    assert not hasattr(w, "contract_actions_btn")
    assert w.cons_table.columnCount() == 4
    assert w.cons_table.rowCount() >= 1
    for r in range(w.cons_table.rowCount()):
        cell = w.cons_table.cellWidget(r, 3)
        assert cell is not None and cell.text() == "✎ تعديل"
    print("OK: الدفعة V2.10 + إخفاء الأيام + زر تعديل لكل عقد")
    app.quit()


if __name__ == "__main__":
    main()
