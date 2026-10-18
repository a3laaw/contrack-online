# -*- coding: utf-8 -*-
"""شاشة إدارة العقود."""
from PySide6.QtCore import QDate, QRegularExpression, Qt, Signal
from PySide6.QtGui import QColor, QRegularExpressionValidator
from PySide6.QtWidgets import (
    QComboBox, QDateEdit, QDialog, QDoubleSpinBox, QFormLayout, QFrame,
    QHBoxLayout, QHeaderView, QLabel, QLineEdit, QPushButton,
    QStyledItemDelegate, QTableWidget, QTableWidgetItem, QTextEdit,
    QVBoxLayout, QWidget,
)

# V4.5.10: قيمة الدفعة في جدول «المراحل والدفعات» — رقم فقط، والنص
# «تُحدد لاحقًا» إرشادي (بلا كتابة يدوية ولا يقبل إلا الأرقام).
_PLAN_AMOUNT_HINT = "تُحدد لاحقًا"


def _normalize_amount_text(text) -> str:
    """يحوّل الأرقام/الفواصل العربية إلى صيغة قابلة للحساب (V4.5.10)."""
    s = str(text or "").strip()
    s = s.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    for _ch in ("٫", "٬", ",", " ", "\u00a0"):
        s = s.replace(_ch, "." if _ch == "٫" else "")
    return s


def _paint_amount_hint(item, suffix: str = "") -> None:
    """يجعل «تُحدد لاحقًا» نصًا إرشاديًا رماديًا (V4.5.10)."""
    if item is None:
        return
    try:
        item.setForeground(QColor(getattr(style, "MUTED", "") or "#8a8a8a"))
    except Exception:
        pass
    if suffix:
        item.setText(f"{_PLAN_AMOUNT_HINT} ({suffix})")


class _PlanAmountDelegate(QStyledItemDelegate):
    """محرّر «قيمة الدفعة»: أرقام فقط + «تُحدد لاحقًا» كنص إرشادي.

    قبل V4.5.10 كانت الخانة نصًا حرًا: أي كتابة غير رقمية تُصفَّر إلى
    0.000. الآن عند فتح التحرير تظهر الخانة فارغة، ويظهر «تُحدد لاحقًا»
    كنص إرشادي رمادي داخلها، ولا تُقبل إلا الأرقام (بمنع الحروف)،
    وترك الخانة فارغة يعيد النص الإرشادي ويلغي قيمة تلك الدفعة.
    """

    def createEditor(self, parent, option, index):  # noqa: N802
        ed = QLineEdit(parent)
        ed.setValidator(QRegularExpressionValidator(
            QRegularExpression(r"[0-9٠-٩]{0,12}([.,٫][0-9٠-٩]{0,3})?"), ed))
        ed.setPlaceholderText(_PLAN_AMOUNT_HINT)
        ed.setAlignment(Qt.AlignCenter)
        return ed

    def setEditorData(self, editor, index):  # noqa: N802
        txt = str(index.data(Qt.EditRole) or "")
        if _PLAN_AMOUNT_HINT in txt:
            editor.setText("")
        else:
            editor.setText(_normalize_amount_text(txt))
        editor.selectAll()

    def setModelData(self, editor, model, index):  # noqa: N802
        model.setData(index, (editor.text() or "").strip(), Qt.EditRole)

from services.db_facade_service import DatabaseError
from database.models import Contract
from services import contract_service, customer_service
from services.customer_service import ValidationError
from ui import style
from ui.design_system import Colors, Dimensions, Fonts, Styles
from ui.widgets import required_label, SearchableComboBox, SafeDoubleSpinBox, SafeDateEdit, make_searchable


