# -*- coding: utf-8 -*-
"""النسخة الاحتياطية الكاملة: قاعدة البيانات + كل الملفات والصور والمستندات.

الفرق عن `backup_service`:
- `backup_service`  : نسخة سريعة لقاعدة البيانات وحدها، كل بضع ساعات.
- `full_backup_service` : أرشيف ZIP واحد يضم القاعدة + أرشيف العملاء +
  مرفقات العقود + الشعار وصور الترويسة + قوالب Word + أيقونة النظام.

سياسة الاحتفاظ (دوّارة):
- **أسبوعية**: تُنشأ كل 7 أيام ويُحتفظ بآخر 4 (شهر كامل). النسخة الخامسة
  تحذف الأولى تلقائيًا وتأخذ مكانها.
- **شهرية**: أول نسخة في كل شهر تُرقّى إلى «شهرية» ويُحتفظ بآخر 3 أشهر،
  فتبقى صورة بعيدة للبيانات الكبيرة بعد دوران الأسابيع.

كل الإعدادات يضبطها المطوّر من تبويب «أدوات المطور».
"""
import os
import shutil
import zipfile
from datetime import datetime, timedelta

from database.database import (BASE_DIR, DATA_DIR, DB_PATH, get_connection,
                               DatabaseError)
from services.customer_service import ValidationError

FULL_DIR_NAME = "full_backups"
WEEKLY_PREFIX = "نسخة_كاملة_اسبوعية_"
MONTHLY_PREFIX = "نسخة_كاملة_شهرية_"
_DATE_FMT = "%Y-%m-%d %H:%M:%S"

DEFAULT_INTERVAL_DAYS = 7
DEFAULT_KEEP_WEEKLY = 4
DEFAULT_KEEP_MONTHLY = 3
DEFAULT_WEEKDAY = 3          # الخميس (ترقيم بايثون: الاثنين=0)
BY_INTERVAL = -1             # قيمة weekday التي تعني «بالمدة لا بيوم محدد»

# ترقيم بايثون لأيام الأسبوع (weekday())
WEEKDAYS = {
    5: "السبت", 6: "الأحد", 0: "الإثنين", 1: "الثلاثاء",
    2: "الأربعاء", 3: "الخميس", 4: "الجمعة",
}
WEEKDAY_ORDER = [5, 6, 0, 1, 2, 3, 4]   # ترتيب عربي يبدأ بالسبت


def weekday_name(value: int) -> str:
    """اسم يوم النسخة · أو «بالمدة» إن لم يُحدد يوم."""
    return WEEKDAYS.get(int(value), "بالمدة المحددة")

# ما الذي يدخل النسخة الكاملة (مسار على القرص ⟵ اسم المجلد داخل الأرشيف)
def _sources() -> list[tuple[str, str]]:
    return [
        (os.path.join(DATA_DIR, "archive"), "archive"),          # ملفات العملاء
        (os.path.join(DATA_DIR, "attachments"), "attachments"),  # مرفقات العقود
        (os.path.join(BASE_DIR, "assets", "logo"), "logo"),      # الشعار والصور
        (os.path.join(BASE_DIR, "assets", "word_templates"), "word_templates"),
        (os.path.join(BASE_DIR, "assets", "icon"), "icon"),
    ]


