# -*- coding: utf-8 -*-
"""كشف تصفية العهدة — PDF جدولي كامل قابل للطباعة.

يطبع كشفًا رسميًا لتصفية عهدة واحدة:
  · ترويسة الشركة وعنوان الكشف ومرجعه
  · بيانات العهدة (الحساب · المستلم · التاريخ · طريقة الدفع)
  · جدول بنود المصروف بترقيم متسلسل
  · الموازنة: المُسلَّم − المُنفَق = المتبقي أو المسترد
  · سطر التوقيعات وترقيم الصفحات
"""
from datetime import datetime

from services import settings_service


def _require_pdf():
    try:
        from reportlab.lib import colors as _c
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas as rl_canvas
        from reports.pdf_utils import (
            apply_pdf_metadata, ar, register_fonts, hex_color, light_tint,
            PDFError, AR_FONT, AR_FONT_BOLD, PRIMARY, ACCENT, GREEN, RED,
            safe_image, draw_header_image, draw_footer_image,
            footer_image_height,
        )
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            f"مكتبة {exc.name or 'reportlab'} غير مثبتة. "
            "شغّل INSTALL.bat أو ثبّت المتطلبات من requirements.txt."
        ) from exc
    return {
        "_c": _c, "A4": A4, "landscape": landscape, "mm": mm,
        "rl_canvas": rl_canvas, "apply_pdf_metadata": apply_pdf_metadata,
        "ar": ar, "register_fonts": register_fonts, "hex_color": hex_color,
        "light_tint": light_tint, "PDFError": PDFError, "AR_FONT": AR_FONT,
        "AR_FONT_BOLD": AR_FONT_BOLD, "PRIMARY": PRIMARY, "ACCENT": ACCENT,
        "GREEN": GREEN, "RED": RED, "safe_image": safe_image,
        "draw_header_image": draw_header_image,
        "draw_footer_image": draw_footer_image,
        "footer_image_height": footer_image_height,
    }


#: أعمدة جدول البنود: (العنوان، العرض بالمليمتر، المحاذاة)
#: البيان أوسع عمود لأنه يحمل شرحًا مكتوبًا أو نصًا طويلًا.
#: جدول مبسّط (6 أعمدة) بالاتجاه الطولي — البيان أوسعها ويستوعب
#: حساب المصروف بين قوسين حتى لا تضيع المعلومة المحاسبية.
_COLS = [
    ("م", 8, "c"),
    ("التاريخ", 20, "c"),
    ("المستفيد", 34, "r"),
    ("العقد / المشروع", 30, "r"),
    ("البيان", 66, "r"),
    ("المبلغ", 22, "c"),
]

#: فهرس عمود البيان — يُلفّ على سطرين عند الحاجة بدل القص.
_WRAP_COL = 4


