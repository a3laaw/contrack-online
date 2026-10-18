# -*- coding: utf-8 -*-
"""مثال على تطبيق نظام التصميم الموحد على شاشة تصفيية العهدة."""

from PySide6.QtCore import Qt, QDate
from PySide6.QtWidgets import (
    QComboBox, QDialog, QFrame, QHBoxLayout, QLabel,
    QLineEdit, QPushButton, QScrollArea, QTableWidget,
    QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget,
)

from ui.design_system import Colors, Dimensions, Fonts, Styles


class CustodySettlementStyledDialog(QDialog):
    """تصفية عهدة — بتصميم موحد."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("تصفية عهدة")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumSize(1200, 750)
        self.resize(1300, 850)
        self.setStyleSheet(f"QDialog {{ background: {Colors.BG}; }}")

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ===== الترويسة =====
        banner = QFrame()
        banner.setFixedHeight(80)
        banner.setStyleSheet(Styles.banner())
        banner_lay = QVBoxLayout(banner)
        banner_lay.setContentsMargins(24, 16, 24, 16)
        banner_lay.setSpacing(4)

        title = QLabel("تصفية عهدة  ✅")
        title.setStyleSheet(f"""
            color: white; font-size: 20px; font-weight: {Fonts.WEIGHT_BOLD};
            background: transparent; border: none;
        """)
        subtitle = QLabel("تسجيل مصروفات فعلية من عهدة قائمة — بندًا وراء بند")
        subtitle.setStyleSheet(f"""
            color: #E0E7FF; font-size: {Fonts.CAPTION}px;
            background: transparent; border: none;
        """)
        banner_lay.addWidget(title)
        banner_lay.addWidget(subtitle)
        root.addWidget(banner)

        # ===== المحتوى =====
        content = QWidget()
        content.setStyleSheet(f"background: {Colors.BG};")
        content_lay = QVBoxLayout(content)
        content_lay.setContentsMargins(20, 20, 20, 20)
        content_lay.setSpacing(16)

        # ===== صف المعلومات العلوي =====
        info_row = QHBoxLayout()
        info_row.setSpacing(12)

        # بطاقة التاريخ
        date_card = self._create_info_card("التاريخ", "2026-10-08")
        info_row.addWidget(date_card)

        # بطاقة حساب العهدة
        custody_card = self._create_info_card("حساب العهدة", "عهدة موظف - أحمد")
        info_row.addWidget(custody_card, 1)

        # بطاقة الرصيد
        balance_card = self._create_stat_card("الرصيد الحالي", "5,000.000 د.ك", Colors.INFO)
        info_row.addWidget(balance_card)

        # بطاقة البيان
        desc_card = self._create_info_card("بيان عام", "تصفية شهر أكتوبر")
        info_row.addWidget(desc_card, 2)

        content_lay.addLayout(info_row)

        # ===== القسم السفلي: النموذج + القائمة =====
        main_row = QHBoxLayout()
        main_row.setSpacing(16)

        # ===== نموذج البند الحالي =====
        form_card = QFrame()
        form_card.setStyleSheet(Styles.card())
        form_card.setFixedWidth(380)
        form_lay = QVBoxLayout(form_card)
        form_lay.setContentsMargins(16, 16, 16, 16)
        form_lay.setSpacing(12)

        form_title = QLabel("✎ بند التصفية الحالي")
        form_title.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.PRIMARY};
            background: transparent; border: none;
        """)
        form_lay.addWidget(form_title)

        # حقول النموذج
        form_lay.addWidget(self._create_label("تاريخ الفاتورة"))
        self.date_input = QLineEdit()
        self.date_input.setPlaceholderText("yyyy-MM-dd")
        self.date_input.setStyleSheet(Styles.input_field())
        form_lay.addWidget(self.date_input)

        form_lay.addWidget(self._create_label("حساب المصروف *"))
        self.expense_combo = QComboBox()
        self.expense_combo.setStyleSheet(Styles.input_field())
        form_lay.addWidget(self.expense_combo)

        form_lay.addWidget(self._create_label("المورد / الجهة"))
        self.supplier_input = QLineEdit()
        self.supplier_input.setPlaceholderText("اسم المورد أو الجهة")
        self.supplier_input.setStyleSheet(Styles.input_field())
        form_lay.addWidget(self.supplier_input)

        form_lay.addWidget(self._create_label("المبلغ *"))
        self.amount_input = QLineEdit()
        self.amount_input.setPlaceholderText("0.000")
        self.amount_input.setStyleSheet(Styles.input_field())
        form_lay.addWidget(self.amount_input)

        form_lay.addWidget(self._create_label("البيان"))
        self.desc_input = QTextEdit()
        self.desc_input.setPlaceholderText("وصف البند...")
        self.desc_input.setFixedHeight(60)
        self.desc_input.setStyleSheet(Styles.input_field())
        form_lay.addWidget(self.desc_input)

        # أزرار النموذج
        btn_row = QHBoxLayout()
        btn_row.setSpacing(8)

        add_btn = QPushButton("＋ إضافة بند")
        add_btn.setStyleSheet(Styles.button_primary())
        btn_row.addWidget(add_btn)

        clear_btn = QPushButton("مسح")
        clear_btn.setStyleSheet(Styles.button_secondary())
        btn_row.addWidget(clear_btn)

        form_lay.addLayout(btn_row)
        form_lay.addStretch()

        main_row.addWidget(form_card)

        # ===== قائمة البنود =====
        list_card = QFrame()
        list_card.setStyleSheet(Styles.card())
        list_lay = QVBoxLayout(list_card)
        list_lay.setContentsMargins(16, 16, 16, 16)
        list_lay.setSpacing(12)

        list_header = QHBoxLayout()
        list_title = QLabel("📋 بنود التصفية")
        list_title.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.TEXT};
            background: transparent; border: none;
        """)
        list_header.addWidget(list_title)
        list_header.addStretch()

        count_lbl = QLabel("العدد: 0")
        count_lbl.setStyleSheet(f"""
            background: {Colors.INFO_BG}; color: {Colors.INFO};
            padding: 4px 12px; border-radius: {Dimensions.RADIUS_SM}px;
            font-weight: {Fonts.WEIGHT_BOLD};
        """)
        list_header.addWidget(count_lbl)
        list_lay.addLayout(list_header)

        # جدول البنود
        self.items_table = QTableWidget()
        self.items_table.setColumnCount(7)
        self.items_table.setHorizontalHeaderLabels([
            "م", "التاريخ", "الحساب", "المورد", "العقد", "المبلغ", "حذف"
        ])
        self.items_table.setStyleSheet(Styles.table())
        self.items_table.verticalHeader().setVisible(False)
        self.items_table.setAlternatingRowColors(True)
        list_lay.addWidget(self.items_table, 1)

        # ملخص
        summary_frame = QFrame()
        summary_frame.setStyleSheet(f"""
            QFrame {{
                background: {Colors.PRIMARY}08;
                border: 1.5px solid {Colors.PRIMARY}30;
                border-radius: {Dimensions.RADIUS_MD}px;
                padding: 10px;
            }}
        """)
        summary_lay = QHBoxLayout(summary_frame)
        summary_lay.setContentsMargins(12, 8, 12, 8)

        total_label = QLabel("الإجمالي: 0.000 د.ك")
        total_label.setStyleSheet(f"""
            font-size: {Fonts.SUBTITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.PRIMARY};
            background: transparent; border: none;
        """)
        summary_lay.addWidget(total_label)
        summary_lay.addStretch()

        remaining_label = QLabel("الرصيد بعد التصفية: 5,000.000 د.ك")
        remaining_label.setStyleSheet(f"""
            font-size: {Fonts.BODY}px;
            font-weight: {Fonts.WEIGHT_SEMIBOLD};
            color: {Colors.SUCCESS};
            background: transparent; border: none;
        """)
        summary_lay.addWidget(remaining_label)

        list_lay.addWidget(summary_frame)
        main_row.addWidget(list_card, 1)

        content_lay.addLayout(main_row, 1)

        # ===== أزرار الحفظ =====
        footer = QFrame()
        footer.setStyleSheet(f"""
            QFrame {{
                background: {Colors.CARD};
                border-top: 1px solid {Colors.BORDER};
                padding: 12px;
            }}
        """)
        footer_lay = QHBoxLayout(footer)
        footer_lay.setContentsMargins(20, 12, 20, 12)

        footer_lay.addStretch()

        cancel_btn = QPushButton("إلغاء")
        cancel_btn.setStyleSheet(Styles.button_secondary())
        cancel_btn.setFixedWidth(120)
        footer_lay.addWidget(cancel_btn)

        save_btn = QPushButton("💾 حفظ التصفية")
        save_btn.setStyleSheet(Styles.button_success())
        save_btn.setFixedWidth(160)
        footer_lay.addWidget(save_btn)

        root.addWidget(content, 1)
        root.addWidget(footer)

    def _create_label(self, text: str) -> QLabel:
        """إنشاء تسمية."""
        lbl = QLabel(text)
        lbl.setStyleSheet(f"""
            font-size: {Fonts.CAPTION}px;
            font-weight: {Fonts.WEIGHT_SEMIBOLD};
            color: {Colors.TEXT_SECONDARY};
            background: transparent; border: none;
        """)
        return lbl

    def _create_info_card(self, title: str, value: str) -> QFrame:
        """بطاقة معلومات."""
        card = QFrame()
        card.setStyleSheet(Styles.card())
        lay = QVBoxLayout(card)
        lay.setContentsMargins(12, 8, 12, 10)
        lay.setSpacing(4)

        title_lbl = QLabel(title)
        title_lbl.setStyleSheet(f"""
            font-size: {Fonts.SMALL}px;
            font-weight: {Fonts.WEIGHT_SEMIBOLD};
            color: {Colors.MUTED};
            background: transparent; border: none;
        """)
        lay.addWidget(title_lbl)

        value_lbl = QLabel(value)
        value_lbl.setStyleSheet(f"""
            font-size: {Fonts.BODY}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.TEXT};
            background: transparent; border: none;
        """)
        lay.addWidget(value_lbl)

        return card

    def _create_stat_card(self, title: str, value: str, color: str) -> QFrame:
        """بطاقة إحصائية ملونة."""
        card = QFrame()
        card.setStyleSheet(Styles.stat_card(color))
        lay = QVBoxLayout(card)
        lay.setContentsMargins(12, 8, 12, 10)
        lay.setSpacing(4)

        title_lbl = QLabel(title)
        title_lbl.setStyleSheet(f"""
            font-size: {Fonts.SMALL}px;
            font-weight: {Fonts.WEIGHT_SEMIBOLD};
            color: {color};
            background: transparent; border: none;
        """)
        lay.addWidget(title_lbl)

        value_lbl = QLabel(value)
        value_lbl.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {color};
            background: transparent; border: none;
        """)
        lay.addWidget(value_lbl)

        return card


# ============================================================
# تشغيل المثال
# ============================================================
if __name__ == "__main__":
    import sys
    from PySide6.QtWidgets import QApplication

    app = QApplication(sys.argv)
    app.setLayoutDirection(Qt.RightToLeft)

    # تطبيق الستايل الموحد
    from ui.design_system import apply_global_style
    apply_global_style(app)

    dlg = CustodySettlementStyledDialog()
    dlg.show()

    sys.exit(app.exec())
