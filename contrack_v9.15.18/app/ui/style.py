# -*- coding: utf-8 -*-
"""Premium Liquid Glass ERP · نظام التصميم.

Qt لا يدعم backdrop-filter، لذا الزجاج منفّذ بـ:
- خلفية Ambient متدرجة مرسومة برمجياً (GlassBackground)
- طبقات rgba شفافة فعلية فوقها
- حدود بيضاء شبه شفافة (border highlights)
- ظلال ناعمة QGraphicsDropShadowEffect

ثيم واحد فقط: light (زجاجي نهاري) — لا يوجد ثيم داكن، والنظام يفرض الألوان الفاتحة حتى على ويندوز بالوضع الداكن.
"""
from PySide6.QtCore import Qt
from PySide6.QtGui import (QBrush, QColor, QLinearGradient, QPainter,
                           QRadialGradient)
from PySide6.QtWidgets import (QGraphicsDropShadowEffect, QMessageBox,
                               QWidget)

FONT_FAMILY = '"Tajawal", "Segoe UI", "Tahoma", sans-serif'

# ============ تعريف الثيمات ============
THEMES = {
    "light": {
        "name": "زجاجي نهاري",
        # ===== اللوحة المعتمدة 2026-08-22 (عائلة الأزرق) =====
        "BRAND_900": "#4338CA", "BRAND_700": "#4338CA",
        "BRAND_600": "#4F46E5", "BRAND_100": "#EEF0FF",
        "BRAND_50": "#F1F4FA",
        "SUCCESS_600": "#16A34A", "SUCCESS_700": "#15803D",
        "DANGER_600": "#DC2626", "DANGER_700": "#B91C1C",
        "WARNING_600": "#D97706", "WARNING_700": "#B45309",
        "SURFACE_2": "#F8FAFC",
        "BORDER_STRONG": "#D8E0EB",
        "TEXT_900": "#1F2937", "TEXT_600": "#64748B", "TEXT_400": "#94A3B8",
        # الهوية (مفاتيح قديمة · قيم جديدة)
        "PRIMARY": "#1F2937", "ACCENT": "#4F46E5", "ACCENT_DARK": "#4338CA",
        "TEXT": "#1F2937", "MUTED": "#64748B",
        "GREEN": "#16A34A", "RED": "#DC2626", "WARNING": "#D97706",
        "BG": "#EEF2F7", "CARD": "#FFFFFF",
        "BORDER": "#E3E9F2",
        # الزجاج
        "GLASS": "#FFFFFF",
        "GLASS_STRONG": "#FFFFFF",
        "GLASS_HOVER": "#F8FAFC",
        "GLASS_BORDER": "#E3E9F2",
        "GLASS_EDGE": "#E3E9F2",
        # sidebar
        "SIDE_GLASS": "#FFFFFF",
        "SIDE_TEXT": "#1F2937", "SIDE_SUB": "#64748B",
        "NAV_HOVER": "#F1F4FA",
        "NAV_ACTIVE": "#EEF0FF",
        "NAV_ACTIVE_BORDER": "#4F46E5",
        "NAV_ACTIVE_TEXT": "#4F46E5",
        # الحقول
        "INPUT_BG": "#FFFFFF",
        "INPUT_BORDER": "#E3E9F2",
        "INPUT_FOCUS_BORDER": "#4F46E5",
        "INPUT_FOCUS_BG": "#FFFFFF",
        # الجداول
        "TBL_BG": "#FFFFFF",
        "TBL_HEADER": "#F5F7FB",
        "TBL_HEADER_TEXT": "#64748B",
        "TBL_ALT": "#F8FAFC",
        "TBL_GRID": "#E9EEF5",
        "TBL_SELECT": "#EEF0FF",
        "TBL_SELECT_TEXT": "#1F2937",
        # الأزرار
        "BTN_FLAT_BG": "#FFFFFF",
        "BTN_FLAT_TEXT": "#1F2937",
        "BTN_FLAT_BORDER": "#E3E9F2",
        "BTN_FLAT_HOVER": "#F1F4FA",
        "BTN_DANGER_BG": "#FEF2F2",
        "BTN_DANGER_TEXT": "#B91C1C",
        "BTN_DANGER_BORDER": "#F3C1C1",
        "BTN_DANGER_HOVER": "#FDE7E7",
        "BTN_SUCCESS_BG": "#EEF9F1",
        "BTN_SUCCESS_TEXT": "#15803D",
        "BTN_SUCCESS_BORDER": "#BFE8CA",
        "BTN_SUCCESS_HOVER": "#E3F5E8",
        # tabs / scroll
        "TAB_BG": "#FFFFFF", "TAB_TEXT": "#64748B",
        "TAB_HOVER": "#F1F4FA",
        "SCROLL": "#CBD5E1",
        "SCROLL_HOVER": "#94A3B8",
        # خلفية Ambient (الزجاج الأزرق)
        "AMBIENT_BASE1": "#EEF2F7", "AMBIENT_BASE2": "#EEF2F7",
        "AMBIENT_BASE_MID": "#EEF2F7",
        # ألوان صلبة (بلا شفافية) للقوائم المنسدلة والنوافذ المنبثقة ·
        # الشفافية فوق سطح المكتب أو فوق الوضع الليلي لويندوز تعطي أسود
        "POPUP_BG": "#FFFFFF", "POPUP_BORDER": "#D5DCE8",
        "SURFACE": "#FFFFFF", "FIELD_BG": "#FFFFFF",
        "AMBIENT_GLOW1": (79, 70, 229, 26),     # #4F46E5
        "AMBIENT_GLOW2": (67, 56, 202, 20),     # #4338CA
        "AMBIENT_GLOW3": (129, 140, 248, 18),   # #818CF8
        "SHADOW": (31, 41, 55, 18),
    },
}

CURRENT_THEME = "light"
PRIMARY = ACCENT = BG = CARD = BORDER = TEXT = MUTED = GREEN = RED = ""

# ===== دلالة الأرقام المالية (المرحلة 4) =====
MONEY_IN = "#15803D"       # المحصّل · سند قبض
MONEY_OUT = "#B91C1C"      # المنصرف · سند صرف
MONEY_REMAIN = "#B45309"   # المتبقي · المستحق (كهرماني · ليس تحذيرًا)
MONEY_OVERDUE = "#B91C1C"  # متأخر فعلًا: دفعة فات استحقاقها أو شيك متأخر
MONEY_NEUTRAL = "#1F2937"  # قيمة العقد وأي رقم محايد

# ===== لوحة الألوان الدلالية الموحّدة (المصدر الوحيد · القاعدة 26) =====
INFO = "#4F46E5"        # معلومة / حالة معتمدة / الإجراء الأساسي
OK_GREEN = "#16A34A"     # تمام · مكتمل · وارد
WARN = "#D97706"         # انتباه · قريب الاستحقاق · متوقف
DANGER = "#DC2626"       # خطر فعلي · ملغى · متأخر
NEUTRAL = "#64748B"      # محايد · مغلق · بلا دلالة
NEUTRAL_SOFT = "#94A3B8"  # محايد باهت · مسودة
PURPLE = "#7C3AED"       # منتهٍ بشكل طبيعي · مقاولو الباطن
PURPLE_DEEP = "#5B21B6"  # نص فوق خلفية بنفسجية فاتحة
AMBER_DEEP = "#B45309"   # كهرماني غامق · نص التحذير الهادئ
TEXT_STRONG = "#1F2937"  # أقوى درجة نص
GREEN_DEEP = "#0F7A38"   # نص أخضر غامق فوق خلفية فاتحة
AMBER_TEXT = "#92400E"   # نص فوق خلفية كهرمانية فاتحة

# ألوان حالات العقد — تُقرأ من هنا في كل شاشة (كانت مكررة في 3 ملفات)
STATUS_COLORS = {
    "مسودة": NEUTRAL_SOFT,
    "تحت المراجعة": WARN,
    "معتمد": INFO,
    "نشط": OK_GREEN,
    "متوقف": WARN,
    "منتهي": PURPLE,
    "مغلق": NEUTRAL,
    "ملغى": DANGER,
}
STATUS_DEFAULT = NEUTRAL

# V5.4 ⑥: خريطة ألوان حالة الدفعات/المستحقات — مصدر واحد لكل الشاشات.
#   مدفوع/محصَّل ⇒ أخضر · مستحق/متأخر ⇒ أحمر · جزئي ⇒ أصفر (كهرماني)
#   بانتظار إنجاز المرحلة أو المصادر ⇒ رمادي (لم يستحق بعد — ليس دَينًا)
PAY_STATUS_COLORS = {
    "مدفوع": OK_GREEN, "مدفوعة": OK_GREEN, "محصَّل": OK_GREEN,
    "محصل": OK_GREEN, "مسدَّد": OK_GREEN, "مسدد": OK_GREEN,
    "مستحقة": DANGER, "مستحق": DANGER, "متأخر": DANGER,
    "متأخرة": DANGER, "غير مدفوع": DANGER,
    "جزئي": WARN, "جزئية": WARN, "مستحق قريبًا": WARN,
    "بانتظار إنجاز المرحلة": NEUTRAL, "بانتظار المصادر": NEUTRAL,
    "مرحلة متخطاة": NEUTRAL,
}


def status_color(status: str, default: str | None = None) -> str:
    """لون الحالة الموحد (⑥): أخضر مدفوع · أحمر مستحق · أصفر جزئي.

    غير المعروف يرجع ``STATUS_COLORS`` ثم الافتراضي الرمادي — فلا تظهر
    حالة بلا لون في أي جدول.
    """
    st = (status or "").strip()
    if st in PAY_STATUS_COLORS:
        return PAY_STATUS_COLORS[st]
    return STATUS_COLORS.get(st, default or STATUS_DEFAULT)

