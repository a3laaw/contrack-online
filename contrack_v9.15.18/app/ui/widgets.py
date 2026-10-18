# -*- coding: utf-8 -*-
"""عناصر واجهة مشتركة · القائمة القابلة للبحث + حقول بدون تمرير العجلة."""
from PySide6.QtCore import QModelIndex, QObject, QPoint, QRect, QSize, Qt, Signal, QTimer, QDate
from PySide6.QtWidgets import (QComboBox, QCompleter, QDateEdit,
                               QDateTimeEdit, QDoubleSpinBox, QLayout, QSpinBox, QTimeEdit,
                               QWidget)

# مصدر الألوان الوحيد (القاعدة 26) — style لا يستورد widgets فلا دائرية
from ui import style


class NoWheelMixin:
    """إلغاء تأثير بكرة الماوس تمامًا على حقول الإدخال الرقمية/التاريخية."""

    def wheelEvent(self, event):  # noqa: N802
        event.ignore()


class SafeDoubleSpinBox(NoWheelMixin, QDoubleSpinBox):
    """حقل مبلغ لا يتأثر بعجلة الماوس."""


class SafeSpinBox(NoWheelMixin, QSpinBox):
    """حقل رقم صحيح لا يتأثر بعجلة الماوس."""


class SafeDateEdit(NoWheelMixin, QDateEdit):
    """حقل تاريخ لا يتأثر بعجلة الماوس · يبدأ من اليوم · كتابة سلسة.

    - الافتراضي تاريخ اليوم (لا 2000-01-01).
    - الدخول للحقل يعلّم أول خانة فورًا فتكتب مباشرة (والانتقال بين
      الخانات تلقائي عند اكتمالها).
    - مسح/Backspace على خانة معلّمة يعلّم الحقل كله (جاهزًا لإعادة
      الكتابة) بدل إفساد العرض — وأي رقم بعده يبدأ من أول خانة.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.setDate(QDate.currentDate())
        self._sep_skip = False

    def _format_sections(self) -> list:
        """أقسام الصيغة بترتيبها (سنة/شهر/يوم)."""
        found = []
        for token, sec in (("y", QDateTimeEdit.YearSection),
                           ("M", QDateTimeEdit.MonthSection),
                           ("d", QDateTimeEdit.DaySection)):
            idx = self.displayFormat().find(token)
            if idx >= 0:
                found.append((idx, sec))
        return [s for _, s in sorted(found)]

    def _advance_section(self):
        secs = self._format_sections()
        try:
            i = secs.index(self.currentSection())
        except ValueError:
            i = -1
        if 0 <= i < len(secs) - 1:
            self.setSelectedSection(secs[i + 1])

    def focusInEvent(self, event):  # noqa: N802
        super().focusInEvent(event)
        secs = self._format_sections()
        if secs:
            self.setSelectedSection(secs[0])

    def keyPressEvent(self, event):  # noqa: N802
        key = event.key()
        le = self.lineEdit()
        if key in (Qt.Key_Backspace, Qt.Key_Delete):
            self._sep_skip = False
            if le is None:
                return super().keyPressEvent(event)
            sel = le.selectedText() if le.hasSelectedText() else ""
            if sel and len(sel) >= len(le.text()):
                return  # معلّم كله — لا فراغ مسموح، نبقي التعليم
            if sel and sel == self.sectionText(self.currentSection()):
                self.selectAll()  # خانة معلّمة ← تعليم الحقل كله
                return
            return super().keyPressEvent(event)  # وسط الكتابة ← تصحيح عادي
        if event.text() in ("-", "/", ".", " ", ":"):
            if self._sep_skip:
                self._sep_skip = False  # يلي انتقالًا تلقائيًا ← تجاهل
            else:
                self._advance_section()  # فاصل ← القسم التالي
            return
        if event.text() and event.text().isdigit():
            if (le is not None and le.hasSelectedText()
                    and len(le.selectedText()) >= len(le.text())):
                secs = self._format_sections()
                if secs:
                    self.setSelectedSection(secs[0])
            before = self.currentSection()
            super().keyPressEvent(event)
            self._sep_skip = (self.currentSection() != before)
            return
        self._sep_skip = False
        return super().keyPressEvent(event)


class SafeTimeEdit(NoWheelMixin, QTimeEdit):
    """حقل وقت لا يتأثر بعجلة الماوس."""


class _CleanCompleter(QCompleter):
    """مكمّل يبحث في النص الخفي (هاتف/أرقام) لكنه يُدخل نص العرض النظيف.

    QCompleter الافتراضي يستخدم completionRole في أمرين:
      1) الفلترة أثناء الكتابة (وهذا ما نريده)
      2) النص الذي يُكتب في الخانة عند التأكيد/مغادرة الحقل (وهذا سبب
         ظهور CUS-0002 66554433 ... بدل الاسم)
    هنا نعيد تعريف pathFromIndex ليعيد دائمًا نص العرض النظيف.
    """

    def pathFromIndex(self, index):  # noqa: N802
        if not index or not index.isValid():
            return ""
        text = index.model().data(index, Qt.DisplayRole)
        return "" if text is None else str(text)



class SearchableComboBox(QComboBox):
    """قائمة منسدلة قابلة للبحث بالكتابة · اكتب جزءًا من الاسم فتُرشَّح النتائج.

    - النص الظاهر نظيف (الاسم فقط) · والبحث يشمل بيانات خفية
      (هاتف، أرقام...) عبر search_items()
    - البحث في أي جزء من النص وغير حساس لحالة الأحرف
    - عجلة الماوس معطّلة
    - selected_data() ترجع قيمة العنصر المحدد أو None
    """

    selection_changed = Signal()
    _SEARCH_ROLE = Qt.UserRole + 7  # نص البحث الخفي

    def __init__(self, parent=None, placeholder: str = "",
                 open_on_click: bool = False, search_only: bool = False,
                 browse_on_empty: bool = False):
        super().__init__(parent)
        self.setEditable(True)
        self.setInsertPolicy(QComboBox.NoInsert)
        self.lineEdit().setPlaceholderText(placeholder)
        # open_on_click: للقوائم التابعة القصيرة فقط (مثل عقود العميل
        # المختار) · النقر يفتح القائمة فورًا. القوائم الكبيرة (العملاء)
        # تبقى بحثًا بالكتابة ولا تنسدل بالنقر.
        # search_only: لقوائم العملاء/مقاولي الباطن — بحث وكتابة فقط:
        # لا فتح بالنقر ولا بالسهم ▼ ولا بسهم الكيبورد ↓ أبدًا.
        self._search_only = bool(search_only)
        self._open_on_click = bool(open_on_click) and not self._search_only
        # V3.25: النقرة/↓ بخانة فارغة تعرض أعلى البنود (لخانات العقود
        # فقط — العملاء يبقون بحثًا صارمًا بلا انسدال كما أُقر).
        self._browse_on_empty = bool(browse_on_empty)

        self._suggest = None
        if self._search_only:
            # البحث-فقط: بلا QCompleter إطلاقًا — قائمة اقتراحات خاصة
            # نتحكم فيها بالكامل (كتابة ← مطابقات فقط ← اختيار بماوس/إنتر).
            self._completer = None
            self._build_suggest_popup()
            # بلا زر فتح: السهم مخفي تمامًا — الخانة للكتابة فقط.
            self.setStyleSheet(
                "QComboBox::drop-down { width: 0px; border: none; }")
        else:
            self._completer = _CleanCompleter(self.model(), self)
            self._completer.setCompletionMode(QCompleter.PopupCompletion)
            self._completer.setFilterMode(Qt.MatchContains)
            self._completer.setCaseSensitivity(Qt.CaseInsensitive)
            # البحث في نص البحث الخفي · والعرض يبقى نظيفًا
            self._completer.setCompletionRole(self._SEARCH_ROLE)
            self.setCompleter(self._completer)
            # قائمة البحث المنسدلة: اسم كائن ليطبّق عليها ستايل النظام
            # ارتفاع صف مريح يسهل النقر عليه
            _popup = self._completer.popup()
            _popup.setObjectName("completerPopup")
            # لا تجعل نافذة النتائج تسحب تركيز الكتابة؛ المستخدم يستطيع إكمال
            # الكتابة مباشرة بعد أول حرف بدل أن يضطر للنقر داخل الخانة مرة أخرى.
            _popup.setFocusPolicy(Qt.NoFocus)
            self.view().setFocusPolicy(Qt.NoFocus)

        self.currentIndexChanged.connect(lambda _: self.selection_changed.emit())
        if self._completer is not None:
            self._completer.activated[QModelIndex].connect(self._on_completer_index)
        self.lineEdit().textEdited.connect(self._on_user_text_edited)
        self.lineEdit().textEdited.connect(self._force_complete_popup)
        # شبكة أمان: عند إنهاء التحرير الحقيقي فقط أعد النص النظيف. نؤجل
        # التنفيذ لأن فتح قائمة النتائج قد يرسل focusOut مؤقتًا بعد أول حرف.
        self.lineEdit().editingFinished.connect(self._deferred_normalize_text)
        # النقر داخل الخانة يفتح القائمة فورًا · ترى الخيارات بمجرد الضغط
        self.lineEdit().installEventFilter(self)

    def eventFilter(self, obj, event):  # noqa: N802
        """نقرة داخل الخانة تفتح القائمة · للقوائم التابعة القصيرة فقط."""
        from PySide6.QtCore import QEvent
        if (self._search_only and obj is self.lineEdit()
                and event.type() == QEvent.KeyPress):
            return self._suggest_key(event)
        if (self._search_only and self._suggest is not None
                and event.type() == QEvent.KeyPress
                and (obj is self._suggest
                     or obj is self._suggest.viewport())):
            return self._suggest_popup_key(event)
        if (self._open_on_click and obj is self.lineEdit()
                and event.type() == QEvent.MouseButtonPress):
            if self.count() and not self._completer.popup().isVisible():
                # لا نستخدم QComboBox.showPopup هنا؛ قائمته تمسك لوحة المفاتيح
                # أحيانًا فيتوقف الإدخال بعد أول حرف. نافذة QCompleter تعرض
                # النتائج وتترك التركيز في خانة الكتابة.
                self._completer.setCompletionPrefix(self.lineEdit().text())
                self._completer.complete()
                QTimer.singleShot(0, self._refocus_line_edit)
        return super().eventFilter(obj, event)

    def wheelEvent(self, event):  # noqa: N802
        event.ignore()

    def showPopup(self):  # noqa: N802
        """بحث-فقط: مطابقات النص · وفارغة = أعلى البنود (V3.25)."""
        if getattr(self, "_search_only", False):
            try:
                prefix = (self.lineEdit().text() or "").strip()
            except Exception:
                prefix = ""
            if not prefix:
                if self._browse_on_empty:
                    self._suggest_show_all()
                else:
                    self._suggest_hide()
                return
            self._suggest_refresh(prefix)
            return
        super().showPopup()

    def hidePopup(self):  # noqa: N802
        if getattr(self, "_search_only", False):
            self._suggest_hide()
            return
        super().hidePopup()

    # ================== قائمة الاقتراحات الخاصة (بحث-فقط) ==================
    # خانة فارغة تمامًا ← كتابة ← مطابقات فقط ← اختيار بماوس/إنتر.
    # بلا QCompleter وبلا زر فتح — نتحكم في كل خطوة برمجيًا.

    def _build_suggest_popup(self):
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QAbstractItemView, QListWidget
        pop = QListWidget(self)
        pop.setWindowFlags(Qt.Popup)
        # V2.50: بلا تفعيل — النافذة كانت تسحب التفعيل من البرنامج في
        # ويندوز فتتوقف الكتابة حتى اختيار بند (البند 5).
        pop.setAttribute(Qt.WA_ShowWithoutActivating, True)
        pop.setObjectName("completerPopup")  # نفس ستايل نافذة النتائج
        pop.setFocusPolicy(Qt.NoFocus)
        pop.setMouseTracking(True)
        pop.setSelectionBehavior(QAbstractItemView.SelectRows)
        pop.setEditTriggers(QAbstractItemView.NoEditTriggers)
        pop.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        pop.itemClicked.connect(self._on_suggest_clicked)
        pop.installEventFilter(self)
        try:
            pop.viewport().installEventFilter(self)
        except Exception:
            pass
        pop.hide()
        self._suggest = pop
        self._suggest_last_key = None  # (النص، صفوف المطابقات) لتخطي إعادة البناء

    def _suggest_search_text(self, row: int) -> str:
        try:
            hidden = self.itemData(row, self._SEARCH_ROLE)
        except Exception:
            hidden = None
        return str(hidden) if hidden else self.itemText(row)

    def _suggest_match_rows(self, query: str) -> list:
        """مطابقات مرتبة — خروج مبكر بعد حد العرض + 1 (للقوائم الضخمة)."""
        q = (query or "").strip().casefold()
        if not q:
            return []
        cache = getattr(self, "_search_cache", None)
        if not isinstance(cache, list) or len(cache) != self.count():
            cache = self._rebuild_search_cache()
        need = self._SUGGEST_MAX + 1
        out = []
        for r, s in enumerate(cache):
            if q in s:
                out.append(r)
                if len(out) >= need:
                    break
        return out

    def _rebuild_search_cache(self) -> list:
        cache = [self._suggest_search_text(r).casefold()
                 for r in range(self.count())]
        self._search_cache = cache
        return cache

    _SUGGEST_MAX = 30  # V2.50: حد العرض (كان 100 — بناء أخف مع كل حرف)

    def _suggest_refresh(self, text: str):
        """إعادة بناء الاقتراحات من النص · تُخفى عند الفراغ/انعدام المطابق."""
        if not self._search_only or self._suggest is None:
            return
        rows = self._suggest_match_rows(text)
        if not rows:
            self._suggest.hide()
            self._suggest_last_key = ("", ())
            return
        self._suggest_render(rows, text or "")

    def _suggest_show_all(self):
        """V3.25: النقرة/↓ بخانة فارغة تعرض أعلى البنود — لا فراغ أبدًا."""
        if not self._search_only or self._suggest is None:
            return
        if not self.count():
            self._suggest_hide()
            return
        self._suggest_render(
            list(range(min(self.count(), self._SUGGEST_MAX))), "\0top")

    def _suggest_render(self, rows: list, key_text: str):
        """بناء نافذة الاقتراحات من صفوف جاهزة (مشترك)."""
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QListWidgetItem
        pop = self._suggest
        key = (key_text, tuple(rows[: self._SUGGEST_MAX + 1]))
        if key == self._suggest_last_key and pop.isVisible():
            return  # نفس المطابقات — لا إعادة بناء مع كل حرف (منع التجميد)
        self._suggest_last_key = key
        shown = rows[: self._SUGGEST_MAX]
        pop.setUpdatesEnabled(False)
        try:
            pop.clear()
            for r in shown:
                it = QListWidgetItem(self.itemText(r))
                it.setData(Qt.UserRole, r)
                pop.addItem(it)
            pop.setCurrentRow(0)
        finally:
            pop.setUpdatesEnabled(True)
        if not pop.isVisible():
            le = self.lineEdit()
            # القياس المعتمد: عرض المحتوى (أطول اسم) بحد أقصى عرض الخانة —
            # الصندوق داخل حدود الخانة دائمًا، والحافة الخارجية (يمنى في RTL)
            # على حافة الخانة.
            hint = pop.sizeHintForColumn(0) or 0
            extra = 30
            if len(shown) > 7:
                try:
                    extra += pop.verticalScrollBar().sizeHint().width()
                except Exception:
                    extra += 14
            w = min(self.width(), max(hint + extra, min(120, self.width())))
            pop.setFixedWidth(w)
            h = pop.sizeHintForRow(0) or 30
            pop.setFixedHeight(min(max(h * min(len(shown), 7) + 8, 40), 260))
            # الحافة من الكومبو نفسه (الخانة الداخلية أضيق بإطارها)
            br = self.mapToGlobal(self.rect().bottomRight())
            bl = self.mapToGlobal(self.rect().bottomLeft())
            if self.layoutDirection() == Qt.RightToLeft:
                pop.move(br.x() - w, br.y() + 2)
            else:
                pop.move(bl.x(), bl.y() + 2)
            pop.show()
            # V2.50: أعد التركيز للخانة فور الإظهار (شبكة أمان ويندوز)
            from PySide6.QtCore import QTimer as _QTimer
            _QTimer.singleShot(0, self._refocus_line_edit)

    def _suggest_hide(self):
        try:
            if self._suggest is not None:
                self._suggest.hide()
        except Exception:
            pass
        self._suggest_last_key = None

    def suggestion_count(self) -> int:
        """عدد الاقتراحات المعروضة حاليًا."""
        try:
            return self._suggest.count() if self._suggest is not None else 0
        except Exception:
            return 0

    def suggestions_visible(self) -> bool:
        """هل نافذة الاقتراحات ظاهرة؟"""
        try:
            return bool(self._suggest is not None
                        and self._suggest.isVisible())
        except Exception:
            return False

    def _on_suggest_clicked(self, item):
        from PySide6.QtCore import Qt
        try:
            row = int(item.data(Qt.UserRole))
        except Exception:
            return
        self._suggest_choose(row)

    def _suggest_choose(self, row: int):
        if row is None or row < 0 or row >= self.count():
            return
        self.setCurrentIndex(row)
        try:
            self.lineEdit().setText(self.itemText(row))
        except Exception:
            pass
        self._suggest_hide()
        self._refocus_line_edit()

    def _suggest_key(self, event) -> bool:
        """مفاتيح الخانة أثناء الاقتراحات: ↓↑ تنقل · إنتر اختيار · Esc إخفاء."""
        from PySide6.QtCore import Qt
        key = event.key()
        if not self.suggestions_visible():
            if key == Qt.Key_Down:
                try:
                    text = (self.lineEdit().text() or "").strip()
                except Exception:
                    text = ""
                if text:
                    self._suggest_refresh(text)
                    return True
            return False
        pop = self._suggest
        if key in (Qt.Key_Down, Qt.Key_Up):
            n = max(pop.count(), 1)
            step = 1 if key == Qt.Key_Down else -1
            pop.setCurrentRow((pop.currentRow() + step) % n)
            return True
        if key in (Qt.Key_Enter, Qt.Key_Return):
            cur = pop.currentItem()
            if cur is not None:
                self._on_suggest_clicked(cur)
                return True
            return False
        if key == Qt.Key_Escape:
            self._suggest_hide()
            return True
        return False

    def _suggest_popup_key(self, event) -> bool:
        """مفاتيح تصل لنافذة الاقتراحات نفسها (ويندوز يفعّل المنبثقة).

        - تنقل/اختيار/إخفاء: نعالجها هنا.
        - أي حرف آخر (كتابة/حذف/مسافة): نعيد التركيز للخانة ونمرر
          الحدث لها — وإلا توقفت الكتابة بعد أول حرف (آلية QCompleter).
        """
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QApplication
        key = event.key()
        pop = self._suggest
        if key in (Qt.Key_Down, Qt.Key_Up,
                   Qt.Key_PageDown, Qt.Key_PageUp):
            n = max(pop.count(), 1)
            if key == Qt.Key_Down:
                step = 1
            elif key == Qt.Key_Up:
                step = -1
            else:
                step = 5 if key == Qt.Key_PageDown else -5
            pop.setCurrentRow((pop.currentRow() + step) % n)
            return True
        if key in (Qt.Key_Enter, Qt.Key_Return):
            cur = pop.currentItem()
            if cur is not None:
                self._on_suggest_clicked(cur)
                return True
            return False
        if key == Qt.Key_Escape:
            self._suggest_hide()
            self._refocus_line_edit()
            return True
        try:
            le = self.lineEdit()
            le.setFocus(Qt.OtherFocusReason)
            QApplication.sendEvent(le, event)
        except Exception:
            pass
        return True

    def _force_complete_popup(self, text: str):
        """مع كل حرف: اعرض المطابقات فقط — إجباريًا لا اعتمادًا على Qt.

        الخانة تبدأ فارغة تمامًا؛ أول حرف يفتح نافذة المطابقات المُرشَّحة
        فقط (اسم/رقم/هاتف)، ومسح النص يُخفيها (المعالج الأصلي).
        """
        if self._search_only:
            self._suggest_refresh(text or "")
            return
        if not (text or "").strip():
            return
        try:
            self._completer.setCompletionPrefix(text)
            self._completer.complete()
            pop = self._completer.popup()
            if pop.minimumWidth() < self.width():
                pop.setMinimumWidth(self.width())
        except Exception:
            pass

    def _on_user_text_edited(self, text: str):
        """مسح المستخدم للنص لا يجب أن يعيد أول اختيار تلقائيًا."""
        if (text or "").strip():
            return
        self.blockSignals(True)
        try:
            self.setCurrentIndex(-1)
        finally:
            self.blockSignals(False)
        self.lineEdit().setText("")
        if self._search_only:
            self._suggest_hide()
        else:
            try:
                self._completer.popup().hide()
            except Exception:
                pass
        self.selection_changed.emit()

    def focusOutEvent(self, event):  # noqa: N802
        """عند مغادرة الخانة: تأكد أن الظاهر هو نص العرض النظيف دائمًا."""
        super().focusOutEvent(event)
        self._deferred_normalize_text()

    def _popup_is_visible(self) -> bool:
        if getattr(self, "_search_only", False):
            return self.suggestions_visible()
        try:
            return bool(self.view().isVisible() or self._completer.popup().isVisible())
        except Exception:
            return False

    def _refocus_line_edit(self):
        le = self.lineEdit()
        if le is not None:
            le.setFocus(Qt.OtherFocusReason)
            le.setCursorPosition(len(le.text()))

    def _deferred_normalize_text(self):
        """لا نطبّع النص أثناء ظهور نتائج البحث حتى لا يتوقف إدخال الأحرف."""
        def _run():
            if self._popup_is_visible():
                if self._focus_left_combo():
                    # المستخدم نقر خارج الخانة فعلًا: أخفِ القائمة وطبّع
                    # بدل سحب التركيز رغمًا (كان يمنع النقر خارجها).
                    if getattr(self, "_search_only", False):
                        self._suggest_hide()
                    else:
                        try:
                            self._completer.popup().hide()
                        except Exception:
                            pass
                    self._normalize_text()
                    return
                self._refocus_line_edit()
                return
            self._normalize_text()
        QTimer.singleShot(0, _run)

    def _focus_left_combo(self) -> bool:
        """هل التركيز الآن خارج الخانة وقائمتها (نقرة خارجية حقيقية)؟"""
        try:
            from PySide6.QtWidgets import QApplication
            fw = QApplication.focusWidget()
        except Exception:
            return False
        if fw is None:
            return False
        le = self.lineEdit()
        if fw is self or fw is le:
            return False
        try:
            if getattr(self, "_search_only", False):
                pop = self._suggest
            else:
                pop = self._completer.popup() if self._completer else None
            if pop is not None and (fw is pop or pop.isAncestorOf(fw)):
                return False
        except Exception:
            pass
        return True

    def _normalize_text(self):
        """إن كان النص المكتوب لا يطابق أي عنصر، أعده لنص العنصر المحدد.

        يمنع بقاء نص البحث الخفي (رقم العميل/الهاتف/البريد) ظاهرًا في
        الخانة بعد مغادرتها.
        """
        text = self.currentText().strip()
        if not text:
            # المستخدم فرّغ الخانة عمدًا · ألغِ التحديد (مهم للحقول الاختيارية)
            if self.currentIndex() != -1:
                self.setCurrentIndex(-1)
            self.lineEdit().setText("")
            return
        if self.findText(text) >= 0:
            return  # النص مطابق لعنصر فعلي · كل شيء سليم
        # النص لا يطابق عنصرًا: جرّب مطابقته مع نص البحث الخفي
        # (تطابق كامل، أو احتواء في عنصر واحد فقط · مثل كتابة رقم العقد)
        contains = []
        for row in range(self.count()):
            search = str(self.itemData(row, self._SEARCH_ROLE) or "")
            if text == search:
                self.setCurrentIndex(row)
                self.lineEdit().setText(self.itemText(row))
                return
            if text.casefold() in search.casefold():
                contains.append(row)
        try:
            from services.search_utils import normalize as _norm_search
        except Exception:
            _norm_search = lambda x: str(x or '').casefold()
        ntext = _norm_search(text)
        if ntext:
            normalized_contains = []
            for row in range(self.count()):
                search = str(self.itemData(row, self._SEARCH_ROLE) or "")
                if ntext in _norm_search(search):
                    normalized_contains.append(row)
            if len(normalized_contains) == 1:
                self.setCurrentIndex(normalized_contains[0])
                self.lineEdit().setText(self.itemText(normalized_contains[0]))
                return
        if len(contains) == 1:
            self.setCurrentIndex(contains[0])
            self.lineEdit().setText(self.itemText(contains[0]))
            return
        # وإلا: أعد نص العنصر المحدد حاليًا (أو فرّغ الخانة)
        idx = self.currentIndex()
        if idx >= 0:
            self.lineEdit().setText(self.itemText(idx))
        else:
            self.lineEdit().setText("")

    def _on_completer_index(self, index):
        row = index.row()
        # completer يعمل على نفس الموديل
        src_index = index
        if hasattr(index, "model") and index.model() is not self.model():
            try:
                src_index = index.model().mapToSource(index)
            except Exception:
                pass
        self.setCurrentIndex(src_index.row())
        self.lineEdit().setText(self.itemText(src_index.row()))

    def selected_data(self):
        """قيمة العنصر المحدد فعليًا (V4.5.10) — بلا لبس عند تشابه النصوص.

        قبل V4.5.10 كانت القيمة تُقرأ بمطابقة النص الظاهر (findText)،
        فإذا حمل عنصران النص نفسه (عقدان بنفس الاسم لنفس العميل مثلًا)
        رجعت قيمة **أول** عنصر لا المختار — فتظهر بنود ودفعات عقد آخر في
        نافذة عقد الباطن. الآن الأولوية للعنصر المحدد (currentIndex) ما
        دام نصه الظاهر مطابقًا لمكتوب الخانة، ثم نرجع للمطابقة النصية
        كما كانت (توافق خلفي لخانات تُكتب نصًا).
        """
        idx = self.currentIndex()
        if idx < 0:
            return None
        shown = (self.currentText() or "").strip()
        label = (self.itemText(idx) or "").strip()
        if shown and shown == label:
            return self.itemData(idx)
        return None

    def set_items(self, items, keep_selection: bool = False,
                  auto_select: bool = True):
        """تعبئة القائمة.

        items: [(نص_العرض، القيمة)] أو [(نص_العرض، القيمة، نص_البحث_الخفي)]
        نص البحث الخفي يشمل الهاتف/الأرقام · يُبحث فيه ولا يظهر.
        """
        current = self.selected_data() if keep_selection else None
        self.blockSignals(True)
        self.clear()
        display_items = list(items or [])
        for item in display_items:
            if len(item) >= 3:
                text, data, search_text = item[0], item[1], item[2]
            else:
                text, data = item[0], item[1]
                search_text = text
            self.addItem(text, data)
            row = self.count() - 1
            try:
                from services.search_utils import normalize as _norm_search
                normalized = _norm_search(f"{text} {search_text}")
            except Exception:
                normalized = ""
            self.setItemData(row, f"{text} {search_text} {normalized}", self._SEARCH_ROLE)
        if current is not None:
            idx = self.findData(current)
            if idx >= 0:
                self.setCurrentIndex(idx)
        self.blockSignals(False)
        if self._completer is not None:
            self._completer.setModel(self.model())
            self._completer.setCompletionRole(self._SEARCH_ROLE)
        if self._search_only:
            self._suggest_hide()
            try:
                self._rebuild_search_cache()
            except Exception:
                self._search_cache = []
        if current is None and display_items and auto_select and self.itemData(0) is not None:
            self.setCurrentIndex(0)
        elif current is None:
            # لا نملأ الخانة تلقائيًا بعبارات مثل «بدون عميل» أو «اختر».
            # تبقى الخانة فارغة بصريًا، والاختيار يتم بالبحث/الفتح فقط.
            self.setCurrentIndex(-1)
            self.lineEdit().setText("")
        self.selection_changed.emit()

    def select_data(self, data) -> bool:
        idx = self.findData(data)
        if idx >= 0:
            self.setCurrentIndex(idx)
            return True
        return False


# ============ عناصر قوائم: عرض نظيف + بحث خفي بكل البيانات ============
def customer_items() -> list[tuple[str, int, str]]:
    """العرض: الاسم فقط · البحث: الرقم + الهاتف + البريد."""
    from services import customer_service
    items = []
    for c in customer_service.list_customers():
        display = c.name
        search = " ".join(x for x in [c.customer_code, c.phone, c.email] if x)
        items.append((display, c.id, search))
    return items


def subcontractor_items() -> list[tuple[str, int, str]]:
    """العرض: اسم المقاول فقط · البحث: الرقم + الهاتف + النشاط."""
    from services import lifecycle_service as lc
    items = []
    for s in lc.list_subcontractors():
        display = s["name"]
        search = " ".join(x for x in [s.get("sub_code"), s.get("phone"),
                                      s.get("activity")] if x)
        items.append((display, s["id"], search))
    return items


def contract_items(customer_id=None) -> list[tuple[str, int, str]]:
    """العرض: اسم العميل — اسم العقد/رقمه · البحث: + الرقم + الهاتف."""
    from services import contract_service, customer_service
    phones = {c.id: c.phone for c in customer_service.list_customers()}
    items = []
    for c in contract_service.list_contracts(customer_id=customer_id):
        name = getattr(c, "contract_name", "") or c.description or ""
        core = name if name else c.contract_number
        cust = (getattr(c, "customer_name", "") or "").strip()
        # العميل أولًا ثم العقد — العقود المتشابهة تُميَّز بعميلها
        display = f"{cust} — {core}" if cust else core
        search = " ".join(x for x in [core, c.contract_number, cust,
                                      phones.get(c.customer_id)] if x)
        items.append((display, c.id, search))
    return items


def project_items() -> list[tuple[str, int, str]]:
    """العرض: اسم المشروع · البحث: الرقم + العميل."""
    from services import lifecycle_service as lc
    items = []
    for p in lc.list_projects():
        display = p["name"]
        search = " ".join(x for x in [p["project_code"],
                                      p.get("customer_name")] if x)
        items.append((display, p["id"], search))
    return items


# ============================================================
# نظام الحقول الإجبارية الموحد
# ============================================================
def required_label(text: str) -> str:
    """تنسيق عنوان حقل إجباري: نجمة حمراء واضحة."""
    return f'{text} <span style="color:{style.DANGER}; font-weight:800;">*</span>'


class RequiredValidator:
    """مدقق الحقول الإجبارية لنافذة إدخال.

    الاستخدام:
        v = RequiredValidator(dialog)
        v.add(self.name, "اسم العميل")
        v.add(self.customer, "العميل")       # SearchableComboBox
        v.add(self.amount, "المبلغ", min_value=0.001)  # SpinBox
        if not v.validate():
            return  # الرسالة عُرضت والحقل الناقص تلوّن
    """

    _ERROR_STYLE = f"border: 2px solid {style.DANGER}; border-radius: 9px;"

    def __init__(self, parent_widget):
        self.parent = parent_widget
        self._fields = []

    def add(self, widget, label: str, min_value: float | None = None):
        self._fields.append((widget, label, min_value))
        return self

    @staticmethod
    def _is_empty(widget, min_value):
        from PySide6.QtWidgets import (QComboBox, QDoubleSpinBox, QLineEdit,
                                       QSpinBox, QTextEdit)
        if isinstance(widget, SearchableComboBox):
            return widget.selected_data() is None
        if isinstance(widget, (QDoubleSpinBox, QSpinBox)):
            threshold = min_value if min_value is not None else 0.000001
            return widget.value() < threshold
        if isinstance(widget, QLineEdit):
            return not widget.text().strip()
        if isinstance(widget, QTextEdit):
            return not widget.toPlainText().strip()
        if isinstance(widget, QComboBox):
            return widget.currentIndex() < 0
        return False

    def _mark(self, widget, error: bool):
        if error:
            widget.setProperty("_orig_style", widget.styleSheet())
            widget.setStyleSheet(widget.styleSheet() + self._ERROR_STYLE)
        else:
            orig = widget.property("_orig_style")
            if orig is not None:
                widget.setStyleSheet(orig)

    def validate(self) -> bool:
        """يتحقق من كل الحقول · يلوّن الناقص ويعرض رسالة واحدة مجمعة."""
        missing = []
        first_bad = None
        for widget, label, min_value in self._fields:
            bad = self._is_empty(widget, min_value)
            self._mark(widget, bad)
            if bad:
                missing.append(label)
                if first_bad is None:
                    first_bad = widget
        if missing:
            from ui import style
            style.error(
                self.parent,
                "لا يمكن الحفظ · الحقول التالية إجبارية:\n\n"
                + "\n".join(f"  •  {m}" for m in missing),
                "حقول ناقصة")
            if first_bad is not None:
                first_bad.setFocus()
            return False
        return True


# ============================================================
# تصدير Excel عام لأي صفحة جدولية
# ============================================================
def export_table_excel(parent, title: str, heads: list, rows: list,
                       file_stem: str, number_cols: list | None = None):
    """حوار حفظ + توليد Excel أنيق + فتح الملف · للاستخدام من أي صفحة."""
    import os
    from PySide6.QtWidgets import QFileDialog
    from ui import style
    if not rows:
        style.info(parent, "لا توجد بيانات للتصدير.")
        return
    default = os.path.join(os.path.expanduser("~"), f"{file_stem}.xlsx")
    path, _ = QFileDialog.getSaveFileName(
        parent, "تصدير Excel", default, "Excel (*.xlsx)")
    if not path:
        return
    try:
        from reports.tabular_pdf import generate_table_excel
        generate_table_excel(title, heads, rows, path,
                             number_cols=number_cols or [])
        style.info(parent, f"تم التصدير:\n{path}", "تم")
        from ui.invoices import open_file_externally
        open_file_externally(path)
    except Exception:
        style.error(parent, "تعذر تصدير الملف.")


# ============================================================
# شريط ترقيم الصفحات · لعرض القوائم الكبيرة صفحة صفحة
# ============================================================
def sync_header_alignment(view) -> None:
    """توحيد محاذاة رؤوس الأعمدة مع محاذاة بياناتها فعليًا.

    السبب: رأس العمود الافتراضي في Qt يتوسّط، بينما الأرقام المالية
    تُحاذى يمينًا (MONEY_ALIGN) والبيانات المساعدة تتوسّط · فيبدو الرأس
    غير مطابق لعموده. هذه الدالة تقرأ محاذاة أول صف مملوء وتنسخها للرأس،
    فتبقى صحيحة تلقائيًا عند أي تغيير في الأعمدة (قاعدة 14).
    """
    from PySide6.QtCore import Qt
    try:
        # منع التحريك اليدوي للأعمدة في كل الجداول/الأشجار؛ التوزيع يبقى آليًا.
        h = view.horizontalHeader() if hasattr(view, "horizontalHeader") else view.header()
        if h is not None:
            h.setSectionsMovable(False)
            h.setFirstSectionMovable(False)
    except Exception:
        pass
    try:
        cols = view.columnCount()
    except AttributeError:
        return
    # أول صف يحمل بيانات
    row_item = None
    if hasattr(view, "topLevelItemCount"):          # QTreeWidget
        if view.topLevelItemCount():
            row_item = view.topLevelItem(0)
        header = view.headerItem() if hasattr(view, "headerItem") else None
        if header is None:
            return
        for c in range(cols):
            align = (row_item.textAlignment(c) if row_item is not None else 0)
            if not int(align):
                # خلية بلا محاذاة صريحة تُرسم باتجاه اللغة · وفي RTL
                # يُعكس AlignLeft بصريًا إلى اليمين (قاعدة 13)
                align = Qt.AlignLeft | Qt.AlignVCenter
            header.setTextAlignment(c, align)
        return
    # QTableWidget
    for r in range(getattr(view, "rowCount", lambda: 0)()):
        if view.item(r, 0) is not None:
            row_item = r
            break
    for c in range(cols):
        head = view.horizontalHeaderItem(c)
        if head is None:
            continue
        cell = view.item(row_item, c) if row_item is not None else None
        align = cell.textAlignment() if cell is not None else 0
        if not int(align):
            align = Qt.AlignLeft | Qt.AlignVCenter    # يُعكس في RTL
        head.setTextAlignment(align)


def size_buttons(buttons, min_w: int = 0, uniform: bool = True) -> None:
    """توحيد مقاس أزرار بلا اقتطاع نص · حد أدنى فقط ولا مقاس ثابت أبدًا.

    الارتفاع يأتي من QSS المركزي (الحشوة والخط) فلا يُفرض رقم أصغر منه،
    والعرض = أعرض نص في المجموعة أو `min_w` أيهما أكبر (قاعدة 33).
    """
    items = [b for b in buttons if b is not None]
    if not items:
        return
    need_w = need_h = 0
    for b in items:
        b.ensurePolished()
        hint = b.sizeHint()
        need_w = max(need_w, hint.width())
        need_h = max(need_h, hint.height())
    need_w = max(need_w, int(min_w or 0))
    for b in items:
        b.setMinimumHeight(need_h)
        b.setMinimumWidth(need_w if uniform else
                          max(b.sizeHint().width(), int(min_w or 0)))


def more_menu_button(parent, actions: list[tuple]) -> "QPushButton":
    """زر ⋯ المزيد الموحد (V4.18): إجراءات نادرة الاستخدام في قائمة.

    actions = [(النص, الدالة), ...] — تُبنى بنفس الترتيب المعطى.
    """
    from PySide6.QtWidgets import QMenu, QPushButton
    btn = QPushButton("⋯ المزيد", parent)
    btn.setProperty("flat", True)
    menu = QMenu(btn)
    for text, slot in actions:
        menu.addAction(text, slot)
    btn.setMenu(menu)
    return btn


class PaginationBar(QWidget):
    """شريط «السابق / صفحة X من Y / التالي» يعمل مع أي قائمة كبيرة.

    الاستخدام:
        self.pager = PaginationBar(page_size=50)
        self.pager.page_changed.connect(self.refresh)
        ...
        rows = self.pager.slice(all_rows)   # داخل refresh
    """
    page_changed = Signal()

    PAGE_SIZE = 50  # الحجم الافتراضي الموحد في كل النظام

    def __init__(self, parent=None, page_size: int | None = None):
        from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton
        super().__init__(parent)
        self.page_size = page_size or self.PAGE_SIZE
        self.page = 0          # صفحة حالية (تبدأ من صفر)
        self.total = 0         # إجمالي الصفوف
        self.setObjectName("transparentHost")

        # تخطيط ملتف: على الشاشات الضيقة تنزل الأزرار سطرًا ثانيًا بدل
        # أن يفرض الشريط عرضًا أدنى (534px) يخلق تمريرًا أفقيًا للصفحة
        # كلها — وهو ما حدث في الرئيسية (القاعدة 48).
        from PySide6.QtWidgets import QVBoxLayout as _QVB
        _outer = _QVB(self)
        _outer.setContentsMargins(0, 0, 0, 0)
        _host, lay = flow_host(spacing=8)
        _outer.addWidget(_host)

        # نص عربي فقط · بلا إيموجي (تظهر مربعات على بعض أجهزة ويندوز)
        self.first_btn = QPushButton("الأولى")
        self.prev_btn = QPushButton("السابق")
        self.next_btn = QPushButton("التالي")
        self.last_btn = QPushButton("الأخيرة")
        _pager_btns = (self.first_btn, self.prev_btn,
                       self.next_btn, self.last_btn)
        for b in _pager_btns:
            b.setProperty("flat", True)
            b.setCursor(Qt.PointingHandCursor)
        # مقاس موحد محسوب من النص · لا مقاس ثابت (قاعدة 33)
        size_buttons(_pager_btns, min_w=84)
        self.info_lbl = QLabel("")
        self.info_lbl.setProperty("hint", True)
        self.info_lbl.setMinimumWidth(0)
        self.info_lbl.setAlignment(Qt.AlignCenter)

        self.first_btn.clicked.connect(lambda: self._go(0))
        self.prev_btn.clicked.connect(lambda: self._go(self.page - 1))
        self.next_btn.clicked.connect(lambda: self._go(self.page + 1))
        self.last_btn.clicked.connect(lambda: self._go(self.pages() - 1))

        lay.addWidget(self.first_btn)
        lay.addWidget(self.prev_btn)
        lay.addWidget(self.info_lbl)
        lay.addWidget(self.next_btn)
        lay.addWidget(self.last_btn)

    def pages(self) -> int:
        return max(1, -(-self.total // self.page_size))  # ceil

    def _go(self, page: int):
        page = max(0, min(page, self.pages() - 1))
        if page != self.page:
            self.page = page
            self.page_changed.emit()

    def reset(self):
        """العودة لأول صفحة (تُستدعى عند تغيير البحث)."""
        self.page = 0

    def slice(self, rows: list) -> list:
        """تسجيل الإجمالي + إرجاع شريحة الصفحة الحالية + تحديث الشريط."""
        self.total = len(rows)
        if self.page >= self.pages():
            self.page = self.pages() - 1
        start = self.page * self.page_size
        chunk = rows[start:start + self.page_size]
        self._update_bar(start, len(chunk))
        return chunk

    def server_slice(self, total: int, fetch):
        """ترقيم على مستوى قاعدة البيانات.

        ``total``: العدد الكلي (من دالة count_*).
        ``fetch(limit, offset)``: تجلب صفحة واحدة فقط.

        الفرق عن ``slice``: لا تُنقل كل السجلات إلى الذاكرة — تُجلب
        صفحة واحدة فقط، وهو ما يمنع نقل ميجابايتات عبر الشبكة لعرض
        50 صفًا. الدالة القديمة باقية كما هي لبقية الشاشات.
        """
        self.total = int(total or 0)
        if self.page >= self.pages():
            self.page = self.pages() - 1
        if self.page < 0:
            self.page = 0
        start = self.page * self.page_size
        chunk = list(fetch(self.page_size, start) or [])
        # حماية: لو حُذفت صفوف بين العدّ والجلب فصارت الصفحة فارغة
        if not chunk and self.total and start >= self.total:
            self.page = max(0, self.pages() - 1)
            start = self.page * self.page_size
            chunk = list(fetch(self.page_size, start) or [])
        self._update_bar(start, len(chunk))
        return chunk

    def offset(self) -> int:
        """إزاحة الصفحة الحالية (للاستخدام مع server_slice)."""
        return self.page * self.page_size

    def _update_bar(self, start: int, shown: int):
        many = self.total > self.page_size
        # الشريط كله يختفي لو النتائج تدخل في صفحة واحدة
        self.setVisible(many)
        if not many:
            return
        self.info_lbl.setText(
            f"صفحة {self.page + 1} من {self.pages()}"
            f"   ({start + 1}–{start + shown} من {self.total})")
        self.first_btn.setEnabled(self.page > 0)
        self.prev_btn.setEnabled(self.page > 0)
        self.next_btn.setEnabled(self.page < self.pages() - 1)
        self.last_btn.setEnabled(self.page < self.pages() - 1)


class FlowLayout(QLayout):
    """تخطيط أفقي يلتف تلقائيًا لسطر جديد عند ضيق العرض.

    يُستخدم في أشرطة الأدوات (بحث/فلاتر/أزرار) وشريط الإجراءات السريعة،
    فتنزل العناصر سطرًا إضافيًا على الشاشات الصغيرة (1366×768 أو مع تكبير
    ويندوز 125%/150%) بدل أن تُجبِر النافذة على عرض أكبر من الشاشة.
    """

    def __init__(self, parent=None, margin: int = 0, spacing: int = 8):
        super().__init__(parent)
        self._items: list = []
        self.setContentsMargins(margin, margin, margin, margin)
        self._space = spacing

    def __del__(self):
        while self._items:
            self._items.pop()

    # --- واجهة QLayout الإلزامية ---
    def addWidget(self, widget, *args):  # noqa: N802
        """إضافة Widget مع تجاهل معاملات stretch/alignment الاختيارية.

        بعض الشاشات تستعمل نفس صيغة QBoxLayout مثل:
            layout.addWidget(widget, 1)
        بينما QLayout الأساسي يقبل widget فقط. هذا الغلاف يحافظ على التوافق
        ويمنع TypeError عند استعمال FlowLayout كبديل ملتف.
        """
        super().addWidget(widget)

    def addItem(self, item):  # noqa: N802
        self._items.append(item)

    def count(self) -> int:
        return len(self._items)

    def itemAt(self, index):  # noqa: N802
        if 0 <= index < len(self._items):
            return self._items[index]
        return None

    def takeAt(self, index):  # noqa: N802
        if 0 <= index < len(self._items):
            return self._items.pop(index)
        return None

    def expandingDirections(self):  # noqa: N802
        return Qt.Orientations(Qt.Orientation(0))

    def hasHeightForWidth(self) -> bool:  # noqa: N802
        return True

    def heightForWidth(self, width: int) -> int:  # noqa: N802
        return self._do_layout(QRect(0, 0, width, 0), test_only=True)

    def setGeometry(self, rect):  # noqa: N802
        super().setGeometry(rect)
        self._do_layout(rect, test_only=False)

    def sizeHint(self) -> QSize:  # noqa: N802
        """المقاس المفضّل = كل العناصر في سطر واحد (كالشريط الأفقي العادي).

        بهذا يبقى الشريط سطرًا واحدًا على الشاشات الواسعة، ويلتف فقط
        عندما يضيق العرض فعلًا.
        """
        width = 0
        height = 0
        for i, item in enumerate(self._items):
            hint = item.sizeHint()
            width += hint.width() + (self._space if i else 0)
            height = max(height, hint.height())
        margins = self.contentsMargins()
        return QSize(width + margins.left() + margins.right(),
                     height + margins.top() + margins.bottom())

    def minimumSize(self) -> QSize:  # noqa: N802
        """أدنى عرض = أعرض عنصر فقط (الباقي ينزل أسطرًا).

        V8.5: يُرجع أيضًا ارتفاعًا أدنى (مجموع أسطر كاملة) حتى لا يختفي
        الودجت تمامًا عندما يُسأل Qt عن المقاس قبل أن يعرف العرض الفعلي
        (يحدث على بعض أجهزة Windows مع DPI تكيّفي).
        """
        w = QSize()
        line_h = 0
        line_w = 0
        for item in self._items:
            s = item.minimumSize()
            line_w += s.width()
            line_h = max(line_h, s.height())
            w = w.expandedTo(s)
        # ارتفاع أدنى = سطر واحد على الأقل (لكل العناصر)
        h = line_h if self._items else 0
        margins = self.contentsMargins()
        return QSize(w.width() + margins.left() + margins.right(),
                     h + margins.top() + margins.bottom())

    def _is_rtl(self) -> bool:
        """الاتجاه من الواجهة الأم · النظام كله عربي RTL."""
        from PySide6.QtWidgets import QApplication
        parent = self.parentWidget()
        if parent is not None:
            return parent.layoutDirection() == Qt.RightToLeft
        return QApplication.layoutDirection() == Qt.RightToLeft

    # --- الترتيب الفعلي ---
    def _do_layout(self, rect: QRect, test_only: bool) -> int:
        margins = self.contentsMargins()
        left = rect.x() + margins.left()
        right = rect.right() - margins.right()
        y = rect.y() + margins.top()
        line_height = 0
        rtl = self._is_rtl()
        # في RTL نبدأ من أقصى اليمين ونمشي لليسار
        cursor = right if rtl else left

        for item in self._items:
            hint = item.sizeHint()
            if rtl:
                start = cursor - hint.width()
                if start < left - 1 and line_height > 0:
                    cursor = right
                    y += line_height + self._space
                    line_height = 0
                    start = cursor - hint.width()
                if not test_only:
                    item.setGeometry(QRect(QPoint(start, y), hint))
                cursor = start - self._space
            else:
                end = cursor + hint.width()
                if end > right + 1 and line_height > 0:
                    cursor = left
                    y += line_height + self._space
                    line_height = 0
                if not test_only:
                    item.setGeometry(QRect(QPoint(cursor, y), hint))
                cursor += hint.width() + self._space
            line_height = max(line_height, hint.height())

        return y + line_height - rect.y() + margins.bottom()


def flow_host(parent=None, margin: int = 0, spacing: int = 8):
    """حاوية جاهزة بتخطيط ملتف · تُستخدم في أشرطة الأدوات.

    ترجع (الحاوية، التخطيط). الحاوية تسمح بتقليص عرضها وتحسب ارتفاعها
    حسب العرض المتاح، فتنزل العناصر سطرًا إضافيًا تلقائيًا عند الحاجة.
    """
    from PySide6.QtWidgets import QSizePolicy, QWidget as _QWidget
    host = _QWidget(parent)
    host.setObjectName("transparentHost")
    layout = FlowLayout(host, margin=margin, spacing=spacing)
    policy = QSizePolicy(QSizePolicy.Preferred, QSizePolicy.Minimum)
    policy.setHeightForWidth(True)
    host.setSizePolicy(policy)
    # V8.5: ارتفاع أدنى يمنع اختفاء الشريط على Windows
    # (بعض أجهزة Windows تطلب sizeHint قبل setGeometry فيختفي الودجت)
    host.setMinimumHeight(32)
    return host, layout


def make_searchable(combo, placeholder: str = "",
                    click_to_open: bool = True):
    """يجعل QComboBox عاديًا قابلًا للكتابة والبحث داخل عناصره.

    آمن تمامًا: لا يغيّر العناصر ولا بياناتها، ولا يسمح بإدخال قيمة
    جديدة (NoInsert)، ويطابق أي جزء من النص. يُستدعى **بعد** تعبئة
    العناصر (المكمّل يرى النموذج حيًّا فلا ضرر من التعبئة بعده).

    تطبيع النص مطابق لسلوك SearchableComboBox: مسح المستخدم للنص
    يلغي التحديد (‎-1‎/None)، والنص الذي لا يطابق أي عنصر يرتد عند
    مغادرة الخانة إلى نص العنصر المحدد — فلا يبقى نص غريب عالقًا.
    """
    try:
        from PySide6.QtCore import Qt, QTimer
        from PySide6.QtWidgets import QComboBox, QCompleter
        combo.setEditable(True)
        combo.setInsertPolicy(QComboBox.NoInsert)
        le = combo.lineEdit()
        if le is not None:
            le.setPlaceholderText(placeholder)
        comp = QCompleter(combo.model(), combo)
        comp.setCompletionMode(QCompleter.PopupCompletion)
        comp.setFilterMode(Qt.MatchContains)
        comp.setCaseSensitivity(Qt.CaseInsensitive)
        try:
            comp.popup().setObjectName("completerPopup")
            # نافذة النتائج لا تسحب التركيز؛ يستطيع المستخدم إكمال
            # الكتابة مباشرة بعد أول حرف (كما في SearchableComboBox).
            comp.popup().setFocusPolicy(Qt.NoFocus)
        except Exception:
            pass
        combo.setCompleter(comp)

        def _on_user_text_edited(text):
            # حرف مكتوب ← اعرض المطابقات فقط إجباريًا.
            if (text or "").strip():
                try:
                    comp.setCompletionPrefix(text)
                    comp.complete()
                except Exception:
                    pass
                return
            # مسح المستخدم للنص يلغي التحديد (مهم للحقول الاختيارية).
            try:
                combo.setCurrentIndex(-1)
            except Exception:
                pass
            try:
                combo.lineEdit().setText("")
            except Exception:
                pass
            try:
                combo.completer().popup().hide()
            except Exception:
                pass

        def _normalize_text():
            try:
                text = (combo.currentText() or "").strip()
            except Exception:
                return
            if not text:
                try:
                    if combo.currentIndex() != -1:
                        combo.setCurrentIndex(-1)
                    combo.lineEdit().setText("")
                except Exception:
                    pass
                return
            try:
                if combo.findText(text) >= 0:
                    return  # النص مطابق لعنصر فعلي · كل شيء سليم
                idx = combo.currentIndex()
                combo.lineEdit().setText(
                    combo.itemText(idx) if idx >= 0 else "")
            except Exception:
                pass

        def _deferred_normalize():
            # لا نطبّع أثناء ظهور نتائج البحث حتى لا يتوقف الإدخال.
            def _run():
                try:
                    if combo.completer().popup().isVisible():
                        return
                except Exception:
                    pass
                _normalize_text()
            QTimer.singleShot(0, _run)

        try:
            le.textEdited.connect(_on_user_text_edited)
            le.editingFinished.connect(_deferred_normalize)
        except Exception:
            pass
        if click_to_open:
            try:
                install_click_to_open(combo)
            except Exception:
                pass
    except Exception:
        pass
    return combo


def hide_popups_on_scroll(table):
    """إخفاء نوافذ الاقتراحات/القوائم عند تمرير جدول يحمل خانات بحث.

    تمنع بقاء نافذة عالقة فوق خلايا خاطئة أثناء التمرير (تداخل ظاهري).
    """
    try:
        from PySide6.QtWidgets import QComboBox
    except Exception:
        return table

    def _hide(*_):
        try:
            boxes = table.findChildren(QComboBox)
        except Exception:
            return
        for cb in boxes:
            try:
                cb.hidePopup()
            except Exception:
                pass
    try:
        table.horizontalScrollBar().valueChanged.connect(_hide)
        table.verticalScrollBar().valueChanged.connect(_hide)
    except Exception:
        pass
    return table


class SegmentedTabs(QWidget):
    """تابات مقسمة عصرية بنفس هوية النظام · بواجهة QComboBox للتوافق.

    تُستخدم بدل قوائم «النوع» المنسدلة (نوع الصرف/الطرف): أزرار ظاهرة
    دائمًا بدل قائمة مخفية، مع عدّاد اختياري لكل تاب («عميل (2)»).
    الواجهة المتوافقة مع QComboBox: addItem · count · itemData ·
    findData · currentIndex · currentData · currentText ·
    setCurrentIndex · setCurrentData · currentIndexChanged(int).
    """

    currentIndexChanged = Signal(int)

    def __init__(self, parent=None):
        from PySide6.QtWidgets import QHBoxLayout
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)
        self._buttons = []
        self._base_texts = []
        self._datas = []
        self._index = -1
        self.setStyleSheet(
            "QPushButton { border: 1.5px solid #CBD5E1; border-radius: 9px;"
            " padding: 7px 18px; background: #FFFFFF; color: #475569;"
            " font-weight: 700; font-size: 13px; }"
            "QPushButton:checked { background: #4F46E5; color: #FFFFFF;"
            " border-color: #4F46E5; }"
            "QPushButton:!checked:hover { background: #EFF6FF; }"
            "QPushButton:disabled { color: #9CA3AF; background: #F1F5F9; }")

    def addItem(self, text: str, data=None):
        from PySide6.QtWidgets import QPushButton
        btn = QPushButton(text)
        btn.setCheckable(True)
        btn.setCursor(Qt.PointingHandCursor)
        i = len(self._buttons)
        btn.toggled.connect(lambda checked, _i=i: self._on_toggled(_i, checked))
        self.layout().addWidget(btn)
        self._buttons.append(btn)
        self._base_texts.append(text)
        self._datas.append(data)
        if self._index < 0:
            self.setCurrentIndex(0)
        return self

    def _on_toggled(self, i: int, checked: bool):
        if not checked:
            if i == self._index and 0 <= i < len(self._buttons):
                # منع فك التحديد بالنقر على التاب المحدد (سلوك التابات)
                self._buttons[i].blockSignals(True)
                self._buttons[i].setChecked(True)
                self._buttons[i].blockSignals(False)
            return
        self.setCurrentIndex(i)

    def setCurrentIndex(self, i: int):
        if not (0 <= i < len(self._buttons)) or i == self._index:
            return
        for j, b in enumerate(self._buttons):
            want = (j == i)
            if b.isChecked() != want:
                b.blockSignals(True)
                b.setChecked(want)
                b.blockSignals(False)
        self._index = i
        self.currentIndexChanged.emit(i)

    def setCurrentData(self, data):
        i = self.findData(data)
        if i >= 0:
            self.setCurrentIndex(i)

    def findData(self, data) -> int:
        for i, d in enumerate(self._datas):
            if d == data:
                return i
        return -1

    def count(self) -> int:
        return len(self._buttons)

    def itemData(self, i: int):
        return self._datas[i] if 0 <= i < len(self._datas) else None

    def currentIndex(self) -> int:
        return self._index

    def currentData(self):
        return self.itemData(self._index)

    def currentText(self) -> str:
        try:
            return self._buttons[self._index].text()
        except Exception:
            return ""

    def setCount(self, i: int, n: int):
        """عدّاد على التاب: «عميل (2)»."""
        if 0 <= i < len(self._buttons):
            self._buttons[i].setText(f"{self._base_texts[i]} ({int(n)})")


class _ClickOpenFilter(QObject):
    """النقر بالزر الأيسر في أي مكان داخل الخانة يفتح قائمة الخيارات.

    يطابق سلوك SearchableComboBox (open_on_click) مع فارق واحد مقصود:
    يقتصر على الزر الأيسر حتى لا تتعارض القائمة مع قائمة الزر الأيمن.
    يُعيد False دائمًا فلا يبتلع الحدث (التركيز وموضع المؤشر طبيعيان).
    """

    def __init__(self, combo, parent=None):
        super().__init__(parent or combo)
        self._combo = combo

    def eventFilter(self, obj, event):  # noqa: N802
        try:
            from PySide6.QtCore import QEvent, Qt, QTimer
            combo = self._combo
            if (obj is combo.lineEdit()
                    and event.type() == QEvent.MouseButtonPress
                    and event.button() == Qt.LeftButton):
                comp = combo.completer()
                if (comp is not None and combo.count()
                        and not comp.popup().isVisible()):
                    le = combo.lineEdit()
                    comp.setCompletionPrefix(le.text() if le else "")
                    comp.complete()
                    if le is not None:
                        QTimer.singleShot(
                            0,
                            lambda: (le.setFocus(Qt.OtherFocusReason),
                                     le.setCursorPosition(len(le.text()))))
        except Exception:
            pass
        return False


def install_click_to_open(combo):
    """تثبيت الفتح بالنقر على قائمة قابلة للبحث (مرة واحدة فقط)."""
    try:
        if getattr(combo, "_click_open_filter", None) is not None:
            return combo
        le = combo.lineEdit()
        if le is None:
            return combo
        filt = _ClickOpenFilter(combo, combo)
        combo._click_open_filter = filt  # مرجع بايثون حتى لا يُجمع قمامةً
        le.installEventFilter(filt)
    except Exception:
        pass
    return combo


def apply_column_weights(view, weights, min_widths=None, content_cols=()):
    """توزيع عرض الأعمدة تلقائيًا بحيث يملأ العرض المتاح بلا تمرير أفقي.

        apply_column_weights(tree, [32, 14, 14, 14, 12, 0],
                             min_widths=[180, 90, 90, 90, 80, 0],
                             content_cols=(5,))

    - أعمدة `content_cols` (أعمدة الأزرار/الإجراءات) تبقى ResizeToContents
      لأن عرضها ثابت فعليًا بمحتواها.
    - باقي الأعمدة (النصية/الرقمية) تتقاسم ما يتبقى من العرض حسب النِسب،
      فعمود الاسم يأخذ نصيبًا أكبر من أعمدة الأرقام.
    """
    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QHeaderView, QTableWidget

    header = (view.horizontalHeader() if isinstance(view, QTableWidget)
              else view.header())
    count = len(weights)
    flex = [i for i in range(count) if i not in content_cols]
    header.setSectionsMovable(False)
    header.setFirstSectionMovable(False)
    for i in range(count):
        # Fixed يمنع سحب المستخدم للأعمدة يدويًا، بينما يظل resizeSection
        # البرمجي أدناه يوزع العرض تلقائيًا مع كل تغيير حجم.
        header.setSectionResizeMode(
            i, QHeaderView.ResizeToContents if i in content_cols
            else QHeaderView.Fixed)
    header.setStretchLastSection(False)
    mins = list(min_widths or [60] * count)

    def _redistribute():
        try:
            total = view.viewport().width()
            if total <= 0:
                return
            used = sum(header.sectionSize(i) for i in content_cols)
            room = total - used
            if room <= 0:
                return
            sum_w = float(sum(weights[i] for i in flex)) or 1.0
            widths = {}
            for i in flex:
                widths[i] = max(mins[i], int(room * weights[i] / sum_w))
            diff = room - sum(widths.values())
            if diff > 0 and flex:
                widest = max(flex, key=lambda i: weights[i])
                widths[widest] += diff
            elif diff < 0 and flex:
                # الحدود الدنيا تجاوزت العرض المتاح: نضغط الأعرض أولًا
                # حتى 75% من حدّه الأدنى — أفضل من ترك تمرير أفقي بـ1px
                over = -diff
                # تمريرتان: الأولى حتى 75% من الحد الأدنى، والثانية —
                # عند الشاشات الضيقة جدًا — حتى 36px حفاظًا على «لا
                # تمرير أفقي» (القاعدة 48) بدل بقاء بكسل أو اثنين
                for factor, hard in ((0.75, 40), (0.0, 36)):
                    if over <= 0:
                        break
                    for i in sorted(flex, key=lambda c: -widths[c]):
                        if over <= 0:
                            break
                        floor_i = max(hard, int(mins[i] * factor))
                        take = min(over, widths[i] - floor_i)
                        if take > 0:
                            widths[i] -= take
                            over -= take
            for i, wdt in widths.items():
                header.resizeSection(i, wdt)
        except RuntimeError:
            pass

    view._redistribute_columns = _redistribute
    # آمنة عند الاستدعاء المتكرر: لا نغلّف resizeEvent أكثر من مرة
    if not getattr(view, "_col_weights_hooked", False):
        original_resize = view.resizeEvent

        def _on_resize(event):
            original_resize(event)
            fn = getattr(view, "_redistribute_columns", None)
            if fn:
                fn()

        view.resizeEvent = _on_resize
        view._col_weights_hooked = True
    QTimer.singleShot(0, _redistribute)
    return _redistribute


def fit_table_with_floors(table, initial: list[int], floors: list[int],
                          desc_col: int):
    """توزيع أعمدة جدول خلاياه ودجات إدخال (لا نصوص فقط).

    - بالوسع: المقاسات الابتدائية + الفائض كله لعمود البيان.
    - بالضيق: تتقلص الأعمدة تناسبيًا حتى أرضية كل عمود (الحد الأدنى
      لودجة خليته) ثم يظهر تمرير أفقي — فلا يفيض ودجت على جاره أبدًا.
    - الأعمدة تبقى Interactive (المستخدم يسحبها)؛ إعادة التوزيع تعمل
      فقط عند تغيّر حجم الجدول نفسه.
    """
    from PySide6.QtWidgets import QHeaderView
    header = table.horizontalHeader()
    n = table.columnCount()
    for i in range(n):
        header.setSectionResizeMode(i, QHeaderView.Interactive)
    others = [i for i in range(n) if i != desc_col]
    sum_init = float(sum(initial)) or 1.0
    sum_others = float(sum(initial[i] for i in others)) or 1.0

    def _fit():
        try:
            vp = table.viewport().width()
        except RuntimeError:
            return
        if vp <= 0:
            return
        if vp >= sum_init:
            widths = {i: initial[i] for i in others}
            widths[desc_col] = initial[desc_col] + int(vp - sum_init)
        else:
            room = vp - floors[desc_col]
            factor = min(1.0, room / sum_others)
            widths = {}
            for i in others:
                widths[i] = max(floors[i],
                                int(initial[i] * factor))
            widths[desc_col] = max(
                floors[desc_col], vp - sum(widths.values()))
        # V5.9: حماية مقروئية «البيان» — لا يصغر عن أوسع عمود آخر
        # (بعد أن صارت قوائم الحسابات تعرض اسمًا نهائيًا أقصر فاتسع الجدول).
        if widths:
            _widest = max(widths.values())
            if widths.get(desc_col, 0) < _widest:
                widths[desc_col] = _widest
        for i, wdt in widths.items():
            try:
                header.resizeSection(i, wdt)
            except RuntimeError:
                return

    table._fit_initial = list(initial)
    table._fit_floors = list(floors)
    table._fit_desc_col = desc_col
    if not getattr(table, "_fit_floors_hooked", False):
        table._fit_floors_hooked = True
        _orig = table.resizeEvent

        def _on_resize(ev, _o=_orig):
            _o(ev)
            _fit()

        table.resizeEvent = _on_resize
    QTimer.singleShot(0, _fit)
    return _fit


# ============================================================
# رأس موحّد + شريط إجراءات موحّد
# تستعملهما شاشتا «ملف العميل» و«مركز العقد» ليخرجا بنفس الشكل
# بدل تكرار بناء الرأس والأزرار في كل شاشة.
# ============================================================

# ============================================================
# مستويات الأزرار (نظام الثيم · المرحلة 2)
# primary  : الفعل الأساسي · زر واحد فقط في كل شاشة
# receipt  : الفعل المالي الإيجابي (سند قبض · إنهاء مهمة)
# danger   : الصرف والحذف والإلغاء
# ghost    : إغلاق/إلغاء · بلا خلفية
# ""       : المستوى الثانوي الافتراضي (كشوف · تصدير · طباعة)
# ============================================================
BUTTON_LEVELS = {
    "primary": "btnPrimary",
    "receipt": "btnReceipt",
    "danger": "btnDangerSoft",
    "ghost": "btnGhost",
    # ثانوي محايد: بلا objectName فيأخذ نمط الزر الافتراضي ·
    # للنسخ المكررة من الإجراء الأساسي (§5: رئيسي ظاهر واحد)
    "secondary": "",
    "": "",
}


def apply_button_level(button, level: str = ""):
    """إعطاء الزر مستواه البصري · الافتراضي ثانوي.

    إن لم يُمرَّر مستوى، يُؤخذ من سجل الإجراءات الموحّد ACTION_LEVELS حتى
    يظهر الإجراء الواحد بنفس اللون في كل الشاشات (لا «سند قبض» أخضر هنا
    ورمادي هناك).
    """
    lvl = (level or "").strip()
    if not lvl:
        lvl = level_for(button.text())
    name = BUTTON_LEVELS.get(lvl, "")
    if name:
        button.setObjectName(name)
    return button


# ============================================================
# سجل الإجراء ← مستواه اللوني (المصدر الوحيد للاتساق)
# ============================================================
# القاعدة: اللون يتبع *معنى الإجراء* لا الشاشة التي يقف فيها.
#   receipt = دخول مال (أخضر) · danger = خروج مال أو إتلاف (أحمر هادئ)
#   primary = الإجراء الأساسي (أزرق) · الباقي ثانوي رمادي
ACTION_LEVELS = {
    # دخول مال
    "سند قبض": "receipt",
    "سند قبض (دفعة)": "receipt",
    "تسجيل دفعة": "receipt",
    # خروج مال / إتلاف
    "سند صرف": "danger",
    "سند صرف لمقاول باطن": "danger",
    # الإجراء الأساسي المنشئ
    "عقد جديد": "primary",
}


def level_for(text: str) -> str:
    """مستوى اللون المعتمد لنص إجراء (يتجاهل الإيموجي والمسافات)."""
    import re as _re
    key = _re.sub(r"[\U0001F300-\U0001FAFF\u2190-\u27BF\u2B00-\u2BFF"
                  r"\uFF0B\uFE0F\u200f\u200e]", "", text or "")
    key = _re.sub(r"\s+", " ", key).strip(" .·…")
    return ACTION_LEVELS.get(key, "")


def _rgba(hex_color: str, alpha: float) -> str:
    """Qt يفسّر #RRGGBBAA على أنه #AARRGGBB · لذلك rgba() صراحةً."""
    h = (hex_color or style.NEUTRAL).lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"


