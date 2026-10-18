# -*- coding: utf-8 -*-
"""V4.42: بلا ⋯ — تصدير/طباعة/افتتاحي خارجية + تاريخ التسديد.

§1 الأزرار · §2 توجيه الطباعة · §3 بيانات الأوراق.
"""
import os
import sys
import tempfile
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v442_")
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


G = "KNET"
st.save_profile(None, G, "بنك K", "KNET", 1, 0.150)
st.ensure_ops_table()
with database.get_connection() as conn:
    conn.executemany(
        "INSERT INTO gateway_ops (gateway, op_date, phone, amount, ref,"
        " status, customer, batch, gw_paid, distributed,"
        " classified_manual, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [(G, "2026-09-10", "92220001", 500.0, "P1", "other", "كامل",
          "B1.xlsx", 1, 1, 1, "2026-09-11 10:00:00"),
         (G, "2026-09-12", "92220002", 100.0, "P2", "other", "جديد",
          "B1.xlsx", 1, 1, 1, "2026-09-13 10:00:00")])
    _ids = {r["ref"]: r["id"] for r in conn.execute(
        "SELECT id, ref FROM gateway_ops").fetchall()}
t1 = st.add_other_transfer("2026-09-15", 499.85, "TR1", "", "تحويل بنكي",
                           [_ids["P1"]])

print("=== 1. الأزرار ===")
from PySide6.QtWidgets import QApplication, QFileDialog  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402

app = QApplication.instance() or QApplication([])
oc = OtherCompanyPage()
check("بلا زر ⋯", not hasattr(oc, "more_btn"))
check("النصوص",
      oc.export_btn.text() == "📤 تصدير"
      and oc.print_btn.text() == "🖨 طباعة"
      and oc.opening_btn.text() == "⚙️ الرصيد الافتتاحي")
_all_vis = True
for _m in ["due", "paid", "ops", "ledger", "daily"]:
    oc.mode.setCurrentData(_m)
    app.processEvents()
    _all_vis = _all_vis and not oc.export_btn.isHidden() \
        and not oc.print_btn.isHidden() \
        and not oc.opening_btn.isHidden()
check("ظاهرة في كل التبويبات", _all_vis)
check("الكشف والتسوية في التبويبات (بلا مكرر)",
      [b.text() for b in oc.mode._buttons]
      == ["📌 المستحق", "✅ المسدد", "📊 التقرير", "الكشف المالي",
          "📅 التسوية اليومية"])
check("تصدير المضمّن مخفي (بلا مكرر)",
      oc.dues_embed.export_btn.isHidden())

print("=== 2. توجيه الطباعة ===")
oc.d1.setDate(oc.d1.date().fromString("2026-09-01", "yyyy-MM-dd"))
oc.d2.setDate(oc.d2.date().fromString("2026-09-30", "yyyy-MM-dd"))
oc.refresh()
app.processEvents()
_calls: list = []
_pdf = os.path.join(_tmpdir, "p.pdf")
with mock.patch.object(QFileDialog, "getSaveFileName",
                       return_value=(_pdf, "PDF (*.pdf)")), \
        mock.patch("reports.tabular_pdf.generate_table_pdf",
                   side_effect=lambda *a, **k: _calls.append((a, k))), \
        mock.patch("ui.style.info"), \
        mock.patch("ui.invoices.open_file_externally"):
    for _m, _title in (
            ("due", "المستحق للدفع — الشركة الأخرى"),
            ("paid", "المسدد — الشركة الأخرى"),
            ("ops", "تقرير عمليات الشركة الأخرى"),
            ("ledger", "كشف حساب الشركة الأخرى"),
            ("daily", "التسوية اليومية — الشركة الأخرى")):
        oc.mode.setCurrentData(_m)
        app.processEvents()
        oc._print_current()
check("5 طباعات بالعناوين",
      [c[0][0] for c in _calls]
      == ["المستحق للدفع — الشركة الأخرى", "المسدد — الشركة الأخرى",
          "تقرير عمليات الشركة الأخرى", "كشف حساب الشركة الأخرى",
          "التسوية اليومية — الشركة الأخرى"],
      [c[0][0] for c in _calls])
_heads = [c[0][1] for c in _calls]
check("رؤوس المستحق بلا ✓",  # V4.50: + إجمالي الملف أخيرًا
      _heads[0][0] == "التاريخ" and _heads[0][-2] == "التحصيل"
      and _heads[0][-1] == "إجمالي الملف"
      and len(_heads[0]) == 9, _heads[0])
check("رؤوس المسدد الواضحة",
      _heads[1][-2:] == ["التسديد", "تاريخ التسديد"], _heads[1])
check("صفوف حقيقية",
      len(_calls[0][0][3]) == 1 and len(_calls[1][0][3]) == 1
      and _calls[1][0][3][0][6] == f"ت{t1}"
      and _calls[1][0][3][0][7] == "2026-09-15")

print("=== 3. بيانات الأوراق ===")
_sh = oc._ledger_sheet_data()
check("الكشف",
      _sh["name"] == "كشف حساب الشركة الأخرى"
      and _sh["heads"][1] == "التاريخ"
      and _sh["rows"][0][1] == "رصيد أول الفترة"
      and _sh["rows"][-1][1] == "الإجمالي")
_ds = oc._dues_sheet_data()
check("التحصيل محسوب في الورقة",
      _ds["rows"][0][-2] == "✅ 2026-09-13"
      and _ds["rows"][0][-1] == 100.0, _ds["rows"][0][-2:])

print("")
print(f"V4.42 buttons: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
