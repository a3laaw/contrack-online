"""الجدول الموحّد «العميل ⇄ المقاول» لدفعات عقد الباطن.

يُستخدم في شاشتين بنفس الشكل والمنطق:
  • شاشة العقد (ui/contract_hub.py) — كتلة لكل مقاول.
  • شاشة المقاول (ui/subcontractor_page.py) — جدول عقد الباطن المختار.

الدوال هنا نُقلت حرفيًا من دالة `_pay_fill` في شاشة العقد، مع تمرير
ما كانت تأخذه من المتغيرات المغلقة كمعاملات، حتى لا يتغيّر الشكل.
"""
from __future__ import annotations

import re

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (QHeaderView, QStyledItemDelegate,
                               QTableWidget, QTableWidgetItem)

from ui import style


def short_status(text: str) -> str:
    """اختصار أسماء الحالات الطويلة لعرضها كشارة صغيرة."""
    return {"بانتظار إنجاز المرحلة": "انتظار",
            "بانتظار المرحلة": "انتظار",
            "⚠ بلا مصدر": "بلا مصدر",
            "مستحقة": "مستحقّة",
            "غير مستحقة": "غير مستحقّة",
            "مغلقة": "مغلقة",
            "محصّلة": "محصّلة",
            "مدفوعة": "مدفوعة"}.get(text, text)


def _cell(text, color=None, bold=False, tip="", align=None, bg=None):
    """خلية نصية بتنسيق موحّد (نفس دالة `_item` الأصلية)."""
    it = QTableWidgetItem("" if text is None else str(text))
    if tip:
        it.setToolTip(tip)
    it.setTextAlignment(align if align is not None
                        else (Qt.AlignCenter))
    if color:
        it.setForeground(QColor(color))
    if bold:
        f = it.font()
        f.setBold(True)
        it.setFont(f)
    if bg:
        it.setBackground(QColor(bg))
    return it


# ── V8.9: Delegate خفيف لشريط التقدم تحت المسدّد ─────────────
class ProgressDelegate(QStyledItemDelegate):
    """يرسم شريط تقدم 3px تحت النص في خلايا المسدّد."""
    def __init__(self, table, parent=None):
        super().__init__(parent)
        self._t = table

    def paint(self, painter, option, index):
        from PySide6.QtGui import QPainter, QColor
        from PySide6.QtCore import QRectF
        super().paint(painter, option, index)
        c = index.column()
        if c not in (3, 7):
            return
        r = index.row()
        nc = self._t.rowCount()
        if r >= nc - 1:
            return  # صف الإجمالي
        # نقرأ المبلغ والمسدّد من الخلايا
        amt_c = 2 if c == 3 else 6
        amt_txt = self._t.item(r, amt_c).text() if self._t.item(r, amt_c) else ""
        paid_txt = index.data() or ""
        try:
            amt = float(amt_txt.replace(",", "").strip() or 0)
            paid = float(paid_txt.replace(",", "").strip() or 0)
        except Exception:
            return
        if amt <= 0:
            return
        ratio = min(paid / amt, 1.0)
        if ratio <= 0:
            return
        bar_h = 3
        bar_rect = QRectF(
            option.rect.x() + 2,
            option.rect.bottom() - bar_h - 1,
            (option.rect.width() - 4) * ratio,
            bar_h)
        painter.save()
        painter.setRenderHint(QPainter.Antialiasing)
        color = QColor("#10B981") if ratio >= 0.999 else QColor("#F59E0B")
        painter.setBrush(color)
        painter.setPen(Qt.NoPen)
        painter.drawRoundedRect(bar_rect, 1, 1)
        painter.restore()

def fmt_num(x):
    """=format الأرقام: بلا كسور صفرية، الصفر = —."""
    try:
        v = float(x or 0)
    except Exception:
        return "—"
    if abs(v) < 0.001:
        return "—"
    if abs(v - int(v)) < 0.001:
        return f"{int(v):,}"
    return f"{v:,.3f}"

def status_pill(text, full_text):
    """شارة حالة pill."""
    it = QTableWidgetItem(short_status(text))
    it.setTextAlignment(Qt.AlignCenter)
    it.setToolTip(full_text)
    col = style.status_color(full_text, style.MUTED)
    if col:
        it.setForeground(QColor(col))
    f = it.font()
    f.setBold(True)
    f.setPointSize(max(f.pointSize() - 2, 9))
    it.setFont(f)
    return it