# ============================================================
# الإعدادات
# ============================================================
def get_config() -> dict:
    """إعدادات النسخة الكاملة · قيم افتراضية آمنة عند غياب الأعمدة."""
    defaults = {
        "enabled": True,
        "weekday": DEFAULT_WEEKDAY,
        "interval_days": DEFAULT_INTERVAL_DAYS,
        "keep_weekly": DEFAULT_KEEP_WEEKLY,
        "keep_monthly": DEFAULT_KEEP_MONTHLY,
        "folder": "",
        "last": "",
    }
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT full_backup_enabled, full_backup_interval_days, "
                "full_backup_weekday, full_backup_keep_weekly, "
                "full_backup_keep_monthly, full_backup_folder, "
                "last_full_backup_at FROM settings WHERE id=1").fetchone()
    except Exception:
        return defaults
    if not row:
        return defaults
    weekday = row["full_backup_weekday"]
    weekday = DEFAULT_WEEKDAY if weekday is None else int(weekday)
    if weekday not in WEEKDAYS:
        weekday = BY_INTERVAL
    return {
        "enabled": bool(row["full_backup_enabled"]),
        "weekday": weekday,
        "interval_days": max(1, min(90, int(
            row["full_backup_interval_days"] or DEFAULT_INTERVAL_DAYS))),
        "keep_weekly": max(1, min(52, int(
            row["full_backup_keep_weekly"] or DEFAULT_KEEP_WEEKLY))),
        "keep_monthly": max(0, min(36, int(
            row["full_backup_keep_monthly"] or DEFAULT_KEEP_MONTHLY))),
        "folder": row["full_backup_folder"] or "",
        "last": row["last_full_backup_at"] or "",
    }


def save_config(enabled: bool, interval_days: int, keep_weekly: int,
                keep_monthly: int, folder: str = "",
                weekday: int = DEFAULT_WEEKDAY) -> None:
    if int(interval_days) < 1:
        raise ValidationError("مدة النسخة الكاملة يجب أن تكون يومًا على الأقل.")
    if int(keep_weekly) < 1:
        raise ValidationError("عدد النسخ المحفوظة يجب أن يكون 1 على الأقل.")
    weekday = int(weekday)
    if weekday not in WEEKDAYS:
        weekday = BY_INTERVAL
    with get_connection() as conn:
        conn.execute(
            "UPDATE settings SET full_backup_enabled=?, "
            "full_backup_interval_days=?, full_backup_weekday=?, "
            "full_backup_keep_weekly=?, "
            "full_backup_keep_monthly=?, full_backup_folder=? WHERE id=1",
            (1 if enabled else 0, int(interval_days), weekday,
             int(keep_weekly), int(keep_monthly), (folder or "").strip()))


def _mark_done() -> None:
    with get_connection() as conn:
        conn.execute("UPDATE settings SET last_full_backup_at=? WHERE id=1",
                     (datetime.now().strftime(_DATE_FMT),))


# ============================================================
# المجلد والملفات
# ============================================================
def get_dir(custom_folder: str = "") -> str:
    """مجلد النسخ الكاملة: المخصص (قرص خارجي/شبكة) أو data/full_backups."""
    folder = (custom_folder or "").strip()
    if folder:
        try:
            os.makedirs(folder, exist_ok=True)
            probe = os.path.join(folder, ".write_test")
            with open(probe, "w") as fh:
                fh.write("x")
            os.remove(probe)
            return folder
        except OSError:
            pass    # المسار غير متاح · نرجع للافتراضي بلا إيقاف النسخة
    default = os.path.join(DATA_DIR, FULL_DIR_NAME)
    os.makedirs(default, exist_ok=True)
    return default


def list_backups(custom_folder: str = "") -> list[dict]:
    """كل النسخ الكاملة مرتبة من الأحدث · مع نوعها وحجمها وتاريخها."""
    folder = get_dir(custom_folder)
    items = []
    for name in os.listdir(folder):
        if not name.lower().endswith(".zip"):
            continue
        if not (name.startswith(WEEKLY_PREFIX)
                or name.startswith(MONTHLY_PREFIX)):
            continue
        path = os.path.join(folder, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        items.append({
            "name": name,
            "path": path,
            "kind": "شهرية" if name.startswith(MONTHLY_PREFIX) else "أسبوعية",
            "size": stat.st_size,
            "created": datetime.fromtimestamp(stat.st_mtime),
        })
    items.sort(key=lambda x: x["created"], reverse=True)
    return items


def format_size(size: float) -> str:
    for unit in ("بايت", "ك.بايت", "م.بايت", "ج.بايت"):
        if size < 1024:
            return f"{size:,.1f} {unit}"
        size /= 1024
    return f"{size:,.1f} ت.بايت"


# ============================================================
# الإنشاء
# ============================================================
def _add_tree(zf: zipfile.ZipFile, src: str, arc_root: str) -> int:
    """إضافة مجلد كامل للأرشيف · يرجع عدد الملفات المضافة."""
    if not os.path.isdir(src):
        return 0
    count = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs
                   if d not in ("__pycache__", FULL_DIR_NAME, "backups")]
        for name in files:
            full = os.path.join(root, name)
            arc = os.path.join(arc_root, os.path.relpath(full, src))
            try:
                zf.write(full, arc)
                count += 1
            except OSError:
                continue    # ملف مفتوح أو بلا صلاحية · لا نوقف النسخة
    return count


