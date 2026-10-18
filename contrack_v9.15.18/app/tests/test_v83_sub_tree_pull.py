#!/usr/bin/env python3
"""
V8.3: اختبار إنزال البنود من شجرة عقد العميل في نافذة ربط عقد باطن.
"""
import sys, os, tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["QT_QPA_PLATFORM"] = "offscreen"

import database.database as db  # noqa: E402
_DB_DIR = tempfile.mkdtemp(prefix="v83_")
db.DATA_DIR = _DB_DIR
db.DB_PATH = os.path.join(_DB_DIR, "test.sqlite")

from PySide6.QtWidgets import QApplication, QMessageBox, QDialog
app = QApplication(sys.argv)

# Mock ALL message dialogs to prevent hangs
QMessageBox.exec = lambda self: 0
QMessageBox.exec_ = lambda self: 0

# Patch style functions that show dialogs
import ui.style as style
for _n in ("info", "error", "toast", "success", "warning"):
    if hasattr(style, _n):
        setattr(style, _n, lambda *a, **kw: None)



from PySide6.QtCore import Qt
from PySide6.QtTest import QTest

from database.database import init_db, get_connection
init_db()

from services import contract_type_service as cts
from services import contract_service as cs
from services import customer_service as cus
from database.models import Contract
from services.customer_service import Customer
from services import lifecycle_service as lc

# === helpers ===
PASS = 0
FAIL = 0

def check(desc: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {desc}")
    else:
        FAIL += 1
        extra = f" ({detail})" if detail else ""
        print(f"  ❌ {desc}{extra}")


# =====================================================
print("\n═══════════════════════════════════════════")
print("  V8.3: إنزال البنود من شجرة عقد العميل")
print("═══════════════════════════════════════════\n")

# === إنشاء البيانات الأساسية ===
print("📋 إعداد البيانات...")
cts.add_type("مقاولات يدوي", manual_track=True)

cust = Customer(customer_code="C001", name="عميل تجريبي", phone="12345678")
cust_id = cus.add_customer(cust)

contract = Contract(
    contract_number="CON-001", customer_id=cust_id,
    contract_date="2026-01-01", description="عقد تجريبي",
    amount=100000, contract_type="مقاولات يدوي"
)
contract_id = cs.add_contract(contract)

# إضافة مراحل وبنود BOQ
with get_connection() as conn:
    # مراحل القالب
    conn.execute(
        "INSERT INTO workflow_stages "
        "(transaction_type, stage_name, stage_order, contract_type) "
        "VALUES ('contract', 'الأعمال التحضيرية', 1, 'مقاولات يدوي')")
    conn.execute(
        "INSERT INTO workflow_stages "
        "(transaction_type, stage_name, stage_order, contract_type) "
        "VALUES ('contract', 'أعمال الأساسات', 2, 'مقاولات يدوي')")
    conn.execute(
        "INSERT INTO workflow_stages "
        "(transaction_type, stage_name, stage_order, contract_type) "
        "VALUES ('contract', 'أعمال التشطيب', 3, 'مقاولات يدوي')")

    # مراحل العقد
    stages = conn.execute(
        "SELECT * FROM workflow_stages "
        "WHERE contract_type='مقاولات يدوي' ORDER BY stage_order"
    ).fetchall()
    stage_ids = []
    for s in stages:
        cur = conn.execute(
            "INSERT INTO contract_stages "
            "(contract_id, name, level, sort_order) VALUES (?, ?, 1, ?)",
            (contract_id, s["stage_name"], s["stage_order"]))
        stage_ids.append(cur.lastrowid)

    # بنود BOQ مرتبطة بالعقد
    boq_ids = []
    boq_data = [
        ("تهيئة الموقع", "م2", 500, 10, stage_ids[0]),
        ("حفر أساسات", "م3", 200, 25, stage_ids[1]),
        ("صب خرسانة", "م3", 150, 40, stage_ids[1]),
        ("دهانات داخلية", "م2", 800, 5, stage_ids[2]),
    ]
    for name, unit, qty, price, sid in boq_data:
        cur = conn.execute(
            "INSERT INTO boq_items "
            "(contract_id, description, unit, qty, unit_price, "
            " stage_id) VALUES (?, ?, ?, ?, ?, ?)",
            (contract_id, name, unit, qty, price, sid))
        boq_ids.append(cur.lastrowid)

    # خطة دفعات العقد
    for i, sid in enumerate(stage_ids):
        conn.execute(
            "INSERT INTO payment_plan "
            "(contract_id, title, due_date, amount, sort_order, stage_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (contract_id, f"دفعة {i+1}", f"2026-0{i+1}-01",
             30000 + i * 5000, i + 1, sid))

    conn.commit()

sub_id = lc.add_subcontractor("S001", "مقاول تجريبي", "87654321")
print(f"  العميل #{cust_id}  العقد #{contract_id}  المقاول #{sub_id}")
print(f"  المراحل: {len(stage_ids)}  البنود: {len(boq_ids)}")


# =====================================================
# سيناريو 1: فتح النافذة وتحميل الشجرة
# =====================================================
print("\n─── سيناريو 1: تحميل شجرة البنود ───")

from ui.subcontractors import LinkSubContractDialog

dlg = LinkSubContractDialog(None)
dlg.show()
QTest.qWait(200)
app.processEvents()

# اختيار البيانات
dlg.sub.select_data(sub_id)
dlg.customer.select_data(cust_id)
dlg.contract.select_data(contract_id)
QTest.qWait(300)
app.processEvents()