def clean_title(title, no=None):
    """نظّف البادئة الرقمية المكررة من عنوان الدفعة."""
    t = (title or "").strip()
    if no:
        # أزل "1." أو "1 -" أو "1-" من البداية
        import re
        t = re.sub(rf"^{no}\s*[\.\-–]\s*", "", t).strip()
    return t or (f"دفعة {no}" if no else "—")


def build_unified_table(*, plan_by_id, client_no, shared_ids, c_name, sub_name, lines, src, nums,
                        sub_cancelled=False):
    """الجدول الموحّد (V9.1): 9 أعمدة — المرحلة | عميل 4 | مقاول 4."""
    # ربط دفعات المقاول بدفعة العميل
    # V9.15.15: كل خط مقاول يظهر مرة واحدة، تحت أول دفعة عميل مرتبطة به
    # (حسب ترتيب الجدول). كل دفعة عميل تُعرض في صف لكل خط مقاول عليها.
    assign = {}
    for ln in lines:
        _cands = []
        for _s in (src.get(int(ln["id"])) or []):
            try:
                _s = int(_s)
            except (TypeError, ValueError):
                continue
            if _s in client_no:
                _cands.append(_s)
        if _cands:
            assign[int(ln["id"])] = min(_cands, key=lambda x: client_no[x])
    _sub_seq = {}
    for _si, ln in enumerate(lines, 1):
        _sub_seq[int(ln["id"])] = _si
    # الصفوف: (معرّف دفعة العميل, خط المقاول, هل تُعرض خانة العميل في هذا الصف)
    pairs = []
    for x in nums:
        _subs = [ln for ln in lines if assign.get(int(ln["id"])) == x]
        if not _subs:
            pairs.append((x, None, True))
            continue
        for _k, ln in enumerate(_subs):
            pairs.append((x, ln, _k == 0))
    for ln in lines:
        if int(ln["id"]) not in assign:
            pairs.append((None, ln, False))

    NC = 9
    t = QTableWidget(0, NC)
    t.setHorizontalHeaderLabels([""] * NC)
    t.verticalHeader().setVisible(False)
    t.setEditTriggers(QTableWidget.NoEditTriggers)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    t.setSelectionMode(QTableWidget.SingleSelection)
    t.setAlternatingRowColors(False)
    t.setWordWrap(True)
    t.horizontalHeader().setVisible(False)
    t.setShowGrid(True)

    # أحجام الأعمدة — V9.1: المرحلة/البند أكبر + الباقي يمتد
    from PySide6.QtWidgets import QHeaderView as _QHV
    hh = t.horizontalHeader()
    # البند/المرحلة: stretch يأخذ المساحة المتبقية
    hh.setSectionResizeMode(0, _QHV.Stretch)
    t.setColumnWidth(0, 220)   # عرض ابتدائي للبند
    # العميل — أعمدة ثابتة
    for c in (1, 2, 3, 4):
        hh.setSectionResizeMode(c, _QHV.Fixed)
    t.setColumnWidth(1, 150)   # الدفعة — عميل
    t.setColumnWidth(2, 100)   # المبلغ — عميل
    t.setColumnWidth(3, 100)   # المسدّد — عميل
    t.setColumnWidth(4, 80)    # الحالة — عميل
    # المقاول — أعمدة ثابتة
    for c in (5, 6, 7, 8):
        hh.setSectionResizeMode(c, _QHV.Fixed)
    t.setColumnWidth(5, 150)   # الدفعة — مقاول
    t.setColumnWidth(6, 100)   # المبلغ — مقاول
    t.setColumnWidth(7, 100)   # المسدّد — مقاول
    t.setColumnWidth(8, 80)    # الحالة — مقاول
    hh.setMinimumSectionSize(70)

    # Delegate لشريط التقدم
    t.setItemDelegate(ProgressDelegate(t))

    # فصل بصري بحدود واضحة بين الأقسام الثلاثة
    t.setStyleSheet("""
        QTableWidget {
            gridline-color: #CBD5E1;
            border: 1px solid #CBD5E1;
        }
        QTableWidget::item {
            border-bottom: 1px solid #E2E8F0;
            padding: 2px 4px;
        }
    """)

    t.setRowCount(len(pairs) + 3)  # رأس المجموعات + رأس العناوين + الصفوف + إجمالي
    money_align = Qt.AlignRight | Qt.AlignVCenter

    # ── 1) صف مجموعات الأعمدة ──
    _head_font_sz = 13

    # البند/المرحلة (col 0)
    it_stage = QTableWidgetItem("البند")
    f_stg = it_stage.font()
    f_stg.setPointSize(_head_font_sz)
    f_stg.setWeight(QFont.Weight.Medium)
    it_stage.setFont(f_stg)
    it_stage.setForeground(QColor("#475569"))
    it_stage.setBackground(QColor("#F1F5F9"))
    t.setItem(0, 0, it_stage)

    # العميل (cols 1-4)
    cli_title = f"👤 العميل · {c_name or '—'}"
    it_cli = QTableWidgetItem(cli_title)
    f_cli = it_cli.font()
    f_cli.setPointSize(_head_font_sz)
    f_cli.setWeight(QFont.Weight.Medium)
    it_cli.setFont(f_cli)
    it_cli.setForeground(QColor("#1E40AF"))
    it_cli.setToolTip(cli_title)
    t.setItem(0, 1, it_cli)
    t.setSpan(0, 1, 1, 4)

    # المقاول (cols 5-8)
    sub_title = f"🔨 المقاول · {sub_name}" if sub_name else "🔨 المقاول — (غير مرتبط)"
    it_sub = QTableWidgetItem(sub_title)
    f_sub = it_sub.font()
    f_sub.setPointSize(_head_font_sz)
    f_sub.setWeight(QFont.Weight.Medium)
    it_sub.setFont(f_sub)
    it_sub.setForeground(QColor("#92400E"))
    it_sub.setToolTip(sub_title)
    t.setItem(0, 5, it_sub)
    t.setSpan(0, 5, 1, 4)

    # خلفية صف المجموعات
    for _c in range(NC):
        _ci = t.item(0, _c)
        if _ci is None:
            _ci = QTableWidgetItem("")
            t.setItem(0, _c, _ci)
        if _c == 0:
            _ci.setBackground(QColor("#F1F5F9"))  # رمادي — البند
        elif _c < 5:
            _ci.setBackground(QColor("#EFF6FF"))  # أزرق — العميل
        else:
            _ci.setBackground(QColor("#FFFBEB"))  # أصفر — المقاول

    # ── 2) صف رؤوس الأعمدة ──
    _heads = ["المرحلة/البند",
               "الدفعة", "المبلغ", "المسدّد", "الحالة",
               "الدفعة", "المبلغ", "المسدّد", "الحالة"]
    for _c, _h in enumerate(_heads):
        _hi = QTableWidgetItem(_h)
        _hf = _hi.font()
        _hf.setPointSize(11)
        _hi.setFont(_hf)
        _hi.setForeground(QColor(style.MUTED))
        _hi.setTextAlignment(Qt.AlignCenter)
        if _c == 0:
            _hi.setBackground(QColor("#E2E8F0"))  # رمادي — البند
        elif _c < 5:
            _hi.setBackground(QColor("#DBEAFE"))  # أزرق — العميل
        else:
            _hi.setBackground(QColor("#FEF3C7"))  # أصفر — المقاول
        t.setItem(1, _c, _hi)
    t.setRowHeight(1, 28)

    # ── 3) الصفوف ──
    c_tot = c_paid = s_tot = s_paid = 0.0
    for idx, (clid, ln, show_c) in enumerate(pairs):
        r = idx + 2
        t.setRowHeight(r, 36)

        # البند/المرحلة (col 0)
        if clid is not None and clid in plan_by_id:
            it = plan_by_id[clid]
            stage_name = it.get("stage_name") or "—"
        elif ln is not None:
            stage_name = ln.get("stage_name") or "—"
        else:
            stage_name = "—"
        _si = QTableWidgetItem(stage_name)
        _si.setToolTip(stage_name)
        _si.setBackground(QColor("#F8FAFC"))  # خلفية فاتحة للبند
        f_si = _si.font()
        f_si.setPointSize(10)
        _si.setFont(f_si)
        t.setItem(r, 0, _si)

        # عميل (cols 1-4) — تُعرض وتُحسب مرة واحدة لكل دفعة عميل
        if show_c and clid is not None and clid in plan_by_id:
            it = plan_by_id[clid]
            amt = float(it.get("amount") or 0)
            paid = float(it.get("covered") or 0)
            st = it.get("status") or "—"
            c_tot += amt
            c_paid += paid
            _c_no = client_no.get(clid, "")
            _c_title = clean_title(it.get("title") or "", _c_no)
            _tip_c = f"{_c_no}. {_c_title}" if _c_no else _c_title
            if clid in shared_ids:
                _tip_c += " · مشتركة"
            _lbl = f"{_c_no}. {_c_title}" if _c_no else _c_title
            t.setItem(r, 1, _cell(_lbl, tip=_tip_c))
            t.setItem(r, 2, _cell(fmt_num(amt), align=money_align))
            t.setItem(r, 3, _cell(fmt_num(paid), align=money_align))
            t.setItem(r, 4, status_pill(st, st))
        else:
            for _c in (1, 2, 3):
                t.setItem(r, _c, _cell("", style.MUTED, align=money_align))
            t.setItem(r, 4, _cell("", style.MUTED))

        # مقاول (cols 5-8)
        if ln is not None:
            _l_amt = float(ln.get("amount") or 0)
            _l_paid = float(ln.get("covered") or 0)
            _l_st = ln.get("status") or "—"
            if sub_cancelled:
                # عقد الباطن ملغى: تظهر خطوطه بحالة «ملغى» ولا تدخل الإجماليات
                _l_st = "ملغى"
            else:
                s_tot += _l_amt
                s_paid += _l_paid
            _s_no = _sub_seq.get(int(ln["id"]), "")
            _s_title = clean_title(ln.get("title") or "", _s_no)
            _lbl_s = f"{_s_no}. {_s_title}" if _s_no else _s_title
            t.setItem(r, 5, _cell(_lbl_s, tip=_lbl_s))
            t.setItem(r, 6, _cell(fmt_num(_l_amt), align=money_align))
            t.setItem(r, 7, _cell(fmt_num(_l_paid), align=money_align))
            t.setItem(r, 8, status_pill(_l_st, _l_st))
        else:
            for _c in (5, 6, 7):
                t.setItem(r, _c, _cell("", style.MUTED, align=money_align))
            t.setItem(r, 8, _cell("", style.MUTED))

    # ── 4) صف الإجمالي ──
    _tr = len(pairs) + 2
    t.setRowHeight(_tr, 32)
    # البند
    _tot_stg = QTableWidgetItem("الإجمالي")
    _tf = _tot_stg.font()
    _tf.setWeight(QFont.Weight.Medium)
    _tot_stg.setFont(_tf)
    _tot_stg.setBackground(QColor("#E2E8F0"))
    t.setItem(_tr, 0, _tot_stg)
    # العميل
    for _c in range(1, 5):
        _ci = t.item(_tr, _c)
        if _ci is None:
            _ci = QTableWidgetItem("")
            t.setItem(_tr, _c, _ci)
        _ci.setBackground(QColor("#EFF6FF"))
        f = _ci.font()
        f.setWeight(QFont.Weight.Medium)
        _ci.setFont(f)
    t.setItem(_tr, 2, _cell(fmt_num(c_tot), style.TEXT, True, align=money_align))
    t.setItem(_tr, 3, _cell(fmt_num(c_paid), style.TEXT, True, align=money_align))
    # المقاول
    for _c in range(5, 9):
        _ci = t.item(_tr, _c)
        if _ci is None:
            _ci = QTableWidgetItem("")
            t.setItem(_tr, _c, _ci)
        _ci.setBackground(QColor("#FFFBEB"))
        f = _ci.font()
        f.setWeight(QFont.Weight.Medium)
        _ci.setFont(f)
    t.setItem(_tr, 6, _cell(fmt_num(s_tot), style.TEXT, True, align=money_align))
    t.setItem(_tr, 7, _cell(fmt_num(s_paid), style.TEXT, True, align=money_align))

    return t, c_tot, c_paid, s_tot, s_paid


