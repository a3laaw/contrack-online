# -*- coding: utf-8 -*-
"""V4.5.12.1: إرجاع الموزَّع على «شركة أخرى» من كارت 🔒 الموزَّع.

المشكلة: بعد التوزيع يظهر في كارت «الموزَّع» صفوف شركتنا فقط، فصف «شركة
أخرى» لا يُحدَّد ولا يُرجَع. الإصلاح: الكارت يجمع الفريقين، والزر يرجع
الاثنين، والمسدَّد يُرفض برسالة تشرح الحل.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db  # noqa: E402
t = tempfile.mkdtemp(prefix="v45121_gw_")
db.DATA_DIR = t
db.DB_PATH = os.path.join(t, "t.sqlite")
from database import database  # noqa: E402
database.init_db()
from database.database import get_connection  # noqa: E402
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


GW = "بوابة الاختبار"
st.ensure_ops_table()
OPS = [("2026-10-01", "9001", 100.0, "M-1", "mine"),
       ("2026-10-01", "9002", 200.0, "O-1", "other"),
       ("2026-10-02", "9003", 300.0, "O-2", "other")]
with get_connection() as c:
    c.execute("DELETE FROM gateway_ops")
    for dt, ph, am, rf, stt in OPS:
        c.execute("INSERT INTO gateway_ops (gateway, op_date, phone, amount, "
                  "ref, status) VALUES (?,?,?,?,?,?)", (GW, dt, ph, am, rf, stt))

print("=== 1. الخدمة: صفوف «شركة أخرى» الموزَّعة ===")
res = st.distribute_rows(GW, [(dt, ph, am, rf) for dt, ph, am, rf, _ in OPS])
check("التوزيع شمل الفريقين", res == {"mine": 1, "other": 2, "skipped": 0}, res)
other = st.distributed_other_rows(GW)
check("دالة جديدة ترجع صفَّي شركة أخرى", len(other) == 2, len(other))
check("الصفوف كلها موسومة side=other وغير مسدَّدة",
      all(r["side"] == "other" and r["paid"] is False for r in other), other)
check("الحقول كاملة (تاريخ/هاتف/مبلغ/مرجع)",
      all(r["date"] and r["phone"] and r["amount"] and r["ref"] for r in other),
      other[0])
mine = st.distributed_mine_rows()
check("صفوف شركتنا تبقى كما هي (صف واحد)", len(mine) == 1, len(mine))

print("=== 2. الواجهة: الكارت يعرض الفريقين والزر يرجع الآخر ===")
from PySide6.QtCore import Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402
from PySide6.QtTest import QTest  # noqa: E402
app = QApplication.instance() or QApplication([])
import ui.gateway_page as gp  # noqa: E402
from ui import style  # noqa: E402
msgs = []
style.info = lambda *a, **k: msgs.append(("info", a[1] if len(a) > 1 else ""))
style.success = lambda *a, **k: msgs.append(("ok", a[1] if len(a) > 1 else ""))
style.error = lambda *a, **k: msgs.append(("err", a[1] if len(a) > 1 else ""))
gp.style.info = style.info
gp.style.success = style.success
gp.style.error = style.error

page = gp.GatewayPage(None)
page.gw_combo.addItem(GW, GW)
page.gw_combo.setCurrentIndex(page.gw_combo.count() - 1)
page.set_filter("dist")
page.show()                      # الجدول الظاهر فقط يقبل التحديد بالنقر
QTest.qWait(150)
app.processEvents()
app.processEvents()


def _click_row(row: int):
    """نقرة فأرة حقيقية على صف الجدول (كما يفعل المستخدم)."""
    rect = page.table.visualRect(page.table.model().index(row, 0))
    QTest.mouseClick(page.table.viewport(), Qt.LeftButton, Qt.NoModifier,
                     rect.center())
    app.processEvents()
    app.processEvents()
check("كاش الموزَّع يجمع الفريقين (3 صفوف)",
      len(page._dist_cache) == 3, len(page._dist_cache))
check("قسم شركتنا صف واحد وقسم الأخرى صفان",
      len(page._dist_mine) == 1 and len(page._dist_other) == 2,
      (len(page._dist_mine), len(page._dist_other)))
check("العدّاد يعرض 3 عمليات", "3 عمليات" in page._cards["dist"].text(),
      page._cards["dist"].text())
check("التلميح يوضح التقسيم",
      "شركة أخرى" in page._cards["dist"].toolTip(),
      page._cards["dist"].toolTip())
# الصفوف المعروضة: صف شركتنا ثم صفا الأخرى بشارة مميزة
badges = [page.table.item(r, 7).text() for r in range(page.table.rowCount())]
check("شارة «شركة أخرى» ظاهرة في جدول الموزَّع",
      gp.DIST_BADGE_OTHER in badges, badges)
check("تصنيف صف الأخرى «🏢 شركة أخرى»",
      any(page.table.item(r, 6).text().endswith("شركة أخرى")
          for r in range(page.table.rowCount())),
      [page.table.item(r, 6).text() for r in range(page.table.rowCount())])

# تحديد صف «شركة أخرى» من الجدول ثم الإرجاع
row_other = badges.index(gp.DIST_BADGE_OTHER)
_click_row(row_other)
check("تحديد صف الأخرى تم بالنقر",
      len(page.table.selectedIndexes()) > 0,
      len(page.table.selectedIndexes()))
check("زر «↩ إرجاع للتوزيع» يظهر عند تحديد صف الأخرى",
      not page.back_btn.isHidden())
msgs.clear()
page._unselect()
app.processEvents()
check("رسالة الإرجاع نجحت", msgs and msgs[-1][0] == "ok" and "أُرجع 1" in
      msgs[-1][1], msgs[-1] if msgs else None)
check("صف واحد فقط بقي موزَّعًا على الأخرى",
      len(st.distributed_other_rows(GW)) == 1,
      st.distributed_other_rows(GW))
with get_connection() as c:
    r = c.execute("SELECT distributed, classified_manual, status "
                  "FROM gateway_ops WHERE phone='9002'").fetchone()
check("حالة الصف أُرجعت للمرحلة المؤقتة والتصنيف محفوظ",
      int(r["distributed"]) == 0 and int(r["classified_manual"]) == 0
      and r["status"] == "other", dict(r))

print("=== 3. المسدَّد: خارج الموزَّع + الخدمة ترفض إرجاعه ===")
st.ensure_alloc_table()
_tid = st.add_other_transfer("2026-10-05", 300.0, ref="", notes="اختبار")
with get_connection() as c:
    c.execute("UPDATE gateway_ops SET paid_transfer_id=? WHERE phone='9003'",
              (_tid,))
other2 = st.distributed_other_rows(GW)
check("المسدَّد خارج كارت الموزَّع (قاعدة مستقرة)",
      all(r["phone"] != "9003" for r in other2),
      [r["phone"] for r in other2])
row_paid = [r for r in st.distributed_other_rows(GW, include_paid=True)
            if r["phone"] == "9003"][0]
check("مع include_paid يظهر معلَّمًا paid=True", row_paid["paid"] is True,
      row_paid)
page._refresh_dist_cache()
page._render()
app.processEvents()
refs = [page.table.item(r, 5).text() for r in range(page.table.rowCount())]
check("الجدول لا يعرض الصف المسدَّد", "O-2" not in refs, refs)
check("الخدمة ترفض إرجاع المسدَّد (paid_skipped)",
      st.undistribute_rows(GW, [("2026-10-02", "9003", 300.0, "O-2")])
      == {"ok": 0, "paid_skipped": 1})
check("الصف المسدَّد بقي موزَّعًا",
      len([r for r in st.distributed_other_rows(GW, include_paid=True)
           if r["phone"] == "9003"]) == 1)

print("")
print(f"V4.5.12.1 gateway undo-other: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