def create_backup(monthly: bool = False, custom_folder: str = "") -> dict:
    """إنشاء نسخة كاملة الآن. يرجع {path, files, size, kind}."""
    folder = get_dir(custom_folder)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    prefix = MONTHLY_PREFIX if monthly else WEEKLY_PREFIX
    path = os.path.join(folder, f"{prefix}{stamp}.zip")
    # اسم فريد دائمًا · نسختان في الثانية نفسها لا تكتبان فوق بعضهما
    counter = 2
    while os.path.exists(path):
        path = os.path.join(folder, f"{prefix}{stamp}_{counter}.zip")
        counter += 1
    files = 0
    tmp_db = os.path.join(DATA_DIR, "_full_backup_db.tmp")
    try:
        # نسخة متسقة من القاعدة (تعمل حتى والبرنامج مفتوح)
        from database.database import backup_db
        backup_db(tmp_db)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED,
                             compresslevel=6) as zf:
            zf.write(tmp_db, "database.sqlite")
            files += 1
            for src, arc in _sources():
                files += _add_tree(zf, src, arc)
            info = (f"نسخة كاملة\nالتاريخ: "
                    f"{datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
                    f"النوع: {'شهرية' if monthly else 'أسبوعية'}\n"
                    f"عدد الملفات: {files}\n")
            zf.writestr("معلومات_النسخة.txt", info)
    except (OSError, DatabaseError, zipfile.BadZipFile) as exc:
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
        raise ValidationError(f"تعذر إنشاء النسخة الكاملة:\n{exc}") from exc
    finally:
        if os.path.exists(tmp_db):
            try:
                os.remove(tmp_db)
            except OSError:
                pass
    return {"path": path, "files": files,
            "size": os.path.getsize(path),
            "kind": "شهرية" if monthly else "أسبوعية"}


def cleanup(custom_folder: str = "", keep_weekly: int | None = None,
            keep_monthly: int | None = None) -> list[str]:
    """حذف الزائد عن الحد: الأقدم يخرج والأحدث يدخل. يرجع أسماء المحذوف."""
    cfg = get_config()
    keep_w = cfg["keep_weekly"] if keep_weekly is None else max(1, keep_weekly)
    keep_m = cfg["keep_monthly"] if keep_monthly is None else max(0, keep_monthly)
    removed = []
    items = list_backups(custom_folder or cfg["folder"])
    weekly = [i for i in items if i["kind"] == "أسبوعية"]
    monthly = [i for i in items if i["kind"] == "شهرية"]
    for group, keep in ((weekly, keep_w), (monthly, keep_m)):
        for item in group[keep:]:      # القائمة مرتبة من الأحدث
            try:
                os.remove(item["path"])
                removed.append(item["name"])
            except OSError:
                continue
    return removed