def generate_custody_pdf(data: dict, out_path: str,
                         orientation: str = "portrait") -> str:
    """توليد كشف تصفية عهدة.

    ``data`` من ``lifecycle_service.custody_settlement(group_ref)``.
    """
    pdf = _require_pdf()
    _c, mm, ar = pdf["_c"], pdf["mm"], pdf["ar"]
    AR_FONT, AR_FONT_BOLD = pdf["AR_FONT"], pdf["AR_FONT_BOLD"]

    if not data or not data.get("lines"):
        raise pdf["PDFError"]("لا توجد بنود لطباعتها في هذه التصفية.")

    portrait = str(orientation).lower().startswith("port")
    PAGE_W, PAGE_H = (pdf["A4"] if portrait
                      else pdf["landscape"](pdf["A4"]))
    MARGIN = 12 * mm
    ROW_H = 8 * mm           # يتسع ~20 صفًا في الصفحة الواحدة
    F_CELL, F_HEAD = (9.0, 9.5) if portrait else (10.0, 10.5)

    pdf["register_fonts"]()
    s = settings_service.get_settings()
    economy = bool(getattr(s, "print_economy", False))
    primary = pdf["hex_color"](s.invoice_primary, pdf["PRIMARY"])
    accent = pdf["hex_color"](s.invoice_accent, pdf["ACCENT"])
    light = pdf["light_tint"](s.invoice_primary)
    border = _c.HexColor("#9FB3C8")
    GREEN, RED = pdf["GREEN"], pdf["RED"]
    # الوضع الاقتصادي: أشرطة بيضاء بنص أسود (بدل شريط أسود داكن)
    bar_text = _c.white
    if economy:
        primary = accent = _c.white
        border = _c.black
        light = _c.white
        bar_text = _c.black

    right, left = PAGE_W - MARGIN, MARGIN
    avail = right - left
    scale = avail / (sum(w for _h, w, _a in _COLS) * mm)
    cols = [w * mm * scale for _h, w, _a in _COLS]
    total_w = sum(cols)

    _footer_ref = [None]
    _draw_footer_ref = [None]

    class _Canvas(pdf["rl_canvas"].Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved) + 1
            self._saved.append(dict(self.__dict__))
            for st in self._saved:
                self.__dict__.update(st)
                _fh = 0.0
                if _footer_ref[0]:
                    try:
                        _fh = _draw_footer_ref[0](self, PAGE_W, _footer_ref[0]) or 0.0
                    except Exception:
                        pass
                self.setFillColor(_c.black)
                self.setFont(AR_FONT, 8)
                # V4.33: الرقم فوق شريط الفوتر لا عليه (8مم فقط بلا صورة).
                _num_y = (_fh + 3.5 * mm) if _fh else 8 * mm
                self.drawCentredString(
                    PAGE_W / 2, _num_y,
                    ar(f"صفحة رقم {self._pageNumber} من {total}"))
                super().showPage()
            super().save()

    c = _Canvas(out_path, pagesize=(PAGE_W, PAGE_H))
    pdf["apply_pdf_metadata"](c, "كشف تصفية عهدة")

    def fit(text, font, size, width, floor=6.0):
        while size > floor and c.stringWidth(text, font, size) > width:
            size -= 0.25
        return size

    _hdr_img = pdf["safe_image"](getattr(s, "header_image", "") or "")
    _ftr_img = pdf["safe_image"](getattr(s, "footer_image", "") or "")
    _footer_ref[0] = _ftr_img
    _draw_footer_ref[0] = pdf["draw_footer_image"]
    # V4.33: حجز شريط الفوتر + رقم الصفحة — المحتوى يتوقف فوقهما.
    _footer_h = 0.0
    if _ftr_img:
        try:
            _footer_h = pdf["footer_image_height"](PAGE_W, _ftr_img) or 0.0
        except Exception:
            _footer_h = 0.0
    _band = _footer_h + 8 * mm if _footer_h else 0.0

    def header():
        """ترويسة موحّدة: صورة الشركة المرفوعة إن وُجدت وإلا الشريط النصي."""
        if _hdr_img:
            h = pdf["draw_header_image"](c, PAGE_W, PAGE_H, _hdr_img)
            y0 = PAGE_H - h - 4 * mm
            c.setFillColor(_c.black)
            c.setFont(AR_FONT_BOLD, 12)
            c.drawRightString(right, y0, ar("كشف تصفية عهدة"))
            c.setFont(AR_FONT, 9)
            c.drawString(left, y0, ar(f"المرجع: {data.get('group_ref','')}"))
            return y0 - 7 * mm
        c.setFillColor(primary)
        c.rect(0, PAGE_H - 26 * mm, PAGE_W, 26 * mm, stroke=0, fill=1)
        c.setFillColor(bar_text)
        c.setFont(AR_FONT_BOLD, 14)
        c.drawRightString(right, PAGE_H - 11 * mm, ar(s.company_name or ""))
        c.setFont(AR_FONT_BOLD, 12)
        c.drawRightString(right, PAGE_H - 20 * mm, ar("كشف تصفية عهدة"))
        c.setFont(AR_FONT, 9)
        c.drawString(left, PAGE_H - 12 * mm,
                     ar(f"المرجع: {data.get('group_ref','')}"))
        c.drawString(left, PAGE_H - 20 * mm,
                     ar("تاريخ الطباعة: "
                        + datetime.now().strftime("%Y-%m-%d %H:%M")))
        return PAGE_H - 32 * mm

    def info_box(y):
        """بيانات العهدة في صندوق واضح."""
        h = 16 * mm
        c.setFillColor(light)
        c.setStrokeColor(border)
        c.rect(left, y - h, avail, h, stroke=1, fill=1)
        c.setFillColor(_c.black)
        pairs = [
            ("حساب العهدة", data.get("custody_account") or "—"),
            ("المستلم", data.get("holder") or "—"),
            ("تاريخ التصفية", data.get("vdate") or "—"),
        ]
        cw = avail / len(pairs)
        x = right
        for label, val in pairs:
            c.setFont(AR_FONT, 8.5)
            c.setFillColor(_c.HexColor("#64748B"))
            c.drawRightString(x - 3 * mm, y - 6 * mm, ar(label))
            c.setFont(AR_FONT_BOLD, 10)
            c.setFillColor(_c.black)
            t = ar(str(val))
            c.setFont(AR_FONT_BOLD, fit(t, AR_FONT_BOLD, 10, cw - 6 * mm))
            c.drawRightString(x - 3 * mm, y - 12.5 * mm, t)
            x -= cw
        return y - h - 5 * mm

    def table_head(y):
        hh = ROW_H * 1.15
        c.setFillColor(primary)
        c.rect(right - total_w, y - hh, total_w, hh, stroke=0, fill=1)
        c.setFillColor(bar_text)
        x = right
        for (head, _w, _a), w in zip(_COLS, cols):
            t = ar(head)
            c.setFont(AR_FONT_BOLD, fit(t, AR_FONT_BOLD, F_HEAD, w - 2 * mm))
            c.drawCentredString(x - w / 2, y - hh + 3.2 * mm, t)
            x -= w
        return y - hh

    y = header()
    y = info_box(y)
    y = table_head(y)

    lines = data.get("lines") or []
    idx = 0
    for row in lines:
        if y - ROW_H < max(42 * mm, _band):
            c.showPage()
            y = header()
            y = table_head(y)
        idx += 1
        cancelled = bool(row.get("cancelled"))
        if idx % 2 == 0 and not economy:
            c.setFillColor(light)
            c.rect(right - total_w, y - ROW_H, total_w, ROW_H,
                   stroke=0, fill=1)
        c.setStrokeColor(border)
        c.rect(right - total_w, y - ROW_H, total_w, ROW_H, stroke=1, fill=0)
        _acct = (row.get("expense_account_snapshot")
                 or row.get("account") or "").strip()
        _desc = (row.get("description") or "").strip()
        if _acct:
            _desc = f"{_desc} ({_acct})" if _desc else f"({_acct})"
        _con = (row.get("contract_label")
                or row.get("contract_number") or "").strip()
        _cc = (row.get("contract_customer_name") or "").strip()
        if _cc and _con:
            _con = f"{_cc} — {_con}"
        vals = [
            str(idx),
            row.get("vdate") or "",
            row.get("party") or "—",
            _con or "—",
            _desc or "—",
            f"{float(row.get('amount') or 0):,.3f}",
        ]
        x = right
        for ci, ((_h, _w, align), w, val) in enumerate(
                zip(_COLS, cols, vals)):
            is_amount = (_h == "المبلغ")
            c.setFillColor(RED if cancelled else _c.black)
            font = AR_FONT_BOLD if is_amount else AR_FONT
            size = F_CELL
            t = ar(str(val))
            room = w - 3 * mm
            # عمود البيان: يُلفّ على سطرين بدل القص لأن النص طويل عادةً
            if ci == _WRAP_COL and c.stringWidth(t, font, size) > room:
                line1, line2 = "", ""
                for wd in str(val).split():
                    trial = (line1 + " " + wd).strip()
                    if c.stringWidth(ar(trial), font, size - 1) <= room:
                        line1 = trial
                    else:
                        line2 = (line2 + " " + wd).strip()
                if line2:
                    l2 = ar(line2)
                    if c.stringWidth(l2, font, size - 1) > room:
                        while (c.stringWidth(l2 + "…", font, size - 1) > room
                               and len(l2) > 2):
                            l2 = l2[:-1]
                        l2 += "…"
                    c.setFont(font, size - 1)
                    c.drawRightString(x - 2.5 * mm,
                                      y - ROW_H + 5.8 * mm, ar(line1))
                    c.drawRightString(x - 2.5 * mm,
                                      y - ROW_H + 1.8 * mm, l2)
                    x -= w
                    continue
            if c.stringWidth(t, font, size) > room:
                if is_amount:
                    size = fit(t, font, size, room, 5.5)
                else:
                    size = fit(t, font, size, room, max(6.0, F_CELL - 2))
                    if c.stringWidth(t, font, size) > room:
                        while (c.stringWidth(t + "…", font, size) > room
                               and len(t) > 2):
                            t = t[:-1]
                        t += "…"
            c.setFont(font, size)
            if align == "r":
                c.drawRightString(x - 2.5 * mm, y - ROW_H + 3.2 * mm, t)
            else:
                c.drawCentredString(x - w / 2, y - ROW_H + 3.2 * mm, t)
            x -= w
        if cancelled:
            c.setStrokeColor(RED)
            c.line(right - total_w + 2, y - ROW_H / 2,
                   right - 2, y - ROW_H / 2)
        y -= ROW_H

    # ---------- الموازنة ----------
    if y - 40 * mm < max(20 * mm, _band):
        c.showPage()
        y = header()
    y -= 4 * mm
    handed = float(data.get("handed") or 0)
    spent = float(data.get("spent") or 0)
    balance = float(data.get("balance") or 0)

    # إجمالي المصروف بعرض الجدول
    c.setFillColor(accent)
    c.rect(right - total_w, y - ROW_H, total_w, ROW_H, stroke=0, fill=1)
    c.setFillColor(bar_text)
    c.setFont(AR_FONT_BOLD, F_HEAD + 0.5)
    c.drawRightString(right - 4 * mm, y - ROW_H + 3.2 * mm,
                      ar(f"إجمالي المصروف من العهدة ({data.get('active_count', 0)} بند)"))
    c.drawString(left + 4 * mm, y - ROW_H + 3.2 * mm,
                 ar(f"{spent:,.3f}"))
    y -= ROW_H + 5 * mm

    rows_sum = [
        ("المبلغ المُسلَّم للعهدة", handed, None),
        ("المصروف الفعلي (حسب البنود أعلاه)", spent, None),
        ("المتبقي لدى المستلم" if balance >= 0
         else "مستحق للمستلم (صرف زيادة)",
         abs(balance), GREEN if balance >= 0 else RED),
    ]
    box_w = min(avail, 110 * mm)
    for i, (label, val, color) in enumerate(rows_sum):
        last = (i == len(rows_sum) - 1)
        c.setStrokeColor(border)
        c.setFillColor(light if not last else _c.HexColor("#EEF4FB"))
        c.rect(right - box_w, y - ROW_H, box_w, ROW_H,
               stroke=1, fill=0 if economy else 1)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD if last else AR_FONT, F_CELL + (0.5 if last else 0))
        c.drawRightString(right - 4 * mm, y - ROW_H + 3.2 * mm, ar(label))
        c.setFillColor(color or _c.black)
        c.setFont(AR_FONT_BOLD, F_CELL + (1 if last else 0))
        c.drawString(right - box_w + 4 * mm, y - ROW_H + 3.2 * mm,
                     ar(f"{val:,.3f}"))
        y -= ROW_H
    if data.get("cancelled_count"):
        y -= 4 * mm
        c.setFillColor(RED)
        c.setFont(AR_FONT, 9)
        c.drawRightString(right, y,
                          ar(f"ملاحظة: {data['cancelled_count']} بند ملغى "
                             "مستثنى من الإجمالي (يظهر مشطوبًا أعلاه)."))
        y -= 5 * mm

    # ---------- التوقيعات ----------
    if y - 26 * mm < max(16 * mm, _band):
        c.showPage()
        y = header()
    y -= 12 * mm
    c.setFillColor(_c.black)
    c.setFont(AR_FONT_BOLD, 10)
    slots = ["المستلم", "المحاسب", "المدير"]
    sw = avail / len(slots)
    x = right
    for name in slots:
        c.setStrokeColor(_c.black)
        c.line(x - sw + 12 * mm, y, x - 12 * mm, y)
        c.drawCentredString(x - sw / 2, y - 6 * mm, ar(name))
        x -= sw

    c.save()
    return out_path

