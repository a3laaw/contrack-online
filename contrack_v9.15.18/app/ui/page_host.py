"""
page_host.py — FullPageHost: يضمّن QDialog داخل صفحة كاملة في الـ stack.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel, QSizePolicy,
    QDialog,
)

_BACK_SS = (
    "QPushButton { padding: 6px 16px; font-size: 13px; font-weight: 600;"
    " border: 1px solid #D1D5DB; border-radius: 8px;"
    " background: #F9FAFB; color: #374151; }"
    " QPushButton:hover { background: #E5E7EB; }"
)
_TITLE_SS = "font-size: 17px; font-weight: 800; color: #1F2937; background: transparent;"


class FullPageHost(QWidget):
    """يضمّن QDialog كصفحة كاملة داخل main stack.

    يتعامل مع:
    - setup_dialog resize/minSize
    - Esc key
    - finished signal
    - accept()/reject() behavior
    """

    def __init__(self, dialog, title: str = "", on_done=None, parent=None,
                 prev_widget=None):
        super().__init__(parent)
        self._dialog = dialog
        self._on_done = on_done
        self._prev_widget = prev_widget  # يُمرَّر من open_dialog_page
        self._finished = False

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ── رأس الصفحة ───────────────────────────────────────────
        if title:
            header = QWidget()
            header.setStyleSheet("background: #F9FAFB; border-bottom: 1px solid #E5E7EB;")
            h_lay = QHBoxLayout(header)
            h_lay.setContentsMargins(12, 8, 12, 8)

            back_btn = QPushButton("← رجوع")
            back_btn.setStyleSheet(_BACK_SS)
            back_btn.clicked.connect(self._reject_and_close)
            h_lay.addWidget(back_btn)

            title_lbl = QLabel(title)
            title_lbl.setStyleSheet(_TITLE_SS)
            h_lay.addWidget(title_lbl, 1)

            lay.addWidget(header)

        # ── تضمين الـ Dialog ─────────────────────────────────────
        dialog.setWindowFlags(Qt.Widget)
        dialog.setParent(self)
        dialog.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        lay.addWidget(dialog, 1)

        # ── ربط الإغلاق ──────────────────────────────────────────
        dialog.finished.connect(self._on_dialog_finished)
        dialog.rejected.connect(self._on_dialog_rejected)

        # ── ربط Esc key ──────────────────────────────────────────
        QShortcut(QKeySequence(Qt.Key_Escape), self, self._reject_and_close)

        # ── تعطيل resize/setup_dialog بعد التضمين ────────────────
        QTimer.singleShot(0, self._fix_dialog_after_embed)

    def _fix_dialog_after_embed(self):
        """إصلاح أحجام Dialog بعد التضمين."""
        dlg = self._dialog
        # تعطيل الحدود الدنيا/setup_dialog
        dlg.setMinimumSize(0, 0)
        dlg.setMaximumSize(16777215, 16777215)
        dlg.resize(self.size())
        # تحديث التخطيط
        dlg.updateGeometry()
        self.updateGeometry()

    def _reject_and_close(self):
        """زر رجوع = reject (يفعّل تأكيد التعديلات غير المحفوظة إن وجدت)."""
        if self._finished:
            return
        self._dialog.reject()

    def _on_dialog_rejected(self):
        """عند reject — إغلاق الصفحة."""
        if self._finished:
            return
        self._finished = True
        self._cleanup_and_close(False)

    def _on_dialog_finished(self, code):
        """عند إغلاق الـ dialog — إزالة الصفحة والعودة."""
        if self._finished:
            return
        self._finished = True
        accepted = (code == QDialog.Accepted)
        self._cleanup_and_close(accepted)

    def _cleanup_and_close(self, accepted: bool):
        """تنظيف وإغلاق الصفحة."""
        win = self.window()
        if hasattr(win, 'stack'):
            win.stack.removeWidget(self)
        # العودة للصفحة السابقة
        if self._prev_widget and hasattr(win, 'stack'):
            win.stack.setCurrentWidget(self._prev_widget)
        # استدعاء callback
        if self._on_done:
            self._on_done(accepted)
        self.deleteLater()