# ألوان مراحل المتابعة — يقرأها workflow_service عند زرع الافتراضيات
STAGE_COLORS = {
    "neutral": NEUTRAL,
    "warn": WARN,
    "info": INFO,
    "amber": AMBER_DEEP,
    "done": OK_GREEN,
    "purple": PURPLE,
    "danger": DANGER,
}
STAGE_COLOR_DEFAULT = INFO

# ألوان أيقونات هوية الشاشات (رأس النافذة)
ICON_CUSTOMER = INFO
ICON_CONTRACT = INFO
ICON_SUB = "#8B5CF6"
ICON_TASK = WARN

# عارض PDF (رمادي محايد خلف الورقة — ليس لونًا دلاليًا)
PDF_VIEWER_BG = "#6D7F90"
PDF_PAGE_BORDER = "#4E6070"

# ألوان هوية المستندات الافتراضية (تُحفظ في الإعدادات ويعدّلها العميل)
DOC_PRIMARY_DEFAULT = "#1E3A5F"
DOC_ACCENT_DEFAULT = "#2E86AB"

# خلفية حقول العرض فقط (رمادي فاتح جدًا)
READONLY_BG = "#FAFCFE"

_T = THEMES["light"]


# ===== ثيم واحد معتمد للنظام =====
THEME_KEY = "light"


def _normalize(theme_key: str) -> str:
    return "light"


def _load(theme_key: str):
    global CURRENT_THEME, PRIMARY, ACCENT, BG, CARD, BORDER, TEXT, MUTED
    global GREEN, RED, _T
    _T = THEMES["light"]          # ثيم واحد فقط
    CURRENT_THEME = "light"
    PRIMARY, ACCENT, BG = _T["PRIMARY"], _T["ACCENT"], _T["BG"]
    CARD, BORDER, TEXT = _T["CARD"], _T["BORDER"], _T["TEXT"]
    MUTED, GREEN, RED = _T["MUTED"], _T["GREEN"], _T["RED"]


def theme() -> dict:
    return _T


# ============ خلفية Ambient (تحاكي الإضاءة خلف الزجاج) ============
class GlassBackground(QWidget):
    """خلفية متدرجة مع مصادر ضوء ناعمة · تُرسم خلف كل الطبقات الزجاجية."""

    def paintEvent(self, event):
        """خلفية هادئة موحّدة بلا تدرجات أو زخارف."""
        t = _T
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), QColor(t["BG"]))
        p.end()


SHADOWS_ENABLED = True     # يُطفأ في «الوضع السريع» — يضبطه main عند الإقلاع


def set_shadows_enabled(on: bool) -> None:
    """تشغيل/إطفاء ظلال البطاقات (الوضع السريع)."""
    global SHADOWS_ENABLED
    SHADOWS_ENABLED = bool(on)


def soft_shadow(widget: QWidget, radius: int = 28, y: int = 6,
                alpha: int | None = None, x: int = 0) -> None:
    """ظل ناعم منتشر · يعطي إحساس الطفو فوق الخلفية."""
    if not SHADOWS_ENABLED:
        return
    t = _T
    r, g, b, a = t["SHADOW"]
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(radius)
    effect.setXOffset(x)
    effect.setYOffset(y)
    effect.setColor(QColor(r, g, b, alpha if alpha is not None else a))
    widget.setGraphicsEffect(effect)


# ============ التكيف مع حجم الشاشة و DPI ============

def available_geometry(widget=None):
    """المساحة المتاحة فعليًا على الشاشة التي تظهر عليها النافذة."""
    from PySide6.QtGui import QGuiApplication
    screen = None
    if widget is not None:
        try:
            handle = widget.window().windowHandle()
            if handle is not None:
                screen = handle.screen()
            if screen is None:
                screen = QGuiApplication.screenAt(widget.mapToGlobal(
                    widget.rect().center()))
        except Exception:
            screen = None
    if screen is None:
        screen = QGuiApplication.primaryScreen()
    if screen is None:
        return None
    return screen.availableGeometry()


def fit_window(win, want_w: int, want_h: int,
               min_w: int = 0, min_h: int = 0, ratio: float = 0.94) -> None:
    """ضبط حجم نافذة كاملة بحيث تناسب أي شاشة وأي نسبة تكبير."""
    avail = available_geometry(win)
    if avail is None:
        if min_w or min_h:
            win.setMinimumSize(max(min_w, 320), max(min_h, 240))
        win.resize(want_w, want_h)
        return

    max_w = max(int(avail.width() * ratio), 320)
    max_h = max(int(avail.height() * ratio), 240)

    if min_w or min_h:
        win.setMinimumSize(min(min_w, max_w), min(min_h, max_h))

    win.resize(min(want_w, max_w), min(want_h, max_h))


def center_on_screen(win) -> None:
    """توسيط النافذة داخل المساحة المتاحة (بعد ضبط الحجم)."""
    avail = available_geometry(win)
    if avail is None:
        return
    geo = win.frameGeometry()
    geo.moveCenter(avail.center())
    x = max(avail.left(), min(geo.left(), avail.right() - win.width()))
    y = max(avail.top(), min(geo.top(), avail.bottom() - win.height()))
    win.move(x, y)


def scale_unit(widget=None) -> float:
    """معامل تصغير للعناصر ثابتة العرض على الشاشات الصغيرة."""
    avail = available_geometry(widget)
    if avail is None:
        return 1.0
    factor = min(avail.width() / 1600.0, avail.height() / 900.0)
    return max(0.78, min(1.0, factor))


def app_icon_path() -> str | None:
    """مسار أيقونة البرنامج · يفضّل SVG (حاد في أي DPI) ثم PNG."""
    import os
    import sys
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS",
                       os.path.dirname(os.path.abspath(sys.executable)))
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icon_dir = os.path.join(base, "assets", "icon")
    for name in ("app_icon.svg", "app_icon.png"):
        path = os.path.join(icon_dir, name)
        if os.path.exists(path):
            return path
    return None


def app_icon():
    """QIcon للبرنامج (SVG يُرسم بأي مقاس بلا تشويش)."""
    from PySide6.QtGui import QIcon
    path = app_icon_path()
    return QIcon(path) if path else QIcon()


def icon_pixmap(size: int, widget=None):
    """QPixmap للأيقونة بمقاس منطقي، مرسومة بدقة الشاشة الفعلية."""
    from PySide6.QtGui import QGuiApplication, QPixmap
    path = app_icon_path()
    if not path:
        return QPixmap()
    dpr = 1.0
    try:
        screen = QGuiApplication.primaryScreen()
        if screen:
            dpr = float(screen.devicePixelRatio())
        if widget is not None:
            dpr = max(dpr, float(widget.devicePixelRatioF()))
    except Exception:
        dpr = 1.0
    dpr = max(1.0, dpr)

    if path.lower().endswith(".svg"):
        pix = app_icon().pixmap(int(size * dpr), int(size * dpr))
    else:
        src = QPixmap(path)
        if src.isNull():
            return QPixmap()
        pix = src.scaled(int(size * dpr), int(size * dpr),
                         Qt.KeepAspectRatio, Qt.SmoothTransformation)
    if not pix.isNull():
        pix.setDevicePixelRatio(dpr)
    return pix


# ============ مقياس الخطوط ============
FONT_SCALE = 0.85
_MIN_FONT_PX = 9.0


def scale_css(css: str) -> str:
    """تصغير كل قيم font-size داخل نص CSS بنسبة FONT_SCALE."""
    import re

    def _one(m):
        try:
            size = float(m.group(1)) * FONT_SCALE
        except ValueError:
            return m.group(0)
        size = max(_MIN_FONT_PX, size)
        text = f"{size:.1f}".rstrip("0").rstrip(".")
        return f"font-size: {text}px"

    return re.sub(r"font-size:\s*([0-9.]+)px", _one, css)


