# -*- coding: utf-8 -*-
"""قائمة المهام: يدوية أو محوّلة من تنبيهات النظام."""
from PySide6.QtCore import Qt, QDateTime, QTime, Signal
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QDateTimeEdit, QDialog, QFormLayout, QHBoxLayout, QHeaderView, QLabel,
    QLineEdit, QPushButton, QComboBox, QTableWidget, QTableWidgetItem,
    QTextEdit, QVBoxLayout, QWidget, QCheckBox,
)

from services.db_facade_service import DatabaseError
from services import task_service
from services.customer_service import ValidationError
from ui import style
from ui.style import soft_shadow
from ui.widgets import required_label, NoWheelMixin, SafeDateEdit, SafeTimeEdit, make_searchable


class SafeDateTimeEdit(NoWheelMixin, QDateTimeEdit):
    """تاريخ ووقت بدون عجلة الماوس."""


class TaskDialog(QDialog):
    """إضافة / تعديل مهمة."""

    def __init__(self, parent=None, task: dict | None = None,
                 preset_title: str = "", preset_details: str = ""):
        super().__init__(parent)
        self.task = task
        title = "تعديل مهمة" if task else "مهمة جديدة"
        style.setup_dialog(
            self, title,
            "مهمة بموعد وتذكير · يمكن ربطها بعميل وعقد",
            icon="📌", color=style.WARN, size_ratio=0.40,
            min_w=520, max_w=700)
        from PySide6.QtWidgets import QWidget as _QW
        form_host = _QW()
        form = QFormLayout(form_host)
        form.setContentsMargins(0, 0, 0, 0)
        form.setSpacing(10)
        self.title = QLineEdit()
        self.title.setPlaceholderText("مثال: متابعة تحصيل القسط من العميل...")
        self.details = QTextEdit()
        self.details.setFixedHeight(64)
        self.details.setPlaceholderText("(اختياري)")
        # إدخال احترافي: التاريخ والوقت في خانتين منفصلتين أسهل في الكتابة.
        # التخزين يبقى yyyy-MM-dd hh:mm حتى لا تتغير قواعد التنبيهات.
        default_due = QDateTime.currentDateTime().addSecs(3600)
        self.due_date = SafeDateEdit()
        self.due_date.setCalendarPopup(True)
        self.due_date.setDisplayFormat("dd-MM-yyyy")
        self.due_date.setDate(default_due.date())
        self.due_date.setToolTip("اكتب التاريخ بهذا الشكل: يوم-شهر-سنة، أو اختر من التقويم")
        self.due_time = SafeTimeEdit()
        self.due_time.setDisplayFormat("hh:mm AP")
        self.due_time.setTime(default_due.time())
        self.due_time.setToolTip("اكتب الوقت مباشرة مثل 09:30 ص أو 02:15 م")
        self.due_host = QWidget()
        self.due_host.setObjectName("transparentHost")
        due_row = QHBoxLayout(self.due_host)
        due_row.setContentsMargins(0, 0, 0, 0)
        due_row.setSpacing(8)
        due_row.addWidget(self.due_date, 2)
        due_row.addWidget(self.due_time, 1)
        self.due_host.setMaximumHeight(42)
        # نوع المهمة: موعد (مع عميل) أو تذكير عام
        self.task_type = QComboBox()
        self.task_type.addItem("📌 موعد — مع العميل (اجتماع · معاينة · تسليم)", "موعد")
        self.task_type.addItem("📝 تذكير — عام (متابعة داخلية · مكالمة)", "تذكير")
        make_searchable(self.task_type, "")
        self.task_type.currentIndexChanged.connect(self._type_changed)
        self.task_type.setCurrentIndex(-1)

        self.remind = QComboBox()
        for label, minutes in [("ربع ساعة", 15), ("نصف ساعة", 30),
                               ("ساعة", 60), ("ساعتين", 120),
                               ("يوم كامل", 1440)]:
            self.remind.addItem(f"قبل الموعد بـ {label}", minutes)
        self.remind.setCurrentIndex(-1)
        make_searchable(self.remind, "")

        # ربط اختياري بعميل وعقد · بالفلترة الذكية
        from ui.widgets import SearchableComboBox, customer_items, contract_items
        self.customer = SearchableComboBox(search_only=True)
        self.customer.set_items(customer_items(), auto_select=False)
        self.contract = SearchableComboBox(open_on_click=True)
        self.contract.set_items([("— بدون عقد —", None)], auto_select=False)
        self.customer.selection_changed.connect(self._reload_contracts)

        if task:
            self.title.setText(task["title"])
            self.details.setPlainText(task["details"] or "")
            # النوع المحفوظ
            _tt = (task.get("task_type") or "تذكير").strip()
            idx = 0 if _tt == "موعد" else 1
            self.task_type.setCurrentIndex(idx)
            dt = QDateTime.fromString(task["due_at"], "yyyy-MM-dd hh:mm")
            if dt.isValid():
                self.due_date.setDate(dt.date())
                self.due_time.setTime(dt.time())
            idx = self.remind.findData(task["remind_minutes"])
            if idx >= 0:
                self.remind.setCurrentIndex(idx)
            if task.get("customer_id"):
                self.customer.select_data(task["customer_id"])
                self._reload_contracts()
            if task.get("contract_id"):
                self.contract.select_data(task["contract_id"])
        else:
            if preset_title:
                self.title.setText(preset_title)
            if preset_details:
                self.details.setPlainText(preset_details)

        form.addRow("نوع المهمة *", self.task_type)
        form.addRow(QLabel(required_label("المهمة")), self.title)
        form.addRow("التفاصيل", self.details)
        form.addRow(QLabel(required_label("تاريخ ووقت الموعد")), self.due_host)
        form.addRow("التذكير", self.remind)
        form.addRow("العميل", self.customer)
        form.addRow("العقد", self.contract)

        self.body_layout.addWidget(form_host)
        style.dialog_buttons(self, "حفظ المهمة", on_save=self._save)

    def _reload_contracts(self):
        """الفلترة الذكية: العقود المعروضة تخص العميل المختار فقط."""
        from ui.widgets import contract_items
        cid = self.customer.selected_data()
        items = [("— بدون عقد —", None)]
        if cid:
            items += contract_items(customer_id=cid)
        self.contract.set_items(items, auto_select=False)

    def _type_changed(self):
        """موعد ← يذكّر باختيار العميل (الرسالة توجَّه له)."""
        is_appt = self.task_type.currentData() == "موعد"
        tip = ("الموعد يُرسل للعميل برسالة تذكير واتساب"
               if is_appt else "تذكير عام — للمدير والفريق")
        self.task_type.setToolTip(tip)

    def accept(self):  # noqa: N802
        """لا تغلق النافذة إلا بعد نجاح التحقق والحفظ."""
        self._save()

    def _save(self):
        from ui.widgets import RequiredValidator
        v = RequiredValidator(self)
        v.add(self.title, "المهمة")
        v.add(self.task_type, "نوع المهمة")
        v.add(self.remind, "التذكير")
        if not v.validate():
            return
        due_at = QDateTime(self.due_date.date(), self.due_time.time()).toString("yyyy-MM-dd hh:mm")
        customer_id = self.customer.selected_data()
        contract_id = self.contract.selected_data()
        try:
            if self.task:
                task_service.update_task(
                    self.task["id"], self.title.text(), due_at,
                    self.details.toPlainText(),
                    (self.remind.currentData() or 30),
                    customer_id=customer_id, contract_id=contract_id,
                    task_type=self.task_type.currentData() or "تذكير")
            else:
                task_service.add_task(
                    self.title.text(), due_at,
                    self.details.toPlainText(),
                    (self.remind.currentData() or 30),
                    customer_id=customer_id, contract_id=contract_id,
                    task_type=self.task_type.currentData() or "تذكير")
            style.toast(self.parent() or self, "تم حفظ المهمة")
            QDialog.accept(self)
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


