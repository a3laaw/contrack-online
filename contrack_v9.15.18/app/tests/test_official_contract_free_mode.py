# -*- coding: utf-8 -*-
"""نافذة تعبئة القوالب الرسمية (عقود): عميل إلزامي + عقد اختياري.

- مع عقد: كل البيانات من العقد بما فيها الدفعات من خطة السداد (قابلة للتعديل).
- قيمة العقد = مجموع الدفعات دائمًا (حتى مع عقد)، قابلة للتجاوز اليدوي،
  والتفقيط مقفل ويتبع القيمة الظاهرة لحظيًا.
- قوالب العروض: تبقى بسلوكها السابق دون تغيير.
"""
import os
import sys
import tempfile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)

from database import database  # noqa: E402


FIELDS = [
    "التاريخ", "اسم_المالك", "المنطقة", "الرقم_المدني",
    "دفعة_1", "دفعة_2", "دفعة_3",
    "رقم_القطعة", "رقم_القسيمة", "قيمة_العقد",
    "عدد_اكياس_الاسمنت", "هاتف_المالك", "قيمة_العقد_كتابة",
]


def _make_docx(fields):
    from docx import Document
    doc = Document()
    for name in fields:
        doc.add_paragraph("{{" + name + "}}")
    fd, path = tempfile.mkstemp(suffix=".docx", prefix="official_test_")
    os.close(fd)
    doc.save(path)
    return path


def _cleanup(conn_ids, paths):
    """حذف شامل لبيانات الاختبار: تمريرات على كل الجداول حتى الثبات،
    لأن إنشاء العقد يولّد تلقائيًا (مشروع/تعليق/مراحل) بقيود FK متشابكة."""
    from database.database import get_connection
    try:
        with get_connection() as conn:
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            for _ in range(12):
                deleted = 0
                for t in tables:
                    try:
                        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({t})")]
                    except Exception:
                        continue
                    for col, key in (("contract_id", "contracts"),
                                     ("customer_id", "customers"),
                                     ("expense_customer_id", "customers")):
                        if col in cols:
                            for _id in conn_ids.get(key, []):
                                try:
                                    cur = conn.execute(f"DELETE FROM {t} WHERE {col}=?", (_id,))
                                    deleted += cur.rowcount or 0
                                except Exception:
                                    pass
                    if t == "customers":
                        for _id in conn_ids.get("customers", []):
                            try:
                                cur = conn.execute("DELETE FROM customers WHERE id=?", (_id,))
                                deleted += cur.rowcount or 0
                            except Exception:
                                pass
                    if t == "contracts":
                        for _id in conn_ids.get("contracts", []):
                            try:
                                cur = conn.execute("DELETE FROM contracts WHERE id=?", (_id,))
                                deleted += cur.rowcount or 0
                            except Exception:
                                pass
                if deleted == 0:
                    break
    except Exception:
        pass
    for p in paths:
        try:
            os.remove(p)
        except Exception:
            pass


