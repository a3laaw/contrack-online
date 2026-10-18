# -*- coding: utf-8 -*-
"""نافذة البحث الشامل الذكي · اكتب أي شيء وافتح النتيجة مباشرة."""
from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QVBoxLayout,
)

from services.search_service import global_search
from ui import style

_SAFE_ICONS = {"👥": "◉", "📑": "▤", "🏗": "▲", "👷": "◆",
               "📥": "⬇", "📤": "⬆", "🧾": "❏"}
from ui.style import soft_shadow


class GlobalSearchDialog(QDialog):
    """بحث موحد في كل النظام: عملاء، عقود، مشاريع، مقاولون، سندات، فواتير."""

    # النوع + المعرف · النافذة الرئيسية تتصرف بالنتيجة
    result_chosen = Signal(str, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("بحث شامل")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 620, 520, min_w=520, min_h=400)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(12)

        self.title_lbl = QLabel("⌕ بحث شامل")
        self.title_lbl.setProperty("sectionTitle", True)
        layout.addWidget(self.title_lbl)

        self.search = QLineEdit()
        self.search.setPlaceholderText(
            "⌕  اكتب اسمًا أو رقم هاتف أو رقم عقد / سند / فاتورة ...")
        self.search.setStyleSheet("font-size: 13.6px; padding: 12px 16px;")
        layout.addWidget(self.search)

        self.hint = QLabel("اكتب حرفين على الأقل · البحث في كل النظام")
        self.hint.setProperty("hint", True)
        layout.addWidget(self.hint)

        self.results_list = QListWidget()
        soft_shadow(self.results_list, radius=26, y=6)
        layout.addWidget(self.results_list, 1)

        # تأخير بسيط أثناء الكتابة (debounce)
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(220)
        self._timer.timeout.connect(self._do_search)
        self.search.textChanged.connect(lambda _: self._timer.start())
        self.results_list.itemActivated.connect(self._open_result)
        self.results_list.itemDoubleClicked.connect(self._open_result)
        self.search.returnPressed.connect(self._open_first)

        self._results: list[dict] = []
        self.search.setFocus()

    def _do_search(self):
        query = self.search.text().strip()
        self.results_list.clear()
        self._results = global_search(query)
        if not query or len(query) < 2:
            self.hint.setText("اكتب حرفين على الأقل · البحث في كل النظام")
            return
        if not self._results:
            self.hint.setText(f"لا نتائج لـ «{query}»")
            return
        groups: dict[str, list] = {}
        for r in self._results:
            groups.setdefault(r["type_label"], []).append(r)
        self.hint.setText(
            f"{len(self._results)} نتيجة · {len(groups)} نوع")
        from PySide6.QtGui import QFont as _QF
        for label, items in groups.items():
            head = QListWidgetItem(f"{label} ({len(items)})")
            head.setFlags(Qt.NoItemFlags)
            _f = _QF()
            _f.setBold(True)
            head.setFont(_f)
            head.setData(Qt.UserRole, None)
            self.results_list.addItem(head)
            for r in items:
                icon = _SAFE_ICONS.get(r["icon"], r["icon"])
                text = f"{icon}  {r['title']}"
                if r["subtitle"]:
                    text += f"\n        {r['subtitle']}"
                item = QListWidgetItem(text)
                item.setData(Qt.UserRole, (r["type"], r["id"]))
                self.results_list.addItem(item)

    def _open_first(self):
        for i in range(self.results_list.count()):
            item = self.results_list.item(i)
            if item.data(Qt.UserRole) is not None:
                self._open_result(item)
                return

    def _open_result(self, item: QListWidgetItem):
        data = item.data(Qt.UserRole)
        if data is None:
            return
        rtype, rid = data
        self.result_chosen.emit(rtype, rid)
        self.accept()