class TasksPage(QWidget):
    """صفحة/لوحة قائمة المهام. compact=True للوحة الرئيسية الجانبية."""
    data_changed = Signal()

    def __init__(self, parent=None, compact: bool = False):
        super().__init__(parent)
        self.setObjectName("page")
        self.compact = compact
        self._tasks: list[dict] = []
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        if self.compact:
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(10)
        else:
            layout.setContentsMargins(16, 10, 16, 8)
            layout.setSpacing(10)

        # رأس ملتف: في اللوحة الضيقة (230px على شاشة 1024) ينزل الزر
        # سطرًا ثانيًا بدل أن يُقتطع نصه (القاعدة 33)
        from ui.widgets import flow_host as _fh
        top_host, top = _fh(spacing=8)
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title = QLabel("📌 المهام" if self.compact else "المهام")
        title.setProperty("pageTitle" if not self.compact else "sectionTitle",
                          True)
        title_col.addWidget(title)
        if not self.compact:
            self.desc_lbl = QLabel("مهامك ومواعيدك وتذكيراتها — نقرة مزدوجة للتعديل")
            self.desc_lbl.setProperty("pageDesc", True)
            title_col.addWidget(self.desc_lbl)
        _title_host = QWidget()
        _title_host.setObjectName("transparentHost")
        _title_host.setLayout(title_col)
        top.addWidget(_title_host)
        self.show_done = QCheckBox("المنجزة" if self.compact
                                   else "إظهار المنجزة")
        self.show_done.toggled.connect(self.refresh)
        add_btn = QPushButton("+ جديدة" if self.compact else "＋ مهمة جديدة")
        if not self.compact:
            # أساسي في شاشة المهام فقط · داخل الرئيسية يكون ثانويًا
            # حتى لا تجتمع علامتا «أساسي» في شاشة واحدة (قاعدة 23)
            add_btn.setObjectName("btnPrimary")
        if self.compact:
            add_btn.setToolTip("مهمة جديدة")
        else:
            add_btn.setToolTip("إنشاء مهمة جديدة بموعد وتذكير")
            # نفس المقاس المضغوط لبقية أزرار اللوحة (ارتفاع موحّد)
            add_btn.setProperty("compact", True)
        add_btn.clicked.connect(self._add)
        top.addWidget(self.show_done)
        top.addWidget(add_btn)
        layout.addWidget(top_host)

        cols = 3 if self.compact else 5
        self.table = QTableWidget(0, cols)
        if self.compact:
            self.table.setHorizontalHeaderLabels(
                ["المهمة", "الموعد", "المتبقي"])
        else:
            self.table.setHorizontalHeaderLabels(
                ["المهمة", "الموعد", "المصدر", "الحالة", "المتبقي"])
        header = self.table.horizontalHeader()
        if self.compact:
            # V9.15.7: توزيع نسبي مع حد أدنى لكل عمود حتى لا يُقتطع النص
            from ui.widgets import apply_column_weights
            apply_column_weights(self.table, [44, 28, 28],
                                 min_widths=[140, 90, 70])
        else:
            header.setSectionResizeMode(QHeaderView.Stretch)
            header.setSectionResizeMode(0, QHeaderView.Stretch)
            from ui.widgets import apply_column_weights
            apply_column_weights(self.table, [40, 18, 14, 12, 16],
                                 min_widths=[200, 100, 80, 60, 80])
        header.setMinimumSectionSize(52)
        self.table.setMinimumWidth(0)
        self.table.verticalHeader().setVisible(False)
        self.table.setWordWrap(True)
        self.table.verticalHeader().setDefaultSectionSize(50)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(True)
        soft_shadow(self.table, radius=32, y=8)
        self.table.doubleClicked.connect(self._edit)
        layout.addWidget(self.table, 1)

        # تخطيط ملتف: أزرار المهام تنزل سطرًا ثانيًا في اللوحة الضيقة
        # بدل أن يُقتطع نصها العربي
        from ui.widgets import flow_host
        actions_host, actions = flow_host(spacing=6)
        actions.setSpacing(8)
        done_btn = QPushButton("إتمام" if self.compact
                               else "إتمام المهمة")
        done_btn.setObjectName("btnReceipt")
        done_btn.clicked.connect(self._complete)
        done_btn.setToolTip("إتمام المهمة المحددة")
        edit_btn = QPushButton("✎ تعديل")
        edit_btn.setProperty("flat", True)
        edit_btn.clicked.connect(self._edit)
        edit_btn.setToolTip("تعديل المهمة")
        reopen_btn = QPushButton("إعادة" if self.compact else "إعادة فتح")
        reopen_btn.setProperty("flat", True)
        reopen_btn.clicked.connect(self._reopen)
        reopen_btn.setToolTip("إعادة فتح مهمة منجزة")
        # V4.5.13: مفتاح «إرسال واتساب» يخفي الزر فعليًا
        from services import feature_service as _feat13t
        wa_btn = QPushButton("واتساب")
        wa_btn.setProperty("flat", True)
        if not _feat13t.enabled("whatsapp"):
            wa_btn.setVisible(False)
        wa_btn.clicked.connect(self._whatsapp)
        wa_btn.setToolTip("إرسال ملخص المهمة للمدير أو تذكير للعميل عبر واتساب")
        # قائمة الزر الأيمن على الصف (القاعدة 19)
        from ui.widgets import attach_row_menu
        attach_row_menu(self.table, lambda: [
            ("إتمام المهمة", self._complete),
            ("تعديل", self._edit),
            ("إعادة فتح", self._reopen),
            None,
            ("حذف المهمة", self._delete, True),
        ])
        # مقاس موحد يمنع تداخل الأزرار في اللوحة الجانبية الضيقة
        _task_btns = (done_btn, edit_btn, wa_btn, reopen_btn)
        if self.compact:
            # اللوحة الجانبية ضيقة: خط وحشوة أصغر ليقف الأربعة في صف
            # واحد بدل أن ينزل بعضهم سطرًا ثانيًا (شكوى صاحب النظام)
            for _b in _task_btns:
                _b.setProperty("compact", True)
        # المقاس من قياس النص نفسه (ارتفاعًا وعرضًا) · يمنع اقتطاع
        # الكلمات العربية مهما تغيّر الخط أو نسبة تكبير ويندوز
        from ui.widgets import size_buttons
        size_buttons(_task_btns, min_w=54 if self.compact else 88)
        for b in _task_btns:
            actions.addWidget(b)
        self.summary_lbl = QLabel("")
        self.summary_lbl.setProperty("hint", True)
        if not self.compact:
            actions.addWidget(self.summary_lbl)
        else:
            layout_summary = self.summary_lbl  # يُضاف أسفل الأزرار
        layout.addWidget(actions_host)
        if self.compact:
            layout.addWidget(self.summary_lbl)

    def refresh(self):
        self._tasks = task_service.list_tasks(
            include_done=self.show_done.isChecked())
        self.table.setRowCount(len(self._tasks))
        bold = QFont()
        bold.setBold(True)
        for r, t in enumerate(self._tasks):
            due_disp = task_service.format_due_at(t.get("due_at", ""))["text"]
            if t["status"] == task_service.STATUS_DONE:
                left = "—"
            elif t["overdue"]:
                mins = -t["minutes_left"]
                left = (f"متأخرة {mins // 60} س {mins % 60} د"
                        if mins >= 60 else f"متأخرة {mins} د")
            else:
                mins = t["minutes_left"]
                if mins >= 1440:
                    left = f"بعد {mins // 1440} يوم"
                elif mins >= 60:
                    left = f"بعد {mins // 60} س {mins % 60} د"
                else:
                    left = f"بعد {mins} د"
            title_disp = t["title"]
            link_bits = []
            if t.get("customer_name"):
                link_bits.append(t["customer_name"])
            if t.get("contract_number"):
                link_bits.append(t["contract_number"])
            if link_bits:
                title_disp += "  (" + " · ".join(link_bits) + ")"
            if self.compact:
                values = [title_disp, due_disp, left]
            else:
                values = [title_disp, due_disp, t["source"], t["status"], left]
            for col, val in enumerate(values):
                item = QTableWidgetItem(str(val))
                item.setTextAlignment(Qt.AlignCenter if col else
                                      Qt.AlignRight | Qt.AlignVCenter)
                if col == 3 and not self.compact:
                    if t["status"] == task_service.STATUS_DONE:
                        _c = style.OK_GREEN
                    elif t["overdue"]:
                        _c = style.theme()["RED"]
                    else:
                        _c = style.INFO
                    item.setForeground(QColor(_c))
                elif t["status"] == task_service.STATUS_DONE:
                    item.setForeground(QColor(style.theme()["MUTED"]))
                elif t["overdue"]:
                    item.setForeground(QColor(style.theme()["RED"]))
                    if col == len(values) - 1:
                        item.setFont(bold)
                self.table.setItem(r, col, item)
        open_count = sum(1 for t in self._tasks
                         if t["status"] == task_service.STATUS_OPEN)
        overdue = sum(1 for t in self._tasks if t.get("overdue"))
        self.summary_lbl.setText(
            f"مهام مفتوحة: {open_count}   |   متأخرة: {overdue}")

        from ui.widgets import sync_header_alignment
        sync_header_alignment(self.table)

    def _selected(self) -> dict | None:
        row = self.table.currentRow()
        if row < 0 or row >= len(self._tasks):
            style.info(self, "اختر مهمة من الجدول أولاً.")
            return None
        return self._tasks[row]

    def _add(self):
        if TaskDialog(self).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _edit(self):
        t = self._selected()
        if not t:
            return
        if TaskDialog(self, task=t).exec() == QDialog.Accepted:
            self.refresh()
            self.data_changed.emit()

    def _complete(self):
        t = self._selected()
        if not t:
            return
        task_service.complete_task(t["id"])
        self.refresh()
        self.data_changed.emit()

    def _reopen(self):
        t = self._selected()
        if not t:
            return
        task_service.reopen_task(t["id"])
        self.refresh()
        self.data_changed.emit()

    def _delete(self):
        t = self._selected()
        if not t:
            return
        if style.confirm(self, f"حذف المهمة «{t['title']}»؟"):
            task_service.delete_task(t["id"])
            self.refresh()
            self.data_changed.emit()

    def _whatsapp(self):
        """إرسال ملخص المهمة عبر واتساب · للمدير أو للعميل المرتبط."""
        t = self._selected()
        if not t:
            return
        from PySide6.QtWidgets import QMenu, QApplication
        from PySide6.QtGui import QCursor
        from services import settings_service
        from services.extras_service import open_whatsapp
        from services.task_service import (task_whatsapp_message,
                                           task_customer_phone,
                                           task_party_name)

        manager_phone = settings_service.get_settings().manager_phone.strip()
        customer_phone = task_customer_phone(t)
        # الطرف: العميل المرتبط مباشرة أو صاحب العقد المرتبط
        party_name = task_party_name(t)

        menu = QMenu(self)
        mgr_label = "📤 إرسال ملخص للمدير"
        if manager_phone:
            mgr_label += f" ({manager_phone})"
        act_manager = menu.addAction(mgr_label)
        act_customer = None
        if party_name:
            act_customer = menu.addAction(f"📤 تذكير للعميل ({party_name})")
        chosen = menu.exec(QCursor.pos())
        if chosen is None:
            return

        if chosen is act_manager:
            msg = task_whatsapp_message(t, for_customer=False)
            phone = manager_phone
            who = "المدير"
            hint = ("رقم واتساب المدير غير مسجل.\n"
                    "سجّله من: الإعدادات ← الشركة ← واتساب المدير.\n\n"
                    "تم نسخ الرسالة · الصقها في المحادثة يدويًا:")
        else:
            msg = task_whatsapp_message(t, for_customer=True)
            phone = customer_phone
            who = "العميل"
            hint = ("لا يوجد رقم هاتف مسجل لهذا العميل.\n\n"
                    "تم نسخ الرسالة · الصقها في المحادثة يدويًا:")

        QApplication.clipboard().setText(msg)
        if phone and open_whatsapp(phone, msg):
            style.info(self,
                       f"تم فتح واتساب على محادثة {who} والرسالة جاهزة · "
                       "اضغط إرسال.", "واتساب جاهز")
        else:
            style.info(self, hint + "\n\n" + msg, "رسالة واتساب جاهزة")
