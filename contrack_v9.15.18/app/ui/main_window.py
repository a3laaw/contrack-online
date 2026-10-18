# -*- coding: utf-8 -*-
"""النافذة الرئيسية · Premium Liquid Glass ERP.

Sidebar زجاجي طافٍ على اليمين + خلفية Ambient متدرجة + صفحات شفافة فوقها.
"""
import os

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtGui import QPainter, QColor, QPixmap
from PySide6.QtWidgets import (
    QButtonGroup, QFrame, QGridLayout, QHBoxLayout, QLabel, QMainWindow,
    QPushButton, QStackedWidget, QVBoxLayout, QWidget,
)

from services import contract_service, settings_service
from services import lifecycle_service as lc
from ui import style
from ui.style import GlassBackground, soft_shadow
from ui.statement import StatementPage
from ui.settings import SettingsPage
from ui.subcontractors import SubcontractorsPage
from ui.vouchers import VouchersPage
from ui.dealings import DealingsPage
# ContractHubPage يُستخدم الآن مضمّنًا داخل ملف العميل وليس كصفحة تنقل مستقلة
from ui.word_forms_center import FormsCenterPage  # مركز النماذج Word First
from ui.comments_center import CommentsCenterPage


def _age_days(value) -> int:
    """عمر الحدث بالأيام من نص تاريخ (يتحمّل الصيغ الناقصة أو الفارغة)."""
    if not value:
        return 0
    from datetime import date, datetime
    text = str(value).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(text[:len(fmt) + 2].strip(), fmt).date()
            return max(0, (date.today() - dt).days)
        except ValueError:
            continue
    return 0


# ============================================================
# كلاس مخصص لرسم خلفية الهوفر يدوياً (يتجاوز مشاكل CSS السوداء)
# ============================================================
class HoverRow(QFrame):
    """صف يرسم خلفيته يدوياً عند مرور الماوس لضمان عدم ظهور اللون الأسود."""
    
    def __init__(self, hover_color: str = "", parent=None):
        # اللون الافتراضي من الثيم (قاعدة 26: لا hex خارج style.py)
        if not hover_color:
            hover_color = style.theme()["BRAND_50"]
        super().__init__(parent)
        self.setFrameShape(QFrame.NoFrame)
        self._hover_color = QColor(hover_color)
        self._is_hovered = False
        self.setAttribute(Qt.WA_Hover, True)
        # المؤشر «يد» لا يوضع هنا: صفوف التنبيه غير قابلة للنقر — يضعه
        # باني صف النشاط فقط على الصفوف القابلة للنقر فعلًا
    
    def enterEvent(self, event):
        self._is_hovered = True
        self.update()
        super().enterEvent(event)
    
    def leaveEvent(self, event):
        self._is_hovered = False
        self.update()
        super().leaveEvent(event)
    
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        if self._is_hovered:
            painter.setBrush(self._hover_color)
        else:
            painter.setBrush(Qt.transparent)
        
        painter.setPen(Qt.NoPen)
        painter.drawRoundedRect(self.rect().adjusted(0, 0, -1, -1), 10, 10)
        painter.end()


