# -*- coding: utf-8 -*-
"""لا نوافذ وامضة عند بناء النوافذ: أي عنصر يُبنى بلا أب ثم يُستدعى
عليه setVisible(True) قبل دخوله التخطيط يظهر كنافذة مستقلة تومض
على ويندوز ثم تختفي (بلاغ V2.04: وميض عند «إضافة دفعة» وفتح صفحات).

الاختبار يراقب كل أحداث الإظهار: المسموح فقط نوافذ الحوارات نفسها
والرئيسية — أي عنصر عادي (زر/خانة/قائمة) يظهر كنافذة = فشل.

ملاحظة: ContractDialog وOfficialTemplateFillDialog مستبعدان عمدًا —
يتجمدان headless مع قاعدة فارغة (مسار تحذيري مودال لا علاقة له
بالوميض) وتم التحقق منهما استاتيكيًا: كل setVisible فيهما بعد الأبوة.
"""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402


class _SpyApp(__import__("PySide6.QtWidgets", fromlist=["QApplication"]).QApplication):
    flashes = []

    def notify(self, obj, event):
        from PySide6.QtCore import QEvent
        from PySide6.QtWidgets import QWidget
        if event.type() == QEvent.Show:
            try:
                if isinstance(obj, QWidget) and obj.isWindow():
                    name = type(obj).__name__
                    if "Dialog" not in name and name != "MainWindow":
                        _SpyApp.flashes.append(name)
            except Exception:
                pass
        return super().notify(obj, event)


def _check(label):
    bad = list(_SpyApp.flashes)
    _SpyApp.flashes.clear()
    assert not bad, f"{label}: نوافذ وامضة: {bad}"
    print(f"OK: {label} بلا وميض")


def main():
    from PySide6.QtWidgets import QApplication
    database.init_db()
    app = QApplication.instance() or _SpyApp([])

    # إجبار مسارات الإظهار الشرطية (حتى لو تغيرت الصلاحيات/المزايا)
    from services import auth_service, feature_service
    _orig_perm = auth_service.has_permission
    _orig_feat = feature_service.enabled
    auth_service.has_permission = lambda *a, **k: True
    _feat_wrap = lambda name, *a, **k: True  # noqa: E731
    feature_service.enabled = _feat_wrap
    try:
        from ui.main_window import MainWindow
        mw = MainWindow()
        mw.show()
        app.processEvents()
        _check("بدء الرئيسية")
        for idx in sorted(mw._page_factories):
            p = mw._ensure_page(idx)
            mw.stack.setCurrentWidget(p)
            app.processEvents()
            app.processEvents()
        _check("بناء كل الصفحات")

        from ui.type_workflow import PaymentEditDialog
        PaymentEditDialog(None, "x")
        app.processEvents()
        _check("إضافة دفعة (وضع جديد)")
        _pay = {"pay_no": 2, "title": "دفعة اختبار", "pct": 30.0,
                "amount_fixed": 0, "days_offset": 10, "stages": []}
        PaymentEditDialog(None, "x", payment=dict(_pay))
        app.processEvents()
        _check("إضافة دفعة (وضع تعديل)")
        _pay2 = {"pay_no": 1, "title": "دفعة كاملة", "pct": 0,
                 "amount_fixed": 5000, "days_offset": 0, "stages": []}
        PaymentEditDialog(None, "x", payment=dict(_pay2))
        app.processEvents()
        _check("إضافة دفعة (دفعة كاملة)")

        from ui.vouchers import VoucherDialog, GroupedPaymentDialog
        VoucherDialog(None, "payment")
        VoucherDialog(None, "receipt")
        GroupedPaymentDialog(None)
        app.processEvents()
        _check("سندات الصرف/القبض/المجمع")
        from ui.tasks import TaskDialog
        from ui.custody_center import CustodySettlementDialog
        TaskDialog(None)
        CustodySettlementDialog(None)
        app.processEvents()
        _check("المهام وتصفية العهدة")

        # فتح ملف العميل (بناء كسول عند النقر — كان يومض: شريط الرجوع
        # + قسم البنود + شريط المركز) · عميلان: بناء أول + مسار مخزّن.
        from services import customer_service as _cs
        from services import contract_service as _cons
        from database.models import Customer, Contract
        _c1 = _cs.add_customer(Customer(customer_code="C-NF1",
                                       name="عميل وميض 1",
                                       phone="99111111"))
        _c2 = _cs.add_customer(Customer(customer_code="C-NF2",
                                       name="عميل وميض 2",
                                       phone="99222222"))
        _con = _cons.add_contract(Contract(
            customer_id=_c1, contract_number="CON-NF",
            contract_name="عقد الوميض", amount=10000,
            contract_date="2026-01-01"))
        mw.open_customer_page(_c1)
        app.processEvents()
        app.processEvents()
        _check("فتح ملف العميل (أول مرة)")
        mw.customer_file_page.show_contract_detail(_con)
        app.processEvents()
        app.processEvents()
        _check("تفاصيل العقد داخل الملف")
        mw.open_customer_page(_c2)
        app.processEvents()
        app.processEvents()
        _check("فتح ملف عميل ثانٍ")
        from ui.contract_hub import ContractHubPage
        ContractHubPage(None, embedded=False)
        ContractHubPage(None, embedded=True)
        app.processEvents()
        _check("مركز العقد (مستقل/مضمّن)")
    finally:
        auth_service.has_permission = _orig_perm
        feature_service.enabled = _orig_feat
    print("PASS")


if __name__ == "__main__":
    main()