def _darken(hex_color: str, factor: float = 0.66) -> str:
    h = (hex_color or style.NEUTRAL).lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return "#%02X%02X%02X" % (int(r * factor), int(g * factor), int(b * factor))


def status_badge(text: str, color: str):
    """شارة حالة صغيرة بلون الحالة."""
    from PySide6.QtWidgets import QLabel
    lbl = QLabel(text)
    lbl.setAlignment(Qt.AlignCenter)
    lbl.setStyleSheet(
        f"background: {_rgba(color, 0.13)}; color: {_darken(color)};"
        f" border: 1.5px solid {_rgba(color, 0.35)};"
        "border-radius: 10px; padding: 4px 14px;"
        "font-weight: 700; font-size: 10.2px;")
    return lbl


class EntityHeader(QWidget):
    """رأس موحّد: أيقونة + عنوان + سطر فرعي + شارة حالة + أزرار سياق.

    كود السجل يظهر في tooltip العنوان فقط.
    """

    def __init__(self, parent=None, icon: str = ""):
        from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel,
                                       QVBoxLayout)
        super().__init__(parent)
        from ui import style
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        self.card = QFrame()
        self.card.setProperty("card", True)
        style.soft_shadow(self.card, radius=24, y=5)
        row = QHBoxLayout(self.card)
        row.setContentsMargins(12, 8, 12, 8)
        row.setSpacing(8)

        self._icon_lbl = QLabel(icon)
        self._icon_lbl.setStyleSheet("font-size: 18px; background: transparent;")
        if icon:
            row.addWidget(self._icon_lbl)

        col = QVBoxLayout()
        col.setSpacing(2)
        self.title_lbl = QLabel("")
        self.title_lbl.setStyleSheet(
            "font-size: 15.3px; font-weight: 800; background: transparent;")
        self.sub_lbl = QLabel("")
        self.sub_lbl.setProperty("hint", True)
        self.sub_lbl.setWordWrap(True)
        col.addWidget(self.title_lbl)
        col.addWidget(self.sub_lbl)
        row.addLayout(col, 1)

        self._badge_holder = QHBoxLayout()
        self._badge_holder.setSpacing(6)
        row.addLayout(self._badge_holder)

        self._btn_host, self._btn_layout = flow_host(spacing=6)
        row.addWidget(self._btn_host)
        outer.addWidget(self.card)

    # ---------- تعبئة ----------
    def set_title(self, text: str, tooltip: str = ""):
        self.title_lbl.setText(text)
        self.title_lbl.setToolTip(tooltip)

    def set_subtitle(self, text: str):
        self.sub_lbl.setText(text)
        self.sub_lbl.setVisible(bool(text))

    def clear_badges(self):
        # لا setParent(None) — كان يفتح نوافذ شبحية صغيرة تومض.
        while self._badge_holder.count():
            item = self._badge_holder.takeAt(0)
            old_w = item.widget() if item is not None else None
            if old_w is not None:
                dispose_widget(old_w, host=self)

    def set_badge(self, text: str, color: str):
        self.clear_badges()
        self.add_badge(text, color)

    def add_badge(self, text: str, color: str):
        self._badge_holder.addWidget(status_badge(text, color))

    def add_button(self, text: str, slot=None, prop: str = "flat",
                   tooltip: str = "", level: str = ""):
        from PySide6.QtWidgets import QPushButton
        btn = QPushButton(text)
        apply_button_level(btn, level)
        if prop and not level:
            btn.setProperty(prop, True)
        btn.setProperty("compact", True)
        btn.setCursor(Qt.PointingHandCursor)
        if tooltip:
            btn.setToolTip(tooltip)
        if slot is not None:
            btn.clicked.connect(slot)
        # لا يُضغط الزر تحت مقاسه الطبيعي داخل الرأس (قاعدة 33)
        size_buttons([btn], uniform=False)
        self._btn_layout.addWidget(btn)
        return btn


