# -*- coding: utf-8 -*-
"""أدوات مشتركة لإنشاء PDF بدعم كامل للغة العربية RTL."""
import os
import sys

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except Exception:  # تعمل الطباعة حتى لو نقصت مكتبات تشكيل العربي
    arabic_reshaper = None
    get_display = None
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

if getattr(sys, "frozen", False):
    # عند التشغيل كملف EXE: الخطوط مضمّنة داخل حزمة PyInstaller
    BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(BASE_DIR, "assets", "fonts")

AR_FONT = "Amiri"
AR_FONT_BOLD = "Amiri-Bold"
# خط تجوال — بديل أخف لمن يطابق شكل نموذجه الأصلي (محرك النماذج)
AR_FONT_TAJ = "Tajawal"
AR_FONT_TAJ_BOLD = "Tajawal-Bold"

# ألوان الهوية الافتراضية
PRIMARY = colors.HexColor("#1e3a5f")
ACCENT = colors.HexColor("#2e86ab")
LIGHT_BG = colors.HexColor("#f2f6fa")
BORDER = colors.HexColor("#c9d6e3")
GREEN = colors.HexColor("#1e7d4f")
RED = colors.HexColor("#b03a2e")


def hex_color(value: str, fallback):
    """تحويل نص HEX إلى لون مع قيمة بديلة عند الخطأ."""
    try:
        if value and value.startswith("#") and len(value) in (4, 7):
            return colors.HexColor(value)
    except Exception:
        pass
    return fallback


def light_tint(hex_value: str, fallback=LIGHT_BG):
    """توليد خلفية فاتحة جدًا مشتقة من اللون المخصص (للبطاقات والصفوف)."""
    try:
        c = colors.HexColor(hex_value)
        # مزج مع الأبيض بنسبة 93%
        r = 1 - (1 - c.red) * 0.07
        g = 1 - (1 - c.green) * 0.07
        b = 1 - (1 - c.blue) * 0.07
        return colors.Color(r, g, b)
    except Exception:
        return fallback

_registered = False


class PDFError(Exception):
    """خطأ إنشاء PDF برسالة عربية."""


def _first_existing(paths: list[str]) -> str:
    for p in paths:
        if p and os.path.exists(p):
            return p
    return ""


def register_fonts() -> None:
    global _registered
    if _registered:
        return
    regular = _first_existing([
        os.path.join(FONTS_DIR, "Amiri-Regular.ttf"),
        os.path.join(FONTS_DIR, "Tajawal-Regular.ttf"),
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ])
    bold = _first_existing([
        os.path.join(FONTS_DIR, "Amiri-Bold.ttf"),
        os.path.join(FONTS_DIR, "Tajawal-Bold.ttf"),
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\tahomabd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        regular,
    ])
    if not regular or not bold:
        raise PDFError("تعذر العثور على خط عربي مناسب للطباعة. تأكد من وجود مجلد assets/fonts بجوار البرنامج.")
    try:
        pdfmetrics.registerFont(TTFont(AR_FONT, regular))
        pdfmetrics.registerFont(TTFont(AR_FONT_BOLD, bold))
        _registered = True
    except Exception as exc:
        raise PDFError(f"تعذر تحميل الخط العربي: {exc}") from exc
    for _name, _font_name in (("Tajawal-Regular.ttf", "Tajawal"),
                              ("Tajawal-Bold.ttf", "Tajawal-Bold")):
        _p = os.path.join(FONTS_DIR, _name)
        if not os.path.exists(_p):
            _p = regular if _font_name == "Tajawal" else bold
        try:
            pdfmetrics.registerFont(TTFont(_font_name, _p))
        except Exception:
            pass


def ar(text: str) -> str:
    """تهيئة النص العربي للعرض الصحيح في PDF (تشكيل + اتجاه)."""
    if text is None:
        return ""
    text = str(text)
    if not text.strip():
        return text
    try:
        if arabic_reshaper is None or get_display is None:
            return text
        # تعطيل ligatures مهم جدًا: بعض الخطوط/قارئات PDF لا تعرض
        # لامي «الله» المركبة داخل أسماء مثل «عبدالله» فتظهر كمربع.
        try:
            reshaper = arabic_reshaper.ArabicReshaper(
                configuration={"support_ligatures": False})
            reshaped = reshaper.reshape(text)
        except Exception:
            reshaped = arabic_reshaper.reshape(text)
        reshaped = reshaped.replace("\ufdf2", "الله")
        return get_display(reshaped)
    except Exception:
        return text



