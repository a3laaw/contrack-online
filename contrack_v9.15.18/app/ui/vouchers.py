# -*- coding: utf-8 -*-
"""سندات الصرف والقبض · نموذج إداري بسيط: التاريخ، الطرف، المبلغ، البيان، العقد."""
from PySide6.QtCore import QDate, Qt, Signal, QTimer
from PySide6.QtGui import QColor, QCursor
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QCompleter, QDateEdit, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout,
    QGridLayout, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QPushButton, QStackedLayout, QTableWidget,
    QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError
from services import lifecycle_service as lc
from services import contract_service
from services.customer_service import ValidationError
from ui import style
from ui.design_system import Colors, Dimensions, Fonts, Styles
from ui.style import soft_shadow
from ui.widgets import required_label, SearchableComboBox, SafeDoubleSpinBox, SafeDateEdit, make_searchable, install_click_to_open, hide_popups_on_scroll, SegmentedTabs


class ExpenseAccountCombo(QComboBox):
    """قائمة حسابات مصروفات/عهد خفيفة للحوارات.

    البحث هنا فلترة داخل نفس QComboBox: يطابق أي حروف في أول أو وسط أو آخر
    المسار، ويطبّق تطبيعًا عربيًا بسيطًا حتى تظهر «العُهد / عهدة أحمد» عند
    كتابة «عهد» أو جزء من اسم الموظف، بدون نافذة Popup خارجية سوداء.
    """
    def __init__(self, placeholder: str = "", parent=None):
        super().__init__(parent)
        self.setEditable(True)
        self.setInsertPolicy(QComboBox.NoInsert)
        self.lineEdit().setPlaceholderText(placeholder)
        self.setMinimumWidth(220)
        # لا تجعل قائمة النتائج تسحب تركيز لوحة المفاتيح بعد أول حرف.
        self.view().setFocusPolicy(Qt.NoFocus)
        self._completer = QCompleter(self.model(), self)
        self._completer.setCompletionMode(QCompleter.PopupCompletion)
        self._completer.setFilterMode(Qt.MatchContains)
        self._completer.setCaseSensitivity(Qt.CaseInsensitive)
        self._completer.popup().setObjectName("completerPopup")
        self._completer.popup().setFocusPolicy(Qt.NoFocus)
        self.setCompleter(self._completer)
        self._all_items: list[tuple[str, object]] = []
        self.lineEdit().textEdited.connect(self._filter_text)
        install_click_to_open(self)

    @staticmethod
    def _norm(text: str) -> str:
        n = (text or "").strip().lower()
        for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"),
                     ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي"), ("ـ", "")):
            n = n.replace(a, b)
        return " ".join(n.split())

    def wheelEvent(self, event):  # noqa: N802
        event.ignore()

    def set_items(self, items, keep_selection: bool = False,
                  auto_select: bool = False):
        current = self.currentData() if keep_selection else None
        self._all_items = []
        for item in list(items or []):
            text, data = (item[0], item[1]) if len(item) >= 2 else (str(item), None)
            self._all_items.append((str(text), data))
        self._load_items(self._all_items)
        if current is not None:
            idx = self.findData(current)
            if idx >= 0:
                self.setCurrentIndex(idx)
        if auto_select and self.count() and self.currentIndex() < 0:
            self.setCurrentIndex(0)
        elif not auto_select:
            self.setCurrentIndex(-1)
            self.lineEdit().setText("")

    def _load_items(self, items: list[tuple[str, object]], typed: str = ""):
        le = self.lineEdit()
        self.blockSignals(True); le.blockSignals(True)
        self.clear()
        for text, data in items:
            self.addItem(text, data)
        if typed:
            self.setCurrentIndex(-1)
            le.setText(typed)
        self.blockSignals(False); le.blockSignals(False)
        self._completer.setModel(self.model())

    def _refocus_line_edit(self):
        le = self.lineEdit()
        if le is not None:
            le.setFocus(Qt.OtherFocusReason)
            le.setCursorPosition(len(le.text()))

    def _filter_text(self, text: str):
        typed = text or ""
        q = self._norm(typed)
        if not q:
            # عند حذف نص البحث لا نختار أول حساب تلقائيًا؛ يجب أن تبقى الخانة
            # فارغة حتى لا يرجع أول خيار في القائمة بدل ما يترك المستخدم الحقل
            # خاليًا أو يكتب بحثًا جديدًا.
            self._load_items(self._all_items, "")
            self.setCurrentIndex(-1)
            self.lineEdit().setText("")
            try:
                self._completer.popup().hide()
                self.hidePopup()
            except Exception:
                pass
            return
        matches = [(t, d) for t, d in self._all_items
                   if q in self._norm(t)]
        self._load_items(matches, typed)
        if matches:
            try:
                # لا نستخدم showPopup أثناء الكتابة لأنه قد يمسك لوحة المفاتيح
                # ويجبر المستخدم على النقر مرة أخرى. completer يعرض النتائج
                # المفلترة يدويًا ويُبقي الإدخال نشطًا.
                self._completer.setCompletionPrefix("")
                self._completer.complete()
                QTimer.singleShot(0, self._refocus_line_edit)
            except Exception:
                pass

    def selected_data(self):
        text = self.currentText().strip()
        # الاختيار الصحيح: النص الظاهر يساوي عنصرًا من القائمة الحالية/الأصلية.
        for i in range(self.count()):
            if self.itemText(i).strip() == text:
                return self.itemData(i)
        for label, data in self._all_items:
            if label.strip() == text:
                return data
        return None

    def select_data(self, data) -> bool:
        """V5.9: اختيار عنصر بمعرّفه — يُستخدم عند فتح سند قديم كانت
        قائمته تعرض المسار الكامل بينما العرض الآن باسم الحساب النهائي."""
        if data is None:
            return False
        try:
            idx = self.findData(data)
        except Exception:
            idx = -1
        if idx >= 0:
            self.setCurrentIndex(idx)
            return True
        return False


def _preview_saved_vouchers(parent, voucher_ids: list[int]) -> None:
    """معاينة السندات المحفوظة واحدًا تلو الآخر (نفس نافذة العرض)."""
    from ui.glass_receipt import GlassReceiptDialog
    for vid in voucher_ids or []:
        try:
            v = lc.get_voucher(int(vid))
        except Exception:
            v = None
        if not v:
            continue
        GlassReceiptDialog(parent, {
            "number": v["voucher_number"], "date": v["vdate"],
            "party": v["party"], "description": v["description"],
            "contract_number": v.get("contract_number"),
            "amount": float(v["amount"]), "vtype": v["vtype"], "raw": v,
        }).exec()


def _ask_extra_handling(parent, excess: float, next_title: str = "") -> str:
    """V6.2: قرار إلزامي عند زيادة المبلغ عن متبقي الدفعة المستحقة.

    يعيد "spread" (توزيع على الدفعة التالية) · "advance" (رصيد/سلفة) ·
    "" لو أُلغي — ولا يتحفظ السند بدون اختيار.
    """
    from PySide6.QtWidgets import QMessageBox
    box = QMessageBox(parent)
    box.setWindowTitle("المبلغ أكبر من متبقي الدفعة")
    box.setIcon(QMessageBox.Warning)
    _nxt = f"«{next_title}»" if next_title else "الدفعة المستحقة التالية"
    box.setText(f"المبلغ يزيد عن متبقي الدفعة بمقدار {excess:,.3f} د.ك.")
    box.setInformativeText("اختر إلزاميًا طريقة التعامل مع الزيادة قبل الحفظ:")
    b_spread = box.addButton(f"↪ وزّع الباقي على {_nxt}",
                             QMessageBox.AcceptRole)
    b_adv = box.addButton("💰 سجّله رصيد / سلفة", QMessageBox.ActionRole)
    box.addButton("✕ إلغاء", QMessageBox.RejectRole)
    box.exec()
    if box.clickedButton() is b_spread:
        return "spread"
    if box.clickedButton() is b_adv:
        return "advance"
    return ""


