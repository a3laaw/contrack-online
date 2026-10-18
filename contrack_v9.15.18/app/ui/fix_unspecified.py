# -*- coding: utf-8 -*-
"""شاشة مراجعة وإصلاح «عقود غير محدد».

تعرض كل عقد نوعه فارغ أو «غير محدد» في جدول مراجعة:
    العميل | رقم العقد | اسم/وصف العقد | النوع المقترح |
    حالة المراحل | حالة سندات القبض | القرار

قواعد الأمان المطبّقة في هذه الشاشة:
  · لا شيء يُنفَّذ إلا بضغط «تنفيذ الإصلاح» + تأكيد صريح.
  · القرار الافتراضي لأي عقد عليه مراحل/تقدّم/سندات/تعليقات هو
    «تحديث النوع فقط» — إعادة البناء اختيار يدوي صريح منك.
  · إعادة بناء مراحل عقد عليه تقدّم فعلي تتطلب تأكيدًا ثانيًا
    منفصلًا؛ وبدونه تُخفَّض تلقائيًا إلى «تحديث النوع فقط».
  · لا يُحذف عقد ولا عميل · ولا يُعدَّل ولا يُلغى أي سند قبض ·
    ولا يُنقل أي سند من عقد لآخر.
"""
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QDialog, QHBoxLayout, QHeaderView, QLabel,
    QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services import types_setup_service as tss
from ui import style


