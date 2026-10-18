# -*- coding: utf-8 -*-
"""قوائم العملاء/مقاولي الباطن: بحث وكتابة فقط (لا فتح كامل بالنقر).

القاعدة: 7 قوائم كانت تفتح كل الأسماء بالنقر → الآن بحث فقط:
سند صرف/عميل مرتبط · السند المجمع/عميل الصف · المصروف العام/المستفيد ·
المصروف العام/عميل مرتبط · تصفية عهدة/عميل · تعبئة رسمية/عميل ·
تعبئة نموذج/عميل. + بصمة النسخة في عنوان الرئيسية.
"""
import os
import sys
import tempfile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer  # noqa: E402


def _click_no_popup(combo, app, label):
    from PySide6.QtCore import Qt
    from PySide6.QtTest import QTest
    combo.lineEdit().setText("")
    QTest.mouseClick(combo.lineEdit(), Qt.LeftButton)
    app.processEvents(); app.processEvents()
    assert not combo.suggestions_visible(), \
        f"{label}: يجب ألا يفتح بالنقر"
    print(f"OK: {label} لا يفتح بالنقر")


def _type_filters(combo, app, label, query="7770002"):
    from PySide6.QtTest import QTest
    combo.lineEdit().setText("")
    QTest.keyClicks(combo.lineEdit(), query)
    app.processEvents()
    n = combo.suggestion_count()
    assert n == 1, f"{label}: الترشيح بالكتابة: {n}"
    assert combo.suggestions_visible(), f"{label}: الاقتراحات لم تظهر!"
    print(f"OK: {label} يُرشَّح بالكتابة")


def _select_mouse_enter(combo, app, label, query="7770002", expect="عميل بحث 2"):
    """اختيار من الاقتراحات بالماوس ثم بإنتر — النص والقيمة صحيحان."""
    from PySide6.QtCore import Qt
    from PySide6.QtTest import QTest
    combo.lineEdit().setText("")
    QTest.keyClicks(combo.lineEdit(), query)
    app.processEvents()
    pop = combo._suggest
    assert pop.count() == 1, f"{label}: الاقتراحات: {pop.count()}"
    rect = pop.visualItemRect(pop.item(0))
    QTest.mouseClick(pop.viewport(), Qt.LeftButton, pos=rect.center())
    app.processEvents()
    assert not combo.suggestions_visible(), f"{label}: لم تُقفل بعد الاختيار"
    assert expect in combo.currentText(), \
        f"{label}: النص بعد الماوس: {combo.currentText()!r}"
    assert combo.selected_data() is not None, f"{label}: القيمة ضاعت!"
    print(f"OK: {label} اختيار بالماوس سليم")
    combo.lineEdit().setText("")
    QTest.keyClicks(combo.lineEdit(), query)
    app.processEvents()
    QTest.keyClick(combo.lineEdit(), Qt.Key_Return)
    app.processEvents()
    assert expect in combo.currentText(), f"{label}: النص بعد إنتر"
    assert not combo.suggestions_visible(), f"{label}: لم تُقفل بعد إنتر"
    print(f"OK: {label} اختيار بإنتر سليم")