def is_due(config: dict | None = None, now: datetime | None = None) -> bool:
    """هل حان موعد النسخة الكاملة؟

    وضعان:
    - **يوم محدد** (الافتراضي: الخميس): تُنشأ أول مرة يُفتح فيها البرنامج
      يوم الخميس ولم تُؤخذ نسخة فيه. وإن كان الجهاز مغلقًا ذلك اليوم
      تُنشأ تعويضيًا في أول تشغيل بعد مرور 7 أيام على آخر نسخة.
    - **بالمدة**: كل N يومًا من آخر نسخة.
    """
    cfg = config or get_config()
    if not cfg["enabled"]:
        return False
    now = now or datetime.now()
    last = (cfg["last"] or "").strip()
    last_dt = None
    if last:
        try:
            last_dt = datetime.strptime(last, _DATE_FMT)
        except ValueError:
            last_dt = None
    if last_dt is None:
        return True
    weekday = cfg.get("weekday", BY_INTERVAL)
    if weekday in WEEKDAYS:
        already_today = last_dt.date() == now.date()
        if now.weekday() == weekday and not already_today:
            return True
        # تعويض: الجهاز كان مغلقًا يوم النسخة
        return (now - last_dt) >= timedelta(days=7)
    return (now - last_dt) >= timedelta(days=cfg["interval_days"])


def next_run_text(config: dict | None = None,
                  now: datetime | None = None) -> str:
    """وصف الموعد القادم لعرضه في الإعدادات."""
    cfg = config or get_config()
    if not cfg["enabled"]:
        return "النسخة الكاملة التلقائية معطّلة"
    now = now or datetime.now()
    weekday = cfg.get("weekday", BY_INTERVAL)
    if weekday in WEEKDAYS:
        if is_due(cfg, now):
            return f"مستحقة الآن (يوم النسخة: {weekday_name(weekday)})"
        days = (weekday - now.weekday()) % 7 or 7
        target = now + timedelta(days=days)
        return (f"النسخة القادمة يوم {weekday_name(weekday)} "
                f"{target.strftime('%Y-%m-%d')}")
    if is_due(cfg, now):
        return "مستحقة الآن"
    try:
        last_dt = datetime.strptime(cfg["last"], _DATE_FMT)
        target = last_dt + timedelta(days=cfg["interval_days"])
        return f"النسخة القادمة {target.strftime('%Y-%m-%d')}"
    except (ValueError, KeyError):
        return "مستحقة الآن"


def _monthly_needed(custom_folder: str = "") -> bool:
    """هل نحتاج نسخة شهرية هذا الشهر؟ (أول نسخة في الشهر تُرقّى)."""
    cfg = get_config()
    if cfg["keep_monthly"] <= 0:
        return False
    now = datetime.now()
    for item in list_backups(custom_folder or cfg["folder"]):
        if item["kind"] != "شهرية":
            continue
        if (item["created"].year, item["created"].month) == (now.year,
                                                             now.month):
            return False
    return True


def run_if_due(force: bool = False) -> dict | None:
    """يُستدعى من مؤقّت البرنامج · ينشئ النسخة عند حلول موعدها وينظّف.

    يرجع تفاصيل النسخة أو None إن لم يحن الموعد.
    """
    cfg = get_config()
    if not force and not is_due(cfg):
        return None
    result = create_backup(monthly=False, custom_folder=cfg["folder"])
    # ترقية أول نسخة في الشهر إلى «شهرية» (صورة بعيدة للبيانات الكبيرة)
    if _monthly_needed(cfg["folder"]):
        try:
            monthly_path = result["path"].replace(WEEKLY_PREFIX,
                                                  MONTHLY_PREFIX, 1)
            shutil.copy2(result["path"], monthly_path)
        except OSError:
            pass
    result["removed"] = cleanup(cfg["folder"])
    _mark_done()
    return result


# ============================================================
# الاستعادة
# ============================================================
def inspect_backup(zip_path: str) -> dict:
    """محتويات نسخة كاملة قبل استعادتها."""
    if not os.path.exists(zip_path):
        raise ValidationError("ملف النسخة غير موجود.")
    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            info = ""
            if "معلومات_النسخة.txt" in names:
                info = zf.read("معلومات_النسخة.txt").decode("utf-8", "ignore")
    except zipfile.BadZipFile as exc:
        raise ValidationError("ملف النسخة تالف أو غير صالح.") from exc
    return {
        "has_db": "database.sqlite" in names,
        "files": len(names),
        "archive": sum(1 for n in names if n.startswith("archive/")),
        "attachments": sum(1 for n in names if n.startswith("attachments/")),
        "info": info,
    }