def build_items_table(mine_ids, item_by_id):
    """بنود العقد المرتبطة بعقد الباطن (نُقل من شاشة العقد بلا تغيير في الشكل).

    يُعيد (نص العنوان, الجدول أو None, الإجمالي).
    """
    mine = sorted(int(x) for x in (mine_ids or []))
    if not mine:
        return None, None, 0.0
    rows = []
    tot = 0.0
    for bid in mine:
        it = item_by_id.get(int(bid))
        if it is None:
            continue
        q = float(it.get("qty") or 0)
        up = float(it.get("unit_price") or 0)
        t_ = float(it.get("total") if it.get("total") is not None
                   else q * up)
        tot += t_
        desc = it.get("description") or ""
        rows.append(f"{desc}  ·  {q:,.3f} {it.get('unit') or ''} × {up:,.3f} = {t_:,.3f}")
    text = f"📋 بنود العقد المرتبطة · {len(mine)} بند · إجمالي {tot:,.3f} د.ك"
    t = QTableWidget(len(rows), 1)
    t.setHorizontalHeaderLabels(["البند"])
    t.verticalHeader().setVisible(False)
    t.setEditTriggers(QTableWidget.NoEditTriggers)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    t.setWordWrap(True)
    t.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
    t.setStyleSheet("""
        QTableWidget {
            alternate-background-color: #FEF3C7;
            background-color: #FFFBEB;
            font-size: 12px;
        }
        QHeaderView::section {
            background: #FDE68A;
            color: #92400E;
            font-weight: 700;
            padding: 4px;
            border: 1px solid #F59E0B;
        }
    """)
    for r, desc in enumerate(rows):
        it = QTableWidgetItem(desc)
        it.setToolTip(desc)
        t.setItem(r, 0, it)
        t.setRowHeight(r, 28)
    return text, t, tot


