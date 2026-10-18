# -*- coding: utf-8 -*-
"""مركز نماذج Word المبسط — بديل عملي لمسار PDF بالإحداثيات."""
import os
import re
import shutil
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QFrame, QGridLayout, QHBoxLayout, QHeaderView,
    QLabel, QLineEdit, QMenu, QPushButton, QScrollArea, QTableWidget,
    QTableWidgetItem, QTabWidget, QTextEdit, QVBoxLayout, QWidget, QInputDialog,
)

from services import word_forms_service as wfs
from services import form_service as fs
from services.search_utils import contains as search_contains
from services.customer_service import ValidationError
from services.db_facade_service import DatabaseError
from ui import style
from ui.widgets import make_searchable, SearchableComboBox


class FieldMapDialog(QDialog):
    """ربط حقل Word واحد بمصدر بيانات أو تركه يدويًا."""
    def __init__(self, parent, field: dict):
        super().__init__(parent)
        self.field = field
        self.setWindowTitle(f"ربط الحقل: {{{{{field.get('placeholder') or field.get('name')}}}}}")
        self.setLayoutDirection(Qt.RightToLeft)
        self.setMinimumWidth(460)
        form = QFormLayout(self)
        self.source_type = QComboBox()
        for key, label in fs.SOURCE_TYPES.items():
            self.source_type.addItem(label, key)
        self.entity = QComboBox()
        self.key = QComboBox()
        self.ftype = QComboBox()
        for key, label in fs.FIELD_TYPES.items():
            self.ftype.addItem(label, key)
        self.required = QComboBox()
        self.required.addItem("اختياري", 0); self.required.addItem("مطلوب", 1)
        make_searchable(self.source_type, "")
        make_searchable(self.entity, "")
        make_searchable(self.key, "")
        make_searchable(self.ftype, "")
        make_searchable(self.required, "")
        form.addRow("مصدر القيمة:", self.source_type)
        form.addRow("الجهة:", self.entity)
        form.addRow("الحقل:", self.key)
        form.addRow("نوع الإدخال:", self.ftype)
        form.addRow("الإلزام:", self.required)
        row = QHBoxLayout(); row.addStretch()
        ok = QPushButton("💾 حفظ الربط"); ok.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        row.addWidget(ok); row.addWidget(cancel); form.addRow(row)
        self.source_type.currentIndexChanged.connect(self._reload_entities)
        self.entity.currentIndexChanged.connect(self._reload_keys)
        self._load_current()
        ok.clicked.connect(self.accept); cancel.clicked.connect(self.reject)

    def _load_current(self):
        def select(combo, value):
            i = combo.findData(value)
            if i >= 0: combo.setCurrentIndex(i)
        select(self.source_type, self.field.get("source_type") or "manual")
        self._reload_entities()
        select(self.entity, self.field.get("source_entity") or "")
        self._reload_keys()
        select(self.key, self.field.get("source_key") or "")
        select(self.ftype, self.field.get("field_type") or "text")
        select(self.required, int(self.field.get("required") or 0))

    def _reload_entities(self):
        st = self.source_type.currentData()
        self.entity.clear()
        self.entity.addItem("—", "")
        if st == "system":
            for ent, data in fs.data_source_tree().items():
                if ent == "system":
                    continue
                self.entity.addItem(data["label"], ent)
        elif st == "auto":
            self.entity.addItem("قيم تلقائية", "system")
        self._reload_keys()

    def _reload_keys(self):
        ent = self.entity.currentData() or ""
        self.key.clear(); self.key.addItem("—", "")
        tree = fs.data_source_tree()
        if ent in tree:
            for key, label in tree[ent]["fields"].items():
                self.key.addItem(label, key)

    def values(self):
        ent = self.entity.currentData() or ""
        context = fs.data_source_tree().get(ent, {}).get("context", "")
        return {
            "source_type": self.source_type.currentData() or "manual",
            "source_entity": ent,
            "source_key": self.key.currentData() or "",
            "context": context,
            "field_type": self.ftype.currentData() or "text",
            "required": int(self.required.currentData() or 0),
        }