# ============================================================
class DashboardPage(QWidget):
    """الشاشة الرئيسية · بدون بيانات مالية: عدادات + تنبيهات فقط."""

    user_action = Signal(str)
    activity_chosen = Signal(int, int)
    ALERTS_PER_PAGE = 8
    ALERT_MAX_AGE_DAYS = 30
    quick_action = Signal(str)
    convert_alert = Signal(str)
    folder_opened = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        outer = QHBoxLayout(self)
        outer.setContentsMargins(16, 10, 16, 10)
        outer.setSpacing(10)

        content = QWidget()
        content.setObjectName("transparentHost")
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(18)

        from ui.tasks import TasksPage
        self.tasks_panel = TasksPage(compact=True)
        tasks_card = QFrame()
        tasks_card.setProperty("card", True)
        soft_shadow(tasks_card, radius=26, y=6)
        tasks_lay = QVBoxLayout(tasks_card)
        tasks_lay.setContentsMargins(14, 10, 14, 10)
        tasks_lay.addWidget(self.tasks_panel)

        tasks_card.setMinimumWidth(320)
        tasks_card.setMaximumWidth(480)
        self._tasks_card = tasks_card
        from PySide6.QtWidgets import QSizePolicy as _QSPt
        tasks_card.setSizePolicy(_QSPt.Preferred, _QSPt.Preferred)
        from ui.widgets import scroll_body
        outer.addWidget(scroll_body(content), 1)
        outer.addWidget(tasks_card)
        # V4.5.13: مفتاح «المهام والتنبيهات» يخفي لوحة المهام كاملة.
        # الإخفاء بعد الإضافة للأب — قبلها تُفتح نافذة عائمة تومض (قاعدة 53)
        from services import feature_service as _feat13tsk
        if not _feat13tsk.enabled("tasks"):
            tasks_card.setVisible(False)

        top_bar = QHBoxLayout()
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title = QLabel("الرئيسية")
        title.setProperty("pageTitle", True)
        title_col.addWidget(title)
        top_bar.addLayout(title_col)
        top_bar.addStretch()
        layout.addLayout(top_bar)

        from ui.widgets import flow_host as _flow_host
        grid_host, grid = _flow_host(spacing=16)
        self._cards: dict[str, QLabel] = {}
        from services import feature_service as _feat13m
        specs = [
            ("customers", "عدد العملاء", "👥"),
            ("contracts", "عدد العقود", "📑"),
            ("vouchers", "عدد السندات", "💵"),
        ]
        # V4.5.13: بطاقة «عدد المشاريع» تتبع مفتاح المزايا فعليًا
        if _feat13m.enabled("projects"):
            specs.insert(2, ("projects", "عدد المشاريع", "🏗"))
        for i, (key, label, icon) in enumerate(specs):
            card = QFrame()
            card.setProperty("card", True)
            card.setProperty("metricCard", True)
            soft_shadow(card, radius=30, y=8)
            card_layout = QHBoxLayout(card)
            card_layout.setContentsMargins(20, 18, 20, 18)
            card_layout.setSpacing(14)
            icon_lbl = QLabel(icon)
            icon_lbl.setProperty("statIcon", True)
            text_col = QVBoxLayout()
            text_col.setSpacing(4)
            value_lbl = QLabel("0")
            value_lbl.setProperty("statValue", True)
            name_lbl = QLabel(label)
            name_lbl.setProperty("statLabel", True)
            text_col.addWidget(name_lbl)
            text_col.addWidget(value_lbl)
            card_layout.addWidget(icon_lbl)
            card_layout.addLayout(text_col, 1)
            self._cards[key] = value_lbl
            card.setMinimumWidth(138)
            grid.addWidget(card)
        layout.addWidget(grid_host)

        self.feed_card = QFrame()
        self.feed_card.setProperty("card", True)
        soft_shadow(self.feed_card, radius=26, y=6)
        feed_layout = QVBoxLayout(self.feed_card)
        feed_layout.setContentsMargins(18, 14, 18, 14)
        feed_layout.setSpacing(8)

        feed_head = QHBoxLayout()
        feed_title = QLabel("🔔 التنبيهات والنشاطات")
        feed_title.setProperty("sectionTitle", True)
        feed_head.addWidget(feed_title)
        feed_head.addStretch()
        self.alerts_note = QLabel("")
        self.alerts_note.setProperty("hint", True)
        self.alerts_note.setWordWrap(True)
        self.alerts_note.setVisible(False)
        feed_head.addWidget(self.alerts_note)
        feed_layout.addLayout(feed_head)

        self.feed_holder = QVBoxLayout()
        self.feed_holder.setSpacing(6)
        feed_layout.addLayout(self.feed_holder)
        feed_layout.addStretch()

        foot = QHBoxLayout()
        self.activity_more = QPushButton("توسيع النشاط")
        self.activity_more.setObjectName("btnGhost")
        self.activity_more.setCursor(Qt.PointingHandCursor)
        self.activity_more.clicked.connect(self._show_more_activity)
        foot.addWidget(self.activity_more)
        foot.addStretch()
        from ui.widgets import PaginationBar
        self.alerts_pager = PaginationBar(page_size=self.ALERTS_PER_PAGE)
        self.alerts_pager.page_changed.connect(self._render_feed)
        foot.addWidget(self.alerts_pager)
        feed_layout.addLayout(foot)

        layout.addWidget(self.feed_card, 1)

        qa_card = QFrame()
        qa_card.setProperty("card", True)
        soft_shadow(qa_card, radius=26, y=6)
        from ui.widgets import FlowLayout
        from PySide6.QtWidgets import QSizePolicy as _QSP
        qa_layout = FlowLayout(qa_card, margin=0, spacing=10)
        qa_layout.setContentsMargins(18, 12, 18, 12)
        _qa_policy = _QSP(_QSP.Preferred, _QSP.Minimum)
        _qa_policy.setHeightForWidth(True)
        qa_card.setSizePolicy(_qa_policy)
        qa_title = QLabel("⚡ إجراءات سريعة:")
        qa_title.setStyleSheet(f"color: {style.TEXT_STRONG}; font-weight: 800;")
        qa_title.setProperty("sectionTitle", True)
        qa_layout.addWidget(qa_title)
        self._quick_buttons = []
        from services import auth_service as _auth_quick
        quick_specs = [
            ("＋ تسجيل عميل", "new_customer"),
            ("＋ عقد جديد", "new_contract"),
            ("＋ سند قبض", "new_receipt"),
            ("＋ سند صرف", "new_payment"),
        ]
        if _auth_quick.has_permission("action_add_subcontractor"):
            quick_specs.append(("＋ مقاول باطن", "new_subcontractor"))
        for text, action in quick_specs:
            btn = QPushButton(text)
            from ui.widgets import apply_button_level, level_for
            if level_for(text):
                apply_button_level(btn)
            else:
                btn.setProperty("flat", True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _, a=action: self.quick_action.emit(a))
            qa_layout.addWidget(btn)
            self._quick_buttons.append(btn)
        from ui.widgets import size_buttons
        size_buttons(self._quick_buttons)
        layout.addWidget(qa_card)

        self.alerts_card = self.feed_card
        self.activity_card = self.feed_card
        self.alerts_holder = self.feed_holder
        self.activity_holder = self.feed_holder

    def resizeEvent(self, event):
        super().resizeEvent(event)
        card = getattr(self, "_tasks_card", None)
        if card is not None:
            card.setMaximumWidth(max(230, min(380, int(self.width() * 0.34))))

    def refresh(self):
        from services import ui_data_service as ui_data
        stats = contract_service.dashboard_stats()
        counts = ui_data.dashboard_counts()
        vouchers = counts["vouchers"]
        self._cards["customers"].setText(str(stats["customers"]))
        self._cards["contracts"].setText(str(stats["contracts"]))
        if "projects" in self._cards:   # V4.5.13: البطاقة قد تكون مخفية بالمفتاح
            self._cards["projects"].setText(str(counts["projects"]))
        self._cards["vouchers"].setText(str(vouchers))
        # V2.48: حُذف العرض المبكر للسجل — كان يُبنى مرتين في كل تحديث
        # (استعلاما النشاط مكرران) ثم يُستبدل فورًا بعرض _render_alerts.

        from ui.widgets import dispose_widget as _dispose
        while self.alerts_holder.count():
            item = self.alerts_holder.takeAt(0)
            old_w = item.widget() if item is not None else None
            if old_w is not None:
                _dispose(old_w, host=self.feed_card)

        alerts = []
        for e in lc.expiring_contracts()[:25]:
            color = (style.AMBER_DEEP if e["remaining"] <= 7 else style.WARN if e["remaining"] <= 60 else style.INFO)
            alerts.append((color, f"⏰ العقد {e['contract_number']} · {e['customer_name']} ينتهي بعد {e['remaining']} يوم ({e['end_date']})"))
        
        for p in lc.overdue_plan_items()[:25]:
            if p["days_diff"] < 0:
                color, text = style.DANGER, f"📆 دفعة متأخرة: «{p['title']}» · {p['customer_name']} (العقد {p['contract_number']}) متبقٍ منه {p['remaining']:,.3f} · تأخر {-p['days_diff']} يوم"
            else:
                color, text = style.WARN, f"📆 دفعة تستحق خلال {p['days_diff']} يوم: «{p['title']}» · {p['customer_name']} ({p['remaining']:,.3f})"
            alerts.append((color, text, {"age": max(0, -p["days_diff"])}))
            
        try:
            from services import comment_service as _cmt
            from services import feature_service as _ftc
            if _ftc.enabled("comments"):
                for c in _cmt.stale_pinned()[:10]:
                    body = (c.get("body") or "").replace("\n", " ")
                    if len(body) > 70: body = body[:70] + "…"
                    alerts.append((style.WARN, f"📌 تعليق مثبّت على {c['customer_name']} منذ {c['age_days']} يومًا بلا متابعة: {body}", {"age": int(c.get("age_days") or 0), "customer_id": c["customer_id"]}))
        except Exception: pass

        try:
            from services.extras_service import due_cheques
            for ch in due_cheques(7)[:25]:
                kind = "قبض" if ch["vtype"] == "receipt" else "صرف"
                if ch["days_left"] < 0: text, color = f"🏦 شيك {kind} ({ch['voucher_number']}) من {ch['party']} بقيمة {ch['amount']:,.3f} · استحق منذ {-ch['days_left']} يوم ({ch['cheque_due_date']})", style.DANGER
                elif ch["days_left"] == 0: text, color = f"🏦 شيك {kind} ({ch['voucher_number']}) من {ch['party']} بقيمة {ch['amount']:,.3f} · يستحق اليوم!", style.DANGER
                else: text, color = f"🏦 شيك {kind} ({ch['voucher_number']}) من {ch['party']} بقيمة {ch['amount']:,.3f} · يستحق بعد {ch['days_left']} يوم ({ch['cheque_due_date']})", style.WARN
                alerts.append((color, text, {"age": max(0, -ch["days_left"])}))
        except Exception: pass

        try:
            from services.supervision_service import contracts_near_base_end
            from services.extras_service import contract_labels as _cls
            _near = contracts_near_base_end(30)[:25]
            _lbl = _cls([s["contract_id"] for s in _near])
            for s in _near:
                d_txt = "اليوم!" if s["days_left"] == 0 else f"بعد {s['days_left']} يوم" if s["days_left"] > 2 else f"بعد {s['days_left']} يومين"
                alerts.append((style.WARN, f"تنبيه إشراف: {s['customer_name']} · {_lbl.get(s['contract_id'], '')} تنتهي مدته الأساسية {d_txt} ({s['base_end']}) · بعدها يبدأ حساب أشهر التمديد ({s['monthly']:,.3f} للشهر)"))
        except Exception: pass

        try:
            from services.supervision_service import contracts_in_extension
            from services.extras_service import contract_labels as _cls2
            _ext = contracts_in_extension()[:25]
            _lbl2 = _cls2([s["contract_id"] for s in _ext])
            for s in _ext:
                m_txt = "شهر واحد" if s["billable_extension"] == 1 else "شهران" if s["billable_extension"] == 2 else f"{s['billable_extension']:g} شهر"
                alerts.append((style.PURPLE, f"تمديد إشراف: {s['customer_name']} · {_lbl2.get(s['contract_id'], '')} انتهت مدته الأساسية ({s['base_end']}) وعليه {m_txt} تمديد بقيمة {s['extension_value']:,.3f} · للمخالصة: سند قبض أو إلغاء مدة من المدير"))
        except Exception: pass

        try:
            from services import auth_service as _auth
            from services import settlement_service as _st
            # V3.27: تنبيهات التسوية تبع شاشة البوابة (محجوبة عن السكرتير)
            _gw_rows = (_st.late_settlements(10)
                        if _auth.has_permission("screen_gateway") else [])
            for r in _gw_rows:
                alerts.append((style.DANGER, f"🏦 تسوية بوابة متأخرة: {r['gateway']} · يوم {r['day']} (متوقع {r['expect']:,.3f} بتاريخ {r['settle_date']}) لم يصل البنك"))
        except Exception: pass

        # مراحل التنفيذ: تأخير العقود في مراحلها (أحمر) والقارب على
        # الانتهاء (كهرماني) — قابلة للتحويل إلى مهمة بزر «مهمة»
        try:
            from services import workflow_service as _wf
            from services import feature_service as _wff
            if _wff.enabled("followup"):
                for _key, _text, _extra in _wf.execution_alerts()[:25]:
                    _color = style.DANGER if _key == "danger" else style.WARN
                    alerts.append((_color, _text, _extra))
        except Exception:
            pass

        for o in lc.overdue_collections()[:25]:
            last = f"آخر تحصيل: {o['last_receipt']}" if o["last_receipt"] else "لم يُحصّل شيء بعد"
            alerts.append((style.WARN, f"💰 متابعة تحصيل: {o['customer_name']} · العقد {o['contract_number']} عليه {o['remaining']:,.3f} متبقية ({last} · منذ {o['days_since']} يوم)", {"age": int(o["days_since"] or 0)}))
            
        from services import ui_data_service as ui_data
        paused = ui_data.paused_contracts()
        for p in paused[:25]:
            alerts.append((style.WARN, f"⏸ العقد {p['contract_number']} · {p['name']} متوقف"))
            
        try:
            s = settings_service.get_settings()
            if s.auto_backup_enabled and s.auto_backup_folder.strip():
                if not os.path.isdir(s.auto_backup_folder.strip()):
                    alerts.insert(0, (style.DANGER, f"💾 مجلد النسخ الاحتياطي غير متاح: {s.auto_backup_folder.strip()} · وصّل القرص الخارجي أو غيّر المجلد من الإعدادات"))
        except Exception: pass

        try:
            from services import auth_service as _auth_fb
            if _auth_fb.is_admin():
                from services import full_backup_service as _fbs
                health = _fbs.backup_health()
                if not health["ok"]:
                    alerts.insert(0, (style.DANGER if health["level"] == "danger" else style.WARN, f"🗄 {health['text']}", {"no_convert": False}))
        except Exception: pass

        try:
            from services.folder_service import folders_with_updates
            for f in folders_with_updates()[:25]:
                newest = f" · أحدث ملف: {f['newest_file']}" if f["newest_file"] else ""
                alerts.append((style.INFO, f"🗀 تحديث جديد في مجلد العميل {f['customer_name']}{newest}\n📂 {f['path']}\n(اضغط هنا لفتح المجلد · وسيختفي التنبيه)", {"folder_customer_id": f["customer_id"], "folder_path": f["path"]}))
        except Exception: pass

        try:
            from services import task_service as _ts
            for t in [x for x in _ts.list_tasks(include_done=False) if x["overdue"]][:25]:
                alerts.append((style.DANGER, f"📌 مهمة متأخرة: «{t['title']}» · كان موعدها {t['due_at']}", {"no_convert": True, "age": _age_days(t.get("due_at"))}))
        except Exception: pass

        fresh, hidden = [], 0
        try:
            from services import workflow_service as _wfd
            _dismissed = _wfd.dismissed_alert_keys()
        except Exception:
            _wfd, _dismissed = None, set()
        for a in alerts:
            extra = a[2] if len(a) > 2 else {}
            if int(extra.get("age", 0) or 0) > self.ALERT_MAX_AGE_DAYS:
                hidden += 1
                continue
            if _dismissed and _wfd.alert_key(a[1]) in _dismissed:
                continue
            fresh.append(a)
        self._alerts = fresh
        self._alerts_hidden = hidden
        self._render_alerts()

    def user_menu_actions(self):
        return [("بيانات الموظف", "profile"), ("تغيير كلمة المرور", "password"), ("تسجيل الخروج", "logout")]

    ACTIVITY_ROWS = 8

    def _render_activity(self, limit=None):
        self._render_feed()

    def _show_more_activity(self):
        expanded = getattr(self, "_activity_expanded", False)
        self._activity_expanded = not expanded
        self.activity_more.setText("اختصار النشاط" if not expanded else "توسيع النشاط")
        self._render_activity(25 if not expanded else self.ACTIVITY_ROWS)

    def _open_activity(self, data: dict):
        self.activity_chosen.emit(data.get("contract_id") or 0, data.get("customer_id") or 0)

    @staticmethod
    def _tint(hex_color: str, alpha: float = 0.10) -> str:
        h = (hex_color or style.NEUTRAL).lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return f"rgba({r},{g},{b},{alpha})"

    def _feed_items(self):
        items = []
        for alert in getattr(self, "_alerts", []):
            extra = alert[2] if len(alert) > 2 else {}
            items.append({"src": "alert", "color": alert[0], "text": alert[1], "extra": extra})
        limit = 25 if getattr(self, "_activity_expanded", False) else self.ACTIVITY_ROWS
        try: acts = lc.recent_activity(limit)
        except Exception: acts = []
        theme = style.theme()
        for it in acts:
            color = style.MONEY_IN if it["sign"] > 0 else style.MONEY_OUT if it["sign"] < 0 else theme["BRAND_600"]
            items.append({"src": "activity", "color": color, "data": it})
        return items

    def _render_feed(self):
        from PySide6.QtWidgets import QHBoxLayout as _QH, QSizePolicy as _SP
        from ui.widgets import dispose_widget as _dispose
        
        while self.feed_holder.count():
            item = self.feed_holder.takeAt(0)
            old_w = item.widget() if item is not None else None
            if old_w is not None:
                _dispose(old_w, host=self.feed_card)

        hidden = getattr(self, "_alerts_hidden", 0)
        if hidden:
            self.alerts_note.setText(f"أُخفي {hidden} تنبيهًا أقدم من {self.ALERT_MAX_AGE_DAYS} يومًا — تفاصيلها في التقارير")
            self.alerts_note.setVisible(True)
        else:
            self.alerts_note.setVisible(False)

        items = self._feed_items()
        self._feed_all = items
        self.activity_more.setVisible(bool(items))
        if not items:
            ok = QLabel("✅ لا تنبيهات ولا نشاط بعد · كل شيء على ما يرام")
            ok.setWordWrap(True)
            ok.setStyleSheet(f"color: {style.GREEN_DEEP}; font-weight: 700; font-size: 11.9px; background: {self._tint(style.GREEN, 0.10)}; border-radius: 10px; padding: 10px 14px;")
            self.feed_holder.addWidget(ok)
            return

        theme = style.theme()
        for it in self.alerts_pager.slice(items):
            row = HoverRow(hover_color=theme['BRAND_50'])
            row.setSizePolicy(_SP.Preferred, _SP.Preferred)
            row.setMinimumWidth(0)
            
            row_l = _QH(row)
            row_l.setContentsMargins(4, 2, 4, 2)
            row_l.setSpacing(6)
            
            if it["src"] == "alert":
                self._build_alert_row(row_l, it)
            else:
                self._build_activity_row(row_l, it, theme)
                
            self.feed_holder.addWidget(row)

    def _build_alert_row(self, row_l, it):
        t = style.theme()
        color, text, extra = it["color"], it["text"], it["extra"]
        
        lbl = QLabel(text)
        lbl.setWordWrap(True)
        lbl.setMinimumWidth(0)
        lbl.setStyleSheet(f"color: {color}; font-weight: 700; background: {self._tint(color, 0.10)}; border: 1.5px solid {self._tint(color, 0.30)}; border-radius: 10px; padding: 8px 14px;")
            
        if extra.get("folder_customer_id"):
            lbl.setCursor(Qt.PointingHandCursor)
            lbl.setToolTip("")
            cid, pth = extra["folder_customer_id"], extra["folder_path"]
            lbl.mousePressEvent = lambda e, c=cid, p=pth: self._open_alert_folder(c, p)
        row_l.addWidget(lbl, 1)
        
        if extra.get("folder_customer_id"):
            open_btn = QPushButton("📂 فتح")
            open_btn.setCursor(Qt.PointingHandCursor)
            open_btn.setToolTip("")
            # النمط القياسي للزر الثانوي (لا ستايل inline — قاعدة 41)
            open_btn.setProperty("flat", True)
            open_btn.clicked.connect(lambda _, cid=extra["folder_customer_id"], p=extra["folder_path"]: self._open_alert_folder(cid, p))
            row_l.addWidget(open_btn)
            
        if not extra.get("no_convert"):
            from services import feature_service as _feat13tk
            task_btn = QPushButton("مهمة")
            task_btn.setCursor(Qt.PointingHandCursor)
            task_btn.setToolTip("")
            # النمط القياسي للزر الثانوي (لا ستايل inline — قاعدة 41)
            task_btn.setProperty("flat", True)
            task_btn.clicked.connect(lambda _, t=text: self.convert_alert.emit(t))
            row_l.addWidget(task_btn)
            if not _feat13tk.enabled("tasks"):   # V4.5.13: بعد الإضافة للأب
                task_btn.setVisible(False)

    def _build_activity_row(self, row_l, it, theme):
        from PySide6.QtWidgets import QSizePolicy as _SP
        data = it["data"]
        color = it["color"]
        
        row_widget = row_l.parentWidget()
        if row_widget is not None:
            # لا نستخدم QToolTip هنا لأن بعض نسخ ويندوز تعرضه بخلفية سوداء
            # فوق شاشة التنبيهات. المؤشر نفسه يكفي للدلالة أن الصف قابل للفتح.
            row_widget.setToolTip("")
            row_widget.setCursor(Qt.PointingHandCursor)
            row_widget.mousePressEvent = lambda _e, d=data: self._open_activity(d)

        kind = QLabel(data["kind"])
        kind.setStyleSheet(f"color: {color}; background: {self._tint(color, 0.10)}; border-radius: 8px; padding: 4px 10px; font-weight: 700; font-size: 11px;")
        kind.setSizePolicy(_SP.Maximum, _SP.Preferred)
        
        where = data["contract_label"] or data["customer_name"] or "—"
        detail = data["text"] or ""
        body = QLabel(f"{where} · {detail}" if detail else where)
        body.setWordWrap(True)
        body.setMinimumWidth(0)
        body.setStyleSheet(f"color: {theme['TEXT_900']}; background: transparent; font-size: 11.5px;")
        body.setToolTip("")
        
        amount = QLabel(f"{data['sign'] * data['amount']:+,.3f}" if data["amount"] else "")
        amount.setStyleSheet(f"color: {color}; background: transparent; font-weight: 800;")
        amount.setSizePolicy(_SP.Maximum, _SP.Preferred)
        
        when = QLabel((data["when"] or "")[:16])
        when.setStyleSheet(f"color: {theme['TEXT_400']}; background: transparent; font-size: 11px;")
        when.setSizePolicy(_SP.Maximum, _SP.Preferred)
        
        row_l.addWidget(kind)
        row_l.addWidget(body, 1)
        row_l.addWidget(amount)
        row_l.addWidget(when)

    def _render_alerts(self):
        self._render_feed()

    def _open_alert_folder(self, customer_id: int, path: str):
        from services import folder_service
        if not folder_service.open_folder(path):
            style.error(self, "تعذر فتح المجلد، تأكد من اتصال الشبكة.")
            return
        try:
            folder_service.mark_folder_seen(customer_id)
        except Exception:
            pass
        self.folder_opened.emit()