class VoucherDialog(QDialog):
    """سند صرف / قبض مبسّط · إداري وليس محاسبيًا."""

    def __init__(self, parent, vtype: str, preset_contract_id: int | None = None,
                 voucher: dict | None = None,
                 preset_subcontractor_id: int | None = None,
                 preset_sub_contract_id: int | None = None):
        super().__init__(parent)
        self.vtype = vtype
        self.voucher = voucher  # سند موجود = وضع تعديل
        # V5.4: تلميحات فتح السند من الزر الأيمن على مقاول الباطن
        self._preset_sub_id = preset_subcontractor_id
        self._preset_sc_id = preset_sub_contract_id
        if voucher:
            title = ("تعديل سند صرف" if vtype == "payment"
                     else "تعديل سند قبض") + f" · {voucher['voucher_number']}"
        else:
            title = "سند صرف جديد" if vtype == "payment" else "سند قبض جديد"
        is_receipt = vtype == "receipt"
        subtitle = ("تحصيل دفعة من عميل · تُخصم من العقد تلقائيًا"
                    if is_receipt else
                    "صرف مبلغ لمقاول باطن أو عميل")
        style.setup_dialog(
            self, title, subtitle,
            icon="📥" if is_receipt else "📤",
            color=style.OK_GREEN if is_receipt else style.DANGER,
            size_ratio=0.50,
            min_w=760 if is_receipt else 620,
            max_w=1100 if is_receipt else 920,
            fullscreen=True)

        from PySide6.QtWidgets import QWidget as _QW
        form_host = _QW()
        form = QFormLayout(form_host)
        self.form = form
        form.setContentsMargins(0, 0, 0, 0)
        form.setSpacing(11)
        self.body_layout.addWidget(form_host)
        # شريط مرحلة السند (تعديل سند موجود): عداد + إنهاء/تخطي بالأزرار
        if voucher:
            try:
                from services import workflow_service as _wf
                from ui.followup import StageBar
                if _wf.get_stages("payment"):
                    bar = StageBar(self, "payment", int(voucher["id"]))
                    self.body_layout.addWidget(bar)
            except Exception:
                pass

        self.number = QLineEdit(lc.next_voucher_number(vtype, _consume=False))
        self.number.setReadOnly(True)
        self.vdate = SafeDateEdit()
        self.vdate.setCalendarPopup(True)
        self.vdate.setDisplayFormat("yyyy-MM-dd")
        self.vdate.setDate(QDate.currentDate())

        self.party_kind = SegmentedTabs()
        self.party_kind.addItem("عميل", "customer")
        self.party_kind.addItem("مقاول باطن", "subcontractor")
        if vtype == "payment":
            self.party_kind.addItem("مصروف عام / مورد", "")
            self.party_kind.addItem("تحويل داخلي", "transfer")
            self.party_kind.setCurrentIndex(1)
        self.party_kind.addItem("الشريك (جارٍ)", "partner")
        self._gate_partner_button()
        self.party_kind.currentIndexChanged.connect(self._reload_parties)
        self.party_kind.currentIndexChanged.connect(lambda _: self._toggle_party_mode())
        self.party_kind.currentIndexChanged.connect(lambda _: self._reload_contracts())
        self.party_kind.currentIndexChanged.connect(
            lambda *_: self._reload_sub_contracts(keep=False))
        self.party = SearchableComboBox(search_only=True)
        self.party_text = QLineEdit()
        self.party_text.setPlaceholderText("اسم المورد / جهة الصرف...")
        self.expense_account = ExpenseAccountCombo("")
        self._expense_accounts = []
        self._expense_account_ids = []
        self._custody_mode = False      # وضع «تسليم عهدة» (سُلفة لا مصروف)
        self._reload_expense_accounts()
        self.expense_account.set_items(list(zip(self._expense_accounts, self._expense_account_ids)), auto_select=False)
        # تسليم العهدة أصبح من شاشة «العُهد» فقط. يبقى هذا الكود احتياطيًا
        # للتوافق مع السندات القديمة/الاستدعاءات الداخلية، ولا يظهر للمستخدم هنا.
        self.custody_give = QCheckBox("تسليم عهدة (سُلفة لموظف)")
        self.custody_give.setToolTip(
            "فعّلها عند تسليم مبلغ لموظف كعهدة.\n"
            "المبلغ يُقيَّد على حساب عهدة ولا يُحتسب مصروفًا الآن،\n"
            "وتتم تصفيته لاحقًا من شاشة «العُهد».")
        self.custody_give.toggled.connect(self._toggle_custody_give)
        party_row = QHBoxLayout()
        if vtype != "payment":
            party_row.addWidget(self.party_kind)
        party_row.addWidget(self.party, 1)
        party_row.addWidget(self.party_text, 1)

        self.amount = SafeDoubleSpinBox()
        self.amount.setRange(0, 1e9)
        self.amount.setDecimals(3)
        self.amount.setGroupSeparatorShown(True)
        self.description = QTextEdit()
        self.description.setPlaceholderText("بيان السند...")
        self.description.setFixedHeight(64)
        self.method = QComboBox()
        from services import settings_service as _ss
        _methods = [m["name"] for m in _ss.list_payment_methods()]
        if not _methods:
            _methods = ["نقدًا"]
        self._payment_methods = list(_methods)
        self.method.addItems(_methods)
        self.method.setCurrentIndex(-1)
        make_searchable(self.method, "")
        
        self.cheque_due = SafeDateEdit()
        self.cheque_due.setCalendarPopup(True)
        self.cheque_due.setDisplayFormat("dd-MM-yyyy")
        self.cheque_due.setDate(QDate.currentDate())
        self.cheque_due_lbl = QLabel("استحقاق الشيك")
        self.method.currentTextChanged.connect(self._toggle_cheque_due)
        # V3.25: بحث-فقط منذ الولادة (النقرة تفتح أعلى البنود) — بلا تبديل
        self.contract = SearchableComboBox(search_only=True,
                                          browse_on_empty=True)
        self.expense_customer = SearchableComboBox(search_only=True)
        self.project = SearchableComboBox(open_on_click=True)
        self._cash_accounts = ["البنك", "الصندوق"]
        self.transfer_from = QComboBox()
        self.transfer_to = QComboBox()
        self.transfer_from.addItems(self._cash_accounts)
        self.transfer_to.addItems(self._cash_accounts)
        self.transfer_from.setCurrentIndex(-1)
        self.transfer_to.setCurrentIndex(-1)
        make_searchable(self.transfer_from, "")
        make_searchable(self.transfer_to, "")
        self.transfer_accounts_host = QWidget()
        self.transfer_accounts_host.setObjectName("transparentHost")
        transfer_row = QHBoxLayout(self.transfer_accounts_host)
        transfer_row.setContentsMargins(0, 0, 0, 0)
        transfer_row.setSpacing(8)
        transfer_row.addWidget(QLabel("من حساب"))
        transfer_row.addWidget(self.transfer_from, 1)
        transfer_row.addWidget(QLabel("إلى حساب"))
        transfer_row.addWidget(self.transfer_to, 1)
        self.transfer_accounts_host.setVisible(False)
        self.transfer_from.currentTextChanged.connect(self._sync_transfer_fields)
        self.transfer_to.currentTextChanged.connect(self._sync_transfer_fields)
        self.notes = QLineEdit()
        self.notes.setPlaceholderText("تظهر هنا الملاحظة التلقائية للدفعة/المرحلة ويمكن تعديلها...")

        top_host = QWidget()
        top_host.setObjectName("transparentHost")
        top_row = QHBoxLayout(top_host)
        top_row.setContentsMargins(0, 0, 0, 0)
        top_row.setSpacing(8)
        top_row.addWidget(QLabel("رقم السند"))
        top_row.addWidget(self.number, 1)
        top_row.addWidget(QLabel(required_label("التاريخ")))
        top_row.addWidget(self.vdate, 1)
        form.addRow("بيانات السند", top_host)
        self.grouped_receipt_check = QCheckBox("سند مجمّع")
        self.grouped_receipt_check.setToolTip("سند قبض مجمّع يُنشئ أكثر من سند فردي، والعمولة البنكية تُقسم بالتساوي تلقائيًا")
        if is_receipt and not voucher:
            form.addRow("", self.grouped_receipt_check)
        else:
            self.grouped_receipt_check.setVisible(False)
        if vtype == "payment":
            self.expense_account_label = QLabel(required_label("حساب المصروف"))
            form.addRow(self.expense_account_label, self.expense_account)
            # تسليم العهدة يبقى في سند الصرف لأنه خروج نقدي فعلي.
            # التصفية والتقارير فقط داخل شاشة «العُهد».
            if not voucher:
                form.addRow("", self.custody_give)
            else:
                self.custody_give.setVisible(False)
        else:
            self.custody_give.setVisible(False)
        # V5.4: «عقد الباطن» — يظهر لطرف مقاول الباطن، ويُربط به السند
        # حتى تُسدَّد دفعات عقد الباطن فعليًا (كان الحقل لا يُمرَّر إطلاقًا).
        from ui.widgets import SearchableComboBox as _SCB4
        self.sub_contract = _SCB4(search_only=True)
        self.sub_contract.setToolTip(
            "عقد الباطن الذي يخصّه هذا السند — به تُسدَّد دفعات عقد الباطن "
            "وتظهر «مدفوعة» بدل «مستحقة».")
        self.sub_contract_lbl = QLabel("عقد الباطن")
        self.sub_contract.selection_changed.connect(
            lambda *_a: self._toggle_sub_contract_row())

        self.party_label = QLabel(required_label("المستفيد" if vtype == "payment" else "الدافع"))
        self.contract_label = QLabel(required_label("العقد") if is_receipt else "عقود الطرف")
        if is_receipt:
            self.grouped_panel = QWidget()
            self.grouped_panel.setObjectName("transparentHost")
            gp = QVBoxLayout(self.grouped_panel)
            gp.setContentsMargins(0, 0, 0, 0)
            gp.setSpacing(6)
            self.group_tabs = SegmentedTabs()
            self.group_tabs.addItem("عميل", "customer")
            self.group_tabs.addItem("مقاول باطن", "subcontractor")
            gp.addWidget(self.group_tabs)
            btn_row = QHBoxLayout()
            self.group_add_line_btn = QPushButton("＋ إضافة سطر")
            self.group_add_line_btn.setProperty("flat", True)
            btn_row.addWidget(self.group_add_line_btn)
            btn_row.addStretch()
            gp.addLayout(btn_row)
            from PySide6.QtWidgets import QStackedWidget as _QSW2
            self._group_stack = _QSW2()
            self._group_tables = {}
            _gspecs = {
                "customer": "العميل",
                "subcontractor": "مقاول الباطن",
            }
            for _gk, _ghead0 in _gspecs.items():
                _gt = QTableWidget(0, 5)
                _gt.setHorizontalHeaderLabels(
                    [_ghead0, "العقد", "المبلغ", "البيان", "حذف"])
                _gt.verticalHeader().setVisible(False)
                _gt.verticalHeader().setDefaultSectionSize(46)
                style.fit_table_height(_gt)
                _gh = _gt.horizontalHeader()
                _gh.setMinimumSectionSize(36)
                from ui.widgets import fit_table_with_floors as _ftwf
                _ftwf(_gt, [130, 120, 110, 180, 54],
                      [100, 100, 95, 120, 40], 3)
                hide_popups_on_scroll(_gt)
                _gt.setAlternatingRowColors(True)
                self._group_tables[_gk] = _gt
                self._group_stack.addWidget(_gt)
            gp.addWidget(self._group_stack)
            self.group_tabs.currentIndexChanged.connect(
                self._on_group_tab_changed)
            self.group_tabs.setCurrentData("customer")
            self.group_table = self._group_tables["customer"]
            self.group_total_lbl = QLabel("الإجمالي: 0.000 د.ك · عدد السندات: 0 · العمولة: 0.000 د.ك · نصيب السند: 0.000 د.ك")
            self.group_total_lbl.setStyleSheet(f"""
                font-weight: {Fonts.WEIGHT_BOLD};
                background: transparent; border: none;
                color: {Colors.TEXT};
            """)
            gp.addWidget(self.group_total_lbl)
        # V8.7.6: فقط لسندات القبض
        if is_receipt:
            self.grouped_panel.setVisible(False)
            form.addRow("توزيع السندات", self.grouped_panel)
        # بطاقة «الطرف والعقد»: النوع + الاسم + العقد متجاورة بدل
        # تشتتها في الشاشة · نفس الودجات تُنقل فقط — بلا أي تغيير منطقي.
        from PySide6.QtWidgets import QGroupBox as _QGB
        self.party_group = _QGB("الطرف والعقد")
        _gform = QFormLayout(self.party_group)
        _gform.setContentsMargins(10, 12, 10, 10)
        _gform.setSpacing(9)
        self._party_group_form = _gform
        if vtype == "payment":
            _gform.addRow("نوع الصرف", self.party_kind)
        _gform.addRow(self.party_label, party_row)
        if vtype == "payment":
            _gform.addRow("التحويل الداخلي", self.transfer_accounts_host)
        _gform.addRow(self.contract_label, self.contract)
        if vtype == "payment":   # V5.4: صف عقد الباطن لسند الصرف فقط
            _gform.addRow(self.sub_contract_lbl, self.sub_contract)
        if vtype == "payment":
            self.expense_customer_label = QLabel("العميل - اختياري")
            _gform.addRow(self.expense_customer_label, self.expense_customer)
            self.project_label = QLabel("المشروع")
            _gform.addRow(self.project_label, self.project)
        try:
            _ref = (self.grouped_receipt_check if is_receipt
                    else (self.custody_give if not voucher
                          else self.expense_account))
            _r, _ = form.getWidgetPosition(_ref)
            form.insertRow(_r + 1, self.party_group)
        except Exception:
            form.addRow(self.party_group)

        self.allocation = QComboBox()
        self.allocation.addItem("— دفعات العقد (بالترتيب) —", "")
        make_searchable(self.allocation, "")
        self.allocation_lbl = QLabel("سداد مقابل")
        form.addRow(self.allocation_lbl, self.allocation)
        form.addRow(QLabel(required_label("المبلغ")), self.amount)
        form.addRow("البيان", self.description)
        self.method_label = QLabel("طريقة الدفع")
        form.addRow(self.method_label, self.method)
        form.addRow(self.cheque_due_lbl, self.cheque_due)
        self.allocation.setVisible(False)
        self.allocation_lbl.setVisible(False)

        # ===== V6.2: ربط بدفعة مستحقة (قبض ← دفعات العميل · صرف ← المقاول) =====
        self._due_rows = []
        self._due_cancelled = []
        self._picked_line = None
        self._due_user_unchecked = False
        self.link_due = QCheckBox("ربط بدفعة مستحقة؟")
        self.link_due.setToolTip(
            "نعم: تُربط الوصل بدفعة من جدول الدفعات المستحقة، ويتحدّث البيان "
            "والحالة تلقائيًا.\n"
            "لا: يتحفظ كسند عادي (دفعة حرة / سلفة / مصروف) بلا أي تغيير في "
            "جداول الدفعات.")
        self.link_lbl = QLabel("ربط بدفعة مستحقة")
        self.due_host = QWidget()
        self.due_host.setObjectName("transparentHost")
        _dv = QVBoxLayout(self.due_host)
        _dv.setContentsMargins(0, 0, 0, 0)
        _dv.setSpacing(4)
        self.due_table = QTableWidget(0, 6)
        self.due_table.setHorizontalHeaderLabels(
            ["☑", "رقم الدفعة", "المرحلة / الدفعة", "المبلغ",
             "المسدَّد", "المتبقي"])
        self.due_table.verticalHeader().setVisible(False)
        self.due_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.due_table.setSelectionMode(QTableWidget.SingleSelection)
        self.due_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.due_table.setMaximumHeight(128)
        self.due_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.Stretch)
        self.due_table.itemChanged.connect(self._due_checkbox_changed)
        _dv.addWidget(self.due_table)
        self.due_info = QLabel("")
        self.due_info.setWordWrap(True)
        self.due_info.setStyleSheet(
            f"color:{Colors.TEXT_SECONDARY}; font-size:{Fonts.CAPTION}px; font-weight:{Fonts.WEIGHT_SEMIBOLD};")
        _dv.addWidget(self.due_info)
        form.addRow(self.link_lbl, self.link_due)
        form.addRow(self.due_host)
        self.link_due.toggled.connect(self._toggle_due_link)
        self.link_lbl.setVisible(False)
        self.link_due.setVisible(False)
        self.due_host.setVisible(False)
        if vtype == "receipt":
            self.contract.selection_changed.connect(self._reload_allocations)
            self.allocation.currentIndexChanged.connect(
                lambda _: self._auto_description())
            self.grouped_receipt_check.toggled.connect(self._toggle_grouped_receipt)
            self.group_add_line_btn.clicked.connect(lambda: self._add_group_row(False))
            self.method.currentTextChanged.connect(self._update_group_summary)
        # في سند القبض تبقى خانة الملاحظات الأصلية ظاهرة؛
        # فهي التي تُكتب فيها الملاحظة التلقائية للدفعة/المرحلة.
        # خانة البيان لم تعد تحمل كلمة «ملاحظات» حتى لا يظهر تكرار.
        if vtype == "receipt":
            form.addRow("ملاحظات", self.notes)
        else:
            self.notes.setVisible(False)
        self._toggle_cheque_due(self.method.currentText())

        from ui.widgets import shrinkable as _shrink
        from PySide6.QtWidgets import (QComboBox as _QCb, QAbstractSpinBox as _QSb, QDateEdit as _QDe)
        _shrink(*self.findChildren(_QCb), *self.findChildren(_QSb), *self.findChildren(_QDe))

        if is_receipt:
            self._pilot_receipt_sections()

        style.dialog_buttons(self, "حفظ السند", on_save=self._save, danger=not is_receipt)

        # V6.3: يفتح السند بحجم يكفي محتواه — كان سند الصرف يظهر ناقصًا
        # فيحتاج تكبيرًا يدويًا لرؤية «ربط بدفعة مستحقة؟» وبقية الخانات.
        QTimer.singleShot(0, self._fit_voucher_size)
        QTimer.singleShot(60, self._fit_voucher_size)

        self._preset_contract_id = preset_contract_id
        self._desc_auto = True
        self._notes_auto = True
        self.description.textChanged.connect(self._desc_manual_text)
        self.notes.textEdited.connect(lambda t: setattr(self, "_notes_auto", not bool((t or "").strip())))
        if vtype == "receipt":
            self.amount.valueChanged.connect(self._auto_description)
            self.contract.selection_changed.connect(self._auto_description)
        elif vtype == "payment":
            # V6.1: البيان التلقائي لسند الصرف — مثل سند القبض.
            self.amount.valueChanged.connect(self._auto_description)
            self.contract.selection_changed.connect(self._auto_description)
            self.sub_contract.selection_changed.connect(self._auto_description)
        self._reload_expense_customers()
        self._reload_projects()
        self._toggle_party_mode()
        if hasattr(self, "link_due"):
            self.contract.selection_changed.connect(
                lambda *_: self._reload_due())
            self.party.selection_changed.connect(lambda *_: self._reload_due())
            self.sub_contract.selection_changed.connect(
                lambda *_: self._reload_due())
            self.party_kind.currentIndexChanged.connect(
                lambda *_: self._reload_due())
        self._reload_parties(first_time=True)
        self.party.selection_changed.connect(self._reload_contracts)
        self.party.selection_changed.connect(
            lambda *_: self._reload_sub_contracts(keep=False))
        if hasattr(self, "expense_customer"):
            self.expense_customer.selection_changed.connect(self._reload_contracts)
        self._reload_contracts()
        if preset_contract_id:
            contract = contract_service.get_contract(preset_contract_id)
            if contract and vtype == "receipt":
                self.party_kind.setCurrentIndex(0)
                self._reload_parties()
                self.party.select_data(contract.customer_id)
                self._reload_contracts()
                self.contract.select_data(preset_contract_id)
            elif contract and self._preset_sub_id:
                # V5.4: سند على مقاول باطن من الزر الأيمن — يُربط بعقد العميل
                self.contract.select_data(preset_contract_id)
        if hasattr(self, "link_due") and not voucher:
            self._reload_due()
        # V5.4: الطرف «مقاول باطن» + عقد الباطن من الزر الأيمن
        if self._preset_sub_id:
            _idx = self.party_kind.findData("subcontractor")
            if _idx >= 0:
                self.party_kind.setCurrentIndex(_idx)
            self._reload_parties()
            self.party.select_data(int(self._preset_sub_id))
            self._reload_contracts()
            self._reload_sub_contracts(keep=False)
            if self._preset_sc_id:
                self.sub_contract.select_data(int(self._preset_sc_id))
                # عقد العميل الأب يُعبَّأ من عقد الباطن نفسه
                try:
                    if not self.contract.selected_data():
                        from services import lifecycle_service as _lc4b
                        _row = _lc4b.get_sub_contract(int(self._preset_sc_id))
                        _cid4 = int((dict(_row) if _row else {}).get("contract_id") or 0)
                        if _cid4:
                            self.contract.select_data(_cid4)
                except Exception:
                    pass
            self._toggle_sub_contract_row()

        if voucher:
            from PySide6.QtCore import QDate as _QD
            self.number.setText(voucher["voucher_number"])
            self.number.setReadOnly(True)
            d = _QD.fromString(voucher["vdate"], "yyyy-MM-dd")
            if d.isValid():
                self.vdate.setDate(d)
            ptype = voucher.get("party_type") or ""
            if ptype == "customer":
                kind_idx = 0
            elif ptype == "subcontractor":
                kind_idx = 1
            elif ptype == "partner":
                kind_idx = self.party_kind.findData("partner")
                self._reveal_partner_readonly(kind_idx)
            elif (ptype == "transfer" or voucher.get("vtype") == "transfer") and self.vtype == "payment" and self.party_kind.count() > 3:
                kind_idx = 3
            else:
                kind_idx = 2 if self.vtype == "payment" and self.party_kind.count() > 2 else 0
            self.party_kind.setCurrentIndex(kind_idx)
            self._reload_parties()
            if voucher.get("party_id"):
                self.party.select_data(voucher["party_id"])
            elif not ptype:
                self.party_text.setText(voucher.get("party") or "")
            self._reload_contracts()
            if voucher.get("contract_id"):
                self.contract.select_data(voucher["contract_id"])
            if self.vtype == "payment":
                # V5.9: القائمة تعرض اسم الحساب النهائي فقط — نطابق بالمعرّف
                # أولًا (expense_account_id/custody_account_id) ثم بالنص احتياطًا،
                # حتى تُفتح السندات القديمة بمساراتها الكاملة المحفوظة.
                _aid = (voucher.get("expense_account_id")
                        or voucher.get("custody_account_id"))
                _sel = False
                if _aid:
                    try:
                        _sel = bool(self.expense_account.select_data(_aid))
                    except Exception:
                        _sel = False
                if not _sel:
                    a_idx = self.expense_account.findText(
                        voucher.get("account") or "")
                    if a_idx >= 0:
                        self.expense_account.setCurrentIndex(a_idx)
                if not _sel and not (voucher.get("account") or "").strip():
                    self.expense_account.setCurrentIndex(-1)
                if voucher.get("expense_customer_id"):
                    self.expense_customer.select_data(voucher["expense_customer_id"])
                if voucher.get("project_id"):
                    self.project.select_data(voucher["project_id"])
            self.amount.setValue(float(voucher["amount"]))
            self.description.setPlainText(voucher.get("description") or "")
            m_idx = self.method.findText(voucher.get("method") or "")
            if m_idx >= 0:
                self.method.setCurrentIndex(m_idx)
            if voucher.get("vtype") == "transfer":
                self.transfer_from.setCurrentText(voucher.get("method") or "البنك")
                self.transfer_to.setCurrentText(voucher.get("account") or "الصندوق")
                self._transfer_auto_description = self.description.toPlainText().strip()
            # V5.4: عقد الباطن المحفوظ على السند
            self._reload_sub_contracts(keep=False)
            if voucher.get("sub_contract_id"):
                self.sub_contract.select_data(int(voucher["sub_contract_id"]))
            self._toggle_sub_contract_row()
            if hasattr(self, "link_due"):
                self._reload_due()
                self._restore_links()
            self.notes.setText(voucher.get("notes") or "")
            cheq = voucher.get("cheque_due_date") or ""
            if cheq:
                cd = _QD.fromString(cheq, "yyyy-MM-dd")
                if cd.isValid():
                    self.cheque_due.setDate(cd)
            self._toggle_cheque_due(self.method.currentText())


    def _pilot_receipt_sections(self):
        """أقسام لنسخة القبض فقط — تُستدعى للقبض حصرًا.

        صفر ارتفاع صافٍ (شرط test_v207_dynamic_sizing): عنوان موجود
        يُنسَّق كقسم + عنوان واحد مُدرج + دمج الفراغات للقبض فقط.
        """
        import re
        from PySide6.QtWidgets import QFormLayout, QLabel
        form = self.form
        form.setSpacing(8)
        self.description.setFixedHeight(64)
        for i in range(form.rowCount()):
            item = form.itemAt(i, QFormLayout.LabelRole)
            w = item.widget() if item is not None else None
            raw = w.text() if isinstance(w, QLabel) else ""
            plain = re.sub(r"<[^>]*>", "", raw).replace("*", "").strip()
            if plain == "توزيع السندات":
                # تنسيق فقط بلا تغيير نص (مجموعة الطرف لها عنوانها الخاص)
                w.setProperty("pilotSection", True)
            elif plain.startswith("المبلغ"):
                head = QLabel("المبلغ وطريقة الدفع")
                head.setProperty("pilotSection", True)
                form.insertRow(i, head)
                break


    def _fit_voucher_size(self):
        """V6.3: يوسّع نافذة السند تلقائيًا لقدر محتواها الحالي.

        سند الصرف كان يفتح صغيرًا فتختفي «ربط بدفعة مستحقة؟» والأزرار
        حتى يكبره المستخدم يدويًا — الآن يتسع وحده مع ظهور أي قسم.
        """
        try:
            from ui.style import refit_dialog as _refit
            _refit(self, max_h_ratio=0.94)
        except Exception:
            pass

    def _toggle_custody_give(self, checked: bool):
        """تبديل قائمة الحساب بين حسابات المصروف وحسابات العهد."""
        self._custody_mode = bool(checked)
        try:
            from services import expense_account_service as _ea
            items = (_ea.custody_items() if checked else _ea.posting_items())
        except Exception:
            items = []
        self._expense_accounts = [t for t, _ in items]
        self._expense_account_ids = [i for _, i in items]
        self.expense_account.set_items(list(items), auto_select=False)
        self.expense_account.setCurrentIndex(-1)
        try:
            self.expense_account.lineEdit().setText("")
        except Exception:
            pass
        self.expense_account_label.setText(
            required_label("حساب العهدة" if checked else "حساب المصروف"))
        try:
            self.expense_account.lineEdit().setPlaceholderText(
                "اختر حساب العهدة..." if checked
                else "ابحث في حسابات المصروفات...")
        except Exception:
            pass
        if checked and not items:
            style.info(
                self,
                "لا توجد حسابات عهد معرّفة.\n"
                "أضفها من: الإعدادات ← شجرة حسابات المصروف ← "
                "تحت «العهد» (نوع الحساب: عهدة).",
                "لا توجد حسابات عهد")
        if checked:
            # تسليم العهدة ليس صرفًا لعميل/مقاول/مشروع؛ هو عهدة لموظف فقط.
            # ثبّت النوع داخليًا على «مصروف عام/مورد» حتى يُقرأ اسم المستلم من حقل النص،
            # ثم أخفِ اختيار نوع الصرف والعميل والعقد والمشروع من الواجهة.
            for i in range(self.party_kind.count()):
                if self.party_kind.itemData(i) == "":
                    self.party_kind.blockSignals(True)
                    self.party_kind.setCurrentIndex(i)
                    self.party_kind.blockSignals(False)
                    break
            self.party_text.setPlaceholderText("اسم الموظف / المستلم...")
        else:
            self.party_text.setPlaceholderText("اسم المورد / جهة الصرف...")
        self._toggle_party_mode()
        if checked and not (self.description.toPlainText() or "").strip():
            from services.extras_service import apply_description_prefix
            self.description.blockSignals(True)
            self.description.setPlainText(apply_description_prefix(
                "custody", "تسليم عهدة"))
            self.description.blockSignals(False)

    def _reload_expense_accounts(self):
        try:
            from services import expense_account_service as _ea
            items = (_ea.custody_items() if getattr(self, "_custody_mode", False)
                     else _ea.posting_items())
        except Exception:
            items = []
        if not items:
            items = [("مصروفات تشغيلية / بنزين / وقود", None),
                     ("مصروفات إدارية / سلف موظفين / قرض راتب", None),
                     ("مصروف / تكلفة المشروع", None)]
        self._expense_accounts = [t for t, _ in items]
        self._expense_account_ids = [i for _, i in items]

    def _selected_expense_account_id(self):
        try:
            data = self.expense_account.selected_data()
            if data is not None:
                return data
        except Exception:
            pass
        idx = self.expense_account.currentIndex()
        if 0 <= idx < len(getattr(self, "_expense_account_ids", [])):
            return self._expense_account_ids[idx]
        return None

    def _reload_allocations(self):
        self.allocation.blockSignals(True)
        self.allocation.clear()
        self.allocation.addItem("— دفعات العقد (بالترتيب) —", "")
        contract_id = self.contract.selected_data()
        opts = []
        if contract_id:
            try:
                from services.extras_service import allocation_options
                opts = [o for o in allocation_options(contract_id) if o["remaining"] > 0.001]
            except Exception:
                opts = []
        for o in opts:
            self.allocation.addItem(f"{o['label']} · متبقٍ {o['remaining']:,.3f}", o["number"])
        show = bool(opts)
        self.allocation.setVisible(show)
        self.allocation_lbl.setVisible(show)
        self.allocation.blockSignals(False)
        if self.vtype == "receipt":
            self._auto_description()

    # ================= V6.2: ربط بدفعة مستحقة =================
    def _link_kind(self) -> str:
        """نوع الربط بحسب السند والطرف (فراغ ⇒ لا رابط لهذا السند)."""
        try:
            if self.vtype == "receipt":
                if (self.party_kind.currentData() == "customer"
                        and self.contract.selected_data()):
                    return "receipt"
            elif self.vtype == "payment":
                if (self.party_kind.currentData() == "subcontractor"
                        and self._selected_sub_contract_id()):
                    return "payment"
        except Exception:
            return ""
        return ""

    def _reload_due(self):
        """يعبّئ جدول الدفعات المستحقة من المصدر الصحيح (عميل/مقاول)."""
        if not hasattr(self, "due_table"):
            return
        kind = self._link_kind()
        rows = []
        cancelled_rows = []   # V9.15.18: خطوط عقد الباطن الملغى — عرض فقط
        if kind:
            try:
                from services import voucher_payment_link_service as vpl
                _ex = (int(self.voucher["id"])
                       if getattr(self, "voucher", None) else None)
                if kind == "receipt":
                    rows = vpl.due_lines(
                        "receipt",
                        contract_id=self.contract.selected_data(),
                        exclude_voucher_id=_ex)
                else:
                    _sid = self._selected_sub_contract_id()
                    rows = vpl.due_lines(
                        "payment",
                        sub_contract_id=_sid,
                        exclude_voucher_id=_ex)
                    if _sid:
                        cancelled_rows = [
                            r for r in vpl.plan_rows(
                                "payment", sub_contract_id=_sid,
                                exclude_voucher_id=_ex)
                            if r.get("cancelled")]
            except Exception:
                rows = []
                cancelled_rows = []
        self._due_rows = rows
        self._due_cancelled = cancelled_rows
        self.due_table.blockSignals(True)
        self.due_table.setRowCount(0)
        for r in rows + cancelled_rows:
            i = self.due_table.rowCount()
            self.due_table.insertRow(i)
            # عمود الـ checkbox (العمود 0)
            chk = QTableWidgetItem()
            if r.get("gated") or r.get("cancelled"):
                chk.setFlags(Qt.ItemIsEnabled)  # V9.15.17: الموقوفة لا تُحدَّد · V9.15.18: الملغاة كذلك
            else:
                chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            chk.setCheckState(Qt.Unchecked)
            self.due_table.setItem(i, 0, chk)
            # باقي الأعمدة (1-5)
            cells = [str(r["number"]),
                     (r["stage"] or r["title"]) + (" — ملغى" if r.get("cancelled") else ""),
                     f"{r['amount']:,.3f}", f"{r['paid']:,.3f}",
                     f"{r['remaining']:,.3f}"]
            for c, txt in enumerate(cells):
                it = QTableWidgetItem(txt)
                if c >= 2:
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if r.get("cancelled"):
                    it.setForeground(Qt.gray)
                    it.setToolTip("عقد الباطن ملغى: لا يمكن الصرف على هذه الدفعة")
                elif r.get("gated"):
                    it.setForeground(Qt.gray)
                    it.setToolTip(r.get("gate_reason") or "")
                self.due_table.setItem(i, c + 1, it)
        self.due_table.blockSignals(False)
        show = bool(kind)
        self.link_lbl.setVisible(show)
        self.link_due.setVisible(show)
        # V6.3: ظهور قسم «ربط بدفعة مستحقة؟» يوسّع النافذة تلقائيًا.
        QTimer.singleShot(0, self._fit_voucher_size)
        if not show:
            self.link_due.blockSignals(True)
            self.link_due.setChecked(False)
            self.link_due.blockSignals(False)
            self.due_host.setVisible(False)
            self._picked_line = None
            self.due_info.setText("")
            return
        if not self.link_due.isChecked() and not self._due_user_unchecked:
            # الافتراضي: «نعم» لو في دفعات مستحقة، و«لا» لو مفيش
            self.link_due.blockSignals(True)
            self.link_due.setChecked(bool(rows))
            self.link_due.blockSignals(False)
        if self.link_due.isChecked() and rows:
            self.due_host.setVisible(True)
            self.due_table.setVisible(True)
            if self._picked_line is None:
                # V6.4: الاختيار يدوي — بلا تحديد تلقائي لأي دفعة
                self.due_info.setText(self._due_pick_hint())
        elif self.link_due.isChecked() and not rows and cancelled_rows:
            self.due_host.setVisible(True)
            self.due_table.setVisible(True)
            self._picked_line = None
            self.due_info.setText(
                "عقد الباطن ملغى: خطوطه معروضة بحالة «ملغى» ولا يمكن الصرف عليها.")
        elif self.link_due.isChecked() and not rows:
            # V6.3: نُظهر السبب صراحةً — كل الدفعات بانتظار مرحلة أو مسدّدة.
            self.due_host.setVisible(True)
            self.due_table.setVisible(False)
            self._picked_line = None
            self.due_info.setText(
                "لا توجد دفعات مستحقة للربط الآن — الدفعات إما بانتظار "
                "انتهاء مرحلتها أو مسدّدة. اجعل الخانة «لا» ليُحفظ السند "
                "عاديًا بلا ربط.")
        else:
            self.due_host.setVisible(False)
            self._picked_line = None
            self.due_info.setText("" if rows else
                                  "لا دفعات مستحقة حاليًا — سيُحفظ السند "
                                  "عاديًا بلا ربط.")
        # V6.3: توسيع تلقائي بعد أي تغيير في قسم الربط.
        QTimer.singleShot(0, self._fit_voucher_size)

    def _select_due_row(self, idx: int):
        """V6.4: اختيار صف دفعة في جدول المستحقة بشكل مضمون.

        QTableWidget.selectRow قد لا تُحدث أي تحديد في بعض تركيبات
        Qt/الأنظمة (رصدناه فعليًا) — لذا نحدد الصف عبر نموذج التحديد
        مباشرة ثم نستدعي _due_picked.
        """
        rows = self._due_rows or []
        if not (0 <= idx < len(rows)):
            return
        from PySide6.QtCore import QItemSelectionModel as _QISM
        self.due_table.blockSignals(True)
        self.due_table.clearSelection()
        self.due_table.setCurrentCell(idx, 0)
        try:
            sm = self.due_table.selectionModel()
            sm.select(self.due_table.model().index(idx, 0),
                      _QISM.ClearAndSelect | _QISM.Rows)
        except Exception:
            pass
        self.due_table.blockSignals(False)
        self._due_picked()

    @staticmethod
    def _due_pick_hint() -> str:
        """V6.4: الاختيار يدوي — نص إرشادي حتى يختار المستخدم بنفسه."""
        return ("حدّد الدفعات المستحقة بخانة الاختيار في الجدول بالأسفل، "
                "بالترتيب من الأقدم — يُعبَّأ البيان والمبلغ تلقائيًا، "
                "والمبلغ يُوزَّع على الدفعات المحددة ويبقى قابلًا للتعديل. "
                "أو اجعل الخانة «لا» ليُحفظ السند عاديًا.")

    def _due_picked(self):
        """不再使用 — تم استبداله بالـ checkbox."""
        pass

    def _checked_due_rows(self) -> list:
        """الدفعات المحددة بالـ checkbox — بترتيب الجدول (= ترتيب الخطة)."""
        if not hasattr(self, "due_table"):
            return []
        out = []
        for i, r in enumerate(self._due_rows or []):
            it = self.due_table.item(i, 0)
            if it is not None and it.checkState() == Qt.Checked:
                out.append(r)
        return out

    def _set_due_check(self, i: int, state):
        it = self.due_table.item(i, 0)
        if it is None:
            return
        self.due_table.blockSignals(True)
        it.setCheckState(state)
        self.due_table.blockSignals(False)

    def _clear_due_checks(self):
        if not hasattr(self, "due_table"):
            return
        self.due_table.blockSignals(True)
        for i in range(self.due_table.rowCount()):
            it = self.due_table.item(i, 0)
            if it is not None:
                it.setCheckState(Qt.Unchecked)
        self.due_table.blockSignals(False)
        self._picked_line = None

    def _update_due_info(self, sel: list):
        if not sel:
            self.due_info.setText(self._due_pick_hint())
            return
        parts = [f"رقم {x['number']} ({x['stage'] or x['title']}) "
                 f"· المتبقي {x['remaining']:,.3f}" for x in sel]
        total = sum(float(x["remaining"]) for x in sel)
        self.due_info.setText(
            "المحدد: " + " · ".join(parts)
            + f" — المجموع المتبقي {total:,.3f} د.ك. "
            "المبلغ يُوزَّع عليها تلقائيًا بالترتيب.")

    def _due_checkbox_changed(self, item):
        """V9.15.17: تحديد أكثر من دفعة — بالترتيب فقط (قاعدة التتابع)."""
        if item.column() != 0:
            return
        rows = self._due_rows or []
        i = item.row()
        if not (0 <= i < len(rows)):
            return
        from services import voucher_payment_link_service as vpl
        if item.checkState() == Qt.Checked:
            ids = [int(x["line_id"]) for x in self._checked_due_rows()]
            err = vpl.check_selection(rows, ids)
            if err:
                self._set_due_check(i, Qt.Unchecked)
                self.due_info.setText("⛔ " + err)
                return
        else:
            # إلغاء دفعة يُلغي ما بعدها، حتى يبقى التحديد متتاليًا
            self.due_table.blockSignals(True)
            for j in range(i + 1, self.due_table.rowCount()):
                it2 = self.due_table.item(j, 0)
                if it2 is not None:
                    it2.setCheckState(Qt.Unchecked)
            self.due_table.blockSignals(False)
        sel = self._checked_due_rows()
        self._picked_line = sel[0] if sel else None
        self._update_due_info(sel)
        if sel and not self.voucher:
            self.amount.setValue(sum(float(x["remaining"]) for x in sel))
            self._desc_auto = True
            self._auto_description()

    def _toggle_due_link(self, checked: bool):
        rows = self._due_rows or []
        if not checked:
            self._due_user_unchecked = True
            self.due_host.setVisible(False)
            self._clear_due_checks()
            self.due_info.setText("")
            QTimer.singleShot(0, self._fit_voucher_size)
            return
        self._due_user_unchecked = False
        # V6.4: لا تحديد تلقائي لأي دفعة — الاختيار يدوي من الجدول
        # (وُحّد أسلوب سند القبض وسند الصرف على أسلوب الصرف اليدوي).
        if not rows and not getattr(self, "_due_cancelled", []):
            # V6.3: خانة «نعم» بلا دفعة قابلة للربط — نوضّح السبب فورًا.
            self.due_host.setVisible(True)
            self.due_table.setVisible(False)
            self._picked_line = None
            self.due_info.setText(
                "لا توجد دفعات مستحقة للربط الآن — الدفعات إما بانتظار "
                "انتهاء مرحلتها أو مسدّدة. اجعل الخانة «لا» ليُحفظ السند "
                "عاديًا بلا ربط، أو اختر الدفعة بعد اكتمال مرحلتها.")
            QTimer.singleShot(0, self._fit_voucher_size)
            return
        self.due_host.setVisible(True)
        self.due_table.setVisible(True)
        if not rows:
            self._picked_line = None
            self.due_info.setText(
                "عقد الباطن ملغى: خطوطه معروضة بحالة «ملغى» ولا يمكن الصرف عليها.")
        elif self._picked_line is None:
            self.due_info.setText(self._due_pick_hint())
        QTimer.singleShot(0, self._fit_voucher_size)

    def _next_due_after(self, line):
        rows = self._due_rows or []
        try:
            pos = next(i for i, r in enumerate(rows)
                       if int(r["line_id"]) == int(line["line_id"]))
        except StopIteration:
            return None
        for r in rows[pos + 1:]:
            if not r.get("gated"):
                return r
        return None

    def _build_payment_link(self):
        """اختيار الدفعة للربط (أو None) — مع فرض قرار الزيادة إلزاميًا."""
        if not hasattr(self, "link_due") or self.link_due.isHidden():
            return None
        if not self.link_due.isChecked():
            return None
        rows = self._due_rows or []
        if not rows:
            # V6.3: خانة «نعم» بلا أي دفعة قابلة للربط — لا نحفظ بصمت
            # (كان السند يُحفظ بلا ربط فيُغطّي الخطة بالترتيب فيختلّ الجدول).
            try:
                from services.customer_service import ValidationError as _VE
            except Exception:
                _VE = Exception
            raise _VE(
                "الخانة «ربط بدفعة مستحقة؟» مفعّلة لكن لا توجد دفعات مستحقة "
                "للربط الآن (الدفعات إما بانتظار انتهاء مرحلتها أو مسدّدة).\n"
                "اجعل الخانة «لا» ليُحفظ السند عاديًا بلا ربط.")
        sel_rows = self._checked_due_rows()
        if not sel_rows:
            raise ValidationError(
                "اختر دفعة مستحقة من الجدول للربط (أو اجعل الخانة «لا» "
                "ليتحفظ السند عاديًا).")
        from services import voucher_payment_link_service as vpl
        sel = [int(x["line_id"]) for x in sel_rows]
        err = vpl.check_selection(rows, sel)
        if err:
            raise ValidationError(err)
        kind = self._link_kind() or "payment"
        amt = float(self.amount.value())
        sum_rem = sum(float(x["remaining"]) for x in sel_rows)
        spread = True
        if amt > sum_rem + 0.0005:
            nxt = self._next_due_after(sel_rows[-1])
            choice = _ask_extra_handling(self, amt - sum_rem,
                                         nxt["title"] if nxt else "")
            if choice == "spread":
                spread = True
            elif choice == "advance":
                spread = False
            else:
                raise ValidationError(
                    "المبلغ أكبر من متبقي الدفعات المحددة — اختر إما «توزيع "
                    "الباقي على الدفعة التالية» أو «تسجيله رصيد/سلفة»، ولا "
                    "يتحفظ السند بدون اختيار.")
        d = vpl.distribute(
            rows, sel, amt, kind=kind,
            exclude_voucher_id=(int(self.voucher["id"])
                                if self.voucher else None),
            spread=spread)
        if d.get("error"):
            raise ValidationError(d["error"])
        selections = [(int(a["line_id"]), float(a["amount"]))
                      for a in d["allocs"]]
        if d.get("advance", 0) > 0.0005 and selections:
            # الزيادة فوق الخطة تُسجَّل رصيدًا على السند (apply_links)
            lid, amt_l = selections[-1]
            selections[-1] = (lid, amt_l + float(d["advance"]))
        return {"selections": selections, "spread": spread, "amount": amt}

    def _restore_links(self):
        """يسترجع ربط سند محفوظ عند فتحه للتعديل (كل الدفعات المربوطة)."""
        if not self.voucher:
            return
        try:
            from services import voucher_payment_link_service as vpl
            links = vpl.voucher_links(int(self.voucher["id"]))
        except Exception:
            links = []
        if not links:
            return
        ids = {int(l["line_id"]) for l in links}
        idxs = [i for i, r in enumerate(self._due_rows or [])
                if int(r["line_id"]) in ids]
        if not idxs:
            return
        self._due_user_unchecked = False
        self.link_due.blockSignals(True)
        self.link_due.setChecked(True)
        self.link_due.blockSignals(False)
        self.due_host.setVisible(True)
        self.due_table.blockSignals(True)
        for i in idxs:
            it = self.due_table.item(i, 0)
            if it is not None:
                it.setCheckState(Qt.Checked)
        self.due_table.blockSignals(False)
        sel = self._checked_due_rows()
        self._picked_line = sel[0] if sel else None
        self._update_due_info(sel)

    def _contract_number(self, cid) -> str:
        try:
            from database.database import get_connection
            with get_connection() as conn:
                r = conn.execute("SELECT contract_number FROM contracts "
                                 "WHERE id=?", (int(cid),)).fetchone()
            return (r["contract_number"] if r else "") or ""
        except Exception:
            return ""

    def _contract_name(self, cid) -> str:
        """اسم العقد (description أو contract_name)."""
        try:
            from database.database import get_connection
            with get_connection() as conn:
                r = conn.execute(
                    "SELECT COALESCE(NULLIF(contract_name,''), description,'') AS n "
                    "FROM contracts WHERE id=?", (int(cid),)).fetchone()
            return (r["n"] if r else "") or ""
        except Exception:
            return ""

    def _desc_manual_text(self):
        self._desc_manual(self.description.toPlainText())

    def _desc_manual(self, text):
        cur = (text or "").strip()
        if cur and cur != getattr(self, "_last_auto_description", ""):
            self._desc_auto = False
        else:
            self._desc_auto = True
            self._auto_description()

    def _auto_description(self):
        current_desc = self.description.toPlainText().strip()
        last_auto = getattr(self, "_last_auto_description", "")
        if not getattr(self, "_desc_auto", True):
            if current_desc and current_desc != last_auto:
                return
            self._desc_auto = True
        if self.voucher:
            return
        # V6.2: عند الربط بدفعة مستحقة يتقدّم البيان الموحّد للسندين
        _linking = (hasattr(self, "link_due") and not self.link_due.isHidden()
                    and self.link_due.isChecked())
        _sel = self._checked_due_rows() if _linking else []
        if _sel:
            _kind = self._link_kind()
            if _kind:
                try:
                    from services import voucher_payment_link_service as vpl
                    _amt = float(self.amount.value())
                    _d = vpl.distribute(
                        self._due_rows,
                        [int(x["line_id"]) for x in _sel], _amt,
                        kind=_kind,
                        exclude_voucher_id=(int(self.voucher["id"])
                                            if self.voucher else None),
                        spread=True)
                    if not _d.get("error") and _d.get("allocs"):
                        _cid = self.contract.selected_data()
                        if _kind == "payment":
                            _scid = self._selected_sub_contract_id()
                            _sc = lc.get_sub_contract(_scid) if _scid else None
                            _cid = (dict(_sc).get("contract_id")
                                    if _sc else _cid)
                        _txt = vpl.describe_items(
                            _d["allocs"], _d.get("advance", 0.0),
                            vpl.contract_display_name(_cid))
                        self._apply_auto_description(_txt)
                        _stages = [(x.get("stage") or "").strip()
                                   for x in _sel]
                        self._apply_stage_note({
                            "line_id": int(_sel[0]["line_id"]),
                            "stage": " + ".join(
                                dict.fromkeys(t for t in _stages if t))})
                        return
                except Exception:
                    pass
        contract_id = self.contract.selected_data()
        amount = self.amount.value()
        if amount <= 0:
            return
        sub_id = None
        if self.vtype == "payment" and hasattr(self, "sub_contract"):
            try:
                if not self.sub_contract.isHidden():
                    sub_id = self.sub_contract.selected_data()
            except Exception:
                sub_id = None
        if not contract_id and not sub_id:
            return
        try:
            if self.vtype == "payment":
                from services.extras_service import smart_payment_description
                text = smart_payment_description(
                    contract_id=contract_id, sub_contract_id=sub_id,
                    amount=amount)
                note_text = ""
                return self._apply_auto_description(text)
            alloc = self.allocation.currentData() if hasattr(self, "allocation") else ""
            if alloc:
                from services.extras_service import allocated_description
                text = allocated_description(contract_id, amount, alloc)
            else:
                from services.extras_service import (
                    smart_receipt_description, smart_receipt_stage_note)
                text = smart_receipt_description(contract_id, amount)
                note_text = smart_receipt_stage_note(contract_id, amount)
                if note_text and getattr(self, "_notes_auto", True):
                    self.notes.blockSignals(True)
                    self.notes.setText(note_text)
                    self.notes.blockSignals(False)
        except Exception:
            return
        self._apply_auto_description(text)

    def _apply_stage_note(self, line):
        """V6.3: «مرحلة العمل» تتبع الدفعة المختارة — تُحدَّث مع تغييرها.

        لا تُدهس ملاحظة المستخدم اليدوية إلا عندما تتغيّر الدفعة نفسها.
        """
        if not hasattr(self, "notes"):
            return
        try:
            from services.extras_service import apply_description_prefix
        except Exception:
            return
        try:
            lid = int((line or {}).get("line_id") or 0)
        except Exception:
            lid = 0
        cur = (self.notes.text() or "").strip()
        last = getattr(self, "_last_auto_note", "")
        changed = lid and lid != getattr(self, "_note_line_id", 0)
        if (cur and cur != last and not getattr(self, "_notes_auto", True)
                and not changed):
            return
        stage = ((line or {}).get("stage") or "").strip()
        txt = (apply_description_prefix("stage_note", f"مرحلة العمل: {stage}")
               if stage else "")
        self.notes.blockSignals(True)
        self.notes.setText(txt)
        self.notes.blockSignals(False)
        self._last_auto_note = txt
        self._note_line_id = lid
        self._notes_auto = True

    def _apply_auto_description(self, text: str):
        """كتابة البيان التلقائي بلا إزعاج تعديل المستخدم (V6.1)."""
        if not text:
            return
        self.description.blockSignals(True)
        self.description.setPlainText(text)
        self.description.blockSignals(False)
        self._last_auto_description = text
        self._desc_auto = True

    def _sync_transfer_fields(self, *_):
        """مزامنة بيان التحويل مع حساب (من/إلى) تلقائيًا."""
        if not (self.vtype == "payment" and self.party_kind.currentData() == "transfer"):
            return
        src = self.transfer_from.currentText() or "البنك"
        dst = self.transfer_to.currentText() or "الصندوق"
        self.method.setCurrentText(src)
        self.expense_account.setCurrentText(dst)
        auto_text = getattr(self, "_transfer_auto_description", "")
        from services.extras_service import apply_description_prefix
        new_text = apply_description_prefix(
            "transfer", f"تحويل داخلي من {src} إلى {dst}")
        cur = self.description.toPlainText().strip()
        if not cur or cur == auto_text:
            self.description.blockSignals(True)
            self.description.setPlainText(new_text)
            self.description.blockSignals(False)
            self._transfer_auto_description = new_text

    def _toggle_cheque_due(self, method_text: str):
        is_cheque = "شيك" in (method_text or "")
        self.cheque_due.setVisible(is_cheque)
        self.cheque_due_lbl.setVisible(is_cheque)

    def _set_form_row_visible(self, widget, visible: bool) -> None:
        """إخفاء صف كامل في QFormLayout عند توفر API، مع fallback للعنصر نفسه."""
        for _f in (self.form, getattr(self, "_party_group_form", None)):
            if _f is None:
                continue
            try:
                _r, _ = _f.getWidgetPosition(widget)
            except Exception:
                continue
            if _r < 0:
                continue  # ليس في هذا التخطيط — بلا تحذيرات كونسول
            try:
                _f.setRowVisible(widget, bool(visible))
            except Exception:
                pass
        try:
            widget.setVisible(bool(visible))
        except Exception:
            pass

    def _grow(self, dh: int = 0):
        """تكبير/تصغير النافذة بمقدار تغيّر المحتوى — بعد الظهور فقط."""
        try:
            if self.isVisible():
                style.grow_dialog(self, dh)
        except Exception:
            pass

    def _gate_partner_button(self):
        """V4.40: زر الشريك (جارٍ) للمدير فقط."""
        try:
            from services import auth_service as _auth
            _admin = _auth.is_admin()
        except Exception:
            _admin = True
        if _admin:
            return
        idx = self.party_kind.findData("partner")
        if 0 <= idx < len(self.party_kind._buttons):
            self.party_kind._buttons[idx].setVisible(False)

    def _reveal_partner_readonly(self, idx: int):
        """سكرتير يفتح سند شريك موجودًا: عرض معطّل (الحفظ مرفوض خدميًا)."""
        try:
            from services import auth_service as _auth
            _admin = _auth.is_admin()
        except Exception:
            _admin = True
        if _admin or not (0 <= idx < len(self.party_kind._buttons)):
            return
        btn = self.party_kind._buttons[idx]
        btn.setVisible(True)
        btn.setEnabled(False)

    def _toggle_party_mode(self):
        _h0 = style.body_hint(self)
        kind = self.party_kind.currentData()
        is_custody = (self.vtype == "payment" and getattr(self, "_custody_mode", False))
        is_transfer = (self.vtype == "payment" and kind == "transfer" and not is_custody)
        is_general_expense = (self.vtype == "payment" and not kind and not is_custody)
        is_partner = (kind == "partner" and not is_custody)
        self.party.setVisible(not is_general_expense and not is_transfer and not is_custody and not is_partner)
        self.party_text.setVisible(is_general_expense or is_custody)
        if hasattr(self, "party_label"):
            self.party_label.setText(required_label("المستلم / الموظف") if is_custody
                                     else ("الشريك (جارٍ)" if is_partner
                                           else required_label("المستفيد" if self.vtype == "payment" else "الدافع")))
        if hasattr(self, "contract"):
            self.contract.setVisible(not is_transfer and not is_custody and not is_partner)
            self.contract.setEnabled(True)
            if hasattr(self, "contract_label"):
                self.contract_label.setVisible(not is_transfer and not is_custody and not is_partner)
                self._set_form_row_visible(self.contract_label, not is_transfer and not is_custody and not is_partner)
                self.contract_label.setText("العقد/المشروع - اختياري" if is_general_expense else (required_label("العقد") if self.vtype == "receipt" else "عقود الطرف"))
            self.contract.lineEdit().setPlaceholderText("اختر العقد/المشروع (اختياري)..." if is_general_expense else ("اختر العقد المرتبط بالسند..." if self.vtype == "receipt" else "اربط السند بعقد (اختياري)..."))
        if hasattr(self, "project"):
            self.project.setVisible(False)
            if hasattr(self, "project_label"):
                self.project_label.setVisible(False)
                self._set_form_row_visible(self.project_label, False)
        if hasattr(self, "expense_customer"):
            self.expense_customer.setVisible(is_general_expense and not is_custody)
            if hasattr(self, "expense_customer_label"):
                self.expense_customer_label.setVisible(is_general_expense and not is_custody)
                self._set_form_row_visible(self.expense_customer_label, is_general_expense and not is_custody)
        if self.vtype == "payment":
            self._set_form_row_visible(self.party_kind, not is_custody)
            if hasattr(self, "transfer_accounts_host"):
                self.transfer_accounts_host.setVisible(is_transfer)
                self._set_form_row_visible(self.transfer_accounts_host, is_transfer)
            self.method.setVisible(not is_transfer)
            self.method_label.setVisible(not is_transfer)
            self.expense_account.setVisible(not is_transfer and not is_partner)
            self.expense_account_label.setVisible(not is_transfer and not is_partner)
            if is_transfer:
                self.method.blockSignals(True); self.expense_account.blockSignals(True)
                self.method.clear(); self.method.addItems(self._cash_accounts)
                self.method.setCurrentIndex(-1)
                self.expense_account.set_items([(x, None) for x in self._cash_accounts], auto_select=False)
                self.method.blockSignals(False); self.expense_account.blockSignals(False)
                if not self.voucher:
                    self.number.setText(lc.next_voucher_number("transfer", _consume=False))
                self.description.setPlaceholderText("يتغير تلقائيًا حسب من حساب / إلى حساب")
                self._sync_transfer_fields()
                self.cheque_due.setVisible(False); self.cheque_due_lbl.setVisible(False)
            else:
                current_method = self.method.currentText()
                current_acc = self.expense_account.currentText()
                self._reload_expense_accounts()
                self.method.blockSignals(True); self.expense_account.blockSignals(True)
                self.method.clear(); self.method.addItems(self._payment_methods)
                self.expense_account.set_items(list(zip(self._expense_accounts, self._expense_account_ids)), auto_select=False)
                if current_method in self._payment_methods:
                    self.method.setCurrentText(current_method)
                else:
                    self.method.setCurrentIndex(-1)
                if current_acc in self._expense_accounts:
                    self.expense_account.setCurrentText(current_acc)
                self.method.blockSignals(False); self.expense_account.blockSignals(False)
                if not self.voucher:
                    self.number.setText(lc.next_voucher_number("payment", _consume=False))
                self.method_label.setText("طريقة الدفع")
                self.expense_account_label.setText(required_label("حساب العهدة") if is_custody else "حساب المصروف")
                self.description.setPlaceholderText("بيان تسليم العهدة..." if is_custody else "بيان السند...")
                self._toggle_cheque_due(self.method.currentText())
        if self.vtype == "receipt" and not self.voucher and hasattr(
                self, "grouped_receipt_check"):
            # القبض الجديد فقط: في الصرف/التعديل لا صف له (نافذة وامضة).
            self._set_form_row_visible(self.grouped_receipt_check,
                                       not is_partner)
        if is_partner and not self.description.toPlainText().strip():
            self.description.setPlainText(
                "مسحوبات للشريك" if self.vtype == "payment" else "تمويل من الشريك")
        self._grow(style.body_hint(self) - _h0)

    def _reload_expense_customers(self):
        if self.vtype != "payment":
            return
        try:
            from ui.widgets import customer_items
            self.expense_customer.set_items([("— بدون عميل —", None)] + customer_items(), auto_select=False)
        except Exception:
            self.expense_customer.set_items([("— بدون عميل —", None)], auto_select=False)

    def _reload_projects(self):
        if self.vtype != "payment":
            return
        try:
            from ui.widgets import project_items
            self.project.set_items([("— بدون مشروع —", None)] + project_items(), auto_select=False)
        except Exception:
            self.project.set_items([("— بدون مشروع —", None)], auto_select=False)

    def _sub_contract_items(self) -> list[tuple]:
        """عقود الباطن للمقاول المحدد — (نص العرض، معرّف عقد الباطن)."""
        items: list[tuple] = [("— بدون عقد باطن —", None)]
        try:
            party_id = self.party.selected_data()
        except Exception:
            party_id = None
        if not party_id:
            return items
        try:
            from services import lifecycle_service as _lc4
            for sc in _lc4.list_sub_contracts():
                if int(sc.get("subcontractor_id") or 0) != int(party_id):
                    continue
                # V6.1: اسم العقد (وصفه) أولًا — لا رقم ومبلغ فقط.
                _desc = (sc.get("description") or "").strip() or "عقد باطن"
                _st = (sc.get("status") or "").strip()
                txt = (f"{_desc} · {sc.get('contract_number') or ''}"
                       + (f" · {_st}" if _st and _st != "نشط" else ""))
                items.append((txt, int(sc["id"])))
        except Exception:
            pass
        return items

    def _reload_sub_contracts(self, keep: bool = True):
        """تعبئة قائمة عقود الباطن — واختيار الأوحد تلقائيًا."""
        if not hasattr(self, "sub_contract"):
            return
        cur = None
        if keep:
            try:
                cur = self.sub_contract.selected_data()
            except Exception:
                cur = None
        items = self._sub_contract_items()
        self.sub_contract.blockSignals(True)
        self.sub_contract.set_items(items, auto_select=False)
        self.sub_contract.blockSignals(False)
        real = [v for _t, v in items if v is not None]
        if cur is not None and int(cur) in [int(x) for x in real]:
            self.sub_contract.select_data(cur)
        elif len(real) == 1:
            self.sub_contract.select_data(real[0])
        self._toggle_sub_contract_row()

    def _toggle_sub_contract_row(self):
        """يظهر صف عقد الباطن لطرف المقاول في سند الصرف فقط."""
        if not hasattr(self, "sub_contract"):
            return
        try:
            is_sub = (self.party_kind.currentData() == "subcontractor")
        except Exception:
            is_sub = False
        show = bool(is_sub and self.vtype == "payment")
        try:
            self.sub_contract.setVisible(show)
            self.sub_contract_lbl.setVisible(show)
        except Exception:
            pass

    def _selected_sub_contract_id(self):
        """عقد الباطن المختار — أو الوحيد تلقائيًا."""
        try:
            val = self.sub_contract.selected_data()
            if val:
                return int(val)
            real = [v for _t, v in self._sub_contract_items() if v is not None]
            return int(real[0]) if len(real) == 1 else None
        except Exception:
            return None

    def _reload_parties(self, first_time: bool = False):
        kind = self.party_kind.currentData()
        from ui.widgets import customer_items, subcontractor_items
        if kind == "customer":
            items = customer_items()
        elif kind == "subcontractor":
            items = subcontractor_items()
        else:
            items = []
        self.party.set_items(items, auto_select=False)

    def _available_contract_ids(self) -> list[int]:
        ids = []
        try:
            for i in range(self.contract.count()):
                val = self.contract.itemData(i)
                if val is not None:
                    ids.append(int(val))
        except Exception:
            pass
        return ids

    def _reload_contracts(self):
        kind = self.party_kind.currentData()
        is_transfer = (self.vtype == "payment" and kind == "transfer")
        is_general_expense = (self.vtype == "payment" and not kind)
        if is_transfer:
            self.contract.set_items([], auto_select=False)
            return
        party_id = (self.expense_customer.selected_data() if is_general_expense and hasattr(self, "expense_customer")
                    else self.party.selected_data())
        items = [("— بدون عقد/مشروع —" if is_general_expense else "— بدون عقد —", None)]
        if is_general_expense:
            from ui.widgets import contract_items
            # قاعدة العمل: العقد هو المشروع. لذلك لا نعرض كل مشاريع/عقود النظام.
            # في المصروف العام يختار المستخدم العميل أولًا، ثم تظهر عقود/مشاريع هذا العميل فقط.
            items = [] if not party_id else items + contract_items(customer_id=party_id)
        elif party_id:
            if kind == "customer":
                from ui.widgets import contract_items
                items += contract_items(customer_id=party_id)
            elif kind == "subcontractor":
                from services import ui_data_service as ui_data
                items += ui_data.subcontractor_contract_items(party_id)
        current = self.contract.selected_data()
        self.contract.set_items(items, auto_select=False)
        # V3.25: بحث-فقط دائمًا
        self.contract.lineEdit().setPlaceholderText(
            "اكتب رقم العقد أو اسم العميل...")
        valid_ids = {int(v) for _txt, v, *_rest in items if v is not None}
        if current is not None and int(current) in valid_ids:
            self.contract.select_data(current)
        elif (self.vtype == "receipt" and kind == "customer"
              and not self.voucher and len(valid_ids) == 1):
            # في سند قبض العميل: إذا كان له عقد واحد فقط، اربط السند به تلقائيًا
            # حتى يسمع مباشرة في ملخص العقد ولا يبقى سندًا عامًا على العميل.
            self.contract.select_data(next(iter(valid_ids)))
        if self.vtype == "receipt":
            self._reload_allocations()

    def _toggle_grouped_receipt(self, checked: bool):
        if self.vtype != "receipt" or self.voucher:
            return
        if not hasattr(self, 'grouped_panel'):
            return
        self.grouped_panel.setVisible(bool(checked))
        for label, widget in ((self.party_label, self.party_kind),
                              (self.contract_label, self.contract),
                              (self.allocation_lbl, self.allocation)):
            self._set_form_row_visible(label, not checked)
        for w in (self.party_label, self.party_kind, self.party, self.party_text,
                  self.contract_label, self.contract,
                  self.allocation_lbl, self.allocation):
            try:
                w.setVisible(not checked)
            except Exception:
                pass
        if checked:
            self.resize(max(self.width(), 980), self.height())
            style.fit_table_height(self.group_table)
            if self.method.findText("تحويل بنكي") >= 0:
                self.method.setCurrentText("تحويل بنكي")
            self.party_kind.setCurrentIndex(0)
            self.amount.setEnabled(False)
            self.amount.setToolTip("إجمالي سندات الجدول ويُحدّث تلقائيًا")
            if self.group_table.rowCount() == 0:
                self._add_group_row(False)
            self._update_group_summary()
        else:
            self.amount.setEnabled(True)
            self.amount.setToolTip("")
            try:
                self._reload_allocations()
            except Exception:
                pass
        self._update_group_summary()
        try:
            _th = self.group_table.height() + 60
            self._grow(_th if checked else -_th)
        except Exception:
            pass

    _GROUP_TAB_ORDER = ("customer", "subcontractor")
    _GROUP_TAB_NAMES = {"customer": "عميل", "subcontractor": "مقاول باطن"}

    def _on_group_tab_changed(self, i: int):
        data = self.group_tabs.itemData(i)
        if data not in self._group_tables:
            data = "customer"
        try:
            _old_h = self.group_table.height()
        except Exception:
            _old_h = 0
        self._group_stack.setCurrentWidget(self._group_tables[data])
        self.group_table = self._group_tables[data]
        style.fit_table_height(self.group_table)
        try:
            self._grow(self.group_table.height() - _old_h)
        except Exception:
            pass

    def _add_group_row(self, same_customer: bool = True, kind=None):
        if self.vtype != "receipt":
            return
        # clicked(bool) من الزر يمرر قيمة غير نصية ← التاب المفتوح.
        from ui.widgets import (customer_items, contract_items,
                                subcontractor_items)
        k = (kind if isinstance(kind, str) and kind in self._group_tables
             else (self.group_tabs.currentData() or "customer"))
        table = self._group_tables[k]
        is_cust = (k == "customer")
        row = table.rowCount()
        table.insertRow(row)
        cust = SearchableComboBox(
            search_only=True)
        cust.set_items((customer_items() if is_cust else subcontractor_items()),
                       auto_select=False)
        if same_customer and self.party_kind.currentData() == k \
                and self.party.selected_data():
            cust.select_data(self.party.selected_data())
        con = SearchableComboBox(search_only=True, browse_on_empty=True)
        amount = SafeDoubleSpinBox()
        amount.setRange(0, 1e9); amount.setDecimals(3); amount.setGroupSeparatorShown(True)
        desc = QLineEdit(); desc.setPlaceholderText("بيان هذا السند...")
        desc.setProperty("_auto_group_desc", True)
        delete_btn = QPushButton("✕")
        delete_btn.setProperty("danger", True)
        delete_btn.setToolTip("حذف السطر")
        delete_btn.setFixedWidth(34)
        delete_btn.setObjectName("btnDangerGhost")
        delete_btn.setStyleSheet(Styles.button_danger_ghost())
        preset_contract = self.contract.selected_data() if row == 0 else None
        if row == 0 and self.amount.value() > 0:
            amount.setValue(self.amount.value())

        def mark_manual(text):
            desc.setProperty("_auto_group_desc", not bool((text or "").strip()))

        def refresh_description(*_):
            if not bool(desc.property("_auto_group_desc")) and desc.text().strip():
                return
            contract_id = con.selected_data()
            val = float(amount.value() or 0)
            text = ""
            if contract_id and val > 0:
                try:
                    from services.extras_service import smart_receipt_description
                    text = smart_receipt_description(contract_id, val)
                except Exception:
                    text = ""
            if not text:
                cname = cust.currentText().strip()
                contract_name = con.currentText().strip()
                if contract_name and contract_id:
                    text = f"تحصيل دفعة من {cname} عن عقد {contract_name}" if cname else f"تحصيل دفعة عن عقد {contract_name}"
                elif cname:
                    text = f"تحصيل دفعة من {cname}"
            if text:
                desc.blockSignals(True)
                desc.setText(text)
                desc.blockSignals(False)
                desc.setProperty("_auto_group_desc", True)

        def reload_contracts():
            pid = cust.selected_data()
            items = [("— بدون عقد —", None)]
            if pid:
                if is_cust:
                    items += contract_items(customer_id=pid)
                else:
                    try:
                        from services import ui_data_service as ui_data
                        items += ui_data.subcontractor_contract_items(pid)
                    except Exception:
                        pass
            current = con.selected_data()
            con.set_items(items, auto_select=False)
            # V3.25: بحث-فقط دائمًا
            con.lineEdit().setPlaceholderText(
                "اكتب رقم العقد أو اسم العميل...")
            if current:
                con.select_data(current)
            refresh_description()

        def on_amount_changed(*_):
            refresh_description()
            self._update_group_summary()

        cust.selection_changed.connect(reload_contracts)
        con.selection_changed.connect(refresh_description)
        amount.valueChanged.connect(on_amount_changed)
        desc.textEdited.connect(mark_manual)
        delete_btn.clicked.connect(lambda *_: self._remove_group_row(delete_btn))
        reload_contracts()
        if preset_contract:
            con.select_data(preset_contract)
        refresh_description()
        table.setCellWidget(row, 0, cust)
        table.setCellWidget(row, 1, con)
        table.setCellWidget(row, 2, amount)
        table.setCellWidget(row, 3, desc)
        table.setCellWidget(row, 4, delete_btn)
        table.setRowHeight(row, 50)
        _dh = style.fit_table_height(table)
        self._update_group_summary()
        self._grow(_dh)

    def _remove_group_row(self, button):
        for k in self._GROUP_TAB_ORDER:
            t = self._group_tables[k]
            for r in range(t.rowCount()):
                if t.cellWidget(r, 4) is button:
                    label = self._GROUP_TAB_NAMES[k]
                    if not style.confirm(
                            self,
                            f"حذف السطر رقم {r + 1} (تاب {label}) من السند المجمع؟",
                            "تأكيد حذف سطر"):
                        return
                    t.removeRow(r)
                    _dh = style.fit_table_height(t)
                    self._update_group_summary()
                    self._grow(_dh)
                    return

    def _update_group_summary(self, *args):
        if not hasattr(self, "_group_tables") or not hasattr(self, "group_total_lbl"):
            return
        total = 0.0
        count = 0
        for i, k in enumerate(self._GROUP_TAB_ORDER):
            t = self._group_tables[k]
            n = t.rowCount()
            for r in range(n):
                amount = t.cellWidget(r, 2)
                val = float(amount.value() if amount else 0)
                total += val
                if val > 0:
                    count += 1
            try:
                self.group_tabs.setCount(i, n)
            except Exception:
                pass
        fee = lc._receipt_bank_fee(self.method.currentText(), total) if total > 0 else 0.0
        share = (fee / count) if count and fee else 0.0
        self.group_total_lbl.setText(
            f"الإجمالي: {total:,.3f} د.ك · عدد السندات: {count} · العمولة: {fee:,.3f} د.ك · نصيب السند: {share:,.3f} د.ك"
        )
        if self.grouped_receipt_check.isChecked():
            self.amount.blockSignals(True)
            self.amount.setValue(total)
            self.amount.blockSignals(False)
    def _grouped_rows_data(self) -> list[dict]:
        rows = []
        seen_pairs = {}
        for k in self._GROUP_TAB_ORDER:
            t = self._group_tables[k]
            label = self._GROUP_TAB_NAMES[k]
            who = "العميل" if k == "customer" else "مقاول الباطن"
            for r in range(t.rowCount()):
                cust = t.cellWidget(r, 0)
                con = t.cellWidget(r, 1)
                amount = t.cellWidget(r, 2)
                desc = t.cellWidget(r, 3)
                cid = cust.selected_data() if cust else None
                if not cid:
                    raise ValidationError(
                        f"حدد {who} في سطر السند المجمع رقم {r + 1} (تاب {label}).")
                val = float(amount.value() if amount else 0)
                if val <= 0:
                    raise ValidationError(
                        f"مبلغ سطر السند المجمع رقم {r + 1} (تاب {label}) يجب أن يكون أكبر من صفر.")
                contract_id = con.selected_data() if con else None
                if contract_id:
                    pair = (k, cid, contract_id)
                    if pair in seen_pairs:
                        raise ValidationError(
                            f"السطر {r + 1} (تاب {label}) يكرر نفس العقد لنفس {who} الموجود في السطر {seen_pairs[pair][1] + 1} (تاب {seen_pairs[pair][0]}).\n"
                            "اجمع المبلغ في سطر واحد أو اختر عقدًا آخر."
                        )
                    seen_pairs[pair] = (label, r)
                rows.append({"customer_id": cid, "party_id": cid,
                             "party_type": k,
                             "contract_id": contract_id,
                             "amount": val,
                             "description": desc.text().strip() if desc else ""})
        return rows

    def accept(self):  # noqa: N802
        """لا تغلق النافذة إلا بعد نجاح التحقق والحفظ."""
        self._save()

    def _save(self):
        # تأكيد قبل الحفظ
        _vtype_label = "سند قبض" if self.vtype == "receipt" else (
            "سند صرف" if self.vtype == "payment" else "تحويل")
        _amt = self.amount.value()
        if not style.confirm(self,
                f"هل تريد حفظ {_vtype_label} بمبلغ {_amt:,.3f} د.ك؟"):
            return
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        grouped = (self.vtype == "receipt" and not self.voucher
                   and self.grouped_receipt_check.isChecked()
                   and self.party_kind.currentData() != "partner")
        if grouped:
            pass
        elif self.party_kind.currentData() == "partner":
            pass
        elif self.vtype == "payment" and self.party_kind.currentData() == "transfer":
            pass
        elif self.vtype == "payment" and not self.party_kind.currentData():
            v.add(self.party_text, "اسم المورد / جهة الصرف")
        else:
            v.add(self.party, "الطرف (عميل أو مقاول)")
        if self.vtype == "payment" and not grouped and self.party_kind.currentData() not in ("transfer", "partner"):
            v.add(self.expense_account,
                  "حساب العهدة" if getattr(self, "_custody_mode", False)
                  else "حساب المصروف")
        if not grouped:
            v.add(self.amount, "المبلغ", min_value=0.001)
        _is_transfer = (self.vtype == "payment"
                        and self.party_kind.currentData() == "transfer")
        if _is_transfer:
            v.add(self.transfer_from, "حساب التحويل (من)")
            v.add(self.transfer_to, "حساب التحويل (إلى)")
        else:
            v.add(self.method, "طريقة الدفع")
        if not v.validate():
            return
        if grouped:
            try:
                self._execute_grouped_save(allow_overpay=False)
            except lc.OverpayWarning as exc:
                if style.confirm(self, f"{exc}\n\nهل تريد المتابعة وتسجيل الزيادة؟", "تحذير: تجاوز مبلغ العقد"):
                    try:
                        self._execute_grouped_save(allow_overpay=True)
                    except (ValidationError, DatabaseError) as e:
                        style.error(self, str(e))
                        return
                else:
                    return
            except (ValidationError, DatabaseError) as exc:
                style.error(self, str(exc))
                return
            if getattr(self, "_saved_voucher_ids", None):
                if style.confirm(self, "تم حفظ السندات بنجاح.\nهل تريد معاينتها وطباعتها الآن؟",
                                 "معاينة السندات"):
                    _preview_saved_vouchers(self, self._saved_voucher_ids)
            QDialog.accept(self)
            return
        
        alloc = (self.allocation.currentData() if hasattr(self, "allocation") else "")
        contract_id = self.contract.selected_data()
        _pkind = self.party_kind.currentData()
        if _pkind is None:
            _pkind = "customer" if self.vtype == "receipt" else ""
        if (self.vtype == "receipt" and _pkind == "customer"
                and self._available_contract_ids() and not contract_id):
            style.error(
                self,
                "اختر العقد المرتبط بسند القبض حتى يتم تحديث المحصل والمتبقي في ملخص العقد.")
            return
        
        if alloc and contract_id and not self.voucher:
            from services.extras_service import allocation_options
            opt = next((o for o in allocation_options(contract_id) if o["number"] == alloc), None)
            if opt and self.amount.value() > opt["remaining"] + 1e-9:
                style.error(self, f"المبلغ يتجاوز المتبقي من {opt['label']}.\nالمتبقي: {opt['remaining']:,.3f}")
                return

        if self.voucher and not style.require_admin(self, "حفظ تعديل السند"):
            return

        self._saved_voucher_ids = []
        try:
            self._execute_save(allow_overpay=False)
        except lc.OverpayWarning as exc:
            if style.confirm(self, "تحذير: تجاوز مبلغ العقد", 
                             f"{exc}\n\nهل تريد المتابعة وتسجيل الزيادة؟"):
                try:
                    self._execute_save(allow_overpay=True)
                except (ValidationError, DatabaseError) as e:
                    style.error(self, str(e))
                    return
            else:
                return
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        if getattr(self, "_saved_voucher_ids", None):
            # تحديث حالة المطالبات تلقائياً عند السداد
            try:
                from services.claims_service import auto_update_claims_for_contract
                _cid = self.contract.selected_data()
                if _cid:
                    auto_update_claims_for_contract(int(_cid))
            except Exception:
                pass
            if style.confirm(self, "تم حفظ السند بنجاح.\nهل تريد معاينته وطباعته الآن؟",
                             "معاينة السند"):
                _preview_saved_vouchers(self, self._saved_voucher_ids)
        QDialog.accept(self)

    def _execute_grouped_save(self, allow_overpay: bool = False):
        rows = self._grouped_rows_data()
        result = lc.add_grouped_receipts(
            self.vdate.date().toString("yyyy-MM-dd"),
            self.method.currentText(), "", rows,
            group_description=self.description.toPlainText(),
            allow_overpay=allow_overpay)
        style.success(
            self,
            f"تم إنشاء السند المجمع · مرجع داخلي {result['group_number']}\n"
            f"عدد سندات القبض: {len(result['receipt_ids'])}\n"
            f"إجمالي التحويل: {result['total']:,.3f}\n"
            f"العمولة الموزعة بالتساوي: {result['bank_fee']:,.3f}")
        self._saved_voucher_ids = list(result.get("receipt_ids") or [])

    def _execute_save(self, allow_overpay: bool = False):
        # V6.2: اختيار الدفعة المستحقة (يفرض قرار الزيادة عند اللزوم)
        _plink = self._build_payment_link()
        _link_sel = (_plink or {}).get("selections")
        if (_link_sel is None and self.voucher
                and hasattr(self, "link_due") and (not self.link_due.isHidden())):
            _link_sel = []          # إلغاء الربط صريحًا عند إلغاء الخانة
        party_kind = self.party_kind.currentData()
        is_partner = (party_kind == "partner")
        is_custody = (self.vtype == "payment" and getattr(self, "_custody_mode", False))
        is_transfer = (self.vtype == "payment" and party_kind == "transfer" and not is_custody)
        party_id = self.party.selected_data() if party_kind and not is_transfer and not is_custody and not is_partner else None
        contract_id = self.contract.selected_data() if party_kind and not is_transfer and not is_custody else None
        alloc = (self.allocation.currentData() if hasattr(self, "allocation") else "")
        if is_partner:
            alloc = ""
        project_id = None
        expense_customer_id = self.expense_customer.selected_data() if (self.vtype == "payment" and not party_kind and not is_custody and hasattr(self, "expense_customer")) else None
        contract_id = self.contract.selected_data() if (not is_transfer and not is_custody and not is_partner and (party_kind or self.vtype == "payment")) else None
        if contract_id:
            from services import ui_data_service as ui_data
            project_id = ui_data.contract_project_id(contract_id)

        method_value = self.transfer_from.currentText() if is_transfer else self.method.currentText()
        expense_account_id = self._selected_expense_account_id() if (self.vtype == "payment" and not is_transfer) else None
        # وضع «تسليم عهدة»: الحساب المختار هو حساب العهدة لا حساب مصروف،
        # ولا يرتبط بعميل/عقد/مشروع لأن الربط يحدث عند التصفية فقط.
        custody_handover_id = None
        if is_custody:
            custody_handover_id = expense_account_id
            expense_account_id = None
            party_kind = ""
            party_id = None
            contract_id = None
            project_id = None
            expense_customer_id = None
            alloc = ""
            if not custody_handover_id:
                raise ValidationError("اختر حساب العهدة أولًا.")
        account = ("جاري الشريك" if is_partner
                   else (self.transfer_to.currentText() if is_transfer
                         else (self.expense_account.currentText() if self.vtype == "payment" else "")))
        party_name = "الشريك" if is_partner else ("تحويل داخلي" if is_transfer else (self.party_text.text().strip() if (not party_kind or is_custody) else ""))
        if self.voucher:
            lc.update_voucher(
                self.voucher["id"],
                self.vdate.date().toString("yyyy-MM-dd"),
                method_value,
                self.amount.value(), self.description.toPlainText(),
                notes=self.notes.text(),
                contract_id=contract_id,
                party_type=party_kind,
                party_id=party_id,
                cheque_due_date=self.cheque_due.date().toString("yyyy-MM-dd"),
                allow_overpay=allow_overpay,
                account=account,
                project_id=project_id,
                party=party_name,
                expense_customer_id=expense_customer_id,
                sub_contract_id=self._selected_sub_contract_id(),
                payment_links=_link_sel,
                payment_spread=bool((_plink or {}).get("spread", True)))
        if self.voucher:
            self._saved_voucher_ids = [self.voucher["id"]]
        if not self.voucher:
            _new_id = lc.add_voucher(
                "transfer" if is_transfer else self.vtype,
                self.vdate.date().toString("yyyy-MM-dd"),
                party_name, method_value, account,
                self.amount.value(), self.description.toPlainText(),
                project_id=project_id, contract_id=contract_id,
                expense_customer_id=expense_customer_id,
                notes=self.notes.text(),
                party_type=party_kind,
                party_id=party_id,
                sub_contract_id=self._selected_sub_contract_id(),
                cheque_due_date=self.cheque_due.date().toString("yyyy-MM-dd"),
                allocation=alloc or "",
                allow_overpay=allow_overpay,
                expense_account_id=expense_account_id,
                custody_account_id=custody_handover_id,
                payment_link=_plink)
            self._saved_voucher_ids = [_new_id]


