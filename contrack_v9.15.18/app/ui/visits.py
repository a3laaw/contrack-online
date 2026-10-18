# -*- coding: utf-8 -*-
"""شاشة «جدول الزيارات اليومي» — صفوف الساعات × أعمدة المهندسين.

كل خانة (ساعة × موظف) تُفتح بنقرة مزدوجة: بحث عن العميل وتثبيت
الزيارة · ملاحظة · ترحيل كمهمة تذكير بموعدها · تذكير واتساب
للمهندس والعميل — وتصدير جدول اليوم PDF.
الموظفون وساعات العمل من: الإعدادات ← جدول الزيارات.
"""
from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (QDateEdit, QDialog, QFormLayout,
                               QHBoxLayout, QHeaderView, QLabel, QLineEdit,
                               QPushButton, QTableWidget, QTableWidgetItem,
                               QTextEdit, QVBoxLayout, QWidget)

from services import auth_service, visits_service as vs
from services.customer_service import ValidationError
from ui import style
from ui.widgets import flow_host, sync_header_alignment


class VisitsPage(QWidget):
    """جدول الزيارات اليومي."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # ===== الشريط العلوي المختصر والملتّف =====
        top = QWidget()
        top.setObjectName("pageHeader")
        top_box = QVBoxLayout(top)
        top_box.setContentsMargins(16, 8, 16, 6)
        from ui.widgets import flow_host
        tools_host, tl = flow_host(spacing=7)
        title = QLabel("جدول الزيارات")
        title.setProperty("pageTitle", True)
        tl.addWidget(title)

        today_btn = QPushButton("◷ اليوم")
        today_btn.setToolTip("العودة لتاريخ اليوم")
        today_btn.setProperty("flat", True)
        today_btn.clicked.connect(lambda: self._set_date(QDate.currentDate()))
        tl.addWidget(today_btn)
        self.date_edit = QDateEdit()
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDisplayFormat("yyyy-MM-dd")
        self.date_edit.setDate(QDate.currentDate())
        self.date_edit.dateChanged.connect(lambda _: self.refresh())
        tl.addWidget(self.date_edit)

        pdf_btn = QPushButton("⬇ تصدير PDF")
        pdf_btn.setProperty("flat", True)
        pdf_btn.setToolTip("جدول اليوم كاملًا بهوية الشركة — للطباعة "
                           "أو الإرسال")
        pdf_btn.clicked.connect(self._export_pdf)
        tl.addWidget(pdf_btn)
        tasks_btn = QPushButton("➤ ترحيل كمهام")
        tasks_btn.setProperty("flat", True)
        tasks_btn.setToolTip("كل زيارة تُحوَّل مهمة تذكير بموعدها — "
                             "للموظف متابعتها مثل بقية المهام")
        tasks_btn.clicked.connect(self._tasks_all)
        tl.addWidget(tasks_btn)
        top_box.addWidget(tools_host)
        outer.addWidget(top)

        # ===== الجدول =====
        body = QWidget()
        body.setObjectName("transparentHost")
        bl = QVBoxLayout(body)
        bl.setContentsMargins(16, 6, 16, 8)
        bl.setSpacing(8)
        self.hint = QLabel("")
        self.hint.setProperty("hint", True)
        self.hint.setWordWrap(True)
        bl.addWidget(self.hint)
        self.table = QTableWidget(0, 1)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectItems)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(
            QHeaderView.Stretch)
        self.table.verticalHeader().setDefaultSectionSize(46)
        self.table.doubleClicked.connect(self._cell_dialog)
        bl.addWidget(self.table, 1)
        outer.addWidget(body, 1)

    # ==================== العرض ====================
    def showEvent(self, event):  # noqa: N802
        super().showEvent(event)
        try:
            self.refresh()
        except Exception:
            pass

    def _set_date(self, d: QDate):
        self.date_edit.setDate(d)
        self.refresh()

    def _day(self) -> str:
        return self.date_edit.date().toString("yyyy-MM-dd")

    def refresh(self):
        staff = vs.list_staff()
        slots = vs.hour_slots()
        visits = {(v["hour_slot"], v["staff_id"]): v
                  for v in vs.day_visits(self._day())}
        self.table.setColumnCount(max(1, len(staff) + 1))
        heads = ["الساعة"] + [s["name"] for s in staff]
        self.table.setHorizontalHeaderLabels(heads)
        self.table.setRowCount(len(slots))
        t = style.theme()
        for r, slot in enumerate(slots):
            head = QTableWidgetItem(slot)
            head.setTextAlignment(Qt.AlignCenter)
            # خلفية فاتحة بنص غامق عريض — واضح في كل الأحوال (كان
            # أبيض على أزرق غير مقروء)
            from PySide6.QtGui import QColor, QFont
            bold = QFont()
            bold.setBold(True)
            head.setFont(bold)
            head.setForeground(QColor(t["BRAND_900"]))
            head.setBackground(QColor(t["BRAND_100"]))
            self.table.setItem(r, 0, head)
            for c, st in enumerate(staff, 1):
                v = visits.get((slot, st["id"]))
                if v:
                    txt = str(v.get("customer_name") or "—")
                    if v.get("task_id"):
                        txt += "\n✓ مهمة"
                    if v.get("note"):
                        txt += f"\n{v['note']}"
                    item = QTableWidgetItem(txt)
                    item.setTextAlignment(Qt.AlignCenter)
                    from PySide6.QtGui import QColor
                    item.setBackground(QColor(t["BRAND_50"]))
                    tip = (f"زيارة: {v.get('customer_name')}\n"
                           f"الساعة {slot} · {st['name']}")
                    if v.get("task_id"):
                        tip += "\nمرحَّلة كمهمة تذكير"
                    item.setToolTip(tip)
                    self.table.setItem(r, c, item)
                else:
                    item = QTableWidgetItem("—")
                    item.setTextAlignment(Qt.AlignCenter)
                    from PySide6.QtGui import QColor
                    item.setForeground(QColor(t["TEXT_400"]))
                    item.setToolTip("نقرة مزدوجة لحجز زيارة في هذه "
                                    "الخانة")
                    self.table.setItem(r, c, item)
        sync_header_alignment(self.table)
        self.hint.setText(
            "نقرة مزدوجة على أي خانة: بحث عن العميل وحجز الزيارة · "
            "الترحيل كمهمة وتذكير الواتساب من نفس النافذة · "
            "الموظفون وساعات العمل من: الإعدادات ← جدول الزيارات"
            if staff else
            "لا موظفين بعد — أضف المهندسين من: الإعدادات ← جدول "
            "الزيارات.")
        if not slots:
            self.hint.setText("ساعات العمل غير مضبوطة — اضبطها من: "
                              "الإعدادات ← جدول الزيارات.")

    # ==================== نافذة الخانة ====================
    def _cell_dialog(self, index):
        staff = vs.list_staff()
        slots = vs.hour_slots()
        r, c = index.row(), index.column()
        if c < 1 or r >= len(slots) or c > len(staff):
            return
        slot = slots[r]
        st = staff[c - 1]
        day = self._day()
        visit = vs.get_visit(day, slot, st["id"])

        dlg = QDialog(self)
        dlg.setWindowTitle(f"زيارة {slot} · {st['name']}")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(430)
        form = QFormLayout(dlg)
        form.setSpacing(10)
        info = QLabel(f"📅 {day} · 🕒 {slot} · 👷 {st['name']}")
        info.setProperty("hint", True)
        form.addRow(info)

        from ui.widgets import SearchableComboBox
        combo = SearchableComboBox(search_only=True)
        from services import customer_service
        combo.set_items(
            [("-- تفريغ الخانة --", None)] +
            [(cu.name, cu.id)
             for cu in customer_service.list_customers()],
            auto_select=False)
        if visit and visit.get("customer_id"):
            combo.select_data(visit["customer_id"])
        form.addRow("العميل:", combo)

        note = QTextEdit()
        note.setPlainText(visit.get("note") or "" if visit else "")
        note.setFixedHeight(64)
        note.setPlaceholderText("ملاحظة الزيارة (مثال: قياس الموقع)...")
        form.addRow("الملاحظة:", note)

        btns_host, btns = flow_host(spacing=8)
        save = QPushButton("💾 حفظ")
        save.setObjectName("btnPrimary")
        save.clicked.connect(dlg.accept)
        btns.addWidget(save)
        if visit:
            task_b = QPushButton("➤ ترحيل كمهمة")
            task_b.setProperty("flat", True)
            task_b.setToolTip("مهمة تذكير بموعد الزيارة — مثل بقية "
                              "المهام في النظام")
            task_b.clicked.connect(lambda: self._to_task(day, slot, st))
            btns.addWidget(task_b)
            # V4.5.13: مفتاح «إرسال واتساب» يخفي زرّي التذكير
            from services import feature_service as _feat13v
            _wa13 = _feat13v.enabled("whatsapp")
            _tk13 = _feat13v.enabled("tasks")
            wa_eng = QPushButton("✉ تذكير المهندس")
            wa_eng.setProperty("flat", True)
            wa_eng.setToolTip("فتح واتساب برسالة تذكير للموظف")
            wa_eng.clicked.connect(
                lambda: self._remind(day, slot, st, True))
            btns.addWidget(wa_eng)
            wa_c = QPushButton("✉ تذكير العميل")
            wa_c.setProperty("flat", True)
            wa_c.setToolTip("فتح واتساب برسالة تذكير موعد الزيارة "
                            "للعميل")
            wa_c.clicked.connect(
                lambda: self._remind(day, slot, st, False))
            btns.addWidget(wa_c)
            # V4.5.13: الإخفاء بعد الإضافة للأب (قاعدة 53 — لا وميض)
            if not _tk13:
                task_b.setVisible(False)
            if not _wa13:
                wa_eng.setVisible(False)
                wa_c.setVisible(False)
        cancel = QPushButton("✕ إغلاق")
        cancel.setProperty("flat", True)
        cancel.clicked.connect(dlg.reject)
        btns.addWidget(cancel)
        form.addRow(btns_host)

        if dlg.exec() == QDialog.Accepted:
            try:
                vs.set_visit(day, slot, st["id"], combo.selected_data(),
                             note.toPlainText().strip(),
                             auth_service.current_username())
            except Exception as exc:
                style.error(self, str(exc))
                return
            self.refresh()
            style.toast(self, "تم حفظ خانة الزيارة")

    # ==================== الإجراءات ====================
    def _to_task(self, day, slot, st):
        try:
            tid = vs.visit_to_task(day, slot, st["id"])
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.refresh()
        style.toast(self, f"تم ترحيل الزيارة كمهمة تذكير (مهمة رقم "
                          f"{tid}) بموعدها {day} {slot}")

    def _remind(self, day, slot, st, to_engineer):
        try:
            ok = vs.send_reminder(day, slot, st["id"], to_engineer)
        except Exception as exc:
            style.error(self, str(exc))
            return
        if not ok:
            style.error(self, "تعذر فتح واتساب — تأكد من وجود متصفح "
                              "افتراضي على الجهاز.")

    def _export_pdf(self):
        import os
        import tempfile
        from services import settings_service
        out = os.path.join(
            tempfile.gettempdir(),
            f"جدول_الزيارات_{self._day()}.pdf")
        try:
            vs.export_day_pdf(self._day(), out)
        except Exception as exc:
            style.error(self, f"تعذر التصدير: {exc}")
            return
        from ui.pdf_preview import PdfPreviewDialog
        PdfPreviewDialog(
            self, out, f"جدول الزيارات — {self._day()}",
            save_name=os.path.basename(out)).exec()

    def _tasks_all(self):
        """ترحيل كل زيارات اليوم غير المرحَّلة كمهام تذكير."""
        day = self._day()
        visits = [v for v in vs.day_visits(day) if not v.get("task_id")]
        if not visits:
            style.info(self, "لا زيارات بحاجة إلى ترحيل — كل زيارات "
                             "اليوم مرحَّلة بالفعل (أو الجدول فاضغ).")
            return
        if not style.confirm(
                self, f"ترحيل {len(visits)} زيارة كمهام تذكير "
                      f"بمواعيدها؟", "ترحيل يوم كامل"):
            return
        done = 0
        for v in visits:
            try:
                vs.visit_to_task(day, v["hour_slot"], v["staff_id"])
                done += 1
            except Exception:
                pass
        self.refresh()
        style.toast(self, f"تم ترحيل {done} زيارة كمهام تذكير")
