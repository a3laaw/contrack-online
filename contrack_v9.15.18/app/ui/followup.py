# -*- coding: utf-8 -*-
"""لوحة «مراحل التنفيذ» — Stepper شجري + عداد أيام + أزرار بلا سحب.

تُدمج داخل شاشات التفاصيل (مركز العقد · السندات · عقود الباطن)
وتعمل مع أي نوع معاملة مسجَّل في `workflow_service.TX_TYPES`.

· المراحل الرئيسية مجموعات بصرية، والفرعيات خطوات المسار.
· البطاقة الحالية تعرض عداد الأيام مقابل المتوقع (أخضر/كهرماني/
  أحمر) وزران: «إنهاء المرحلة» و«تخطي المرحلة» — بلا سحب وإفلات.
· الشات والسجل كما كانا (المشاركة = الرؤية).
"""
from PySide6.QtCore import QDate, Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QDateEdit, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QFrame, QHBoxLayout, QLabel, QLineEdit,
                               QPlainTextEdit, QPushButton, QVBoxLayout, QWidget)

from services import auth_service, workflow_service as wf
from ui import style
from ui.widgets import flow_host, scroll_body


def _norm_stage_name(name: str) -> str:
    """تطبيع بسيط لأسماء مراحل الإشراف في قواعد العملاء القديمة.

    بعض القوالب تُسميها: بداية الإشراف، بدا الإشراف، بدء تعهد الإشراف،
    أو بداية تعهد الاشراف. لذلك لا نعتمد على صيغة واحدة حرفيًا.
    """
    n = (name or "").strip().lower()
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي")):
        n = n.replace(a, b)
    return " ".join(n.split())