# ============================================================
# التقرير الشامل: كل العُهد وكل التصفيات (وارد ومنصرف)
# ============================================================
def generate_custody_overview_pdf(data: dict, out_path: str,
                                  orientation: str = "landscape") -> str:
    """تقرير شامل للعُهد: أرصدة الحسابات + الوارد + كل التصفيات.

    ``data`` من ``lifecycle_service.custody_overview(...)``.
    """
    pdf = _require_pdf()
    _c, mm, ar = pdf["_c"], pdf["mm"], pdf["ar"]
    AR_FONT, AR_FONT_BOLD = pdf["AR_FONT"], pdf["AR_FONT_BOLD"]

    portrait = str(orientation).lower().startswith("port")
    PAGE_W, PAGE_H = (pdf["A4"] if portrait else pdf["landscape"](pdf["A4"]))
    MARGIN = 12 * mm
    ROW_H = 9.5 * mm
    F_CELL, F_HEAD = (9.0, 9.5) if portrait else (10.0, 10.5)

    pdf["register_fonts"]()
    s = settings_service.get_settings()
    economy = bool(getattr(s, "print_economy", False))
    primary = pdf["hex_color"](s.invoice_primary, pdf["PRIMARY"])
    accent = pdf["hex_color"](s.invoice_accent, pdf["ACCENT"])
    light = pdf["light_tint"](s.invoice_primary)
    border = _c.HexColor("#9FB3C8")
    GREEN, RED = pdf["GREEN"], pdf["RED"]
    # الوضع الاقتصادي: أشرطة بيضاء بنص أسود (بدل شريط أسود داكن)
    bar_text = _c.white
    if economy:
        primary = accent = _c.white
        border = _c.black
        light = _c.white
        bar_text = _c.black

    right, left = PAGE_W - MARGIN, MARGIN
    avail = right - left

    class _Canvas(pdf["rl_canvas"].Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved) + 1
            self._saved.append(dict(self.__dict__))
            for st in self._saved:
                self.__dict__.update(st)
                self.setFillColor(_c.black)
                self.setFont(AR_FONT, 8)
                self.drawCentredString(
                    PAGE_W / 2, 8 * mm,
                    ar(f"صفحة رقم {self._pageNumber} من {total}"))
                super().showPage()
            super().save()

    c = _Canvas(out_path, pagesize=(PAGE_W, PAGE_H))
    pdf["apply_pdf_metadata"](c, "تقرير العُهد الشامل")

    def fit(text, font, size, width, floor=6.0):
        while size > floor and c.stringWidth(text, font, size) > width:
            size -= 0.25
        return size

    d1 = data.get("date_from") or ""
    d2 = data.get("date_to") or ""
    period = (f"من {d1} إلى {d2}" if d1 or d2 else "كل الفترات")

    def header():
        c.setFillColor(primary)
        c.rect(0, PAGE_H - 26 * mm, PAGE_W, 26 * mm, stroke=0, fill=1)
        c.setFillColor(bar_text)
        c.setFont(AR_FONT_BOLD, 14)
        c.drawRightString(right, PAGE_H - 11 * mm, ar(s.company_name or ""))
        c.setFont(AR_FONT_BOLD, 12)
        c.drawRightString(right, PAGE_H - 20 * mm,
                          ar("تقرير العُهد الشامل — الوارد والمنصرف"))
        c.setFont(AR_FONT, 9)
        c.drawString(left, PAGE_H - 12 * mm, ar(f"الفترة: {period}"))
        c.drawString(left, PAGE_H - 20 * mm,
                     ar("تاريخ الطباعة: "
                        + datetime.now().strftime("%Y-%m-%d %H:%M")))
        return PAGE_H - 32 * mm

    def section(y, text):
        if y - 14 * mm < 22 * mm:
            c.showPage()
            y = header()
        c.setFillColor(accent)
        c.rect(right - avail, y - 8 * mm, avail, 8 * mm, stroke=0, fill=1)
        c.setFillColor(bar_text)
        c.setFont(AR_FONT_BOLD, F_HEAD + 0.5)
        c.drawRightString(right - 3 * mm, y - 5.8 * mm, ar(text))
        return y - 8 * mm - 2 * mm

    def table(y, cols, rows, totals=None, color_last=False):
        """رسم جدول: cols=[(عنوان, عرض_مم, محاذاة)] · rows=قوائم نصوص."""
        scale = avail / (sum(w for _h, w, _a in cols) * mm)
        widths = [w * mm * scale for _h, w, _a in cols]
        total_w = sum(widths)

        def head(yy):
            hh = ROW_H * 1.1
            c.setFillColor(primary)
            c.rect(right - total_w, yy - hh, total_w, hh, stroke=0, fill=1)
            c.setFillColor(bar_text)
            x = right
            for (h, _w, _a), w in zip(cols, widths):
                t = ar(h)
                c.setFont(AR_FONT_BOLD,
                          fit(t, AR_FONT_BOLD, F_HEAD, w - 2 * mm))
                c.drawCentredString(x - w / 2, yy - hh + 3.1 * mm, t)
                x -= w
            return yy - hh

        y = head(y)
        for i, row in enumerate(rows, 1):
            if y - ROW_H < 22 * mm:
                c.showPage()
                y = header()
                y = head(y)
            if i % 2 == 0 and not economy:
                c.setFillColor(light)
                c.rect(right - total_w, y - ROW_H, total_w, ROW_H,
                       stroke=0, fill=1)
            c.setStrokeColor(border)
            c.rect(right - total_w, y - ROW_H, total_w, ROW_H,
                   stroke=1, fill=0)
            x = right
            for j, ((_h, _w, align), w, val) in enumerate(
                    zip(cols, widths, row)):
                txt = str(val)
                is_last = (j == len(cols) - 1)
                colr = _c.black
                if color_last and is_last:
                    try:
                        num = float(str(val).replace(",", ""))
                        colr = GREEN if num >= 0 else RED
                    except ValueError:
                        colr = _c.black
                c.setFillColor(colr)
                font = AR_FONT_BOLD if is_last else AR_FONT
                size = F_CELL
                t = ar(txt)
                room = w - 3 * mm
                if c.stringWidth(t, font, size) > room:
                    size = fit(t, font, size, room, 5.5)
                    if c.stringWidth(t, font, size) > room and align == "r":
                        while (c.stringWidth(t + "…", font, size) > room
                               and len(t) > 2):
                            t = t[:-1]
                        t += "…"
                c.setFont(font, size)
                if align == "r":
                    c.drawRightString(x - 2.5 * mm, y - ROW_H + 3.1 * mm, t)
                else:
                    c.drawCentredString(x - w / 2, y - ROW_H + 3.1 * mm, t)
                x -= w
            y -= ROW_H
        if totals:
            if y - ROW_H < 22 * mm:
                c.showPage()
                y = header()
            c.setFillColor(accent)
            c.rect(right - total_w, y - ROW_H, total_w, ROW_H,
                   stroke=0, fill=1)
            c.setFillColor(bar_text)
            x = right
            for (_h, _w, align), w, val in zip(cols, widths, totals):
                if str(val) != "":
                    t = ar(str(val))
                    c.setFont(AR_FONT_BOLD,
                              fit(t, AR_FONT_BOLD, F_HEAD, w - 2.5 * mm))
                    if align == "r":
                        c.drawRightString(x - 2.5 * mm,
                                          y - ROW_H + 3.1 * mm, t)
                    else:
                        c.drawCentredString(x - w / 2,
                                            y - ROW_H + 3.1 * mm, t)
                x -= w
            y -= ROW_H
        return y - 5 * mm

    y = header()
    t = data.get("totals") or {}

    # ---------- 1) ملخص عام ----------
    y = section(y, "الملخص العام")
    bal = float(t.get("balance") or 0)
    cards = [
        ("إجمالي الوارد للعُهد", f"{float(t.get('handed') or 0):,.3f}", None),
        ("إجمالي المنصرف (التصفيات)", f"{float(t.get('spent') or 0):,.3f}", None),
        ("الرصيد المتبقي لدى المستلمين", f"{bal:,.3f}",
         GREEN if bal >= 0 else RED),
    ]
    cw = avail / len(cards)
    box_h = 16 * mm
    x = right
    for label, val, colr in cards:
        c.setFillColor(light)
        c.setStrokeColor(border)
        c.rect(x - cw + 2, y - box_h, cw - 4, box_h,
               stroke=1, fill=0 if economy else 1)
        c.setFillColor(_c.HexColor("#64748B"))
        c.setFont(AR_FONT, 9)
        c.drawCentredString(x - cw / 2, y - 6 * mm, ar(label))
        c.setFillColor(colr or _c.black)
        c.setFont(AR_FONT_BOLD, 13)
        c.drawCentredString(x - cw / 2, y - 13 * mm, ar(val))
        x -= cw
    y -= box_h + 4 * mm
    c.setFillColor(_c.black)
    c.setFont(AR_FONT, 9.5)
    c.drawRightString(
        right, y,
        ar(f"عدد حسابات العُهد: {t.get('accounts', 0)}   ·   "
           f"سندات التسليم: {t.get('handovers', 0)}   ·   "
           f"عدد التصفيات: {t.get('settlements', 0)}"))
    y -= 7 * mm

    # ---------- 2) أرصدة حسابات العُهد ----------
    y = section(y, "أرصدة حسابات العُهد")
    cols = [("م", 9, "c"), ("حساب العهدة", 62, "r"),
            ("سندات التسليم", 22, "c"), ("عدد التصفيات", 22, "c"),
            ("الوارد", 30, "c"), ("المنصرف", 30, "c"), ("المتبقي", 30, "c")]
    rows, th, ts = [], 0.0, 0.0
    for i, a in enumerate(data.get("accounts") or [], 1):
        th += a["handed"]
        ts += a["spent"]
        rows.append([i, a["account"] or "—", a.get("handed_count", 0),
                     a.get("settlements", 0), f"{a['handed']:,.3f}",
                     f"{a['spent']:,.3f}", f"{a['balance']:,.3f}"])
    if not rows:
        rows = [["—", "لا توجد عُهد في هذه الفترة", "", "", "", "", ""]]
        totals = None
    else:
        totals = ["", "الإجمالي", "", "", f"{th:,.3f}", f"{ts:,.3f}",
                  f"{th - ts:,.3f}"]
    y = table(y, cols, rows, totals, color_last=True)

    # ---------- 3) الوارد: سندات تسليم العُهد ----------
    y = section(y, "الوارد — سندات تسليم العُهد")
    cols = [("م", 9, "c"), ("التاريخ", 24, "c"), ("رقم السند", 24, "c"),
            ("حساب العهدة", 48, "r"), ("المستلم", 40, "r"),
            ("البيان", 46, "r"), ("المبلغ", 28, "c")]
    rows = []
    for i, h in enumerate(data.get("handovers") or [], 1):
        rows.append([i, h.get("vdate", ""), h.get("voucher_number", ""),
                     h.get("account") or "—", h.get("party") or "—",
                     h.get("description") or "—",
                     f"{float(h.get('amount') or 0):,.3f}"])
    if not rows:
        rows = [["—", "", "", "لا توجد سندات تسليم في هذه الفترة",
                 "", "", ""]]
        totals = None
    else:
        totals = ["", "", "", "", "", "إجمالي الوارد",
                  f"{float(t.get('handed') or 0):,.3f}"]
    y = table(y, cols, rows, totals)

    # ---------- 4) المنصرف: كل التصفيات ----------
    y = section(y, "المنصرف — كل التصفيات")
    cols = [("م", 9, "c"), ("التاريخ", 24, "c"), ("مرجع التصفية", 44, "c"),
            ("حساب العهدة", 56, "r"), ("طريقة الدفع", 26, "c"),
            ("عدد البنود", 22, "c"), ("إجمالي المصروف", 30, "c")]
    rows = []
    for i, g in enumerate(data.get("settlements") or [], 1):
        rows.append([i, g.get("vdate", ""), g.get("group_ref", ""),
                     g.get("account") or "—", g.get("method") or "—",
                     g.get("lines_count", 0),
                     f"{float(g.get('total') or 0):,.3f}"])
    if not rows:
        rows = [["—", "", "", "لا توجد تصفيات في هذه الفترة", "", "", ""]]
        totals = None
    else:
        totals = ["", "", "", "", "", "إجمالي المنصرف",
                  f"{float(t.get('spent') or 0):,.3f}"]
    y = table(y, cols, rows, totals)

    # ---------- التوقيعات ----------
    if y - 24 * mm < 16 * mm:
        c.showPage()
        y = header()
    y -= 10 * mm
    c.setFillColor(_c.black)
    c.setFont(AR_FONT_BOLD, 10)
    slots = ["المحاسب", "المدير المالي", "المدير العام"]
    sw = avail / len(slots)
    x = right
    for name in slots:
        c.setStrokeColor(_c.black)
        c.line(x - sw + 12 * mm, y, x - 12 * mm, y)
        c.drawCentredString(x - sw / 2, y - 6 * mm, ar(name))
        x -= sw

    c.save()
    return out_path