class WordFormFillDialog(QDialog):
    """تعبئة قالب Word من نفس المحرك الجديد بدون الاعتماد على form_filler القديم."""
    def __init__(self, template_id: int, parent=None,
                 customer_id: int | None = None,
                 contract_id: int | None = None):
        super().__init__(parent)
        from services import customer_service as cs, contract_service as ks
        self.template_id = int(template_id)
        self.setWindowTitle("تعبئة نموذج Word")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(820, 620)
        self._manual_inputs: dict[str, QLineEdit] = {}
        self._customers = cs.list_customers()
        self._contracts = []

        root = QVBoxLayout(self)
        tpl = fs.get_template(template_id)
        title = QLabel(tpl.get("base_name", "نموذج Word") if tpl else "نموذج Word")
        title.setProperty("sectionTitle", True)
        root.addWidget(title)
        hint = QLabel("القيم المرتبطة بالنظام تُملأ تلقائيًا، واكتب فقط الحقول اليدوية ثم اضغط توليد.")
        hint.setWordWrap(True); hint.setProperty("hint", True); root.addWidget(hint)

        form = QFormLayout(); form.setSpacing(10); form.setLabelAlignment(Qt.AlignRight)
        self.doc_title = QLineEdit((tpl or {}).get("base_name", "مستند Word"))
        form.addRow("اسم المستند", self.doc_title)
        self.output_format = QComboBox()
        self.output_format.addItem("Word (.docx)", "word")
        self.output_format.addItem("PDF (.pdf)", "pdf")
        self.output_format.addItem("Word + PDF", "both")
        make_searchable(self.output_format, "")
        form.addRow("صيغة التوليد", self.output_format)

        # إخفاء التذييل مؤقتًا — للطباعة على ورق يحمل تذييل الشركة مسبقًا.
        # يؤثر على المستند المولَّد فقط ولا يغيّر قالب Word الأصلي.
        self.hide_footer_chk = QCheckBox("إخفاء التذييل (الفوتر) في هذا المستند")
        self.hide_footer_chk.setToolTip(
            "يُفرّغ تذييل المستند المولَّد فقط · القالب الأصلي لا يتغيّر.\n"
            "مفيد عند الطباعة على ورق مطبوع عليه تذييل الشركة.")
        form.addRow("", self.hide_footer_chk)

        self.customer_cb = SearchableComboBox(
            search_only=True)
        self.customer_cb.addItem("— بدون عميل —", None)
        for c in self._customers:
            self.customer_cb.addItem(f"{c.name} · {c.customer_code}", c.id)
        form.addRow("العميل", self.customer_cb)

        self.contract_cb = QComboBox()
        make_searchable(self.contract_cb, "")
        form.addRow("العقد", self.contract_cb)
        self.customer_cb.currentIndexChanged.connect(self._reload_contracts)
        if customer_id:
            idx = self.customer_cb.findData(int(customer_id))
            if idx >= 0: self.customer_cb.setCurrentIndex(idx)
        self._reload_contracts()
        if contract_id:
            idx = self.contract_cb.findData(int(contract_id))
            if idx >= 0: self.contract_cb.setCurrentIndex(idx)

        fields = wfs.template_fields(template_id)
        self._fields = fields
        root.addLayout(form)

        manual = [f for f in fields if (f.get("source_type") or "manual") == "manual"]
        sub = QLabel("الحقول اليدوية")
        sub.setStyleSheet("font-weight: 800; padding-top: 8px;")
        root.addWidget(sub)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setObjectName("transparentHost")
        host = QWidget(); host.setObjectName("transparentHost")
        self.fields_form = QGridLayout(host)
        self.fields_form.setContentsMargins(4, 4, 4, 4)
        self.fields_form.setHorizontalSpacing(10)
        self.fields_form.setVerticalSpacing(8)
        if manual:
            for i, f in enumerate(manual):
                key = f.get("name") or f.get("placeholder") or str(f.get("id"))
                edit = QLineEdit()
                edit.setPlaceholderText(f"{{{{{f.get('placeholder') or key}}}}}")
                self._manual_inputs[key] = edit
                edit.textChanged.connect(self._update_calc_hint)
                label_txt = f.get("placeholder") or key
                if f.get("required"):
                    label_txt += " *"
                row_i = i // 2
                # نحافظ على ترتيب Word: الحقل الأول في يمين الصف والثاني في يساره.
                pair = 1 if i % 2 == 0 else 0
                self.fields_form.addWidget(QLabel(label_txt), row_i, pair * 2)
                self.fields_form.addWidget(edit, row_i, pair * 2 + 1)
        else:
            done = QLabel("لا توجد حقول يدوية — هذا القالب جاهز للتعبئة التلقائية.")
            done.setProperty("hint", True)
            self.fields_form.addWidget(done, 0, 0, 1, 4)
        scroll.setWidget(host)
        root.addWidget(scroll, 1)
        self.calc_hint = QLabel("")
        self.calc_hint.setWordWrap(True)
        self.calc_hint.setProperty("hint", True)
        root.addWidget(self.calc_hint)
        self._update_calc_hint()
        row = QHBoxLayout(); row.addStretch()
        gen = QPushButton("توليد Word/PDF")
        gen.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        row.addWidget(gen); row.addWidget(cancel); root.addLayout(row)
        gen.clicked.connect(self._generate)
        cancel.clicked.connect(self.reject)

    @staticmethod
    def _norm_calc_name(name: str) -> str:
        text = (name or "").strip().lower()
        text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
        text = text.replace("ة", "ه").replace("ى", "ي")
        return re.sub(r"[\s\-]+", "_", text).strip("_")

    @staticmethod
    def _amount_float(raw) -> float | None:
        if raw is None:
            return None
        txt = str(raw).strip().replace(",", "")
        txt = re.sub(r"[^0-9.\-]", "", txt)
        if not txt:
            return None
        try:
            return float(txt)
        except ValueError:
            return None

    def _contract_value_input(self) -> float | None:
        aliases = {"قيمه_العقد", "مبلغ_العقد", "اجمالي_العقد", "القيمه_الاجماليه"}
        for key, edit in self._manual_inputs.items():
            if self._norm_calc_name(key) in aliases:
                return self._amount_float(edit.text())
        return None

    def _payment_inputs_total(self) -> tuple[float, int]:
        total = 0.0
        count = 0
        for key, edit in self._manual_inputs.items():
            if re.match(r"^(?:ال)?دفعه_\d+_(?:قيمه|مبلغ)$", self._norm_calc_name(key)):
                val = self._amount_float(edit.text())
                if val is not None:
                    total += val
                    count += 1
        return round(total, 3), count

    def _update_calc_hint(self):
        lbl = getattr(self, "calc_hint", None)
        if lbl is None:
            return
        contract_value = self._contract_value_input()
        total, count = self._payment_inputs_total()
        if contract_value is None or count == 0:
            lbl.setText("")
            return
        diff = round(contract_value - total, 3)
        if abs(diff) <= 0.001:
            lbl.setText(
                f"✓ الحساب صحيح: قيمة العقد {contract_value:,.3f} = مجموع الدفعات {total:,.3f}")
            lbl.setStyleSheet("color: #047857; font-weight: 800; background: transparent; border: none;")
        else:
            lbl.setText(
                f"⚠ المتبقي/الفرق الاسترشادي: {diff:,.3f} — لن يتم تعبئة نموذج العقد إلا إذا تساوت قيمة العقد مع مجموع الدفعات.\n"
                f"قيمة العقد: {contract_value:,.3f} | مجموع الدفعات: {total:,.3f}")
            lbl.setStyleSheet("color: #B45309; font-weight: 800; background: transparent; border: none;")

    def _reload_contracts(self):
        from services import contract_service as ks
        cid = self.customer_cb.currentData() if hasattr(self, "customer_cb") else None
        self.contract_cb.clear()
        self.contract_cb.addItem("— بدون عقد —", None)
        try:
            contracts = ks.list_contracts(customer_id=cid) if cid else ks.list_contracts()
        except Exception:
            contracts = []
        for k in contracts:
            label = f"{k.contract_number} · {k.contract_name or k.description or k.customer_name}"
            self.contract_cb.addItem(label, k.id)

    def _generate(self):
        title = (self.doc_title.text() or "").strip() or "مستند Word"
        values = {key: edit.text() for key, edit in self._manual_inputs.items()}
        fields = wfs.template_fields(self.template_id)
        for f in fields:
            key = f.get("name") or f.get("placeholder")
            if f.get("required") and (f.get("source_type") or "manual") == "manual":
                if not (values.get(key) or "").strip():
                    style.error(self, f"الحقل مطلوب: {f.get('placeholder') or key}")
                    return
        try:
            res = wfs.create_word_document(
                self.template_id, title, values,
                self.customer_cb.currentData(), self.contract_cb.currentData(),
                output_format=self.output_format.currentData() or "word",
                hide_footer=bool(self.hide_footer_chk.isChecked()))
        except Exception as exc:
            style.error(self, str(exc))
            return
        msg = "تم توليد مستند Word."
        if self.hide_footer_chk.isChecked():
            msg += "\n(بلا تذييل — القالب الأصلي لم يتغيّر)"
        if res.get("word_path"):
            msg += f"\n{res['word_path']}"
        if res.get("archived_path"):
            msg += f"\n\nتم حفظ نسخة في ملف العميل."
        style.success(self, msg)
        try:
            from ui.invoices import open_file_externally
            open_file_externally(res.get("selected_path") or res.get("word_path"))
        except Exception:
            pass
        self.accept()