class ActionBar(QWidget):
    """شريط إجراءات سفلي موحّد · يلتف تلقائيًا على الشاشات الصغيرة.

        bar = ActionBar()
        bar.add("سند قبض", self._receipt, prop="success")
        bar.add_close(self.accept)
    """

    def __init__(self, parent=None):
        from PySide6.QtWidgets import QVBoxLayout
        super().__init__(parent)
        self.setObjectName("transparentHost")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        self._host, self._layout = flow_host(spacing=6)
        outer.addWidget(self._host)
        self._buttons: dict[str, object] = {}

    def add(self, text: str, slot=None, prop: str = "", tooltip: str = "",
            key: str = "", level: str = ""):
        from PySide6.QtWidgets import QPushButton
        btn = QPushButton(text)
        apply_button_level(btn, level)
        if prop and not level:
            btn.setProperty(prop, True)
        btn.setProperty("compact", True)
        btn.setCursor(Qt.PointingHandCursor)
        if tooltip:
            btn.setToolTip(tooltip)
        if slot is not None:
            btn.clicked.connect(slot)
        self._layout.addWidget(btn)
        self._buttons[key or text] = btn
        return btn

    def add_close(self, slot):
        return self.add("إغلاق", slot, key="close", level="ghost")

    def button(self, key: str):
        return self._buttons.get(key)


