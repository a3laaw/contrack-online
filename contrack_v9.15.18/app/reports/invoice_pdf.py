# -*- coding: utf-8 -*-
"""إنشاء فاتورة PDF احترافية A4 بالعربية RTL."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas

from database.models import Invoice, Settings
from services import invoice_service, settings_service
from reports.pdf_utils import (apply_pdf_metadata, 
    ar, register_fonts, safe_logo, safe_image, draw_header_image,
    draw_footer_image, hex_color, light_tint, fit_pdf_text, PDFError,
    draw_label_value_row,
    AR_FONT, AR_FONT_BOLD, PRIMARY, ACCENT, LIGHT_BG, BORDER, GREEN, RED, draw_stamp)

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm


def _text_r(c, x_right, y, text, font=AR_FONT, size=11, color=None,
            max_width=None):
    c.setFont(font, size)
    if color:
        c.setFillColor(color)
    shaped = (fit_pdf_text(c, str(text), font, size, max_width)
              if max_width else ar(text))
    c.drawRightString(x_right, y, shaped)
    c.setFillColorRGB(0, 0, 0)


def _wrap_notes(c, x_right, y, text, font=AR_FONT, size=10,
                max_width=None, max_lines=3, leading=5 * mm):
    """ملاحظات متعددة السطور بعرض محدد (تقصير بسطر أخير منقّط)."""
    words = str(text or "").split()
    lines, cur = [], ""
    for wd in words:
        trial = f"{cur} {wd}".strip()
        if c.stringWidth(ar(trial), font, size) <= (max_width or 10 ** 9):
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = wd
            if len(lines) >= max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    elif cur:
        lines[-1] = (lines[-1] + " …") if lines else "…"
    for ln in lines[:max_lines]:
        _text_r(c, x_right, y, ln, font, size, max_width=max_width)
        y -= leading
    return y


def _text_l(c, x_left, y, text, font=AR_FONT, size=11, color=None):
    c.setFont(font, size)
    if color:
        c.setFillColor(color)
    c.drawString(x_left, y, ar(text))
    c.setFillColorRGB(0, 0, 0)


def generate_invoice_pdf(invoice: Invoice, out_path: str) -> str:
    try:
        register_fonts()
        settings: Settings = settings_service.get_settings()
        fin = invoice_service.contract_financials(invoice.contract_id)
        cur = settings.currency

        # الألوان المخصصة من الإعدادات
        primary = hex_color(settings.invoice_primary, PRIMARY)
        accent = hex_color(settings.invoice_accent, ACCENT)
        light_bg = light_tint(settings.invoice_primary)

        c = rl_canvas.Canvas(out_path, pagesize=A4)
        apply_pdf_metadata(c, f"Invoice {invoice.invoice_number}")

        right = PAGE_W - MARGIN
        left = MARGIN

        # ===== الترويسة: صورة مخصصة أو ترويسة مرسومة =====
        from reportlab.lib import colors as _c
        header_img = safe_image(settings.header_image)
        if header_img:
            header_h = draw_header_image(c, PAGE_W, PAGE_H, header_img)
            y = PAGE_H - header_h - 14 * mm
        else:
            c.setFillColor(primary)
            c.rect(0, PAGE_H - 42 * mm, PAGE_W, 42 * mm, stroke=0, fill=1)
            logo = safe_logo(settings.logo_path)
            if logo:
                try:
                    c.drawImage(logo, left, PAGE_H - 38 * mm, width=28 * mm,
                                height=28 * mm, preserveAspectRatio=True, mask="auto")
                except Exception:
                    pass
            hy = PAGE_H - 16 * mm
            inv_head_w = PAGE_W - 2 * MARGIN - 42 * mm  # فسحة الشعار/«فاتورة»
            _text_r(c, right, hy, settings.company_name or "اسم الشركة",
                    AR_FONT_BOLD, 18, _c.white, max_width=inv_head_w)
            hy -= 7 * mm
            if settings.company_address:
                _text_r(c, right, hy, settings.company_address, AR_FONT, 10,
                        _c.HexColor("#d8e4ef"), max_width=inv_head_w)
                hy -= 5.5 * mm
            contact = "  |  ".join(x for x in [
                f"هاتف: {settings.company_phone}" if settings.company_phone else "",
                settings.company_email] if x)
            if contact:
                _text_r(c, right, hy, contact, AR_FONT, 10,
                        _c.HexColor("#d8e4ef"), max_width=inv_head_w)
            c.setFillColor(_c.white)
            c.setFont(AR_FONT_BOLD, 26)
            if not logo:
                c.drawString(left, PAGE_H - 30 * mm, ar("فاتورة"))
            c.setFillColorRGB(0, 0, 0)
            y = PAGE_H - 56 * mm

        # ===== شريط معلومات الفاتورة =====
        c.setFillColor(light_bg)
        c.roundRect(left, y - 20 * mm, PAGE_W - 2 * MARGIN, 24 * mm, 3 * mm,
                    stroke=0, fill=1)

        col_w = (PAGE_W - 2 * MARGIN) / 4
        labels = [
            ("رقم الفاتورة", invoice.invoice_number),
            ("التاريخ", invoice.invoice_date),
            ("العميل", invoice.customer_name),
            ("رقم العقد", invoice.contract_number),
        ]
        for i, (label, value) in enumerate(labels):
            cx = right - i * col_w - col_w / 2
            c.setFont(AR_FONT, 9)
            c.setFillColor(accent)
            c.drawCentredString(cx, y - 6 * mm, ar(label))
            c.setFont(AR_FONT_BOLD, 12)
            c.setFillColor(primary)
            c.drawCentredString(cx, y - 13.5 * mm,
                                fit_pdf_text(c, str(value), AR_FONT_BOLD, 12,
                                             col_w - 4 * mm))
        c.setFillColorRGB(0, 0, 0)

        # ===== جدول البيان =====
        y = y - 32 * mm
        table_top = y
        row_h = 11 * mm
        # رأس الجدول
        c.setFillColor(primary)
        c.rect(left, y - row_h, PAGE_W - 2 * MARGIN, row_h, stroke=0, fill=1)
        amount_col_w = 48 * mm
        c.setFillColor(_c.white)
        c.setFont(AR_FONT_BOLD, 11)
        c.drawCentredString(right - (PAGE_W - 2 * MARGIN - amount_col_w) / 2,
                            y - row_h + 3.5 * mm, ar("البيان"))
        c.drawCentredString(left + amount_col_w / 2, y - row_h + 3.5 * mm,
                            ar(f"المبلغ ({cur})"))
        # صف البيان
        y -= row_h
        c.setFillColor(_c.white)
        c.rect(left, y - row_h, PAGE_W - 2 * MARGIN, row_h, stroke=0, fill=1)
        c.setStrokeColor(BORDER)
        c.rect(left, y - row_h, PAGE_W - 2 * MARGIN, row_h, stroke=1, fill=0)
        c.line(left + amount_col_w, y, left + amount_col_w, y - row_h)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT, 11)
        desc = invoice.description or "دفعة من قيمة العقد"
        c.drawRightString(right - 4 * mm, y - row_h + 3.5 * mm,
                          fit_pdf_text(c, desc, AR_FONT, 11,
                                       PAGE_W - 2 * MARGIN - amount_col_w - 8 * mm))
        c.setFont(AR_FONT_BOLD, 12)
        c.drawCentredString(left + amount_col_w / 2, y - row_h + 3.5 * mm,
                            f"{invoice.amount:,.3f}")
        y -= row_h

        # إجمالي الفاتورة
        c.setFillColor(accent)
        c.rect(left, y - row_h, PAGE_W - 2 * MARGIN, row_h, stroke=0, fill=1)
        c.setFillColor(_c.white)
        c.setFont(AR_FONT_BOLD, 12)
        c.drawRightString(right - 4 * mm, y - row_h + 3.5 * mm, ar("إجمالي الفاتورة"))
        c.drawCentredString(left + amount_col_w / 2, y - row_h + 3.5 * mm,
                            ar(f"{invoice.amount:,.3f} {cur}"))
        y -= row_h + 14 * mm

        # ===== ملخص العقد =====
        _text_r(c, right, y, "ملخص العقد", AR_FONT_BOLD, 13, primary)
        y -= 4 * mm
        c.setStrokeColor(BORDER)
        c.line(left, y, right, y)
        y -= 9 * mm

        summary = [
            ("قيمة العقد", fin["contract_amount"], primary),
            ("إجمالي الفواتير", fin["total_invoiced"], accent),
            ("المبلغ المتبقي من العقد", fin["remaining"],
             GREEN if fin["remaining"] >= 0 else RED),
        ]
        # صفوف ملخص مفصولة إلى عمود بيان وعمود رقم حتى لا تتداخل
        # الكلمات الطويلة مع الأرقام في الطباعة العربية.
        box_x = left
        box_w = right - left
        for label, value, color in summary:
            draw_label_value_row(
                c, box_x, y, box_w, label, f"{value:,.3f} {cur}",
                AR_FONT, AR_FONT_BOLD, 11, color, gap=10 * mm,
                value_width=45 * mm)
            y -= 8 * mm

        if invoice.notes:
            y -= 4 * mm
            _text_r(c, right, y, "ملاحظات:", AR_FONT_BOLD, 10, primary)
            y -= 6 * mm
            y = _wrap_notes(c, right, y, invoice.notes, AR_FONT, 10,
                            max_width=right - left)

        # ===== التوقيعات: المستلم والمحاسب =====
        sig_y = 40 * mm
        c.setFont(AR_FONT_BOLD, 10.5)
        c.setFillColor(primary)
        c.drawCentredString(right - 40 * mm, sig_y, ar("توقيع المستلم"))
        c.drawCentredString(left + 40 * mm, sig_y, ar("التوقيع"))
        c.setStrokeColor(_c.HexColor("#9aa8b8"))
        c.line(right - 68 * mm, sig_y - 8 * mm, right - 12 * mm, sig_y - 8 * mm)
        c.line(left + 12 * mm, sig_y - 8 * mm, left + 68 * mm, sig_y - 8 * mm)

        # ===== مكان الختم =====
        # في منتصف الصفحة بين التوقيعين · يُرسم الختم إن رُفعت صورته
        # من الإعدادات، وإلا يظهر إطار متقطع مكتوب فيه «مكان الختم»
        # ليُختم يدويًا بعد الطباعة.
        stamp_size = float(getattr(settings, "stamp_size_mm", 0) or 0) or 30
        # شاشة التحريك تحفظ إزاحة من الموضع الافتراضي لا إحداثيًا مطلقًا؛
        # سابقًا قيمة صغيرة مثل 10 مم كانت تُحسب من أسفل الصفحة فتنزل الختم جدًا.
        _half = (stamp_size / 2) * mm
        stamp_cx = PAGE_W / 2 + float(getattr(settings, "stamp_x_mm", 0) or 0) * mm
        stamp_cy = sig_y + 2 * mm + float(getattr(settings, "stamp_y_mm", 0) or 0) * mm
        stamp_cx = max(_half + 5 * mm, min(PAGE_W - _half - 5 * mm, stamp_cx))
        stamp_cy = max(_half + 5 * mm, min(PAGE_H - _half - 5 * mm, stamp_cy))
        economy = bool(getattr(settings, "print_economy", False))
        drawn = False
        if not economy:
            drawn = draw_stamp(c, stamp_cx, stamp_cy,
                               getattr(settings, "stamp_image", ""),
                               max_mm=stamp_size)
        if not drawn:
            c.saveState()
            c.setStrokeColor(_c.HexColor("#c3cdd8"))
            c.setDash(2, 2)
            c.circle(stamp_cx, stamp_cy, (stamp_size / 2) * mm, stroke=1, fill=0)
            c.setDash()
            c.setFont(AR_FONT, 8)
            c.setFillColor(_c.HexColor("#9aa8b8"))
            c.drawCentredString(stamp_cx, stamp_cy - 1.5 * mm,
                                ar("مكان الختم"))
            c.restoreState()

        # ===== التذييل: صورة مخصصة أو نص =====
        footer_img = safe_image(settings.footer_image)
        if footer_img:
            draw_footer_image(c, PAGE_W, footer_img)
        else:
            c.setStrokeColor(BORDER)
            c.line(left, 22 * mm, right, 22 * mm)
            c.setFont(AR_FONT, 9)
            c.setFillColor(_c.HexColor("#7a8a99"))
            c.drawCentredString(PAGE_W / 2, 16 * mm,
                                fit_pdf_text(c, f"{settings.company_name} · شكرًا لتعاملكم معنا",
                                             AR_FONT, 9, PAGE_W - 2 * MARGIN))

        c.save()
        return out_path
    except PDFError:
        raise
    except Exception as exc:
        raise PDFError(f"تعذر إنشاء ملف PDF للفاتورة: {exc}") from exc