def _popup_key_forward(combo, app, label):
    """مفاتيح تصل للنافذة نفسها (حالة ويندوز): كتابة/حذف/تنقل/اختيار."""
    from PySide6.QtCore import Qt
    from PySide6.QtTest import QTest
    combo.lineEdit().setText("")
    QTest.keyClicks(combo.lineEdit(), "777")
    app.processEvents()
    assert combo.suggestions_visible() and combo.suggestion_count() == 5
    pop = combo._suggest
    QTest.keyClick(pop, "0")  # حرف يصل للنافذة ← يُمرَّر للخانة
    app.processEvents()
    assert combo.lineEdit().text() == "7770", combo.lineEdit().text()
    assert combo.suggestion_count() == 5, "إعادة الترشيح بعد التمرير"
    print(f"OK: {label} حرف النافذة يُمرَّر للخانة وتستمر الكتابة")
    QTest.keyClick(pop, Qt.Key_Backspace)  # حذف من النافذة
    app.processEvents()
    assert combo.lineEdit().text() == "777", combo.lineEdit().text()
    assert combo.suggestion_count() == 5
    print(f"OK: {label} الحذف من النافذة يعمل")
    QTest.keyClick(pop, Qt.Key_Down)  # تنقل داخل النافذة
    app.processEvents()
    assert pop.currentRow() == 1, pop.currentRow()
    QTest.keyClick(pop, Qt.Key_Return)  # اختيار من النافذة
    app.processEvents()
    # القائمة مرتبة بالأحدث أولًا: الصف 1 = «عميل بحث 4»
    assert "عميل بحث 4" in combo.currentText(), combo.currentText()
    assert not combo.suggestions_visible()
    print(f"OK: {label} تنقل واختيار من النافذة سليم")
    # تضييق بأرقام عبر النافذة حتى مطابق واحد
    combo.lineEdit().setText("")
    QTest.keyClicks(combo.lineEdit(), "777")
    app.processEvents()
    for ch in ("0", "0", "0", "2"):
        QTest.keyClick(combo._suggest, ch)
        app.processEvents()
    assert combo.lineEdit().text() == "7770002", combo.lineEdit().text()
    assert combo.suggestion_count() == 1, "مطابق واحد عبر النافذة"
    print(f"OK: {label} كتابة متصلة عبر النافذة تُرشَّح لواحد")


def _arrow_no_full_list(combo, app, label):
    """↓ والخانة فارغة ← لا شيء إطلاقًا (لا قائمة كاملة)."""
    combo.lineEdit().setText("")
    combo._suggest_hide()
    combo.showPopup()
    app.processEvents(); app.processEvents()
    assert not combo.view().isVisible(), \
        f"{label}: السهم فتح القائمة الكاملة!"
    assert not combo.suggestions_visible(), \
        f"{label}: نافذة فارغة انفتحت!"
    print(f"OK: {label} السهم مع خانة فارغة لا يفتح شيئًا")


def _arrow_with_text_filters(combo, app, label, query="7770002"):
    """↓ مع نص مكتوب ← المطابقات المُرشَّحة فقط."""
    from PySide6.QtTest import QTest
    combo.lineEdit().setText("")
    QTest.keyClicks(combo.lineEdit(), query)
    app.processEvents()
    combo.showPopup()
    app.processEvents(); app.processEvents()
    assert not combo.view().isVisible(), \
        f"{label}: السهم فتح القائمة الكاملة!"
    n = combo.suggestion_count()
    assert n == 1, f"{label}: الترشيح مع السهم: {n}"
    assert combo.suggestions_visible(), f"{label}: الاقتراحات لم تظهر!"
    print(f"OK: {label} السهم مع نص يعرض المطابق فقط")


