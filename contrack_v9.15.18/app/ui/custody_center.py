# -*- coding: utf-8 -*-
"""شاشة العُهد: التصفيات والأرصدة — مستقلة عن سندات الصرف.

بنود تصفية العهدة لا تظهر في شاشة سندات الصرف (تُستبعد من القائمة)،
وتُعرض هنا كمجموعة واحدة قابلة للطباعة ككشف رسمي كامل.

ملاحظة: **سند تسليم العهدة يبقى ظاهرًا في سندات الصرف** لأنه صرف نقدي
فعلي خرج من الخزينة؛ أما التصفية فهي توزيع لمبلغ سبق صرفه.
"""
import os
import tempfile

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QDialog, QFormLayout, QFrame, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QMenu,
    QPushButton, QScrollArea, QTableWidget,
    QTableWidgetItem, QTabWidget, QTextEdit, QVBoxLayout, QWidget,
)

from services import lifecycle_service as lc
from ui import style



def _custody_default_desc() -> str:
    """النص الافتراضي لتسليم العهدة مع بادئة الإعدادات."""
    try:
        from services.extras_service import apply_description_prefix
        return apply_description_prefix("custody", "تسليم عهدة")
    except Exception:
        return "تسليم عهدة"



# V3.15: مطابقة النموذج — ثيم حوار التصفية.
_SETTLE_CARD_QSS = ("QFrame { background: white; border: 1px solid #E3E6F0;"
                    " border-radius: 10px; }")
_SETTLE_INPUT_QSS = (
    "QLineEdit, QComboBox, QDateEdit, QTextEdit, QAbstractSpinBox {"
    " background: white; border: 1px solid #D5DAE8; border-radius: 7px;"
    " padding: 5px 8px; min-height: 24px; font-size: 12px; }"
    "QLineEdit:focus, QComboBox:focus, QDateEdit:focus, QTextEdit:focus,"
    " QAbstractSpinBox:focus { border: 1px solid #4F46E5; }")
_SETTLE_TABLE_QSS = (
    "QTableWidget { background: white; alternate-background-color: #F6F8FC;"
    " border: 1px solid #E3E6F0; border-radius: 8px;"
    " gridline-color: #EDF0F7; font-size: 12px; }"
    "QTableWidget::item { padding: 3px; }"
    "QTableWidget::item:selected { background: #E0E7FF; color: #1E1B4B; }"
    "QHeaderView::section { background: #EEF0FA; color: #3730A3;"
    " font-weight: 800; border: none; border-bottom: 2px solid #C7D2FE;"
    " padding: 6px; font-size: 12px; }")
_SETTLE_PILL_QSS = ("background: white; border: 1px solid #E3E6F0;"
                    " border-radius: 8px; padding: 7px 12px; font-weight: 800;")


def _auto_settlement_desc(acc_name: str, cust_name: str = "",
                          party: str = "") -> str:
    """V9.15: بيان احتياطي لبند التصفية إذا تُرك فارغًا — العميل + المصروف."""
    parts = [(p or "").strip() for p in (cust_name, acc_name)]
    text = " — ".join(p for p in parts if p)
    return text or (party or "").strip() or "تصفية عهدة"


