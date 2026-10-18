# -*- coding: utf-8 -*-
"""V8.1: تشخيص رسائل بنود عقد العميل في شاشة عقد الباطن.

 الحالات المغطاة:
  1. عقد بلا بنود ⇒ رسالة واضحة مع إشارة لشاشة العقد.
  2. عقد من نوع له قالب (تلقائي) ⇒ يُخفى الصندوق ويذكر اسم النوع.
  3. كل البنود عند مقاول آخر ⇒ رسالة صريحة بأسماء المقاولين.
  4. خطأ مفتعل في list_boq ⇒ رسالة خطأ واضحة.
  5. tooltip على الصف المعطّل.
"""
import os, sys, tempfile
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db
_tmp = tempfile.mkdtemp(prefix="v81diag_")
db.DATA_DIR = _tmp
db.DB_PATH = os.path.join(_tmp, "t.sqlite")
db.init_db()

from PySide6.QtWidgets import QApplication, QLabel, QGroupBox, QTableWidget
app = QApplication.instance() or QApplication(sys.argv)

from database.database import get_connection
from database.models import Contract, Customer
from services import contract_service as cs
from services import customer_service
from services import contract_type_service as cts
from services import lifecycle_service as lc
from services import workflow_service as wf

MAN = "مقاولات_يدوي_81"
AUTO = "مقاولات_تلقائي_81"

passed = failed = 0


def reset_db():
    db.close_connections()
    if os.path.exists(db.DB_PATH):
        os.remove(db.DB_PATH)
    db.init_db()


def check(label, cond, detail=""):
    global passed, failed
    st = "PASS" if cond else "FAIL"
    if not cond:
        failed += 1
    else:
        passed += 1
    print(f"  [{st}] {label}" + (f" | {detail}" if detail and not cond else ""))