def main():
    from PySide6.QtWidgets import QApplication
    from services import customer_service as cs
    from ui.vouchers import VoucherDialog, GroupedPaymentDialog
    from ui.custody_center import CustodySettlementDialog
    from ui.word_forms_center import OfficialTemplateFillDialog

    database.init_db()
    app = QApplication.instance() or QApplication([])
    for i in range(1, 6):
        cs.add_customer(Customer(
            customer_code=f"CUST-S{i}", name=f"عميل بحث {i}",
            phone=f"777000{i}"))
    from services import lifecycle_service as _lc
    for i in (1, 2):
        _lc.add_subcontractor(f"SUB-T{i}", f"مقاول بحث {i}",
                              phone=f"778000{i}")
    try:
        # 1) سند صرف ← عميل مرتبط
        d_pay = VoucherDialog(None, "payment")
        d_pay.show(); app.processEvents()
        _click_no_popup(d_pay.expense_customer, app, "سند صرف/عميل مرتبط")
        _type_filters(d_pay.expense_customer, app, "سند صرف/عميل مرتبط")
        _arrow_no_full_list(d_pay.expense_customer, app, "سند صرف/عميل مرتبط")
        _arrow_with_text_filters(d_pay.expense_customer, app, "سند صرف/عميل مرتبط")

        # 2) السند المجمع ← عميل الصف
        d_rec = VoucherDialog(None, "receipt")
        d_rec.show(); app.processEvents()
        d_rec._add_group_row()
        app.processEvents()
        gcust = d_rec.group_table.cellWidget(0, 0)
        _click_no_popup(gcust, app, "السند المجمع/عميل الصف")
        _type_filters(gcust, app, "السند المجمع/عميل الصف")

        # 2ب) سند قبض ← الدافع (عميل/مقاول — صورة البلاغ)
        _click_no_popup(d_rec.party, app, "سند قبض/الدافع")
        _type_filters(d_rec.party, app, "سند قبض/الدافع")
        _arrow_no_full_list(d_rec.party, app, "سند قبض/الدافع")
        _arrow_with_text_filters(d_rec.party, app, "سند قبض/الدافع")
        _select_mouse_enter(d_rec.party, app, "سند قبض/الدافع")
        _popup_key_forward(d_rec.party, app, "سند قبض/الدافع")

        # 2ب2) بطاقة «الطرف والعقد»: متجاورة قبل المبلغ + دفع المطابقات صريح
        for _dlg, _vt in ((d_rec, "receipt"), (d_pay, "payment")):
            assert _dlg.party_group.title() == "الطرف والعقد"
            _gf = _dlg._party_group_form
            # V2.07: أُزيل صف «التحويل الداخلي» الدخيل من بطاقة القبض.
            assert _gf.rowCount() >= (2 if _vt == "receipt" else 3), _vt
            if _vt == "receipt":
                from PySide6.QtWidgets import QLabel as _QL
                _labels = [w.text() for w in _dlg.findChildren(_QL)]
                assert not any("التحويل الداخلي" in t for t in _labels)
            _r_grp, _ = _dlg.form.getWidgetPosition(_dlg.party_group)
            _r_amt, _ = _dlg.form.getWidgetPosition(_dlg.amount)
            assert 0 <= _r_grp < _r_amt, (_vt, _r_grp, _r_amt)
            assert _dlg.party in _dlg.party_group.findChildren(
                __import__("ui.widgets", fromlist=["SearchableComboBox"]).SearchableComboBox)
            assert _dlg.contract in _dlg.party_group.findChildren(
                __import__("ui.widgets", fromlist=["SearchableComboBox"]).SearchableComboBox)
        print("OK: بطاقة الطرف والعقد متجاورة قبل المبلغ في السندين")
        # الدفع الصريح: إشارة نصية برمجية تُظهر المطابق وحده
        d_rec.party.lineEdit().setText("")
        d_rec.party.lineEdit().textEdited.emit("7770002")
        app.processEvents(); app.processEvents()
        assert d_rec.party.suggestion_count() == 1
        assert d_rec.party.suggestions_visible()
        print("OK: أول حرف يدفع نافذة المطابق الوحيد صراحةً")
        # وضع المجمّع ما زال يُخفي الطرف/العقد ويُظهر الجدول
        d_rec.grouped_receipt_check.setChecked(True)
        app.processEvents()
        assert d_rec.grouped_panel.isVisible()
        assert not d_rec.party.isVisible() and not d_rec.contract.isVisible()
        d_rec.grouped_receipt_check.setChecked(False)
        app.processEvents()
        assert not d_rec.grouped_panel.isVisible()
        assert d_rec.party.isVisible() and d_rec.contract.isVisible()
        print("OK: وضع المجمّع يُخفي/يُظهر البطاقة سليمًا")

        # 2ج) عقد جديد ← العميل (صورة البلاغ)
        from ui.contracts import ContractDialog
        d_con = ContractDialog(None)
        d_con.show(); app.processEvents()
        _click_no_popup(d_con.customer, app, "عقد جديد/العميل")
        _type_filters(d_con.customer, app, "عقد جديد/العميل")
        _arrow_no_full_list(d_con.customer, app, "عقد جديد/العميل")
        _arrow_with_text_filters(d_con.customer, app, "عقد جديد/العميل")
        _select_mouse_enter(d_con.customer, app, "عقد جديد/العميل")

        # 3+4) السند المجمع ← تابات الأنواع + حفظ مختلط
        from ui.widgets import SegmentedTabs
        d_grp = GroupedPaymentDialog(None)
        d_grp.show(); app.processEvents()
        assert isinstance(d_grp.tabs, SegmentedTabs)
        assert d_grp.tabs.count() == 3
        assert [d_grp.tabs.itemData(i) for i in range(3)] == [
            "customer", "subcontractor", ""]
        assert d_grp.tabs.currentData() == ""
        assert d_grp.table is d_grp._tab_tables[""]
        assert d_grp.table.rowCount() == 1  # سطر بداية واحد (عام) كما قبل
        print("OK: تابات المجمع الثلاثة والتاب الافتراضي")
        # تاب العميل: مستفيد بحث فقط + اختيار بالماوس/إنتر
        d_grp.tabs.setCurrentData("customer")
        d_grp._add_row()
        app.processEvents()
        assert d_grp.table is d_grp._tab_tables["customer"]
        assert d_grp.table.columnCount() == 6
        _pc = d_grp.table.cellWidget(0, 1)
        _click_no_popup(_pc, app, "المجمع/عميل مستفيد")
        _type_filters(_pc, app, "المجمع/عميل مستفيد")
        _select_mouse_enter(_pc, app, "المجمع/عميل مستفيد")
        # تاب المقاول: بنية ثابتة بلا عمود نوع
        d_grp.tabs.setCurrentData("subcontractor")
        d_grp._add_row()
        app.processEvents()
        assert d_grp.table is d_grp._tab_tables["subcontractor"]
        assert d_grp.table.columnCount() == 6
        _ps = d_grp.table.cellWidget(0, 1)
        _click_no_popup(_ps, app, "المجمع/مقاول مستفيد")
        _type_filters(_ps, app, "المجمع/مقاول مستفيد", query="7780002")
        _select_mouse_enter(_ps, app, "المجمع/مقاول مستفيد", query="7780002", expect="مقاول بحث 2")
        # تاب العام: عميل مرتبط بحث فقط (سطر البداية)
        d_grp.tabs.setCurrentData("")
        app.processEvents()
        assert d_grp.table.columnCount() == 7
        _cc = d_grp.table.cellWidget(0, 2)
        _click_no_popup(_cc, app, "المجمع/عميل مرتبط")
        _type_filters(_cc, app, "المجمع/عميل مرتبط")
        _counts = [d_grp.tabs._buttons[i].text() for i in range(3)]
        assert _counts == ["عميل (1)", "مقاول باطن (1)",
                           "مصروف عام / مورد (1)"], _counts
        print("OK: عدّادات التابات")
        # حفظ مختلط من التابات الثلاثة → 3 سندات
        from services import expense_account_service as _ea
        from ui import style as _style
        _ea.ensure_defaults()
        for _k in ("customer", "subcontractor", ""):
            _t = d_grp._tab_tables[_k]
            _t.cellWidget(0, 0).set_items(_ea.posting_items(),
                                          auto_select=True)
        d_grp._tab_tables["customer"].cellWidget(0, 3).setValue(100)
        d_grp._tab_tables["subcontractor"].cellWidget(0, 3).setValue(200)
        _gt = d_grp._tab_tables[""]
        _gt.cellWidget(0, 1).setText("مورد اختبار")
        _gt.cellWidget(0, 4).setValue(300)
        d_grp.method.setCurrentIndex(0)  # V2.50: الطريقة إجبارية
        _ok_msgs, _err_msgs = [], []
        _orig_ok, _orig_err = _style.success, _style.error
        _orig_conf = _style.confirm
        _style.success = lambda *a, **k: _ok_msgs.append(a[1])
        _style.error = lambda *a, **k: _err_msgs.append(a[1])
        _style.confirm = lambda *a, **k: False
        try:
            d_grp._save()
        finally:
            _style.success, _style.error = _orig_ok, _orig_err
            _style.confirm = _orig_conf
        assert d_grp.result() == 1, f"لم يُقبل الحفظ: {_err_msgs}"
        assert not _err_msgs, _err_msgs
        print("OK: حفظ مختلط من التابات الثلاثة")
        # بند ناقص → انتقال تلقائي لتابه قبل عرض الخطأ
        d_bad = GroupedPaymentDialog(None)
        d_bad.method.setCurrentIndex(0)  # V2.50: الطريقة إجبارية
        d_bad.show(); app.processEvents()
        d_bad.tabs.setCurrentData("customer")
        d_bad._add_row()
        d_bad.tabs.setCurrentData("")
        app.processEvents()
        _err2 = []
        _style.success, _style.error = (lambda *a, **k: None,
                                       lambda *a, **k: _err2.append(a[1]))
        try:
            d_bad._save()
        finally:
            _style.success, _style.error = _orig_ok, _orig_err
        assert d_bad.result() == 0
        assert len(_err2) == 1, _err2
        assert d_bad.tabs.currentData() == "customer", "لم ينتقل لتاب الخطأ"
        print("OK: الانتقال التلقائي لتاب البند الناقص")
        d_bad.close()

        # 5) تصفية عهدة ← عميل اختياري
        d_set = CustodySettlementDialog(None)
        d_set.show(); app.processEvents()
        scust = d_set.f_cust
        _click_no_popup(scust, app, "تصفية عهدة/عميل")
        _type_filters(scust, app, "تصفية عهدة/عميل")

        # 6) تعبئة رسمية (عقد) ← العميل
        from docx import Document
        fd, tpl = tempfile.mkstemp(suffix=".docx")
        os.close(fd)
        doc = Document(); doc.add_paragraph("{{اسم_العميل}}"); doc.save(tpl)
        try:
            d_off = OfficialTemplateFillDialog(
                {"path": tpl, "name": "عقد", "kind": "contract"}, None)
            d_off.show(); app.processEvents()
            _click_no_popup(d_off.customer_cb, app, "تعبئة رسمية/العميل")
            _type_filters(d_off.customer_cb, app, "تعبئة رسمية/العميل",
                            query="CUST-S2")
            from ui.widgets import SearchableComboBox
            assert isinstance(d_off.customer_cb, SearchableComboBox)
            assert d_off.customer_cb._search_only is True
            _arrow_no_full_list(d_off.customer_cb, app, "تعبئة رسمية/العميل")
            _arrow_with_text_filters(d_off.customer_cb, app, "تعبئة رسمية/العميل",
                                     query="CUST-S2")
        finally:
            os.remove(tpl)

        # 7) تعبئة نموذج Word ← العميل (نفس الآلية + وحدة مستقلة)
        from PySide6.QtWidgets import QComboBox
        from ui.widgets import make_searchable
        mini = QComboBox()
        mini.addItems(["عميل بحث 1", "عميل بحث 2"])
        make_searchable(mini, click_to_open=False)
        mini.show(); app.processEvents()
        from PySide6.QtCore import Qt as _Qt
        from PySide6.QtTest import QTest as _QTest
        mini.lineEdit().setText("")
        _QTest.mouseClick(mini.lineEdit(), _Qt.LeftButton)
        app.processEvents(); app.processEvents()
        assert not mini.completer().popup().isVisible()
        assert getattr(mini, "_click_open_filter", None) is None
        print("OK: click_to_open=False لا يفتح بالنقر")

        # 8) بصمة النسخة في عنوان الرئيسية
        from version import APP_VERSION
        from ui.main_window import MainWindow
        w = MainWindow()
        assert w.windowTitle().endswith(APP_VERSION), w.windowTitle()
        print(f"OK: رقم الإصدار في العنوان ({w.windowTitle()})")
        # ملاحظة: لا نغلق الرئيسية هنا — closeEvent يعرض تأكيدًا مشروطًا
        # يعلّق التشغيل الآلي (سلوك أصلي مقصود للمستخدم الحقيقي).
        d_pay.close(); d_rec.close(); d_con.close(); d_grp.close(); d_set.close(); mini.close()
    finally:
        from database.database import get_connection
        try:
            with get_connection() as conn:
                conn.execute("DELETE FROM customers WHERE name LIKE 'عميل بحث %'")
        except Exception:
            pass
    print("PASS")


if __name__ == "__main__":
    main()
