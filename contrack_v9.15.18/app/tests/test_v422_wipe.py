# -*- coding: utf-8 -*-
"""V4.22: 🗑 مسح بيانات البوابات في ⋯ — مسح شامل نهائي بتأكيد كتابي + نسخة احتياطية.

يغطي: العدادات · رفض النص الخطأ والإلغاء · المسح الكامل (عمليات +
تسديدات + سندات + قيود) · بقاء الرئيسي (الملفات/البنكية/سند مستقل
وقيده) · تصفير الشاشة.
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

from services import lifecycle_service as lc  # noqa: E402
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


G1, G2, D = "Hesabe", "KNET", "2026-09-20"
st.save_profile(None, G1, "بنك H", "KNET", 1, 0.150)
st.save_profile(None, G2, "بنك K", "KNET", 1, 0.100)
st.save_gateway_ops(G1, [
    {"date": D, "phone": "94440001", "amount": 100.0, "ref": "PA",
     "status": "other"},
    {"date": D, "phone": "94440002", "amount": 50.0, "ref": "UB",
     "status": "other"},
    {"date": D, "phone": "94440003", "amount": 70.0, "ref": "S1",
     "status": "unknown"}], "f.csv")
st.save_gateway_ops(G2, [
    {"date": D, "phone": "95550001", "amount": 30.0, "ref": "G2",
     "status": "unknown"}], "g.csv")
st.distribute_rows(G1, [(D, "94440001", 100.0, "PA"),
                        (D, "94440002", 50.0, "UB")])
_ids = st.op_ids_for(G1, [(D, "94440001", 100.0, "PA")])
# V4.5.13: أُلغيت ميزة سند الصرف من مسار تسديد الأخرى — لا سند يُنشأ
st.add_other_transfer("2026-09-21", 99.85, op_ids=_ids, method="تحويل بنكي")
st.add_other_transfer("2026-09-22", 5.0, notes="يدوي")
_vid = lc.add_voucher("receipt", D, "عميل تجريبي", "نقدًا", "", 500.0,
                      "سند مستقل")
st.save_bank_lines("بنك H", [{"cdate": D, "amount": 100.0,
                              "descr": "تحويل"}], "b1")

from PySide6.QtWidgets import QApplication  # noqa: E402
from ui import gateway_page as _gp  # noqa: E402
from ui import style as _style  # noqa: E402
from ui.gateway_page import GatewayPage  # noqa: E402

app = QApplication.instance() or QApplication([])
pg = GatewayPage()
pg._reload_profiles()
pg.gw_combo.setCurrentIndex(pg.gw_combo.findData(G1))
csv_path = os.path.join(_tmpdir, "p.csv")
with open(csv_path, "w", encoding="utf-8") as fh:
    fh.write("phone,amount,date,ref,customer\n"
             "94440003,70.0,2026-09-20,S1,س\n")
pg.import_file(csv_path)
app.processEvents()

print("=== 1. العدادات والزر ===")
c = st.wipe_counts()
# V4.5.13: لا سند من مسار تسديد الأخرى ⇒ عداد السندات المرتبطة = 0
check("العدادات (4/2/0)",
      c == {"ops": 4, "transfers": 2, "vouchers": 0}, str(c))
check("المسح في ⋯ باسمه الجديد",
      "🗑 مسح بيانات البوابات"
      in [a.text() for a in pg.more_btn.menu().actions()])
check("صف ظاهر قبل المسح",
      pg.table.rowCount() == 1, pg.table.rowCount())

print("=== 2. الرفض والإلغاء ===")
_orig_get = _gp.QInputDialog.getText
_orig_ok = _style.success
_orig_info = _style.info
_style.success = lambda *a, **k: None
_style.info = lambda *a, **k: None
try:
    _gp.QInputDialog.getText = staticmethod(lambda *a, **k: ("لا", True))
    pg._wipe_all()
    check("النص الخطأ لا يمسح",
          st.wipe_counts()["ops"] == 4, st.wipe_counts())
    _gp.QInputDialog.getText = staticmethod(lambda *a, **k: ("", False))
    pg._wipe_all()
    check("الإلغاء لا يمسح",
          st.wipe_counts()["ops"] == 4, st.wipe_counts())

    print("=== 3. المسح الكامل ===")
    _gp.QInputDialog.getText = staticmethod(lambda *a, **k: ("مسح", True))
    pg._wipe_all()
    app.processEvents()
    c2 = st.wipe_counts()
    check("صفر الكل", c2 == {"ops": 0, "transfers": 0, "vouchers": 0},
          str(c2))
    with db.get_connection() as _conn:
        _nv = _conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]
        _nj = _conn.execute(
            "SELECT COUNT(*) FROM journal_entries "
            "WHERE source_type LIKE 'voucher/_%' ESCAPE '/'").fetchone()[0]
        _nb = _conn.execute("SELECT COUNT(*) FROM bank_lines").fetchone()[0]
    # V4.5.13: لا سند تسوية أصلًا ⇒ يبقى السند المستقل وحده وقيده
    check("لا سند تسوية (المستقل بقي)",
          _nv == 1 and _nj == 1, "v=%s j=%s" % (_nv, _nj))
    check("الملفات والبنكية باقية",
len(st.list_profiles()) == 2 and _nb == 1)
    check("الشاشة تصفرت",
          pg.table.rowCount() == 0 and pg._matched == []
          and pg.file_lbl.text() == "لم يتم اختيار ملف")
    import glob
    check("نسخة احتياطية محفوظة",
          len(glob.glob(os.path.join(_tmpdir, "backups",
                                     "wipe_*.sqlite"))) == 1)
finally:
    _gp.QInputDialog.getText = _orig_get
    _style.success = _orig_ok
    _style.info = _orig_info

print("")
print("V4.22 wipe-all: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
