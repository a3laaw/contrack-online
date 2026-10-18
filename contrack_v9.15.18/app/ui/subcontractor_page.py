# -*- coding: utf-8 -*-
"""صفحة مقاول الباطن · ملف كامل مثل صفحة العميل.

التبويبات: نظرة عامة | العقود (Master-Detail)
"""
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QComboBox, QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel,
    QLineEdit, QPushButton, QScrollArea, QSplitter, QStackedWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services import lifecycle_service as lc
from services import contract_service
from ui import style
from ui.widgets import (
    MONEY_ALIGN, ActionBar, EntityHeader, PageNav,
    apply_column_weights, make_searchable, sync_header_alignment,
    connect_debounced_text,
)


def _table(headers: list[str]) -> QTableWidget:
    """إنشاء جدول موحّد."""
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels(headers)
    t.verticalHeader().setVisible(False)
    t.verticalHeader().setDefaultSectionSize(34)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    t.setSelectionMode(QTableWidget.SingleSelection)
    t.setEditTriggers(QTableWidget.NoEditTriggers)
    t.setAlternatingRowColors(True)
    t.setShowGrid(True)
    try:
        t.horizontalHeader().setSectionsMovable(False)
    except Exception:
        pass
    return t


def _fill(table: QTableWidget, rows: list[list], center_from: int = 1,
          colors: dict | None = None, money_cols: tuple = ()):
    """تعبئة جدول."""
    table.setRowCount(len(rows))
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            item = QTableWidgetItem(str(val))
            if c in money_cols:
                item.setTextAlignment(MONEY_ALIGN)
            elif c >= center_from:
                item.setTextAlignment(Qt.AlignCenter)
            if colors and (r, c) in colors:
                item.setForeground(QColor(colors[(r, c)]))
            table.setItem(r, c, item)
    sync_header_alignment(table)