def _has_any(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def _is_supervision_start_stage(name: str) -> bool:
    n = _norm_stage_name(name)
    start_words = ("بدا", "بدء", "بدايه", "ابتدا", "شروع", "اصدار")
    subject_words = ("اشراف", "تعهد الاشراف", "تعهد")
    return _has_any(n, start_words) and _has_any(n, subject_words)


def _contract_can_pledge(contract_id: int) -> bool:
    """V3.29: هل يقبل العقد تعهدًا عقديًا؟ (شرط الخدمة نفسه)."""
    try:
        from services import contract_service
        contract = contract_service.get_contract(contract_id)
        if contract is None:
            return False
        if isinstance(contract, dict):
            _months = contract.get("sup_months")
            _monthly = contract.get("sup_monthly")
        else:
            _months = getattr(contract, "sup_months", 0)
            _monthly = getattr(contract, "sup_monthly", 0)
        return int(_months or 0) > 0 and float(_monthly or 0) > 0
    except Exception:
        return False


def _should_ask_supervision_start(contract_id: int, stage_name: str,
                                  is_stamped: bool = False) -> bool:
    """هل يجب طلب تاريخ بداية الإشراف عند إنهاء/بدء المرحلة الحالية؟

    نعتمد أولًا على اسم المرحلة «بداية الإشراف». ولحماية نسخ العملاء
    القديمة أو القوالب المعدلة، لو العقد من نوع إشراف والمرحلة الحالية
    هي مرحلة بداية/بدء حتى لو اسمها لا يحتوي كلمة إشراف، نظهر خانة التاريخ.
    V3.29: بوابة — المرحلة الموسومة يغطيها محرك المراحل الجديد فلا حوار،
    والتعهد العقدي يُطلب فقط ممن يملك مدة وقيمة مضبوطة.
    V4.0: التعهد يفوز — العقد ذو المدة والقيمة تُسأل مراحله المسماة
    (موسومة أو لا) نوافذ التعهد نفسها كعقد الإشراف تمامًا.
    """
    if _is_supervision_start_stage(stage_name):
        return _contract_can_pledge(contract_id)
    n = _norm_stage_name(stage_name)
    if not _has_any(n, ("بدا", "بدء", "بدايه", "ابتدا", "شروع", "اصدار")):
        return False
    try:
        from services import contract_service
        contract = contract_service.get_contract(contract_id)
        return (bool(contract_service.is_supervision_contract(contract))
                and _contract_can_pledge(contract_id))
    except Exception:
        return False


def _should_ask_supervision_end(contract_id: int, stage_name: str,
                                is_stamped: bool = False) -> bool:
    """V3.29: بوابة سؤال نهاية الإشراف — كالبداية تمامًا.
    V4.0: التعهد يفوز — كالبداية (الطابع يُتجاهل مع وجود مدة وقيمة)."""
    if not _is_supervision_end_stage(stage_name):
        return False
    return _contract_can_pledge(contract_id)


def _supervision_hint(contract_id: int, stage_name: str,
                      is_stamped: bool = False) -> str | None:
    """V3.29: تلميح عند مطابقة الاسم مع انغلاق البوابة.
    V4.0: مع التعهد يُعرض الحوار فلا تلميح · والموسوم بلا تعهد
    لمحرك المراحل فلا تلميح · الباقي يُرشَد للمسارين معًا."""
    if _contract_can_pledge(contract_id):
        return None
    if is_stamped:
        return None
    if not (_is_supervision_start_stage(stage_name)
            or _is_supervision_end_stage(stage_name)):
        return None
    try:
        from services import contract_service
        contract = contract_service.get_contract(contract_id)
        _is_sup = bool(contract_service.is_supervision_contract(contract))
    except Exception:
        _is_sup = False
    if _is_sup:
        return ("عقد إشراف بلا مدة مضبوطة — اضبط «مدة الإشراف» و«قيمة الشهر» "
                "من تعديل بيانات العقد.")
    return ("💡 المرحلة تحمل اسم إشراف بلا تفعيل — اضبط «مدة الإشراف» "
            "و«قيمة الشهر» من بيانات العقد (تعهد عقدي)، أو ضع الطابع "
            "من زر «👁 طابع إشراف» (حساب مرحلي).")


def _ask_supervision_start(parent, contract_id: int, stage_name: str) -> str | None:
    try:
        from services import supervision_service as sup
    except Exception:
        return None
    dlg = QDialog(parent)
    dlg.setWindowTitle("بداية تعهد الإشراف")
    dlg.setLayoutDirection(Qt.RightToLeft)
    form = QFormLayout(dlg)
    info = QLabel(f"مرحلة «{stage_name}» تبدأ حساب مدة الإشراف والتمديد.")
    info.setWordWrap(True); info.setProperty("hint", True)
    start = QDateEdit()
    start.setCalendarPopup(True); start.setDisplayFormat("yyyy-MM-dd")
    start.setDate(QDate.currentDate())
    form.addRow(info)
    form.addRow("تاريخ بداية تعهد الإشراف:", start)
    bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
    bb.button(QDialogButtonBox.Save).setText("اعتماد البداية")
    bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
    bb.accepted.connect(dlg.accept); bb.rejected.connect(dlg.reject)
    form.addRow(bb)
    if dlg.exec() != QDialog.Accepted:
        return None
    chosen = start.date().toString("yyyy-MM-dd")
    try:
        sup.set_supervision_start_from_stage(contract_id, chosen)
    except Exception as exc:
        style.error(parent, str(exc))
        return None
    return chosen


def _is_supervision_end_stage(name: str) -> bool:
    n = _norm_stage_name(name)
    end_words = ("انهاء", "انتهاء", "نهايه", "نهاية", "اغلاق", "اقفال", "ختم")
    subject_words = ("اشراف", "تعهد الاشراف", "تعهد")
    return _has_any(n, end_words) and _has_any(n, subject_words)


def _ask_supervision_end(parent, contract_id: int, stage_name: str) -> str | None:
    dlg = QDialog(parent)
    dlg.setWindowTitle("تاريخ إنهاء الإشراف")
    dlg.setLayoutDirection(Qt.RightToLeft)
    form = QFormLayout(dlg)
    info = QLabel(
        f"مرحلة «{stage_name}» توقف حساب أيام الإشراف بعد التاريخ المعتمد.")
    info.setWordWrap(True); info.setProperty("hint", True)
    end = QDateEdit()
    end.setCalendarPopup(True); end.setDisplayFormat("yyyy-MM-dd")
    end.setDate(QDate.currentDate())
    form.addRow(info)
    form.addRow("تاريخ إنهاء الإشراف:", end)
    bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
    bb.button(QDialogButtonBox.Save).setText("اعتماد النهاية")
    bb.button(QDialogButtonBox.Cancel).setText("إلغاء")
    bb.accepted.connect(dlg.accept); bb.rejected.connect(dlg.reject)
    form.addRow(bb)
    if dlg.exec() != QDialog.Accepted:
        return None
    return end.date().toString("yyyy-MM-dd")


def _state_chip(text: str, state: str, color: str = "") -> QLabel:
    """شريحة مرحلة بحسب حالتها (done/current/future/skip)."""
    chip = QLabel(text)
    chip.setAlignment(Qt.AlignCenter)
    chip.setToolTip(text)  # V4.39: الاسم الكامل عند التحويم
    t = style.theme()
    if state == "done":
        chip.setStyleSheet(
            f"background: {t['SUCCESS_600']}; color: white;"
            "font-weight: 800; border-radius: 10px; padding: 5px 12px;")
    elif state == "skip":
        chip.setStyleSheet(
            f"color: {style.NEUTRAL}; border: 1.5px dashed {t['BORDER']};"
            "border-radius: 10px; padding: 5px 12px;")
    elif state == "current":
        c = color or t["BRAND_600"]
        chip.setStyleSheet(
            f"background: {c}; color: white; font-weight: 800;"
            "border-radius: 10px; padding: 5px 12px;")
    else:
        chip.setStyleSheet(
            f"color: {style.NEUTRAL}; border: 1.5px solid {t['BORDER']};"
            "border-radius: 10px; padding: 5px 12px;")
    return chip




def _is_cancelled_contract(tx_type: str, tx_id: int) -> bool:
    if tx_type != wf.TX_CONTRACT or not tx_id:
        return False
    try:
        from services import ui_data_service as _ui_data
        return _ui_data.contract_status(tx_id) == "ملغى"
    except Exception:
        return False

class StageSupervisionDialog(QDialog):
    """V3.21: الطابع الإشرافي لمرحلة عقد — بداية/نهاية/تنازل كعقد الإشراف."""

    def __init__(self, parent, stage_id: int):
        super().__init__(parent)
        self._stage_id = int(stage_id)
        self.setWindowTitle("الطابع الإشرافي للمرحلة")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(440)
        lay = QVBoxLayout(self)
        self.info_lbl = QLabel()
        self.info_lbl.setWordWrap(True)
        self.info_lbl.setProperty("hint", True)
        lay.addWidget(self.info_lbl)
        form = QFormLayout()
        lay.addLayout(form)
        self.flag = QCheckBox("مرحلة ذات طابع إشراف")
        form.addRow(self.flag)
        # V3.23: المصدر قالب النوع في الإعدادات — هنا تجاوز لهذا العقد
        _src_hint = QLabel("الطابع يأتي من قالب النوع (الإعدادات ← مراحل "
                           "المتابعة) — التعديل هنا تجاوز لهذا العقد فقط.")
        _src_hint.setWordWrap(True)
        _src_hint.setProperty("hint", True)
        form.addRow(_src_hint)
        self.end = QDateEdit()
        self.end.setCalendarPopup(True)
        self.end.setDisplayFormat("yyyy-MM-dd")
        self.end.setDate(QDate.currentDate())
        form.addRow("النهاية المخططة:", self.end)
        self.monthly = QDoubleSpinBox()
        self.monthly.setRange(0, 10000000)
        self.monthly.setDecimals(3)
        self.monthly.setSuffix(" د.ك/شهر")
        form.addRow("قيمة الشهر:", self.monthly)
        self.start_date = QDateEdit()
        self.start_date.setCalendarPopup(True)
        self.start_date.setDisplayFormat("yyyy-MM-dd")
        self.start_date.setDate(QDate.currentDate())
        form.addRow("تاريخ البداية:", self.start_date)
        self.finish_date = QDateEdit()
        self.finish_date.setCalendarPopup(True)
        self.finish_date.setDisplayFormat("yyyy-MM-dd")
        self.finish_date.setDate(QDate.currentDate())
        form.addRow("تاريخ الإنهاء:", self.finish_date)
        self.waive_months = QDoubleSpinBox()
        self.waive_months.setRange(0, 1200)
        self.waive_months.setDecimals(2)
        self.waive_months.setSuffix(" شهر")
        form.addRow("تنازل (مدير):", self.waive_months)
        self.waive_reason = QLineEdit()
        self.waive_reason.setPlaceholderText("سبب التنازل")
        form.addRow("سبب التنازل:", self.waive_reason)
        self.status_lbl = QLabel()
        self.status_lbl.setWordWrap(True)
        self.status_lbl.setStyleSheet("font-weight: 800;")
        lay.addWidget(self.status_lbl)
        row = QHBoxLayout()
        lay.addLayout(row)
        self.save_btn = QPushButton("💾 حفظ الطابع")
        self.save_btn.clicked.connect(self._save_flag)
        row.addWidget(self.save_btn)
        self.start_btn = QPushButton("بدء الإشراف")
        self.start_btn.clicked.connect(self._start)
        row.addWidget(self.start_btn)
        self.end_btn = QPushButton("إنهاء الإشراف")
        self.end_btn.clicked.connect(self._finish)
        row.addWidget(self.end_btn)
        self.waive_btn = QPushButton("تنازل")
        self.waive_btn.clicked.connect(self._waive)
        row.addWidget(self.waive_btn)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.accept)
        row.addWidget(close_btn)
        self._reload()

    def _row(self):
        from database.database import get_connection
        with get_connection() as conn:
            return conn.execute(
                "SELECT cs.*, c.contract_number FROM contract_stages cs "
                "JOIN contracts c ON c.id = cs.contract_id "
                "WHERE cs.id=?", (self._stage_id,)).fetchone()

    def _reload(self):
        from services import supervision_service as sup
        r = self._row()
        if not r:
            style.error(self, "المرحلة غير موجودة.")
            self.reject()
            return
        d = dict(r)
        self.info_lbl.setText(
            f"العقد {d.get('contract_number') or ''} · "
            f"المرحلة «{d.get('name') or ''}»")
        self.flag.setChecked(bool(d.get("is_supervision")))
        if (d.get("sup_end") or "").strip():
            self.end.setDate(QDate.fromString(d["sup_end"][:10], "yyyy-MM-dd"))
        self.monthly.setValue(float(d.get("sup_monthly") or 0))
        try:
            st = sup.stage_supervision_status(self._stage_id)
        except Exception:
            st = None
        if not d.get("is_supervision"):
            self.status_lbl.setText(
                "بلا طابع إشرافي — فعّل الخانة وحدد النهاية والقيمة ثم احفظ.")
        elif not st:
            self.status_lbl.setText("ناقص: حدد النهاية والقيمة ثم ابدأ الإشراف.")
        elif st["delay_months"]:
            self.status_lbl.setText(
                f"\U0001f441 متأخر {st['delay_text']} · "
                f"{st['delay_value']:,.3f} د.ك "
                f"(البداية {st['start']} · النهاية {st['base_end']})")
        elif st["in_extension"]:
            self.status_lbl.setText(
                f"\U0001f441 في التمديد · النهاية الكاملة {st['full_end']}")
        else:
            self.status_lbl.setText(
                f"\U0001f441 ضمن المدة · حتى {st['base_end']}")

    def _save_flag(self):
        from services import supervision_service as sup
        try:
            if self.flag.isChecked():
                sup.setup_stage_supervision(
                    self._stage_id, self.end.date().toString("yyyy-MM-dd"),
                    float(self.monthly.value()))
                style.toast(self, "تم حفظ الطابع الإشرافي")
            else:
                sup.clear_stage_supervision(self._stage_id)
                style.toast(self, "أُزيل الطابع الإشرافي")
        except Exception as exc:
            style.error(self, str(exc))
            return
        self._reload()

    def _start(self):
        from services import supervision_service as sup
        try:
            sup.set_stage_sup_start(
                self._stage_id, self.start_date.date().toString("yyyy-MM-dd"))
            style.toast(self, "بدأ إشراف المرحلة")
        except Exception as exc:
            style.error(self, str(exc))
            return
        self._reload()

    def _finish(self):
        from services import supervision_service as sup
        try:
            sup.set_stage_sup_end(
                self._stage_id, self.finish_date.date().toString("yyyy-MM-dd"))
            style.toast(self, "انتهى إشراف المرحلة — توقفت ساعة التأخير")
        except Exception as exc:
            style.error(self, str(exc))
            return
        self._reload()

    def _waive(self):
        if not style.require_admin(self, "تنازل عن تأخير مرحلة",
                                   perm="action_supervision_waive"):
            return
        from services import supervision_service as sup
        try:
            sup.waive_stage_extension_months(
                self._stage_id, float(self.waive_months.value()),
                self.waive_reason.text())
            style.toast(self, "تم التنازل")
        except Exception as exc:
            style.error(self, str(exc))
            return
        self._reload()


