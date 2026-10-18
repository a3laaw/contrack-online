# -*- coding: utf-8 -*-
"""اختبار الدفعة 15: توحيد خانات البيان ومنع التداخل في نوافذ الإدخال."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtWidgets import QHeaderView, QTableWidget  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {extra}")


def check_table(name, t: QTableWidget, init, floors, desc):
    w = [t.columnWidth(i) for i in range(t.columnCount())]
    check(f"{name}: المواصفة",
          getattr(t, "_fit_initial", None) == init
          and getattr(t, "_fit_floors", None) == floors
          and getattr(t, "_fit_desc_col", None) == desc
          and getattr(t, "_fit_floors_hooked", False) is True)
    check(f"{name}: تفاعلية",
          all(t.horizontalHeader().sectionResizeMode(i)
              == QHeaderView.Interactive
              for i in range(t.columnCount())))
    check(f"{name}: فوق الأرضيات",
          all(w[i] >= floors[i] for i in range(len(w))), w)
    check(f"{name}: البيان >= العقد",
          w[desc] >= max(w[i] for i in range(len(w))
                         if "العقد" in t.horizontalHeaderItem(i).text()),
          w)
    if t.rowCount():
        bad = [(i, t.cellWidget(0, i).minimumWidth(), w[i])
               for i in range(len(w))
               if t.cellWidget(0, i) is not None
               and t.cellWidget(0, i).minimumWidth() > w[i]]
        check(f"{name}: لا فيض", bad == [], bad)


app = QApplication.instance() or QApplication([])
from database.database import init_db  # noqa: E402

init_db()
from ui.custody_center import CustodySettlementDialog  # noqa: E402
from ui.invoices import InvoiceDialog  # noqa: E402
from ui.tasks import TaskDialog  # noqa: E402
from ui.vouchers import GroupedPaymentDialog, VoucherDialog  # noqa: E402

print("=== 1. القبض المجمع ===")
dlg = VoucherDialog(None, "receipt")
dlg.show()
dlg.grouped_receipt_check.setChecked(True)
dlg._add_group_row(False)
app.processEvents()
check_table("قبض", dlg._group_tables["customer"],
            [130, 120, 110, 180, 54], [100, 100, 95, 120, 40], 3)

print("=== 2. الصرف المجمع ===")
g = GroupedPaymentDialog(None)
g.show()
for kind, init, floors, desc in [
        ("customer", [220, 170, 160, 115, 220, 58],
         [170, 160, 150, 110, 160, 40], 4),
        ("subcontractor", [220, 170, 160, 115, 220, 58],
         [170, 160, 150, 110, 160, 40], 4),
        ("", [220, 170, 160, 150, 115, 220, 58],
         [170, 150, 150, 150, 110, 160, 40], 5)]:
    g.tabs.setCurrentData(kind)
    g._add_row()
    app.processEvents()
    check_table(f"صرف/{kind or 'مصروف'}", g._tab_tables[kind],
                init, floors, desc)
check("بيان عام >= 250", g.desc.minimumWidth() == 250)

print("=== 3. تصفية العهدة ===")
s = CustodySettlementDialog(None)
s.show()
app.processEvents()
check_table("تصفية", s.table,
            [44, 110, 180, 140, 180, 115, 220],
            [40, 100, 150, 110, 140, 100, 150], 6)
check("بيان عام >= 250", s.desc.minimumWidth() == 250)

print("=== 4. توحيد الارتفاعات ===")
inv = InvoiceDialog()
check("الفاتورة 64", inv.description.height() == 64
      and inv.notes.height() == 64)
td = TaskDialog(None)
check("المهمة 64", td.details.height() == 64)
dp = VoucherDialog(None, "payment")
check("السند 64", dlg.description.height() == 64
      and dp.description.height() == 64)

print(f"\nالنتيجة: {passed} ناجح / {failed} فاشل")
sys.exit(1 if failed else 0)