# محاذاة الأرقام المالية: تُضبط مرة واحدة هنا وتُستعمل في كل الجداول.
# القياس البكسلي أثبت أن AlignRight في RTL يضع الرقم على الحافة اليسرى
# للخلية، وهي الجهة التي تتحاذى عندها خانات الآحاد رأسيًا.
MONEY_ALIGN = Qt.AlignRight | Qt.AlignVCenter


def money_item(text: str, color: str = "", tooltip: str = ""):
    """خلية رقم مالي بمحاذاة موحّدة (ولون دلالي اختياري)."""
    from PySide6.QtGui import QColor
    from PySide6.QtWidgets import QTableWidgetItem
    item = QTableWidgetItem(text)
    item.setTextAlignment(MONEY_ALIGN)
    if color:
        item.setForeground(QColor(color))
    if tooltip:
        item.setToolTip(tooltip)
    return item


def stat_card(icon: str, label: str, accent: str = ""):
    """بطاقة مؤشر: أيقونة + قيمة كبيرة + وصف + شريط جانبي دلالي 4px.

    accent: لون الشريط · أزرق = معلومات (افتراضي) · أخضر = محصّل/ربحية ·
    كهرماني = متبقي/مستحقات. المقاسات لم تتغير.
    ترجع (البطاقة، عنصر القيمة).
    """
    from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout
    from ui import style
    theme = style.theme()
    color = accent or theme["BRAND_600"]
    card = QFrame()
    card.setProperty("card", True)
    row = QHBoxLayout(card)
    row.setContentsMargins(14, 12, 14, 12)
    row.setSpacing(10)
    # الشريط الدلالي · في RTL يُرسم right على الحافة اليمنى فعليًا
    # (تم إثباته بالقياس في المرحلة 3)
    bar = QFrame()
    bar.setFixedWidth(4)
    bar.setStyleSheet(
        f"background: {color}; border: none; border-radius: 2px;")
    icon_lbl = QLabel(icon)
    icon_lbl.setStyleSheet("font-size: 17px; background: transparent;")
    col = QVBoxLayout()
    col.setSpacing(2)
    value = QLabel("-")
    value.setStyleSheet(
        "font-size: 13.6px; font-weight: 800; background: transparent;")
    name = QLabel(label)
    name.setProperty("hint", True)
    col.addWidget(value)
    col.addWidget(name)
    row.addWidget(bar)
    row.addWidget(icon_lbl)
    row.addLayout(col, 1)
    return card, value


