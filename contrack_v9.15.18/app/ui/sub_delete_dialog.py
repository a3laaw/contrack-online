# -*- coding: utf-8 -*-
"""V5.8: شاشة «حذف بيانات المقاول» — خيارات منفصلة بدل حذف المقاول كامل.

ثلاثة أقسام واضحة:
  ① 📑 عقود الباطن  — علّم ✔ العقد/العقود ثم «احذف المحدد».
  ② 🧾 السندات       — علّم ✔ السند/السندات ثم حذف نهائي (المطور) أو إلغاء.
  ③ 👷 سجل المقاول   — لا يُحذف ما دام عليه عقد أو سند (نفس قواعد العميل).
"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QDialog, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QPushButton, QTabWidget, QTableWidget, QTableWidgetItem, QVBoxLayout,
    QWidget,
)

from services import sub_delete_service as sds
from services.customer_service import ValidationError
from ui import style


def _fmt(x) -> str:
    try:
        return f"{float(x or 0):,.3f}"
    except Exception:
        return "0.000"


class QWidgetHost(QWidget):
    """حاوية بسيطة بعمود واحد — لتقليل تكرار الكود."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("transparentHost")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(6, 8, 6, 8)
        lay.setSpacing(8)
        self.root = lay


class _Chk(QTableWidgetItem):
    """خانة ✔ — وتُعطَّل مع سبب المنع إن تعذّر الحذف."""

    def __init__(self, checked: bool = False, enabled: bool = True,
                 why: str = ""):
        super().__init__("")
        flags = Qt.ItemIsUserCheckable | Qt.ItemIsSelectable
        if enabled:
            flags |= Qt.ItemIsEnabled
        self.setFlags(flags)
        self.setCheckState(Qt.Checked if checked else Qt.Unchecked)
        if why:
            self.setToolTip(f"لا يمكن حذفه: {why}")


