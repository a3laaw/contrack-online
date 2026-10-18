# -*- coding: utf-8 -*-
"""شاشة التعاملات · شجرة موحدة: العميل ← عقوده، بدون شاشات منفصلة.

- سطر العميل: ملخصه المالي (إجمالي / محصّل / متبقي)
- تحته عقوده بحالاتها الملونة
- دبل كليك على العقد ← مركز العقد | على العميل ← ملفه الشامل
- زر ＋ جديد ذكي: عميل أو عقد
- العقد هو المشروع: مشروع مطابق يُنشأ تلقائيًا داخل add_contract
"""
from PySide6.QtCore import Qt, Signal, QTimer
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QDialog, QFileDialog, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QMenu, QPushButton, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget,
)

from services.db_facade_service import DatabaseError
from services import contract_service, customer_service
from services import lifecycle_service as lc
from services.customer_service import ValidationError
from ui import style
from ui.style import soft_shadow

# ألوان الحالات مصدرها الوحيد ui/style.py (القاعدة 26) — لا تُعرَّف هنا
STATUS_COLORS = style.STATUS_COLORS


class DealingsPage(QWidget):
    """الشاشة الموحدة: عملاء + عقود (+ مشاريع تلقائية)."""
    data_changed = Signal()
    open_statement = Signal(int)
    open_customer_file = Signal(int)   # يفتحه main_window كصفحة داخلية

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        # سياق شريط الإجراءات؛ يُهيّأ دائمًا حتى لا تفشل الأزرار إذا ضغطت
        # آليًا/بالخطأ قبل وجود صف محدد فعليًا.
        self._sel_kind = ""
        self._sel_id = None
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 10, 16, 8)
        layout.setSpacing(10)

        # ===== الرأس وشريط الأدوات =====
        top = QHBoxLayout()
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        self.title_lbl = QLabel("العملاء")
        self.title_lbl.setProperty("pageTitle", True)
        title_col.addWidget(self.title_lbl)
        self.desc_lbl = QLabel("عملاؤك وعقودهم وقيمهم — حدد عميلًا لفتح ملفه وإجراءاته")
        self.desc_lbl.setProperty("pageDesc", True)
        title_col.addWidget(self.desc_lbl)
        top.addLayout(title_col)
        top.addSpacing(18)

        self.search = QLineEdit()
        self.search.setPlaceholderText("ابحث بالاسم أو الهاتف أو رقم العقد...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(230)
        self.search.setMaximumWidth(420)
        from ui.widgets import connect_debounced_text
        connect_debounced_text(self.search, self._search_changed, delay_ms=420)

        # شرائح التصفية ظاهرة دائمًا (فلتر «عليهم متبقٍ» أداة يومية)
        from ui.widgets import FilterChips, flow_host
        self.chips = FilterChips([
            ("all", "الكل"),
            ("active", "لهم عقود نشطة"),
            ("remaining", "عليهم متبقٍ"),
            ("no_contracts", "بلا عقود"),
        ])
        self.chips.changed.connect(lambda _: self._search_changed())

        # الفرز: أيقونة تفتح قائمة بالخيارات الأربعة
        self._sort_options = [
            ("newest", "الأحدث إضافة أولاً"),
            ("code", "رقم العميل (تصاعدي)"),
            ("name", "الاسم (أبجدي)"),
            ("updated", "آخر تحديث أولاً"),
        ]
        self._sort_key = "newest"
        self.sort_btn = QPushButton("⇅")
        self.sort_btn.setObjectName("iconBtn")
        self.sort_btn.setToolTip("ترتيب قائمة العملاء")
        self.sort_btn.setCursor(Qt.PointingHandCursor)
        self.sort_btn.clicked.connect(self._sort_menu)

        excel_btn = QPushButton("📤")
        excel_btn.setObjectName("iconBtn")
        excel_btn.setToolTip("تصدير قائمة العملاء إلى Excel")
        excel_btn.setCursor(Qt.PointingHandCursor)
        excel_btn.clicked.connect(self._export_excel)

        new_btn = QPushButton("＋ جديد")
        new_btn.setObjectName("btnPrimary")
        new_btn.setCursor(Qt.PointingHandCursor)
        new_btn.setToolTip("عميل جديد أو عقد جديد")
        new_btn.clicked.connect(self._new_menu)

        tools, tools_flow = flow_host(spacing=8)
        for _w in (self.search, self.chips, self.sort_btn, excel_btn, new_btn):
            tools_flow.addWidget(_w)
        top.addWidget(tools, 1)
        layout.addLayout(top)

        # الشجرة
        self.tree = QTreeWidget()
        self.tree.setColumnCount(6)
        self.tree.setHeaderLabels(
            ["العميل", "الهاتف", "العقود", "القيمة", "المحصّل", "المتبقي"])
        # قائمة مسطّحة: صف واحد لكل عميل · عقوده داخل «ملف العميل»
        # (أسرع بكثير: لا استعلام لكل عقد ولا صفوف فرعية)
        self.tree.setRootIsDecorated(False)
        header = self.tree.header()
        # توزيع نسبي يملأ العرض بالكامل: اسم العميل/العقد يأخذ النصيب
        # الأكبر، والأعمدة الرقمية والحالة تتقاسم الباقي، وعمود الملفات
        # (أزرار) يأخذ عرضًا ثابتًا تقريبًا · فلا يظهر تمرير أفقي أبدًا
        from ui.widgets import apply_column_weights
        # عمود الملفات أُلغي · الإجراءات في شريط التحديد وقائمة الزر الأيمن
        apply_column_weights(
            self.tree, [34, 11, 8, 16, 15, 16],
            min_widths=[168, 84, 56, 88, 88, 88])
        self.tree.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        header.setDefaultAlignment(Qt.AlignCenter)
        self.tree.setAlternatingRowColors(True)
        self.tree.setAnimated(True)
        self.tree.setIndentation(28)
        self.tree.setStyleSheet(
            f"QTreeWidget {{ background: {style.theme()['TBL_BG']};"
            f" border: 1.5px solid {style.theme()['GLASS_BORDER']};"
            " border-radius: 16px; }"
            "QTreeWidget::item { padding: 8px 6px; }")
        soft_shadow(self.tree, radius=32, y=8)
        self.tree.itemDoubleClicked.connect(self._double_clicked)
        # كليك يمين على أي صف = قائمة الإجراءات (خاصة صفوف العقود)
        self.tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(
            lambda _: self._actions_menu())
        layout.addWidget(self.tree, 1)

        # ===== شريط إجراءات يظهر عند تحديد صف (بدل أزرار داخل الصفوف) =====
        from ui.widgets import ActionBar
        self.sel_bar_host = QWidget()
        self.sel_bar_host.setObjectName("transparentHost")
        sel_layout = QHBoxLayout(self.sel_bar_host)
        sel_layout.setContentsMargins(0, 0, 0, 0)
        sel_layout.setSpacing(10)
        self.sel_name_lbl = QLabel("")
        self.sel_name_lbl.setStyleSheet(
            "font-weight: 800; background: transparent;")
        self.sel_bar = ActionBar()
        # الأساسي في هذه الشاشة هو «+ جديد» في الشريط العلوي (قاعدة 23)
        self.sel_bar.add("📁 فتح الملف", self._sel_open_file, key="file",
                         tooltip="فتح ملف العميل المحدد")
        # ثانوي عمدًا: نسخة من الإجراء الأساسي في الشريط العلوي (§5)
        self.sel_bar.add("📑 عقد جديد", self._sel_new_contract, key="contract",
                         level="secondary", tooltip="عقد جديد لهذا العميل")
        self.sel_bar.add("📥 قبض", lambda: self._sel_voucher("receipt"),
                         key="receipt", level="receipt",
                         tooltip="سند قبض من المحدد")
        self.sel_bar.add("📤 صرف", lambda: self._sel_voucher("payment"),
                         key="payment", level="danger",
                         tooltip="سند صرف للمحدد")
        self.sel_bar.add("📊 كشف حساب", self._sel_statement, key="statement",
                         tooltip="كشف حساب المحدد")
        self.sel_bar.add("⋯ إجراءات أخرى", self._sel_more_menu, key="more",
                         tooltip="طباعة المستندات · المجلد · تعديل · حذف")
        sel_layout.addWidget(self.sel_name_lbl)
        sel_layout.addWidget(self.sel_bar, 1)
        self.sel_bar_host.setVisible(False)
        self.tree.itemSelectionChanged.connect(self._selection_changed)
        layout.addWidget(self.sel_bar_host)

        # شريط سفلي: ترقيم صفحات + ملخص
        from ui.widgets import PaginationBar
        self.pager = PaginationBar()
        self.pager.page_changed.connect(self.refresh)
        actions = QHBoxLayout()
        actions.addStretch()
        actions.addWidget(self.pager)
        actions.addStretch()
        self.summary_lbl = QLabel("")
        self.summary_lbl.setProperty("hint", True)
        actions.addWidget(self.summary_lbl)
        layout.addLayout(actions)

    # ==================== حالة الفراغ ====================
        # لا زر يُضغط تحت مقاسه الطبيعي (قاعدة 33)
        from PySide6.QtWidgets import QPushButton as _QPB
        from ui.widgets import size_buttons as _size_btns
        _size_btns([b for b in self.findChildren(_QPB) if b.text().strip()],
                   uniform=False)

    def _update_empty_state(self, count: int, query: str, filter_key: str):
        """يستبدل الجدول الفارغ برسالة واضحة وزر إجراء."""
        from ui.widgets import empty_state, dispose_widget as _dispose
        if count:
            if getattr(self, "_empty_widget", None) is not None:
                # لا setParent(None) بدون ربط أب جديد: كان يترك الودجة
                # كنافذة شبحية صغيرة تومض فوق الشاشة.
                _dispose(self._empty_widget, host=self)
                self._empty_widget = None
                self.tree.setVisible(True)
            return
        if query:
            text = (f"لا نتائج لـ «{query}» · جرّب اسمًا أو رقم هاتف مختلفًا")
            btn, slot = "✕ مسح البحث", lambda: self.search.clear()
        elif filter_key == "remaining":
            text = "لا عملاء عليهم متبقٍ حاليًا · كل الحسابات مسدّدة"
            btn, slot = "🔍 عرض كل العملاء", lambda: self.chips.select("all")
        elif filter_key == "active":
            text = "لا عملاء لهم عقود نشطة حاليًا"
            btn, slot = "🔍 عرض كل العملاء", lambda: self.chips.select("all")
        elif filter_key == "no_contracts":
            text = "كل العملاء لديهم عقود · لا فرص بيعية معلّقة"
            btn, slot = "🔍 عرض كل العملاء", lambda: self.chips.select("all")
        else:
            text = "لا يوجد عملاء بعد · ابدأ بتسجيل أول عميل"
            btn, slot = "＋ تسجيل عميل", self._new_customer

        def _do():
            slot()
            self._search_changed()

        if getattr(self, "_empty_widget", None) is not None:
            _dispose(self._empty_widget, host=self)
        self._empty_widget = empty_state(text, btn, _do, icon="👥",
                                            primary=False)
        self.tree.setVisible(False)
        self.layout().insertWidget(1, self._empty_widget, 1)

    # ==================== شريط التحديد ====================
    def _selection_changed(self):
        """إظهار شريط الإجراءات باسم المحدد · وإخفاؤه عند إلغاء التحديد."""
        kind, rid = self._selected_silent()
        if not kind:
            self._sel_kind = ""
            self._sel_id = None
            self.sel_bar_host.setVisible(False)
            return
        item = self.tree.currentItem()
        name = item.text(0) if item else ""
        self._sel_kind, self._sel_id = kind, rid
        self.sel_name_lbl.setText(name)
        is_customer = kind == "customer"
        for key in ("file", "contract", "receipt", "payment", "statement",
                    "more"):
            btn = self.sel_bar.button(key)
            if btn:
                btn.setVisible(True)
        # صف عقد: «فتح الملف» يصير «فتح مركز العقد»
        self.sel_bar.button("file").setText(
            "📁 فتح الملف" if is_customer else "🗂 فتح مركز العقد")
        self.sel_bar.button("file").setToolTip(
            "فتح ملف العميل المحدد" if is_customer
            else "فتح مركز العقد المحدد")
        self.sel_bar.button("contract").setVisible(is_customer)
        self.sel_bar_host.setVisible(True)

    def _selection_context(self) -> tuple[str, int | None]:
        kind = getattr(self, "_sel_kind", "") or ""
        rid = getattr(self, "_sel_id", None)
        if not kind or rid is None:
            style.info(self, "اختر عميلًا أو عقدًا من القائمة أولًا.")
            return "", None
        return kind, rid

    def _sel_open_file(self):
        kind, rid = self._selection_context()
        if not kind:
            return
        if kind == "customer":
            self._open_customer(rid)
        else:
            self._open_contract(rid)

    def _sel_new_contract(self):
        kind, rid = self._selection_context()
        if not kind:
            return
        self._new_contract(preset_customer_id=rid)

    def _sel_voucher(self, vtype: str):
        kind, rid = self._selection_context()
        if not kind:
            return
        from ui.actions import open_voucher
        if open_voucher(self, vtype,
                        customer_id=rid if kind == "customer" else None,
                        contract_id=rid if kind != "customer" else None):
            self.refresh()
            self.data_changed.emit()

    def _sel_statement(self):
        kind, rid = self._selection_context()
        if not kind:
            return
        if kind == "customer":
            self.open_statement.emit(rid)
        else:
            self._open_contract(rid)

    def _sel_more_menu(self):
        """الإجراءات الأقل استخدامًا · بلا إيموجي في نص الأزرار."""
        kind, rid = self._selection_context()
        if not kind:
            return
        from PySide6.QtGui import QCursor
        cust = (customer_service.get_customer(rid)
                if kind == "customer" else None)
        menu = QMenu(self)
        act_print = menu.addAction("طباعة كل المستندات")
        act_folder = menu.addAction("فتح مجلد الشير")
        if cust is not None and not (cust.folder_path or "").strip():
            act_folder.setEnabled(False)
            act_folder.setToolTip("لم يُضبط مجلد شبكة لهذا العميل بعد")
        menu.addSeparator()
        act_edit = menu.addAction("تعديل البيانات")
        act_delete = menu.addAction("حذف")
        chosen = menu.exec(QCursor.pos())
        if chosen is None:
            return
        if chosen is act_print and cust is not None:
            from ui.customers import batch_print_customer_documents
            batch_print_customer_documents(self, cust)
        elif chosen is act_folder and cust is not None:
            self._open_customer_folder(cust.id, cust)
        elif chosen is act_edit:
            self._edit_selected()
        elif chosen is act_delete:
            self._delete_selected()

    def _sort_menu(self):
        """قائمة الترتيب من أيقونة ⇅ (بديل القائمة المنسدلة)."""
        from PySide6.QtGui import QCursor
        menu = QMenu(self)
        actions = {}
        for key, label in self._sort_options:
            act = menu.addAction(("✓  " if key == self._sort_key else "     ")
                                 + label)
            actions[act] = key
        chosen = menu.exec(QCursor.pos())
        if chosen in actions:
            self._sort_key = actions[chosen]
            self._search_changed()

    # ==================== التعبئة ====================
    def _search_changed(self):
        """تغيير البحث يعيد لأول صفحة ثم يحدّث."""
        self.pager.reset()
        self.refresh()

    def refresh(self):
        self.tree.clear()

        query = self.search.text().strip()
        customers = customer_service.list_customers(query)

        # خريطة التعليقات مرة واحدة (بلا استعلام لكل عميل)
        comments_map = {}
        try:
            from services import comment_service as _cmt
            from services import feature_service as _ftc
            if _ftc.enabled("comments"):
                comments_map = _cmt.customers_with_comments()
        except Exception:
            comments_map = {}

        # الترتيب المختار من القائمة
        sort_key = getattr(self, "_sort_key", "newest")

        def _code_num(c):
            try:
                return int((c.customer_code or "").split("-")[-1])
            except (ValueError, IndexError):
                return 0
        if sort_key == "code":
            customers.sort(key=_code_num)
        elif sort_key == "name":
            customers.sort(key=lambda c: c.name or "")
        elif sort_key == "updated":
            # المعدَّل فعليًا يتقدم على المُنشأ فقط عند تساوي التوقيت
            customers.sort(
                key=lambda c: ((c.updated_at or c.created_at or ""),
                               1 if c.updated_at else 0, c.id or 0),
                reverse=True)
        # "newest" هو ترتيب الاستعلام الافتراضي (id DESC)
        contracts_by_customer: dict[int, list] = {}
        matched_customer_ids = {c.id for c in customers}

        # لو البحث طابق عقدًا لعميل غير مطابق بالاسم · أظهر عميله أيضًا
        if query:
            for con in contract_service.list_contracts(query):
                if con.customer_id not in matched_customer_ids:
                    cust = customer_service.get_customer(con.customer_id)
                    if cust:
                        customers.append(cust)
                        matched_customer_ids.add(cust.id)

        all_contracts = contract_service.list_contracts()
        for con in all_contracts:
            contracts_by_customer.setdefault(con.customer_id, []).append(con)

        from services import ui_data_service as ui_data
        _maps = ui_data.dealings_financial_maps()
        statuses = _maps["statuses"]
        collected_map = _maps["collected_map"]
        addendums_map: dict[int, list] = _maps["addendums_map"]

        # عقود الإشراف الداخلة في التمديد: القيمة = الأساس + التمديد المستحق
        # (بلا فلتر على المتبقي · حتى بعد المخالصة بسداد أو إلغاء أشهر
        #  تبقى القيمة صحيحة ولا ترجع للقيمة الأصلية)
        sup_ext_map: dict[int, dict] = {}
        try:
            from services.supervision_service import extensions_map
            sup_ext_map = extensions_map()
        except Exception:
            pass

        # القيمة الحالية لكل عقد = الأصلية + صافي ملحقاته المعتمدة
        # + تمديد الإشراف المستحق (إن وجد)
        # V2.48: خريطة القيم دفعة واحدة بدل استعلامين لكل عقد
        # (كانت 200 استعلام لكل تحديث للصفحة).
        _values_map = lc.contract_values_map()

        def _contract_value(con) -> dict:
            v = _values_map.get(con.id)
            if v is None:  # احتياط: عقد جديد بعد بناء الخريطة
                v = lc.contract_current_value(con.id)
            return {"original": v["original"], "additions": v["additions"],
                    "deductions": v["deductions"],
                    "sup_ext": v["sup_extension"],
                    "current": v["current"]}

        bold = QFont()
        bold.setBold(True)

        # الملخص المالي لكل عميل (من الخرائط المجمعة · سريع فوق مئات العملاء)
        # الأقساط المتأخرة فعليًا لكل عميل (لتمييز المتبقي بالأحمر)
        overdue_customers: dict[int, int] = {}
        try:
            for item in lc.overdue_plan_items():
                if item.get("days_diff", 0) >= 0:
                    continue
                con = next((c for c in all_contracts
                            if c.contract_number == item["contract_number"]),
                           None)
                if con is None:
                    continue
                late = -int(item["days_diff"])
                overdue_customers[con.customer_id] = max(
                    overdue_customers.get(con.customer_id, 0), late)
        except Exception:
            overdue_customers = {}
        self._overdue_customers = overdue_customers

        def _summary(cust) -> dict:
            cust_contracts = contracts_by_customer.get(cust.id, [])
            s_total = sum(_contract_value(c)["current"] for c in cust_contracts
                          if statuses.get(c.id, "نشط") != "ملغى")
            s_collected = sum(collected_map.get(c.id, 0.0)
                              for c in cust_contracts)
            return {"total": s_total, "collected": s_collected,
                    "remaining": s_total - s_collected}

        # الإجماليات بالأسفل تحسب كل العملاء (وليس الصفحة الحالية فقط)
        total_all = collected_all = 0.0
        summaries: dict[int, dict] = {}
        for cust in customers:
            s = _summary(cust)
            summaries[cust.id] = s

        # فلتر العملاء المختار من القائمة المنسدلة
        filter_key = self.chips.current() if hasattr(self, "chips") else "all"
        if filter_key == "active":
            customers = [c for c in customers
                         if any(statuses.get(k.id, "نشط") == "نشط"
                                for k in contracts_by_customer.get(c.id, []))]
        elif filter_key == "remaining":
            customers = [c for c in customers
                         if summaries[c.id]["remaining"] > 0.001]
        elif filter_key == "no_contracts":
            customers = [c for c in customers
                         if not contracts_by_customer.get(c.id)]

        for cust in customers:
            total_all += summaries[cust.id]["total"]
            collected_all += summaries[cust.id]["collected"]

        # ترقيم الصفحات: 50 عميلًا في الصفحة · الرسم للشريحة الحالية فقط
        n_customers = len(customers)
        page_customers = self.pager.slice(customers)

        for cust in page_customers:
            summary = summaries[cust.id]
            n_cons = len(contracts_by_customer.get(cust.id, []))
            parent = QTreeWidgetItem([
                cust.name,
                cust.phone or "—",
                str(n_cons) if n_cons else "—",
                f"{summary['total']:,.3f}",
                f"{summary['collected']:,.3f}",
                f"{summary['remaining']:,.3f}", ""])
            parent.setData(0, Qt.UserRole, ("customer", cust.id))
            parent.setFont(0, bold)
            # نقطة حمراء صغيرة عند وجود تحديث في مجلد الشير
            if (cust.folder_path or "").strip():
                try:
                    from services import folder_service
                    st = folder_service.check_customer_folder(cust.id)
                    if st.get("has_update"):
                        parent.setText(0, f"🔴  {cust.name}")
                        parent.setToolTip(
                            0, "يوجد تحديث جديد في مجلد الشير · "
                               "افتحه من «إجراءات أخرى»")
                except Exception:
                    pass
            # علامة التعليقات: 💬 مع آخر تعليق في التلميح
            info = comments_map.get(cust.id)
            if info:
                mark = "💬"
                if info.get("has_pinned"):
                    mark = "📌"
                parent.setText(0, f"{mark}  {parent.text(0).lstrip('🔴 ').strip()}"
                               if "🔴" not in parent.text(0)
                               else f"🔴{mark}  {cust.name}")
                body = (info.get("last_body") or "").replace("\n", " ")
                if len(body) > 120:
                    body = body[:120] + "…"
                tip = (f"{info['n']} تعليق · آخرها: "
                       f"{info.get('last_author') or ''} "
                       f"{(info.get('last_at') or '')[:16]}\n{body}")
                old_tip = parent.toolTip(0)
                parent.setToolTip(0, (old_tip + "\n\n" + tip) if old_tip
                                  else tip)
            # الهاتف وعدد العقود: بيانات مساعدة بوزن أخف من الأرقام المالية
            from PySide6.QtGui import QFont as _QF
            light = _QF()
            light.setPointSizeF(max(7.0, light.pointSizeF() - 0.5))
            for col in (1, 2):
                parent.setFont(col, light)
                parent.setForeground(col, QColor(style.MUTED))
            for col in (1, 2):
                parent.setTextAlignment(col, Qt.AlignCenter)
            # الأرقام المالية بمحاذاة موحّدة (تتحاذى خانات الآحاد رأسيًا)
            from ui.widgets import MONEY_ALIGN
            for col in (3, 4, 5):
                parent.setTextAlignment(col, MONEY_ALIGN)
            parent.setForeground(4, QColor(style.MONEY_IN))
            # الأحمر للتأخر الفعلي فقط · الكهرماني لباقي المتبقي
            late_days = overdue_customers.get(cust.id, 0)
            if summary["remaining"] <= 0:
                remain_color = style.MUTED
            elif late_days:
                remain_color = style.MONEY_OVERDUE
                parent.setToolTip(
                    5, f"عليه قسط متأخر منذ {late_days} يومًا")
            else:
                remain_color = style.MONEY_REMAIN
            parent.setForeground(5, QColor(remain_color))
            from PySide6.QtCore import QSize
            parent.setSizeHint(0, QSize(0, 44))  # ارتفاع يتسع للأزرار
            # معلومات التدقيق: من أضاف العميل ومتى وآخر تحديث (Tooltip)
            audit = [f"{cust.name}  ({cust.customer_code})",
                     f"أُضيف: {(cust.created_at or '')[:16]}"]
            if cust.created_by:
                audit[1] += f"  بواسطة {cust.created_by}"
            if cust.updated_at:
                upd = f"آخر تحديث: {cust.updated_at[:16]}"
                if cust.updated_by:
                    upd += f"  بواسطة {cust.updated_by}"
                audit.append(upd)
            audit.append("افتح «ملف العميل» لعرض عقوده")
            parent.setToolTip(0, "\n".join(audit))
            self.tree.addTopLevelItem(parent)

        # حالة الفراغ: نص يشرح السبب + زر إجراء مناسب
        self._update_empty_state(n_customers, query,
                                 self.chips.current() if hasattr(self, "chips")
                                 else "all")
        self.title_lbl.setText(f"العملاء ({n_customers})")
        self.summary_lbl.setText(
            f"{n_customers} عميل · إجمالي التعاملات: {total_all:,.3f} | "
            f"المحصّل: {collected_all:,.3f} | المتبقي: {total_all - collected_all:,.3f}")

        from ui.widgets import sync_header_alignment
        sync_header_alignment(self.tree)

    def _selected_silent(self):
        """التحديد الحالي بلا أي رسالة (لتتبع تغيّر التحديد)."""
        item = self.tree.currentItem()
        if item is None or not item.isSelected():
            return None, None
        data = item.data(0, Qt.UserRole)
        return data if data else (None, None)

    def _selected(self):
        kind, rid = self._selected_silent()
        if not kind:
            style.info(self, "اختر عميلًا من القائمة أولاً.")
            return None, None
        return kind, rid

    def _double_clicked(self, item, _col):
        kind, rid = item.data(0, Qt.UserRole)
        if kind == "contract":
            self._open_contract(rid)
        else:
            self._open_customer(rid)

    def _open_selected(self):
        kind, rid = self._selected()
        if kind == "contract":
            self._open_contract(rid)
        elif kind == "customer":
            self._open_customer(rid)

    def _open_contract(self, contract_id):
        # مركز العقد صفحة داخلية الآن (لا نافذة منبثقة) — المدخل
        # الموحّد من النافذة الرئيسية، والتحديث يعود مع الرجوع للشاشة
        win = self.window()
        if hasattr(win, "open_contract_hub"):
            win.open_contract_hub(contract_id)
            return
        from services import contract_service
        con = contract_service.get_contract(contract_id)
        if con and hasattr(win, 'open_contract_page'):
            win.open_contract_page(
                contract=con,
                on_done=lambda accepted: (self.refresh(), self.data_changed.emit()) if accepted else None)
        elif con:
            from ui.contracts import ContractDialog
            if ContractDialog(self, con).exec():
                self.refresh()
                self.data_changed.emit()

    def _page_host_connected(self) -> bool:
        """هل النافذة الرئيسية موصولة بإشارة فتح ملف العميل كصفحة؟

        ملاحظة: `QObject.receivers()` في PySide6 يقبل نص التوقيع فقط ولا
        يقبل كائن الإشارة · الطريقة المعتمدة هي `isSignalConnected` مع
        `QMetaMethod.fromSignal`. وأي فشل هنا يعني «غير موصول» فيفتح
        الملف كنافذة منبثقة بدل أن يسقط البرنامج.
        """
        try:
            from PySide6.QtCore import QMetaMethod
            return self.isSignalConnected(
                QMetaMethod.fromSignal(self.open_customer_file))
        except Exception:
            return False

    def _open_customer(self, customer_id):
        """ملف العميل: صفحة داخلية أولًا؛ لا نفتح Dialog إلا خارج الرئيسية.

        تمت إزالة الاعتماد العملي على isSignalConnected لأنه قد يعطي نتيجة
        مختلفة حسب نسخة PySide/توقيت بناء الصفحة، وكان يسمح بظهور نافذة
        أرشيف عابرة عند فتح العميل. المسار المعتمد الآن هو أقرب مضيف يملك
        open_customer_page، ثم fallback للحوارات فقط في الاختبارات/النوافذ
        المستقلة.
        """
        try:
            from ui.widgets import find_host
            host = find_host(self, "open_customer_page")
        except Exception:
            host = None
        if host is not None:
            QTimer.singleShot(0, lambda cid=int(customer_id): host.open_customer_page(cid))
            return
        if self._page_host_connected():
            self.open_customer_file.emit(customer_id)
            return
        cust = customer_service.get_customer(customer_id)
        if cust:
            from ui.archive import CustomerArchiveDialog
            CustomerArchiveDialog(self, cust).exec()

    # ==================== جديد ====================
    def _new_menu(self):
        from PySide6.QtGui import QCursor
        menu = QMenu(self)
        act_customer = menu.addAction("👥 عميل جديد")
        act_contract = menu.addAction("📑 عقد جديد")
        chosen = menu.exec(QCursor.pos())
        if chosen is act_customer:
            self._new_customer()
        elif chosen is act_contract:
            self._new_contract()

    def _new_customer(self):
        from ui.customers import CustomerDialog
        if CustomerDialog(self).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _new_contract(self, preset_customer_id=None):
        if not customer_service.count_customers():
            style.info(self, "أضف عميلًا أولاً.")
            return
        win = self.window()
        if hasattr(win, 'open_contract_page'):
            win.open_contract_page(
                customer_id=preset_customer_id,
                on_done=lambda accepted: (self.refresh(), self.data_changed.emit()) if accepted else None)
        else:
            from ui.contracts import ContractDialog
            dlg = ContractDialog(self)
            if preset_customer_id:
                dlg.customer.select_data(preset_customer_id)
            if dlg.exec() == QDialog.Accepted:
                self.refresh()
                self.data_changed.emit()

    # ==================== تعديل / حذف ====================
    def _edit_selected(self):
        kind, rid = self._selected()
        if kind == "customer":
            cust = customer_service.get_customer(rid)
            from ui.customers import CustomerDialog
            if cust and CustomerDialog(self, cust).exec() == QDialog.Accepted:
                self.refresh()
                self.data_changed.emit()
        elif kind == "contract":
            con = contract_service.get_contract(rid)
            win = self.window()
            if con and hasattr(win, 'open_contract_page'):
                win.open_contract_page(
                    contract=con,
                    on_done=lambda accepted: (self.refresh(), self.data_changed.emit()) if accepted else None)
            elif con:
                from ui.contracts import ContractDialog
                if ContractDialog(self, con).exec() == QDialog.Accepted:
                    self.refresh()
                    self.data_changed.emit()

    def _delete_selected(self):
        if not style.require_admin(self, "حذف عميل أو عقد",
                                   perm="action_delete"):
            return
        kind, rid = self._selected()
        if kind == "customer":
            cust = customer_service.get_customer(rid)
            if not cust:
                return
            contracts, invoices = customer_service.customer_links(rid)
            from services import feature_service as _feat13d
            if not _feat13d.enabled("invoices"):   # V4.5.13: ربط فعلي
                invoices = []
            if contracts or invoices:
                style.error(self, f"لا يمكن حذف العميل «{cust.name}» لأنه "
                            f"مرتبط بـ {contracts} عقد.")
                return
            if style.confirm(self, f"حذف العميل «{cust.name}»؟"):
                try:
                    customer_service.delete_customer(rid)
                    self.refresh()
                    self.data_changed.emit()
                except (ValidationError, DatabaseError) as exc:
                    style.error(self, str(exc))
        elif kind == "contract":
            con = contract_service.get_contract(rid)
            if not con:
                return
            if con.total_invoiced > 0:
                style.error(self, "لا يمكن حذف عقد عليه حركات.")
                return
            _cinfo = f"{con.customer_name} — {con.contract_number}" if getattr(con, "customer_name", "") else con.contract_number
            if style.confirm(self, f"حذف العقد «{_cinfo}»؟"):
                try:
                    contract_service.delete_contract(rid)
                    self.refresh()
                    self.data_changed.emit()
                except (ValidationError, DatabaseError) as exc:
                    style.error(self, str(exc))

    # ==================== إجراءات ====================
    def _open_customer_folder(self, customer_id: int, cust):
        """فتح مجلد العميل على الشبكة + اعتباره مُطّلعًا عليه."""
        from services import folder_service
        path = (cust.folder_path or "").strip()
        if not folder_service.open_folder(path):
            style.error(self,
                        "تعذر فتح مجلد العميل:\n" + path +
                        "\n\nتأكد أن جهاز الشبكة متصل، وأن المسار يفتح "
                        "من مستكشف ويندوز بنفسه.\n"
                        "لو المسار بشرطة أمامية (//) عرّفه من جديد من "
                        "ملف العميل ← تبويب المستندات ← «تحديد مجلد "
                        "الشبكة».")
            return
        try:
            folder_service.mark_folder_seen(customer_id)
        except Exception:
            pass
        self.data_changed.emit()

    def _actions_menu_for(self, customer_id: int):
        """قائمة إجراءات العميل · تُفتح من زر ⚡ بجانب اسمه في الشجرة."""
        from PySide6.QtGui import QCursor
        cust = customer_service.get_customer(customer_id)
        if not cust:
            return
        # الترتيب حسب معدل الاستخدام اليومي · والخطر أخيرًا بعد فاصل
        menu = QMenu(self)
        act_file = menu.addAction("📁 فتح ملف العميل")
        act_contract = menu.addAction("📑 عقد جديد لهذا العميل")
        act_receipt = menu.addAction("📥 سند قبض")
        menu.addSeparator()
        act_payment = menu.addAction("📤 سند صرف")
        act_statement = menu.addAction("📑 كشف حساب")
        act_batch = menu.addAction("🖨 طباعة كل مستنداته")
        chosen = menu.exec(QCursor.pos())
        if chosen is act_file:
            self._open_customer(customer_id)
        elif chosen is act_contract:
            self._new_contract(preset_customer_id=customer_id)
        elif chosen in (act_receipt, act_payment):
            from ui.actions import open_voucher
            vtype = "receipt" if chosen is act_receipt else "payment"
            if open_voucher(self, vtype, customer_id=customer_id):
                self.refresh()
                self.data_changed.emit()
        elif chosen is act_statement:
            self.open_statement.emit(customer_id)
        elif chosen is act_batch:
            from ui.customers import batch_print_customer_documents
            # إعادة استخدام منطق الطباعة الدفعية الموجود
            batch_print_customer_documents(self, cust)

    def _actions_menu(self):
        """قائمة إجراءات حسب التحديد (تُستخدم لصفوف العقود)."""
        kind, rid = self._selected()
        if not kind:
            return
        from PySide6.QtGui import QCursor
        if kind == "customer":
            self._actions_menu_for(rid)
            return
        # حالة العقد الحالية لتخصيص خيارات الإيقاف/التفعيل
        from services import ui_data_service as ui_data
        cur_status = ui_data.contract_status(rid)

        menu = QMenu(self)
        act_hub = menu.addAction("🗂 فتح مركز العقد")
        act_receipt = menu.addAction("📥 سند قبض على هذا العقد")
        act_payment = menu.addAction("📤 سند صرف على هذا العقد")
        act_addendum = menu.addAction("📎 عقد إضافي / أمر تغييري")
        # عقد إشراف في التمديد: خيار إلغاء أشهر (مخالصة بتنازل · مدير)
        act_waive = None
        try:
            from services.supervision_service import supervision_status
            _sup = supervision_status(rid)
            if _sup and _sup["billable_extension"] > 0:
                act_waive = menu.addAction(
                    f"إلغاء أشهر تمديد الإشراف "
                    f"(غير المسدد: {_sup['unpaid_extension_months']:g} شهر)")
        except Exception:
            _sup = None
        menu.addSeparator()
        act_pause = act_resume = act_cancel = None
        if cur_status == "متوقف":
            act_resume = menu.addAction("▶ إعادة تفعيل العقد")
        elif cur_status not in ("مغلق", "ملغى"):
            act_pause = menu.addAction("⏸ إيقاف مؤقت (تجميد)")
        if cur_status not in ("مغلق", "ملغى"):
            act_cancel = menu.addAction("🚫 إلغاء العقد")
            from PySide6.QtGui import QColor as _QC2
            act_cancel.setToolTip("عملية حساسة · تُعرض أرقام العقد قبل التنفيذ")
        chosen = menu.exec(QCursor.pos())
        if chosen is act_hub:
            self._open_contract(rid)
        elif chosen in (act_receipt, act_payment):
            from ui.actions import open_voucher
            vtype = "receipt" if chosen is act_receipt else "payment"
            if open_voucher(self, vtype, contract_id=rid):
                self.refresh()
                self.data_changed.emit()
        elif chosen is act_addendum:
            from ui.addendum_dialog import open_change_order
            open_change_order(self, rid,
                              on_saved=lambda: (self.refresh(),
                                                self.data_changed.emit())
                              ).exec()
        elif act_pause is not None and chosen is act_pause:
            self._change_contract_status(rid, "متوقف")
        elif act_resume is not None and chosen is act_resume:
            self._change_contract_status(rid, "نشط")
        elif act_cancel is not None and chosen is act_cancel:
            self._change_contract_status(rid, "ملغى")
        elif act_waive is not None and chosen is act_waive:
            self._waive_supervision(rid)

    def _waive_supervision(self, contract_id: int):
        """إلغاء أشهر تمديد إشراف (تنازل) · بموافقة مدير.

        المتاح للإلغاء = التمديد غير المسدد فقط (يتحدث بعد كل دفعة)،
        ويقبل كسور الشهر (1.5 شهر مثلًا).
        """
        from services.supervision_service import (supervision_status,
                                                  waive_extension_months)
        st = supervision_status(contract_id)
        if not st or st["billable_extension"] <= 0:
            style.info(self, "لا توجد أشهر تمديد محسوبة على هذا العقد.")
            return
        can = st["unpaid_extension_months"]
        if can <= 0.001:
            style.info(self,
                       "كل أشهر التمديد تمت مخالصتها بالسداد · "
                       "لا يوجد ما يُلغى.")
            return
        if not style.require_admin(self, "إلغاء أشهر تمديد إشراف",
                                   perm="action_supervision_waive"):
            return
        from PySide6.QtWidgets import (QDialog, QDialogButtonBox, QDoubleSpinBox,
                                       QFormLayout, QLabel, QTextEdit)
        paid_ext = st["extension_value"] - st["unpaid_extension_value"]
        dlg = QDialog(self)
        dlg.setWindowTitle("إلغاء مدة إشراف")
        dlg.setLayoutDirection(Qt.RightToLeft)
        form = QFormLayout(dlg)
        info = (f"أشهر التمديد المحسوبة: {st['billable_extension']:g} "
                f"(قيمة الشهر {st['monthly']:,.3f})\n")
        if paid_ext > 0.001:
            info += (f"سدد العميل منها: {paid_ext:,.3f} "
                     f"({paid_ext / st['monthly']:g} شهر)\n")
        info += f"المتاح للإلغاء (غير المسدد): {can:g} شهر"
        lbl = QLabel(info)
        lbl.setWordWrap(True)
        form.addRow(lbl)
        months_w = QDoubleSpinBox()
        months_w.setRange(0.5, float(can))
        months_w.setSingleStep(0.5)
        months_w.setDecimals(1)
        months_w.setValue(float(can))
        reason_w = QTextEdit()
        reason_w.setFixedHeight(80)
        reason_w.setPlaceholderText("سبب الإلغاء / التوضيح الذي سيظهر في تقرير الإشراف...")
        form.addRow("المدة الملغاة:", months_w)
        form.addRow("سبب الإلغاء:", reason_w)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("تأكيد الإلغاء")
        bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        form.addRow(bb)
        if dlg.exec() != QDialog.Accepted:
            return
        months = months_w.value()
        reason = reason_w.toPlainText().strip()
        if not style.confirm(
                self,
                f"إلغاء {months:g} شهر تمديد بقيمة "
                f"{months * st['monthly']:,.3f}؟\n"
                "سيُخصم من مديونية العميل نهائيًا ويُسجل في سجل العقد."):
            return
        try:
            new_st = waive_extension_months(contract_id, months, reason)
            style.info(self,
                       "تم الإلغاء.\n"
                       f"المتبقي على العميل الآن: {new_st['remaining']:,.3f}",
                       "تمت المخالصة")
            self.refresh()
            self.data_changed.emit()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

    def _change_contract_status(self, contract_id: int, new_status: str):
        """تغيير حالة العقد من القائمة · مع عرض الآثار المالية قبل التنفيذ."""
        # ملخص مالي قبل السؤال
        try:
            value = lc.contract_current_value(contract_id)
            from services import ui_data_service as ui_data
            collected = ui_data.contract_receipts_total(contract_id)
            remaining = value["current"] - collected
        except Exception:
            collected = remaining = 0.0
            value = {"current": 0.0}

        effects = {
            "متوقف": ("إيقاف العقد مؤقتًا (تجميد)؟",
                      "• يبقى العقد وأرصدته كما هي\n"
                      "• سيظهر تنبيه (عقد متوقف) في الرئيسية\n"
                      "• يمكنك إعادة تفعيله في أي وقت"),
            "نشط": ("إعادة تفعيل العقد؟",
                    "• يعود العقد نشطًا وتُستأنف متابعته وتنبيهاته"),
            "ملغى": ("إلغاء العقد نهائيًا؟",
                     "• يخرج العقد من كل الأرصدة والتقارير والتنبيهات\n"
                     "• لا يُقبل إن كانت عليه تحصيلات سارية"),
        }
        if not style.require_admin(
                self, f"تغيير حالة العقد إلى ({new_status})",
                perm="action_change_status"):
            return
        title, effect = effects.get(new_status, ("تغيير حالة العقد؟", ""))
        if not style.confirm_financial(
                self, title, title,
                [("قيمة العقد", f"{value['current']:,.3f}"),
                 ("المحصّل", f"{collected:,.3f}"),
                 ("المتبقي", f"{remaining:,.3f}")],
                note=effect):
            return
        reason = ""
        close_amount = 0.0
        if new_status == "ملغى":
            from PySide6.QtWidgets import QInputDialog
            reason, ok = QInputDialog.getText(
                self, "سبب إلغاء العقد",
                "اكتب سبب الإلغاء / التوضيح الذي سيظهر في سجل العقد:")
            if not ok:
                return
            close_amount, ok = QInputDialog.getDouble(
                self, "مبلغ إغلاق الإلغاء",
                "اكتب مبلغ الإغلاق/التسوية عند إلغاء العقد (0 إذا لا يوجد):",
                max(0.0, remaining), 0.0, 1e9, 3)
            if not ok:
                return
        try:
            lc.change_contract_status(contract_id, new_status, reason, close_amount)
            self.refresh()
            self.data_changed.emit()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

    def _export_excel(self):
        from datetime import datetime
        import os
        from services.excel_service import export_customers_excel, ExcelError
        stamp = datetime.now().strftime("%Y-%m-%d")
        default = os.path.join(os.path.expanduser("~"),
                               f"كشف_العملاء_{stamp}.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "تصدير كشف العملاء", default, "Excel (*.xlsx)")
        if not path:
            return
        try:
            export_customers_excel(path)
            style.info(self, f"تم التصدير:\n{path}", "تم")
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except ExcelError as exc:
            style.error(self, str(exc))