class PageNav(QWidget):
    """شريط تنقّل بين صفحات مجمَّعة · لون واحد للنشط فقط.

        nav = PageNav([("نظرة عامة", "", [("overview", "عام")]), ...])
        nav.page_changed.connect(handler)

    معامل اللون في كل مجموعة صار متجاهَلًا (يبقى في التوقيع للتوافق):
    كل التبويبات محايدة، والتبويب النشط وحده يأخذ لون العلامة.
    الأزرار تُلف تلقائيًا على الشاشات الصغيرة (FlowLayout).
    """
    page_changed = Signal(str)

    def __init__(self, groups: list, parent=None):
        from PySide6.QtWidgets import (QButtonGroup, QFrame, QHBoxLayout,
                                       QLabel, QPushButton, QVBoxLayout)
        from ui import style
        super().__init__(parent)
        theme = style.theme()
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        bar = QFrame()
        bar.setProperty("card", True)
        host_layout = QHBoxLayout(bar)
        host_layout.setContentsMargins(7, 4, 7, 5)
        host_layout.setSpacing(6)
        flow_widget, flow = flow_host(spacing=8)
        host_layout.addWidget(flow_widget, 1)

        self._group = QButtonGroup(self)
        self._group.setExclusive(True)
        self.buttons: dict = {}
        for title, _color, pages in groups:
            box = QFrame()
            box.setStyleSheet(
                f"QFrame {{ background: {theme['SURFACE_2']};"
                f" border: 1px solid {theme['BORDER']};"
                " border-radius: 10px; }")
            box_layout = QVBoxLayout(box)
            box_layout.setContentsMargins(3, 2, 3, 3)
            box_layout.setSpacing(1)
            lbl = QLabel(title)
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet(
                f"color: {theme['TEXT_400']}; font-size: 9.3px;"
                " font-weight: 800; background: transparent; border: none;")
            box_layout.addWidget(lbl)
            row = QHBoxLayout()
            row.setSpacing(4)
            for key, text in pages:
                btn = QPushButton(text)
                btn.setObjectName("pageTab")
                btn.setCheckable(True)
                btn.setCursor(Qt.PointingHandCursor)
                btn.clicked.connect(
                    lambda _=False, k=key: self.page_changed.emit(k))
                self._group.addButton(btn)
                self.buttons[key] = btn
                row.addWidget(btn)
            box_layout.addLayout(row)
            flow.addWidget(box)
        outer.addWidget(bar)

    def select(self, key: str):
        """اختيار صفحة برمجيًا · يبدّلها فعلًا لا يعلّم زرها فقط.

        كانت تكتفي بـsetChecked فلا تُطلق page_changed، فالتنقّل
        البرمجي (وفتح صفحة من تنبيه أو اختصار) لا يبدّل الصفحة.
        """
        btn = self.buttons.get(key)
        if not btn:
            return False
        already = btn.isChecked()
        btn.setChecked(True)
        if not already:
            self.page_changed.emit(key)
        return True


