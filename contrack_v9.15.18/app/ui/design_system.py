# -*- coding: utf-8 -*-
"""نظام التصميم الموحد — ConTrack Pro V8.3

يوفر ألوان وخطوط وأبعاد وأنماط مكونات موحدة لجميع شاشات البرنامج.
"""

# ============================================================
# 🎨 الألوان
# ============================================================
class Colors:
    # الألوان الأساسية
    PRIMARY = "#4F46E5"      # البنفسجي الرئيسي
    PRIMARY_LIGHT = "#818CF8"
    PRIMARY_DARK = "#3730A3"
    PRIMARY_BG = "#EEF2FF"
    
    SECONDARY = "#0EA5E9"    # الأزرق الثانوي
    SECONDARY_LIGHT = "#38BDF8"
    
    SUCCESS = "#10B981"      # الأخضر
    SUCCESS_LIGHT = "#34D399"
    SUCCESS_BG = "#D1FAE5"
    
    DANGER = "#EF4444"       # الأحمر
    DANGER_LIGHT = "#F87171"
    DANGER_BG = "#FEE2E2"
    
    WARNING = "#F59E0B"      # البرتقالي
    WARNING_LIGHT = "#FBBF24"
    WARNING_BG = "#FEF3C7"
    
    INFO = "#3B82F6"         # الأزرق
    INFO_LIGHT = "#60A5FA"
    INFO_BG = "#DBEAFE"
    
    # ألوان الخلفية
    BG = "#F8FAFC"
    BG_DARK = "#F1F5F9"
    CARD = "#FFFFFF"
    CARD_HOVER = "#F8FAFC"
    
    # ألوان النص
    TEXT = "#1E293B"
    TEXT_SECONDARY = "#475569"
    MUTED = "#64748B"
    MUTED_LIGHT = "#94A3B8"
    
    # ألوان الحدود
    BORDER = "#E2E8F0"
    BORDER_FOCUS = "#4F46E5"
    BORDER_LIGHT = "#F1F5F9"


# ============================================================
# 📝 الخطوط
# ============================================================
class Fonts:
    # الأحجام
    TITLE_LARGE = 18
    TITLE = 15
    SUBTITLE = 14
    BODY = 13
    CAPTION = 11
    SMALL = 10
    
    # الأوزان
    WEIGHT_BOLD = 800
    WEIGHT_SEMIBOLD = 700
    WEIGHT_MEDIUM = 600
    WEIGHT_NORMAL = 400


# ============================================================
# 📐 الأبعاد
# ============================================================
class Dimensions:
    # الحواف المدورة
    RADIUS_SM = 6
    RADIUS_MD = 8
    RADIUS_LG = 12
    RADIUS_XL = 16
    
    # المسافات
    SPACING_XS = 4
    SPACING_SM = 8
    SPACING_MD = 12
    SPACING_LG = 16
    SPACING_XL = 20
    
    # ارتفاعات
    INPUT_HEIGHT = 36
    BUTTON_HEIGHT = 38
    TABLE_ROW_HEIGHT = 40
    
    # أحجام الأيقونات
    ICON_SM = 16
    ICON_MD = 20
    ICON_LG = 24


