# -*- coding: utf-8 -*-
"""النسخ الاحتياطي التلقائي كل مدة محددة.

- يعمل في الخلفية أثناء تشغيل البرنامج (QTimer يفحص كل 10 دقائق).
- عند انقضاء المدة المحددة (بالساعات) يُنشئ نسخة تلقائيًا.
- يحتفظ بآخر 30 نسخة تلقائية ويحذف الأقدم.
- كما يُنشئ نسخة عند بدء التشغيل إذا كانت المدة قد انقضت والبرنامج مغلق.
"""
import os
import sqlite3
from datetime import datetime

from database.database import get_connection, backup_db, DATA_DIR, DatabaseError

AUTO_BACKUP_DIR_NAME = "backups"
MAX_AUTO_BACKUPS = 30
_DATE_FMT = "%Y-%m-%d %H:%M:%S"


def get_backup_dir(custom_folder: str = "") -> str:
    """مجلد النسخ التلقائية: المخصص من الإعدادات أو data/backups افتراضيًا."""
    folder = (custom_folder or "").strip()
    if folder:
        try:
            os.makedirs(folder, exist_ok=True)
            # اختبار الكتابة
            probe = os.path.join(folder, ".write_test")
            with open(probe, "w") as f:
                f.write("x")
            os.remove(probe)
            return folder
        except OSError:
            pass  # نرجع للافتراضي
    default = os.path.join(DATA_DIR, AUTO_BACKUP_DIR_NAME)
    os.makedirs(default, exist_ok=True)
    return default


def _read_backup_config() -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT auto_backup_enabled, auto_backup_interval, "
            "auto_backup_folder, last_backup_at FROM settings WHERE id=1"
        ).fetchone()
    if not row:
        return {"enabled": True, "interval": 24, "folder": "", "last": ""}
    return {
        "enabled": bool(row["auto_backup_enabled"]),
        "interval": max(1, min(168, int(row["auto_backup_interval"] or 24))),
        "folder": row["auto_backup_folder"] or "",
        "last": row["last_backup_at"] or "",
    }


def _mark_backup_done() -> None:
    with get_connection() as conn:
        conn.execute("UPDATE settings SET last_backup_at=? WHERE id=1",
                     (datetime.now().strftime(_DATE_FMT),))


def _prune_old_backups(folder: str) -> None:
    """الاحتفاظ بآخر MAX_AUTO_BACKUPS نسخة تلقائية فقط."""
    try:
        files = sorted(
            (f for f in os.listdir(folder)
             if f.startswith("auto_backup_") and f.endswith(".sqlite")),
        )
        for old in files[:-MAX_AUTO_BACKUPS]:
            try:
                os.remove(os.path.join(folder, old))
            except OSError:
                pass
    except OSError:
        pass


def is_backup_due() -> bool:
    """هل حان وقت النسخة التلقائية؟"""
    cfg = _read_backup_config()
    if not cfg["enabled"]:
        return False
    if not cfg["last"]:
        return True
    try:
        last = datetime.strptime(cfg["last"], _DATE_FMT)
    except ValueError:
        return True
    elapsed_hours = (datetime.now() - last).total_seconds() / 3600.0
    return elapsed_hours >= cfg["interval"]


def run_auto_backup(force: bool = False) -> str | None:
    """ينفّذ نسخة تلقائية إذا حان وقتها. يرجع مسار الملف أو None."""
    cfg = _read_backup_config()
    if not force and not is_backup_due():
        return None
    if not cfg["enabled"] and not force:
        return None
    folder = get_backup_dir(cfg["folder"])
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dest = os.path.join(folder, f"auto_backup_{stamp}.sqlite")
    try:
        backup_db(dest)
        _mark_backup_done()
        _prune_old_backups(folder)
        return dest
    except DatabaseError:
        return None  # لا نزعج المستخدم بفشل نسخة تلقائية؛ سيُعاد المحاولة لاحقًا


def last_backup_info() -> str:
    """نص وصفي عن آخر نسخة تلقائية (للعرض في الإعدادات)."""
    cfg = _read_backup_config()
    return cfg["last"] or "لم تُنشأ نسخة تلقائية بعد"