class CustodySettlementDialog(QDialog):
    """تصفية عهدة — نموذج بند + قائمة (V3.13: بدل الجدول الثُماني).

    إدخال مريح بندًا وراء بند: النموذج الأيمن للبند الحالي، والقائمة
    اليسرى للبنود المضافة (الضغط على بند يحمّله للتعديل). الرصيد الحالي
    والرصيد بعد التصفية ظاهران دائمًا. نفس الحفظ والخدمة تمامًا.
    """

    LIST_HEADS = ["م", "تاريخ الفاتورة", "حساب المصروف", "المورد/الجهة",
                  "العميل / العقد", "المبلغ", "البيان", "حذف"]

    def __init__(self, parent=None):
        super().__init__(parent)
        from ui.design_system import Colors, Dimensions, Fonts, Styles
        
        self.setLayoutDirection(Qt.RightToLeft)
        self.setWindowTitle("تصفية عهدة")
        self.setStyleSheet(f"CustodySettlementDialog {{ background: {Colors.BG}; }}")
        
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        self.root_layout = root
        
        # ===== الترويسة بتدرج لوني =====
        banner = QFrame()
        banner.setFixedHeight(80)
        banner.setStyleSheet(Styles.banner())
        blay = QVBoxLayout(banner)
        blay.setContentsMargins(24, 16, 24, 16)
        blay.setSpacing(4)
        
        _bt = QLabel("تصفية عهدة  ✅")
        _bt.setStyleSheet(f"""
            color: white; font-size: 20px; font-weight: {Fonts.WEIGHT_BOLD};
            background: transparent; border: none;
        """)
        _bs = QLabel("تصفية — بندًا وراء بند")
        _bs.setStyleSheet(f"""
            color: #E0E7FF; font-size: {Fonts.CAPTION}px;
            background: transparent; border: none;
        """)
        blay.addWidget(_bt)
        blay.addWidget(_bs)
        root.addWidget(banner)
        # ===== المحتوى الرئيسي مع شريط إزاحة =====
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet(f"QScrollArea {{ border: none; background: {Colors.BG}; }}")
        content = QWidget()
        content.setStyleSheet(f"background: {Colors.BG};")
        content_lay = QVBoxLayout(content)
        content_lay.setContentsMargins(20, 20, 20, 20)
        content_lay.setSpacing(16)
        self.body_layout = content_lay
        scroll.setWidget(content)
        root.addWidget(scroll, 1)
        lay = content_lay
        
        try:
            from ui.widgets import SafeDateEdit
        except Exception:
            from PySide6.QtWidgets import QDateEdit as SafeDateEdit
        from PySide6.QtCore import QDate
        from services import expense_account_service as ea

        # ===== صف المعلومات العلوي =====
        top = QHBoxLayout()
        top.setSpacing(12)
        
        self.vdate = SafeDateEdit()
        self.vdate.setCalendarPopup(True)
        self.vdate.setDisplayFormat("yyyy-MM-dd")
        self.vdate.setDate(QDate.currentDate())
        
        self.custody = QComboBox()
        for text, aid in ea.custody_items():
            self.custody.addItem(text, aid)
        self.custody.setCurrentIndex(-1)
        from ui.widgets import make_searchable
        make_searchable(self.custody, "")
        self.custody.currentIndexChanged.connect(lambda *_: self._summary())
        
        self.balance_lbl = QLabel("الرصيد الحالي: —")
        self.balance_lbl.setAlignment(Qt.AlignCenter)
        self.balance_lbl.setStyleSheet(f"""
            background: {Colors.INFO_BG}; color: {Colors.INFO};
            border-radius: {Dimensions.RADIUS_MD}px;
            padding: 8px 12px;
            font-weight: {Fonts.WEIGHT_BOLD};
            font-size: {Fonts.BODY}px;
        """)
        
        self.desc = QTextEdit()
        self.desc.setPlaceholderText("بيان عام اختياري للتصفية")
        self.desc.setFixedHeight(52)
        self.desc.setMinimumWidth(250)
        
        def _top_card(caption, widget, stretch=0):
            """بطاقة معلومات في الصف العلوي."""
            card = QFrame()
            card.setStyleSheet(Styles.card())
            vl = QVBoxLayout(card)
            vl.setContentsMargins(12, 8, 12, 10)
            vl.setSpacing(4)
            cap = QLabel(caption)
            cap.setStyleSheet(f"""
                color: {Colors.MUTED};
                font-size: {Fonts.CAPTION}px;
                font-weight: {Fonts.WEIGHT_SEMIBOLD};
                background: transparent; border: none;
            """)
            vl.addWidget(cap)
            vl.addWidget(widget)
            top.addWidget(card, stretch)
        
        _top_card("التاريخ", self.vdate)
        _top_card("حساب العهدة *", self.custody, 1)
        _top_card("الرصيد الحالي", self.balance_lbl)
        _top_card("بيان عام (اختياري)", self.desc, 2)
        lay.addLayout(top)

        # ===== نموذج البند + القائمة =====
        mid = QHBoxLayout()
        mid.setSpacing(16)
        
        # ===== نموذج البند الحالي =====
        form_box = QFrame()
        form_box.setStyleSheet(Styles.card())
        form_box.setFixedWidth(400)
        form_box.setMaximumWidth(440)
        
        form_lay = QVBoxLayout(form_box)
        form_lay.setContentsMargins(16, 16, 16, 16)
        form_lay.setSpacing(10)
        
        form_title = QLabel("✎ بند التصفية الحالي")
        form_title.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.PRIMARY};
            background: transparent; border: none;
        """)
        form_lay.addWidget(form_title)
        form = QFormLayout()
        form.setSpacing(10)
        
        self.f_date = SafeDateEdit()
        self.f_date.setCalendarPopup(True)
        self.f_date.setDisplayFormat("yyyy-MM-dd")
        self.f_date.setDate(QDate.currentDate())
        self.f_date.setStyleSheet(Styles.input_field())
        
        self.f_acc = self._account_combo()
        self.f_acc.setStyleSheet(Styles.input_field())
        
        from ui.widgets import SearchableComboBox, customer_items, SafeDoubleSpinBox
        
        self.f_amount = SafeDoubleSpinBox()
        self.f_amount.setDecimals(3)
        self.f_amount.setRange(0, 9999999)
        self.f_amount.setStyleSheet(f"""
            font-size: 15px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.PRIMARY};
            background: {Colors.PRIMARY_BG};
            border: 1.5px solid {Colors.PRIMARY}30;
            border-radius: {Dimensions.RADIUS_MD}px;
            padding: 8px;
        """)
        
        self.f_party = QLineEdit()
        self.f_party.setPlaceholderText("اسم المورد أو الجهة")
        self.f_party.setStyleSheet(Styles.input_field())
        
        self.f_cust = SearchableComboBox(search_only=True)
        self.f_cust.set_items(customer_items(), auto_select=False)
        self.f_cust.setCurrentIndex(-1)
        self.f_cust.lineEdit().setText("")
        self.f_cust.setStyleSheet(Styles.input_field())
        
        self.f_con = SearchableComboBox(open_on_click=True)
        self.f_con.set_items([], auto_select=False)
        self.f_con.setCurrentIndex(-1)
        self.f_con.lineEdit().setText("")
        self.f_con.setStyleSheet(Styles.input_field())
        
        self.f_cust.selection_changed.connect(self._reload_contracts)
        
        self.f_desc = QLineEdit()
        self.f_desc.setPlaceholderText("بيان هذا البند")
        self.f_desc.setStyleSheet(Styles.input_field())
        
        def _flabel(text, req=False):
            """تسمية حقل مع نجمة للمطلوب."""
            star = f' <span style="color:{Colors.DANGER};">*</span>' if req else ""
            lb = QLabel(f"<b>{text}</b>{star}")
            lb.setStyleSheet(f"""
                background: transparent; border: none;
                font-size: {Fonts.CAPTION}px;
                color: {Colors.TEXT_SECONDARY};
            """)
            return lb
        
        form.addRow(_flabel("حساب المصروف", True), self.f_acc)
        form.addRow(_flabel("المبلغ (د.ك)", True), self.f_amount)
        form.addRow(_flabel("تاريخ الفاتورة"), self.f_date)
        form.addRow(_flabel("المورد/الجهة"), self.f_party)
        form.addRow(_flabel("العميل"), self.f_cust)
        form.addRow(_flabel("العقد"), self.f_con)
        form.addRow(_flabel("بيان البند"), self.f_desc)
        form_lay.addLayout(form)
        row_btns = QHBoxLayout()
        row_btns.setSpacing(8)

        self.add_btn = QPushButton("＋ إضافة البند للقائمة")
        self.add_btn.setMinimumHeight(40)
        self.add_btn.setStyleSheet(Styles.button_primary())
        self.add_btn.setCursor(Qt.PointingHandCursor)
        self.add_btn.clicked.connect(self._add_line)

        self.clear_btn = QPushButton("مسح النموذج")
        self.clear_btn.setMinimumHeight(40)
        self.clear_btn.setStyleSheet(Styles.button_secondary())
        self.clear_btn.setCursor(Qt.PointingHandCursor)
        self.clear_btn.clicked.connect(self._confirm_clear)
        row_btns.addWidget(self.add_btn, 3)
        row_btns.addWidget(self.clear_btn, 1)
        form_lay.addLayout(row_btns)
        self.form_hint = QLabel("لأكثر من بند: املأ ← أضف ← املأ التالي… ثم احفظ الكل مرة واحدة.")
        self.form_hint.setWordWrap(True)
        self.form_hint.setStyleSheet(f"""
            color: {Colors.MUTED};
            font-size: {Fonts.CAPTION}px;
            background: transparent; border: none;
            padding: 8px;
        """)
        form_lay.addWidget(self.form_hint)
        form_lay.addStretch()
        mid.addWidget(form_box)

        # ===== قائمة البنود =====
        list_card = QFrame()
        list_card.setStyleSheet(Styles.card())
        
        list_lay = QVBoxLayout(list_card)
        list_lay.setContentsMargins(16, 16, 16, 16)
        list_lay.setSpacing(12)
        
        list_title = QLabel("📋 بنود التصفية — اضغط أي بند لتعديله")
        list_title.setStyleSheet(f"""
            font-size: {Fonts.TITLE}px;
            font-weight: {Fonts.WEIGHT_BOLD};
            color: {Colors.TEXT};
            background: transparent; border: none;
        """)
        list_lay.addWidget(list_title)
        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(self.LIST_HEADS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setAlternatingRowColors(True)
        self.table.setStyleSheet(Styles.table())
        self.table.verticalHeader().setDefaultSectionSize(35)
        from ui.widgets import fit_table_with_floors as _ftwf3
        _ftwf3(self.table, [44, 110, 180, 140, 180, 115, 220, 50],
               [40, 100, 150, 110, 140, 100, 150, 44], 6)
        self.table.cellClicked.connect(lambda r, _c: self._load_line(r))
        list_lay.addWidget(self.table, 1)
        mid.addWidget(list_card, 1)
        lay.addLayout(mid, 1)

        # ===== ملخص البنود =====
        pills = QHBoxLayout()
        pills.setSpacing(12)
        
        self.total_lbl = QLabel("الإجمالي: 0.000 د.ك · عدد البنود: 0")
        self.total_lbl.setAlignment(Qt.AlignCenter)
        self.total_lbl.setStyleSheet(f"""
            background: {Colors.CARD};
            border: 1.5px solid {Colors.BORDER};
            border-radius: {Dimensions.RADIUS_MD}px;
            padding: 10px 16px;
            font-weight: {Fonts.WEIGHT_BOLD};
            font-size: {Fonts.BODY}px;
            color: {Colors.TEXT};
        """)
        
        self.after_lbl = QLabel("")
        self.after_lbl.setAlignment(Qt.AlignCenter)
        self.after_lbl.setStyleSheet(f"""
            background: {Colors.SUCCESS_BG};
            border: 1.5px solid {Colors.SUCCESS}30;
            border-radius: {Dimensions.RADIUS_MD}px;
            padding: 10px 16px;
            font-weight: {Fonts.WEIGHT_BOLD};
            font-size: {Fonts.BODY}px;
            color: {Colors.SUCCESS};
        """)
        
        pills.addWidget(self.total_lbl, 1)
        pills.addWidget(self.after_lbl, 1)
        list_lay.addLayout(pills)
        
        # ===== أزرار الحفظ =====
        save_btn, _cancel_btn = style.dialog_buttons(self, "💾 حفظ التصفية", on_save=self._save)
        save_btn.setMinimumHeight(42)
        save_btn.setStyleSheet(Styles.button_success())
        _cancel_btn.setMinimumHeight(42)
        _cancel_btn.setStyleSheet(Styles.button_secondary())
        self._lines: list[dict] = []
        self._editing: int | None = None
        self._selected: int | None = None
        self._summary()
        self._fit_to_content()

    def _fit_to_content(self):
        """V9.15.2: النافذة تتكيف مع حجم الخانات والأعمدة بدل الحجم الثابت."""
        from PySide6.QtWidgets import QApplication, QHeaderView
        h = self.table.horizontalHeader()
        for c in range(self.table.columnCount()):
            h.setSectionResizeMode(c, QHeaderView.ResizeToContents)
        h.setSectionResizeMode(6, QHeaderView.Stretch)  # البيان يتمدد
        screen = QApplication.primaryScreen().availableGeometry()
        hint = self.sizeHint()
        w = min(max(hint.width(), 900), int(screen.width() * 0.92))
        hh = min(max(hint.height(), 600), int(screen.height() * 0.92))
        self.resize(w, hh)

    def _confirm_clear(self):
        """V9.15.2: مسح النموذج بعد تأكيد حتى لا يضيع إدخال بالخطأ."""
        if style.confirm(self, "هل تريد مسح بيانات النموذج الحالي؟\n"
                               "البنود المضافة للقائمة لن تتأثر."):
            self._clear_form()

    def _account_combo(self):
        from ui.vouchers import ExpenseAccountCombo
        cb = ExpenseAccountCombo("")
        cb.setMinimumWidth(170)
        try:
            from services import expense_account_service as ea
            cb.set_items(ea.posting_items(), auto_select=False)
        except Exception:
            cb.set_items([], auto_select=False)
        return cb

    def _reload_contracts(self):
        from ui.widgets import contract_items
        cid = self.f_cust.selected_data()
        self.f_con.set_items(contract_items(customer_id=cid) if cid else [], auto_select=False)
        self.f_con.setCurrentIndex(-1); self.f_con.lineEdit().setText("")

    def _form_line(self) -> dict | None:
        acc_id = self.f_acc.selected_data()
        amount = round(float(self.f_amount.value() or 0), 3)
        if not acc_id:
            style.error(self, "اختر حساب المصروف للبند.")
            return None
        if amount <= 0:
            style.error(self, "مبلغ البند يجب أن يكون أكبر من صفر.")
            return None
        cust_id = self.f_cust.selected_data()
        con_id = self.f_con.selected_data()
        return {
            "vdate": self.f_date.date().toString("yyyy-MM-dd"),
            "expense_account_id": acc_id,
            "acc_name": self.f_acc.currentText().strip(),
            "party": self.f_party.text().strip(),
            "expense_customer_id": cust_id,
            "cust_name": self.f_cust.currentText().strip() if cust_id else "",
            "project_id": None,
            "contract_id": con_id,
            "con_name": self.f_con.currentText().strip() if con_id else "",
            "amount": amount,
            "description": self.f_desc.text().strip(),
        }

    def _add_line(self):
        line = self._form_line()
        if line is None:
            return
        if self._editing is None:
            self._lines.append(line)
        else:
            self._lines[self._editing] = line
        self._clear_form()
        self._refresh_lines()

    def _clear_form(self):
        self.f_acc.setCurrentIndex(-1)
        try:
            self.f_acc.lineEdit().setText("")
        except Exception:
            pass
        self.f_amount.setValue(0)
        self.f_date.setDate(self.vdate.date())
        self.f_party.setText("")
        self.f_cust.setCurrentIndex(-1); self.f_cust.lineEdit().setText("")
        self.f_con.set_items([], auto_select=False); self.f_con.setCurrentIndex(-1); self.f_con.lineEdit().setText("")
        self.f_desc.setText("")
        self._editing = None
        self.add_btn.setText("＋ إضافة البند للقائمة")

    def _load_line(self, row: int):
        if not (0 <= row < len(self._lines)):
            return
        self._selected = row
        line = self._lines[row]
        from PySide6.QtCore import QDate
        self.f_date.setDate(QDate.fromString(line["vdate"], "yyyy-MM-dd"))
        try:
            self.f_acc.setCurrentIndex(self.f_acc.findData(line["expense_account_id"]))
        except Exception:
            pass
        self.f_amount.setValue(line["amount"])
        self.f_party.setText(line["party"])
        try:
            if line["expense_customer_id"]:
                self.f_cust.select_data(line["expense_customer_id"])
            else:
                self.f_cust.setCurrentIndex(-1); self.f_cust.lineEdit().setText("")
            self._reload_contracts()
            if line["contract_id"]:
                self.f_con.select_data(line["contract_id"])
        except Exception:
            pass
        self.f_desc.setText(line["description"])
        self._editing = row
        self.add_btn.setText("✔ تحديث البند")

    def _refresh_lines(self):
        from PySide6.QtWidgets import QTableWidgetItem as _QTI
        self.table.setRowCount(0)
        for i, line in enumerate(self._lines):
            r = self.table.rowCount(); self.table.insertRow(r)
            who = " — ".join(x for x in (line["cust_name"], line["con_name"]) if x) or "—"
            cells = [str(i + 1), line["vdate"], line["acc_name"], line["party"] or "—",
                     who, f"{line['amount']:,.3f}", line["description"] or "—"]
            for c, txt in enumerate(cells):
                it = _QTI(txt)
                it.setTextAlignment(Qt.AlignCenter if c != 2 else (Qt.AlignRight | Qt.AlignVCenter))
                if c == 5:
                    _f = it.font(); _f.setBold(True); it.setFont(_f)
                self.table.setItem(r, c, it)
            from ui.design_system import Styles as _S
            _del = QPushButton("🗑")
            _del.setCursor(Qt.PointingHandCursor)
            # زر صغير مستقل التنسيق (لا يتأثر بالحد الأدنى لأزرار النماذج)
            _del.setStyleSheet(
                "QPushButton { background:#FEE2E2; color:#991B1B; "
                "border:1px solid #FCA5A5; border-radius:6px; "
                "padding:0px; min-height:0px; font-size:13px; }"
                "QPushButton:hover { background:#FECACA; }")
            _del.setFixedSize(36, 26)
            _del.setToolTip("حذف هذا البند من التصفية قبل الحفظ")
            _del.clicked.connect(lambda _=False, idx=i: self._delete_at(idx))
            # الغلاف يملأ الخلية، والزر يبقى بحجمه الصغير في الوسط
            _wrap = QWidget()
            _wl = QHBoxLayout(_wrap)
            _wl.setContentsMargins(2, 2, 2, 2)
            _wl.addStretch(); _wl.addWidget(_del); _wl.addStretch()
            self.table.setCellWidget(r, 7, _wrap)
        self._summary()

    def _delete_at(self, row: int):
        """V9.15: حذف بند من القائمة (قبل الحفظ فقط) بزر الصف نفسه."""
        if not (0 <= row < len(self._lines)):
            return
        del self._lines[row]
        if self._selected is not None:
            if self._selected == row:
                self._selected = None
            elif self._selected > row:
                self._selected -= 1
        if self._editing is not None:
            if self._editing == row:
                self._clear_form()
            elif self._editing > row:
                self._editing -= 1
        self._refresh_lines()

    def _custody_balance(self) -> float | None:
        try:
            acc_id = self.custody.currentData()
            if not acc_id:
                return None
            for b in lc.custody_balances():
                if int(b["account_id"]) == int(acc_id):
                    return round(float(b["balance"] or 0), 3)
            return 0.0
        except Exception:
            return None

    def _summary(self):
        total = round(sum(float(x.get("amount") or 0) for x in self._lines), 3)
        self.total_lbl.setText(f"الإجمالي: {total:,.3f} د.ك · عدد البنود: {len(self._lines)}")
        bal = self._custody_balance()
        if bal is None:
            self.balance_lbl.setText("الرصيد الحالي: —")
            self.after_lbl.setText("")
            return
        self.balance_lbl.setText(f"الرصيد الحالي: {bal:,.3f} د.ك")
        after = round(bal - total, 3)
        self.after_lbl.setText(f"الرصيد بعد التصفية: {after:,.3f} د.ك")
        color = "#991B1B" if after < -0.001 else "#166534"
        self.after_lbl.setStyleSheet(_SETTLE_PILL_QSS + f" color:{color};")

    def _rows(self):
        return [{
            "vdate": x["vdate"], "expense_account_id": x["expense_account_id"],
            "party": x["party"], "expense_customer_id": x["expense_customer_id"],
            "project_id": None, "contract_id": x["contract_id"],
            "amount": x["amount"],
            # V9.15: بيان فارغ يُملأ تلقائيًا بالعميل + المصروف
            "description": (x["description"] or "").strip()
                           or _auto_settlement_desc(x.get("acc_name"),
                                                    x.get("cust_name"),
                                                    x.get("party")),
        } for x in self._lines]

    def _save(self):
        try:
            acc_id = self.custody.currentData()
            if not acc_id:
                style.error(self, "اختر حساب العهدة."); return
            if not self._lines:
                style.error(self, "أضف بندًا واحدًا على الأقل."); return
            res = lc.add_custody_settlement(
                self.vdate.date().toString("yyyy-MM-dd"), int(acc_id),
                self._rows(), self.desc.toPlainText().strip())
            style.success(self, f"تم حفظ تصفية العهدة\nالمرجع: {res['group_number']}\nالعدد: {res['count']}\nالإجمالي: {res['total']:,.3f}")
            self.accept()
        except Exception as exc:
            style.error(self, str(exc))


class SettlementEditDialog(QDialog):
    """V3.1: تعديل بنود تصفية عهدة قائمة (للمدير) — تعديل/حذف بنود."""

    def __init__(self, parent, ref: str):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._ref = (ref or "").strip()
        style.setup_dialog(
            self, f"تعديل تصفية عهدة · {self._ref}",
            "عدّل البنود أو احذف منها — حذف البند إلغاء موثق لسنده",
            "\u270e", min_w=1180, max_w=1550)
        self.resize(1220, 620)
        lay = self.body_layout
        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels([
            "تاريخ الفاتورة", "حساب المصروف *", "المورد/الجهة", "العميل",
            "العقد", "المبلغ", "البيان", "حذف"])
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(56)
        h = self.table.horizontalHeader()
        h.setMinimumSectionSize(36)
        from ui.widgets import fit_table_with_floors as _ftwf
        _ftwf(self.table, [120, 170, 140, 150, 150, 115, 220, 58],
              [110, 170, 120, 120, 120, 110, 120, 40], 6)
        lay.addWidget(self.table, 1)
        from ui.widgets import hide_popups_on_scroll as _hps
        _hps(self.table)
        self.total_lbl = QLabel("")
        self.total_lbl.setStyleSheet("font-weight:800;")
        lay.addWidget(self.total_lbl)
        style.dialog_buttons(self, "حفظ التعديلات", on_save=self._save,
                             danger=True)
        self._lines = [dict(v) for v in lc.list_custody_group_lines(self._ref)
                       if not (v.get("cancelled") or 0)]
        for v in self._lines:
            self._add_edit_row(v)
        style.fit_table_height(self.table)
        self._summary()

    def _add_edit_row(self, v: dict):
        from PySide6.QtCore import QDate
        from ui.widgets import (SearchableComboBox, customer_items,
                                contract_items, SafeDoubleSpinBox,
                                SafeDateEdit)
        from ui.vouchers import ExpenseAccountCombo
        from services import expense_account_service as ea
        r = self.table.rowCount()
        self.table.insertRow(r)
        inv = SafeDateEdit()
        inv.setCalendarPopup(True)
        inv.setDisplayFormat("yyyy-MM-dd")
        _d = QDate.fromString(v.get("vdate") or "", "yyyy-MM-dd")
        if _d.isValid():
            inv.setDate(_d)
        acc = ExpenseAccountCombo("")
        acc.setMinimumWidth(170)
        try:
            acc.set_items(ea.posting_items(), auto_select=False)
        except Exception:
            acc.set_items([], auto_select=False)
        if v.get("expense_account_id"):
            _ai = acc.findData(v["expense_account_id"])
            if _ai >= 0:
                acc.setCurrentIndex(_ai)
        party = QLineEdit()
        party.setText(v.get("party") or "")
        cust = SearchableComboBox(search_only=True)
        cust.set_items(customer_items(), auto_select=False)
        cid = v.get("expense_customer_id")
        if cid:
            cust.select_data(cid)
        con = SearchableComboBox(open_on_click=True)
        con.set_items(contract_items(customer_id=cid) if cid else [],
                      auto_select=False)
        if v.get("contract_id"):
            con.select_data(v["contract_id"])

        def reload_contracts():
            _cid = cust.selected_data()
            con.set_items(contract_items(customer_id=_cid) if _cid else [],
                          auto_select=False)
            con.setCurrentIndex(-1)
            con.lineEdit().setText("")
        cust.selection_changed.connect(reload_contracts)
        amount = SafeDoubleSpinBox()
        amount.setDecimals(3)
        amount.setRange(0, 9999999)
        amount.setMinimumWidth(110)
        amount.setValue(float(v.get("amount") or 0))
        amount.valueChanged.connect(lambda *_: self._summary())
        desc = QLineEdit()
        desc.setText(v.get("description") or "")
        delete = QPushButton("\u00d7")
        delete.setProperty("danger", True)
        delete.setProperty("vid", int(v["id"]))
        delete.clicked.connect(lambda *_b, b=delete: self._remove_row(b))
        for c, w in enumerate((inv, acc, party, cust, con, amount, desc,
                               delete)):
            self.table.setCellWidget(r, c, w)

    def _remove_row(self, button):
        from PySide6.QtCore import QTimer
        QTimer.singleShot(0, lambda b=button: self._drop_row(b))

    def _drop_row(self, button):
        for r in range(self.table.rowCount()):
            if self.table.cellWidget(r, 7) is button:
                self.table.removeRow(r)
                break
        style.fit_table_height(self.table)
        self._summary()

    def _summary(self):
        total = 0.0
        for r in range(self.table.rowCount()):
            try:
                total += float(self.table.cellWidget(r, 5).value() or 0)
            except Exception:
                pass
        self.total_lbl.setText(
            f"الإجمالي: {total:,.3f} د.ك · عدد البنود: {self.table.rowCount()}")

    def _save(self):
        if self.table.rowCount() == 0:
            style.error(self, "لا توجد بنود — لا يمكن حفظ تصفية فارغة.")
            return
        try:
            for r in range(self.table.rowCount()):
                vid = int(self.table.cellWidget(r, 7).property("vid"))
                old = next(x for x in self._lines if int(x["id"]) == vid)
                acc_id = self.table.cellWidget(r, 1).selected_data()
                if not acc_id:
                    style.error(self, f"البند {r + 1}: اختر حساب المصروف.")
                    return
                amt = float(self.table.cellWidget(r, 5).value() or 0)
                if amt <= 0:
                    style.error(
                        self,
                        f"البند {r + 1}: المبلغ يجب أن يكون أكبر من صفر.")
                    return
                lc.update_voucher(
                    vid,
                    self.table.cellWidget(r, 0).date().toString("yyyy-MM-dd"),
                    old.get("method") or "", amt,
                    (self.table.cellWidget(r, 6).text().strip()
                     or _auto_settlement_desc(
                         self.table.cellWidget(1).currentText(),
                         self.table.cellWidget(3).currentText(),
                         self.table.cellWidget(2).text())),
                    notes=old.get("notes") or "",
                    contract_id=self.table.cellWidget(r, 4).selected_data(),
                    party_type=old.get("party_type") or "",
                    party_id=old.get("party_id"),
                    project_id=old.get("project_id"),
                    party=self.table.cellWidget(r, 2).text().strip(),
                    expense_customer_id=self.table.cellWidget(r, 3).selected_data(),
                    expense_account_id=int(acc_id))
            alive = set()
            for r in range(self.table.rowCount()):
                alive.add(int(self.table.cellWidget(r, 7).property("vid")))
            for v in self._lines:
                if int(v["id"]) not in alive:
                    lc.cancel_voucher(int(v["id"]),
                                      "حذف بند أثناء تعديل التصفية")
            style.success(self, f"تم حفظ تعديلات التصفية {self._ref}")
            self.accept()
        except Exception as exc:
            style.error(self, str(exc))


class CustodyReportsWidget(QWidget):
    """V3.8: تبويبات تقارير العهد الأربعة · V3.9/دفعة 1: ودجت قابل للتضمين.

    يُعرض داخل الصفحة الموحدة، ويبقى SettlementsReportDialog غلافًا
    نافذةً حوله للتوافق مع الاستدعاءات والاختبارات القديمة.
    """

    HEADS = ["المرجع", "التاريخ", "العهدة", "البنود", "الإجمالي",
             "البيان"]
    BAL_HEADS = ["العهدة", "المُسلَّم", "المُنفَق", "الرصيد",
                 "تسليمات", "بنود منصرف"]
    EMP_HEADS = ["التاريخ", "المرجع", "البيان", "وارد", "منصرف",
                 "الرصيد"]
    OPEN_HEADS = ["العهدة", "الرصيد المفتوح", "المُسلَّم", "المُنفَق",
                  "أقدم تسليم", "الأيام", "تسليمات"]

    def __init__(self, parent=None, account_id=None, d1="", d2=""):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_summary(d1, d2, account_id),
                         "📊 التصفيات المجمع")
        self.tabs.addTab(self._build_balances(d1, d2), "💰 أرصدة العهد")
        self.tabs.addTab(self._build_employee(account_id), "🧾 كشف موظف")
        self.tabs.addTab(self._build_detailed(d1, d2, account_id),
                         "📄 تفصيلي بالحركة")
        self.tabs.addTab(self._build_monthly(d1, d2, account_id),
                         "📅 الملخص الشهري")
        self.tabs.addTab(self._build_handovers(d1, d2, account_id),
                         "🧾 كشف عهدة (طباعة)")
        self.tabs.addTab(self._build_open(), "⏳ العهد المعلقة")
        root.addWidget(self.tabs, 1)

    # ---------- مشترك ----------
    def _date_bar(self, host_lay, prefix=""):
        from PySide6.QtCore import QDate
        try:
            from ui.widgets import SafeDateEdit as _DE
        except Exception:
            from PySide6.QtWidgets import QDateEdit as _DE
        bar = QHBoxLayout()
        bar.addWidget(QLabel("من:"))
        d1 = _DE()
        d1.setCalendarPopup(True)
        d1.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(d1)
        bar.addWidget(QLabel("إلى:"))
        d2 = _DE()
        d2.setCalendarPopup(True)
        d2.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(d2)
        if prefix:
            bar.addWidget(QLabel(prefix))
        host_lay.addLayout(bar)
        return d1, d2

    def _tab_buttons(self, host_lay, on_print, on_export):
        btns = QHBoxLayout()
        btns.addStretch()
        pdf = QPushButton("🖨 طباعة PDF")
        pdf.clicked.connect(on_print)
        xls = QPushButton("📤 تصدير Excel")
        xls.setProperty("flat", True)
        xls.clicked.connect(on_export)
        btns.addWidget(pdf)
        btns.addWidget(xls)
        host_lay.addLayout(btns)

    # ---------- تبويب 1: التصفيات المجمع ----------
    def _build_summary(self, d1, d2, account_id):
        from PySide6.QtCore import QDate
        try:
            from ui.widgets import SafeDateEdit
        except Exception:
            from PySide6.QtWidgets import QDateEdit as SafeDateEdit
        tab = QWidget()
        root = QVBoxLayout(tab)
        bar = QHBoxLayout()
        bar.addWidget(QLabel("من:"))
        self.d1 = SafeDateEdit()
        self.d1.setCalendarPopup(True)
        self.d1.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(self.d1)
        bar.addWidget(QLabel("إلى:"))
        self.d2 = SafeDateEdit()
        self.d2.setCalendarPopup(True)
        self.d2.setDisplayFormat("yyyy-MM-dd")
        bar.addWidget(self.d2)
        if d1:
            self.d1.setDate(QDate.fromString(d1, "yyyy-MM-dd"))
        if d2:
            self.d2.setDate(QDate.fromString(d2, "yyyy-MM-dd"))
        bar.addWidget(QLabel("الحساب:"))
        self.account = QComboBox()
        self.account.addItem("كل الحسابات", None)
        try:
            for x in lc.custody_accounts():
                self.account.addItem(x.get("account") or "—",
                                     x.get("account_id"))
        except Exception:
            pass
        if account_id:
            _i = self.account.findData(account_id)
            if _i >= 0:
                self.account.setCurrentIndex(_i)
        bar.addWidget(self.account, 1)
        go = QPushButton("🔍 عرض")
        go.setObjectName("btnPrimary")
        go.clicked.connect(self.refresh)
        bar.addWidget(go)
        root.addLayout(bar)
        opt = QHBoxLayout()
        self.details = QCheckBox("إظهار البنود")
        self.details.setChecked(True)
        self.details.stateChanged.connect(lambda _s: self.refresh())
        opt.addWidget(self.details)
        opt.addStretch()
        self.total_lbl = QLabel("")
        self.total_lbl.setStyleSheet("font-weight:800;")
        opt.addWidget(self.total_lbl)
        root.addLayout(opt)
        from ui.archive import _table
        self.table = _table(self.HEADS)
        root.addWidget(self.table, 1)
        self._tab_buttons(root, self._print, self._export)
        self._data: dict = {"rows": [], "count": 0, "total": 0.0}
        self.refresh()
        return tab

    def _subtotal_rows(self, rows):
        """صفوف المجاميع الفرعية — فقط عند تعدد العهد المعروضة."""
        accs: dict[str, list] = {}
        for g in rows:
            accs.setdefault(g.get("custody_account") or "—", []).append(g)
        if len(accs) < 2:
            return []
        out = []
        for acc in sorted(accs):
            gs = accs[acc]
            out.append([f"إجمالي: {acc}", "", "",
                        str(sum(int(g.get("lines") or 0) for g in gs)),
                        round(sum(float(g.get("total") or 0)
                                  for g in gs), 3), ""])
        return out

    def refresh(self):
        d1 = self.d1.date().toString("yyyy-MM-dd")
        d2 = self.d2.date().toString("yyyy-MM-dd")
        self._data = lc.settlements_summary(
            d1, d2, self.account.currentData())
        rows = self._data["rows"]
        self.total_lbl.setText(
            f"التصفيات: {self._data['count']} · "
            f"الإجمالي: {self._data['total']:,.3f} د.ك")
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        data = []
        for g in rows:
            acc = g.get("custody_account") or "—"
            data.append([g["ref"], g["vdate"], acc, str(g["lines"]),
                         f"{float(g['total'] or 0):,.3f}",
                         g["description"] or ""])
            if self.details.isChecked():
                for x in g["details"]:
                    data.append([
                        "  ↳ " + (x["voucher_number"] or ""), x["vdate"],
                        acc,
                        (x["expense_account_snapshot"] or "") + " · "
                        + (x["party"] or ""),
                        f"{float(x['amount'] or 0):,.3f}",
                        x["description"] or ""])
        for s in self._subtotal_rows(rows):
            data.append([s[0], s[1], s[2], s[3],
                         f"{s[4]:,.3f}" if s[4] != "" else "", s[5]])
        _fill(self.table, data, money_cols=(4,))
        apply_column_weights(self.table, [20, 13, 20, 12, 14, 41])

    def _rows_export(self):
        rows = []
        for g in self._data["rows"]:
            acc = g.get("custody_account") or "—"
            rows.append([g["ref"], g["vdate"], acc, g["lines"],
                         round(float(g["total"] or 0), 3),
                         g["description"] or ""])
            if self.details.isChecked():
                for x in g["details"]:
                    rows.append(["  ↳ " + (x["voucher_number"] or ""),
                                 x["vdate"], acc,
                                 (x["expense_account_snapshot"] or "")
                                 + " · " + (x["party"] or ""),
                                 round(float(x["amount"] or 0), 3),
                                 x["description"] or ""])
        rows.extend(self._subtotal_rows(self._data["rows"]))
        return rows

    def _print(self):
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            d1 = self.d1.date().toString("yyyy-MM-dd")
            d2 = self.d2.date().toString("yyyy-MM-dd")
            generate_table_pdf(
                f"تقرير تصفيات مجمع · من {d1} إلى {d2}", self.HEADS,
                [26, 20, 30, 14, 20, 52], self._rows_export(), tmp.name,
                totals_row=["الإجمالي", "",
                            f"{len({g.get('custody_account') or '' for g in self._data['rows']})} عهد",
                            str(self._data["count"]),
                            self._data["total"], ""],
                footer_note="التصفيات: %d" % self._data["count"],
                number_cols=[4])
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="تقرير تصفيات مجمع",
                             save_name="تقرير_تصفيات_مجمع.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _export(self):
        from ui.widgets import export_table_excel
        d1 = self.d1.date().toString("yyyy-MM-dd")
        d2 = self.d2.date().toString("yyyy-MM-dd")
        export_table_excel(self, f"تقرير تصفيات مجمع · من {d1} إلى {d2}",
                           self.HEADS, self._rows_export(),
                           "settlements_summary", number_cols=[4])

    # ---------- تبويب 2: أرصدة العهد ----------
    def _build_balances(self, d1, d2):
        from PySide6.QtCore import QDate
        tab = QWidget()
        root = QVBoxLayout(tab)
        self.bd1, self.bd2 = self._date_bar(root)
        if d1:
            self.bd1.setDate(QDate.fromString(d1, "yyyy-MM-dd"))
        if d2:
            self.bd2.setDate(QDate.fromString(d2, "yyyy-MM-dd"))
        else:
            self.bd1.setDate(QDate.currentDate().addMonths(-12))
        bar = QHBoxLayout()
        go = QPushButton("🔍 عرض")
        go.setObjectName("btnPrimary")
        go.clicked.connect(self._refresh_balances)
        bar.addStretch()
        bar.addWidget(go)
        root.addLayout(bar)
        self.btotal = QLabel("")
        self.btotal.setStyleSheet("font-weight:800;")
        root.addWidget(self.btotal)
        from ui.archive import _table
        self.btable = _table(self.BAL_HEADS)
        root.addWidget(self.btable, 1)
        self._tab_buttons(root, self._print_balances,
                          self._export_balances)
        self._bdata: list = []
        self._refresh_balances()
        return tab

    def _refresh_balances(self):
        from PySide6.QtGui import QColor
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        d1 = self.bd1.date().toString("yyyy-MM-dd")
        d2 = self.bd2.date().toString("yyyy-MM-dd")
        try:
            rows = lc.custody_balances(d1, d2)
        except Exception as exc:
            style.error(self, f"تعذر تحميل الأرصدة: {exc}")
            rows = []
        self._bdata = rows
        th = sum(float(r.get("handed") or 0) for r in rows)
        ts = sum(float(r.get("spent") or 0) for r in rows)
        self.btotal.setText(
            f"العهد: {len(rows)} · المُسلَّم: {th:,.3f} · المُنفَق: "
            f"{ts:,.3f} · المتبقي: {th - ts:,.3f} د.ك")
        data = [[r.get("account") or "—",
                 f"{float(r.get('handed') or 0):,.3f}",
                 f"{float(r.get('spent') or 0):,.3f}",
                 f"{float(r.get('balance') or 0):,.3f}",
                 str(r.get("handed_count") or ""),
                 str(r.get("spent_count") or "")] for r in rows]
        _fill(self.btable, data, money_cols=(1, 2, 3))
        for i, r in enumerate(rows):
            bal = float(r.get("balance") or 0)
            it = self.btable.item(i, 3)
            if it is None:
                continue
            if bal < -0.005:
                it.setForeground(QColor("#991B1B"))
            elif abs(bal) <= 0.005:
                it.setForeground(QColor("#64748B"))
        apply_column_weights(self.btable, [40, 20, 20, 22, 14, 16])

    def _balances_export(self):
        return [[r.get("account") or "—",
                 round(float(r.get("handed") or 0), 3),
                 round(float(r.get("spent") or 0), 3),
                 round(float(r.get("balance") or 0), 3),
                 int(r.get("handed_count") or 0),
                 int(r.get("spent_count") or 0)]
                for r in self._bdata]

    def _print_balances(self):
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            d1 = self.bd1.date().toString("yyyy-MM-dd")
            d2 = self.bd2.date().toString("yyyy-MM-dd")
            rows = self._balances_export()
            th = sum(r[1] for r in rows)
            ts = sum(r[2] for r in rows)
            generate_table_pdf(
                f"أرصدة العهد · من {d1} إلى {d2}", self.BAL_HEADS,
                [44, 22, 22, 24, 16, 18], rows, tmp.name,
                totals_row=["الإجمالي", round(th, 3), round(ts, 3),
                            round(th - ts, 3), "", ""],
                footer_note=f"العهد: {len(rows)}",
                number_cols=[1, 2, 3])
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="أرصدة العهد",
                             save_name="أرصدة_العهد.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _export_balances(self):
        from ui.widgets import export_table_excel
        d1 = self.bd1.date().toString("yyyy-MM-dd")
        d2 = self.bd2.date().toString("yyyy-MM-dd")
        export_table_excel(self, f"أرصدة العهد · من {d1} إلى {d2}",
                           self.BAL_HEADS, self._balances_export(),
                           "custody_balances", number_cols=[1, 2, 3])

    # ---------- تبويب 3: كشف موظف ----------
    def _build_employee(self, account_id):
        from PySide6.QtCore import QDate
        tab = QWidget()
        root = QVBoxLayout(tab)
        bar = QHBoxLayout()
        bar.addWidget(QLabel("العهدة:"))
        self.eaccount = QComboBox()
        try:
            for x in lc.custody_accounts():
                self.eaccount.addItem(x.get("account") or "—",
                                      x.get("account_id"))
        except Exception:
            pass
        if account_id:
            _i = self.eaccount.findData(account_id)
            if _i >= 0:
                self.eaccount.setCurrentIndex(_i)
        bar.addWidget(self.eaccount, 1)
        root.addLayout(bar)
        self.ed1, self.ed2 = self._date_bar(root)
        self.ed1.setDate(QDate.currentDate().addMonths(-12))
        bar2 = QHBoxLayout()
        go = QPushButton("🔍 عرض")
        go.setObjectName("btnPrimary")
        go.clicked.connect(self._refresh_employee)
        bar2.addStretch()
        bar2.addWidget(go)
        root.addLayout(bar2)
        self.etotal = QLabel("")
        self.etotal.setStyleSheet("font-weight:800;")
        root.addWidget(self.etotal)
        from ui.archive import _table
        self.etable = _table(self.EMP_HEADS)
        root.addWidget(self.etable, 1)
        self._tab_buttons(root, self._print_employee,
                          self._export_employee)
        self._edata: dict = {"rows": [], "totals": {}}
        self._refresh_employee()
        return tab

    def _refresh_employee(self):
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        acc = self.eaccount.currentData()
        d1 = self.ed1.date().toString("yyyy-MM-dd")
        d2 = self.ed2.date().toString("yyyy-MM-dd")
        try:
            data = lc.custody_ledger(acc, d1, d2) if acc else {
                "rows": [], "totals": {"in": 0, "out": 0, "balance": 0}}
        except Exception as exc:
            style.error(self, f"تعذر تحميل الكشف: {exc}")
            data = {"rows": [], "totals": {}}
        self._edata = data
        rows = data.get("rows") or []
        t = data.get("totals") or {}
        acc_name = self.eaccount.currentText().strip() or "—"
        self.etotal.setText(
            f"{acc_name} · الحركات: {len(rows)} · الوارد: "
            f"{float(t.get('in') or 0):,.3f} · المنصرف: "
            f"{float(t.get('out') or 0):,.3f} · الرصيد: "
            f"{float(t.get('balance') or 0):,.3f} د.ك")
        _fill(self.etable, [[
            r.get("vdate"), r.get("ref"), r.get("description"),
            f"{float(r.get('in') or 0):,.3f}" if r.get("in") else "",
            f"{float(r.get('out') or 0):,.3f}" if r.get("out") else "",
            f"{float(r.get('balance') or 0):,.3f}"] for r in rows],
            money_cols=(3, 4, 5))
        apply_column_weights(self.etable, [16, 26, 46, 16, 16, 18])

    def _employee_export(self):
        return [[r.get("vdate"), r.get("ref"), r.get("description"),
                 round(float(r.get("in") or 0), 3) or "",
                 round(float(r.get("out") or 0), 3) or "",
                 round(float(r.get("balance") or 0), 3)]
                for r in self._edata.get("rows") or []]

    def _print_employee(self):
        try:
            import tempfile
            from reports.custody_pdf import generate_custody_ledger_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            d1 = self.ed1.date().toString("yyyy-MM-dd")
            d2 = self.ed2.date().toString("yyyy-MM-dd")
            generate_custody_ledger_pdf(
                {"rows": self._edata.get("rows") or [],
                 "totals": self._edata.get("totals") or {},
                 "account_id": self.eaccount.currentData(),
                 "date_from": d1, "date_to": d2}, tmp.name,
                include_details=False)
            from ui.pdf_preview import PdfPreviewDialog
            acc = (self.eaccount.currentText() or "").strip() or "موظف"
            PdfPreviewDialog(self, tmp.name, title=f"كشف {acc}",
                             save_name=f"كشف_{acc}.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _export_employee(self):
        from ui.widgets import export_table_excel
        acc = (self.eaccount.currentText() or "").strip() or "موظف"
        export_table_excel(self, f"كشف عهدة {acc}", self.EMP_HEADS,
                           self._employee_export(), "custody_employee",
                           number_cols=[3, 4, 5])

    # ---------- تبويب 3: تفصيلي بالحركة (V9.15) ----------
    DET_HEADS = ["التاريخ", "المرجع", "العهدة", "نوع الحركة", "البيان",
                 "المستلم / المورد", "حساب المصروف", "العميل / العقد",
                 "وارد", "منصرف", "الرصيد"]
    DET_WIDTHS = [10, 9, 13, 11, 20, 14, 13, 12, 8, 8, 9]

    def _build_detailed(self, d1, d2, account_id):
        from PySide6.QtCore import QDate
        from ui.archive import _table
        tab = QWidget()
        root = QVBoxLayout(tab)
        bar = QHBoxLayout()
        bar.addWidget(QLabel("العهدة:"))
        self.dacc = QComboBox()
        self.dacc.addItem("كل العهد", None)
        try:
            for x in lc.custody_accounts():
                self.dacc.addItem(x.get("account") or "—", x.get("account_id"))
        except Exception:
            pass
        if account_id:
            _i = self.dacc.findData(account_id)
            if _i >= 0:
                self.dacc.setCurrentIndex(_i)
        bar.addWidget(self.dacc, 1)
        root.addLayout(bar)
        self.dd1, self.dd2 = self._date_bar(root)
        self.dd1.setDate(QDate.fromString(d1, "yyyy-MM-dd") if d1
                         else QDate.currentDate().addMonths(-12))
        self.dd2.setDate(QDate.fromString(d2, "yyyy-MM-dd") if d2
                         else QDate.currentDate())
        bar2 = QHBoxLayout()
        go = QPushButton("🔍 عرض")
        go.setObjectName("btnPrimary")
        go.clicked.connect(self._refresh_detailed)
        bar2.addStretch()
        bar2.addWidget(go)
        root.addLayout(bar2)
        self.dtotal = QLabel("")
        self.dtotal.setStyleSheet("font-weight:800;")
        root.addWidget(self.dtotal)
        self.dtable = _table(self.DET_HEADS)
        root.addWidget(self.dtable, 1)
        self._tab_buttons(root, self._print_detailed, self._export_detailed)
        self._ddata: dict = {"rows": [], "totals": {}}
        self._refresh_detailed()
        return tab

    def _refresh_detailed(self):
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        d1 = self.dd1.date().toString("yyyy-MM-dd")
        d2 = self.dd2.date().toString("yyyy-MM-dd")
        try:
            data = lc.custody_detailed_report(d1, d2, self.dacc.currentData())
        except Exception as exc:
            style.error(self, f"تعذر تحميل التقرير: {exc}")
            data = {"rows": [], "totals": {}}
        self._ddata = data
        rows = self._det_export()
        t = data.get("totals") or {}
        self.dtotal.setText(
            f"عدد الحركات: {len(rows)} · الوارد: "
            f"{float(t.get('in') or 0):,.3f} · المنصرف: "
            f"{float(t.get('out') or 0):,.3f} · الرصيد: "
            f"{float(t.get('balance') or 0):,.3f} د.ك")
        _fill(self.dtable, [
            [f"{v:,.3f}" if isinstance(v, (int, float)) else v
             for v in row] for row in rows],
            money_cols=(8, 9, 10))
        apply_column_weights(self.dtable, self.DET_WIDTHS)

    def _det_export(self):
        out = []
        for r in self._ddata.get("rows") or []:
            out.append([
                r.get("vdate") or "", r.get("ref") or "",
                r.get("account") or "", r.get("type") or "",
                r.get("description") or "", r.get("party") or "",
                r.get("expense") or "", r.get("customer") or "",
                round(float(r.get("in") or 0), 3) or "",
                round(float(r.get("out") or 0), 3) or "",
                round(float(r.get("balance") or 0), 3)])
        return out

    def _print_detailed(self):
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            d1 = self.dd1.date().toString("yyyy-MM-dd")
            d2 = self.dd2.date().toString("yyyy-MM-dd")
            t = self._ddata.get("totals") or {}
            generate_table_pdf(
                f"التقرير التفصيلي للعهد · من {d1} إلى {d2}", self.DET_HEADS,
                self.DET_WIDTHS, self._det_export(), tmp.name,
                totals_row=["الإجمالي", "", "", "", "", "", "", "",
                            t.get("in", 0), t.get("out", 0),
                            t.get("balance", 0)],
                footer_note=f"عدد الحركات: {len(self._det_export())}",
                number_cols=[8, 9, 10])
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="التقرير التفصيلي للعهد",
                             save_name="تقرير_العهد_التفصيلي.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _export_detailed(self):
        from ui.widgets import export_table_excel
        d1 = self.dd1.date().toString("yyyy-MM-dd")
        d2 = self.dd2.date().toString("yyyy-MM-dd")
        export_table_excel(self, f"التقرير التفصيلي للعهد · من {d1} إلى {d2}",
                           self.DET_HEADS, self._det_export(),
                           "custody_detailed", number_cols=[8, 9, 10])

    # ---------- تبويب 4: الملخص الشهري (V9.15) ----------
    MON_HEADS = ["الشهر", "العهدة", "رصيد أول المدة", "تسليم",
                 "صرف (تصفية)", "مرتجع", "رصيد آخر المدة"]
    MON_WIDTHS = [12, 26, 14, 13, 14, 12, 14]

    def _account_filter(self, bar, attr):
        bar.addWidget(QLabel("العهدة:"))
        cb = QComboBox()
        cb.addItem("كل العهد", None)
        try:
            for x in lc.custody_accounts():
                cb.addItem(x.get("account") or "—", x.get("account_id"))
        except Exception:
            pass
        setattr(self, attr, cb)
        bar.addWidget(cb, 1)
        return cb

    def _build_monthly(self, d1, d2, account_id):
        from PySide6.QtCore import QDate
        from ui.archive import _table
        tab = QWidget()
        root = QVBoxLayout(tab)
        bar = QHBoxLayout()
        self._account_filter(bar, "macc")
        root.addLayout(bar)
        self.md1, self.md2 = self._date_bar(root)
        self.md1.setDate(QDate.fromString(d1, "yyyy-MM-dd") if d1
                         else QDate.currentDate().addMonths(-12))
        self.md2.setDate(QDate.fromString(d2, "yyyy-MM-dd") if d2
                         else QDate.currentDate())
        if account_id:
            _i = self.macc.findData(account_id)
            if _i >= 0:
                self.macc.setCurrentIndex(_i)
        bar2 = QHBoxLayout()
        go = QPushButton("🔍 عرض")
        go.setObjectName("btnPrimary")
        go.clicked.connect(self._refresh_monthly)
        bar2.addStretch()
        bar2.addWidget(go)
        root.addLayout(bar2)
        self.mtotal = QLabel("")
        self.mtotal.setStyleSheet("font-weight:800;")
        root.addWidget(self.mtotal)
        self.mtable = _table(self.MON_HEADS)
        root.addWidget(self.mtable, 1)
        self._tab_buttons(root, self._print_monthly, self._export_monthly)
        self._mdata: dict = {"rows": [], "totals": {}}
        self._refresh_monthly()
        return tab

    def _refresh_monthly(self):
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        d1 = self.md1.date().toString("yyyy-MM-dd")
        d2 = self.md2.date().toString("yyyy-MM-dd")
        try:
            data = lc.custody_monthly_summary(d1, d2, self.macc.currentData())
        except Exception as exc:
            style.error(self, f"تعذر تحميل الملخص: {exc}")
            data = {"rows": [], "totals": {}}
        self._mdata = data
        t = data.get("totals") or {}
        self.mtotal.setText(
            f"عدد الصفوف: {len(data.get('rows') or [])} · تسليم: "
            f"{float(t.get('handed') or 0):,.3f} · صرف: "
            f"{float(t.get('spent') or 0):,.3f} · مرتجع: "
            f"{float(t.get('returned') or 0):,.3f} د.ك")
        _fill(self.mtable, [self._mon_export_row(r) for r in data.get("rows") or []],
              money_cols=(2, 3, 4, 5, 6))
        apply_column_weights(self.mtable, self.MON_WIDTHS)

    @staticmethod
    def _mon_export_row(r):
        return [r.get("month") or "", r.get("account") or "",
                f"{float(r.get('opening') or 0):,.3f}",
                f"{float(r.get('handed') or 0):,.3f}",
                f"{float(r.get('spent') or 0):,.3f}",
                f"{float(r.get('returned') or 0):,.3f}",
                f"{float(r.get('closing') or 0):,.3f}"]

    def _mon_export(self):
        out = []
        for r in self._mdata.get("rows") or []:
            out.append([r.get("month") or "", r.get("account") or "",
                        round(float(r.get("opening") or 0), 3),
                        round(float(r.get("handed") or 0), 3),
                        round(float(r.get("spent") or 0), 3),
                        round(float(r.get("returned") or 0), 3),
                        round(float(r.get("closing") or 0), 3)])
        return out

    def _print_monthly(self):
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            d1 = self.md1.date().toString("yyyy-MM-dd")
            d2 = self.md2.date().toString("yyyy-MM-dd")
            t = self._mdata.get("totals") or {}
            generate_table_pdf(
                f"الملخص الشهري للعهد · من {d1} إلى {d2}", self.MON_HEADS,
                self.MON_WIDTHS, self._mon_export(), tmp.name,
                totals_row=["الإجمالي", "", "", t.get("handed", 0),
                            t.get("spent", 0), t.get("returned", 0), ""],
                footer_note="الرصيد الافتتاحي والختامي لكل عهدة على حدة",
                number_cols=[2, 3, 4, 5, 6])
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="الملخص الشهري للعهد",
                             save_name="الملخص_الشهري_للعهد.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _export_monthly(self):
        from ui.widgets import export_table_excel
        d1 = self.md1.date().toString("yyyy-MM-dd")
        d2 = self.md2.date().toString("yyyy-MM-dd")
        export_table_excel(self, f"الملخص الشهري للعهد · من {d1} إلى {d2}",
                           self.MON_HEADS, self._mon_export(),
                           "custody_monthly", number_cols=[2, 3, 4, 5, 6])

    # ---------- تبويب 5: كشف عهدة (طباعة) (V9.15) ----------
    HO_HEADS = ["التاريخ", "رقم العهدة", "العهدة (الحساب)", "المستلم",
                "المبلغ", "البيان", "طريقة الدفع", "طباعة"]
    HO_WIDTHS = [11, 11, 22, 16, 12, 24, 12, 10]

    def _build_handovers(self, d1, d2, account_id):
        from PySide6.QtCore import QDate
        from ui.archive import _table
        tab = QWidget()
        root = QVBoxLayout(tab)
        bar = QHBoxLayout()
        self._account_filter(bar, "hacc")
        root.addLayout(bar)
        self.hd1, self.hd2 = self._date_bar(root)
        self.hd1.setDate(QDate.fromString(d1, "yyyy-MM-dd") if d1
                         else QDate.currentDate().addMonths(-12))
        self.hd2.setDate(QDate.fromString(d2, "yyyy-MM-dd") if d2
                         else QDate.currentDate())
        if account_id:
            _i = self.hacc.findData(account_id)
            if _i >= 0:
                self.hacc.setCurrentIndex(_i)
        bar2 = QHBoxLayout()
        go = QPushButton("🔍 عرض")
        go.setObjectName("btnPrimary")
        go.clicked.connect(self._refresh_handovers)
        bar2.addStretch()
        bar2.addWidget(go)
        root.addLayout(bar2)
        self.htotal = QLabel("")
        self.htotal.setStyleSheet("font-weight:800;")
        root.addWidget(self.htotal)
        self.htable = _table(self.HO_HEADS)
        root.addWidget(self.htable, 1)
        self._tab_buttons(root, self._print_handover_list,
                          self._export_handovers)
        self._hdata: list = []
        self._refresh_handovers()
        return tab

    def _refresh_handovers(self):
        from PySide6.QtWidgets import QPushButton as _PB
        from ui.widgets import apply_column_weights
        d1 = self.hd1.date().toString("yyyy-MM-dd")
        d2 = self.hd2.date().toString("yyyy-MM-dd")
        try:
            self._hdata = lc.custody_handover_list(d1, d2, self.hacc.currentData())
        except Exception as exc:
            style.error(self, f"تعذر تحميل العهد: {exc}")
            self._hdata = []
        self.htable.setRowCount(0)
        total = 0.0
        for h in self._hdata:
            r = self.htable.rowCount()
            self.htable.insertRow(r)
            amt = float(h.get("amount") or 0)
            total += amt
            cells = [h.get("vdate") or "", h.get("ref") or "",
                     h.get("custody_account_snapshot") or "",
                     h.get("party") or "", f"{amt:,.3f}",
                     h.get("description") or "", h.get("method") or ""]
            for c, txt in enumerate(cells):
                it = QTableWidgetItem(str(txt))
                it.setTextAlignment(Qt.AlignCenter if c != 2 else (Qt.AlignRight | Qt.AlignVCenter))
                self.htable.setItem(r, c, it)
            btn = _PB("🖨 طباعة")
            btn.setCursor(Qt.PointingHandCursor)
            btn.setMinimumHeight(26)
            btn.clicked.connect(lambda _=False, hh=h: self._print_handover(hh))
            self.htable.setCellWidget(r, 7, btn)
        self.htotal.setText(
            f"عدد العهد المسلّمة: {len(self._hdata)} · إجمالي التسليم: "
            f"{total:,.3f} د.ك")
        apply_column_weights(self.htable, self.HO_WIDTHS)

    def _print_handover(self, h):
        """كشف عهدة واحدة (سند تسليم) قابل للطباعة."""
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            ref = h.get("ref") or ""
            rows = [
                ["رقم العهدة", ref],
                ["تاريخ التسليم", h.get("vdate") or ""],
                ["حساب العهدة", h.get("custody_account_snapshot") or ""],
                ["المستلم", h.get("party") or "—"],
                ["المبلغ", f"{float(h.get('amount') or 0):,.3f} د.ك"],
                ["طريقة الدفع", h.get("method") or "—"],
                ["البيان", h.get("description") or "—"],
                ["ملاحظات", h.get("notes") or "—"],
            ]
            generate_table_pdf(
                f"كشف عهدة رقم {ref}", ["البيان", "التفاصيل"], [30, 70],
                rows, tmp.name,
                footer_note="كشف سند تسليم العهدة — المصروف منها يظهر في الملخص الشهري وكشف الحساب")
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title=f"كشف عهدة {ref}",
                             save_name=f"كشف_عهدة_{ref}.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _print_handover_list(self):
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            rows = self._handover_export()
            total = sum(float(h.get("amount") or 0) for h in self._hdata)
            generate_table_pdf(
                "العهد المسلّمة", self.HO_HEADS[:-1],
                self.HO_WIDTHS[:-1], rows, tmp.name,
                totals_row=["الإجمالي", "", "", "", total, "", ""],
                footer_note=f"عدد العهد: {len(rows)}", number_cols=[4])
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="العهد المسلّمة",
                             save_name="العهد_المسلمة.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _handover_export(self):
        return [[h.get("vdate") or "", h.get("ref") or "",
                 h.get("custody_account_snapshot") or "",
                 h.get("party") or "", round(float(h.get("amount") or 0), 3),
                 h.get("description") or "", h.get("method") or ""]
                for h in self._hdata]

    def _export_handovers(self):
        from ui.widgets import export_table_excel
        d1 = self.hd1.date().toString("yyyy-MM-dd")
        d2 = self.hd2.date().toString("yyyy-MM-dd")
        export_table_excel(self, f"العهد المسلّمة · من {d1} إلى {d2}",
                           self.HO_HEADS[:-1], self._handover_export(),
                           "custody_handovers", number_cols=[4])

    # ---------- تبويب 4: العهد المعلقة ----------
    def _build_open(self):
        from PySide6.QtWidgets import QSpinBox
        tab = QWidget()
        root = QVBoxLayout(tab)
        bar = QHBoxLayout()
        bar.addWidget(QLabel("أقدم من (يوم):"))
        self.ospin = QSpinBox()
        self.ospin.setRange(0, 3650)
        self.ospin.setValue(30)
        self.ospin.setToolTip("صفر = كل المعلقة بلا حد أيام")
        self.ospin.valueChanged.connect(lambda *_: self._refresh_open())
        bar.addWidget(self.ospin)
        note = QLabel("المعلقة = رصيد موجب ما زال لدى الموظف · "
                      "الأيام من أقدم تسليم")
        note.setStyleSheet("color:#64748B;")
        bar.addWidget(note, 1)
        root.addLayout(bar)
        self.ototal = QLabel("")
        self.ototal.setStyleSheet("font-weight:800;")
        root.addWidget(self.ototal)
        from ui.archive import _table
        self.otable = _table(self.OPEN_HEADS)
        root.addWidget(self.otable, 1)
        self._tab_buttons(root, self._print_open, self._export_open)
        self._odata: list = []
        self._refresh_open()
        return tab

    def _refresh_open(self):
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        try:
            rows = lc.custody_open_items()
        except Exception as exc:
            style.error(self, f"تعذر تحميل المعلقة: {exc}")
            rows = []
        days_min = int(self.ospin.value() or 0)
        if days_min > 0:
            rows = [r for r in rows if r.get("days", 0) >= days_min]
        self._odata = rows
        tot = sum(float(r.get("balance") or 0) for r in rows)
        self.ototal.setText(
            f"العهد المعلقة: {len(rows)} · إجمالي المفتوح: "
            f"{tot:,.3f} د.ك")
        _fill(self.otable, [[
            r.get("account") or "—",
            f"{float(r.get('balance') or 0):,.3f}",
            f"{float(r.get('handed') or 0):,.3f}",
            f"{float(r.get('spent') or 0):,.3f}",
            r.get("oldest") or "—", str(r.get("days") or ""),
            str(r.get("handovers") or "")] for r in rows],
            money_cols=(1, 2, 3))
        apply_column_weights(self.otable, [34, 18, 18, 18, 18, 12, 14])

    def _open_export(self):
        return [[r.get("account") or "—",
                 round(float(r.get("balance") or 0), 3),
                 round(float(r.get("handed") or 0), 3),
                 round(float(r.get("spent") or 0), 3),
                 r.get("oldest") or "", int(r.get("days") or 0),
                 int(r.get("handovers") or 0)] for r in self._odata]

    def _print_open(self):
        try:
            import tempfile
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            rows = self._open_export()
            tot = sum(r[1] for r in rows)
            generate_table_pdf(
                "العهد المعلقة", self.OPEN_HEADS,
                [36, 20, 20, 20, 20, 14, 16], rows, tmp.name,
                totals_row=["الإجمالي", round(tot, 3), "", "", "", "",
                            ""],
                footer_note=f"المعلقة: {len(rows)}",
                number_cols=[1, 2, 3])
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="العهد المعلقة",
                             save_name="العهد_المعلقة.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر الطباعة: {exc}")

    def _export_open(self):
        from ui.widgets import export_table_excel
        export_table_excel(self, "العهد المعلقة", self.OPEN_HEADS,
                           self._open_export(), "custody_open",
                           number_cols=[1, 2, 3])


class SettlementsReportDialog(QDialog):
    """غلاف توافقي (V3.9/دفعة 1): نافذة حول ودجت التقارير.

    كل الخصائص والدوال تُحوَّل للودجت الداخلي، فيبقى سلوك V3.8
    مطابقًا تمامًا لكل الاستدعاءات والاختبارات القديمة.
    """

    def __init__(self, parent=None, account_id=None, d1="", d2=""):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self.setWindowTitle("تقارير العهد")
        self.resize(1020, 640)
        root = QVBoxLayout(self)
        self._w = CustodyReportsWidget(
            self, account_id=account_id, d1=d1, d2=d2)
        root.addWidget(self._w, 1)
        bottom = QHBoxLayout()
        bottom.addStretch()
        close = QPushButton("✕ إغلاق")
        close.setProperty("flat", True)
        close.clicked.connect(self.reject)
        bottom.addWidget(close)
        root.addLayout(bottom)

    def __getattr__(self, name):
        w = self.__dict__.get("_w")
        if w is None:
            raise AttributeError(name)
        return getattr(w, name)


class CustodyReturnDialog(QDialog):
    """V4.52: إرجاع متبقي عهدة للخزينة — بلا سند قبض وبلا أثر إيرادي."""

    def __init__(self, parent=None, account_id: int | None = None):
        super().__init__(parent)
        from PySide6.QtWidgets import (QDateEdit as _DE,
                                       QDialogButtonBox as _BB,
                                       QDoubleSpinBox as _DSB)
        from PySide6.QtCore import QDate as _QDate
        self.setWindowTitle("↩ إرجاع عهدة للصندوق")
        self.setMinimumWidth(380)
        self._saved_id: int | None = None
        root = QVBoxLayout(self)
        form = QFormLayout()
        self.account = QComboBox()
        try:
            _accs = [a for a in lc.custody_accounts()
                     if float(a.get("balance") or 0) > 0.0005]
        except Exception:
            _accs = []
        for a in _accs:
            self.account.addItem(
                f"{a.get('account') or ''} — متبقي "
                f"{float(a.get('balance') or 0):,.3f}",
                int(a.get("account_id") or 0))
        if account_id:
            _i = self.account.findData(int(account_id))
            if _i >= 0:
                self.account.setCurrentIndex(_i)
        self.balance_lbl = QLabel("")
        self.balance_lbl.setStyleSheet("font-weight: 800; color: #1E3A8A;")
        self.amount = _DSB()
        self.amount.setRange(0, 10000000)
        self.amount.setDecimals(3)
        self.date = _DE()
        self.date.setCalendarPopup(True)
        self.date.setDisplayFormat("yyyy-MM-dd")
        self.date.setDate(_QDate.currentDate())
        self.method = QComboBox()
        self.method.addItems(["الصندوق", "البنك"])
        self.party = QLineEdit()
        self.party.setPlaceholderText("اسم المُرجِع (اختياري)")
        self.notes = QLineEdit()
        self.notes.setPlaceholderText("ملاحظات (اختياري)")
        form.addRow("حساب العهدة:", self.account)
        form.addRow("", self.balance_lbl)
        form.addRow("المبلغ:", self.amount)
        form.addRow("التاريخ:", self.date)
        form.addRow("إلى:", self.method)
        form.addRow("المُرجِع:", self.party)
        form.addRow("ملاحظات:", self.notes)
        root.addLayout(form)
        self.account.currentIndexChanged.connect(self._refresh_max)
        self._refresh_max()
        bb = _BB(_BB.Save | _BB.Cancel)
        bb.accepted.connect(self._save)
        bb.rejected.connect(self.reject)
        root.addWidget(bb)

    def _refresh_max(self):
        try:
            _accs = {int(a.get("account_id") or 0): float(a.get("balance") or 0)
                     for a in lc.custody_accounts()}
        except Exception:
            _accs = {}
        _bal = _accs.get(int(self.account.currentData() or 0), 0.0)
        self.balance_lbl.setText(f"المتبقي المتاح: {_bal:,.3f} د.ك")
        self.amount.setMaximum(max(_bal, 0.0))
        if self.amount.value() <= 0 or self.amount.value() > _bal:
            self.amount.setValue(max(_bal, 0.0))

    def _save(self):
        try:
            self._saved_id = lc.add_custody_return(
                self.date.date().toString("yyyy-MM-dd"),
                int(self.account.currentData() or 0),
                self.amount.value(), self.party.text().strip(),
                self.method.currentText(), self.notes.text().strip())
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.success(self, "سُجّل الإرجاع ✅")
        self.accept()


class CustodyLedgerWidget(QWidget):
    """كشف حساب العهدة الموحّد (Ledger) — ودجت قابل للتضمين."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._ledger: dict = {}
        self._visible: list[dict] = []

        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 14, 18, 14)
        lay.setSpacing(10)

        self.title_lbl = QLabel("كشف حساب العهدة")
        self.title_lbl.setProperty("pageTitle", True)
        lay.addWidget(self.title_lbl)
        self.desc_lbl = QLabel("حركات العهدة وتصفياتها وأرصدتها — النقر على تصفية يعرضها في شاشة التصفيات · الزر الأيمن لبقية الإجراءات")
        self.desc_lbl.setProperty("pageDesc", True)
        lay.addWidget(self.desc_lbl)
        self.sub_lbl = QLabel("")
        self.sub_lbl.setStyleSheet("color:#475569; font-weight:700;")
        lay.addWidget(self.sub_lbl)

        top = QHBoxLayout()
        self.account = QComboBox()
        self.account.setMinimumWidth(260)
        from ui.widgets import make_searchable
        make_searchable(self.account, "")
        self.account.currentIndexChanged.connect(self.reload)
        self.handover_btn = QPushButton("🤝 تسليم عهدة")
        self.handover_btn.setObjectName("btnPrimary")
        self.handover_btn.setToolTip("عهدة جديدة")
        self.handover_btn.clicked.connect(self._handover)
        self.edit_btn = QPushButton("✎ تعديل")
        self.edit_btn.setProperty("flat", True)
        self.edit_btn.setToolTip("تعديل")
        self.edit_btn.clicked.connect(self._edit_selected)
        # V3.13: حُذف زر التقرير المكرر — تاب «التقارير» العلوي يكفي.
        self.settle_btn = QPushButton("✅ تصفية عهدة")
        self.settle_btn.setProperty("flat", True)
        self.settle_btn.setToolTip("تصفية")
        self.settle_btn.clicked.connect(self._settle)
        self.return_btn = QPushButton("↩ إرجاع للصندوق")
        self.return_btn.setProperty("flat", True)
        self.return_btn.setToolTip(
            "إرجاع متبقي عهدة للخزينة — بلا سند قبض وبلا أثر إيرادي")
        self.return_btn.clicked.connect(self._return_custody)
        self.blank_form_btn = QPushButton("🖨 نموذج تصفية فارغ")
        self.blank_form_btn.setProperty("flat", True)
        self.blank_form_btn.setToolTip("نموذج ورقي")
        self.blank_form_btn.clicked.connect(self._blank_form)
        self.blank_excel_btn = QPushButton("⬇ نموذج Excel للموظف")
        self.blank_excel_btn.setProperty("flat", True)
        self.blank_excel_btn.setToolTip("نموذج Excel")
        self.blank_excel_btn.clicked.connect(self._blank_excel_form)
        top.addWidget(QLabel("حساب العهدة"))
        top.addWidget(self.account, 1)
        top.addStretch()
        top.addWidget(self.blank_excel_btn)
        top.addWidget(self.blank_form_btn)
        top.addWidget(self.return_btn)
        top.addWidget(self.settle_btn)
        top.addWidget(self.edit_btn)
        top.addWidget(self.handover_btn)
        lay.addLayout(top)

        cards = QHBoxLayout()
        self.card_in = self._card("📥 إجمالي الوارد", "0.000", "#DCFCE7", "#166534")
        self.card_out = self._card("📤 إجمالي المنصرف", "0.000", "#FEE2E2", "#991B1B")
        self.card_balance = self._card("💰 الرصيد الحالي", "0.000", "#DBEAFE", "#1E3A8A")
        cards.addWidget(self.card_in[0])
        cards.addWidget(self.card_out[0])
        cards.addWidget(self.card_balance[0])
        lay.addLayout(cards)

        filters = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("بحث بالمرجع أو البيان…")
        try:
            from ui.widgets import connect_debounced_text
            connect_debounced_text(self.search, self.reload, delay_ms=350)
        except Exception:
            self.search.textChanged.connect(lambda *_: self.reload())
        from PySide6.QtCore import QDate
        try:
            from ui.widgets import SafeDateEdit as _DE
        except Exception:
            from PySide6.QtWidgets import QDateEdit as _DE
        self.use_period = QCheckBox("فترة")
        self.use_period.toggled.connect(lambda *_: self.reload())
        self.date_from = _DE(); self.date_from.setCalendarPopup(True); self.date_from.setDisplayFormat("yyyy-MM-dd"); self.date_from.setDate(QDate.currentDate().addMonths(-12))
        self.date_to = _DE(); self.date_to.setCalendarPopup(True); self.date_to.setDisplayFormat("yyyy-MM-dd"); self.date_to.setDate(QDate.currentDate())
        self.date_from.dateChanged.connect(lambda *_: self.reload())
        self.date_to.dateChanged.connect(lambda *_: self.reload())
        refresh = QPushButton("🔄 تحديث"); refresh.setProperty("flat", True); refresh.setToolTip("تحديث"); refresh.clicked.connect(self._refresh_all)
        filters.addWidget(QLabel("بحث")); filters.addWidget(self.search, 2)
        filters.addWidget(self.use_period); filters.addWidget(QLabel("من")); filters.addWidget(self.date_from)
        filters.addWidget(QLabel("إلى")); filters.addWidget(self.date_to); filters.addWidget(refresh)
        lay.addLayout(filters)

        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(["التاريخ", "المرجع", "العهدة", "البيان", "وارد", "منصرف", "الرصيد", "طباعة"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(True)
        self.table.setStyleSheet("QTableWidget { gridline-color: #C7D2E0; }")
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(QHeaderView.Interactive)
        h.setSectionResizeMode(3, QHeaderView.Stretch)
        h.setSectionResizeMode(7, QHeaderView.Fixed)
        for i, w in enumerate([95, 190, 150, 300, 110, 110, 115, 96]):
            self.table.setColumnWidth(i, w)
        self.table.cellClicked.connect(self._cell_clicked)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._menu_ledger)
        lay.addWidget(self.table, 1)

        bottom = QHBoxLayout()
        self.include_details = QCheckBox("تضمين تفاصيل التصفيات في الطباعة")
        self.excel_btn = QPushButton("📤")
        self.excel_btn.setObjectName("iconBtn")
        self.excel_btn.setToolTip("تصدير")
        self.excel_btn.setCursor(Qt.PointingHandCursor)
        self.excel_btn.clicked.connect(self._excel)
        # ثانوي عمدًا: الرئيسي الوحيد «تسليم عهدة» أعلى الصفحة (§5)
        self.print_btn = QPushButton("🖨 طباعة كشف الحساب")
        self.print_btn.setProperty("flat", True)
        self.print_btn.setToolTip("طباعة")
        self.print_btn.clicked.connect(self._print_ledger)
        bottom.addWidget(self.include_details)
        bottom.addStretch()
        bottom.addWidget(self.excel_btn)
        bottom.addWidget(self.print_btn)
        lay.addLayout(bottom)

        self._load_accounts()
        self.reload()

    def _card(self, title: str, value: str, bg: str, fg: str):
        box = QWidget(); box.setObjectName("card")
        box.setStyleSheet(f"QWidget#card {{ background: {bg}; border-radius: 12px; padding: 10px; }}")
        l = QVBoxLayout(box); l.setContentsMargins(14, 10, 14, 10)
        t = QLabel(title); t.setStyleSheet("font-weight:700; color:#475569;")
        v = QLabel(value); v.setStyleSheet(f"font-size:20px; font-weight:900; color:{fg};")
        l.addWidget(t); l.addWidget(v)
        return box, v

    def _load_accounts(self):
        cur = self.account.currentData()
        self.account.blockSignals(True)
        self.account.clear()
        try:
            accounts = lc.custody_accounts()
        except Exception:
            accounts = []
        if len(accounts) > 1:
            self.account.addItem("كل حسابات العهد", None)
        for a in accounts:
            self.account.addItem(a.get("account") or "—", a.get("account_id"))
        if cur is not None:
            idx = self.account.findData(cur)
            if idx >= 0:
                self.account.setCurrentIndex(idx)
        self.account.blockSignals(False)

    def _period(self):
        if not self.use_period.isChecked():
            return "", ""
        return (self.date_from.date().toString("yyyy-MM-dd"),
                self.date_to.date().toString("yyyy-MM-dd"))

    def _refresh_all(self):
        # زر التحديث: الحسابات أولًا (قد تُضاف عهدة جديدة من شاشة أخرى)
        # ثم الكشف — كان يعيد الكشف فقط فتبدو الشاشة جامدة.
        self._load_accounts()
        self.reload()

    def reload(self):
        try:
            from services import auth_service as _auth
            self.edit_btn.setVisible(bool(_auth.is_admin()))
        except Exception:
            pass
        d1, d2 = self._period()
        try:
            self._ledger = lc.custody_ledger(
                self.account.currentData(), d1, d2, self.search.text())
        except Exception as exc:
            style.error(self, f"تعذر تحميل كشف العهدة: {exc}")
            self._ledger = {"rows": [], "totals": {"in": 0, "out": 0, "balance": 0}}
        self._render()

    def _render(self):
        rows = self._ledger.get("rows") or []
        totals = self._ledger.get("totals") or {}
        self.card_in[1].setText(f"{float(totals.get('in') or 0):,.3f}")
        self.card_out[1].setText(f"{float(totals.get('out') or 0):,.3f}")
        self.card_balance[1].setText(f"{float(totals.get('balance') or 0):,.3f}")
        self.table.setRowCount(0)
        self._visible = []
        for item in rows:
            self._add_main_row(item)
        try:
            acc = self.account.currentText().strip() or "—"
            d1, d2 = self._period()
            period = f" · الفترة: {d1} إلى {d2}" if d1 else ""
            self.sub_lbl.setText(
                f"الحساب: {acc} · الحركات: {len(rows)}{period}")
        except Exception:
            pass

        self._update_empty_state(len(rows))

    def _update_empty_state(self, count: int):
        """حالة الفراغ: رسالة + زر — تُستدعى نهاية العرض."""
        from ui.widgets import empty_state, dispose_widget as _dispose
        if count:
            if getattr(self, "_empty_widget", None) is not None:
                _dispose(self._empty_widget, host=self)
                self._empty_widget = None
                self.table.setVisible(True)
            return
        if getattr(self, "_empty_widget", None) is not None:
            _dispose(self._empty_widget, host=self)
        self._empty_widget = empty_state(
            "لا حركات عهدة في الحساب والفترة المحددة",
            "تسليم عهدة", self._handover, icon="🧾",
            primary=False)
        self.table.setVisible(False)
        lay = self.layout()
        lay.insertWidget(lay.indexOf(self.table), self._empty_widget, 1)

    def _set_item(self, row, col, text, align=Qt.AlignCenter, bg=None, fg=None, bold=False):
        it = QTableWidgetItem(str(text or ""))
        it.setTextAlignment(align)
        if bg: it.setBackground(QColor(bg))
        if fg: it.setForeground(QColor(fg))
        if bold:
            f = it.font(); f.setBold(True); it.setFont(f)
        self.table.setItem(row, col, it)
        return it

    def _add_main_row(self, item: dict):
        from ui.widgets import MONEY_ALIGN
        r = self.table.rowCount(); self.table.insertRow(r)
        ref = item.get("ref") or ""
        bg = "#F8FAFC"
        self._set_item(r, 0, item.get("vdate"), bg=bg)
        self._set_item(r, 1, ref, bg=bg, bold=True).setToolTip(ref)
        self._set_item(r, 2, item.get("custody_account") or "—", Qt.AlignRight | Qt.AlignVCenter, bg=bg)
        self._set_item(r, 3, item.get("description"), Qt.AlignRight | Qt.AlignVCenter, bg=bg)
        self._set_item(r, 4, f"{float(item.get('in') or 0):,.3f}" if item.get("in") else "", MONEY_ALIGN, bg="#DCFCE7" if item.get("in") else bg, fg="#166534", bold=bool(item.get("in")))
        self._set_item(r, 5, f"{float(item.get('out') or 0):,.3f}" if item.get("out") else "", MONEY_ALIGN, bg="#FEE2E2" if item.get("out") else bg, fg="#991B1B", bold=bool(item.get("out")))
        self._set_item(r, 6, f"{float(item.get('balance') or 0):,.3f}", MONEY_ALIGN, bg=bg, bold=True)
        btn = QPushButton("🖨 طباعة")
        btn.setProperty("flat", True)
        btn.setMinimumWidth(64)
        # V3.13: نفس نمط زر التعديل — حشوة مدمجة حتى لا يُقطع النص.
        btn.setStyleSheet("QPushButton { padding: 2px 8px; }")
        btn.setToolTip("طباعة هذه الحركة")
        btn.clicked.connect(lambda _=False, x=dict(item): self._print_row(x))
        self.table.setCellWidget(r, 7, btn)
        self._visible.append({"type": "main", "item": item})
        self.table.setRowHeight(r, 34)

    def _cell_clicked(self, row: int, col: int):
        """V3.7: النقر على صف تصفية يعرضها في شاشة التصفيات (بدل الطي)."""
        if row < 0 or row >= len(self._visible):
            return
        meta = self._visible[row]
        item = meta.get("item") or {}
        if meta.get("type") != "main" or item.get("kind") != "settlement":
            return
        if col == 7:
            return  # زر الطباعة له مساره
        ref = item.get("ref") or ""
        if ref:
            self._open_in_settlements(ref)

    def _open_in_settlements(self, ref: str) -> bool:
        """الانتقال لشاشة التصفيات مع تحديد التصفية — يعيد النجاح."""
        try:
            from ui.main_window import IDX_SETTLEMENTS
            win = self.window()
            if win is None or not hasattr(win, "_navigate"):
                return False
            win._navigate(IDX_SETTLEMENTS)
            try:
                page = win.settlements_page
            except Exception:
                page = None
            if page is not None and hasattr(page, "select_settlement"):
                page.select_settlement(ref)
            return True
        except Exception:
            return False

    def _copy_text(self, text: str):
        try:
            from PySide6.QtWidgets import QApplication
            QApplication.clipboard().setText(text or "")
            style.toast(self, "تم نسخ المرجع.")
        except Exception:
            pass

    def _menu_ledger(self, pos):
        """V3.7: قائمة الزر الأيمن على حركات الكشف."""
        row = self.table.rowAt(pos.y())
        if row < 0 or row >= len(self._visible):
            return
        self.table.selectRow(row)
        item = (self._visible[row].get("item") or {})
        kind = item.get("kind") or ""
        ref = item.get("ref") or ""
        menu = QMenu(self)
        menu.setLayoutDirection(Qt.RightToLeft)
        try:
            from services import auth_service as _auth
            _admin = bool(_auth.is_admin())
        except Exception:
            _admin = False
        if kind == "settlement" and ref:
            a_view = menu.addAction("👁 عرض في شاشة التصفيات")
            a_view.triggered.connect(
                lambda *_: self._open_in_settlements(ref))
            try:
                from services import feature_service as _feat
                _can_edit = _feat.enabled("settle_edit")
            except Exception:
                _can_edit = True
            if _admin and _can_edit:
                a_edit = menu.addAction("✎ تعديل التصفية")
                a_edit.triggered.connect(self._edit_selected)
            a_print = menu.addAction("🖨 طباعة التصفية")
            a_print.triggered.connect(
                lambda *_: self._print_row(dict(item)))
            a_copy = menu.addAction("⧉ نسخ المرجع")
            a_copy.triggered.connect(lambda *_: self._copy_text(ref))
        elif kind == "handover":
            if _admin:
                a_edit = menu.addAction("✎ تعديل السند")
                a_edit.triggered.connect(self._edit_selected)
            a_print = menu.addAction("🖨 طباعة الحركة")
            a_print.triggered.connect(
                lambda *_: self._print_row(dict(item)))
            if ref:
                a_copy = menu.addAction("⧉ نسخ المرجع")
                a_copy.triggered.connect(
                    lambda *_: self._copy_text(ref))
        else:
            return
        menu.exec(self.table.viewport().mapToGlobal(pos))

    def _handover(self):
        try:
            from ui.vouchers import VoucherDialog
            dlg = VoucherDialog(self, "payment")
            try:
                dlg.custody_give.setChecked(True)
            except Exception:
                pass
            if dlg.exec() == QDialog.Accepted:
                self._load_accounts(); self.reload()
        except Exception as exc:
            style.error(self, f"تعذر فتح تسليم العهدة: {exc}")

    def _return_custody(self):
        try:
            _cur = None
            try:
                _cur = self.account.currentData()
            except Exception:
                pass
            dlg = CustodyReturnDialog(self, account_id=_cur)
            if dlg.exec() == QDialog.Accepted:
                self._load_accounts()
                self.reload()
        except Exception as exc:
            style.error(self, f"تعذر فتح إرجاع العهدة: {exc}")

    def _edit_selected(self):
        """V2.50: تعديل تسليم عهدة (مدير فقط) عبر حوار السند — التصفية لا تُعدّل."""
        try:
            from services import auth_service as _auth
            if not _auth.is_admin():
                style.toast(self, "تعديل العهد للمدير فقط.")
                return
        except Exception:
            pass
        row = self.table.currentRow()
        if row < 0 or row >= len(getattr(self, "_visible", [])):
            style.info(self, "حدد حركة تسليم من الكشف أولًا.")
            return
        meta = self._visible[row]
        item = meta.get("item") or {}
        if meta.get("type") != "main":
            style.info(self, "حدد حركة من الكشف أولًا.")
            return
        if item.get("kind") == "handover" and item.get("voucher_id"):
            self._edit_single_voucher(int(item["voucher_id"]))
            return
        if item.get("kind") == "settlement" and (item.get("ref") or ""):
            try:
                from services import feature_service as _feat_se
                if not _feat_se.enabled("settle_edit"):
                    style.info(self, "تعديل التصفية معطّل لهذا العميل.")
                    return
            except Exception:
                pass
            try:
                if SettlementEditDialog(self, item["ref"]).exec():
                    self._load_accounts()
                    self.reload()
            except Exception as exc:
                style.error(self, f"تعذر تعديل التصفية: {exc}")
            return
        style.info(self, "حدد حركة تسليم أو تصفية من الكشف أولًا.")

    def _edit_single_voucher(self, voucher_id: int):
        """V3.1: تعديل سند واحد (تسليم أو بند تصفية) عبر حوار السند."""
        try:
            v = lc.get_voucher(int(voucher_id))
            if not v:
                style.error(self, "السند غير موجود.")
                return
            from ui.vouchers import VoucherDialog
            from PySide6.QtWidgets import QDialog as _QD
            dlg = VoucherDialog(self, "payment", voucher=dict(v))
            if dlg.exec() == _QD.Accepted:
                self._load_accounts()
                self.reload()
        except Exception as exc:
            style.error(self, f"تعذر تعديل العهدة: {exc}")

    def _settle(self):
        if CustodySettlementDialog(self).exec() == QDialog.Accepted:
            self._load_accounts(); self.reload()

    def _blank_form(self):
        try:
            from reports.custody_pdf import generate_blank_custody_settlement_form
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False); tmp.close()
            generate_blank_custody_settlement_form(tmp.name)
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="نموذج تصفية عهدة فارغ",
                             save_name="نموذج_تصفية_عهدة_فارغ.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر إنشاء ملف PDF: {exc}")

    def _blank_excel_form(self):
        try:
            from PySide6.QtWidgets import QFileDialog
            default = os.path.join(os.path.expanduser("~"), "نموذج_تصفية_عهدة_للموظف.xlsx")
            path, _ = QFileDialog.getSaveFileName(
                self, "حفظ نموذج Excel للموظف", default, "Excel (*.xlsx)")
            if not path:
                return
            if not path.lower().endswith(".xlsx"):
                path += ".xlsx"
            from reports.custody_excel import generate_blank_custody_settlement_excel
            generate_blank_custody_settlement_excel(path)
            style.info(self, f"تم حفظ نموذج Excel:\n{path}", "تم")
            try:
                from ui.invoices import open_file_externally
                open_file_externally(path)
            except Exception:
                pass
        except Exception as exc:
            style.error(self, f"تعذر إنشاء نموذج Excel: {exc}")

    def _print_row(self, item: dict):
        try:
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False); tmp.close()
            if item.get("kind") == "settlement":
                from reports.custody_pdf import generate_custody_pdf
                data = lc.custody_settlement(item.get("ref") or "")
                generate_custody_pdf(data, tmp.name)
                title = "كشف تصفية عهدة"
                save = f"تصفية_عهدة_{item.get('ref','')}.pdf"
            else:
                from reports.voucher_pdf import generate_voucher_pdf
                v = lc.get_voucher(int(item.get("voucher_id") or 0))
                generate_voucher_pdf(v, tmp.name)
                title = "سند تسليم عهدة"
                save = f"سند_تسليم_عهدة_{item.get('ref','')}.pdf"
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title=title, save_name=save).exec()
        except Exception as exc:
            style.error(self, f"تعذر طباعة الحركة: {exc}")

    def _print_ledger(self):
        try:
            from reports.custody_pdf import generate_custody_ledger_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False); tmp.close()
            generate_custody_ledger_pdf(self._ledger, tmp.name,
                                        include_details=self.include_details.isChecked())
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title="كشف حساب العهدة",
                             save_name="كشف_حساب_العهدة.pdf").exec()
        except Exception as exc:
            style.error(self, f"تعذر طباعة كشف الحساب: {exc}")

    def _excel(self):
        from PySide6.QtWidgets import QFileDialog
        default = os.path.join(os.path.expanduser("~"), "كشف_حساب_العهدة.xlsx")
        path, _ = QFileDialog.getSaveFileName(self, "حفظ كشف حساب العهدة", default, "Excel (*.xlsx)")
        if not path:
            return
        if not path.lower().endswith(".xlsx"):
            path += ".xlsx"
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment
            wb = Workbook()
            ws = wb.active; ws.title = "كشف الحساب"; ws.sheet_view.rightToLeft = True
            heads = ["التاريخ", "المرجع", "العهدة", "البيان", "وارد", "منصرف", "الرصيد"]
            ws.append(heads)
            for c in ws[1]:
                c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1E3A5F"); c.alignment = Alignment(horizontal="center")
            for r in self._ledger.get("rows") or []:
                ws.append([r.get("vdate"), r.get("ref"), r.get("custody_account") or "",
                           r.get("description"),
                           float(r.get("in") or 0) or "",
                           float(r.get("out") or 0) or "",
                           float(r.get("balance") or 0)])
            ws2 = wb.create_sheet("تفاصيل التصفيات"); ws2.sheet_view.rightToLeft = True
            ws2.append(["مرجع التصفية", "رقم السند", "التاريخ", "حساب المصروف", "الجهة/المورد", "العقد", "البيان", "المبلغ"])
            for c in ws2[1]:
                c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1E3A5F"); c.alignment = Alignment(horizontal="center")
            for r in self._ledger.get("rows") or []:
                if r.get("kind") != "settlement":
                    continue
                for d in r.get("details") or []:
                    ws2.append([r.get("ref"), d.get("voucher_number"), d.get("vdate"),
                                d.get("expense_account_snapshot") or d.get("account"),
                                d.get("party"), (((d.get("contract_customer_name") or "").strip() + " — ") if (d.get("contract_customer_name") or "").strip() else "") + (d.get("contract_number") or d.get("contract_label") or ""),
                                d.get("description"), float(d.get("amount") or 0)])
            for sheet, wide in ((ws, 4), (ws2, 7)):
                for col in range(1, sheet.max_column + 1):
                    sheet.column_dimensions[chr(64 + col)].width = 18 if col != wide else 44
            wb.save(path)
            style.info(self, f"تم حفظ كشف الحساب:\n{path}", "تم")
            try:
                from ui.invoices import open_file_externally
                open_file_externally(path)
            except Exception:
                pass
        except Exception as exc:
            style.error(self, f"تعذر تصدير Excel: {exc}")