# ============================================================
# شرائح الفلترة + حالة الفراغ (الخطة الموحّدة · المرحلة ب)
# ============================================================
class FilterChips(QWidget):
    """شرائح فلترة ظاهرة دائمًا بدل قائمة منسدلة مخفية.

        chips = FilterChips([("all", "الكل"), ("active", "لهم عقود نشطة")])
        chips.changed.connect(handler)   # يرسل مفتاح الشريحة
        chips.current()                  # المفتاح المختار
    """
    changed = Signal(str)

    def __init__(self, items: list, parent=None):
        from PySide6.QtWidgets import QButtonGroup, QPushButton
        super().__init__(parent)
        self.setObjectName("transparentHost")
        host, layout = flow_host(spacing=6)
        from PySide6.QtWidgets import QVBoxLayout
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(host)
        self._group = QButtonGroup(self)
        self._group.setExclusive(True)
        self.buttons: dict = {}
        for i, (key, label) in enumerate(items):
            btn = QPushButton(label)
            btn.setObjectName("filterChip")
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.setChecked(i == 0)
            btn.clicked.connect(lambda _=False, k=key: self.changed.emit(k))
            self._group.addButton(btn)
            self.buttons[key] = btn
            layout.addWidget(btn)
        self._first = items[0][0] if items else ""

    def current(self) -> str:
        for key, btn in self.buttons.items():
            if btn.isChecked():
                return key
        return self._first

    def select(self, key: str):
        btn = self.buttons.get(key)
        if btn:
            btn.setChecked(True)

    def set_count(self, key: str, count: int | None):
        """رقم اختياري بجانب اسم الشريحة."""
        btn = self.buttons.get(key)
        if btn is None:
            return
        base = btn.text().split("  (")[0]
        btn.setText(base if count is None else f"{base}  ({count})")


