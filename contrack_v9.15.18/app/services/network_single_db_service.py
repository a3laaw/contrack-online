# -*- coding: utf-8 -*-
"""تشغيل ConTrack بقاعدة بيانات واحدة مشتركة على شبكة Windows Server.

هذا ليس Sync بين قواعد منفصلة؛ كل الأجهزة تشير إلى نفس database.sqlite داخل
مجلد مشترك. الخدمة هنا تفحص المسار وتكتب/تقرأ ملف network_folder.txt عبر
طبقة database.database فقط.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import time
from database import database


def configure_shared_database(folder: str) -> dict:
    """تفعيل قاعدة بيانات مشتركة في مجلد شبكة ونقل المحلي إن لزم.

    لو فشلت تهيئة SQLite لا نترك الجهاز عالقًا في وضع الشبكة؛ نرجع
    تلقائيًا للمحلي ونرجع تقرير الفشل للمستخدم.
    """
    folder = (folder or "").strip()
    before_dir, before_path = database.DATA_DIR, database.DB_PATH
    try:
        pre = health_check(folder)
        if not pre.get("ok"):
            raise OSError(pre)
        database.set_network_folder(folder)
        database.close_connections()
        database.init_db()
        post = health_check(folder)
        if not post.get("ok"):
            raise OSError(post)
        st = status()
        st["health"] = post
        return st
    except Exception:
        try:
            if os.path.exists(database._NET_CONFIG):
                os.remove(database._NET_CONFIG)
        except Exception:
            pass
        try:
            database.close_connections()
            database.DATA_DIR = before_dir
            database.DB_PATH = before_path
        except Exception:
            pass
        raise


def disable_shared_database() -> dict:
    """الرجوع لقاعدة الجهاز المحلية."""
    database.set_network_folder("")
    database.close_connections()
    database.init_db()
    return status()


def status() -> dict:
    return {
        "network_mode": database.network_mode(),
        "data_dir": database.DATA_DIR,
        "db_path": database.DB_PATH,
        "config_path": database._NET_CONFIG,
        "exists": os.path.exists(database.DB_PATH),
    }


def _windows_drive_type(root: str):
    """نوع القرص عبر Win32 · None لو غير ويندوز أو تعذر."""
    try:
        import ctypes
        _gdt = ctypes.windll.kernel32.GetDriveTypeW
        _gdt.argtypes = [ctypes.c_wchar_p]
        _gdt.restype = ctypes.c_uint
        return int(_gdt(root))
    except Exception:
        return None


def drive_kind(folder: str) -> str:
    """تصنيف المسار.

    unc: عنوان شبكة · fixed: قرص محلي ثابت (مسموح على المضيف) ·
    remote: قرص شبكة معيَّن بحرف (مرفوض) · removable/cdrom (مرفوض) ·
    ramdisk · relative · unknown.
    """
    p = (folder or "").strip()
    if p.startswith("\\\\") or p.startswith("//"):
        return "unc"
    if len(p) >= 2 and p[1] == ":":
        return {0: "unknown", 1: "unknown", 2: "removable", 3: "fixed",
                4: "remote", 5: "cdrom", 6: "ramdisk"}.get(
                    _windows_drive_type(p[:3]), "unknown")
    if os.path.isabs(p):
        return "fixed"  # posix absolute (تطوير/اختبار)
    return "relative"


def health_check(folder: str | None = None) -> dict:
    """اختبار عملي للمجلد المشترك: ملفات + SQLite + قفل كتابة."""
    folder = (folder or database.DATA_DIR).strip()
    out = {"folder": folder, "db_path": os.path.join(folder, "database.sqlite") if folder else "",
           "ok": False, "checks": []}
    def add(name, ok, msg=""):
        out["checks"].append({"name": name, "ok": bool(ok), "message": msg})
    if not folder:
        add("مسار المجلد", False, "المسار فارغ")
        return out
    kind = drive_kind(folder)
    if kind == "remote":
        add("نوع المسار", False,
            "حرف قرص شبكة معيَّن (mapped) — يختلف بين المستخدمين وقد يختفي. "
            "استخدم مسار UNC مثل \\\\SERVER\\ConTrackData")
        return out
    if kind in ("removable", "cdrom"):
        add("نوع المسار", False,
            "قرص قابل للإزالة — غير آمن لقاعدة مشتركة (انفصاله يتلف البيانات). "
            "ضع المجلد على قرص داخلي ثابت.")
        return out
    if kind in ("unknown", "relative"):
        add("نوع المسار", False,
            "استخدم مسار UNC مثل \\\\SERVER\\ConTrackData "
            "أو مسارًا محليًا على المضيف مثل C:\\ConTrackData")
        return out
    add("نوع المسار", True,
        "UNC" if kind == "unc" else "مسار محلي على المضيف")
    if not os.path.isdir(folder):
        add("وجود المجلد", False, "المجلد غير موجود أو غير مرئي من هذا الجهاز")
        return out
    add("وجود المجلد", True)
    test_file = os.path.join(folder, f".contrack_test_{int(time.time()*1000)}.tmp")
    try:
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("test")
        with open(test_file, encoding="utf-8") as f:
            ok = f.read() == "test"
        os.remove(test_file)
        add("صلاحيات قراءة/كتابة/حذف", ok)
    except Exception as exc:
        add("صلاحيات قراءة/كتابة/حذف", False, str(exc))
        return out
    db_path = os.path.join(folder, "database.sqlite")
    if os.path.exists(db_path):
        try:
            with open(db_path, "ab"):
                pass
            add("ملف قاعدة البيانات قابل للكتابة", True)
        except Exception as exc:
            add("ملف قاعدة البيانات قابل للكتابة", False, str(exc))
            return out
    try:
        database.close_connections()
        old_dir, old_path = database.DATA_DIR, database.DB_PATH
        database.DATA_DIR = folder
        database.DB_PATH = db_path
        database.init_db()
        with database.get_connection() as conn:
            jm = conn.execute("PRAGMA journal_mode").fetchone()[0]
            qc = conn.execute("PRAGMA quick_check").fetchone()[0]
            conn.execute("CREATE TABLE IF NOT EXISTS network_health_check (id INTEGER PRIMARY KEY, checked_at TEXT)")
            conn.execute("INSERT INTO network_health_check (checked_at) VALUES (datetime('now','localtime'))")
        add("SQLite shared DB", qc == "ok", f"journal_mode={jm}; quick_check={qc}")
    except sqlite3.OperationalError as exc:
        msg = str(exc)
        if "disk I/O" in msg:
            msg += " | غالبًا صلاحيات مشاركة Windows غير كاملة، أو المسار غير UNC، أو الملف مفتوح/تالف/على مجلد cloud sync."
        if "FOREIGN KEY" in msg:
            msg += " | بيانات قديمة تتعارض مع القيود — أعد المحاولة (الترقية تُعالجها تلقائياً)."
        add("SQLite shared DB", False, msg)
    except Exception as exc:
        msg = str(exc)
        if "FOREIGN KEY" in msg:
            msg += " | بيانات قديمة تتعارض مع القيود — أعد المحاولة (الترقية تُعالجها تلقائياً)."
        add("SQLite shared DB", False, msg)
    finally:
        try:
            database.close_connections()
            if 'old_dir' in locals():
                database.DATA_DIR = old_dir
                database.DB_PATH = old_path
        except Exception:
            pass
    out["ok"] = all(c["ok"] for c in out["checks"])
    return out


def repair_shared_database() -> dict:
    """محاولة آمنة لإصلاح إعداد/ملف قاعدة الشبكة بدون حذف بيانات.

    لا يحذف database.sqlite أبدًا. ينشئ نسخة احتياطية ويحاول ضبط journal_mode=DELETE.
    """
    st = status()
    folder = st.get("data_dir") or ""
    result = {"status": st, "actions": [], "ok": False}
    hc = health_check(folder)
    result["health_before"] = hc
    if not folder or not os.path.isdir(folder):
        result["actions"].append("Shared folder is missing or not accessible.")
        return result
    db_path = os.path.join(folder, "database.sqlite")
    try:
        database.close_connections()
        if os.path.exists(db_path):
            bak = os.path.join(folder, f"database_repair_backup_{int(time.time())}.sqlite")
            shutil.copy2(db_path, bak)
            result["actions"].append(f"Backup created: {bak}")
        con = sqlite3.connect(db_path, timeout=30.0)
        try:
            con.execute("PRAGMA busy_timeout=30000")
            jm = con.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
            con.execute("PRAGMA synchronous=FULL")
            qc = con.execute("PRAGMA integrity_check").fetchone()[0]
            con.commit()
            result["actions"].append(f"journal_mode={jm}; integrity_check={qc}")
            result["ok"] = (qc == "ok")
        finally:
            con.close()
    except Exception as exc:
        result["actions"].append(f"Repair failed: {exc}")
        result["ok"] = False
    result["health_after"] = health_check(folder)
    result["ok"] = bool(result.get("ok") and result["health_after"].get("ok"))
    return result
