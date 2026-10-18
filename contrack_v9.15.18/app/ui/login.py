# -*- coding: utf-8 -*-
"""شاشة تسجيل الدخول."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog, QFrame, QHBoxLayout, QLabel, QLineEdit, QPushButton, QScrollArea,
    QVBoxLayout,
)

from services import auth_service
from ui import style
from ui.style import GlassBackground, soft_shadow

# مسار الأيقونة يُحدد مركزيًا في style (SVG أولًا ثم PNG)


class LoginDialog(QDialog):
    """نافذة تسجيل الدخول · بطاقة زجاجية فوق خلفية Ambient."""

    MAX_ATTEMPTS = 3

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self._attempts = 0
        from services import settings_service as _ss
        _app_name = _ss.app_name()
        self.setWindowTitle(f"تسجيل الدخول · {_app_name}")
        self.setLayoutDirection(Qt.RightToLeft)
        # حجم متكيف: 440×540 على الشاشات العادية، ويتقلّص تلقائيًا على
        # الشاشات الصغيرة (1366×768) أو عند تكبير ويندوز 125%/150%
        # مع بقاء النافذة قابلة للتمدد (بدل setFixedSize السابق)
        style.fit_window(self, 440, 540, min_w=380, min_h=430, ratio=0.90)
        style.center_on_screen(self)

        # خلفية Ambient + بطاقة زجاجية
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        bg = GlassBackground()
        outer.addWidget(bg)
        bg_layout = QVBoxLayout(bg)
        bg_layout.setContentsMargins(28, 28, 28, 28)

        card = QFrame()
        card.setProperty("card", True)
        soft_shadow(card, radius=44, y=10)
        # على الشاشات القصيرة (768 مع تكبير 150%) يظهر شريط تمرير بدل
        # أن يُقصّ محتوى البطاقة
        card_scroll = QScrollArea()
        card_scroll.setWidgetResizable(True)
        card_scroll.setFrameShape(QFrame.NoFrame)
        card_scroll.setObjectName("transparentHost")
        card_scroll.viewport().setObjectName("transparentHost")
        card_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        card_scroll.setWidget(card)
        bg_layout.addWidget(card_scroll)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(34, 28, 34, 24)
        layout.setSpacing(12)

        # الأيقونة
        icon_lbl = QLabel()
        icon_lbl.setAlignment(Qt.AlignCenter)
        # الأيقونة تُرسم بدقة الشاشة الفعلية (SVG أولًا) فتبقى حادة مع التكبير
        pix = style.icon_pixmap(84, self)
        if not pix.isNull():
            icon_lbl.setPixmap(pix)
        layout.addWidget(icon_lbl)

        title = QLabel(_app_name)
        title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet(
            f"font-size: 18.7px; font-weight: bold; color: {style.PRIMARY};")
        subtitle = QLabel("عملاء • عقود • فواتير • كشوف حساب")
        subtitle.setAlignment(Qt.AlignCenter)
        subtitle.setProperty("hint", True)
        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addSpacing(8)

        user_lbl = QLabel("اسم المستخدم")
        user_lbl.setStyleSheet(
            f"font-size: 12px; font-weight: 600; color: {style.PRIMARY};")
        layout.addWidget(user_lbl)
        self.username = QLineEdit()
        self.username.setPlaceholderText("اسم المستخدم")
        # يُملأ باسم آخر مستخدم دخل بنجاح على هذا الجهاز فقط
        try:
            from services import prefs_service as _prefs
            self.username.setText(str(_prefs.get_pref("last_username", "")))
        except Exception:
            pass
        layout.addWidget(self.username)
        pass_lbl = QLabel("كلمة المرور")
        pass_lbl.setStyleSheet(
            f"font-size: 12px; font-weight: 600; color: {style.PRIMARY};")
        layout.addWidget(pass_lbl)
        self.password = QLineEdit()
        self.password.setPlaceholderText("كلمة المرور")
        self.password.setEchoMode(QLineEdit.Password)
        layout.addWidget(self.password)

        self.msg = QLabel("")
        self.msg.setAlignment(Qt.AlignCenter)
        self.msg.setStyleSheet(f"color: {style.RED}; font-size: 10.2px;")
        self.msg.setWordWrap(True)
        layout.addWidget(self.msg)

        login_btn = QPushButton("دخول")
        login_btn.setObjectName("btnPrimary")
        login_btn.setMinimumHeight(42)
        login_btn.clicked.connect(self._try_login)
        layout.addWidget(login_btn)

        layout.addStretch()
        from version import APP_VERSION as _APP_VERSION
        ver = QLabel(f"الإصدار {_APP_VERSION}")
        ver.setAlignment(Qt.AlignCenter)
        ver.setProperty("hint", True)
        layout.addWidget(ver)

        self.password.returnPressed.connect(self._try_login)
        self.username.returnPressed.connect(self.password.setFocus)
        # التركيز على كلمة المرور إن كان الاسم محفوظًا، وإلا على الاسم
        (self.password if self.username.text().strip()
         else self.username).setFocus()

    def _try_login(self):
        if auth_service.verify_login(self.username.text(), self.password.text()):
            auth_service.set_current_user(self.username.text().strip())
            try:
                from services import prefs_service as _prefs
                _prefs.set_pref("last_username", self.username.text().strip())
            except Exception:
                pass
            self.accept()
            return
        self._attempts += 1
        remaining = self.MAX_ATTEMPTS - self._attempts
        if remaining <= 0:
            style.error(self, "تم تجاوز عدد المحاولات المسموح بها.\nسيتم إغلاق البرنامج.")
            self.reject()
            return
        self.msg.setText(
            f"اسم المستخدم أو كلمة المرور غير صحيحة. (متبقي {remaining} محاولة)")
        self.password.clear()
        self.password.setFocus()
