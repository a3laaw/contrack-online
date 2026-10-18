# -*- coding: utf-8 -*-
"""V4.28 (مرحلة 1): تبسيط بوابة الدفع — بلا فقد وظائف.

يغطي: زر التسوية الوحيد · ⋯ التصنيف (4) · الكروت فلاتر ·
الموزعة بجانب البحث · التسميات الموحدة · ⋯ الأخرى · سقف 3 أزرار.
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
D = "2026-09-20"
st.save_profile(None, G, "بنك H", "KNET", 1, 0.150)

from PySide6.QtWidgets import QApplication, QPushButton  # noqa: E402
from ui.clearing_page import ClearingPage  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])

print("=== 1. زر التسوية الوحيد ===")
mg = PaymentGatewayPage()
check("الحاوية: زر + تبويبان مسميان",  # V4.40: بلا مطابقة
      mg.wizard_btn.text() == "＋ تسوية جديدة"
      and mg.tabs.count() == 2
      and [b.text() for b in mg.tabs._buttons]
      == ["التصنيف والتوزيع", "الشركة الأخرى"],
      mg.tabs.count())
check("المدمج بلا استيراد",
      mg.match_tab.import_btn.isHidden())
pg = GatewayPage()
check("المنفرد فيه التسوية",
      not pg.import_btn.isHidden()
      and pg.import_btn.text() == "＋ تسوية جديدة",
      pg.import_btn.text())

print("=== 2. شريط التصنيف ===")
acts = [a.text() for a in pg.more_btn.menu().actions()]
check("⋯ = 6 إجراءات",  # V4.40: ملفات البوابات بدل المطابقة
      acts == ["تعليم الكل: شركتنا", "تعليم الكل: شركة أخرى",
               "📤 تصدير", "🗑 مسح بيانات البوابات",
               "↩ إرجاع المحدد للتوزيع", "⚙️ ملفات البوابات"], acts)
tops = [b for b in (pg.import_btn, pg.dist_btn, pg.more_btn)]
check("الشريط ≤ 3 (بلا جماعي/مسح/تبويبات)",
      len(tops) <= 3 and not hasattr(pg, "ours_btn")
      and not hasattr(pg, "other_btn") and not hasattr(pg, "wipe_btn")
      and not hasattr(pg, "tabs"))
check("الإرجاع السياقي بجانب البحث + كارت الموزَّع",  # V4.30
      pg.back_btn.parentWidget() is pg.search.parentWidget()
      and pg.back_btn.isHidden()
      and "dist" in pg._cards)
check("لا وظيفة مفقودة",
      all(hasattr(pg, m) for m in
          ("_pick_file", "_bulk", "_export", "_wipe_all", "_distribute")))

print("=== 3. الكروت فلاتر ===")
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "c.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "94440001,100.0,2026-09-20,A1,أ\n"
             "94440002,200.0,2026-09-20,A2,ب\n")
pg.import_file(csv_path)
app.processEvents()
pg.set_filter("all")
app.processEvents()
check("فلتر الكل", pg.table.rowCount() == 2, pg.table.rowCount())
pg.set_filter("mine")
app.processEvents()
check("فلتر شركتنا + حد ملوّن",
      pg._filter == "mine"
      and "16A34A" in pg._card_frames["mine"].styleSheet()
      and pg._card_frames["total"].styleSheet() == "")
pg._matched[0]["status"] = "unmarked"
pg.set_filter("unmarked")
app.processEvents()
check("فلتر غير مصنّف",
      pg._filter == "unmarked" and pg.table.rowCount() == 1,
      pg.table.rowCount())

print("=== 4. التسميات الموحدة ===")
check("غير مصنّف",
      gw.STATUS_LABEL[gw.STATUS_UNMARKED] == "⚪ غير مصنّف"
      and "غير مصنّف" in pg.table.item(0, 6).text(),
      pg.table.item(0, 6).text())
check("حالات التصفية",
      st.STATUS_LABEL
      == {"done": "✅ مكتمل", "pending": "⏳ منتظر",
          "diff": "⚠️ فرق", "late": "❌ متأخر"},
      st.STATUS_LABEL)
cl = ClearingPage()
check("عرض البنك + الحالات مسماة",
      [b.text() for b in cl.views._buttons]
      == ["التصفية اليومية", "بنك غير مربوط"]
      and [b.text() for b in cl.status._buttons]
      == ["الكل", "✅ مكتمل", "⏳ منتظر", "⚠️ فرق", "❌ متأخر"])
check("⋯ التصفية",
      [a.text() for a in cl.more_btn.menu().actions()]
      == ["⚙ البوابات", "📤 تصدير"])

print("=== 5. حساب الأخرى ===")
oc = OtherCompanyPage()
vis = [b for b in (oc.pay_btn, oc.export_btn, oc.print_btn,
                   oc.opening_btn)
       if not b.isHidden()]
check("4 أزرار خارجية بلا ⋯",  # V4.42
      len(vis) == 4 and not hasattr(oc, "more_btn")
      and not hasattr(oc, "dues_btn"))
shown_btns = [b.text() for b in mg.match_tab.findChildren(QPushButton)
              if "تسوية" in b.text()]
check("المدمج: زر التسوية موجود (مخفي)", shown_btns == ["＋ تسوية جديدة"],
      shown_btns)

print(f"\nV4.28 phase1: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