class CustodyCenterPage(CustodyLedgerWidget):
    """صفحة العهدة (غلاف توافقي V3.9/دفعة 1): ودجت الكشف كصفحة مستقلة."""


class CustodyUnifiedPage(QWidget):
    """صفحة «العهد» الموحدة — تنقل علوي (V3.12: تابات بدل الجانبي).

    تضم ودجت الكشف + شاشة التصفيات + ودجت التقارير (يُبنى كسولًا
    عند أول فتح). مزامنة الحساب المختار بين الأقسام تلقائيًا.
    """

    SECTIONS = (("ledger", "🧾  الكشف والحركات"),
                ("settlements", "📑  التصفيات"),
                ("reports", "📊  التقارير"))

    #: مهلة عدم إعادة التحميل عند التنقل السريع بين الأقسام
    _REFRESH_TTL = 8.0

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)
        self.tabs = QTabWidget()
        self.ledger = CustodyLedgerWidget()
        from ui.custody_settlements import CustodySettlementsPage
        self.settlements = CustodySettlementsPage()
        self.tabs.addTab(self.ledger, self.SECTIONS[0][1])
        self.tabs.addTab(self.settlements, self.SECTIONS[1][1])
        self._reports = None
        lay.addWidget(self.tabs, 1)
        self._last_refresh: dict = {}
        self._syncing = False
        try:
            self.ledger.account.currentIndexChanged.connect(
                lambda _i: self._sync_value(
                    self.ledger.account.currentData()))
            self.settlements.account.currentIndexChanged.connect(
                lambda _i: self._sync_value(
                    self.settlements.account.currentData()))
        except Exception:
            pass
        self.tabs.currentChanged.connect(self._show_tab)
        self.tabs.setCurrentIndex(0)
        self._show_tab(0)

    # ---------- التقارير (بناء كسول) ----------
    def _ensure_reports(self):
        if self._reports is None:
            self._reports = CustodyReportsWidget()
            self.tabs.addTab(self._reports, self.SECTIONS[2][1])
            try:
                self._reports.account.currentIndexChanged.connect(
                    lambda _i: self._sync_value(
                        self._reports.account.currentData()))
                self._reports.eaccount.currentIndexChanged.connect(
                    lambda _i: self._sync_value(
                        self._reports.eaccount.currentData()))
                self._sync_value(self.ledger.account.currentData())
            except Exception:
                pass
        return self._reports

    @property
    def reports(self):
        return self._ensure_reports()

    # ---------- التنقل بين الأقسام ----------
    def show_section(self, name: str):
        idx = {"ledger": 0, "settlements": 1, "reports": 2}.get(name, 0)
        self.tabs.setCurrentIndex(idx)
        self._show_tab(idx)

    def _show_tab(self, row: int):
        if row == 2:
            self._ensure_reports()
        if 0 <= row < self.tabs.count():
            self.tabs.setCurrentIndex(row)
            self._refresh_section(row)

    def _refresh_section(self, row: int):
        import time as _t
        now = _t.time()
        if now - self._last_refresh.get(row, 0) < self._REFRESH_TTL:
            return
        self._last_refresh[row] = now
        try:
            if row == 0:
                self.ledger.reload()
            elif row == 1:
                self.settlements.reload()
            elif row == 2 and self._reports is not None:
                cur = self._reports.tabs.currentIndex()
                [self._reports.refresh,
                 self._reports._refresh_balances,
                 self._reports._refresh_employee,
                 self._reports._refresh_open][cur]()
        except Exception:
            pass

    def refresh(self):
        """تحديث القسم المعروض — يستدعيها التنقل الرئيسي عند فتح الصفحة."""
        try:
            self._last_refresh.pop(self.tabs.currentIndex(), None)
            self._refresh_section(self.tabs.currentIndex())
        except Exception:
            pass

    # ---------- مزامنة الحساب ----------
    def _sync_value(self, account_id):
        if self._syncing:
            return
        self._syncing = True
        try:
            combos = [self.ledger.account, self.settlements.account]
            if self._reports is not None:
                combos.extend([self._reports.account,
                               self._reports.eaccount])
            for combo in combos:
                try:
                    idx = combo.findData(account_id)
                    if idx >= 0 and combo.currentIndex() != idx:
                        combo.setCurrentIndex(idx)
                except Exception:
                    continue
        finally:
            self._syncing = False
