# -*- coding: utf-8 -*-
"""V2.08: بادئات البيانات التلقائية من الإعدادات (فارغ = النص الحالي حرفيًا)."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402
from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402
from services import (  # noqa: E402
    contract_service, customer_service, settings_service as ss)
from services.extras_service import (  # noqa: E402
    allocated_description, apply_description_prefix,
    smart_receipt_description, smart_receipt_stage_note)


def main() -> None:
    database.init_db()
    # 1) أعمدة الترقية موجودة
    from database.database import get_connection
    with get_connection() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(settings);")}
    for c in ("desc_prefix_receipt", "desc_prefix_supervision",
              "desc_prefix_transfer", "desc_prefix_custody",
              "desc_prefix_stage_note"):
        assert c in cols, c
    # 2) فارغ = هوية + حراسة
    s = ss.get_settings()
    assert s.desc_prefix_receipt == "" and s.desc_prefix_stage_note == ""
    assert apply_description_prefix("receipt", "رسوم سداد X") == "رسوم سداد X"
    assert apply_description_prefix("bogus", "Y") == "Y"
    assert apply_description_prefix("receipt", "") == ""
    # 3) بيانات مرجعية بلا بادئة
    cid = customer_service.add_customer(Customer(
        customer_code="C-DP1", name="عميل بادئة", phone="9101"))
    kid = contract_service.add_contract(Contract(
        contract_number="CON-DP1", customer_id=cid,
        contract_date="2026-01-01", description="اختبار", amount=5000))
    d0 = smart_receipt_description(kid, 1000.0)
    assert d0 and not d0.startswith("مقبوضات")
    # 4) تفعيل البادئات
    s.desc_prefix_receipt = "مقبوضات"
    s.desc_prefix_stage_note = "تنفيذ"
    s.desc_prefix_transfer = "حركة داخلية:"
    s.desc_prefix_custody = "عهد"
    ss.save_settings(s)
    assert smart_receipt_description(kid, 1000.0) == "مقبوضات: " + d0
    assert smart_receipt_stage_note(kid, 1000.0).startswith("تنفيذ: مرحلة العمل:")
    assert allocated_description(kid, 100.0, "NOPE").startswith("مقبوضات: سداد مقابل بند إضافي")
    assert apply_description_prefix("custody", "تسليم عهدة") == "عهد: تسليم عهدة"
    # النقطتان الزائدتان من المستخدم تُدمجان في فاصل واحد
    assert apply_description_prefix("transfer", "تحويل داخلي من س إلى ص") == \
        "حركة داخلية: تحويل داخلي من س إلى ص"
    # 5) النافذة: توليد + احترام اليدوي
    app = QApplication.instance() or QApplication([])
    from ui import style
    old_err, old_info, old_conf = style.error, style.info, style.confirm
    style.error = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("ERROR POPUP"))
    style.info = lambda *a, **k: None
    style.confirm = lambda *a, **k: True
    try:
        from ui.vouchers import VoucherDialog
        d = VoucherDialog(None, "receipt")
        d.show()
        app.processEvents()
        d.party_kind.setCurrentIndex(d.party_kind.findData("customer"))
        app.processEvents()
        d.party.setCurrentIndex(d.party.findData(cid))
        app.processEvents()
        d.contract.setCurrentIndex(d.contract.findData(kid))
        app.processEvents()
        d.amount.setValue(1000.0)
        app.processEvents()
        app.processEvents()
        assert d.description.toPlainText() == "مقبوضات: " + d0, d.description.toPlainText()
        d.description.setPlainText("يدوي")
        app.processEvents()
        d.amount.setValue(2000.0)
        app.processEvents()
        assert d.description.toPlainText() == "يدوي", d.description.toPlainText()
        # 6) التحويل والعهدة في النوافذ
        p = VoucherDialog(None, "payment")
        p.show()
        app.processEvents()
        p.party_kind.setCurrentIndex(p.party_kind.findData("transfer"))
        app.processEvents()
        assert p.description.toPlainText() == \
            "حركة داخلية: تحويل داخلي من البنك إلى الصندوق", p.description.toPlainText()
        p.custody_give.setChecked(True)
        app.processEvents()
        assert p.description.toPlainText().startswith("حركة داخلية: تحويل داخلي")
        p2 = VoucherDialog(None, "payment")
        p2.show()
        app.processEvents()
        p2.custody_give.setChecked(True)
        app.processEvents()
        assert p2.description.toPlainText() == "عهد: تسليم عهدة", p2.description.toPlainText()
    finally:
        style.error, style.info, style.confirm = old_err, old_info, old_conf
    # 7) شاشة الإعدادات: بلا قسم بادئات/واتساب + الحفظ يحفظ القيم الحالية
    from ui.settings import SettingsPage
    pg = SettingsPage()
    pg.show()
    pg.refresh()
    app.processEvents()
    assert not hasattr(pg, "_desc_prefix_edits"), "قسم البادئات أُلغي من الواجهة"
    assert "واتساب" not in "".join(
        pg.tabs.tabText(i) for i in range(pg.tabs.count())), "تبويب الواتساب أُلغي"
    _real_info = style.info
    style.info = lambda *a, **k: None
    try:
        pg._save()
    finally:
        style.info = _real_info
    app.processEvents()
    s3 = ss.get_settings()
    assert s3.desc_prefix_receipt == "مقبوضات", "الحفظ يحفظ البادئات الحالية"
    assert s3.desc_prefix_custody == "عهد"
    print("OK: بادئات البيانات التلقائية الخمس + النوافذ + حفظ الإعدادات")
    app.quit()


if __name__ == "__main__":
    main()
