# -*- coding: utf-8 -*-
"""سند صرف / قبض PDF · تصميم عصري ببطاقات دائرية مطابق للنموذج المرجعي."""
import base64
import hashlib
import re

from reportlab.lib import colors as _c
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas

from services import settings_service
from services.tafqeet import amount_to_words
from reports.pdf_utils import (apply_pdf_metadata, 
    ar, register_fonts, safe_logo, safe_image, draw_header_image,
    draw_footer_image, hex_color, light_tint, PDFError,
    AR_FONT, AR_FONT_BOLD, PRIMARY, ACCENT,
    get_transparent_stamp,
)

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm

_CARD_BG = _c.HexColor("#FFFFFF")
_PAGE_BG = _c.HexColor("#F4F5FA")
_LABEL = _c.HexColor("#8A93A6")
_DOTS = _c.HexColor("#C9D0DC")
_SHADOW = _c.HexColor("#E4E7EF")

_ECONOMY = {"on": False}


def _image_signature(raw):
    """بصمة MD5 لمحتوى الصورة (تدعم مسار ملف / Base64 / data-URI).

    تفيد في اكتشاف تطابق صورتين محفوظتين بصيغتين مختلفتين،
    مثل مسار في حقل و Base64 في الآخر.
    """
    if not raw:
        return None
    raw = str(raw).strip()
    if not raw:
        return None
    # إزالة بادئة data-URI إن وُجدت
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1].strip()
    # هل تبدو مسار ملف؟ (فواصل مجلدات أو امتداد)
    looks_like_path = ("/" in raw) or ("\\" in raw) or bool(re.search(r"\.\w{2,5}$", raw))
    if looks_like_path:
        try:
            with open(raw, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except OSError:
            return None
    # هل هي Base64 صالحة؟
    compact = re.sub(r"\s+", "", raw)
    if compact and len(compact) % 4 == 0 and re.fullmatch(r"[A-Za-z0-9+/]+=*", compact):
        try:
            return hashlib.md5(base64.b64decode(compact, validate=True)).hexdigest()
        except Exception:
            return None
    return None


def _wrap_text(c, text, font, size, max_w):
    """تقسيم النص إلى أسطر تتلاءم مع العرض المحدد بدقة (بعد التحويل العربي)."""
    text = str(text or "").strip()
    if not text:
        return []
    if c.stringWidth(ar(text), font, size) <= max_w:
        return [text]
    words = text.split()
    if not words:
        return []
    lines = []
    current_line = words[0]
    for word in words[1:]:
        trial_line = f"{current_line} {word}"
        if c.stringWidth(ar(trial_line), font, size) <= max_w:
            current_line = trial_line
        else:
            lines.append(current_line)
            current_line = word
    lines.append(current_line)
    return lines




def _clean_customer_text(text: str) -> str:
    """تنظيف النصوص المطبوعة من أي مراجع/أرقام داخلية لا تخص العميل."""
    cleaned = re.sub(r"(?<!\d)\b\d+\.\s*(?=الدفعة)", "", str(text or ""))
    cleaned = re.sub(r"\[\s*تحويل\s+مجمع\s*:\s*BT-\d+\s*\]\s*(?:سطر\s*\d+\s*من\s*\d+)?", "", cleaned)
    cleaned = re.sub(r"تحويل\s+بنكي\s+مجمع\s*BT-\d+", "", cleaned)
    cleaned = re.sub(r"BT-\d+", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()

def _card(c, x, y, w, h, radius=4.5 * mm, fill=_CARD_BG, dashed=False, border=None):
    if _ECONOMY["on"]:
        c.setFillColor(_c.white)
        c.setStrokeColor(_c.black)
        c.setLineWidth(0.8)
        if dashed:
            c.setDash(2.2, 2.2)
            c.roundRect(x, y, w, h, radius, stroke=1, fill=0)
            c.setDash()
        else:
            c.roundRect(x, y, w, h, radius, stroke=1, fill=0)
        return
    c.setFillColor(_SHADOW)
    c.roundRect(x + 0.6 * mm, y - 0.9 * mm, w, h, radius, stroke=0, fill=1)
    c.setFillColor(fill)
    if dashed:
        c.setDash(2.2, 2.2)
        c.setStrokeColor(border or _DOTS)
        c.setLineWidth(1)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)
        c.setDash()
    elif border:
        c.setStrokeColor(border)
        c.setLineWidth(1)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)
    else:
        c.roundRect(x, y, w, h, radius, stroke=0, fill=1)


