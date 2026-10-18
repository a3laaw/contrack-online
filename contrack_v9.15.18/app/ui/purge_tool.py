# -*- coding: utf-8 -*-
"""أداة تنظيف البيانات — نافذة المطور.

تعرض ما سيُحذف بالضبط **قبل** الحذف، وتطلب سببًا مكتوبًا وتأكيدًا
صريحًا، ثم تحفظ لقطة كاملة في سجل التدقيق.

لا تحتوي هذه النافذة أي منطق حذف — كل العمليات تمر عبر
``services.purge_service`` الذي يرفض أي مستخدم غير المطور.
"""
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QDialog, QHBoxLayout, QHeaderView, QLabel,
    QLineEdit, QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout,
)

from services import purge_service as pg
from services.customer_service import ValidationError
from ui import style


KIND_LABEL = {"customer": "عميل", "contract": "عقد", "voucher": "سند",
              "subcontractor": "مقاول باطن", "sub_contract": "عقد باطن",
              "claim": "مطالبة مالية"}


class PurgeDialog(QDialog):
    """اختيار سجل وحذفه نهائيًا بعد معاينة وتأكيد."""

    def __init__(self, parent=None, kind: str = "customer",
                 preset_id: int | None = None):
        super().__init__(parent)
        self.kind = kind if kind in KIND_LABEL else "customer"
        style.ensure_light_background(self)
        self.setWindowTitle(f"تنظيف البيانات — حذف {KIND_LABEL[self.kind]}")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 1000, 640, min_w=760, min_h=480)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 16, 20, 16)
        lay.setSpacing(12)

        title = QLabel(f"🧹 حذف {KIND_LABEL[self.kind]} نهائيًا")
        title.setProperty("pageTitle", True)
        lay.addWidget(title)

        warn = QLabel(
            "الحذف <b>نهائي</b> ولا يُستعاد تلقائيًا. تُحفظ لقطة كاملة في "
            "سجل التدقيق.<br><b>تأكد أنك أخذت نسخة احتياطية.</b>")
        warn.setWordWrap(True)
        warn.setStyleSheet(
            "background: rgba(239,68,68,0.10); color: #991B1B;"
            " border: 1.5px solid rgba(239,68,68,0.45);"
            " border-radius: 10px; padding: 9px 13px;")
        lay.addWidget(warn)

        srow = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("ابحث بالاسم أو الرقم…")
        self.search.textChanged.connect(self._reload)
        srow.addWidget(QLabel("بحث"))
        srow.addWidget(self.search, 1)
        lay.addLayout(srow)

        self.table = QTableWidget(0, 1)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        if self.kind == "voucher":
            self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        else:
            self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        # للمطالبات: اختيار العقد (ليس المطالبة نفسها)
        if self.kind == "claim":
            self.search.setPlaceholderText("ابحث برقم العقد أو العنوان…")
        self.table.verticalHeader().setVisible(False)
        self.table.itemSelectionChanged.connect(self._preview)
        lay.addWidget(self.table, 1)

        self.preview_lbl = QLabel("اختر سجلاً لعرض ما سيُحذف معه.")
        self.preview_lbl.setWordWrap(True)
        self.preview_lbl.setStyleSheet(
            "background: rgba(245,158,11,0.10); border-radius: 8px;"
            " padding: 9px 13px; font-weight: 600;")
        lay.addWidget(self.preview_lbl)

        self.cascade = QCheckBox(
            {"customer": "احذف عقوده وسنداته أيضًا",
             "sub_contract": "احذف سندات الصرف أيضًا",
             "claim": "احذف كل المطالبات (وليس المسجلة فقط)"}
            .get(self.kind, "احذف سندات هذا العقد أيضًا"))
        if self.kind in ("voucher", "subcontractor"):
            self.cascade.setVisible(False)
        if self.kind in ("claim", "sub_contract"):
            self.cascade.toggled.connect(lambda *_: self._preview())
        lay.addWidget(self.cascade)
        # V5.8: للمقاول خياران منفصلان — عقود الباطن وحدها، أو السندات وحدها
        self.cascade_v = None
        self.cascade_c = None
        if self.kind == "subcontractor":
            self.cascade_c = QCheckBox("احذف عقود الباطن أيضًا (مفعّل افتراضيًا)")
            self.cascade_c.setChecked(True)
            self.cascade_v = QCheckBox("احذف السندات أيضًا (مفعّل افتراضيًا)")
            self.cascade_v.setChecked(True)
            lay.addWidget(self.cascade_c)
            lay.addWidget(self.cascade_v)
            self.cascade_c.toggled.connect(lambda *_: self._preview())
            self.cascade_v.toggled.connect(lambda *_: self._preview())

        rrow = QHBoxLayout()
        self.reason = QLineEdit()
        self.reason.setPlaceholderText(
            "سبب الحذف (إلزامي) — مثال: بيانات تجريبية من الاستيراد")
        rrow.addWidget(QLabel("السبب"))
        rrow.addWidget(self.reason, 1)
        lay.addLayout(rrow)

        brow = QHBoxLayout()
        self.del_btn = QPushButton("🗑 حذف نهائي")
        self.del_btn.setProperty("danger", True)
        self.del_btn.clicked.connect(self._do_delete)
        close = QPushButton("✕ إغلاق")
        close.setProperty("flat", True)
        close.clicked.connect(self.reject)
        brow.addWidget(self.del_btn)
        brow.addStretch()
        brow.addWidget(close)
        lay.addLayout(brow)

        self._reload()
        if preset_id:
            self._preselect(int(preset_id))
        style.guard_table_sections(self)

    # ---------- تحميل القائمة ----------
    def _reload(self):
        if self.kind == "customer":
            heads = ["#", "الكود", "اسم العميل", "الهاتف"]
            fields = ["id", "customer_code", "name", "phone"]
        elif self.kind == "contract":
            heads = ["#", "رقم العقد", "الوصف", "العميل", "القيمة"]
            fields = ["id", "contract_number", "description", "customer", "amount"]
        elif self.kind == "subcontractor":
            heads = ["#", "الكود", "اسم المقاول", "الهاتف"]
            fields = ["id", "sub_code", "name", "phone"]
        elif self.kind == "sub_contract":
            heads = ["#", "المقاول", "العقد", "القيمة", "الحالة"]
            fields = ["id", "sub_name", "contract_number", "amount", "status"]
        elif self.kind == "claim":
            heads = ["#", "رقم العقد", "عدد المطالبات", "المسجلة", "الإجمالي"]
            fields = ["id", "contract_number", "claims_count", "reg_count",
                      "total_amount"]
        else:
            heads = ["#", "رقم السند", "النوع", "التاريخ", "الطرف", "المبلغ", "ملغى"]
            fields = ["id", "voucher_number", "vtype", "vdate", "party", "amount", "cancelled"]

        rows = pg.list_entities(self.kind, self.search.text(), limit=500)

        self.table.clear()
        self.table.setColumnCount(len(heads))
        self.table.setHorizontalHeaderLabels(heads)
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            for j, field in enumerate(fields):
                val = r.get(field) if isinstance(r, dict) else r[j]
                if heads[j] == "ملغى":
                    val = "ملغى" if val else ""
                elif heads[j] in ("المبلغ", "القيمة", "الإجمالي"):
                    val = f"{float(val or 0):,.3f}"
                elif heads[j] in ("عدد المطالبات", "المسجلة"):
                    val = str(int(val or 0))
                elif heads[j] == "النوع":
                    val = {"receipt": "قبض", "payment": "صرف",
                           "transfer": "تحويل"}.get(str(val), str(val))
                item = QTableWidgetItem("" if val is None else str(val))
                item.setTextAlignment(Qt.AlignCenter)
                self.table.setItem(i, j, item)
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(2, QHeaderView.Stretch)
        self.table.setColumnHidden(0, True)
        self.preview_lbl.setText("اختر سجلاً لعرض ما سيُحذف معه.")

    def _preselect(self, preset_id: int):
        """V5.5: يفتح الأداة والمقاول محدد جاهز (من شاشة المقاولين)."""
        self.search.blockSignals(True)
        self.search.setText("")
        self.search.blockSignals(False)
        self._reload()
        for r in range(self.table.rowCount()):
            it = self.table.item(r, 0)
            if it is not None and it.text() == str(preset_id):
                self.table.setCurrentCell(r, 0)
                self._preview()
                return

    def _selected_ids(self) -> list[int]:
        rows = {i.row() for i in self.table.selectedIndexes()}
        out = []
        for r in sorted(rows):
            it = self.table.item(r, 0)
            if it and it.text().isdigit():
                out.append(int(it.text()))
        return out

    # ---------- المعاينة ----------
    def _preview(self):
        ids = self._selected_ids()
        if not ids:
            self.preview_lbl.setText("اختر سجلاً لعرض ما سيُحذف معه.")
            return
        try:
            if self.kind == "voucher":
                rows = pg.preview_vouchers(ids)
                total = sum(float(r.get("amount") or 0) for r in rows)
                self.preview_lbl.setText(
                    f"سيُحذف <b>{len(rows)}</b> سند · إجمالي المبالغ "
                    f"<b>{total:,.3f}</b><br>"
                    "تُحذف معها قيودها المحاسبية، ويُفكّ ارتباطها بخطة "
                    "السداد بلا حذف أي دفعة.")
                return
            cid = ids[0]
            if self.kind == "claim":
                data = pg.preview_claims_for_contract(cid)
                if not data or not data.get("claims"):
                    self.preview_lbl.setText("لا توجد مطالبات لهذا العقد.")
                    return
                reg = data.get("registered") or []
                other = data.get("other") or []
                total = data.get("total") or 0
                all_mode = self.cascade.isChecked()
                if all_mode:
                    del_count = len(reg) + len(other)
                    self.preview_lbl.setText(
                        f"العقد عليه <b>{data['count']}</b> مطالبة · "
                        f"إجمالي <b>{total:,.3f}</b><br>"
                        f"⚠ <b>سيُحذف كل المطالبات ({del_count})</b> — "
                        "المسجلة والمرحّلة معًا.")
                else:
                    self.preview_lbl.setText(
                        f"العقد عليه <b>{data['count']}</b> مطالبة · "
                        f"إجمالي <b>{total:,.3f}</b><br>"
                        f"• مسجلة (تحذف): <b>{len(reg)}</b><br>"
                        f"• مرحّلة (تبقى): <b>{len(other)}</b>")
                return
            if self.kind == "sub_contract":
                data = pg.preview_sub_contract(cid)
                if not data:
                    self.preview_lbl.setText("السجل غير موجود.")
                    return
                kids = data.get("children") or {}
                sc = data.get("sub_contract") or {}
                parts = []
                for k, n in kids.items():
                    label = {"sub_contract_items": "بند", "sub_payment_plan": "دفعة",
                             "sub_payment_sources": "مصدر", "claims": "مطالبة",
                             "vouchers": "سند"}.get(k, k)
                    parts.append(f"<b>{n}</b> {label}")
                body = " · ".join(parts) if parts else "لا شيء"
                extra = ""
                if data.get("vouchers_total"):
                    extra = (f"<br>⚠ سندات صرف بمبلغ "
                             f"<b>{data['vouchers_total']:,.3f}</b>")
                self.preview_lbl.setText(
                    f"عقد باطن «{sc.get('sub_name','')}» — "
                    f"{sc.get('contract_number','')}<br>"
                    f"سيُحذف: {body}{extra}")
                return
            data = (pg.preview_customer(cid) if self.kind == "customer"
                    else (pg.preview_subcontractor(cid)
                          if self.kind == "subcontractor"
                          else pg.preview_contract(cid)))
            if not data:
                self.preview_lbl.setText("السجل غير موجود.")
                return
            if self.kind == "subcontractor":
                kids0 = data.get("children") or {}
                _tot = float(data.get("vouchers_total") or 0)
                _act = int(data.get("vouchers_active") or 0)
                _can = int(data.get("vouchers_cancelled") or 0)
                self.preview_lbl.setText(
                    "سيُحذف مع المقاول: "
                    f"<b>{kids0.get('sub_contracts', 0)}</b> عقد باطن · "
                    f"<b>{kids0.get('sub_contract_items', 0)}</b> بند مرتبط · "
                    f"<b>{kids0.get('sub_payment_plan', 0)}</b> دفعة خطة · "
                    f"<b>{kids0.get('claims', 0)}</b> مطالبة · "
                    f"<b>{kids0.get('vouchers', 0)}</b> سند"
                    + (f" (فعّال {_act} · ملغى {_can} · بمبلغ {_tot:,.3f})"
                       if kids0.get("vouchers") else "")
                    + "<br>بنود عقد العميل نفسها <b>لا تُحذف</b> — يُحذف "
                    "ارتباطها بالمقاول فقط.")
                return
            kids = data.get("children") or {}
            names = {
                "contracts": "عقد", "vouchers": "سند", "invoices": "فاتورة",
                "payment_plan": "دفعة في خطة السداد",
                "contract_stages": "مرحلة", "addendums": "ملحق",
                "quotations": "عرض سعر", "projects": "مشروع",
                "visits": "زيارة", "sub_contracts": "عقد باطن",
                "boq_items": "بند كميات", "contract_events": "حدث",
                "contract_attachments": "مرفق",
                "contract_groups": "مجموعة عقود",
                "contract_group_items": "عنصر مجموعة",
                "claims": "مطالبة", "contract_scope": "نطاق مختار",
                "contract_components": "مكوّن شامل",
                "sub_contract_items": "بند مرتبط بمقاول",
                "sub_payment_plan": "دفعة عقد باطن",
                "sub_payment_sources": "مصدر دفعة باطن",
                "claims": "مطالبة", "expense_accounts": "حساب مصروف",
            }
            if kids:
                parts = [f"<b>{n}</b> {names.get(k, k)}"
                         for k, n in sorted(kids.items())]
                body = " · ".join(parts)
                extra = ""
                if kids.get("vouchers"):
                    extra = ("<br><span style='color:#991B1B'>⚠ يشمل حركة "
                             "مالية — فعّل الخيار أدناه صراحةً.</span>")
                keep = []
                if (getattr(self, "cascade_c", None) is not None
                        and not self.cascade_c.isChecked() and kids.get("sub_contracts")):
                    keep.append(f"{kids['sub_contracts']} عقد باطن")
                if (getattr(self, "cascade_v", None) is not None
                        and not self.cascade_v.isChecked() and kids.get("vouchers")):
                    keep.append(f"{kids['vouchers']} سند")
                if keep:
                    extra += ("<br><span style='color:#0F766E'>سيبقى بلا "
                              "حذف: " + " و ".join(keep) + ".</span>")
                self.preview_lbl.setText("سيُحذف معه: " + body + extra)
            else:
                self.preview_lbl.setText(
                    "لا توجد سجلات تابعة — الحذف آمن.")
        except Exception as exc:
            self.preview_lbl.setText(f"تعذرت المعاينة: {exc}")

    # ---------- التنفيذ ----------
    def _do_delete(self):
        ids = self._selected_ids()
        if not ids:
            style.error(self, "اختر سجلاً أولاً.")
            return
        reason = (self.reason.text() or "").strip()
        if not reason:
            style.error(self, "اكتب سبب الحذف — يُحفظ في سجل التدقيق.")
            return
        label = KIND_LABEL[self.kind]
        n = len(ids)
        if not style.confirm(
                self,
                f"سيتم حذف {n} {label} نهائيًا.\n\n"
                f"{self.preview_lbl.text()}\n\n"
                "هذا الحذف لا يُستعاد تلقائيًا.\n"
                "هل أخذت نسخة احتياطية؟ هل أنت متأكد؟",
                "تأكيد الحذف النهائي"):
            return
        # تأكيد ثانٍ عند وجود حركة مالية
        _money = (self.cascade.isChecked() if self.kind != "subcontractor"
                  else bool(self.cascade_v and self.cascade_v.isChecked()))
        if self.kind != "voucher" and _money:
            if not style.confirm(
                    self,
                    "تأكيد أخير: اخترت حذف السندات المرتبطة أيضًا.\n"
                    "ستُحذف حركة مالية نهائيًا من النظام.\n\n"
                    "هل تؤكد؟",
                    "تحذير: حذف حركة مالية"):
                return
        try:
            if self.kind == "voucher":
                res = pg.purge_vouchers(ids, reason)
                msg = f"تم حذف {res['deleted']} سند."
            elif self.kind == "contract":
                res = pg.purge_contract(ids[0], reason,
                                        delete_vouchers=self.cascade.isChecked())
                msg = ("تم حذف العقد"
                       + (f" و{res['vouchers']} سند." if res.get("vouchers")
                          else "."))
            elif self.kind == "subcontractor":
                res = pg.purge_subcontractor(
                    ids[0], reason,
                    delete_contracts=bool(self.cascade_c
                                          and self.cascade_c.isChecked()),
                    delete_vouchers=bool(self.cascade_v
                                         and self.cascade_v.isChecked()))
                msg = ("تم حذف المقاول"
                       + (f" و{res['contracts']} عقد باطن" if res.get("contracts")
                          else "")
                       + (f" و{res['vouchers']} سند." if res.get("vouchers")
                          else "."))
            elif self.kind == "sub_contract":
                res = pg.purge_sub_contract(
                    ids[0], reason,
                    delete_vouchers=self.cascade.isChecked())
                msg = ("حُذف عقد الباطن"
                       + (f" و{res['vouchers']} سند." if res.get("vouchers")
                          else "."))
            elif self.kind == "claim":
                reg_only = not (self.cascade.isChecked())
                res = pg.purge_claims(ids[0], reason,
                                      registered_only=reg_only)
                msg = f"حُذفت {res['deleted']} مطالبة."
            else:
                res = pg.purge_customer(ids[0], reason,
                                        delete_contracts=self.cascade.isChecked())
                msg = ("تم حذف العميل"
                       + (f" و{res['contracts']} عقد بكل تفاصيلها."
                          if res.get("contracts") else "."))
        except ValidationError as exc:
            style.error(self, str(exc))
            return
        except Exception as exc:
            style.error(self, f"تعذر الحذف: {exc}")
            return
        style.info(self, msg + "\n\nحُفظت لقطة كاملة في سجل الحذف.",
                   "تم التنظيف")
        self.reason.clear()
        self._reload()