def main():
    from datetime import date
    database.init_db()
    from PySide6.QtWidgets import QApplication
    from database.models import Customer, Contract
    from database.database import get_connection
    from services import customer_service as cs, contract_service as ks
    from services.tafqeet import amount_to_words
    from ui.word_forms_center import OfficialTemplateFillDialog
    import ui.word_forms_center as wfc

    app = QApplication.instance() or QApplication([])
    ids = {"customers": [], "contracts": []}
    paths = []
    try:
        import random
        tag = f"{random.randint(1000, 9999)}"
        # --- بيانات اختبار (رموز فريدة لكل تشغيل) ---
        cust1 = cs.add_customer(Customer(
            customer_code=f"CUST-T1-{tag}", name=f"عميل اختبار أول {tag}",
            phone=f"9999{tag}", address_governorate="حولي",
            address_area="السالمية", address_block="7", address_plot="21"))
        cust2 = cs.add_customer(Customer(
            customer_code=f"CUST-T2-{tag}", name=f"عميل اختبار ثان {tag}",
            phone=f"9998{tag}", address_area="الفروانية"))
        ids["customers"] = [cust1, cust2]
        kid = ks.add_contract(Contract(
            contract_number=f"CON-T1-{tag}", customer_id=cust1,
            contract_date="2026-09-01", description="عقد اختبار",
            amount=500.0, contract_type="غير محدد"))
        ids["contracts"] = [kid]
        with get_connection() as conn:
            conn.execute("DELETE FROM payment_plan WHERE contract_id=?", (kid,))
            for i, amt in enumerate((150.0, 150.0, 200.0), 1):
                conn.execute(
                    "INSERT INTO payment_plan (contract_id, title, due_date, amount, sort_order, notes)"
                    " VALUES (?,?,?,?,?,?)",
                    (kid, f"دفعة {i}", "2026-10-01", amt, i, ""))

        path = _make_docx(FIELDS)
        paths.append(path)
        tpl = {"path": path, "name": "قالب اختبار", "kind": "contract"}

        # --- 1) فتح حر: بدون عقد افتراضيًا ---
        dlg = OfficialTemplateFillDialog(tpl, None)
        app.processEvents()
        assert hasattr(dlg, "customer_cb"), "قوالب العقود يجب أن تعرض قائمة العميل"
        assert dlg.source_cb.itemText(0) == "— بدون عقد —"
        assert dlg.source_cb.currentData() is None, "الافتراضي: بدون عقد (وضع حر)"
        assert dlg._inputs["التاريخ"].text() == date.today().isoformat()
        assert dlg._inputs["قيمة_العقد"].text() == ""

        # --- 2) اختيار العميل يملأ بيانات المالك فقط ---
        dlg.customer_cb.setCurrentIndex(dlg.customer_cb.findData(cust1))
        app.processEvents()
        assert dlg._inputs["اسم_المالك"].text() == f"عميل اختبار أول {tag}"
        assert dlg._inputs["المنطقة"].text() == "السالمية"
        assert dlg._inputs["رقم_القطعة"].text() == "7"
        assert dlg._inputs["رقم_القسيمة"].text() == "21"
        assert dlg._inputs["هاتف_المالك"].text() == f"9999{tag}"
        assert dlg._inputs["الرقم_المدني"].text() == "", "الرقم المدني يدوي (لا عمود له)"
        assert dlg._inputs["قيمة_العقد"].text() == ""
        assert dlg.source_cb.currentData() is None

        # --- 3) الوضع الحر: القيمة = مجموع الدفعات + التفقيط يتبعها ---
        dlg._inputs["دفعة_1"].setText("100")
        dlg._inputs["دفعة_2"].setText("200.5")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد"].text() == "300.500", dlg._inputs["قيمة_العقد"].text()
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == amount_to_words(300.5, "د.ك")

        # --- 4) تجاوز يدوي للقيمة يُحترم، والتفقيط يتبع القيمة الظاهرة ---
        dlg._inputs["قيمة_العقد"].setText("400")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == amount_to_words(400.0, "د.ك")
        dlg._inputs["دفعة_3"].setText("50")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد"].text() == "400", "التجاوز اليدوي يجب أن يبقى"
        assert "يدوي" in dlg.calc_hint.text()
        # مسح الخانة يستأنف الحساب التلقائي (100 + 200.5 + 50).
        dlg._inputs["قيمة_العقد"].setText("")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد"].text() == "350.500"

        # --- 5) اختيار عقد: كل البيانات + الدفعات من خطة السداد ---
        dlg.source_cb.setCurrentIndex(dlg.source_cb.findData(kid))
        app.processEvents()
        assert dlg.customer_cb.currentData() == cust1, "العقد يزامن العميل مع مالكه"
        assert dlg._inputs["دفعة_1"].text() == "150.000", dlg._inputs["دفعة_1"].text()
        assert dlg._inputs["دفعة_2"].text() == "150.000"
        assert dlg._inputs["دفعة_3"].text() == "200.000"
        assert wfc.OfficialTemplateFillDialog._parse_value_text(
            dlg._inputs["قيمة_العقد"].text()) == 500.0
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == amount_to_words(500.0, "د.ك")
        assert dlg._inputs["اسم_المالك"].text() == f"عميل اختبار أول {tag}"
        assert "تلقائيًا من المجموع" in dlg.calc_hint.text(), \
            dlg.calc_hint.text()

        # تعديل دفعة في وضع العقد يُعيد جمع قيمة العقد (المجموع دائمًا).
        dlg._inputs["دفعة_1"].setText("100.000")
        app.processEvents()
        assert wfc.OfficialTemplateFillDialog._parse_value_text(
            dlg._inputs["قيمة_العقد"].text()) == 450.0
        assert "تلقائيًا من المجموع" in dlg.calc_hint.text()

        # --- 6) تبديل العميل يُسقط عقد العميل السابق ---
        dlg.customer_cb.setCurrentIndex(dlg.customer_cb.findData(cust2))
        app.processEvents()
        assert dlg.source_cb.currentData() is None
        assert dlg._inputs["اسم_المالك"].text() == f"عميل اختبار ثان {tag}"
        assert dlg._inputs["المنطقة"].text() == "الفروانية"

        # --- 7) التوليد يشترط العميل (عقود فقط) ---
        calls = []
        orig = wfc.style.error
        wfc.style.error = lambda *a, **k: calls.append(a)
        try:
            dlg_free = OfficialTemplateFillDialog(tpl, None)
            dlg_free._generate()
            assert calls, "التوليد بدون عميل يجب أن يُرفض برسالة"
        finally:
            wfc.style.error = orig

        # --- 8) قوالب العروض: بلا تغيير ---
        qpath = _make_docx(["اسم_العميل", "التاريخ"])
        paths.append(qpath)
        qdlg = OfficialTemplateFillDialog(
            {"path": qpath, "name": "عرض", "kind": "quotation"}, None)
        app.processEvents()
        assert not hasattr(qdlg, "customer_cb"), "العروض بلا قائمة عميل (كما كانت)"
        assert not hasattr(qdlg, "calc_hint"), "العروض بلا تلميح حساب (كما كانت)"
        assert qdlg.source_cb.count() == 0  # لا عروض في القاعدة ولا خيار إضافي

        # --- 9) الفتح من ملف عميل: العميل ثابت ومختار ---
        dlg_locked = OfficialTemplateFillDialog(tpl, None, customer_id=cust1)
        app.processEvents()
        assert dlg_locked.customer_cb.currentData() == cust1
        assert not dlg_locked.customer_cb.isEnabled()
        assert dlg_locked._inputs["اسم_المالك"].text() == f"عميل اختبار أول {tag}"

        print("OK: عميل إلزامي + عقد اختياري + وضع حر بالمجموع + تفقيط تابع + عروض بلا تغيير")
    finally:
        _cleanup(ids, paths)


if __name__ == "__main__":
    main()