class StageNoteDialog(QDialog):
    """V5.9: ملاحظة على المعاملة (سبب التأخير / واقفة فين).

    تُحفظ بلا تغيير المرحلة، وتظهر في: سجل المراحل · تعليقات العميل ·
    سجل العقد · تقرير مراحل التنفيذ.
    """

    def __init__(self, parent, transaction_type: str, transaction_id: int,
                 stage_name: str = ""):
        super().__init__(parent)
        self.tx_type = transaction_type
        self.tx_id = int(transaction_id or 0)
        self.setWindowTitle("ملاحظة على المعاملة")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(560)
        lay = QVBoxLayout(self)
        lay.setSpacing(10)

        head = QLabel(
            (f"📝 المرحلة الحالية: {stage_name}" if stage_name
             else "📝 ملاحظة على المعاملة")
            + "\nاكتب سبب التأخير أو «واقفة فين» — بلا تغيير للمرحلة.")
        head.setWordWrap(True)
        head.setProperty("hint", True)
        lay.addWidget(head)

        self.prev_box = QVBoxLayout()
        prev_host = QWidget()
        prev_host.setObjectName("transparentHost")
        prev_host.setLayout(self.prev_box)
        _prev_area = scroll_body(prev_host)
        _prev_area.setMaximumHeight(170)
        lay.addWidget(_prev_area)

        self.editor = QPlainTextEdit()
        self.editor.setPlaceholderText("مثال: واقف عند البلدية — بانتظار موافقة الإطفاء")
        self.editor.setMinimumHeight(90)
        lay.addWidget(self.editor)

        hint = QLabel("تظهر الملاحظة في: سجل المراحل · تعليقات العميل · "
                      "سجل العقد · تقرير مراحل التنفيذ.")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        lay.addWidget(hint)

        row_host, row = flow_host(spacing=8)
        self.save_btn = QPushButton("💾 حفظ الملاحظة")
        self.save_btn.setObjectName("btnPrimary")
        self.save_btn.clicked.connect(self._save)
        row.addWidget(self.save_btn)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.reject)
        row.addWidget(close_btn)
        lay.addWidget(row_host)
        self._load_prev()

    def _load_prev(self):
        while self.prev_box.count():
            item = self.prev_box.takeAt(0)
            w = item.widget() if item is not None else None
            if w is not None:
                w.setParent(None)
        try:
            notes = wf.list_stage_notes(self.tx_type, self.tx_id)
        except Exception:
            notes = []
        title = QLabel(("🕘 الملاحظات السابقة" if notes else "لا ملاحظات سابقة"))
        title.setProperty("sectionTitle", True)
        self.prev_box.addWidget(title)
        for n in notes[-12:]:
            line = QLabel(f"{(n.get('created_at') or '')[:16]} — "
                          f"{n.get('author') or 'مستخدم'}"
                          + (f" · {n['stage_name']}" if n.get("stage_name") else "")
                          + f"\n{n.get('note') or ''}")
            line.setWordWrap(True)
            line.setProperty("hint", True)
            self.prev_box.addWidget(line)

    def _save(self):
        body = self.editor.toPlainText().strip()
        if not body:
            style.info(self, "اكتب نص الملاحظة أولًا.")
            return
        try:
            wf.add_stage_note(self.tx_type, self.tx_id, body)
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم حفظ الملاحظة — ظهرت في السجل والتعليقات ✅")
        self.accept()


