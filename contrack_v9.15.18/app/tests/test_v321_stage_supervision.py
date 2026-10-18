# -*- coding: utf-8 -*-
"""V3.21: الطابع الإشرافي للمراحل — بداية/نهاية/تأخير في ملف الإشراف."""
import os
import sqlite3
import sys
import tempfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database.database as db

_tmpdir = tempfile.mkdtemp()
db.DATA_DIR = _tmpdir
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")
db.init_db()

from database.models import Contract, Customer  # noqa: E402
from services import contract_service as ks  # noqa: E402
from services import customer_service as cs  # noqa: E402
from services import report_service  # noqa: E402
from services import supervision_service as sup  # noqa: E402
from services.customer_service import ValidationError  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {detail}")


c1 = cs.add_customer(Customer(customer_code="C-211", name="عميل البنود",
                              phone="55001122"))
k1 = ks.add_contract(Contract(contract_number="K-211", customer_id=c1,
                              contract_date="2026-01-01",
                              description="عقد بنود", amount=60000.0,
                              contract_type="مقاولة عامة"))
with db.get_connection() as _c:
    _c.execute("INSERT INTO boq_items (contract_id, description, qty, unit,"
               " unit_price) VALUES (?,?,?,?,?)",
               (k1, "خرسانة", 100.0, "م3", 600.0))
    _c.execute("INSERT INTO contract_stages (contract_id, name, level,"
               " sort_order, start_date) VALUES (?,?,?,?,?)",
               (k1, "الهيكل", 1, 1, "2026-01-01"))
    _sid = _c.execute("SELECT id FROM contract_stages WHERE contract_id=?",
                      (k1,)).fetchone()[0]

print("=== 1. الخدمة وحساب التأخير ===")
try:
    sup.set_stage_sup_start(_sid, "2026-01-01")
    check("البداية قبل الضبط مرفوضة", False)
except ValidationError:
    check("البداية قبل الضبط مرفوضة", True)
sup.setup_stage_supervision(_sid, "2026-02-01", 1000.0)
sup.set_stage_sup_start(_sid, "2026-01-01")
st = sup.stage_supervision_status(_sid, date(2026, 4, 15))
check("داخل التمديد", st["in_extension"])
check("التأخير 3 شهور", st["delay_months"] == 3, str(st["delay_months"]))
check("قيمة التأخير", st["delay_value"] == 3000.0, str(st["delay_value"]))
check("النهاية الكاملة = المخططة", st["full_end"] == "2026-02-01")
try:
    sup.set_stage_sup_end(_sid, "2025-12-01")
    check("إنهاء قبل البداية مرفوض", False)
except ValidationError:
    check("إنهاء قبل البداية مرفوض", True)
sup.set_stage_sup_end(_sid, "2026-03-15")
st2 = sup.stage_supervision_status(_sid, date(2026, 4, 15))
check("الساعة توقفت عند الإنهاء",
      st2["calculation_date"] == "2026-03-15" and st2["delay_months"] == 2,
      f"{st2['calculation_date']}/{st2['delay_months']}")
sup.waive_stage_extension_months(_sid, 1.0, "ظروف الموقع")
st3 = sup.stage_supervision_status(_sid, date(2026, 4, 15))
check("التنازل يقلل التأخير",
      st3["delay_months"] == 1 and st3["delay_value"] == 1000.0
      and st3["full_end"] == "2026-03-01",
      f"{st3['delay_months']}/{st3['delay_value']}/{st3['full_end']}")

print("=== 2. ملف تأخيرات الإشراف ===")
rep = report_service.supervision_delays_report()
_stage_rows = [r for r in rep["rows"] if r.get("is_stage")]
check("صف المرحلة مدمج", len(_stage_rows) == 1)
check("الهوية في العنوان",
      "K-211" in _stage_rows[0]["address"]
      and "الهيكل" in _stage_rows[0]["address"],
      _stage_rows[0]["address"] if _stage_rows else "")
check("إجماليات المراحل", rep["totals"]["stage_count"] == 1
      and rep["totals"]["stage_delay_value"] > 0)
from ui import reports_page as rp  # noqa: E402

spec = rp._data_supervision_delays("all")
check("التقرير يعرضها", any("K-211" in str(r) for r in spec["rows"]))
check("الملاحظة تفصلها", "مراحل إشرافية" in (spec.get("note") or ""))

print("=== 3. ترحيل قاعدة قديمة ===")
_old = os.path.join(_tmpdir, "old.sqlite")
_con = sqlite3.connect(_old)
_con.executescript(
    "CREATE TABLE contract_stages (id INTEGER PRIMARY KEY AUTOINCREMENT,"
    " contract_id INTEGER NOT NULL, name TEXT NOT NULL,"
    " level INTEGER NOT NULL DEFAULT 1, parent_name TEXT DEFAULT '',"
    " expected_days INTEGER NOT NULL DEFAULT 0, pay_pct REAL NOT NULL DEFAULT 0,"
    " pay_kind TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,"
    " start_date TEXT DEFAULT '', end_date TEXT DEFAULT '',"
    " is_skipped INTEGER NOT NULL DEFAULT 0, closed_by TEXT DEFAULT '');"
    "INSERT INTO contract_stages (contract_id, name) VALUES (1,'قديمة');")
_con.commit()
_con.close()
db.DB_PATH = _old
db.init_db()
with db.get_connection() as _c2:
    _cols = {r[1] for r in _c2.execute("PRAGMA table_info(contract_stages);")}
    _n = _c2.execute("SELECT COUNT(*) FROM contract_stages").fetchone()[0]
check("الأعمدة السبعة أُضيفت",
      {"is_supervision", "sup_start", "sup_end", "sup_actual_end",
       "sup_monthly", "sup_waived_months", "sup_waive_reason"} <= _cols)
check("بيانات القديمة محفوظة", _n == 1)
db.DB_PATH = os.path.join(_tmpdir, "test.sqlite")

print("=== 4. الحوار (offscreen) ===")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QDate  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication([])
from ui.followup import FollowupPanel, StageSupervisionDialog  # noqa: E402

with db.get_connection() as _c3:
    _c3.execute("INSERT INTO contract_stages (contract_id, name, level,"
                " sort_order, start_date) VALUES (?,?,?,?,?)",
                (k1, "التشطيب", 1, 2, "2026-03-01"))
    _sid2 = _c3.execute("SELECT id FROM contract_stages WHERE name='التشطيب'"
                        ).fetchone()[0]
dlg = StageSupervisionDialog(None, _sid2)
check("الحوار يُبنى", dlg.flag is not None)
dlg.flag.setChecked(True)
dlg.end.setDate(QDate(2026, 5, 1))
dlg.monthly.setValue(2000.0)
dlg._save_flag()
dlg.start_date.setDate(QDate(2026, 3, 1))
dlg._start()
with db.get_connection() as _c4:
    _r = _c4.execute("SELECT is_supervision, sup_start FROM contract_stages"
                     " WHERE id=?", (_sid2,)).fetchone()
check("الحفظ والبدء من الحوار", tuple(_r) == (1, "2026-03-01"), str(tuple(_r)))
check("شارة اللوحة", hasattr(FollowupPanel, "_open_stage_supervision"))

print(f"\nالنتيجة: {PASS} ناجح / {FAIL} فاشل")
sys.exit(1 if FAIL else 0)