def empty_state(text: str, button_text: str = "", slot=None,
                icon: str = "🗂", primary: bool = True):
    """حالة فراغ موحّدة: أيقونة + نص + زر إجراء اختياري.

    primary=False عندما يعرض الشريط العلوي الإجراء الأساسي نفسه —
    زر رئيسي ظاهر واحد لكل صفحة (§5).
    """
    from PySide6.QtWidgets import (QLabel, QPushButton, QVBoxLayout, QWidget)
    from ui import style
    theme = style.theme()
    host = QWidget()
    host.setObjectName("transparentHost")
    layout = QVBoxLayout(host)
    layout.setContentsMargins(20, 26, 20, 26)
    layout.setSpacing(8)
    layout.setAlignment(Qt.AlignCenter)
    icon_lbl = QLabel(icon)
    icon_lbl.setAlignment(Qt.AlignCenter)
    icon_lbl.setStyleSheet("font-size: 26px; background: transparent;")
    msg = QLabel(text)
    msg.setAlignment(Qt.AlignCenter)
    msg.setWordWrap(True)
    msg.setStyleSheet(
        f"color: {theme['TEXT_600']}; font-size: 12.5px;"
        " background: transparent;")
    layout.addWidget(icon_lbl)
    layout.addWidget(msg)
    if button_text:
        btn = QPushButton(button_text)
        if primary:
            btn.setObjectName("btnPrimary")
        else:
            btn.setProperty("flat", True)
        btn.setCursor(Qt.PointingHandCursor)
        if slot is not None:
            btn.clicked.connect(slot)
        row = QWidget()
        row.setObjectName("transparentHost")
        from PySide6.QtWidgets import QHBoxLayout
        row_l = QHBoxLayout(row)
        row_l.setContentsMargins(0, 0, 0, 0)
        row_l.addStretch()
        row_l.addWidget(btn)
        row_l.addStretch()
        layout.addWidget(row)
    return host


