# -*- coding: utf-8 -*-
"""V4.27: تجميع الكشوف (خدمة) + الدفتر والزر الذكي.

V4.40: وضع الكشوف حُذف من الشاشة (بلا تجميع بتاريخ الرفع) —
حل محله تقرير العمليات · الخدمة باقية للتوافق.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

from database import database  # noqa: E402

database.init_db()

from services import settlement_service as st  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


G = "Hesabe"
D1 = "2026-09-20"
D2 = "2026-09-21"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops(G, [
    {"date": D1, "phone": "94440001", "amount": 100.0, "ref": "PA",
     "status": "other", "customer": "أ"},
    {"date": D1, "phone": "94440002", "amount": 50.0, "ref": "UB",
     "status": "other", "customer": "ب"},
    {"date": D1, "phone": "94440003", "amount": 70.0, "ref": "UM",
     "status": "mine", "customer": "ج"},
    {"date": D1, "phone": "94440004", "amount": 30.0, "ref": "UU",
     "status": "unmarked", "customer": "د"}], "f1.xlsx")
st.distribute_rows(G, [(D1, "94440001", 100.0, "PA"),
                       (D1, "94440002", 50.0, "UB"),
                       (D1, "94440003", 70.0, "UM")])
_ids = st.op_ids_for(G, [(D1, "94440001", 100.0, "PA")])
st.add_other_transfer("2026-09-21", 99.85, op_ids=_ids)
st.save_gateway_ops(G, [
    {"date": D2, "phone": "94440005", "amount": 20.0, "ref": "UC",
     "status": "other", "customer": "ه"}], "f2.xlsx")
with database.get_connection() as conn:
    conn.execute("UPDATE gateway_ops SET created_at='2026-09-20 10:00:00' "
                 "WHERE batch='f1.xlsx'")
    try:
        conn.commit()
    except Exception:
        pass

print("=== 1. تجميع الكشوف ===")
batches = st.list_upload_batches()
check("مجموعتان", len(batches) == 2, len(batches))
check("الأحدث أولًا",
      batches[0]["batch"] == "f2.xlsx"
      and batches[1]["batch"] == "f1.xlsx",
      [b["batch"] for b in batches])
f1 = next(b for b in batches if b["batch"] == "f1.xlsx")
check("مجاميع f1",
      f1["n_ops"] == 4 and f1["n_dist"] == 3 and f1["n_paid"] == 1
      and f1["due_amount"] == 50.0
      and f1["day"] == "2026-09-20" and f1["gateway"] == G, f1)
f2 = next(b for b in batches if b["batch"] == "f2.xlsx")
check("مجاميع f2",
      f2["n_ops"] == 1 and f2["n_dist"] == 0 and f2["due_amount"] == 0.0,
      f2)
ops = st.upload_batch_ops(G, "f1.xlsx", "2026-09-20")
check("محتويات f1 كاملة",
      len(ops) == 4
      and {o["ref"] for o in ops} == {"PA", "UB", "UM", "UU"}
      and all("gw_paid" in o for o in ops), len(ops))

print("=== 2. الدفتر والزر الذكي ===")
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.other_company_page import (ExportDialog,  # noqa: E402
                                   OtherCompanyPage)

app = QApplication.instance() or QApplication([])
oc = OtherCompanyPage()
check("الوضع الافتراضي المستحق",  # V4.40
      oc.mode.currentData() == "due"
      and not oc.mode.isHidden()
      and oc.table.isHidden()
      and not oc.dues_embed.isHidden())
oc.mode.setCurrentData("ledger")
app.processEvents()
check("الدفتر صريحًا",
      oc.table.columnCount() == 7
      and oc.table.horizontalHeaderItem(0).text() == "✓")
check("الفلتر معاد التسمية",
      [b.text() for b in oc.kind._buttons]
      == ["الكل", "مستحق لها", "مسدد لها"],
      [b.text() for b in oc.kind._buttons])
check("بلا ⋯ والأزرار خارجية",  # V4.42
      not hasattr(oc, "more_btn")
      and oc.export_btn.text() == "📤 تصدير"
      and oc.print_btn.text() == "🖨 طباعة"
      and oc.opening_btn.text() == "⚙️ الرصيد الافتتاحي"
      and not oc.export_btn.isHidden()
      and not oc.print_btn.isHidden()
      and not oc.opening_btn.isHidden()
      and not hasattr(oc, "pay_checked_btn")
      and not hasattr(oc, "checked_lbl"))
check("التسديد افتراضي دفعة حرة",
      oc.pay_btn.text() == "💸 دفعة على الحساب", oc.pay_btn.text())
jb = next(j for j, x in enumerate(oc._shown)
          if x["kind"] == "due" and x.get("day") == D1)
oc.table.item(jb, 0).setCheckState(Qt.Checked)
app.processEvents()
check("التحديد يحوّل لمربوط",
      "💸 تسديد المحدد" in oc.pay_btn.text()
      and "1 بند" in oc.pay_btn.text()
      and "49.850" in oc.pay_btn.text(), oc.pay_btn.text())
oc.table.item(jb, 0).setCheckState(Qt.Unchecked)
app.processEvents()
check("الإلغاء يعيد الحرة",
      oc.pay_btn.text() == "💸 دفعة على الحساب", oc.pay_btn.text())

print("=== 3. تقرير العمليات بدل الكشوف ===")  # V4.40
oc.mode.setCurrentData("ops")
app.processEvents()
check("جدول العمليات",
      oc.table.columnCount() == 8
      and oc.table.horizontalHeaderItem(7).text() == "الحالة"
      and oc.table.rowCount() == 3
      and oc.table.item(0, 1).text() == "أ"
      and oc.table.item(0, 7).text() == "✅ مسدد"
      and oc.table.item(1, 7).text() == "📌 مستحق"
      and not oc.d1.isHidden() and not oc.kind.isHidden())
oc.search.setText("ب")
app.processEvents()
check("البحث في العمليات",
      oc.table.rowCount() == 2
      and oc.table.item(0, 1).text() == "ب",
      oc.table.rowCount())
oc.search.setText("")
app.processEvents()
oc.kind.setCurrentData("pay")
app.processEvents()
check("فلتر المسدد",
      oc.table.rowCount() == 2
      and oc.table.item(0, 1).text() == "أ",
      oc.table.rowCount())
oc.kind.setCurrentData("all")
app.processEvents()

print("=== 4. التسديد بلا لوحة سفلية ===")  # V4.41
oc._on_table_click(0, 0)
app.processEvents()
check("الضغطة لا تفتح لوحة",
      oc.detail_box.isHidden()
      and oc.table.columnCount() == 8
      and oc.table.item(0, 7).text() == "✅ مسدد")
oc.mode.setCurrentData("due")
app.processEvents()
check("التبويب للمستحق",
      oc.mode.currentData() == "due"
      and oc.table.isHidden()
      and not hasattr(oc, "back_btn"))
d1, d2 = oc._dates()
ed = ExportDialog(oc, d1, d2)
check("التصدير افتراضي الكشف بتواريخ الشاشة",
      ed.choice() == ("ledger", d1, d2)
      and not ed.d1.isEnabled(), ed.choice())
ed.opt_recon.setChecked(True)
app.processEvents()
check("المطابقة تفتح التواريخ",
      ed.d1.isEnabled() and ed.choice()[0] == "recon", ed.choice())
ed.close()

print(f"\nV4.27 uploads: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