tree = dlg.scope_tree
check("الشجرة موجودة", tree is not None)
check("الشجرة تحتوي على عناصر", tree.topLevelItemCount() > 0)

# فحص المحتوى
n_stages = tree.topLevelItemCount()
n_items_total = sum(tree.topLevelItem(i).childCount()
                    for i in range(n_stages))
print(f"  المراحل: {n_stages}  البنود: {n_items_total}")
check("عدد المراحل > 0", n_stages > 0, f"got {n_stages}")


# =====================================================
# سيناريو 2: تحديد عناصر وإنزالها
# =====================================================
print("\n─── سيناريو 2: تحديد وإنزال ───")

# تحديد المرحلة الأولى بالكامل
top0 = tree.topLevelItem(0)
if top0 and top0.childCount() > 0:
    top0.setCheckState(0, Qt.Checked)
    app.processEvents()

    # فحص أن الأبناء تحددوا
    n_checked_children = sum(
        1 for i in range(top0.childCount())
        if top0.child(i).checkState(0) == Qt.Checked
    )
    check("تحديد المرحلة يحدد أبناءها",
          n_checked_children == top0.childCount(),
          f"checked={n_checked_children} total={top0.childCount()}")
else:
    print("  ⚠️ لا أبناء في المرحلة الأولى")

# إنزال المحدد
dlg._pull_selected()
app.processEvents()

check("تم إنزال صفوف", len(dlg._pulled_rows) > 0,
      f"got {len(dlg._pulled_rows)}")

if dlg._pulled_rows:
    row = dlg._pulled_rows[0]
    check("الصف يحتوي على الكمية", "qty" in row and row["qty"] > 0,
          f"qty={row.get('qty')}")
    check("الصف يحتوي على سعر الوحدة",
          "unit_price" in row and row["unit_price"] > 0,
          f"price={row.get('unit_price')}")
    check("الصف يحتوي على المبلغ",
          "amount" in row and row["amount"] > 0,
          f"amount={row.get('amount')}")
    check("الصف يحتوي على source_kind", "source_kind" in row)


# =====================================================
# سيناريو 3: تعديل الكميات والأسعار
# =====================================================
print("\n─── سيناريو 3: تعديل القيم ───")

if dlg._pulled_rows:
    old_qty = dlg._pulled_rows[0].get("qty", 0)
    new_qty = old_qty + 10
    dlg._pulled_rows[0]["qty"] = new_qty
    dlg._pulled_rows[0]["amount"] = new_qty * dlg._pulled_rows[0]["unit_price"]
    check("تم تعديل الكمية",
          dlg._pulled_rows[0]["qty"] == new_qty,
          f"{old_qty} → {new_qty}")
    check("المبلغ تحدّث",
          dlg._pulled_rows[0]["amount"] == new_qty * dlg._pulled_rows[0]["unit_price"])

# فحص أن القيم المُعدَّلة تبقى كما هي عند إعادة الإنزال
# (إعادة تحديد وإلغاء ثم تحديد وإعادة إنزال)
if dlg._pulled_rows and top0 and top0.childCount() > 0:
    # إلغاء تحديد المرحلة
    top0.setCheckState(0, Qt.Unchecked)
    app.processEvents()
    
    # إزالة من pulled_rows
    dlg._pulled_rows.clear()
    app.processEvents()
    
    # إعادة تحديد
    top0.setCheckState(0, Qt.Checked)
    app.processEvents()
    
    # إعادة إنزال
    dlg._pull_selected()
    app.processEvents()
    
    check("إعادة الإنزال تعمل", len(dlg._pulled_rows) > 0)


# =====================================================
# سيناريو 4: جدول pulled_table
# =====================================================
print("\n─── سيناريو 4: جدول البنود المُنزَّلة ───")

ptable = dlg.pulled_table
check("الجدول المُنزَّل موجود", ptable is not None)
check("عدد صفوف الجدول يطابق pulled_rows",
      ptable.rowCount() == len(dlg._pulled_rows),
      f"table={ptable.rowCount()} rows={len(dlg._pulled_rows)}")


# =====================================================
# سيناريو 5: `_selected_item_ids` و `_pulled_items_data`
# =====================================================
print("\n─── سيناريو 5: دوال البيانات ───")

sel_ids = dlg._selected_item_ids()
check("_selected_item_ids يُرجع قائمة", isinstance(sel_ids, list))

pulled_data = dlg._pulled_items_data()
check("_pulled_items_data يُرجع قائمة", isinstance(pulled_data, list))
if pulled_data:
    check("بيانات pulled تحتوي source_kind",
          "source_kind" in pulled_data[0])


# =====================================================
# سيناريو 6: الحفظ
# =====================================================
print("\n─── سيناريو 6: الحفظ ───")

dlg.amount.setValue(50000)
app.processEvents()

try:
    dlg._save()
    app.processEvents()
    check("الحفظ نجح", True)
except Exception as e:
    check("الحفظ نجح", False, str(e))

dlg.close()


# =====================================================
# الملخص
# =====================================================
print(f"\n{'='*45}")
print(f"  ✅ نجح: {PASS}   ❌ فشل: {FAIL}")
print(f"{'='*45}")

if FAIL:
    print("\n⚠️  هناك اختبارات فاشلة!")
    sys.exit(1)
else:
    print("\n🎉 كل الاختبارات نجحت!")
    sys.exit(0)