def fit_pdf_text(canvas, text: str, font: str, size: float, max_width: float,
                 ellipsis: str = "…") -> str:
    """نص عربي/لاتيني مقصوص بعرض محدد قبل الرسم في PDF.

    مهم لمنع تداخل العناوين الطويلة مع الأرقام داخل صناديق الملخص
    والجداول؛ القياس يتم بعد تطبيق ar() لأن النص العربي يتغير شكله واتجاهه.
    """
    raw = "" if text is None else str(text)
    shaped = ar(raw)
    if canvas.stringWidth(shaped, font, size) <= max_width:
        return shaped
    base = raw
    while len(base) > 1:
        base = base[:-1]
        shaped = ar(base + ellipsis)
        if canvas.stringWidth(shaped, font, size) <= max_width:
            return shaped
    return ar(ellipsis)


def draw_label_value_row(canvas, x: float, y: float, width: float, label: str,
                         value: str, label_font: str, value_font: str,
                         size: float, value_color, label_color=colors.black,
                         gap: float = 8, value_width: float | None = None) -> None:
    """يرسم صف ملخص RTL بفصل ثابت بين البيان والرقم.

    x هو يسار الصندوق و width عرضه. القيمة تُحجز لها مساحة مستقلة يسارًا،
    والبيان يُرسم يمينًا داخل مساحته. هذا يمنع مشكلة تداخل كلمات مثل
    «إجمالي الدائن...» مع رقم 500.000 في كشوف الحساب والمطبوعات.
    """
    value_width = value_width or min(width * 0.42, 44 * 2.834645669)
    label_width = max(10, width - value_width - gap)
    value_right = x + value_width
    label_right = x + width
    canvas.setFont(label_font, size)
    canvas.setFillColor(label_color)
    canvas.drawRightString(label_right, y,
                           fit_pdf_text(canvas, label, label_font, size, label_width))
    canvas.setFont(value_font, size + 1)
    canvas.setFillColor(value_color)
    canvas.drawRightString(value_right, y,
                           fit_pdf_text(canvas, value, value_font, size + 1, value_width))

def safe_image(path: str) -> str | None:
    """يرجع مسار الصورة إن كانت صالحة، وإلا None."""
    if not path or not os.path.exists(path):
        return None
    try:
        from reportlab.lib.utils import ImageReader
        ImageReader(path)
        return path
    except Exception:
        return None


def get_transparent_stamp(path: str, threshold: int = 230):
    """يرجع صورة الختم بعد إزالة الخلفية البيضاء ككائن BytesIO في الذاكرة.

    البيكسل القريب من الأبيض (كل قنواته فوق ``threshold``) يُجعَل شفافًا،
    فيظهر الختم فوق التوقيع والورق بلا مربع أبيض حوله. الناتج صالح لتمريره
    مباشرة إلى ``canvas.drawImage`` عبر ``ImageReader``.
    """
    if not path or not os.path.exists(path):
        return None
    try:
        from PIL import Image
        import io
        img = Image.open(path).convert("RGBA")
        datas = img.getdata()
        new_data = []
        for item in datas:
            if (item[0] > threshold and item[1] > threshold
                    and item[2] > threshold):
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append(item)
        img.putdata(new_data)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf
    except Exception:
        return None


def _cropped_stamp_path(image_path: str) -> str | None:
    """قص حواف الصورة الفارجة تلقائيًا وإرجاع مسار نسخة مقصوصة.

    كثير من صور الأختام تُرفع بهوامش بيضاء/شفافة واسعة حول الختم،
    فلو رُسمت كما هي يبدو الختم صغيرًا عائمًا في منتصف خانة أكبر منه.
    هذه الدالة تمسح البيكسل صفًا بصف وعمودًا بعمود، وتكتشف أول وآخر
    بيكسل له محتوى فعلي (غير شفاف وغير أبيض بالكامل)، ثم تقص الصورة
    لمحتواها فقط. الناتج يُحفظ في مجلد مؤقت لجلسة الطباعة.
    """
    path = safe_image(image_path)
    if not path:
        return None
    try:
        from PIL import Image as _PILImage
        img = _PILImage.open(path).convert("RGBA")
        w, h = img.size
        if not w or not h:
            return path
        px = img.load()
        # عتبة: البيكسل يُعد «محتوى» إن كان غير شفاف (alpha > 25)
        # أو لونه ليس أبيض/قريب من الأبيض (أي قناة < 240).
        def _has_content(x: int, y: int) -> bool:
            r, g, b, a = px[x, y]
            if a <= 25:
                return False
            return r < 240 or g < 240 or b < 240

        top = 0
        while top < h and not any(_has_content(x, top) for x in range(w)):
            top += 1
        bottom = h - 1
        while bottom >= top and not any(
                _has_content(x, bottom) for x in range(w)):
            bottom -= 1
        left = 0
        while left < w and not any(_has_content(left, y) for y in range(top, bottom + 1)):
            left += 1
        right = w - 1
        while right >= left and not any(
                _has_content(right, y) for y in range(top, bottom + 1)):
            right -= 1
        # لو الصورة كلها فارغة (ختم أبيض على أبيض) نرجعها كما هي
        if left >= right or top >= bottom:
            return path
        # هامش صغير 4% حول الختم بعد القص حتى لا يلتصق بحافة الخانة
        margin_x = max(2, int((right - left) * 0.04))
        margin_y = max(2, int((bottom - top) * 0.04))
        left = max(0, left - margin_x)
        right = min(w - 1, right + margin_x)
        top = max(0, top - margin_y)
        bottom = min(h - 1, bottom + margin_y)
        cropped = img.crop((left, top, right + 1, bottom + 1))
        import tempfile
        fd, tmp_path = tempfile.mkstemp(
            prefix="stamp_crop_", suffix=".png")
        os.close(fd)
        cropped.save(tmp_path, "PNG")
        return tmp_path
    except Exception:
        return path