# ============================================================
# قائمة إجراءات الصف (القاعدة 19 + 41)
# ============================================================
def row_menu(view, entries, pos=None):
    """إظهار قائمة إجراءات الصف عند الزر الأيمن.

    entries: قائمة من (نص, دالة) — أو None لفاصل — و«حذف» يُمرَّر
    عبر danger=True فيُفصل بخط ويُلوَّن بالأحمر.

        row_menu(self.tree, [("تعديل", self._edit),
                             ("سند صرف للمقاول", self._pay_selected),
                             None,
                             ("حذف عقد الباطن", self._delete, True)])

    الإجراءات المدمِّرة لا تأخذ زرًا دائمًا في الشريط السفلي — مكانها هنا
    فقط، حتى لا يقف «حذف» أحمرَ بجوار إجراء مالي روتيني.
    """
    from PySide6.QtGui import QCursor
    from PySide6.QtWidgets import QMenu
    from ui import style
    menu = QMenu(view)
    for item in entries:
        if item is None:
            menu.addSeparator()
            continue
        text, slot = item[0], item[1]
        danger = len(item) > 2 and item[2]
        act = menu.addAction(text)
        if danger:
            act.setIcon(_dot_icon(style.DANGER))
        act.triggered.connect(_safe_action(view, text, slot))
    menu.exec(view.mapToGlobal(pos) if pos is not None else QCursor.pos())
    return menu


def _safe_action(view, label: str, slot):
    """يغلّف إجراء القائمة فلا يصل أي استثناء غير متوقع للمستخدم.

    القاعدة 9: ممنوع ظهور traceback. أي عطل برمجي داخل إجراء صف
    (مفتاح ناقص · بيانات قديمة) يُعرض كرسالة عربية واضحة ويُسجَّل في
    data/error.log بدل أن يسقط البرنامج.
    """
    def _run(*_args):
        try:
            return slot()
        except Exception as exc:      # noqa: BLE001 — شبكة أمان مقصودة
            _log_action_error(label, exc)
            try:
                style.error(
                    view.window() if hasattr(view, "window") else None,
                    f"تعذّر تنفيذ «{label}».\n"
                    "أُغلقت العملية بأمان ولم تتأثر أي بيانات.\n"
                    "التفاصيل في data/error.log إن احتجتها.")
            except Exception:
                pass
    return _run


def _log_action_error(label: str, exc: Exception) -> None:
    import os
    import traceback
    from datetime import datetime
    try:
        from services.db_facade_service import BASE_DIR
        path = os.path.join(BASE_DIR, "data", "error.log")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"\n===== {datetime.now():%Y-%m-%d %H:%M:%S} · "
                    f"إجراء: {label} =====\n")
            f.write("".join(traceback.format_exception(
                type(exc), exc, exc.__traceback__)))
    except Exception:
        pass


def _dot_icon(color: str):
    """نقطة لون صغيرة تميّز الإجراء المدمِّر داخل القائمة."""
    from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
    pm = QPixmap(12, 12)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor(color))
    p.setPen(Qt.NoPen)
    p.drawEllipse(2, 2, 8, 8)
    p.end()
    return QIcon(pm)


def attach_row_menu(view, builder):
    """ربط قائمة الزر الأيمن بجدول/شجرة مرة واحدة.

    builder() ترجع قائمة entries بصيغة row_menu (وتُستدعى عند كل نقرة
    حتى تعكس الصف المحدد وقتها).
    """
    view.setContextMenuPolicy(Qt.CustomContextMenu)

    def _show(pos):
        try:
            entries = builder()
        except Exception:
            return
        if entries:
            row_menu(view, entries, pos)

    view.customContextMenuRequested.connect(_show)
    return view


# ============================================================
# تمرير جسم الصفحة مع تثبيت شريط الأزرار (القاعدة 45)
# ============================================================
def scroll_body(widget):
    """يلفّ ودجة داخل منطقة تمرير شفافة (بلا إطار).

    يُستعمل لجسم الصفحة فقط — شريط الإجراءات يُضاف **بعده** في تخطيط
    الصفحة فيبقى مثبتًا أسفل الشاشة مهما طال المحتوى.
    """
    from PySide6.QtWidgets import QFrame, QScrollArea
    area = QScrollArea()
    area.setWidgetResizable(True)
    area.setFrameShape(QFrame.NoFrame)
    area.setObjectName("transparentHost")
    area.viewport().setObjectName("transparentHost")
    area.setWidget(widget)
    return area


def split_scroll_footer(page, footer_count: int = 1):
    """يعيد بناء صفحة جاهزة: كل شيء يمرَّر عدا آخر `footer_count` عنصرًا.

    يُستدعى في نهاية بناء الصفحة، فيأخذ تخطيطها الحالي ويقسمه:
    الجسم داخل QScrollArea، والعناصر الأخيرة (شريط الأزرار) مثبتة أسفل.
    """
    from PySide6.QtWidgets import QVBoxLayout, QWidget
    old = page.layout()
    if old is None or old.count() <= footer_count:
        return page
    items = [old.takeAt(0) for _ in range(old.count())]
    body = QWidget()
    body.setObjectName("transparentHost")
    body_layout = QVBoxLayout(body)
    body_layout.setContentsMargins(0, 0, 0, 0)
    body_layout.setSpacing(old.spacing())
    margins = old.contentsMargins()
    footer_items = items[-footer_count:]
    for it in items[:-footer_count]:
        if it.widget() is not None:
            body_layout.addWidget(it.widget())
        elif it.layout() is not None:
            body_layout.addLayout(it.layout())
        else:
            body_layout.addItem(it)
    _orphan = QWidget()
    _orphan.setLayout(old)
    _orphan.deleteLater()
    new_layout = QVBoxLayout(page)
    new_layout.setContentsMargins(margins)
    new_layout.setSpacing(10)
    new_layout.addWidget(scroll_body(body), 1)
    for it in footer_items:
        if it.widget() is not None:
            new_layout.addWidget(it.widget())
        elif it.layout() is not None:
            new_layout.addLayout(it.layout())
    return page


def make_page_scrollable(page, keep_footer: int = 0):
    """يجعل جسم الصفحة قابلًا للتمرير مع إبقاء آخر `keep_footer` عنصرًا مثبتًا.

    **يحافظ على التخطيط الأصلي كما هو** (أفقي أو شبكي أو عمودي) بنقل
    كائن التخطيط نفسه إلى ودجة الجسم — إعادة بناء العناصر في تخطيط
    عمودي جديد كانت تقلب الصفحات ذات الأعمدة الجانبية رأسًا على عقب.
    """
    from PySide6.QtWidgets import QVBoxLayout, QWidget
    old = page.layout()
    if old is None or old.count() == 0:
        return page
    if keep_footer >= old.count():
        keep_footer = 0
    footer_items = []
    for _ in range(keep_footer):
        footer_items.insert(0, old.takeAt(old.count() - 1))
    margins = old.contentsMargins()
    spacing = old.spacing()
    old.setContentsMargins(0, 0, 0, 0)
    body = QWidget()
    body.setObjectName("transparentHost")
    body.setLayout(old)            # نقل التخطيط الأصلي بلا إعادة ترتيب
    outer = QVBoxLayout(page)
    outer.setContentsMargins(margins)
    outer.setSpacing(spacing if spacing > 0 else 10)
    outer.addWidget(scroll_body(body), 1)
    for it in footer_items:
        if it.widget() is not None:
            outer.addWidget(it.widget())
        elif it.layout() is not None:
            outer.addLayout(it.layout())
    return page


def shrinkable(*widgets, min_chars: int = 8):
    """يجعل الحقول قابلة للتقلّص فلا تفرض عرضًا أدنى على النافذة.

    القائمة المنسدلة تحسب حدّها الأدنى من **أطول نص فيها**، فاسم عميل
    طويل واحد يوسّع النافذة كلها ويخلق تمريرًا أفقيًا (القاعدة 48).
    النص الكامل يبقى في التلميح وفي القائمة عند فتحها.
    """
    from PySide6.QtWidgets import QComboBox
    for w in widgets:
        if w is None:
            continue
        try:
            w.setMinimumWidth(0)
            if isinstance(w, QComboBox):
                w.setSizeAdjustPolicy(
                    QComboBox.AdjustToMinimumContentsLengthWithIcon)
                w.setMinimumContentsLength(min_chars)
                view = w.view()
                if view is not None:
                    view.setMinimumWidth(240)
        except Exception:
            pass
    return widgets


# ==================== البحث عن المضيف في شجرة الآباء ====================
# ملف العميل ومركز العقد يفتح كلٌّ منهما الآخر. لو فتح كلُّ نداء نافذة
# جديدة تتكدّس النوافذ بلا نهاية (قِيس فعلًا: 6 نوافذ في 6 نقرات).
# الحل: قبل فتح أي نافذة نبحث في شجرة الآباء عن مضيف يستطيع **استبدال**
# المحتوى بدل تكديس نافذة فوق نافذة (القاعدة 54).

def dispose_widget(widget, host=None):
    """تخلّص آمن من ودجة قديمة في تخطيط · بلا أشباح ولا نوافذ منبثقة.

    المشكلة التي كانت تحصل في الرئيسية: عند مسح صفوف التنبيهات القديمة
    استُدعي ``old_w.setParent(None)``، فصارت الودجة نافذة سطح مكتب
    مستقلة (top-level) بحجم صغير (359×48) قبل أن يلتقطها ``deleteLater``
    في دورة الأحداث التالية — وكانت تومض كنافذة منبثقة صغيرة كل تنقّل
    بين الصفحات على ويندوز.

    الحل:
      1) نُخفي الودجة فورًا (فلا ترسم ولا تومض كنافذة).
      2) **نتركها تحت أبيها الأصلي** — هذا هو المفتاح. ``takeAt`` يزيلها
         من التخطيط فقط، فتبقى مودجة تحت أبيها (ليست top-level) فلا
         تنشأ نافذة شبحية.
      3) نطلِق ``deleteLater()`` ونجبر حدث DeferredDelete على المعالجة
         فورًا (في الـevent loop التالي المتاح) حتى لا تتراكم ودجات قديمة
         يعدّها ``findChildren``.
    """
    if widget is None:
        return
    try:
        widget.hide()
    except Exception:
        pass
    try:
        widget.deleteLater()
    except Exception:
        pass


def flush_disposed():
    """معالجة فورية لأحداث DeferredDelete المعلّقة (الأشباح المحذوفة).

    يُستدعى عادةً بعد مسح قائمة كاملة في حلقة حتى تُحذف الودجات القديمة
    فعلًا قبل أن يفحصها ``findChildren`` في نفس العملية.
    """
    try:
        from PySide6.QtCore import QCoreApplication
        QCoreApplication.sendPostedEvents(None, 52)  # QEvent::DeferredDelete
    except Exception:
        pass


def find_host(widget, attr: str):
    """أقرب سلف (أو نافذة أب) يملك السمة `attr` · وإلا None."""
    seen = set()
    node = widget
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if node is not widget and hasattr(node, attr):
            return node
        parent = node.parent()
        if parent is None and hasattr(node, "parentWidget"):
            parent = node.parentWidget()
        node = parent
    # احتياط: نافذة عليا ظاهرة تملك السمة (سياق الأدوات والاختبارات)
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance()
    if app is not None:
        for top in app.topLevelWidgets():
            if top is not widget and hasattr(top, attr) and top.isVisible():
                return top
    return None


def ancestor_of_type(widget, cls):
    """أقرب سلف من نوع `cls` · وإلا None."""
    seen = set()
    node = widget.parent() if widget is not None else None
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if isinstance(node, cls):
            return node
        parent = node.parent()
        if parent is None and hasattr(node, "parentWidget"):
            parent = node.parentWidget()
        node = parent
    return None


def connect_debounced_text(line_edit, callback, delay_ms: int = 420,
                           min_chars: int = 0):
    """ربط مربع بحث بتأخير تلقائي بدل الاستعلام مع كل حرف.

    يرجع QTimer المرتبط بالودجت حتى لا يجمعه garbage collector.
    """
    from PySide6.QtCore import QTimer
    timer = QTimer(line_edit)
    timer.setSingleShot(True)
    timer.setInterval(max(120, int(delay_ms or 420)))

    def _fire():
        text = line_edit.text().strip()
        if min_chars and 0 < len(text) < min_chars:
            return
        callback()

    timer.timeout.connect(_fire)
    line_edit.textChanged.connect(lambda *_: timer.start())
    return timer
