# -*- coding: utf-8 -*-
"""V4.18: تنظيف واجهات البوابة الأربع — دمج + فلاتر تلقائية + أزرار سياقية.

يغطي: جدول موحد للأخرى (✓ على المستحق غير المسدد فقط) بلا تغيير
حسابي · حذف زر عرض/سطر الملخص · قوائم ⋯ المزيد · ظهور الأزرار
السياقية (تسديد المحدد/توزيع/إرجاع) عند التحديد فقط.
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

from services import gateway_service as gw  # noqa: E402
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
D1 = "2026-09-10"
D2 = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)
st.save_gateway_ops(G, [
    {"date": D1, "phone": "91110001", "amount": 100.0, "ref": "RA",
     "status": "other"},
    {"date": D2, "phone": "91110002", "amount": 50.0, "ref": "RB",
     "status": "other"},
    {"date": D2, "phone": "91110003", "amount": 70.0, "ref": "RM",
     "status": "mine"}], "f.csv")
st.distribute_rows(G, [(D1, "91110001", 100.0, "RA"),
                       (D2, "91110002", 50.0, "RB"),
                       (D2, "91110003", 70.0, "RM")])
_ids = st.op_ids_for(G, [(D1, "91110001", 100.0, "RA")])
st.add_other_transfer("2026-09-21", 99.85, op_ids=_ids)

from PySide6.QtCore import QDate, Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402
from ui.clearing_page import ClearingPage  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402

app = QApplication.instance() or QApplication([])

print("=== 1. جدول الأخرى الموحد (عرض فقط) ===")
oc = OtherCompanyPage()
oc.mode.setCurrentData("ledger")  # V4.31: الافتراضي صار الكشوف
lg = st.other_ledger(oc._dates()[0], oc._dates()[1])
check("7 أعمدة بـ ✓ أولًا",
      oc.table.columnCount() == 7
      and oc.table.horizontalHeaderItem(0).text() == "✓")
check("الأرصدة مطابقة للدفتر",
      oc.table.item(oc.table.rowCount() - 1, 6).text()
      == f"{lg['end']:,.3f}",
      oc.table.item(oc.table.rowCount() - 1, 6).text())
check("البطاقات سليمة",
      oc._cards["dues"].text() == "149.700"
      and oc._cards["paid"].text() == "99.850"
      and oc._cards["remaining"].text() == "49.850",
      oc._cards["remaining"].text())
check("بلا جدول ثانٍ ولا سطر ملخص",
      not hasattr(oc, "items_table") and not hasattr(oc, "totals"))
check("بلا زر عرض",
      not any("عرض" in b.text()
              for b in oc.findChildren(QPushButton)))
check("الأخرى: 3 أزرار خارجية بلا ⋯",  # V4.42
      not hasattr(oc, "more_btn")
      and not oc.export_btn.isHidden()
      and not oc.print_btn.isHidden()
      and not oc.opening_btn.isHidden())
check("دفعة الحساب ظاهرة", not oc.pay_btn.isHidden())

print("=== 2. ✓ على المستحق غير المسدد فقط ===")
shown = oc._shown
ja = next(j for j, x in enumerate(shown)
          if x["kind"] == "due" and x.get("day") == D1)
jb = next(j for j, x in enumerate(shown)
          if x["kind"] == "due" and x.get("day") == D2)
from PySide6.QtCore import Qt as _Qt  # noqa: E402

fa = oc.table.item(ja, 0).flags()
fb = oc.table.item(jb, 0).flags()
check("المسدد بالكامل بلا ✓",
      not bool(fa & _Qt.ItemIsUserCheckable))
check("غير المسدد يقبل ✓", bool(fb & _Qt.ItemIsUserCheckable))
check("زر التسديد افتراضي (دفعة حرة)",
      oc.pay_btn.text() == "💸 دفعة على الحساب",
      oc.pay_btn.text())
oc.table.item(jb, 0).setCheckState(Qt.Checked)
app.processEvents()
check("التحديد يحوّل الزر لمربوط + عدّاد 49.85",
      "💸 تسديد المحدد" in oc.pay_btn.text()
      and "1 بند" in oc.pay_btn.text()
      and "49.850" in oc.pay_btn.text(),
      oc.pay_btn.text())
oc.table.item(jb, 0).setCheckState(Qt.Unchecked)
app.processEvents()
check("إلغاء التحديد يعيد الدفعة الحرة",
      oc.pay_btn.text() == "💸 دفعة على الحساب",
      oc.pay_btn.text())

print("=== 3. فلاتر تلقائية بلا زر ===")
oc.kind.setCurrentData("pay")
app.processEvents()
check("فلتر المسدد فوري",
      oc.table.rowCount() == 1
      and "💸" in oc.table.item(0, 3).text(),
      oc.table.rowCount())
oc.kind.setCurrentData("all")
oc.d1.setDate(QDate(2026, 9, 21))
app.processEvents()
check("التاريخ حدّث تلقائيًا (سطر سابق + سطر)",
      oc.table.rowCount() == 2
      and oc.table.item(1, 1).text() == "2026-09-21",
      oc.table.rowCount())
oc.d1.setDate(QDate.currentDate().addMonths(-1))
app.processEvents()
check("عاد الكل", oc.table.rowCount() == 3, oc.table.rowCount())

print("=== 4. التصنيف: توزيع سياقي + المزيد ===")
pg = GatewayPage()
check("التوزيع مخفي بلا صفوف", pg.dist_btn.isHidden())
acts = [a.text() for a in pg.more_btn.menu().actions()]
check("المزيد = 6 إجراءات",  # V4.40: ملفات البوابات بدل المطابقة
      acts == ["تعليم الكل: شركتنا", "تعليم الكل: شركة أخرى",
               "📤 تصدير", "🗑 مسح بيانات البوابات",
               "↩ إرجاع المحدد للتوزيع", "⚙️ ملفات البوابات"], acts)
check("الأساسية ظاهرة + الإرجاع سياقي مخفي",
      not pg.import_btn.isHidden()
      and pg.import_btn.text() == "＋ تسوية جديدة"
      and "dist" in pg._cards
      and pg.back_btn.isHidden()
      and not any(hasattr(pg, b)
                  for b in ("ours_btn", "other_btn", "wipe_btn",
                            "tabs", "show_dist")))
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "c.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "91110009,25.0,2026-09-20,RN,ج\n")
check("استيراد صف", pg.import_file(csv_path) == 1)
app.processEvents()
check("التوزيع ظهر (صف مصنّف)",
      not pg.dist_btn.isHidden())
from ui import style as _style  # noqa: E402

_orig_ok = _style.success
_style.success = lambda *a, **k: None
try:
    pg._distribute()
finally:
    _style.success = _orig_ok
check("التوزيع اختفى بعد الاعتماد", pg.dist_btn.isHidden())

# V4.34: §5 (شركتنا) دُمج نطاقًا في التقرير — غطاؤه في test_v434.

print("=== 5. التصفية: استيراد وحيد + المزيد ===")
cl = ClearingPage()
check("بلا زر عرض",
      not any("عرض" in b.text()
              for b in cl.findChildren(QPushButton)))
check("الاستيراد أساسي ظاهر",
      not cl.import_btn.isHidden())
acts = [a.text() for a in cl.more_btn.menu().actions()]
check("المزيد = البوابات + التصدير",
      acts == ["⚙ البوابات", "📤 تصدير"], acts)
n0 = cl.table.rowCount()
cl.d1.setDate(QDate.currentDate())
cl.d2.setDate(QDate.currentDate())
app.processEvents()
check("التواريخ حدّثت تلقائيًا",
      n0 == 2 and cl.table.rowCount() == 0, (n0, cl.table.rowCount()))

print("")
print("V4.18 cleanup: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