def _make_dlg(contract_id):
    """إنشاء LinkSubContractDialog مبسط للاختبار."""
    from ui.subcontractors import LinkSubContractDialog
    dlg = LinkSubContractDialog.__new__(LinkSubContractDialog)
    dlg.items_hint = QLabel()
    dlg.items_box = QGroupBox()
    dlg.items_hidden_note = QLabel()
    dlg.plan_box = QGroupBox("③ الدفعات")
    dlg.items_table = QTableWidget(0, 6)
    dlg.items_table.setHorizontalHeaderLabels(["✔", "البند", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"])
    dlg.chosen_table = QTableWidget(0, 5)
    dlg.chosen_total_lbl = QLabel()
    dlg.items_total_lbl = QLabel()
    dlg._items = []
    dlg._items_by_id = {}
    dlg._linked_other = {}
    dlg._chosen_ids = []
    dlg._items_cid = None
    dlg._items_error = None
    dlg._items_hidden = False
    dlg._client_auto = False

    class FakeCombo:
        def selected_data(self_inner):
            return contract_id
    dlg.contract = FakeCombo()
    return dlg


# ═══════════════════════════════════════════════════════════════
# 1) عقد بلا بنود
# ═══════════════════════════════════════════════════════════════
def test_no_items():
    """عقد بدون أي بنود ⇒ رسالة واضحة."""
    cust = customer_service.add_customer(Customer(customer_code="C-81-1", name="عميل_1", phone="111"))
    k = cs.add_contract(Contract(contract_number="C-81-1", contract_date="2026-01-01", customer_id=cust,
                                  contract_type=MAN, description="عقد فارغ",
                                  amount=1))
    dlg = _make_dlg(k)
    dlg._reload_items(cid=k)
    hint = dlg.items_hint.text()
    check("لا بنود: يذكر 'لا بنود'", "لا بنود" in hint, hint)
    check("لا بنود: يذكر 'بنود العقد'", "بنود العقد" in hint, hint)


# ═══════════════════════════════════════════════════════════════
# 2) عقد من نوع له قالب (تلقائي)
# ═══════════════════════════════════════════════════════════════
def test_templated_contract():
    """عقد من نوع له قالب ⇒ يُخفى الصندوق ويذكر اسم النوع."""
    cts.add_type(AUTO, 1000.0)
    wf.add_stage("contract", "التصميم", contract_type=AUTO)
    wf.add_stage("contract", "التنفيذ", contract_type=AUTO)

    cust = customer_service.add_customer(Customer(customer_code="C-81-2", name="عميل_2", phone="222"))
    k = cs.add_contract(Contract(contract_number="C-81-2", contract_date="2026-01-01", customer_id=cust,
                                  contract_type=AUTO, description="عقد تلقائي",
                                  amount=1000))
    dlg = _make_dlg(k)
    dlg._reload_items(cid=k)
    hint = dlg.items_hint.text()
    check("قالب: يذكر اسم النوع", AUTO in hint, hint)
    check("قالب: يذكر 'تلقائي'", "تلقائي" in hint, hint)
    check("قالب: الصندوق مخفي", not dlg.items_box.isVisible())


# ═══════════════════════════════════════════════════════════════
# 3) كل البنود عند مقاول آخر
# ═══════════════════════════════════════════════════════════════
def test_all_items_taken():
    """كل البنود مرتبطة بمقاول آخر ⇒ رسالة صريحة."""
    with get_connection() as conn:
        conn.execute("INSERT INTO subcontractors (sub_code, name, phone) VALUES ('SUB-81-A', 'مقاول ألف', '333')")
        conn.execute("INSERT INTO subcontractors (sub_code, name, phone) VALUES ('SUB-81-B', 'مقاول باء', '444')")
        conn.execute("COMMIT")
    sub_a = 1
    cust = customer_service.add_customer(Customer(customer_code="C-81-3", name="عميل_3", phone="555"))
    k = cs.add_contract(Contract(contract_number="C-81-3", contract_date="2026-01-01", customer_id=cust,
                                  contract_type=MAN, description="عقد",
                                  amount=5000))
    b1 = lc.add_boq_item(k, "بند أول", 10, "", 500.0)
    b2 = lc.add_boq_item(k, "بند ثاني", 20, "", 600.0)
    # ربط البنود بمقاول ألف
    sc_id = lc.add_sub_contract(sub_a, k, None, 1000)
    with get_connection() as conn:
        for bid in (b1, b2):
            conn.execute("INSERT INTO sub_contract_items (sub_contract_id, boq_item_id) VALUES (?, ?)", (sc_id, bid))
        conn.execute("COMMIT")

    dlg = _make_dlg(k)
    dlg._reload_items(cid=k)
    hint = dlg.items_hint.text()
    check("كلها عند مقاول: يذكر 'مرتبطة'", "مرتبطة" in hint, hint)
    check("كلها عند مقاول: يذكر اسم المقاول", "مقاول ألف" in hint, hint)


# ═══════════════════════════════════════════════════════════════
# 4) خطأ مفتعل في list_boq
# ═══════════════════════════════════════════════════════════════
def test_list_boq_error():
    """خطأ في list_boq ⇒ رسالة خطأ واضحة."""
    cust = customer_service.add_customer(Customer(customer_code="C-81-4", name="عميل_4", phone="666"))
    k = cs.add_contract(Contract(contract_number="C-81-4", contract_date="2026-01-01", customer_id=cust,
                                  contract_type=MAN, description="عقد",
                                  amount=1000))

    orig = lc.list_boq
    lc.list_boq = lambda cid: (_ for _ in ()).throw(RuntimeError("DB connection lost"))

    dlg = _make_dlg(k)
    dlg._reload_items(cid=k)
    hint = dlg.items_hint.text()
    check("خطأ: يذكر 'تعذّر'", "تعذّر" in hint, hint)
    check("خطأ: يذكر رسالة الخطأ", "DB connection lost" in hint, hint)
    lc.list_boq = orig


# ═══════════════════════════════════════════════════════════════
# 5) tooltip على الصف المعطّل
# ═══════════════════════════════════════════════════════════════
def test_tooltip_on_taken_row():
    """البنود المرتبطة بمقاول آخر لها tooltip باسم المقاول."""
    with get_connection() as conn:
        conn.execute("INSERT INTO subcontractors (sub_code, name, phone) VALUES ('SUB-81-T', 'مقاول تاء', '777')")
        conn.execute("COMMIT")
    sub_a = 1
    cust = customer_service.add_customer(Customer(customer_code="C-81-5", name="عميل_5", phone="888"))
    k = cs.add_contract(Contract(contract_number="C-81-5", contract_date="2026-01-01", customer_id=cust,
                                  contract_type=MAN, description="عقد",
                                  amount=2000))
    b1 = lc.add_boq_item(k, "بند أ", 10, "", 500.0)
    sc_id = lc.add_sub_contract(sub_a, k, None, 500)
    with get_connection() as conn:
        conn.execute("INSERT INTO sub_contract_items (sub_contract_id, boq_item_id) VALUES (?, ?)", (sc_id, b1))
        conn.execute("COMMIT")

    dlg = _make_dlg(k)
    dlg._reload_items(cid=k)

    t = dlg.items_table
    found_tooltip = False
    for r in range(t.rowCount()):
        for c in range(t.columnCount()):
            cell = t.item(r, c)
            if cell and "مقاول تاء" in (cell.toolTip() or ""):
                found_tooltip = True
                break
        if found_tooltip:
            break
    check("tooltip: يذكر اسم المقاول", found_tooltip)


# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    tests = [
        ("① بلا بنود", test_no_items),
        ("② قالب (تلقائي)", test_templated_contract),
        ("③ كلها عند مقاول آخر", test_all_items_taken),
        ("④ خطأ في list_boq", test_list_boq_error),
        ("⑤ tooltip معطّل", test_tooltip_on_taken_row),
    ]
    for label, fn in tests:
        print(f"\n=== {label} ===")
        reset_db()
        try:
            fn()
        except Exception as e:
            print(f"  FAIL (exception): {e}")
            failed += 1
    print(f"\n{'='*50}")
    print(f"النتيجة: {passed} نجح / {failed} فشل من {len(tests)}")
    sys.exit(1 if failed else 0)