def build_stylesheet(theme_key: str = THEME_KEY) -> str:
    t = THEMES["light"]           # ثيم واحد معتمد
    return scale_css(f"""
* {{
    font-family: {FONT_FAMILY};
    font-size: 14px;
    color: {t['TEXT']};
    outline: none;
}}
QMainWindow {{ background: {t['BG']}; }}
QDialog {{ background: {t['BG']}; }}
QWidget#page, #transparentHost {{ background: transparent; }}
QScrollArea {{ border: none; background: transparent; }}
QScrollArea > QWidget > QWidget {{ background: transparent; }}
QStackedWidget {{ background: transparent; }}

/* ============ Sidebar: Floating Liquid Glass ============ */
QFrame#sidebar {{
    background: {t['SIDE_GLASS']};
    border: 1.5px solid {t['GLASS_BORDER']};
    border-top-left-radius: 22px;
    border-bottom-left-radius: 22px;
    border-top-right-radius: 0px;
    border-bottom-right-radius: 0px;
    border-right: none;
}}
QLabel#appTitle {{
    color: {t['PRIMARY']}; font-size: 17px; font-weight: 800;
    background: transparent; padding: 0;
}}
QLabel#appSubtitle {{
    color: {t['SIDE_SUB']}; font-size: 10px; background: transparent; padding: 0;
}}
QLabel#appLogo {{ background: transparent; }}
QPushButton[nav="true"] {{
    color: {t['SIDE_TEXT']}; background: transparent;
    border: 1.5px solid transparent;
    padding: 9px 10px; text-align: left; font-size: 13.5px;
    border-radius: 12px; margin: 2px 7px; font-weight: 600;
}}
QPushButton[nav="true"]:hover {{
    background: {t['SURFACE_2']};
    border-color: {t['BORDER']};
}}
QPushButton[nav="true"]:checked {{
    background: {t['BRAND_50']};
    border: 1px solid {t['BORDER']};
    border-right: 3px solid {t['BRAND_600']};
    color: {t['BRAND_600']};
    font-weight: 800;
}}
QPushButton[navGroup="true"] {{
    color: {t['SIDE_TEXT']}; background: transparent;
    border: 1.5px solid transparent;
    padding: 11px 16px; text-align: left; font-size: 15px;
    border-radius: 12px; margin: 2px 12px; font-weight: 800;
}}
QPushButton[navGroup="true"]:hover {{
    background: {t['SURFACE_2']};
    border-color: {t['GLASS_EDGE']};
}}
QPushButton[navChild="true"] {{
    color: {t['SIDE_TEXT']}; background: transparent;
    border: 1.5px solid transparent;
    padding: 8px 22px 8px 10px; text-align: left; font-size: 13px;
    border-radius: 11px; margin: 1px 12px 1px 10px; font-weight: 600;
}}
QPushButton[navChild="true"]:hover {{
    background: {t['SURFACE_2']};
    border-color: {t['GLASS_EDGE']};
}}
QPushButton[navChild="true"]:checked {{
    background: {t['BRAND_50']};
    border: 1px solid {t['BORDER']};
    border-right: 3px solid {t['BRAND_600']};
    color: {t['BRAND_600']};
    font-weight: 800;
}}
QPushButton[chip="true"] {{
    background: {t['BTN_FLAT_BG']}; color: {t['BTN_FLAT_TEXT']};
    border: 1.5px solid {t['BTN_FLAT_BORDER']};
    border-radius: 12px; padding: 6px 16px; font-size: 13px;
    font-weight: 700;
}}
QPushButton[chip="true"]:hover {{
    background: {t['BTN_FLAT_HOVER']};
    border-color: {t['INPUT_FOCUS_BORDER']};
}}
QPushButton[chip="true"]:checked {{
    background: {t['BRAND_600']};
    color: white; border: 1.5px solid {t['BRAND_600']};
}}

/* ============ Glass Panels ============ */
QFrame[card="true"] {{
    background: {t['CARD']};
    border: 1.5px solid {t['GLASS_BORDER']};
    border-radius: 14px;
}}
QFrame[glassStrong="true"] {{
    background: {t['GLASS_STRONG']};
    border: 1.5px solid {t['GLASS_BORDER']};
    border-radius: 14px;
}}
QLabel[statValue="true"] {{
    font-size: 25px; font-weight: 800; color: {t['PRIMARY']};
    background: transparent;
}}
QLabel[statLabel="true"] {{ font-size: 12px; color: {t['MUTED']}; background: transparent; }}
QLabel[statIcon="true"] {{ font-size: 26px; background: transparent; }}
QLabel[pageTitle="true"] {{
    font-size: 19px; font-weight: 800; color: {t['PRIMARY']}; background: transparent;
}}
QLabel[pageDesc="true"] {{ font-size: 11.5px; color: {t['MUTED']}; background: transparent; }}
QLabel[sectionTitle="true"] {{
    font-size: 13.5px; font-weight: 700; color: {t['PRIMARY']}; background: transparent;
}}
QLabel[hint="true"] {{ color: {t['MUTED']}; font-size: 12px; background: transparent; }}
QLabel {{ background: transparent; }}

/* ============ الأزرار · أربعة مستويات ============ */
QPushButton {{
    background: {t['SURFACE']}; color: {t['TEXT_900']};
    border: 1.5px solid {t['BORDER_STRONG']};
    border-radius: 8px;
    padding: 8px 14px; font-weight: 700; font-size: 13px;
}}
QPushButton:hover {{
    border-color: {t['BRAND_600']}; color: {t['BRAND_600']};
    background: {t['BRAND_50']};
}}
QPushButton:pressed {{ background: {t['BRAND_100']}; }}
QPushButton:focus {{
    border: 2px solid {t['BRAND_600']}; padding: 7px 13px;
}}
QPushButton:disabled {{
    background: {t['SURFACE_2']}; color: {t['TEXT_400']};
    border-color: {t['BORDER']};
}}

QPushButton#btnPrimary {{
    background: {t['BRAND_600']}; color: #FFFFFF;
    border: 1.5px solid {t['BRAND_600']};
}}
QPushButton#btnPrimary:hover {{
    background: {t['BRAND_700']}; border-color: {t['BRAND_700']};
    color: #FFFFFF;
}}
QPushButton#btnPrimary:pressed {{ background: {t['BRAND_900']}; }}
QPushButton#btnPrimary:focus {{
    border: 2px solid {t['BRAND_900']}; padding: 7px 13px;
}}
QPushButton#btnPrimary:disabled {{
    background: {t['SURFACE_2']}; color: {t['TEXT_400']};
    border-color: {t['BORDER']};
}}

QPushButton#btnReceipt {{
    background: {t['SUCCESS_600']}; color: #FFFFFF;
    border: 1.5px solid {t['SUCCESS_600']};
}}
QPushButton#btnReceipt:hover {{
    background: {t['SUCCESS_700']}; border-color: {t['SUCCESS_700']};
    color: #FFFFFF;
}}
QPushButton#btnReceipt:pressed {{ background: {t['SUCCESS_700']}; }}
QPushButton#btnReceipt:focus {{
    border: 2px solid {t['SUCCESS_700']}; padding: 7px 13px;
}}
QPushButton#btnReceipt:disabled {{
    background: {t['SURFACE_2']}; color: {t['TEXT_400']};
    border-color: {t['BORDER']};
}}

QPushButton#btnDangerSoft {{
    background: {t['SURFACE']}; color: {t['DANGER_600']};
    border: 1.5px solid #F3C1C1;
}}
QPushButton#btnDangerSoft:hover {{
    background: rgba(220,38,38,0.07); color: {t['DANGER_700']};
    border-color: {t['DANGER_600']};
}}
QPushButton#btnDangerSoft:pressed {{ background: rgba(220,38,38,0.14); }}
QPushButton#btnDangerSoft:focus {{
    border: 2px solid {t['DANGER_600']}; padding: 7px 13px;
}}
QPushButton#btnDangerSoft:disabled {{
    background: {t['SURFACE_2']}; color: {t['TEXT_400']};
    border-color: {t['BORDER']};
}}

QPushButton#btnDangerGhost {{
    background: transparent; color: {t['DANGER_600']};
    border: 1px solid transparent; font-weight: 900; font-size: 16px;
}}
QPushButton#btnDangerGhost:hover {{
    background: rgba(220,38,38,0.08); color: {t['DANGER_700']};
    border-color: {t['DANGER_600']};
}}
QPushButton#btnDangerGhost:pressed {{
    background: rgba(220,38,38,0.15);
}}

QPushButton[compact="true"] {{
    padding: 7px 9px;
    font-size: 12px;
    border-radius: 8px;
}}

QPushButton#userBadge {{
    font-weight: 700;
    padding: 8px 14px;
    background: rgba(59,130,246,0.10);
    border: 1.5px solid rgba(59,130,246,0.35);
    border-radius: 12px;
    color: {TEXT_STRONG};
}}
QPushButton#userBadge:hover {{ background: rgba(59,130,246,0.20); }}

QPushButton#btnGhost {{
    background: transparent; color: {t['TEXT_600']};
    border: 1.5px solid transparent;
}}
QPushButton#btnGhost:hover {{
    background: {t['SURFACE_2']}; color: {t['TEXT_900']};
}}
QPushButton#btnGhost:pressed {{ background: {t['BRAND_50']}; }}
QPushButton#btnGhost:focus {{
    border: 2px solid {t['BRAND_600']}; padding: 7px 13px;
}}
QPushButton#btnGhost:disabled {{ color: {t['TEXT_400']}; }}

QPushButton[flat="true"] {{
    background: {t['SURFACE']}; color: {t['TEXT_600']};
    border: 1.5px solid {t['BORDER_STRONG']};
}}
QPushButton[flat="true"]:hover {{
    background: {t['BRAND_50']}; color: {t['BRAND_600']};
    border-color: {t['BRAND_600']};
}}
QPushButton[danger="true"] {{
    background: {t['SURFACE']}; color: {t['DANGER_600']};
    border: 1.5px solid #F3C1C1;
}}
QPushButton[danger="true"]:hover {{
    background: rgba(220,38,38,0.07); color: {t['DANGER_700']};
    border-color: {t['DANGER_600']};
}}
QPushButton[success="true"] {{
    background: {t['SUCCESS_600']}; color: #FFFFFF;
    border: 1.5px solid {t['SUCCESS_600']};
}}
QPushButton[success="true"]:hover {{
    background: {t['SUCCESS_700']}; border-color: {t['SUCCESS_700']};
    color: #FFFFFF;
}}

QPushButton#iconBtn {{
    padding: 8px 8px; min-width: 28px; font-size: 15px;
}}

/* ============ الشريط العلوي المثبّت ============ */
QWidget#topBar {{ background: transparent; }}
QPushButton#bellBtn {{
    background: transparent; color: {t['TEXT_600']};
    border: 1.5px solid transparent; border-radius: 12px;
    padding: 6px 10px; min-width: 34px; font-size: 15px; font-weight: 700;
}}
QPushButton#bellBtn:hover {{
    background: {t['SURFACE_2']}; border-color: {t['BORDER']};
    color: {t['TEXT_900']};
}}
QPushButton#bellBtn[unread="true"] {{
    background: {t['BTN_DANGER_BG']}; color: {t['BTN_DANGER_TEXT']};
    border: 1.5px solid {t['BTN_DANGER_BORDER']}; font-weight: 800;
}}
QPushButton#bellBtn[unread="true"]:hover {{
    background: {t['BTN_DANGER_HOVER']};
}}

/* ============ شرائح الفلترة ============ */
QPushButton#filterChip {{
    background: {t['SURFACE_2']}; color: {t['TEXT_600']};
    border: 1px solid {t['BORDER']}; border-radius: 14px;
    padding: 7px 16px; font-size: 12.5px; font-weight: 600;
}}
QPushButton#filterChip:hover {{
    background: {t['BRAND_50']}; color: {t['TEXT_900']};
    border-color: {t['BORDER_STRONG']};
}}
QPushButton#filterChip:checked {{
    background: {t['BRAND_100']}; color: {t['BRAND_600']};
    border: 1.5px solid {t['BRAND_600']}; font-weight: 800;
}}
QPushButton#filterChip:focus {{ border: 1.5px solid {t['BRAND_600']}; }}

/* ============ تبويبات الصفحات (PageNav) ============ */
QPushButton#pageTab {{
    background: transparent; color: {t['TEXT_600']};
    border: 1px solid transparent; border-radius: 8px;
    padding: 6px 13px; font-size: 12.5px; font-weight: 600;
}}
QPushButton#pageTab:hover {{
    color: {t['TEXT_900']}; background: {t['SURFACE']};
}}
QPushButton#pageTab:checked {{
    background: {t['SURFACE']}; color: {t['BRAND_600']};
    border: 1px solid {t['BORDER']}; font-weight: 800;
}}
QPushButton#pageTab:focus {{ border: 1.5px solid {t['BRAND_600']}; }}
QPushButton#pageTab:disabled {{ color: {t['TEXT_400']}; }}

/* ============ الحقول: Floating Glass ============ */
QLineEdit, QTextEdit, QComboBox, QDoubleSpinBox, QSpinBox, QDateEdit {{
    background: {t['INPUT_BG']};
    border: 1.5px solid {t['INPUT_BORDER']};
    border-radius: 9px; padding: 6px 11px; min-height: 19px;
    selection-background-color: {t['ACCENT']}; color: {t['TEXT']};
}}
QLineEdit:hover, QComboBox:hover, QDateEdit:hover {{
    border-color: {t['INPUT_FOCUS_BORDER']};
}}
QLineEdit:focus, QTextEdit:focus, QComboBox:focus,
QDoubleSpinBox:focus, QSpinBox:focus, QDateEdit:focus {{
    border: 2px solid {t['INPUT_FOCUS_BORDER']};
    background: {t['INPUT_FOCUS_BG']};
    padding: 5px 10px;
}}
QComboBox::drop-down {{ border: none; width: 30px; }}
QComboBox {{ combobox-popup: 0; }}
QComboBox QAbstractItemView {{
    background: {t['POPUP_BG']};
    border: 1.5px solid {t['POPUP_BORDER']}; border-radius: 12px;
    selection-background-color: {t['TBL_SELECT']};
    selection-color: {t['TBL_SELECT_TEXT']};
    padding: 6px; color: {t['TEXT']};
    outline: none;
}}
QComboBox QAbstractItemView::item {{
    min-height: 34px; padding: 4px 14px; border-radius: 8px;
    color: {t['TEXT']};
}}
QComboBox QAbstractItemView::item:hover {{
    background: {t['NAV_HOVER']};
}}
QComboBox QAbstractItemView::item:selected {{
    background: {t['TBL_SELECT']}; color: {t['TBL_SELECT_TEXT']};
}}

/* ============ الجداول: Modern Glass Data Table ============ */
QTableWidget, QTableView {{
    background: {t['TBL_BG']};
    border: 1.5px solid {t['GLASS_BORDER']};
    border-radius: 12px;
    gridline-color: {t['TBL_GRID']};
    alternate-background-color: {t['TBL_ALT']};
    color: {t['TEXT']};
}}
QTableWidget::item, QTableView::item {{
    padding: 6px 7px; border: none;
    border-bottom: 1px solid {t['TBL_GRID']};
}}
QTableWidget::item:hover, QTableView::item:hover {{ background: {t['BRAND_50']}; }}
QTableWidget::item:selected, QTableView::item:selected {{
    background: {t['TBL_SELECT']};
    color: {t['TBL_SELECT_TEXT']};
}}
QHeaderView {{ background: transparent; }}
QHeaderView::section {{
    background: {t['TBL_HEADER']};
    color: {t['TBL_HEADER_TEXT']};
    padding: 8px 8px; border: none;
    border-bottom: 1.5px solid {t['BORDER']};
    font-weight: 700; font-size: 12px;
}}
QHeaderView::section:first {{ border-top-right-radius: 15px; }}
QHeaderView::section:last {{ border-top-left-radius: 15px; }}
QTableCornerButton::section {{ background: transparent; border: none; }}

QTreeWidget::item:hover {{ background: {t['BRAND_50']}; }}

/* ============ تحصين مضاد للسواد (ويندوز الداكن) ============
   عناصر كانت بلا ستايل صريح فترتد للون النظام عند تفعيل الوضع
   الداكن في ويندوز — كلها تُلزم بلوحة النظام الفاتحة. */
QScrollBar:vertical, QScrollBar:horizontal {{
    background: {t['SURFACE_2']}; border: none; border-radius: 6px;
}}
QScrollBar::handle:vertical, QScrollBar::handle:horizontal {{
    background: {t['BORDER_STRONG']}; border-radius: 4px; min-height: 24px;
    min-width: 24px;
}}
QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover {{
    background: {t['MUTED']};
}}
QScrollBar::add-line, QScrollBar::sub-line, QScrollBar::add-page,
QScrollBar::sub-page {{ background: transparent; border: none; height: 0;
    width: 0; }}

QSpinBox, QDoubleSpinBox {{
    background: {t['FIELD_BG']}; color: {t['TEXT']};
    border: 1.5px solid {t['BORDER_STRONG']}; border-radius: 9px;
    padding: 6px 10px; selection-background-color: {t['TBL_SELECT']};
}}
QSpinBox::up-button, QSpinBox::down-button,
QDoubleSpinBox::up-button, QDoubleSpinBox::down-button {{
    background: {t['SURFACE_2']}; border: none; width: 18px;
}}
QSpinBox::up-arrow, QDoubleSpinBox::up-arrow {{
    border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-bottom: 5px solid {t['MUTED']}; width: 0; height: 0;
}}
QSpinBox::down-arrow, QDoubleSpinBox::down-arrow {{
    border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-top: 5px solid {t['MUTED']}; width: 0; height: 0;
}}

QCheckBox, QRadioButton {{ background: transparent; color: {t['TEXT']}; }}
QCheckBox::indicator, QRadioButton::indicator {{
    background: {t['POPUP_BG']}; border: 1.5px solid {t['BORDER_STRONG']};
}}
QCheckBox::indicator {{ width: 15px; height: 15px; border-radius: 4px; }}
QRadioButton::indicator {{ width: 15px; height: 15px; border-radius: 8px; }}
QCheckBox::indicator:checked, QRadioButton::indicator:checked {{
    background: {t['BRAND_600']}; border-color: {t['BRAND_600']};
}}
QCheckBox::indicator:hover, QRadioButton::indicator:hover {{
    border-color: {t['BRAND_600']};
}}
#scopeTree::indicator:unchecked {{
    background: {t['POPUP_BG']}; border: 1.5px solid {t['BORDER_STRONG']};
    width: 15px; height: 15px; border-radius: 4px;
}}
#scopeTree::indicator:checked {{
    background: {t['BRAND_600']}; border: 1.5px solid {t['BRAND_600']};
    width: 15px; height: 15px; border-radius: 4px;
}}
#scopeTree::indicator:indeterminate {{
    background: {t['POPUP_BG']}; border: 2px solid {t['BRAND_600']};
    width: 15px; height: 15px; border-radius: 4px;
}}

QProgressBar {{
    background: {t['SURFACE_2']}; border: 1.5px solid {t['BORDER']};
    border-radius: 8px; text-align: center; color: {t['TEXT']};
}}
QProgressBar::chunk {{
    background: {t['BRAND_600']}; border-radius: 7px;
}}

QStatusBar {{ background: {t['SURFACE_2']}; color: {t['MUTED']}; }}

QSlider::groove:horizontal {{ background: {t['SURFACE_2']}; height: 6px;
    border-radius: 3px; }}
QSlider::handle:horizontal {{ background: {t['BRAND_600']}; width: 14px;
    border-radius: 7px; margin: -5px 0; }}
QSlider::sub-page:horizontal {{ background: {t['BRAND_100']};
    border-radius: 3px; }}

QTabWidget::pane {{ background: {t['SURFACE']}; border: 1.5px solid
    {t['BORDER']}; border-radius: 10px; }}
QTabBar::tab {{ background: {t['SURFACE_2']}; color: {t['MUTED']};
    padding: 7px 16px; border: 1.5px solid {t['BORDER']};
    border-bottom: none; }}
QTabBar::tab:selected {{ background: {t['SURFACE']}; color: {t['BRAND_600']};
    font-weight: 700; }}

QTreeWidget, QTreeView {{ background: {t['SURFACE']}; color: {t['TEXT']};
    border: 1.5px solid {t['BORDER']}; border-radius: 12px; }}
QListWidget {{ background: {t['SURFACE']}; color: {t['TEXT']};
    border: 1.5px solid {t['BORDER']}; border-radius: 12px; }}
QPlainTextEdit {{ background: {t['FIELD_BG']}; color: {t['TEXT']};
    border: 1.5px solid {t['BORDER_STRONG']}; border-radius: 9px; }}
QTreeWidget::item:selected {{
    background: {t['BRAND_100']}; color: {t['TEXT_900']};
}}

/* ============ القوائم ============ */
QListWidget {{
    background: {t['TBL_BG']};
    border: 1.5px solid {t['GLASS_BORDER']}; border-radius: 12px; padding: 6px;
}}
QListWidget::item {{ padding: 10px 12px; border-radius: 10px; margin: 2px; }}
QListWidget::item:hover {{ background: {t['BRAND_50']}; }}
QListWidget::item:selected {{
    background: {t['BRAND_100']}; color: {t['TEXT_900']};
}}

/* ============ التبويبات ============ */
QTabWidget::pane {{ border: none; background: transparent; top: 12px; }}
QTabBar::tab {{
    background: {t['TAB_BG']}; color: {t['TAB_TEXT']};
    border: 1.5px solid {t['GLASS_EDGE']};
    padding: 7px 15px; border-radius: 10px; margin-left: 6px;
    font-weight: 700; font-size: 12.5px;
}}
QTabBar::tab:hover {{ background: {t['TAB_HOVER']}; }}
QTabBar::tab:selected {{
    background: {t['NAV_ACTIVE']};
    border: 1.5px solid {t['NAV_ACTIVE_BORDER']};
    color: {t['NAV_ACTIVE_TEXT']};
}}

/* ============ Scrollbars ============ */
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 3px; }}
QScrollBar::handle:vertical {{
    background: {t['SCROLL']}; border-radius: 5px; min-height: 32px;
}}
QScrollBar::handle:vertical:hover {{ background: {t['SCROLL_HOVER']}; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 3px; }}
QScrollBar::handle:horizontal {{
    background: {t['SCROLL']}; border-radius: 5px; min-width: 32px;
}}

QGroupBox {{
    border: 1.5px solid {t['GLASS_BORDER']}; border-radius: 12px;
    margin-top: 13px; background: {t['CARD']};
    padding-top: 8px; font-weight: 700; color: {t['PRIMARY']};
}}
QGroupBox::title {{ subcontrol-origin: margin; right: 14px; padding: 0 6px; }}

QCheckBox {{ spacing: 8px; font-weight: 600; background: transparent; }}
QCheckBox::indicator {{
    width: 20px; height: 20px; border-radius: 7px;
    border: 2px solid {t['INPUT_BORDER']}; background: {t['INPUT_BG']};
}}
QCheckBox::indicator:checked {{
    background: {t['ACCENT']}; border-color: {t['ACCENT']};
}}
#scopeTree::indicator:unchecked {{
    border: 2px solid {t['INPUT_BORDER']}; background: {t['INPUT_BG']};
    width: 20px; height: 20px; border-radius: 7px;
}}
#scopeTree::indicator:checked {{
    background: {t['ACCENT']}; border: 2px solid {t['ACCENT']};
    width: 20px; height: 20px; border-radius: 7px;
}}
#scopeTree::indicator:indeterminate {{
    background: {t['INPUT_BG']}; border: 3px solid {t['ACCENT']};
    width: 20px; height: 20px; border-radius: 7px;
}}

QMessageBox {{ background: {t['BG']}; }}
QMenu {{
    background: {t['POPUP_BG']}; color: {t['TEXT']};
    border: 1.5px solid {t['POPUP_BORDER']}; border-radius: 12px; padding: 6px;
}}
QMenu::item {{ padding: 8px 24px; border-radius: 8px; }}
QMenu::item:selected {{ background: {t['TBL_SELECT']}; color: {t['TBL_SELECT_TEXT']}; }}
QToolTip {{
    background-color: #FFFFFF;
    color: #0F172A;
    border: 1px solid #CBD5E1;
    border-radius: 8px;
    padding: 7px 9px;
    opacity: 245;
}}

/* ============ كل نافذة منبثقة / قائمة عائمة ============ */
QListView#completerPopup::item {{
    min-height: 34px; padding: 4px 14px; border-radius: 8px;
}}
QListView#completerPopup::item:hover {{ background: {t['NAV_HOVER']}; }}
QListWidget#completerPopup::item {{
    min-height: 34px; padding: 4px 14px; border-radius: 8px;
}}
QListWidget#completerPopup::item:hover {{ background: {t['NAV_HOVER']}; }}
QListWidget#completerPopup::item:selected {{ background: {t['TBL_SELECT']}; color: {t['TBL_SELECT_TEXT']}; }}
QComboBox QListView, QCompleter QAbstractItemView, QListView#completerPopup, QListWidget#completerPopup {{
    background: {t['POPUP_BG']}; color: {t['TEXT']};
    border: 1.5px solid {t['POPUP_BORDER']}; border-radius: 12px; padding: 4px;
    selection-background-color: {t['TBL_SELECT']};
    selection-color: {t['TBL_SELECT_TEXT']};
}}

/* ============ ✅ إصلاح التقويم: إزالة الخلفية السوداء والهوفر الأسود ============ */
QCalendarWidget {{
    background: {t['POPUP_BG']};
    color: {t['TEXT']};
    border: 1.5px solid {t['POPUP_BORDER']};
    border-radius: 12px;
    font-family: {FONT_FAMILY};
}}
QCalendarWidget QWidget#qt_calendar_navigationbar {{
    background: {t['SURFACE_2']};
    border-bottom: 1px solid {t['BORDER']};
    padding: 6px;
}}
QCalendarWidget QToolButton {{
    background: transparent;
    color: {t['TEXT']};
    border: none;
    padding: 4px 10px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 13px;
}}
QCalendarWidget QToolButton:hover {{
    background: {t['BRAND_50']};
    color: {t['BRAND_600']};
}}
QCalendarWidget QMenu {{
    background: {t['POPUP_BG']};
    color: {t['TEXT']};
    border: 1.5px solid {t['POPUP_BORDER']};
    border-radius: 8px;
}}
QCalendarWidget QMenu::item {{
    padding: 6px 20px;
    border-radius: 6px;
}}
QCalendarWidget QMenu::item:selected {{
    background: {t['TBL_SELECT']};
    color: {t['TBL_SELECT_TEXT']};
}}
QCalendarWidget QTableView {{
    background: {t['POPUP_BG']};
    color: {t['TEXT']};
    alternate-background-color: {t['TBL_ALT']};
    gridline-color: {t['TBL_GRID']};
    border: none;
}}
QCalendarWidget QHeaderView {{
    background: {t['SURFACE_2']};
    color: {t['TEXT_600']};
    border: none;
    border-bottom: 1px solid {t['BORDER']};
    font-weight: 700;
    font-size: 12px;
}}
QCalendarWidget QHeaderView::section {{
    background: {t['SURFACE_2']};
    color: {t['TEXT_600']};
    border: none;
    border-bottom: 1px solid {t['BORDER']};
    padding: 8px 4px;
    font-weight: 700;
}}
QCalendarWidget QAbstractItemView {{
    background: {t['POPUP_BG']};
    color: {t['TEXT']};
    selection-background-color: {t['ACCENT']};
    selection-color: #FFFFFF;
    outline: none;
}}
QCalendarWidget QAbstractItemView::item {{
    background: transparent;
    color: {t['TEXT']};
    padding: 4px;
    border-radius: 6px;
}}
QCalendarWidget QAbstractItemView::item:hover {{
    background: {t['BRAND_50']};
    color: {t['TEXT_900']};
}}
QCalendarWidget QAbstractItemView::item:selected {{
    background: {t['ACCENT']};
    color: #FFFFFF;
    font-weight: 700;
}}
QCalendarWidget QAbstractItemView::item:disabled {{
    color: {t['TEXT_400']};
}}
QCalendarWidget QSpinBox {{
    background: {t['FIELD_BG']};
    color: {t['TEXT']};
    border: 1.5px solid {t['INPUT_BORDER']};
    border-radius: 8px;
    padding: 4px 8px;
}}

/* ============ ✅ إصلاح الصفحة الرئيسية: إزالة الهوفر الأسود ============ */
QFrame[statCard="true"] {{
    background: {t['CARD']};
    border: 1.5px solid {t['GLASS_BORDER']};
    border-radius: 12px;
}}
QFrame[statCard="true"]:hover {{
    background: {t['GLASS_HOVER']};
    border-color: {t['BRAND_600']};
}}
QListWidget#activityList::item {{
    background: transparent;
    color: {t['TEXT']};
    padding: 10px 14px;
    border-radius: 10px;
    margin: 3px;
}}
QListWidget#activityList::item:hover {{
    background: {t['BRAND_50']};
    color: {t['TEXT_900']};
}}
QListWidget#activityList::item:selected {{
    background: {t['BRAND_100']};
    color: {t['TEXT_900']};
}}
QTableWidget#activityTable::item:hover {{
    background: {t['BRAND_50']};
    color: {t['TEXT_900']};
}}
QTableWidget#activityTable::item:selected {{
    background: {t['BRAND_100']};
    color: {t['TEXT_900']};
}}
QPushButton[activity="true"] {{
    background: transparent;
    color: {t['TEXT']};
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    text-align: right;
}}
QPushButton[activity="true"]:hover {{
    background: {t['BRAND_50']};
    color: {t['TEXT_900']};
}}
QPushButton#quickAction {{
    background: {t['SURFACE']};
    color: {t['TEXT']};
    border: 1.5px solid {t['BORDER']};
    border-radius: 10px;
    padding: 10px 16px;
    font-weight: 700;
    font-size: 13px;
}}
QPushButton#quickAction:hover {{
    background: {t['BRAND_50']};
    border-color: {t['BRAND_600']};
    color: {t['BRAND_600']};
}}
QPushButton#quickAction:pressed {{
    background: {t['BRAND_100']};
}}

QDialogButtonBox QPushButton {{ min-width: 84px; }}
QInputDialog, QColorDialog, QProgressDialog, QFontDialog {{
    background: {t['AMBIENT_BASE1']}; color: {t['TEXT']};
}}
""" + pilot_styles(t) + shared_styles(t) + "")


