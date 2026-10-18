"""اختبار انحدار: كل القوائم المنسدلة في الواجهات قابلة للبحث والكتابة والمسح.

- فحص استاتيكي (AST): كل استخدام لـ make_searchable مغطى باستيراد صحيح.
- فحص سلوكي: بناء الحوارات الأساسية والتأكد أن كل QComboBox قابل للتحرير
  (isEditable) ويملك مكمّل بحث (QCompleter)، وأن الكتابة/المسح لا تكسر القرّاء.
"""
from __future__ import annotations

import ast
import glob
import os
import shutil
import sqlite3
import sys
import tempfile

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP_ROOT)
sys.path.insert(0, APP_ROOT)
sys.path.insert(0, os.path.join(APP_ROOT, "tests"))

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QComboBox  # noqa: E402

from database import database  # noqa: E402
from ui.widgets import make_searchable  # noqa: E402,F401 (يثبت وجود الدالة)

TAG = "بحث شامل"
PATCHED_FILES = [
    "ui/vouchers.py", "ui/contracts.py", "ui/archive.py", "ui/comments_center.py",
    "ui/contract_hub.py", "ui/custody_center.py", "ui/dealings.py",
    "ui/fix_unspecified.py", "ui/settings.py", "ui/subcontractors.py",
    "ui/tasks.py", "ui/type_workflow.py", "ui/word_forms_center.py",
    "ui/reports_page.py",
]


def check_make_searchable_imports(path: str) -> list[str]:
    """كل دالة تستخدم make_searchable يجب أن تراه (استيراد علوي أو محلي)."""
    tree = ast.parse(open(path, encoding="utf-8").read())
    top: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "ui.widgets":
            top.update(a.asname or a.name for a in node.names)
    problems: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        uses = any(isinstance(n, ast.Name) and n.id == "make_searchable"
                   for n in ast.walk(node))
        if not uses or "make_searchable" in top:
            continue
        local = any(
            isinstance(n, ast.ImportFrom) and n.module == "ui.widgets"
            and any(a.name == "make_searchable" for a in n.names)
            for n in ast.walk(node))
        if not local:
            problems.append(f"{path}:{node.lineno} {node.name}")
    return problems


def assert_all_searchable(widget, label: str) -> int:
    boxes = widget.findChildren(QComboBox)
    assert boxes, f"{label}: لا توجد قوائم؟!"
    for box in boxes:
        assert box.isEditable(), f"{label}: قائمة غير قابلة للتحرير!"
        _has_search = (box.completer() is not None
                       or getattr(box, "_search_only", False))
        assert _has_search, f"{label}: قائمة بلا مكمّل بحث!"
    print(f"OK: {label}: {len(boxes)} قوائم كلها قابلة للبحث")
    return len(boxes)


def _cleanup(tag: str) -> None:
    """حذف شامل: تمريرات على كل الجداول حتى الثبات (قيود FK متشابكة)."""
    try:
        with database.get_connection() as conn:
            cust_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM customers WHERE name LIKE ?",
                (f"%{tag}%",))]
            con_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM contracts WHERE description LIKE ?",
                (f"%{tag}%",))]
            ids = {"customers": cust_ids, "contracts": con_ids}
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
                            for _id in ids.get(key, []):
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
                            for _id in ids.get(key, []):
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


def _make_docx(path: str) -> None:
    from docx import Document
    doc = Document()
    doc.add_paragraph("عقد {{رقم_العقد}} للعميل {{اسم_العميل}}")
    doc.save(path)