class FollowupPanel(QWidget):
    """مراحل التنفيذ (Stepper + عداد + أزرار) + سجل + شات المشاركين."""

    changed = Signal()

    def __init__(self, parent=None, transaction_type: str = "",
                 transaction_id: int = 0, show_chat: bool = True,
                 show_history: bool = True):
        super().__init__(parent)
        self.setObjectName("transparentHost")
        self.tx_type = transaction_type
        self.tx_id = int(transaction_id or 0)
        self.show_chat = bool(show_chat)
        self.show_history = bool(show_history)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(10)

        # ===== رسالة عدم الصلاحية =====
        self.denied = QLabel(
            "🔒 هذه المعاملة غير مشتركة معك.\n"
            "اطلب من زميلك أو المدير إشراكك فيها لترى مراحلها ومحادثتها.")
        self.denied.setWordWrap(True)
        self.denied.setAlignment(Qt.AlignCenter)
        self.denied.setStyleSheet(
            f"color: {style.AMBER_TEXT};"
            "background: rgba(217,119,6,0.10); border-radius: 12px;"
            "padding: 22px 18px; font-weight: 700;")
        self.denied.setVisible(False)
        outer.addWidget(self.denied)

        self.body = QWidget()
        self.body.setObjectName("transparentHost")
        body_l = QVBoxLayout(self.body)
        body_l.setContentsMargins(0, 0, 0, 0)
        body_l.setSpacing(10)
        outer.addWidget(self.body, 1)

        # ===== بطاقة المرحلة الحالية + العداد + الأزرار =====
        self.stage_card = QFrame()
        self.stage_card.setProperty("card", True)
        style.soft_shadow(self.stage_card, radius=22, y=5)
        sc_l = QVBoxLayout(self.stage_card)
        sc_l.setContentsMargins(16, 12, 16, 12)
        sc_l.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("🔄 مرحلة التنفيذ")
        title.setProperty("sectionTitle", True)
        top.addWidget(title)
        top.addStretch()
        self.current_lbl = QLabel("—")
        self.current_lbl.setStyleSheet("font-weight: 800;")
        top.addWidget(self.current_lbl)
        # V5.9: النوت الصغير — آخر ملاحظة قدام المعاملة (كاملة في التلميح)
        self.note_chip = QLabel("")
        self.note_chip.setWordWrap(False)
        self.note_chip.setVisible(False)
        top.addWidget(self.note_chip)
        sc_l.addLayout(top)

        # شريط المسار (Stepper) شجريًا: رئيسية عناوين وفرعيات خطوات
        self.steps_host, self.steps = flow_host(spacing=6)
        sc_l.addWidget(self.steps_host)

        # العداد: «مر عليها X يومًا (المتوقع Y)»
        self.counter_lbl = QLabel("")
        self.counter_lbl.setWordWrap(True)
        sc_l.addWidget(self.counter_lbl)

        # أزرار الإجراء — بلا سحب وإفلات
        act_host, act_row = flow_host(spacing=8)
        self.finish_btn = QPushButton("إنهاء هذه المرحلة")
        self.finish_btn.setObjectName("btnReceipt")
        self.finish_btn.setToolTip("إغلاق المرحلة الحالية والانتقال "
                                   "للمرحلة التالية تلقائيًا")
        self.finish_btn.clicked.connect(lambda: self._advance(False))
        act_row.addWidget(self.finish_btn)
        self.skip_btn = QPushButton("تخطي هذه المرحلة")
        self.skip_btn.setProperty("flat", True)
        self.skip_btn.setToolTip("للحالات الاستثنائية — عقد لا يحتاج هذه "
                                 "المرحلة. تُوسم «م تخطيها» في السجل "
                                 "وتظهر في تقرير المراحل المفقودة")
        self.skip_btn.clicked.connect(lambda: self._advance(True))
        act_row.addWidget(self.skip_btn)
        self.revert_btn = QPushButton("تراجع مرحلة")
        self.revert_btn.setObjectName("btnDangerSoft")
        self.revert_btn.setToolTip("للمدير فقط: إرجاع العقد للمرحلة السابقة مع عكس الاستحقاقات التلقائية الآمنة")
        self.revert_btn.clicked.connect(self._revert_stage)
        act_row.addWidget(self.revert_btn)
        # V3.21: الطابع الإشرافي للمرحلة الحالية
        self.sup_btn = QPushButton("\U0001f441 طابع إشراف")
        self.sup_btn.setToolTip("المرحلة بطابع إشرافي: بداية/نهاية وتأخير شهور في ملف تأخيرات الإشراف")
        self.sup_btn.clicked.connect(self._open_stage_supervision)
        act_row.addWidget(self.sup_btn)
        # V3.28: سحب المراحل الناقصة من قالب النوع
        self.pull_btn = QPushButton("⬇ سحب الناقص من القالب")
        self.pull_btn.setToolTip("إدراج مراحل القالب الجديدة في مسار "
                                 "هذا العقد — إدخال فقط بلا مساس "
                                 "بالتقدم أو التواريخ أو خطة الدفع")
        self.pull_btn.clicked.connect(self._pull_missing_stages)
        act_row.addWidget(self.pull_btn)
        # V5.9: ملاحظة المرحلة — سبب التأخير / واقفة فين
        self.note_btn = QPushButton("📝 ملاحظة المرحلة")
        self.note_btn.setToolTip("اكتب سبب التأخير أو «واقفة فين» بلا تغيير "
                                 "المرحلة — تظهر في سجل المراحل وتعليقات "
                                 "العميل وتقرير مراحل التنفيذ")
        self.note_btn.clicked.connect(self._add_stage_note)
        act_row.addWidget(self.note_btn)
        self.note = QLineEdit()
        self.note.setVisible(False)
        sc_l.addWidget(act_host)
        body_l.addWidget(self.stage_card)

        # ===== V4.45: بطاقة المسار اليدوي =====
        self.manual_card = QFrame()
        self.manual_card.setProperty("card", True)
        style.soft_shadow(self.manual_card, radius=22, y=5)
        mc_l = QVBoxLayout(self.manual_card)
        mc_l.setContentsMargins(16, 12, 16, 12)
        mc_l.setSpacing(6)
        mc_top = QHBoxLayout()
        mc_title = QLabel("✅ المسار اليدوي")
        mc_title.setProperty("sectionTitle", True)
        mc_top.addWidget(mc_title)
        mc_top.addStretch()
        self.manual_progress = QLabel("")
        self.manual_progress.setStyleSheet("font-weight: 800;")
        mc_top.addWidget(self.manual_progress)
        mc_l.addLayout(mc_top)
        from PySide6.QtWidgets import QTabWidget as _QTW56
        self.manual_tabs = _QTW56()
        mc_l.addWidget(self.manual_tabs, 1)
        self.manual_card.setVisible(False)
        body_l.addWidget(self.manual_card)

        # ===== الشات =====
        chat_card = QFrame()
        chat_card.setProperty("card", True)
        style.soft_shadow(chat_card, radius=22, y=5)
        ch_l = QVBoxLayout(chat_card)
        ch_l.setContentsMargins(16, 12, 16, 12)
        ch_l.setSpacing(8)
        ch_title = QLabel("💬 محادثة المعاملة")
        ch_title.setProperty("sectionTitle", True)
        ch_l.addWidget(ch_title)

        self.msgs_host = QWidget(self)
        self.msgs_host.setObjectName("transparentHost")
        self.msgs = QVBoxLayout(self.msgs_host)
        self.msgs.setContentsMargins(0, 0, 0, 0)
        self.msgs.setSpacing(6)
        self.msgs_area = scroll_body(self.msgs_host)
        self.msgs_area.setMinimumHeight(180)
        ch_l.addWidget(self.msgs_area, 1)

        send_host, send_row = flow_host(spacing=8)
        self.msg_input = QLineEdit()
        self.msg_input.setPlaceholderText("اكتب رسالتك للمشاركين...")
        self.msg_input.returnPressed.connect(self._send)
        send_row.addWidget(self.msg_input)
        self.send_btn = QPushButton("إرسال")
        self.send_btn.clicked.connect(self._send)
        send_row.addWidget(self.send_btn)
        ch_l.addWidget(send_host)
        chat_card.setVisible(self.show_chat)
        body_l.addWidget(chat_card, 1 if self.show_chat else 0)

        # ===== السجل =====
        hist_card = QFrame()
        hist_card.setProperty("card", True)
        style.soft_shadow(hist_card, radius=22, y=5)
        h_l = QVBoxLayout(hist_card)
        h_l.setContentsMargins(16, 12, 16, 12)
        h_l.setSpacing(6)
        h_title = QLabel("🕒 سجل المراحل")
        h_title.setProperty("sectionTitle", True)
        h_l.addWidget(h_title)
        self.hist_host = QWidget()
        self.hist_host.setObjectName("transparentHost")
        self.hist = QVBoxLayout(self.hist_host)
        self.hist.setContentsMargins(0, 0, 0, 0)
        self.hist.setSpacing(4)
        h_l.addWidget(self.hist_host)
        hist_card.setVisible(self.show_history)
        body_l.addWidget(hist_card)

    def showEvent(self, event):  # noqa: N802
        """تحديث ذاتي عند الظهور — يعمل في أي مكان يُدمج فيه."""
        super().showEvent(event)
        try:
            self.refresh()
        except Exception:
            pass

    # ==================== التحميل ====================
    def set_transaction(self, transaction_type: str, transaction_id: int):
        self.tx_type = transaction_type
        self.tx_id = int(transaction_id or 0)
        self.refresh()

    def _clear(self, layout):
        # لا setParent(None) — dispose_widget يُخفي قبل الحذف (قاعدة قديمة)
        from ui.widgets import dispose_widget as _dispose, flush_disposed
        while layout.count():
            item = layout.takeAt(0)
            w = item.widget() if item is not None else None
            if w is not None:
                _dispose(w, host=self)
        flush_disposed()

    def refresh(self):
        if not self.tx_type or not self.tx_id:
            return
        uid = auth_service.current_user_id()
        # فتح التبويب = مشاركة (المشاركة = الرؤية)
        allowed = wf.can_user_view(uid, self.tx_type, self.tx_id)
        if allowed:
            wf.auto_add_participant(uid, self.tx_type, self.tx_id)
        self.denied.setVisible(not allowed)
        self.body.setVisible(allowed)
        if not allowed:
            return
        self._load_stages()
        if _is_cancelled_contract(self.tx_type, self.tx_id):
            self.finish_btn.setEnabled(False)
            self.skip_btn.setEnabled(False)
            self.revert_btn.setEnabled(False)
            self.sup_btn.setEnabled(False)
            self.counter_lbl.setText("العقد ملغى ومجمّد — لا يمكن تغيير المراحل أو تحفيز دفعات جديدة.")
        self._refresh_manual()
        self._refresh_note_chip()
        if self.show_chat:
            self._load_messages()
        if self.show_history:
            self._load_history()

    # ==================== V5.9: ملاحظات المرحلة ====================
    def _refresh_note_chip(self):
        """الشارة الصغيرة: آخر ملاحظة قدام المعاملة."""
        try:
            n = wf.latest_stage_note(self.tx_type, self.tx_id)
        except Exception:
            n = None
        if not n:
            self.note_chip.setVisible(False)
            return
        txt = (n.get("note") or "").strip()
        short = txt if len(txt) <= 42 else txt[:40] + "…"
        self.note_chip.setText(f"📝 {short}")
        t = style.theme()
        self.note_chip.setToolTip(
            f"{txt}\n\n— {(n.get('author') or 'مستخدم')} · "
            f"{(n.get('created_at') or '')[:16]}"
            + (f" · {n['stage_name']}" if n.get("stage_name") else ""))
        self.note_chip.setStyleSheet(
            f"color: {t['WARNING_600']}; border: 1.5px solid {t['BORDER']};"
            "border-radius: 10px; padding: 3px 10px; font-weight: 700;")
        self.note_chip.setVisible(True)

    def _add_stage_note(self):
        st = {}
        try:
            st = wf.stage_status(self.tx_type, self.tx_id) or {}
        except Exception:
            st = {}
        cur = st.get("current") or {}
        dlg = StageNoteDialog(self, self.tx_type, self.tx_id,
                              stage_name=(cur.get("stage_name")
                                          or cur.get("name") or ""))
        if dlg.exec():
            self._refresh_note_chip()
            if self.show_history:
                self._load_history()
            self.changed.emit()

    # ==================== V4.45: المسار اليدوي ====================
    def _path_badge(self) -> str:
        """V4.50: شارة المسار — يدوي/إجباري/طابع إشراف."""
        if self.tx_type != wf.TX_CONTRACT or not self.tx_id:
            return ""
        try:
            if wf.is_manual_path(self.tx_id):
                return "🔧 مسار يدوي · "
        except Exception:
            return ""
        try:
            from services import contract_service as _cs50
            _con = _cs50.get_contract(self.tx_id)
            if _con is not None and _cs50.is_supervision_contract(_con):
                return "🔧 طابع يدوي — إشراف · "
        except Exception:
            pass
        return "📏 مسار إجباري · "

    def _is_manual_tx(self) -> bool:
        """هل المعاملة الحالية عقد على المسار اليدوي؟"""
        return (self.tx_type == wf.TX_CONTRACT and bool(self.tx_id)
                and wf.is_manual_path(self.tx_id))

    def _refresh_manual(self):
        """إظهار/تحديث بطاقة المسار اليدوي + تجميد الأزرار الخطية."""
        t = style.theme()
        is_contract = (self.tx_type == wf.TX_CONTRACT
                       and bool(self.tx_id))
        cancelled = (_is_cancelled_contract(self.tx_type, self.tx_id)
                     if is_contract else False)
        manual = bool(is_contract and wf.is_manual_path(self.tx_id))
        # V4.56: اليدوي يحجب الخطي تمامًا — لا مساران معًا.
        self.stage_card.setVisible(not manual)
        self.manual_card.setVisible(manual)
        if not manual:
            return
        # المسار الخطي مجمّد في الوضع اليدوي (السحب من القالب يبقى)
        for _b in (self.finish_btn, self.skip_btn, self.revert_btn,
                   self.sup_btn):
            _b.setEnabled(False)
        data = wf.manual_path_groups(self.tx_id)
        self.manual_progress.setText(
            f"المنجز {data['done']} من {data['total']} · "
            f"{data['pct']}٪")
        self.current_lbl.setText(
            f"🔧 مسار يدوي — {data['done']}/{data['total']}")
        self.current_lbl.setToolTip(self.current_lbl.text())
        self.counter_lbl.setText(
            f"🔧 العقد على المسار اليدوي: علّم أي مرحلة من أي تصنيف — "
            f"المنجز {data['done']} من {data['total']}.")
        self.counter_lbl.setStyleSheet(
            f"color: {t['BRAND_700']}; font-weight: 800; font-size: 13px;")
        # V4.56: تاب لكل مرحلة رئيسية — بداخله مراحله الفرعية.
        # V6.3: نحفظ التاب المفتوح قبل إعادة البناء — كان كل تحديث
        # بعد أي حركة يرجع المستخدم لأول تاب («شاشة أول مسار»).
        _keep_tab = self.manual_tabs.currentIndex()
        _keep_name = ""
        try:
            if _keep_tab >= 0:
                _keep_name = self.manual_tabs.tabText(
                    _keep_tab).split(" — ")[0]
        except Exception:
            _keep_name = ""
        self.manual_tabs.clear()
        _forder = wf.stage_finish_order(self.tx_id)
        for g in data["groups"]:
            _tab = QWidget()
            _tab.setObjectName("transparentHost")
            _lay = QVBoxLayout(_tab)
            _lay.setContentsMargins(4, 8, 4, 8)
            _lay.setSpacing(4)
            for it in g["items"]:
                row = QHBoxLayout()
                row.setContentsMargins(18, 0, 0, 0)
                row.setSpacing(8)
                suffix = ""
                pay = it.get("pay") or {}
                if pay.get("title") or pay.get("amount"):
                    suffix = (f"  ·  {pay.get('title', '')} "
                              f"{pay.get('amount', 0):,.0f}")
                    suffix += ("  ✓ مستحقة" if pay.get("triggered")
                               else "  ○ تقديرية")
                elif it["level"] == 1:
                    suffix = "  ·  بدون دفعة"
                cb = QCheckBox(f"{it['name']}{suffix}")
                cb.setProperty("manualStageId", it["id"])
                cb.blockSignals(True)
                cb.setChecked(it["closed"])
                cb.setEnabled(not cancelled)
                cb.blockSignals(False)
                cb.toggled.connect(
                    lambda _c, _sid=it["id"]: self._manual_tick(_sid, _c))
                row.addWidget(cb)
                row.addStretch()
                if it["closed"]:
                    _fn = _forder.get(it["id"])
                    info = QLabel((f"🏁 #{_fn}  " if _fn else "")
                                  + f"✅ {it['end_date']}"
                                  + (f" · {it['closed_by']}"
                                     if it["closed_by"] else ""))
                    info.setStyleSheet(
                        f"color: {t['TEXT_600']}; font-size: 11px;")
                    row.addWidget(info)
                wrap = QWidget()
                wrap.setObjectName("transparentHost")
                wrap.setLayout(row)
                _lay.addWidget(wrap)
            _lay.addStretch(1)
            self.manual_tabs.addTab(
                _tab, f"{g['main']} — {g['done']}/{g['total']}")
        # V6.3: إعادة تحديد نفس التاب بعد إعادة البناء.
        _target = -1
        if _keep_name:
            for _i in range(self.manual_tabs.count()):
                if self.manual_tabs.tabText(_i).split(" — ")[0] == _keep_name:
                    _target = _i
                    break
        if _target < 0 and 0 <= _keep_tab < self.manual_tabs.count():
            _target = _keep_tab
        if _target >= 0:
            self.manual_tabs.setCurrentIndex(_target)

    def _manual_tick(self, stage_id: int, checked: bool):
        if checked:
            skipped = wf.manual_skip_preview(self.tx_id, stage_id)
            if skipped:
                _names = "، ".join(skipped[:3])
                if len(skipped) > 3:
                    _names += f" (+{len(skipped) - 3})"
                if not style.confirm(
                        self, f"⚠ تنبيه تخطٍ: هذه المراحل ما زالت مفتوحة "
                        f"وأسبق ترتيبًا:\n{_names}\n\nسيتقدّم ترتيب "
                        f"الدفعات على ما تُنهيه الآن — متابعة؟",
                        "تنبيه تخطي"):
                    self.refresh()
                    return
            # V4.56: تاريخ التعليم تلقائي (اليوم) — بلا حقل يدوي.
            try:
                res = wf.manual_close_stage(self.tx_id, stage_id, None)
            except Exception as exc:
                style.error(self, str(exc))
                self.refresh()
                return
            n_trig = (len(res["triggered"]) + len(res["triggered_sub"])
                      + len(res["triggered_src"]))
            if n_trig:
                style.toast(
                    self, f"✅ {res['closed']} — استُحقت {n_trig} دفعة",
                    "success")
        else:
            if not style.confirm(
                    self, "إعادة فتح هذه المرحلة؟\n"
                    "الدفعات غير المحصّلة المرتبطة بها تعود تقديرية."):
                self.refresh()
                return
            try:
                res = wf.manual_reopen_stage(self.tx_id, stage_id)
            except Exception as exc:
                style.error(self, str(exc))
                self.refresh()
                return
            if res["kept"]:
                style.toast(
                    self, "⚠ أُعيد فتح المرحلة لكن بقيت "
                    f"{len(res['kept'])} دفعة مستحقة لوجود سندات لاحقة",
                    "warning")
        self.refresh()
        # V4.5.05: إشعار مركز العقد لإعادة بناء الدفعات/المقارنة فورًا.
        self.changed.emit()


    def _load_stages(self):
        """Stepper شجري: رئيسية (عنوان) ثم خطواتها بحالاتها — للعقود من
        **نسخة العقد** (Snapshot) المستقلة عن القالب."""
        t = style.theme()
        self._clear(self.steps)
        st = wf.stage_status(self.tx_type, self.tx_id)
        if self.tx_type == wf.TX_CONTRACT:
            self._load_stages_contract(st)
            self._load_steps_tail(st)
            return
        tree = wf.stage_tree(self.tx_type)
        cur = st["current"]
        self.current_lbl.setText(
            self._path_badge()
            + (cur["stage_name"] if cur else "اكتمل المسار ✓"))
        self.current_lbl.setToolTip(self.current_lbl.text())

        # شريحة لكل خطوة + عنوان لكل رئيسية (إن كانت مجموعة)
        states = {p["stage"]["id"]: p for p in st["path"]}
        icon = {"done": "✅", "skip": "⏭️", "current": "🔵",
                "future": "⚪"}
        for m in tree:
            if m["children"]:
                head = QLabel(f"▸ {m['stage_name']}")
                head.setStyleSheet(
                    f"color: {t['BRAND_700']}; font-weight: 800;")
                self.steps.addWidget(head)
                for sub in m["children"]:
                    p = states.get(sub["id"])
                    state = p["state"] if p else "future"
                    days = f" · {p['days']} ي" if p and p["days"] else ""
                    self.steps.addWidget(_state_chip(
                        f"{icon[state]} {sub['stage_name']}{days}",
                        state, sub["color"]))
            else:
                p = states.get(m["id"])
                state = p["state"] if p else "future"
                days = f" · {p['days']} ي" if p and p["days"] else ""
                self.steps.addWidget(_state_chip(
                    f"{icon[state]} {m['stage_name']}{days}",
                    state, m["color"]))

        # العداد + الأزرار
        if cur is not None:
            days, expected = st["days_in"], st["expected"]
            if st["state"] == "over":
                color = t["DANGER_600"]
                txt = (f"🔴 متأخر: مر عليها {days} يومًا "
                       f"(المتوقع {expected}) — تجاوز {days - expected} يوم")
            elif st["state"] == "near":
                color = t["WARNING_600"]
                txt = (f"🟡 قاربت على الانتهاء: {days} يومًا "
                       f"من أصل {expected} — بقي {expected - days} يوم")
            else:
                color = t["SUCCESS_700"]
                txt = (f"🟢 مر عليها {days} يومًا"
                       + (f" (المتوقع {expected})" if expected else ""))
            self.counter_lbl.setText(txt)
            self.counter_lbl.setStyleSheet(
                f"color: {color}; font-weight: 800; font-size: 13px;")
            nxt = self._next_stage_name()
            self.finish_btn.setText("إنهاء المرحلة")
            self.finish_btn.setToolTip(
                f"إنهاء «{cur['stage_name']}» والانتقال لـ «{nxt}»"
                if nxt else f"إنهاء «{cur['stage_name']}» — اكتمل المسار")
            self.finish_btn.setEnabled(True)
            self.skip_btn.setEnabled(True)
            self.revert_btn.setVisible(self.tx_type == wf.TX_CONTRACT)
            self.revert_btn.setEnabled(self.tx_type == wf.TX_CONTRACT)
        else:
            self.counter_lbl.setText("اكتمل مسار المراحل لهذه المعاملة.")
            self.counter_lbl.setStyleSheet(
                f"color: {t['SUCCESS_700']}; font-weight: 800;")
            self.finish_btn.setText("إنهاء هذه المرحلة")
            self.finish_btn.setEnabled(False)
            self.skip_btn.setEnabled(False)
            self.revert_btn.setVisible(self.tx_type == wf.TX_CONTRACT)
            self.revert_btn.setEnabled(self.tx_type == wf.TX_CONTRACT)

    def _load_stages_contract(self, st):
        """Stepper أفقي مختصر: السابقة + الحالية + التالية فقط.

        عند وجود 20+ مرحلة لا نكدّس كل الشرائح؛ نعرض سياق العمل الحالي،
        والتقرير/الإعدادات يظلان مكان العرض الكامل للمسار.
        """
        t = style.theme()
        cur = st["current"]
        path = [p for p in st.get("path", [])]
        _sup_cur = bool(cur.get("is_supervision")) if cur else False
        self.current_lbl.setText(
            self._path_badge() + ("\U0001f441 " if _sup_cur else "")
            + (cur["stage_name"] if cur else "اكتمل المسار ✓"))
        self.current_lbl.setToolTip(self.current_lbl.text())
        icon = {"done": "✅", "skip": "⏭️", "current": "🔵", "future": "⚪"}
        total = len(path)
        current_index = None
        if cur is not None:
            ids = [p["stage"]["id"] for p in path]
            if cur["id"] in ids:
                current_index = ids.index(cur["id"])
        else:
            current_index = total
        done_count = sum(1 for p in path if p.get("state") in ("done", "skip"))
        meta = QLabel(f"المعروض: السابقة / الحالية / التالية · المنجز {done_count} من {total}")
        meta.setStyleSheet(f"color: {t['TEXT_600']}; font-size: 11px; font-weight: 700;")
        self.steps.addWidget(meta)

        show_indexes = []
        if total:
            if cur is None:
                show_indexes = list(range(max(0, total - 3), total))
            else:
                for i in (current_index - 1, current_index, current_index + 1):
                    if 0 <= i < total:
                        show_indexes.append(i)
        labels = {}
        if cur is None:
            labels = {i: "سابقة" for i in show_indexes}
        else:
            labels = {current_index - 1: "السابقة", current_index: "الحالية", current_index + 1: "التالية"}
        for i in show_indexes:
            p = path[i]
            s = p["stage"]
            state = p.get("state") or "future"
            days = f" · {p['days']} ي" if p.get("days") else ""
            pay = (f" · {float(s.get('payment_pct') or s.get('pay_pct') or 0):g}%"
                   if float(s.get('payment_pct') or s.get('pay_pct') or 0) > 0 else "")
            prefix = labels.get(i, "")
            name = s.get("stage_name") or s.get("name") or "مرحلة"
            if s.get("is_supervision"):
                name = f"\U0001f441 {name}"
            self.steps.addWidget(_state_chip(f"{prefix}: {icon.get(state,'•')} {name}{pay}{days}", state))
        if total > len(show_indexes):
            tail = QLabel(f"+ {total - len(show_indexes)} مرحلة أخرى في المسار")
            tail.setStyleSheet(f"color: {t['TEXT_400']}; font-size: 10.5px;")
            self.steps.addWidget(tail)

    def _load_steps_tail(self, st):
        """العداد والأزرار بعد بناء الخطوات (للعقود من النسخة)."""
        t = style.theme()
        cur = st["current"]
        if cur is not None:
            days, expected = st["days_in"], st["expected"]
            if st["state"] == "over":
                color = t["DANGER_600"]
                txt = (f"🔴 متأخر: مر عليها {days} يومًا "
                       f"(المتوقع {expected}) — تجاوز {days - expected} يوم")
            elif st["state"] == "near":
                color = t["WARNING_600"]
                txt = (f"🟡 قاربت على الانتهاء: {days} يومًا "
                       f"من أصل {expected} — بقي {expected - days} يوم")
            else:
                color = t["SUCCESS_700"]
                txt = (f"🟢 مر عليها {days} يومًا"
                       + (f" (المتوقع {expected})" if expected else ""))
            self.counter_lbl.setText(txt)
            self.counter_lbl.setStyleSheet(
                f"color: {color}; font-weight: 800; font-size: 13px;")
            nxt = self._next_stage_name()
            self.finish_btn.setText("إنهاء المرحلة")
            self.finish_btn.setToolTip(
                f"إنهاء «{cur['stage_name']}» والانتقال لـ «{nxt}»"
                if nxt else f"إنهاء «{cur['stage_name']}» — اكتمل المسار")
            self.finish_btn.setEnabled(True)
            self.skip_btn.setEnabled(True)
            self.revert_btn.setVisible(self.tx_type == wf.TX_CONTRACT)
            self.revert_btn.setEnabled(self.tx_type == wf.TX_CONTRACT)
        else:
            self.counter_lbl.setText("اكتمل مسار المراحل لهذه المعاملة.")
            self.counter_lbl.setStyleSheet(
                f"color: {t['SUCCESS_700']}; font-weight: 800;")
            self.finish_btn.setText("إنهاء هذه المرحلة")
            self.finish_btn.setEnabled(False)
            self.skip_btn.setEnabled(False)
            self.revert_btn.setVisible(self.tx_type == wf.TX_CONTRACT)
            self.revert_btn.setEnabled(self.tx_type == wf.TX_CONTRACT)
        # V3.21: سطر إشراف المرحلة الحالية + زر الطابع (عقود فقط)
        # V3.28: الطابع عند الحاجة فقط — الجارية موسومة أو القالب فيه إشراف
        # V4.0: التعهد يفوز — العقد ذو المدة والقيمة بلا زر طابع
        # (نوافذ التعهد والكارت تدير إشرافه) · الزر للعقود بلا مدة فقط.
        _tpl_has_sup = False
        _pledged = False
        if self.tx_type == wf.TX_CONTRACT:
            try:
                _tpl_has_sup = wf.template_has_supervision(
                    wf.resolve_scope(wf.TX_CONTRACT, self.tx_id))
            except Exception:
                _tpl_has_sup = False
            try:
                _pledged = _contract_can_pledge(self.tx_id)
            except Exception:
                _pledged = False
        _show_sup = (self.tx_type == wf.TX_CONTRACT and cur is not None
                     and (bool(cur.get("is_supervision")) or _tpl_has_sup)
                     and not _pledged)
        self.sup_btn.setVisible(_show_sup)
        # V3.28: زر السحب يظهر فقط عند وجود مراحل ناقصة في القالب
        _missing_n = 0
        if self.tx_type == wf.TX_CONTRACT:
            try:
                _missing_n = len(wf.preview_missing_stages(
                    self.tx_id).get("missing", []))
            except Exception:
                _missing_n = 0
        self.pull_btn.setVisible(_missing_n > 0)
        if _missing_n > 0:
            self.pull_btn.setText(f"⬇ سحب الناقص من القالب ({_missing_n})")
        if _show_sup and cur.get("is_supervision"):
            try:
                from services import supervision_service as _sup_svc
                _sst = _sup_svc.stage_supervision_status(int(cur["id"]))
            except Exception:
                _sst = None
            if _sst:
                if _sst["delay_months"]:
                    self.counter_lbl.setText(
                        self.counter_lbl.text()
                        + f"\n\U0001f441 إشراف: متأخر {_sst['delay_text']} · "
                          f"{_sst['delay_value']:,.3f} د.ك")
                    self.counter_lbl.setStyleSheet(
                        f"color: {t['DANGER_600']}; "
                        "font-weight: 800; font-size: 13px;")
                elif _sst["in_extension"]:
                    self.counter_lbl.setText(
                        self.counter_lbl.text()
                        + f"\n\U0001f441 إشراف: في التمديد · النهاية الكاملة "
                          f"{_sst['full_end']}")
                else:
                    self.counter_lbl.setText(
                        self.counter_lbl.text()
                        + f"\n\U0001f441 إشراف: ضمن المدة · حتى {_sst['base_end']}")

    def _open_stage_supervision(self):
        """V3.21: حوار الطابع الإشرافي للمرحلة الحالية (عقود فقط)."""
        if self.tx_type != wf.TX_CONTRACT:
            return
        try:
            cur = (wf.stage_status(self.tx_type, self.tx_id).get("current")
                   or {})
            sid = cur.get("id")
            if not sid:
                return
            StageSupervisionDialog(self, int(sid)).exec()
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.refresh()
        self.changed.emit()

    def _pull_missing_stages(self):
        """V3.28: حوار معاينة ثم سحب المراحل الناقصة من قالب النوع."""
        if self.tx_type != wf.TX_CONTRACT:
            return
        try:
            prev = wf.preview_missing_stages(self.tx_id)
        except Exception as exc:
            style.error(self, str(exc))
            return
        if not prev.get("missing"):
            style.toast(self, "لا مراحل ناقصة — المسار مطابق للقالب")
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("سحب المراحل الناقصة من القالب")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(480)
        lay = QVBoxLayout(dlg)
        head = QLabel(
            f"القالب «{prev['scope']}» — ستُدرج "
            f"{len(prev['missing'])} مرحلة في مسار العقد:")
        head.setWordWrap(True)
        head.setProperty("sectionTitle", True)
        lay.addWidget(head)
        for m in prev["missing"]:
            if m["level"] == 0:
                _tag = "عنوان مجموعة"
            elif m["is_supervision"]:
                _tag = "👁 إشرافية"
            else:
                _tag = "تنفيذية"
            _pay = (f" · دفع {m['pay_pct']:g}%"
                    if m["pay_pct"] > 0 else "")
            _mv = (" — نُقلت بعد الحالية" if m["clamped"] else "")
            _row = QLabel(f"• «{m['name']}» — {_tag}{_pay} — "
                          f"بعد «{m['after']}»{_mv}")
            _row.setWordWrap(True)
            lay.addWidget(_row)
        safe = QLabel("إدخال فقط: لا يمس أي تقدم أو تواريخ أو خطة دفع قائمة.")
        safe.setWordWrap(True)
        lay.addWidget(safe)
        if any(m["is_supervision"] for m in prev["missing"]):
            hint = QLabel("تنبيه: المراحل الإشرافية تحتاج تحديد النهاية "
                          "المخططة والبداية من زر «طابع إشراف» لتفعيل "
                          "حساب التأخير.")
            hint.setWordWrap(True)
            lay.addWidget(hint)
        agree = None
        if prev["reopen"]:
            warn = QLabel("⚠ المسار مكتمل حاليًا — سيُعاد فتحه على أول "
                          "مرحلة مُدرجة بتاريخ اليوم.")
            warn.setWordWrap(True)
            lay.addWidget(warn)
            agree = QCheckBox("أوافق على إعادة فتح مسار المراحل")
            lay.addWidget(agree)
        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        _ok = btns.button(QDialogButtonBox.Ok)
        _ok.setText("سحب المراحل")
        btns.button(QDialogButtonBox.Cancel).setText("تراجع")
        if agree is not None:
            _ok.setEnabled(False)
            agree.toggled.connect(_ok.setEnabled)
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        lay.addWidget(btns)
        if dlg.exec() != QDialog.Accepted:
            return
        try:
            rep = wf.pull_missing_stages(self.tx_id)
        except Exception as exc:
            style.error(self, str(exc))
            return
        _msg = f"أُدرجت {len(rep['inserted'])} مرحلة من القالب"
        if rep["reopened"]:
            _msg += f" — أُعيد فتح المسار على «{rep['reopened']}»"
        style.toast(self, _msg)
        self.refresh()
        self.changed.emit()

    def _next_stage_name(self) -> str:
        st = wf.stage_status(self.tx_type, self.tx_id)
        cur = st["current"]
        if cur is None:
            return ""
        path = [p for p in st["path"]]
        ids = [p["stage"]["id"] for p in path]
        if cur["id"] not in ids:
            return path[0]["stage"]["stage_name"] if path else ""
        i = ids.index(cur["id"])
        if i + 1 < len(path):
            return path[i + 1]["stage"]["stage_name"]
        return ""

    def _load_messages(self):
        self._clear(self.msgs)
        rows = wf.get_messages(self.tx_type, self.tx_id)
        if not rows:
            empty = QLabel("لا رسائل بعد · اكتب أول رسالة للمشاركين")
            empty.setProperty("hint", True)
            empty.setAlignment(Qt.AlignCenter)
            self.msgs.addWidget(empty)
            return
        me = auth_service.current_user_id()
        for r in rows:
            mine = int(r.get("user_id") or 0) == me
            bubble = QLabel(
                f"{r['author'] or 'مستخدم'} · {(r['created_at'] or '')[:16]}"
                f"\n{r['message']}")
            bubble.setWordWrap(True)
            bubble.setMinimumWidth(0)
            bg = ("rgba(29,78,216,0.10)" if mine
                  else "rgba(100,116,139,0.10)")
            bubble.setStyleSheet(
                f"background: {bg}; border-radius: 10px; padding: 8px 12px;")
            self.msgs.addWidget(bubble)
        self.msgs.addStretch()

    def _load_history(self):
        self._clear(self.hist)
        rows = wf.get_stage_history(self.tx_type, self.tx_id)
        if not rows:
            empty = QLabel("لا حركة بعد")
            empty.setProperty("hint", True)
            self.hist.addWidget(empty)
            return
        for r in rows[-10:]:
            note = f" · {r['note']}" if r.get("note") else ""
            skip = " · ⏭️ تخطٍ" if int(r.get("is_skipped") or 0) else ""
            span = ""
            started = (r.get("start_date") or "") or \
                str(r.get("moved_at") or "")[:10]
            if started:
                ended = (r.get("end_date") or "") or "حتى الآن"
                span = f" [{started} ← {ended}]"
            line = QLabel(
                f"{(r['moved_at'] or '')[:16]} — {r['stage_name']}"
                f" · {r['moved_by_name'] or 'مستخدم'}{skip}{span}{note}")
            line.setWordWrap(True)
            line.setMinimumWidth(0)
            line.setProperty("hint", True)
            self.hist.addWidget(line)

    # ==================== الإجراءات ====================
    def _revert_stage(self):
        if self.tx_type != wf.TX_CONTRACT:
            style.info(self, "التراجع عن المرحلة متاح لعقود العملاء فقط.")
            return
        if not style.require_admin(self, "التراجع عن مرحلة", perm="action_manage_workflow"):
            return
        from PySide6.QtWidgets import QInputDialog
        reason, ok = QInputDialog.getText(
            self, "سبب التراجع عن المرحلة",
            "اكتب سبب التراجع؛ سيظهر تلقائيًا في تعليقات العميل وسجل العقد:")
        if not ok:
            return
        if not style.confirm(
                self,
                "سيتم إرجاع العقد للمرحلة السابقة.\n"
                "أي استحقاق دفعة تلقائي لم يصدر له سند قبض سيعود لحالة غير مستحق.\n"
                "السندات المالية الموجودة لن تُحذف ولن تُلغى تلقائيًا.",
                "تأكيد التراجع"):
            return
        try:
            res = wf.revert_contract_stage(self.tx_id, reason)
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.note.clear()
        self.refresh()
        self.changed.emit()
        msg = f"تم التراجع من «{res['from']}» إلى «{res['to']}»"
        if res.get("kept_payments"):
            msg += " · توجد دفعات لها سندات لم تُعدل تلقائيًا"
        style.toast(self, msg)

    def _advance(self, skip: bool):
        action_date = None
        if not skip and self.tx_type == wf.TX_CONTRACT:
            try:
                cur = (wf.stage_status(self.tx_type, self.tx_id).get("current") or {})
                stage_name = cur.get("stage_name") or cur.get("name") or ""
                # V3.29: بوابة التعهد القديم + تلميح عند الانغلاق
                _stamped = bool(cur.get("is_supervision"))
                if _should_ask_supervision_start(self.tx_id, stage_name,
                                                 _stamped):
                    action_date = _ask_supervision_start(self, self.tx_id, stage_name)
                    if not action_date:
                        return
                elif _should_ask_supervision_end(self.tx_id, stage_name,
                                                 _stamped):
                    action_date = _ask_supervision_end(self, self.tx_id, stage_name)
                    if not action_date:
                        return
                else:
                    _hint = _supervision_hint(self.tx_id, stage_name,
                                              _stamped)
                    if _hint:
                        style.toast(self, _hint)
            except Exception as exc:
                style.error(self, str(exc))
                return
        try:
            res = wf.advance_stage(self.tx_type, self.tx_id, skip=skip,
                                   note=self.note.text().strip(),
                                   action_date=action_date)
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.note.clear()
        self.refresh()
        self.changed.emit()
        if skip:
            style.toast(self, f"تم تخطي «{res['closed']}»")
        elif res["next"]:
            style.toast(self,
                        f"تم إنهاء «{res['closed']}» — بدأت «{res['next']}»")
        else:
            style.toast(self, f"تم إنهاء «{res['closed']}» — اكتمل المسار ✓")

    def _send(self):
        if not self.show_chat:
            return
        text = self.msg_input.text().strip()
        if not text:
            return
        try:
            wf.add_message(self.tx_type, self.tx_id, text)
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.msg_input.clear()
        self._load_messages()
        self.changed.emit()