def shared_styles(t: dict) -> str:
    """أنماط الدفعة 2 (الهيكل المشترك): مسار التنقل + تمركز أزرار الطي.

    مقيدة بالخصائص: QLabel[breadcrumb] و QFrame#sidebar[collapsed] —
    لا أثر خارج الشريط العلوي والشريط الجانبي المطوي.
    """
    return """
/* ===== الدفعة 2: مسار التنقل + الشريط المطوي ===== */
QLabel[breadcrumb="true"] {
    font-size: 12.5px; color: %s;
    background: transparent; padding: 2px 6px;
}
QFrame#sidebar[collapsed="true"] QPushButton {
    text-align: center; padding-left: 2px; padding-right: 2px;
}
/* زر الطي 30px: الحشوة العامة (14px) كانت تصفّر مستطيل النص */
QPushButton#sidebarToggle {
    padding: 0; font-size: 14px;
}
""" % (t["MUTED"],)


def pilot_styles(t: dict) -> str:
    """أنماط الدفعة التجريبية (إعادة التصميم): مفعّلة بالخصائص فقط.

    كل قاعدة هنا مقيدة بخاصية ([...]) تُضبط على شاشات الدفعة حصرًا،
    فلا يتغير بكسل واحد خارجها. التباين محسوب: PRIMARY ≈ 14:1 —
    فوق بوابة 4.5:1. (وصف الصفحة يعيد استخدام QLabel[pageDesc] القائم.)
    """
    return """
/* ===== الدفعة التجريبية 1: الرئيسية/العملاء/سند قبض (نطاق اختياري) ===== */
QLabel[pilotSection="true"] {
    font-size: 13px; font-weight: 800; color: %s;
    background: transparent; padding-bottom: 4px; margin-top: 6px;
    border-bottom: 1.5px solid %s;
}
QFrame[metricCard="true"] {
    background: %s; border: 1.5px solid %s;
    border-top: 3px solid %s; border-radius: 14px;
}
""" % (t["PRIMARY"], t["BORDER"], t["CARD"], t["GLASS_BORDER"],
       t["BRAND_600"])