# ============================================================
# فهارس الشاشات في الـStack
# ============================================================
IDX_DASHBOARD = 0
IDX_DEALINGS = 1
IDX_CONTRACTS = 2      # مركز النماذج (كان صفحة العقود الثابتة)
IDX_SUBS = 3
IDX_RECEIPTS = 4
IDX_PAYMENTS = 5
IDX_STATEMENT = 6
IDX_REPORTS = 7
IDX_SETTINGS = 8
# (IDX_BOARD=9 محذوف — لوحة الكانبان استُبدلت بنظام مراحل التنفيذ
#  بالأزرار والعداد: مركز العقد + التقارير — أرقام الباقي بلا تغيير)
IDX_CONTRACT_HUB = 10
IDX_VISITS = 11           # جدول الزيارات اليومي (ساعات × مهندسين)
IDX_COMMENTS = 12         # مركز التعليقات والمتابعة الموحد
IDX_CUSTODY = 13          # العُهد وتصفياتها (مستقلة عن سندات الصرف)
IDX_GATEWAY = 14          # شاشة بوابة الدفع الموحدة (مطابقة + تصفية)
IDX_SETTLEMENTS = 15      # رابط عميق: صفحة العهد الموحدة على قسم التصفيات
IDX_TRANSFERS = 16        # تسديدات الشركة الأخرى (مجمعات التواريخ)
IDX_CLAIMS = 17           # المطالبات المالية (V4.47)
IDX_ADVANCES = 18         # سلف الموظفين (V4.53)


