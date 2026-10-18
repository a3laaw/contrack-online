# -*- coding: utf-8 -*-
"""تغيير أيقونة البرنامج من صورة يختارها المستخدم.

يولّد من الصورة الواحدة كل الصيغ التي يحتاجها النظام:
  assets/icon/app_icon.png  · أيقونة النوافذ وشاشة الدخول
  assets/icon/app_icon.ico  · أيقونة اختصار سطح المكتب وملف EXE

ملاحظة: لو كان هناك app_icon.svg قديم فهو الأسبق في القراءة، لذلك
يُنقل إلى نسخة احتياطية حتى تظهر أيقونة المستخدم فعلًا.
"""
import os
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(BASE_DIR, "assets", "icon")
PNG_PATH = os.path.join(ICON_DIR, "app_icon.png")
ICO_PATH = os.path.join(ICON_DIR, "app_icon.ico")
SVG_PATH = os.path.join(ICON_DIR, "app_icon.svg")
BACKUP_DIR = os.path.join(ICON_DIR, "backup")

ALLOWED = (".png", ".jpg", ".jpeg", ".bmp", ".ico", ".webp")
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


class IconError(Exception):
    """خطأ برسالة عربية جاهزة للعرض."""


def _backup(path: str) -> None:
    if not os.path.exists(path):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(path, os.path.join(BACKUP_DIR, os.path.basename(path)))


def install_icon(source: str) -> str:
    """تركيب صورة كأيقونة للبرنامج · يرجع رسالة نجاح عربية."""
    if not source or not os.path.isfile(source):
        raise IconError("لم يتم اختيار ملف صورة صالح.")
    ext = os.path.splitext(source)[1].lower()
    if ext not in ALLOWED:
        raise IconError("صيغة الصورة غير مدعومة.\n"
                        "المدعوم: PNG أو JPG أو BMP أو ICO.")
    try:
        from PIL import Image
    except ImportError as exc:                       # pragma: no cover
        raise IconError("مكتبة الصور غير مثبتة، شغّل INSTALL.bat.") from exc

    try:
        img = Image.open(source)
        img.load()
    except Exception as exc:
        raise IconError(f"تعذر قراءة الصورة:\n{exc}") from exc

    img = img.convert("RGBA")

    # قصّ مربّع من المنتصف حتى لا تتشوّه الأيقونة
    w, h = img.size
    if w != h:
        side = min(w, h)
        left, top = (w - side) // 2, (h - side) // 2
        img = img.crop((left, top, left + side, top + side))

    os.makedirs(ICON_DIR, exist_ok=True)
    _backup(PNG_PATH)
    _backup(ICO_PATH)
    _backup(SVG_PATH)

    try:
        img.resize((512, 512), Image.LANCZOS).save(PNG_PATH, format="PNG")
        img.resize((256, 256), Image.LANCZOS).save(
            ICO_PATH, format="ICO",
            sizes=[(s, s) for s in ICO_SIZES])
    except Exception as exc:
        raise IconError(f"تعذر حفظ الأيقونة:\n{exc}") from exc

    # ملف SVG الافتراضي أسبق في القراءة · ننحّيه ليظهر اختيار المستخدم
    moved_svg = False
    if os.path.exists(SVG_PATH):
        try:
            os.remove(SVG_PATH)
            moved_svg = True
        except OSError:
            pass

    msg = ("تم تغيير أيقونة البرنامج.\n"
           "• أيقونة النوافذ وشاشة الدخول: فورًا بعد إعادة التشغيل.\n"
           "• أيقونة سطح المكتب: شغّل create_desktop_shortcut.bat مرة واحدة.")
    if moved_svg:
        msg += "\n(نسخة الأيقونة السابقة محفوظة في assets/icon/backup)"
    return msg


def restore_default() -> str:
    """إرجاع الأيقونة الأصلية من النسخة الاحتياطية."""
    if not os.path.isdir(BACKUP_DIR):
        raise IconError("لا توجد نسخة احتياطية من الأيقونة الأصلية.")
    restored = 0
    for name in ("app_icon.svg", "app_icon.png", "app_icon.ico"):
        src = os.path.join(BACKUP_DIR, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(ICON_DIR, name))
            restored += 1
    if not restored:
        raise IconError("النسخة الاحتياطية فارغة.")
    return "تمت استعادة الأيقونة الأصلية، أعد تشغيل البرنامج."