def restore_backup(zip_path: str) -> dict:
    """استعادة نسخة كاملة: القاعدة + كل المجلدات (بعد نسخة أمان تلقائية)."""
    details = inspect_backup(zip_path)
    if not details["has_db"]:
        raise ValidationError("النسخة لا تحتوي على قاعدة البيانات.")
    # نسخة أمان للوضع الحالي قبل الكتابة فوقه
    safety = None
    try:
        safety = create_backup(monthly=False)["path"]
    except Exception:
        safety = None
    tmp_dir = os.path.join(DATA_DIR, "_restore_tmp")
    shutil.rmtree(tmp_dir, ignore_errors=True)
    os.makedirs(tmp_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp_dir)
        from database.database import restore_db
        restore_db(os.path.join(tmp_dir, "database.sqlite"))
        for src, arc in _sources():
            extracted = os.path.join(tmp_dir, arc)
            if not os.path.isdir(extracted):
                continue
            os.makedirs(src, exist_ok=True)
            for root, _dirs, files in os.walk(extracted):
                for name in files:
                    rel = os.path.relpath(os.path.join(root, name), extracted)
                    dest = os.path.join(src, rel)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.copy2(os.path.join(root, name), dest)
    except (OSError, zipfile.BadZipFile, DatabaseError) as exc:
        raise ValidationError(f"تعذرت الاستعادة:\n{exc}") from exc
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return {"safety_copy": safety, **details}


# ============================================================
# تشخيص الحالة (لتنبيهات الشاشة الرئيسية)
# ============================================================
def backup_health(now: datetime | None = None) -> dict:
    """حالة النسخة الكاملة: {level, text, ok}.

    level: "ok" · "warn" (متأخرة) · "danger" (المجلد غير متاح أو لا نسخة).
    """
    cfg = get_config()
    now = now or datetime.now()
    if not cfg["enabled"]:
        return {"ok": True, "level": "ok",
                "text": "النسخة الكاملة التلقائية معطّلة"}

    # 1) مجلد الحفظ المخصص غير متاح (قرص خارجي مفصول مثلًا)
    folder = (cfg["folder"] or "").strip()
    if folder and not os.path.isdir(folder):
        return {"ok": False, "level": "danger",
                "text": ("مجلد النسخة الكاملة غير متاح: "
                         f"{folder} · وصّل القرص الخارجي أو غيّر المجلد "
                         "من أدوات المطور")}

    last = (cfg["last"] or "").strip()
    last_dt = None
    if last:
        try:
            last_dt = datetime.strptime(last, _DATE_FMT)
        except ValueError:
            last_dt = None
    if last_dt is None:
        return {"ok": False, "level": "danger",
                "text": ("لم تُؤخذ أي نسخة احتياطية كاملة بعد · "
                         "شغّلها من أدوات المطور")}

    # 2) تأخر فعلي: مرّ يومان على موعدها ولم تُؤخذ
    days_since = (now - last_dt).days
    limit = 7 if cfg["weekday"] in WEEKDAYS else cfg["interval_days"]
    if days_since > limit + 1:
        when = weekday_name(cfg["weekday"]) if cfg["weekday"] in WEEKDAYS \
            else f"كل {cfg['interval_days']} يوم"
        return {"ok": False, "level": "warn",
                "text": (f"تأخرت النسخة الاحتياطية الكاملة ({when}) · "
                         f"آخر نسخة من {days_since} يومًا "
                         f"({last_dt.strftime('%Y-%m-%d')})")}

    # 3) عدد النسخ المحفوظة أقل من المفترض (حُذفت يدويًا مثلًا)
    kept = len(list_backups(folder))
    if kept == 0:
        return {"ok": False, "level": "danger",
                "text": "لا توجد أي نسخة كاملة محفوظة في مجلد النسخ"}
    return {"ok": True, "level": "ok",
            "text": (f"النسخة الكاملة سليمة · {kept} نسخة محفوظة · "
                     f"{next_run_text(cfg, now)}")}
