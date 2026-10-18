# -*- coding: utf-8 -*-
"""شاشة كشف الحساب: شامل لكل عقود العميل مع فلتر عقد."""
from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QComboBox, QFrame, QHBoxLayout, QHeaderView, QLabel,
    QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError
from services import contract_service, customer_service, settings_service, statement_service
from services.customer_service import ValidationError
from ui import style
from ui.widgets import SearchableComboBox, SegmentedTabs

try:
    from ui.widgets import SafeDateEdit
except Exception:
    from PySide6.QtWidgets import QDateEdit as SafeDateEdit


class StatementPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        self._data = None
        self._party = "customer"  # customer = عميل · sub = مقاول باطن
        self._mode = "full"  # شامل دائمًا (عقد واحد أُلغي — الفلتر يغطيه)
        self._period = ("", "")
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 10, 16, 8)
        layout.setSpacing(10)

        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title = QLabel("كشف الحساب")
        title.setProperty("pageTitle", True)
        title_col.addWidget(title)
        layout.addLayout(title_col)

        # اختيار العميل والعقد والفترة · تخطيط ملتف يناسب الشاشات الضيقة
        from ui.widgets import flow_host
        selectors_host, selectors = flow_host(spacing=8)
        self.party_tabs = SegmentedTabs()
        self.party_tabs.addItem("عميل", "customer")
        self.party_tabs.addItem("مقاول باطن", "sub")
        self.party_tabs.setCurrentData("customer")
        selectors.addWidget(self.party_tabs)
        self.customer_lbl = QLabel("العميل:")
        selectors.addWidget(self.customer_lbl)
        self.customer = SearchableComboBox(search_only=True)
        self.customer.setMinimumWidth(200)
        self.customer.setMaximumWidth(320)
        selectors.addWidget(self.customer)
        self.sub_lbl = QLabel("المقاول:")
        selectors.addWidget(self.sub_lbl)
        self.subcontractor = SearchableComboBox(search_only=True)
        self.subcontractor.setMinimumWidth(200)
        self.subcontractor.setMaximumWidth(320)
        selectors.addWidget(self.subcontractor)
        self.contract_lbl = QLabel("العقد:")
        selectors.addWidget(self.contract_lbl)
        self.contract = SearchableComboBox(open_on_click=True)
        self.contract.setMinimumWidth(200)
        self.contract.setMaximumWidth(320)
        selectors.addWidget(self.contract)
        self.sub_lbl.setVisible(False)
        self.subcontractor.setVisible(False)
        selectors.addWidget(QLabel("الفترة:"))
        self.period = QComboBox()
        self.period.addItems(["كل الفترات", "هذا الشهر", "الربع الحالي",
                              "هذه السنة", "فترة مخصصة"])
        self.period.setMinimumWidth(130)
        selectors.addWidget(self.period)
        self.date_from = SafeDateEdit()
        self.date_from.setCalendarPopup(True)
        self.date_from.setDisplayFormat("yyyy-MM-dd")
        self.date_to = SafeDateEdit()
        self.date_to.setCalendarPopup(True)
        self.date_to.setDisplayFormat("yyyy-MM-dd")
        self.date_from.setDate(QDate.currentDate())
        self.date_to.setDate(QDate.currentDate())
        selectors.addWidget(QLabel("من:"))
        selectors.addWidget(self.date_from)
        selectors.addWidget(QLabel("إلى:"))
        selectors.addWidget(self.date_to)

        self.excel_btn = QPushButton("📤 تصدير Excel")
        self.excel_btn.setProperty("flat", True)
        self.excel_btn.clicked.connect(self._export_excel)
        selectors.addWidget(self.excel_btn)
        self.print_btn = QPushButton("🖨 معاينة / طباعة كشف الحساب")
        self.print_btn.setObjectName("btnPrimary")
        self.print_btn.setToolTip(
            "معاينة كشف الحساب · ومن المعاينة: طباعة أو حفظ PDF")
        self.print_btn.clicked.connect(self._print)
        # الطباعة لمن يملك تأشيرتها (صلاحيات دقيقة · المدير دائمًا)
        from services import auth_service as _auth
        if _auth.has_permission("action_print_statement"):
            selectors.addWidget(self.print_btn)
        layout.addWidget(selectors_host)

        # بطاقة معلومات العقد
        self.info_card = QFrame()
        self.info_card.setProperty("card", True)
        info_layout = QHBoxLayout(self.info_card)
        info_layout.setContentsMargins(18, 12, 18, 12)
        self.lbl_customer = QLabel("-", self)
        self.lbl_contract = QLabel("-", self)
        self.lbl_amount = QLabel("-", self)
        for lbl in (self.lbl_customer, self.lbl_contract, self.lbl_amount):
            info_layout.addWidget(lbl)
            info_layout.addStretch()
        layout.addWidget(self.info_card)

        # جدول الحركة بصيغة مدين / دائن
        self.table = QTableWidget(0, 7)
        self._setup_columns()
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(True)
        self.table.verticalHeader().setDefaultSectionSize(42)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        from ui.style import soft_shadow
        soft_shadow(self.table, radius=32, y=8)
        self.table.cellDoubleClicked.connect(self._open_ref)
        hint_click = QLabel("💡 نقرة مزدوجة على سطر فاتورة/سند لفتحه · وعلى سطر العقد لفتح مركزه")
        hint_click.setProperty("hint", True)
        layout.addWidget(self.table, 1)
        layout.addWidget(hint_click)

        # الإجماليات
        totals = QFrame()
        totals.setProperty("card", True)
        totals_layout = QHBoxLayout(totals)
        totals_layout.setContentsMargins(18, 12, 18, 12)
        self.lbl_total_contract = QLabel("-", self)
        self.lbl_total_invoiced = QLabel("-", self)
        self.lbl_remaining = QLabel("-", self)
        self.lbl_remaining.setStyleSheet(
            f"color: {style.GREEN}; font-weight: bold; font-size: 12.8px;")
        for lbl in (self.lbl_total_contract, self.lbl_total_invoiced,
                    self.lbl_remaining):
            totals_layout.addWidget(lbl)
            totals_layout.addStretch()
        layout.addWidget(totals)

        self.customer.selection_changed.connect(self._customer_changed)
        self.subcontractor.selection_changed.connect(self._load_statement)
        self.contract.selection_changed.connect(self._load_statement)
        self.party_tabs.currentIndexChanged.connect(self._party_changed)
        self.period.currentIndexChanged.connect(self._period_changed)
        self.date_from.dateChanged.connect(self._custom_period)
        self.date_to.dateChanged.connect(self._custom_period)
        self._period_changed(0)

    def _setup_columns(self):
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels(
            ["التاريخ", "العقد", "البيان", "المرجع", "مدين", "دائن",
             "الرصيد"])
        _h = self.table.horizontalHeader()
        _h.setSectionResizeMode(QHeaderView.Stretch)
        _h.setStretchLastSection(False)
        self.table.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)

    # ---------- الوضع والفترة ----------
    def _period_changed(self, index: int):
        today = QDate.currentDate()
        if index == 1:  # هذا الشهر
            start = QDate(today.year(), today.month(), 1)
            self._set_period(start, today)
        elif index == 2:  # الربع الحالي
            qm = ((today.month() - 1) // 3) * 3 + 1
            self._set_period(QDate(today.year(), qm, 1), today)
        elif index == 3:  # هذه السنة
            self._set_period(QDate(today.year(), 1, 1), today)
        elif index == 4:  # مخصصة
            self.date_from.setEnabled(True)
            self.date_to.setEnabled(True)
            self._custom_period()
            return
        else:  # كل الفترات
            self.date_from.setEnabled(False)
            self.date_to.setEnabled(False)
            self._period = ("", "")
            self._load_statement()
            return
        self.date_from.setEnabled(False)
        self.date_to.setEnabled(False)

    def _set_period(self, start: QDate, end: QDate):
        self.date_from.blockSignals(True)
        self.date_to.blockSignals(True)
        self.date_from.setDate(start)
        self.date_to.setDate(end)
        self.date_from.blockSignals(False)
        self.date_to.blockSignals(False)
        self._period = (start.toString("yyyy-MM-dd"),
                        end.toString("yyyy-MM-dd"))
        self._load_statement()

    def _custom_period(self, *_args):
        if self.period.currentIndex() != 4:
            return
        start = self.date_from.date().toString("yyyy-MM-dd")
        end = self.date_to.date().toString("yyyy-MM-dd")
        if start > end:
            start, end = end, start
        self._period = (start, end)
        self._load_statement()

    # ---------- تعبئة القوائم ----------
    def refresh(self, preselect_customer: int | None = None):
        current = preselect_customer or self.customer.selected_data()
        from ui.widgets import customer_items
        items = customer_items()
        self.customer.blockSignals(True)
        # لا اختيار تلقائي · يبدأ الكشف فارغًا حتى يختار المستخدم العميل
        self.customer.set_items(items, auto_select=False)
        if current:
            self.customer.select_data(current)
        self.customer.blockSignals(False)
        self._customer_changed()

    def select_customer(self, customer_id: int):
        if self._party != "customer":
            self.party_tabs.setCurrentData("customer")
        self.refresh(preselect_customer=customer_id)

    def select_subcontractor(self, sub_id: int):
        """V5.4: فتح الكشف على مقاول باطن محدد (من الزر الأيمن)."""
        if self._party != "sub":
            self.party_tabs.setCurrentData("sub")
            self._party = "sub"
        self._party_changed(0)
        try:
            self.subcontractor.select_data(int(sub_id))
        except Exception:
            from ui.widgets import subcontractor_items
            self.subcontractor.set_items(subcontractor_items(),
                                         auto_select=False)
            self.subcontractor.select_data(int(sub_id))
        self._load_statement()

    def _party_changed(self, _index: int):
        self._party = self.party_tabs.currentData() or "customer"
        is_cust = self._party == "customer"
        self.customer_lbl.setVisible(is_cust)
        self.customer.setVisible(is_cust)
        self.contract_lbl.setVisible(is_cust)
        self.contract.setVisible(is_cust)
        self.sub_lbl.setVisible(not is_cust)
        self.subcontractor.setVisible(not is_cust)
        if hasattr(self, "print_btn"):
            self.print_btn.setVisible(is_cust)
        if is_cust:
            self._setup_columns()
        if not is_cust:
            from ui.widgets import subcontractor_items
            self.subcontractor.blockSignals(True)
            self.subcontractor.set_items(subcontractor_items(),
                                         auto_select=False)
            self.subcontractor.blockSignals(False)
            self.table.setColumnCount(7)
            self.table.setHorizontalHeaderLabels(
                ["التاريخ", "العقد", "البيان", "المرجع", "مدين", "دائن",
                 "الرصيد"])
        self._load_statement()

    def _customer_changed(self):
        cid = self.customer.selected_data()
        items = []
        if cid:
            cust = self.customer.currentText().strip()
            items.append(("كل العقود", -1))
            for c in contract_service.list_contracts(customer_id=cid):
                cname = getattr(c, "contract_name", "") or c.description or ""
                core = (f"{c.contract_number} · {cname}"
                        if cname else c.contract_number)
                display = f"{cust} — {core}" if cust else core
                items.append((display, c.id, f"{c.amount:,.3f}"))
        self.contract.blockSignals(True)
        # الخانة تبدأ فارغة — المستخدم يختار العقد صراحة
        self.contract.set_items(items, auto_select=False)
        self.contract.blockSignals(False)
        self._load_statement()

    def _selected_contract_filter(self):
        sel = self.contract.selected_data()
        if sel in (None, -1, "-1"):
            return None
        try:
            return int(sel)
        except (TypeError, ValueError):
            return None

    # ---------- عرض الكشف ----------
    def _clear_labels(self):
        for lbl in (self.lbl_customer, self.lbl_contract, self.lbl_amount,
                    self.lbl_total_contract, self.lbl_total_invoiced,
                    self.lbl_remaining):
            lbl.setText("-")

    def _load_statement(self):
        if self._party == "sub":
            self._load_sub()
        else:
            self._load_full()

        self._update_empty_state()

    def _load_sub(self):
        sid = self.subcontractor.selected_data()
        self.table.setRowCount(0)
        if not sid:
            self._data = None
            self._clear_labels()
            return
        try:
            df, dt = self._period
            self._data = statement_service.build_subcontractor_statement(
                int(sid), df, dt)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return
        d = self._data
        cur = settings_service.get_settings().currency
        sub = d["sub"]
        self.lbl_customer.setText(
            f"المقاول: {sub['name']} ({sub['sub_code']})")
        self.lbl_contract.setText(
            f"النطاق: كل عقود الباطن ({d['contracts_count']})")
        if df or dt:
            self.lbl_amount.setText(f"الفترة: {df or '…'} ← {dt or '…'}")
        else:
            self.lbl_amount.setText("الفترة: الكل")
        self.table.setRowCount(len(d["rows"]))
        for r, row in enumerate(d["rows"]):
            self._paint_row(r, row, True)
        if df:
            self.lbl_total_contract.setText(
                f"رصيد أول الفترة: {d['opening']:,.3f} {cur}")
        else:
            self.lbl_total_contract.setText(
                f"إجمالي المدين: {d['total_debit']:,.3f} {cur}")
        self.lbl_total_invoiced.setText(
            f"إجمالي الدائن: {d['total_credit']:,.3f} {cur}")
        self.lbl_remaining.setText(
            f"الرصيد المتبقي: {d['remaining']:,.3f} {cur}")

    def _update_empty_state(self):
        """حالة الفراغ: توجيه بلا زر (صفحة عرض لا إنشاء)."""
        from ui.widgets import empty_state, dispose_widget as _dispose
        if self.table.rowCount():
            if getattr(self, "_empty_widget", None) is not None:
                _dispose(self._empty_widget, host=self)
                self._empty_widget = None
                self.table.setVisible(True)
            return
        if getattr(self, "_empty_widget", None) is not None:
            _dispose(self._empty_widget, host=self)
        has_party = (self.customer.selected_data()
                     if self._party == "customer"
                     else self.subcontractor.selected_data())
        if not has_party:
            text = ("اختر عميلًا من الأعلى لعرض كشف حسابه"
                    if self._party == "customer"
                    else "اختر مقاولًا من الأعلى لعرض كشف حسابه")
        else:
            text = "لا حركات مطابقة في النطاق والفترة المحددة"
        self._empty_widget = empty_state(text, icon="📊")
        self.table.setVisible(False)
        lay = self.layout()
        lay.insertWidget(lay.indexOf(self.table), self._empty_widget, 1)

    def _paint_row(self, r: int, row: dict, full: bool):
        debit = f"{row['debit']:,.3f}" if row["debit"] else "—"
        credit = f"{row['credit']:,.3f}" if row["credit"] else "—"
        values = [row["date"], row["description"], row["ref"],
                  debit, credit, f"{row['balance']:,.3f}"]
        if full:
            kind = row.get("kind", "move")
            contract_cell = row.get("contract_number") or (
                "—" if kind == "move" else "")
            values.insert(1, contract_cell)
        is_summary = row.get("kind", "move") != "move"
        try:
            tint = QColor(style.theme().get("BRAND_50", "#F1F4FA"))
        except Exception:
            tint = QColor("#F1F4FA")
        for col, val in enumerate(values):
            item = QTableWidgetItem(str(val))
            item.setTextAlignment(Qt.AlignCenter)
            if is_summary:
                font = item.font()
                font.setBold(True)
                item.setFont(font)
                item.setBackground(tint)
            base = 1 if full else 0
            if col == 3 + base and row["debit"]:
                item.setForeground(QColor(style.MONEY_REMAIN))
            elif col == 4 + base and row["credit"]:
                item.setForeground(QColor(style.MONEY_IN))
            elif col == 5 + base:
                item.setForeground(QColor(style.PRIMARY))
            self.table.setItem(r, col, item)

    def _load_full(self):
        cid = self.customer.selected_data()
        self.table.setRowCount(0)
        if not cid:
            self._data = None
            self._clear_labels()
            return
        try:
            cf = self._selected_contract_filter()
            df, dt = self._period
            self._data = statement_service.build_customer_statement(
                cid, cf, df, dt)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))
            return

        d = self._data
        cur = settings_service.get_settings().currency
        self.lbl_customer.setText(
            f"العميل: {d['customer'].name} ({d['customer'].customer_code})")
        if cf and d["contract"] is not None:
            self.lbl_contract.setText(
                f"العقد: {d['contract'].contract_number}")
        else:
            self.lbl_contract.setText(
                f"النطاق: كل العقود ({d['contracts_count']})")
        if df or dt:
            self.lbl_amount.setText(f"الفترة: {df or '…'} ← {dt or '…'}")
        else:
            self.lbl_amount.setText("الفترة: الكل")

        self.table.setRowCount(len(d["rows"]))
        for r, row in enumerate(d["rows"]):
            self._paint_row(r, row, True)

        if df:
            self.lbl_total_contract.setText(
                f"رصيد أول الفترة: {d['opening']:,.3f} {cur}")
        else:
            self.lbl_total_contract.setText(
                f"إجمالي المدين: {d['total_debit']:,.3f} {cur}")
        self.lbl_total_invoiced.setText(
            f"إجمالي الدائن: {d['total_credit']:,.3f} {cur}")
        self.lbl_remaining.setText(f"الرصيد المتبقي: {d['remaining']:,.3f} {cur}")

    def _open_ref(self, row: int, col: int):
        """النقر المزدوج على سطر: المستند المرتبط بأي ترقيم · العقد ← مركزه."""
        if not self._data or row >= len(self._data["rows"]):
            return
        line = self._data["rows"][row]
        if line.get("kind", "move") != "move":
            return
        ref = str(line.get("ref") or "")
        kid = line.get("contract_id") or self._selected_contract_filter()
        if kid:
            _con = contract_service.get_contract(int(kid))
            _con_no = str(getattr(_con, "contract_number", "") or "")
            if ref and _con_no and ref == _con_no:
                from ui.contract_hub import ContractHubPage
                hub = ContractHubPage(self)
                hub.load_contract(int(kid))
                hub.show()
                return
        # بحث بلا بادئات: أي رقم فاتورة/سند (قياسي أو مخصص/مستورد)
        from services import invoice_service
        invoices = [i for i in invoice_service.list_invoices(search=ref)
                    if i.invoice_number == ref]
        if invoices:
            from ui.glass_receipt import GlassReceiptDialog
            inv = invoices[0]
            GlassReceiptDialog(self, {
                "number": inv.invoice_number, "date": inv.invoice_date,
                "party": inv.customer_name, "description": inv.description,
                "contract_number": inv.contract_number,
                "amount": float(inv.amount), "vtype": "invoice",
                "invoice_obj": inv,
            }).exec()
            return
        from services import lifecycle_service as lc
        vouchers = [v for v in lc.list_vouchers(search=ref)
                    if v["voucher_number"] == ref]
        if vouchers:
            from ui.glass_receipt import GlassReceiptDialog
            v = vouchers[0]
            GlassReceiptDialog(self, {
                "number": v["voucher_number"], "date": v["vdate"],
                "party": v["party"], "description": v["description"],
                "contract_number": v.get("contract_number"),
                "amount": float(v["amount"]), "vtype": v["vtype"],
                "raw": v,
            }).exec()
            return
        style.info(self, "هذا السطر بلا مستند مرتبط.")

    # ---------- تصدير وطباعة ----------
    def _make_pdf(self, path: str) -> bool:
        from reports.pdf_utils import PDFError
        from reports.statement_pdf import generate_customer_statement_pdf
        cid = self.customer.selected_data()
        if not cid:
            style.info(self, "الرجاء اختيار العميل أولاً.")
            return False
        try:
            df, dt = self._period
            generate_customer_statement_pdf(
                cid, path, self._selected_contract_filter(), df, dt)
            return True
        except PDFError as exc:
            style.error(self, str(exc))
        except Exception:
            style.error(self, "حدث خطأ غير متوقع أثناء إنشاء ملف PDF.")
        return False

    def _export_excel(self):
        if not self._data:
            style.info(self, "اختر عميلًا أولاً."
                       if self._party == "customer"
                       else "اختر مقاولًا أولاً.")
            return
        from ui.widgets import export_table_excel
        d = self._data
        cur = settings_service.get_settings().currency
        if self._party == "sub":
            rows = [[r["date"], r.get("contract_number") or "",
                     r["description"], r["ref"],
                     float(r["debit"] or 0), float(r["credit"] or 0),
                     float(r["balance"])] for r in d["rows"]]
            tag = f"مقاول_{d['sub']['sub_code']}"
            export_table_excel(
                self, f"كشف حساب · {tag}",
                ["التاريخ", "العقد", "البيان", "المرجع", "مدين", "دائن",
                 "الرصيد"],
                rows, f"كشف_حساب_{tag}",
                number_cols=[4, 5, 6])
            return
        code = d["customer"].customer_code
        rows = [[r["date"], r.get("contract_number") or "",
                 r["description"], r["ref"],
                 float(r["debit"] or 0), float(r["credit"] or 0),
                 float(r["balance"])] for r in d["rows"]]
        if self._selected_contract_filter() and d.get("contract") is not None:
            tag = d["contract"].contract_number
        else:
            tag = f"شامل_{code}"
        export_table_excel(
            self, f"كشف حساب · {tag}",
            ["التاريخ", "العقد", "البيان", "المرجع", "مدين", "دائن",
             "الرصيد"],
            rows, f"كشف_حساب_{tag}",
            number_cols=[4, 5, 6])

    def _print(self):
        """معاينة فورية لكشف الحساب + أرشفة تلقائية في ملف العميل."""
        from services import archive_service
        from ui.pdf_preview import PdfPreviewDialog, make_temp_pdf_path
        if self._party == "sub":
            style.info(self, "طباعة كشف المقاول من تصدير Excel حاليًا.")
            return
        if not self.customer.selected_data():
            style.info(self, "الرجاء اختيار العميل أولاً.")
            return
        customer = customer_service.get_customer(
            self.customer.selected_data())
        cf = self._selected_contract_filter()
        if cf:
            contract = contract_service.get_contract(cf)
            number = contract.contract_number if contract else "statement"
        else:
            number = f"شامل_{customer.customer_code if customer else 'all'}"
        path = make_temp_pdf_path(f"statement_{number}")
        if self._make_pdf(path):
            if customer:
                try:
                    archive_service.save_to_archive(
                        customer, path, f"كشف_حساب_{number}.pdf", overwrite=True)
                except OSError:
                    pass
            dialog = PdfPreviewDialog(
                self, path,
                title=f"كشف حساب · {number}",
                save_name=f"كشف_حساب_{number}.pdf",
                archive_customer=customer)
            dialog.exec()