class SubcontractorPage(QWidget):
    """صفحة ملف المقاول · تعمل داخل النافذة الرئيسية."""

    back_requested = Signal()

    _FIELD_H = 28
    _FIELD_SS = (
        f"QLineEdit, QComboBox, QDateEdit, QDoubleSpinBox, QSpinBox {{"
        f" min-height: {_FIELD_H}px; max-height: {_FIELD_H}px;"
        f" padding: 3px 6px; font-size: 11px;"
        f" border: 0.5px solid #D1D5DB; border-radius: 6px;"
        f" background: #F9FAFB; color: #111827; }}"
        f" QLineEdit:focus, QComboBox:focus, QDateEdit:focus,"
        f" QDoubleSpinBox:focus, QSpinBox:focus {{"
        f" border-color: #2563EB; background: #FFFFFF; }}"
    )

    def __init__(self, parent=None, sub_id: int = None):
        super().__init__(parent)
        self._sub_id = sub_id
        self._sub_data = None
        self._contracts = []
        self._payments = []
        self._build_ui()
        if sub_id:
            self.load_subcontractor(sub_id)

    def _build_ui(self):
        """بناء واجهة الصفحة."""
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── شريط العنوان + زر رجوع ──────────────────────────────
        header_row = QHBoxLayout()
        header_row.setContentsMargins(8, 4, 8, 4)
        header_row.setSpacing(8)

        back_btn = QPushButton("← رجوع")
        back_btn.setProperty("flat", True)
        back_btn.setProperty("compact", True)
        back_btn.setCursor(Qt.PointingHandCursor)
        back_btn.clicked.connect(self.back_requested.emit)
        header_row.addWidget(back_btn)

        self.header = EntityHeader()
        self.header.set_title("👷 ملف المقاول")
        self.header.set_subtitle("—")
        header_row.addWidget(self.header, 1)
        root.addLayout(header_row)

        # ── شريط التنقل (تبويبات) ────────────────────────────────
        self.nav = PageNav([
            ("المقاول", "", [
                ("overview", "نظرة عامة"),
                ("contracts", "العقود والدفعات"),
                ("addendums", "الأوامر التغييرية"),
            ]),
        ])
        self.nav.page_changed.connect(self._on_tab_changed)
        root.addWidget(self.nav)

        # ── المحتوى ──────────────────────────────────────────────
        self.stack = QStackedWidget()
        self.stack.setObjectName("transparentHost")
        root.addWidget(self.stack, 1)

        self._build_overview_page()
        self._build_contracts_page()
        self._build_addendums_page()

        # ── شريط الإجراءات ──────────────────────────────────────
        self.actions = ActionBar()
        self.actions.add("➕ عقد جديد", slot=self._new_contract, prop="btnPrimary")
        self.actions.add("💰 سند صرف", slot=self._new_voucher, prop="btnGhost")
        self.actions.add("✏️ تعديل بيانات", slot=self._edit_sub, prop="btnGhost")
        root.addWidget(self.actions)

    # ================================================================
    #  TAB 1: نظرة عامة
    # ================================================================
    def _build_overview_page(self):
        page = QWidget()
        page.setObjectName("transparentHost")
        lay = QVBoxLayout(page)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(8)

        # بطاقة الملخص المالي
        summary_card = QFrame()
        summary_card.setStyleSheet(
            "QFrame { background: #FFFFFF; border: 0.5px solid #E5E7EB;"
            " border-radius: 8px; }")
        sg = QGridLayout(summary_card)
        sg.setContentsMargins(8, 6, 8, 6)
        sg.setHorizontalSpacing(12)
        sg.setVerticalSpacing(4)

        self._lbl_total = QLabel("الإجمالي: 0.000 د.ك")
        self._lbl_total.setStyleSheet("font-weight: 700; font-size: 12px;")
        self._lbl_paid = QLabel("المدفوع: 0.000 د.ك")
        self._lbl_paid.setStyleSheet("font-weight: 600; color: #059669; font-size: 11px;")
        self._lbl_remaining = QLabel("المتبقي: 0.000 د.ك")
        self._lbl_remaining.setStyleSheet("font-weight: 600; color: #DC2626; font-size: 11px;")
        self._lbl_count = QLabel("العقود: 0")
        self._lbl_count.setStyleSheet("font-weight: 600; font-size: 11px;")

        sg.addWidget(QLabel("📊 الملخص المالي"), 0, 0, 1, 4)
        sg.addWidget(self._lbl_total, 1, 0)
        sg.addWidget(self._lbl_paid, 1, 1)
        sg.addWidget(self._lbl_remaining, 1, 2)
        sg.addWidget(self._lbl_count, 1, 3)
        lay.addWidget(summary_card)

        # جدول العقود الأخيرة
        cl = QLabel("📋 العقود المرتبطة")
        cl.setStyleSheet("font-weight: 700; font-size: 11px;")
        lay.addWidget(cl)
        self._recent_table = _table(["#", "رقم العقد", "العميل", "القيمة", "الحالة"])
        apply_column_weights(self._recent_table, [5, 20, 30, 25, 20])
        lay.addWidget(self._recent_table, 1)

        # جدول الدفعات القادمة
        pl = QLabel("💰 الدفعات الأخيرة")
        pl.setStyleSheet("font-weight: 700; font-size: 11px;")
        lay.addWidget(pl)
        self._upcoming_table = _table(["#", "الدفعة", "العقد", "المبلغ", "التاريخ", "الحالة"])
        apply_column_weights(self._upcoming_table, [5, 25, 20, 20, 15, 15])
        lay.addWidget(self._upcoming_table, 1)

        self.stack.addWidget(page)

    # ================================================================
    #  TAB 2: العقود والدفعات (Master-Detail)
    # ================================================================
    def _build_contracts_page(self):
        page = QWidget()
        page.setObjectName("transparentHost")
        lay = QVBoxLayout(page)
        lay.setContentsMargins(0, 4, 0, 0)
        lay.setSpacing(4)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.setHandleWidth(2)

        # ── يسار: قائمة العقود ──────────────────────────────────
        side = QFrame()
        side.setProperty("card", True)
        side.setMinimumWidth(300)
        side.setMaximumWidth(500)
        side_lay = QVBoxLayout(side)
        side_lay.setContentsMargins(10, 8, 10, 8)
        side_lay.setSpacing(6)

        side_title = QLabel("عقود المقاول")
        side_title.setProperty("sectionTitle", True)
        side_lay.addWidget(side_title)

        # بحث + فلتر
        self._con_search = QLineEdit()
        self._con_search.setPlaceholderText("بحث برقم العقد أو اسم العميل...")
        self._con_search.setClearButtonEnabled(True)
        self._con_search.setStyleSheet(self._FIELD_SS)
        connect_debounced_text(self._con_search, self._refresh_contracts, delay_ms=400)

        self._con_filter = QComboBox()
        self._con_filter.setStyleSheet(self._FIELD_SS)
        self._con_filter.addItem("كل العقود", "all")
        self._con_filter.addItem("النشطة فقط", "active")
        self._con_filter.addItem("المغلقة", "closed")
        make_searchable(self._con_filter, "")
        self._con_filter.currentIndexChanged.connect(lambda: self._refresh_contracts())

        side_lay.addWidget(self._con_search)
        side_lay.addWidget(self._con_filter)

        # جدول العقود (مثل ملف العميل)
        self._contracts_table = _table(
            ["#", "رقم العقد", "العميل", "القيمة", "المدفوع", "المتبقي", "الحالة"])
        apply_column_weights(self._contracts_table,
                             [4, 16, 24, 14, 14, 14, 14],
                             min_widths=[30, 90, 120, 80, 80, 80, 60],
                             content_cols=(3, 4, 5))
        self._contracts_table.setSelectionBehavior(QTableWidget.SelectRows)
        self._contracts_table.setSelectionMode(QTableWidget.SingleSelection)
        self._contracts_table.itemSelectionChanged.connect(self._on_contract_selected)
        side_lay.addWidget(self._contracts_table, 1)

        # ملخص العقود
        self._con_summary = QLabel("")
        self._con_summary.setProperty("hint", True)
        side_lay.addWidget(self._con_summary)

        splitter.addWidget(side)

        # ── يمين: دفعات العقد المختار ───────────────────────────
        detail = QFrame()
        detail.setProperty("card", True)
        detail_lay = QVBoxLayout(detail)
        detail_lay.setContentsMargins(10, 8, 10, 8)
        detail_lay.setSpacing(6)

        # عنوان + placeholder
        self._pay_title = QLabel("💰 دفعات العقد")
        self._pay_title.setStyleSheet("font-weight: 700; font-size: 12px;")
        detail_lay.addWidget(self._pay_title)

        self._no_contract_lbl = QLabel("اختر عقدًا من القائمة لعرض دفعاته هنا.")
        self._no_contract_lbl.setAlignment(Qt.AlignCenter)
        self._no_contract_lbl.setProperty("hint", True)
        detail_lay.addWidget(self._no_contract_lbl)

        # كتل الدفعات المشتركة مع العميل (نفس جدول شاشة العقد)
        self._blocks_scroll = QScrollArea()
        self._blocks_scroll.setWidgetResizable(True)
        self._blocks_scroll.setFrameShape(QFrame.NoFrame)
        self._blocks_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._blocks_host = QWidget()
        self._blocks_host.setObjectName("transparentHost")
        self._blocks_lay = QVBoxLayout(self._blocks_host)
        self._blocks_lay.setContentsMargins(0, 0, 0, 0)
        self._blocks_lay.setSpacing(10)
        self._blocks_lay.addStretch(1)
        self._blocks_scroll.setWidget(self._blocks_host)
        self._blocks_scroll.setVisible(False)
        detail_lay.addWidget(self._blocks_scroll, 1)

        splitter.addWidget(detail)
        splitter.setSizes([450, 700])

        lay.addWidget(splitter, 1)
        self.stack.addWidget(page)

    # ================================================================
    #  TAB 3: الأوامر التغييرية
    # ================================================================
    def _build_addendums_page(self):
        """الأوامر التغييرية — نسخة من contract_hub._tab_addendums."""
        from PySide6.QtWidgets import QTabWidget as _TabW
        page = QWidget()
        page.setObjectName("transparentHost")
        lay = QVBoxLayout(page)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(8)

        # العنوان
        bar = QHBoxLayout()
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        self._adx_value_lbl = QLabel("")
        self._adx_value_lbl.setProperty("sectionTitle", True)
        title_col.addWidget(self._adx_value_lbl)
        add_desc = QLabel("الأوامر التغييرية والعقود الإضافية")
        add_desc.setProperty("pageDesc", True)
        title_col.addWidget(add_desc)
        bar.addLayout(title_col)
        bar.addStretch()
        lay.addLayout(bar)

        # تابان: العميل / المقاول
        self._adx_tabs = _TabW()
        self._adx_tabs.setLayoutDirection(Qt.RightToLeft)

        # --- تاب العميل ---
        cli_page = QWidget()
        cli_page.setObjectName("transparentHost")
        cli_lay = QVBoxLayout(cli_page)
        cli_lay.setContentsMargins(0, 4, 0, 0)
        cli_lay.setSpacing(6)
        self._cli_add_table = _table(
            ["الرقم", "النوع", "التاريخ", "السبب", "زيادة", "خصم",
             "الصافي", "بنود", "مُنفَّذ", "الحالة"])
        cli_lay.addWidget(self._cli_add_table, 1)
        self._adx_tabs.addTab(cli_page, "👤 العميل")

        # --- تاب المقاول ---
        sub_page = QWidget()
        sub_page.setObjectName("transparentHost")
        sub_lay = QVBoxLayout(sub_page)
        sub_lay.setContentsMargins(0, 4, 0, 0)
        sub_lay.setSpacing(6)
        self._sub_add_table = _table(
            ["الرقم", "النوع", "المقاول", "التاريخ", "السبب", "زيادة", "خصم",
             "الصافي", "بنود", "الحالة"])
        sub_lay.addWidget(self._sub_add_table, 1)
        self._adx_tabs.addTab(sub_page, "🔨 المقاول")

        lay.addWidget(self._adx_tabs, 1)
        self.stack.addWidget(page)

    def _refresh_addendums(self):
        """تحديث جداول الأوامر التغييرية."""
        if not self._sub_id:
            return
        try:
            from services import addendum_service as adx
            # الأوامر التغييرية المرتبطة بعقود هذا المقاول
            sub_con_ids = [c.get("id") for c in self._contracts if c.get("id")]
            if not sub_con_ids:
                _fill(self._cli_add_table, [])
                _fill(self._sub_add_table, [])
                self._adx_value_lbl.setText("لا توجد أوامر تغييرية")
                return
            all_addendums = []
            for cid in sub_con_ids:
                try:
                    items = adx.list_addendums(cid) or []
                    all_addendums.extend(items)
                except Exception:
                    pass
            cli_rows = []
            sub_rows = []
            cli_total = 0.0
            sub_total = 0.0
            for a in all_addendums:
                side = (a.get("side") or "").strip()
                net = float(a.get("net_total") or 0)
                row_data = [
                    str(a.get("id", "")),
                    a.get("type_name", ""),
                    a.get("created_at", "")[:10],
                    a.get("reason", "")[:40],
                    f"{float(a.get('increase_total') or 0):,.3f}",
                    f"{float(a.get('decrease_total') or 0):,.3f}",
                    f"{net:,.3f}",
                    str(a.get("part_count", 0)),
                    "✔" if a.get("executed") else "—",
                    a.get("status", ""),
                ]
                if side == "client":
                    cli_rows.append(row_data)
                    cli_total += net
                else:
                    sub_rows.append(row_data)
                    sub_total += net
            _fill(self._cli_add_table, cli_rows, money_cols=(4, 5, 6))
            _fill(self._sub_add_table, sub_rows, money_cols=(4, 5, 6))
            self._adx_value_lbl.setText(
                f"العميل: {cli_total:,.3f} د.ك · المقاول: {sub_total:,.3f} د.ك")
        except Exception:
            _fill(self._cli_add_table, [])
            _fill(self._sub_add_table, [])
            self._adx_value_lbl.setText("الأوامر التغييرية")

    # ================================================================
    #  التحميل والتحديث
    # ================================================================
    def _on_tab_changed(self, tab_id: str):
        if tab_id == "overview":
            self.stack.setCurrentIndex(0)
        elif tab_id == "contracts":
            self.stack.setCurrentIndex(1)
        elif tab_id == "addendums":
            self.stack.setCurrentIndex(2)
            self._refresh_addendums()

    def load_subcontractor(self, sub_id: int):
        self._sub_id = sub_id
        try:
            self._sub_data = lc.get_subcontractor(sub_id)
        except Exception:
            self._sub_data = None
        if not self._sub_data:
            return
        name = self._sub_data.get("name", "")
        code = self._sub_data.get("sub_code", "")
        self.header.set_title(f"👷 {name}")
        self.header.set_subtitle(f"كود: {code}")
        self._load_all_data()

    def _load_all_data(self):
        if not self._sub_id:
            return
        # تحميل العقود
        try:
            self._contracts = lc.get_sub_contracts(self._sub_id) or []
        except Exception:
            self._contracts = []
        # تحميل الدفعات
        try:
            self._payments = lc.get_sub_payments(self._sub_id) or []
        except Exception:
            self._payments = []

        self._fill_overview()
        self._refresh_contracts()

    def _fill_overview(self):
        """تعبئة تبويب نظرة عامة."""
        # العقود الأخيرة
        rows = []
        for i, c in enumerate(self._contracts[:8], 1):
            rows.append([
                str(i),
                c.get("contract_number", ""),
                c.get("customer_name", ""),
                f"{c.get('amount', 0):,.3f}",
                c.get("status", "نشط"),
            ])
        _fill(self._recent_table, rows, money_cols=(3,))

        # الدفعات الأخيرة
        pay_rows = []
        for i, p in enumerate(self._payments[:8], 1):
            pay_rows.append([
                str(i),
                p.get("title", ""),
                p.get("contract_number", ""),
                f"{p.get('amount', 0):,.3f}",
                p.get("due_date", ""),
                p.get("status", ""),
            ])
        _fill(self._upcoming_table, pay_rows, money_cols=(3,))

        # الملخص
        total = sum(float(c.get("amount", 0)) for c in self._contracts)
        paid = sum(float(c.get("paid_amount", 0)) for c in self._contracts)
        remaining = total - paid
        self._lbl_total.setText(f"الإجمالي: {total:,.3f} د.ك")
        self._lbl_paid.setText(f"المدفوع: {paid:,.3f} د.ك")
        self._lbl_remaining.setText(f"المتبقي: {remaining:,.3f} د.ك")
        self._lbl_count.setText(f"العقود: {len(self._contracts)}")

    def _refresh_contracts(self):
        """تعبئة جدول العقود مع البحث والفلتر."""
        items = list(self._contracts)
        query = self._con_search.text().strip()
        if query:
            items = [c for c in items
                     if query in (c.get("contract_number") or "")
                     or query in (c.get("customer_name") or "")]
        key = self._con_filter.currentData()
        if key == "active":
            items = [c for c in items if (c.get("status") or "نشط") in ("نشط", "")]
        elif key == "closed":
            items = [c for c in items if (c.get("status") or "") in ("منتهي", "مغلق", "ملغى")]

        self._filtered_contracts = items
        rows = []
        colors = {}
        for i, c in enumerate(items):
            paid = float(c.get("paid_amount", 0))
            amount = float(c.get("amount", 0))
            remaining = amount - paid
            status = c.get("status", "نشط") or "نشط"
            rows.append([
                str(i + 1),
                c.get("contract_number", ""),
                c.get("customer_name", ""),
                f"{amount:,.3f}",
                f"{paid:,.3f}",
                f"{remaining:,.3f}",
                status,
            ])
            # لون المتبقي
            if remaining > 0.001:
                colors[(i, 5)] = style.MONEY_REMAIN
            # لون الحالة
            if status in ("منتهي", "مغلق"):
                colors[(i, 6)] = "#6B7280"
            elif status == "ملغى":
                colors[(i, 6)] = "#DC2626"

        _fill(self._contracts_table, rows, colors=colors, money_cols=(3, 4, 5))
        total = sum(float(c.get("amount", 0)) for c in items
                     if (c.get("status") or "نشط") != "ملغى")
        paid = sum(float(c.get("paid_amount", 0)) for c in items)
        self._con_summary.setText(
            f"المعروض: {len(items)} عقد · المتبقي {total - paid:,.3f} د.ك")
        # إعادة بناء كتلة الدفعات للصف المحدد: إعادة التعبئة لا تُطلق
        # إشارة تغيير الاختيار، فتبقى الحالات القديمة ظاهرة بعد تحديث البيانات.
        self._on_contract_selected()

    def _clear_blocks(self):
        """إزالة كتل العقد السابقة قبل بناء الجديدة."""
        while self._blocks_lay.count() > 1:
            item = self._blocks_lay.takeAt(0)
            w = item.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()

    @staticmethod
    def _fit_height(t):
        """ارتفاع الجدول = ارتفاع محتواه (نفس منطق شاشة العقد)."""
        try:
            t.resizeRowsToContents()
            h = t.horizontalHeader().height() + 6
            for r in range(t.rowCount()):
                h += t.rowHeight(r)
            t.setFixedHeight(max(72, min(620, h + 6)))
        except Exception:
            pass

    def _on_contract_selected(self):
        """عند اختيار عقد الباطن — جدول دفعاته المشتركة مع العميل (مثل شاشة العقد)."""
        from ui import sub_pay_blocks as spb
        row = self._contracts_table.currentRow()
        self._clear_blocks()
        if row < 0 or row >= len(getattr(self, "_filtered_contracts", [])):
            self._blocks_scroll.setVisible(False)
            self._no_contract_lbl.setVisible(True)
            self._pay_title.setText("💰 دفعات العقد")
            return

        con = self._filtered_contracts[row]
        self._no_contract_lbl.setVisible(False)
        self._blocks_scroll.setVisible(True)
        self._pay_title.setText(f"💰 دفعات: {con.get('contract_number', '')}")

        cid = int(con.get("contract_id") or 0)
        sc_id = int(con.get("id") or 0)
        try:
            d = spb.sub_contract_data(cid, sc_id)
        except Exception as ex:
            lbl = QLabel(f"تعذّر تحميل دفعات العقد: {ex}")
            lbl.setProperty("hint", True)
            lbl.setWordWrap(True)
            self._blocks_lay.insertWidget(0, lbl)
            return

        c_name = (con.get("customer_name") or "").strip()
        sub_name = d["sub_name"] or ""

        # عنوان الكتلة
        head = QLabel(f"👤 العميل · {c_name}      🔨 المقاول · {sub_name}")
        head.setStyleSheet("font-weight: 700; font-size: 12px; color: #374151;")
        head.setWordWrap(True)
        self._blocks_lay.insertWidget(self._blocks_lay.count() - 1, head)

        # الجدول الموحّد (نفس شاشة العقد)
        t, c_tot, c_paid, s_tot, s_paid = spb.build_unified_table(
            plan_by_id=d["plan_by_id"], client_no=d["client_no"],
            shared_ids=d["shared_ids"], c_name=c_name, sub_name=sub_name,
            lines=d["lines"], src=d["src"], nums=d["nums"],
            sub_cancelled=d["cancelled"])
        self._fit_height(t)
        t.horizontalHeader().setStretchLastSection(False)
        self._blocks_lay.insertWidget(self._blocks_lay.count() - 1, t)

        # ملخص الكتلة
        summ = QLabel(
            f"العميل: {c_tot:,.3f} د.ك · مسدّد {c_paid:,.3f} · "
            f"المقاول: {s_tot:,.3f} د.ك · مسدّد {s_paid:,.3f}")
        summ.setStyleSheet("font-weight: 700; font-size: 11px;")
        summ.setWordWrap(True)
        self._blocks_lay.insertWidget(self._blocks_lay.count() - 1, summ)

        # بنود العقد المرتبطة بهذا العقد الباطن
        text, it, _tot = spb.build_items_table(d["mine_ids"], d["item_by_id"])
        if it is not None:
            lbl = QLabel(text)
            lbl.setProperty("hint", True)
            lbl.setWordWrap(True)
            self._blocks_lay.insertWidget(self._blocks_lay.count() - 1, lbl)
            self._fit_height(it)
            self._blocks_lay.insertWidget(self._blocks_lay.count() - 1, it)

    # ================================================================
    #  الإجراءات
    # ================================================================
    def _new_contract(self):
        if not self._sub_id:
            return
        try:
            from ui.subcontractors import LinkSubContractDialog
            dlg = LinkSubContractDialog(self, preset_sub_id=self._sub_id)
            dlg.exec()
            self._load_all_data()
        except Exception as e:
            style.error(self, f"خطأ في إنشاء العقد: {e}")

    def _new_voucher(self):
        """سند صرف لهذا المقاول — يُعبَّأ عقد الباطن المختار إن وُجد."""
        if not self._sub_id:
            return
        try:
            from ui.actions import open_voucher
            cid = sc_id = None
            row = self._contracts_table.currentRow()
            if 0 <= row < len(getattr(self, "_filtered_contracts", [])):
                con = self._filtered_contracts[row]
                sc_id = int(con.get("id") or 0) or None
                cid = int(con.get("contract_id") or 0) or None
            open_voucher(self, "payment", contract_id=cid,
                         on_saved=self._load_all_data,
                         subcontractor_id=self._sub_id,
                         sub_contract_id=sc_id)
        except Exception as e:
            style.error(self, f"خطأ في إنشاء السند: {e}")

    def _edit_sub(self):
        if not self._sub_id or not self._sub_data:
            return
        try:
            from ui.subcontractors import SubcontractorDialog
            dlg = SubcontractorDialog(self, sub=self._sub_data)
            dlg.exec()
            self.load_subcontractor(self._sub_id)
        except Exception as e:
            style.error(self, f"خطأ في تعديل المقاول: {e}")
