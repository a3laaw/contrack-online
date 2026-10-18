# -*- coding: utf-8 -*-
"""V3.2 (د): بوابة الدفع — تصنيف وتوزيع + الشركة الأخرى (V4.40: بلا مطابقة بنك)."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QHBoxLayout, QLabel, QPushButton, QStackedWidget,
                               QVBoxLayout, QWidget)

from ui.gateway_page import GatewayPage
from ui.other_company_page import OtherCompanyPage
from ui.widgets import SegmentedTabs


class PaymentGatewayPage(QWidget):
    """تصنيف وتوزيع البوابات (فلوس مين؟) + حساب الشركة الأخرى."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)
        top = QHBoxLayout()
        title = QLabel("بوابة الدفع")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        top.addStretch()
        self.wizard_btn = QPushButton("＋ تسوية جديدة")
        self.wizard_btn.setObjectName("btnPrimary")
        self.wizard_btn.clicked.connect(self._open_wizard)
        top.addWidget(self.wizard_btn)
        self.tabs = SegmentedTabs()
        self.tabs.addItem("التصنيف والتوزيع", "match")
        self.tabs.addItem("الشركة الأخرى", "other")
        self.tabs.currentIndexChanged.connect(self._switch)
        top.addWidget(self.tabs)
        root.addLayout(top)
        hint = QLabel("صنّف ثم وزّع · تابع المستحق والمسدد في الشركة الأخرى")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        root.addWidget(hint)
        self.stack = QStackedWidget()
        self.match_tab = GatewayPage(
            embedded=True, on_show_tab=self.show_tab)
        self.other_tab = OtherCompanyPage(embedded=True)
        self.stack.addWidget(self.match_tab)
        self.stack.addWidget(self.other_tab)
        root.addWidget(self.stack, 1)

    def _switch(self, index: int):
        self.stack.setCurrentIndex(max(0, index))
        try:
            self.stack.currentWidget().refresh()
        except Exception:
            pass

    def _open_wizard(self):
        """تسوية جديدة بخطوتين: (١) رفع الملف ← (٢) شاشة التصنيف."""
        from PySide6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getOpenFileName(
            self, "استيراد كشف التسوية", "", "Excel/CSV (*.xlsx *.csv)")
        if not path:
            return
        try:
            self.match_tab.import_file(path)
        except Exception:
            pass
        try:
            self.other_tab.refresh()
        except Exception:
            pass
        self.show_tab("match")

    def show_tab(self, name: str, mode: str | None = None):
        """show_tab("other", "due") تهبط على المستحق مباشرة."""
        self.tabs.setCurrentData(name)
        self._switch(self.tabs.currentIndex())
        if name == "other" and mode:
            try:
                self.other_tab.mode.setCurrentData(mode)
            except Exception:
                pass

    def refresh(self):
        try:
            self.stack.currentWidget().refresh()
        except Exception:
            pass