class PurgeAuditDialog(QDialog):
    """سجل عمليات الحذف — من · متى · ماذا · لماذا."""

    def __init__(self, parent=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self.setWindowTitle("سجل الحذف")
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 1000, 600, min_w=720, min_h=420)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 16, 20, 16)
        lay.setSpacing(12)
        title = QLabel("📜 سجل عمليات الحذف")
        title.setProperty("pageTitle", True)
        lay.addWidget(title)
        hint = QLabel("كل عملية حذف محفوظة بلقطة كاملة للبيانات — "
                      "اضغط على السطر لعرض تفاصيل ما حُذف.")
        hint.setProperty("hint", True)
        lay.addWidget(hint)

        heads = ["#", "التاريخ", "بواسطة", "النوع", "الوصف", "السبب"]
        self.table = QTableWidget(0, len(heads))
        self.table.setHorizontalHeaderLabels(heads)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.verticalHeader().setVisible(False)
        self.table.cellDoubleClicked.connect(self._show_snapshot)
        lay.addWidget(self.table, 1)

        brow = QHBoxLayout()
        show = QPushButton("🔍 عرض تفاصيل المحذوف")
        show.clicked.connect(lambda: self._show_snapshot(
            self.table.currentRow(), 0))
        close = QPushButton("✕ إغلاق")
        close.setProperty("flat", True)
        close.clicked.connect(self.reject)
        brow.addWidget(show)
        brow.addStretch()
        brow.addWidget(close)
        lay.addLayout(brow)
        self._reload()
        style.guard_table_sections(self)

    def _reload(self):
        rows = pg.audit_log(500)
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            vals = [r["id"], r["purged_at"], r["purged_by"],
                    KIND_LABEL.get(r["entity"], r["entity"]),
                    r["label"], r["reason"]]
            for j, v in enumerate(vals):
                item = QTableWidgetItem("" if v is None else str(v))
                item.setTextAlignment(Qt.AlignCenter)
                item.setForeground(QColor("#991B1B") if j == 3 else
                                   QColor("#1F2937"))
                self.table.setItem(i, j, item)
        self.table.setColumnHidden(0, True)
        h = self.table.horizontalHeader()
        h.setSectionResizeMode(4, QHeaderView.Stretch)

    def _show_snapshot(self, row: int, _col: int = 0):
        if row is None or row < 0:
            style.info(self, "اختر سطرًا من السجل أولاً.")
            return
        it = self.table.item(row, 0)
        if not it:
            return
        snap = pg.audit_snapshot(int(it.text()))
        if not snap:
            style.info(self, "لا توجد تفاصيل محفوظة.", "السجل")
            return
        lines = []
        for table, items in snap.items():
            lines.append(f"• {table}: {len(items)} صف")
            for rec in items[:3]:
                bits = [f"{k}={v}" for k, v in list(rec.items())[:5]
                        if v not in (None, "", 0)]
                lines.append("    - " + " · ".join(bits))
            if len(items) > 3:
                lines.append(f"    … و{len(items) - 3} صفًا آخر")
        style.info(self, "\n".join(lines), "تفاصيل ما حُذف")