class GroupedPaymentDialog(QDialog):
    """سند صرف مجمع: كل سطر يتحول إلى سند صرف مستقل."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("سند صرف مجمع")
        self.setLayoutDirection(Qt.RightToLeft)
        style.setup_dialog(self, "سند صرف مجمع", "أضف البنود؛ عند الحفظ ينشأ سند صرف مستقل لكل بند", "💸", min_w=1250, max_w=1600)
        self.resize(1280, 680)
        lay = self.body_layout
        top = QHBoxLayout()
        self.vdate = SafeDateEdit(); self.vdate.setCalendarPopup(True); self.vdate.setDisplayFormat("yyyy-MM-dd"); self.vdate.setDate(QDate.currentDate())
        from services import settings_service as _ss
        self.method = QComboBox(); self.method.addItems([m["name"] for m in _ss.list_payment_methods()])
        self.method.setCurrentIndex(-1)
        make_searchable(self.method, "")
        self.desc = QTextEdit(); self.desc.setPlaceholderText("بيان عام اختياري للمجموعة")
        self.desc.setFixedHeight(64)
        self.desc.setMinimumWidth(250)
        top.addWidget(QLabel("التاريخ")); top.addWidget(self.vdate)
        top.addWidget(QLabel("طريقة الدفع")); top.addWidget(self.method)
        top.addWidget(QLabel("بيان عام")); top.addWidget(self.desc, 1)
        lay.addLayout(top)
        info = QLabel("ملاحظة: حساب المصروف للتصنيف المحاسبي فقط؛ ويمكن في نفس البند كتابة المورد/الجهة واختيار العميل ثم العقد المرتبط بهذا العميل.")
        info.setWordWrap(True)
        info.setStyleSheet(f"""
            color:{Colors.TEXT_SECONDARY};
            font-weight:{Fonts.WEIGHT_SEMIBOLD};
            background:{Colors.BG};
            border:1px solid {Colors.BORDER};
            border-radius:{Dimensions.RADIUS_MD}px;
            padding:8px;
        """)
        lay.addWidget(info)
        # نفس شكل شاشة تصفية العهدة: زر الإضافة فوق الجدول، ولا يوجد مشروع
        # مستقل لأن العقد هو المشروع الفعلي.
        add_row = QHBoxLayout()
        self.add_btn = QPushButton("＋ إضافة بند")
        self.add_btn.setObjectName("btnPrimary")
        self.add_btn.clicked.connect(self._add_row)
        add_row.addWidget(self.add_btn)
        add_row.addStretch()
        lay.addLayout(add_row)

        # تابات نوع الصرف خارج الجدول — كل تاب جدول بأعمدته الخاصة فقط.
        # (kind: عمود حساب، مستفيد، [عميل مرتبط]، عقد، مبلغ، بيان، حذف)
        self.tabs = SegmentedTabs()
        self.tabs.addItem("عميل", "customer")
        self.tabs.addItem("مقاول باطن", "subcontractor")
        self.tabs.addItem("مصروف عام / مورد", "")
        lay.addWidget(self.tabs)
        from PySide6.QtWidgets import QStackedWidget as _QSW
        self._stack = _QSW()
        self._tab_tables = {}
        _specs = {
            "customer": (["حساب المصروف *", "العميل المستفيد", "العقد",
                          "المبلغ", "البيان", "حذف"],
                         [220, 170, 160, 115, 220, 58],
                         [170, 160, 150, 110, 160, 40], 4),
            "subcontractor": (["حساب المصروف *", "مقاول الباطن", "العقد",
                               "المبلغ", "البيان", "حذف"],
                              [220, 170, 160, 115, 220, 58],
                              [170, 160, 150, 110, 160, 40], 4),
            "": (["حساب المصروف *", "المورد/الجهة", "العميل المرتبط",
                 "العقد", "المبلغ", "البيان", "حذف"],
                [220, 170, 160, 150, 115, 220, 58],
                [170, 150, 150, 150, 110, 160, 40], 5),
        }
        from ui.widgets import fit_table_with_floors as _ftwf2
        for _kind, (_heads, _init, _floors, _desc) in _specs.items():
            _t = QTableWidget(0, len(_heads))
            _t.setHorizontalHeaderLabels(_heads)
            _t.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
            _t.verticalHeader().setVisible(False)
            _t.verticalHeader().setDefaultSectionSize(58)
            style.fit_table_height(_t)
            _t.horizontalHeader().setMinimumSectionSize(36)
            _ftwf2(_t, _init, _floors, _desc)
            hide_popups_on_scroll(_t)
            self._tab_tables[_kind] = _t
            self._stack.addWidget(_t)
        lay.addWidget(self._stack, 1)
        self.tabs.currentIndexChanged.connect(self._on_tab_changed)
        self.tabs.setCurrentData("")
        self.table = self._tab_tables[""]
        self.total_lbl = QLabel("الإجمالي: 0.000 د.ك · عدد البنود: 0")
        self.total_lbl.setStyleSheet(f"""
            font-weight:{Fonts.WEIGHT_BOLD};
            color:{Colors.TEXT};
        """)
        lay.addWidget(self.total_lbl)
        # أزرار ثابتة أسفل النافذة خارج منطقة التمرير، حتى تبقى ظاهرة مهما زاد عدد البنود.
        self.save_btn, self.cancel_btn = style.dialog_buttons(
            self, "حفظ سندات الصرف", on_save=self._save, danger=True)
        self._add_row()


    def _expense_items_for_kind(self, kind: str = ""):
        """حسابات المصروف المتاحة حسب نوع الصرف.

        كل الأنواع تستخدم حسابات المصروف العادية فقط، مع ترتيب ذكي بسيط يجعل
        الحسابات الأقرب للنوع في أول القائمة دون إخفاء باقي الحسابات؛ حتى لا
        نمنع المستخدم من اختيار التصنيف المحاسبي الصحيح.
        """
        try:
            from services import expense_account_service as ea
            items = ea.posting_items()
        except Exception:
            items = [("مصروف / تكلفة المشروع", None)]
        if not kind:
            return items
        if kind == "subcontractor":
            keys = ("مقاول", "باطن", "عمال", "مشاريع", "موقع")
        elif kind == "customer":
            keys = ("عميل", "مشاريع", "موقع", "رسوم", "مواد")
        else:
            keys = ()
        if not keys:
            return items
        def score(item):
            txt = str(item[0] or "")
            return 0 if any(k in txt for k in keys) else 1
        return sorted(items, key=score)

    def _account_combo(self, kind: str = ""):
        placeholders = {
            "": "ابحث في حساب المصروف للمورد/المصروف العام...",
            "customer": "ابحث في حساب المصروف المرتبط بالعميل...",
            "subcontractor": "ابحث في حساب مصروف مقاول الباطن...",
        }
        cb = ExpenseAccountCombo("")
        cb.setMinimumWidth(170)
        cb.set_items(self._expense_items_for_kind(kind), auto_select=False)
        return cb

    def _party_selector(self, placeholder: str):
        from ui.widgets import SearchableComboBox
        combo = SearchableComboBox(placeholder=placeholder, search_only=True)
        combo.setMinimumWidth(160)
        return combo

    def _grow(self, dh: int = 0):
        try:
            if self.isVisible():
                style.grow_dialog(self, dh)
        except Exception:
            pass

    def _on_tab_changed(self, i: int):
        data = self.tabs.itemData(i)
        if data not in self._tab_tables:
            data = ""
        try:
            _old_h = self.table.height()
        except Exception:
            _old_h = 0
        self._stack.setCurrentWidget(self._tab_tables[data])
        self.table = self._tab_tables[data]
        style.fit_table_height(self.table)
        try:
            self._grow(self.table.height() - _old_h)
        except Exception:
            pass

    _TAB_ORDER = ("customer", "subcontractor", "")

    def _add_row(self, kind=None):
        # تُستدعى من زر «+ إضافة بند» (يمرر clicked(bool)) أو مباشرة؛
        # أي قيمة غير نصية تعني: أضف في التاب المفتوح حاليًا.
        from ui.widgets import SearchableComboBox, SafeDoubleSpinBox, customer_items, contract_items, subcontractor_items
        k = kind if isinstance(kind, str) and kind in self._tab_tables else (self.tabs.currentData() or "")
        table = self._tab_tables[k]
        r = table.rowCount(); table.insertRow(r)
        acc = self._account_combo(k)
        amount = SafeDoubleSpinBox(minimum=0, maximum=999999999, decimals=3)
        amount.setMinimumWidth(110)
        amount.valueChanged.connect(lambda _v: self._summary())
        desc = QLineEdit(); desc.setPlaceholderText("بيان البند...")
        desc.setMinimumWidth(120)
        delete = QPushButton("×")
        delete.setObjectName("btnDangerGhost")
        delete.setFixedSize(40, 34)
        delete.setCursor(Qt.PointingHandCursor)
        delete.clicked.connect(lambda _b, _btn=delete: self._remove_row(_btn))
        if k == "":
            party = QLineEdit(); party.setPlaceholderText("اسم المورد أو الجهة")
            party.setMinimumWidth(150)
            cust = SearchableComboBox(search_only=True)
            cust.setMinimumWidth(150)
            cust.set_items(customer_items(), auto_select=False)
            cust.setCurrentIndex(-1); cust.lineEdit().setText("")
            con = SearchableComboBox(search_only=True, browse_on_empty=True)
            con.setMinimumWidth(150)
            con.set_items([], auto_select=False)
            con.setCurrentIndex(-1); con.lineEdit().setText("")
            def reload_contracts():
                cid = cust.selected_data()
                items = contract_items(customer_id=cid) if cid else []
                con.set_items(items, auto_select=False)
                con.setCurrentIndex(-1); con.lineEdit().setText("")
                con.lineEdit().setPlaceholderText(
                    "اكتب رقم العقد أو اسم العميل...")
            cust.selection_changed.connect(reload_contracts)
            widgets = (acc, party, cust, con, amount, desc, delete)
        else:
            is_cust = (k == "customer")
            party = self._party_selector("اختر العميل المستفيد..." if is_cust else "اختر مقاول الباطن...")
            party.set_items((customer_items() if is_cust else subcontractor_items()), auto_select=False)
            con = SearchableComboBox(search_only=True, browse_on_empty=True)
            con.setMinimumWidth(150)
            con.set_items([], auto_select=False)
            con.setCurrentIndex(-1); con.lineEdit().setText("")
            def reload_contracts():
                pid = party.selected_data()
                if is_cust:
                    items = contract_items(customer_id=pid) if pid else []
                else:
                    try:
                        from services import ui_data_service as ui_data
                        items = ui_data.subcontractor_contract_items(pid) if pid else []
                    except Exception:
                        items = []
                con.set_items(items, auto_select=False)
                con.setCurrentIndex(-1); con.lineEdit().setText("")
                con.lineEdit().setPlaceholderText(
                    "اكتب رقم العقد أو اسم العميل...")
            party.selection_changed.connect(reload_contracts)
            widgets = (acc, party, con, amount, desc, delete)
        for c, w in enumerate(widgets):
            table.setCellWidget(r, c, w)
        table.setRowHeight(r, 58)
        _dh = style.fit_table_height(table)
        self._summary()
        self._grow(_dh)

    def _remove_row(self, button):
        # لا تحذف المرسل أثناء إشارة clicked (يفسد الكومة ويُسقط
        # البرنامج): أجل الحذف لما بعد انتهاء الإشارة.
        QTimer.singleShot(0, lambda b=button: self._drop_row(b))

    def _drop_row(self, button):
        _dh = 0
        for k in self._TAB_ORDER:
            t = self._tab_tables[k]
            del_col = 5 if k else 6
            for r in range(t.rowCount()):
                if t.cellWidget(r, del_col) is button:
                    t.removeRow(r)
                    _dh = style.fit_table_height(t)
                    break
        self._summary()
        try:
            self._grow(_dh)
        except Exception:
            pass

    def _summary(self):
        total = 0.0; n_all = 0
        for i, k in enumerate(self._TAB_ORDER):
            t = self._tab_tables[k]
            n = t.rowCount(); n_all += n
            amt_col = 3 if k else 4
            for r in range(n):
                w = t.cellWidget(r, amt_col)
                try:
                    total += float(w.value() if w else 0)
                except Exception:
                    pass
            self.tabs.setCount(i, n)
        self.total_lbl.setText(f"الإجمالي: {total:,.3f} د.ك · عدد البنود: {n_all}")

    def _rows(self):
        rows = []
        for kind in self._TAB_ORDER:
            t = self._tab_tables[kind]
            for r in range(t.rowCount()):
                if kind == "":
                    party_txt = t.cellWidget(r, 1)
                    cust_cb = t.cellWidget(r, 2)
                    con_cb = t.cellWidget(r, 3)
                    amt = t.cellWidget(r, 4)
                    dsc = t.cellWidget(r, 5)
                    rows.append({
                        "party_type": "", "party_id": None,
                        "expense_account_id": t.cellWidget(r, 0).selected_data(),
                        "party": party_txt.text().strip() if party_txt else "",
                        "expense_customer_id": cust_cb.selected_data() if cust_cb else None,
                        "project_id": None,
                        "contract_id": con_cb.selected_data() if con_cb else None,
                        "amount": amt.value() if amt else 0,
                        "description": dsc.text().strip() if dsc else "",
                    })
                else:
                    party = t.cellWidget(r, 1)
                    con_cb = t.cellWidget(r, 2)
                    amt = t.cellWidget(r, 3)
                    dsc = t.cellWidget(r, 4)
                    pid = party.selected_data() if party else None
                    rows.append({
                        "party_type": kind, "party_id": pid,
                        "expense_account_id": t.cellWidget(r, 0).selected_data(),
                        "party": party.currentText().strip() if party else "",
                        "expense_customer_id": pid if kind == "customer" else None,
                        "project_id": None,
                        "contract_id": con_cb.selected_data() if con_cb else None,
                        "amount": amt.value() if amt else 0,
                        "description": dsc.text().strip() if dsc else "",
                    })
        return rows

    def _focus_first_invalid(self):
        """الانتقال لتاب أول بند ناقص قبل عرض رسالة الخطأ (بنفس ترتيب الفحص)."""
        try:
            for kind in self._TAB_ORDER:
                t = self._tab_tables[kind]
                for r in range(t.rowCount()):
                    if kind == "":
                        amt = t.cellWidget(r, 4)
                        bad = (
                            (not amt or float(amt.value() or 0) <= 0)
                            or not t.cellWidget(r, 0).selected_data()
                            or not (t.cellWidget(r, 1).text().strip() if t.cellWidget(r, 1) else "")
                        )
                    else:
                        party = t.cellWidget(r, 1)
                        amt = t.cellWidget(r, 3)
                        bad = (
                            (not amt or float(amt.value() or 0) <= 0)
                            or not t.cellWidget(r, 0).selected_data()
                            or not (party.selected_data() if party else None)
                        )
                    if bad:
                        self.tabs.setCurrentData(kind)
                        return
        except Exception:
            pass

    def _save(self):
        if self.method.currentIndex() < 0:
            style.error(self, "اختر طريقة الدفع من القائمة.")
            return
        try:
            res = lc.add_grouped_payments(self.vdate.date().toString("yyyy-MM-dd"),
                                          self.method.currentText(),
                                          self._rows(),
                                          self.desc.toPlainText().strip(),
                                          custody_account_id=None)
            style.success(self, f"تم إنشاء سندات الصرف\nمرجع داخلي: {res['group_number']}\nالعدد: {res['count']}\nالإجمالي: {res['total']:,.3f}")
            _ids = list(res.get("voucher_ids") or [])
            if _ids and style.confirm(self, "تم حفظ السندات بنجاح.\nهل تريد معاينتها وطباعتها الآن؟",
                                      "معاينة السندات"):
                _preview_saved_vouchers(self, _ids)
            self.accept()
        except Exception as exc:
            self._focus_first_invalid()
            style.error(self, str(exc))




class VouchersPage(QWidget):
    """صفحة سندات من نوع واحد (قبض أو صرف)."""
    data_changed = Signal()

    def __init__(self, vtype: str, parent=None):
        super().__init__(parent)
        self.vtype = vtype
        self.setObjectName("page")
        is_receipt = vtype == "receipt"
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 10, 16, 8)
        layout.setSpacing(10)

        from ui.widgets import flow_host
        top_host, top = flow_host(spacing=7)
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title_row = QHBoxLayout()
        title_row.setSpacing(8)
        self.title_lbl = QLabel("سندات القبض" if is_receipt else "سندات الصرف")
        self.title_lbl.setProperty("pageTitle", True)
        title_row.addWidget(self.title_lbl)
        from ui.widgets import status_badge
        self.type_badge = status_badge(
            "📥 قبض" if is_receipt else "📤 صرف",
            style.OK_GREEN if is_receipt else style.DANGER)
        title_row.addWidget(self.type_badge)
        title_row.addStretch()
        title_col.addLayout(title_row)
        self.desc_lbl = QLabel(
            "تحصيلاتك من العملاء والمقاولين — حدد سندًا للعرض أو الطباعة"
            if is_receipt else
            "مدفوعاتك للمقاولين والعملاء والموردين — حدد سندًا للعرض أو الطباعة")
        self.desc_lbl.setProperty("pageDesc", True)
        title_col.addWidget(self.desc_lbl)
        title_host = QWidget(); title_host.setObjectName("transparentHost"); title_host.setLayout(title_col)
        top.addWidget(title_host)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍  ابحث برقم السند أو الاسم...")
        self.search.setMinimumWidth(170)
        self.search.setMaximumWidth(300)
        from ui.widgets import connect_debounced_text
        connect_debounced_text(self.search, self._search_changed, delay_ms=420)
        
        # أزرار الإجراءات
        print_btn = QPushButton("🖨 طباعة")
        print_btn.setProperty("flat", True)
        print_btn.setToolTip("عرض")
        print_btn.clicked.connect(self._view_glass)

        edit_btn = QPushButton("✎ تعديل")
        edit_btn.setProperty("flat", True)
        edit_btn.setToolTip("تعديل")
        edit_btn.clicked.connect(self._edit)

        edit_desc_btn = QPushButton("✎ 📝 تعديل البيان")
        edit_desc_btn.setProperty("flat", True)
        edit_desc_btn.setToolTip("تعديل البيان")
        edit_desc_btn.clicked.connect(self._edit_description_only)
        
        cancel_btn = QPushButton("✕ إلغاء")
        cancel_btn.setProperty("flat", True)
        cancel_btn.setToolTip("إلغاء السند")
        # لون خطر الإلغاء من الثيم (قاعدة 26 + لا ستايل inline على زر
        # إجراء) — عبر خاصية danger الموحدة في style.py
        cancel_btn.setProperty("danger", True)
        cancel_btn.clicked.connect(self._cancel)
        
        excel_btn = QPushButton("📤")
        excel_btn.setObjectName("iconBtn")
        excel_btn.setToolTip("تصدير")
        excel_btn.setCursor(Qt.PointingHandCursor)
        excel_btn.clicked.connect(self._export_excel)
        
        add_btn = QPushButton("＋ سند قبض جديد" if is_receipt else "＋ سند صرف جديد")
        add_btn.setObjectName("btnReceipt" if is_receipt else "btnDangerSoft")
        add_btn.setToolTip("سند جديد" if is_receipt else "إنشاء سند صرف جديد")
        add_btn.clicked.connect(self._add)
        batch_pay_btn = None
        if not is_receipt:
            batch_pay_btn = QPushButton("＋ سند صرف مجمع")
            batch_pay_btn.setObjectName("btnDangerSoft")
            batch_pay_btn.setToolTip("سند مجمع")
            batch_pay_btn.clicked.connect(self._add_grouped_payment)
        
        tools, tools_flow = flow_host(spacing=7)
        # الصلاحيات الدقيقة: كل زر يظهر لمن يملك تأشيرته فقط
        # (المدير والمطور يرون كل شيء دائمًا)
        from services import auth_service as _auth
        _can_add = _auth.has_permission(
            "action_add_receipt" if is_receipt else "action_add_payment")
        self._can_add = _can_add
        _can_edit = _auth.has_permission("action_edit_voucher")
        _can_edit_desc = _auth.has_permission("action_edit_voucher_description")
        _can_cancel = _auth.has_permission("action_cancel_voucher")
        _toolbar = [self.search, print_btn]
        if _can_edit:
            _toolbar.append(edit_btn)
        if _can_edit_desc and not _can_edit:
            _toolbar.append(edit_desc_btn)
        if _can_cancel:
            _toolbar.append(cancel_btn)
        _toolbar.append(excel_btn)
        if _can_add:
            _toolbar.append(add_btn)
            if batch_pay_btn is not None:
                _toolbar.append(batch_pay_btn)
        for _w in _toolbar:
            tools_flow.addWidget(_w)
        top.addWidget(tools)
        layout.addWidget(top_host)

        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(["الرقم", "التاريخ", "الطرف", "العقد", "البيان", "المبلغ", "الحالة"])
        from ui.widgets import apply_column_weights
        apply_column_weights(self.table, [8, 10, 21, 15, 25, 12, 9], min_widths=[64, 74, 116, 88, 124, 80, 68])
        self.table.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(42)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(True)
        soft_shadow(self.table, radius=32, y=8)
        self.table.doubleClicked.connect(self._view_glass)
        # قائمة زر الماوس الأيمن للمستخدم المتقدم (مواصفة إعادة التصميم
        # قسم 19 + القاعدة 19) — الأزرار الظاهرة تبقى المسار الأساسي
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._actions_menu)
        layout.addWidget(self.table, 1)

        from ui.widgets import PaginationBar
        self.pager = PaginationBar()
        self.pager.page_changed.connect(self.refresh)

        actions = QHBoxLayout()
        hint = QLabel("حدد سندًا · نقرة مزدوجة للعرض · الزر الأيمن لبقية الإجراءات")
        hint.setVisible(False)  # V8.3: إخفاء — معلومة واضحة
        hint.setProperty("hint", True)
        actions.addWidget(hint)
        actions.addStretch()
        actions.addWidget(self.pager)
        layout.addLayout(actions)

        self._vouchers: list[dict] = []

        from PySide6.QtWidgets import QPushButton as _QPB
        from ui.widgets import size_buttons as _size_btns
        _size_btns([b for b in self.findChildren(_QPB) if b.text().strip()], uniform=False)

    def _search_changed(self):
        self.pager.reset()
        self.refresh()

    def refresh(self):
        # بنود تصفية العهدة لها شاشتها المستقلة «العُهد» ولا تظهر هنا.
        # سند تسليم العهدة يظل حركة صرف مالية في البيانات، لكن إنشاؤه من شاشة العُهد.
        # ترقيم حقيقي على مستوى قاعدة البيانات: تُجلب صفحة واحدة فقط
        # بدل نقل كل السندات ثم عرض 50 منها. (التصدير يجلب الكل عند
        # الطلب فقط — انظر _export_excel.)
        _kw = dict(vtype=self.vtype, search=self.search.text(),
                   exclude_custody_settlement=(self.vtype == "payment"))
        self._list_kw = _kw
        try:
            total = lc.count_vouchers(**_kw)
            self._vouchers = self.pager.server_slice(
                total, lambda lim, off: lc.list_vouchers(
                    limit=lim, offset=off, **_kw))
            self._all_vouchers = None      # يُجلب عند التصدير فقط
        except Exception:
            # أي خطأ غير متوقع: نعود للسلوك القديم كما هو تمامًا
            self._all_vouchers = lc.list_vouchers(**_kw)
            self._vouchers = self.pager.slice(self._all_vouchers)
        self.table.setRowCount(len(self._vouchers))
        from PySide6.QtGui import QFont as _QF
        for r, v in enumerate(self._vouchers):
            cancelled = bool(v.get("cancelled"))
            _cl = v.get("contract_label") or v.get("contract_number") or ""
            _cc = (v.get("contract_customer_name") or "").strip()
            _con = f"{_cc} — {_cl}" if (_cc and _cl) else (_cl or "-")
            values = [v["voucher_number"], v["vdate"], v["party"],
                      _con,
                      v["description"], f"{v['amount']:,.3f}",
                      "ملغى" if cancelled else "سارٍ"]
            from ui.widgets import MONEY_ALIGN
            for col, val in enumerate(values):
                item = QTableWidgetItem(str(val))
                item.setTextAlignment(MONEY_ALIGN if col == 5 else Qt.AlignCenter)
                if cancelled:
                    item.setBackground(QColor(148, 163, 184, 30))
                    if v.get("cancel_reason"):
                        item.setToolTip("سبب الإلغاء: " + str(v.get("cancel_reason") or ""))
                if col == 3 and v.get("contract_number"):
                    item.setToolTip(v["contract_number"])
                if cancelled:
                    item.setForeground(QColor(style.MUTED))
                    f = _QF(); f.setStrikeOut(col != 6)
                    item.setFont(f)
                    if col == 6:
                        item.setForeground(QColor(style.RED))
                elif col == 5:
                    item.setForeground(QColor(style.MONEY_IN if self.vtype == "receipt" else style.MONEY_OUT))
                elif col == 6:
                    item.setForeground(QColor(style.OK_GREEN))
                self.table.setItem(r, col, item)
        from ui.widgets import sync_header_alignment
        sync_header_alignment(self.table)
        self._update_empty_state(len(self._vouchers))

    def _update_empty_state(self, count: int):
        """حالة الفراغ: رسالة + زر — تُستدعى نهاية التحديث."""
        from ui.widgets import empty_state, dispose_widget as _dispose
        if count:
            if getattr(self, "_empty_widget", None) is not None:
                _dispose(self._empty_widget, host=self)
                self._empty_widget = None
                self.table.setVisible(True)
            return
        if getattr(self, "_empty_widget", None) is not None:
            _dispose(self._empty_widget, host=self)
        is_receipt = self.vtype == "receipt"
        self._empty_widget = empty_state(
            "لا سندات مطابقة بعد · ابدأ بإنشاء أول سند",
            "＋ سند قبض جديد" if is_receipt else "＋ سند صرف جديد",
            self._add, icon="📥" if is_receipt else "📤",
            primary=not getattr(self, "_can_add", True))
        self.table.setVisible(False)
        lay = self.layout()
        lay.insertWidget(lay.indexOf(self.table), self._empty_widget, 1)

    def _build_actions_menu(self, voucher: dict):
        """بناء قائمة إجراءات السند · مفصولة عن العرض ليسهل اختبارها."""
        from PySide6.QtWidgets import QMenu
        from services import auth_service
        cancelled = bool(voucher.get("cancelled"))
        menu = QMenu(self)
        menu.addAction("✨ عرض / طباعة السند").setData("view")
        from services import feature_service as _feat13w
        if (auth_service.has_permission("action_whatsapp")
                and _feat13w.enabled("whatsapp")):   # V4.5.13: ربط فعلي
            menu.addAction("💬 رسالة واتساب").setData("whatsapp")
        _can_edit = auth_service.has_permission("action_edit_voucher")
        _can_edit_desc = auth_service.has_permission("action_edit_voucher_description")
        _can_cancel = auth_service.has_permission("action_cancel_voucher")
        if _can_edit or _can_edit_desc or _can_cancel:
            menu.addSeparator()
            if _can_edit:
                act_edit = menu.addAction("✏ تعديل السند")
                act_edit.setData("edit")
                act_edit.setEnabled(not cancelled)
            if _can_edit_desc and not _can_edit:
                act_desc = menu.addAction("📝 تعديل البيان فقط")
                act_desc.setData("edit_description")
                act_desc.setEnabled(not cancelled)
            if _can_cancel:
                act_cancel = menu.addAction("🚫 إلغاء السند")
                act_cancel.setData("cancel")
                act_cancel.setEnabled(not cancelled)
        return menu

    def _actions_menu(self, pos=None):
        """قائمة إجراءات السند بزر الماوس الأيمن."""
        from PySide6.QtGui import QCursor
        from PySide6.QtWidgets import QMenu
        row = self.table.rowAt(pos.y()) if pos is not None else self.table.currentRow()
        if row < 0 or row >= len(self._vouchers):
            return
        self.table.setCurrentCell(row, 0)
        menu = self._build_actions_menu(self._vouchers[row])
        chosen = menu.exec(QCursor.pos() if pos is not None else QCursor.pos())
        if chosen is None:
            return
        acts = {
            "view": lambda: self._view_glass(),
            "whatsapp": lambda: self._whatsapp(),
            "edit": lambda: self._edit(),
            "edit_description": lambda: self._edit_description_only(),
            "cancel": lambda: self._cancel(),
        }
        fn = acts.get(chosen.data())
        if fn:
            try:
                fn()
            except Exception:
                pass

    def _whatsapp(self):
        """فتح واتساب مباشرة على رقم الطرف برسالة جاهزة عن السند.

        إن لم يكن للطرف رقم هاتف مسجل · تُنسخ الرسالة للحافظة كخطة بديلة.
        """
        v = self._selected()
        if not v:
            return
        from services.extras_service import (whatsapp_message,
                                             voucher_party_phone,
                                             open_whatsapp)
        from PySide6.QtWidgets import QApplication
        try:
            msg = whatsapp_message(v)
            phone = voucher_party_phone(v)
        except Exception:
            style.error(self, "تعذر تجهيز الرسالة.")
            return
        # دائمًا ننسخ الرسالة أيضًا (مفيدة لإعادة الإرسال أو الإرفاق)
        QApplication.clipboard().setText(msg)
        if phone and open_whatsapp(phone, msg):
            style.info(self,
                       "تم فتح واتساب على محادثة الطرف والرسالة جاهزة · "
                       "اضغط إرسال.\n\n"
                       "💡 لإرفاق نسخة PDF من السند: اطبعه أولًا ثم اسحب "
                       "الملف إلى المحادثة.",
                       "واتساب جاهز")
        else:
            style.info(self,
                       "لا يوجد رقم هاتف مسجل لهذا الطرف · تم نسخ الرسالة، "
                       "الصقها في محادثة واتساب يدويًا:\n\n" + msg,
                       "الرسالة في الحافظة")

    def _selected(self) -> dict | None:
        row = self.table.currentRow()
        if row < 0 or row >= len(self._vouchers):
            style.info(self, "اختر سندًا من الجدول أولاً.")
            return None
        return self._vouchers[row]

    def _add(self):
        if VoucherDialog(self, self.vtype).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()


    def _add_grouped_payment(self):
        if self.vtype != "payment":
            return
        if GroupedPaymentDialog(self).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _view_glass(self):
        v = self._selected()
        if not v: return
        from ui.glass_receipt import GlassReceiptDialog
        GlassReceiptDialog(self, {
            "number": v["voucher_number"], "date": v["vdate"],
            "party": v["party"], "description": v["description"],
            "contract_number": v.get("contract_number"),
            "amount": float(v["amount"]), "vtype": v["vtype"], "raw": v,
        }).exec()

    def _edit(self):
        v = self._selected()
        if not v: return
        if v.get("cancelled"):
            style.info(self, "لا يمكن تعديل سند ملغى.")
            return
        dlg = VoucherDialog(self, self.vtype, voucher=v)
        if dlg.exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _edit_description_only(self):
        """تعديل البيان فقط — مناسب للسكرتير دون فتح تعديل مالي للسند."""
        v = self._selected()
        if not v:
            return
        if v.get("cancelled"):
            style.info(self, "لا يمكن تعديل بيان سند ملغى.")
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("تعديل بيان السند فقط")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(560)
        lay = QVBoxLayout(dlg)
        hint = QLabel(
            f"سيتم تعديل بيان السند {v['voucher_number']} فقط، بدون تغيير التاريخ أو الطرف أو العقد أو المبلغ.")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        lay.addWidget(hint)
        editor = QTextEdit()
        editor.setPlainText(v.get("description") or "")
        editor.setMinimumHeight(110)
        lay.addWidget(editor)
        bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Save).setText("حفظ البيان")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        lay.addWidget(bb)
        if dlg.exec() != QDialog.Accepted:
            return
        if not style.require_admin(self, "حفظ تعديل بيان السند فقط"):
            return
        try:
            lc.update_voucher_description(v["id"], editor.toPlainText())
            self.refresh()
            self.data_changed.emit()
            style.toast(self, "تم تعديل بيان السند فقط")
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

    def _export_excel(self):
        from ui.widgets import export_table_excel
        title = ("سندات القبض" if self.vtype == "receipt" else "سندات الصرف")
        # التصدير يشمل كل النتائج المطابقة للفلتر (لا الصفحة الحالية
        # فقط) — تُجلب الآن عند الضغط بدل إبقائها في الذاكرة دائمًا.
        src = getattr(self, "_all_vouchers", None)
        if not src:
            try:
                src = lc.list_vouchers(**getattr(self, "_list_kw", {}) )
            except Exception:
                src = self._vouchers
        rows = [[v["voucher_number"], v["vdate"], v["party"], v["contract_number"] or "-", v["description"], float(v["amount"]), "ملغى" if v.get("cancelled") else "سارٍ", v.get("cancel_reason") or ""] for v in src]
        export_table_excel(self, title, ["الرقم", "التاريخ", "الطرف", "العقد", "البيان", "المبلغ", "الحالة", "سبب الإلغاء"], rows, title, number_cols=[5])

    def _cancel(self):
        v = self._selected()
        if not v: return
        if v.get("cancelled"):
            style.info(self, "هذا السند ملغى بالفعل.")
            return
        from PySide6.QtWidgets import QInputDialog
        if not style.confirm_financial(self, "تأكيد إلغاء السند", f"إلغاء السند «{v['voucher_number']}»؟", [("المبلغ", f"{float(v['amount']):,.3f}"), ("الطرف", v.get("party") or "—"), ("العقد", v.get("contract_label") or v.get("contract_number") or "—")], note="• رقم السند يبقى محفوظًا في التسلسل\n• يُستبعد مبلغه من كل الأرصدة والكشوف والتقارير\n• يبقى ظاهرًا بحالة (ملغى) للمراجعة"):
            return
        if not style.require_admin(self, "عملية إلغاء السند",
                                   perm="action_cancel_voucher"):
            return
        reason, ok = QInputDialog.getText(self, "سبب الإلغاء", "اكتب سبب الإلغاء (اختياري):")
        try:
            lc.cancel_voucher(v["id"], reason if ok else "")
            self.refresh()
            self.data_changed.emit()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
