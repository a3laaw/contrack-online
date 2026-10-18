# -*- coding: utf-8 -*-
"""V4.30: المرحلة 3 — الموزَّع عرض داخل التصنيف (بلا تبويب شركتنا).

يغطي: 3 تبويبات مسماة · كارت 🔒 الموزَّع + حالة اليوم · الإرجاع السياقي ·
قفزة الملخص للموزَّع · ⋯ (إرجاع/مطابقة البنك) · حراس العرض فقط.
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
D = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)

from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
p = os.path.join(_tmpdir, "d.csv")
with open(p, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "92220002,60.0,2026-09-20,F2,غ\n"
             "92220003,30.0,2026-09-20,F3,هـ\n")

print("=== 1. الحاوية: تبويبان (V4.40) ===")
mg = PaymentGatewayPage()
check("التبويبان مسميان بلا مطابقة",
      mg.stack.count() == 2 and mg.tabs.count() == 2
      and [b.text() for b in mg.tabs._buttons]
      == ["التصنيف والتوزيع", "الشركة الأخرى"]
      and not hasattr(mg, "ours_tab")
      and not hasattr(mg, "clear_tab"))
check("المفاتيح محفوظة",
      mg.tabs.currentData() == "match"
      and hasattr(mg, "match_tab") and hasattr(mg, "other_tab"))

print("=== 2. التوزيع ثم القفز للموزَّع ===")
mt = mg.match_tab
mt.gw_combo.setCurrentIndex(mt.gw_combo.findData(G))
check("استيراد صفين", mt.import_file(p) == 2)
app.processEvents()
mt._on_cell(0, 6)
mt._on_cell(0, 6)
check("الأول صار شركتنا",
      mt.table.item(0, 6).text() == "✅ شركتنا",
      mt.table.item(0, 6).text())
mt._distribute()
app.processEvents()
d2 = mt._sum_dlg
btns = {b.text(): b for b in d2.findChildren(QPushButton)}
check("أزرار الملخص",
      sorted(btns) == ["→ الموزَّع", "→ حساب الأخرى", "✕ إغلاق"],
      sorted(btns))
check("كارت الموزَّع = شركتنا + الأخرى (F2 + F3)",  # V4.5.12.1
      mt._cards["dist"].text() == "عمليتان\n90.000 د.ك"
      and "شركة أخرى: عملية واحدة" in mt._cards["dist"].toolTip(),
      (mt._cards["dist"].text(), mt._cards["dist"].toolTip()))
btns["→ الموزَّع"].click()
app.processEvents()
check("القفزة: التصنيف + فلتر الموزَّع (صفّانا)",
      # V4.5.12.1: القفزة تعرض الموزَّع كاملًا: شركتنا + شركة أخرى
      mg.stack.currentIndex() == 0 and mt._filter == "dist"
      and mt.table.rowCount() == 2
      and mt.table.item(0, 6).text() == "✅ شركتنا"
      and mt.table.item(0, 10).text().startswith("🏦 يوم: ")
      and mt.table.item(1, 6).text() == "🏢 شركة أخرى"
      and mt.table.item(1, 7).text() == "🔒 موزَّعة — شركة أخرى",
      [(mt.table.item(i, 6).text(), mt.table.item(i, 7).text())
       for i in range(mt.table.rowCount())])
d2.close()

print("=== 3. بحث الموزَّع + الإرجاع السياقي ===")
mt.search.setText("92220002")
app.processEvents()
check("البحث يفلتر الموزَّع", mt.table.rowCount() == 1,
      mt.table.rowCount())
mt.search.setText("zzz")
app.processEvents()
check("بحث عقيم = صفر", mt.table.rowCount() == 0)
mt.search.setText("")
app.processEvents()
check("الإرجاع مخفي بلا تحديد", mt.back_btn.isHidden())
mt.table.item(0, 0).setSelected(True)
app.processEvents()
check("الإرجاع ظهر عند التحديد", not mt.back_btn.isHidden())

print("=== 4. ⋯: ملفات البوابات + الإرجاع ===")
acts = [a.text() for a in mt.more_btn.menu().actions()]
check("⋯ = 6 إجراءات",
      acts == ["تعليم الكل: شركتنا", "تعليم الكل: شركة أخرى",
               "📤 تصدير", "🗑 مسح بيانات البوابات",
               "↩ إرجاع المحدد للتوزيع", "⚙️ ملفات البوابات"], acts)
import ui.clearing_page as _clmod  # noqa: E402
_prof_calls: dict = {}


class _FakeProf:
    def __init__(self, parent):
        _prof_calls["opened"] = True

    def exec(self):
        _prof_calls["exec"] = True
        return 0


_orig_prof = _clmod.GatewayProfilesDialog
_clmod.GatewayProfilesDialog = _FakeProf
try:
    next(a for a in mt.more_btn.menu().actions()
         if a.text() == "⚙️ ملفات البوابات").trigger()
    app.processEvents()
finally:
    _clmod.GatewayProfilesDialog = _orig_prof
check("⋯ فتحت ملفات البوابات",
      _prof_calls.get("opened") and _prof_calls.get("exec"),
      _prof_calls)
mg.show_tab("match")
mt.set_filter("dist")
mt.table.item(0, 0).setSelected(True)
app.processEvents()
from ui import style as _style  # noqa: E402

_calls = []
_orig_ok, _orig_info = _style.success, _style.info
_style.success = lambda *a, **k: _calls.append(("ok", a[-1]))
_style.info = lambda *a, **k: _calls.append(("info", a[-1]))
try:
    mt._unselect()
    app.processEvents()
finally:
    _style.success, _style.info = _orig_ok, _orig_info
check("الإرجاع أعاد F2 للتوزيع وبقيت F3 (شركة أخرى) ظاهرة",
      # V4.5.12.1: أُرجعت شركتنا فقط، وصف شركة أخرى بقي في الموزَّع
      mt.table.rowCount() == 1
      and mt.table.item(0, 5).text() == "F3"
      and mt.table.item(0, 7).text() == "🔒 موزَّعة — شركة أخرى"
      and (D, "92220002", 60.0, "F2") not in st.distributed_lookup(G)
      and any(c[0] == "ok" for c in _calls),
      (mt.table.rowCount(), _calls))

print("=== 5. حراس العرض فقط + انحدار ===")
_style.success, _style.info = _orig_ok, _orig_info
_calls2 = []
_orig_info2 = _style.info
_style.info = lambda *a, **k: _calls2.append(a[-1])
try:
    mt._distribute()
    mt._on_cell(0, 6)
    mt._bulk("mine")
finally:
    _style.info = _orig_info2
check("الحراس الثلاثة رفضوا",
      len(_calls2) == 3
      and all("الموزَّع" in m for m in _calls2), _calls2)
mg.show_tab("other", "due")
app.processEvents()
check("انحدار: المستحق تبويب داخل الأخرى",
      mg.stack.currentIndex() == 1
      and mg.other_tab.mode.currentData() == "due")
# V4.34: صفحة شركتنا دُمجت نطاقًا في التقرير (test_v434).

print("")
print("V4.30 phase3: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