def shared_client_line_ids(contract_id) -> set:
    """أرقام دفعات العميل المغذّاة لأكثر من عقد باطن (تُوسم «مشتركة»)."""
    try:
        from database.database import get_connection
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT s.cust_line_id AS clid, sp.sub_contract_id AS scid "
                "FROM sub_payment_sources s "
                "JOIN sub_payment_plan sp ON sp.id = s.sub_line_id "
                "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
                "WHERE sc.contract_id = ?", (int(contract_id),)).fetchall()
        by = {}
        for r in rows:
            by.setdefault(int(r["clid"]), set()).add(int(r["scid"]))
        return {x for x, scs in by.items() if len(scs) > 1}
    except Exception:
        return set()


def linked_client_numbers(lines, src, client_no) -> list:
    """أرقام دفعات العميل المرتبطة بدفعات عقد الباطن، مرتبة كما في الشاشة."""
    nums = []
    for ln in lines:
        for _s in (src.get(int(ln["id"])) or []):
            try:
                _s = int(_s)
            except (TypeError, ValueError):
                continue
            if _s in client_no and _s not in nums:
                nums.append(_s)
    nums.sort(key=lambda x: client_no.get(x, 0))
    return nums


def sub_contract_data(contract_id, sc_id):
    """كل ما تحتاجه كتلة عقد باطن واحد (نفس مصادر شاشة العقد).

    تُستخدم من شاشة المقاول. تُعيد dict بالمفاتيح:
    plan_by_id, client_no, shared_ids, lines, src, nums, item_by_id,
    mine_ids, sub_name.
    """
    from database.database import get_connection
    from services import lifecycle_service as lc

    cid = int(contract_id)
    sid = int(sc_id)
    plan = [dict(x) for x in lc.contract_payment_plan(cid)]
    client_no = {int(x["id"]): i for i, x in enumerate(plan, 1)}
    plan_by_id = {int(x["id"]): x for x in plan}
    try:
        items = [dict(x) for x in lc.list_boq(cid)]
    except Exception:
        items = []
    item_by_id = {int(x["id"]): x for x in items}

    lines = [dict(x) for x in lc.sub_payment_plan(sid)]
    try:
        src = lc.sub_source_ids(sid)
    except Exception:
        src = {}
    nums = linked_client_numbers(lines, src, client_no)

    sub_name = ""
    cancelled = False
    for s in lc.list_sub_contracts(contract_id=cid):
        if int(s["id"]) == sid:
            sub_name = (s.get("sub_name") or "").strip()
            cancelled = (s.get("status") or "") == "ملغى"
            break

    mine_ids = set()
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT boq_item_id AS bid FROM sub_contract_items "
                "WHERE sub_contract_id = ? AND boq_item_id IS NOT NULL",
                (sid,)).fetchall()
        mine_ids = {int(r["bid"]) for r in rows}
    except Exception:
        mine_ids = set()

    return {
        "plan_by_id": plan_by_id,
        "client_no": client_no,
        "shared_ids": shared_client_line_ids(cid),
        "lines": lines,
        "src": src,
        "nums": nums,
        "item_by_id": item_by_id,
        "mine_ids": mine_ids,
        "sub_name": sub_name,
        "cancelled": cancelled,
    }