class StageBar(QWidget):
    """شريط مرحلة مدمج (للسندات وعقود الباطن): المرحلة + العداد +
    زري إنهاء/تخطي — صف واحد داخل أي نافذة."""

    changed = Signal()

    def __init__(self, parent=None, transaction_type: str = "",
                 transaction_id: int = 0, show_chat: bool = True,
                 show_history: bool = True):
        super().__init__(parent)
        self.setObjectName("transparentHost")
        self.tx_type = transaction_type
        self.tx_id = int(transaction_id or 0)
        self.show_chat = bool(show_chat)
        self.show_history = bool(show_history)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(8)
        t = style.theme()
        card = QFrame()
        card.setProperty("card", True)
        cl = QHBoxLayout(card)
        cl.setContentsMargins(12, 8, 12, 8)
        cl.setSpacing(10)
        self.title_lbl = QLabel("🔄 المرحلة:")
        self.title_lbl.setStyleSheet(f"color: {t['BRAND_700']};"
                                     "font-weight: 800;")
        cl.addWidget(self.title_lbl)
        self.stage_lbl = QLabel("—")
        self.stage_lbl.setStyleSheet("font-weight: 800;")
        cl.addWidget(self.stage_lbl)
        self.counter_lbl = QLabel("")
        self.counter_lbl.setWordWrap(True)
        cl.addWidget(self.counter_lbl, 1)
        # V5.9: النوت الصغير + زر الملاحظة
        self.note_chip = QLabel("")
        self.note_chip.setVisible(False)
        cl.addWidget(self.note_chip)
        self.note_btn = QPushButton("📝 ملاحظة")
        self.note_btn.setToolTip("سبب التأخير / واقفة فين — بلا تغيير المرحلة")
        self.note_btn.clicked.connect(self._add_stage_note)
        cl.addWidget(self.note_btn)
        self.finish_btn = QPushButton("إنهاء المرحلة")
        self.finish_btn.setObjectName("btnReceipt")
        self.finish_btn.clicked.connect(lambda: self._advance(False))
        cl.addWidget(self.finish_btn)
        self.skip_btn = QPushButton("تخطي")
        self.skip_btn.setProperty("flat", True)
        self.skip_btn.clicked.connect(lambda: self._advance(True))
        cl.addWidget(self.skip_btn)
        lay.addWidget(card)

    def set_transaction(self, transaction_type: str, transaction_id: int):
        self.tx_type = transaction_type
        self.tx_id = int(transaction_id or 0)
        self.refresh()

    def refresh(self):
        t = style.theme()
        if not self.tx_type or not self.tx_id:
            self.setVisible(False)
            return
        st = wf.stage_status(self.tx_type, self.tx_id)
        cur = st["current"]
        if cur is None:
            self.stage_lbl.setText("اكتمل المسار ✓")
            self.counter_lbl.setText("")
            self.finish_btn.setEnabled(False)
            self.skip_btn.setEnabled(False)
            self._refresh_note_chip()      # V5.9: الشارة تظهر دائمًا
            return
        self.stage_lbl.setText(cur["stage_name"])
        if _is_cancelled_contract(self.tx_type, self.tx_id):
            self.counter_lbl.setText("العقد ملغى ومجمّد")
            self.finish_btn.setEnabled(False)
            self.skip_btn.setEnabled(False)
            self._refresh_note_chip()      # V5.9
            return
        days, expected = st["days_in"], st["expected"]
        if st["state"] == "over":
            self.counter_lbl.setText(
                f"🔴 {days} يومًا من أصل {expected} (تجاوز {days - expected})")
            self.counter_lbl.setStyleSheet(
                f"color: {t['DANGER_600']}; font-weight: 800;")
        elif st["state"] == "near":
            self.counter_lbl.setText(
                f"🟡 بقي {expected - days} يوم من {expected}")
            self.counter_lbl.setStyleSheet(
                f"color: {t['WARNING_600']}; font-weight: 800;")
        else:
            self.counter_lbl.setText(
                f"🟢 {days} يومًا" + (f" من {expected}" if expected else ""))
            self.counter_lbl.setStyleSheet(
                f"color: {t['SUCCESS_700']}; font-weight: 800;")
        self.finish_btn.setEnabled(True)
        self.skip_btn.setEnabled(True)
        self._refresh_note_chip()

    # ==================== V5.9: ملاحظات المرحلة ====================
    def _refresh_note_chip(self):
        try:
            n = wf.latest_stage_note(self.tx_type, self.tx_id)
        except Exception:
            n = None
        if not n:
            self.note_chip.setVisible(False)
            return
        txt = (n.get("note") or "").strip()
        short = txt if len(txt) <= 34 else txt[:32] + "…"
        self.note_chip.setText(f"📝 {short}")
        t = style.theme()
        self.note_chip.setToolTip(
            f"{txt}\n\n— {(n.get('author') or 'مستخدم')} · "
            f"{(n.get('created_at') or '')[:16]}")
        self.note_chip.setStyleSheet(
            f"color: {t['WARNING_600']}; font-weight: 700;")
        self.note_chip.setVisible(True)

    def _add_stage_note(self):
        dlg = StageNoteDialog(self, self.tx_type, self.tx_id,
                              stage_name=(self.stage_lbl.text()
                                          if self.stage_lbl.text() != "—" else ""))
        if dlg.exec():
            self._refresh_note_chip()
            self.changed.emit()

    def _revert_stage(self):
        if self.tx_type != wf.TX_CONTRACT:
            style.info(self, "التراجع عن المرحلة متاح لعقود العملاء فقط.")
            return
        if not style.require_admin(self, "التراجع عن مرحلة", perm="action_manage_workflow"):
            return
        from PySide6.QtWidgets import QInputDialog
        reason, ok = QInputDialog.getText(
            self, "سبب التراجع عن المرحلة",
            "اكتب سبب التراجع؛ سيظهر تلقائيًا في تعليقات العميل وسجل العقد:")
        if not ok:
            return
        if not style.confirm(
                self,
                "سيتم إرجاع العقد للمرحلة السابقة.\n"
                "أي استحقاق دفعة تلقائي لم يصدر له سند قبض سيعود لحالة غير مستحق.\n"
                "السندات المالية الموجودة لن تُحذف ولن تُلغى تلقائيًا.",
                "تأكيد التراجع"):
            return
        try:
            res = wf.revert_contract_stage(self.tx_id, reason)
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.note.clear()
        self.refresh()
        self.changed.emit()
        msg = f"تم التراجع من «{res['from']}» إلى «{res['to']}»"
        if res.get("kept_payments"):
            msg += " · توجد دفعات لها سندات لم تُعدل تلقائيًا"
        style.toast(self, msg)

    def _advance(self, skip: bool):
        action_date = None
        if not skip and self.tx_type == wf.TX_CONTRACT:
            try:
                cur = (wf.stage_status(self.tx_type, self.tx_id).get("current") or {})
                stage_name = cur.get("stage_name") or cur.get("name") or ""
                # V3.29: بوابة التعهد القديم + تلميح عند الانغلاق
                _stamped = bool(cur.get("is_supervision"))
                if _should_ask_supervision_start(self.tx_id, stage_name,
                                                 _stamped):
                    action_date = _ask_supervision_start(self, self.tx_id, stage_name)
                    if not action_date:
                        return
                elif _should_ask_supervision_end(self.tx_id, stage_name,
                                                 _stamped):
                    action_date = _ask_supervision_end(self, self.tx_id, stage_name)
                    if not action_date:
                        return
                else:
                    _hint = _supervision_hint(self.tx_id, stage_name,
                                              _stamped)
                    if _hint:
                        style.toast(self, _hint)
            except Exception as exc:
                style.error(self, str(exc))
                return
        try:
            wf.advance_stage(self.tx_type, self.tx_id, skip=skip,
                             action_date=action_date)
        except Exception as exc:
            style.error(self, str(exc))
            return
        self.refresh()
        self.changed.emit()
