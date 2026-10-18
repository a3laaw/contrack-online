# -*- coding: utf-8 -*-
"""تصنيف عمليات بوابة الدفع: شركتنا / شركة أخرى / غير مصنّف."""
from PySide6.QtCore import QEvent, Qt, QTimer
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QDialog,
                               QFileDialog, QFrame, QHBoxLayout, QHeaderView,
                               QInputDialog, QLabel, QLineEdit, QPushButton,
                               QTabWidget, QTableWidget, QTableWidgetItem,
                               QVBoxLayout, QWidget)

from services import gateway_service as gw
from services import settlement_service as st
from ui import style
from ui.archive import _fill, _table
from ui.widgets import (apply_column_weights, export_table_excel,
                        more_menu_button, size_buttons)

HEADS = ["م", "الهاتف", "المبلغ", "الصافي", "تاريخ التسوية", "المرجع",
         "التصنيف", "الحالة", "سندنا", "العميل", "ملاحظة"]
STATUS_COLORS = {gw.STATUS_MINE: "#16A34A", gw.STATUS_OTHER: "#B45309",
                 gw.STATUS_UNMARKED: "#64748B"}
CLASS_CYCLE = [gw.STATUS_UNMARKED, gw.STATUS_MINE, gw.STATUS_OTHER]
_CARD_FILTER = {"total": "all", "mine": gw.STATUS_MINE,
                "other": gw.STATUS_OTHER,
                "unmarked": gw.STATUS_UNMARKED,
                "dist": "dist"}


def _dist_badge(r: dict) -> str:
    """شارة حالة التوزيع (V4.36): موزَّعة/مسددة/جاهزة/تُتخطى."""
    if r.get("distributed"):
        return "🔒 موزَّعة"
    if r.get("paid_before"):
        return "⏭ مسددة"
    if (r.get("status") or "") in (gw.STATUS_MINE, gw.STATUS_OTHER):
        return "✓ جاهزة"
    return "… تُتخطى"


BADGE_COLORS = {"🔒 موزَّعة": "#7C3AED", "⏭ مسددة": "#0D9488",
                "✓ جاهزة": "#16A34A", "… تُتخطى": "#64748B",
                # V4.5.12.1: الموزَّع على شركة أخرى صار يظهر للتحديد والإرجاع
                "🔒 موزَّعة — شركة أخرى": "#9333EA"}
DIST_BADGE_OTHER = "🔒 موزَّعة — شركة أخرى"


def _ops(n: int) -> str:
    """صياغة عدد العمليات عربيًا: واحدة / عمليتان / عمليات / عملية."""
    if n == 1:
        return "عملية واحدة"
    if n == 2:
        return "عمليتان"
    if 3 <= n <= 10:
        return f"{n} عمليات"
    return f"{n} عملية"


def _row_key(r: dict) -> tuple:
    """مفتاح العملية المثبتة: تاريخ + هاتف + مبلغ + مرجع."""
    return ((r.get("date") or ""), (r.get("phone") or "").strip(),
            round(float(r.get("amount") or 0), 3),
            (r.get("ref") or "").strip())


def _seen_badge(r: dict) -> str:
    """شارة سبق التعامل: مسدد / مسجَّلة من قبل بتصنيفها المحفوظ."""
    if r.get("paid_before"):
        return f" · ✅ مسدد مسبقًا ({r['paid_before']}) — مقفل"
    if r.get("distributed"):
        return " · 🔒 موزَّعة — مقفلة (في الموزَّع)"
    if r.get("seen_before") == gw.STATUS_MINE:
        return " · 📌 مسجَّلة من قبل: شركتنا"
    if r.get("seen_before") == gw.STATUS_OTHER:
        return " · 📌 مسجَّلة من قبل: شركة أخرى"
    if r.get("seen_before"):
        return " · 📌 مسجَّلة من قبل: غير مصنّف"
    return ""


def _suggest_badge(r: dict) -> str:
    """شارة الاقتراح التلقائي (V4.17) — فارغة إن لم يوجد اقتراح."""
    if r.get("_suggested"):
        return f"✨ مقترح: {r.get('_suggest_reason') or ''}"
    if r.get("_conflict"):
        return "⚠️ سوابق متعارضة — راجِع الصنف"
    return ""


class DistributeSummaryDialog(QDialog):
    """ملخص ما بعد التوزيع (V4.19): أين ذهبت الصفوف + قفز للوجهة.

    غير مشروط (modeless): يُعرض بـ show() فلا يعلّق الفحص الآلي.
    """

    def __init__(self, parent, mine: int, other: int, skipped: int,
                 on_jump=None):
        super().__init__(parent)
        self.setWindowTitle("تم التوزيع ✅")
        self.setLayoutDirection(Qt.RightToLeft)
        self._on_jump = on_jump
        root = QVBoxLayout(self)
        bits = []
        if mine:
            bits.append(f"{_ops(mine)} شركتنا ← التصفية")
        if other:
            bits.append(f"{_ops(other)} شركة أخرى ← المستحق")
        msg = QLabel("وُزّع: " + " + ".join(bits))
        msg.setStyleSheet("font-weight: 800; font-size: 14px;")
        msg.setWordWrap(True)
        root.addWidget(msg)
        if skipped:
            note = QLabel(f"تُخطي {skipped} (غير مصنّف — باقية هنا).")
            note.setProperty("hint", True)
            root.addWidget(note)
        bar = QHBoxLayout()
        if mine and callable(on_jump):
            jb = QPushButton("→ الموزَّع")
            jb.clicked.connect(lambda: self._go("dist"))
            bar.addWidget(jb)
        if other and callable(on_jump):
            jb = QPushButton("→ حساب الأخرى")
            jb.clicked.connect(lambda: self._go("other"))
            bar.addWidget(jb)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.clicked.connect(self.close)
        bar.addWidget(close_btn)
        root.addLayout(bar)

    def _go(self, name: str):
        try:
            self._on_jump(name)
        except Exception:
            pass
        self.close()


