# -*- coding: utf-8 -*-
"""إنشاء كشف حساب PDF احترافي A4 بالعربية RTL."""
from reportlab.lib import colors as _c
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas

from services import settings_service, statement_service
from reports.pdf_utils import (apply_pdf_metadata, 
    ar, register_fonts, safe_logo, safe_image, draw_header_image,
    draw_footer_image, hex_color, light_tint, fit_pdf_text,
    draw_label_value_row,
    PDFError, AR_FONT, AR_FONT_BOLD, PRIMARY, ACCENT, LIGHT_BG, BORDER,
    GREEN, RED,
)

PAGE_W, PAGE_H = A4
MARGIN = 15 * mm
ROW_H = 9 * mm

# ألوان التقرير الحالية (تُحدَّث من الإعدادات عند كل توليد)
_PRIMARY = PRIMARY
_ACCENT = ACCENT
_LIGHT_BG = LIGHT_BG
_BORDER_C = BORDER
_MUTED_C = _c.HexColor("#3d5568")
_MUTED2_C = _c.HexColor("#7a8a99")
_STRIPE_C = _c.HexColor("#d8e4ef")


def _header(c, settings, title: str) -> float:
    """يرسم ترويسة الصفحة (صورة مخصصة أو مرسومة) ويرجع y لبداية المحتوى."""
    right = PAGE_W - MARGIN
    left = MARGIN
    header_img = safe_image(settings.header_image)
    if header_img:
        header_h = draw_header_image(c, PAGE_W, PAGE_H, header_img)
        c.setFillColor(_PRIMARY)
        c.setFont(AR_FONT_BOLD, 13)
        c.drawRightString(right, PAGE_H - header_h - 8 * mm, ar(title))
        return PAGE_H - header_h - 16 * mm
    c.setFillColor(_PRIMARY)
    c.rect(0, PAGE_H - 34 * mm, PAGE_W, 34 * mm, stroke=0, fill=1)
    logo = safe_logo(settings.logo_path)
    if logo:
        try:
            c.drawImage(logo, left, PAGE_H - 30 * mm, width=22 * mm,
                        height=22 * mm, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFillColor(_c.white)
    c.setFont(AR_FONT_BOLD, 15)
    head_w = PAGE_W - 2 * MARGIN - 34 * mm  # فسحة الشعار يسارًا
    c.drawRightString(right, PAGE_H - 13 * mm,
                      fit_pdf_text(c, settings.company_name or "اسم الشركة",
                                   AR_FONT_BOLD, 15, head_w))
    c.setFont(AR_FONT, 9)
    c.setFillColor(_STRIPE_C)
    info = "  |  ".join(x for x in [
        settings.company_address,
        f"هاتف: {settings.company_phone}" if settings.company_phone else "",
        settings.company_email] if x)
    if info:
        c.drawRightString(right, PAGE_H - 20 * mm,
                          fit_pdf_text(c, info, AR_FONT, 9, head_w))
    c.setFont(AR_FONT_BOLD, 13)
    c.setFillColor(_c.white)
    c.drawRightString(right, PAGE_H - 28 * mm, ar(title))
    c.setFillColorRGB(0, 0, 0)
    return PAGE_H - 42 * mm


# أعمدة الجدول من اليمين لليسار: التاريخ | البيان | المرجع | مدين | دائن | الرصيد
_COLS = [26 * mm, 46 * mm, 28 * mm, 27 * mm, 27 * mm, 26 * mm]
_HEADS = ["التاريخ", "البيان", "المرجع", "مدين", "دائن", "الرصيد"]
# الكشف الشامل: عمود «العقد» ثانيًا (المجموع 176مم ≤ 180مم المتاح)
_COLS_FULL = [20 * mm, 24 * mm, 38 * mm, 24 * mm, 24 * mm, 24 * mm, 22 * mm]
_HEADS_FULL = ["التاريخ", "العقد", "البيان", "المرجع", "مدين", "دائن", "الرصيد"]


def _table_header(c, y, cols=None, heads=None) -> float:
    cols = cols or _COLS
    heads = heads or _HEADS
    right = PAGE_W - MARGIN
    total_w = sum(cols)
    c.setFillColor(_PRIMARY)
    c.rect(right - total_w, y - ROW_H, total_w, ROW_H, stroke=0, fill=1)
    c.setFillColor(_c.white)
    c.setFont(AR_FONT_BOLD, 10)
    x = right
    for w, head in zip(cols, heads):
        c.drawCentredString(x - w / 2, y - ROW_H + 3 * mm, ar(head))
        x -= w
    c.setFillColorRGB(0, 0, 0)
    return y - ROW_H


def _table_row(c, y, row, index, cols=None, shade=False) -> float:
    cols = cols or _COLS
    right = PAGE_W - MARGIN
    total_w = sum(cols)
    if shade:
        c.setFillColor(_STRIPE_C)
        c.rect(right - total_w, y - ROW_H, total_w, ROW_H, stroke=0, fill=1)
    elif index % 2 == 0:
        c.setFillColor(_LIGHT_BG)
        c.rect(right - total_w, y - ROW_H, total_w, ROW_H, stroke=0, fill=1)
    c.setStrokeColor(_BORDER_C)
    c.rect(right - total_w, y - ROW_H, total_w, ROW_H, stroke=1, fill=0)
    c.setFillColor(_c.black)
    debit = f"{row['debit']:,.3f}" if row["debit"] else "—"
    credit = f"{row['credit']:,.3f}" if row["credit"] else "—"
    desc_font = AR_FONT_BOLD if shade else AR_FONT
    values = [
        (row["date"], AR_FONT, 8.5),
        (row["description"], desc_font, 8.5),
        (row["ref"], AR_FONT, 8.5),
        (debit, AR_FONT, 9),
        (credit, AR_FONT, 9),
        (f"{row['balance']:,.3f}", AR_FONT_BOLD, 9),
    ]
    if len(cols) == 7:
        values.insert(1, (row.get("contract_number") or ("—" if row.get("kind") == "move" else ""), AR_FONT, 8))
    x = right
    for w, (val, font, size) in zip(cols, values):
        c.setFont(font, size)
        text = fit_pdf_text(c, str(val), font, size, w - 3 * mm)
        c.drawCentredString(x - w / 2, y - ROW_H + 3 * mm, text)
        x -= w
    return y - ROW_H




def _setup_colors():
    """تهيئة الألوان من الإعدادات (مشتركة بين كشفي العقد والعميل)."""
    global _PRIMARY, _ACCENT, _LIGHT_BG
    global _BORDER_C, _MUTED_C, _MUTED2_C, _STRIPE_C
    register_fonts()
    settings = settings_service.get_settings()
    _PRIMARY = hex_color(settings.invoice_primary, PRIMARY)
    _ACCENT = hex_color(settings.invoice_accent, ACCENT)
    _LIGHT_BG = light_tint(settings.invoice_primary)
    economy = bool(getattr(settings, "print_economy", False))
    _BORDER_C = BORDER
    _MUTED_C = _c.HexColor("#3d5568")
    _MUTED2_C = _c.HexColor("#7a8a99")
    _STRIPE_C = _c.HexColor("#d8e4ef")
    border_c = BORDER
    green_c, red_c = GREEN, RED
    if economy:
        _PRIMARY = _c.black
        _ACCENT = _c.black
        _LIGHT_BG = _c.white
        _BORDER_C = _c.black
        _MUTED_C = _c.black
        _MUTED2_C = _c.HexColor("#555555")
        _STRIPE_C = _c.white
        border_c = _c.black
        green_c = red_c = _c.black
    return settings, economy, border_c, green_c, red_c


def generate_statement_pdf(contract_id: int, out_path: str) -> str:
    global _PRIMARY, _ACCENT, _LIGHT_BG
    settings, _economy, border_c, green_c, red_c = _setup_colors()
    try:
        data = statement_service.build_statement(contract_id)
        customer = data["customer"]
        contract = data["contract"]
        cur = settings.currency
        right = PAGE_W - MARGIN
        left = MARGIN

        c = rl_canvas.Canvas(out_path, pagesize=A4)
        apply_pdf_metadata(c, f"Statement {contract.contract_number}")

        y = _header(c, settings, "كشف حساب عميل")

        # بطاقة بيانات العميل والعقد
        card_h = 32 * mm
        c.setFillColor(_LIGHT_BG)
        c.roundRect(left, y - card_h, PAGE_W - 2 * MARGIN, card_h, 3 * mm,
                    stroke=0, fill=1)
        c.setFillColor(_PRIMARY)
        c.setFont(AR_FONT_BOLD, 11)
        card_w = PAGE_W - 2 * MARGIN - 10 * mm
        c.drawRightString(right - 5 * mm, y - 7 * mm,
                          fit_pdf_text(c, f"العميل: {customer.name}  ({customer.customer_code})",
                                       AR_FONT_BOLD, 11, card_w))
        c.setFont(AR_FONT, 10)
        c.setFillColor(_MUTED_C)
        info = "   ".join(x for x in [
            f"هاتف: {customer.phone}" if customer.phone else "",
            customer.address] if x)
        if info:
            c.drawRightString(right - 5 * mm, y - 13.5 * mm,
                              fit_pdf_text(c, info, AR_FONT, 10, card_w))
        c.setFont(AR_FONT_BOLD, 10.5)
        c.setFillColor(_PRIMARY)
        c.drawRightString(
            right - 5 * mm, y - 21 * mm,
            fit_pdf_text(c, f"العقد: {contract.contract_number}  |  التاريخ: {contract.contract_date}"
                         f"  |  القيمة: {data['contract_amount']:,.3f} {cur}",
                         AR_FONT_BOLD, 10.5, card_w))
        if contract.description:
            c.setFont(AR_FONT, 9.2)
            c.setFillColor(_MUTED_C)
            c.drawRightString(
                right - 5 * mm, y - 27 * mm,
                fit_pdf_text(c, contract.description, AR_FONT, 9.2,
                             PAGE_W - 2 * MARGIN - 10 * mm))
        c.setFillColorRGB(0, 0, 0)
        y -= card_h + 7 * mm

        # جدول الحركة
        y = _table_header(c, y)
        for i, row in enumerate(data["rows"]):
            if y - ROW_H < 45 * mm:  # صفحة جديدة
                c.showPage()
                y = _header(c, settings, "كشف حساب عميل · تابع")
                y = _table_header(c, y)
            y = _table_row(c, y, row, i)

        # الإجماليات
        y -= 10 * mm
        if y < 55 * mm:
            c.showPage()
            y = _header(c, settings, "كشف حساب عميل · تابع")
            y -= 5 * mm

        box_w = 112 * mm
        box_h = 34 * mm
        box_x = left
        c.setFillColor(_LIGHT_BG)
        c.roundRect(box_x, y - box_h, box_w, box_h, 3 * mm, stroke=0, fill=1)
        c.setStrokeColor(border_c)
        c.roundRect(box_x, y - box_h, box_w, box_h, 3 * mm, stroke=1, fill=0)
        # فاصل بصري بين عمود الأرقام وعمود البيان لمنع أي تداخل.
        c.setStrokeColor(border_c)
        c.line(box_x + 43 * mm, y - 5 * mm, box_x + 43 * mm, y - box_h + 5 * mm)

        lines = [
            ("إجمالي المدين (العقد والإضافات)", data["total_debit"], _PRIMARY),
            ("إجمالي الدائن (المحصّل والخصومات)", data["total_credit"], _ACCENT),
            ("الرصيد المتبقي", data["remaining"],
             green_c if data["remaining"] >= 0 else red_c),
        ]
        ly = y - 9 * mm
        for label, value, color in lines:
            draw_label_value_row(
                c, box_x + 5 * mm, ly, box_w - 10 * mm,
                label, f"{value:,.3f} {cur}",
                AR_FONT, AR_FONT_BOLD, 10, color, _c.black,
                gap=8 * mm, value_width=38 * mm)
            ly -= 9 * mm

        # التذييل: صورة مخصصة أو نص
        from datetime import datetime
        footer_img = safe_image(settings.footer_image)
        if footer_img:
            draw_footer_image(c, PAGE_W, footer_img)
        else:
            c.setStrokeColor(border_c)
            c.line(left, 18 * mm, right, 18 * mm)
            c.setFont(AR_FONT, 8.5)
            c.setFillColor(_MUTED2_C)
            c.drawCentredString(
                PAGE_W / 2, 12 * mm,
                fit_pdf_text(c, f"تاريخ الإصدار: {datetime.now().strftime('%Y-%m-%d %H:%M')} · {settings.company_name}",
                             AR_FONT, 8.5, PAGE_W - 2 * MARGIN))

        c.save()
        return out_path
    except PDFError:
        raise
    except Exception as exc:
        raise PDFError(f"تعذر إنشاء ملف PDF لكشف الحساب: {exc}") from exc


def generate_customer_statement_pdf(customer_id: int, out_path: str,
                                    contract_id: int | None = None,
                                    date_from: str = "", date_to: str = "") -> str:
    """كشف العميل الشامل PDF: كل العقود (أو عقد مفلتر) + عمود العقد."""
    settings, _economy, border_c, green_c, red_c = _setup_colors()
    try:
        data = statement_service.build_customer_statement(
            customer_id, contract_id, date_from, date_to)
        customer = data["customer"]
        cur = settings.currency
        right = PAGE_W - MARGIN
        left = MARGIN

        c = rl_canvas.Canvas(out_path, pagesize=A4)
        apply_pdf_metadata(c, f"Customer statement {customer.customer_code}")

        title = "كشف حساب عميل — شامل"
        y = _header(c, settings, title)

        if contract_id and data["contract"] is not None:
            scope = f"العقد: {data['contract'].contract_number}"
        else:
            scope = f"كل العقود ({data['contracts_count']})"
        period = "الفترة: الكل"
        if date_from or date_to:
            period = f"الفترة: {date_from or '…'} ← {date_to or '…'}"

        card_h = 32 * mm
        c.setFillColor(_LIGHT_BG)
        c.roundRect(left, y - card_h, PAGE_W - 2 * MARGIN, card_h, 3 * mm,
                    stroke=0, fill=1)
        c.setFillColor(_PRIMARY)
        c.setFont(AR_FONT_BOLD, 11)
        card_w = PAGE_W - 2 * MARGIN - 10 * mm
        c.drawRightString(right - 5 * mm, y - 7 * mm,
                          fit_pdf_text(c, f"العميل: {customer.name}  ({customer.customer_code})",
                                       AR_FONT_BOLD, 11, card_w))
        c.setFont(AR_FONT, 10)
        c.setFillColor(_MUTED_C)
        info = "   ".join(x for x in [
            f"هاتف: {customer.phone}" if customer.phone else "",
            customer.address] if x)
        if info:
            c.drawRightString(right - 5 * mm, y - 13.5 * mm,
                              fit_pdf_text(c, info, AR_FONT, 10, card_w))
        c.setFont(AR_FONT_BOLD, 10.5)
        c.setFillColor(_PRIMARY)
        c.drawRightString(
            right - 5 * mm, y - 21 * mm,
            fit_pdf_text(c, f"النطاق: {scope}  |  {period}",
                         AR_FONT_BOLD, 10.5, card_w))
        c.setFillColorRGB(0, 0, 0)
        y -= card_h + 7 * mm

        y = _table_header(c, y, _COLS_FULL, _HEADS_FULL)
        for i, row in enumerate(data["rows"]):
            if y - ROW_H < 45 * mm:
                c.showPage()
                y = _header(c, settings, f"{title} · تابع")
                y = _table_header(c, y, _COLS_FULL, _HEADS_FULL)
            y = _table_row(c, y, row, i, _COLS_FULL,
                           shade=(row.get("kind", "move") != "move"))

        y -= 10 * mm
        if y < 60 * mm:
            c.showPage()
            y = _header(c, settings, f"{title} · تابع")
            y -= 5 * mm

        lines = [
            ("إجمالي المدين", data["total_debit"], _PRIMARY),
            ("إجمالي الدائن", data["total_credit"], _ACCENT),
            ("الرصيد المتبقي", data["remaining"],
             green_c if data["remaining"] >= 0 else red_c),
        ]
        if date_from:
            lines.insert(0, ("رصيد أول الفترة", data["opening"], _PRIMARY))
        box_w = 112 * mm
        box_h = (9 * len(lines) + 7) * mm
        box_x = left
        c.setFillColor(_LIGHT_BG)
        c.roundRect(box_x, y - box_h, box_w, box_h, 3 * mm, stroke=0, fill=1)
        c.setStrokeColor(border_c)
        c.roundRect(box_x, y - box_h, box_w, box_h, 3 * mm, stroke=1, fill=0)
        c.setStrokeColor(border_c)
        c.line(box_x + 43 * mm, y - 5 * mm, box_x + 43 * mm, y - box_h + 5 * mm)

        ly = y - 9 * mm
        for label, value, color in lines:
            draw_label_value_row(
                c, box_x + 5 * mm, ly, box_w - 10 * mm,
                label, f"{value:,.3f} {cur}",
                AR_FONT, AR_FONT_BOLD, 10, color, _c.black,
                gap=8 * mm, value_width=38 * mm)
            ly -= 9 * mm

        from datetime import datetime
        footer_img = safe_image(settings.footer_image)
        if footer_img:
            draw_footer_image(c, PAGE_W, footer_img)
        else:
            c.setStrokeColor(border_c)
            c.line(left, 18 * mm, right, 18 * mm)
            c.setFont(AR_FONT, 8.5)
            c.setFillColor(_MUTED2_C)
            c.drawCentredString(
                PAGE_W / 2, 12 * mm,
                fit_pdf_text(c, f"تاريخ الإصدار: {datetime.now().strftime('%Y-%m-%d %H:%M')} · {settings.company_name}",
                             AR_FONT, 8.5, PAGE_W - 2 * MARGIN))

        c.save()
        return out_path
    except PDFError:
        raise
    except Exception as exc:
        raise PDFError(f"تعذر إنشاء ملف PDF للكشف الشامل: {exc}") from exc
