# -*- coding: utf-8 -*-
"""الدفعة 3: زر + جديد + جرس موحد + تعبئة الفراغ/Toast — بلا منطق جديد."""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication, QDialog, QLabel, QWidget  # noqa: E402

from database import database  # noqa: E402
from database.models import Customer  # noqa: E402
from services import auth_service, customer_service, feature_service  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from services import comment_center_service as ccs  # noqa: E402
from services import workflow_service as wf_svc  # noqa: E402
from ui import style  # noqa: E402
from ui.main_window import MainWindow  # noqa: E402

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} {extra}")


def main() -> None:
    database.init_db()
    app = QApplication.instance() or QApplication([])
    app.setStyleSheet(style.apply_theme())
    _op, _of = auth_service.has_permission, feature_service.enabled
    auth_service.has_permission = lambda *a, **k: True
    feature_service.enabled = lambda *a, **k: True
    try:
        win = MainWindow()
        win.show()
        app.processEvents()

        print("=== 1. زر + جديد ===")
        check("الزر موجود", win.new_btn.text() == "＋ جديد")
        items = win._new_menu_items()
        labels = [x[0] for x in items]
        dash = [b.text() for b in win.dashboard._quick_buttons]
        check("مطابق لأزرار الرئيسية", labels == dash, labels)
        check("المقاول مشروط بالصلاحية",
              ("＋ مقاول باطن" in labels) is True)

        print("=== 2. توجيه الإنشاء (stubs بلا مودال) ===")
        import ui.actions as actions_mod
        import ui.contracts as contracts_mod
        import ui.customers as customers_mod
        import ui.subcontractors as subs_mod
        reached = []

        class FakeDlg:
            def __init__(self, *a, **k):
                reached.append("dlg")
            def exec(self):
                return QDialog.Rejected

        _oc = actions_mod.open_voucher
        actions_mod.open_voucher = lambda *a, **k: reached.append("voucher")
        _cd, _ctd, _sd = (customers_mod.CustomerDialog,
                          contracts_mod.ContractDialog,
                          subs_mod.SubcontractorDialog)
        customers_mod.CustomerDialog = FakeDlg
        contracts_mod.ContractDialog = FakeDlg
        subs_mod.SubcontractorDialog = FakeDlg
        _cc = customer_service.count_customers
        customer_service.count_customers = lambda: 1
        try:
            for _label, action in items:
                reached.clear()
                win._quick_action(action)
                app.processEvents()
                if action in ("new_receipt", "new_payment"):
                    check(f"توجيه {action}", reached == ["voucher"], reached)
                else:
                    check(f"توجيه {action}", reached == ["dlg"], reached)
        finally:
            actions_mod.open_voucher = _oc
            customers_mod.CustomerDialog = _cd
            contracts_mod.ContractDialog = _ctd
            subs_mod.SubcontractorDialog = _sd
            customer_service.count_customers = _cc

        print("=== 3. قائمة الجرس الموحدة (بناء) ===")
        _gu, _gn = wf_svc.get_unread_notifications, wf_svc.unread_count
        wf_svc.get_unread_notifications = lambda *a, **k: [
            {"id": 1, "text": "نقل العقد 5 لمرحلة التنفيذ",
             "transaction_type": "contract", "transaction_id": 0}]
        wf_svc.unread_count = lambda *a, **k: 1
        try:
            win.dashboard._alerts = [
                ("#B91C1C", "⏰ العقد C-1 ينتهي بعد 3 يوم", {}),
                ("#1D4ED8", "🗀 تحديث مجلد",
                 {"folder_customer_id": 7, "folder_path": "X"}),
            ]
            got = win._notification_menu_items()
            kinds = [k for k, _t, _d in got]
            check("ترتيب الأقسام",
                  kinds == ["header", "sys", "sys", "header", "wf", "mark", "clear"],
                  kinds)
            check("رأس النظام", got[0][1] == "تنبيهات النظام (2)", got[0][1])
            check("رأس المتابعة", got[3][1] == "تنبيهات المتابعة (1)",
                  got[3][1])
            win._refresh_bell()
            check("الشارة 3", win.bell_btn.text() == "🔔 (3)",
                  win.bell_btn.text())
            check("التلميح مفصّل", "نظام 2 + متابعة 1" in win.bell_btn.toolTip())
            win.dashboard._alerts = [(f"c{i}", f"تنبيه {i}", {}) for i in range(15)]
            got = win._notification_menu_items()
            kinds = [k for k, _t, _d in got]
            check("سقف النظام 12 + عرض الكل",
                  kinds.count("sys") == 12 and "sys_all" in kinds, kinds)
            win.dashboard._alerts = []
            wf_svc.get_unread_notifications = lambda *a, **k: []
            wf_svc.unread_count = lambda *a, **k: 0
            got = win._notification_menu_items()
            check("فارغ", [k for k, _t, _d in got] == ["empty", "clear"])
            win._refresh_bell()
            check("شارة فارغة", win.bell_btn.text() == "🔔")
        finally:
            wf_svc.get_unread_notifications = _gu
            wf_svc.unread_count = _gn

        print("=== 4. تنفيذ اختيارات الجرس ===")
        calls = []
        _oaf = win.dashboard._open_alert_folder
        win.dashboard._open_alert_folder = lambda c, p: calls.append(("folder", c))
        _go_orig = win._go
        win._go = lambda i: calls.append(("go", i))
        _ma, _mr = wf_svc.mark_all_read, wf_svc.mark_read
        wf_svc.mark_all_read = lambda *a, **k: calls.append(("all",))
        wf_svc.mark_read = lambda *a, **k: calls.append(("read",))
        _ont = win._open_notification_target
        win._open_notification_target = lambda d: calls.append(("target",))
        try:
            win._handle_notification_choice(
                {"__sys__": True, "text": "x",
                 "extra": {"folder_customer_id": 7, "folder_path": "X"}})
            check("تنبيه مجلد يفتح المجلد", calls == [("folder", 7)], calls)
            calls.clear()
            win._handle_notification_choice(
                {"__sys__": True, "text": "y", "extra": {}})
            check("تنبيه نظام يفتح الرئيسية", calls == [("go", 0)], calls)
            calls.clear()
            win._handle_notification_choice({"__sys_all__": True})
            check("عرض الكل يفتح الرئيسية", calls == [("go", 0)], calls)
            calls.clear()
            win._handle_notification_choice({"__all__": True})
            check("تعليم الكل", ("all",) in calls, calls)
            calls.clear()
            win._handle_notification_choice({"id": 1, "text": "t"})
            check("عنصر متابعة: قراءة + هدف",
                  calls == [("read",), ("target",)], calls)
        finally:
            win.dashboard._open_alert_folder = _oaf
            win._go = _go_orig
            wf_svc.mark_all_read = _ma
            wf_svc.mark_read = _mr
            win._open_notification_target = _ont

        print("=== 5. حالات الفراغ على قاعدة فارغة ===")
        from ui.comments_center import CommentsCenterPage
        from ui.custody_center import CustodyCenterPage
        from ui.statement import StatementPage
        from ui.subcontractors import SubcontractorsPage
        from ui.vouchers import VouchersPage

        def empty_of(page):
            w = getattr(page, "_empty_widget", None)
            return w if (w is not None and w.isVisible()) else None

        cc = CommentsCenterPage()
        cc.show()
        app.processEvents()
        check("تعليقات: جدول مخفي", not cc.table.isVisible())
        check("تعليق جديد", empty_of(cc) is not None and any(
            b.text() == "＋ تعليق جديد"
            for b in empty_of(cc).findChildren(
                __import__("PySide6.QtWidgets", fromlist=["QPushButton"]).QPushButton)))

        cu = CustodyCenterPage()
        cu.show()
        app.processEvents()
        check("عهدة: جدول مخفي + زر تسليم",
              not cu.table.isVisible() and empty_of(cu) is not None)

        st = StatementPage()
        st.show()
        app.processEvents()
        ew = empty_of(st)
        st_text = "\n".join(l.text() for l in ew.findChildren(QLabel)) \
            if ew is not None else ""
        check("كشف: توجيه اختيار عميل", "اختر عميلًا" in st_text, st_text)
        from PySide6.QtWidgets import QPushButton as _PB
        check("كشف: بلا زر", ew is not None and not ew.findChildren(_PB))

        vr = VouchersPage("receipt")
        vr.refresh()
        vr.show()
        app.processEvents()
        check("قبض: زر سند قبض جديد",
              empty_of(vr) is not None and any(
                  b.text() == "＋ سند قبض جديد"
                  for b in empty_of(vr).findChildren(_PB)))
        vp = VouchersPage("payment")
        vp.refresh()
        vp.show()
        app.processEvents()
        check("صرف: زر سند صرف جديد",
              empty_of(vp) is not None and any(
                  b.text() == "＋ سند صرف جديد"
                  for b in empty_of(vp).findChildren(_PB)))

        sp = SubcontractorsPage()
        sp.refresh()
        sp.show()
        app.processEvents()
        ew_sub = empty_of(sp)
        check("مقاولون: فراغ بزر إنشاء عقد الباطن",
              ew_sub is not None and any(
                  b.text() == "＋ عقد باطن جديد"
                  for b in ew_sub.findChildren(_PB)))

        print("=== 6. عودة الجدول مع البيانات ===")
        cid = customer_service.add_customer(Customer(
            customer_code="C-E1", name="عميل فراغ", phone="9011"))
        from database.models import Contract
        from services import contract_service
        contract_service.add_contract(Contract(
            contract_number="CON-E1", customer_id=cid,
            contract_date="2026-01-01", description="عقد فراغ",
            amount=10000.0, contract_type="مقاولة عامة"))
        ccs.add_comment(cid, "تعليق تجربة")
        cc.refresh()
        app.processEvents()
        check("تعليقات: ظهر الجدول",
              cc.table.isVisible() and cc.table.rowCount() >= 1,
              cc.table.rowCount())
        lc.add_subcontractor("S-E1", "مقاول فراغ", "", "", "", "")
        sp.refresh()
        app.processEvents()
        check("مقاولون: ظهرت الشجرة", sp.tree.isVisible())
        st.refresh()
        app.processEvents()
        assert st.customer.select_data(cid), "تعذر اختيار العميل"
        st.refresh()
        app.processEvents()
        check("كشف: ظهرت الحركات (قيد العقد)",
              st.table.isVisible() and st.table.rowCount() >= 1,
              st.table.rowCount())
        st.table.setRowCount(0)
        st._update_empty_state()
        app.processEvents()
        ew = empty_of(st)
        st2 = "\n".join(l.text() for l in ew.findChildren(QLabel)) \
            if ew is not None else ""
        check("كشف: نص لا حركات (فلتر صفري)", "لا حركات" in st2, st2)
        cu._update_empty_state(1)
        check("عهدة: تبديل يعيد الجدول", cu.table.isVisible())
        vr._update_empty_state(1)
        check("قبض: تبديل يعيد الجدول", vr.table.isVisible())

        print("=== 7. Toast بعد الحفظ ===")
        from ui.comments_center import CommentDialog
        from ui.customers import CustomerDialog
        host = QWidget()
        host.show()
        app.processEvents()
        dlg = CustomerDialog(host)
        dlg.code.setText("C-T1")
        dlg.name.setText("عميل توست")
        dlg.phone.setText("9022")
        dlg._save()
        app.processEvents()
        toasts = host.window().findChildren(QLabel, "inlineToast")
        check("توست حفظ العميل",
              any("تم حفظ العميل" in x.text() for x in toasts),
              [x.text() for x in toasts])
        dlg2 = CommentDialog(host, cid, None)
        dlg2.body.setPlainText("توست تجربة")
        dlg2._save()
        app.processEvents()
        toasts = host.window().findChildren(QLabel, "inlineToast")
        check("توست حفظ التعليق",
              any("تم حفظ التعليق" in x.text() for x in toasts))
        check("التوست على النافذة لا الحوار",
              dlg.findChild(QLabel, "inlineToast") is None)
    finally:
        auth_service.has_permission = _op
        feature_service.enabled = _of
    print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
    app.quit()
    if FAIL:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
