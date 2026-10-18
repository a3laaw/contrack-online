# -*- coding: utf-8 -*-
"""نافذة معاينة PDF فورية داخل البرنامج · بدون حفظ مسبق.

تصميم مستقر: تُنشأ QLabel واحدة لكل صفحة مرة واحدة فقط، وعند التكبير أو
تغيير حجم النافذة تُحدَّث الصورة داخل نفس العنصر (لا حذف/إنشاء)، ما يمنع
أي تراكب أو ظهور صفحات مكررة.
"""
import os
import shutil
import tempfile

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QPainter, QPixmap
from PySide6.QtPdf import QPdfDocument
from PySide6.QtPrintSupport import QPrintDialog, QPrinter
from PySide6.QtWidgets import (
    QDialog, QFileDialog, QHBoxLayout, QLabel, QPushButton, QScrollArea,
    QVBoxLayout, QWidget,
)

from ui import style

_RENDER_SCALE = 2.0  # دقة الرسم الداخلية (أعلى = أوضح عند التكبير)


class PdfPreviewDialog(QDialog):
    """معاينة فورية لملف PDF مع طباعة وحفظ اختياري."""

    def __init__(self, parent, pdf_path: str, title: str = "معاينة",
                 save_name: str = "document.pdf", archive_customer=None):
        super().__init__(parent)
        style.ensure_light_background(self)
        self._pdf_path = pdf_path
        self._save_name = save_name
        self._archive_customer = archive_customer  # لحفظ نسخة في ملف العميل
        self._zoom = 1.0
        self._page_pixmaps: list[QPixmap] = []
        self._page_labels: list[QLabel] = []

        self.setWindowTitle(title)
        self.setLayoutDirection(Qt.RightToLeft)
        style.fit_window(self, 900, 760, min_w=620, min_h=500)
        style.center_on_screen(self)
        self.setWindowModality(Qt.WindowModal)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        # شريط الأزرار
        bar = QHBoxLayout()
        print_btn = QPushButton("🖨 طباعة")
        print_btn.setObjectName("btnPrimary")
        print_btn.setToolTip("طباعة المستند على الطابعة")
        save_btn = QPushButton("💾 حفظ PDF")
        save_btn.setToolTip("حفظ نسخة من الملف على الجهاز")
        zoom_in = QPushButton("تكبير +")
        zoom_in.setToolTip("تكبير العرض")
        zoom_out = QPushButton("تصغير −")
        zoom_out.setToolTip("تصغير العرض")
        for z in (zoom_in, zoom_out):
            z.setProperty("flat", True)
        self._zoom_lbl = QLabel("100%")
        self._zoom_lbl.setProperty("hint", True)
        self._zoom_lbl.setToolTip("نسبة التكبير الحالية")
        close_btn = QPushButton("✕ إغلاق")
        close_btn.setProperty("flat", True)
        close_btn.setToolTip("إغلاق المعاينة")

        print_btn.clicked.connect(self._print)
        save_btn.clicked.connect(self._save)
        zoom_in.clicked.connect(lambda: self._set_zoom(self._zoom * 1.2))
        zoom_out.clicked.connect(lambda: self._set_zoom(self._zoom / 1.2))
        close_btn.clicked.connect(self.accept)

        bar.addWidget(print_btn)
        bar.addWidget(save_btn)
        if self._archive_customer is not None:
            archive_btn = QPushButton("📁 حفظ في ملف العميل")
            archive_btn.setProperty("flat", True)
            archive_btn.setToolTip("حفظ نسخة من الملف في أرشيف العميل")
            archive_btn.clicked.connect(self._save_to_archive)
            bar.addWidget(archive_btn)
        bar.addSpacing(12)
        bar.addWidget(zoom_in)
        bar.addWidget(self._zoom_lbl)
        bar.addWidget(zoom_out)
        bar.addStretch()
        self._pages_lbl = QLabel("")
        self._pages_lbl.setProperty("hint", True)
        bar.addWidget(self._pages_lbl)
        bar.addWidget(close_btn)
        layout.addLayout(bar)

        # منطقة العرض
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setAlignment(Qt.AlignHCenter | Qt.AlignTop)
        self._scroll.setStyleSheet(
            f"QScrollArea {{ background: {style.PDF_VIEWER_BG};"
            f" border: none; border-radius: 8px; }}")
        self._container = QWidget()
        self._container.setStyleSheet(f"background: {style.PDF_VIEWER_BG};")
        self._pages_layout = QVBoxLayout(self._container)
        self._pages_layout.setAlignment(Qt.AlignHCenter | Qt.AlignTop)
        self._pages_layout.setSpacing(10)
        self._pages_layout.setContentsMargins(16, 16, 16, 16)
        self._scroll.setWidget(self._container)
        layout.addWidget(self._scroll, 1)

        # مؤقّت تهدئة لإعادة القياس عند تغيير حجم النافذة
        self._resize_timer = QTimer(self)
        self._resize_timer.setSingleShot(True)
        self._resize_timer.setInterval(120)
        self._resize_timer.timeout.connect(self._update_page_sizes)

        # تحميل المستند ورسم الصفحات (مرة واحدة فقط)
        self._doc = QPdfDocument(self)
        self._doc.load(pdf_path)
        self._build_pages_once()
        count = self._doc.pageCount()
        self._pages_lbl.setText(
            f"{count} صفحة" if count == 1 else f"{count} صفحات")

    # ---------- بناء الصفحات (مرة واحدة) ----------
    def _build_pages_once(self):
        # على الشاشات عالية الدقة نرسم بدقة أعلى حتى يبقى النص حادًا
        render_scale = _RENDER_SCALE * self._dpr()
        for page in range(self._doc.pageCount()):
            size = self._doc.pagePointSize(page)
            w = int(size.width() * render_scale)
            h = int(size.height() * render_scale)
            image = self._doc.render(page, QSize(w, h))
            if image.isNull():
                continue
            pix = QPixmap.fromImage(image)
            self._page_pixmaps.append(pix)
            label = QLabel()
            label.setStyleSheet(
                f"background: white; border: 1px solid {style.PDF_PAGE_BORDER};")
            label.setAlignment(Qt.AlignCenter)
            self._page_labels.append(label)
            self._pages_layout.addWidget(label, 0, Qt.AlignHCenter)
        self._update_page_sizes()

    def _dpr(self) -> float:
        """نسبة بكسلات الشاشة الفعلية (1.0 عادي / 1.5 عند تكبير 150%)."""
        try:
            return max(1.0, float(self.devicePixelRatioF()))
        except Exception:
            return 1.0

    # ---------- تحديث المقاسات فقط (بدون حذف/إنشاء) ----------
    def _update_page_sizes(self):
        viewport_w = self._scroll.viewport().width()
        base_width = max(420, viewport_w - 64)
        target_w = int(base_width * self._zoom)
        dpr = self._dpr()
        for label, pix in zip(self._page_labels, self._page_pixmaps):
            # نكبّر بالبكسل الفعلي ثم نخبر Qt بالنسبة → عرض منطقي صحيح
            scaled = pix.scaledToWidth(int(target_w * dpr),
                                       Qt.SmoothTransformation)
            scaled.setDevicePixelRatio(dpr)
            label.setPixmap(scaled)
            label.setFixedSize(int(scaled.width() / dpr),
                               int(scaled.height() / dpr))

    def _set_zoom(self, value: float):
        self._zoom = max(0.4, min(3.0, value))
        self._zoom_lbl.setText(f"{round(self._zoom * 100)}%")
        self._update_page_sizes()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        # تهدئة: تحديث واحد بعد انتهاء السحب بدل تحديث لكل حركة
        self._resize_timer.start()

    def showEvent(self, event):
        super().showEvent(event)
        # ضبط المقاس الصحيح بعد ظهور النافذة بأبعادها النهائية
        QTimer.singleShot(0, self._update_page_sizes)

    # ---------- حفظ اختياري ----------
    def _save(self):
        default = os.path.join(os.path.expanduser("~"), self._save_name)
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ الملف", default, "PDF (*.pdf)")
        if not path:
            return
        try:
            shutil.copy2(self._pdf_path, path)
            style.info(self, f"تم حفظ الملف بنجاح:\n{path}", "تم")
        except OSError:
            style.error(self, "تعذر حفظ الملف في المسار المحدد.")

    # ---------- حفظ في أرشيف العميل ----------
    def _save_to_archive(self):
        from services import archive_service
        try:
            dest = archive_service.save_to_archive(
                self._archive_customer, self._pdf_path, self._save_name)
            style.info(self, f"تم حفظ نسخة في ملف العميل:\n{os.path.basename(dest)}", "تم")
        except OSError:
            style.error(self, "تعذر الحفظ في ملف العميل.")

    # ---------- طباعة مباشرة ----------
    def _print(self):
        from PySide6.QtGui import QPageLayout
        printer = QPrinter(QPrinter.HighResolution)
        try:
            count = int(self._doc.pageCount())
        except Exception:
            count = 0
        sizes = []
        for _p in range(max(count, 1)):
            try:
                sizes.append(self._doc.pagePointSize(_p))
            except Exception:
                sizes.append(None)

        def _orient(sz):
            try:
                if sz is not None and sz.width() > sz.height():
                    return QPageLayout.Landscape
            except Exception:
                pass
            return QPageLayout.Portrait

        # اتجاه الصفحة الأولى قبل بدء الرسم حتى يُعتمد من الطابعة.
        try:
            printer.setPageOrientation(_orient(sizes[0] if sizes else None))
        except Exception:
            pass
        dialog = QPrintDialog(printer, self)
        dialog.setWindowTitle("طباعة")
        if dialog.exec() != QPrintDialog.Accepted:
            return
        try:
            painter = QPainter()
            if not painter.begin(printer):
                style.error(self, "تعذر بدء الطباعة. تأكد من توصيل الطابعة.")
                return
            for page, size in enumerate(sizes):
                if page > 0:
                    printer.newPage()
                try:
                    page_rect = printer.pageRect(QPrinter.DevicePixel)
                    sw = float(size.width()) if size else 0.0
                    sh = float(size.height()) if size else 0.0
                except Exception:
                    page_rect, sw, sh = None, 0.0, 0.0
                if page_rect is None or sw <= 0 or sh <= 0:
                    continue
                scale = min(page_rect.width() / sw, page_rect.height() / sh)
                img_w = max(1, int(sw * scale))
                img_h = max(1, int(sh * scale))
                image = self._doc.render(page, QSize(img_w, img_h))
                if not image.isNull():
                    painter.drawImage(0, 0, image)
            painter.end()
            style.info(self, "تم إرسال المستند إلى الطابعة.", "طباعة")
        except Exception:
            style.error(self, "تعذر تنفيذ الطباعة. تأكد من توصيل الطابعة.")


def make_temp_pdf_path(prefix: str) -> str:
    """مسار ملف مؤقت فريد للمعاينة (طابع زمني بالثانية + عدّاد · قاعدة 22).

    الاسم الفريد يمنع الكتابة فوق ملف مفتوح في المعاينة أو في قارئ آخر.
    """
    from datetime import datetime
    tmp_dir = os.path.join(tempfile.gettempdir(), "contracts_app_preview")
    os.makedirs(tmp_dir, exist_ok=True)
    safe = "".join(ch for ch in prefix if ch.isalnum() or ch in "-_")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = f"{safe or 'preview'}_{stamp}"
    path = os.path.join(tmp_dir, f"{base}.pdf")
    counter = 2
    while os.path.exists(path):
        path = os.path.join(tmp_dir, f"{base}_{counter}.pdf")
        counter += 1
    return path