class ContractDialog(QDialog):
    """نافذة إضافة / تعديل عقد."""

    def __init__(self, parent=None, contract: Contract | None = None):
        super().__init__(parent)
        self.contract = contract
        self._plan_amount_overrides: dict[int, float] = {}
        self._plan_row_tpl: dict[int, str] = {}
        self._plan_no_map: dict[int, int] = {}
        self._plan_preview_loading = False
        self._plan_tpl_mode = False
        title = "تعديل عقد" if contract else "إضافة عقد جديد"
        style.setup_dialog(
            self, title,
            "بيانات العقد وقيمته ودفعات السداد",
            icon="📑", color=style.INFO, size_ratio=0.88,
            min_w=980, max_w=1400, fullscreen=True)
        # شاشة العقد أصبحت غنية بالبيانات؛ لذلك تُفتح بحجم عمل كبير
        # وقابلة للتكبير بدل نافذة صغيرة مزدحمة.
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        try:
            style.fit_window(self, 1220, 820, min_w=980, min_h=680,
                             ratio=0.96)
        except Exception:
            self.resize(1220, 820)
        from PySide6.QtWidgets import QWidget as _QW, QGridLayout as _QGL

        # ── نمط موحّد للحقول (Compact Design) ────────────────────
        _FIELD_H = 28
        _FIELD_SS = (
            f"QLineEdit, QComboBox, QDateEdit, QDoubleSpinBox, QSpinBox {{"
            f" min-height: {_FIELD_H}px; max-height: {_FIELD_H}px;"
            f" padding: 3px 6px; font-size: 11px;"
            f" border: 0.5px solid #D1D5DB; border-radius: 6px;"
            f" background: #F9FAFB; color: #111827; }}"
            f" QLineEdit:focus, QComboBox:focus, QDateEdit:focus,"
            f" QDoubleSpinBox:focus, QSpinBox:focus {{"
            f" border-color: #2563EB; background: #FFFFFF;"
            f" }}"
        )
        _LABEL_SS = (
            "QLabel { font-size: 10px; font-weight: 600;"
            " color: #9CA3AF; background: transparent; border: none;"
            " padding: 0px; margin: 0px; }"
        )
        _DESC_SS = (
            f"QTextEdit {{"
            f" min-height: {_FIELD_H}px; max-height: {_FIELD_H}px;"
            f" padding: 3px 6px; font-size: 11px;"
            f" border: 0.5px solid #D1D5DB; border-radius: 6px;"
            f" background: #F9FAFB; color: #111827; }}"
            f" QTextEdit:focus {{"
            f" border-color: #2563EB; background: #FFFFFF; }}"
        )

        # ── بطاقة النموذج ─────────────────────────────────────────
        form_card = _QW()
        form_card.setObjectName("formCard")
        form_card.setStyleSheet(
            "#formCard { background: #FFFFFF; border: 1px solid #E5E7EB;"
            " border-radius: 10px; padding: 6px; }")
        grid = _QGL(form_card)
        grid.setContentsMargins(6, 4, 6, 4)
        grid.setHorizontalSpacing(6)
        grid.setVerticalSpacing(4)

        # ── إنشاء الحقول ──────────────────────────────────────────
        self.number = QLineEdit()
        self.number.setStyleSheet(_FIELD_SS)

        self.customer = SearchableComboBox(search_only=True)
        self._customers = customer_service.list_customers()
        from ui.widgets import customer_items
        self.customer.set_items(customer_items(), auto_select=False)
        self.customer.setStyleSheet(_FIELD_SS)

        self.date = SafeDateEdit()
        self.date.setCalendarPopup(True)
        self.date.setDisplayFormat("yyyy-MM-dd")
        self.date.setDate(QDate.currentDate())
        self.date.setStyleSheet(_FIELD_SS)

        self.description = QTextEdit()
        self.description.setStyleSheet(_DESC_SS)

        from PySide6.QtWidgets import QComboBox as _QCB
        from services import contract_type_service as _cts
        self.ctype = _QCB()
        self.ctype.setStyleSheet(_FIELD_SS)
        self._types = _cts.list_types()
        for _t in self._types:
            label = _t["name"]
            _unit = (_t.get("unit_label") or "").strip()
            _uprice = float(_t.get("unit_price") or 0)
            if _unit and _uprice:
                label += f"   ({_uprice:,.3f} د.ك / {_unit})"
            elif _t["default_amount"]:
                label += f"   ({_t['default_amount']:,.3f} د.ك)"
            self.ctype.addItem(label, _t["name"])
        self.ctype.setCurrentIndex(-1)
        make_searchable(self.ctype, "")
        self.ctype.currentIndexChanged.connect(self._type_changed)

        self.contract_name_hint = QLabel("اسم العقد المعروض: —")
        self.contract_name_hint.setProperty("hint", True)
        self.contract_name_hint.setWordWrap(True)
        self.contract_name_hint.setVisible(False)
        self.contract_name_hint.setMaximumHeight(0)
        # mode_banner: مُزال — كان يظهر كنافذة منبثقة لأن ليس في layout

        self.amount = SafeDoubleSpinBox()
        self.amount.setDecimals(3)
        self.amount.setRange(0, 999_999_999)
        self.amount.setGroupSeparatorShown(True)
        self.amount.setStyleSheet(_FIELD_SS)

        # ===== التسعير بالكمية: الكمية × سعر الوحدة =====
        from ui.widgets import SafeSpinBox as _SSpinQ
        self.qty = _SSpinQ()
        self.qty.setRange(1, 100000)
        self.qty.setValue(1)
        self.qty.setFixedWidth(80)
        self.qty.setStyleSheet(_FIELD_SS)
        self.unit_price = SafeDoubleSpinBox()
        self.unit_price.setDecimals(3)
        self.unit_price.setRange(0, 999_999_999)
        self.unit_price.setGroupSeparatorShown(True)
        self.unit_price.setStyleSheet(_FIELD_SS)
        self.qty_unit_lbl = QLabel("وحدة")
        self.qty_unit_lbl.setStyleSheet(
            f"background: transparent; border: none; color: {Colors.TEXT};"
            " font-size: 11px;")
        self.gross_lbl = QLabel("")
        self.gross_lbl.setStyleSheet(
            f"background: transparent; border: none;"
            f" font-weight: {Fonts.WEIGHT_BOLD}; color: {Colors.TEXT};"
            " font-size: 11px;")
        qty_row = QHBoxLayout()
        qty_row.setContentsMargins(0, 0, 0, 0)
        qty_row.setSpacing(6)
        qty_row.addWidget(self.qty)
        qty_row.addWidget(self.qty_unit_lbl)
        qty_row.addWidget(QLabel("×"))
        qty_row.addWidget(self.unit_price, 1)
        qty_row.addWidget(self.gross_lbl)
        self.qty_host = QWidget()
        self.qty_host.setObjectName("transparentHost")
        self.qty_host.setLayout(qty_row)

        self.discount_lbl = QLabel("")
        self.discount_lbl.setWordWrap(True)
        self.discount_lbl.setStyleSheet(
            f"background: transparent; border: none; color: {Colors.TEXT};"
            " font-size: 11px;")

        self.qty.valueChanged.connect(self._qty_changed)
        self.unit_price.valueChanged.connect(self._qty_changed)
        self.amount.valueChanged.connect(self._update_discount)
        self.amount.valueChanged.connect(
            lambda _v: self._update_items_total())
        self.notes = QTextEdit()
        self.notes.setFixedHeight(70)

        if contract:
            self.number.setText(contract.contract_number)
            self.customer.select_data(contract.customer_id)
            self.date.setDate(QDate.fromString(contract.contract_date, "yyyy-MM-dd"))
            self.description.setPlainText(contract.description)
            _idx = self.ctype.findData(
                getattr(contract, "contract_type", "") or "")
            if _idx >= 0:
                self.ctype.setCurrentIndex(_idx)
            self.amount.setValue(contract.amount)
            self.qty.setValue(int(getattr(contract, "qty", 1) or 1))
            self.unit_price.setValue(
                float(getattr(contract, "unit_price", 0) or 0))
            self.notes.setPlainText(contract.notes)
        else:
            self.number.setText(contract_service.next_contract_number())

        # ── ملء الشبكة 2 صفوف × 4 أعمدة ─────────────────────────
        def _lbl(text, required=False):
            l = QLabel(required_label(text) if required else text)
            l.setStyleSheet(_LABEL_SS)
            l.setContentsMargins(4, 0, 4, 0)
            return l

        # الصف 1: رقم العقد | التاريخ | العميل | نوع العقد
        # التسميات داخل الحقول (placeholders)
        self.number.setPlaceholderText("رقم العقد *")
        self.date.setDisplayFormat("yyyy-MM-dd")
        self.ctype.setPlaceholderText("نوع العقد *") if hasattr(self.ctype, 'setPlaceholderText') else None
        
        grid.addWidget(self.number, 0, 0)
        grid.addWidget(self.date, 0, 1)
        grid.addWidget(self.customer, 0, 2)
        grid.addWidget(self.ctype, 0, 3)

        # الصف 2: قيمة العقد | الكمية×السعر | الوصف
        # V9.15.10: بطاقة «قيمة العقد» مستقلة بجانب خانة الرقم فقط
        self.amount.setPrefix("")
        _amount_host = QWidget()
        _amount_host.setObjectName("transparentHost")
        _amount_row = QHBoxLayout(_amount_host)
        _amount_row.setContentsMargins(0, 0, 0, 0)
        _amount_row.setSpacing(6)
        _amount_card = QLabel(required_label("قيمة العقد"))
        _amount_card.setStyleSheet(
            "background: #EEF6FF; border: 1px solid #93C5FD;"
            " border-radius: 10px; padding: 4px 10px;"
            " font-weight: 700; color: #1E40AF;")
        _amount_card.setAlignment(Qt.AlignCenter)
        _amount_row.addWidget(_amount_card)
        _amount_row.addWidget(self.amount, 1)
        grid.addWidget(_amount_host, 1, 0)
        grid.addWidget(self.qty_host, 1, 1)
        self.description.setPlaceholderText("الوصف")
        grid.addWidget(self.description, 1, 2, 1, 2)

        # ملاحظة الخصم (مخفي — يظهر فقط عند وجود خصم/زيادة)
        grid.addWidget(self.discount_lbl, 2, 0, 1, 4)
        self.discount_lbl.setVisible(False)
        self._insert_at = 3

        # ══════════════════════════════════════════════════════════════
        # تركيب النموذج: حقول + Splitter
        # ══════════════════════════════════════════════════════════════
        from PySide6.QtWidgets import (QScrollArea as _QSA,
                                       QSplitter as _QSplit,
                                       QGroupBox as _QGB)

        column = _QW()
        col_l = QVBoxLayout(column)
        col_l.setContentsMargins(2, 2, 2, 2)
        col_l.setSpacing(4)
        col_l.addWidget(form_card)

        # ── حقول الإشراف (تظهر/تحتفي حسب نوع العقد) ───────────────
        from PySide6.QtWidgets import QGridLayout as _QG2
        from ui.widgets import SafeSpinBox as _SSpin
        sup_box = _QW()
        sup_box.setStyleSheet(
            "background: #FFFFFF; border: 1px solid #E5E7EB;"
            " border-radius: 10px; padding: 6px;")
        sup_l = _QG2(sup_box)
        sup_l.setContentsMargins(8, 4, 8, 4)
        sup_l.setHorizontalSpacing(6)
        sup_l.setVerticalSpacing(4)
        _lbl1 = QLabel("تاريخ البداية")
        _lbl2 = QLabel("المدة (أشهر)")
        _lbl3 = QLabel("قيمة الشهر")
        _lbl4 = QLabel("خصم الإشراف")
        for _l in (_lbl1, _lbl2, _lbl3, _lbl4):
            _l.setStyleSheet(_LABEL_SS)
        self.sup_start = SafeDateEdit()
        self.sup_start.setCalendarPopup(True)
        self.sup_start.setDisplayFormat("yyyy-MM-dd")
        self.sup_start.setDate(QDate.currentDate())
        self.sup_start.setStyleSheet(_FIELD_SS)
        self.sup_months = _SSpin()
        self.sup_months.setRange(0, 120)
        self.sup_months.setValue(4)
        self.sup_months.setStyleSheet(_FIELD_SS)
        self.sup_monthly = SafeDoubleSpinBox()
        self.sup_monthly.setDecimals(3)
        self.sup_monthly.setRange(0, 999_999)
        self.sup_monthly.setGroupSeparatorShown(True)
        self.sup_monthly.setStyleSheet(_FIELD_SS)
        self.sup_discount = SafeDoubleSpinBox()
        self.sup_discount.setDecimals(3)
        self.sup_discount.setRange(0, 999_999)
        self.sup_discount.setGroupSeparatorShown(True)
        self.sup_discount.setStyleSheet(_FIELD_SS)
        self.sup_value_lbl = QLabel("")
        self.sup_value_lbl.setStyleSheet(
            "background: transparent; border: none;"
            " font-weight: 600; color: #2563EB; font-size: 11px;")
        sup_l.addWidget(_lbl1, 0, 0)
        sup_l.addWidget(self.sup_start, 1, 0)
        sup_l.addWidget(_lbl2, 0, 1)
        sup_l.addWidget(self.sup_months, 1, 1)
        sup_l.addWidget(_lbl3, 0, 2)
        sup_l.addWidget(self.sup_monthly, 1, 2)
        sup_l.addWidget(_lbl4, 0, 3)
        sup_l.addWidget(self.sup_discount, 1, 3)
        sup_l.addWidget(self.sup_value_lbl, 0, 4, 2, 1)
        sup_box.setVisible(False)
        sup_box.setMaximumHeight(0)  # لا يأخذ مساحة_when hidden
        self._sup_box = sup_box
        self.sup_months_lbl = _lbl2
        self.sup_monthly_lbl = _lbl3
        self.sup_discount_lbl = _lbl4
        self.sup_months.valueChanged.connect(lambda _v: self._sup_changed())
        self.sup_monthly.valueChanged.connect(lambda _v: self._sup_changed())
        self.sup_discount.valueChanged.connect(lambda _v: self._sup_changed())
        col_l.addWidget(sup_box)

        # ══════════════════════════════════════════════════════════════
        # مكوّنات العقد الشامل (bundle_box)
        # ══════════════════════════════════════════════════════════════
        bundle_box = _QW()
        bundle_box.setStyleSheet(
            "background: #FFFFFF; border: 1px solid #E5E7EB;"
            " border-radius: 10px; padding: 6px;")
        bundle_l = QVBoxLayout(bundle_box)
        bundle_l.setContentsMargins(8, 4, 8, 4)
        bundle_l.setSpacing(4)
        self.bundle_title = QLabel("🧩 مكوّنات النطاق")
        self.bundle_title.setStyleSheet(
            "font-weight: 700; background: transparent; border: none;"
            " font-size: 11px;")
        bundle_l.addWidget(self.bundle_title)
        self.bundle_hint = QLabel("")
        self.bundle_hint.setWordWrap(True)
        self.bundle_hint.setStyleSheet(
            "background: transparent; border: none; color: #6B7280;"
            " font-size: 10px;")
        bundle_l.addWidget(self.bundle_hint)
        self.bundle_rows = QVBoxLayout()
        self.bundle_rows.setSpacing(2)
        bundle_l.addLayout(self.bundle_rows)
        bundle_box.setVisible(False)
        bundle_box.setMaximumHeight(0)  # لا يأخذ مساحة_when hidden
        self._bundle_box = bundle_box
        self._bundle_cards: list = []
        col_l.addWidget(bundle_box)

        # ══════════════════════════════════════════════════════════════
        # المراحل الرئيسية اليدوية (stages_box)
        # ══════════════════════════════════════════════════════════════
        stages_box = _QW()
        stages_box.setStyleSheet(
            "background: #FFFFFF; border: 1px solid #E5E7EB;"
            " border-radius: 10px; padding: 6px;")
        stages_l = QVBoxLayout(stages_box)
        stages_l.setContentsMargins(8, 4, 8, 4)
        stages_l.setSpacing(4)
        self.stages_title = QLabel("🧩 المراحل الرئيسية")
        self.stages_title.setStyleSheet(
            "font-weight: 700; background: transparent; border: none;"
            " font-size: 11px;")
        stages_l.addWidget(self.stages_title)
        self.stages_hint = QLabel("")
        self.stages_hint.setWordWrap(True)
        self.stages_hint.setStyleSheet(
            "background: transparent; border: none; color: #6B7280;"
            " font-size: 10px;")
        stages_l.addWidget(self.stages_hint)
        self.stages_rows = QVBoxLayout()
        self.stages_rows.setSpacing(2)
        stages_l.addLayout(self.stages_rows)
        stages_btns = QHBoxLayout()
        self.stages_add = QPushButton("＋ إضافة مرحلة")
        self.stages_add.setProperty("flat", True)
        self.stages_add.clicked.connect(self._add_manual_stage_row)
        stages_btns.addWidget(self.stages_add)
        stages_btns.addStretch()
        self.stages_remaining = QLabel("")
        self.stages_remaining.setStyleSheet(
            "background: transparent; border: none; font-weight: 700;"
            " font-size: 11px;")
        stages_btns.addWidget(self.stages_remaining)
        stages_l.addLayout(stages_btns)
        stages_box.setVisible(False)
        stages_box.setMaximumHeight(0)  # لا يأخذ مساحة_when hidden
        self._stages_box = stages_box
        self._stage_rows: list = []
        self._stages_has_tpl = False
        col_l.addWidget(stages_box)

        # ── widgets مخفية في layout (جذع لمنع crash + نوافذ عائمة) ──
        self._qty_row_label = QLabel("")
        self._qty_row_label.setVisible(False)
        self._qty_row_label.setMaximumHeight(0)
        col_l.addWidget(self._qty_row_label)  # لازم يكون في layout عشان ما يظهرش كنافذة
        col_l.addWidget(self.contract_name_hint)  # orphan fix
        self._items_box = QWidget()
        self._items_box.setVisible(False)
        self._items_box.setMaximumHeight(0)
        col_l.addWidget(self._items_box)

        # ── Splitter: نطاق العقد (يسار) | خطة السداد (يمين) ───────
        splitter = _QSplit(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        self._splitter = splitter

        # ── خطة السداد (تُضاف يمين في الـ splitter) ──────────────
        left_box = _QGB("📆 خطة السداد")
        _PURPLE_SS = (
            "QGroupBox { font-weight: bold; border: 1px solid #DDD6FE;"
            " border-radius: 8px; margin-top: 4px; padding-top: 8px;"
            " font-size: 11px; color: #7C3AED;"
            " background: qlineargradient(x1:0,y1:0,x2:0,y2:1,"
            " stop:0 #F5F3FF, stop:1 #FFFFFF); }"
            " QGroupBox::title { subcontrol-origin: margin;"
            " left: 10px; padding: 0 6px; color: #7C3AED;"
            " font-weight: 700; }"
        )
        left_box.setStyleSheet(_PURPLE_SS)
        plan_l = QVBoxLayout(left_box)
        plan_l.setContentsMargins(4, 2, 4, 2)
        plan_l.setSpacing(2)

        head_row = QHBoxLayout()
        self.plan_title = QLabel("📆 دفعات السداد"
                                  if not contract else
                                  "📆 دفعات السداد الحالية")
        self.plan_title.setStyleSheet(
            "font-weight: 700; background: transparent;"
            " border: none; color: #1F2937; font-size: 11px;")
        head_row.addWidget(self.plan_title)
        head_row.addStretch()
        self.plan_auto_lbl = QLabel("")
        self.plan_auto_lbl.setStyleSheet(
            "background: transparent; border: none; font-weight: 700;"
            " font-size: 11px;")
        head_row.addWidget(self.plan_auto_lbl)
        if contract:
            self.plan_add_btn = QPushButton("＋ إضافة دفعة")
            self.plan_add_btn.setProperty("flat", True)
            self.plan_add_btn.clicked.connect(self._plan_add_item)
            head_row.addWidget(self.plan_add_btn)
            self.plan_del_btn = QPushButton("🗑 حذف المحددة")
            self.plan_del_btn.setProperty("flat", True)
            self.plan_del_btn.clicked.connect(self._plan_delete_item)
            head_row.addWidget(self.plan_del_btn)
        self.plan_return_btn = QPushButton("↩ إرجاع المحدد")
        self.plan_return_btn.setProperty("flat", True)
        self.plan_return_btn.setToolTip("إرجاع الدفعات المحددة لقيمها الأصلية من القالب")
        self.plan_return_btn.clicked.connect(self._plan_return_selected)
        head_row.addWidget(self.plan_return_btn)
        plan_l.addLayout(head_row)

        self.plan_hint = QLabel(
            "يتم تحميل مراحل ودفعات نوع العقد تلقائيًا."
            if not contract else
            "عدّل قيمة أي دفعة — يجب أن يساوي المجموع قيمة العقد.")
        self.plan_hint.setStyleSheet(
            "background: transparent; border: none; color: #6B7280;"
            " font-size: 10px;")
        self.plan_hint.setWordWrap(True)
        plan_l.addWidget(self.plan_hint)

        self.plan_table = QTableWidget(0, 6)
        self.plan_table.setHorizontalHeaderLabels(
            ["✔", "#", "المرحلة", "طريقة القيمة", "قيمة الدفعة", "الاستحقاق"])
        self.plan_table.verticalHeader().setVisible(False)
        self.plan_table.setEditTriggers(
            QTableWidget.DoubleClicked | QTableWidget.EditKeyPressed
            | QTableWidget.SelectedClicked)
        self.plan_table.setSelectionMode(QTableWidget.SingleSelection)
        self.plan_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.plan_table.setAlternatingRowColors(True)
        self.plan_table.setStyleSheet(
            "QTableWidget { border: 1px solid #DDD6FE; border-radius: 6px;"
            " background: #FFFFFF; gridline-color: #EDE9FE; }"
            " QHeaderView::section { background: #7C3AED; color: #FFFFFF;"
            " font-weight: 700; font-size: 11px; padding: 4px;"
            " border: none; border-bottom: 2px solid #6D28D9;"
            " border-right: 1px solid #8B5CF6; }"
            " QTableWidget::item { padding: 4px; font-size: 11px; }"
            " QTableWidget::item:selected { background: #EDE9FE; color: #1F2937; }"
            " QTableWidget::item:alternate { background: #FAF5FF; }"
        )
        self.plan_table.itemChanged.connect(self._plan_amount_changed)
        self.plan_table.setItemDelegateForColumn(
            4, _PlanAmountDelegate(self.plan_table))
        from ui.widgets import apply_column_weights as _plan_weights
        _plan_weights(self.plan_table, [4, 4, 30, 12, 14, 36],
                      min_widths=[30, 36, 140, 80, 100, 150])
        plan_l.addWidget(self.plan_table, 1)

        self.plan_total_lbl = QLabel("مجموع الدفعات: 0.000 د.ك")
        self.plan_total_lbl.setStyleSheet(
            "background: transparent; border: none;"
            " font-weight: 700; color: #1F2937; font-size: 11px;")
        plan_l.addWidget(self.plan_total_lbl)

        self._plan_box = left_box

        # ── يمين: نطاق العقد (جدول) ─────────────────────────────
        right_box = _QGB("🎯 نطاق العقد")
        _TEAL_SS = (
            "QGroupBox { font-weight: bold; border: 1px solid #99F6E4;"
            " border-radius: 8px; margin-top: 4px; padding-top: 8px;"
            " font-size: 11px; color: #0F766E;"
            " background: qlineargradient(x1:0,y1:0,x2:0,y2:1,"
            " stop:0 #F0FDFA, stop:1 #FFFFFF); }"
            " QGroupBox::title { subcontrol-origin: margin;"
            " left: 10px; padding: 0 6px; color: #0F766E;"
            " font-weight: 700; }"
        )
        right_box.setStyleSheet(_TEAL_SS)
        scope_l = QVBoxLayout(right_box)
        scope_l.setContentsMargins(4, 2, 4, 2)
        scope_l.setSpacing(2)

        scope_head = QHBoxLayout()
        scope_head.addStretch()
        self.scope_all = QPushButton("✓ الكل")
        self.scope_all.setProperty("flat", True)
        self.scope_all.clicked.connect(lambda: self._set_scope_all(True))
        scope_head.addWidget(self.scope_all)
        self.scope_none = QPushButton("✕ لا شيء")
        self.scope_none.setProperty("flat", True)
        self.scope_none.clicked.connect(lambda: self._set_scope_all(False))
        scope_head.addWidget(self.scope_none)
        self.scope_apply = QPushButton("⬇ نزّل الدفعات")
        self.scope_apply.setProperty("flat", True)
        self.scope_apply.clicked.connect(self._apply_scope_to_plan)
        scope_head.addWidget(self.scope_apply)
        scope_l.addLayout(scope_head)

        # جدول البنود (بديل scope_tree)
        self.scope_table = QTableWidget(0, 4)
        self.scope_table.setHorizontalHeaderLabels(
            ["✔", "البند/المرحلة", "الكمية", "السعر"])
        self.scope_table.setStyleSheet(
            "QTableWidget { border: 1px solid #99F6E4; border-radius: 6px;"
            " background: #FFFFFF; gridline-color: #CCFBF1; }"
            " QHeaderView::section { background: #0D9488; color: #FFFFFF;"
            " font-weight: 700; font-size: 11px; padding: 4px;"
            " border: none; border-bottom: 2px solid #0F766E;"
            " border-right: 1px solid #14B8A6; }"
            " QTableWidget::item { padding: 4px; font-size: 11px; }"
            " QTableWidget::item:selected { background: #CCFBF1; color: #1F2937; }"
            " QTableWidget::item:alternate { background: #F0FDFA; }"
        )
        self.scope_table.verticalHeader().setVisible(False)
        self.scope_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.scope_table.setSelectionMode(QTableWidget.NoSelection)
        self.scope_table.setAlternatingRowColors(True)
        self.scope_table.itemChanged.connect(self._sync_scope_table)
        _plan_weights(self.scope_table, [8, 50, 21, 21],
                      min_widths=[30, 120, 60, 60])
        scope_l.addWidget(self.scope_table, 1)

        scope_foot = QHBoxLayout()
        self.scope_count = QLabel("")
        self.scope_count.setStyleSheet(
            "background: transparent; border: none; font-weight: 700;"
            " font-size: 11px;")
        scope_foot.addWidget(self.scope_count)
        self._scope_stale = QLabel("⚠ المختار اتغيّر — دوس ⬇ نزّل الدفعات")
        self._scope_stale.setStyleSheet(
            "background: transparent; border: none; font-weight: 700;"
            " color: #B45309; font-size: 10px;")
        self._scope_stale.setVisible(False)
        scope_foot.addWidget(self._scope_stale)
        scope_foot.addStretch()
        scope_l.addLayout(scope_foot)

        self._scope_box = right_box
        # الترتيب: scope_table يسار (index 0)، plan_table يمين (index 1)
        splitter.addWidget(right_box)   # index 0 = يسار = نطاق العقد
        splitter.addWidget(left_box)    # index 1 = يمين = خطة السداد

        # نسبة 44/56 — نطاق العقد أضيق، خطة السداد أوسع
        splitter.setStretchFactor(0, 44)
        splitter.setStretchFactor(1, 56)

        col_l.addWidget(splitter, 1)  # stretch=1 → الـ splitter ياخد المساحة المتبقية

        self.ctype.currentIndexChanged.connect(
            lambda _i: self._refresh_manual_stages())
        self.amount.valueChanged.connect(
            lambda _v: self._update_stages_remaining())
        from PySide6.QtCore import QTimer as _QT4
        _QT4.singleShot(0, self._refresh_manual_stages)

        # ── Scroll Area ───────────────────────────────────────────
        scroll = _QSA()
        self._scroll = scroll
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setObjectName("transparentHost")
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        column.setObjectName("transparentHost")
        scroll.setWidget(column)

        # تعبئة بيانات الإشراف عند التعديل
        if contract and ((getattr(contract, "sup_start_date", "") or "").strip()
                         or int(getattr(contract, "sup_months", 0) or 0) > 0):
            _ss4 = (getattr(contract, "sup_start_date", "") or "").strip()
            if _ss4:
                self.sup_start.setDate(QDate.fromString(
                    contract.sup_start_date, "yyyy-MM-dd"))
            self.sup_months.setValue(int(contract.sup_months or 0))
            self.sup_monthly.setValue(float(contract.sup_monthly or 0))
            self.sup_discount.setValue(float(getattr(contract, "sup_discount", 0) or 0))

        self.body_layout.addWidget(scroll)
        style.dialog_buttons(self, "حفظ", on_save=self._save)

        self._sync_pricing_row()

        if not self._customers:
            style.info(self, "لا يوجد عملاء بعد. الرجاء إضافة عميل أولاً.")

        # اتصالات amount → معاينة الخطة (كانت في الكتلة القديمة المحذوفة)
        _is_sup_contract = bool(
            contract and (getattr(contract, "sup_start_date", "") or "").strip())
        if not _is_sup_contract:
            if contract:
                self.amount.valueChanged.connect(
                    lambda _v: self._refresh_plan_preview()
                    if self._plan_tpl_mode
                    else self._update_plan_total_status())
                self._apply_plan_mode()
            else:
                self.amount.valueChanged.connect(
                    lambda _v: self._refresh_plan_preview())


    def accept(self):  # noqa: N802
        """لا تُغلق نافذة العقد بالخطأ عند الضغط على Enter؛ الحفظ فقط بعد نجاح التحقق."""
        self._save()

    def _plan_amount_changed(self, item):
        """تعديل قيمة دفعة في معاينة إنشاء العقد لهذا العقد فقط.

        V4.5.10: الخانة أرقام فقط؛ وتركها فارغة يعيد النص الإرشادي
        «تُحدد لاحقًا» ويلغي قيمة تلك الدفعة — بلا كتابة يدوية للنص.
        """
        if getattr(self, "_plan_preview_loading", False):
            return
        if item is None or item.column() != 4:
            return
        tbl = getattr(self, "plan_table", None)
        if tbl is None:
            return
        no_item = tbl.item(item.row(), 1)
        try:
            pay_no = int((no_item.text() if no_item else "0").strip())
        except Exception:
            pay_no = 0
        raw = _normalize_amount_text(item.text())
        if _PLAN_AMOUNT_HINT in str(item.text() or ""):
            raw = ""
        amount = None
        if raw:
            try:
                amount = float(raw)
            except Exception:
                amount = None
        tbl.blockSignals(True)
        try:
            if amount is None:
                # فراغ ⇒ إلغاء قيمة هذه الدفعة (يرجع مبلغ القالب إن وُجد،
                # وإلا تبقى «تُحدد لاحقًا»). نص غير رقمي ⇒ لا يُمسّ التجاوز.
                _tpl_txt = str((getattr(self, "_plan_row_tpl", {}) or {})
                               .get(pay_no, "") or "")
                if raw:
                    _keep = self._plan_amount_overrides.get(pay_no)
                    _txt = (f"{_keep:,.3f}" if _keep is not None else _tpl_txt)
                else:
                    if pay_no:
                        self._plan_amount_overrides.pop(pay_no, None)
                    _txt = _tpl_txt
                if _txt:
                    item.setText(_txt)
                    item.setForeground(
                        QColor(getattr(style, "TEXT", "") or "#1F2937"))
                else:
                    item.setText(_PLAN_AMOUNT_HINT)
                    _paint_amount_hint(item)
            else:
                if amount < 0:
                    amount = 0.0
                self._plan_amount_overrides[pay_no] = round(amount, 3)
                item.setText(f"{amount:,.3f}")
                item.setForeground(
                    QColor(getattr(style, "TEXT", "") or "#1F2937"))
        finally:
            tbl.blockSignals(False)
        self.plan_hint.setText(
            "تم تعديل قيمة دفعة لهذا العقد فقط. يجب أن يساوي مجموع الدفعات قيمة العقد قبل الحفظ.")
        self._update_plan_total_status()

    def _refresh_plan_existing(self):
        """وضع التعديل: تحميل دفعات العقد الفعلية في نفس الجدول.

        عمود القيمة قابل للتحرير ويُحفظ عبر نفس آلية التجاوز
        (_plan_amount_overrides) — بلا مساس بقالب النوع.
        """
        from PySide6.QtWidgets import QTableWidgetItem as _QTI
        from services import lifecycle_service as _lc
        tbl = getattr(self, "plan_table", None)
        if tbl is None or not self.contract:
            return
        try:
            items = _lc.contract_payment_plan(self.contract.id)
        except Exception:
            items = []
        self._plan_amount_overrides = {}
        self._plan_row_tpl = {}
        self._plan_preview_loading = True
        tbl.setRowCount(len(items))
        for r, it in enumerate(items):
            no = int(it.get("sort_order") or it.get("pay_no") or (r + 1))
            self._plan_row_tpl[no] = f"{float(it.get('amount') or 0):,.3f}"
            # عمود 0: ✔ (checkbox)
            chk = _QTI()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Unchecked)
            chk.setTextAlignment(Qt.AlignCenter)
            tbl.setItem(r, 0, chk)
            cells = (str(no), it.get("title") or f"دفعة {no}",
                     "مجدولة", f"{float(it.get('amount') or 0):,.3f}",
                     it.get("due_date") or "")
            for c, txt in enumerate(cells):
                cell = _QTI(str(txt))
                cell.setTextAlignment(Qt.AlignCenter)
                flags = cell.flags()
                if c in (1, 4):
                    cell.setTextAlignment(Qt.AlignLeft | Qt.AlignVCenter)
                if c == 3:
                    cell.setFlags(flags | Qt.ItemIsEditable)
                    cell.setToolTip("تعديل")
                else:
                    cell.setFlags(flags & ~Qt.ItemIsEditable)
                tbl.setItem(r, c + 1, cell)
        self._plan_preview_loading = False
        self.plan_auto_lbl.setText(
            f"{len(items)} دفعة" if items else "بلا دفعات مجدولة")
        self.plan_hint.setText(
            "عدّل قيمة أي دفعة داخل الجدول — يجب أن يساوي المجموع قيمة العقد."
            if items else
            "لا دفعات مجدولة بعد — أضفها بزر «+ إضافة دفعة».")
        self._update_plan_total_status()
        self._update_plan_summary()
        self._refit()
        # عمود التشيك بوكس مخفي دائماً في التعديل
        tbl.setColumnHidden(0, True)

    def _plan_add_item(self):
        """إضافة دفعة مجدولة للعقد الحالي (وضع التعديل فقط)."""
        if not self.contract:
            return
        from PySide6.QtWidgets import (QDialog as _QD, QFormLayout as _QF,
                                       QLineEdit as _QLE,
                                       QPushButton as _QPB, QHBoxLayout as _QH)
        from ui.widgets import SafeDateEdit, SafeDoubleSpinBox
        dlg = _QD(self)
        dlg.setWindowTitle("دفعة مجدولة جديدة")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = _QF(dlg)
        title = _QLE()
        title.setPlaceholderText("مثال: دفعة التوقيع / دفعة الهيكل")
        due = SafeDateEdit()
        amount = SafeDoubleSpinBox()
        amount.setRange(0, 1e9)
        amount.setDecimals(3)
        amount.setGroupSeparatorShown(True)
        form.addRow("اسم الدفعة *", title)
        form.addRow("تاريخ الاستحقاق *", due)
        form.addRow("القيمة *", amount)
        btns = _QH()
        ok = _QPB("حفظ")
        ok.setObjectName("btnPrimary")
        cancel = _QPB("إلغاء")
        cancel.setProperty("flat", True)
        ok.clicked.connect(dlg.accept)
        cancel.clicked.connect(dlg.reject)
        btns.addStretch()
        btns.addWidget(ok)
        btns.addWidget(cancel)
        form.addRow(btns)
        if dlg.exec() != _QD.Accepted:
            return
        if not title.text().strip() or amount.value() <= 0:
            style.error(self, "اكتب اسم الدفعة وقيمة أكبر من صفر.")
            return
        try:
            from services import lifecycle_service as _lc
            _lc.add_plan_item(self.contract.id, title.text().strip(),
                              due.date().toString("yyyy-MM-dd"),
                              float(amount.value()))
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._refresh_plan_existing()

    def _plan_delete_item(self):
        """حذف — الوضع اليدوي (بلا قالب) فقط.

        V3.11: أنواع القوالب بلا حذف صف؛ الزوائد تُنظَّف بالمزامنة عند الحفظ.
        """
        if not self.contract:
            return
        tbl = getattr(self, "plan_table", None)
        if tbl is None or tbl.currentRow() < 0:
            style.info(self, "حدد دفعة من الجدول أولًا.")
            return
        try:
            from services import lifecycle_service as _lc
            items = _lc.contract_payment_plan(self.contract.id)
            target = items[tbl.currentRow()]
        except Exception:
            style.error(self, "تعذر تحديد الدفعة.")
            return
        name = target.get("title") or f"دفعة {tbl.currentRow() + 1}"
        if not style.confirm(self, f"حذف «{name}» من خطة السداد؟",
                             "حذف دفعة"):
            return
        try:
            _lc.delete_plan_item(int(target["id"]))
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        self._refresh_plan_existing()

    def _auto_plan_ui(self) -> bool:
        """V4.5.13: نوع «تلقائي» (له قالب مراحل وليس مسارًا يدويًا).

        قرار صاحب النظام: هذا النوع **لا يُظهر** واجهة سحب البنود والدفعات
        (شجرة النطاق وجدول القالب) — العقد يحمل القالب كاملًا تلقائيًا.
        النوع اليدوي يبقى كما هو (اختيار كامل/جزء).
        """
        try:
            from services import contract_type_service as _cts13
            from services import workflow_service as _wf13
            from services.contract_type_service import UNSPECIFIED as _UNS13
            _name13 = (self.ctype.currentData() or "").strip()
            if not _name13 or _name13 == _UNS13:
                return False   # «غير محدد» ليست نظامًا مُعدًا
            _cfg13 = _cts13.type_config(_name13)
            if _cfg13.get("manual_track") or _cfg13.get("is_bundle"):
                return False   # اليدوي والشامل يبقيان كما هما (قرار 2026-10-05)
            return bool(_wf13.get_stages(_wf13.TX_CONTRACT, _name13))
        except Exception:
            return False

    def _apply_scope_controls(self):
        """V9.15.8: أزرار النطاق وعمود التحديد تُحسب من الحالة الحالية.

        تُستدعى بعد `_load_scope_tree` لأن `_apply_mode` يُشغَّل قبله فيقرأ
        قيمة `_scope_applicable` من الاختيار السابق (فتختفي الأزرار في أول
        اختيار للعقد اليدوي). القاعدة: الأزرار للعقد اليدوي فقط.
        """
        _show_scope = bool(getattr(self, "_scope_applicable", False))
        _is_bundle = bool(getattr(self, "_mode", "") == "bundle")
        _manual_vis = _show_scope and not _is_bundle
        for _btn_name in ("scope_all", "scope_none", "scope_apply"):
            _btn = getattr(self, _btn_name, None)
            if _btn is not None:
                _btn.setVisible(_manual_vis)
        _ret = getattr(self, "plan_return_btn", None)
        if _ret is not None:
            _ret.setVisible(_manual_vis)
        if getattr(self, "plan_table", None) is not None:
            self.plan_table.setColumnHidden(0, not _manual_vis)

    def _apply_plan_mode(self):
        """V3.11: القالب هو الوضع الوحيد لأنواع القوالب في التعديل.

        النوع ذو الشجرة ← كامل القالب بلا أزرار يدوية (تعديل مبلغ الخلية
        فقط لهذا العقد، والمزامنة عند الحفظ) · بلا شجرة ← اليدوي الحالي.
        """
        if not self.contract or getattr(self, "plan_table", None) is None:
            return
        # V4.5.14 (قرار 2026-10-06): النوع التلقائي يعرض جدول القالب كاملًا
        # أسفل شاشة العقد، مع إمكانية تعديل المبالغ لهذا العقد فقط —
        # بلا شريحة نطاق وبلا بنود (يُحمَّل القالب تلقائيًا عند الحفظ).
        _auto14 = self._auto_plan_ui()
        ctype = (self.ctype.currentData() or "").strip()
        try:
            from services import workflow_service as _wf
            from services.contract_type_service import UNSPECIFIED
            # شجرة «غير محدد» الافتراضية ليست نظامًا مُعدًا — اليدوي لها.
            from services import feature_service as _feat_tpl
            has_tpl = bool(ctype and ctype != UNSPECIFIED
                           and _feat_tpl.enabled("template_plan_mode")
                           and _wf.get_stages(_wf.TX_CONTRACT, ctype))
        except Exception:
            has_tpl = False
        if _auto14:
            # النوع التلقائي = وضع القالب دائمًا (مهما كانت حالة المفتاح)
            has_tpl = True
        self._plan_tpl_mode = bool(has_tpl)
        add_btn = getattr(self, "plan_add_btn", None)
        del_btn = getattr(self, "plan_del_btn", None)
        if add_btn is not None:
            add_btn.setVisible(not self._plan_tpl_mode)
        if del_btn is not None:
            del_btn.setVisible(not self._plan_tpl_mode)
            del_btn.setToolTip("حذف")
        if self._plan_tpl_mode:
            self.plan_title.setText("📆 دفعات القالب (لهذا العقد فقط)")
            self._refresh_plan_preview()
        else:
            self.plan_title.setText("📆 دفعات السداد الحالية (قابلة للتحرير)")
            self._refresh_plan_existing()

    def _refresh_plan_preview(self):
        """معاينة قالب المراحل والدفعات للنوع المختار — تلقائية كاملة.

        المصدر هنا هو قالب الدفعات الصريح `type_payment_tpl`، وليس أعمدة
        النسبة القديمة داخل المراحل؛ حتى يرى المستخدم نفس ما أعدّه في
        شاشة «مراحل ودفعات نوع العقد» قبل الحفظ.
        """
        if self.contract and not getattr(self, "_plan_tpl_mode", False):
            return  # وضع التعديل اليدوي يعرض الخطة الفعلية لا القالب
        from PySide6.QtWidgets import QTableWidgetItem as _QTI
        from services import workflow_service as _wf
        ctype = self.ctype.currentData() or ""
        tbl = getattr(self, "plan_table", None)
        if tbl is None:
            return
        if not ctype:
            tbl.setRowCount(0)
            self.plan_auto_lbl.setText("")
            self.plan_hint.setText(
                "اختر نوع العقد — إن كانت له شجرة مراحل ودفعات ستظهر هنا، وإلا ستظهر بنود العقد تلقائيًا.")
            self._update_plan_total_status()
            return
        # العقد اليدوي مع النطاق: الجدول يُدار يدوياً فقط (⬇ نزّل + ↩ إرجاع)
        # لا نمسحه ولا نعبئه تلقائي — المستخدم هو اللي يتحكم
        # لكن العقد الشامل (bundle) يكمل عادي — يتعبأ تلقائي من القالب
        _is_bundle = bool(getattr(self, "_mode", "") == "bundle")
        if (getattr(self, "_scope_applicable", False)
                and not self.contract
                and not _is_bundle):
            if not getattr(self, "_plan_scope_ids", None):
                tbl.setRowCount(0)
                self.plan_auto_lbl.setText("")
                self.plan_hint.setText(
                    "اختر البنود من جدول النطاق ← ثم اضغط «⬇ نزّل الدفعات» لتعبئة الخطة.")
            self._update_plan_total_status()
            return
        stages = _wf.get_stages(_wf.TX_CONTRACT, ctype)
        if not stages:
            tbl.setRowCount(0)
            self.plan_auto_lbl.setText("لا توجد شجرة مراحل")
            self.plan_hint.setText(
                f"نوع «{ctype}» لا يملك قالب مراحل/دفعات بعد.")
            self._update_plan_total_status()
            return
        preview = _wf.type_payment_preview(ctype, self.amount.value())
        steps = preview["steps"]
        payments = preview["payments"]
        # ===== V5.3 (قرار 2026-10-06): شاشة التعديل تعرض دفعات العقد
        # الفعلية المشمولة فقط — بمبالغها المحفوظة رقمًا واضحًا — بدل
        # عرض كامل القالب بنصوص «تُحدد لاحقًا (الفعلي…)» المقصوصة.
        # تُطبَّق فقط عندما لقالب النوع دفعات — نوع بلا قالب يُبقي رسالة
        # «لا يوجد قالب دفعات» كما هي.
        if (self.contract is not None and getattr(self.contract, "id", None)
                and preview["payments"]):
            if self._fill_plan_from_actual(tbl, preview, ctype):
                return
        _sel50 = getattr(self, "_plan_scope_ids", None)
        _filtered50 = (self.contract is None and isinstance(_sel50, set))
        # V4.5.10: ترشيح النطاق + ترقيم متسلسل 1..n (بلا فجوة عند إلغاء
        # اختيار مرحلة: كانت تظهر 1,2,4,5 — الآن 1,2,3,4).
        _rows_src = _wf.renumber_plan_rows(
            preview["rows"], _sel50 if _filtered50 else None)
        # إعادة ترميز مبالغ المستخدم المحفوظة في الشاشة إلى الترقيم الجديد
        # (نفس الدفعة تبقى محفوظة بعد تغيير المختار).
        _map50 = {int(r["tpl_pay_no"]): int(r["pay_no"]) for r in _rows_src}
        _prev_map50 = getattr(self, "_plan_no_map", None)
        if _prev_map50 and self._plan_amount_overrides:
            _remap50 = {}
            for _tpl_no, _old_no in _prev_map50.items():
                if _tpl_no in _map50 and _old_no in self._plan_amount_overrides:
                    _remap50[_map50[_tpl_no]] = self._plan_amount_overrides[
                        _old_no]
            self._plan_amount_overrides = _remap50
        self._plan_no_map = _map50
        rows = []
        self._plan_row_tpl = {}
        for r in _rows_src:
            pay_no = int(r["pay_no"])
            amount_text = r["amount_text"]
            self._plan_row_tpl[pay_no] = str(amount_text)
            if pay_no in self._plan_amount_overrides:
                amount_text = f"{self._plan_amount_overrides[pay_no]:,.3f}"
            rows.append((pay_no, r["stage_name"], r["mode_text"],
                         amount_text, r["due_text"]))
        if _filtered50:
            total_pct = round(sum(float(r.get("pct") or 0)
                                  for r in _rows_src), 2)
            fixed_sum = round(sum(float(r.get("fixed_basis") or 0)
                                  for r in _rows_src), 3)
            flexible_count = sum(
                1 for r in _rows_src if (r.get("mode") or "") == "flexible")
            steps = sorted({int(r["trigger_stage_id"]) for r in _rows_src
                            if r.get("trigger_stage_id") is not None})
            if not steps and _rows_src:
                steps = sorted(_sel50)
            payments = _rows_src
            _scope_tag = (" · من المختار"
                          if len(_rows_src) != len(preview["rows"]) else "")
        else:
            total_pct = preview["total_pct"]
            fixed_sum = preview["fixed_basis_sum"]
            flexible_count = preview["flexible_count"]
            _scope_tag = ""
        # V3.11: التعديل يعرض كامل القالب دائمًا — بلا فلترة على الفعلي.
        self._plan_preview_loading = True
        tbl.setRowCount(len(rows))
        for r, cells in enumerate(rows):
            # عمود 0: ✔ (checkbox)
            chk = _QTI()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Unchecked)
            chk.setTextAlignment(Qt.AlignCenter)
            tbl.setItem(r, 0, chk)
            for c, txt in enumerate(cells):
                it = _QTI(str(txt))
                it.setTextAlignment(Qt.AlignCenter)
                flags = it.flags()
                if c in (1, 4):
                    it.setTextAlignment(Qt.AlignLeft | Qt.AlignVCenter)
                if c == 3:
                    it.setFlags(flags | Qt.ItemIsEditable)
                    it.setToolTip(
                        "اكتب رقمًا فقط — واتركها فارغة لتبقى «تُحدد لاحقًا»")
                    if _PLAN_AMOUNT_HINT in str(txt):
                        _paint_amount_hint(it)
                else:
                    it.setFlags(flags & ~Qt.ItemIsEditable)
                tbl.setItem(r, c + 1, it)
        self._plan_preview_loading = False
        if not steps:
            self.plan_auto_lbl.setText("")
            if _filtered50:
                self.plan_hint.setText(
                    "لا مراحل مختارة — علّم تصنيفًا من النطاق ثم دوس "
                    "⬇ نزّل الدفعات.")
            else:
                self.plan_hint.setText(
                    "هذا النوع بلا مراحل تنفيذ فعلية بعد — أضفها من: الإعدادات ← مراحل المتابعة.")
        elif not payments:
            self.plan_auto_lbl.setText(f"{len(steps)} مرحلة · بلا دفعات")
            self.plan_hint.setText(
                "لا يوجد قالب دفعات لهذا النوع بعد.")
        else:
            extras = []
            if total_pct > 0:
                extras.append(f"نسب {total_pct:g}%")
            if fixed_sum > 0:
                extras.append("مبالغ يدوية من القالب")
            if flexible_count:
                extras.append(f"{flexible_count} مرنة")
            detail = " · ".join(extras) if extras else "بلا قيمة افتراضية"
            mark = "✓" if (abs(total_pct - 100) < 0.01 and fixed_sum == 0 and flexible_count == 0) else ""
            self.plan_auto_lbl.setText(
                f"{len(steps)} مرحلة · {len(payments)} دفعة من القالب {mark} {detail}{_scope_tag}".strip())
            self.plan_hint.setText(
                "يمكن تعديل دفعات هذا العقد فقط، ويجب أن تساوي قيمة العقد.")
        if self.contract and getattr(self, "_plan_tpl_mode", False):
            if tbl.rowCount():
                _ct = self.ctype.currentData() or ""
                self.plan_hint.setText(
                    f"🗂 تُدار من قالب النوع «{_ct}» — عدّل المبلغ داخل "
                    "الجدول لهذا العقد فقط؛ تُزامَن الخطة عند الحفظ.")
            self._update_plan_summary()
        if self.contract and getattr(self, "_plan_tpl_mode", False):
            # V4.5.02: المرنة بلا قيمة قالب تعرض مبلغها الفعلي بين قوسين —
            # عرض فقط (بلا تجاوز) فلا أثر على المجاميع أو التحقق.
            try:
                from services import lifecycle_service as _lc_fx
                _real = {}
                for _it in _lc_fx.contract_payment_plan(self.contract.id):
                    _no = int(_it.get("sort_order") or 0)
                    if _no > 0 and _no not in self._plan_amount_overrides:
                        _real[_no] = round(float(_it.get("amount") or 0), 3)
                if _real:
                    tbl.blockSignals(True)
                    try:
                        for r in range(tbl.rowCount()):
                            _c0 = tbl.item(r, 1)
                            try:
                                _pn = int((_c0.text() if _c0 else "0").strip())
                            except Exception:
                                continue
                            _cell = tbl.item(r, 4)
                            if (_cell is not None and _pn in _real
                                    and _real[_pn] > 0
                                    and _cell.text().startswith(
                                        _PLAN_AMOUNT_HINT)):
                                _paint_amount_hint(
                                    _cell,
                                    f"الفعلي: {_real[_pn]:,.3f}")
                    finally:
                        tbl.blockSignals(False)
            except Exception:
                pass
        self._update_plan_total_status()
        # عمود التشيك بوكس (col 0): ظاهر فقط للعقد اليدوي
        _show_scope_now = getattr(self, "_scope_applicable", False)
        _is_bundle_now = bool(getattr(self, "_mode", "") == "bundle")
        _is_manual = _show_scope_now and not _is_bundle_now and not self.contract
        tbl.setColumnHidden(0, not _is_manual)

    def _fill_plan_from_actual(self, tbl, preview, ctype) -> bool:
        """V5.3: جدول الدفعات في التعديل = الصفوف الفعلية المحفوظة للعقد.

        تُعرض الدفعات المشمولة (نطاق الإنشاء) بمبالغها الحقيقية رقمًا
        قابلًا للتعديل، ويُذكر أسفل الجدول ما لم يُشمل من خطوات القالب.
        ترجع True إن عُبّئ الجدول، وFalse إن كان العقد بلا صفوف دفعات
        (حينها تبقى المعاينة القديمة حتى يستطيع إدخال المبالغ).
        """
        from PySide6.QtWidgets import QTableWidgetItem as _QTI
        from services import lifecycle_service as _lc5
        try:
            _plan = [dict(x) for x in
                     _lc5.contract_payment_plan(self.contract.id)]
        except Exception:
            return False
        rows = []
        self._plan_row_tpl = {}
        self._plan_no_map = {}
        _included = set()
        for it in _plan:
            _no = int(it.get("sort_order") or 0)
            if _no <= 0:
                continue
            _amt = round(float(it.get("amount") or 0), 3)
            _stage = (it.get("stage_name") or "").strip()
            _title = (it.get("title") or "").strip()
            if _stage:
                _included.add(_stage)
            _mode = "مرنة" if _amt <= 0 else "مبلغ محدَّد"
            _amt_txt = (f"{_amt:,.3f}" if _amt > 0 else _PLAN_AMOUNT_HINT)
            self._plan_row_tpl[_no] = _PLAN_AMOUNT_HINT
            _due = (it.get("due_date") or "").strip()
            if _stage:
                _due_txt = f"عن مرحلة «{_stage}»" + (f" · {_due}" if _due else "")
            else:
                _due_txt = _due or _title
            rows.append((_no, _stage or _title or "—", _mode, _amt_txt,
                         _due_txt))
        if not rows:
            return False
        rows.sort(key=lambda t: t[0])
        # خطوات القالب غير المشمولة في العقد (بلا صف فعلي)
        _excluded = []
        try:
            for _r in preview.get("rows") or []:
                _sn = (_r.get("stage_name") or "").strip()
                if _sn and _sn not in _included and _sn not in _excluded:
                    _excluded.append(_sn)
        except Exception:
            _excluded = []
        self._plan_preview_loading = True
        tbl.setRowCount(len(rows))
        for r, cells in enumerate(rows):
            for c, txt in enumerate(cells):
                it = _QTI(str(txt))
                it.setTextAlignment(Qt.AlignCenter)
                flags = it.flags()
                if c in (2, 5):
                    it.setTextAlignment(Qt.AlignLeft | Qt.AlignVCenter)
                if c == 4:
                    it.setFlags(flags | Qt.ItemIsEditable)
                    it.setToolTip("اكتب رقمًا فقط — المبلغ يخص هذا العقد وحده")
                    if _PLAN_AMOUNT_HINT in str(txt):
                        _paint_amount_hint(it)
                else:
                    it.setFlags(flags & ~Qt.ItemIsEditable)
                tbl.setItem(r, c, it)
        self._plan_preview_loading = False
        _n_amt = sum(1 for _r in rows if _r[3] != _PLAN_AMOUNT_HINT)
        _n_flex = len(rows) - _n_amt
        _bits = [f"{len(rows)} دفعة مشمولة في هذا العقد"]
        if _n_amt:
            _bits.append(f"{_n_amt} بمبلغ محدَّد")
        if _n_flex:
            _bits.append(f"{_n_flex} مرنة")
        self.plan_auto_lbl.setText(" · ".join(_bits))
        _hint = (f"🗂 تُدار من قالب النوع «{ctype}» — عدّل المبلغ داخل "
                 "الجدول لهذا العقد فقط؛ تُزامَن الخطة عند الحفظ.")
        if _excluded:
            _hint += "\nغير مشمول في هذا العقد: " + " · ".join(_excluded)
        self.plan_hint.setText(_hint)
        try:
            self._update_plan_summary()
        except Exception:
            pass
        self._update_plan_total_status()
        # عمود التشيك بوكس مخفي دائماً في التعديل (existing contract)
        tbl.setColumnHidden(0, True)
        return True

    def _plan_amount_total(self) -> float:
        """مجموع قيم الدفعات الظاهرة في معاينة إنشاء العقد."""
        tbl = getattr(self, "plan_table", None)
        if tbl is None:
            return 0.0
        total = 0.0
        for r in range(tbl.rowCount()):
            cell = tbl.item(r, 4)
            try:
                total += float(str(cell.text() if cell else "0").replace(",", "").strip() or 0)
            except Exception:
                pass
        return round(total, 3)

    def _plan_has_active_rows(self) -> bool:
        box = getattr(self, "_plan_box", None)
        tbl = getattr(self, "plan_table", None)
        # لا نستخدم isVisible() لأن النافذة قد تكون قيد البناء أو مخفية أثناء
        # الفحص الآلي؛ المهم أن صندوق الخطة غير مخفي منطقيًا وله صفوف.
        return bool(box is not None and tbl is not None and not box.isHidden()
                    and tbl.rowCount() > 0)

    def _refit(self):
        try:
            if self.isVisible():
                style.refit_dialog(self)
        except Exception:
            pass

    def _plan_effective_total(self) -> float:
        """V4.5.02: مجموع الخطة الفعلي (المحفوظ + تجاوزات الشاشة غير المحفوظة)."""
        try:
            from services import lifecycle_service as _lc_et
            _ov = getattr(self, "_plan_amount_overrides", None) or {}
            _sum = 0.0
            _seen = set()
            for _it in _lc_et.contract_payment_plan(self.contract.id):
                _no = int(_it.get("sort_order") or 0)
                _seen.add(_no)
                _sum += float(_ov.get(_no, _it.get("amount") or 0))
            for _no, _amt in _ov.items():
                if _no not in _seen:
                    _sum += float(_amt or 0)
            return round(_sum, 3)
        except Exception:
            return self._plan_amount_total()

    def _update_plan_total_status(self):
        """يعرض الربط المحاسبي بين قيمة العقد ومجموع الدفعات."""
        lbl = getattr(self, "plan_total_lbl", None)
        if lbl is None:
            return
        if not self._plan_has_active_rows():
            lbl.setText("مجموع الدفعات: 0.000 د.ك")
            lbl.setStyleSheet(
                "background: transparent; border: none; font-weight: 800;")
            return
        total = self._plan_amount_total()
        if getattr(self, "contract", None) is not None and getattr(
                self, "_plan_tpl_mode", False):
            # V4.5.02: وضع القالب يعرض نص القالب — المجموع من الفعلي.
            total = self._plan_effective_total()
        amount = round(float(self.amount.value() or 0), 3)
        diff = round(total - amount, 3)
        theme = style.theme()
        if abs(diff) <= 0.001:
            lbl.setText(
                f"✓ مجموع الدفعات يساوي قيمة العقد: {total:,.3f} د.ك")
            lbl.setStyleSheet(
                "background: transparent; border: none; font-weight: 800;"
                f" color: {theme['SUCCESS_700']};")
        else:
            lbl.setText(
                f"⚠ مجموع الدفعات: {total:,.3f} د.ك · قيمة العقد: {amount:,.3f} د.ك · الفرق: {diff:+,.3f} د.ك")
            lbl.setStyleSheet(
                "background: transparent; border: none; font-weight: 800;"
                f" color: {theme['WARNING_700']};")

    def _items_total(self) -> float:
        return round(sum(a for _, a, *_ in self._items_rows()), 3)

    def _items_active(self) -> bool:
        box = getattr(self, "_items_box", None)
        return bool(box is not None and not box.isHidden()
                    and self._items_rows())

    def _resolve_amount_mismatch(self) -> bool:
        """V3.2 (أ): تنبيه ثنائي الاتجاه مبلغ <-> دفعات/بنود — سماح مع خيارات."""
        from PySide6.QtWidgets import QMessageBox
        amount = round(float(self.amount.value() or 0), 3)
        # V5.3: في تعديل عقد بقالب يُقارَن المجموع الفعلي (نفس ما يعرضه
        # سطر الحالة) بدل مجموع نصوص القالب — وإلا ظهر الفحص متناقضًا.
        if (getattr(self, "contract", None) is not None
                and getattr(self, "_plan_tpl_mode", False)):
            plan_total = (self._plan_effective_total()
                          if self._plan_has_active_rows() else None)
        else:
            plan_total = (self._plan_amount_total()
                          if self._plan_has_active_rows() else None)
        # V3.30: بنود الشامل نطاق لا توازن — تُستثنى من المطابقة.
        _bundle_mm = getattr(self, "_mode", "") == "bundle"
        items_total = (self._items_total()
                       if self._items_active() and not _bundle_mm else None)
        problems = []
        if plan_total is not None and abs(plan_total - amount) > 0.001:
            problems.append(("plan", plan_total))
        if items_total is not None and abs(items_total - amount) > 0.001:
            problems.append(("items", items_total))
        if not problems:
            return True
        try:
            from services import feature_service as _feat_ag
            _guard_on = _feat_ag.enabled("amount_guard")
        except Exception:
            _guard_on = True
        if not _guard_on:
            # الميزة معطلة: منع صارم بلا خيارات (السلوك القديم).
            _lbl = []
            for kind, total in problems:
                _n = "مجموع الدفعات" if kind == "plan" else "مجموع البنود"
                _lbl.append(f"{_n}: {total:,.3f} د.ك "
                            f"(الفرق {total - amount:+,.3f})")
            style.error(self, "قيمة العقد: "
                             f"{amount:,.3f} د.ك\n" + "\n".join(_lbl)
                             + "\n\nعدّل القيم حتى تتساوى قبل الحفظ.")
            return False
        lines = [f"قيمة العقد: {amount:,.3f} د.ك"]
        for kind, total in problems:
            label = "مجموع الدفعات" if kind == "plan" else "مجموع البنود"
            lines.append(f"{label}: {total:,.3f} د.ك "
                         f"(الفرق {total - amount:+,.3f})")
        box = QMessageBox(self)
        box.setWindowTitle("تنبيه: فرق بين المبلغ والمجموع")
        box.setText("يوجد فرق — ماذا تريد أن تفعل؟\n\n" + "\n".join(lines))
        box.setIcon(QMessageBox.Warning)
        try:
            t = style.theme()
            box.setStyleSheet(
                f"QMessageBox {{ background: {t['BG']}; color: {t['TEXT']}; }}"
                f" QLabel {{ color: {t['TEXT']}; font-size: 12px; }}"
                f" QPushButton {{ min-height: 28px; padding: 4px 12px;"
                f" border-radius: 6px; font-size: 11px; }}"
            )
        except Exception:
            pass
        try:
            can_amount = not bool(self.amount.isReadOnly())
        except Exception:
            can_amount = True
        target = problems[0][1]
        b_amount = None
        if can_amount:
            b_amount = box.addButton(
                f"تحديث مبلغ العقد إلى {target:,.3f}",
                QMessageBox.AcceptRole)
        b_scale = None
        if any(k == "plan" for k, _ in problems):
            b_scale = box.addButton(
                f"توزيع الدفعات على المبلغ {amount:,.3f}",
                QMessageBox.AcceptRole)
        b_keep = box.addButton("حفظ بالفرق (يُسجل في التقرير)",
                               QMessageBox.AcceptRole)
        box.addButton("إلغاء", QMessageBox.RejectRole)
        box.setDefaultButton(b_keep)
        box.exec()
        clicked = box.clickedButton()
        if b_amount is not None and clicked is b_amount:
            self.amount.setValue(target)
            self._update_plan_total_status()
            self._update_items_total()
            return True
        if b_scale is not None and clicked is b_scale:
            self._rescale_plan_to(amount)
            return True
        if clicked is b_keep:
            return True
        return False

    def _rescale_plan_to(self, amount: float) -> None:
        """توزيع نسبي للدفعات الظاهرة على المبلغ (عبر التجاوزات + تحديث العرض)."""
        tbl = getattr(self, "plan_table", None)
        if tbl is None or tbl.rowCount() == 0:
            return
        total = self._plan_amount_total()
        if total <= 0:
            return
        self._plan_preview_loading = True
        tbl.blockSignals(True)
        try:
            acc = 0.0
            for r in range(tbl.rowCount()):
                no_item = tbl.item(r, 1)
                try:
                    pay_no = int((no_item.text() if no_item else "0").strip())
                except Exception:
                    continue
                cell = tbl.item(r, 4)
                try:
                    old = float(str(cell.text() if cell else "0").replace(
                        ",", "").strip() or 0)
                except Exception:
                    old = 0.0
                if r < tbl.rowCount() - 1:
                    new = round(old / total * amount, 3)
                    acc = round(acc + new, 3)
                else:
                    new = round(amount - acc, 3)
                self._plan_amount_overrides[pay_no] = new
                if cell is not None:
                    cell.setText(f"{new:,.3f}")
            try:
                self.plan_hint.setText(
                    "تم توزيع الدفعات نسبيًا على قيمة العقد.")
            except Exception:
                pass
        finally:
            tbl.blockSignals(False)
            self._plan_preview_loading = False
        self._update_plan_total_status()

    def _sup_changed(self):
        """تغيّر بيانات الإشراف: القيمة = عدد الأشهر × قيمة الشهر."""
        # V4.0: المعاينة أيضًا لمسار القالب الإشرافي (بلا مساس بقيمة العقد).
        _tpl_only = (bool(getattr(self, "_tpl_has_sup", False))
                     and not getattr(self, "_is_sup", False))
        if not getattr(self, "_is_sup", False) and not _tpl_only:
            return
        # حراسة: أي عنصر إشراف ناقص (ملف غير مكتمل) ⇒ خصم صفر بلا عطل.
        qty_w = getattr(self, "qty", None)
        price_w = getattr(self, "unit_price", None)
        if qty_w is None or price_w is None:
            return
        mixed_supervision = getattr(self, "_mode", "") == "items"
        sup_months_w = getattr(self, "sup_months", None)
        sup_monthly_w = getattr(self, "sup_monthly", None)
        if mixed_supervision and (sup_months_w is None or sup_monthly_w is None):
            return
        try:
            _from_sup = mixed_supervision or _tpl_only
            months = sup_months_w.value() if _from_sup else qty_w.value()
            monthly = sup_monthly_w.value() if _from_sup else price_w.value()
        except Exception:
            return
        gross = months * monthly
        try:
            sup_discount_w = getattr(self, "sup_discount", None)
            discount = (min(sup_discount_w.value(), gross)
                        if sup_discount_w is not None else 0.0)
        except Exception:
            discount = 0.0
        net = max(0.0, gross - discount)
        if not mixed_supervision and not _tpl_only:
            try:
                self.amount.blockSignals(True)
                self.amount.setValue(net)
                self.amount.blockSignals(False)
            except Exception:
                pass
        lbl = getattr(self, "sup_value_lbl", None)
        if lbl is not None:
            try:
                lbl.setText(
                    f"قيمة الإشراف: {months} شهر × {monthly:,.3f} = {gross:,.3f}"
                    + (f" · خصم {discount:,.3f} · الصافي {net:,.3f}" if discount else "")
                    + (" · قيمة العقد الإجمالية تُكتب بالأعلى وتشمل باقي الخدمات" if mixed_supervision else "")
                    + (" · تُستخدم عند إنهاء مراحل الإشراف" if _tpl_only else ""))
            except Exception:
                pass
        try:
            self._update_plan_summary()
        except Exception:
            pass

    def _set_amount_readonly(self, readonly: bool):
        """قيمة العقد للقراءة فقط في عقد الإشراف · بخلفية وتلميح واضحين."""
        theme = style.theme()
        self.amount.setReadOnly(readonly)
        self.amount.setButtonSymbols(
            QDoubleSpinBox.NoButtons if readonly
            else QDoubleSpinBox.UpDownArrows)
        if readonly:
            self.amount.setStyleSheet(
                f"background: {theme['SURFACE_2']}; color: {theme['TEXT_600']};")
            self.amount.setToolTip(
                "تُحسب تلقائيًا: عدد الأشهر × قيمة الشهر")
        else:
            self.amount.setStyleSheet("")
            self.amount.setToolTip("")

    def _go_plan_tab(self):
        """سطر ملخص خطة السداد: يمرّر النظر إلى صندوق الخطة."""
        box = getattr(self, "_plan_box", None)
        if box is None:
            style.info(self, "خطة السداد تُضاف عند إنشاء العقد · "
                             "ومن مركز العقد بعد ذلك.")
            return
        if not box.isVisible():
            return
        try:
            sc = getattr(self, "_scroll", None)
            if sc is not None:
                sc.ensureWidgetVisible(box)
        except Exception:
            pass
        box.setFocus()

    def focus_plan(self):
        """فتح مباشر على قسم الدفعات (من قائمة إجراءات العقد)."""
        self._go_plan_tab()

    def focus_amount(self):
        """فتح مباشر على قيمة العقد (من قائمة إجراءات العقد)."""
        try:
            sc = getattr(self, "_scroll", None)
            if sc is not None:
                sc.ensureWidgetVisible(self.amount)
        except Exception:
            pass
        self.amount.setFocus()
        try:
            self.amount.selectAll()
        except Exception:
            pass

    def _update_plan_summary(self):
        """تحديث ملخص خطة السداد."""
        pass  # v9.7: تم حذف plan_summary_link — الملخص داخل splitter

    # ==================== النوع يشكّل النموذج ====================
    def _sync_pricing_row(self):
        """يضبط شكل النموذج عند الفتح (جديد أو تعديل)."""
        con = self.contract
        if con is not None:
            mode = contract_service.contract_mode(con)
            is_sup = contract_service.is_supervision_contract(con)
            unit = ""
            try:
                from services import contract_type_service as _cts
                cfg = _cts.type_config(
                    getattr(con, "contract_type", "") or "")
                unit = cfg["unit_label"]
                if is_sup and not unit:
                    unit = "شهر"
            except Exception:
                unit = "شهر" if is_sup else ""
            try:
                from services import workflow_service as _wf
                self._has_stage_template = bool(_wf.get_stages(
                    _wf.TX_CONTRACT, getattr(con, "contract_type", "") or ""))
                # V4.0: القالب فيه مراحل إشرافية ← حقول المدة والقيمة.
                self._tpl_has_sup = bool(_wf.template_has_supervision(
                    getattr(con, "contract_type", "") or ""))
            except Exception:
                self._has_stage_template = False
                self._tpl_has_sup = False
            saved_price = float(getattr(con, "unit_price", 0) or 0)
            if is_sup and saved_price <= 0:
                saved_price = float(getattr(con, "sup_monthly", 0) or 0)
            saved_qty = int(float(getattr(con, "qty", 1) or 1))
            if is_sup and int(getattr(con, "sup_months", 0) or 0) > 0:
                saved_qty = int(getattr(con, "sup_months"))
            # V3.11: القالب أولًا لحظة الفتح (كلمس النوع) — فلا يظهر قسم
            # البنود لنوع له قالب ولا ينقلب الوضع عند لمس النوع.
            from services import contract_type_service as _cts11
            _tname = (getattr(con, "contract_type", "") or "").strip()
            if (_tname and self._has_stage_template
                    and mode == _cts11.MODE_ITEMS):
                mode = _cts11.MODE_LUMP
            self._apply_mode(mode, unit, saved_price, is_sup, keep=True)
            self.qty.blockSignals(True)
            self.qty.setValue(max(saved_qty, 1))
            self.qty.blockSignals(False)
            self.unit_price.blockSignals(True)
            self.unit_price.setValue(saved_price)
            self.unit_price.blockSignals(False)
            self._update_gross()
            self._update_discount()
            self._load_items()
            # V3.30: لقطة المكوّنات للعرض عند تعديل عقد شامل
            if mode == _cts11.MODE_BUNDLE:
                self._load_bundle_cards(_tname)
                self._refresh_bundle_items()
        else:
            self._type_changed(self.ctype.currentIndex())

    def _add_manual_stage_row(self, name: str = "", amount: float = 0.0,
                                days: int = 0):
        """V4.44: صف مرحلة رئيسية يدوية."""
        from ui.widgets import SafeSpinBox as _SSpin
        box = QWidget()
        lay = QHBoxLayout(box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)
        nm = QLineEdit()
        nm.setPlaceholderText("اسم المرحلة")
        nm.setText(name or "")
        nm.setMinimumWidth(180)
        nm.textChanged.connect(lambda _t: self._update_stages_remaining())
        amt = SafeDoubleSpinBox()
        amt.setDecimals(3)
        amt.setRange(0, 999_999_999)
        amt.setGroupSeparatorShown(True)
        amt.setValue(float(amount or 0))
        amt.setToolTip("مبلغ دفعة المرحلة")
        amt.valueChanged.connect(lambda _v: self._update_stages_remaining())
        dys = _SSpin()
        dys.setRange(0, 3650)
        dys.setValue(int(days or 0))
        dys.setToolTip("الأيام من توقيع العقد لاستحقاق الدفعة")
        dys.setFixedWidth(80)
        rm = QPushButton("✕")
        rm.setProperty("flat", True)
        rm.setFixedWidth(32)
        lay.addWidget(nm, 1)
        lay.addWidget(QLabel("المبلغ:"))
        lay.addWidget(amt)
        lay.addWidget(QLabel("الأيام:"))
        lay.addWidget(dys)
        lay.addWidget(rm)
        row = {"box": box, "name": nm, "amount": amt, "days": dys}
        rm.clicked.connect(lambda: self._drop_manual_stage_row(row))
        self._stage_rows.append(row)
        self.stages_rows.addWidget(box)
        self._update_stages_remaining()

    def _drop_manual_stage_row(self, row: dict):
        if row in self._stage_rows:
            self._stage_rows.remove(row)
        row["box"].setParent(None)
        row["box"].deleteLater()
        self._update_stages_remaining()

    def _refresh_manual_stages(self):
        """V4.44: إظهار محرر المراحل للشامل بلا قالب دفعات."""
        box = getattr(self, "_stages_box", None)
        if box is None:
            return
        is_bundle = getattr(self, "_mode", "") == "bundle"
        box.setVisible(is_bundle)
        box.setMaximumHeight(16777215 if is_bundle else 0)  # QWIDGETMAX when visible
        if not is_bundle:
            return
        has_tpl = False
        try:
            from database.database import get_connection as _g44
            with _g44() as _conn:
                has_tpl = bool(_conn.execute(
                    "SELECT 1 FROM type_payment_tpl WHERE contract_type=?"
                    " LIMIT 1",
                    (self.ctype.currentData() or "",)).fetchone())
        except Exception:
            has_tpl = False
        self._stages_has_tpl = has_tpl
        if has_tpl:
            self.stages_hint.setText(
                "نوع العقد له قالب دفعات — المراحل والدفعات من القالب.")
        else:
            self.stages_hint.setText(
                "أضف مرحلة أو اثنتين أو ثلاثًا (أو أكثر) — كل مرحلة تُنشأ "
                "مع دفعتها عند الحفظ.")
        for r in self._stage_rows:
            for w in (r["name"], r["amount"], r["days"]):
                w.setEnabled(not has_tpl)
        self.stages_add.setEnabled(not has_tpl)
        self._update_stages_remaining()

    def _update_stages_remaining(self):
        """V4.44: المتبقي الحي لقيمة العقد بعد القائم والصفوف."""
        lbl = getattr(self, "stages_remaining", None)
        if lbl is None:
            return
        base = round(float(self.amount.value() or 0), 3)
        planned = 0.0
        if getattr(self, "contract", None) is not None \
                and getattr(self.contract, "id", None):
            try:
                from services import lifecycle_service as _lc44
                planned = _lc44.manual_stages_remaining(
                    self.contract.id)["planned"]
            except Exception:
                planned = 0.0
        rows_sum = round(sum(float(r["amount"].value() or 0)
                             for r in getattr(self, "_stage_rows", [])), 3)
        rem = round(base - planned - rows_sum, 3)
        lbl.setText(
            f"المتبقي للدفعات: {rem:,.3f} "
            f"(القيمة {base:,.3f} − القائم {planned:,.3f} "
            f"− الصفوف {rows_sum:,.3f})")
        lbl.setStyleSheet(
            "background: transparent; border: none; font-weight: 700; "
            + ("color: #B91C1C;" if rem < -0.001 else "color: #166534;"))

    def _manual_stage_rows(self) -> list[dict]:
        """V4.44: جمع صفوف المراحل (الفارغ يُتجاهل والناقص يُرفض)."""
        if getattr(self, "_stages_has_tpl", False):
            return []
        out = []
        for r in getattr(self, "_stage_rows", []):
            _name = (r["name"].text() or "").strip()
            _amt = round(float(r["amount"].value() or 0), 3)
            _days = int(r["days"].value() or 0)
            if not _name and _amt <= 0:
                continue
            if not _name:
                raise ValidationError("اسم المرحلة مطلوب لكل صف بمبلغ.")
            if _amt <= 0:
                raise ValidationError(
                    f"مبلغ المرحلة «{_name}» يجب أن يكون أكبر من صفر.")
            out.append({"name": _name, "amount": _amt, "days": _days})
        return out

    def _type_changed(self, _idx: int):
        """اختيار النوع يضبط النمط والحقول والقيم الافتراضية."""
        name = self.ctype.currentData() or ""
        self._plan_amount_overrides = {}
        self.contract_name_hint.setText(
            f"اسم العقد المعروض: {name}" if name else "اسم العقد المعروض: —")
        if not name:
            self._has_stage_template = False
            self._tpl_has_sup = False
            self._scope_applicable = False
            self._apply_mode("lump", "", 0.0, False)
            self._apply_scope_controls()
            return
        from services import contract_type_service as cts
        from services import workflow_service as _wf
        cfg = cts.type_config(name)
        self._has_stage_template = bool(_wf.get_stages(_wf.TX_CONTRACT, name))
        # V4.0: القالب فيه مراحل إشرافية ← حقول المدة والقيمة.
        self._tpl_has_sup = bool(_wf.template_has_supervision(name))
        if (self.contract is None and self._tpl_has_sup
                and not cfg["is_supervision"]):
            # عقد جديد بقالب إشرافي — الصفر افتراضيًا (لا تعهد إلا
            # بإدخال صريح) بدل وراثة أي قيمة سابقة.
            self.sup_months.setValue(0)
            self.sup_monthly.setValue(0.0)
            self.sup_discount.setValue(0.0)
        unit = cfg["unit_label"] or ("شهر" if cfg["is_supervision"] else "")
        keep = bool(self.contract and self.amount.value() > 0)
        mode = cfg["mode"]
        # تبسيط ذكي: القالب أولًا. إن وُجدت شجرة لا نُظهر البنود،
        # وإن لم توجد نعرض بنود العقد بدل صندوق القالب.
        if self._has_stage_template and mode == cts.MODE_ITEMS:
            mode = cts.MODE_LUMP
        elif (not self._has_stage_template and not cfg["is_supervision"]
                and mode != cts.MODE_BUNDLE):
            mode = cts.MODE_ITEMS
        self._apply_mode(mode, unit, cfg["unit_price"],
                         cfg["is_supervision"], keep=keep)
        # V3.30: بطاقات المكوّنات — للتعديل فقط (الإنشاء: scope_table يكفي)
        if mode == cts.MODE_BUNDLE and self.contract:
            self._load_bundle_cards(name)
        self._load_scope_tree(name)
        self._apply_scope_controls()
        self._refresh_plan_preview()
        if self.contract:
            self._apply_plan_mode()
        if keep:
            return
        if cfg["mode"] == cts.MODE_UNIT and cfg["unit_price"] > 0:
            self._qty_changed()
        elif cfg["mode"] == cts.MODE_LUMP and cfg["default_amount"]:
            self.amount.setValue(cfg["default_amount"])

    # ==================== V3.30: العقد الشامل ====================
    def _clear_bundle_cards(self):
        for c in getattr(self, "_bundle_cards", []):
            try:
                c["frame"].setParent(None)
                c["frame"].deleteLater()
            except Exception:
                pass
        self._bundle_cards = []

    def _load_bundle_cards(self, type_name: str):
        """بناء بطاقات المكوّنات من النوع + لقطة العقد (للتعديل)."""
        from PySide6.QtWidgets import QCheckBox as _QChk
        from PySide6.QtWidgets import QSpinBox as _QSpin
        from ui.widgets import SafeSpinBox as _SSpin
        self._clear_bundle_cards()
        box = getattr(self, "_bundle_box", None)
        if box is None:
            return
        from services import contract_type_service as cts
        _tname = (type_name or "").strip()
        if not _tname or not cts.type_config(_tname).get("is_bundle"):
            box.setVisible(False)
            box.setMaximumHeight(0)  # لا يأخذ مساحة
            return
        _saved = {}
        if self.contract and getattr(self.contract, "id", None):
            for s in contract_service.get_contract_components(
                    int(self.contract.id)):
                _saved[s["comp_key"]] = s
        _readonly = bool(self.contract)  # التعديل لاحقًا يحتاج إعادة بناء
        for t in cts.list_bundle_components(_tname):
            _key = t["comp_key"]
            _sv = _saved.get(_key, {})
            _kind = (t["kind"] or "qty").strip()
            _req = bool(t["required"])
            frame = QWidget()
            frame.setObjectName("transparentHost")
            row = QHBoxLayout(frame)
            row.setContentsMargins(0, 2, 0, 2)
            row.setSpacing(8)
            chk = _QChk(f"✓ {t['label']}")
            _on = bool(_sv.get("enabled")) if _sv else bool(
                t["default_enabled"])
            if _req:
                _on = True
            chk.setChecked(_on)
            if _req:
                chk.setEnabled(False)
                chk.setToolTip("مكوّن إلزامي")
            if _readonly:
                chk.setEnabled(False)
            row.addWidget(chk)
            qty_w = months_w = monthly_w = None
            if _kind == "qty":
                qty_w = _SSpin()
                qty_w.setRange(1, 9999)
                qty_w.setValue(max(1, int(float(
                    _sv.get("qty", t["default_qty"] or 1)))))
                qty_w.setPrefix("العدد: ")
                qty_w.setEnabled(not _readonly)
                row.addWidget(qty_w)
                _ref = QLabel(
                    f"× {float(t['ref_price'] or 0):,.3f} "
                    f"{(t['unit_label'] or '').strip()} (مرجعي)")
                _ref.setStyleSheet(
                    f"background: transparent; border: none; "
                    f"color: {style.NEUTRAL}; font-size: 10.2px;")
                row.addWidget(_ref)
            elif _kind == "supervision":
                months_w = _SSpin()
                months_w.setRange(1, 120)
                months_w.setValue(max(1, int(
                    _sv.get("months", t["default_months"] or 1))))
                months_w.setPrefix("الأشهر: ")
                months_w.setEnabled(not _readonly)
                row.addWidget(months_w)
                monthly_w = SafeDoubleSpinBox()
                monthly_w.setDecimals(3)
                monthly_w.setRange(0, 999_999_999)
                monthly_w.setValue(float(
                    _sv.get("monthly", t["default_monthly"] or 0)))
                monthly_w.setPrefix("الشهري: ")
                monthly_w.setEnabled(not _readonly)
                row.addWidget(monthly_w)
                _xn = QLabel("(للتمديد — لا تدخل الإجمالي)")
                _xn.setStyleSheet(
                    f"background: transparent; border: none; "
                    f"color: {style.NEUTRAL}; font-size: 10.2px;")
                row.addWidget(_xn)
            else:
                _ih = QLabel("البنود تُدخل في جدول البنود بالأسفل")
                _ih.setStyleSheet(
                    f"background: transparent; border: none; "
                    f"color: {style.NEUTRAL}; font-size: 10.2px;")
                row.addWidget(_ih)
            row.addStretch()
            self.bundle_rows.addWidget(frame)
            self._bundle_cards.append({
                "key": _key, "label": t["label"], "kind": _kind,
                "required": _req, "frame": frame, "chk": chk,
                "qty": qty_w, "months": months_w, "monthly": monthly_w})
            chk.toggled.connect(
                lambda _v=False, _c=self._bundle_cards[-1]:
                self._refresh_bundle_card(_c))
        if _readonly:
            self.bundle_hint.setText(
                "المكوّنات تُحدد عند الإنشاء — لقطة هذا العقد للعرض فقط.")
        else:
            self.bundle_hint.setText(
                "فعّل ما يشمله العقد — المطفأ تُحذف مراحله من المسار.")
        box.setVisible(True)
        box.setMaximumHeight(16777215)  # QWIDGETMAX when visible
        self._refresh_bundle_items()

    def _refresh_bundle_card(self, card: dict):
        for w in (card.get("qty"), card.get("months"),
                  card.get("monthly")):
            if w is not None:
                w.setEnabled(bool(card["chk"].isChecked()))
        self._refresh_bundle_items()

    def _bundle_has_items(self) -> bool:
        return any(c["kind"] == "items" and c["chk"].isChecked()
                   for c in getattr(self, "_bundle_cards", []))

    def _is_bundle_mode(self) -> bool:
        try:
            from services import contract_type_service as cts
            return getattr(self, "_mode", "") == cts.MODE_BUNDLE
        except Exception:
            return getattr(self, "_mode", "") == "bundle"

    def _refresh_bundle_items(self):
        """جدول البنود للشامل يظهر عند تفعيل مكوّن بنود فقط."""
        if not self._is_bundle_mode():
            return
        box = getattr(self, "_items_box", None)
        if box is not None:
            box.setVisible(self._bundle_has_items())

    def _bundle_selection(self) -> list[dict]:
        sel = []
        for c in getattr(self, "_bundle_cards", []):
            _on = bool(c["chk"].isChecked())
            sel.append({
                "comp_key": c["key"], "label": c["label"],
                "kind": c["kind"], "enabled": _on,
                "qty": float(c["qty"].value()) if c.get("qty") else 1.0,
                "months": int(c["months"].value()) if c.get("months") else 0,
                "monthly": float(c["monthly"].value())
                if c.get("monthly") else 0.0})
        return sel

    # ==================== V4.48: نطاق العقد ====================
    def _load_scope_tree(self, type_name: str):
        """بناء جدول النطاق من قالب النوع — إنشاء فقط."""
        if getattr(self, "_scope_box", None) is None:
            self._plan_scope_ids = None
            return
        from services import contract_type_service as _cts
        from services import workflow_service as _wf
        _cfg = _cts.type_config(type_name) if type_name else {}
        _is_bundle = bool(_cfg.get("is_bundle"))
        show = (self.contract is None and bool(type_name)
                and not self._auto_plan_ui())
        if _is_bundle:
            # الشامل: أظهر نطاق العقد بمكوّنات القالب
            _comps = _cts.list_bundle_components(type_name) if show else []
            show = show and bool(_comps)
            self._scope_applicable = bool(show)
            self._scope_box.setVisible(show)
            self._scope_box.setMaximumWidth(16777215 if show else 0)
            if not show:
                self._plan_scope_ids = None
                return
            tbl = self.scope_table
            tbl.blockSignals(True)
            tbl.setRowCount(0)
            for t in _comps:
                r = tbl.rowCount()
                tbl.insertRow(r)
                chk = QTableWidgetItem()
                chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
                chk.setCheckState(Qt.Checked if t.get("default_enabled") or t.get("required") else Qt.Unchecked)
                chk.setData(Qt.UserRole, t["comp_key"])
                tbl.setItem(r, 0, chk)
                tbl.setItem(r, 1, QTableWidgetItem(t.get("label") or ""))
                tbl.setItem(r, 2, QTableWidgetItem(str(int(float(t.get("default_qty") or 1)))))
                tbl.setItem(r, 3, QTableWidgetItem(f"{float(t.get('ref_price') or 0):,.3f}"))
            tbl.blockSignals(False)
            self._plan_scope_ids = None
            return
        # اليدوي: أظهر نطاق العقد بمراحل القالب
        tree_stages = (_wf.get_stages(_wf.TX_CONTRACT, type_name)
                       if show else [])
        show = show and bool(tree_stages)
        self._scope_applicable = bool(show)
        self._scope_box.setVisible(show)
        self._scope_box.setMaximumWidth(16777215 if show else 0)
        if not show:
            self._plan_scope_ids = None
            return
        tbl = self.scope_table
        tbl.blockSignals(True)
        tbl.setRowCount(0)
        mains = [st for st in tree_stages if not st.get("parent_id")]
        kids: dict = {}
        for st in tree_stages:
            if st.get("parent_id"):
                kids.setdefault(st["parent_id"], []).append(st)
        for m in mains:
            r = tbl.rowCount()
            tbl.insertRow(r)
            chk = QTableWidgetItem()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Checked)
            chk.setData(Qt.UserRole, int(m["id"]))
            chk.setData(Qt.UserRole + 1, True)  # is_parent
            tbl.setItem(r, 0, chk)
            name = QTableWidgetItem(m.get("stage_name", ""))
            name.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            tbl.setItem(r, 1, name)
            tbl.setItem(r, 2, QTableWidgetItem(""))
            tbl.setItem(r, 3, QTableWidgetItem(""))
            for k in kids.get(m["id"], []):
                r = tbl.rowCount()
                tbl.insertRow(r)
                chk = QTableWidgetItem()
                chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
                chk.setCheckState(Qt.Checked)
                chk.setData(Qt.UserRole, int(k["id"]))
                chk.setData(Qt.UserRole + 1, False)  # is_child
                chk.setData(Qt.UserRole + 2, int(m["id"]))  # parent_id
                tbl.setItem(r, 0, chk)
                name = QTableWidgetItem("    " + k.get("stage_name", ""))
                name.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                tbl.setItem(r, 1, name)
                tbl.setItem(r, 2, QTableWidgetItem(""))
                tbl.setItem(r, 3, QTableWidgetItem(""))
        tbl.blockSignals(False)
        self._update_scope_count()
        # لا نعبّئ خطة السداد تلقائيًا — المستخدم يضغط ⬇ يدوي

    def _sync_scope_table(self, item):
        """مزامنة الأب/الأبناء عند التعليم في جدول النطاق."""
        if item is None or item.column() != 0:
            return
        tbl = self.scope_table
        tbl.blockSignals(True)
        try:
            row = item.row()
            is_parent = item.data(Qt.UserRole + 1)
            if is_parent:
                parent_id = item.data(Qt.UserRole)
                _want = item.checkState()
                for r in range(tbl.rowCount()):
                    chk = tbl.item(r, 0)
                    if chk and chk.data(Qt.UserRole + 2) == parent_id:
                        chk.setCheckState(_want)
            else:
                parent_id = item.data(Qt.UserRole + 2)
                if parent_id:
                    states = set()
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(Qt.UserRole + 2) == parent_id:
                            states.add(chk.checkState())
                    for r in range(tbl.rowCount()):
                        chk = tbl.item(r, 0)
                        if chk and chk.data(Qt.UserRole) == parent_id and chk.data(Qt.UserRole + 1):
                            if len(states) == 1:
                                chk.setCheckState(states.pop())
                            else:
                                chk.setCheckState(Qt.PartiallyChecked)
                            break
        finally:
            tbl.blockSignals(False)
        self._update_scope_count()

    def _set_scope_all(self, on: bool):
        tbl = self.scope_table
        tbl.blockSignals(True)
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk:
                chk.setCheckState(Qt.Checked if on else Qt.Unchecked)
        tbl.blockSignals(False)
        self._update_scope_count()

    def _plan_return_selected(self):
        """حذف الدفعات المعلّمة ✔ من جدول خطة السداد."""
        tbl = getattr(self, "plan_table", None)
        if tbl is None:
            return
        # جمع الصفوف المعلّمة (من الآخر عشان الحذف ما يكسرش الفهرسة)
        to_delete = []
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk and chk.checkState() == Qt.Checked:
                no_item = tbl.item(r, 1)
                try:
                    pay_no = int(no_item.text().strip()) if no_item else 0
                except ValueError:
                    pay_no = 0
                to_delete.append((r, pay_no))
        if not to_delete:
            style.info(self, "علّم ✔ على الدفعات اللي عاوز تحذفها أولاً.")
            return
        # تأكيد
        if not style.confirm(self, f"حذف {len(to_delete)} دفعة من خطة السداد؟"):
            return
        tbl.blockSignals(True)
        # حذف من الآخر
        for r, pay_no in reversed(to_delete):
            tbl.removeRow(r)
            self._plan_amount_overrides.pop(pay_no, None)
        tbl.blockSignals(False)
        self._update_plan_total_status()
        style.toast(self, f"تم حذف {len(to_delete)} دفعة من الخطة")

    def _update_scope_count(self):
        tbl = getattr(self, "scope_table", None)
        if tbl is None:
            return
        n_main = 0
        n_step = 0
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk is None:
                continue
            if chk.data(Qt.UserRole + 1):
                if chk.checkState() != Qt.Unchecked:
                    n_main += 1
            elif chk.checkState() == Qt.Checked:
                n_step += 1
        if hasattr(self, "scope_count"):
            self.scope_count.setText(f"المختار: {n_main} تصنيف · {n_step} خطوة")

    def _scope_selection(self) -> list[int]:
        """معرفات مراحل القالب المعلّمة (أبناء + رئيسيات بلا أبناء)."""
        out: list[int] = []
        tbl = getattr(self, "scope_table", None)
        if tbl is None:
            return out
        parent_has_children: dict = {}
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk and not chk.data(Qt.UserRole + 1):
                pid = chk.data(Qt.UserRole + 2)
                if pid:
                    parent_has_children.setdefault(pid, True)
        for r in range(tbl.rowCount()):
            chk = tbl.item(r, 0)
            if chk is None:
                continue
            sid = chk.data(Qt.UserRole)
            if chk.data(Qt.UserRole + 1):
                if not parent_has_children.get(sid, False):
                    if chk.checkState() == Qt.Checked:
                        try:
                            out.append(int(sid))
                        except (TypeError, ValueError):
                            pass
            else:
                if chk.checkState() == Qt.Checked:
                    try:
                        out.append(int(sid))
                    except (TypeError, ValueError):
                        pass
        return out

    def _apply_scope_to_plan(self, silent: bool = False):
        """⬇ تنزيل الدفعات من المختار — إضافة تراكمية (بدون مسح الموجود)."""
        if self.contract is not None:
            return
        # العقد الشامل لا يستخدم هذا — له تدفق خاص
        if getattr(self, "_mode", "") == "bundle":
            return
        try:
            self._apply_scope_to_plan_impl(silent)
        except Exception as exc:
            import traceback; traceback.print_exc()
            style.error(self, f"خطأ في تنزيل الدفعات:\n{exc}")

    def _apply_scope_to_plan_impl(self, silent: bool = False):
        from PySide6.QtWidgets import QTableWidgetItem as _QTI
        from services import workflow_service as _wf

        new_ids = set(self._scope_selection())
        if not new_ids:
            if not silent:
                style.info(self, "اختر بنود من جدول النطاق أولاً.")
            return

        # تجميع مع الموجود (تراكمي)
        if getattr(self, "_plan_scope_ids", None) is None:
            self._plan_scope_ids = set()
        self._plan_scope_ids |= new_ids

        ctype = self.ctype.currentData() or ""
        tbl = getattr(self, "plan_table", None)
        if tbl is None or not ctype:
            return

        # جمع أسماء المراحل الموجودة فعلاً في الجدول
        existing_stages = set()
        for r in range(tbl.rowCount()):
            it = tbl.item(r, 2)  # عمود المرحلة
            if it:
                existing_stages.add(it.text().strip())

        # توليد صفوف القالب كاملة ثم ترشيح المختار فقط (فلترة صارمة)
        preview = _wf.type_payment_preview(ctype, self.amount.value())
        _want = self._plan_scope_ids  # مجموع المختار + السابق

        # فلترة صارمة: فقط الصفوف اللي trigger_stage_id بتاعها في المختار
        _filtered = []
        _seq = 0
        for row in preview["rows"]:
            tt = row.get("trigger_stage_id")
            if not tt or int(tt) not in _want:
                continue  # skip rows not tied to a selected stage
            _seq += 1
            item = dict(row)
            item["tpl_pay_no"] = int(item.get("pay_no") or 0)
            item["pay_no"] = _seq
            _filtered.append(item)
        _rows_src = _filtered

        # صفوف جديدة لم تكن في الجدول
        new_rows = []
        for rd in _rows_src:
            sname = str(rd["stage_name"]).strip()
            if sname in existing_stages:
                continue
            pay_no = int(rd["pay_no"])
            amount_text = rd["amount_text"]
            self._plan_row_tpl = getattr(self, "_plan_row_tpl", {})
            self._plan_row_tpl[pay_no] = str(amount_text)
            if pay_no in self._plan_amount_overrides:
                amount_text = f"{self._plan_amount_overrides[pay_no]:,.3f}"
            new_rows.append((pay_no, sname, rd["mode_text"],
                             amount_text, rd["due_text"]))

        if not new_rows:
            if not silent:
                style.toast(self, "البنود المختارة موجودة بالفعل في الخطة.")
            return

        self._plan_preview_loading = True
        tbl.blockSignals(True)
        start = tbl.rowCount()
        tbl.setRowCount(start + len(new_rows))
        for i, cells in enumerate(new_rows):
            r = start + i
            chk = _QTI()
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Unchecked)
            chk.setTextAlignment(Qt.AlignCenter)
            tbl.setItem(r, 0, chk)
            for c, txt in enumerate(cells):
                it = _QTI(str(txt))
                it.setTextAlignment(Qt.AlignCenter)
                flags = it.flags()
                if c in (1, 4):
                    it.setTextAlignment(Qt.AlignLeft | Qt.AlignVCenter)
                if c == 3:
                    it.setFlags(flags | Qt.ItemIsEditable)
                    it.setToolTip(
                        "اكتب رقمًا فقط — واتركها فارغة لتبقى «تُحدد لاحقًا»")
                    if _PLAN_AMOUNT_HINT in str(txt):
                        _paint_amount_hint(it)
                else:
                    it.setFlags(flags & ~Qt.ItemIsEditable)
                tbl.setItem(r, c + 1, it)
        tbl.blockSignals(False)
        self._plan_preview_loading = False
        self._update_plan_total_status()
        if not silent:
            style.toast(self, f"تمت إضافة {len(new_rows)} بند للخطة")

    def _save_bundle_pledge(self, contract_id: int, bundle_sel: list) -> None:
        """V4.1: تعهد الشامل من بطاقة الإشراف وحده (لا صندوق ولا ازدواج).

        إنشاءً: من الاختيار الحالي · تعديلًا: من اللقطة المحفوظة —
        وتفعيل اللقطة لمرة واحدة فقط (عقد بلا مدة) · القائم لا يُمس
        أبدًا (المركز يملك تعديله بعد التفعيل) ولا مسح تلقائي.
        """
        comps = list(bundle_sel) if bundle_sel else []
        if self.contract and not comps:
            try:
                comps = contract_service.get_contract_components(contract_id)
            except Exception:
                comps = []
        _pos = [c for c in comps if c.get("kind") == "supervision"
                and c.get("enabled") and int(c.get("months") or 0) > 0
                and float(c.get("monthly") or 0) > 0]
        if not _pos:
            return
        if self.contract:
            try:
                _ex = contract_service.get_contract(contract_id)
                _exm = (_ex.get("sup_months") if isinstance(_ex, dict)
                        else getattr(_ex, "sup_months", 0))
                if int(_exm or 0) > 0:
                    return  # متعهد قائم — اللقطة لا تكتب فوقه.
            except Exception:
                pass
        _c = _pos[0]
        from services import supervision_service as _sup41
        _start41 = ((getattr(self.contract, "sup_start_date", "") or "").strip()
                    if self.contract else "")
        _sup41.setup_supervision(contract_id, _start41, int(_c["months"]),
                                 float(_c["monthly"]), 0.0,
                                 touch_amount=False)
        if _start41:
            from services import lifecycle_service as _lc41
            _lc41.update_contract_lifecycle(
                contract_id, start_date=_start41,
                end_date=_sup41.base_end_date(contract_id))

    def _apply_mode(self, mode: str, unit_label: str, unit_price: float,
                    is_supervision: bool, keep: bool = False):
        """إظهار أقسام النموذج حسب نمط التسعير · النوع هو المصدر."""
        self._mode = mode or "lump"
        self._is_sup = bool(is_supervision)
        if not hasattr(self, "_qty_row_label"):
            return          # النموذج لم يكتمل بناؤه بعد · تُضبط في المزامنة
        from services import feature_service as _feat
        has_template = bool(getattr(self, "_has_stage_template", False))
        mixed_supervision = bool(is_supervision and self._mode == "items")
        show_unit = (self._mode == "unit")
        # في العقود المختلطة تظهر البنود كمكونات مالية حتى لو كان النوع له قالب مراحل.
        show_items = (self._mode == "items" and _feat.enabled("boq_items")) or (
            not has_template and not is_supervision and _feat.enabled("boq_items"))
        # V3.30: الشامل — مبلغه مقطوع يُكتب، والبنود تتبع مكوّن البنود.
        _is_bundle = (self._mode == "bundle")
        if _is_bundle:
            show_items = (self._bundle_has_items()
                          and _feat.enabled("boq_items"))
        elif getattr(self, "_bundle_box", None) is not None:
            self._bundle_box.setVisible(False)
            self._bundle_box.setMaximumHeight(0)  # لا يأخذ مساحة
            self._clear_bundle_cards()
        if is_supervision and not _feat.enabled("supervision"):
            is_supervision = False
            self._is_sup = False

        # صف الكمية × السعر
        self.qty_unit_lbl.setText(unit_label or "وحدة")
        self._qty_row_label.setText(
            "عدد الأشهر × قيمة الشهر" if is_supervision
            else "الكمية × سعر الوحدة")
        self._qty_row_label.setVisible(show_unit)
        self._qty_row_label.setMaximumHeight(28 if show_unit else 0)
        self.qty_host.setVisible(show_unit)
        if show_unit and not keep and unit_price > 0:
            self.unit_price.blockSignals(True)
            self.unit_price.setValue(unit_price)
            self.unit_price.blockSignals(False)
        if not show_unit:
            self.gross_lbl.setText("")

        # جدول البنود
        self._items_box.setVisible(show_items)

        # صندوق الإشراف: تاريخ التعهد فقط (المدة والقيمة من صف الكمية)
        # V4.0: يظهر أيضًا للأنواع التي في قالبها مراحل إشرافية —
        # المدة والقيمة تُدخلان هنا مرة واحدة، والبداية من نافذة المرحلة.
        # V4.1: الشامل مستثنى — بطاقة الإشراف هي المصدر الوحيد (لا صندوق).
        _tpl_has_sup = bool(getattr(self, "_tpl_has_sup", False))
        try:
            _sup_box = getattr(self, "_sup_box", None)
            if _sup_box is not None:
                _show_sup = (bool(is_supervision) or _tpl_has_sup) and not _is_bundle
                _sup_box.setVisible(_show_sup)
                _sup_box.setMaximumHeight(16777215 if _show_sup else 0)  # QWIDGETMAX when visible
        except Exception:
            pass
        _show_sup_fields = (mixed_supervision
                            or (_tpl_has_sup and not is_supervision)) \
            and not _is_bundle
        for _name, _vis in (("sup_months_lbl", _show_sup_fields),
                            ("sup_months", _show_sup_fields),
                            ("sup_monthly_lbl", _show_sup_fields),
                            ("sup_monthly", _show_sup_fields),
                            ("sup_discount_lbl", True),
                            ("sup_discount", True)):
            try:
                _w = getattr(self, _name, None)
                if _w is not None:
                    _w.setVisible(bool(_vis))
            except Exception:
                pass

        # خطة السداد/المراحل تظهر فقط إذا كان نوع العقد له شجرة فعلًا.
        # V4.5.14: النوع التلقائي يعرض جدول القالب أيضًا (تعديل مبالغ هذا
        # العقد فقط) — بلا شريحة نطاق وبلا بنود.
        _show_plan = not is_supervision and has_template and _feat.enabled("payment_plan")
        if getattr(self, "_plan_box", None) is not None:
            self._plan_box.setVisible(True)  # دائماً ظاهر — حتى لو فارغ
            if (is_supervision or not has_template) and hasattr(self, "plan_table"):
                self.plan_table.setRowCount(0)
                self._update_plan_total_status()

        # نطاق العقد يظهر فقط عند الحاجة — الـ splitter دائماً ظاهر
        _show_scope = getattr(self, "_scope_applicable", False)
        _is_bundle = bool(getattr(self, "_mode", "") == "bundle")
        if getattr(self, "_scope_box", None) is not None:
            self._scope_box.setVisible(_show_scope)
            if not _show_scope:
                self._scope_box.setMaximumWidth(0)
            else:
                self._scope_box.setMaximumWidth(16777215)
        # أزرار النطاق: ظاهرة فقط للعقد اليدوي (مش الشامل)
        _scope_btns_vis = _show_scope and not _is_bundle
        for _btn_name in ("scope_all", "scope_none", "scope_apply"):
            _btn = getattr(self, _btn_name, None)
            if _btn is not None:
                _btn.setVisible(_scope_btns_vis)
        # زر إرجاع من جدول الدفعات: ظاهر فقط للعقد اليدوي
        _plan_return_vis = _show_scope and not _is_bundle
        if getattr(self, "plan_return_btn", None) is not None:
            self.plan_return_btn.setVisible(_plan_return_vis)
        # عمود التشيك بوكس (col 0): ظاهر فقط للعقد اليدوي
        _show_chk_col = _show_scope and not _is_bundle
        if getattr(self, "plan_table", None) is not None:
            self.plan_table.setColumnHidden(0, not _show_chk_col)
        # الـ splitter دائماً ظاهر (جدول الدفعات يظهر حتى لو فارغ)
        if getattr(self, "_splitter", None) is not None:
            self._splitter.setVisible(True)
            self._splitter.setMaximumHeight(16777215)

        # قيمة العقد تقفل فقط في عقد الإشراف الصافي؛ أما المختلط فيبقى مبلغ العقد
        # إجمالي الخدمات والبنود، مع حفظ بيانات الإشراف كجزء مستقل.
        self._set_amount_readonly(bool(is_supervision and not mixed_supervision))
        _lnk14b = getattr(self, "plan_summary_link", None)
        if _lnk14b is not None:
            # V4.5.14: سطر الملخص يظهر للتلقائي أيضًا (جدول القالب ظاهر)
            _lnk14b.setVisible(True)
        # لا نعيد تحجم النافذة عند تغيير النوع — يسبب تحريك الأزرار
        self._update_mode_banner()
        self._update_gross()
        self._update_discount()
        self._update_plan_summary()
        self._refresh_plan_preview()

    def _sync_plan_from_items(self):
        """V3.2 (ب): المبلغ = مجموع البنود + توزيع الدفعات عليه."""
        total = self._items_total()
        if total <= 0:
            style.info(self, "لا توجد بنود بمبالغ للمزامنة منها.")
            return
        try:
            if not self.amount.isReadOnly():
                self.amount.setValue(total)
        except Exception:
            self.amount.setValue(total)
        if self._plan_has_active_rows():
            self._rescale_plan_to(total)
        self._update_items_total()
        self._update_plan_total_status()
        style.toast(self.parent() or self, f"تمت المزامنة على {total:,.3f} د.ك")

    def _update_mode_banner(self):
        pass  # mode_banner مُزال بالكامل

    def _resize_for_mode(self, show_items: bool, is_sup: bool):
        """ارتفاع النافذة يتبع محتواها · بحد الشاشة (لا setFixedSize)."""
        want_h = 760
        if show_items:
            want_h = 840
        elif is_sup:
            want_h = 800
        try:
            style.fit_window(self, max(self.width(), 1120), want_h,
                             min_w=980, min_h=680, ratio=0.96)
        except Exception:
            pass

    # ==================== بنود العقد ====================
    def _add_item_row(self, description: str = "", amount: float = 0.0,
                      stage_id: int | None = None):
        row = self.items_table.rowCount()
        self.items_table.blockSignals(True)
        self.items_table.insertRow(row)
        self.items_table.setItem(row, 0, QTableWidgetItem(description))
        cell = QTableWidgetItem(f"{amount:,.3f}" if amount else "")
        cell.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.items_table.setItem(row, 1, cell)
        # عمود المرحلة: QComboBox
        from PySide6.QtWidgets import QComboBox
        combo = QComboBox()
        combo.addItem("— بدون مرحلة —", None)
        _cid = getattr(self.contract, "id", None) if self.contract else None
        if _cid:
            try:
                from services import workflow_service as _wf_st
                for st in _wf_st.get_contract_stages(_cid):
                    if (st.get("level") or 0) != 1:
                        continue
                    combo.addItem(st.get("name") or "", int(st["id"]))
            except Exception:
                pass
        if stage_id:
            for _i in range(combo.count()):
                if combo.itemData(_i) == int(stage_id):
                    combo.setCurrentIndex(_i)
                    break
        self.items_table.setCellWidget(row, 2, combo)
        self.items_table.blockSignals(False)
        self._update_items_total()

    def _del_item_row(self):
        row = self.items_table.currentRow()
        if row < 0:
            style.info(self, "اختر بندًا من الجدول أولاً.")
            return
        self.items_table.removeRow(row)
        self._update_items_total()

    def _item_amount(self, row: int) -> float:
        cell = self.items_table.item(row, 1)
        if cell is None:
            return 0.0
        try:
            return float(str(cell.text()).replace(",", "").strip() or 0)
        except ValueError:
            return 0.0

    def _items_rows(self) -> list[tuple[str, float, int | None]]:
        if not hasattr(self, "items_table"):
            return []
        rows = []
        for r in range(self.items_table.rowCount()):
            name_cell = self.items_table.item(r, 0)
            text = (name_cell.text().strip() if name_cell else "")
            amount = self._item_amount(r)
            # قراءة stage_id من combo
            _combo = self.items_table.cellWidget(r, 2)
            _sid = _combo.currentData() if _combo else None
            if text or amount:
                rows.append((text, amount, _sid))
        return rows

    def _update_items_total(self):
        if not hasattr(self, "items_total_lbl"):
            return
        total = sum(a for _, a, *_ in self._items_rows())
        self.items_total_lbl.setText(f"مجموع البنود: {total:,.3f} د.ك")
        diff = total - self.amount.value()
        if total > 0 and abs(diff) > 0.001:
            theme = style.theme()
            self.items_total_lbl.setText(
                f"مجموع البنود: {total:,.3f} د.ك · "
                f"الفرق عن قيمة العقد: {diff:+,.3f}")
            self.items_total_lbl.setStyleSheet(
                "background: transparent; border: none; font-weight: 800;"
                f" color: {theme['WARNING_700']};")
        else:
            self.items_total_lbl.setStyleSheet(
                "background: transparent; border: none; font-weight: 800;")

    def _load_items(self):
        """تحميل بنود عقد قائم في الجدول."""
        if not self.contract or not self.contract.id:
            return
        if not hasattr(self, "items_table"):
            return  # جدول البنود محذوف — لا crash
        try:
            from services import lifecycle_service as lc
            rows = lc.list_boq(self.contract.id)
        except Exception:
            rows = []
        self.items_table.setRowCount(0)
        for r in rows:
            self._add_item_row(r["description"],
                               float(r["qty"] or 1) * float(r["unit_price"] or 0),
                               stage_id=r.get("stage_id"))

    def _confirm_plan_sync(self, prev: dict) -> bool:
        """V3.11: تأكيد قبل/بعد قبل مزامنة الخطة من القالب."""
        _kept = []
        if prev["triggered_kept"]:
            _kept.append(f"{len(prev['triggered_kept'])} مستحقة فعلًا")
        if prev["overridden_kept"]:
            _kept.append(f"{len(prev['overridden_kept'])} بمبالغ يدوية")
        if prev["flexible_kept"]:
            _kept.append(f"{len(prev['flexible_kept'])} مرنة")
        return bool(style.confirm(
            self,
            f"خطة السداد تختلف عن قالب النوع «{prev['type']}».\n"
            f"قبل: {prev['before_count']} دفعات "
            f"({prev['before_total']:,.3f} د.ك)\n"
            f"بعد: {prev['after_count']} دفعات "
            f"({prev['after_total']:,.3f} د.ك)"
            + (f"\nتُحفَظ ولا تُمسّ: {' · '.join(_kept)}"
               if _kept else "")
            + "\nستُؤخذ نسخة احتياطية تلقائيًا قبل التنفيذ."
            "\n\nمتابعة المزامنة؟",
            "مزامنة الخطة من القالب"))

    def _backup_before_plan_sync(self, contract_id: int) -> str:
        """V3.11: نسخة احتياطية قبل المزامنة — "" مع رسالة عند الفشل."""
        import os as _os
        from datetime import datetime as _dt
        try:
            from database.database import backup_db
            from services.backup_service import get_backup_dir
            dest = _os.path.join(
                get_backup_dir(),
                f"pre_plan_sync_{contract_id}_"
                f"{_dt.now().strftime('%Y-%m-%d_%H%M%S')}.sqlite")
            backup_db(dest)
            return dest
        except Exception as exc:
            style.error(
                self, f"تعذر أخذ نسخة احتياطية — أُلغي الحفظ:\n{exc}")
            return ""

    def _confirm_type_rebuild(self, old_type: str, new_type: str) -> bool:
        """V2.50: تأكيد إعادة البناء قبل حفظ أي شيء."""
        try:
            from services import workflow_service as _wf
            impact = _wf.schedule_impact(self.contract.id)
        except Exception:
            impact = {"plan": 0, "stages": 0, "vouchers": 0}
        return bool(style.confirm(
            self,
            f"تغيّر نوع العقد من «{old_type}» إلى «{new_type}».\n"
            f"سيُعاد بناء {impact['stages']} مرحلة و{impact['plan']} دفعة "
            "من قالب النوع الجديد.\n"
            f"السندات ({impact['vouchers']}) تبقى مربوطة بالعقد ولا تُحذف.\n"
            "ستُؤخذ نسخة احتياطية تلقائيًا قبل التنفيذ.\n\nمتابعة؟",
            "إعادة بناء المراحل والدفعات"))

    def _run_type_rebuild(self, contract_id: int, old_type: str,
                          new_type: str) -> bool:
        """V2.50: نسخة احتياطية ← إعادة بناء ← تقرير. False = أُلغي الحفظ."""
        import os as _os
        from datetime import datetime as _dt
        try:
            from database.database import backup_db
            from services.backup_service import get_backup_dir
            _dest = _os.path.join(
                get_backup_dir(),
                f"pre_type_change_{contract_id}_"
                f"{_dt.now().strftime('%Y-%m-%d_%H%M%S')}.sqlite")
            backup_db(_dest)
        except Exception as exc:
            try:
                contract_service.set_contract_type(contract_id, old_type)
            except Exception:
                pass
            style.error(self, f"تعذر أخذ نسخة احتياطية — أُعيد النوع السابق:\n{exc}")
            return False
        try:
            from services import workflow_service as _wf
            rep = _wf.rebuild_contract_schedule(contract_id, old_type)
        except Exception as exc:
            style.error(self, f"تعذّرت إعادة البناء (النوع الجديد محفوظ):\n{exc}\nالنسخة: {_dest}")
            return True
        _old_total = sum(float(x["amount"] or 0) for x in rep["old_plan"])
        _new_total = sum(float(x["amount"] or 0) for x in rep["new_plan"])
        style.info(
            self,
            f"تمت إعادة البناء «{old_type}» ← «{new_type}»:"
            f"\nقبل: {rep['old_stages']} مرحلة · {len(rep['old_plan'])} دفعات "
            f"({ _old_total:,.3f})"
            f"\nبعد: {rep['new_stages']} مرحلة · {len(rep['new_plan'])} دفعات "
            f"({_new_total:,.3f})"
            f"\nالسندات الباقية مربوطة: {rep['vouchers_kept']}"
            f"\nالنسخة الاحتياطية: {_dest}")
        return True

    def _save_items(self, contract_id: int):
        """حفظ البنود: مسح ثم إعادة كتابة (بند + مبلغ + مرحلة)."""
        from services import lifecycle_service as lc
        from services import ui_data_service as ui_data
        rows = self._items_rows()
        try:
            ui_data.purge_unlinked_boq_items(contract_id)
        except Exception:
            pass
        for description, amount, stage_id in rows:
            if not description:
                continue
            lc.add_boq_item(contract_id, description, 1, "", amount,
                            stage_id=stage_id)

    def _update_gross(self):
        """سطر «= الإجمالي» بجوار الكمية × السعر."""
        gross = self.qty.value() * self.unit_price.value()
        self.gross_lbl.setText(f"=  {gross:,.3f} د.ك" if gross else "")
        self.gross_lbl.setToolTip(
            "الإجمالي قبل الخصم · اكتب القيمة الفعلية في «قيمة العقد» "
            "وسيحسب النظام المخصوم")

    def _qty_changed(self):
        """تغيير الكمية أو سعر الوحدة يعيد ضبط قيمة العقد (قبل الخصم)."""
        if getattr(self, "_is_sup", False):
            self._update_gross()
            self._sup_changed()
            return
        self._update_gross()
        gross = self.qty.value() * self.unit_price.value()
        if gross > 0:
            self.amount.setValue(gross)
        self._update_discount()

    def _update_discount(self):
        """سطر «المخصوم» بالمبلغ والنسبة · يُحسب ولا يُخزَّن.

        يخص نمط «وحدة × سعر» وحده · وفي الإشراف القيمة محسوبة بلا خصم.
        """
        if not hasattr(self, "discount_lbl"):
            return
        if getattr(self, "_mode", "unit") != "unit" or \
                getattr(self, "_is_sup", False):
            self.discount_lbl.setText("")
            self.discount_lbl.setVisible(False)
            return
        theme = style.theme()
        info = contract_service.pricing(
            self.qty.value(), self.unit_price.value(), self.amount.value(),
            self.qty_unit_lbl.text())
        if not info["has_qty"] or abs(info["diff"]) < 0.001:
            self.discount_lbl.setText("")
            self.discount_lbl.setVisible(False)
            return
        if info["is_discount"]:
            self.discount_lbl.setText(
                f"المخصوم: {info['discount']:,.3f} د.ك "
                f"({info['percent']:,.1f}%) من إجمالي "
                f"{info['gross']:,.3f} د.ك")
            color = theme["SUCCESS_700"]
        else:
            self.discount_lbl.setText(
                f"زيادة على السعر: {info['increase']:,.3f} د.ك "
                f"({info['percent']:,.1f}%) فوق إجمالي "
                f"{info['gross']:,.3f} د.ك")
            color = theme["WARNING_700"]
        self.discount_lbl.setStyleSheet(
            f"background: transparent; border: none; font-weight: 700;"
            f" color: {color};")
        self.discount_lbl.setVisible(True)

    def _save(self):
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.number, "رقم العقد")
        v.add(self.customer, "العميل")
        v.add(self.amount, "قيمة العقد", min_value=0.001)
        if not v.validate():
            return
        if not (self.ctype.currentData() or ""):
            style.error(self, "اختر نوع العقد من القائمة.\n"
                              "الأنواع تُضاف من: الإعدادات ← أنواع العقود.")
            return
        # فحص بيانات الإشراف (النوع الإشرافي: الكمية أشهر والسعر شهري)
        is_sup = bool(getattr(self, "_is_sup", False))
        mixed_supervision = is_sup and getattr(self, "_mode", "") == "items"
        _sup_monthly_value = (self.sup_monthly.value() if mixed_supervision
                              else self.unit_price.value())
        if is_sup and _sup_monthly_value <= 0:
            style.error(self, "عقد الإشراف: قيمة الشهر يجب أن تكون أكبر من صفر.")
            return
        # V4.0: مسار القالب الإشرافي — المدة والقيمة معًا أو صفرًا.
        _tpl_has_sup_v = False
        if not is_sup:
            try:
                from services import workflow_service as _wf4v
                _tpl_has_sup_v = bool(_wf4v.template_has_supervision(
                    self.ctype.currentData() or ""))
            except Exception:
                _tpl_has_sup_v = False
        # V4.1: الشامل مستثنى — فحصه من البطاقة لا الصندوق.
        if _tpl_has_sup_v and not is_sup \
                and getattr(self, "_mode", "") != "bundle":
            _m4v = int(self.sup_months.value())
            _r4v = float(self.sup_monthly.value())
            if (_m4v > 0) != (_r4v > 0):
                style.error(self, "بيانات الإشراف: أكمل «المدة» و«قيمة الشهر» معًا أو اتركهما صفرًا.")
                return
        _clearing_items = False
        if getattr(self, "_mode", "") == "items" and not self._items_rows():
            # V3.11: فك حبس البند الأخير — المسح الكامل بتأكيد صريح.
            _saved_items_n = (
                contract_service.items_count(self.contract.id)
                if self.contract and self.contract.id else 0)
            if _saved_items_n > 0:
                if not style.confirm(
                        self,
                        f"جدول البنود فارغ — سيُمسح {_saved_items_n} "
                        "بنود محفوظة من هذا العقد. متابعة؟",
                        "مسح بنود العقد"):
                    return
                _clearing_items = True
            else:
                style.error(self, "أضف بندًا واحدًا على الأقل، "
                                  "أو اختر نوع عقد بمبلغ مقطوع.")
                return
        # V3.30: تحقق مكوّنات الشامل (عند الإنشاء فقط — التعديل للعرض)
        _bundle_sel = []
        if getattr(self, "_mode", "") == "bundle" and not self.contract:
            _bundle_sel = self._bundle_selection()
            for _c in _bundle_sel:
                if _c["enabled"] and _c["kind"] == "supervision" \
                        and _c["months"] < 1:
                    style.error(self, f"مكوّن «{_c['label']}» مفعّل — "
                                      "عدد الأشهر مطلوب.")
                    return
            # V4.1: المفعّل يحتاج قيمة شهر موجبة + تعهد واحد فقط.
            _sups41 = [_c for _c in _bundle_sel if _c["enabled"]
                       and _c["kind"] == "supervision"]
            for _c in _sups41:
                if float(_c["monthly"]) <= 0:
                    style.error(self, f"مكوّن «{_c['label']}» مفعّل — "
                                      "قيمة الشهر مطلوبة.")
                    return
            if len(_sups41) > 1:
                style.error(self, "التعهد العقدي واحد — "
                                  "فعّل مكوّن إشراف واحدًا فقط.")
                return
            if not any(_c["enabled"] for _c in _bundle_sel) \
                    and _bundle_sel:
                style.toast(self, "كل المكوّنات مطفأة — سيُبنى المسار "
                                  "الأساسي فقط")
        # V4.48: النطاق — تصنيف واحد على الأقل عند الإنشاء.
        if self._scope_box.isVisibleTo(self):
            if not self._scope_selection():
                style.error(self, "اختر تصنيفًا واحدًا على الأقل من نطاق "
                                  "العقد — أو علّم «الكل».")
                return
        # V4.44: فحص المراحل اليدوية مبكرًا — قبل أي كتابة.
        _man_pre: list = []
        if getattr(self, "_mode", "") == "bundle":
            _man_pre = self._manual_stage_rows()
            if _man_pre:
                _man_total = round(sum(r["amount"] for r in _man_pre), 3)
                if self.contract and getattr(self.contract, "id", None):
                    from services import lifecycle_service as _lc44v
                    _rem44 = _lc44v.manual_stages_remaining(
                        self.contract.id)["remaining"]
                else:
                    _rem44 = round(float(self.amount.value() or 0), 3)
                if _man_total > _rem44 + 0.001:
                    style.error(
                        self,
                        f"مجموع المراحل ({_man_total:,.3f}) يتجاوز المتبقي "
                        f"من قيمة العقد ({_rem44:,.3f}).")
                    return
        if getattr(self, "_mode", "") == "bundle" and self.contract:
            # V4.1: التعديل — اللقطة المحفوظة لا تحمل تعهدين.
            try:
                _snap41 = contract_service.get_contract_components(
                    self.contract.id)
            except Exception:
                _snap41 = []
            _pos41e = [c for c in _snap41 if c.get("kind") == "supervision"
                       and c.get("enabled")
                       and int(c.get("months") or 0) > 0
                       and float(c.get("monthly") or 0) > 0]
            if len(_pos41e) > 1:
                style.error(self, "اللقطة تحمل مكوّني إشراف — "
                                  "راجع الإعدادات قبل الحفظ.")
                return
        if not self._resolve_amount_mismatch():
            return
        customer_id = self.customer.selected_data()
        contract_type = self.ctype.currentData() or ""
        # V2.50 (البند 3): تغيير النوع يُعاد معه بناء المراحل والدفعات
        _old_type = ((getattr(self.contract, "contract_type", "") or "")
                     if self.contract else "")
        _type_changed = bool(self.contract and _old_type
                             and contract_type and _old_type != contract_type)
        if _type_changed and not self._confirm_type_rebuild(_old_type, contract_type):
            return
        if not self.contract:
            duplicates = contract_service.existing_active_contracts_for_customer_type(
                customer_id, contract_type)
            if duplicates:
                sample = "، ".join(d.contract_number for d in duplicates[:3])
                if not style.confirm(
                        self,
                        "هذا العميل لديه عقد من نفس النوع بالفعل:\n"
                        f"{sample}\n\nهل تريد إضافة عقد آخر من نفس النوع؟"):
                    return
        if not self.contract:
            # V4.56: كل عقد لازم له خطة دفع — الإشراف الصرف معفى
            # (تحصيله بالمستحقات لا بخطة السداد).
            from services import workflow_service as _wf56p
            _is_bundle56 = getattr(self, "_mode", "") == "bundle"
            _is_sup56 = bool(getattr(self, "_is_sup", False))
            if not _is_sup56 and not _is_bundle56:
                # الشامل والإشراف لهما تحصيلهما الخاص (مكوّنات/مستحقات).
                _tree56 = _wf56p.get_stages(_wf56p.TX_CONTRACT,
                                            contract_type or "")
                if not _tree56 and not _wf56p.type_payments(
                        contract_type or ""):
                    style.error(
                        self, f"النوع «{contract_type}» بلا مراحل "
                        "ودفعات — اربطها أولًا من الإعدادات (ربط مراحل "
                        "ودفعات هذا النوع).")
                    return
        data = Contract(
            id=self.contract.id if self.contract else None,
            contract_number=self.number.text(),
            contract_name=self.ctype.currentData() or "",
            customer_id=customer_id,
            contract_date=self.date.date().toString("yyyy-MM-dd"),
            description=self.description.toPlainText(),
            amount=self.amount.value(),
            contract_type=contract_type,
            notes=self.notes.toPlainText(),
            qty=(self.qty.value()
                 if getattr(self, "_mode", "") == "unit" else 1),
            unit_price=(self.unit_price.value()
                        if getattr(self, "_mode", "") == "unit" else 0.0),
        )
        try:
            if self.contract:
                # V3.11: فحص التجاوزات قبل الكتابة — الفشل لا يغيّر شيئًا.
                if getattr(self, "_plan_amount_overrides", None):
                    from services import lifecycle_service as _lc0
                    _lc0.validate_plan_amount_overrides(
                        self.contract.id, self._plan_amount_overrides,
                        against_value=float(self.amount.value() or 0))
                # V3.11: معاينة المزامنة قبل أي كتابة — الفرق المادي
                # يحتاج تأكيد قبل/بعد + نسخة احتياطية، والرفض يُلغي الحفظ.
                from services import workflow_service as _wf_sync
                _sync_prev = None
                _sync_backup = ""
                if (not _type_changed
                        and getattr(self, "_plan_tpl_mode", False)):
                    _sync_prev = _wf_sync.preview_plan_sync(
                        self.contract.id,
                        amount=float(self.amount.value() or 0))
                    if _sync_prev["changed"]:
                        if not self._confirm_plan_sync(_sync_prev):
                            return
                        _sync_backup = self._backup_before_plan_sync(
                            self.contract.id)
                        if not _sync_backup:
                            return
                contract_service.update_contract(data)
                new_id = self.contract.id
                if _type_changed:
                    if not self._run_type_rebuild(new_id, _old_type, contract_type):
                        return
                elif _sync_prev is not None and _sync_prev["changed"]:
                    _sync_rep = _wf_sync.sync_plan_from_template(new_id)
                    _kept_bits = []
                    if _sync_rep["triggered_kept"]:
                        _kept_bits.append(
                            f"{len(_sync_rep['triggered_kept'])} مستحقة فعلًا")
                    if _sync_rep["overridden_kept"]:
                        _kept_bits.append(
                            f"{len(_sync_rep['overridden_kept'])} يدوية")
                    if _sync_rep["flexible_kept"]:
                        _kept_bits.append(
                            f"{len(_sync_rep['flexible_kept'])} مرنة")
                    style.info(
                        self,
                        f"زُامنت خطة السداد من قالب "
                        f"«{_sync_rep['type']}»:\n"
                        f"قبل: {_sync_rep['before_count']} دفعات "
                        f"({_sync_rep['before_total']:,.3f})\n"
                        f"بعد: {_sync_rep['after_count']} دفعات "
                        f"({_sync_rep['after_total']:,.3f})"
                        + (f"\nحُفظت: {' · '.join(_kept_bits)}"
                           if _kept_bits else "")
                        + f"\nالنسخة الاحتياطية: {_sync_backup}")
                # تجاوزات مبالغ الدفعات في وضع التعديل (تُفحص مقابل
                # القيمة المحدّثة — لهذا تُطبّق بعد update_contract،
                # وبعد المزامنة لتبقى تعديلات الخلايا).
                if getattr(self, "_plan_amount_overrides", None):
                    from services import lifecycle_service as _lc2
                    _lc2.update_plan_amount_overrides(
                        new_id, self._plan_amount_overrides)
                if (getattr(self, "_plan_tpl_mode", False) and getattr(
                        self, "_plan_amount_overrides", None)):
                    from services import lifecycle_service as _lc33
                    _lc33.log_event(
                        new_id, "تحرير دفعات من القالب",
                        "تجاوز مبالغ دفعات لهذا العقد فقط")
            else:
                from services import contract_type_service as _cts56
                _manual56 = bool(_cts56.type_config(
                    self.ctype.currentData() or "").get("manual_track"))
                new_id = contract_service.add_contract(
                    data, components=(_bundle_sel or None),
                    scope_stage_ids=(self._scope_selection()
                                     if self._scope_box.isVisibleTo(self)
                                     else None),
                    manual_path=_manual56)
                # خطة السداد تُسحب تلقائيًا من قالب نوع العقد، ثم تُطبّق
                # أي مبالغ عدّلها المستخدم في معاينة هذا العقد فقط.
                if getattr(self, "_plan_amount_overrides", None):
                    from services import lifecycle_service as _lc
                    _lc.update_plan_amount_overrides(new_id, self._plan_amount_overrides)
            # حفظ بنود العقد (نمط البنود · أو الشامل بمكوّن بنود مفعّل)
            if getattr(self, "_mode", "") == "items" or (
                    getattr(self, "_mode", "") == "bundle"
                    and self._bundle_has_items()):
                self._save_items(new_id)
                if _clearing_items:
                    _left = contract_service.items_count(new_id)
                    if _left > 0:
                        style.info(
                            self,
                            f"بقيت {_left} بنود مرتبطة بحركات "
                            "(سندات/عقود فرعية) — لم تُمسح.")
            # ضبط/إزالة بيانات الإشراف (المدة والقيمة من صف الكمية)
            from services import supervision_service as sup
            if is_sup:
                _sup_start = ((getattr(self.contract, "sup_start_date", "") or "").strip()
                              if self.contract else "")
                _s_disc = getattr(self, "sup_discount", None)
                _s_mon = getattr(self, "sup_months", None)
                _s_mly = getattr(self, "sup_monthly", None)
                sup.setup_supervision(
                    new_id, _sup_start,
                    (_s_mon.value() if (mixed_supervision and _s_mon is not None)
                     else self.qty.value()),
                    (_s_mly.value() if (mixed_supervision and _s_mly is not None)
                     else self.unit_price.value()),
                    (_s_disc.value() if _s_disc is not None else 0.0))
                # فترة العقد تتبع تعهد الإشراف تلقائيًا (بداية ⟵ نهاية)
                from services import lifecycle_service as _lc
                if _sup_start:
                    _lc.update_contract_lifecycle(
                        new_id, start_date=_sup_start,
                        end_date=sup.base_end_date(new_id))
            elif getattr(self, "_mode", "") == "bundle":
                # V4.1: الشامل — التعهد من بطاقة الإشراف وحده (لا صندوق).
                self._save_bundle_pledge(new_id, _bundle_sel)
                # V4.44: المراحل الرئيسية اليدوية — كل مرحلة بدفعتها.
                _man_stages = self._manual_stage_rows()
                if _man_stages:
                    from services import lifecycle_service as _lcms
                    _lcms.add_contract_main_stages(new_id, _man_stages)
            else:
                # V4.0: مسار القالب الإشرافي — المدة والقيمة تُحفظان على
                # العقد (بلا مساس بقيمته) وتبدأ نوافذ التعهد من المراحل.
                _tpl4 = False
                try:
                    from services import workflow_service as _wf4s
                    _tpl4 = bool(_wf4s.template_has_supervision(contract_type))
                except Exception:
                    _tpl4 = False
                _m4s = int(self.sup_months.value())
                _r4s = float(self.sup_monthly.value())
                _was_sup = bool(self.contract and (getattr(
                    self.contract, "sup_start_date", "") or "").strip())
                if _tpl4 and _m4s > 0 and _r4s > 0:
                    _sup_start4 = ((getattr(self.contract, "sup_start_date", "")
                                    or "").strip() if self.contract else "")
                    _s_disc4 = getattr(self, "sup_discount", None)
                    sup.setup_supervision(
                        new_id, _sup_start4, _m4s, _r4s,
                        (_s_disc4.value() if _s_disc4 is not None else 0.0),
                        touch_amount=False)
                    if _sup_start4:
                        from services import lifecycle_service as _lc4
                        _lc4.update_contract_lifecycle(
                            new_id, start_date=_sup_start4,
                            end_date=sup.base_end_date(new_id))
                elif _was_sup:
                    # كان إشرافًا وأُلغي التفعيل · تُمسح بياناته
                    from services import ui_data_service as ui_data
                    ui_data.clear_supervision_fields(new_id)
            style.toast(self.parent() or self, "تم حفظ العقد")
            QDialog.accept(self)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


