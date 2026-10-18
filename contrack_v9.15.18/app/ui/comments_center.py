# -*- coding: utf-8 -*-
"""مركز التعليقات والمتابعة — مكان واحد لكل تعليقات العملاء والعقود."""
from PySide6.QtCore import Qt, QDate
from PySide6.QtWidgets import (QComboBox, QDateEdit, QDialog, QFormLayout,
                               QHBoxLayout, QLabel, QLineEdit, QPushButton,
                               QTableWidget, QTableWidgetItem, QTextEdit,
                               QVBoxLayout, QWidget, QCheckBox, QHeaderView)

from services import comment_center_service as ccs
from services.customer_service import ValidationError
from services.db_facade_service import DatabaseError
from ui import style
from ui.widgets import SearchableComboBox, customer_items, contract_items, make_searchable


class CommentDialog(QDialog):
    def __init__(self, parent=None, customer_id=None, contract_id=None):
        super().__init__(parent)
        self.setWindowTitle("تعليق / متابعة جديدة")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(560)
        form = QFormLayout(self)
        form.setSpacing(10)
        self.customer = SearchableComboBox(search_only=True)
        self.customer.set_items(customer_items(), auto_select=False)
        if customer_id:
            self.customer.select_data(customer_id)
        self.customer.currentIndexChanged.connect(self._reload_contracts)
        self.contract = SearchableComboBox()
        self.kind = QComboBox(); self.kind.addItems(ccs.KINDS)
        make_searchable(self.kind, "")
        self.priority = QComboBox(); self.priority.addItems(ccs.PRIORITIES)
        make_searchable(self.priority, "")
        self.status = QComboBox(); self.status.addItems(ccs.STATUSES)
        make_searchable(self.status, "")
        self.tags = QLineEdit(); self.tags.setPlaceholderText("مثال: بلدية، تحصيل، رخصة")
        self.follow = QDateEdit(); self.follow.setCalendarPopup(True); self.follow.setDisplayFormat("yyyy-MM-dd")
        self.follow.setSpecialValueText("بدون متابعة"); self.follow.setMinimumDate(QDate(2000,1,1)); self.follow.setDate(QDate(2000,1,1))
        self.body = QTextEdit(); self.body.setPlaceholderText("اكتب التعليق أو المتابعة هنا..."); self.body.setMinimumHeight(120)
        form.addRow("العميل:", self.customer)
        form.addRow("العقد:", self.contract)
        form.addRow("النوع:", self.kind)
        form.addRow("الأولوية:", self.priority)
        form.addRow("الحالة:", self.status)
        form.addRow("وسوم:", self.tags)
        form.addRow("تاريخ متابعة:", self.follow)
        form.addRow("التعليق:", self.body)
        row = QHBoxLayout(); row.addStretch()
        ok = QPushButton("💾 حفظ"); ok.setObjectName("btnPrimary"); ok.clicked.connect(self._save)
        cancel = QPushButton("✕ إلغاء"); cancel.clicked.connect(self.reject)
        row.addWidget(ok); row.addWidget(cancel); form.addRow(row)
        self._reload_contracts()
        if contract_id:
            self.contract.select_data(contract_id)

    def _reload_contracts(self):
        cid = self.customer.selected_data()
        items = [("— بدون عقد محدد —", None)]
        if cid:
            items += contract_items(customer_id=cid)
        self.contract.set_items(items, auto_select=False)

    def _save(self):
        try:
            cid = self.customer.selected_data()
            if not cid:
                style.error(self, "اختر العميل أولًا."); return
            follow = "" if self.follow.date() == QDate(2000,1,1) else self.follow.date().toString("yyyy-MM-dd")
            ccs.add_comment(cid, self.body.toPlainText(), self.contract.selected_data(),
                            self.kind.currentText(), self.priority.currentText(),
                            self.tags.text(), follow, self.status.currentText())
            style.toast(self.parent() or self, "تم حفظ التعليق")
            self.accept()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


