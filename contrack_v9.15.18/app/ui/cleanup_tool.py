# -*- coding: utf-8 -*-
"""شاشة تنظيف البيانات الشاملة — V8.3

تتيح البحث عن عميل/مقاول/عقد/سند مع عرض جميع معاملاته
مع قائمة اختيار للحذف مع تحذيرات الارتباط.
"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QDialog, QFrame,
    QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QPushButton, QScrollArea, QSplitter, QTabWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services import cleanup_service as cs
from services.customer_service import ValidationError
from ui import style


# ============================================================
# الألوان والأنماط
# ============================================================
_COLORS = {
    "bg": "#F8FAFC",
    "card": "#FFFFFF",
    "border": "#E2E8F0",
    "primary": "#1E40AF",
    "primary_light": "#DBEAFE",
    "danger": "#DC2626",
    "danger_light": "#FEE2E2",
    "warning": "#D97706",
    "warning_light": "#FEF3C7",
    "success": "#059669",
    "success_light": "#D1FAE5",
    "text": "#1E293B",
    "text_muted": "#64748B",
}


def _colored_btn(text: str, color: str, hover: str) -> QPushButton:
    """زر ملون."""
    btn = QPushButton(text)
    btn.setStyleSheet(f"""
        QPushButton {{
            background: {color};
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 13px;
        }}
        QPushButton:hover {{
            background: {hover};
        }}
    """)
    return btn


def _danger_btn(text: str) -> QPushButton:
    return _colored_btn(text, _COLORS["danger"], "#B91C1C")


def _success_btn(text: str) -> QPushButton:
    return _colored_btn(text, _COLORS["success"], "#047857")


def _primary_btn(text: str) -> QPushButton:
    return _colored_btn(text, _COLORS["primary"], "#1E3A8A")


# ============================================================
# الشاشة الرئيسية
# ============================================================
class CleanupDialog(QDialog):
    """شاشة تنظيف البيانات الشاملة."""

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("🧹 تنظيف البيانات")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 1200, 800, min_w=900, min_h=600)

        self._setup_ui()

    def _setup_ui(self):
        """بناء الواجهة."""
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 12, 16, 12)
        root.setSpacing(12)

        # === الترويسة ===
        header = QHBoxLayout()
        title = QLabel("🧹 أداة تنظيف البيانات")
        title.setProperty("pageTitle", True)
        header.addWidget(title)
        header.addStretch()

        # زر التقرير
        report_btn = _primary_btn("📊 تقرير شامل")
        report_btn.clicked.connect(self._show_report)
        header.addWidget(report_btn)

        root.addLayout(header)

        # === التبويبات ===
        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("""
            QTabBar::tab {
                padding: 10px 24px;
                font-weight: bold;
                border: 1px solid #E2E8F0;
                border-bottom: none;
                border-top-left-radius: 8px;
                border-top-right-radius: 8px;
                margin-right: 2px;
                font-size: 14px;
            }
            QTabBar::tab:selected {
                background: #1E40AF;
                color: white;
            }
            QTabBar::tab:!selected {
                background: #F1F5F9;
            }
        """)

        # تبويبات الأقسام
        self.tabs.addTab(self._build_customers_tab(), "👥 العملاء")
        self.tabs.addTab(self._build_subcontractors_tab(), "👷 المقاولين")
        self.tabs.addTab(self._build_contracts_tab(), "📋 العقود")
        self.tabs.addTab(self._build_vouchers_tab(), "💰 السندات")
        self.tabs.addTab(self._build_claims_tab(), "📝 المطالبات المالية")

        root.addWidget(self.tabs)

    # ============================================================
    # تبويب العملاء
    # ============================================================
    def _build_customers_tab(self) -> QWidget:
        tab = QWidget()
        lay = QVBoxLayout(tab)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(12)

        # شريط البحث
        search_row = QHBoxLayout()
        self.customer_search = QLineEdit()
        self.customer_search.setPlaceholderText("🔍 ابحث بالاسم، الكود، أو رقم الهاتف...")
        self.customer_search.setStyleSheet(f"""
            QLineEdit {{
                padding: 10px 15px;
                border: 2px solid {_COLORS['border']};
                border-radius: 8px;
                font-size: 14px;
            }}
            QLineEdit:focus {{
                border-color: {_COLORS['primary']};
            }}
        """)
        self.customer_search.returnPressed.connect(self._search_customers)
        search_row.addWidget(self.customer_search, 1)

        search_btn = _primary_btn("🔍 بحث")
        search_btn.clicked.connect(self._search_customers)
        search_row.addWidget(search_btn)

        lay.addLayout(search_row)

        # جدول النتائج
        self.customer_table = QTableWidget()
        self.customer_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.customer_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.customer_table.verticalHeader().setVisible(False)
        self.customer_table.setStyleSheet(f"""
            QTableWidget {{
                border: 1px solid {_COLORS['border']};
                border-radius: 6px;
                gridline-color: {_COLORS['border']};
            }}
            QHeaderView::section {{
                background: {_COLORS['primary_light']};
                padding: 8px;
                border: none;
                border-bottom: 2px solid {_COLORS['primary']};
                font-weight: bold;
            }}
        """)
        self.customer_table.itemDoubleClicked.connect(
            lambda item: self._show_entity_details("customer", item))
        lay.addWidget(self.customer_table, 1)

        # أزرار الحذف
        btn_row = QHBoxLayout()
        select_all_btn = _primary_btn("☑ تحديد الكل")
        select_all_btn.clicked.connect(
            lambda: self._select_all(self.customer_table))
        btn_row.addWidget(select_all_btn)

        deselect_btn = _primary_btn("☐ إلغاء التحديد")
        deselect_btn.clicked.connect(
            lambda: self._deselect_all(self.customer_table))
        btn_row.addWidget(deselect_btn)

        btn_row.addStretch()

        delete_selected_btn = _danger_btn("🗑 حذف المحدد")
        delete_selected_btn.clicked.connect(
            lambda: self._delete_selected("customer", self.customer_table))
        btn_row.addWidget(delete_selected_btn)

        lay.addLayout(btn_row)

        return tab

    # ============================================================
    # تبويب المقاولين
    # ============================================================
    def _build_subcontractors_tab(self) -> QWidget:
        tab = QWidget()
        lay = QVBoxLayout(tab)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(12)

        # شريط البحث
        search_row = QHBoxLayout()
        self.sub_search = QLineEdit()
        self.sub_search.setPlaceholderText("🔍 ابحث بالاسم، الكود، النشاط، أو الهاتف...")
        self.sub_search.setStyleSheet(f"""
            QLineEdit {{
                padding: 10px 15px;
                border: 2px solid {_COLORS['border']};
                border-radius: 8px;
                font-size: 14px;
            }}
            QLineEdit:focus {{
                border-color: {_COLORS['primary']};
            }}
        """)
        self.sub_search.returnPressed.connect(self._search_subcontractors)
        search_row.addWidget(self.sub_search, 1)

        search_btn = _primary_btn("🔍 بحث")
        search_btn.clicked.connect(self._search_subcontractors)
        search_row.addWidget(search_btn)

        lay.addLayout(search_row)

        # جدول النتائج
        self.sub_table = QTableWidget()
        self.sub_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.sub_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.sub_table.verticalHeader().setVisible(False)
        self.sub_table.setStyleSheet(f"""
            QTableWidget {{
                border: 1px solid {_COLORS['border']};
                border-radius: 6px;
                gridline-color: {_COLORS['border']};
            }}
            QHeaderView::section {{
                background: {_COLORS['warning_light']};
                padding: 8px;
                border: none;
                border-bottom: 2px solid {_COLORS['warning']};
                font-weight: bold;
            }}
        """)
        self.sub_table.itemDoubleClicked.connect(
            lambda item: self._show_entity_details("subcontractor", item))
        lay.addWidget(self.sub_table, 1)

        # أزرار الحذف
        btn_row = QHBoxLayout()
        select_all_btn = _primary_btn("☑ تحديد الكل")
        select_all_btn.clicked.connect(
            lambda: self._select_all(self.sub_table))
        btn_row.addWidget(select_all_btn)

        deselect_btn = _primary_btn("☐ إلغاء التحديد")
        deselect_btn.clicked.connect(
            lambda: self._deselect_all(self.sub_table))
        btn_row.addWidget(deselect_btn)

        btn_row.addStretch()

        delete_selected_btn = _danger_btn("🗑 حذف المحدد")
        delete_selected_btn.clicked.connect(
            lambda: self._delete_selected("subcontractor", self.sub_table))
        btn_row.addWidget(delete_selected_btn)

        lay.addLayout(btn_row)

        return tab

    # ============================================================
    # تبويب العقود
    # ============================================================
    def _build_contracts_tab(self) -> QWidget:
        tab = QWidget()
        lay = QVBoxLayout(tab)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(12)

        # شريط البحث
        search_row = QHBoxLayout()
        self.contract_search = QLineEdit()
        self.contract_search.setPlaceholderText("🔍 ابحث برقم العقد، الوصف، اسم العميل...")
        self.contract_search.setStyleSheet(f"""
            QLineEdit {{
                padding: 10px 15px;
                border: 2px solid {_COLORS['border']};
                border-radius: 8px;
                font-size: 14px;
            }}
            QLineEdit:focus {{
                border-color: {_COLORS['primary']};
            }}
        """)
        self.contract_search.returnPressed.connect(self._search_contracts)
        search_row.addWidget(self.contract_search, 1)

        search_btn = _primary_btn("🔍 بحث")
        search_btn.clicked.connect(self._search_contracts)
        search_row.addWidget(search_btn)

        lay.addLayout(search_row)

        # جدول النتائج
        self.contract_table = QTableWidget()
        self.contract_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.contract_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.contract_table.verticalHeader().setVisible(False)
        self.contract_table.setStyleSheet(f"""
            QTableWidget {{
                border: 1px solid {_COLORS['border']};
                border-radius: 6px;
                gridline-color: {_COLORS['border']};
            }}
            QHeaderView::section {{
                background: {_COLORS['success_light']};
                padding: 8px;
                border: none;
                border-bottom: 2px solid {_COLORS['success']};
                font-weight: bold;
            }}
        """)
        self.contract_table.itemDoubleClicked.connect(
            lambda item: self._show_entity_details("contract", item))
        lay.addWidget(self.contract_table, 1)

        # أزرار الحذف
        btn_row = QHBoxLayout()
        select_all_btn = _primary_btn("☑ تحديد الكل")
        select_all_btn.clicked.connect(
            lambda: self._select_all(self.contract_table))
        btn_row.addWidget(select_all_btn)

        deselect_btn = _primary_btn("☐ إلغاء التحديد")
        deselect_btn.clicked.connect(
            lambda: self._deselect_all(self.contract_table))
        btn_row.addWidget(deselect_btn)

        btn_row.addStretch()

        delete_selected_btn = _danger_btn("🗑 حذف المحدد")
        delete_selected_btn.clicked.connect(
            lambda: self._delete_selected("contract", self.contract_table))
        btn_row.addWidget(delete_selected_btn)

        lay.addLayout(btn_row)

        return tab

    # ============================================================
    # تبويب السندات
    # ============================================================
    def _build_vouchers_tab(self) -> QWidget:
        tab = QWidget()
        lay = QVBoxLayout(tab)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(12)

        # شريط البحث
        search_row = QHBoxLayout()
        self.voucher_search = QLineEdit()
        self.voucher_search.setPlaceholderText("🔍 ابحث برقم السند، المبلغ، التاريخ...")
        self.voucher_search.setStyleSheet(f"""
            QLineEdit {{
                padding: 10px 15px;
                border: 2px solid {_COLORS['border']};
                border-radius: 8px;
                font-size: 14px;
            }}
            QLineEdit:focus {{
                border-color: {_COLORS['primary']};
            }}
        """)
        self.voucher_search.returnPressed.connect(self._search_vouchers)
        search_row.addWidget(self.voucher_search, 1)

        search_btn = _primary_btn("🔍 بحث")
        search_btn.clicked.connect(self._search_vouchers)
        search_row.addWidget(search_btn)

        lay.addLayout(search_row)

        # جدول النتائج
        self.voucher_table = QTableWidget()
        self.voucher_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.voucher_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.voucher_table.verticalHeader().setVisible(False)
        self.voucher_table.setStyleSheet(f"""
            QTableWidget {{
                border: 1px solid {_COLORS['border']};
                border-radius: 6px;
                gridline-color: {_COLORS['border']};
            }}
            QHeaderView::section {{
                background: #FEF3C7;
                padding: 8px;
                border: none;
                border-bottom: 2px solid {_COLORS['warning']};
                font-weight: bold;
            }}
        """)
        self.voucher_table.itemDoubleClicked.connect(
            lambda item: self._show_entity_details("voucher", item))
        lay.addWidget(self.voucher_table, 1)

        # أزرار الحذف
        btn_row = QHBoxLayout()
        select_all_btn = _primary_btn("☑ تحديد الكل")
        select_all_btn.clicked.connect(
            lambda: self._select_all(self.voucher_table))
        btn_row.addWidget(select_all_btn)

        deselect_btn = _primary_btn("☐ إلغاء التحديد")
        deselect_btn.clicked.connect(
            lambda: self._deselect_all(self.voucher_table))
        btn_row.addWidget(deselect_btn)

        btn_row.addStretch()

        delete_selected_btn = _danger_btn("🗑 حذف المحدد")
        delete_selected_btn.clicked.connect(
            lambda: self._delete_selected("voucher", self.voucher_table))
        btn_row.addWidget(delete_selected_btn)

        lay.addLayout(btn_row)

        return tab

    # ============================================================
    # تبويب المطالبات المالية
    # ============================================================
    def _build_claims_tab(self) -> QWidget:
        tab = QWidget()
        lay = QVBoxLayout(tab)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(12)

        # شريط البحث
        search_row = QHBoxLayout()
        self.claim_search = QLineEdit()
        self.claim_search.setPlaceholderText("🔍 ابحث برقم المطالبة، العقد، المبلغ...")
        self.claim_search.setStyleSheet(f"""
            QLineEdit {{
                padding: 10px 15px;
                border: 2px solid {_COLORS['border']};
                border-radius: 8px;
                font-size: 14px;
            }}
            QLineEdit:focus {{
                border-color: {_COLORS['primary']};
            }}
        """)
        self.claim_search.returnPressed.connect(self._search_claims)
        search_row.addWidget(self.claim_search, 1)

        search_btn = _primary_btn("🔍 بحث")
        search_btn.clicked.connect(self._search_claims)
        search_row.addWidget(search_btn)

        lay.addLayout(search_row)

        # جدول النتائج
        self.claim_table = QTableWidget()
        self.claim_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.claim_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.claim_table.verticalHeader().setVisible(False)
        self.claim_table.setStyleSheet(f"""
            QTableWidget {{
                border: 1px solid {_COLORS['border']};
                border-radius: 6px;
                gridline-color: {_COLORS['border']};
            }}
            QHeaderView::section {{
                background: #E0E7FF;
                padding: 8px;
                border: none;
                border-bottom: 2px solid {_COLORS['primary']};
                font-weight: bold;
            }}
        """)
        self.claim_table.itemDoubleClicked.connect(
            lambda item: self._show_entity_details("claim", item))
        lay.addWidget(self.claim_table, 1)

        # أزرار الحذف
        btn_row = QHBoxLayout()
        select_all_btn = _primary_btn("☑ تحديد الكل")
        select_all_btn.clicked.connect(
            lambda: self._select_all(self.claim_table))
        btn_row.addWidget(select_all_btn)

        deselect_btn = _primary_btn("☐ إلغاء التحديد")
        deselect_btn.clicked.connect(
            lambda: self._deselect_all(self.claim_table))
        btn_row.addWidget(deselect_btn)

        btn_row.addStretch()

        delete_selected_btn = _danger_btn("🗑 حذف المحدد")
        delete_selected_btn.clicked.connect(
            lambda: self._delete_selected("claim", self.claim_table))
        btn_row.addWidget(delete_selected_btn)

        lay.addLayout(btn_row)

        return tab

    # ============================================================
    # البحث
    # ============================================================
    def _search_customers(self):
        query = self.customer_search.text().strip()
        if not query:
            style.error(self, "اكتب نصًا للبحث.")
            return
        results = cs.search_customers(query)
        self._populate_table(self.customer_table, results, "customer")

    def _search_subcontractors(self):
        query = self.sub_search.text().strip()
        if not query:
            style.error(self, "اكتب نصًا للبحث.")
            return
        results = cs.search_subcontractors(query)
        self._populate_table(self.sub_table, results, "subcontractor")

    def _search_contracts(self):
        query = self.contract_search.text().strip()
        if not query:
            style.error(self, "اكتب نصًا للبحث.")
            return
        results = cs.search_contracts(query)
        self._populate_table(self.contract_table, results, "contract")

    def _search_vouchers(self):
        query = self.voucher_search.text().strip()
        if not query:
            style.error(self, "اكتب نصًا للبحث.")
            return
        results = cs.search_vouchers(query)
        self._populate_table(self.voucher_table, results, "voucher")

    def _search_claims(self):
        query = self.claim_search.text().strip()
        if not query:
            style.error(self, "اكتب نصًا للبحث.")
            return
        results = cs.search_claims(query)
        self._populate_table(self.claim_table, results, "claim")

    def _populate_table(self, table: QTableWidget, results: list[dict],
                        entity_type: str):
        """ملء جدول بالنتائج."""
        table.clear()
        if not results:
            table.setRowCount(0)
            style.info(self, "لا توجد نتائج مطابقة.", "بحث")
            return

        # تحديد الرؤوس حسب النوع
        if entity_type == "customer":
            heads = ["☑", "المعرف", "الكود", "الاسم", "الهاتف"]
        elif entity_type == "subcontractor":
            heads = ["☑", "المعرف", "الكود", "الاسم", "الهاتف", "النشاط"]
        elif entity_type == "contract":
            heads = ["☑", "المعرف", "رقم العقد", "الوصف", "العميل", "المبلغ"]
        elif entity_type == "voucher":
            heads = ["☑", "المعرف", "رقم السند", "النوع", "المبلغ", "التاريخ"]
        elif entity_type == "claim":
            heads = ["☑", "المعرف", "رقم المطالبة", "الحالة", "المبلغ", "التاريخ"]
        else:
            heads = ["☑", "المعرف", "اسم", "معلومات"]

        table.setColumnCount(len(heads))
        table.setHorizontalHeaderLabels(heads)
        table.setRowCount(len(results))

        for i, row in enumerate(results):
            # مربع الاختيار
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Unchecked)
            chk.setData(Qt.UserRole, {"type": entity_type, "data": row})
            table.setItem(i, 0, chk)

            # المعرف
            id_item = QTableWidgetItem(str(row.get("id", "")))
            id_item.setTextAlignment(Qt.AlignCenter)
            table.setItem(i, 1, id_item)

            # باقي الأعمدة حسب النوع
            if entity_type == "customer":
                table.setItem(i, 2, QTableWidgetItem(row.get("customer_code", "")))
                table.setItem(i, 3, QTableWidgetItem(row.get("name", "")))
                table.setItem(i, 4, QTableWidgetItem(row.get("phone", "")))
            elif entity_type == "subcontractor":
                table.setItem(i, 2, QTableWidgetItem(row.get("sub_code", "")))
                table.setItem(i, 3, QTableWidgetItem(row.get("name", "")))
                table.setItem(i, 4, QTableWidgetItem(row.get("phone", "")))
                table.setItem(i, 5, QTableWidgetItem(row.get("activity", "")))
            elif entity_type == "contract":
                table.setItem(i, 2, QTableWidgetItem(row.get("contract_number", "")))
                table.setItem(i, 3, QTableWidgetItem(row.get("name", "")))
                table.setItem(i, 4, QTableWidgetItem(row.get("customer", "")))
                table.setItem(i, 5, QTableWidgetItem(f"{row.get('amount', 0):,.3f}"))
            elif entity_type == "voucher":
                table.setItem(i, 2, QTableWidgetItem(row.get("voucher_number", "")))
                table.setItem(i, 3, QTableWidgetItem(row.get("vtype", "")))
                table.setItem(i, 4, QTableWidgetItem(f"{row.get('amount', 0):,.3f}"))
                table.setItem(i, 5, QTableWidgetItem(row.get("voucher_date", "")))
            elif entity_type == "claim":
                table.setItem(i, 2, QTableWidgetItem(row.get("claim_number", "")))
                table.setItem(i, 3, QTableWidgetItem(row.get("status", "")))
                table.setItem(i, 4, QTableWidgetItem(f"{row.get('amount', 0):,.3f}"))
                table.setItem(i, 5, QTableWidgetItem(row.get("due_date", "")))

        table.resizeColumnsToContents()

    # ============================================================
    # التحديد والحذف
    # ============================================================
    def _select_all(self, table: QTableWidget):
        for i in range(table.rowCount()):
            item = table.item(i, 0)
            if item:
                item.setCheckState(Qt.Checked)

    def _deselect_all(self, table: QTableWidget):
        for i in range(table.rowCount()):
            item = table.item(i, 0)
            if item:
                item.setCheckState(Qt.Unchecked)

    def _delete_selected(self, entity_type: str, table: QTableWidget):
        """حذف العناصر المحددة."""
        selected = []
        for i in range(table.rowCount()):
            item = table.item(i, 0)
            if item and item.checkState() == Qt.Checked:
                data = item.data(Qt.UserRole)
                if data:
                    selected.append(data)

        if not selected:
            style.error(self, "لم يتم تحديد أي عنصر.")
            return

        # تأكيد الحذف
        count = len(selected)
        if not style.confirm(
                self,
                f"⚠️ هل أنت متأكد من حذف {count} عنصر؟\n"
                "هذا الإجراء لا يمكن التراجع عنه!",
                "تأكيد الحذف"):
            return

        # تنفيذ الحذف
        deleted = 0
        errors = []
        for item in selected:
            try:
                eid = item["data"]["id"]
                if entity_type == "customer":
                    cs.delete_customer(eid)
                elif entity_type == "subcontractor":
                    cs.delete_subcontractor(eid)
                elif entity_type == "contract":
                    cs.delete_contract(eid)
                elif entity_type == "voucher":
                    cs.delete_voucher(eid)
                elif entity_type == "claim":
                    cs.delete_claim(eid)
                deleted += 1
            except Exception as e:
                errors.append(str(e))

        # عرض النتيجة
        msg = f"✅ تم حذف {deleted} عنصر بنجاح."
        if errors:
            msg += f"\n❌ فشل حذف {len(errors)} عنصر:\n" + "\n".join(errors[:5])
        style.info(self, msg, "نتيجة الحذف")

        # إعادة البحث
        if entity_type == "customer":
            self._search_customers()
        elif entity_type == "subcontractor":
            self._search_subcontractors()
        elif entity_type == "contract":
            self._search_contracts()
        elif entity_type == "voucher":
            self._search_vouchers()
        elif entity_type == "claim":
            self._search_claims()

    # ============================================================
    # عرض التفاصيل
    # ============================================================
    def _show_entity_details(self, entity_type: str, item: QTableWidgetItem):
        """عرض تفاصيل العنصر عند النقر المزدوج."""
        row = item.row()
        table = item.tableWidget()
        id_item = table.item(row, 1)
        if not id_item:
            return

        eid = int(id_item.text())
        try:
            details = cs.get_entity_details(entity_type, eid)
            if details:
                self._display_details_popup(entity_type, details)
        except Exception as e:
            style.error(self, f"خطأ في جلب التفاصيل: {e}")

    def _display_details_popup(self, entity_type: str, details: dict):
        """عرض نافذة منبثقة بالتفاصيل."""
        dialog = QDialog(self)
        dialog.setWindowTitle("تفاصيل")
        dialog.setLayoutDirection(Qt.RightToLeft)
        dialog.setMinimumSize(500, 400)

        lay = QVBoxLayout(dialog)

        # عرض البيانات
        text = ""
        for key, val in details.items():
            text += f"<b>{key}:</b> {val}<br>"

        label = QLabel(text)
        label.setWordWrap(True)
        label.setTextFormat(Qt.RichText)
        lay.addWidget(label)

        # زر إغلاق
        close_btn = QPushButton("إغلاق")
        close_btn.clicked.connect(dialog.close)
        lay.addWidget(close_btn)

        dialog.exec()

    # ============================================================
    # التقرير
    # ============================================================
    def _show_report(self):
        """عرض التقرير الشامل."""
        dialog = QDialog(self)
        dialog.setWindowTitle("📊 تقرير شامل")
        dialog.setLayoutDirection(Qt.RightToLeft)
        dialog.setMinimumSize(600, 500)

        lay = QVBoxLayout(dialog)

        try:
            report = cs.get_full_report()
            text = "<h2>📊 تقرير قاعدة البيانات</h2><hr>"
            for section, data in report.items():
                text += f"<h3>{section}</h3><ul>"
                for key, val in data.items():
                    text += f"<li><b>{key}:</b> {val}</li>"
                text += "</ul>"

            label = QLabel(text)
            label.setWordWrap(True)
            label.setTextFormat(Qt.RichText)
            scroll = QScrollArea()
            scroll.setWidget(label)
            scroll.setWidgetResizable(True)
            lay.addWidget(scroll)
        except Exception as e:
            label = QLabel(f"خطأ في جلب التقرير: {e}")
            lay.addWidget(label)

        close_btn = QPushButton("إغلاق")
        close_btn.clicked.connect(dialog.close)
        lay.addWidget(close_btn)

        dialog.exec()


# ============================================================
# نافذة التقرير
# ============================================================
class CleanupReportDialog(QDialog):
    """نافذة التقرير الشامل."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("📊 تقرير تنظيف البيانات")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumSize(800, 600)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(16, 16, 16, 16)
        lay.setSpacing(12)

        # عنوان
        title = QLabel("📊 تقرير شامل — قاعدة البيانات")
        title.setProperty("sectionTitle", True)
        lay.addWidget(title)

        # منطقة التقرير
        self.report_area = QScrollArea()
        self.report_area.setWidgetResizable(True)
        self.report_widget = QWidget()
        self.report_layout = QVBoxLayout(self.report_widget)
        self.report_layout.setContentsMargins(16, 16, 16, 16)
        self.report_layout.setSpacing(16)
        self.report_area.setWidget(self.report_widget)
        lay.addWidget(self.report_area, 1)

        # زر إغلاق
        close_btn = QPushButton("إغلاق")
        close_btn.clicked.connect(self.close)
        lay.addWidget(close_btn)

        self._load_report()

    def _load_report(self):
        """تحميل التقرير."""
        try:
            report = cs.get_full_report()
            # مسح القديم
            while self.report_layout.count():
                child = self.report_layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()

            # عرض التقرير
            text = ""
            for section, data in report.items():
                text += f"<h3>{section}</h3><ul>"
                for key, val in data.items():
                    text += f"<li><b>{key}:</b> {val}</li>"
                text += "</ul>"

            label = QLabel(text)
            label.setWordWrap(True)
            label.setTextFormat(Qt.RichText)
            self.report_layout.addWidget(label)
            self.report_layout.addStretch()
        except Exception as e:
            label = QLabel(f"خطأ: {e}")
            self.report_layout.addWidget(label)