def generate_blank_custody_settlement_form(out_path: str) -> str:
    """نموذج تصفية عهدة فارغ يُطبع ويُسلّم للموظف لتعبئته يدويًا."""
    pdf = _require_pdf()
    _c, mm, ar = pdf["_c"], pdf["mm"], pdf["ar"]
    AR_FONT, AR_FONT_BOLD = pdf["AR_FONT"], pdf["AR_FONT_BOLD"]
    pdf["register_fonts"]()
    s = settings_service.get_settings()
    # النموذج الفارغ عمودي ليتّسع لـ 16 سطر كتابة يدوية مريحة (8مم/سطر).
    PAGE_W, PAGE_H = pdf["A4"]
    M = 12 * mm
    right, left = PAGE_W - M, M
    primary = pdf["hex_color"](s.invoice_primary, pdf["PRIMARY"])
    light = pdf["light_tint"](s.invoice_primary)
    border = _c.HexColor("#94A3B8")
    # الوضع الاقتصادي: أشرطة بيضاء بنص أسود (لا شريط أسود داكن)
    economy = bool(getattr(s, "print_economy", False))
    bar_text = _c.white
    if economy:
        primary = _c.white
        light = _c.white
        border = _c.black
        bar_text = _c.black
    c = pdf["rl_canvas"].Canvas(out_path, pagesize=(PAGE_W, PAGE_H))
    pdf["apply_pdf_metadata"](c, "نموذج تصفية عهدة فارغ")

    c.setFillColor(primary)
    c.rect(0, PAGE_H - 28 * mm, PAGE_W, 28 * mm, stroke=0, fill=1)
    c.setFillColor(bar_text)
    c.setFont(AR_FONT_BOLD, 15)
    c.drawRightString(right, PAGE_H - 12 * mm, ar(s.company_name or ""))
    c.setFont(AR_FONT_BOLD, 13)
    c.drawRightString(right, PAGE_H - 22 * mm, ar("نموذج تصفية عهدة"))
    c.setFont(AR_FONT, 9)
    c.drawString(left, PAGE_H - 14 * mm, ar("نموذج فارغ لتعبئة الموظف"))

    y = PAGE_H - 40 * mm
    c.setFillColor(light)
    c.setStrokeColor(border)
    c.rect(left, y - 34 * mm, right - left, 34 * mm, stroke=1, fill=1)
    c.setFillColor(_c.black)
    c.setFont(AR_FONT_BOLD, 10)
    fields = [
        ("اسم الموظف / المستلم", ""),
        ("حساب العهدة", ""),
        ("تاريخ التصفية", "      /      /      "),
        ("إجمالي العهدة المسلّمة", ""),
        ("إجمالي المصروف", ""),
        ("المتبقي / المستحق", ""),
    ]
    col_w = (right - left) / 2
    for i, (label, sample) in enumerate(fields):
        col = i % 2
        row = i // 2
        x2 = right - col * col_w
        yy = y - (8 + row * 10) * mm
        c.drawRightString(x2 - 4 * mm, yy, ar(label + ":"))
        c.line(x2 - col_w + 6 * mm, yy - 1.5 * mm, x2 - 45 * mm, yy - 1.5 * mm)
        if sample:
            c.setFont(AR_FONT, 9)
            c.drawRightString(x2 - 48 * mm, yy, ar(sample))
            c.setFont(AR_FONT_BOLD, 10)

    y -= 45 * mm
    headers = ["م", "التاريخ", "العميل", "العقد", "حساب المصروف", "الجهة", "البيان", "المبلغ"]
    # مساحة البيان أكبر لأنها غالبًا تُكتب يدويًا بتفاصيل كثيرة.
    widths_mm = [10, 22, 30, 34, 38, 28, 82, 26]
    scale = (right - left) / (sum(widths_mm) * mm)
    widths = [w * mm * scale for w in widths_mm]
    row_h = 8 * mm
    c.setFillColor(primary)
    c.rect(left, y - row_h, right - left, row_h, stroke=0, fill=1)
    c.setFillColor(bar_text)
    c.setFont(AR_FONT_BOLD, 8.5)
    x = right
    for head, w in zip(headers, widths):
        c.drawCentredString(x - w / 2, y - 6 * mm, ar(head))
        x -= w
    y -= row_h
    c.setStrokeColor(border)
    for r in range(1, 17):
        c.setFillColor(_c.white if r % 2 else light)
        c.rect(left, y - row_h, right - left, row_h, stroke=0, fill=1)
        c.setStrokeColor(border)
        c.rect(left, y - row_h, right - left, row_h, stroke=1, fill=0)
        x = right
        c.setFillColor(_c.black)
        c.setFont(AR_FONT, 8.5)
        for idx, w in enumerate(widths):
            c.line(x - w, y, x - w, y - row_h)
            if idx == 0:
                c.drawCentredString(x - w / 2, y - 6 * mm, str(r))
            x -= w
        y -= row_h

    y -= 8 * mm
    c.setFont(AR_FONT_BOLD, 10)
    c.setFillColor(_c.black)
    c.drawRightString(right, y, ar("إقرار الموظف:"))
    c.setFont(AR_FONT, 9)
    c.drawRightString(right, y - 8 * mm, ar("أقر بأن المصروفات أعلاه تخص أعمال الشركة، وأرفقت المستندات المؤيدة لها."))
    y -= 16 * mm
    sigs = ["الموظف / المستلم", "المحاسب", "المدير"]
    sw = (right - left) / 3
    for i, label in enumerate(sigs):
        x2 = right - i * sw
        c.setFont(AR_FONT_BOLD, 9.5)
        c.drawCentredString(x2 - sw / 2, y, ar(label))
        c.line(x2 - sw + 15 * mm, y - 10 * mm, x2 - 15 * mm, y - 10 * mm)
        c.setFont(AR_FONT, 8)
        c.drawCentredString(x2 - sw / 2, y - 16 * mm, ar("الاسم والتوقيع"))
    c.setFont(AR_FONT, 8)
    c.drawCentredString(PAGE_W / 2, 8 * mm, ar("صفحة 1 من 1"))
    c.save()
    return out_path