class CommentsCenterPage(QWidget):
    """قائمة مركزية لكل التعليقات مع فلتر ذكي للعقود."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        self.setLayoutDirection(Qt.RightToLeft)
        outer = QVBoxLayout(self); outer.setContentsMargins(16,10,16,8); outer.setSpacing(10)
        from ui.widgets import flow_host
        head_host, head = flow_host(spacing=7)
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        self.title_lbl = QLabel("مركز التعليقات")
        self.title_lbl.setToolTip("مركز التعليقات والمتابعة")
        self.title_lbl.setProperty("pageTitle", True)
        title_col.addWidget(self.title_lbl)
        self.desc_lbl = QLabel("كل تعليقات العملاء والعقود ومتابعاتها — حدد تعليقًا لتغيير حالته")
        self.desc_lbl.setProperty("pageDesc", True)
        title_col.addWidget(self.desc_lbl)
        title_host = QWidget()
        title_host.setObjectName("transparentHost")
        title_host.setLayout(title_col)
        head.addWidget(title_host)
        add = QPushButton("＋ تعليق جديد"); add.setObjectName("btnPrimary"); add.setToolTip("توثيق تعليق أو متابعة جديدة"); add.clicked.connect(self._add)
        head.addWidget(add); outer.addWidget(head_host)
        filters_host, filters = flow_host(spacing=7)
        self.search = QLineEdit(); self.search.setPlaceholderText("بحث في التعليقات/العميل/العقد/الوسوم...")
        from ui.widgets import connect_debounced_text
        connect_debounced_text(self.search, self.refresh, delay_ms=420)
        self.customer = SearchableComboBox(search_only=True); self.customer.set_items([("كل العملاء", None)] + customer_items(), auto_select=False); self.customer.currentIndexChanged.connect(self._customer_changed)
        self.contract = SearchableComboBox(); self.contract.set_items([("كل العقود", None)], auto_select=False); self.contract.currentIndexChanged.connect(self.refresh)
        self.status = QComboBox(); self.status.addItem("كل الحالات", ""); [self.status.addItem(x,x) for x in ccs.STATUSES]; self.status.currentIndexChanged.connect(self.refresh)
        make_searchable(self.status, "")
        self.kind = QComboBox(); self.kind.addItem("كل الأنواع", ""); [self.kind.addItem(x,x) for x in ccs.KINDS]; self.kind.currentIndexChanged.connect(self.refresh)
        make_searchable(self.kind, "")
        self.due = QCheckBox("تحتاج متابعة الآن"); self.due.toggled.connect(self.refresh)
        for w in (self.search, self.customer, self.contract, self.status, self.kind, self.due): filters.addWidget(w)
        outer.addWidget(filters_host)
        self.summary = QLabel(""); self.summary.setProperty("hint", True); outer.addWidget(self.summary)
        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(["التاريخ", "العميل", "العقد", "النوع", "الأولوية", "الحالة", "متابعة", "التعليق"])
        self.table.horizontalHeader().setSectionResizeMode(7, QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False); self.table.setAlternatingRowColors(True); self.table.setWordWrap(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows); self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        outer.addWidget(self.table, 1)
        actions_host, actions = flow_host(spacing=7)
        done = QPushButton("✔ تعليم تم"); done.setObjectName("btnReceipt"); done.setToolTip("تعليم التعليق المحدد كمنجز"); done.clicked.connect(lambda: self._set_status("تم"))
        openb = QPushButton("↩ إعادة فتح"); openb.setProperty("flat", True); openb.setToolTip("إعادة فتح التعليق المحدد"); openb.clicked.connect(lambda: self._set_status("مفتوح"))
        delete = QPushButton("✕ إلغاء/إخفاء"); delete.setProperty("flat", True); delete.setProperty("danger", True); delete.setToolTip("إخفاء التعليق المحدد (يبقى في القاعدة)"); delete.clicked.connect(self._delete)
        actions.addWidget(openb); actions.addWidget(done); actions.addWidget(delete); outer.addWidget(actions_host)
        self.refresh()


    def load_filter(self, customer_id: int | None = None, contract_id: int | None = None):
        """فتح المركز على عميل/عقد محدد من ملف العميل أو مركز العقد."""
        if customer_id:
            self.customer.select_data(customer_id)
            self._customer_changed()
        if contract_id:
            self.contract.select_data(contract_id)
        self.refresh()

    def _customer_changed(self):
        cid = self.customer.selected_data()
        items = [("كل العقود", None)]
        if cid:
            items += contract_items(customer_id=cid)
        self.contract.set_items(items, auto_select=False)
        self.refresh()

    def refresh(self):
        rows = ccs.list_comments(search=self.search.text(), customer_id=self.customer.selected_data(),
                                 contract_id=self.contract.selected_data(), status=self.status.currentData() or "",
                                 kind=self.kind.currentData() or "", due_only=self.due.isChecked())
        sm = ccs.summary(self.customer.selected_data(), self.contract.selected_data())
        self.summary.setText(f"الإجمالي: {sm['total']} · مفتوح: {sm['open']} · عاجل: {sm['urgent']} · متابعة الآن: {sm['due']}")
        self._rows = rows; self.table.setRowCount(len(rows))
        for r, x in enumerate(rows):
            vals = [x.get("created_at",""), x.get("customer_name","") or "—", x.get("contract_number","") or "—",
                    x.get("kind","") or "عام", x.get("priority","") or "عادي", x.get("status","") or "مفتوح",
                    x.get("followup_date","") or "—", x.get("body","")]
            from PySide6.QtGui import QColor
            for c, v in enumerate(vals):
                it = QTableWidgetItem(str(v)); it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if c == 4:
                    it.setForeground(QColor({"عاجل": style.DANGER, "مهم": style.WARN}.get(x.get("priority"), style.MUTED)))
                elif c == 5:
                    it.setForeground(QColor({"تم": style.OK_GREEN, "ملغى": style.DANGER, "مؤجل": style.WARN}.get(x.get("status"), style.INFO)))
                self.table.setItem(r,c,it)
        self.table.resizeRowsToContents()
        self._update_empty_state(len(rows))

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
        if self.search.text().strip():
            text = "لا نتائج مطابقة · جرّب كلمات مختلفة أو امسح البحث"
            btn, slot = "✕ مسح البحث", lambda *_a: (self.search.clear(), self.refresh())
        else:
            text = "لا تعليقات بعد · ابدأ بتوثيق أول متابعة"
            btn, slot = "＋ تعليق جديد", self._add
        self._empty_widget = empty_state(text, btn, slot, icon="✎",
                                            primary=False)
        self.table.setVisible(False)
        lay = self.layout()
        lay.insertWidget(lay.indexOf(self.table), self._empty_widget, 1)

    def _selected(self):
        r = self.table.currentRow()
        return self._rows[r] if 0 <= r < len(getattr(self, '_rows', [])) else None

    def _add(self):
        if CommentDialog(self, self.customer.selected_data(), self.contract.selected_data()).exec() == QDialog.Accepted:
            self.refresh()

    def _set_status(self, status):
        row = self._selected()
        if not row:
            style.info(self, "اختر تعليقًا من الجدول أولاً.")
            return
        ccs.update_meta(row['id'], status=status); self.refresh()

    def _delete(self):
        row = self._selected()
        if not row:
            style.info(self, "اختر تعليقًا من الجدول أولاً.")
            return
        if style.confirm(self, "إلغاء/إخفاء التعليق؟\nلن يتم حذفه من قاعدة البيانات."):
            ccs.soft_delete(row['id'], "من مركز التعليقات"); self.refresh()
