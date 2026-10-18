# -*- coding: utf-8 -*-
"""قوالب العقود (جولة 2): اسم اليوم + القيمة من مجموع الدفعات دائمًا.

- {{يوم_الأسبوع}} و{{اسم_اليوم}} يُملآن باسم اليوم الحالي تلقائيًا + مصدر ربط جديد
  ({{اليوم}} بقي تاريخ اليوم كما كان).
- قيمة العقد = مجموع الدفعات في النموذج دائمًا (حتى مع عقد مختار)،
  والتجاوز اليدوي يُحترم حتى مسح الخانة.
- خانة التفقيط مقفلة (للقراءة) وتتبع الرقم لحظيًا.
"""
import os
import sys
import tempfile
from datetime import date

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_ROOT)
os.chdir(APP_ROOT)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from database import database  # noqa: E402
from database.models import Customer, Contract  # noqa: E402


FIELDS = ["التاريخ", "اليوم", "يوم_الأسبوع", "دفعة_1", "دفعة_2", "دفعة_3",
          "قيمة_العقد", "قيمة_العقد_كتابة"]


def _make_docx(fields):
    from docx import Document
    fd, path = tempfile.mkstemp(suffix=".docx")
    os.close(fd)
    doc = Document()
    doc.add_paragraph(" ".join("{{%s}}" % f for f in fields))
    doc.save(path)
    return path


def _cleanup(conn_ids):
    from database.database import get_connection
    try:
        with get_connection() as conn:
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
                " AND name NOT LIKE 'sqlite_%'")]
            for _ in range(12):
                deleted = 0
                for t in tables:
                    try:
                        cols = [r[1] for r in conn.execute(
                            f"PRAGMA table_info({t})")]
                    except Exception:
                        continue
                    for col, key in (("contract_id", "contracts"),
                                     ("customer_id", "customers"),
                                     ("expense_customer_id", "customers")):
                        if col in cols:
                            for _id in conn_ids.get(key, []):
                                try:
                                    cur = conn.execute(
                                        f"DELETE FROM {t} WHERE {col}=?",
                                        (_id,))
                                    deleted += cur.rowcount or 0
                                except Exception:
                                    pass
                    for tname, key in (("customers", "customers"),
                                       ("contracts", "contracts")):
                        if t == tname:
                            for _id in conn_ids.get(key, []):
                                try:
                                    cur = conn.execute(
                                        f"DELETE FROM {tname} WHERE id=?",
                                        (_id,))
                                    deleted += cur.rowcount or 0
                                except Exception:
                                    pass
                if deleted == 0:
                    break
    except Exception:
        pass


def main():
    from PySide6.QtWidgets import QApplication
    from services import customer_service as cs, contract_service as ks
    from services import form_service as fs
    from services.tafqeet import amount_to_words
    from ui.word_forms_center import OfficialTemplateFillDialog

    database.init_db()
    app = QApplication.instance() or QApplication([])
    ids = {"customers": [], "contracts": []}
    paths = []
    try:
        import random
        tag = f"{random.randint(1000, 9999)}"

        # --- 1) مصدر الربط: اسم اليوم ---
        tree = fs.data_source_tree()
        assert "weekday" in tree["system"]["fields"], "مصدر الربط: اسم اليوم"
        assert fs._resolve_system("weekday") == fs.arabic_weekday()
        assert fs.arabic_weekday() in (
            "الاثنين", "الثلاثاء", "الأربعاء", "الخميس",
            "الجمعة", "السبت", "الأحد")
        print("OK: مصدر ربط «اسم اليوم» يعمل")

        # --- بيانات ---
        cust = cs.add_customer(Customer(
            customer_code=f"CUST-V2-{tag}", name=f"عميل القيمة {tag}",
            phone=f"9888{tag}"))
        ids["customers"] = [cust]
        kid = ks.add_contract(Contract(
            contract_number=f"CON-V2-{tag}", customer_id=cust,
            contract_date="2026-09-01", description="عقد القيمة",
            amount=999.0, contract_type="غير محدد"))
        ids["contracts"] = [kid]
        with database.get_connection() as conn:
            conn.execute("DELETE FROM payment_plan WHERE contract_id=?",
                         (kid,))
            for i, amt in enumerate((150.0, 150.0, 200.0), 1):
                conn.execute(
                    "INSERT INTO payment_plan (contract_id, title, due_date, amount, sort_order, notes)"
                    " VALUES (?,?,?,?,?,?)",
                    (kid, f"دفعة {i}", "2026-10-01", amt, i, ""))
        tpl = _make_docx(FIELDS)
        paths.append(tpl)
        dlg = OfficialTemplateFillDialog(
            {"path": tpl, "name": "قالب القيمة", "kind": "contract"}, None)
        app.processEvents()

        # --- 2) الفتح الحر: التاريخ + اليوم تلقائي، والقيمة فارغة ---
        assert dlg._inputs["التاريخ"].text() == date.today().isoformat()
        assert dlg._inputs["يوم_الأسبوع"].text() == fs.arabic_weekday()
        assert dlg._inputs["اليوم"].text() == date.today().isoformat(), \
            "{{اليوم}} يبقى تاريخ اليوم (سلوك قديم)"
        assert dlg._inputs["قيمة_العقد"].text() == ""
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == ""
        assert dlg._inputs["قيمة_العقد_كتابة"].isReadOnly(), \
            "خانة التفقيط يجب أن تكون مقفلة"
        print("OK: الفتح الحر يملأ التاريخ واليوم والقيمة فارغة بلا دفعات")

        # --- 3) مع عقد: الدفعات من الخطة والقيمة = المجموع لا مبلغ العقد ---
        dlg.customer_cb.setCurrentIndex(dlg.customer_cb.findData(cust))
        app.processEvents()
        dlg.source_cb.setCurrentIndex(dlg.source_cb.findData(kid))
        app.processEvents()
        assert dlg._inputs["دفعة_1"].text() == "150.000", \
            dlg._inputs["دفعة_1"].text()
        assert dlg._inputs["دفعة_3"].text() == "200.000"
        assert dlg._inputs["قيمة_العقد"].text() == "500.000", \
            f"القيمة يجب أن تكون مجموع الدفعات لا مبلغ العقد: {dlg._inputs['قيمة_العقد'].text()}"
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == amount_to_words(
            500.0, "د.ك")
        print("OK: مع العقد القيمة = مجموع الدفعات (500 لا 999) والتفقيط يتبعها")

        # --- 4) تعديل دفعة يُعيد الجمع حيًّا ---
        dlg._inputs["دفعة_1"].setText("200")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد"].text() == "550.000"
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == amount_to_words(
            550.0, "د.ك")
        print("OK: تعديل الدفعات يُعيد حساب القيمة والتفقيط لحظيًا")

        # --- 5) التجاوز اليدوي ثم الاستئناف بالمسح ---
        dlg._inputs["قيمة_العقد"].setText("600")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد"].text() == "600"
        assert dlg._inputs["قيمة_العقد_كتابة"].text() == amount_to_words(
            600.0, "د.ك")
        dlg._inputs["قيمة_العقد"].setText("")
        app.processEvents()
        assert dlg._inputs["قيمة_العقد"].text() == "550.000"
        print("OK: التجاوز اليدوي يُحترم ويُستأنف التلقائي بالمسح")

    finally:
        _cleanup(ids)
        for p in paths:
            try:
                os.remove(p)
            except Exception:
                pass

    print("PASS")


if __name__ == "__main__":
    main()