def generate_custody_ledger_pdf(data: dict, out_path: str,
                                include_details: bool = False) -> str:
    """طباعة كشف حساب عهدة موحّد بصفوف مجمّعة.

    التفاصيل اختيارية، ولا تؤثر على الرصيد المتراكم في الصفوف الرئيسية.
    """
    pdf = _require_pdf()
    _c, mm, ar = pdf["_c"], pdf["mm"], pdf["ar"]
    AR_FONT, AR_FONT_BOLD = pdf["AR_FONT"], pdf["AR_FONT_BOLD"]
    pdf["register_fonts"]()
    s = settings_service.get_settings()
    PAGE_W, PAGE_H = pdf["landscape"](pdf["A4"])
    M = 12 * mm
    right, left = PAGE_W - M, M
    primary = pdf["hex_color"](s.invoice_primary, pdf["PRIMARY"])
    light = pdf["light_tint"](s.invoice_primary)
    border = _c.HexColor("#9FB3C8")
    green = _c.HexColor("#DCFCE7")
    red = _c.HexColor("#FEE2E2")
    # الوضع الاقتصادي: أشرطة بيضاء بنص أسود وبلا تظليل ملوّن
    economy = bool(getattr(s, "print_economy", False))
    bar_text = _c.white
    if economy:
        primary = _c.white
        light = _c.white
        green = _c.white
        red = _c.white
        border = _c.black
        bar_text = _c.black
    rows = data.get("rows") or []
    totals = data.get("totals") or {}
    _accs = {str(r.get("custody_account") or "").strip() for r in rows}
    _accs.discard("")
    if len(_accs) == 1:
        account = next(iter(_accs))
    elif _accs:
        account = "كل حسابات العهد"
    else:
        account = "كل حسابات العهد" if not data.get("account_id") else "—"

    c = pdf["rl_canvas"].Canvas(out_path, pagesize=(PAGE_W, PAGE_H))
    pdf["apply_pdf_metadata"](c, "كشف حساب العهدة")
    cols = [("التاريخ", 25), ("المرجع", 35), ("العهدة", 30),
            ("البيان", 75), ("وارد", 26), ("منصرف", 26), ("الرصيد", 28)]
    total_w = sum(w for _, w in cols) * mm
    scale = (right - left) / total_w
    widths = [w * mm * scale for _, w in cols]
    row_h = 8.5 * mm

    def header(page=1):
        c.setFillColor(primary)
        c.rect(0, PAGE_H - 25 * mm, PAGE_W, 25 * mm, stroke=0, fill=1)
        c.setFillColor(bar_text)
        c.setFont(AR_FONT_BOLD, 14)
        c.drawRightString(right, PAGE_H - 10 * mm, ar(s.company_name or ""))
        c.setFont(AR_FONT_BOLD, 12)
        c.drawRightString(right, PAGE_H - 19 * mm, ar("كشف حساب العهدة"))
        c.setFont(AR_FONT, 9)
        c.drawString(left, PAGE_H - 11 * mm, ar(f"الحساب: {account}"))
        period = ""
        if data.get("date_from") or data.get("date_to"):
            period = f"الفترة: {data.get('date_from') or '...'} إلى {data.get('date_to') or '...'}"
        c.drawString(left, PAGE_H - 19 * mm, ar(period or ("تاريخ الطباعة: " + datetime.now().strftime("%Y-%m-%d %H:%M"))))
        y = PAGE_H - 33 * mm
        c.setFillColor(light)
        c.setStrokeColor(border)
        c.rect(left, y - 13 * mm, right - left, 13 * mm, stroke=1, fill=1)
        c.setFillColor(_c.black)
        c.setFont(AR_FONT_BOLD, 10)
        summary = (f"إجمالي الوارد: {float(totals.get('in') or 0):,.3f}   |   "
                   f"إجمالي المنصرف: {float(totals.get('out') or 0):,.3f}   |   "
                   f"الرصيد الحالي: {float(totals.get('balance') or 0):,.3f}")
        c.drawRightString(right - 4 * mm, y - 8.5 * mm, ar(summary))
        y -= 18 * mm
        c.setFillColor(primary)
        c.rect(left, y - row_h, right - left, row_h, stroke=0, fill=1)
        c.setFillColor(bar_text)
        c.setFont(AR_FONT_BOLD, 9)
        x = right
        for (head, _), w in zip(cols, widths):
            c.drawCentredString(x - w / 2, y - 5.8 * mm, ar(head))
            x -= w
        return y - row_h

    def draw_row(y, values, fill=None, bold=False, small=False):
        if fill:
            c.setFillColor(fill); c.rect(left, y - row_h, right - left, row_h, stroke=0, fill=1)
        c.setStrokeColor(border); c.rect(left, y - row_h, right - left, row_h, stroke=1, fill=0)
        c.setFillColor(_c.black)
        x = right
        c.setFont(AR_FONT_BOLD if bold else AR_FONT, 7.8 if small else 9)
        for i, (val, w) in enumerate(zip(values, widths)):
            txt = ar(str(val or ""))
            if c.stringWidth(txt, AR_FONT_BOLD if bold else AR_FONT, 7.8 if small else 9) > w - 3 * mm:
                while len(txt) > 3 and c.stringWidth(txt + "…", AR_FONT, 7.8 if small else 9) > w - 3 * mm:
                    txt = txt[:-1]
                txt += "…"
            if i in (2, 3):
                c.drawRightString(x - 2 * mm, y - 5.8 * mm, txt)
            else:
                c.drawCentredString(x - w / 2, y - 5.8 * mm, txt)
            x -= w
        return y - row_h

    y = header()
    for r in rows:
        needed = row_h * (1 + (len(r.get("details") or []) if include_details and r.get("kind") == "settlement" else 0))
        if y - needed < 18 * mm:
            c.showPage(); y = header()
        fill = green if r.get("in") else (red if r.get("out") else None)
        y = draw_row(y, [r.get("vdate"), r.get("ref"),
                         r.get("custody_account") or "",
                         r.get("description"),
                         f"{float(r.get('in') or 0):,.3f}" if r.get("in") else "",
                         f"{float(r.get('out') or 0):,.3f}" if r.get("out") else "",
                         f"{float(r.get('balance') or 0):,.3f}"], fill=fill, bold=True)
        if include_details and r.get("kind") == "settlement":
            for d in r.get("details") or []:
                y = draw_row(y, ["", d.get("voucher_number"), "",
                                 f"{d.get('expense_account_snapshot') or ''} · {d.get('party') or ''} · {((d.get('contract_customer_name') or '').strip() + ' — ') if (d.get('contract_customer_name') or '').strip() else ''}{d.get('contract_number') or ''} · {d.get('description') or ''}",
                                 "", f"{float(d.get('amount') or 0):,.3f}", ""],
                             fill=_c.HexColor("#F8FAFC"), small=True)
    c.setFont(AR_FONT, 8)
    c.setFillColor(_c.black)
    c.drawCentredString(PAGE_W / 2, 8 * mm, ar("كشف حساب العهدة"))
    c.save()
    return out_path
