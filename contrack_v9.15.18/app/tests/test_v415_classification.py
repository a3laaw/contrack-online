# -*- coding: utf-8 -*-
"""V4.15: شاشة التصنيف — تلقائي مبدئي + يدوي مقفل + مستحق عند التصنيف.

يغطي: auto_classify · القفل اليدوي عبر الكشوف · قفل المسدد ·
المستحق (بلا بنك، بعد الرسوم، بلا معلّق) · التقرير الخارجي قراءة فقط ·
توافق diff القديم · شاشة التصنيف (تبديل/جماعي/فلتر).
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

from database.database import get_connection  # noqa: E402
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


def _row(phone, amount, ref, status, cust=""):
    return {"date": D, "phone": phone, "amount": amount, "ref": ref,
            "status": status, "customer": cust, "receipt_no": "",
            "note": "هاتف+مبلغ"}


print("=== 1. التصنيف التلقائي المبدئي ===")
m = gw.auto_classify([
    _row("1", 10.0, "A", "mine"), _row("2", 10.0, "B", "diff"),
    _row("3", 10.0, "C", "other")])
check("المطابق ← شركتنا", m[0]["status"] == gw.STATUS_MINE)
check("الفرق ← غير مصنّف", m[1]["status"] == gw.STATUS_UNMARKED)
check("الأخرى ← غير مصنّف (لا تصنيف تلقائي)",
      m[2]["status"] == gw.STATUS_UNMARKED)
check("الملاحظة تلميح باقٍ", m[1]["note"] == "هاتف+مبلغ")
s = gw.summary(m)
check("الملخص: 1/0/2",
      s["mine"]["count"] == 1 and s["other"]["count"] == 0
      and s["unmarked"]["count"] == 2, str(s))

print("=== 2. حرية التصنيف ثم القفل بالتوزيع ===")
K1 = (D, "90000001", 100.0, "R1")
K2 = (D, "90000002", 50.0, "R2")
first = [_row("90000001", 100.0, "R1", gw.STATUS_UNMARKED, "أ"),
         _row("90000002", 50.0, "R2", gw.STATUS_UNMARKED, "ب")]
check("تثبيت 2", st.save_gateway_ops(G, first, "f1.csv") == 2)
st.set_row_class(G, K1, gw.STATUS_OTHER)
check("تصنيف يدوي ناجح", True)
again = [_row("90000001", 100.0, "R1", gw.STATUS_UNMARKED, "أ"),
         _row("90000002", 50.0, "R2", gw.STATUS_MINE, "ب")]
check("إعادة الرفع: صفر جديدة",
      st.save_gateway_ops(G, again, "f2.csv") == 0)
look = st.seen_lookup(G)
check("المرحلة حرة (الرفع يكتب فوق اليدوي)",
      look[K1] == gw.STATUS_UNMARKED, str(look))
check("التلقائي يتحدث (شركتنا)",
      look[K2] == gw.STATUS_MINE)
st.set_row_class(G, K1, gw.STATUS_OTHER)
_dd = st.distribute_rows(G, [K1])
check("توزيع R1", _dd == {"mine": 0, "other": 1, "skipped": 0},
      str(_dd))
st.save_gateway_ops(
    G, [_row("90000001", 100.0, "R1", gw.STATUS_UNMARKED, "أ")],
    "f3.csv")
look3 = st.seen_lookup(G)
check("الموزَّع مقفل ضد الرفع الجديد",
      look3[K1] == gw.STATUS_OTHER, str(look3))
man = st.restore_manual(
    [_row("90000001", 100.0, "R1", gw.STATUS_UNMARKED)], G)
check("الاسترجاع يعيد الموزَّع", man == 1)

print("=== 3. قفل المسدد ===")
ids = st.op_ids_for(G, [(D, "90000001", 100.0, "R1")])
tid = st.add_other_transfer("2026-09-21", 99.85, op_ids=ids)


def _reclass():
    st.set_row_class(G, (D, "90000001", 100.0, "R1"), gw.STATUS_MINE)


try:
    _reclass()
    check("إعادة تصنيف المسدد مرفوضة", False)
except ValueError as exc:
    check("إعادة تصنيف المسدد مرفوضة", "مسددة" in str(exc), str(exc))
check("تسديد برقم", tid > 0)

print("=== 4. المستحق عند التوزيع ===")
check("المستحق = 100 − 0.150",
      abs(st.other_dues_total() - 99.85) < 0.001,
      st.other_dues_total())
stmt = st.other_statement("2026-09-01", "2026-09-30")
check("الكشف يوم واحد تراكمي",
      len(stmt) == 1 and stmt[0]["cumulative"] == 99.85, str(stmt))
bal = st.other_balance()
check("المتبقي = 0 (التسديد على الصافي V4.49)",
      abs(bal["remaining"]) < 0.001, str(bal))

print("=== 5. التقرير الخارجي قراءة فقط ===")


def _counts():
    with get_connection() as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("gateway_ops", "other_company_transfers",
                          "vouchers", "bank_lines")}


st.ensure_bank_table()
st.ensure_transfer_table()
before = _counts()
rep = st.other_external_report("2026-09-01", "2026-09-30")
check("الجداول لم تتغير", _counts() == before, str(_counts()))
check("صف واحد سُدّد", len(rep["rows"]) == 1 and rep["rows"][0]["paid"]
      and rep["rows"][0]["customer"] == "أ", str(rep["rows"]))
check("الصافي 99.85", rep["net"] == 99.85, str(rep))
check("بلا تفاصيل داخلية",
      all(set(o) == {"date", "customer", "amount", "paid", "gw",
                     "gw_date"}
          for o in rep["rows"]))

print("=== 6. توافق diff القديم ===")
st.distribute_rows(G, [K2])
st.save_gateway_ops(G, [_row("90000009", 5.0, "OLD", "diff", "قديم")],
                    "old.csv")
look2 = st.seen_lookup(G)
check("يُقرأ غير مصنّف",
      look2[(D, "90000009", 5.0, "OLD")] == gw.STATUS_UNMARKED)
rows = st.daily_clearing("2026-09-01", "2026-09-30", G)
mine_n = sum(r["g_mine"] for r in rows)
check("خارج التصفية (شركتنا = 50 فقط)", mine_n == 50.0, mine_n)
check("خارج المستحق", abs(st.other_dues_total() - 99.85) < 0.001)

print("=== 7. شاشة التصنيف ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G))
csv_path = os.path.join(_tmpdir, "cls.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "90000001,100.0,2026-09-20,R1,أ\n"
             "90000007,70.0,2026-09-20,R7,جديد\n")
check("استيراد صفين", pg.import_file(csv_path) == 2)
app.processEvents()
check("الموزَّع مخفي (الظاهر 1)", pg.table.rowCount() == 1,
      pg.table.rowCount())
check("العدّاد يذكر المسددة المخفاة",
      "1 مسددة مسبقًا (مخفاة)" in pg.file_lbl.text(),
      pg.file_lbl.text())
check("الظاهر هو الجديد مقترحًا للأخرى",
      pg.table.item(0, 6).text() == "🏢 شركة أخرى"
      and "✨ مقترح: بلا سابقة" in pg.table.item(0, 10).text(),
      pg.table.item(0, 6).text() + pg.table.item(0, 10).text())
from ui import style as _style  # noqa: E402
pg.set_filter("dist")
app.processEvents()
check("المسدد خارج الموزَّع",  # V4.30
      all("R1" not in (pg.table.item(i, 5).text() or "")
          for i in range(pg.table.rowCount())))
pg.set_filter("all")
pg._on_cell(0, 6)  # أخرى ← بدون (ومسح الشارة)
check("التبديل: غير مصنّف",
      pg.table.item(0, 6).text() == "⚪ غير مصنّف"
      and "✨" not in pg.table.item(0, 10).text(),
      pg.table.item(0, 6).text())
pg._on_cell(0, 6)  # بدون ← شركتنا
check("التبديل: شركتنا", pg.table.item(0, 6).text() == "✅ شركتنا",
      pg.table.item(0, 6).text())
pg._on_cell(0, 6)  # شركتنا ← أخرى
check("التبديل: شركة أخرى",
      pg.table.item(0, 6).text() == "🏢 شركة أخرى",
      pg.table.item(0, 6).text())
check("التصنيف وحده بلا أثر",
      abs(st.other_dues_total() - 99.85) < 0.001,
      st.other_dues_total())
pg.table.item(0, 0).setSelected(True)
_orig_ok = _style.success
_style.success = lambda *a, **k: None
try:
    pg._distribute()
finally:
    _style.success = _orig_ok
check("الموزَّع اختفى", pg.table.rowCount() == 0, pg.table.rowCount())
check("المستحق نشأ بالتوزيع (+69.85)",
      abs(st.other_dues_total() - (99.85 + 69.85)) < 0.001,
      st.other_dues_total())
check("الجماعي في قائمة ⋯",  # V4.40: ملفات البوابات بدل مطابقة البنك
      [a.text() for a in pg.more_btn.menu().actions()]
      == ["تعليم الكل: شركتنا", "تعليم الكل: شركة أخرى",
          "📤 تصدير", "🗑 مسح بيانات البوابات",
          "↩ إرجاع المحدد للتوزيع", "⚙️ ملفات البوابات"])

print("")
print("V4.15 classification: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