class SubDeleteDialog(QDialog):
    """خيارات حذف مقاول الباطن: عقد · سند · السجل."""

    def __init__(self, parent=None, sub_id: int = 0, focus: str = "contracts",
                 on_done=None):
        super().__init__(parent)
        self.sub_id = int(sub_id or 0)
        self.on_done = on_done
        self.setWindowTitle("🗑 حذف بيانات المقاول — عقد · سند · السجل")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumSize(980, 660)

        root = QVBoxLayout(self)
        root.setSpacing(8)

        self.head_lbl = QLabel("")
        self.head_lbl.setStyleSheet("font-weight:800; font-size:14px;")
        root.addWidget(self.head_lbl)
        self.sum_lbl = QLabel("")
        self.sum_lbl.setStyleSheet("color:#475569;")
        root.addWidget(self.sum_lbl)

        rrow = QHBoxLayout()
        rrow.addWidget(QLabel("السبب"))
        self.reason = QLineEdit()
        self.reason.setPlaceholderText(
            "سبب الحذف — إلزامي لحذف/إلغاء السندات وحذف سجل المقاول")
        rrow.addWidget(self.reason, 1)
        root.addLayout(rrow)

        self.tabs = QTabWidget()
        root.addWidget(self.tabs, 1)

        # ================= ① عقود الباطن =================
        host_c = QWidgetHost()
        self.c_tab = host_c
        c_btns = QHBoxLayout()
        self.c_hint = QLabel("")
        self.c_hint.setWordWrap(True)
        self.c_hint.setStyleSheet("color:#64748B; font-size:12px;")
        c_btns.addWidget(self.c_hint)
        c_btns.addStretch()
        b_c = QPushButton("🗑 احذف العقود المحددة")
        b_c.setProperty("danger", True)
        b_c.setToolTip("يحذف عقد الباطن المحدد فقط — بلا مساس بسجل المقاول "
                       "ولا بسنداته الباقية")
        b_c.clicked.connect(self._del_contracts)
        c_btns.addWidget(b_c)
        host_c.root.addLayout(c_btns)
        self.c_table = QTableWidget(0, 8)
        self.c_table.setHorizontalHeaderLabels(
            ["✔", "عقد الباطن", "عقد العميل", "القيمة", "الحالة", "بنود",
             "دفعات", "سندات سارية"])
        self.c_table.verticalHeader().setVisible(False)
        self.c_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.c_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.c_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        host_c.root.addWidget(self.c_table, 1)
        self.tabs.addTab(host_c, "📑 عقود الباطن")

        # ================= ② السندات =================
        host_v = QWidgetHost()
        v_btns = QHBoxLayout()
        self.v_hint = QLabel("")
        self.v_hint.setWordWrap(True)
        self.v_hint.setStyleSheet("color:#64748B; font-size:12px;")
        v_btns.addWidget(self.v_hint)
        v_btns.addStretch()
        self.b_v = QPushButton("")
        self.b_v.setProperty("danger", True)
        self.b_v.clicked.connect(self._del_vouchers)
        v_btns.addWidget(self.b_v)
        host_v.root.addLayout(v_btns)
        self.v_table = QTableWidget(0, 7)
        self.v_table.setHorizontalHeaderLabels(
            ["✔", "رقم السند", "النوع", "التاريخ", "المبلغ", "الحالة",
             "عقد العميل المرتبط"])
        self.v_table.verticalHeader().setVisible(False)
        self.v_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.v_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.v_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        host_v.root.addWidget(self.v_table, 1)
        self.tabs.addTab(host_v, "🧾 السندات")

        # ================= ③ سجل المقاول =================
        host_r = QWidgetHost()
        self.r_state = QLabel("")
        self.r_state.setWordWrap(True)
        self.r_state.setStyleSheet("font-weight:700;")
        host_r.root.addWidget(self.r_state)
        self.r_note = QLabel(
            "حذف السجل نفسه يكون بعد إفراغه من العقود والسندات — وبعدها لا "
            "يُستعاد. بنود عقد العميل والمالية مع المالك لا تُمسّ.")
        self.r_note.setWordWrap(True)
        self.r_note.setStyleSheet("color:#64748B; font-size:12px;")
        host_r.root.addWidget(self.r_note)
        self.r_ack = QCheckBox("أُقر بحذف سجل المقاول نهائيًا (لا يُستعاد)")
        host_r.root.addWidget(self.r_ack)
        rb = QHBoxLayout()
        rb.addStretch()
        self.b_r = QPushButton("🗑 احذف سجل المقاول")
        self.b_r.setProperty("danger", True)
        self.b_r.clicked.connect(self._del_record)
        rb.addWidget(self.b_r)
        host_r.root.addLayout(rb)
        host_r.root.addStretch()
        self.r_tab = host_r
        self.tabs.addTab(host_r, "👷 سجل المقاول")

        self.status = QLabel("")
        self.status.setWordWrap(True)
        self.status.setStyleSheet("color:#475569; font-size:12px;")
        root.addWidget(self.status)

        br = QHBoxLayout()
        br.addStretch()
        ref = QPushButton("🔄 تحديث")
        ref.setProperty("flat", True)
        ref.clicked.connect(self._reload)
        br.addWidget(ref)
        close = QPushButton("✕ إغلاق")
        close.setProperty("flat", True)
        close.clicked.connect(self.reject)
        br.addWidget(close)
        root.addLayout(br)

        idx = {"contracts": 0, "vouchers": 1, "record": 2}.get(focus or "", 0)
        self.tabs.setCurrentIndex(idx)
        self._reload()

    # ---------- تحميل ----------
    def _reload(self):
        ov = sds.overview(self.sub_id)
        sub = ov.get("subcontractor") or {}
        if not sub:
            self.head_lbl.setText("المقاول غير موجود")
            for t in (self.c_table, self.v_table):
                t.setRowCount(0)
            self.r_state.setText("")
            return
        s = ov["summary"]
        self.head_lbl.setText(
            f"👷 {sub.get('name','')}  ({sub.get('sub_code','')}) — "
            "حذف بخيارات: عقد · سند · السجل")
        self.sum_lbl.setText(
            f"حالته: {s['contracts']} عقد باطن ({_fmt(s['contracts_value'])} د.ك)"
            f"  ·  {s['vouchers']} سند منها {s['vouchers_active']} فعّال و"
            f"{s['vouchers_cancelled']} ملغى — بمبلغ فعّال "
            f"{_fmt(s['vouchers_total'])} د.ك")

        # ① العقود
        self.c_table.setRowCount(0)
        for sc in ov["contracts"]:
            i = self.c_table.rowCount()
            self.c_table.insertRow(i)
            self.c_table.setItem(i, 0, _Chk(
                False, enabled=bool(sc.get("can_delete")),
                why=sc.get("block_reason") or ""))
            cells = [f"#{sc['id']} — {sc.get('client_number') or '—'}",
                     sc.get("customer_name") or "—",
                     _fmt(sc.get("amount")),
                     sc.get("status") or "",
                     str(sc.get("items") or 0), str(sc.get("plan_rows") or 0),
                     str(sc.get("vouchers_active") or 0)]
            for c, txt in enumerate(cells, start=1):
                it = QTableWidgetItem(str(txt))
                if c in (3, 5, 6, 7):
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.c_table.setItem(i, c, it)
        blocked = [x for x in ov["contracts"] if not x.get("can_delete")]
        if not ov["contracts"]:
            self.c_hint.setText("لا عقود باطن لهذا المقاول.")
        elif blocked:
            self.c_hint.setText(
                f"{len(ov['contracts'])} عقدًا · منها {len(blocked)} لا يمكن "
                "حذفه الآن (سند سارٍ أو مطالبة) — مرّر على ✔ لمعرفة السبب.")
        else:
            self.c_hint.setText(
                f"{len(ov['contracts'])} عقدًا — علّم ✔ ما تريد حذفه.")
        self.tabs.setTabText(0, f"📑 عقود الباطن ({len(ov['contracts'])})")

        # ② السندات
        dev = sds.can_hard_delete_vouchers()
        self.b_v.setText("🗑 احذف السندات المحددة نهائيًا" if dev
                         else "↩ ألغِ السندات المحددة")
        self.v_hint.setText(
            ("المطور: حذف نهائي موثّق في سجل التدقيق — علّم ✔ ما تريد حذفه."
             if dev else
             "حسابك ليس حساب المطور: السندات تُلغى إلغاءً موثّقًا (تبقى في "
             "السجل ويُفتح ما عُلّق بها)."))
        self.v_table.setRowCount(0)
        for v in ov["vouchers"]:
            i = self.v_table.rowCount()
            self.v_table.insertRow(i)
            state = "ملغى" if v.get("cancelled") else "فعّال"
            self.v_table.setItem(i, 0, _Chk(
                False, enabled=not v.get("cancelled"),
                why="ملغى بالفعل" if v.get("cancelled") else ""))
            cells = [v.get("voucher_number") or f"#{v['id']}",
                     v.get("type_label") or "", v.get("vdate") or "",
                     _fmt(v.get("amount")), state,
                     v.get("linked_contract") or "—"]
            for c, txt in enumerate(cells, start=1):
                it = QTableWidgetItem(str(txt))
                if c == 4:
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.v_table.setItem(i, c, it)
        self.tabs.setTabText(1, f"🧾 السندات ({len(ov['vouchers'])})")

        # ③ السجل
        self.r_state.setText(ov["record_block"] or
                             "✅ السجل فارغ من العقود والسندات — يمكن حذفه.")
        self.r_state.setStyleSheet(
            "font-weight:700; color:" + ("#D97706" if not ov["can_delete_record"]
                                          else style.theme().get("GREEN",
                                                                 "#16A34A")))
        can = bool(ov["can_delete_record"]) and dev
        self.r_ack.setEnabled(can)
        self.r_ack.setChecked(False)
        self.b_r.setEnabled(can)
        if ov["can_delete_record"] and not dev:
            self.r_note.setText(
                "السجل فارغ — لكن حذف السجل نفسه يتاح لحساب المطور فقط "
                "(مثل أداة التنظيف).")
        else:
            self.r_note.setText(
                "حذف السجل نفسه يكون بعد إفراغه من العقود والسندات — وبعدها "
                "لا يُستعاد. بنود عقد العميل والمالية مع المالك لا تُمسّ.")

    def _note(self, msg: str, bad: bool = False):
        self.status.setText(msg)
        self.status.setStyleSheet(
            "font-size:12px; color:" + ("#DC2626" if bad else "#475569"))

    def _picked(self, table) -> list:
        out = []
        for i in range(table.rowCount()):
            it = table.item(i, 0)
            if it and (it.flags() & Qt.ItemIsEnabled) \
                    and it.checkState() == Qt.Checked:
                out.append(i)
        return out

    # ---------- أفعال ----------
    def _del_contracts(self):
        rows = self._picked(self.c_table)
        if not rows:
            self._note("علّم ✔ على عقد باطن واحد على الأقل.", True)
            return
        ov = sds.overview(self.sub_id)
        ids = [int(ov["contracts"][r]["id"]) for r in rows]
        names = ", ".join(
            f"#{i} ({ov['contracts'][r].get('client_number') or '—'})"
            for r, i in zip(rows, ids))
        if not style.confirm(
                self,
                f"حذف {len(ids)} عقد باطن: {names}؟\n\n"
                "تُحذف بنود ارتباطه وخطة دفعاته — وأي سند **ملغى** يُفكّ عنه "
                "ويبقى في السجل. سجل المقاول وبقية عقوده وسنداته لا تُمسّ.",
                "تأكيد حذف عقد/عقود الباطن"):
            return
        try:
            res = sds.delete_contracts(ids, self.reason.text())
        except ValidationError as exc:
            self._note(str(exc), True)
            return
        msg = f"حُذف {res['deleted']} عقد باطن."
        if res["errors"]:
            msg += "  ⚠ تعذّر: " + " | ".join(
                f"#{e['id']}: {e['msg'].splitlines()[0]}"
                for e in res["errors"])
            self._note(msg, True)
        else:
            self._note(msg)
        self._after()

    def _del_vouchers(self):
        rows = self._picked(self.v_table)
        if not rows:
            self._note("علّم ✔ على سند واحد على الأقل.", True)
            return
        reason = (self.reason.text() or "").strip()
        if not reason:
            self._note("اكتب سبب الحذف/الإلغاء أولًا.", True)
            return
        ov = sds.overview(self.sub_id)
        ids = [int(ov["vouchers"][r]["id"]) for r in rows]
        dev = sds.can_hard_delete_vouchers()
        verb = "حذف" if dev else "إلغاء"
        if not style.confirm(
                self,
                f"{verb} {len(ids)} سند لمقاول «"
                f"{ov['subcontractor'].get('name','')}»؟\n\n"
                + ("حذف نهائي موثّق في سجل التدقيق — لا يُستعاد."
                   if dev else
                   "إلغاء موثّق: الحركة تبقى في السجل باسم ملغى."),
                f"تأكيد {verb} السندات"):
            return
        try:
            res = sds.delete_vouchers(ids, reason)
        except ValidationError as exc:
            self._note(str(exc), True)
            return
        if res["mode"] == "delete":
            msg = f"حُذف {res['deleted']} سند نهائيًا."
        else:
            msg = f"أُلغي {res['cancelled']} سند (يبقى في السجل باسم ملغى)."
        if res["errors"]:
            msg += "  ⚠ " + " | ".join(
                f"#{e['id']}: {e['msg'].splitlines()[0]}"
                for e in res["errors"])
        self._note(msg, bool(res["errors"]))
        self._after()

    def _del_record(self):
        ov = sds.overview(self.sub_id)
        if not ov.get("subcontractor"):
            self._note("المقاول غير موجود.", True)
            return
        if not ov["can_delete_record"]:
            self._note(ov["record_block"], True)
            return
        if not self.r_ack.isChecked():
            self._note("علّم مربع الإقرار بحذف السجل نهائيًا.", True)
            return
        name = ov["subcontractor"].get("name", "")
        if not style.confirm(
                self,
                f"حذف سجل المقاول «{name}» نهائيًا؟\n\n"
                "الاسم والهاتف والنشاط فقط — لا عقود ولا سندات متبقية.\n"
                "هذا الحذف لا يُستعاد (تُحفظ لقطة في سجل التدقيق).",
                "تأكيد حذف سجل المقاول"):
            return
        try:
            sds.delete_record(self.sub_id, self.reason.text())
        except ValidationError as exc:
            self._note(str(exc), True)
            return
        self._note(f"حُذف سجل المقاول «{name}».")
        self._after()

    def _after(self):
        self._reload()
        if callable(self.on_done):
            try:
                self.on_done()
            except Exception:
                pass