class FixUnspecifiedDialog(QDialog):
    """شاشة مراجعة عقود «غير محدد» واتخاذ قرار لكل عقد."""

    COL_CUSTOMER = 0
    COL_NUMBER = 1
    COL_NAME = 2
    COL_TYPE = 3
    COL_STAGES = 4
    COL_RECEIPTS = 5
    COL_ACTION = 6
    HEADERS = ["العميل", "رقم العقد", "اسم / وصف العقد", "النوع المقترح",
               "حالة المراحل", "حالة سندات القبض", "القرار"]

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("إصلاح عقود غير محدد")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 1280, 760, min_w=900, min_h=520)
        self._rows: list[dict] = []
        self._type_names: list[str] = []

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 16)
        layout.setSpacing(12)

        title = QLabel("🛠 إصلاح عقود «غير محدد»")
        title.setProperty("pageTitle", True)
        layout.addWidget(title)

        note = QLabel(
            "راجع كل عقد واختر قراره. <b>لن يُنفَّذ شيء قبل ضغط زر التنفيذ "
            "والتأكيد.</b><br>"
            "العقد الذي عليه مراحل أو تقدّم أو سندات أو تعليقات يظهر "
            "بخلفية تحذيرية وقراره الافتراضي «تحديث النوع فقط» حمايةً "
            "لبياناتك.<br>"
            "لن يُحذف أي عقد أو عميل · ولن يُعدَّل أو يُلغى أي سند قبض · "
            "ولن يُنقل أي سند لعقد آخر.")
        note.setWordWrap(True)
        layout.addWidget(note)

        # شريط أدوات جماعي
        tools = QHBoxLayout()
        self.count_lbl = QLabel("—")
        self.count_lbl.setProperty("sectionTitle", True)
        tools.addWidget(self.count_lbl)
        tools.addStretch()
        all_skip = QPushButton("تعيين الكل: تخطي")
        all_skip.clicked.connect(lambda: self._set_all(tss.ACT_SKIP))
        all_type = QPushButton("تعيين الكل: النوع فقط")
        all_type.clicked.connect(lambda: self._set_all(tss.ACT_TYPE_ONLY))
        reload_btn = QPushButton("🔄 إعادة الفحص")
        reload_btn.clicked.connect(self.reload)
        tools.addWidget(all_skip)
        tools.addWidget(all_type)
        tools.addWidget(reload_btn)
        layout.addLayout(tools)

        self.table = QTableWidget(0, len(self.HEADERS))
        self.table.setHorizontalHeaderLabels(self.HEADERS)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.verticalHeader().setVisible(False)
        head = self.table.horizontalHeader()
        head.setSectionResizeMode(self.COL_NAME, QHeaderView.Stretch)
        for col in (self.COL_CUSTOMER, self.COL_NUMBER, self.COL_TYPE,
                    self.COL_STAGES, self.COL_RECEIPTS, self.COL_ACTION):
            head.setSectionResizeMode(col, QHeaderView.ResizeToContents)
        layout.addWidget(self.table, 1)

        bottom = QHBoxLayout()
        self.apply_btn = QPushButton("🔧 تنفيذ الإصلاح على المحدد")
        self.apply_btn.setObjectName("btnPrimary")
        self.apply_btn.clicked.connect(self._apply)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.setProperty("flat", True)
        close_btn.clicked.connect(self.reject)
        bottom.addWidget(self.apply_btn)
        bottom.addStretch()
        bottom.addWidget(close_btn)
        layout.addLayout(bottom)

        self.reload()
        style.guard_table_sections(self)

    # ---------- تحميل البيانات (قراءة فقط) ----------
    def reload(self):
        from services import contract_type_service as cts
        try:
            self._rows = tss.analyze_unspecified()
        except Exception as exc:
            style.error(self, f"تعذّر فحص العقود: {exc}")
            self._rows = []
        self._type_names = [t["name"] for t in cts.list_types(False)
                            if t["name"] != cts.UNSPECIFIED]

        risky_n = sum(1 for r in self._rows if r["risky"])
        self.count_lbl.setText(
            f"عقود بحاجة لتحديد النوع: {len(self._rows)}  |  "
            f"منها {risky_n} عقد يحتاج انتباهًا (مراحل/سندات/تعليقات)")
        self.apply_btn.setEnabled(bool(self._rows))

        self.table.setRowCount(0)
        if not self._rows:
            return
        self.table.setRowCount(len(self._rows))
        for i, r in enumerate(self._rows):
            self._fill_row(i, r)
        self.table.resizeRowsToContents()

    def _fill_row(self, i: int, r: dict):
        def cell(col, text, tip=""):
            item = QTableWidgetItem(str(text))
            item.setTextAlignment(Qt.AlignCenter)
            if tip:
                item.setToolTip(tip)
            if r["risky"]:
                item.setBackground(QColor("#FEF3C7"))
            self.table.setItem(i, col, item)

        cell(self.COL_CUSTOMER, r["customer_name"])
        cell(self.COL_NUMBER, r["contract_number"])
        cell(self.COL_NAME, r["contract_name"] or "—")
        cell(self.COL_STAGES, r["stages_state"], r["risk_reasons"])
        cell(self.COL_RECEIPTS, r["receipts_state"])

        # النوع المقترح (قابل للتغيير يدويًا)
        type_box = QComboBox()
        type_box.addItem("— بدون تحديد —", "")
        for name in self._type_names:
            type_box.addItem(name, name)
        if r["suggested_type"]:
            idx = type_box.findData(r["suggested_type"])
            if idx >= 0:
                type_box.setCurrentIndex(idx)
            from ui.widgets import make_searchable
            make_searchable(type_box, "")
            type_box.setToolTip(
                f"مصدر الاقتراح: {r['source']}"
                + (f" · الكلمة: «{r['evidence']}»" if r["evidence"] else ""))
        else:
            type_box.setToolTip("لم يُعرف النوع تلقائيًا — اختره يدويًا.")
        self.table.setCellWidget(i, self.COL_TYPE, self._wrap(type_box))

        # القرار
        act_box = QComboBox()
        from ui.widgets import make_searchable
        make_searchable(act_box, "")
        for key in (tss.ACT_SKIP, tss.ACT_TYPE_ONLY, tss.ACT_TYPE_STAGES):
            act_box.addItem(tss.ACTION_LABELS[key], key)
        default = r["default_action"] if r["suggested_type"] else tss.ACT_SKIP
        idx = act_box.findData(default)
        if idx >= 0:
            act_box.setCurrentIndex(idx)
        if r["risky"]:
            act_box.setToolTip(
                "هذا العقد عليه: " + (r["risk_reasons"] or "بيانات قائمة")
                + "\nإعادة بناء المراحل ستحذف مراحله الحالية — "
                  "لا تخترها إلا إذا كنت متأكدًا.")
        self.table.setCellWidget(i, self.COL_ACTION, self._wrap(act_box))

    @staticmethod
    def _wrap(widget) -> QWidget:
        """تغليف عنصر داخل هامش بسيط ليظهر مرتبًا داخل الخلية."""
        holder = QWidget()
        lay = QHBoxLayout(holder)
        lay.setContentsMargins(6, 2, 6, 2)
        lay.addWidget(widget)
        return holder

    def _box(self, row: int, col: int) -> QComboBox | None:
        holder = self.table.cellWidget(row, col)
        return holder.findChild(QComboBox) if holder else None

    def _set_all(self, action: str):
        for i in range(self.table.rowCount()):
            box = self._box(i, self.COL_ACTION)
            if box:
                idx = box.findData(action)
                if idx >= 0:
                    box.setCurrentIndex(idx)

    # ---------- التنفيذ ----------
    def _collect(self) -> tuple[list[dict], list[str], int]:
        """يجمع القرارات · يرجع (القرارات، مشاكل، عدد الخطِر)."""
        decisions, problems, risky_rebuild = [], [], 0
        for i, r in enumerate(self._rows):
            act_box = self._box(i, self.COL_ACTION)
            type_box = self._box(i, self.COL_TYPE)
            if not act_box or not type_box:
                continue
            action = act_box.currentData()
            tname = type_box.currentData()
            if action == tss.ACT_SKIP:
                continue
            if not tname:
                problems.append(
                    f"عقد {r['contract_number']} ({r['customer_name']}): "
                    "لم تختر نوعًا — اختر نوعًا أو اجعل قراره «تخطي».")
                continue
            if action == tss.ACT_TYPE_STAGES and r["has_progress"]:
                risky_rebuild += 1
            decisions.append({"contract_id": r["contract_id"],
                              "type_name": tname, "action": action})
        return decisions, problems, risky_rebuild

    def _apply(self):
        decisions, problems, risky_rebuild = self._collect()
        if problems:
            style.error(self, "صحّح التالي أولاً:\n\n- " + "\n- ".join(problems))
            return
        if not decisions:
            style.info(self, "لا يوجد أي عقد محدد للتنفيذ · كل القرارات «تخطي».",
                       "لا شيء للتنفيذ")
            return

        n_type = sum(1 for d in decisions if d["action"] == tss.ACT_TYPE_ONLY)
        n_both = sum(1 for d in decisions if d["action"] == tss.ACT_TYPE_STAGES)
        msg = ("سيتم الآن:\n"
               f"• تحديث نوع {len(decisions)} عقد\n"
               f"   - منها {n_type} «تحديث النوع فقط» (مراحلها لن تُمس)\n"
               f"   - ومنها {n_both} «إعادة بناء المراحل»\n\n"
               "لن يُحذف أي عقد أو عميل · ولن يُعدَّل أو يُلغى أو يُنقل "
               "أي سند قبض.\n\n"
               "هل أخذت نسخة احتياطية من قاعدة البيانات؟\nهل أنت متأكد؟")
        if not style.confirm(self, msg, "تنفيذ الإصلاح"):
            return

        allow_destructive = False
        if risky_rebuild:
            allow_destructive = style.confirm(
                self,
                f"تحذير أخير ومهم:\n\n{risky_rebuild} عقد عليه <b>تقدّم فعلي "
                "في المراحل</b> (مراحل بدأت أو انتهت) واخترت له «إعادة بناء "
                "المراحل».\n\nإعادة البناء ستحذف مراحله الحالية وتاريخ "
                "تقدّمها وتبنيها من جديد من قالب النوع.\n\n"
                "• اضغط «نعم» للموافقة الصريحة على إعادة بنائها.\n"
                "• اضغط «لا» لتنفيذ «تحديث النوع فقط» لهذه العقود "
                "وترك مراحلها كما هي.",
                "إذن صريح لإعادة بناء مراحل عليها تقدّم")

        try:
            stats = tss.apply_fixes(decisions,
                                    allow_destructive=allow_destructive,
                                    link_receipts=True)
        except Exception as exc:
            style.error(self, f"توقف الإصلاح: {exc}")
            return

        report = ("تم الإصلاح ✅\n\n"
                  f"• عقود حُدِّث نوعها: {stats['type_updated']}\n"
                  f"• عقود أُعيد بناء مراحلها: {stats['stages_rebuilt']}\n")
        if stats["downgraded"]:
            report += (f"• عقود خُفِّض قرارها إلى «النوع فقط» حمايةً "
                       f"لتقدّمها: {stats['downgraded']}\n")
        report += (f"• سندات قبض رُبطت بدفعاتها: {stats['receipts_linked']}\n"
                   f"• سندات بقيت بلا مرحلة ({tss.NO_STAGE_TOKEN}): "
                   f"{stats['receipts_no_stage']}\n")
        if stats["problems"]:
            report += ("\n⚠ لم يُنفَّذ:\n- "
                       + "\n- ".join(stats["problems"][:12]))
        style.info(self, report, "تقرير الإصلاح")
        self.reload()
