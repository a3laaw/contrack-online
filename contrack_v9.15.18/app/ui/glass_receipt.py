# -*- coding: utf-8 -*-
"""شاشة عرض السند / الفاتورة · بنفس ستايل النظام الحالي (يتبع الثيم المختار).

- خلفية Ambient هادئة مثل بقية البرنامج
- بطاقات زجاجية بنفس ألوان وحدود النظام
- الديباجة الرسمية: البيانات المتغيرة بارزة بلون الهوية
- المبلغ بالأرقام + بالحروف (تفقيط)
- أزرار بنفس نمط النظام: طباعة | إغلاق
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog, QFrame, QHBoxLayout, QLabel, QPushButton, QVBoxLayout,
)

from services import settings_service
from services.tafqeet import amount_to_words
from ui import style
from ui.style import GlassBackground, soft_shadow


class GlassReceiptDialog(QDialog):
    """عارض السند / الفاتورة · بستايل النظام."""

    def __init__(self, parent, doc: dict):
        """doc: {number, date, party, description, contract_number,
                 amount, vtype ('receipt'|'payment'|'invoice')}"""
        super().__init__(parent)
        style.ensure_light_background(self)
        self.doc = doc
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 900, 680, min_w=760, min_h=560)
        style.center_on_screen(self)
        settings = settings_service.get_settings()
        cur = settings.currency
        t = style.theme()

        vtype = doc.get("vtype", "receipt")
        titles = {"receipt": "سند قبض", "payment": "سند صرف", "invoice": "فاتورة"}
        self.setWindowTitle(f"{titles.get(vtype, 'سند')} {doc['number']}")

        # ===== الخلفية بنفس خلفية النظام =====
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        bg = GlassBackground()
        outer.addWidget(bg)
        root = QVBoxLayout(bg)
        root.setContentsMargins(36, 28, 36, 24)
        root.setSpacing(16)

        # ============ الهيدر: الشركة + كبسولة الرقم ============
        header = QHBoxLayout()
        company_col = QVBoxLayout()
        company_col.setSpacing(3)
        company = QLabel(settings.company_name or "اسم الشركة")
        company.setStyleSheet(
            f"color: {style.PRIMARY}; font-size: 17.8px; font-weight: 800;"
            "background: transparent;")
        contact = "   ".join(x for x in [
            settings.company_address,
            f"هاتف: {settings.company_phone}" if settings.company_phone else "",
            settings.company_email] if x)
        contact_lbl = QLabel(contact)
        contact_lbl.setProperty("hint", True)
        company_col.addWidget(company)
        company_col.addWidget(contact_lbl)
        header.addLayout(company_col)
        header.addStretch()

        # كبسولة الرقم والتاريخ · بطاقة نظام عادية
        capsule = QFrame()
        capsule.setProperty("card", True)
        soft_shadow(capsule, radius=22, y=5)
        cap_layout = QVBoxLayout(capsule)
        cap_layout.setContentsMargins(24, 10, 24, 10)
        cap_layout.setSpacing(2)
        num_lbl = QLabel(doc["number"])
        num_lbl.setAlignment(Qt.AlignCenter)
        num_lbl.setStyleSheet(
            f"color: {style.ACCENT}; font-size: 16.1px; font-weight: 800;"
            "background: transparent;")
        date_lbl = QLabel(doc["date"])
        date_lbl.setAlignment(Qt.AlignCenter)
        date_lbl.setProperty("hint", True)
        cap_layout.addWidget(num_lbl)
        cap_layout.addWidget(date_lbl)
        header.addWidget(capsule)
        root.addLayout(header)

        # ============ عنوان المستند ============
        type_color = {"receipt": style.GREEN, "payment": style.RED,
                      "invoice": style.ACCENT}.get(vtype, style.ACCENT)
        type_lbl = QLabel(titles.get(vtype, "سند"))
        type_lbl.setAlignment(Qt.AlignCenter)
        type_lbl.setStyleSheet(
            f"color: {type_color}; font-size: 20.4px; font-weight: 800;"
            "background: transparent;")
        root.addWidget(type_lbl)

        # ============ الديباجة الرسمية ============
        prologue = QFrame()
        prologue.setProperty("card", True)
        soft_shadow(prologue, radius=24, y=6)
        pro_layout = QVBoxLayout(prologue)
        pro_layout.setContentsMargins(30, 22, 30, 22)

        verb = {"receipt": "استلمنا من", "payment": "صرفنا إلى",
                "invoice": "فاتورة مستحقة على"}.get(vtype, "استلمنا من")
        static = f"color: {style.MUTED}; font-size: 14.4px;"
        dynamic = (f"color: {style.PRIMARY}; font-size: 15.3px; font-weight: 800;")
        def _clean_customer_text(text: str) -> str:
            import re
            return re.sub(r"(?<!\d)\b\d+\.\s*(?=الدفعة)", "", str(text or "")).strip()

        def _ruled_line(text: str = "") -> QLabel:
            lbl = QLabel(text)
            lbl.setTextFormat(Qt.RichText)
            lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            lbl.setMinimumHeight(22)
            lbl.setWordWrap(True)
            lbl.setStyleSheet(
                "background: transparent; border: none;"
                "border-bottom: 1.5px dotted #C9D0DC; padding: 1px 6px;"
                f"color: {style.PRIMARY}; font-size: 14.4px; font-weight: 800;")
            return lbl

        contract_part = ""
        raw = doc.get("raw") or {}
        contract_id = raw.get("contract_id") if isinstance(raw, dict) else None
        if contract_id:
            try:
                from services.extras_service import contract_label
                clabel = contract_label(contract_id)
            except Exception:
                clabel = ""
            if clabel:
                contract_part = f" من قيمة {clabel}"
        elif doc.get("contract_number"):
            contract_part = f" من قيمة العقد {doc['contract_number']}"
        desc = _clean_customer_text((doc.get("description") or "دفعة") + contract_part)

        party_row = QHBoxLayout()
        party_row.addWidget(QLabel(f"{verb} السيد / السادة"))
        party_row.addWidget(_ruled_line(_clean_customer_text(doc.get("party") or "")), 1)
        pro_layout.addLayout(party_row)
        desc_row = QHBoxLayout()
        desc_row.addWidget(QLabel("وذلك عن"))
        desc_col = QVBoxLayout()
        desc_col.setSpacing(2)
        # 3 أسطر مسطرة للبيان في المعاينة.
        desc_col.addWidget(_ruled_line(desc))
        desc_col.addWidget(_ruled_line(""))
        desc_col.addWidget(_ruled_line(""))
        desc_row.addLayout(desc_col, 1)
        pro_layout.addLayout(desc_row)
        root.addWidget(prologue)

        # ============ بطاقة المبلغ والتفقيط ============
        grid_panel = QFrame()
        grid_panel.setProperty("card", True)
        soft_shadow(grid_panel, radius=24, y=6)
        grid_layout = QVBoxLayout(grid_panel)
        grid_layout.setContentsMargins(26, 18, 26, 18)
        grid_layout.setSpacing(12)

        # رأس
        head_row = QHBoxLayout()
        for text, stretch in (("المبلغ بالأرقام", 1), ("المبلغ بالحروف", 2)):
            h = QLabel(text)
            h.setAlignment(Qt.AlignCenter)
            h.setStyleSheet(
                f"color: {style.ACCENT}; font-size: 10.6px; font-weight: 700;"
                "background: transparent;")
            head_row.addWidget(h, stretch)
        grid_layout.addLayout(head_row)

        # الصف
        amount_row = QHBoxLayout()
        amount_row.setSpacing(16)
        amount_box = QFrame()
        amount_box.setProperty("glassStrong", True)
        amount_box.setFixedHeight(58)
        ab_layout = QVBoxLayout(amount_box)
        amount_lbl = QLabel(f"{doc['amount']:,.3f} {cur}")
        amount_lbl.setAlignment(Qt.AlignCenter)
        amount_lbl.setStyleSheet(
            f"color: {style.PRIMARY}; font-size: 17.8px; font-weight: 800;"
            "background: transparent;")
        ab_layout.addWidget(amount_lbl)
        amount_row.addWidget(amount_box, 1)

        words_lbl = QLabel(amount_to_words(doc["amount"], cur))
        words_lbl.setWordWrap(True)
        words_lbl.setAlignment(Qt.AlignVCenter | Qt.AlignRight)
        words_lbl.setStyleSheet(
            f"color: {style.TEXT}; font-size: 13.2px; background: transparent;")
        amount_row.addWidget(words_lbl, 2)
        grid_layout.addLayout(amount_row)

        # الإجمالي
        total_row = QHBoxLayout()
        total_lbl = QLabel(f"الإجمالي: {doc['amount']:,.3f} {cur}")
        total_lbl.setStyleSheet(
            f"color: {style.ACCENT}; font-size: 17px; font-weight: 800;"
            "background: transparent;")
        total_row.addWidget(total_lbl)
        total_row.addStretch()
        grid_layout.addLayout(total_row)
        root.addWidget(grid_panel)

        # ============ الملاحظات: سطران مسطران ============
        notes_txt = ""
        try:
            notes_txt = (doc.get("raw") or {}).get("notes") or doc.get("notes") or ""
        except Exception:
            notes_txt = doc.get("notes") or ""
        notes_box = QFrame(); notes_box.setProperty("card", True)
        notes_l = QHBoxLayout(notes_box); notes_l.setContentsMargins(18, 8, 18, 8)
        notes_l.addWidget(QLabel("ملاحظات"))
        notes_col = QVBoxLayout(); notes_col.setSpacing(2)
        notes_col.addWidget(_ruled_line(_clean_customer_text(notes_txt)))
        notes_col.addWidget(_ruled_line(""))
        notes_l.addLayout(notes_col, 1)
        root.addWidget(notes_box)

        root.addStretch()

        # ============ التذييل ============
        thanks = QLabel("شكرًا لتعاملكم معنا")
        thanks.setAlignment(Qt.AlignCenter)
        thanks.setProperty("hint", True)
        root.addWidget(thanks)

        # أزرار بنفس نمط النظام
        buttons = QHBoxLayout()
        buttons.addStretch()
        print_btn = QPushButton("🖨 طباعة وتحميل")
        print_btn.setObjectName("btnPrimary")
        print_btn.setCursor(Qt.PointingHandCursor)
        close_btn = QPushButton("✕ إغلاق")
        close_btn.setProperty("flat", True)
        close_btn.setCursor(Qt.PointingHandCursor)
        print_btn.clicked.connect(self._print)
        close_btn.clicked.connect(self.accept)
        buttons.addWidget(print_btn)
        buttons.addWidget(close_btn)
        buttons.addStretch()
        root.addLayout(buttons)

    def _archive_customer_for(self, doc: dict):
        """العميل صاحب المستند (للأرشفة التلقائية في ملفه).

        سند بعميل مباشر ← عميله · سند/فاتورة بعقد ← عميل العقد.
        يرجع None إن لم يكن للعميل علاقة (سند عام).
        """
        try:
            from services import customer_service
            raw = doc.get("raw") or {}
            cid = None
            if doc.get("vtype") == "invoice":
                inv = doc.get("invoice_obj")
                cid = getattr(inv, "customer_id", None)
                if not cid and getattr(inv, "contract_id", None):
                    from services import contract_service
                    con = contract_service.get_contract(inv.contract_id)
                    cid = con.customer_id if con else None
            else:
                if raw.get("party_type") == "customer" and raw.get("party_id"):
                    cid = raw["party_id"]
                elif raw.get("contract_id"):
                    from services import contract_service
                    con = contract_service.get_contract(raw["contract_id"])
                    cid = con.customer_id if con else None
            if not cid:
                return None
            return customer_service.get_customer(cid)
        except Exception:
            return None

    def _print(self):
        """فتح معاينة PDF للطباعة والتحميل."""
        from reports.pdf_utils import PDFError
        from ui.pdf_preview import PdfPreviewDialog, make_temp_pdf_path
        doc = self.doc
        raw = doc.get("raw") or {}
        if raw.get("cancelled"):
            style.info(self, "هذا السند ملغى · لا يُطبع.")
            return
        path = make_temp_pdf_path(f"doc_{doc['number']}")
        try:
            if doc.get("vtype") == "invoice":
                from reports.invoice_pdf import generate_invoice_pdf
                generate_invoice_pdf(doc["invoice_obj"], path)
            else:
                from reports.voucher_pdf import generate_voucher_pdf
                generate_voucher_pdf(doc.get("raw", doc), path)
            # أرشفة تلقائية في ملف العميل — كل ما يخصه في ملفه
            _cust = self._archive_customer_for(doc)
            if _cust is not None:
                try:
                    from services.archive_service import save_to_archive
                    save_to_archive(_cust, path,
                                    f"{doc['number']}.pdf", overwrite=True)
                except Exception:
                    pass
            PdfPreviewDialog(self, path,
                             title=doc["number"],
                             save_name=f"{doc['number']}.pdf",
                             archive_customer=_cust).exec()
        except PDFError as exc:
            style.error(self, str(exc))
        except Exception:
            style.error(self, "تعذر إنشاء ملف الطباعة.")