# ✅ تم دمج PAGE_PERMS في قاموس واحد صحيح بدون تكرار
PAGE_PERMS = {
    IDX_DEALINGS: "screen_customers",
    IDX_CONTRACTS: "screen_forms",
    IDX_SUBS: "screen_subcontractors",
    IDX_RECEIPTS: "screen_receipts",
    IDX_PAYMENTS: "screen_payments",
    IDX_STATEMENT: "screen_statement",
    IDX_REPORTS: "screen_reports",
    IDX_SETTINGS: "screen_settings",
    IDX_CONTRACT_HUB: "screen_customers",
    IDX_VISITS: "screen_visits",
    IDX_COMMENTS: "screen_customers",
    IDX_GATEWAY: "screen_gateway",
    IDX_TRANSFERS: "screen_gateway",
    IDX_CLAIMS: "screen_claims",
}


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setObjectName("MainWindow")
        _app_name = settings_service.app_name()
        from version import APP_VERSION as _APP_VERSION
        self.setWindowTitle(f"{_app_name} {_APP_VERSION}")
        self.setLayoutDirection(Qt.RightToLeft)
        self._nav_history: list[int] = []
        self._suppress_history = False
        self._refresh_timer = QTimer(self)
        self._refresh_timer.setSingleShot(True)
        self._refresh_timer.setInterval(650)
        self._refresh_timer.timeout.connect(self._refresh_all)
        style.ensure_light_background(self)
        try:
            from PySide6.QtWidgets import QApplication
            app = QApplication.instance()
            if app is not None:
                app.installEventFilter(self)
        except Exception:
            pass
        style.fit_window(self, 1360, 820, min_w=1100, min_h=680, ratio=0.96)
        style.center_on_screen(self)
        _u = style.scale_unit(self)

        central = GlassBackground()
        root = QHBoxLayout(central)
        root.setContentsMargins(16, 0, 0, 0)
        root.setSpacing(10)

        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(int(200 * _u))
        self._sidebar_scale = _u
        self._sidebar_collapsed = False
        self._sidebar_texts: dict = {}
        self._sidebar_tips: set = set()
        soft_shadow(sidebar, radius=30, y=0, x=-6)
        side_layout = QVBoxLayout(sidebar)
        side_layout.setContentsMargins(0, 16, 0, 14)
        side_layout.setSpacing(0)

        brand = QHBoxLayout()
        brand.setContentsMargins(12, 0, 12, 0)
        brand.setSpacing(8)
        logo_lbl = QLabel()
        logo_lbl.setObjectName("appLogo")
        self.logo_lbl = logo_lbl
        self._refresh_brand_logo()
        text_col = QVBoxLayout()
        text_col.setSpacing(2)
        app_title = QLabel(_app_name)
        app_title.setObjectName("appTitle")
        self.app_title_lbl = app_title
        app_sub = QLabel(settings_service.header_title())
        app_sub.setObjectName("appSubtitle")
        self.app_subtitle_lbl = app_sub
        text_col.addWidget(app_title)
        text_col.addWidget(app_sub)
        brand.addWidget(logo_lbl)
        brand.addLayout(text_col, 1)
        side_layout.addLayout(brand)
        side_layout.addSpacing(12)

        # مدخل البحث الشامل في الشريط العلوي (الدفعة 5 · §6).

        from PySide6.QtGui import QShortcut, QKeySequence
        QShortcut(QKeySequence("Ctrl+F"), self, self._open_global_search)
        QShortcut(QKeySequence("Ctrl+K"), self, self._open_global_search)
        QShortcut(QKeySequence("Ctrl+N"), self, self._shortcut_new_contract)
        QShortcut(QKeySequence("Ctrl+R"), self, lambda: self._shortcut_voucher("receipt"))
        QShortcut(QKeySequence("Ctrl+P"), self, lambda: self._shortcut_voucher("payment"))
        QShortcut(QKeySequence("Ctrl+1"), self, lambda: self._go(0))
        QShortcut(QKeySequence("Ctrl+2"), self, lambda: self._go(1))
        QShortcut(QKeySequence("Ctrl+3"), self, lambda: self._go(2))
        QShortcut(QKeySequence("Ctrl+4"), self, lambda: self._go(3))

        self.stack = QStackedWidget()
        self.stack.currentChanged.connect(
            lambda *_a: QTimer.singleShot(0, lambda: style.guard_table_sections(self.stack)))
        self.dashboard = DashboardPage()
        self.customer_file_page = None
        self._customer_page_return = None
        from ui.reports_page import ReportsPage, visible_reports


        def _visits_factory():
            from ui.visits import VisitsPage
            return VisitsPage()

        def _custody_factory():
            from ui.custody_center import CustodyUnifiedPage
            return CustodyUnifiedPage()

        def _advances_factory():
            from ui.advances_page import AdvancesPage
            return AdvancesPage()

        def _gateway_factory():
            from ui.payment_gateway_page import PaymentGatewayPage
            return PaymentGatewayPage()

        def _transfers_factory():
            from ui.other_transfers_page import OtherTransfersPage
            return OtherTransfersPage()

        def _claims_factory():
            from ui.claims_page import ClaimsPage
            return ClaimsPage()

        self.tasks_page = self.dashboard.tasks_panel

        self._page_factories = {
            IDX_DEALINGS: ("dealings_page", DealingsPage),
            IDX_CONTRACTS: ("forms_page", FormsCenterPage),
            IDX_SUBS: ("subs_page", SubcontractorsPage),
            IDX_RECEIPTS: ("receipts_page", lambda: VouchersPage("receipt")),
            IDX_PAYMENTS: ("payments_page", lambda: VouchersPage("payment")),
            IDX_STATEMENT: ("statement_page", StatementPage),
            IDX_REPORTS: ("reports_page", ReportsPage),
            IDX_SETTINGS: ("settings_page", SettingsPage),
            # لا ننشئ صفحة مركز عقد منفصلة؛ التفاصيل مدمجة داخل ملف العميل.
            IDX_VISITS: ("visits_page", lambda: _visits_factory()),
            IDX_COMMENTS: ("comments_page", CommentsCenterPage),
            IDX_CUSTODY: ("custody_page", lambda: _custody_factory()),
            IDX_GATEWAY: ("gateway_page", lambda: _gateway_factory()),
            IDX_TRANSFERS: ("transfers_page",
                            lambda: _transfers_factory()),
            IDX_CLAIMS: ("claims_page",
                         lambda: _claims_factory()),
            IDX_ADVANCES: ("advances_page",
                           lambda: _advances_factory()),
        }
        self._pages = {IDX_DASHBOARD: self.dashboard}
        self.stack.addWidget(self.dashboard)
        for idx in range(1, max(self._page_factories) + 1):
            holder = QWidget()
            holder.setObjectName("page")
            self.stack.addWidget(holder)

        _REPORT_CHILDREN = [("child_report", f"{r['icon']}  {r.get('short', r['name'])}", i) for i, r in enumerate(visible_reports())]
        from services import feature_service as _feat
        from services import auth_service as _perm
        # ثوابت الفهرس فقط — ممنوع أرقام يدوية (كانت قديمة متحجرة
        # من قبل إضافة مركز النماذج ففتحت كل زر الصفحة التي قبله!)
        _money_children = []
        if _perm.has_permission("screen_receipts"):
            _money_children.append(("child_page", "📥  سندات القبض",
                                    IDX_RECEIPTS))
        if _perm.has_permission("screen_payments"):
            _money_children.append(("child_page", "📤  سندات الصرف",
                                    IDX_PAYMENTS))
        if (_feat.enabled("statement")
                and _perm.has_permission("screen_statement")):
            _money_children.append(("child_page", "📊  كشف الحساب",
                                    IDX_STATEMENT))
        if (_feat.enabled("custody")
                and _perm.has_permission("screen_payments")):
            # V3.12: زر واحد للعهد — التصفيات والتقارير تابات علوية داخله.
            _money_children.append(("child_page", "💰  العهد",
                                    IDX_CUSTODY))
            # V4.53: سلف الموظفين — نفس بوابة العهد (ذمم مستردة).
            _money_children.append(("child_page", "👥  سلف الموظفين",
                                    IDX_ADVANCES))
        if (_feat.enabled("payment_gateway")
                and _perm.has_permission("screen_gateway")):
            _money_children.append(("child_page", "💳  بوابة الدفع",
                                    IDX_GATEWAY))
        if _perm.has_permission("screen_claims"):
            _money_children.append(("child_page", "🧾  المطالبات المالية",
                                    IDX_CLAIMS))

        
        nav_tree = [("page", "الرئيسية", "🏠", 0)]
        if _perm.has_permission("screen_customers"):
            nav_tree.append(("page", "العملاء", "👥", IDX_DEALINGS))
        if (_feat.enabled("forms_center")
                and _perm.has_permission("screen_forms")):
            nav_tree.append(("page", "مركز النماذج", "🗂", IDX_CONTRACTS))
        if _perm.has_permission("screen_customers"):
            nav_tree.append(("page", "التعليقات", "💬", IDX_COMMENTS))
        if _feat.enabled("subcontractors") and _perm.has_permission("screen_subcontractors"):
            nav_tree.append(("page", "مقاولو الباطن", "👷", IDX_SUBS))
        if _money_children: 
            nav_tree.append(("group", "المحاسبة", "💵", _money_children))
        # تظهر التقارير المختارة حتى لو أُخفيت شاشة مركز التقارير كاملة؛
        # تأشيرة screen_reports تعطي المركز، أما rep_* فتفتح التقرير المحدد مباشرة.
        if _feat.enabled("reports") and _REPORT_CHILDREN: 
            nav_tree.append(("group", "التقارير", "📑", _REPORT_CHILDREN))
        if _feat.enabled("visits") and _perm.has_permission("screen_visits"):
            nav_tree.append(("page", "جدول الزيارات", "🗓", IDX_VISITS))
        if _perm.has_permission("screen_settings"): 
            nav_tree.append(("page", "الإعدادات", "⚙", IDX_SETTINGS))

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self._group_boxes: dict[str, QWidget] = {}
        self._group_btns: dict[str, QPushButton] = {}

        from PySide6.QtWidgets import QScrollArea
        nav_scroll = QScrollArea()
        nav_scroll.setWidgetResizable(True)
        nav_scroll.setFrameShape(QFrame.NoFrame)
        nav_scroll.setObjectName("transparentHost")
        nav_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        nav_holder = QWidget()
        nav_holder.setObjectName("transparentHost")
        nav_col = QVBoxLayout(nav_holder)
        nav_col.setContentsMargins(0, 0, 0, 0)
        nav_col.setSpacing(0)

        def _add_page_btn(layout, name, idx, child=False):
            btn = QPushButton(name)
            btn.setProperty("navChild" if child else "nav", True)
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            self.nav_group.addButton(btn, idx)
            layout.addWidget(btn)
            return btn

        def _add_report_btn(layout, name, report_idx):
            btn = QPushButton(name)
            btn.setProperty("navChild", True)
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            self.nav_group.addButton(btn, 1000 + report_idx)
            layout.addWidget(btn)
            return btn

        self._crumbs = {IDX_REPORTS: "التقارير",
                        IDX_CONTRACT_HUB: "مركز العقد"}
        self._report_crumbs: dict = {}

        def _strip_icon(s: str) -> str:
            return s.split("  ", 1)[1] if "  " in s else s

        for entry in nav_tree:
            kind = entry[0]
            if kind == "page":
                _, name, icon, idx = entry
                _add_page_btn(nav_col, f"{icon}  {name}", idx)
                self._crumbs[idx] = name
            else:
                _, name, icon, children = entry
                gbtn = QPushButton(f"{icon}  {name}   ⌄")
                gbtn.setProperty("navGroup", True)
                gbtn.setCursor(Qt.PointingHandCursor)
                nav_col.addWidget(gbtn)
                box = QWidget()
                box.setObjectName("transparentHost")
                box_col = QVBoxLayout(box)
                box_col.setContentsMargins(0, 0, 0, 2)
                box_col.setSpacing(0)
                for ch in children:
                    ckind, cname = ch[0], ch[1]
                    if ckind == "child_page": _add_page_btn(box_col, cname, ch[2], child=True)
                    else: _add_report_btn(box_col, cname, ch[2])
                    _crumb = f"{name} › {_strip_icon(cname)}"
                    if ckind == "child_page": self._crumbs[ch[2]] = _crumb
                    else: self._report_crumbs[ch[2]] = _crumb
                box.setVisible(False)
                nav_col.addWidget(box)
                self._group_boxes[name] = box
                self._group_btns[name] = gbtn
                gbtn.clicked.connect(lambda _, n=name, i=icon: self._toggle_group(n, i))

        nav_col.addStretch()
        nav_scroll.setWidget(nav_holder)
        side_layout.addWidget(nav_scroll, 1)

        # V3.12: الرابط العميق الداخلي (بلا زر) يحتفظ بمساره.
        self._crumbs[IDX_SETTLEMENTS] = "المحاسبة › تصفيات العهد"
        self.nav_group.idClicked.connect(self._navigate)
        self.stack.currentChanged.connect(self._refresh_crumb)
        self.nav_group.button(0).setChecked(True)

        root.addWidget(sidebar)
        right_col = QWidget()
        right_col.setObjectName("transparentHost")
        from PySide6.QtWidgets import QSizePolicy as _QSP2
        right_col.setSizePolicy(_QSP2.Ignored, _QSP2.Preferred)
        col_lay = QVBoxLayout(right_col)
        col_lay.setContentsMargins(0, 0, 0, 0)
        col_lay.setSpacing(0)
        col_lay.addWidget(self._build_top_bar())
        col_lay.addWidget(self._build_local_banner())   # V5.9
        col_lay.addWidget(self.stack, 1)
        root.addWidget(right_col, 1)
        self.setCentralWidget(central)

        self.tasks_page.data_changed.connect(self._schedule_refresh_all)
        self.dashboard.user_action.connect(self._handle_user_action)
        self.dashboard.activity_chosen.connect(self._open_activity_source)
        self.dashboard.quick_action.connect(self._quick_action)
        self.dashboard.convert_alert.connect(self._alert_to_task)
        self.dashboard.folder_opened.connect(self._refresh_all)

        self._task_timer = QTimer(self)
        self._task_timer.setInterval(60 * 1000)
        self._task_timer.timeout.connect(self._check_task_notifications)
        self._task_timer.start()

        # V8.7.11: فحص اتصال قاعدة البيانات كل 30 ثانية
        self._db_healthy = True
        self._db_heartbeat_timer = QTimer(self)
        self._db_heartbeat_timer.setInterval(30 * 1000)
        self._db_heartbeat_timer.timeout.connect(self._db_heartbeat)
        self._db_heartbeat_timer.start()

        self._refresh_all()
        self._sidebar = sidebar
        self._pages_scroll = None
        from PySide6.QtCore import QTimer as _QTimer
        _QTimer.singleShot(0, self._fit_initial_size)
        _QTimer.singleShot(0, lambda: style.guard_table_sections(self))

    def eventFilter(self, obj, event):  # noqa: N802
        """عجلة الماوس للتمرير فقط: لا تغيّر combo/spin/date إلا مع تركيز تحرير."""
        try:
            from PySide6.QtCore import QEvent
            from PySide6.QtWidgets import (QAbstractSpinBox, QApplication,
                                           QComboBox, QScrollArea)
            if event.type() == QEvent.Wheel and isinstance(obj, (QComboBox, QAbstractSpinBox)):
                # السماح فقط إذا كان هذا الحقل هو صاحب تركيز لوحة المفاتيح فعلًا.
                if QApplication.focusWidget() is obj and obj.hasFocus():
                    return False
                parent = obj.parentWidget()
                while parent is not None:
                    if isinstance(parent, QScrollArea):
                        bar = parent.verticalScrollBar()
                        delta = event.angleDelta().y() if hasattr(event, "angleDelta") else 0
                        bar.setValue(bar.value() - delta)
                        event.accept()
                        return True
                    parent = parent.parentWidget()
                event.ignore()
                return True
        except Exception:
            pass
        return super().eventFilter(obj, event)

    # ============================================================
    # V5.9: لافتة «العمل على قاعدة محلية» — تمنع الفشل الصامت
    # ============================================================
    def _build_local_banner(self) -> QWidget:
        """لافتة حمراء واضحة لو تعذّر الوصول للشير ونزل البرنامج محليًا."""
        from database import database as _db
        bar = QFrame()
        bar.setObjectName("localFallbackBanner")
        lay = QHBoxLayout(bar)
        lay.setContentsMargins(12, 8, 12, 8)
        lay.setSpacing(10)
        self.local_banner = bar
        self.local_banner_lbl = QLabel("")
        self.local_banner_lbl.setWordWrap(True)
        self.local_banner_lbl.setStyleSheet("font-weight: 800;")
        lay.addWidget(self.local_banner_lbl, 1)
        self.local_banner_btn = QPushButton("🔄 إعادة المحاولة")
        self.local_banner_btn.clicked.connect(self._retry_network_folder)
        lay.addWidget(self.local_banner_btn)
        self.local_banner_open_btn = QPushButton("📂 فتح الشارح")
        self.local_banner_open_btn.setProperty("flat", True)
        self.local_banner_open_btn.clicked.connect(self._open_share_guide)
        lay.addWidget(self.local_banner_open_btn)
        bar.setVisible(False)
        self._refresh_local_banner()
        # فحص دوري هادئ كل دقيقتين (يتوقف تلقائيًا عند الوصول)
        self._banner_timer = QTimer(self)
        self._banner_timer.setInterval(120 * 1000)
        self._banner_timer.timeout.connect(self._refresh_local_banner)
        self._banner_timer.start()
        return bar

    def _refresh_local_banner(self):
        from database import database as _db
        if not hasattr(self, "local_banner"):
            return
        try:
            st = _db.resolve_status()
        except Exception:
            self.local_banner.setVisible(False)
            return
        if st.get("mode") == "local_fallback":
            self.local_banner_lbl.setText(
                "⚠ البرنامج يعمل الآن على قاعدة بيانات **محلية** على هذا "
                f"الجهاز — تعذّر الوصول لمجلد الشبكة:\n{st.get('configured') or ''}"
                f"  ({st.get('reason') or ''})\n"
                "أي إدخال الآن لن يظهر على الأجهزة الأخرى. أغلق البرنامج "
                "وتأكد من تشغيل جهاز المضيف ثم أعد فتحه.")
            self.local_banner.setStyleSheet(
                "background: rgba(220,38,38,0.12);"
                " border: 2px solid #DC2626; border-radius: 12px;"
                " color: #991B1B;")
            self.local_banner.setVisible(True)
        else:
            self.local_banner.setVisible(False)

    def _retry_network_folder(self):
        from database import database as _db
        ok, msg = _db.recheck_configured_folder()
        if ok:
            self.local_banner.setVisible(False)
            style.info(self,
                       "تم الوصول لمجلد الشبكة ✅\n\n" + str(msg) +
                       "\n\nأعد تشغيل البرنامج الآن ليعمل على قاعدة الشير "
                       "(حتى لا تبقى الجلسة الحالية على القاعدة المحلية).",
                       "وضع الشبكة")
        else:
            style.error(self, "لا يزال تعذّر الوصول:\n" + str(msg) +
                        "\n\nتأكد أن جهاز المضيف يعمل، وأن "
                        "ConTrack مغلق على بقية الأجهزة، ثم أعد المحاولة.")
    # ── V8.7.11: فحص اتصال قاعدة البيانات ────────────────────
    def _db_heartbeat(self):
        """فحص اتصال قاعدة البيانات — يكشف الانقطاع قبل المستخدم."""
        from database.database import db_health_check, db_force_reconnect
        if db_health_check():
            if not self._db_healthy:
                self._db_healthy = True
                self._hide_db_banner()
        else:
            # محاولة reconnect تلقائية
            if db_force_reconnect():
                self._db_healthy = True
                self._hide_db_banner()
            else:
                self._db_healthy = False
                self._show_db_banner()

    def _show_db_banner(self):
        """شريط تنبيه أحمر أعلى النافذة."""
        if not hasattr(self, '_db_warning_bar'):
            from PySide6.QtWidgets import QWidget as _QW
            self._db_warning_bar = _QW()
            lay = QHBoxLayout(self._db_warning_bar)
            lay.setContentsMargins(8, 6, 8, 6)
            lbl = QLabel("⚠️ انقطع الاتصال بقاعدة البيانات — جاري إعادة المحاولة تلقائياً...")
            lbl.setStyleSheet("font-weight: bold;")
            retry_btn = QPushButton("🔄 إعادة المحاولة الآن")
            retry_btn.setStyleSheet(
                "QPushButton { background: #DC2626; color: white; padding: 4px 12px;"
                " border-radius: 6px; font-weight: bold; }"
                " QPushButton:hover { background: #B91C1C; }")
            retry_btn.clicked.connect(self._db_retry_now)
            lay.addWidget(lbl)
            lay.addStretch()
            lay.addWidget(retry_btn)
            self._db_warning_bar.setStyleSheet(
                "background: #FEE2E2; border: 2px solid #DC2626; border-radius: 8px;")
            self.centralWidget().layout().insertWidget(0, self._db_warning_bar)
        self._db_warning_bar.setVisible(True)

    def _hide_db_banner(self):
        """إخفاء شريط التنبيه."""
        if hasattr(self, '_db_warning_bar'):
            self._db_warning_bar.setVisible(False)

    def _db_retry_now(self):
        """إعادة المحاولة فوراً — مع reconnect قسري."""
        from database.database import db_force_reconnect
        if db_force_reconnect():
            self._db_healthy = True
            self._hide_db_banner()
            style.toast(self, "تم إعادة الاتصال ✅")
        else:
            style.error(self, "لا يزال تعذّر الاتصال — تأكد من الشبكة وأعد المحاولة.")


    def _open_share_guide(self):
        import os as _os
        from PySide6.QtCore import QUrl as _QUrl
        from PySide6.QtGui import QDesktopServices as _QDS
        from database.database import BASE_DIR as _bd
        for _cand in (_os.path.join(_bd, "شارح_مشكلة_الشير_والحل.md"),
                      _os.path.join(_os.path.dirname(_bd), "شارح_مشكلة_الشير_والحل.md")):
            if _os.path.exists(_cand):
                _QDS.openUrl(_QUrl.fromLocalFile(_cand))
                return
        style.info(self, "الشارح غير موجود بجوار البرنامج — "
                         "استخدم: الإعدادات ← النسخ الاحتياطي ← وضع الشبكة.")

    def _build_top_bar(self) -> QWidget:
        bar = QWidget()
        bar.setObjectName("topBar")
        lay = QHBoxLayout(bar)
        lay.setContentsMargins(16, 8, 16, 0)
        lay.setSpacing(8)
        self._sidebar_toggle = QPushButton(">>")
        self._sidebar_toggle.setObjectName("sidebarToggle")
        self._sidebar_toggle.setProperty("flat", True)
        self._sidebar_toggle.setCursor(Qt.PointingHandCursor)
        self._sidebar_toggle.setFixedSize(30, 30)
        self._sidebar_toggle.setToolTip("طي الشريط الجانبي")
        self._sidebar_toggle.clicked.connect(self._toggle_sidebar)
        lay.addWidget(self._sidebar_toggle)
        self.crumb_lbl = QLabel("الرئيسية")
        self.crumb_lbl.setProperty("breadcrumb", True)
        lay.addWidget(self.crumb_lbl)
        self._search_btn = QPushButton("🔍 بحث شامل ...")
        self._search_btn.setProperty("flat", True)
        self._search_btn.setCursor(Qt.PointingHandCursor)
        self._search_btn.setMinimumWidth(170)
        self._search_btn.setToolTip("ابحث باسم أو هاتف أو رقم عقد/سند/فاتورة في كل النظام (Ctrl+F أو Ctrl+K)")
        self._search_btn.clicked.connect(self._open_global_search)
        lay.addWidget(self._search_btn)
        self.new_btn = QPushButton("＋ جديد")
        self.new_btn.setProperty("flat", True)
        self.new_btn.setCursor(Qt.PointingHandCursor)
        self.new_btn.setToolTip("إنشاء عميل/عقد/سند/مقاول من أي شاشة")
        self.new_btn.clicked.connect(self._open_new_menu)
        lay.addWidget(self.new_btn)
        lay.addStretch()

        # ---- أيقونة تنبيهات المتابعة (مع ميزة المتابعة فقط — قاعدة 38) ----
        self.bell_btn = None
        from services import feature_service as _feat0
        if _feat0.enabled("followup"):
            self.bell_btn = QPushButton("🔔")
            self.bell_btn.setObjectName("bellBtn")
            self.bell_btn.setCursor(Qt.PointingHandCursor)
            self.bell_btn.setProperty("unread", False)
            self.bell_btn.setToolTip("التنبيهات: نقل مرحلة أو رسالة جديدة على معاملة تشارك فيها")
            self.bell_btn.clicked.connect(self._open_notifications)
            from PySide6.QtWidgets import QSizePolicy as _QSPb
            self.bell_btn.setSizePolicy(_QSPb.Maximum, _QSPb.Fixed)
            lay.addWidget(self.bell_btn)
            self._bell_timer = QTimer(self)
            self._bell_timer.setInterval(30 * 1000)
            self._bell_timer.timeout.connect(self._refresh_bell)
            self._bell_timer.start()

        # ---- شارة المستخدم ----
        self.user_badge = QPushButton("")
        self.user_badge.setObjectName("userBadge")
        self.user_badge.setCursor(Qt.PointingHandCursor)
        self.user_badge.clicked.connect(self._user_menu)
        from PySide6.QtWidgets import QSizePolicy as _QSPu
        self.user_badge.setSizePolicy(_QSPu.Maximum, _QSPu.Fixed)
        self._refresh_user_badge()
        lay.addWidget(self.user_badge)
        self.top_bar = bar
        return bar

    def _refresh_brand_logo(self):
        """تحديث شعار الشركة في هيدر النظام من إعدادات الشركة."""
        if not hasattr(self, "logo_lbl"):
            return
        logo_path = ""
        try:
            logo_path = settings_service.get_settings().logo_path or ""
        except Exception:
            pass
        pix = QPixmap(logo_path) if logo_path and os.path.exists(logo_path) else QPixmap()
        if pix.isNull():
            pix = style.icon_pixmap(34, self)
        self.logo_lbl.setPixmap(pix.scaled(34, 34, Qt.KeepAspectRatio, Qt.SmoothTransformation))

    def _refresh_brand_identity(self):
        try:
            from version import APP_VERSION as _APP_VERSION
            self.setWindowTitle(
                f"{settings_service.app_name()} {_APP_VERSION}")
            if hasattr(self, "app_title_lbl"):
                self.app_title_lbl.setText(settings_service.app_name())
            if hasattr(self, "app_subtitle_lbl"):
                self.app_subtitle_lbl.setText(settings_service.header_title())
            self._refresh_brand_logo()
        except Exception:
            pass

    def _user_menu(self):
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        for label, key in self.dashboard.user_menu_actions():
            if key == "logout": menu.addSeparator()
            menu.addAction(label).setData(key)
        chosen = menu.exec(self.user_badge.mapToGlobal(self.user_badge.rect().bottomRight()))
        if chosen is not None:
            self.dashboard.user_action.emit(chosen.data())

    def _ensure_page(self, index: int):
        page = self._pages.get(index)
        if page is not None: return page
        spec = self._page_factories.get(index)
        if spec is None: return self.stack.widget(index)
        attr, factory = spec
        page = factory()
        setattr(self, "_" + attr, page)
        self._pages[index] = page
        holder = self.stack.widget(index)
        self.stack.insertWidget(index, page)
        if holder is not None and holder is not page:
            self.stack.removeWidget(holder)
            try:
                holder.hide()
            except Exception:
                pass
            holder.deleteLater()
        self._wire_page(index, page)
        return page

    def _wire_page(self, index: int, page):
        if hasattr(page, "data_changed"): page.data_changed.connect(self._schedule_refresh_all)
        if index == IDX_DEALINGS:
            page.open_statement.connect(self._open_statement)
            page.open_customer_file.connect(self.open_customer_page)
        elif index == IDX_SETTINGS:
            page.settings_changed.connect(self._refresh_all)
            page.db_restored.connect(self._refresh_all)
            page.user_identity_changed.connect(self._refresh_user_badge)
            page.modules_changed.connect(self._on_modules_changed)

    def _on_modules_changed(self, *args):
        rp = self._pages.get(IDX_REPORTS)
        if rp is not None: rp.modules_refreshed(*args)

    def _built_pages(self): return list(self._pages.values())

    @property
    def dealings_page(self): return self._ensure_page(IDX_DEALINGS)
    @property
    def forms_page(self): return self._ensure_page(IDX_CONTRACTS)
    @property
    def subs_page(self): return self._ensure_page(IDX_SUBS)
    @property
    def receipts_page(self): return self._ensure_page(IDX_RECEIPTS)
    @property
    def payments_page(self): return self._ensure_page(IDX_PAYMENTS)
    @property
    def statement_page(self): return self._ensure_page(IDX_STATEMENT)
    @property
    def reports_page(self): return self._ensure_page(IDX_REPORTS)
    @property
    def settings_page(self): return self._ensure_page(IDX_SETTINGS)

    @property
    def visits_page(self): return self._ensure_page(IDX_VISITS)
    @property
    def comments_page(self): return self._ensure_page(IDX_COMMENTS)

    @property
    def custody_page(self): return self._ensure_page(IDX_CUSTODY)

    @property
    def advances_page(self): return self._ensure_page(IDX_ADVANCES)

    @property
    def gateway_page(self): return self._ensure_page(IDX_GATEWAY)

    @property
    def transfers_page(self): return self._ensure_page(IDX_TRANSFERS)

    @property
    def settlements_page(self): return self.custody_page.settlements

    @property
    def clearing_page(self): return self._ensure_page(IDX_GATEWAY).clear_tab

    def open_comments_center(self, customer_id: int | None = None,
                             contract_id: int | None = None):
        """فتح مركز التعليقات الموحد مفلترًا حسب العميل/العقد."""
        if not self._guard_perm("screen_customers"):
            return
        self.comments_page.load_filter(customer_id, contract_id)
        self._go(IDX_COMMENTS)

    def open_type_workflow(self, type_name: str):
        """فتح ربط مراحل ودفعات نوع العقد كصفحة داخلية بدل Popup كبير."""
        if not self._guard_perm("screen_settings"):
            return
        from ui.type_workflow import TypeWorkflowDialog
        page = TypeWorkflowDialog(self, type_name)
        page.setWindowFlags(Qt.Widget)
        try:
            lay = page.layout()
            if lay is not None:
                top = QWidget()
                top.setObjectName("pageHeader")
                row = QHBoxLayout(top)
                row.setContentsMargins(0, 0, 0, 8)
                back = QPushButton("→ رجوع للإعدادات")
                back.setProperty("flat", True)
                back.clicked.connect(lambda: self._go(IDX_SETTINGS))
                title = QLabel(f"ربط مراحل ودفعات نوع: {type_name}")
                title.setProperty("pageTitle", True)
                row.addWidget(back); row.addWidget(title); row.addStretch()
                lay.insertWidget(0, top)
        except Exception:
            pass
        old = getattr(self, "_type_workflow_page", None)
        if old is not None:
            self.stack.removeWidget(old)
            try:
                old.hide()
            except Exception:
                pass
            old.deleteLater()
        self._type_workflow_page = page
        self.stack.addWidget(page)
        self.stack.setCurrentWidget(page)

    def open_contract_hub(self, contract_id: int,
                          open_page: str = "dashboard"):
        """فتح تفاصيل العقد داخل ملف العميل الموحد Master-Detail.

        لا يوجد تنقل كامل إلى شاشة عقد منفصلة؛ نحافظ على سياق العميل ونختار
        العقد في قائمة عقود العميل ثم نعرض تفاصيله في نفس الصفحة.
        """
        # V2.48: نطاق ذاكرة البناء — القراءات المكررة (237 استعلامًا
        # كانت) تُنفَّذ مرة واحدة أثناء البناء فقط.
        from services.qcache import build_cache
        with build_cache():
            self._open_contract_hub_inner(contract_id, open_page)

    def _open_contract_hub_inner(self, contract_id: int,
                                 open_page: str = "dashboard"):
        if not self._guard_perm("screen_customers"):
            return
        try:
            con = contract_service.get_contract(contract_id)
            customer_id = getattr(con, "customer_id", None) if con else None
        except Exception:
            customer_id = None
        if customer_id:
            self.open_customer_page(customer_id, "contracts")
            try:
                self.customer_file_page.show_contract_detail(contract_id)
            except Exception:
                pass
            return
        style.error(self, "تعذر فتح تفاصيل العقد لأن بيانات العميل غير متاحة.")

    def _fit_sidebar_width(self):
        if getattr(self, "_sidebar_collapsed", False):
            return
        try:
            need = 0
            for btn in self._sidebar.findChildren(QPushButton):
                fm = btn.fontMetrics()
                text_w = fm.horizontalAdvance(btn.text())
                pad = 22 + 10 + 12 + 10 if btn.property("navChild") else 10 + 10 + 7 + 7 + 18 if btn.property("navGroup") else 10 + 10 + 7 + 7
                need = max(need, text_w + pad)
            need = max(need, 150) + 16 + 12
            target = int(200 * getattr(self, "_sidebar_scale", 1.0))
            avail = style.available_geometry(self)
            cap = int(avail.width() * 0.40) if avail else 400
            width = max(target, need)
            self._sidebar.setFixedWidth(int(max(170, min(width, max(cap, 200)))))
        except Exception: pass

    def _fit_initial_size(self):
        try:
            self._fit_sidebar_width()
            need = self.stack.sizeHint()
            extra_w = self._sidebar.width() + 16 + 32
            want_w = max(1360, need.width() + extra_w)
            want_h = max(820, need.height() + 32)
            style.fit_window(self, want_w, want_h, min_w=1100, min_h=680, ratio=0.96)
            style.center_on_screen(self)
        except Exception: pass

    def _reveal_nav_button(self, index: int):
        btn = self.nav_group.button(index)
        if btn is None: return
        parent = btn.parentWidget()
        for name, box in self._group_boxes.items():
            if parent is box and not box.isVisible():
                gbtn = self._group_btns[name]
                icon = gbtn.text().split("  ")[0]
                self._toggle_group(name, icon)
        btn.setChecked(True)

    def _go(self, index: int):
        if index == IDX_SETTLEMENTS:
            # V3.9: الرابط العميق خارج نطاق الـstack — يُمرَّر مباشرة
            self._reveal_nav_button(index)
            self._navigate(index)
            return
        if 0 <= index < self.stack.count():
            self._reveal_nav_button(index)
            self._navigate(index)

    def _back_from_contract_hub(self):
        """الرجوع من مركز العقد إلى الصفحة السابقة الفعلية في النظام."""
        prev = self._nav_history.pop() if getattr(self, "_nav_history", []) else IDX_DEALINGS
        if prev == IDX_CONTRACT_HUB or not (0 <= prev < self.stack.count()):
            prev = IDX_DEALINGS
        self._suppress_history = True
        self._go(prev)
        self._suppress_history = False

    def open_form_fill(self, template_id: int, customer_id: int | None = None,
                       contract_id: int | None = None):
        """فتح تعبئة قالب Word من المحرك الوحيد الحالي."""
        if not self._guard_perm("screen_forms"):
            return
        from ui.word_forms_center import WordFormFillDialog
        WordFormFillDialog(template_id, self, customer_id, contract_id).exec()
        page = self._pages.get(IDX_CONTRACTS)
        if hasattr(page, "refresh"):
            try:
                page.refresh()
            except Exception:
                pass

    def _ensure_customer_page(self):
        if getattr(self, "customer_file_page", None) is None:
            from ui.archive import CustomerFileWidget
            page = CustomerFileWidget(self, None, embedded=True)
            page.back_requested.connect(self.close_customer_page)
            page.data_changed.connect(self._schedule_refresh_all)
            self.stack.addWidget(page)
            self.customer_file_page = page
        return self.customer_file_page

    def _prewarm_customer_page(self):
        try: self._ensure_customer_page()
        except Exception: pass

    def open_customer_page(self, customer_id: int, open_page: str = "overview"):
        if not self._guard_perm("screen_customers"): return
        from services import customer_service
        cust = customer_service.get_customer(customer_id)
        if not cust:
            style.error(self, "تعذر العثور على بيانات العميل.")
            return
        self.stack.setUpdatesEnabled(False)
        try:
            page = self._ensure_customer_page()
            current = self.stack.currentIndex()
            page.load_customer(cust, open_page)
            # الرجوع يكون للصفحة السابقة الفعلية، وليس دائمًا صفحة العملاء.
            # وإذا كنا بالفعل داخل ملف عميل فلا نجعل الرجوع يشير لنفس الصفحة.
            if self.stack.currentWidget() is self.customer_file_page:
                current = getattr(self, "_customer_page_return", IDX_DEALINGS)
            self._customer_page_return = current if current >= 0 else IDX_DEALINGS
            self.stack.setCurrentWidget(self.customer_file_page)
            self._reveal_nav_button(self._customer_page_return)
            self.customer_file_page.setFocus()
        finally:
            self.stack.setUpdatesEnabled(True)
            self.stack.update()

    def showEvent(self, event):
        super().showEvent(event)
        # لا ننشئ صفحات كبيرة في الخلفية بعد الدخول حتى لا يظهر وميض/Popup عابر.
        # تُبنى الصفحات عند طلبها فقط داخل الـ stack.

    def close_customer_page(self):
        index = getattr(self, "_customer_page_return", None)
        if index is None: index = IDX_DEALINGS
        self.stack.setUpdatesEnabled(False)
        try:
            self.stack.setCurrentIndex(index)
            self._reveal_nav_button(index)
        finally:
            self.stack.setUpdatesEnabled(True)
            self.stack.update()

    # ── صفحة ملف المقاول ────────────────────────────────────────
    def _ensure_subcontractor_page(self):
        if getattr(self, "subcontractor_profile_page", None) is None:
            from ui.subcontractor_page import SubcontractorPage
            page = SubcontractorPage(self)
            page.back_requested.connect(self.close_subcontractor_page)
            self.stack.addWidget(page)
            self.subcontractor_profile_page = page
        return self.subcontractor_profile_page

    def open_subcontractor_profile(self, sub_id: int):
        if not self._guard_perm("screen_subcontractors"): return
        from services import lifecycle_service as lc
        sub = lc.get_subcontractor(sub_id)
        if not sub:
            style.error(self, "تعذر العثور على بيانات المقاول.")
            return
        self.stack.setUpdatesEnabled(False)
        try:
            page = self._ensure_subcontractor_page()
            current = self.stack.currentIndex()
            page.load_subcontractor(sub_id)
            if self.stack.currentWidget() is self.subcontractor_profile_page:
                current = getattr(self, "_sub_page_return", IDX_SUBS)
            self._sub_page_return = current if current >= 0 else IDX_SUBS
            self.stack.setCurrentWidget(self.subcontractor_profile_page)
            self._reveal_nav_button(self._sub_page_return)
            self.subcontractor_profile_page.setFocus()
        finally:
            self.stack.setUpdatesEnabled(True)
            self.stack.update()

    def close_subcontractor_page(self):
        index = getattr(self, "_sub_page_return", None)
        if index is None: index = IDX_SUBS
        self.stack.setUpdatesEnabled(False)
        try:
            self.stack.setCurrentIndex(index)
            self._reveal_nav_button(index)
        finally:
            self.stack.setUpdatesEnabled(True)
            self.stack.update()

    def _alert_to_task(self, alert_text: str):
        from PySide6.QtWidgets import QDialog as _QD
        from ui.tasks import TaskDialog
        title = alert_text.strip()
        for prefix in ("⏰", "📆", "💰", "🏦", "⏸", "💾", "🗀", "📌"):
            if title.startswith(prefix):
                title = title[len(prefix):].strip()
                break
        short = title if len(title) <= 80 else title[:77] + "..."
        dlg = TaskDialog(self, preset_title=short, preset_details=alert_text)
        if dlg.exec() == _QD.Accepted:
            style.info(self, "تم إنشاء المهمة · ستجدها في صفحة المهام وسيصلك تذكير قبل موعدها.", "تم")
            self._refresh_all()

    def _check_task_notifications(self):
        try:
            from services import task_service
            fired = task_service.due_notifications()
        except Exception: return
        if not fired: return
        if len(fired) == 1:
            t = fired[0]
            text = f"تذكير: مهمة «{t['title']}» بعد {max(1, t['minutes_to'])} دقيقة" if t["kind"] == "before" else f"مهمة لم تُنجز: «{t['title']}» · كان موعدها {t['due_at']}"
        else:
            text = f"{len(fired)} مهام تحتاج انتباهك · تفاصيلها في قائمة التنبيهات بالرئيسية"
        try: style.toast(self, text, kind="warning", msec=6000)
        except Exception: pass
        self.dashboard.refresh()

    def _new_menu_items(self):
        """عناصر زر + جديد — مطابقة لأزرار الرئيسية السريعة."""
        from services import auth_service as _auth
        items = [("＋ تسجيل عميل", "new_customer"),
                 ("＋ عقد جديد", "new_contract"),
                 ("＋ سند قبض", "new_receipt"),
                 ("＋ سند صرف", "new_payment")]
        if _auth.has_permission("action_add_subcontractor"):
            items.append(("＋ مقاول باطن", "new_subcontractor"))
        return items

    def _open_new_menu(self):
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        for label, action in self._new_menu_items():
            act = menu.addAction(label)
            act.setData(action)
        chosen = menu.exec(
            self.new_btn.mapToGlobal(self.new_btn.rect().bottomLeft()))
        if chosen is None or not chosen.data():
            return
        self._quick_action(chosen.data())

    def _quick_action(self, action: str):
        from PySide6.QtWidgets import QDialog as _QD
        if action == "new_customer":
            from ui.customers import CustomerDialog
            if CustomerDialog(self).exec() == _QD.Accepted: self._refresh_all()
        elif action == "new_contract": self._new_contract_dialog()
        elif action == "new_receipt": self._shortcut_voucher("receipt")
        elif action == "new_payment": self._shortcut_voucher("payment")
        elif action == "new_subcontractor":
            from services import auth_service as _auth
            if not _auth.has_permission("action_add_subcontractor"):
                style.toast(self, "إضافة مقاولي الباطن للمدير فقط.")
                return
            from ui.subcontractors import SubcontractorDialog
            if SubcontractorDialog(self).exec() == _QD.Accepted: self._refresh_all()

    def _new_contract_dialog(self):
        """فتح صفحة إنشاء عقد جديد."""
        from services import customer_service
        if not customer_service.count_customers():
            style.info(self, "أضف عميلًا أولاً.")
            return
        self.open_contract_page()

    def open_dialog_page(self, dialog, title="", on_done=None):
        """ضمّن أي QDialog كصفحة كاملة في الـ stack."""
        from ui.page_host import FullPageHost
        # حفظ الصفحة السابقة قبل الإضافة
        prev = self.stack.currentWidget()
        host = FullPageHost(dialog, title=title, on_done=on_done,
                            parent=self, prev_widget=prev)
        self.stack.addWidget(host)
        self.stack.setCurrentWidget(host)

    def open_contract_page(self, contract=None, customer_id=None, on_done=None):
        """فتح صفحة عقد العميل (إنشاء/تعديل) كصفحة كاملة."""
        from ui.contracts import ContractDialog
        dlg = ContractDialog(self, contract)
        if customer_id:
            try:
                dlg.customer.select_data(customer_id)
            except Exception:
                pass
        title = "📄 تعديل العقد" if contract else "📄 إنشاء عقد جديد"
        callback = on_done or (lambda accepted: self._refresh_all() if accepted else None)
        self.open_dialog_page(dlg, title=title, on_done=callback)

    def open_subcontract_page(self, contract=None, contract_id=None, sub_id=None, on_done=None):
        """فتح صفحة عقد المقاول (إنشاء/تعديل) كصفحة كاملة."""
        from ui.subcontractors import LinkSubContractDialog, EditSubContractDialog
        if contract:
            dlg = EditSubContractDialog(self, contract)
            title = "👷 تعديل عقد المقاول"
        else:
            dlg = LinkSubContractDialog(self,
                                        preset_contract_id=contract_id,
                                        preset_sub_id=sub_id)
            title = "👷 إنشاء عقد مقاول"
        callback = on_done or (lambda accepted: self._refresh_all() if accepted else None)
        self.open_dialog_page(dlg, title=title, on_done=callback)

    def _shortcut_new_contract(self): self._new_contract_dialog()

    def _shortcut_voucher(self, vtype: str):
        from ui.actions import open_voucher
        open_voucher(self, vtype, on_saved=self._refresh_all)

    def _refresh_bell(self):
        if self.bell_btn is None: return
        try:
            from services import workflow_service as _wf
            n_wf = _wf.unread_count()
        except Exception: n_wf = 0
        n_sys = len(getattr(self.dashboard, "_alerts", []) or [])
        n = n_wf + n_sys
        self.bell_btn.setText(f"🔔 ({n})" if n else "🔔")
        if n:
            tip = f"{n} تنبيه · نظام {n_sys} + متابعة {n_wf} · اضغط للعرض"
        else:
            tip = "لا تنبيهات جديدة"
        self.bell_btn.setToolTip(tip + "\nتنبيهات المتابعة: نقل مرحلة أو رسالة على معاملة تشارك فيها")
        if bool(self.bell_btn.property("unread")) != bool(n):
            self.bell_btn.setProperty("unread", bool(n))
            self.bell_btn.style().unpolish(self.bell_btn)
            self.bell_btn.style().polish(self.bell_btn)

    def _notification_menu_items(self):
        """عناصر قائمة الجرس الموحدة: تنبيهات النظام + المتابعة.

        تنبيهات النظام معاد استخدامها من آخر حساب للرئيسية
        (dashboard._alerts) — لا استعلامات جديدة. كل عنصر:
        (النوع، النص، البيانات) والنوع header/sys/sys_all/wf/mark/clear/empty.
        """
        from services import workflow_service as _wf
        try:
            wf_items = _wf.get_unread_notifications()
        except Exception:
            wf_items = []
        sys_alerts = list(getattr(self.dashboard, "_alerts", []))
        out = []
        if sys_alerts:
            out.append(("header", f"تنبيهات النظام ({len(sys_alerts)})", None))
            for a in sys_alerts[:12]:
                text = a[1] if len(a) > 1 else ""
                extra = a[2] if len(a) > 2 else {}
                short = text if len(text) <= 70 else text[:67] + "..."
                out.append(("sys", short,
                            {"__sys__": True, "text": text, "extra": extra}))
            if len(sys_alerts) > 12:
                out.append(("sys_all", "عرض الكل في الرئيسية ←",
                            {"__sys_all__": True}))
        if wf_items:
            out.append(("header", f"تنبيهات المتابعة ({len(wf_items)})", None))
            for n in wf_items[:20]:
                text = n["text"]
                out.append(("wf", text if len(text) <= 70 else text[:67] + "...", n))
            out.append(("mark", "تعليم الكل كمقروء", {"__all__": True}))
        if sys_alerts:
            out.append(("dismiss", "🙈 إخفاء كل التنبيهات النظامية",
                        {"__dismiss__": True}))
        try:
            _has_hidden = bool(_wf.dismissed_alert_keys())
        except Exception:
            _has_hidden = False
        if _has_hidden:
            out.append(("restore", "↩ إظهار التنبيهات المخفية",
                        {"__restore__": True}))
        if not out:
            out.append(("empty", "لا تنبيهات جديدة", None))
        from services import feature_service as _feat_nc
        if _feat_nc.enabled("notif_cleanup"):
            out.append(("clear", "🗑 مسح كل إشعارات المتابعة",
                        {"__clear__": True}))
        return out

    def _open_notifications(self):
        from PySide6.QtWidgets import QMenu
        from services import workflow_service as _wf
        menu = QMenu(self)
        for kind, text, data in self._notification_menu_items():
            if kind in ("header", "empty"):
                menu.addAction(text).setEnabled(False)
            elif kind in ("mark", "clear", "dismiss", "restore"):
                menu.addSeparator()
                menu.addAction(text).setData(data)
            else:
                menu.addAction(text).setData(data)
        chosen = menu.exec(self.bell_btn.mapToGlobal(self.bell_btn.rect().bottomLeft()))
        if chosen is None or chosen.data() is None: return
        self._handle_notification_choice(chosen.data())

    def _handle_notification_choice(self, data: dict):
        """تنفيذ اختيار قائمة الجرس — مستخرجة للاختبار بلا قوائم مودال."""
        from services import workflow_service as _wf
        if data.get("__all__"):
            _wf.mark_all_read()
            self._refresh_bell()
            return
        if data.get("__dismiss__"):
            from ui import style as _style
            if not _style.confirm(
                    self, "إخفاء كل التنبيهات النظامية الحالية؟\n"
                          "ستعود تلقائيًا إذا تغيّرت بياناتها.",
                    "إخفاء التنبيهات"):
                return
            texts = [a[1] for a in getattr(self.dashboard, "_alerts", [])]
            _wf.dismiss_alerts(texts)
            self.dashboard.refresh()
            self._refresh_bell()
            return
        if data.get("__restore__"):
            n = _wf.restore_dismissed_alerts()
            self.dashboard.refresh()
            self._refresh_bell()
            from ui import style as _style
            _style.info(self, f"تمت إعادة إظهار {n} تنبيهًا."
                        if n else "لا توجد تنبيهات مخفية.")
            return
        if data.get("__clear__"):
            from ui import style as _style
            if not _style.confirm(
                    self, "مسح كل إشعارات المتابعة (المقروءة وغير المقروءة)؟\nلا يمكن التراجع عن هذا الإجراء.",
                    "تصفية الإشعارات"):
                return
            n = _wf.clear_all_notifications()
            _style.info(self, f"تم مسح {n} إشعار."
                        if n else "لا توجد إشعارات مقروءة أو قديمة.")
            self._refresh_bell()
            return
        if data.get("__sys_all__"):
            self._go(IDX_DASHBOARD)
            return
        if data.get("__sys__"):
            extra = data.get("extra") or {}
            if extra.get("folder_customer_id"):
                self.dashboard._open_alert_folder(
                    extra["folder_customer_id"], extra.get("folder_path", ""))
            else:
                self._go(IDX_DASHBOARD)
            return
        try: _wf.mark_read(data["id"])
        except Exception: pass
        self._refresh_bell()
        self._open_notification_target(data)

    def _open_notification_target(self, data: dict):
        from services import workflow_service as _wf
        tx_type = data.get("transaction_type")
        tx_id = int(data.get("transaction_id") or 0)
        if not tx_id: return
        if tx_type == _wf.TX_CONTRACT:
            if not self._guard_perm("screen_customers"): return
            self.open_contract_hub(tx_id)
            self._refresh_bell()
        elif tx_type == _wf.TX_PAYMENT: self._go(IDX_PAYMENTS)
        elif tx_type == _wf.TX_SUBCONTRACT: self._go(IDX_SUBS)

    def _open_global_search(self):
        from ui.global_search import GlobalSearchDialog
        dlg = GlobalSearchDialog(self)
        dlg.result_chosen.connect(self._open_search_result)
        dlg.exec()

    def _open_search_result(self, rtype: str, rid: int):
        if rtype in ("customer", "contract", "project", "invoice") and not self._guard_perm("screen_customers"): return
        if rtype == "subcontractor" and not self._guard_perm("screen_subcontractors"): return
        if rtype == "voucher_receipt" and not self._guard_perm("screen_receipts"): return
        if rtype == "voucher_payment" and not self._guard_perm("screen_payments"): return
        
        if rtype == "customer":
            self._reveal_nav_button(IDX_DEALINGS)
            self.stack.setCurrentIndex(IDX_DEALINGS)
            self.dealings_page.refresh()
            self.open_customer_page(rid)
        elif rtype == "contract":
            self.open_contract_hub(rid)
        elif rtype == "project":
            from services import ui_data_service as ui_data
            contract_id = ui_data.first_contract_id_for_project(rid)
            if contract_id:
                self.open_contract_hub(contract_id)
        elif rtype == "subcontractor":
            self._reveal_nav_button(IDX_SUBS)
            self.stack.setCurrentIndex(IDX_SUBS)
            self.subs_page.refresh()
        elif rtype in ("voucher_receipt", "voucher_payment"):
            v = lc.get_voucher(rid)
            if v:
                from ui.glass_receipt import GlassReceiptDialog
                GlassReceiptDialog(self, {"number": v["voucher_number"], "date": v["vdate"], "party": v["party"], "description": v["description"], "contract_number": v.get("contract_number"), "amount": float(v["amount"]), "vtype": v["vtype"], "raw": v}).exec()
        elif rtype == "invoice":
            from services import invoice_service
            inv = invoice_service.get_invoice(rid)
            if inv:
                from ui.glass_receipt import GlassReceiptDialog
                GlassReceiptDialog(self, {"number": inv.invoice_number, "date": inv.invoice_date, "party": inv.customer_name, "description": inv.description, "contract_number": inv.contract_number, "amount": float(inv.amount), "vtype": "invoice", "invoice_obj": inv}).exec()

    def _apply_theme(self, theme_key: str = "light"):
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance()
        if app:
            app.setStyleSheet(style.apply_theme())
        self.centralWidget().update()
        self._refresh_all()

    def _toggle_sidebar(self):
        """طي/توسيع الشريط الجانبي — عرضي فقط.

        الطي: عرض 64 + أيقونات فقط + تلميحات بالأسماء + إخفاء
        نصوص الهوية. التوسيع: استعادة كاملة + مزامنة أسهم
        المجموعات. التنقل والصلاحيات والمجموعات لا تُمس.
        """
        bar = getattr(self, "_sidebar", None)
        if bar is None:
            return
        collapsed = not getattr(self, "_sidebar_collapsed", False)
        self._sidebar_collapsed = collapsed
        scale = getattr(self, "_sidebar_scale", 1.0)
        if collapsed:
            self._sidebar_texts = {}
            self._sidebar_tips = set()
            for btn in bar.findChildren(QPushButton):
                if not btn.text():
                    continue
                self._sidebar_texts[btn] = btn.text()
                btn.setText(btn.text().split("  ")[0])
                if not btn.toolTip():
                    tip = self._sidebar_texts[btn].replace("  ", " ")
                    tip = tip.replace("⌄", "").replace("⌃", "").strip()
                    btn.setToolTip(tip)
                    self._sidebar_tips.add(btn)
            bar.setFixedWidth(int(72 * scale))
            bar.setProperty("collapsed", True)
            self._sidebar_toggle.setText("<<")
            self._sidebar_toggle.setToolTip("توسيع الشريط الجانبي")
        else:
            for btn, text in self._sidebar_texts.items():
                try:
                    btn.setText(text)
                except RuntimeError:
                    pass
            for btn in self._sidebar_tips:
                try:
                    btn.setToolTip("")
                except RuntimeError:
                    pass
            self._sidebar_texts = {}
            self._sidebar_tips = set()
            bar.setProperty("collapsed", False)
            self._fit_sidebar_width()
            for _n, _gb in self._group_btns.items():
                _box = self._group_boxes.get(_n)
                _ic = _gb.text().split("  ")[0]
                _ar = "⌃" if (_box is not None and _box.isVisible()) else "⌄"
                _gb.setText(f"{_ic}  {_n}   {_ar}")
            self._sidebar_toggle.setText(">>")
            self._sidebar_toggle.setToolTip("طي الشريط الجانبي")
        for attr in ("app_title_lbl", "app_subtitle_lbl"):
            w = getattr(self, attr, None)
            if w is not None:
                w.setVisible(not collapsed)
        try:
            for w in [bar, *bar.findChildren(QWidget)]:
                bar.style().unpolish(w)
                bar.style().polish(w)
        except Exception:
            pass

    def _refresh_crumb(self, index: int):
        """تحديث مسار التنقل في الشريط العلوي — عرضي فقط."""
        lbl = getattr(self, "crumb_lbl", None)
        if lbl is None:
            return
        if index >= 1000:
            text = getattr(self, "_report_crumbs", {}).get(
                index - 1000, "التقارير")
        else:
            text = getattr(self, "_crumbs", {}).get(index, "")
            if not text:
                try:
                    cf = getattr(self, "customer_file_page", None)
                    if cf is not None and self.stack.indexOf(cf) == index:
                        text = "ملف العميل"
                except Exception:
                    pass
        if not text:
            return
        if " › " in text:
            parent, _, child = text.partition(" › ")
            lbl.setText(f"{parent} › <b>{child}</b>")
        else:
            lbl.setText(text)

    def _toggle_group(self, name: str, icon: str):
        box = self._group_boxes.get(name)
        btn = self._group_btns.get(name)
        if box is None or btn is None: return
        show = not box.isVisible()
        box.setVisible(show)
        arrow = "⌃" if show else "⌄"
        if getattr(self, "_sidebar_collapsed", False):
            btn.setText(icon)
        else:
            btn.setText(f"{icon}  {name}   {arrow}")
        self._fit_sidebar_width()

    def _guard_perm(self, perm: str, msg: str = "هذه الشاشة غير متاحة لحسابك.") -> bool:
        from services import auth_service as _auth
        if _auth.has_permission(perm): return True
        style.toast(self, msg)
        return False

    def _navigate(self, index: int):
        if index == IDX_SETTLEMENTS:
            # V3.9: رابط عميق — صفحة العهد الموحدة على قسم التصفيات
            from services import auth_service as _auth
            if not _auth.has_permission("screen_payments"):
                style.toast(self, "هذه الشاشة غير متاحة لحسابك.")
                return
            self._navigate(IDX_CUSTODY)
            try:
                self.custody_page.show_section("settlements")
            except Exception:
                pass
            try:
                if getattr(self, "crumb_lbl", None) is not None:
                    self.crumb_lbl.setText(
                        self._crumbs.get(IDX_SETTLEMENTS, ""))
            except Exception:
                pass
            return
        target = IDX_REPORTS if index >= 1000 else index
        perm = PAGE_PERMS.get(target)
        if target == IDX_CUSTODY:
            perm = "screen_payments"
        if perm and index < 1000:
            from services import auth_service as _auth
            if not _auth.has_permission(perm):
                style.toast(self, "هذه الشاشة غير متاحة لحسابك.")
                return
        self.stack.setUpdatesEnabled(False)
        try:
            if 0 <= index < self.stack.count():
                self._ensure_page(index)
            cur = self.stack.currentIndex()
            if (not getattr(self, "_suppress_history", False) and cur != index
                    and 0 <= cur < self.stack.count()):
                self._nav_history.append(cur)
            if index >= 1000:
                self._ensure_page(IDX_REPORTS)
                self.stack.setCurrentIndex(IDX_REPORTS)
                self.reports_page.open_report(index - 1000)
                self._refresh_crumb(index)
                return
            self.stack.setCurrentIndex(index)
            if index == IDX_REPORTS:
                self.reports_page.show_cards()
            self._refresh_page(index)
        finally:
            self.stack.setUpdatesEnabled(True)
            self.stack.update()

    #: مهلة لا يُعاد فيها تحميل الصفحة عند التنقل السريع ذهابًا وإيابًا
    _PAGE_REFRESH_TTL = 8.0

    def _refresh_page(self, index: int):
        """تحديث الصفحة عند فتحها — مع تفادي إعادة التحميل الفوري.

        كان كل دخول لصفحة يعيد تحميل بياناتها كاملة، فالتنقل السريع
        (عملاء ← رئيسية ← عملاء) يعني قراءات متكررة من القاعدة
        المشتركة بلا داعٍ. الآن نتخطى التحديث إن كانت الصفحة حُدِّثت
        قبل ثوانٍ قليلة فقط. أي حفظ أو تعديل يمسح الطابع فورًا عبر
        ``_schedule_refresh_all`` فتبقى البيانات صحيحة دائمًا.
        """
        page = self.stack.widget(index)
        if not hasattr(page, "refresh"):
            return
        import time as _t
        stamps = getattr(self, "_page_refreshed_at", None)
        if stamps is None:
            stamps = {}
            self._page_refreshed_at = stamps
        now = _t.monotonic()
        last = stamps.get(index, 0.0)
        if last and (now - last) < self._PAGE_REFRESH_TTL:
            return
        page.refresh()
        stamps[index] = now

    def _schedule_refresh_all(self):
        """تجميع التحديثات تلقائيًا لتخفيف ضغط الشبكة بعد الحفظ.

        إذا حدثت عدة عمليات متتالية خلال أقل من ثانية، ننفذ تحديثًا عامًا
        واحدًا بدل عدة قراءات متكررة من قاعدة البيانات المشتركة.
        """
        try:
            self._refresh_timer.start()
        except Exception:
            self._refresh_all()

    def _refresh_all(self):
        # أي تغيير في البيانات يبطل طوابع الصفحات فتُحدَّث عند فتحها
        try:
            self._page_refreshed_at = {}
            from services import folder_service as _fsrv
            _fsrv.clear_folder_cache()
        except Exception:
            pass
        try: lc.auto_archive_expired()
        except Exception: pass
        self.dashboard.refresh()
        self.tasks_page.refresh()
        self._refresh_bell()
        self._refresh_brand_identity()
        current = self.stack.currentWidget()
        if current is not self.dashboard and hasattr(current, "refresh"):
            try: current.refresh()
            except Exception: pass

    def _refresh_user_badge(self):
        from services import auth_service as _auth
        role_label = _auth.ROLE_LABELS.get(_auth.current_role(), "")
        name = _auth.display_name()
        title = _auth.current_job_title()
        self.user_badge.setText(f"{name} · {title or role_label}")
        self.user_badge.setToolTip(f"اسم الدخول: {_auth.current_username()}\nالصلاحية: {role_label}\n(اضغط لخيارات الحساب)")

    def _open_activity_source(self, contract_id: int, customer_id: int):
        if contract_id:
            if not self._guard_perm("screen_customers"): return
            self.open_contract_hub(contract_id)
        elif customer_id:
            self.open_customer_page(customer_id)

    def _handle_user_action(self, action: str):
        {"profile": self._edit_profile, "password": self._open_settings_security, "logout": self._logout}.get(action, lambda: None)()

    def _edit_profile(self):
        from PySide6.QtWidgets import QDialog, QFormLayout, QHBoxLayout, QLineEdit, QPushButton
        from services import auth_service as _auth
        user = _auth.get_user(_auth.current_username())
        if not user:
            style.error(self, "تعذر قراءة بيانات الحساب الحالي.")
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("بيانات الموظف")
        dlg.setLayoutDirection(Qt.RightToLeft)
        dlg.setMinimumWidth(400)
        form = QFormLayout(dlg)
        form.setSpacing(10)
        name = QLineEdit(user.get("full_name") or "")
        name.setPlaceholderText("مثال: أحمد عبدالله")
        job = QLineEdit(user.get("job_title") or "")
        job.setPlaceholderText("مثال: محاسب · سكرتير · مدير المشاريع")
        login_lbl = QLabel(user["username"])
        login_lbl.setProperty("hint", True)
        form.addRow("اسم الدخول", login_lbl)
        form.addRow("اسم الموظف", name)
        form.addRow("المسمى الوظيفي", job)
        row = QHBoxLayout()
        ok = QPushButton("💾 حفظ")
        ok.setObjectName("btnPrimary")
        cancel = QPushButton("✕ إلغاء")
        cancel.setProperty("flat", True)
        ok.clicked.connect(dlg.accept)
        cancel.clicked.connect(dlg.reject)
        row.addStretch()
        row.addWidget(ok)
        row.addWidget(cancel)
        form.addRow(row)
        if dlg.exec() != QDialog.Accepted: return
        try:
            _auth.set_user_identity(user["id"], name.text(), job.text())
        except Exception as exc:
            style.error(self, f"تعذر حفظ البيانات:\n{exc}")
            return
        self._refresh_user_badge()
        style.toast(self, "تم حفظ بيانات الموظف")

    def _open_settings_security(self):
        if not self._guard_perm("screen_settings"): return
        try:
            idx = IDX_SETTINGS
            self._reveal_nav_button(idx)
            self._ensure_page(idx)
            self.stack.setCurrentIndex(idx)
            for i in range(self.settings_page.tabs.count()):
                txt = self.settings_page.tabs.tabText(i)
                if "الأمان" in txt or "كلمة المرور" in txt:
                    self.settings_page.tabs.setCurrentIndex(i)
                    break
        except Exception:
            style.info(self, "افتح الإعدادات ثم تبويب «الأمان والمستخدمون».")

    def _logout(self):
        if not style.confirm(self, "تسجيل الخروج والعودة لشاشة الدخول؟", "تسجيل الخروج"): return
        self.logout_requested = True
        self.close()

    def closeEvent(self, event):
        try: app_name = settings_service.app_name()
        except Exception: app_name = "البرنامج"
        if getattr(self, "logout_requested", False):
            try:
                from services.backup_service import run_auto_backup
                run_auto_backup(force=True)
            except Exception: pass
            event.accept()
            super().closeEvent(event)
            return
        if not style.confirm(self, f"هل تريد إغلاق {app_name}؟\n\nسيتم أخذ نسخة احتياطية تلقائية قبل الإغلاق.", "تأكيد الإغلاق"):
            event.ignore()
            return
        try:
            from services.backup_service import run_auto_backup
            run_auto_backup(force=True)
        except Exception: pass
        event.accept()
        super().closeEvent(event)

    def _open_statement(self, customer_id: int):
        idx = IDX_STATEMENT
        self._reveal_nav_button(idx)
        # الإنشاء قبل العرض: الصفحات كسولة وأول فتح كان يعرض holder فارغًا
        self._ensure_page(idx)
        self.stack.setCurrentIndex(idx)
        self.statement_page.select_customer(customer_id)

    def _open_statement_sub(self, sub_id: int):
        """V5.4: كشف حساب مقاول باطن من الزر الأيمن على الشجرة."""
        idx = IDX_STATEMENT
        self._reveal_nav_button(idx)
        self._ensure_page(idx)
        self.stack.setCurrentIndex(idx)
        self.statement_page.select_subcontractor(sub_id)