# ============================================================
# 🎭 أنماط CSS الموحدة
# ============================================================
class Styles:
    """أنماط CSS جاهزة للاستخدام."""
    
    @staticmethod
    def banner(title: str = "", subtitle: str = "", color: str = Colors.PRIMARY) -> str:
        """ترويسة بتدرج لوني."""
        return f"""
            QFrame {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 {color}, stop:1 {Colors.PRIMARY_DARK});
                border: none; border-radius: 0px;
            }}
        """
    
    @staticmethod
    def card() -> str:
        """بطاقة بيضاء مع ظل."""
        return f"""
            QFrame {{
                background: {Colors.CARD};
                border: 1px solid {Colors.BORDER};
                border-radius: {Dimensions.RADIUS_LG}px;
            }}
        """
    
    @staticmethod
    def input_field() -> str:
        """حقل إدخال."""
        return f"""
            QLineEdit, QTextEdit, QComboBox, QSpinBox, QDoubleSpinBox, QDateEdit {{
                background: {Colors.CARD};
                border: 1.5px solid {Colors.BORDER};
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 8px 12px;
                font-size: {Fonts.BODY}px;
                color: {Colors.TEXT};
                min-height: {Dimensions.INPUT_HEIGHT}px;
            }}
            QLineEdit:focus, QTextEdit:focus, QComboBox:focus,
            QSpinBox:focus, QDoubleSpinBox:focus, QDateEdit:focus {{
                border-color: {Colors.BORDER_FOCUS};
                background: {Colors.CARD};
            }}
            QLineEdit:hover, QTextEdit:hover, QComboBox:hover {{
                border-color: {Colors.MUTED_LIGHT};
            }}
        """
    
    @staticmethod
    def button_primary() -> str:
        """زر أساسي (بنفسجي)."""
        return f"""
            QPushButton {{
                background: {Colors.PRIMARY};
                color: white;
                border: none;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 20px;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.BODY}px;
                min-height: {Dimensions.BUTTON_HEIGHT}px;
            }}
            QPushButton:hover {{
                background: {Colors.PRIMARY_DARK};
            }}
            QPushButton:pressed {{
                background: #312E81;
            }}
            QPushButton:disabled {{
                background: {Colors.BG_DARK};
                color: {Colors.MUTED_LIGHT};
            }}
        """
    
    @staticmethod
    def button_secondary() -> str:
        """زر ثانوي (شفاف)."""
        return f"""
            QPushButton {{
                background: transparent;
                color: {Colors.PRIMARY};
                border: 1.5px solid {Colors.PRIMARY};
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 20px;
                font-weight: {Fonts.WEIGHT_SEMIBOLD};
                font-size: {Fonts.BODY}px;
                min-height: {Dimensions.BUTTON_HEIGHT}px;
            }}
            QPushButton:hover {{
                background: {Colors.PRIMARY}15;
            }}
            QPushButton:pressed {{
                background: {Colors.PRIMARY}25;
            }}
        """
    
    @staticmethod
    def button_danger() -> str:
        """زر خطر (أحمر)."""
        return f"""
            QPushButton {{
                background: {Colors.DANGER};
                color: white;
                border: none;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 20px;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.BODY}px;
                min-height: {Dimensions.BUTTON_HEIGHT}px;
            }}
            QPushButton:hover {{
                background: #DC2626;
            }}
            QPushButton:pressed {{
                background: #B91C1C;
            }}
        """
    
    @staticmethod
    def button_danger_ghost() -> str:
        """زر خطر شفاف (حذف)."""
        return f"""
            QPushButton {{
                background: transparent;
                color: {Colors.DANGER};
                border: 1px solid transparent;
                border-radius: {Dimensions.RADIUS_MD}px;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: 16px;
            }}
            QPushButton:hover {{
                background: {Colors.DANGER_BG};
                border-color: {Colors.DANGER};
            }}
            QPushButton:pressed {{
                background: {Colors.DANGER_BG};
            }}
        """
    
    @staticmethod
    def button_success() -> str:
        """زر نجاح (أخضر)."""
        return f"""
            QPushButton {{
                background: {Colors.SUCCESS};
                color: white;
                border: none;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 20px;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.BODY}px;
                min-height: {Dimensions.BUTTON_HEIGHT}px;
            }}
            QPushButton:hover {{
                background: #059669;
            }}
            QPushButton:pressed {{
                background: #047857;
            }}
        """
    
    @staticmethod
    def table() -> str:
        """جدول."""
        return f"""
            QTableWidget {{
                background: {Colors.CARD};
                border: 1px solid {Colors.BORDER};
                border-radius: {Dimensions.RADIUS_MD}px;
                gridline-color: {Colors.BORDER_LIGHT};
                font-size: {Fonts.BODY}px;
            }}
            QTableWidget::item {{
                padding: 8px;
                border-bottom: 1px solid {Colors.BORDER_LIGHT};
            }}
            QTableWidget::item:selected {{
                background: {Colors.INFO_BG};
                color: {Colors.TEXT};
            }}
            QTableWidget::item:hover {{
                background: {Colors.BG_DARK};
            }}
            QHeaderView::section {{
                background: {Colors.PRIMARY};
                color: white;
                padding: 10px 12px;
                border: none;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.BODY}px;
            }}
        """
    
    @staticmethod
    def table_header(color: str = Colors.PRIMARY) -> str:
        """رأس جدول بلون مخصص."""
        return f"""
            QHeaderView::section {{
                background: {color};
                color: white;
                padding: 10px 12px;
                border: none;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.BODY}px;
            }}
        """
    
    @staticmethod
    def group_box() -> str:
        """مجموعة (GroupBox)."""
        return f"""
            QGroupBox {{
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.SUBTITLE}px;
                color: {Colors.TEXT};
                border: 2px solid {Colors.BORDER};
                border-radius: {Dimensions.RADIUS_LG}px;
                margin-top: 12px;
                padding-top: 16px;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 20px;
                padding: 0 10px;
                background: {Colors.CARD};
            }}
        """
    
    @staticmethod
    def label_title() -> str:
        """عنوان كبير."""
        return f"""
            font-size: {Fonts.TITLE_LARGE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.TEXT};
        """
    
    @staticmethod
    def label_subtitle() -> str:
        """عنوان فرعي."""
        return f"""
            font-size: {Fonts.SUBTITLE}px;
            font-weight: {Fonts.WEIGHT_SEMIBOLD};
            color: {Colors.TEXT_SECONDARY};
        """
    
    @staticmethod
    def label_muted() -> str:
        """نص ثانوي."""
        return f"""
            font-size: {Fonts.CAPTION}px;
            color: {Colors.MUTED};
        """
    
    @staticmethod
    def stat_card(color: str = Colors.PRIMARY) -> str:
        """بطاقة إحصائية."""
        return f"""
            QFrame {{
                background: {color}15;
                border: 1.5px solid {color}40;
                border-radius: {Dimensions.RADIUS_LG}px;
                padding: 12px;
            }}
        """
    
    @staticmethod
    def warning_box() -> str:
        """صندوق تحذير."""
        return f"""
            QLabel {{
                background: {Colors.WARNING_BG};
                border: 1.5px solid {Colors.WARNING}40;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 14px;
                color: #92400E;
                font-weight: {Fonts.WEIGHT_SEMIBOLD};
            }}
        """
    
    @staticmethod
    def danger_box() -> str:
        """صندوق خطر."""
        return f"""
            QLabel {{
                background: {Colors.DANGER_BG};
                border: 1.5px solid {Colors.DANGER}40;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 14px;
                color: #991B1B;
                font-weight: {Fonts.WEIGHT_SEMIBOLD};
            }}
        """
    
    @staticmethod
    def success_box() -> str:
        """صندوق نجاح."""
        return f"""
            QLabel {{
                background: {Colors.SUCCESS_BG};
                border: 1.5px solid {Colors.SUCCESS}40;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 14px;
                color: #065F46;
                font-weight: {Fonts.WEIGHT_SEMIBOLD};
            }}
        """
    
    @staticmethod
    def info_box() -> str:
        """صندوق معلومات."""
        return f"""
            QLabel {{
                background: {Colors.INFO_BG};
                border: 1.5px solid {Colors.INFO}40;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px 14px;
                color: #1E40AF;
                font-weight: {Fonts.WEIGHT_SEMIBOLD};
            }}
        """
    
    @staticmethod
    def tab_widget() -> str:
        """تبويبات."""
        return f"""
            QTabWidget::pane {{
                border: 1px solid {Colors.BORDER};
                border-radius: {Dimensions.RADIUS_MD}px;
                background: {Colors.CARD};
            }}
            QTabBar::tab {{
                padding: 10px 24px;
                font-weight: {Fonts.WEIGHT_BOLD};
                font-size: {Fonts.BODY}px;
                border: 1px solid {Colors.BORDER};
                border-bottom: none;
                border-top-left-radius: {Dimensions.RADIUS_MD}px;
                border-top-right-radius: {Dimensions.RADIUS_MD}px;
                margin-right: 2px;
                background: {Colors.BG_DARK};
                color: {Colors.TEXT_SECONDARY};
            }}
            QTabBar::tab:selected {{
                background: {Colors.PRIMARY};
                color: white;
                border-color: {Colors.PRIMARY};
            }}
            QTabBar::tab:hover:!selected {{
                background: {Colors.BORDER_LIGHT};
            }}
        """
    
    @staticmethod
    def scrollbar() -> str:
        """شريط تمرير."""
        return f"""
            QScrollBar:vertical {{
                background: {Colors.BG};
                width: 10px;
                border-radius: 5px;
            }}
            QScrollBar::handle:vertical {{
                background: {Colors.MUTED_LIGHT};
                border-radius: 5px;
                min-height: 30px;
            }}
            QScrollBar::handle:vertical:hover {{
                background: {Colors.MUTED};
            }}
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
                height: 0;
            }}
            QScrollBar:horizontal {{
                background: {Colors.BG};
                height: 10px;
                border-radius: 5px;
            }}
            QScrollBar::handle:horizontal {{
                background: {Colors.MUTED_LIGHT};
                border-radius: 5px;
                min-width: 30px;
            }}
            QScrollBar::handle:horizontal:hover {{
                background: {Colors.MUTED};
            }}
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
                width: 0;
            }}
        """


# ============================================================
# 🛠️ دوال مساعدة
# ============================================================
def apply_global_style(app):
    """تطبيق الستايل الموحد على التطبيق كامل."""
    app.setStyleSheet(f"""
        * {{
            font-family: 'Segoe UI', 'Tahoma', 'Arial', sans-serif;
        }}
        QDialog {{
            background: {Colors.BG};
        }}
        QMainWindow {{
            background: {Colors.BG};
        }}
        {Styles.input_field()}
        {Styles.scrollbar()}
    """)


def styled_button(text: str, style_type: str = "primary", icon: str = "") -> str:
    """الحصول على نمط زر."""
    styles = {
        "primary": Styles.button_primary(),
        "secondary": Styles.button_secondary(),
        "danger": Styles.button_danger(),
        "danger_ghost": Styles.button_danger_ghost(),
        "success": Styles.button_success(),
    }
    return styles.get(style_type, Styles.button_primary())
