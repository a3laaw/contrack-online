# -*- coding: utf-8 -*-
"""V4.40: الثورة — تبويبات مستحق/مسدد/تقرير + بلا مطابقة + الجاري للمدير.

§1 خدمة تقرير العمليات · §2 التبويبات والفلتر والتفاصيل والتصدير ·
§3 إلغاء المطابقة والتجميع · §4 جاري الشريك للمدير فقط.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import database.database as db

_tmpdir = tempfile.mkdtemp(prefix="v440_")
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
         (G, "2026-09-10", "92220002", 200.0, "P2", "other", "جزئي",
          "B1.xlsx", 1, 1, 1, "2026-09-11 10:00:00"),
         (G, "2026-09-12", "92220003", 100.0, "P3", "other", "جديد",
          "B1.xlsx", 1, 1, 1, "2026-09-13 10:00:00"),
         (G, "2026-09-11", "92220004", 300.0, "PT", "other", "قديم",
          "B1.xlsx", 1, 1, 1, "2026-09-11 10:00:00")])
    _ids = {r["ref"]: r["id"] for r in conn.execute(
        "SELECT id, ref FROM gateway_ops").fetchall()}
t1 = st.add_other_transfer("2026-09-15", 499.85, "TR1", "", "تحويل بنكي",
                           [_ids["P1"]])
t2 = st.add_other_transfer("2026-09-16", 100.0, "TR2", "", "نقدي",
                           [_ids["P2"]])
t3 = st.add_other_transfer("2026-09-20", 1000.0, "TR3", "", "تحويل بنكي",
                           [])
with database.get_connection() as conn:
    conn.execute("UPDATE gateway_ops SET paid_transfer_id=? WHERE id=?",
                 (t3, _ids["PT"]))

print("=== 1. الخدمة ===")
ops = st.other_ops_status("2026-09-01", "2026-09-30")
check("4 عمليات مرتبة",
      [o["ref"] for o in ops] == ["P1", "P2", "PT", "P3"],
      [o["ref"] for o in ops])
_by = {o["ref"]: o for o in ops}
check("الحالات",
      (_by["P1"]["status"], _by["P2"]["status"],
       _by["PT"]["status"], _by["P3"]["status"])
      == ("paid", "partial", "paid", "due"))
check("الجزئية: مدفوع/متبقي/تسديد",
      (_by["P2"]["paid"], _by["P2"]["remaining"],
       _by["P2"]["transfer_id"], _by["P2"]["tdate"])
      == (100.0, 99.85, t2, "2026-09-16"),
      (_by["P2"]["paid"], _by["P2"]["remaining"]))
check("النطاق الزمني",
      [o["ref"] for o in st.other_ops_status("2026-09-12", "2026-09-12")]
      == ["P3"])
_al = st.op_transfer_allocs(_ids["P2"])
check("تسديدات العملية",
      len(_al) == 1 and _al[0]["transfer_id"] == t2
      and _al[0]["alloc"] == 100.0 and _al[0]["method"] == "نقدي")

print("=== 2. التبويبات ===")
from PySide6.QtWidgets import QApplication  # noqa: E402
from ui import other_company_page as ocmod  # noqa: E402
from ui.other_company_page import OtherCompanyPage  # noqa: E402
from ui.payment_gateway_page import PaymentGatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
oc = OtherCompanyPage()
check("التبويبات الخمسة والافتراضي المستحق",
      [b.text() for b in oc.mode._buttons]
      == ["📌 المستحق", "✅ المسدد", "📊 التقرير", "الكشف المالي",
          "📅 التسوية اليومية"]
      and oc.mode.currentData() == "due"
      and not oc.mode.isHidden()
      and not oc.dues_embed.isHidden()
      and oc.dues_embed.view.isHidden())
oc.mode.setCurrentData("paid")
app.processEvents()
check("المسدد مقفل",
      oc.dues_embed.view.currentData() == "paid"
      and oc.pay_btn.isHidden())
oc.d1.setDate(oc.d1.date().fromString("2026-09-01", "yyyy-MM-dd"))
oc.d2.setDate(oc.d2.date().fromString("2026-09-30", "yyyy-MM-dd"))
oc.mode.setCurrentData("ops")
app.processEvents()
check("التقرير: 4 + غير مربوط + إجمالي",
      oc.table.columnCount() == 8
      and oc.table.rowCount() == 6
      and oc.table.item(0, 1).text() == "كامل"
      and oc.table.item(0, 7).text() == "✅ مسدد"
      and oc.table.item(1, 7).text() == "🟡 جزئي"
      and oc.table.item(4, 1).text() == "💸 دفعات على الحساب (غير مربوطة)"
      and oc.table.item(5, 1).text() == "⚖️ الإجمالي"
      and oc.table.item(5, 4).text() == "1,099.400",
      oc.table.rowCount())
oc.kind.setCurrentData("pay")
app.processEvents()
check("فلتر المسدد",
      oc.table.rowCount() == 4
      and oc.table.item(0, 1).text() == "كامل"
      and oc.table.item(1, 1).text() == "قديم")
oc.kind.setCurrentData("due")
app.processEvents()
check("فلتر المستحق (جزئي + جديد)",
      oc.table.rowCount() == 4
      and oc.table.item(0, 1).text() == "جزئي"
      and oc.table.item(1, 1).text() == "جديد")
oc.kind.setCurrentData("all")
oc._on_table_click(1, 0)
app.processEvents()
check("بلا لوحة سفلية (بلا عمود تسديد V4.49)",
      oc.detail_box.isHidden()
      and oc.table.columnCount() == 8
      and oc.table.item(0, 7).text() == "✅ مسدد"
      and oc.table.item(1, 7).text() == "🟡 جزئي")
_wb = oc._ops_workbook_data()
check("المصنف",
      _wb[0]["name"] == "العمليات" and len(_wb[0]["heads"]) == 8
      and _wb[0]["rows"][-1][4] == 1099.4
      and _wb[0]["rows"][-1][1] == "الإجمالي")
_calls: dict = {}


class _FakeExp:
    def __init__(self, *a, **k):
        pass

    def exec(self):
        return 1

    def choice(self):
        return ("ops", "2026-09-01", "2026-09-30")


_orig_exp = ocmod.ExportDialog
ocmod.ExportDialog = _FakeExp
_orig_wb = oc._export_ops_workbook
oc._export_ops_workbook = lambda: _calls.update({"wb": True})
try:
    oc._open_export()
finally:
    ocmod.ExportDialog = _orig_exp
    oc._export_ops_workbook = _orig_wb
check("التصدير يوجَّه للمصنف", _calls.get("wb") is True)

print("=== 3. الإلغاء ===")
pg = PaymentGatewayPage()
check("تبويبان بلا مطابقة",
      [b.text() for b in pg.tabs._buttons]
      == ["التصنيف والتوزيع", "الشركة الأخرى"]
      and not hasattr(pg, "clear_tab"))
check("القائمة بلا مطابقة",
      [a.text() for a in pg.match_tab.more_btn.menu().actions()]
      == ["تعليم الكل: شركتنا", "تعليم الكل: شركة أخرى",
          "📤 تصدير", "🗑 مسح بيانات البوابات",
          "↩ إرجاع المحدد للتوزيع", "⚙️ ملفات البوابات"])
check("بلا دفعات/تصفية/⋯ بالنطاق",  # V4.42: أزرار مباشرة
      not hasattr(oc, "scope")
      and not hasattr(oc, "batch_pay_btn")
      and not hasattr(oc, "mine_back_btn")
      and not hasattr(oc, "back_btn")
      and not hasattr(oc, "jump_btn")
      and not hasattr(oc, "more_btn")
      and oc.export_btn.text() == "📤 تصدير"
      and oc.print_btn.text() == "🖨 طباعة"
      and oc.opening_btn.text() == "⚙️ الرصيد الافتتاحي")

print("=== 4. الجاري ===")
from services import auth_service as _auth  # noqa: E402
from services import lifecycle_service as lc  # noqa: E402
from ui import reports_page as _rp  # noqa: E402
from ui.vouchers import VoucherDialog  # noqa: E402

with database.get_connection() as conn:
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, salt, role)"
            " VALUES ('boss400','x','y','admin'),"
            " ('sec400','x','y','secretary')")
    except Exception:
        pass
_auth.set_current_user("boss400")
vid = lc.add_voucher("payment", "2026-09-20", "الشريك", "نقدي", "نقدي",
                     100.0, "سحب شريك", party_type="partner")
check("المدير يحفظ شريكًا", vid > 0)
_auth.set_current_user("sec400")
dlg = VoucherDialog(None, "receipt")
_idx = dlg.party_kind.findData("partner")
check("الزر مخفي عن السكرتير",
      0 <= _idx < len(dlg.party_kind._buttons)
      and dlg.party_kind._buttons[_idx].isHidden())
try:
    lc.add_voucher("payment", "2026-09-20", "الشريك", "نقدي", "نقدي",
                   50.0, "x", party_type="partner")
    _saved = True
except Exception as exc:
    _saved = False
    _msg = str(exc)
check("الحفظ مرفوض خدميًا", not _saved and "للمدير فقط" in _msg)
try:
    lc.update_voucher(vid, "2026-09-20", "نقدي", 100.0, "تعديل")
    _upd = True
except Exception as exc:
    _upd = False
    _msg2 = str(exc)
check("التعديل مرفوض خدميًا", not _upd and "للمدير فقط" in _msg2)
_rep = _rp._data_cash_flow("detail", "2026-09-01", "2026-09-30")
_txt = " ".join(str(c) for r in _rep["rows"] for c in r)
check("التقرير بلا جاري",
      "جاري الشريك" not in _txt and "حركات الشريك" not in _txt
      and "جاري الشريك" not in _rep["note"])
_auth.set_current_user("boss400")
_rep2 = _rp._data_cash_flow("detail", "2026-09-01", "2026-09-30")
_txt2 = " ".join(str(c) for r in _rep2["rows"] for c in r)
check("المدير يرى الجاري",
      "جاري الشريك" in _txt2 and "حركات الشريك" in _txt2)
dlg.close()

print("")
print(f"V4.40 revolution: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
