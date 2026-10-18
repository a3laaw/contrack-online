# -*- coding: utf-8 -*-
"""مجلد العميل على الشبكة المحلية: فتح + رصد التحديثات.

فكرة الرصد: نحفظ لكل عميل (folder_seen) = أحدث تاريخ تعديل لملف داخل
مجلده وقت آخر اطلاع. عند الفحص نقارن أحدث تعديل حالي بالمحفوظ —
لو أحدث منه ظهر تنبيه "يوجد تحديث" مع أسماء أحدث الملفات، وزر الفتح
يُحدّث folder_seen فيختفي التنبيه حتى التحديث التالي.
"""
import os
import time

from database.database import get_connection

# كاش قصير لنتيجة فحص مجلدات العملاء.
# السبب: شاشة العملاء تنادي check_customer_folder لكل صف عند كل دخول
# للصفحة، وكل نداء = استعلام + فتح اتصال + مسح مجلد على الشبكة.
# على القاعدة المشتركة كان ذلك يعني عشرات الرحلات ومسح عشرات المجلدات
# في كل مرة. الكاش يحفظ النتيجة ثوانيَ معدودة فيختفي الثقل عند
# الدخول والخروج المتكرر، ويبقى الرصد شبه فوري.
_FOLDER_TTL = 20.0
_folder_cache: dict[int, tuple[float, dict]] = {}


def clear_folder_cache() -> None:
    """تفريغ كاش فحص المجلدات (يُستدعى بعد فتح مجلد أو تغيير مساره)."""
    _folder_cache.clear()

# حد أقصى لعدد الملفات المفحوصة في المجلد الواحد (حماية من مجلدات ضخمة)
_MAX_SCAN = 5000
# مهلة اعتبار مجلد الشبكة غير متاح لا تعطل الواجهة · الفحص عند الطلب فقط


def _folder_reachable(path: str) -> bool:
    """هل المجلد متاح فعلًا؟ (بتقنيتين مختلفتين)

    os.path.isdir يكفي محليًا، لكنه يفشل زورًا مع بعض مسارات الشبكة
    (أسماء عربية · شبكة بطيئة · صلاحيات مؤجلة) بينما الفهرسة الفعلية
    تعمل — لذا عند فشله نجرب os.scandir (مسار FindFirstFile نفسه
    الذي يستخدمه مستكشف ويندوز) قبل الحكم بالنفي.
    """
    if not path:
        return False
    if os.path.isdir(path):
        return True
    try:
        with os.scandir(path) as _it:
            next(iter(_it), None)   # مجرد نجاح الفتح يكفي
        return True
    except OSError:
        return False


def scan_folder(path: str) -> dict | None:
    """أحدث تاريخ تعديل داخل المجلد (متضمنًا المجلدات الفرعية).

    يرجع: {latest: float, latest_files: [(اسم، mtime)…حتى 5]} أو None
    إذا كان المجلد غير متاح.
    """
    # تطبيع المسار أولًا (بلاغ مجلد الشير: //PC/شير ← \\PC\\شير)
    path = normalize_share_path(path)
    if not path or not _folder_reachable(path):
        return None
    latest = 0.0
    newest: list[tuple[str, float]] = []
    count = 0
    try:
        for root, dirs, files in os.walk(path):
            # تجاهل مجلدات النظام المخفية
            dirs[:] = [d for d in dirs if not d.startswith((".", "$"))]
            for f in files:
                if f.startswith((".", "~$")):
                    continue
                count += 1
                if count > _MAX_SCAN:
                    break
                fp = os.path.join(root, f)
                try:
                    mt = os.path.getmtime(fp)
                except OSError:
                    continue
                if mt > latest:
                    latest = mt
                newest.append((os.path.relpath(fp, path), mt))
            if count > _MAX_SCAN:
                break
    except OSError:
        return None
    newest.sort(key=lambda x: -x[1])
    return {"latest": latest, "latest_files": newest[:5], "count": count}


def check_customer_folder(customer_id: int, use_cache: bool = True) -> dict:
    """حالة مجلد العميل: متاح؟ فيه تحديث جديد؟ ما أحدث الملفات؟

    ``use_cache``: يستخدم نتيجة محفوظة لثوانٍ قليلة (افتراضيًا) لتفادي
    مسح المجلد لكل صف في كل دخول للشاشة. مرّر False لفحص فوري.
    """
    cid = int(customer_id or 0)
    if use_cache:
        hit = _folder_cache.get(cid)
        if hit and (time.monotonic() - hit[0]) <= _FOLDER_TTL:
            return hit[1]
    res = _check_customer_folder_uncached(cid)
    _folder_cache[cid] = (time.monotonic(), res)
    return res


def _check_customer_folder_uncached(customer_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT folder_path, folder_seen FROM customers WHERE id=?",
            (customer_id,)).fetchone()
    if not row or not (row["folder_path"] or "").strip():
        return {"configured": False}
    path = row["folder_path"].strip()
    info = scan_folder(path)
    if info is None:
        return {"configured": True, "available": False, "path": path}
    seen = float(row["folder_seen"] or 0)
    has_update = info["latest"] > seen + 1  # هامش ثانية لفروق الأنظمة
    return {
        "configured": True, "available": True, "path": path,
        "has_update": has_update, "latest": info["latest"],
        "latest_files": info["latest_files"], "count": info["count"],
    }


