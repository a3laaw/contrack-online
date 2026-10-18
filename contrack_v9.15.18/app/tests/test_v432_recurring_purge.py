# -*- coding: utf-8 -*-
"""V4.32: ترحيل حذف المصروف الدوري — شامل لمرة واحدة وآمن التكرار.

يغطي: بلا جدول = بلا عمل · حذف التعريفات + المولّدة آليًا ببصمتها ·
بقاء اليدوي والطبيعي · إسقاط الجدول · مسح القيود · التكرار الثاني ساكن.
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

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + (" | " + str(detail) if detail else ""))


def _tables():
    with database.get_connection() as conn:
        return {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}


print("=== 1. بلا جدول قديم ===")
r0 = lc.purge_recurring_feature()
check("آمن: بلا عمل",
      r0 == {"defs": 0, "vouchers": 0, "done": False}
      and lc.recurring_purge_pending() is False, r0)

print("=== 2. قاعدة قديمة ثم ترحيل ===")
with database.get_connection() as conn:
    conn.execute("""
        CREATE TABLE recurring_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
            amount REAL NOT NULL, party TEXT DEFAULT '',
            method TEXT DEFAULT 'تحويل بنكي', description TEXT DEFAULT '',
            start_date TEXT NOT NULL, next_due_date TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now', 'localtime')))""")
    conn.execute(
        "INSERT INTO recurring_expenses (title, amount, start_date, "
        "next_due_date, is_active) VALUES (?,?,?,?,?)",
        ("إيجار", 500.0, "2026-01-01", "2026-09-01", 1))
    conn.execute(
        "INSERT INTO recurring_expenses (title, amount, start_date, "
        "next_due_date, is_active) VALUES (?,?,?,?,?)",
        ("راتب", 300.0, "2026-01-01", "2026-10-01", 0))
auto = lc.add_voucher("payment", "2026-09-01", "المؤجر", "تحويل بنكي",
                      "المصروفات الإدارية", 500.0,
                      "إيجار - مصروف دوري (عام)", party_type="",
                      party_id=None)
manual = lc.add_voucher("payment", "2026-09-02", "مصروف دوري", "نقدًا",
                        "المصروفات الإدارية", 50.0, "يدوي",
                        party_type="", party_id=None)
normal = lc.add_voucher("payment", "2026-09-03", "مورد", "نقدًا",
                        "المصروفات الإدارية", 70.0, "عادي",
                        party_type="", party_id=None)
with database.get_connection() as conn:
    n_jr = conn.execute(
        "SELECT COUNT(*) FROM journal_entries WHERE source_id=?",
        (auto,)).fetchone()[0]
check("تجهيز: قيد للمولّد", n_jr == 1, n_jr)
check("الفحص المسبق يرى البقايا",
      lc.recurring_purge_pending() is True)
r1 = lc.purge_recurring_feature()
check("الترحيل حذف تعريفين وسندًا",
      r1 == {"defs": 2, "vouchers": 1, "done": True}, r1)
check("الجدول سقط", "recurring_expenses" not in _tables())
with database.get_connection() as conn:
    left = {r[0] for r in conn.execute("SELECT id FROM vouchers")}
    jr_left = conn.execute(
        "SELECT COUNT(*) FROM journal_entries WHERE source_id=?",
        (auto,)).fetchone()[0]
check("المولّد وقيدها ذهبا والباقي بقي",
      auto not in left and left == {manual, normal} and jr_left == 0,
      (left, jr_left))
r2 = lc.purge_recurring_feature()
check("التكرار الثاني ساكن",
      r2 == {"defs": 0, "vouchers": 0, "done": False}, r2)

print("")
print("V4.32 recurring-purge: " + str(PASS) + " passed, " +
      str(FAIL) + " failed")
sys.exit(1 if FAIL else 0)