def apply_palette(theme_key: str = THEME_KEY) -> None:
    """فرض لوحة ألوان النظام على كل التطبيق."""
    from PySide6.QtGui import QColor, QPalette
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance()
    if app is None:
        return
    t = THEMES["light"]
    current = app.palette()
    if (current.color(QPalette.Window).name().lower()
            == t["AMBIENT_BASE1"].lower()
            and current.color(QPalette.WindowText).name().lower()
            == t["TEXT"].lower()
            and current.color(QPalette.Base).name().lower()
            == t["POPUP_BG"].lower()):
        return
    pal = QPalette()
    text = QColor(t["TEXT"])
    window = QColor(t["AMBIENT_BASE1"])
    base = QColor(t["POPUP_BG"])
    pal.setColor(QPalette.Window, window)
    pal.setColor(QPalette.WindowText, text)
    pal.setColor(QPalette.Base, base)
    pal.setColor(QPalette.AlternateBase, QColor(t.get("SURFACE_2",
                                                      t["SURFACE"])))
    pal.setColor(QPalette.Text, text)
    pal.setColor(QPalette.Button, QColor(t["SURFACE"]))
    pal.setColor(QPalette.ButtonText, text)
    # إجبار ToolTips على اللون الفاتح في كل حالات الـPalette؛
    # بعض أجهزة ويندوز ذات الوضع الداكن تتجاهل مجموعة Active فقط
    # فتظهر نافذة تلميح سوداء رغم ثيم البرنامج.
    tip_base = QColor("#FFFFFF")
    tip_text = QColor("#0F172A")
    for _grp in (QPalette.Active, QPalette.Inactive, QPalette.Disabled):
        pal.setColor(_grp, QPalette.ToolTipBase, tip_base)
        pal.setColor(_grp, QPalette.ToolTipText, tip_text)
    pal.setColor(QPalette.PlaceholderText, QColor(t["MUTED"]))
    pal.setColor(QPalette.Highlight, QColor(t.get("BRAND_600", t["ACCENT"])))
    pal.setColor(QPalette.HighlightedText, QColor("#FFFFFF"))
    pal.setColor(QPalette.Link, QColor(t.get("BRAND_600", t["ACCENT"])))
    pal.setColor(QPalette.Disabled, QPalette.Text, QColor(t["MUTED"]))
    pal.setColor(QPalette.Disabled, QPalette.ButtonText, QColor(t["MUTED"]))
    pal.setColor(QPalette.Disabled, QPalette.WindowText, QColor(t["MUTED"]))
    app.setPalette(pal)