def draw_stamp(c, cx: float, cy: float, image_path: str,
               max_mm: float = 30) -> bool:
    """ختم الشركة في مكانه المخصص · متمركزًا حول (cx, cy).

    يحافظ على نسبة الصورة ولا يتجاوز `max_mm` في أي بُعد، ويُرسم
    بشفافية خفيفة ليبدو كختم فوق الورق لا كصورة ملصقة.
    """
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    # قص الحواف الفارجة تلقائيًا قبل الرسم (الأختام غالبًا ما تُرفع
    # بهوامش بيضاء/شفافة واسعة تجعلها تبدو صغيرة عائمة).
    path = _cropped_stamp_path(image_path) or safe_image(image_path)
    if not path:
        return False
    try:
        img = ImageReader(path)
        iw, ih = img.getSize()
        if not iw or not ih:
            return False
        limit = max_mm * mm
        scale = min(limit / iw, limit / ih)
        w, h = iw * scale, ih * scale
        c.saveState()
        try:
            c.setFillAlpha(0.92)
            c.setStrokeAlpha(0.92)
        except Exception:
            pass
        c.drawImage(path, cx - w / 2, cy - h / 2, width=w, height=h,
                    mask="auto", preserveAspectRatio=True)
        c.restoreState()
        return True
    except Exception:
        return False


def draw_header_image(c, page_w: float, page_h: float, image_path: str,
                      max_h_mm: float = 40) -> float:
    """يرسم صورة الهيدر أعلى الصفحة بعرض كامل ويرجع ارتفاعها المرسوم بالنقاط."""
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    img = ImageReader(image_path)
    iw, ih = img.getSize()
    draw_h = min(max_h_mm * mm, page_w * ih / iw)
    c.drawImage(image_path, 0, page_h - draw_h, width=page_w, height=draw_h,
                preserveAspectRatio=False, mask="auto")
    return draw_h


def footer_image_height(page_w: float, image_path: str,
                        max_h_mm: float = 30) -> float:
    """V4.33: ارتفاع صورة الفوتر المرسوم (بالنقاط) دون رسم — لحجز الشريط."""
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    img = ImageReader(image_path)
    iw, ih = img.getSize()
    return min(max_h_mm * mm, page_w * ih / iw)


def draw_footer_image(c, page_w: float, image_path: str,
                      max_h_mm: float = 30) -> float:
    """يرسم صورة الفوتر أسفل الصفحة بعرض كامل ويرجع ارتفاعها المرسوم."""
    draw_h = footer_image_height(page_w, image_path, max_h_mm)
    c.drawImage(image_path, 0, 0, width=page_w, height=draw_h,
                preserveAspectRatio=False, mask="auto")
    return draw_h


def safe_logo(logo_path: str) -> str | None:
    """يرجع مسار الشعار إن كان صالحًا، وإلا None (بدون كسر التقرير)."""
    if not logo_path:
        return None
    if not os.path.exists(logo_path):
        return None
    try:
        from reportlab.lib.utils import ImageReader
        ImageReader(logo_path)  # يتحقق أن الصورة قابلة للقراءة
        return logo_path
    except Exception:
        return None


def apply_pdf_metadata(c, title: str = "") -> None:
    """كتابة بيانات المستند (الكاتب/المنتج) باسم الشركة لا باسم المكتبة."""
    try:
        from services import settings_service as _ss
        settings = _ss.get_settings()
        company = (getattr(settings, "company_name", "") or "").strip()
        app_name = _ss.app_name()
    except Exception:
        company, app_name = "", ""
    if title:
        c.setTitle(title)
    for setter, value in (("setAuthor", company), ("setCreator", company or app_name),
                          ("setProducer", company or app_name),
                          ("setSubject", company)):
        try:
            if value:
                getattr(c, setter)(value)
        except Exception:
            pass