def _dotted_line(c, x1, x2, y):
    c.setDash(1.5, 2.5)
    c.setStrokeColor(_c.HexColor("#999999") if _ECONOMY["on"] else _DOTS)
    c.setLineWidth(1)
    c.line(x1, y, x2, y)
    c.setDash()


def generate_voucher_pdf(voucher: dict, out_path: str) -> str:
    try:
        register_fonts()
        settings = settings_service.get_settings()
        economy = bool(getattr(settings, "print_economy", False))
        _ECONOMY["on"] = economy
        primary = hex_color(settings.invoice_primary, PRIMARY)
        accent = hex_color(settings.invoice_accent, ACCENT)
        if economy:
            primary = _c.black
            accent = _c.black
        cur = settings.currency
        right = PAGE_W - MARGIN
        left = MARGIN
        content_w = PAGE_W - 2 * MARGIN
        is_receipt = voucher["vtype"] == "receipt"
        title = "سند قبض" if is_receipt else "سند صرف"
        title_en = "RECEIPT VOUCHER" if is_receipt else "PAYMENT VOUCHER"

        # ===== القيم الخام للصور (للمقارنة الصحيحة قبل التحويل) =====
        stamp_raw = getattr(settings, "stamp_image", "") or ""
        footer_raw = getattr(settings, "footer_image", "") or ""

        c = rl_canvas.Canvas(out_path, pagesize=A4)
        apply_pdf_metadata(c, f"{voucher['voucher_number']}")

        if not economy:
            c.setFillColor(_PAGE_BG)
            c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

        header_img = safe_image(settings.header_image)
        if header_img:
            header_h = draw_header_image(c, PAGE_W, PAGE_H, header_img)
            y = PAGE_H - header_h - 10 * mm
        else:
            c.setFillColor(_c.black)
            c.setFont(AR_FONT_BOLD, 11)
            c.drawCentredString(PAGE_W / 2, PAGE_H - 12 * mm, ar(settings.company_name or ""))
            c.setStrokeColor(_c.HexColor("#E2E6EF"))
            c.setLineWidth(0.8)
            c.line(left, PAGE_H - 16 * mm, right, PAGE_H - 16 * mm)
            y = PAGE_H - 24 * mm

        bar_color = _c.black if economy else (primary if is_receipt else accent)
        c.setFillColor(bar_color)
        c.roundRect(right - 2.2 * mm, y - 16 * mm, 2.2 * mm, 13 * mm, 1 * mm, stroke=0, fill=1)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 26)
        c.drawRightString(right - 5 * mm, y - 8 * mm, ar(title))
        c.setFillColor(_c.black)
        c.setFont(AR_FONT, 9)
        c.drawRightString(right - 5 * mm, y - 14 * mm, title_en)
        logo_size = 20 * mm
        logo = safe_logo(settings.logo_path)
        if logo:
            try:
                c.drawImage(logo, left, y - 17 * mm, width=logo_size, height=logo_size, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
        y -= 24 * mm

        card_h = 20 * mm
        gap = 5 * mm
        half = (content_w - gap) / 2
        _card(c, right - half, y - card_h, half, card_h)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT, 9)
        c.drawRightString(right - 7 * mm, y - 7.5 * mm, ar("رقم السند"))
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 14)
        c.drawRightString(right - 7 * mm, y - 15 * mm, voucher["voucher_number"])
        _card(c, left, y - card_h, half, card_h)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT, 9)
        c.drawCentredString(left + half / 2, y - 7.5 * mm, ar("التاريخ"))
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 13)
        c.drawCentredString(left + half / 2, y - 15 * mm, voucher["vdate"])
        y -= card_h + 7 * mm

        # ===== بطاقة الحقول الرئيسية =====
        # البيان مطبوع للعميل على 3 أسطر مسطرة، مع الحفاظ على باقي التصميم.
        party_text = _clean_customer_text(voucher.get("party") or "")
        desc_text = _clean_customer_text(voucher.get("description") or "")
        line_h = 6.2 * mm
        padding_top = 8 * mm
        padding_bottom = 5 * mm
        gap_between_fields = 4 * mm
        party_lines_n = 1
        desc_lines_n = 3
        fields_h = (party_lines_n + desc_lines_n) * line_h + padding_top + padding_bottom + gap_between_fields

        _card(c, left, y - fields_h, content_w, fields_h)
        fy = y - padding_top

        def _draw_ruled_field(label: str, value: str, lines_count: int, top_y: float):
            c.setFillColor(_c.black)
            c.setFont(AR_FONT_BOLD, 11.5)
            c.drawRightString(right - 8 * mm, top_y, ar(label))
            label_w = c.stringWidth(ar(label), AR_FONT_BOLD, 11.5)
            value_right = right - 8 * mm - label_w - 6 * mm
            max_w = value_right - (left + 8 * mm)
            lines = _wrap_text(c, value, AR_FONT, 11, max_w)[:lines_count]
            while len(lines) < lines_count:
                lines.append("")
            c.setFillColor(_c.black)
            c.setFont(AR_FONT, 11)
            ly = top_y
            for line in lines:
                if line:
                    c.drawRightString(value_right, ly, ar(line))
                _dotted_line(c, left + 8 * mm, value_right + 2 * mm, ly - 2.1 * mm)
                ly -= line_h
            return ly

        fy = _draw_ruled_field(
            "استلمنا من السيد / السادة" if is_receipt else "يُصرف إلى السيد / السادة",
            party_text, 1, fy)
        fy -= gap_between_fields
        _draw_ruled_field("وذلك عن", desc_text, 3, fy)
        y -= fields_h + 7 * mm

        # ===== شريط المبلغ المودرن =====
        amount_h = 24 * mm
        if economy:
            c.setStrokeColor(_c.black)
            c.setLineWidth(1.4)
            c.roundRect(left, y - amount_h, content_w, amount_h, 4 * mm, stroke=1, fill=0)
            label_color = _c.black
            num_color = _c.black
            divider_color = _c.black
        else:
            band = light_tint(settings.invoice_primary)
            c.setFillColor(band)
            c.roundRect(left, y - amount_h, content_w, amount_h, 4 * mm, stroke=0, fill=1)
            c.setFillColor(primary)
            c.roundRect(right - 2.2 * mm, y - amount_h + 3 * mm, 2.2 * mm, amount_h - 6 * mm, 1 * mm, stroke=0, fill=1)
            label_color = primary
            num_color = primary
            divider_color = accent

        c.setFillColor(label_color)
        c.setFont(AR_FONT, 9)
        c.drawRightString(right - 7 * mm, y - 7 * mm, ar("المبلغ"))
        c.setFillColor(num_color)
        c.setFont(AR_FONT_BOLD, 22)
        amount_text = f"{voucher['amount']:,.3f}"
        c.drawRightString(right - 7 * mm, y - 17.5 * mm, amount_text)
        amount_w = c.stringWidth(amount_text, AR_FONT_BOLD, 22)
        c.setFillColor(label_color)
        c.setFont(AR_FONT_BOLD, 10)
        c.drawRightString(right - 7 * mm - amount_w - 3 * mm, y - 17.5 * mm, ar(cur))
        
        div_x = right - content_w * 0.42
        c.setStrokeColor(divider_color)
        c.setLineWidth(0.7)
        c.line(div_x, y - amount_h + 4 * mm, div_x, y - 4 * mm)
        
        c.setFillColor(label_color)
        c.setFont(AR_FONT, 8.5)
        c.drawRightString(div_x - 4 * mm, y - 7 * mm, ar("المبلغ كتابةً"))
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 9.5)
        tafqeet_text = amount_to_words(float(voucher["amount"]), cur)
        c.drawRightString(div_x - 4 * mm, y - 15 * mm, ar(tafqeet_text)[:80])
        y -= amount_h + 8 * mm

        selected = voucher.get("method") or "نقدًا"
        pill_h = 12 * mm
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 11.5)
        c.drawRightString(right, y - pill_h + 4 * mm, ar("طريقة الدفع:"))
        label_w = c.stringWidth(ar("طريقة الدفع:"), AR_FONT_BOLD, 11.5)
        pill_w = max(36 * mm, c.stringWidth(ar(selected), AR_FONT_BOLD, 11) + 16 * mm)
        px = right - label_w - 8 * mm - pill_w
        if not economy:
            c.setFillColor(_SHADOW)
            c.roundRect(px + 0.5 * mm, y - pill_h + 0.3 * mm, pill_w, pill_h - 2 * mm, 3 * mm, stroke=0, fill=1)
        c.setFillColor(_c.white)
        c.setStrokeColor(_c.black if economy else accent)
        c.setLineWidth(1.1)
        c.roundRect(px, y - pill_h + 1 * mm, pill_w, pill_h - 2 * mm, 3 * mm, stroke=1, fill=1)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 11)
        c.drawCentredString(px + pill_w / 2, y - pill_h + 4.6 * mm, ar(selected))
        y -= pill_h + 7 * mm

        # ===== الملاحظات =====
        # الملاحظات على سطرين مسطرين دائمًا.
        notes = _clean_customer_text(voucher.get("notes") or "")
        c.setFont(AR_FONT_BOLD, 11)
        notes_label_w = c.stringWidth(ar("ملاحظات"), AR_FONT_BOLD, 11)
        notes_right = right - 8 * mm - notes_label_w - 6 * mm
        max_notes_w = notes_right - (left + 8 * mm)
        notes_lines = _wrap_text(c, notes, AR_FONT, 10.5, max_notes_w)[:2]
        while len(notes_lines) < 2:
            notes_lines.append("")
        notes_line_h = 5.8 * mm
        notes_h = 9 * mm + (2 * notes_line_h)
        _card(c, left, y - notes_h, content_w, notes_h)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 11)
        c.drawRightString(right - 8 * mm, y - 7.5 * mm, ar("ملاحظات"))
        c.setFillColor(_c.black)
        c.setFont(AR_FONT, 10.5)
        ny = y - 7.5 * mm
        for line in notes_lines:
            if line:
                c.drawRightString(notes_right, ny, ar(line))
            _dotted_line(c, left + 8 * mm, notes_right + 2 * mm, ny - 2 * mm)
            ny -= notes_line_h
        y -= notes_h + 3 * mm

        # ===== الختم الكبير (بلا مربع ولا توقيع) في أسفل الصفحة =====
        stamp_bytes = get_transparent_stamp(stamp_raw)
        
        stamp_size = float(getattr(settings, "stamp_size_mm", 0) or 0) or 55
        stamp_w = stamp_size * mm
        # شاشة التحريك تحفظ إزاحة من الموضع الافتراضي لا إحداثيًا مطلقًا؛
        # هذا يمنع نزول الختم لأسفل جدًا عند إدخال رقم صغير للتحريك.
        default_cx = PAGE_W / 2
        default_cy = 35 * mm + stamp_w / 2
        stamp_cx = default_cx + float(getattr(settings, "stamp_x_mm", 0) or 0) * mm
        stamp_cy = default_cy + float(getattr(settings, "stamp_y_mm", 0) or 0) * mm
        _half = stamp_w / 2
        stamp_cx = max(_half + 5 * mm, min(PAGE_W - _half - 5 * mm, stamp_cx))
        stamp_cy = max(_half + 5 * mm, min(PAGE_H - _half - 5 * mm, stamp_cy))
        stamp_x = stamp_cx - _half
        stamp_y = stamp_cy - _half
        
        if stamp_bytes and not economy:
            try:
                stamp_img_reader = ImageReader(stamp_bytes)
                c.drawImage(stamp_img_reader, stamp_x, stamp_y, width=stamp_w, height=stamp_w, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
        elif not stamp_bytes:
            c.setFillColor(_c.HexColor("#9aa8b8"))
            c.setFont(AR_FONT, 9)
            c.drawCentredString(stamp_cx, stamp_cy, ar("(مكان ختم الشركة)"))

        # ===== الفوتر =====
        # مقارنة صحيحة: نقارن القيم الخام + بصمة المحتوى (وليس ImageReader مع نص)
        footer_img = safe_image(footer_raw)
        footer_sig = _image_signature(footer_raw)
        stamp_sig = _image_signature(stamp_raw)
        same_as_stamp = bool(footer_raw) and bool(stamp_raw) and (
            footer_raw == stamp_raw
            or (footer_sig is not None and footer_sig == stamp_sig)
        )

        if footer_img and not same_as_stamp:
            draw_footer_image(c, PAGE_W, footer_img)
        else:
            c.setFillColor(_c.black)
            c.setFont(AR_FONT, 8.5)
            c.drawRightString(right, 8 * mm, ar("سند صادر إلكترونيًا ومعتمد رقميًا"))
            c.drawString(left, 8 * mm, "v1.0")

        c.save()
        return out_path
    except PDFError:
        raise
    except Exception as exc:
        raise PDFError(f"تعذر إنشاء السند PDF: {exc}") from exc