def force_light_scheme() -> None:
    """إجبار Qt على وضع الألوان الفاتح مهما كان إعداد ويندوز."""
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QGuiApplication
    try:
        hints = QGuiApplication.styleHints()
        if hints is not None and hasattr(hints, "setColorScheme"):
            hints.setColorScheme(Qt.ColorScheme.Light)
    except Exception:
        pass



def force_tooltip_palette(app=None) -> None:
    """يثبت ألوان التلميحات Hover ToolTips على الأبيض/النص الداكن.

    يعالج ظهور التلميحات بخلفية سوداء على بعض نسخ ويندوز/PySide عند
    تمرير الماوس فوق بيانات الجداول أو البطاقات.
    """
    try:
        from PySide6.QtGui import QPalette, QColor
        from PySide6.QtWidgets import QApplication, QToolTip
        app = app or QApplication.instance()
        base = QColor("#FFFFFF")
        text = QColor("#0F172A")
        pal = QToolTip.palette()
        for grp in (QPalette.Active, QPalette.Inactive, QPalette.Disabled):
            pal.setColor(grp, QPalette.ToolTipBase, base)
            pal.setColor(grp, QPalette.ToolTipText, text)
        QToolTip.setPalette(pal)
        if app is not None:
            app_pal = app.palette()
            for grp in (QPalette.Active, QPalette.Inactive, QPalette.Disabled):
                app_pal.setColor(grp, QPalette.ToolTipBase, base)
                app_pal.setColor(grp, QPalette.ToolTipText, text)
            app.setPalette(app_pal)
    except Exception:
        pass

def ensure_light_background(widget, fill: bool = True) -> None:
    """ضمان خلفية النظام الفاتحة لأي نافذة."""
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QColor, QPalette
    t = THEMES["light"]
    try:
        if fill:
            widget.setAttribute(Qt.WA_StyledBackground, True)
            widget.setAutoFillBackground(True)
        pal = widget.palette()
        pal.setColor(QPalette.Window, QColor(t["AMBIENT_BASE1"]))
        pal.setColor(QPalette.Base, QColor(t["POPUP_BG"]))
        pal.setColor(QPalette.WindowText, QColor(t["TEXT"]))
        pal.setColor(QPalette.Text, QColor(t["TEXT"]))
        pal.setColor(QPalette.ButtonText, QColor(t["TEXT"]))
        widget.setPalette(pal)
    except Exception:
        pass


def _on_color_scheme_changed(*_args) -> None:
    """يُستدعى فقط عند تغيير المستخدم لثيم ويندوز أثناء التشغيل."""
    try:
        force_light_scheme()
        apply_palette()
        force_tooltip_palette()
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance()
        if app is not None:
            app.setStyleSheet(build_stylesheet())
            for w in app.topLevelWidgets():
                ensure_light_background(w)
    except Exception:
        pass


_GUARD_INSTALLED = False


def install_light_guard(app) -> None:
    """تثبيت مظهر النظام الفاتح · بتكلفة أداء صفر."""
    global _GUARD_INSTALLED
    force_light_scheme()
    apply_palette()
    force_tooltip_palette(app)
    if _GUARD_INSTALLED:
        return
    _GUARD_INSTALLED = True
    try:
        from PySide6.QtGui import QGuiApplication
        hints = QGuiApplication.styleHints()
        if hints is not None and hasattr(hints, "colorSchemeChanged"):
            hints.colorSchemeChanged.connect(_on_color_scheme_changed)
    except Exception:
        pass


def apply_theme(theme_key: str = THEME_KEY) -> str:
    """تطبيق ثيم النظام الوحيد."""
    _load(THEME_KEY)
    apply_palette(THEME_KEY)
    force_tooltip_palette()
    return build_stylesheet(THEME_KEY)


_load("light")
APP_STYLESHEET = build_stylesheet("light")