class OfficialTemplateFillDialog(QDialog):
    """شاشة تعبئة قوالب العقود/العروض الرسمية بنفس فكرة النماذج العامة.

    كل الحقول الموجودة داخل Word تظهر للمستخدم. القيم المعروفة تُملأ من
    العقد/عرض السعر المختار، لكن تبقى قابلة للتعديل لأن كل عقد قد يحتاج
    أسعارًا أو نصوصًا أو بنودًا خاصة.

    قوالب العقود: اختيار العميل (إلزامي) + العقد (اختياري).
    - مع عقد: تُحسب كل البيانات من العقد بما فيها الدفعات من خطة السداد.
    - بدون عقد (وضع حر): البيانات حرة، وقيمة العقد = مجموع الدفعات
      تلقائيًا (قابلة للتجاوز اليدوي)، والتفقيط يتبع القيمة الظاهرة.
    قوالب العروض: تبقى بسلوكها السابق دون تغيير.
    """

    # أسماء مُطبَّعة (بعد _norm_name) لخانات القيمة والتفقيط وربط المالك.
    _VALUE_ALIASES = frozenset({
        "قيمه_العقد", "مبلغ_العقد", "اجمالي_العقد", "القيمه_الاجماليه",
    })
    _WORDS_ALIASES = frozenset({
        "قيمه_العقد_كتابه", "مبلغ_العقد_كتابه",
        "قيمه_العقد_بالحروف", "مبلغ_العقد_بالحروف",
        "المبلغ_بالحروف", "المبلغ_كتابه", "التفقيط", "تفقيط_المبلغ",
    })
    _OWNER_ALIASES = {
        "اسم_المالك": "اسم_العميل", "المالك": "اسم_العميل",
        "هاتف_المالك": "هاتف_العميل", "تليفون_المالك": "هاتف_العميل",
        "عنوان_المالك": "عنوان_العميل",
        "رقم_القطعه": "القطعه", "رقم_القسيمه": "القسيمه",
    }
    _DATE_ALIASES = frozenset({"التاريخ", "تاريخ"})
    # ملاحظة: {{اليوم}} يبقى تاريخ اليوم (سلوك قديم موثق) · اسم اليوم له أسماء مستقلة.
    _DAY_ALIASES = frozenset({"يوم_الاسبوع", "اسم_اليوم"})

    def __init__(self, template: dict, parent=None,
                 customer_id: int | None = None,
                 source_id: int | None = None):
        super().__init__(parent)
        from services import word_service
        self.template = template
        self.customer_id = int(customer_id) if customer_id else None
        self.source_id = int(source_id) if source_id else None
        self.is_quote = (template.get("kind") == "quotation")
        self._inputs: dict[str, QLineEdit] = {}
        self.setWindowTitle("تعبئة بيانات النموذج المختار")
        self.setLayoutDirection(Qt.RightToLeft)
        self.resize(860, 620)

        root = QVBoxLayout(self)
        title = QLabel(template.get("name") or "نموذج")
        title.setProperty("sectionTitle", True)
        root.addWidget(title)
        hint = QLabel(
            "اختر العقد/عرض السعر لتعبئة القيم المتاحة تلقائيًا، ثم عدّل أي خانة حسب هذا النموذج قبل إخراج Word أو PDF."
            if self.is_quote else
            "اختر العميل (إلزامي) ثم العقد (اختياري): مع العقد تُحسب كل البيانات والدفعات من العقد، "
            "وبدون عقد تكون البيانات حرة وقيمة العقد = مجموع الدفعات تلقائيًا."
        )
        hint.setProperty("hint", True); hint.setWordWrap(True); root.addWidget(hint)

        form = QFormLayout(); form.setSpacing(8); form.setLabelAlignment(Qt.AlignRight)
        self.doc_title = QLineEdit(template.get("name") or "مستند")
        form.addRow("اسم المستند", self.doc_title)
        self.output_format = QComboBox()
        self.output_format.addItem("Word (.docx)", "word")
        self.output_format.addItem("PDF (.pdf)", "pdf")
        make_searchable(self.output_format, "")
        form.addRow("صيغة الإخراج", self.output_format)
        # حالة الحساب التلقائي (قوالب العقود فقط).
        self._auto_value: dict[str, str] = {}
        self._words_for_raw: str | None = None
        self._active_currency = ""
        if not self.is_quote:
            from services import customer_service as cs
            self.customer_cb = SearchableComboBox(
                search_only=True)
            self.customer_cb.addItem("— بدون عميل —", None)
            try:
                _customers = cs.list_customers()
            except Exception:
                _customers = []
            for c in _customers:
                self.customer_cb.addItem(f"{c.name} · {c.customer_code}", int(c.id))
            if self.customer_id:
                idx = self.customer_cb.findData(int(self.customer_id))
                if idx >= 0:
                    self.customer_cb.setCurrentIndex(idx)
                # مفتوح من ملف عميل: العميل ثابت على هذا الملف.
                self.customer_cb.setEnabled(False)
            form.addRow("العميل", self.customer_cb)
        self.source_cb = QComboBox()
        make_searchable(self.source_cb, "")
        self._load_sources()
        if self.source_id:
            idx = self.source_cb.findData(self.source_id)
            if idx >= 0:
                self.source_cb.setCurrentIndex(idx)
        if self.is_quote:
            self.source_cb.currentIndexChanged.connect(self._load_auto_values)
            form.addRow("العقد / عرض السعر", self.source_cb)
        else:
            self.customer_cb.currentIndexChanged.connect(self._on_customer_changed)
            self.source_cb.currentIndexChanged.connect(self._on_source_changed)
            form.addRow("العقد", self.source_cb)
            # عقد مُمرر مسبقًا مع عميل مختلف/فارغ: ضبط العميل على مالك العقد.
            self._sync_customer_from_contract()
        root.addLayout(form)

        try:
            field_defs = word_service.official_template_fields(template["path"])
            fields = [f.get("placeholder") or f.get("name") or "" for f in field_defs]
        except Exception as exc:
            field_defs = []
            fields = []
            style.error(self, f"تعذر قراءة حقول القالب:\n{exc}")
        self._field_defs = field_defs
        self._fields = fields
        scroll = QScrollArea(); scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame); scroll.setObjectName("transparentHost")
        host = QWidget(); host.setObjectName("transparentHost")
        self.fields_form = QGridLayout(host)
        self.fields_form.setContentsMargins(4, 4, 4, 4)
        self.fields_form.setHorizontalSpacing(10)
        self.fields_form.setVerticalSpacing(8)
        if fields:
            for i, name in enumerate(fields):
                edit = QLineEdit()
                edit.setPlaceholderText(f"{{{{{name}}}}}")
                if not self.is_quote and self._norm_name(name) in self._WORDS_ALIASES:
                    edit.setReadOnly(True)
                    edit.setToolTip("تُحسب تلقائيًا من خانة قيمة العقد")
                self._inputs[name] = edit
                if not self.is_quote:
                    edit.textChanged.connect(self._refresh_computed)
                row_i = i // 2
                # نفس ترتيب الحقول في Word: الأول يمين الصف، والثاني يساره.
                pair = 1 if i % 2 == 0 else 0
                self.fields_form.addWidget(QLabel(name), row_i, pair * 2)
                self.fields_form.addWidget(edit, row_i, pair * 2 + 1)
        else:
            self.fields_form.addWidget(QLabel("لا توجد حقول {{ }} داخل هذا القالب."), 0, 0, 1, 4)
        scroll.setWidget(host); root.addWidget(scroll, 1)
        if not self.is_quote:
            self.calc_hint = QLabel("")
            self.calc_hint.setWordWrap(True)
            self.calc_hint.setProperty("hint", True)
            root.addWidget(self.calc_hint)

        row = QHBoxLayout(); row.addStretch()
        cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True)
        gen = QPushButton("تعبئة وإخراج"); gen.setObjectName("btnPrimary")
        row.addWidget(cancel); row.addWidget(gen); root.addLayout(row)
        cancel.clicked.connect(self.reject); gen.clicked.connect(self._generate)
        self._load_auto_values()

    def _load_sources(self):
        self.source_cb.clear()
        if self.is_quote:
            from services import lifecycle_service as lc
            rows = lc.list_quotations()
            if self.customer_id:
                rows = [q for q in rows if int(q.get("customer_id") or 0) == self.customer_id]
            self._sources = rows
            for q in rows:
                self.source_cb.addItem(
                    f"{q.get('quote_number')} · {q.get('customer_name')} · {q.get('project_name') or ''}",
                    int(q.get("id")))
        else:
            from services import contract_service as ks
            cid = None
            cb = getattr(self, "customer_cb", None)
            if cb is not None:
                cid = cb.currentData()
            if cid is None and getattr(self, "customer_id", None):
                cid = int(self.customer_id)
            try:
                rows = ks.list_contracts(customer_id=cid) if cid else ks.list_contracts()
            except Exception:
                rows = []
            self._sources = rows
            self.source_cb.addItem("— بدون عقد —", None)
            for c in rows:
                self.source_cb.addItem(
                    f"{c.contract_number} · {c.customer_name} · {c.contract_name or c.description or ''}",
                    int(c.id))

    def _on_customer_changed(self):
        """تغيّر العميل: إعادة تحميل عقوده وإسقاط العقد إن كان لعميل آخر."""
        if self.is_quote:
            return
        keep = self.source_cb.currentData()
        self.source_cb.blockSignals(True)
        try:
            self._load_sources()
            if keep is not None:
                try:
                    ids = {int(c.id) for c in (self._sources or [])}
                except Exception:
                    ids = set()
                if int(keep) in ids:
                    idx = self.source_cb.findData(int(keep))
                    if idx >= 0:
                        self.source_cb.setCurrentIndex(idx)
        finally:
            self.source_cb.blockSignals(False)
        self._load_auto_values()

    def _on_source_changed(self):
        """تغيّر العقد: مزامنة العميل مع مالك العقد ثم إعادة التعبئة."""
        if self.is_quote:
            return
        self._sync_customer_from_contract()
        self._load_auto_values()

    def _sync_customer_from_contract(self):
        """اختيار عقد يضبط قائمة العميل على مالكه تلقائيًا (دون حلقة إشارات)."""
        cb = getattr(self, "customer_cb", None)
        if cb is None or not hasattr(self, "source_cb"):
            return
        obj_id = self.source_cb.currentData()
        if not obj_id:
            return
        owner = None
        for c in (getattr(self, "_sources", []) or []):
            try:
                if int(getattr(c, "id", 0) or 0) == int(obj_id):
                    owner = getattr(c, "customer_id", None)
                    break
            except (TypeError, ValueError):
                continue
        if owner:
            try:
                same = cb.currentData() is not None and int(cb.currentData()) == int(owner)
            except (TypeError, ValueError):
                same = False
            if not same:
                idx = cb.findData(int(owner))
                if idx >= 0:
                    cb.blockSignals(True)
                    try:
                        cb.setCurrentIndex(idx)
                    finally:
                        cb.blockSignals(False)

    @staticmethod
    def _norm_name(name: str) -> str:
        text = (name or "").strip().lower()
        text = re.sub(r"[\s\-]+", "_", text)
        text = (text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
                    .replace("ة", "ه").replace("ى", "ي"))
        return re.sub(r"_+", "_", text).strip("_")

    @staticmethod
    def _parse_value_text(raw) -> float | None:
        if raw is None:
            return None
        txt = str(raw).strip().replace(",", "")
        txt = re.sub(r"[^0-9.\-]", "", txt)
        if not txt:
            return None
        try:
            return float(txt)
        except ValueError:
            return None

    @staticmethod
    def _customer_base(customer_id: int | None) -> dict:
        """قيم العميل بصيغة مفاتيح العقد — للوضع الحر وربط المالك."""
        if not customer_id:
            return {}
        try:
            from services import customer_service as cs
            cust = cs.get_customer(int(customer_id))
        except Exception:
            cust = None
        if not cust:
            return {}
        g = lambda v: (v or "")
        return {
            "اسم_العميل": g(cust.name),
            "رقم_العميل": g(cust.customer_code),
            "هاتف_العميل": g(cust.phone),
            "عنوان_العميل": g(cust.address),
            "محافظة_العميل": g(cust.address_governorate),
            "منطقة_العميل": g(cust.address_area),
            "قطعة_العميل": g(cust.address_block),
            "قسيمة_العميل": g(cust.address_plot),
            "المحافظة": g(cust.address_governorate),
            "المنطقة": g(cust.address_area),
            "القطعة": g(cust.address_block),
            "القسيمة": g(cust.address_plot),
            "محافظة": g(cust.address_governorate),
            "منطقة": g(cust.address_area),
            "قطعة": g(cust.address_block),
            "قسيمة": g(cust.address_plot),
        }

    @classmethod
    def _fallback_value(cls, key: str, norm_base: dict) -> str:
        """ربط احتياطي لحقول المالك والدفعات العارية (دفعة_1..N) عند غياب الربط."""
        nk = cls._norm_name(key)
        if nk in norm_base:
            return str(norm_base.get(nk, "") or "")
        if nk in cls._OWNER_ALIASES:
            return str(norm_base.get(cls._OWNER_ALIASES[nk], "") or "")
        m = re.match(r"^(?:ال)?دفعه_(\d+)$", nk)
        if m:
            return str(norm_base.get(f"دفعه_{int(m.group(1))}_قيمه", "") or "")
        return ""

    def _display_value_text(self) -> str:
        for key, edit in self._inputs.items():
            if self._norm_name(key) in self._VALUE_ALIASES:
                return edit.text()
        return ""

    def _tafqeet(self, num: float) -> str:
        try:
            from services.tafqeet import amount_to_words
            return amount_to_words(float(num or 0), self._active_currency or "د.ك")
        except Exception:
            return f"{float(num or 0):,.3f} {self._active_currency or ''}".strip()

    def _load_auto_values(self):
        from services import word_service
        if self.is_quote:
            # مسار العروض كما هو دون أي تغيير.
            obj_id = self.source_cb.currentData()
            values = {}
            if obj_id:
                try:
                    values = word_service.quotation_field_values(int(obj_id))
                except Exception:
                    values = {}
            try:
                values = word_service.official_field_values(
                    self.template["path"], int(obj_id) if obj_id else None, is_quote=True)
            except Exception:
                pass
            for key, edit in self._inputs.items():
                edit.setText(str(values.get(key, "")))
            return
        # --- مسار العقود: عميل + عقد اختياري ---
        from datetime import date
        contract_id = self.source_cb.currentData()
        cb = getattr(self, "customer_cb", None)
        customer_id = cb.currentData() if cb is not None else None
        base: dict = {}
        if contract_id:
            try:
                base = word_service.contract_field_values(int(contract_id))
            except Exception:
                base = {}
        try:
            mapped = word_service.official_field_values(
                self.template["path"], int(contract_id) if contract_id else None,
                is_quote=False)
        except Exception:
            mapped = {}
        cust_base = self._customer_base(customer_id)
        norm_base: dict[str, str] = {}
        for src in (cust_base, base):
            for k, v in (src or {}).items():
                nk = self._norm_name(k)
                if nk and nk not in norm_base:
                    norm_base[nk] = v
        today = date.today().isoformat()
        try:
            from services.form_service import arabic_weekday as _ar_weekday
            weekday_name = _ar_weekday(date.today())
        except Exception:
            weekday_name = ""
        # الربط الاحتياطي: في الوضع الحر يُطبق على كل خانة فارغة (لا سياق
        # عقد تُحل منه الربوط)، ومع عقد يُحترم الربط الصريح غير اليدوي.
        try:
            _saved = (word_service._load_official_maps() or {}).get(
                word_service._official_map_key(self.template["path"]), {}) or {}
        except Exception:
            _saved = {}
        explicit_non_manual = {
            name for name, m in _saved.items()
            if isinstance(m, dict) and (m.get("source_type") or "manual") != "manual"
        }
        for key, edit in self._inputs.items():
            val = str(mapped.get(key, "") or "")
            if not val and (not contract_id or key not in explicit_non_manual):
                val = self._fallback_value(key, norm_base)
            if not val and self._norm_name(key) in self._DATE_ALIASES:
                val = today
            if not val and self._norm_name(key) in self._DAY_ALIASES:
                val = weekday_name
            edit.blockSignals(True)
            try:
                edit.setText(val)
            finally:
                edit.blockSignals(False)
        # العملة النشطة للتفقيط: عملة العقد ثم عملة الإعدادات.
        cur = str((base or {}).get("العملة", "") or "")
        if not cur:
            try:
                from services import settings_service
                cur = settings_service.get_settings().currency or "د.ك"
            except Exception:
                cur = "د.ك"
        self._active_currency = cur
        # لقطة القيم المعبأة حتى نحترم تجاوز المستخدم اليدوي لاحقًا.
        self._auto_value = {}
        for key, edit in self._inputs.items():
            if self._norm_name(key) in self._VALUE_ALIASES:
                self._auto_value[key] = edit.text()
        self._words_for_raw = self._display_value_text()
        self._refresh_computed()

    def _refresh_computed(self):
        """تحديث لحظي (عقود فقط): القيمة = مجموع الدفعات دائمًا (حتى مع
        عقد مختار)، والتفقيط يتبع القيمة الظاهرة دائمًا. التجاوز اليدوي
        لقيمة العقد يُحترم حتى يمسح المستخدم الخانة فيستأنف الحساب التلقائي."""
        if self.is_quote:
            return
        total = 0.0
        count = 0
        for key, edit in self._inputs.items():
            if re.match(r"^(?:ال)?دفعه_(\d+)$", self._norm_name(key)):
                val = self._parse_value_text(edit.text())
                if val is not None:
                    total += val
                    count += 1
        total = round(total, 3)
        # 1) خانات القيمة: دائمًا = مجموع الدفعات المعبأة في النموذج
        # (حتى مع عقد مختار) ما لم يتجاوزها المستخدم يدويًا.
        candidate = f"{total:,.3f}" if count else ""
        for key, edit in self._inputs.items():
            if self._norm_name(key) not in self._VALUE_ALIASES:
                continue
            last = self._auto_value.get(key)
            if edit.text() == "" or (last is not None and edit.text() == last):
                if edit.text() != candidate:
                    edit.blockSignals(True)
                    try:
                        edit.setText(candidate)
                    finally:
                        edit.blockSignals(False)
                self._auto_value[key] = candidate
        # 2) التفقيط يتبع القيمة الظاهرة.
        current_text = self._display_value_text()
        if current_text != (self._words_for_raw or ""):
            num = self._parse_value_text(current_text)
            words = self._tafqeet(num) if num is not None else ""
            for key, edit in self._inputs.items():
                if self._norm_name(key) in self._WORDS_ALIASES:
                    edit.blockSignals(True)
                    try:
                        edit.setText(words)
                    finally:
                        edit.blockSignals(False)
            self._words_for_raw = current_text
        self._update_calc_hint(total, count)

    def _update_calc_hint(self, total: float = 0.0, count: int = 0):
        lbl = getattr(self, "calc_hint", None)
        if lbl is None:
            return
        has_calc = any(
            self._norm_name(k) in self._VALUE_ALIASES
            or re.match(r"^(?:ال)?دفعه_(\d+)$", self._norm_name(k))
            for k in self._inputs)
        if not has_calc:
            lbl.setText("")
            return
        green = "color: #047857; font-weight: 800; background: transparent; border: none;"
        amber = "color: #B45309; font-weight: 800; background: transparent; border: none;"
        gray = "color: #4B5563; font-weight: 700; background: transparent; border: none;"
        diverged = False
        for key, edit in self._inputs.items():
            if self._norm_name(key) in self._VALUE_ALIASES:
                last = self._auto_value.get(key)
                if edit.text().strip() and edit.text() != (last if last is not None else ""):
                    diverged = True
                    break
        if diverged:
            lbl.setStyleSheet(amber)
            lbl.setText(
                f"مجموع الدفعات: {total:,.3f} (الخانات المعبأة: {count}) — "
                "قيمة العقد مدخلة يدويًا (امسحها لاستئناف الحساب التلقائي).")
        else:
            lbl.setStyleSheet(green if count else gray)
            lbl.setText(
                f"مجموع الدفعات: {total:,.3f} (الخانات المعبأة: {count}) — "
                "تُحسب قيمة العقد تلقائيًا من المجموع.")

    def _safe_name(self) -> str:
        raw = (self.doc_title.text() or self.template.get("name") or "document").strip()
        return "".join(ch for ch in raw if ch not in '\\/:*?"<>|')[:60] or "document"

    def _generate(self):
        from services import word_service
        if not self.is_quote and hasattr(self, "customer_cb"):
            if not self.customer_cb.currentData():
                style.error(self, "اختر العميل أولًا (العقد اختياري، ويمكن التعبئة الحرة بدونه).")
                return
        if not self._fields:
            style.info(self, "القالب لا يحتوي حقولًا للتعبئة، سيتم حفظ نسخة كما هي.")
        default = os.path.join(os.path.expanduser("~"), self._safe_name() + ".docx")
        filt = "Word (*.docx);;PDF (*.pdf)"
        path, selected_filter = QFileDialog.getSaveFileName(self, "حفظ النموذج", default, filt)
        if not path:
            return
        wants_pdf = "PDF" in (selected_filter or "") or path.lower().endswith(".pdf")
        values = {k: e.text() for k, e in self._inputs.items()}
        try:
            if wants_pdf:
                if not path.lower().endswith(".pdf"):
                    path += ".pdf"
                import tempfile
                tmp = os.path.join(tempfile.gettempdir(), f"official_manual_{os.getpid()}.docx")
                word_service.fill_template_with_values(self.template["path"], values, tmp, letterhead=True)
                word_service.word_to_pdf(tmp, path)
            else:
                if not path.lower().endswith(".docx"):
                    path += ".docx"
                word_service.fill_template_with_values(self.template["path"], values, path, letterhead=True)
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.success(self, f"تم تجهيز النموذج:\n{path}")
        try:
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            pass
        self.accept()


class WordFormsCenterPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        self.setLayoutDirection(Qt.RightToLeft)
        outer = QVBoxLayout(self); outer.setContentsMargins(16,10,16,8); outer.setSpacing(10)
        top = QHBoxLayout()
        self.title_lbl = QLabel("مركز النماذج"); self.title_lbl.setProperty("pageTitle", True)
        self.desc_lbl = QLabel("النماذج الرسمية والعامة · توليد Word/PDF من مكان واحد.")
        self.desc_lbl.setProperty("pageDesc", True)
        tcol = QVBoxLayout(); tcol.addWidget(self.title_lbl); tcol.addWidget(self.desc_lbl); top.addLayout(tcol); top.addStretch()
        outer.addLayout(top)

        self.tabs = QTabWidget()
        self.tabs.setLayoutDirection(Qt.RightToLeft)
        outer.addWidget(self.tabs, 1)

        # ===== تبويب العقود وعروض الأسعار الرسمي =====
        official = QWidget(); official.setObjectName("transparentHost")
        official_l = QVBoxLayout(official); official_l.setContentsMargins(4, 6, 4, 4); official_l.setSpacing(7)
        from ui.widgets import flow_host
        row_host, row = flow_host(spacing=7)
        self.official_search = QLineEdit()
        self.official_search.setPlaceholderText("بحث باسم النموذج...")
        self.official_search.textChanged.connect(self.refresh_official)
        from services import feature_service as _feat13wf2
        _wf13on2 = _feat13wf2.enabled("word_forms")
        official_upload = QPushButton("رفع Word")
        official_upload.setProperty("flat", True)  # ثانوي: الرئيسي «تعبئة» (§5)
        official_upload.setToolTip("رفع قالب Word رسمي للعقود أو عروض الأسعار")
        official_upload.clicked.connect(self._official_upload)
        official_batch = QPushButton("📥 استيراد مجلد")
        official_batch.setProperty("flat", True)
        official_batch.setToolTip("استيراد كل ملفات Word من مجلد كقوالب رسمية حسب النوع المحدد")
        official_batch.clicked.connect(self._official_import_folder)
        if not _wf13on2:      # V4.5.13: الإخفاء بعد الأب (قاعدة 53)
            official_upload.setVisible(False)
            official_batch.setVisible(False)
        self.official_kind = QComboBox()
        self.official_kind.addItem("العقود", "contract")
        self.official_kind.addItem("عروض الأسعار", "quotation")
        make_searchable(self.official_kind, "")
        self.official_kind.currentIndexChanged.connect(self.refresh_official)
        row.addWidget(self.official_search)
        row.addWidget(official_upload)
        row.addWidget(official_batch)
        row.addWidget(QLabel("النوع:")); row.addWidget(self.official_kind)
        official_l.addWidget(row_host)
        self.official_table = QTableWidget(0, 4)
        self.official_table.setHorizontalHeaderLabels(["النوع", "النموذج", "النطاق", "المسار"])
        self.official_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.official_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        self.official_table.verticalHeader().setVisible(False)
        self.official_table.setAlternatingRowColors(True)
        self.official_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.official_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.official_table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.official_table.customContextMenuRequested.connect(self._official_menu)
        self.official_table.itemDoubleClicked.connect(lambda *_: self._official_generate())
        official_l.addWidget(self.official_table, 1)
        note = QLabel("الهيدر والفوتر من إعدادات النظام يطبقان تلقائيًا على العقود وعروض الأسعار عند التوليد.")
        note.setProperty("hint", True); note.setWordWrap(True); official_l.addWidget(note)
        official_bottom_host, official_bottom = flow_host(spacing=7)
        fill = QPushButton("تعبئة"); fill.setObjectName("btnPrimary"); fill.setToolTip("فتح شاشة إدخال بيانات النموذج المختار؛ القيم التلقائية تظهر ويمكن تعديلها قبل إخراج Word/PDF"); fill.clicked.connect(self._official_generate)
        fields = QPushButton("ربط الحقول"); fields.setToolTip("عرض الحقول الموجودة في قالب العقد ومدى دعمها التلقائي"); fields.clicked.connect(self._official_show_fields)
        edit = QPushButton("✎ تعديل البيانات"); edit.setToolTip("تعديل اسم القالب الرسمي أو رفع/استبدال القالب من قائمة الزر الأيمن"); edit.clicked.connect(self._official_edit_template)
        archive = QPushButton("أرشفة/استعادة"); archive.setProperty("flat", True); archive.setToolTip("أرشفة القالب المحدد أو استعادته"); archive.clicked.connect(self._official_archive_menu)
        delete = QPushButton("🗑 حذف"); delete.setObjectName("btnDangerSoft"); delete.setToolTip("حذف القالب الرسمي المحدد"); delete.clicked.connect(self._official_delete)
        official_bottom.addWidget(fill); official_bottom.addWidget(fields); official_bottom.addWidget(edit); official_bottom.addWidget(archive); official_bottom.addWidget(delete)
        official_l.addWidget(official_bottom_host)
        self.tabs.addTab(official, "العقود وعروض الأسعار")

        # ===== تبويب باقي النماذج العامة =====
        general = QWidget(); general.setObjectName("transparentHost")
        general_l = QVBoxLayout(general); general_l.setContentsMargins(4, 6, 4, 4); general_l.setSpacing(7)
        gtop_host, gtop = flow_host(spacing=7)
        self.search = QLineEdit(); self.search.setPlaceholderText("بحث باسم النموذج..."); self.search.textChanged.connect(self.refresh); gtop.addWidget(self.search)
        add = QPushButton("رفع Word"); add.setProperty("flat", True); add.setToolTip("رفع قالب Word عام جديد"); add.clicked.connect(self._import_word); gtop.addWidget(add)
        from services import feature_service as _feat13wf
        _wf13on = _feat13wf.enabled("word_forms")   # V4.5.13: ربط فعلي
        add.setVisible(_wf13on)
        batch = QPushButton("📥 استيراد مجلد"); batch.setProperty("flat", True); batch.setToolTip("استيراد كل ملفات Word من مجلد كقوالب عامة"); batch.clicked.connect(self._import_folder); gtop.addWidget(batch)
        batch.setVisible(_wf13on)
        general_l.addWidget(gtop_host)
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["النموذج", "الإصدار", "الحالة", "الحقول", "آخر تعديل", "مسار Word"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False); self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows); self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._templates_menu)
        self.table.itemDoubleClicked.connect(lambda *_: self._edit_template())
        general_l.addWidget(self.table, 1)
        bottom_host, bottom = flow_host(spacing=7)
        fill = QPushButton("تعبئة"); fill.setObjectName("btnPrimary"); fill.setToolTip("تعبئة النموذج المحدد"); fill.clicked.connect(self._fill_selected)
        fields = QPushButton("ربط الحقول"); fields.setToolTip("عرض حقول القالب ومدى دعمها التلقائي"); fields.clicked.connect(self._show_fields)
        edit = QPushButton("✎ تعديل البيانات"); edit.setToolTip("تعديل اسم القالب وبياناته الخارجية"); edit.clicked.connect(self._edit_template)
        archive = QPushButton("أرشفة/استعادة"); archive.setProperty("flat", True); archive.setToolTip("أرشفة النموذج المحدد أو استعادته"); archive.clicked.connect(self._toggle_archive)
        delete2 = QPushButton("🗑 حذف"); delete2.setObjectName("btnDangerSoft"); delete2.setToolTip("حذف النموذج"); delete2.clicked.connect(self._delete_template)
        bottom.addWidget(fill); bottom.addWidget(fields); bottom.addWidget(edit); bottom.addWidget(archive); bottom.addWidget(delete2); general_l.addWidget(bottom_host)
        self.tabs.addTab(general, "باقي النماذج")
        self.refresh_official()
        self.refresh()

    def refresh_official(self):
        """قوالب العقود وعروض الأسعار الرسمية من مكان واحد."""
        from services import word_service
        kind = self.official_kind.currentData() if hasattr(self, "official_kind") else "contract"
        q = (self.official_search.text() if hasattr(self, "official_search") else "").strip()
        all_tpl = word_service.list_templates()
        rows = []
        for t in all_tpl:
            k = t.get("kind") or ""
            if q and not search_contains(str(t.get("name", "")) + " " + str(t.get("path", "")), q):
                continue
            if kind == "quotation":
                if k == "quotation":
                    rows.append({**t, "type_label": "عرض سعر", "scope": "عام"})
            else:
                if k == "contract" or k.startswith("contract-"):
                    scope = "عام" if k == "contract" else "نوع عقد"
                    rows.append({**t, "type_label": "عقد", "scope": scope})
        self._official_rows = rows
        self.official_table.setRowCount(len(rows))
        for r, t in enumerate(rows):
            vals = [t.get("type_label", ""), t.get("name", ""),
                    t.get("scope", ""), t.get("path", "")]
            for c, v in enumerate(vals):
                self.official_table.setItem(r, c, QTableWidgetItem(str(v or "")))
        if rows and self.official_table.currentRow() < 0:
            self.official_table.setCurrentCell(0, 0)
            self.official_table.selectRow(0)

    def _official_selected(self):
        row = self.official_table.currentRow()
        rows = getattr(self, "_official_rows", [])
        if row < 0 or row >= len(rows):
            style.info(self, "اختر قالبًا من تبويب العقود وعروض الأسعار أولاً.")
            return None
        return rows[row]

    def _official_menu(self, pos):
        row = self.official_table.rowAt(pos.y())
        if row >= 0:
            self.official_table.setCurrentCell(row, 0)
        menu = QMenu(self)
        act_gen = menu.addAction("تعبئة / توليد Word-PDF")
        act_fields = menu.addAction("ربط الحقول / عرض الحقول")
        act_edit = menu.addAction("تعديل البيانات")
        menu.addSeparator()
        act_upload = menu.addAction("رفع Word")
        act_batch = menu.addAction("استيراد مجلد")
        act_sample = menu.addAction("إنشاء قالب نموذجي")
        act_archive = menu.addAction("أرشفة/استعادة")
        act_delete = menu.addAction("حذف القالب")
        _rows = getattr(self, "_official_rows", [])
        _sel_ok = 0 <= self.official_table.currentRow() < len(_rows)
        for act in (act_gen, act_fields, act_edit, act_delete):
            act.setEnabled(_sel_ok)
        chosen = menu.exec(self.official_table.viewport().mapToGlobal(pos))
        if chosen is act_gen:
            self._official_generate()
        elif chosen is act_fields:
            self._official_show_fields()
        elif chosen is act_edit:
            self._official_edit_template()
        elif chosen is act_upload:
            self._official_upload()
        elif chosen is act_batch:
            self._official_import_folder()
        elif chosen is act_sample:
            self._official_sample()
        elif chosen is act_archive:
            self._official_archive_menu()
        elif chosen is act_delete:
            self._official_delete()

    def _official_archive_dir(self) -> str:
        from services import word_service
        path = os.path.join(word_service.TEMPLATES_DIR, "_archived")
        os.makedirs(path, exist_ok=True)
        return path

    def _official_show_fields(self):
        from services import word_service, form_service as fs
        tpl = self._official_selected()
        if not tpl:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle(f"ربط حقول Word — {tpl.get('name','قالب العقد')}")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(820, 520)
        root = QVBoxLayout(dlg)
        hint = QLabel("نفس طريقة باقي النماذج: اضغط مرتين على أي حقل لتغيير مصدره إلى إدخال يدوي أو بيانات النظام أو قيمة تلقائية أو محسوبة.")
        hint.setProperty("hint", True); hint.setWordWrap(True); root.addWidget(hint)
        table = QTableWidget(0, 5, dlg)
        table.setHorizontalHeaderLabels(["Placeholder", "مصدر", "جهة", "حقل", "إلزام"])
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        root.addWidget(table, 1)

        def _label_source(code):
            return fs.SOURCE_TYPES.get(code or "manual", code or "manual")

        def reload_rows():
            try:
                fields = word_service.official_template_fields(tpl["path"])
            except Exception as exc:
                style.error(dlg, f"تعذر قراءة حقول القالب:\n{exc}")
                fields = []
            table._fields = fields
            table.setRowCount(len(fields))
            for r, f in enumerate(fields):
                vals = [f.get('placeholder') or f.get('name'),
                        _label_source(f.get('source_type') or 'manual'),
                        f.get('source_entity') or '',
                        f.get('source_key') or '',
                        'مطلوب' if f.get('required') else 'اختياري']
                for c, val in enumerate(vals):
                    table.setItem(r, c, QTableWidgetItem(str(val or '')))

        def edit_row():
            r = table.currentRow()
            fields = getattr(table, '_fields', [])
            if r < 0 or r >= len(fields):
                return
            field = fields[r]
            md = FieldMapDialog(dlg, field)
            if md.exec() == QDialog.Accepted:
                word_service.update_official_field_mapping(
                    tpl["path"], field.get("placeholder") or field.get("name"), **md.values())
                reload_rows()

        table.itemDoubleClicked.connect(lambda *_: edit_row())
        reload_rows()
        row = QHBoxLayout(); row.addStretch()
        edit = QPushButton("✎ تعديل الربط المحدد"); edit.clicked.connect(edit_row)
        close = QPushButton("✕ إغلاق"); close.clicked.connect(dlg.accept)
        row.addWidget(edit); row.addWidget(close); root.addLayout(row)
        style.guard_table_sections(dlg)
        dlg.exec()

    def _official_edit_template(self):
        tpl = self._official_selected()
        if not tpl:
            return
        new_name, ok = QInputDialog.getText(
            self, "تعديل بيانات القالب", "اسم القالب:", text=tpl.get("name", ""))
        if not ok:
            return
        new_name = (new_name or "").strip()
        if not new_name:
            style.info(self, "اسم القالب مطلوب.")
            return
        try:
            from services import word_service
            src = tpl["path"]
            folder = os.path.dirname(src)
            safe = re.sub(r'[\\/:*?"<>|]', "_", new_name)[:50]
            dest = os.path.join(folder, f"{tpl.get('kind') or 'contract'}__{safe}.docx")
            if os.path.abspath(dest) != os.path.abspath(src) and os.path.exists(dest):
                style.error(self, "يوجد قالب رسمي بنفس الاسم.")
                return
            os.rename(src, dest)
        except Exception as exc:
            style.error(self, f"تعذر تعديل بيانات القالب:\n{exc}")
            return
        style.toast(self, "تم تعديل بيانات القالب")
        self.refresh_official()

    def _official_archive_menu(self):
        from PySide6.QtGui import QCursor
        menu = QMenu(self)
        act_archive = menu.addAction("أرشفة القالب المحدد")
        act_restore = menu.addAction("استعادة من الأرشيف")
        if not self._official_selected():
            act_archive.setEnabled(False)
        chosen = menu.exec(QCursor.pos())
        if chosen is act_archive:
            self._official_archive_selected()
        elif chosen is act_restore:
            self._official_restore_archived()

    def _official_archive_selected(self):
        tpl = self._official_selected()
        if not tpl:
            return
        if not style.confirm(self, f"أرشفة القالب «{tpl.get('name','')}»؟", "أرشفة القالب"):
            return
        try:
            dest = os.path.join(self._official_archive_dir(), os.path.basename(tpl["path"]))
            if os.path.exists(dest):
                base, ext = os.path.splitext(dest)
                i = 2
                while os.path.exists(f"{base}_{i}{ext}"):
                    i += 1
                dest = f"{base}_{i}{ext}"
            shutil.move(tpl["path"], dest)
        except Exception as exc:
            style.error(self, f"تعذر أرشفة القالب:\n{exc}")
            return
        style.toast(self, "تمت أرشفة القالب")
        self.refresh_official()

    def _official_restore_archived(self):
        from services import word_service
        folder = self._official_archive_dir()
        files = [f for f in sorted(os.listdir(folder)) if f.lower().endswith(".docx")]
        if not files:
            style.info(self, "لا توجد قوالب مؤرشفة.")
            return
        dlg = QDialog(self); dlg.setWindowTitle("استعادة قالب رسمي"); dlg.setLayoutDirection(Qt.RightToLeft); dlg.resize(620, 360)
        lay = QVBoxLayout(dlg)
        table = QTableWidget(len(files), 2, dlg)
        table.setHorizontalHeaderLabels(["القالب المؤرشف", "النوع"])
        table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        table.verticalHeader().setVisible(False); table.setSelectionBehavior(QTableWidget.SelectRows); table.setEditTriggers(QTableWidget.NoEditTriggers)
        for r, name in enumerate(files):
            kind = name.split("__")[0] if "__" in name else "contract"
            table.setItem(r, 0, QTableWidgetItem(name.split("__")[-1].rsplit(".docx", 1)[0].replace("_", " ")))
            table.setItem(r, 1, QTableWidgetItem("عرض سعر" if kind == "quotation" else "عقد"))
        table.setCurrentCell(0, 0); lay.addWidget(table, 1)
        row = QHBoxLayout(); row.addStretch(); ok = QPushButton("استعادة"); ok.setObjectName("btnPrimary"); cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True); row.addWidget(ok); row.addWidget(cancel); lay.addLayout(row)
        ok.clicked.connect(dlg.accept); cancel.clicked.connect(dlg.reject); table.itemDoubleClicked.connect(lambda *_: dlg.accept())
        style.guard_table_sections(dlg)
        if dlg.exec() != QDialog.Accepted or table.currentRow() < 0:
            return
        name = files[table.currentRow()]
        try:
            src = os.path.join(folder, name)
            dest = os.path.join(word_service.TEMPLATES_DIR, name)
            if os.path.exists(dest):
                base, ext = os.path.splitext(dest); i = 2
                while os.path.exists(f"{base}_{i}{ext}"):
                    i += 1
                dest = f"{base}_{i}{ext}"
            shutil.move(src, dest)
        except Exception as exc:
            style.error(self, f"تعذر استعادة القالب:\n{exc}")
            return
        style.toast(self, "تمت استعادة القالب")
        self.refresh_official()

    def _official_upload(self):
        from services import word_service
        kind = self.official_kind.currentData() or "contract"
        path, _ = QFileDialog.getOpenFileName(self, "اختر قالب Word", "", "Word (*.docx)")
        if not path:
            return
        try:
            word_service.upload_template(path, "quotation" if kind == "quotation" else "contract")
        except Exception as exc:
            style.error(self, str(exc))
            return
        style.toast(self, "تم رفع القالب الرسمي")
        self.refresh_official()

    def _official_import_folder(self):
        from services import word_service
        kind = self.official_kind.currentData() or "contract"
        template_kind = "quotation" if kind == "quotation" else "contract"
        folder = QFileDialog.getExistingDirectory(self, "اختر مجلد قوالب Word الرسمية")
        if not folder:
            return
        imported = 0
        failed = []
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            if not os.path.isfile(path) or not name.lower().endswith(".docx"):
                continue
            try:
                word_service.upload_template(path, template_kind)
                imported += 1
            except Exception as exc:
                failed.append(f"- {name}: {exc}")
        msg = f"تم استيراد {imported} قالب Word رسمي."
        if failed:
            msg += "\n\nملفات لم تُستورد:\n" + "\n".join(failed[:10])
        style.info(self, msg, "استيراد قوالب العقود")
        self.refresh_official()

    def _official_sample(self):
        from services import word_service
        kind = self.official_kind.currentData() or "contract"
        try:
            path = word_service.create_sample_template("quotation" if kind == "quotation" else "contract")
        except Exception as exc:
            style.error(self, f"تعذر إنشاء القالب النموذجي:\n{exc}")
            return
        self.refresh_official()
        style.info(self, f"تم إنشاء قالب نموذجي قابل للتعديل:\n{path}", "تم")
        try:
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            pass

    def _pick_output_path(self, title: str, default_name: str) -> tuple[str, bool]:
        safe = "".join(ch for ch in default_name if ch not in '\\/:*?"<>|')[:60] or "document"
        default = os.path.join(os.path.expanduser("~"), safe + ".docx")
        path, filt = QFileDialog.getSaveFileName(self, title, default,
                                                 "Word (*.docx);;PDF (*.pdf)")
        if not path:
            return "", False
        wants_pdf = "PDF" in (filt or "") or path.lower().endswith(".pdf")
        if wants_pdf and not path.lower().endswith(".pdf"):
            path += ".pdf"
        elif not wants_pdf and not path.lower().endswith(".docx"):
            path += ".docx"
        return path, wants_pdf

    def _choose_contract_id(self) -> int | None:
        from services import contract_service
        rows = contract_service.list_contracts()
        if not rows:
            style.info(self, "لا توجد عقود لتوليد مستند منها.")
            return None
        dlg = QDialog(self); dlg.setWindowTitle("اختيار العقد"); dlg.setLayoutDirection(Qt.RightToLeft); dlg.resize(640, 440)
        lay = QVBoxLayout(dlg)
        table = QTableWidget(len(rows), 4, dlg)
        table.setHorizontalHeaderLabels(["رقم العقد", "العميل", "اسم العقد", "القيمة"])
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        table.verticalHeader().setVisible(False); table.setSelectionBehavior(QTableWidget.SelectRows); table.setEditTriggers(QTableWidget.NoEditTriggers)
        for r, c in enumerate(rows):
            vals = [c.contract_number, c.customer_name, c.contract_name or c.description, f"{c.amount:,.3f}"]
            for col, val in enumerate(vals):
                table.setItem(r, col, QTableWidgetItem(str(val or "")))
        lay.addWidget(QLabel("اختر العقد المطلوب توليده من القالب:")); lay.addWidget(table, 1)
        btns = QHBoxLayout(); btns.addStretch(); ok = QPushButton("اختيار"); ok.setObjectName("btnPrimary"); cancel = QPushButton("✕ إلغاء")
        btns.addWidget(cancel); btns.addWidget(ok); lay.addLayout(btns)
        ok.clicked.connect(dlg.accept); cancel.clicked.connect(dlg.reject); table.itemDoubleClicked.connect(lambda *_: dlg.accept())
        table.setCurrentCell(0, 0)
        style.guard_table_sections(dlg)
        if dlg.exec() != QDialog.Accepted or table.currentRow() < 0:
            return None
        return rows[table.currentRow()].id

    def _choose_quotation_id(self) -> int | None:
        from services import lifecycle_service as lc
        rows = lc.list_quotations()
        if not rows:
            style.info(self, "لا توجد عروض أسعار لتوليد مستند منها.")
            return None
        dlg = QDialog(self); dlg.setWindowTitle("اختيار عرض السعر"); dlg.setLayoutDirection(Qt.RightToLeft); dlg.resize(640, 440)
        lay = QVBoxLayout(dlg)
        table = QTableWidget(len(rows), 5, dlg)
        table.setHorizontalHeaderLabels(["رقم العرض", "العميل", "المشروع", "الحالة", "الإجمالي"])
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        table.verticalHeader().setVisible(False); table.setSelectionBehavior(QTableWidget.SelectRows); table.setEditTriggers(QTableWidget.NoEditTriggers)
        for r, q in enumerate(rows):
            vals = [q.get("quote_number"), q.get("customer_name"), q.get("project_name") or "", q.get("status"), f"{float(q.get('total') or 0):,.3f}"]
            for col, val in enumerate(vals):
                table.setItem(r, col, QTableWidgetItem(str(val or "")))
        lay.addWidget(QLabel("اختر عرض السعر المطلوب توليده من القالب:")); lay.addWidget(table, 1)
        btns = QHBoxLayout(); btns.addStretch(); ok = QPushButton("اختيار"); ok.setObjectName("btnPrimary"); cancel = QPushButton("✕ إلغاء")
        btns.addWidget(cancel); btns.addWidget(ok); lay.addLayout(btns)
        ok.clicked.connect(dlg.accept); cancel.clicked.connect(dlg.reject); table.itemDoubleClicked.connect(lambda *_: dlg.accept())
        table.setCurrentCell(0, 0)
        style.guard_table_sections(dlg)
        if dlg.exec() != QDialog.Accepted or table.currentRow() < 0:
            return None
        return int(rows[table.currentRow()]["id"])

    def _official_generate(self):
        tpl = self._official_selected()
        if not tpl:
            return
        # لا نُخرج المستند مباشرة؛ نفتح شاشة إدخال مثل باقي النماذج حتى
        # يستطيع المستخدم تعديل الأسعار والبيانات الخاصة بكل عقد/نموذج.
        OfficialTemplateFillDialog(tpl, self).exec()
        self.refresh_official()

    def _official_delete(self):
        from services import word_service
        tpl = self._official_selected()
        if not tpl:
            return
        if not style.confirm(self, f"حذف القالب «{tpl.get('name','')}»؟", "حذف القالب"):
            return
        try:
            word_service.delete_template(tpl["path"])
        except Exception as exc:
            style.error(self, str(exc)); return
        style.toast(self, "تم حذف القالب")
        self.refresh_official()

    def refresh(self):
        self._rows = wfs.list_word_templates(self.search.text())
        self.table.setRowCount(len(self._rows))
        for r, t in enumerate(self._rows):
            try:
                an = wfs.analyze_template(t['id'])
                fields_txt = f"{t.get('fields_count',0)} · جاهزية {an['ready_percent']}%"
            except Exception:
                fields_txt = str(t.get('fields_count',0))
            vals = [t.get('base_name',''), f"v{t.get('version',1)}", t.get('status',''),
                    fields_txt, t.get('updated_at','') or t.get('created_at',''),
                    t.get('word_path','')]
            for c, v in enumerate(vals):
                _it = QTableWidgetItem(str(v or ''))
                if c == 2:
                    from PySide6.QtGui import QColor
                    _it.setForeground(QColor(style.STATUS_COLORS.get(
                        t.get('status') or '', style.STATUS_DEFAULT)))
                self.table.setItem(r, c, _it)

    def _selected(self):
        r = self.table.currentRow()
        return self._rows[r] if 0 <= r < len(getattr(self, '_rows', [])) else None

    def _current_user(self) -> str:
        try:
            from services import auth_service
            return auth_service.current_username() or auth_service.display_name() or ""
        except Exception:
            return ""

    def _edit_template(self):
        """تعديل بيانات النموذج الخارجية فقط، وليس حقول Word الداخلية."""
        t = self._selected()
        if not t:
            style.info(self, "اختر نموذجًا من القائمة أولاً.")
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("تعديل بيانات النموذج")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(520, 320)
        root = QVBoxLayout(dlg)
        form = QFormLayout(); form.setSpacing(10); form.setLabelAlignment(Qt.AlignRight)
        name = QLineEdit(t.get("base_name", ""))
        desc = QTextEdit(t.get("description", "") or "")
        desc.setFixedHeight(90)
        status = QComboBox()
        make_searchable(status, "")
        for st in ("مسودة", "معتمد", "معطل", "مؤرشف"):
            status.addItem(st, st)
        idx = status.findText(t.get("status", "معتمد"))
        status.setCurrentIndex(idx if idx >= 0 else 1)
        form.addRow("اسم النموذج", name)
        form.addRow("الوصف", desc)
        form.addRow("الحالة", status)
        root.addLayout(form)
        hint = QLabel("هذا التعديل يغير بيانات النموذج في المركز فقط، ولا يغير حقول القالب الداخلية أو المستندات التي تم توليدها سابقًا.")
        hint.setWordWrap(True); hint.setProperty("hint", True); root.addWidget(hint)
        row = QHBoxLayout(); row.addStretch()
        save = QPushButton("💾 حفظ البيانات"); save.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء"); cancel.setProperty("flat", True)
        row.addWidget(cancel); row.addWidget(save); root.addLayout(row)
        cancel.clicked.connect(dlg.reject)
        def do_save():
            try:
                wfs.update_template_meta(
                    t["id"], name.text(), desc.toPlainText(),
                    status.currentData(), self._current_user())
            except (ValidationError, DatabaseError) as exc:
                style.error(self, str(exc))
                return
            style.toast(self, "تم تعديل بيانات النموذج")
            dlg.accept(); self.refresh()
        save.clicked.connect(do_save)
        dlg.exec()

    def _toggle_archive(self):
        t = self._selected()
        if not t:
            style.info(self, "اختر نموذجًا من القائمة أولاً.")
            return
        new_status = "معتمد" if t.get("status") == "مؤرشف" else "مؤرشف"
        verb = "استعادة" if new_status == "معتمد" else "أرشفة"
        if not style.confirm(self, f"{verb} النموذج «{t.get('base_name','')}»؟", verb):
            return
        try:
            wfs.set_template_status(t["id"], new_status, self._current_user())
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc)); return
        style.toast(self, "تمت الاستعادة" if new_status == "معتمد" else "تمت الأرشفة")
        self.refresh()

    def _delete_template(self):
        t = self._selected()
        if not t:
            style.info(self, "اختر نموذجًا من القائمة أولاً.")
            return
        used = int(t.get("documents_count") or 0)
        if used:
            style.info(
                self,
                "هذا النموذج له مستندات مولدة محفوظة، لذلك لن يتم حذفه حفاظًا على الأرشيف. استخدم الأرشفة بدل الحذف.",
                "حذف النموذج")
            return
        if not style.confirm(
                self, f"حذف النموذج «{t.get('base_name','')}» نهائيًا من مركز النماذج؟\nلن يتم حذف أي مستندات عملاء لأنه غير مستخدم.",
                "حذف النموذج"):
            return
        try:
            wfs.delete_template(t["id"])
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc)); return
        style.toast(self, "تم حذف النموذج")
        self.refresh()

    def _templates_menu(self, pos):
        row = self.table.rowAt(pos.y())
        if row >= 0:
            self.table.setCurrentCell(row, 0)
        t = self._selected()
        if not t:
            return
        menu = QMenu(self)
        act_fill = menu.addAction("تعبئة النموذج")
        act_edit = menu.addAction("تعديل بيانات النموذج")
        act_fields = menu.addAction("عرض ربط الحقول")
        menu.addSeparator()
        act_archive = menu.addAction("استعادة من الأرشيف" if t.get("status") == "مؤرشف" else "أرشفة النموذج")
        act_delete = menu.addAction("حذف النموذج")
        if int(t.get("documents_count") or 0):
            act_delete.setEnabled(False)
            act_delete.setText("حذف النموذج (له مستندات محفوظة)")
        chosen = menu.exec(self.table.viewport().mapToGlobal(pos))
        if chosen is act_fill:
            self._fill_selected()
        elif chosen is act_edit:
            self._edit_template()
        elif chosen is act_fields:
            self._show_fields()
        elif chosen is act_archive:
            self._toggle_archive()
        elif chosen is act_delete:
            self._delete_template()

    def _import_word(self):
        path, _ = QFileDialog.getOpenFileName(self, "اختر قالب Word", "", "Word (*.docx)")
        if not path: return
        name = os.path.splitext(os.path.basename(path))[0]
        try:
            res = wfs.import_docx(name, path)
            known = sum(1 for f in res['fields'] if f['known'])
            style.success(self, f"تم رفع القالب. الحقول: {len(res['fields'])} · مطابق تلقائيًا: {known}")
            self.refresh()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))


    def _import_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "اختر مجلد قوالب Word")
        if not folder:
            return
        try:
            res = wfs.import_folder(folder)
            msg = f"تم استيراد {res['imported']} قالب Word."
            if res['failed']:
                msg += "\n\nملفات لم تُستورد:\n" + "\n".join(
                    f"- {x['file']}: {x['error']}" for x in res['failed'][:10])
            style.info(self, msg, "استيراد القوالب")
            self.refresh()
        except (ValidationError, DatabaseError) as exc:
            style.error(self, str(exc))

    def _fill_selected(self):
        t = self._selected()
        if not t:
            return
        WordFormFillDialog(t['id'], self).exec()
        self.refresh()

    def _show_fields(self):
        t = self._selected()
        if not t: return
        dlg = QDialog(self)
        dlg.setWindowTitle(f"ربط حقول Word — {t['base_name']}")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.resize(820, 520)
        lay = QVBoxLayout(dlg)
        hint = QLabel("اضغط مرتين على أي حقل لتغيير ربطه. الحقول المطابقة تلقائيًا جاهزة، وغير المعروفة تبقى يدوية.")
        hint.setProperty("hint", True); hint.setWordWrap(True); lay.addWidget(hint)
        table = QTableWidget(0, 5)
        table.setHorizontalHeaderLabels(["Placeholder", "مصدر", "جهة", "حقل", "إلزام"])
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        table.verticalHeader().setVisible(False); table.setSelectionBehavior(QTableWidget.SelectRows)
        lay.addWidget(table, 1)

        def reload_rows():
            fields = wfs.template_fields(t['id'])
            table._fields = fields
            table.setRowCount(len(fields))
            for r, f in enumerate(fields):
                vals = [f.get('placeholder') or f.get('name'),
                        f.get('source_type') or 'manual',
                        f.get('source_entity') or '',
                        f.get('source_key') or '',
                        'مطلوب' if f.get('required') else 'اختياري']
                for c, v in enumerate(vals):
                    table.setItem(r, c, QTableWidgetItem(str(v)))
        def edit_row():
            r = table.currentRow()
            if r < 0: return
            fields = getattr(table, '_fields', [])
            if r >= len(fields): return
            md = FieldMapDialog(dlg, fields[r])
            if md.exec() == QDialog.Accepted:
                wfs.update_field_mapping(fields[r]['id'], **md.values())
                reload_rows(); self.refresh()
        table.itemDoubleClicked.connect(lambda *_: edit_row())
        reload_rows()
        row = QHBoxLayout(); row.addStretch()
        edit = QPushButton("✎ تعديل الربط المحدد"); edit.clicked.connect(edit_row)
        close = QPushButton("✕ إغلاق"); close.clicked.connect(dlg.accept)
        row.addWidget(edit); row.addWidget(close); lay.addLayout(row)
        style.guard_table_sections(dlg)
        dlg.exec()


# توافق مع main_window إذا استورد FormsCenterPage من هذا الملف
FormsCenterPage = WordFormsCenterPage
