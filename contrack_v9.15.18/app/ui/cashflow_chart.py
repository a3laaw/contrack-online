# -*- coding: utf-8 -*-
"""رسم بياني بسيط بالأعمدة: الوارد مقابل المنصرف شهرياً · بدون مكتبات خارجية."""
from PySide6.QtCore import Qt, QRectF
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QWidget


class CashflowChart(QWidget):
    """أعمدة شهرية: أخضر = وارد، أحمر = منصرف."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._data: list[dict] = []
        self.setMinimumHeight(190)

    def set_data(self, data: list[dict]):
        self._data = data or []
        self.update()

    def paintEvent(self, event):  # noqa: N802
        from ui import style
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        t = style.theme()
        text_color = QColor(t["TEXT"])
        muted = QColor(t["MUTED"])
        green = QColor(style.OK_GREEN)
        red = QColor(style.DANGER)
        grid = QColor(t["MUTED"])
        grid.setAlpha(40)

        w, h = self.width(), self.height()
        pad_r, pad_l, pad_top, pad_bot = 12, 12, 26, 34
        plot_w = w - pad_r - pad_l
        plot_h = h - pad_top - pad_bot
        if plot_w <= 40 or plot_h <= 30:
            return

        data = self._data
        if not data:
            p.setPen(muted)
            p.drawText(self.rect(), Qt.AlignCenter, "لا توجد حركة مالية بعد")
            return

        max_val = max([max(d["in"], d["out"]) for d in data] + [1.0])

        # خطوط شبكة أفقية خفيفة
        p.setPen(QPen(grid, 1))
        steps = 4
        small = QFont(self.font())
        small.setPointSizeF(max(7.5, self.font().pointSizeF() - 2))
        for i in range(steps + 1):
            y = pad_top + plot_h - (plot_h * i / steps)
            p.drawLine(pad_l, int(y), w - pad_r, int(y))

        # الأعمدة · الرسم من اليمين لليسار (RTL: أول شهر يمين)
        n = len(data)
        group_w = plot_w / n
        bar_w = min(26.0, group_w * 0.32)
        gap = 4
        p.setFont(small)
        for i, d in enumerate(data):
            # المجموعة i: من اليمين
            cx = w - pad_r - group_w * i - group_w / 2
            in_h = plot_h * (d["in"] / max_val)
            out_h = plot_h * (d["out"] / max_val)
            base_y = pad_top + plot_h
            # الوارد (يمين المجموعة)
            rect_in = QRectF(cx - bar_w - gap / 2, base_y - in_h, bar_w, in_h)
            p.setPen(Qt.NoPen)
            p.setBrush(green)
            p.drawRoundedRect(rect_in, 3, 3)
            # المنصرف
            rect_out = QRectF(cx + gap / 2, base_y - out_h, bar_w, out_h)
            p.setBrush(red)
            p.drawRoundedRect(rect_out, 3, 3)
            # اسم الشهر
            p.setPen(muted)
            p.drawText(QRectF(cx - group_w / 2, base_y + 4, group_w, 16),
                       Qt.AlignCenter, d["label"])
            # القيم فوق الأعمدة (بالألف مختصرة إذا كبيرة)
            def fmt(v):
                if v >= 1000:
                    return f"{v/1000:,.0f}k"
                return f"{v:,.0f}" if v else ""
            p.setPen(QColor(style.OK_GREEN))
            if d["in"]:
                p.drawText(QRectF(rect_in.x() - 14, rect_in.y() - 16,
                                  bar_w + 28, 14), Qt.AlignCenter, fmt(d["in"]))
            p.setPen(QColor(style.DANGER))
            if d["out"]:
                p.drawText(QRectF(rect_out.x() - 14, rect_out.y() - 16,
                                  bar_w + 28, 14), Qt.AlignCenter, fmt(d["out"]))

        # وسيلة الإيضاح أعلى اليسار
        p.setFont(small)
        lx = pad_l
        p.setPen(Qt.NoPen)
        p.setBrush(green)
        p.drawRoundedRect(QRectF(lx, 6, 10, 10), 2, 2)
        p.setPen(text_color)
        p.drawText(QRectF(lx + 14, 3, 60, 16), Qt.AlignVCenter | Qt.AlignLeft,
                   "الوارد")
        p.setPen(Qt.NoPen)
        p.setBrush(red)
        p.drawRoundedRect(QRectF(lx + 78, 6, 10, 10), 2, 2)
        p.setPen(text_color)
        p.drawText(QRectF(lx + 92, 3, 60, 16), Qt.AlignVCenter | Qt.AlignLeft,
                   "المنصرف")