# ============ نوافذ الرسائل الاحترافية ============
class _MessageDialog:
    """نافذة رسالة موحدة: أيقونة دائرية ملونة + عنوان + نص + أزرار أنيقة."""

    _SPECS = {
        "info":    ("ℹ",  "#3B82F6"),
        "error":   ("!",  "#EF4444"),
        "confirm": ("؟",  "#F59E0B"),
        "success": ("✓",  "#22C55E"),
    }

    @classmethod
    def show(cls, parent, text, title, kind="info",
             ok_text="موافق", cancel_text=None) -> bool:
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import (QDialog, QFrame, QHBoxLayout, QLabel,
                                       QPushButton, QVBoxLayout)
        icon_char, color = cls._SPECS.get(kind, cls._SPECS["info"])
        t = theme()

        dlg = QDialog(parent)
        dlg.setWindowTitle(title)
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setModal(True)
        dlg.setMinimumWidth(400)
        dlg.setStyleSheet(
            f"QDialog {{ background: {t['BG']}; }}")

        root = QVBoxLayout(dlg)
        root.setContentsMargins(22, 20, 22, 18)
        root.setSpacing(10)

        head = QHBoxLayout()
        head.setSpacing(12)
        icon = QLabel(icon_char)
        icon.setFixedSize(46, 46)
        icon.setAlignment(Qt.AlignCenter)
        icon.setStyleSheet(
            f"background: {color}; color: white; border-radius: 23px;"
            "font-size: 22px; font-weight: 900;")
        title_lbl = QLabel(title)
        title_lbl.setStyleSheet(
            f"font-size: 17px; font-weight: 800; color: {t['PRIMARY']};"
            "background: transparent;")
        head.addWidget(icon)
        head.addWidget(title_lbl, 1)
        root.addLayout(head)

        body = QFrame()
        body.setStyleSheet(
            f"QFrame {{ background: {t['CARD']};"
            f" border: 1.5px solid {t['GLASS_BORDER']};"
            " border-radius: 12px; }")
        body_l = QVBoxLayout(body)
        body_l.setContentsMargins(16, 12, 16, 12)
        msg = QLabel(text)
        msg.setWordWrap(True)
        msg.setTextInteractionFlags(Qt.TextSelectableByMouse)
        msg.setStyleSheet(
            f"font-size: 14px; color: {t['TEXT']}; background: transparent;"
            "border: none; line-height: 1.6;")
        body_l.addWidget(msg)
        root.addWidget(body)

        btns = QHBoxLayout()
        btns.setSpacing(8)
        btns.addStretch()
        result = {"ok": False}

        ok_btn = QPushButton(ok_text)
        ok_btn.setMinimumWidth(110)
        ok_btn.setMinimumHeight(38)
        ok_btn.setCursor(Qt.PointingHandCursor)
        ok_btn.setObjectName({"error": "btnDangerSoft",
                              "confirm": "btnPrimary",
                              "success": "btnReceipt"}.get(kind,
                                                           "btnPrimary"))

        def _accept():
            result["ok"] = True
            dlg.accept()
        ok_btn.clicked.connect(_accept)
        btns.addWidget(ok_btn)

        if cancel_text:
            cancel_btn = QPushButton(cancel_text)
            cancel_btn.setObjectName("btnGhost")
            cancel_btn.setMinimumWidth(100)
            cancel_btn.setMinimumHeight(38)
            cancel_btn.setCursor(Qt.PointingHandCursor)
            cancel_btn.clicked.connect(dlg.reject)
            btns.addWidget(cancel_btn)
            cancel_btn.setDefault(True)
        else:
            ok_btn.setDefault(True)
        root.addLayout(btns)

        try:
            from PySide6.QtCore import QPropertyAnimation, QEasingCurve
            dlg.setWindowOpacity(0.0)
            anim = QPropertyAnimation(dlg, b"windowOpacity", dlg)
            anim.setDuration(160)
            anim.setStartValue(0.0)
            anim.setEndValue(1.0)
            anim.setEasingCurve(QEasingCurve.OutCubic)
            anim.start()
        except Exception:
            dlg.setWindowOpacity(1.0)

        dlg.exec()
        return result["ok"]


def info(parent: QWidget, text: str, title: str = "تنبيه") -> None:
    _MessageDialog.show(parent, text, title, kind="info")


def error(parent: QWidget, text: str, title: str = "خطأ") -> None:
    _MessageDialog.show(parent, text, title, kind="error")


def success(parent: QWidget, text: str, title: str = "تم بنجاح") -> None:
    _MessageDialog.show(parent, text, title, kind="success")


def confirm(parent: QWidget, text: str, title: str = "تأكيد") -> bool:
    return _MessageDialog.show(parent, text, title, kind="confirm",
                               ok_text="نعم", cancel_text="إلغاء")


def require_admin(parent: QWidget, action_name: str = "هذه العملية",
                  perm: str = "") -> bool:
    """بوابة صلاحية المدير."""
    from services import auth_service
    if perm and auth_service.has_permission(perm):
        return True
    if auth_service.is_admin():
        return True
    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import (QDialog, QFormLayout, QHBoxLayout, QLabel,
                                   QLineEdit, QPushButton)
    t = theme()
    dlg = QDialog(parent)
    dlg.setWindowTitle("صلاحية المدير مطلوبة")
    dlg.setLayoutDirection(Qt.RightToLeft)
    dlg.setMinimumWidth(380)
    form = QFormLayout(dlg)
    form.setSpacing(10)
    msg = QLabel(f" {action_name} تتطلب صلاحية المدير.\n"
                 "اطلب من المدير إدخال كلمة مروره للموافقة "
                 "على هذه العملية فقط:")
    msg.setWordWrap(True)
    msg.setStyleSheet("font-weight: 700;")
    form.addRow(msg)
    pwd = QLineEdit()
    pwd.setEchoMode(QLineEdit.Password)
    pwd.setPlaceholderText("كلمة مرور المدير...")
    form.addRow("كلمة المرور", pwd)
    err = QLabel("")
    err.setStyleSheet(f"color: {t['RED']}; font-weight: 700;")
    form.addRow(err)
    result = {"ok": False}
    btns = QHBoxLayout()
    ok_btn = QPushButton("✔ موافقة")
    ok_btn.setObjectName("btnPrimary")
    cancel_btn = QPushButton("✕ إلغاء")
    cancel_btn.setProperty("flat", True)

    def _check():
        if auth_service.admin_override(pwd.text()):
            result["ok"] = True
            dlg.accept()
        else:
            err.setText("كلمة المرور غير صحيحة.")
            pwd.clear()
            pwd.setFocus()
    ok_btn.clicked.connect(_check)
    pwd.returnPressed.connect(_check)
    cancel_btn.clicked.connect(dlg.reject)
    btns.addStretch()
    btns.addWidget(ok_btn)
    btns.addWidget(cancel_btn)
    form.addRow(btns)
    pwd.setFocus()
    dlg.exec()
    return result["ok"]


# ============ التحجيم الديناميكي للنوافذ ============
def refit_dialog(dlg, max_h_ratio: float = 0.88, min_h: int = 0) -> None:
    """ضبط حجم النافذة على محتواها الحالي (تكبر وتصغر مع الخانات).

    تُستدعى بعد أي تغيّر ديناميكي: إضافة/حذف سطر، تبديل وضع مجمع،
    تبديل نوع الطرف، تبديل التابات. آمنة: تتجاهل المكبّرة/ملء الشاشة،
    ولا تعيد التحجيم إلا عند فرق جوهري (>18px) لمنع الارتعاش.
    """
    try:
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QFrame
        if dlg is None:
            return
        try:
            if dlg.isMaximized() or dlg.windowState() & Qt.WindowFullScreen:
                return
        except Exception:
            pass
        avail = available_geometry(dlg)
        if avail is None:
            try:
                dlg.adjustSize()
            except Exception:
                pass
            return
        try:
            hint = dlg.sizeHint().height()
            # نوافذ setup_dialog تضع المحتوى داخل QScrollArea لا يكبر
            # تلميحه مع المحتوى — نقيس التخطيط الداخلي مباشرة بدل تلميحه.
            from PySide6.QtWidgets import QScrollArea
            body = getattr(dlg, "body_layout", None)
            sc = dlg.findChild(QScrollArea)
            if body is not None and sc is not None:
                try:
                    hint = (hint - sc.sizeHint().height()
                            + body.totalSizeHint().height())
                except Exception:
                    pass
            content = dlg.findChild(QFrame)
            if content is not None:
                hint = max(hint, content.sizeHint().height() + 110)
        except Exception:
            return
        min_h = min_h or min(320, int(avail.height() * 0.55))
        target_h = min(max(int(hint), min_h), int(avail.height() * max_h_ratio))
        target_w = min(max(dlg.sizeHint().width(), dlg.minimumWidth()),
                       int(avail.width() * 0.96))
        try:
            if abs(target_h - dlg.height()) > 18 or abs(target_w - dlg.width()) > 18:
                dlg.resize(target_w, target_h)
        except RuntimeError:
            pass
    except Exception:
        pass


def guard_table_sections(root, minimum: int = 80) -> int:
    """حماية أعمدة الجداول من الانهيار: حد أدنى لعرض أي عمود.

    تُستدعى على نافذة/صفحة فتشمل كل جداولها، أو على جدول مباشرةً.
    لا تمس الجداول المضبوطة صراحةً (أي قيمة غير الافتراضي 26).
    V4.49: تتجاوز الجداول المدارة بـ apply_column_weights (لها أرضياتها
    الخاصة — فرض 80px عليها كان يُظهر تمريرًا أفقيًا).
    تُرجع عدد الجداول المحمية.
    """
    from PySide6.QtWidgets import QTableWidget
    tables = [root] if isinstance(root, QTableWidget) else list(root.findChildren(QTableWidget))
    n = 0
    for tbl in tables:
        if getattr(tbl, "_col_weights_hooked", False):
            continue
        try:
            h = tbl.horizontalHeader()
        except RuntimeError:
            continue
        try:
            if h.minimumSectionSize() <= 26:
                h.setMinimumSectionSize(minimum)
                n += 1
        except RuntimeError:
            pass
    return n


def fit_table_height(table, min_rows: int = 2, max_rows: int = 6) -> int:
    """ارتفاع الجدول بعدد سطوره (يكبر ويصغر) ضمن حدّين · بعده تمرير.

    للجداول داخل النوافذ فقط — جداول الصفحات تملأ المساحة ولا تُقيّد.
    تُرجع فرق الارتفاع (جديد − قديم) لينمو المصنع/النافذة بنفس المقدار.
    """
    try:
        n = max(min_rows, min(max_rows, int(table.rowCount())))
        try:
            row_h = int(table.verticalHeader().defaultSectionSize()) or 46
        except Exception:
            row_h = 46
        try:
            head_h = int(table.horizontalHeader().height()) or 30
        except Exception:
            head_h = 30
        new_h = head_h + n * row_h + 6
        try:
            old_h = int(table.height())
        except Exception:
            old_h = new_h
        table.setFixedHeight(new_h)
        return new_h - old_h
    except Exception:
        return 0