def mark_folder_seen(customer_id: int) -> None:  # noqa: D401
    """تحديث آخر اطلاع = أحدث تعديل حالي (يُستدعى عند فتح المجلد)."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT folder_path FROM customers WHERE id=?",
            (customer_id,)).fetchone()
    if not row:
        return
    info = scan_folder((row["folder_path"] or "").strip())
    latest = info["latest"] if info else 0.0
    with get_connection() as conn:
        conn.execute("UPDATE customers SET folder_seen=? WHERE id=?",
                     (latest, customer_id))
    # بعد الاطلاع يجب أن تختفي علامة التحديث فورًا لا بعد انتهاء الكاش
    _folder_cache.pop(int(customer_id or 0), None)


def folders_with_updates() -> list[dict]:
    """كل العملاء الذين في مجلداتهم تحديثات جديدة · لتنبيهات الرئيسية."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, folder_path, folder_seen FROM customers "
            "WHERE folder_path != ''").fetchall()
    result = []
    for r in rows:
        info = scan_folder(r["folder_path"].strip())
        if info is None:
            continue  # المجلد غير متاح · لا نزعج بتنبيه شبكة مفصولة
        if info["latest"] > float(r["folder_seen"] or 0) + 1:
            newest_name = (info["latest_files"][0][0]
                           if info["latest_files"] else "")
            result.append({
                "customer_id": r["id"], "customer_name": r["name"],
                "path": r["folder_path"].strip(),
                "newest_file": newest_name,
            })
    return result


def normalize_share_path(path: str) -> str:
    """تطبيع مسار مجلد الشبكة لصيغة ويندوز الصحيحة.

    المسارات المنسوخة يدويًا قد تأتي بشرطة أمامية (//PC/Share/عميل)
    أو مخلوطة — تُوحَّد كلها لصيغة UNC بشرطة خلفية، ويُشال الفراغ
    والاقتباسات الزائدة من الأطراف (كانت تفشل الفتح بهدوء).
    """
    bs = chr(92)          # شرطة خلفية واحدة \
    unc = bs * 2          # بادئة UNC \\
    p = (path or "").strip().strip(chr(34)).strip(chr(39)).strip()
    if not p:
        return ""
    if p.startswith("//"):
        p = unc + p[2:]
    if p.startswith(unc):
        p = p.replace("/", bs)
        # ردّ البادئة لمزدوجة واحدة إن تضاعفت
        while p.startswith(bs * 4):
            p = p[2:]
        return unc + p.lstrip(bs)
    # مسار محلي C:/x/y ← C:\x\y
    if len(p) > 1 and p[1] == ":" and "/" in p:
        p = p.replace("/", bs)
    return p


def open_path(path: str) -> bool:
    """فتح ملف أو مجلد بالبرنامج الافتراضي مع دعم مسارات الشبكة UNC.

    على ويندوز لا نفحص وجود المسار قبل الفتح، لأن بعض مسارات الشير
    تكون متاحة لمستكشف ويندوز بينما يفشل معها os.path بسبب بطء الشبكة
    أو صلاحيات مؤجلة. لذلك نترك Explorer/Shell يفتح المسار مباشرة.
    """
    import subprocess
    import sys
    path = normalize_share_path(path)
    if not path:
        return False
    if sys.platform.startswith("win"):
        try:
            os.startfile(path)  # noqa
            return True
        except OSError:
            try:
                subprocess.Popen(["explorer", path])
                return True
            except OSError:
                return False
    if sys.platform == "darwin":
        try:
            subprocess.Popen(["open", path])
            return True
        except OSError:
            return False
    if not os.path.exists(path):
        return False
    try:
        subprocess.Popen(["xdg-open", path])
        return True
    except OSError:
        return False


def open_folder(path: str) -> bool:
    """فتح المجلد في مستكشف الملفات.

    على ويندوز: نسلّم المسار لمستكشف ويندوز مباشرة (os.startfile)
    **بلا فحص isdir مسبق** — الفحص كان يفشل مع شبكات بطيئة أو أسماء
    مجلدات عربية أو صلاحيات مؤجلة، مع أن المستكشف يفتحها بنفسه
    (بلاغ العميل: «تعذر فتح مجلد الشير» على مسار سليم).
    """
    import subprocess
    import sys
    path = normalize_share_path(path)
    if not path:
        return False
    if sys.platform.startswith("win"):
        try:
            os.startfile(path)  # noqa — المستكشف يتولى UNC بنفسه
            return True
        except OSError:
            # المسار غير موجود فعلًا — رسالة أصلية من الفتح
            return False
    if sys.platform == "darwin":
        if not os.path.isdir(path):
            return False
        try:
            subprocess.Popen(["open", path])
            return True
        except OSError:
            return False
    # لينكس (بيئة الفحص): التحقق ثم الفتح
    if not os.path.isdir(path):
        return False
    try:
        subprocess.Popen(["xdg-open", path])
        return True
    except OSError:
        return False