class GapsDialog(QDialog):
    """V3.2 (ج): تقرير عقود بفروقات + فتح/إصلاح + تصدير."""

    HEADS = ["العقد", "العميل", "النوع", "القيمة", "مجموع الخطة",
             "فرق الخطة", "مجموع البنود", "فرق البنود"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self.setWindowTitle("عقود بفروقات (القيمة × الخطة × البنود)")
        self.resize(1000, 480)
        root = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.info_lbl = QLabel("")
        bar.addWidget(self.info_lbl, 1)
        self.open_btn = QPushButton("📂 فتح العقد")
        self.open_btn.setObjectName("btnPrimary")
        self.open_btn.clicked.connect(self._open_selected)
        self.fix_btn = QPushButton("🔧 إصلاح الكل")
        self.fix_btn.clicked.connect(self._fix_all)
        self.xls_btn = QPushButton("📤 تصدير Excel")
        self.xls_btn.setProperty("flat", True)
        self.xls_btn.clicked.connect(self._export)
        for b in (self.open_btn, self.fix_btn, self.xls_btn):
            bar.addWidget(b)
        root.addLayout(bar)
        from ui.archive import _fill, _table
        self.table = _table(self.HEADS)
        self.table.cellDoubleClicked.connect(
            lambda _r, _c: self._open_selected())
        root.addWidget(self.table, 1)
        self._rows: list[dict] = []
        self.refresh()

    def refresh(self):
        from services import report_service
        rep = report_service.contract_gaps_report()
        self._rows = rep["rows"]
        self.info_lbl.setText(f"العقود ذات الفروقات: {rep['count']}")
        from ui.archive import _fill
        from ui.widgets import apply_column_weights
        data, colors = [], {}
        for i, r in enumerate(self._rows):
            data.append([r["contract_number"], r["customer_name"],
                         r["contract_type"], f"{r['amount']:,.3f}",
                         f"{r['plan_total']:,.3f}" if r["plan_n"] else "",
                         f"{r['gap_plan']:+,.3f}" if r["plan_n"] else "",
                         f"{r['items_total']:,.3f}" if r["items_n"] else "",
                         f"{r['gap_items']:+,.3f}" if r["items_n"] else ""])
            if r["plan_n"] and abs(r["gap_plan"]) > 0.001:
                colors[(i, 5)] = "#D97706"
            if r["items_n"] and abs(r["gap_items"]) > 0.001:
                colors[(i, 7)] = "#D97706"
        _fill(self.table, data, colors=colors, money_cols=(3, 4, 5, 6, 7))
        apply_column_weights(self.table, [18, 24, 16, 14, 14, 12, 14, 12])

    def _selected(self) -> dict | None:
        r = self.table.currentRow()
        return self._rows[r] if 0 <= r < len(self._rows) else None

    def _open_selected(self):
        row = self._selected()
        if not row:
            style.info(self, "حدد عقدًا أولًا.")
            return
        try:
            con = contract_service.get_contract(row["contract_id"])
            if ContractDialog(self, con).exec():
                self.refresh()
        except Exception as exc:
            style.error(self, f"تعذر فتح العقد:\n{exc}")

    def _fix_all(self):
        if not self._rows:
            style.info(self, "لا توجد فروقات.")
            return
        from PySide6.QtWidgets import QMessageBox
        box = QMessageBox(self)
        box.setWindowTitle("إصلاح الكل")
        box.setText(f"{len(self._rows)} عقود بفروقات — اختر قاعدة الإصلاح "
                    "(تُؤخذ نسخة احتياطية أولًا):")
        box.setIcon(QMessageBox.Question)
        b_amt = box.addButton("تحديث المبالغ لتطابق المجاميع",
                              QMessageBox.AcceptRole)
        b_plan = box.addButton("توزيع الخطط على المبالغ",
                               QMessageBox.AcceptRole)
        box.addButton("إلغاء", QMessageBox.RejectRole)
        box.exec()
        clicked = box.clickedButton()
        if clicked not in (b_amt, b_plan):
            return
        import os as _os
        from datetime import datetime as _dt
        try:
            from database.database import backup_db
            from services.backup_service import get_backup_dir
            dest = _os.path.join(
                get_backup_dir(),
                "pre_gaps_fix_" + _dt.now().strftime("%Y-%m-%d_%H%M%S")
                + ".sqlite")
            backup_db(dest)
        except Exception as exc:
            style.error(self, f"تعذر أخذ نسخة احتياطية — أُلغي الإصلاح:\n{exc}")
            return
        ok, skipped, errors = 0, [], []
        from services import lifecycle_service as _lc
        for r in self._rows:
            cid = r["contract_id"]
            try:
                if clicked is b_amt:
                    ref = (r["plan_total"] if r["plan_n"]
                           else r["items_total"])
                    con = contract_service.get_contract(cid)
                    con.amount = ref
                    contract_service.update_contract(con)
                    _lc.log_event(cid, "إصلاح فرق",
                                  f"توحيد المبلغ مع المجموع {ref:,.3f}")
                else:
                    if not r["plan_n"]:
                        skipped.append(r["contract_number"])
                        continue
                    _lc.rescale_payment_plan(cid, r["amount"])
                    _lc.log_event(cid, "إصلاح فرق",
                                  "توزيع الخطة على المبلغ "
                                  f"{r['amount']:,.3f}")
                ok += 1
            except Exception as exc:
                errors.append(f"{r['contract_number']}: {exc}")
        msg = f"تم إصلاح {ok} من {len(self._rows)}."
        if skipped:
            msg += f"\nتُركت بلا خطة (بنود فقط): {', '.join(skipped[:5])}"
        if errors:
            msg += "\nأخطاء:\n" + "\n".join(errors[:5])
        msg += f"\nالنسخة: {dest}"
        style.info(self, msg)
        self.refresh()

    def _export(self):
        from ui.widgets import export_table_excel
        export_table_excel(
            self, "عقود بفروقات (القيمة × الخطة × البنود)", self.HEADS,
            [[r["contract_number"], r["customer_name"], r["contract_type"],
              r["amount"], r["plan_total"] if r["plan_n"] else "",
              r["gap_plan"] if r["plan_n"] else "",
              r["items_total"] if r["items_n"] else "",
              r["gap_items"] if r["items_n"] else ""]
             for r in self._rows],
            "contract_gaps", number_cols=[3, 4, 5, 6, 7])