def body_hint(dlg) -> int:
    """الارتفاع المرغوب لمحتوى النافذة (يتتبع الإظهار/الإخفاء بدقة)."""
    try:
        body = getattr(dlg, "body_layout", None)
        if body is not None:
            return int(body.totalSizeHint().height())
    except Exception:
        pass
    try:
        return int(dlg.sizeHint().height())
    except Exception:
        return 0


def grow_dialog(dlg, dh: int, max_h_ratio: float = 0.90) -> None:
    """تكبير/تصغير النافذة بمقدار فرق المحتوى · ضمن حدّي الشاشة."""
    try:
        if dlg is None or not dh:
            return
        from PySide6.QtCore import Qt
        try:
            if dlg.isMaximized() or dlg.windowState() & Qt.WindowFullScreen:
                return
        except Exception:
            pass
        avail = available_geometry(dlg)
        max_h = int(avail.height() * max_h_ratio) if avail is not None else 10**9
        min_h = min(300, max_h)
        try:
            target = min(max(dlg.height() + int(dh), min_h), max_h)
        except Exception:
            return
        if abs(target - dlg.height()) > 6:
            dlg.resize(dlg.width(), target)
    except Exception:
        pass


# ============ إطار موحد للنوافذ المنبثقة الاحترافية ============
def setup_dialog(dlg, title: str, subtitle: str = "", icon: str = "📋",
                 color: str = "", size_ratio: float = 0.38,
                 min_w: int = 440, max_w: int = 720,
                 fullscreen: bool = False):
    """تهيئة موحدة لنافذة منبثقة.
    
    fullscreen=True يجعل الشاشة تأخذ ~90% من المساحة المتاحة.
    """
    from PySide6.QtCore import Qt, QPropertyAnimation, QEasingCurve
    from PySide6.QtWidgets import (QApplication, QFrame, QHBoxLayout, QLabel,
                                   QScrollArea, QVBoxLayout)
    t = theme()
    accent = color or t["ACCENT"]

    dlg.setWindowTitle(title)
    dlg.setLayoutDirection(Qt.RightToLeft)
    ensure_light_background(dlg)

    avail = available_geometry(dlg)
    if fullscreen and avail is not None:
        # وضع الشاشة الكاملة: 90% من العرض والارتفاع
        w = int(avail.width() * 0.90)
        h = int(avail.height() * 0.88)
        dlg.setMinimumSize(900, 600)
        dlg.resize(w, h)
    elif avail is not None:
        w = int(avail.width() * size_ratio)
        w = max(min(min_w, int(avail.width() * 0.92)), min(w, max_w))
        h_max = int(avail.height() * 0.92)
        dlg.setMinimumWidth(w)
        dlg.setMaximumHeight(h_max)
        dlg.resize(w, min(int(avail.height() * 0.72), h_max))
    else:
        dlg.setMinimumWidth(min_w)

    def _fit_to_content():
        # النوافذ الكبيرة مثل إضافة عقد تبقى بالحجم العملي الذي يحدده مستدعيها.
        if size_ratio > 0.70:
            return
        refit_dialog(dlg)
    from PySide6.QtCore import QTimer
    QTimer.singleShot(0, _fit_to_content)
    QTimer.singleShot(0, lambda: guard_table_sections(dlg))

    dlg.setStyleSheet(f"QDialog {{ background: {t['BG']}; }}")

    root = QVBoxLayout(dlg)
    root.setContentsMargins(16, 12, 16, 12)
    root.setSpacing(9)

    head = QHBoxLayout()
    head.setSpacing(12)
    icon_lbl = QLabel(icon)
    icon_lbl.setFixedSize(36, 36)
    icon_lbl.setAlignment(Qt.AlignCenter)
    icon_lbl.setStyleSheet(
        f"background: {accent}; color: white; border-radius: 18px;"
        "font-size: 17px;")
    title_col = QVBoxLayout()
    title_col.setSpacing(1)
    title_lbl = QLabel(title)
    title_lbl.setStyleSheet(
        f"font-size: 14.5px; font-weight: 800; color: {t['PRIMARY']};"
        "background: transparent;")
    title_col.addWidget(title_lbl)
    if subtitle:
        sub_lbl = QLabel(subtitle)
        sub_lbl.setStyleSheet(
            f"font-size: 11.5px; color: {t['MUTED']}; background: transparent;")
        title_col.addWidget(sub_lbl)
    head.addWidget(icon_lbl)
    head.addLayout(title_col, 1)
    root.addLayout(head)

    card = QFrame()
    card.setStyleSheet(
        f"QFrame {{ background: {t['CARD']};"
        f" border: 1.5px solid {t['GLASS_BORDER']};"
        " border-radius: 14px; }"
        "QLabel { border: none; background: transparent; }")
    card_l = QVBoxLayout(card)
    card_l.setContentsMargins(12, 10, 12, 10)
    card_l.setSpacing(8)

    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setFrameShape(QFrame.NoFrame)
    scroll.setObjectName("transparentHost")
    scroll.setWidget(card)
    root.addWidget(scroll, 1)

    dlg.body_layout = card_l
    dlg.root_layout = root

    try:
        dlg.setWindowOpacity(0.0)
        anim = QPropertyAnimation(dlg, b"windowOpacity", dlg)
        anim.setDuration(160)
        anim.setStartValue(0.0)
        anim.setEndValue(1.0)
        anim.setEasingCurve(QEasingCurve.OutCubic)
        anim.start()
    except Exception:
        dlg.setWindowOpacity(1.0)
    return card_l


def dialog_buttons(dlg, save_text: str = "حفظ", cancel_text: str = "إلغاء",
                   on_save=None, danger: bool = False):
    """شريط أزرار موحد أسفل النافذة."""
    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import QHBoxLayout, QPushButton
    btns = QHBoxLayout()
    btns.setSpacing(8)
    btns.addStretch()
    save = QPushButton(save_text)
    save.setObjectName("btnPrimary")
    save.setProperty("danger" if danger else "success", True)
    save.setProperty("compact", True)
    save.setMinimumHeight(34)
    save.setMinimumWidth(110)
    save.setCursor(Qt.PointingHandCursor)
    if on_save:
        save.clicked.connect(on_save)
    cancel = QPushButton(cancel_text)
    cancel.setProperty("flat", True)
    cancel.setProperty("compact", True)
    cancel.setMinimumHeight(34)
    cancel.setMinimumWidth(86)
    cancel.setCursor(Qt.PointingHandCursor)
    cancel.clicked.connect(dlg.reject)
    btns.addWidget(save)
    btns.addWidget(cancel)
    dlg.root_layout.addLayout(btns)
    return save, cancel


def toast(parent, text: str, kind: str = "success", msec: int = 2500) -> None:
    """رسالة نجاح خفيفة داخل النافذة نفسها لا كنافذة منبثقة مستقلة.

    كان التنفيذ السابق يستخدم Qt.ToolTip كنافذة عائمة، وهذا كان يظهر للمستخدم
    كأن هناك popup يفتح ويختفي عند الدخول أو التنقل. الآن الرسالة QLabel ابن
    للنافذة الرئيسية، فلا تظهر في شريط المهام ولا كنافذة منفصلة ولا تخطف التركيز.
    """
    from PySide6.QtCore import QTimer, Qt as _Qt
    from PySide6.QtWidgets import QApplication, QLabel
    t = THEMES["light"]
    colors = {
        "success": (t["SUCCESS_700"], "rgba(22,163,74,0.13)"),
        "info": (t["BRAND_600"], "rgba(29,78,216,0.13)"),
        "warning": (t["WARNING_700"], "rgba(217,119,6,0.13)"),
    }
    fg, bg = colors.get(kind, colors["success"])
    host = parent.window() if parent is not None else QApplication.activeWindow()
    if host is None:
        return
    label = QLabel(("✔  " if kind == "success" else "") + text, host)
    label.setObjectName("inlineToast")
    label.setAttribute(_Qt.WA_TransparentForMouseEvents, True)
    label.setLayoutDirection(_Qt.RightToLeft)
    label.setWordWrap(True)
    label.setStyleSheet(
        f"background: {t['POPUP_BG']}; color: {fg};"
        f" border: 1.5px solid {bg.replace('0.13', '0.45')};"
        f" border-left: 4px solid {fg};"
        " border-radius: 10px; padding: 10px 16px;"
        f" font-weight: 700; font-size: {12.5 * FONT_SCALE:.1f}px;")
    max_w = max(280, min(520, host.width() - 48))
    label.setMaximumWidth(max_w)
    label.adjustSize()
    x = 24
    y = max(24, host.height() - label.height() - 28)
    label.move(x, y)
    label.raise_()
    label.show()
    QTimer.singleShot(max(800, int(msec)), label.deleteLater)


def confirm_financial(parent, title: str, question: str,
                      figures: list, note: str = "",
                      confirm_text: str = "تأكيد") -> bool:
    """تأكيد عملية حساسة مع عرض أرقام العقد قبل التنفيذ."""
    lines = [question, ""]
    width = max((len(k) for k, _ in figures), default=0)
    for key, value in figures:
        lines.append(f"{key.ljust(width)} : {value}")
    if note:
        lines += ["", note]
    return confirm(parent, "\n".join(lines), title)
