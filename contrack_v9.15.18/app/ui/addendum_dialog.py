# -*- coding: utf-8 -*-
"""V6.2: شاشة الأمر التغييري — البنية الجديدة المعتمدة.

البنية:
  * الجزء العلوي (العقد/النوع/التاريخ/السبب/الوصف) ثابت.
  * تابان رئيسيان: 👤 عميل · 🔨 مقاول.
  * تاب العميل: تابان فرعيان ➕ إضافة (من بنود العميل التلقائية + بند يدوي
    جديد) · ➖ حذف (كل البنود المعتمدة حاليًا مع عمود «المصدر» تلقائي/يدوي).
  * تاب المقاول: اختيار المقاول صريح داخل التاب (مقاول قائم أو جديد)، وتابان
    فرعيان ➕ إضافة (بنود عقد العميل المحفوظة + «سعر المقاول» لكل بند) ·
    ➖ حذف (البنود المربوطة فعلًا بالمقاول المختار).
  * جدول «أجزاء هذا الأمر التغييري» والإجماليات بالأسفل ثابت ومشترك بين كل
    التابات، وفيه عمود «النوع»: عميل/إضافة · عميل/حذف · مقاول/إضافة · مقاول/حذف.

قواعد المنطق (المعتمدة):
  1. البند اليدوي (عميل ← إضافة أو مقاول ← إضافة) يُسجَّل بندًا معتمدًا
     عند حفظ الأمر فقط — قبل الحفظ لا يظهر في تاب المقاول.
  2. أي بند في تاب المقاول: من بنود العميل المعتمدة المحفوظة (غير المسندة
     لأي مقاول آخر) أو بند يدوي حر (V8.8).
  3. حذف بند من العميل يُنبّه قبل أن يفكّ ارتباط المقاولين تلقائيًا.
  4. حصرية: بند مسنَد لمقاول لا يجوز إسناده لمقاول آخر — يُمنع تكرار نفس
     البند لنفس الطرف (V8.8).
  5. إجمالي العقد وعقد الباطن يتحدثان لحظيًا بالأسفل.
  6. الحفظ أمر واحد (رأس + أجزاء + تنفيذ) في معاملة واحدة.
"""
from __future__ import annotations

from PySide6.QtCore import QDate, Qt, QTimer
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDoubleSpinBox, QFormLayout, QFrame, QGroupBox,
    QHBoxLayout, QHeaderView, QLabel, QLineEdit, QPushButton, QTabWidget,
    QTableWidget, QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget,
)

from services import addendum_service as adx
from services import lifecycle_service as lc
from services.customer_service import ValidationError
from ui import style
from ui.widgets import SafeDateEdit, make_searchable


def _fmt(x) -> str:
    try:
        return f"{float(x or 0):,.3f}"
    except Exception:
        return "0.000"


def _num(txt) -> float:
    try:
        return float(str(txt or "0").replace(",", "").strip() or 0)
    except Exception:
        return 0.0


def _store_ref(item, kind: str, rid: int):
    """يخزّن ref_kind/ref_id في UserRole لاستعادتها عند الإضافة."""
    item.setData(Qt.UserRole, f"{kind}|{rid}")


def _read_ref(item) -> tuple[str, int]:
    """يسترجع (ref_kind, ref_id) من UserRole."""
    val = item.data(Qt.UserRole) if item else ""
    if val and "|" in str(val):
        parts = str(val).split("|", 1)
        return parts[0], int(parts[1] or 0)
    return "", 0


class _ChkItem(QTableWidgetItem):
    """خانة ✔ قابلة للفرز/القراءة بلا لبس."""

    def __init__(self, checked: bool = False):
        super().__init__("")
        self.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled
                      | Qt.ItemIsSelectable)
        self.setCheckState(Qt.Checked if checked else Qt.Unchecked)