def main() -> None:
    database.init_db()
    from services import customer_service as cs, contract_service as ks
    from database.models import Customer, Contract

    # 1) الفحص الاستاتيكي لكل الملفات المرقعة
    for rel in PATCHED_FILES:
        problems = check_make_searchable_imports(
            os.path.join(APP_ROOT, rel))
        assert not problems, f"استيراد ناقص: {problems}"
    print(f"OK: الاستيرادات سليمة في {len(PATCHED_FILES)} ملفًا")

    app = QApplication.instance() or QApplication(sys.argv)

    # بيانات بذر
    _cleanup(TAG)
    cust = cs.add_customer(Customer(
        customer_code=f"CUST-CS-{TAG}", name=f"{TAG} عميل",
        phone="90000001"))
    contract = ks.add_contract(Contract(
        contract_number=f"CON-CS-{TAG}", customer_id=cust,
        contract_date="2026-01-01", description=f"{TAG} عقد",
        amount=50000.0, contract_type="مقاولة عامة"))

    total_boxes = 0
    try:
        # 2) سند قبض + سند صرف
        from ui.vouchers import (VoucherDialog, GroupedPaymentDialog)
        dlg_r = VoucherDialog(None, "receipt")
        total_boxes += assert_all_searchable(dlg_r, "سند قبض")
        dlg_p = VoucherDialog(None, "payment")
        total_boxes += assert_all_searchable(dlg_p, "سند صرف")
        dlg_g = GroupedPaymentDialog(None)
        total_boxes += assert_all_searchable(dlg_g, "سند مجمع")

        # 3) عقد جديد
        from ui.contracts import ContractDialog
        dlg_c = ContractDialog(None, None)
        total_boxes += assert_all_searchable(dlg_c, "إضافة عقد جديد")

        # 4) مهام + تعليقات + تقارير
        from ui.tasks import TaskDialog
        total_boxes += assert_all_searchable(TaskDialog(None), "مهمة")
        from ui.comments_center import CommentsCenterPage
        total_boxes += assert_all_searchable(CommentsCenterPage(), "التعليقات")
        from ui.reports_page import ReportsPage
        total_boxes += assert_all_searchable(ReportsPage(), "التقارير")

        # 5) نماذج Word: تعبئة رسمية (عقد/عرض) + تعبئة حرة + خريطة حقل
        from ui.word_forms_center import (
            OfficialTemplateFillDialog, WordFormFillDialog, FieldMapDialog)
        from services import word_forms_service as wfs
        tmp = tempfile.mkdtemp(prefix="combo_search_")
        sample = os.path.join(tmp, "sample.docx")
        _make_docx(sample)
        before = set(glob.glob(os.path.join(
            APP_ROOT, "data", "word_form_templates", "*")))
        d_off = OfficialTemplateFillDialog(
            {"path": sample, "name": "عقد", "kind": "contract"}, None)
        total_boxes += assert_all_searchable(d_off, "تعبئة رسمية/عقد")
        d_q = OfficialTemplateFillDialog(
            {"path": sample, "name": "عرض", "kind": "quotation"}, None)
        total_boxes += assert_all_searchable(d_q, "تعبئة رسمية/عرض")
        tpl = wfs.import_docx(f"{TAG} قالب", sample, created_by="test")
        tid = tpl["id"] if isinstance(tpl, dict) else tpl
        try:
            d_w = WordFormFillDialog(tid, None)
            total_boxes += assert_all_searchable(d_w, "تعبئة نموذج Word")
        finally:
            wfs.delete_template(tid)
            for f in set(glob.glob(os.path.join(
                    APP_ROOT, "data", "word_form_templates", "*"))) - before:
                os.remove(f)
            shutil.rmtree(tmp, ignore_errors=True)
        d_fm = FieldMapDialog(None, {"key": "رقم_العقد", "label": "رقم العقد"})
        total_boxes += assert_all_searchable(d_fm, "خريطة حقل")

        # 6) كتابة المستخدم ومسحه (محاكاة إشارة textEdited التي ترسلها Qt
        # مع كل ضغطة زر حقيقية — QTest.keyClicks لا يدعم العربية)
        def _user_type(le, text):
            le.setText(le.text() + text)
            le.textEdited.emit(le.text())
            app.processEvents()

        def _user_clear(le):
            le.setText("")
            le.textEdited.emit("")
            app.processEvents()

        def _leave_field(le):
            le.editingFinished.emit()
            app.processEvents(); app.processEvents()

        alloc = dlg_r.allocation
        alloc.setCurrentIndex(0)
        assert alloc.currentData() is not None
        _user_type(alloc.lineEdit(), "نص غريب")
        _user_clear(alloc.lineEdit())
        assert alloc.currentIndex() == -1 and alloc.currentData() is None
        dlg_r._auto_description()      # لا عطل مع تخصيص فارغ
        dlg_r._reload_allocations()    # إعادة الملء سليمة
        assert alloc.count() > 0
        print("OK: الكتابة والمسح في التخصيص يلغي التحديد دون كسر")

        # 7) نص غريب + مغادرة الخانة يرتد لنص العنصر المحدد
        dlg_c.ctype.setCurrentIndex(0)
        before = dlg_c.ctype.currentText()
        _user_type(dlg_c.ctype.lineEdit(), "zzغريبzz")
        _leave_field(dlg_c.ctype.lineEdit())
        assert dlg_c.ctype.currentText() == before
        assert dlg_c.ctype.currentData() is not None
        # ومسح نوع العقد يلغي التحديد ويعيد الوضع الافتراضي تلقائيًا
        _user_clear(dlg_c.ctype.lineEdit())
        assert dlg_c.ctype.currentData() is None
        assert dlg_c._mode == "lump"
        print("OK: التطبيع عند المغادرة والمسح في نوع العقد سليم")

        # 8) مسح طريقة الدفع يخفي حقل الشيك دون عطل
        _user_clear(dlg_r.method.lineEdit())
        assert dlg_r.method.currentIndex() == -1
        print("OK: مسح طريقة الدفع لا يكسر تبديل حقل الشيك")
    finally:
        _cleanup(TAG)

    print(f"OK: الإجمالي {total_boxes} قائمة منسدلة قابلة للبحث في الحوارات")
    print("PASS")


if __name__ == "__main__":
    main()