class GatewayPage(QWidget):
    """شاشة تصنيف عمليات البوابة — تلقائي مبدئي + قرار المستخدم."""

    def __init__(self, parent=None, embedded: bool = False,
                 on_show_tab=None):
        super().__init__(parent)
        self.setLayoutDirection(Qt.RightToLeft)
        self._on_show_tab = on_show_tab
        self._sum_dlg = None
        self._rows: list[dict] = []
        self._matched: list[dict] = []
        self._file = ""
        self._npaid_hidden = 0
        self._ncancelled = 0
        self._nunpaid = 0
        self._filter = "all"
        self._dist_cache: list[dict] = []
        self._fee_cache: dict = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 8, 12, 8)
        root.setSpacing(8)

        top = QHBoxLayout()
        title = QLabel("💳 تصنيف عمليات بوابة الدفع")
        title.setProperty("pageTitle", True)
        top.addWidget(title)
        if embedded:
            title.setVisible(False)
        top.addWidget(QLabel("البوابة:"))
        self.gw_combo = QComboBox()
        self.gw_combo.setMinimumWidth(150)
        top.addWidget(self.gw_combo)
        self._reload_profiles()
        top.addStretch()
        self.file_lbl = QLabel("لم يتم اختيار ملف")
        self.file_lbl.setProperty("hint", True)
        top.addWidget(self.file_lbl)
        self.import_btn = QPushButton("＋ تسوية جديدة")
        self.import_btn.setObjectName("btnPrimary")
        self.import_btn.clicked.connect(self._pick_file)
        self.dist_btn = QPushButton("◆ توزيع")
        self.dist_btn.setObjectName("btnPrimary")
        self.dist_btn.setMinimumWidth(150)
        self.dist_btn.setStyleSheet("font-weight: 800; font-size: 15px;")
        self.dist_btn.clicked.connect(self._distribute)
        self.more_btn = more_menu_button(
            self, [("تعليم الكل: شركتنا",
                     lambda: self._bulk(gw.STATUS_MINE)),
                   ("تعليم الكل: شركة أخرى",
                     lambda: self._bulk(gw.STATUS_OTHER)),
                   ("📤 تصدير", self._export),
                   ("🗑 مسح بيانات البوابات", self._wipe_all),
                   ("↩ إرجاع المحدد للتوزيع", self._unselect),
                   ("⚙️ ملفات البوابات", self._open_profiles)])
        size_buttons([self.import_btn, self.dist_btn, self.more_btn],
                     min_w=110, uniform=False)
        top.addWidget(self.import_btn)
        top.addWidget(self.dist_btn)
        top.addWidget(self.more_btn)
        self.import_btn.setVisible(not embedded)
        self.dist_btn.setVisible(False)
        root.addLayout(top)

        hint = QLabel("انقر خلية التصنيف للتبديل · الكروت فلاتر · "
                      "◆ توزيع يعتمد المحدد (أو الكل) · الموزَّع من كارت 🔒 · "
                      "الشارة: ✓ جاهزة / … تُتخطى")
        hint.setProperty("hint", True)
        hint.setWordWrap(True)
        root.addWidget(hint)
        self.checklist = QLabel("")
        self.checklist.setWordWrap(True)
        self.checklist.setVisible(False)
        root.addWidget(self.checklist)

        cards = QHBoxLayout()
        cards.setSpacing(8)
        self._cards = {}
        self._card_frames = {}
        self._card_colors = {}
        for key, label, color in (
                ("total", "📦 الكل", "#334155"),
                ("mine", "✅ شركتنا", "#16A34A"),
                ("other", "🏢 شركة أخرى", "#B45309"),
                ("unmarked", "⚪ غير مصنّف", "#64748B"),
                ("dist", "🔒 الموزَّع", "#7C3AED")):
            card = QFrame()
            card.setProperty("card", True)
            card.setCursor(Qt.PointingHandCursor)
            lay = QVBoxLayout(card)
            lay.setContentsMargins(10, 6, 10, 6)
            name = QLabel(label)
            name.setStyleSheet(f"font-weight: 700; color: {color};")
            val = QLabel("0 عملية\n0.000 د.ك")
            val.setStyleSheet("font-weight: 800; font-size: 15px;")
            lay.addWidget(name)
            lay.addWidget(val)
            cards.addWidget(card, 1)
            self._cards[key] = val
            self._card_frames[key] = card
            self._card_colors[key] = color
            for w in (card, name, val):
                w.setProperty("cardKey", key)
                w.installEventFilter(self)
        root.addLayout(cards)

        bar = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("بحث بهاتف / مبلغ / مرجع / عميل...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(260)
        self.search.textChanged.connect(lambda _t: self._render())
        bar.addWidget(self.search)
        self.fee_lbl = QLabel("")
        self.fee_lbl.setProperty("hint", True)
        bar.addWidget(self.fee_lbl)
        self.back_btn = QPushButton("↩ إرجاع للتوزيع")
        self.back_btn.setToolTip(
            "يُرجع الصفوف المحددة في «الموزَّع» (شركتنا أو شركة أخرى) إلى "
            "مرحلة التصنيف — المسدَّد يحتاج حذف التسديد أولًا.")
        self.back_btn.setVisible(False)
        self.back_btn.clicked.connect(self._unselect)
        bar.addWidget(self.back_btn)
        root.addLayout(bar)

        self.tabs = QTabWidget()
        self.tabs.setLayoutDirection(Qt.RightToLeft)

        # تاب 1: التصنيف (الحالي)
        tab_classify = QWidget()
        tc_lay = QVBoxLayout(tab_classify)
        tc_lay.setContentsMargins(0, 0, 0, 0)
        self.table = _table(HEADS)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.cellClicked.connect(self._on_cell)
        self.table.itemSelectionChanged.connect(
            lambda: (self._update_dist_label(), self._sync_back()))
        apply_column_weights(self.table,
                             [5, 13, 11, 10, 11, 12, 12, 10, 8, 11, 26],
                             min_widths=[40, 105, 85, 85, 90, 95, 100, 85, 70,
                                         100, 140])
        tc_lay.addWidget(self.table)
        self.tabs.addTab(tab_classify, "📋 التصنيف")

        # تاب 2: كشف حساب
        tab_statement = QWidget()
        ts_lay = QVBoxLayout(tab_statement)
        ts_lay.setContentsMargins(0, 0, 0, 0)
        self.stmt_table = QTableWidget()
        self.stmt_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.stmt_table.setAlternatingRowColors(True)
        self.stmt_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.stmt_table.verticalHeader().setVisible(False)
        self.stmt_table.setShowGrid(True)
        self.stmt_table.setGridStyle(Qt.SolidLine)
        self.stmt_table.verticalHeader().setDefaultSectionSize(30)
        self.stmt_table.setStyleSheet(
            "QTableWidget { gridline-color: #C7D2E0; }"
            "QHeaderView::section { padding: 7px 4px; font-weight: 700; }")
        ts_lay.addWidget(self.stmt_table, 1)
        self.tabs.addTab(tab_statement, "📊 كشف حساب")

        # تاب 3: كشف يومي مجمع
        tab_daily = QWidget()
        td_lay = QVBoxLayout(tab_daily)
        td_lay.setContentsMargins(0, 0, 0, 0)
        self.daily_table = QTableWidget()
        self.daily_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.daily_table.setAlternatingRowColors(True)
        self.daily_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.daily_table.verticalHeader().setVisible(False)
        self.daily_table.verticalHeader().setDefaultSectionSize(32)
        self.daily_table.setShowGrid(True)
        self.daily_table.setStyleSheet(
            "QTableWidget { gridline-color: #C7D2E0; }"
            "QHeaderView::section { padding: 7px 4px; font-weight: 700; }")
        td_lay.addWidget(self.daily_table, 1)
        self.daily_summary = QLabel("")
        self.daily_summary.setStyleSheet("font-weight: 800; font-size: 12px;")
        td_lay.addWidget(self.daily_summary)
        self.tabs.addTab(tab_daily, "📅 كشف يومي مجمع")

        self.tabs.currentChanged.connect(self._on_tab_changed)
        root.addWidget(self.tabs, 1)
        self.set_filter("all")

    # ---------- تحميل وتصنيف ----------
    def _on_tab_changed(self, idx: int):
        if idx == 1:
            self._load_statement()
        elif idx == 2:
            self._load_daily_report()

    def _load_statement(self):
        gw_name = self.gw_combo.currentData() or ""
        from database.database import get_connection
        try:
            opening = st.get_other_opening()["amount"]
        except Exception:
            opening = 0.0
        try:
            fees = {p["name"]: round(float(p.get("fee_fixed") or 0), 3)
                    for p in st.list_profiles(active_only=False)}
        except Exception:
            fees = {}

        with get_connection() as conn:
            rows = conn.execute(
                "SELECT op_date, gateway, COUNT(*) AS n, "
                "COALESCE(SUM(amount),0) AS gross, "
                "SUM(CASE WHEN COALESCE(paid_transfer_id,0)>0 "
                "THEN amount ELSE 0 END) AS paid_amt "
                "FROM gateway_ops "
                "WHERE status='other' AND COALESCE(distributed,0)=1 "
                "AND (gw_paid IS NULL OR gw_paid=1) "
                "AND (?='' OR gateway=?) "
                "GROUP BY op_date, gateway ORDER BY op_date",
                (gw_name, gw_name)).fetchall()

        try:
            tr_total = st.other_transfers_total()
        except Exception:
            tr_total = 0.0

        heads = ["التاريخ", "البيان", "مدين (دخل)", "دائن (صرف)", "الرصيد"]
        self.stmt_table.setColumnCount(5)
        self.stmt_table.setHorizontalHeaderLabels(heads)

        out = []
        balance = opening
        # رصيد افتتاحي
        out.append(["", "رصيد افتتاحي", "", "", opening])
        for r in rows:
            day = r["op_date"] or ""
            n = int(r["n"])
            gross = round(float(r["gross"]), 3)
            fee = round(n * fees.get(r["gateway"] or "", 0), 3)
            net = round(gross - fee, 3)
            balance = round(balance + net, 3)
            out.append([day, f"{r['gateway']} ({n} عملية)", net, "", balance])
        # تسديدات للشركة
        if tr_total > 0.001:
            balance = round(balance - tr_total, 3)
            out.append(["", "تسديد للشركة", "", tr_total, balance])

        self.stmt_table.setRowCount(len(out))
        for i, row in enumerate(out):
            for j, val in enumerate(row):
                is_num = isinstance(val, (int, float))
                text = f"{val:,.3f}" if is_num and val else str(val)
                item = QTableWidgetItem(text)
                item.setTextAlignment(Qt.AlignCenter)
                if j in (2, 3, 4) and is_num:
                    if j == 2 and val:
                        item.setForeground(QColor("#16A34A"))
                    elif j == 3 and val:
                        item.setForeground(QColor("#DC2626"))
                if i == 0 or i == len(out) - 1:
                    font = item.font()
                    font.setBold(True)
                    item.setFont(font)
                    item.setBackground(QColor("#EEF2FF"))
                self.stmt_table.setItem(i, j, item)

        apply_column_weights(self.stmt_table, [16, 40, 18, 18, 18],
                             min_widths=[80, 200, 100, 100, 100])

    def _load_daily_report(self):
        """كشف يومي مجمع — صف واحد لكل يوم بدون تكرار."""
        from database.database import get_connection
        from datetime import date as _date

        gw_name = self.gw_combo.currentData() or ""
        try:
            opening = st.get_other_opening()["amount"]
        except Exception:
            opening = 0.0
        try:
            fees = {p["name"]: round(float(p.get("fee_fixed") or 0), 3)
                    for p in st.list_profiles(active_only=False)}
        except Exception:
            fees = {}

        with get_connection() as conn:
            rows = conn.execute(
                "SELECT op_date, gateway, "
                "COUNT(*) AS n, "
                "COALESCE(SUM(amount),0) AS gross, "
                "SUM(CASE WHEN COALESCE(paid_transfer_id,0)>0 "
                "THEN amount ELSE 0 END) AS paid_amt "
                "FROM gateway_ops "
                "WHERE status='other' AND COALESCE(distributed,0)=1 "
                "AND (gw_paid IS NULL OR gw_paid=1) "
                "AND (?='' OR gateway=?) "
                "GROUP BY op_date, gateway ORDER BY op_date",
                (gw_name, gw_name)).fetchall()

        # تحويلات للشركة
        try:
            tr_total = st.other_transfers_total()
        except Exception:
            tr_total = 0.0

        heads = ["اليوم", "العمليات", "المطلوب", "المدفوع", "الرصيد"]
        self.daily_table.setColumnCount(5)
        self.daily_table.setHorizontalHeaderLabels(heads)

        out = []
        balance = opening
        total_required = 0.0
        total_paid = 0.0

        # الصف الواحد لكل يوم: تُجمع بوابات اليوم أولًا (الرسوم تختلف بحسب البوابة)
        by_day: dict = {}
        day_order: list = []
        for r in rows:
            day = r["op_date"] or ""
            if day not in by_day:
                by_day[day] = {"n": 0, "gross": 0.0, "fee": 0.0, "paid": 0.0}
                day_order.append(day)
            cnt = int(r["n"])
            by_day[day]["n"] += cnt
            by_day[day]["gross"] += float(r["gross"] or 0)
            by_day[day]["fee"] += cnt * float(fees.get(r["gateway"] or "", 0) or 0)
            by_day[day]["paid"] += float(r["paid_amt"] or 0)

        for day in day_order:
            b = by_day[day]
            n = b["n"]
            gross = round(b["gross"], 3)
            fee = round(b["fee"], 3)
            net = round(gross - fee, 3)
            paid = round(b["paid"], 3)
            balance = round(balance + net - paid, 3)
            total_required += net
            total_paid += paid
            out.append([day, f"{n}", net, paid, balance])

        # تسديدات للشركة
        if tr_total > 0.001:
            balance = round(balance - tr_total, 3)
            out.append(["تسديد للشركة", "", "", tr_total, balance])
            total_paid += tr_total

        # صف الرصيد الافتتاحي
        out.insert(0, ["رصيد افتتاحي", "", "", "", opening])

        # صف الإجمالي
        out.append(["الإجمالي", "",
                     round(total_required, 3),
                     round(total_paid, 3),
                     round(balance, 3)])

        self.daily_table.setRowCount(len(out))
        for i, row in enumerate(out):
            for j, val in enumerate(row):
                is_num = isinstance(val, (int, float))
                text = f"{val:,.3f}" if is_num and val else str(val)
                item = QTableWidgetItem(text)
                item.setTextAlignment(Qt.AlignCenter)
                if j == 2 and is_num and val:
                    item.setForeground(QColor("#1D4ED8"))
                elif j == 3 and is_num and val:
                    item.setForeground(QColor("#166534"))
                elif j == 4 and is_num:
                    if val > 0.001:
                        item.setForeground(QColor("#DC2626"))
                    elif val < -0.001:
                        item.setForeground(QColor("#166534"))
                # صف أول/أخير عريض
                if i == 0 or i == len(out) - 1:
                    font = item.font()
                    font.setBold(True)
                    item.setFont(font)
                    item.setBackground(QColor("#EEF2FF"))
                self.daily_table.setItem(i, j, item)

        apply_column_weights(self.daily_table, [20, 12, 22, 22, 24],
                             min_widths=[100, 60, 100, 100, 100])

        self.daily_summary.setText(
            f"الرصيد الحالي: {balance:,.3f} د.ك · "
            f"إجمالي المطلوب: {total_required:,.3f} · "
            f"إجمالي المدفوع: {total_paid:,.3f}")

    def _pick_file(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "استيراد كشف التسوية", "", "Excel/CSV (*.xlsx *.csv)")
        if path:
            self.import_file(path)

    def _reload_profiles(self):
        cur = self.gw_combo.currentData()
        self.gw_combo.clear()
        for p in st.list_profiles():
            self.gw_combo.addItem(p["name"], p["name"])
        if cur:
            i = self.gw_combo.findData(cur)
            self.gw_combo.setCurrentIndex(i if i >= 0 else 0)
        self._fee_cache = st.gateway_fee_map()

    def import_file(self, path: str) -> int:
        """استيراد + تصنيف تلقائي مبدئي + تثبيت تراكمي · عدد الصفوف."""
        try:
            self._rows = gw.read_settlement_file(path)
        except Exception as exc:
            style.error(self, f"تعذر قراءة الملف:\n{exc}")
            return 0
        self._file = path
        import os as _os
        self.file_lbl.setText(f"📄 {_os.path.basename(path)} · "
                              f"{len(self._rows)} صف")
        try:
            st.refresh_gw_paid(self.gw_combo.currentData() or "",
                               self._rows)
        except Exception:
            pass
        self._auto(silent=True)
        # تثبيت تراكمي (مرحلة مؤقتة — الموزَّع والمسدد لا يُمسّان)
        try:
            gname = self.gw_combo.currentData() or ""
            new = st.save_gateway_ops(
                gname, self._matched, _os.path.basename(path))
            if new:
                self.file_lbl.setText(self.file_lbl.text() +
                                      f" · ثُبّت {new} جديد")
        except Exception:
            pass
        _nd = sum(1 for r in self._matched if r.get("distributed"))
        if _nd:
            self.file_lbl.setText(self.file_lbl.text() +
                                  f" · {_nd} موزَّعة مسبقًا (في الموزَّع)")
        if self._npaid_hidden:
            self.file_lbl.setText(
                self.file_lbl.text() +
                f" · {self._npaid_hidden} مسددة مسبقًا (مخفاة)")
        if self._ncancelled:
            self.file_lbl.setText(
                self.file_lbl.text() +
                f" · {self._ncancelled} ملغاة (مستبعدة)")
        if self._nunpaid:
            self.file_lbl.setText(
                self.file_lbl.text() +
                f" · {self._nunpaid} غير مدفوعة (مستبعدة)")
        try:
            _info = gw.last_read_info()
            if _info.get("skipped_unpaid"):
                self.file_lbl.setText(
                    self.file_lbl.text() +
                    f" · استُبعد {_info['skipped_unpaid']} (فاشلة/منتهية)")
        except Exception:
            pass
        self._update_checklist()
        return len(self._rows)

    def _auto(self, silent: bool = False):
        if not self._rows:
            if not silent:
                style.info(self, "استورد كشف التسوية أولًا.")
            return
        self._matched = gw.auto_classify(gw.match_settlement(self._rows))
        try:
            _g = self.gw_combo.currentData() or ""
            st.restore_manual(self._matched, _g)
            st.mark_paid_before(self._matched, _g)
            st.mark_seen_before(self._matched, _g)
            if _g:
                _saved = st.seen_lookup(_g)
                _dist = st.distributed_lookup(_g)
                for r in self._matched:
                    if r.get("paid_before"):
                        r["status"] = _saved.get(_row_key(r)) or "other"
                    r["distributed"] = _row_key(r) in _dist
                st.suggest_row_classes(_g, self._matched)
        except Exception:
            pass
        self._npaid_hidden = sum(
            1 for r in self._matched if r.get("paid_before"))
        if self._npaid_hidden:
            self._matched = [r for r in self._matched
                             if not r.get("paid_before")]
        self._ncancelled = sum(
            1 for r in self._matched if r.get("gw_paid") == 2)
        if self._ncancelled:
            self._matched = [r for r in self._matched
                             if r.get("gw_paid") != 2]
        self._nunpaid = sum(
            1 for r in self._matched if r.get("gw_paid") == 0)
        if self._nunpaid:
            self._matched = [r for r in self._matched
                             if r.get("gw_paid") != 0]
        self._refresh_dist_cache()
        self._render()
        self._update_checklist()

    def refresh(self):
        """إعادة التصنيف عند العودة للصفحة (مع احترام اليدوي)."""
        self._reload_profiles()
        if self._rows:
            QTimer.singleShot(0, lambda: self._auto(silent=True))
        self._refresh_dist_cache()

    # ---------- تصنيف يدوي ----------
    def _on_cell(self, row: int, col: int):
        """النقر على خلية التصنيف يُبدّلها (بدون ← شركتنا ← أخرى)."""
        if col != 6:
            return
        if self._filter == "dist":
            style.info(self, "الموزَّع للعرض فقط — حدد الصف ثم ↩ للإرجاع.")
            return
        filt = self._filtered()
        if not (0 <= row < len(filt)):
            return
        r = filt[row]
        if r.get("paid_before"):
            style.info(self, "العملية مسددة — مقفلة لا تُصنف.")
            return
        if r.get("distributed"):
            style.info(self, "العملية موزَّعة — مقفلة (ارجعها من الموزَّع).")
            return
        gateway = self.gw_combo.currentData() or ""
        if not gateway:
            style.error(self, "اختر البوابة أولًا.")
            return
        cur = r.get("status") or gw.STATUS_UNMARKED
        nxt = CLASS_CYCLE[(CLASS_CYCLE.index(cur) + 1) % len(CLASS_CYCLE)] \
            if cur in CLASS_CYCLE else gw.STATUS_UNMARKED
        try:
            st.set_row_class(gateway, _row_key(r), nxt)
        except ValueError as exc:
            style.error(self, str(exc))
            return
        r["status"] = nxt
        r["manual"] = True
        r.pop("_suggested", None)
        r.pop("_suggest_reason", None)
        r.pop("_conflict", None)
        self._render()

    def _bulk(self, status: str):
        """تصنيف كل الصفوف الظاهرة (عدا المسددة) بتصنيف واحد."""
        if self._filter == "dist":
            style.info(self, "الموزَّع للعرض فقط — حدد ثم ↩ للإرجاع.")
            return
        gateway = self.gw_combo.currentData() or ""
        if not gateway:
            style.error(self, "اختر البوابة أولًا.")
            return
        filt = [r for r in self._filtered()
                if not r.get("paid_before") and not r.get("distributed")]
        if not filt:
            style.info(self, "لا توجد صفوف ظاهرة قابلة للتصنيف.")
            return
        ok = 0
        for r in filt:
            try:
                st.set_row_class(gateway, _row_key(r), status)
            except ValueError:
                continue
            r["status"] = status
            r["manual"] = True
            r.pop("_suggested", None)
            r.pop("_suggest_reason", None)
            r.pop("_conflict", None)
            ok += 1
        self._render()
        if ok:
            style.success(
                self, f"صُنّف {ok} صف: {gw.STATUS_LABEL.get(status, status)}")
        else:
            style.info(self, "تعذّر التصنيف — أعد الاستيراد.")

    def _dist_targets(self) -> list[dict]:
        """صفوف التوزيع: المحدد (أو كل الظاهر) القابل للتوزيع."""
        filt = self._filtered()
        sel = sorted({i.row() for i in self.table.selectedIndexes()})
        rows = ([filt[i] for i in sel if 0 <= i < len(filt)]
                if sel else filt)
        return [r for r in rows if not r.get("distributed")
                and not r.get("paid_before")]

    def _update_dist_label(self):
        """عدّاد زر التوزيع: الجاهزة + المتخطاة (V4.36)."""
        _tg = self._dist_targets()
        n = sum(1 for r in _tg if (r.get("status") or "")
                in (gw.STATUS_MINE, gw.STATUS_OTHER))
        _skip = sum(1 for r in _tg
                    if (r.get("status") or "") not in (gw.STATUS_MINE,
                                                       gw.STATUS_OTHER))
        _txt = f"◆ توزيع ({_ops(n)} · ⏭ {_skip})" if n and _skip else (
            f"◆ توزيع ({_ops(n)})" if n else "◆ توزيع")
        self.dist_btn.setText(_txt)
        self.dist_btn.setToolTip(
            f"يوزّع المحدد (أو كل الظاهر): {n} جاهزة · {_skip} تُتخطى"
            " (غير مصنّفة)")

    def _distribute(self):
        """◆ توزيع صريح: المحدد (أو كل المصنَّف الظاهر) ← معتمد."""
        if self._filter == "dist":
            style.info(self, "أنت في الموزَّع — حدد ثم ↩ للإرجاع.")
            return
        gateway = self.gw_combo.currentData() or ""
        if not gateway:
            style.error(self, "اختر البوابة أولًا.")
            return
        if not self._matched:
            style.info(self, "استورد كشف التسوية أولًا.")
            return
        rows = self._dist_targets()
        if not rows:
            style.info(self, "لا توجد صفوف قابلة للتوزيع.")
            return
        res = st.distribute_rows(gateway, [_row_key(r) for r in rows])
        _dist = st.distributed_lookup(gateway)
        self._matched = [r for r in self._matched
                         if _row_key(r) not in _dist]
        self.table.clearSelection()
        self._refresh_dist_cache()
        self._render()
        parts = []
        if res["mine"]:
            parts.append(f"{_ops(res['mine'])} شركتنا")
        if res["other"]:
            parts.append(f"{_ops(res['other'])} شركة أخرى")
        if not parts:
            style.info(self, "لم يُوزَّع شيء (الظاهر غير مصنّف).")
            return
        self.file_lbl.setText(
            f"وُزّع: {' + '.join(parts)} ✅"
            + (f" · تُخطي {res['skipped']} (غير مصنّف)"
               if res["skipped"] else ""))
        try:
            if self._sum_dlg is not None:
                self._sum_dlg.close()
        except Exception:
            pass
        self._sum_dlg = DistributeSummaryDialog(
            self, res["mine"], res["other"], res["skipped"],
            on_jump=self._jump_to if callable(self._on_show_tab)
            else None)
        self._sum_dlg.show()

    def _jump_to(self, name: str):
        """قفزة من الملخص: الموزَّع ← التصنيف + فلتره · الأخرى ← المستحق."""
        if callable(self._on_show_tab):
            if name == "other":
                self._on_show_tab(name, "due")
            elif name == "dist":
                self._on_show_tab("match")
                self.set_filter("dist")
            else:
                self._on_show_tab(name)

    def _refresh_dist_cache(self):
        """صفوف الموزَّع: شركتنا + شركة أخرى (V4.5.12.1) للبوابة الحالية."""
        gw_name = self.gw_combo.currentData() or ""
        self._dist_mine: list[dict] = []
        self._dist_other: list[dict] = []
        if gw_name:
            try:
                self._dist_mine = [
                    dict(r, _side="mine")
                    for r in st.distributed_mine_rows()
                    if r.get("gateway") == gw_name]
            except Exception:
                self._dist_mine = []
            try:
                self._dist_other = [
                    dict(r, _side="other")
                    for r in st.distributed_other_rows(gw_name)]
            except Exception:
                self._dist_other = []
        self._dist_cache = self._dist_mine + self._dist_other

    def _sync_back(self):
        """↩ الإرجاع سياقي — في الموزَّع مع تحديد فقط."""
        try:
            show = self._filter == "dist" and bool(
                self.table.selectedIndexes())
        except Exception:
            show = False
        self.back_btn.setVisible(show)

    def _open_profiles(self):
        """⚙️ ملفات البوابات (نُقلت من شاشة المطابقة الملغاة)."""
        from ui.clearing_page import GatewayProfilesDialog
        GatewayProfilesDialog(self).exec()
        self._reload_profiles()
        self.refresh()

    def _unselect(self):
        """↩ إرجاع المحدد في الموزَّع إلى التوزيع."""
        if self._filter != "dist":
            style.info(self, "الإرجاع من كارت 🔒 الموزَّع فقط.")
            return
        filt = self._filtered()
        sel = sorted({i.row() for i in self.table.selectedIndexes()})
        rows = [filt[i] for i in sel if 0 <= i < len(filt)]
        if not rows:
            style.info(self, "حدد صفوفًا أولًا.")
            return
        by_gw: dict = {}
        for r in rows:
            by_gw.setdefault(r["gateway"], []).append(
                (r["date"], r["phone"], r["amount"], r["ref"]))
        ok = 0
        _paid = 0
        for g, keys in by_gw.items():
            try:
                _res = st.undistribute_rows(g, keys)
                ok += int(_res.get("ok") or 0)
                _paid += int(_res.get("paid_skipped") or 0)
            except Exception:
                pass
        self.table.clearSelection()
        self._refresh_dist_cache()
        self._render()
        self._sync_back()
        if ok:
            style.success(self, f"أُرجع {ok} صف للتوزيع."
                          + (f" · تعذّر إرجاع {_paid} صف مسدَّد — "
                             "احذف التسديد من شاشة الأخرى أولًا." if _paid
                             else ""))
        elif _paid:
            style.info(self, "تعذّر الإرجاع: الصفوف مسدَّدة — احذف التسديد "
                             "من شاشة «الأخرى» ثم أرجعها.")
        else:
            style.info(self, "تعذّر الإرجاع.")

    # ---------- عرض ----------
    def _wipe_all(self):
        """مسح شامل نهائي — بتأكيد كتابي + نسخة احتياطية تلقائية."""
        c = st.wipe_counts()
        if not (c["ops"] or c["transfers"] or c["vouchers"]):
            style.info(self, "لا توجد معاملات بوابات لمسحها.")
            return
        text, ok = QInputDialog.getText(
            self, "مسح شامل نهائي",
            "سيُمسح نهائيًا: %d عملية · %d تسديد · %d سند "
            "(كل البوابات).\n"
            "تُحفظ نسخة احتياطية تلقائيًا قبل المسح.\n"
            "اكتب «مسح» للتأكيد:" % (c["ops"], c["transfers"],
                                     c["vouchers"]))
        if not ok or (text or "").strip() != "مسح":
            return
        res = st.wipe_all_gateway_data()
        self._matched, self._rows, self._npaid_hidden = [], [], 0
        self.file_lbl.setText("لم يتم اختيار ملف")
        self._render()
        style.success(
            self, "مُسح %d عملية · %d تسديد · %d سند.\nالنسخة: %s"
            % (res["ops"], res["transfers"], res["vouchers"],
               res["backup"]))

    def set_filter(self, data: str):
        """فلتر الكروت (للنقر وللفحص الآلي) + تمييز النشط."""
        self._filter = data
        for key, frame in self._card_frames.items():
            if _CARD_FILTER.get(key) == data:
                frame.setStyleSheet(
                    f"border: 2px solid {self._card_colors[key]}; "
                    f"border-radius: 10px;")
            else:
                frame.setStyleSheet("")
        if data == "dist":
            self._refresh_dist_cache()
        self._render()
        self._sync_back()

    def eventFilter(self, obj, ev):
        if ev.type() == QEvent.MouseButtonPress:
            try:
                key = obj.property("cardKey")
            except Exception:
                key = None
            if key in _CARD_FILTER:
                self.set_filter(_CARD_FILTER[key])
                return True
        return super().eventFilter(obj, ev)

    def _filtered(self) -> list[dict]:
        mode = self._filter
        q = (self.search.text() or "").strip()
        if mode == "dist":
            return [r for r in self._dist_cache
                    if not q or q in " ".join(
                        str(r.get(k) or "") for k in (
                            "phone", "amount", "ref", "customer"))]
        out = []
        for r in self._matched:
            if r.get("distributed"):
                continue
            if mode != "all" and r.get("status") != mode:
                continue
            if q:
                hay = " ".join(str(r.get(k) or "") for k in (
                    "phone", "amount", "ref", "customer", "receipt_no"))
                if q not in hay:
                    continue
            out.append(r)
        return out

    def _update_checklist(self):
        """قائمة تحقق ما بعد الاستيراد — تنبيهات لا أخطاء."""
        if not self._rows:
            self.checklist.setVisible(False)
            return
        try:
            info = gw.last_read_info()
        except Exception:
            info = {}
        lines = []
        if info.get("skipped_unpaid"):
            lines.append(("info",
                          f"⏭ استُبعد {info['skipped_unpaid']} صفًا "
                          f"فاشلًا/منتهيًا من الملف."))
        if not info.get("has_date_col", True):
            lines.append(("warn", "📅 الملف بلا عمود تاريخ — طُبقت الهوية "
                                  "+ المبلغ فقط."))
        elif info.get("dateless"):
            lines.append(("warn", f"📅 {info['dateless']} صفًا بلا تاريخ — "
                                  f"طُبقت عليها الهوية + المبلغ فقط."))
        if info.get("total") and info.get("no_phone") == info["total"]:
            lines.append(("warn", "☎ لا هواتف في الملف إطلاقًا — المطابقة "
                                  "بالاسم فقط."))
        if info.get("no_identity"):
            lines.append(("bad", f"🚫 {info['no_identity']} صفًا بلا هاتف "
                                 f"ولا اسم — تعذرت مطابقتها."))
        try:
            from database.database import get_connection
            with get_connection() as conn:
                n = conn.execute(
                    "SELECT COUNT(*) FROM customers "
                    "WHERE COALESCE(TRIM(phone),'')=''").fetchone()[0]
            if n:
                lines.append(("warn", f"👥 {n} عميل بلا هاتف مسجل — سجّل "
                                      f"هواتفهم لدقة أعلى."))
        except Exception:
            pass
        if not lines:
            lines.append(("ok", "✅ الملف سليم: هواتف وتواريخ ومبالغ — "
                                "المطابقة كاملة."))
        colors = {"info": "#1D4ED8", "warn": "#B45309", "bad": "#DC2626",
                  "ok": "#166534"}
        self.checklist.setText("<br>".join(
            f"<font color='{colors[k]}'>{t}</font>" for k, t in lines))
        self.checklist.setVisible(True)

    def _render(self):
        self.dist_btn.setVisible(any(
            not r.get("distributed") and not r.get("paid_before")
            and (r.get("status") or "") in (gw.STATUS_MINE, gw.STATUS_OTHER)
            for r in self._matched))
        self._update_dist_label()
        s = gw.summary(self._matched)
        for key in ("total", "mine", "other", "unmarked"):
            d = s[key]
            self._cards[key].setText(
                f"{_ops(d['count'])}\n{d['amount']:,.3f} د.ك")
        _dn = len(self._dist_cache)
        _dt = sum(float(r.get("amount") or 0) for r in self._dist_cache)
        _nm = len(getattr(self, "_dist_mine", []) or [])
        _no = len(getattr(self, "_dist_other", []) or [])
        self._cards["dist"].setText(f"{_ops(_dn)}\n{_dt:,.3f} د.ك")
        self._cards["dist"].setToolTip(
            f"موزَّع على شركتنا: {_ops(_nm)} · موزَّع على شركة أخرى: {_ops(_no)}"
            "\nافتح الكارت لتحديد أي صف ثم «↩ إرجاع المحدد للتوزيع».")
        rows = []
        colors = {}
        _is_dist = self._filter == "dist"
        _gw = self.gw_combo.currentData() or ""
        _fee = self._fee_cache.get(_gw, 0)
        for n, r in enumerate(self._filtered(), 1):
            if _is_dist:
                _amt = round(float(r.get("amount") or 0), 3)
                if r.get("_side") == "other":
                    # V4.5.12.1: صف شركة أخرى ظاهر للتحديد والإرجاع
                    note = ("⚠ مسدَّدة — احذف التسديد من شاشة الأخرى "
                            "ثم أرجعها" if r.get("paid") else
                            "↩ حدد الصف ثم «إرجاع المحدد للتوزيع»")
                    rows.append([n, r.get("phone") or "", f"{_amt:,.3f}",
                                 f"{round(_amt - _fee, 3):,.3f}",
                                 r.get("date") or "", r.get("ref") or "",
                                 gw.STATUS_LABEL.get(gw.STATUS_OTHER),
                                 DIST_BADGE_OTHER, "", r.get("customer") or "",
                                 note])
                    colors[(n - 1, 6)] = STATUS_COLORS.get(gw.STATUS_OTHER,
                                                           style.TEXT)
                    colors[(n - 1, 7)] = BADGE_COLORS[DIST_BADGE_OTHER]
                    if r.get("paid"):
                        colors[(n - 1, 10)] = "#B45309"
                    continue
                note = f"🏦 يوم: {r.get('day_status') or '—'}"
                rows.append([n, r.get("phone") or "", f"{_amt:,.3f}",
                             f"{round(_amt - _fee, 3):,.3f}",
                             r.get("date") or "", r.get("ref") or "",
                             gw.STATUS_LABEL.get(gw.STATUS_MINE),
                             "🔒 موزَّعة", "", r.get("customer") or "",
                             note])
                colors[(n - 1, 6)] = STATUS_COLORS.get(gw.STATUS_MINE,
                                                       style.TEXT)
                colors[(n - 1, 7)] = BADGE_COLORS["🔒 موزَّعة"]
                continue
            cls = r.get("status") or gw.STATUS_UNMARKED
            note = (r.get("note") or "") + _seen_badge(r)
            _sg = _suggest_badge(r)
            if _sg:
                note = _sg + (f" · {note}" if note else "")
            _amt = round(float(r.get("amount") or 0), 3)
            _bdg = _dist_badge(r)
            rows.append([n, r.get("phone") or "", f"{_amt:,.3f}",
                         f"{round(_amt - _fee, 3):,.3f}",
                         r.get("date") or "", r.get("ref") or "",
                         gw.STATUS_LABEL.get(cls, cls), _bdg,
                         r.get("receipt_no") or "", r.get("customer") or "",
                         note])
            colors[(n - 1, 6)] = STATUS_COLORS.get(cls, style.TEXT)
            colors[(n - 1, 7)] = BADGE_COLORS.get(_bdg, style.TEXT)
            if r.get("paid_before"):
                colors[(n - 1, 10)] = "#16A34A"
            elif r.get("seen_before"):
                colors[(n - 1, 10)] = "#64748B"
        _fill(self.table, rows, colors=colors, money_cols=(2, 3))
        self.fee_lbl.setText(
            f"العمولة: {_fee:,.3f} د.ك/عملية (ملف {_gw})" if _gw
            else "اختر البوابة لعرض عمولتها")

    # ---------- تصدير ----------
    def _export(self):
        rows = self._filtered()
        if not rows:
            style.info(self, "لا توجد بيانات للتصدير.")
            return
        data = []
        _is_dist = self._filter == "dist"
        for n, r in enumerate(rows, 1):
            _fee_x = self._fee_cache.get(
                self.gw_combo.currentData() or "", 0)
            if _is_dist:
                _ax = round(float(r.get("amount") or 0), 3)
                if r.get("_side") == "other":
                    data.append([n, r.get("phone") or "", _ax,
                                 round(_ax - _fee_x, 3),
                                 r.get("date") or "", r.get("ref") or "",
                                 gw.STATUS_LABEL.get(gw.STATUS_OTHER),
                                 DIST_BADGE_OTHER, "",
                                 r.get("customer") or "",
                                 "مسدَّدة" if r.get("paid") else "قابلة للإرجاع"])
                    continue
                data.append([n, r.get("phone") or "", _ax,
                             round(_ax - _fee_x, 3),
                             r.get("date") or "", r.get("ref") or "",
                             gw.STATUS_LABEL.get(gw.STATUS_MINE),
                             "🔒 موزَّعة", "", r.get("customer") or "",
                             f"🏦 يوم: {r.get('day_status') or '—'}"])
                continue
            _note = (r.get("note") or "") + _seen_badge(r)
            _sg = _suggest_badge(r)
            if _sg:
                _note = _sg + (f" · {_note}" if _note else "")
            _ax = round(float(r.get("amount") or 0), 3)
            data.append([n, r.get("phone") or "", _ax,
                         round(_ax - _fee_x, 3),
                         r.get("date") or "", r.get("ref") or "",
                         gw.STATUS_LABEL.get(r.get("status"), ""),
                         _dist_badge(r), r.get("receipt_no") or "",
                         r.get("customer") or "", _note])
        export_table_excel(self, "تصنيف عمليات بوابة الدفع", HEADS, data,
                           "gateway_classification", number_cols=[2, 3])