class ChangeOrderDialog(QDialog):
    """شاشة أمر تغييري/عقد إضافي — البنية الجديدة (V6.2)."""

    CLI_ADD_HEADS = ["✔", "وصف البند", "الكمية", "الوحدة", "سعر الوحدة",
                     "الإجمالي"]
    CLI_DEL_HEADS = ["✔", "وصف البند", "الكمية", "الوحدة", "سعر الوحدة",
                     "الإجمالي"]
    SUB_ADD_HEADS = ["✔", "وصف البند", "الكمية", "الوحدة", "سعر العميل",
                     "الإجمالي"]
    SUB_DEL_HEADS = ["✔", "وصف البند", "الكمية", "الإجمالي"]
    PARTS_HEADS = ["النوع", "وصف البند", "الكمية", "الإجمالي", ""]

    def __init__(self, parent, contract_id: int,
                 sub_contract_id: int | None = None,
                 default_side: str = "client", on_saved=None):
        super().__init__(parent)
        self.contract_id = int(contract_id)
        self.sub_contract_id = int(sub_contract_id) if sub_contract_id else None
        self.addendum_id: int | None = None
        self.on_saved = on_saved
        self.setLayoutDirection(Qt.RightToLeft)
        self.setWindowTitle("📎 أمر تغييري / عقد إضافي")
        self.setMinimumSize(1020, 780)

        root = QVBoxLayout(self)
        root.setSpacing(6)

        # ===== الجزء العلوي الثابت =====
        head = QVBoxLayout()
        head.setSpacing(4)
        with_c = self._contract_number()
        self.head_lbl = QLabel(
            f"العقد {with_c} — القيمة الحالية: "
            f"{_fmt(self._current_value())} د.ك")
        self.head_lbl.setStyleSheet("font-weight:800; font-size:14px;")
        head.addWidget(self.head_lbl)
        # سطر 1: النوع + التاريخ + السبب
        r1 = QHBoxLayout()
        r1.setSpacing(6)
        self.a_type = QComboBox()
        make_searchable(self.a_type, "")
        self.a_type.addItems(lc.ADDENDUM_TYPES)
        self.a_type.setCurrentText("أمر تغييري")
        self.a_date = SafeDateEdit()
        self.a_date.setCalendarPopup(True)
        self.a_date.setDisplayFormat("yyyy-MM-dd")
        self.a_date.setDate(QDate.currentDate())
        self.a_reason = QLineEdit()
        self.a_reason.setPlaceholderText("سبب الأمر التغييري *")
        r1.addWidget(QLabel("النوع")); r1.addWidget(self.a_type)
        r1.addWidget(QLabel("التاريخ")); r1.addWidget(self.a_date)
        r1.addWidget(self.a_reason, 1)
        head.addLayout(r1)
        # سطر 2: الوصف + المقاول (جنب بعض)
        r2 = QHBoxLayout()
        r2.setSpacing(6)
        self.a_desc = QLineEdit()
        self.a_desc.setPlaceholderText("الوصف / الملاحظات")
        r2.addWidget(QLabel("الوصف")); r2.addWidget(self.a_desc, 1)
        self.a_sub_label = QLabel("المقاول")
        self.a_sub_label.setVisible(False)
        self.a_sub_combo_preview = QLabel("")
        self.a_sub_combo_preview.setStyleSheet("color:#64748B;")
        r2.addWidget(self.a_sub_label)
        r2.addWidget(self.a_sub_combo_preview)
        head.addLayout(r2)
        root.addLayout(head)
        self.a_type.currentIndexChanged.connect(self._type_changed)

        # ===== V8.11: التابات — إضافة/حذف مباشرة حسب الجهة =====
        # لا تاب عميل/مقاول — الجهة محددة من الشاشة الرئيسية
        self._active_side = (default_side or "client").strip().lower()
        if self._active_side == "sub":
            self._build_sub_tab()
            self.active_page = self.p_sub
            self.active_tabs = self.sub_tabs
        else:
            self._active_side = "client"
            self._build_client_tab()
            self.active_page = self.p_client
            self.active_tabs = self.cli_tabs
        root.addWidget(self.active_page, 1)

        # ===== جدول بنود عقد مقاول الباطن (يظهر فقط إذا كان هناك بنود مقاول) =====
        g_sub_parts = QGroupBox("📋 بنود عقد مقاول الباطن")
        gsp = QVBoxLayout(g_sub_parts)
        gsp.setSpacing(4)
        self.sub_parts_table = QTableWidget(0, 4)
        self.sub_parts_table.setHorizontalHeaderLabels(["النوع", "وصف البند", "الكمية", "الإجمالي"])
        self.sub_parts_table.verticalHeader().setVisible(False)
        # V9.1: يسمح بالتعديل المزدوج (سعر المقاول فقط)
        self.sub_parts_table.setEditTriggers(QTableWidget.DoubleClicked | QTableWidget.SelectedClicked)
        self.sub_parts_table.setMaximumHeight(180)
        self.sub_parts_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        gsp.addWidget(self.sub_parts_table)
        self.sub_parts_group = g_sub_parts
        self.sub_parts_group.setVisible(False)
        root.addWidget(g_sub_parts)

        self.foot = QLabel("")
        self.foot.setWordWrap(True)
        self.foot.setStyleSheet("font-weight:800; color:#334155;")
        root.addWidget(self.foot)

        self.status_lbl = QLabel("")
        self.status_lbl.setWordWrap(True)
        self.status_lbl.setStyleSheet("color:#475569; font-size:12px;")
        root.addWidget(self.status_lbl)

        btns = QHBoxLayout()
        self.save_btn = QPushButton("💾 حفظ واعتماد الأمر")
        self.save_btn.setObjectName("btnPrimary")
        self.save_btn.clicked.connect(self._save)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.setProperty("flat", True)
        close_btn.clicked.connect(self.reject)
        btns.addStretch(); btns.addWidget(self.save_btn)
        btns.addWidget(close_btn)
        root.addLayout(btns)

        # ===== تعبئة أولية =====
        # V9.1: تحميل المقاولين فقط إذا كنا على طرف المقاول
        if self._active_side == "sub":
            self._reload_sub_choices()
            if getattr(self, "_sub_choices", None):
                self._sub_changed()
            self.reload_sub_items()
            self.reload_sub_delete()
        else:
            self.reload_available()
            self.reload_delete_table()
        self.reload_parts()
        self._type_changed()

    # ============================================================
    # بناء التابات
    # ============================================================
    def _build_client_tab(self):
        self.p_client = QFrame(self)
        lay = QVBoxLayout(self.p_client)
        lay.setSpacing(6)
        lay.setContentsMargins(0, 0, 0, 0)
        self.cli_tabs = QTabWidget()
        lay.addWidget(self.cli_tabs)

        # ---------- عميل ← إضافة ----------
        add_page = QWidget()
        av = QVBoxLayout(add_page)
        av.setSpacing(4)
        av.setContentsMargins(4, 4, 4, 4)

        # أزرار أعلى الجدول
        av_top = QHBoxLayout()
        av_top.setSpacing(6)
        b_ref = QPushButton("🔄 تحديث")
        b_ref.setProperty("flat", True)
        b_ref.clicked.connect(self.reload_available)
        b_pick = QPushButton("＋ أضف المحدد")
        b_pick.clicked.connect(self._add_selected_available)
        av_top.addStretch()
        av_top.addWidget(b_ref)
        av_top.addWidget(b_pick)
        av.addLayout(av_top)

        # الجدول — يأخذ المساحة المتبقية
        self.avail_table = QTableWidget(0, len(self.CLI_ADD_HEADS))
        self.avail_table.setHorizontalHeaderLabels(self.CLI_ADD_HEADS)
        self.avail_table.verticalHeader().setVisible(False)
        self.avail_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.avail_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.Stretch)
        av.addWidget(self.avail_table, 1)

        # بند يدوي — سطر واحد
        g_manual = QFrame()
        g_manual.setStyleSheet("QFrame { border-top: 1px solid #E2E8F0; padding-top: 4px; }")
        mf = QHBoxLayout(g_manual)
        mf.setSpacing(4)
        mf.setContentsMargins(0, 2, 0, 0)
        self.m_desc = QLineEdit()
        self.m_desc.setPlaceholderText("وصف البند اليدوي")
        self.m_desc.setMinimumWidth(160)
        self.m_qty = QDoubleSpinBox()
        self.m_qty.setRange(0, 1e6)
        self.m_qty.setDecimals(3)
        self.m_qty.setValue(1)
        self.m_unit = QLineEdit()
        self.m_unit.setPlaceholderText("وحدة")
        self.m_unit.setMaximumWidth(60)
        self.m_price = QDoubleSpinBox()
        self.m_price.setRange(0, 1e9)
        self.m_price.setDecimals(3)
        self.m_price.setGroupSeparatorShown(True)
        self.m_total = QLabel("0.000")
        self.m_total.setStyleSheet("font-weight:800;")
        self.m_qty.valueChanged.connect(self._upd_manual_total)
        self.m_price.valueChanged.connect(self._upd_manual_total)
        mf.addWidget(self.m_desc, 1)
        mf.addWidget(self.m_qty)
        mf.addWidget(self.m_unit)
        mf.addWidget(self.m_price)
        mf.addWidget(self.m_total)
        b_addm = QPushButton("＋")
        b_addm.setToolTip("إضافة بند يدوي")
        b_addm.setFixedWidth(36)
        b_addm.clicked.connect(self._add_manual)
        mf.addWidget(b_addm)
        av.addWidget(g_manual)
        self.cli_tabs.addTab(add_page, "➕ إضافة")

        # ---------- عميل ← حذف ----------
        del_page = QWidget()
        dv = QVBoxLayout(del_page)
        dv.setSpacing(4)
        dv.setContentsMargins(4, 4, 4, 4)

        # زر الحذف أعلى الجدول
        dv_top = QHBoxLayout()
        dv_top.setSpacing(6)
        b_del = QPushButton("🗑 احذف المحدد")
        b_del.setProperty("danger", True)
        b_del.clicked.connect(self._mark_delete)
        dv_top.addStretch()
        dv_top.addWidget(b_del)
        dv.addLayout(dv_top)

        # الجدول — يأخذ المساحة المتبقية
        self.del_table = QTableWidget(0, len(self.CLI_DEL_HEADS))
        self.del_table.setHorizontalHeaderLabels(self.CLI_DEL_HEADS)
        self.del_table.verticalHeader().setVisible(False)
        self.del_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.del_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.Stretch)
        dv.addWidget(self.del_table, 1)
        self.cli_tabs.addTab(del_page, "➖ حذف")

    def _build_sub_tab(self):
        self.p_sub = QFrame(self)
        lay = QVBoxLayout(self.p_sub)
        lay.setSpacing(6)
        lay.setContentsMargins(0, 0, 0, 0)

        # اختيار المقاول — فقط المرتبطين + زر "جديد"
        pick = QHBoxLayout()
        pick.setSpacing(6)
        pick.addWidget(QLabel("المقاول"))
        self.sub_combo = QComboBox()
        make_searchable(self.sub_combo, "اكتب اسم المقاول…")
        self.sub_combo.setMinimumWidth(250)
        pick.addWidget(self.sub_combo, 1)
        self.sub_pick_hint = QLabel("")
        self.sub_pick_hint.setStyleSheet("color:#64748B; font-size:11px;")
        pick.addWidget(self.sub_pick_hint)
        # زر إنشاء مقاول جديد
        b_new_sub = QPushButton("＋ مقاول جديد")
        b_new_sub.setToolTip("إنشاء عقد باطن جديد لمقاول غير مرتبط")
        b_new_sub.clicked.connect(self._open_new_sub_dialog)
        pick.addWidget(b_new_sub)
        lay.addLayout(pick)

        self.sub_tabs = QTabWidget()
        lay.addWidget(self.sub_tabs)

        # ---------- مقاول ← إضافة ----------
        add_page = QWidget()
        av = QVBoxLayout(add_page)
        av.setSpacing(4)
        av.setContentsMargins(4, 4, 4, 4)

        # أزرار أعلى الجدول
        av_top = QHBoxLayout()
        av_top.setSpacing(6)
        b_ref = QPushButton("🔄 تحديث")
        b_ref.setProperty("flat", True)
        b_ref.clicked.connect(self.reload_sub_items)
        b_pick = QPushButton("＋ أضف المحدد")
        b_pick.clicked.connect(self._add_selected_sub)
        av_top.addStretch()
        av_top.addWidget(b_ref)
        av_top.addWidget(b_pick)
        av.addLayout(av_top)

        # الجدول — يأخذ المساحة المتبقية
        self.sub_add_table = QTableWidget(0, len(self.SUB_ADD_HEADS))
        self.sub_add_table.setHorizontalHeaderLabels(self.SUB_ADD_HEADS)
        self.sub_add_table.verticalHeader().setVisible(False)
        self.sub_add_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.Stretch)
        self.sub_add_table.itemChanged.connect(self._sub_price_changed)
        av.addWidget(self.sub_add_table, 1)

        # بند يدوي للمقاول
        g_sub_manual = QFrame()
        g_sub_manual.setStyleSheet("QFrame { border-top: 1px solid #E2E8F0; padding-top: 4px; }")
        smf = QHBoxLayout(g_sub_manual)
        smf.setSpacing(4)
        smf.setContentsMargins(0, 2, 0, 0)
        self.sm_desc = QLineEdit()
        self.sm_desc.setPlaceholderText("وصف البند اليدوي")
        self.sm_desc.setMinimumWidth(160)
        self.sm_qty = QDoubleSpinBox()
        self.sm_qty.setRange(0, 1e6)
        self.sm_qty.setDecimals(3)
        self.sm_qty.setValue(1)
        self.sm_unit = QLineEdit()
        self.sm_unit.setPlaceholderText("وحدة")
        self.sm_unit.setMaximumWidth(60)
        self.sm_price = QDoubleSpinBox()
        self.sm_price.setRange(0, 1e9)
        self.sm_price.setDecimals(3)
        self.sm_price.setGroupSeparatorShown(True)
        self.sm_total = QLabel("0.000")
        self.sm_total.setStyleSheet("font-weight:800;")
        self.sm_qty.valueChanged.connect(self._upd_sub_manual_total)
        self.sm_price.valueChanged.connect(self._upd_sub_manual_total)
        smf.addWidget(self.sm_desc, 1)
        smf.addWidget(self.sm_qty)
        smf.addWidget(self.sm_unit)
        smf.addWidget(self.sm_price)
        smf.addWidget(self.sm_total)
        b_addsm = QPushButton("＋")
        b_addsm.setToolTip("إضافة بند يدوي للمقاول")
        b_addsm.setFixedWidth(36)
        b_addsm.clicked.connect(self._add_sub_manual)
        smf.addWidget(b_addsm)
        av.addWidget(g_sub_manual)
        self.sub_tabs.addTab(add_page, "➕ إضافة")

        # ---------- مقاول ← حذف ----------
        del_page = QWidget()
        dv = QVBoxLayout(del_page)
        dv.setSpacing(4)
        dv.setContentsMargins(4, 4, 4, 4)

        # زر الحذف أعلى الجدول
        dv_top = QHBoxLayout()
        dv_top.setSpacing(6)
        b_del = QPushButton("🗑 احذف المحدد")
        b_del.setProperty("danger", True)
        b_del.clicked.connect(self._mark_delete_sub)
        dv_top.addStretch()
        dv_top.addWidget(b_del)
        dv.addLayout(dv_top)

        # الجدول — يأخذ المساحة المتبقية
        self.sub_del_table = QTableWidget(0, len(self.SUB_DEL_HEADS))
        self.sub_del_table.setHorizontalHeaderLabels(self.SUB_DEL_HEADS)
        self.sub_del_table.verticalHeader().setVisible(False)
        self.sub_del_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.sub_del_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.Stretch)
        dv.addWidget(self.sub_del_table, 1)
        self.sub_tabs.addTab(del_page, "➖ حذف")

    # ============================================================
    # أدوات مساعدة
    # ============================================================
    def _upd_manual_total(self):
        self.m_total.setText(_fmt(self.m_qty.value() * self.m_price.value()))

    def _upd_sub_manual_total(self):
        self.sm_total.setText(_fmt(self.sm_qty.value() * self.sm_price.value()))

    def _note(self, msg: str, bad: bool = False):
        self.status_lbl.setText(msg)
        self.status_lbl.setStyleSheet(
            "color:%s; font-size:12px;" % ("#DC2626" if bad else "#475569"))

    def set_status(self, msg: str, bad: bool = False):
        self._note(msg, bad)

    def _contract_number(self) -> str:
        from database.database import get_connection
        with get_connection() as conn:
            r = conn.execute("SELECT contract_number FROM contracts WHERE id=?",
                             (self.contract_id,)).fetchone()
        return (r["contract_number"] if r else "—")

    def _current_value(self) -> float:
        try:
            return float(lc.contract_current_value(self.contract_id)["current"])
        except Exception:
            return 0.0

    def _chosen_sub(self) -> dict | None:
        combo = getattr(self, "sub_combo", None)
        if combo is None:
            return None
        data = combo.currentData()
        if data is None:
            return None
        return next((c for c in getattr(self, "_sub_choices", [])
                     if int(c["subcontractor_id"]) == int(data)), None)

    def _reload_sub_choices(self):
        self._sub_choices = []
        self.sub_combo.blockSignals(True)
        self.sub_combo.clear()
        try:
            choices = adx.subcontractor_choices(self.contract_id)
        except Exception:
            choices = []
        # V9.1: فقط المقاولين المرتبطين (ليس "جديد")
        self._sub_choices = [c for c in choices if not c.get("is_new")]
        for c in self._sub_choices:
            if c.get("sub_contract_id"):
                txt = f"{c['name']} — عقد باطن {_fmt(c.get('amount'))} د.ك"
            else:
                txt = c['name']
            self.sub_combo.addItem(txt, int(c["subcontractor_id"]))
        if self.sub_contract_id:
            for i, c in enumerate(choices):
                if int(c.get("sub_contract_id") or 0) == int(self.sub_contract_id):
                    self.sub_combo.setCurrentIndex(i)
                    break
        elif len(choices) > 1:
            # اختر أول مقاول متعاقد (ليس "جديد")
            for i, c in enumerate(choices):
                if not c.get("is_new"):
                    self.sub_combo.setCurrentIndex(i)
                    break
        self.sub_combo.blockSignals(False)
        self.sub_combo.currentIndexChanged.connect(self._sub_changed)
        # تحميل أولي (مؤجّل لضمان تهيئة الواجهة)
        QTimer.singleShot(0, self._sub_changed)

    def _open_new_sub_dialog(self):
        """فتح شاشة إنشاء عقد باطن جديد — ثم اختياره تلقائيًا."""
        from PySide6.QtWidgets import (
            QDialog as _Dlg, QFormLayout as _FL, QComboBox as _CB,
            QDoubleSpinBox as _DSB, QLineEdit as _LE,
            QDialogButtonBox as _BB, QLabel as _Lbl,
        )
        _dlg = _Dlg(self)
        _dlg.setWindowTitle("إنشاء عقد باطن جديد")
        _dlg.setMinimumWidth(400)
        _dlg.setLayoutDirection(Qt.RightToLeft)
        fl = _FL(_dlg)
        fl.setSpacing(8)

        # اختيار المقاول (من كل المقاولين الموجودين)
        sub_cb = _CB()
        make_searchable(sub_cb, "اكتب اسم المقاول…")
        try:
            all_subs = adx.all_subcontractors()  # كل المقاولين
        except Exception:
            all_subs = []
        for s in all_subs:
            sub_cb.addItem(s["name"], int(s["id"]))
        fl.addRow("المقاول:", sub_cb)

        # المبلغ
        amt_sp = _DSB()
        amt_sp.setRange(0, 1e12)
        amt_sp.setDecimals(3)
        amt_sp.setGroupSeparatorShown(True)
        fl.addRow("مبلغ العقد:", amt_sp)

        # الوصف
        desc_le = _LE()
        desc_le.setPlaceholderText("وصف عقد الباطن (اختياري)")
        fl.addRow("الوصف:", desc_le)

        # ملاحظة
        fl.addRow("", _Lbl("سيتم ربط هذا العقد بعقد العميل الحالي تلقائيًا."))

        bb = _BB(_BB.Ok | _BB.Cancel)
        bb.button(_BB.Ok).setText("إنشاء")
        bb.button(_BB.Cancel).setText("إلغاء")
        bb.accepted.connect(_dlg.accept)
        bb.rejected.connect(_dlg.reject)
        fl.addRow(bb)

        if _dlg.exec() != _Dlg.Accepted:
            return
        # إنشاء عقد الباطن
        try:
            new_sc_id = adx.create_sub_contract(
                self.contract_id,
                int(sub_cb.currentData()),
                amt_sp.value(),
                desc_le.text().strip(),
            )
            # إعادة تحميل القائمة واختيار الجديد
            self._reload_sub_choices()
            # اختيار المقاول الجديد
            for i, c in enumerate(self._sub_choices):
                if int(c.get("sub_contract_id") or 0) == int(new_sc_id):
                    self.sub_combo.setCurrentIndex(i)
                    break
            self._note("تم إنشاء عقد الباطن الجديد.")
        except Exception as exc:
            self._note(f"فشل إنشاء عقد الباطن: {exc}", True)

    def _sub_changed(self):
        c = self._chosen_sub()
        self.sub_contract_id = int(c["sub_contract_id"]) if (
            c and c.get("sub_contract_id")) else None
        # تحديث اسم المقاول في الهيدر
        if c:
            self.a_sub_label.setVisible(True)
            self.a_sub_combo_preview.setText(c.get("name") or "")
        else:
            self.a_sub_label.setVisible(False)
            self.a_sub_combo_preview.setText("")
        self.sub_pick_hint.setText(
            "" if (c and c.get("sub_contract_id"))
            else ("عقد باطن جديد"))
        self.reload_sub_items()
        self.reload_sub_delete()
        self.refresh_tabs_count()

    # ============================================================
    # تاب العميل — إضافة
    # ============================================================
    def reload_available(self):
        self.avail_table.setRowCount(0)
        try:
            av = adx.available_items(self.contract_id, "client")
        except Exception:
            av = {}
        # V8.10: الإضافة = بنود العروض (ما نزلت في العقد) + المحذوفة
        rows = list(av.get("quotation_items") or []) + \
            list(av.get("deleted_items") or [])
        for b in rows:
            i = self.avail_table.rowCount()
            self.avail_table.insertRow(i)
            chk = _ChkItem(False)
            _store_ref(chk, b.get("ref_kind") or "", int(b.get("ref_id") or 0))
            self.avail_table.setItem(i, 0, chk)
            cells = [b.get("description") or "", _fmt(b.get("qty")),
                     b.get("unit") or "", _fmt(b.get("unit_price")),
                     _fmt(b.get("amount") or b.get("total"))]
            for c, txt in enumerate(cells, start=1):
                it = QTableWidgetItem(txt)
                if c in (2, 5):
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.avail_table.setItem(i, c, it)

    def _add_selected_available(self):
        picked = [i for i in range(self.avail_table.rowCount())
                  if self.avail_table.item(i, 0)
                  and self.avail_table.item(i, 0).checkState() == Qt.Checked]
        if not picked:
            self._note("علّم ✔ على البند/البنود المطلوب إضافتها أولًا.", True)
            return
        added = 0
        for i in picked:
            desc = self.avail_table.item(i, 1).text()
            qty = _num(self.avail_table.item(i, 2).text())
            unit = self.avail_table.item(i, 3).text()
            price = _num(self.avail_table.item(i, 4).text())
            _rk, _rid = _read_ref(self.avail_table.item(i, 0))
            boq_id = _rid if _rk == "boq" and _rid else None
            try:
                self.ensure_addendum()
                adx.add_part(self.addendum_id, "client", desc, qty, unit,
                             price, boq_item_id=boq_id,
                             ref_kind=_rk, ref_id=_rid)
                added += 1
            except ValidationError as exc:
                self._note(str(exc), True)
        if added:
            self._note(f"أُضيف {added} بندًا.")
            self._after_change()

    def _add_manual(self):
        try:
            self.ensure_addendum()
            adx.add_part(self.addendum_id, "client", self.m_desc.text(),
                         self.m_qty.value(), self.m_unit.text(),
                         self.m_price.value())
        except ValidationError as exc:
            self._note(str(exc), True)
            return
        self.m_desc.clear()
        self.m_qty.setValue(1)
        self.m_price.setValue(0)
        self._note("تمت إضافة البند إلى الأمر التغييري (بند عميل — يُعتمد "
                   "عند الحفظ).")
        self._after_change()

    def _add_sub_manual(self):
        """V8.8: بند يدوي لجهة المقاول."""
        c = self._chosen_sub()
        if not c:
            self._note("اختر المقاول أولًا.", True)
            return
        try:
            self.ensure_addendum()
            adx.add_part(self.addendum_id, "sub", self.sm_desc.text(),
                         self.sm_qty.value(), self.sm_unit.text(),
                         self.sm_price.value(),
                         subcontractor_id=int(c["subcontractor_id"]),
                         sub_contract_id=c.get("sub_contract_id"))
        except ValidationError as exc:
            self._note(str(exc), True)
            return
        self.sm_desc.clear()
        self.sm_qty.setValue(1)
        self.sm_price.setValue(0)
        self._note(f"تمت إضافة البند اليدوي للمقاول {c['name']} — يُعتمد "
                   "عند الحفظ.")
        self._after_change()

    # ============================================================
    # تاب العميل — حذف
    # ============================================================
    def reload_delete_table(self):
        self.del_table.setRowCount(0)
        try:
            basis = adx.contract_basis_info(self.contract_id)
        except Exception:
            basis = []
        for b in basis:
            if b.get("deleted"):
                continue
            i = self.del_table.rowCount()
            self.del_table.insertRow(i)
            chk = _ChkItem(False)
            _store_ref(chk, b.get("kind") or "", int(b.get("ref_id") or 0))
            self.del_table.setItem(i, 0, chk)
            cells = [b.get("description") or "", _fmt(b.get("qty")),
                     b.get("unit") or "", _fmt(b.get("unit_price")),
                     _fmt(b.get("amount"))]
            for c, txt in enumerate(cells, start=1):
                it = QTableWidgetItem(txt)
                if c in (2, 4, 5):
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.del_table.setItem(i, c, it)

    def _linked_contractors(self, boq_ids: list[int]) -> list[str]:
        """V8.9: يبحث عن مقاولين مرتبطين ببنود BOQ + plan/stage."""
        if not boq_ids:
            return []
        try:
            from database.database import get_connection
            marks = ",".join("?" for _ in boq_ids)
            with get_connection() as conn:
                rows = conn.execute(
                    "SELECT DISTINCT s.name AS name FROM sub_contract_items si "
                    "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                    "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                    f"WHERE si.boq_item_id IN ({marks})",
                    tuple(int(x) for x in boq_ids)).fetchall()
            return [r["name"] for r in rows if r["name"]]
        except Exception:
            return []

    def _mark_delete(self):
        picked = [i for i in range(self.del_table.rowCount())
                  if self.del_table.item(i, 0)
                  and self.del_table.item(i, 0).checkState() == Qt.Checked]
        if not picked:
            self._note("علّم ✔ على البند/البنود المتفق على حذفها أولًا.", True)
            return
        # V8.9: بنود BOQ — نحتاج IDs للتحذير من المقاولين
        boq_ids = []
        for i in picked:
            _rk, _rid = _read_ref(self.del_table.item(i, 0))
            if _rk == "boq" and _rid:
                boq_ids.append(_rid)
        if boq_ids:
            linked = self._linked_contractors(boq_ids)
            if linked:
                if not style.confirm(
                        self,
                        "البند/البنود المحددة مربوطة حاليًا بعقود باطن للمقاولين:\n"
                        "• " + "\n• ".join(linked) + "\n\n"
                        "تنبيه قبل التنفيذ: عند اعتماد الأمر سيُفكّ ارتباط "
                        "المقاولين تلقائيًا (ويبقى قابلًا للإرجاع إن أُلغي الأمر)."
                        "\n\nهل تريد المتابعة؟",
                        "حذف بند مرتبط بمقاولين"):
                    return
        done = 0
        for i in picked:
            _rk, _rid = _read_ref(self.del_table.item(i, 0))
            try:
                self.ensure_addendum()
                adx.add_delete_part(self.addendum_id, "client",
                                    boq_item_id=_rid if _rk == "boq" else None,
                                    ref_kind=_rk, ref_id=_rid)
                done += 1
            except ValidationError as exc:
                self._note(str(exc), True)
        if done:
            self._note(f"عُلّم {done} بندًا «محذوف بأمر تغييري».")
            self._after_change()

    # ============================================================
    # تاب المقاول
    # ============================================================
    def reload_sub_items(self):
        self.sub_add_table.blockSignals(True)
        self.sub_add_table.setRowCount(0)
        c = self._chosen_sub()
        if not c:
            self.sub_add_table.blockSignals(False)
            return
        items = adx.sub_contractor_items(
            self.contract_id, int(c["subcontractor_id"]),
            sub_contract_id=c.get("sub_contract_id"),
            order_addendum_id=self.addendum_id)
        for b in items:
            i = self.sub_add_table.rowCount()
            self.sub_add_table.insertRow(i)
            chk = _ChkItem(False)
            _store_ref(chk, b.get("kind") or "", int(b.get("ref_id") or 0))
            self.sub_add_table.setItem(i, 0, chk)
            # وصف + كمية + وحدة + سعر العميل + الإجمالي (بدون سعر المقاول)
            vals = [b.get("description") or "", _fmt(b.get("qty")),
                    b.get("unit") or "", _fmt(b.get("unit_price")),
                    _fmt(b.get("amount"))]
            for cc, txt in enumerate(vals, start=1):
                it = QTableWidgetItem(txt)
                it.setFlags(it.flags() & ~Qt.ItemIsEditable)
                if cc in (2, 4, 5):
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.sub_add_table.setItem(i, cc, it)
            if b.get("is_deleted"):
                for cc in range(1, 6):
                    self.sub_add_table.item(i, cc).setForeground(Qt.red)
                    font = self.sub_add_table.item(i, cc).font()
                    font.setStrikeOut(True)
                    self.sub_add_table.item(i, cc).setFont(font)
                self.sub_add_table.item(i, 0).setToolTip(
                    "بند محذوف بأمر تغييري — يمكن إعادته")
            elif b.get("on_contract"):
                for cc in range(1, 6):
                    self.sub_add_table.item(i, cc).setForeground(Qt.gray)
                self.sub_add_table.item(i, 0).setToolTip(
                    "هذا البند على عقد الباطن بالفعل — تكراره لنفس المقاول ممنوع.")
        self.sub_add_table.blockSignals(False)

    def _sub_price_changed(self, item):
        """تحديث الإجمالي عند تغيير سعر المقاول في جدول البنود المضافة."""
        pass  # V9.1: سعر المقاول يُحرر في جدول بنود عقد مقاول الباطن (الأسفل)

    def _add_selected_sub(self):
        c = self._chosen_sub()
        if not c:
            self._note("اختر المقاول أولًا.", True)
            return
        picked = [i for i in range(self.sub_add_table.rowCount())
                  if self.sub_add_table.item(i, 0)
                  and self.sub_add_table.item(i, 0).checkState() == Qt.Checked]
        if not picked:
            self._note("علّم ✔ على البنود المطلوب إسنادها للمقاول.", True)
            return
        # V9.1: سعر المقاول = 0 — يُحرر لاحقًا في جدول بنود عقد مقاول الباطن
        added = 0
        for i in picked:
            _rk, _rid = _read_ref(self.sub_add_table.item(i, 0))
            qty = _num(self.sub_add_table.item(i, 2).text())
            unit = self.sub_add_table.item(i, 3).text()
            price = 0.0
            desc = self.sub_add_table.item(i, 1).text()
            try:
                self.ensure_addendum()
                adx.add_part(self.addendum_id, "sub", desc, qty, unit, price,
                             boq_item_id=_rid if _rk == "boq" else None,
                             sub_contract_id=c.get("sub_contract_id"),
                             subcontractor_id=int(c["subcontractor_id"]),
                             ref_kind=_rk, ref_id=_rid)
                added += 1
            except ValidationError as exc:
                self._note(str(exc), True)
        if added:
            self._note(f"أُسند {added} بندًا للمقاول {c['name']} بسعره المستقل.")
            self._after_change()

    def _sub_contract_delete_rows(self) -> list[dict]:
        c = self._chosen_sub()
        if not c or not c.get("sub_contract_id"):
            return []
        try:
            # V8.9: استخدام sub_basis_info الموحّدة
            return adx.sub_basis_info(self.contract_id,
                                      int(c["sub_contract_id"]))
        except Exception:
            return []

    def reload_sub_delete(self):
        self.sub_del_table.setRowCount(0)
        c = self._chosen_sub()
        rows = self._sub_contract_delete_rows()
        for b in rows:
            i = self.sub_del_table.rowCount()
            self.sub_del_table.insertRow(i)
            chk = _ChkItem(False)
            _store_ref(chk, b.get("kind") or "", int(b.get("ref_id") or 0))
            self.sub_del_table.setItem(i, 0, chk)
            for cc, txt in enumerate(
                    [b.get("description") or "", _fmt(b.get("qty")),
                     _fmt(b.get("amount"))], start=1):
                it = QTableWidgetItem(txt)
                if cc in (2, 3):
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.sub_del_table.setItem(i, cc, it)

    def _mark_delete_sub(self):
        c = self._chosen_sub()
        if not c or not c.get("sub_contract_id"):
            self._note("لا عقد باطن قائم لهذا المقاول — لا حذف.", True)
            return
        picked = [i for i in range(self.sub_del_table.rowCount())
                  if self.sub_del_table.item(i, 0)
                  and self.sub_del_table.item(i, 0).checkState() == Qt.Checked]
        if not picked:
            self._note("علّم ✔ على بنود عقد الباطن المتفق على حذفها.", True)
            return
        rows = self._sub_contract_delete_rows()
        done = 0
        for i in picked:
            if i >= len(rows):
                continue
            b = rows[i]
            _rk = b.get("kind") or ""
            _rid = int(b.get("ref_id") or 0)
            try:
                self.ensure_addendum()
                adx.add_delete_part(
                    self.addendum_id, "sub",
                    boq_item_id=_rid if _rk == "boq" else None,
                    sub_contract_id=int(c["sub_contract_id"]),
                    ref_kind=_rk, ref_id=_rid)
                done += 1
            except ValidationError as exc:
                self._note(str(exc), True)
        if done:
            self._note(f"عُلّم {done} بندًا للحذف من عقد الباطن.")
            self._after_change()

    # ============================================================
    # الجدولين المنفصلين + الإجماليات
    # ============================================================
    def reload_parts(self):
        self.sub_parts_table.setRowCount(0)
        self.sub_parts_group.setVisible(False)
        if not self.addendum_id:
            return
        has_sub = False
        for p in adx.list_parts(self.addendum_id):
            side = (p.get("side") or "").strip().lower()
            if side != "sub":
                continue
            has_sub = True
            action = (p.get("action") or "").strip().lower()
            type_txt = p.get("type_ar") or p.get("side_ar") or ""
            if not type_txt:
                type_txt = "حذف" if action == "delete" else "إضافة"

            tbl = self.sub_parts_table
            if tbl.columnCount() < 6:
                tbl.setColumnCount(6)
                tbl.setHorizontalHeaderLabels(
                    ["النوع", "وصف البند", "الكمية", "سعر المقاول", "الإجمالي", ""])
                tbl.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
                tbl.horizontalHeader().setSectionResizeMode(3, QHeaderView.Fixed)
                tbl.setColumnWidth(3, 100)
                tbl.horizontalHeader().setSectionResizeMode(4, QHeaderView.Fixed)
                tbl.setColumnWidth(4, 90)
                tbl.horizontalHeader().setSectionResizeMode(5, QHeaderView.Fixed)
                tbl.setColumnWidth(5, 30)
                tbl.itemChanged.connect(self._sub_part_price_changed)
            i = tbl.rowCount()
            tbl.blockSignals(True)
            tbl.insertRow(i)
            # النوع — غير قابل للتعديل
            type_it = QTableWidgetItem(type_txt)
            type_it.setFlags(type_it.flags() & ~Qt.ItemIsEditable)
            tbl.setItem(i, 0, type_it)
            # الوصف — غير قابل للتعديل
            desc_it = QTableWidgetItem(p.get("description") or "")
            desc_it.setFlags(desc_it.flags() & ~Qt.ItemIsEditable)
            tbl.setItem(i, 1, desc_it)
            # الكمية — غير قابلة للتعديل
            qty_it = QTableWidgetItem(_fmt(p.get("qty")))
            qty_it.setFlags(qty_it.flags() & ~Qt.ItemIsEditable)
            tbl.setItem(i, 2, qty_it)
            # سعر المقاول — قابل للتعديل ✅
            price_val = float(p.get("unit_price") or 0)
            price_it = QTableWidgetItem(_fmt(price_val))
            price_it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            price_it.setData(Qt.UserRole, float(p.get("qty") or 0))
            price_it.setData(Qt.UserRole + 1, int(p["id"]))
            # لا نحذف ItemIsEditable — يبقى قابل للتعديل
            tbl.setItem(i, 3, price_it)
            # الإجمالي — غير قابل للتعديل (يتغير تلقائي)
            amt = float(p.get("qty") or 0) * price_val
            amt_it = QTableWidgetItem(_fmt(amt))
            amt_it.setFlags(amt_it.flags() & ~Qt.ItemIsEditable)
            amt_it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            tbl.setItem(i, 4, amt_it)
            tbl.blockSignals(False)
            if not p.get("applied"):
                b = QPushButton("✕")
                b.setProperty("flat", True)
                b.setFixedSize(24, 24)
                b.setStyleSheet("QPushButton { font-size:14px; color:#EF4444; border:none; padding:0; }"
                                "QPushButton:hover { color:#DC2626; }")
                b.setToolTip("إزالة السطر من الأمر")
                b.setCursor(Qt.PointingHandCursor)
                b.clicked.connect(lambda _=False, pid=int(p["id"]): self._drop_part(pid))
                tbl.setCellWidget(i, 5, b)
            tbl.setRowHeight(i, 28)
        if has_sub:
            self.sub_parts_group.setVisible(True)

    def _sub_part_price_changed(self, item):
        """تحديث الإجمالي + حفظ سعر المقاول عند تغييره."""
        if item.column() != 3:
            return
        tbl = self.sub_parts_table
        row = item.row()
        price = _num(item.text())
        qty = float(item.data(Qt.UserRole) or 0)
        part_id = int(item.data(Qt.UserRole + 1) or 0)
        # تحديث الإجمالي
        tbl.blockSignals(True)
        amt_it = tbl.item(row, 4)
        if amt_it:
            amt_it.setText(_fmt(qty * price))
        tbl.blockSignals(False)
        # حفظ السعر الجديد في القاعدة
        if part_id and self.addendum_id:
            try:
                from database.database import get_connection
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE addendum_items SET unit_price=?, amount=? WHERE id=?",
                        (price, qty * price, part_id))
            except Exception:
                pass

    def _drop_part(self, part_id: int):
        try:
            adx.remove_part(part_id)
        except ValidationError as exc:
            self._note(str(exc), True)
        self._after_change()

    def _after_change(self):
        """تحديث كل الأجزاء والإجماليات فورًا بعد أي تغيير."""
        self.reload_parts()
        # V9.1: فقط إذا كنا على طرف المقاول (sub_add_table موجود)
        if self._active_side == "sub" and hasattr(self, "sub_add_table"):
            self.reload_sub_items()
            self.reload_sub_delete()
        self.refresh_tabs_count()

    def refresh_tabs_count(self):
        if not self.addendum_id:
            self.sum_lbl_fill(0, 0, None)
        else:
            t = adx.totals(self.addendum_id)
            self.sum_lbl_fill(t["client"]["add_n"] + t["client"]["del_n"],
                              t["sub"]["add_n"] + t["sub"]["del_n"], t)
        # عدّادات التابين الرئيسيين + التابات الفرعية
        _n_cli = self._n_client_add + self._n_client_del
        _n_sub = self._n_sub_add + self._n_sub_del
        # V8.11: لا tabs رئيسي — فقط التابات الفرعية
        if self._active_side == "client":
            self.cli_tabs.setTabText(0, "➕ إضافة" + (
                f" ({self._n_client_add})" if self._n_client_add else ""))
            self.cli_tabs.setTabText(1, "➖ حذف" + (
                f" ({self._n_client_del})" if self._n_client_del else ""))
        else:
            self.sub_tabs.setTabText(0, "➕ إضافة" + (
                f" ({self._n_sub_add})" if self._n_sub_add else ""))
            self.sub_tabs.setTabText(1, "➖ حذف" + (
                f" ({self._n_sub_del})" if self._n_sub_del else ""))

    def sum_lbl_fill(self, n_cli: int, n_sub: int, t):
        self._n_client_add = int(t["client"]["add_n"]) if t else 0
        self._n_client_del = int(t["client"]["del_n"]) if t else 0
        self._n_sub_add = int(t["sub"]["add_n"]) if t else 0
        self._n_sub_del = int(t["sub"]["del_n"]) if t else 0
        if not t:
            self.foot.setText("")
            return
        _val = self._current_value()
        _after_c = _val + t["client"]["net"]
        c = self._chosen_sub()
        _sc_now = float(c.get("amount") or 0) if c else 0.0
        _after_s = _sc_now + t["sub"]["net"]
        self.foot.setText(
            f"👤 عميل: +{_fmt(t['client']['add'])} / "
            f"−{_fmt(t['client']['deduct'])} (صافي "
            f"{_fmt(t['client']['net'])})   ·   🔨 مقاول: "
            f"+{_fmt(t['sub']['add'])} / −{_fmt(t['sub']['deduct'])} "
            f"(صافي {_fmt(t['sub']['net'])})     ||     "
            f"قيمة العقد بعد الأمر: {_fmt(_after_c)} د.ك   ·   "
            f"قيمة عقد الباطن بعد الأمر: {_fmt(_after_s)} د.ك")

    # ============================================================
    # الحفظ
    # ============================================================
    def _type_changed(self):
        # النوع «عقد إضافي» يُثبَّت عند الحفظ — نفس السلوك السابق
        self.refresh_tabs_count()

    def ensure_addendum(self):
        """ينشئ مسودة الأمر التغييري مرة واحدة (بلا تنفيذ حتى الحفظ)."""
        if self.addendum_id:
            return self.addendum_id
        c = self._chosen_sub()
        aid = lc.add_addendum(
            self.contract_id,
            self.a_date.date().toString("yyyy-MM-dd"),
            self.a_reason.text().strip() or "أمر تغييري",
            self.a_desc.text(), 0.0, 0.0,
            status="مسودة", notes="", addendum_type=self.a_type.currentText(),
            side="client",
            sub_contract_id=(int(c["sub_contract_id"])
                             if c and c.get("sub_contract_id") else None),
            allow_zero=True)
        self.addendum_id = int(aid)
        return self.addendum_id

    def _save(self):
        if not self.a_reason.text().strip():
            self.set_status("سبب الأمر التغييري مطلوب.", True)
            return
        if not self.addendum_id:
            self.set_status("أضف جزءًا واحدًا على الأقل (إضافة أو حذف) في أي "
                            "من التابين.", True)
            return
        t = adx.totals(self.addendum_id)
        if (t["client"]["add_n"] + t["client"]["del_n"]
                + t["sub"]["add_n"] + t["sub"]["del_n"]) == 0:
            self.set_status("أضف جزءًا واحدًا على الأقل (إضافة أو حذف).", True)
            return
        try:
            c = self._chosen_sub()
            adx.sync_header(
                self.addendum_id,
                adate=self.a_date.date().toString("yyyy-MM-dd"),
                reason=self.a_reason.text().strip(),
                description=self.a_desc.text(),
                addendum_type=self.a_type.currentText(),
                sub_contract_id=(int(c["sub_contract_id"])
                                 if c and c.get("sub_contract_id")
                                 else self.sub_contract_id))
            lc.approve_addendum(self.addendum_id)
        except ValidationError as exc:
            self.set_status(str(exc), True)
            return
        except Exception as exc:                      # noqa: BLE001
            self.set_status(f"تعذّر تنفيذ الأمر: {exc}", True)
            return
        self.set_status("تم اعتماد الأمر التغييري وتنفيذ بنوده على العقد.")
        if callable(self.on_saved):
            try:
                self.on_saved()
            except Exception:
                pass
        self.accept()


def open_change_order(parent, contract_id: int,
                      sub_contract_id: int | None = None,
                      default_side: str = "client", on_saved=None):
    """نقطة دخول موحدة لشاشة الأمر التغييري."""
    dlg = ChangeOrderDialog(parent, contract_id, sub_contract_id,
                            default_side=default_side, on_saved=on_saved)
    return dlg
