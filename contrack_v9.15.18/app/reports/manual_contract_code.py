# -*- coding: utf-8 -*-
"""
============================================================
كود العقود اليدوية — ConTrack V8.2
============================================================

هذا الملف يحتوي على كل الأكواد المتعلقة بالعقود اليدوية (manual_track=1)
في عقد العميل وعقد مقاول الباطن.

المحتويات:
  1. كيفية تحديد نوع العقد (يدوي/تلقائي)
  2. سياسة إخفاء/إظهار صندوق البنود
  3. تحميل البنود/الدفعات للعقود اليدوية
  4. عرض الجدول حسب نوع العقد
  5. بناء الدفعات من العناصر المحددة
  6. العدّاد والمجموع

============================================================
"""

# ============================================================
# 1. من ui/contracts.py — تحديد نوع العقد (يدوي/تلقائي)
# ============================================================
# السطر 830-846

def _auto_plan_ui(self) -> bool:
    """V4.5.13: نوع «تلقائي» (له قالب مراحل وليس مسارًا يدويًا).

    نفس القاعدة: ليس يدويًا وليس شاملًا، وله شجرة مراحل فعلية.
    النوع اليدوي يبقى كما هو (اختيار كامل/جزء).
    """
    try:
        _cfg13 = _cts.type_config(self.ctype.currentData() or "")
        if _cfg13.get("manual_track") or _cfg13.get("is_bundle"):
            return False   # اليدوي والشامل يبقيان كما هما (قرار 2026-10-05)
        return bool(_wf.get_stages(_wf.TX_CONTRACT,
                                   self.ctype.currentData() or ""))
    except Exception:
        return False


# ============================================================
# 2. من services/contract_type_service.py — إعدادات النوع
# ============================================================
# السطر 52-71

def type_config(name: str) -> dict:
    """إعدادات نوع العقد."""
    DEFAULT = {"name": "", "manual_track": False, "is_bundle": False,
               "is_supervision": False}
    if not (name or "").strip():
        return DEFAULT
    with get_connection() as conn:
        row = conn.execute(
            "SELECT name, is_supervision, manual_track FROM contract_types WHERE name=?",
            (name,)).fetchone()
    if not row:
        return DEFAULT
    return {"name": row["name"],
            "is_supervision": bool(row["is_supervision"]),
            "manual_track": bool(row["manual_track"])}


# ============================================================
# 3. من ui/subcontractors.py — سياسة إخفاء/إظهار صندوق البنود
# ============================================================
# السطر 242-275

def _apply_items_visibility(self, cid=None) -> bool:
    """V8.1: سياسة صندوق بنود عقد العميل.

    · عقد تلقائي (قالب مراحل/دفعات) **بلا بنود** ⇒ يُخفى الصندوق كاملًا
      ويُكتفى بدفعات عقد الباطن.
    · عقد يدوي له قالب ⇒ يبقى ظاهرًا (المستخدم يختار البنود يدويًا).
    · عقد تلقائي له بنود فعلية ⇒ يبقى ظاهرًا.
    · غير ذلك ⇒ ظاهر دائمًا.

    تُرجع: هل العقد له قالب (تلقائي أو يدوي)؟
    """
    auto = self._client_contract_auto(cid)
    templated = auto or self._client_contract_templated(cid)
    self._client_auto = auto
    # V8.1: يُخفى فقط للتلقائي بلا بنود — اليدوي يبقى ظاهر
    hide = bool(auto and not getattr(self, "_items", None))
    self._items_hidden = hide
    box = getattr(self, "items_box", None)
    if box is not None:
        box.setVisible(not hide)
    note = getattr(self, "items_hidden_note", None)
    if note is not None:
        note.setVisible(hide)
    pb = getattr(self, "plan_box", None)
    if pb is not None:
        _t = pb.title()
        if hide and "③" in _t:
            pb.setTitle(_t.replace("③", "②", 1))
        elif (not hide) and "②" in _t:
            pb.setTitle(_t.replace("②", "③", 1))
    if hide:
        self._chosen_ids = []
    return templated


# ============================================================
# 4. من ui/subcontractors.py — دوال تحديد نوع العقد
# ============================================================
# السطر 177-230

def _client_contract_auto(self, cid=None) -> bool:
    """هل عقد العميل من النوع «تلقائي» (له قالب مراحل/دفعات)؟

    نفس قاعدة شاشة العقد `_auto_plan_ui`: ليس يدويًا وليس شاملًا
    وليس «غير محدد»، وله شجرة مراحل فعلية.
    """
    try:
        if cid is None:
            cid = self._items_contract_id()
        if not cid:
            return False
        from services import contract_service as _cs
        from services import contract_type_service as _cts
        from services import workflow_service as _wf
        from services.contract_type_service import UNSPECIFIED
        con = _cs.get_contract(int(cid))
        tname = (getattr(con, "contract_type", "") or "").strip()
        if not tname or tname == UNSPECIFIED:
            return False
        cfg = _cts.type_config(tname)
        if cfg.get("manual_track") or cfg.get("is_bundle"):
            return False
        return bool(_wf.get_stages(_wf.TX_CONTRACT, tname))
    except Exception:
        return False


def _client_contract_templated(self, cid=None) -> bool:
    """V5.3: هل نوع عقد العميل له قالب مراحل/دفعات (تلقائي أو يدوي)؟

    شاشة العقد تُخفي «بنود العقد» لأي نوع له قالب — فلا وجود لبنود
    على العقد، فيُكتفى في شاشة عقد الباطن بدفعات عقد الباطن بدل
    جدول فارغ ونص إرشادي مضلِّل. الشامل (bundle) مستثنى.
    """
    try:
        if cid is None:
            cid = self._items_contract_id()
        if not cid:
            return False
        from services import contract_service as _cs
        from services import contract_type_service as _cts
        from services import workflow_service as _wf
        from services.contract_type_service import UNSPECIFIED
        con = _cs.get_contract(int(cid))
        tname = (getattr(con, "contract_type", "") or "").strip()
        if not tname or tname == UNSPECIFIED:
            return False
        if _cts.type_config(tname).get("is_bundle"):
            return False
        return bool(_wf.get_stages(_wf.TX_CONTRACT, tname))
    except Exception:
        return False


# ============================================================
# 5. من ui/subcontractors.py — تحميل البنود/الدفعات
# ============================================================
# السطر 885-975 (V8.2)

def _reload_items(self, cid=None):
    """يعبّئ جدول بنود عقد العميل (V4.5.15: بلا جدول مختار منفصل).
    
    V8.2: للعقود اليدوية (قالب مراحل/دفعات) بلا بنود، يعرض الدفعات/المراحل
    من payment_plan بدل الجدول الفارغ.
    """
    import logging
    _log = logging.getLogger("subcontractors.items")
    if cid is None:
        cid = self.contract.selected_data()
    cid = int(cid) if cid else None
    changed_contract = (getattr(self, "_items_cid", None) != cid)
    if changed_contract:
        self._chosen_ids = []
    self._items_cid = cid
    self._items = []
    self._items_by_id = {}
    self._linked_other = {}
    self._items_error = None
    self._is_plan_mode = False  # V8.2: هل نعرض دفعات بدل بنود؟
    
    if cid:
        # ── قراءة البنود ──
        try:
            self._items = [dict(x) for x in lc.list_boq(cid)]
        except Exception as exc:
            _log.exception("list_boq failed for contract %s", cid)
            self._items = []
            self._items_error = str(exc)[:120]
        
        # V8.2: إذا لم توجد بنود في boq_items، نقرأ من payment_plan
        # (للعقود اليدوية فقط — التلقائي يبقى بلا بنود)
        if not self._items:
            try:
                from database.database import get_connection
                with get_connection() as conn:
                    # التحقق من نوع العقد
                    con = conn.execute(
                        "SELECT contract_type FROM contracts WHERE id=?",
                        (cid,)).fetchone()
                    if con:
                        ctype = (con[0] or "").strip()
                        # قراءة إعدادات النوع
                        type_row = conn.execute(
                            "SELECT manual_track FROM contract_types WHERE name=?",
                            (ctype,)).fetchone()
                        is_manual = bool(type_row and type_row[0])
                        
                        if is_manual:
                            # قراءة المراحل من payment_plan
                            plan_rows = conn.execute(
                                "SELECT pp.*, cs.name AS stage_name "
                                "FROM payment_plan pp "
                                "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
                                "WHERE pp.contract_id=? "
                                "ORDER BY pp.sort_order, pp.due_date",
                                (cid,)).fetchall()
                            
                            if plan_rows:
                                # تحويل المراحل إلى تنسيق البنود
                                self._items = []
                                for i, row in enumerate(plan_rows):
                                    r = dict(row)
                                    self._items.append({
                                        "id": r["id"],
                                        "description": r.get("title") or r.get("stage_name") or f"دفعة {i+1}",
                                        "qty": 1,
                                        "unit": "دفعة",
                                        "unit_price": float(r.get("amount") or 0),
                                        "total": float(r.get("amount") or 0),
                                        "stage_id": r.get("stage_id"),
                                        "due_date": r.get("due_date"),
                                        "notes": r.get("notes", ""),
                                        "_from_plan": True
                                    })
                                self._is_plan_mode = True
                                _log.info("Loaded %d payment plan items for manual contract %s",
                                         len(self._items), cid)
            except Exception as exc:
                _log.exception("Failed to load payment_plan items for contract %s", cid)
        
        # ── قراءة البنود المرتبطة بمقاول آخر ──
        # (فقط للبنود الحقيقية من boq_items، وليس للدفعات)
        if not getattr(self, "_is_plan_mode", False):
            try:
                from database.database import get_connection
                with get_connection() as conn:
                    rows = conn.execute(
                        "SELECT si.boq_item_id, s.name FROM sub_contract_items si "
                        "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                        "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                        "WHERE sc.contract_id=?", (cid,)).fetchall()
                    self._linked_other = {int(r[0]): (r[1] or "")
                                          for r in rows}
            except Exception as exc:
                _log.exception("linked_other query failed for contract %s", cid)
                self._linked_other = {}
    
    self._items_by_id = {int(x["id"]): x for x in self._items}
    if changed_contract:
        # V8.2: للدفعات، الافتراضي غير محدد (المستخدم يختار)
        if getattr(self, "_is_plan_mode", False):
            self._chosen_ids = []  # غير محدد افتراضيًا
        else:
            self._chosen_ids = [int(x["id"]) for x in self._items
                                if int(x["id"]) not in self._linked_other]
    else:
        self._chosen_ids = [i for i in self._chosen_ids
                            if i in self._items_by_id]
    
    # تطبيق سياسة الإخفاء/الإظهار
    _tpl15 = self._apply_items_visibility(cid)
    _type_name = self._client_contract_type_name(cid)
    
    if getattr(self, "_items_hidden", False):
        _lbl = _type_name or "عقد العميل"
        self.items_hint.setText(
            f"عقد العميل من نوع «{_lbl}» (تلقائي) — البنود تُضاف "
            "تلقائيًا؛ يُكتفى بدفعات عقد الباطن أدناه.")
        self.items_hidden_note.setText(self.items_hint.text())
    elif getattr(self, "_is_plan_mode", False):
        # V8.2: يدوي له قالب بلا بنود ⇒ يعرض الدفعات للاختيار
        self.items_hint.setText(
            f"عقد العميل من نوع «{_type_name or 'يدوي'}» له قالب — "
            "علّم الدفعات/المراحل التي تعطيها لهذا المقاول "
            "(المحدد يظهر مميزًا وعدّاده أسفل الجدول).")
        # تحديث عنوان الصندوق
        box = getattr(self, "items_box", None)
        if box is not None:
            box.setTitle("② دفعات/مراحل عقد العميل — علّم الدفعات التي تعطيها لهذا المقاول")
        # إخفاء جدول البنود المختارة (فارغ في هذه الحالة)
        ct = getattr(self, "chosen_table", None)
        if ct is not None:
            ct.setVisible(False)
        _chosen_lbl = getattr(self, "_chosen_lbl", None)
        if _chosen_lbl is not None:
            _chosen_lbl.setVisible(False)
    elif _tpl15:
        self.items_hint.setText(
            f"عقد العميل من نوع «{_type_name or 'يدوي'}» له قالب — "
            "اختر البنود التي تعطيها لهذا المقاول "
            "(المختار يظهر مميزًا وعدّاده أسفل الجدول).")
    elif self._items_error:
        self.items_hint.setText(
            f"⚠ تعذّر قراءة بنود عقد العميل: {self._items_error}")
    elif not self._items:
        self.items_hint.setText(
            "لا بنود على عقد العميل — يمكنك الحفظ بلا بنود. "
            "لإضافة بنود، افتح شاشة العقد الرئيسي واضفها في "
            "جدول «بنود العقد»." if cid else
            "اختر العقد الرئيسي أولًا لعرض بنوده.")
    elif self._items and len(self._chosen_ids) == 0 and self._linked_other:
        _names = sorted(set(self._linked_other.values()))
        _names_str = "، ".join(_names)
        self.items_hint.setText(
            f"⚠ كل بنود هذا العقد مرتبطة بمقاول آخر: {_names_str} — "
            "لا يمكن اختيار أي بند من هذه البنود.")
    else:
        self.items_hint.setText(
            "كل بنود العقد كما هي — علّم البند الذي تعطيه لهذا "
            "المقاول · البنود المرتبطة بمقاول آخر تبقى معطّلة بوسم "
            "المقاول · المختار يظهر مميزًا وعدّاده أسفل الجدول.")
    
    self._fill_items_table()
    self._refresh_sub_totals()


# ============================================================
# 6. من ui/subcontractors.py — عرض الجدول حسب نوع العقد
# ============================================================
# السطر 277-340 (V8.2)

def _fill_items_table(self):
    from ui.widgets import MONEY_ALIGN, sync_header_alignment
    from PySide6.QtGui import QColor
    t = self.items_table
    t.blockSignals(True)
    
    # V8.2: تغيير رؤوس الأعمدة حسب الوضع
    if getattr(self, "_is_plan_mode", False):
        t.setHorizontalHeaderLabels(
            ["✔", "الدفعة", "المرحلة", "الاستحقاق", "المبلغ", "ملاحظات"])
    else:
        t.setHorizontalHeaderLabels(
            ["✔", "البند", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"])
    
    t.setRowCount(len(self._items))
    for r, it in enumerate(self._items):
        iid = int(it["id"])
        qty = float(it.get("qty") or 0)
        price = float(it.get("unit_price") or 0)
        total = float(it.get("total") or qty * price)
        taken = iid in self._linked_other
        chosen = (iid in self._chosen_ids) and not taken
        chk = QTableWidgetItem("")
        flags = (Qt.ItemIsUserCheckable | Qt.ItemIsEnabled
                 | Qt.ItemIsSelectable)
        chk.setFlags(flags)
        chk.setCheckState(Qt.Checked if chosen else Qt.Unchecked)
        chk.setData(Qt.UserRole, iid)
        if taken:
            chk.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
        t.setItem(r, 0, chk)
        
        # V8.2: عرض الدفعات بدل البنود في وضع الخطة
        if getattr(self, "_is_plan_mode", False):
            vals = [
                it.get("description") or "",
                it.get("stage_name") or "—",
                it.get("due_date") or "—",
                f"{total:,.3f}",
                it.get("notes") or ""
            ]
        else:
            vals = [it.get("description") or "", f"{qty:,.3f}",
                    it.get("unit") or "—", f"{price:,.3f}", f"{total:,.3f}"]
        
        for c, v in enumerate(vals, start=1):
            cell = QTableWidgetItem(str(v))
            cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            cell.setTextAlignment(MONEY_ALIGN if c in (3, 4, 5)
                                  else Qt.AlignCenter)
            cell.setData(Qt.UserRole, iid)
            if taken:
                cell.setForeground(QColor(style.WARN))
                _other = self._linked_other.get(iid, "")
                if _other:
                    cell.setToolTip(f"مرتبط بمقاول آخر: {_other}")
            t.setItem(r, c, cell)
    t.blockSignals(False)
    sync_header_alignment(t)
    self._mark_chosen_rows()
    self._refresh_chosen_table()


# ============================================================
# 7. من ui/subcontractors.py — بناء الدفعات من العناصر المحددة
# ============================================================
# السطر 975-1080 (V8.2)

def _build_plan_rows(self, cid=None):
    """صفوف الدفعات = دفعات عقد العميل نفسها — والمبالغ فارغة يدويًا.
    
    V8.2: في وضع الخطة (الدفعات)، يبني الدفعات من العناصر المحددة فقط.
    """
    if cid is None:
        cid = self.contract.selected_data()
    self._plan_rows = []
    self._client_lines = {}
    if not cid:
        self._plan_note = "اختر عقد العميل لعرض دفعاته."
        self._fill_plan_table()
        return
    
    try:
        lines = [dict(x) for x in lc.contract_payment_plan(int(cid))]
    except Exception:
        lines = []
    self._client_lines = {int(x["id"]): x for x in lines}
    
    if not lines:
        self._plan_note = ("لا دفعات على عقد العميل — أضف صفوف الدفعات "
                           "يدويًا من «＋ إضافة دفعة».")
        self._fill_plan_table()
        return
    
    # V8.2: في وضع الخطة، نبني الدفعات من العناصر المحددة فقط
    if getattr(self, "_is_plan_mode", False):
        # فلترة الدفعات المحددة فقط
        selected_lines = []
        for ln in lines:
            if int(ln["id"]) in self._chosen_ids:
                selected_lines.append(ln)
        
        if not selected_lines:
            self._plan_note = ("لم تحدد أي دفعة — علّم الدفعات في الجدول العلوي "
                               "ثم اضغط «⚖ توزيع تلقائي» أو اكتب القيم يدويًا.")
            self._fill_plan_table()
            return
        
        for i, ln in enumerate(selected_lines, 1):
            skipped = int(ln.get("linked_stage_skipped") or 0)
            _seq = int(ln.get("sort_order") or 0) or i
            self._plan_rows.append({
                "title": _auto_title_fixed(_seq, ln.get("title") or ""),
                "stage_id": None if skipped else ln.get("stage_id"),
                "stage_name": ln.get("stage_name") or "",
                "due": (ln.get("due_date") or "")[:10],
                "amount": 0.0,
                "sources": [int(ln["id"])],
            })
        
        note = ("الدفعات المحددة ظاهرة أدناه — اكتب قيمة كل دفعة في خانة "
                "«قيمة الدفعة»، أو اضغط «⚖ توزيع تلقائي» ليقسّم قيمة عقد "
                "الباطن عليها بنسب دفعات العميل.")
    else:
        # الوضع العادي: كل الدفعات
        for i, ln in enumerate(lines, 1):
            skipped = int(ln.get("linked_stage_skipped") or 0)
            _seq = int(ln.get("sort_order") or 0) or i
            self._plan_rows.append({
                "title": _auto_title_fixed(_seq, ln.get("title") or ""),
                "stage_id": None if skipped else ln.get("stage_id"),
                "stage_name": ln.get("stage_name") or "",
                "due": (ln.get("due_date") or "")[:10],
                "amount": 0.0,
                "sources": [int(ln["id"])],
            })
        note = ("دفعات عقد العميل ظاهرة أدناه — اكتب قيمة كل دفعة في خانة "
                "«قيمة الدفعة»، أو اضغط «⚖ توزيع تلقائي» ليقسّم قيمة عقد "
                "الباطن عليها بنسب دفعات العميل.")
    
    missing = lc.sub_plan_autolink_guard(int(cid))
    if missing:
        note = "⚠ " + " · ".join(missing) + "\n" + note
    self._plan_note = note
    self._fill_plan_table()


# ============================================================
# 8. من ui/subcontractors.py — العدّاد والمجموع
# ============================================================
# السطر 435-520 (V8.2)

def _refresh_sub_totals(self):
    """عدّاد ومجموع المختار + مقارنته بقيمة عقد الباطن.
    
    V8.2: في وضع الخطة، يعرض عداد الدفعات المحددة.
    """
    _color = None
    rows = [self._items_by_id[i] for i in self._chosen_ids
            if i in getattr(self, "_items_by_id", {})]
    total = 0.0
    for it in rows:
        qty = float(it.get("qty") or 0)
        price = float(it.get("unit_price") or 0)
        total += float(it.get("total") or qty * price)
    self._chosen_total = total
    
    if getattr(self, "_items_hidden", False):
        txt = ("بلا بنود — عقد العميل من نوع تلقائي (يُكتفى بدفعات "
               "عقد الباطن)"
               if getattr(self, "_client_auto", False) else
               "بلا بنود — نوع عقد العميل له قالب (يُكتفى بدفعات "
               "عقد الباطن)")
    elif getattr(self, "_is_plan_mode", False):
        # V8.2: وضع الدفعات
        if not rows:
            txt = "لم تحدد أي دفعة — علّم الدفعات في الجدول العلوي"
        else:
            _all_total = 0.0
            for _it in (getattr(self, "_items", None) or []):
                _q = float(_it.get("qty") or 0)
                _p = float(_it.get("unit_price") or 0)
                _all_total += float(_it.get("total") or _q * _p)
            txt = (f"مجموع دفعات العقد: {_all_total:,.3f} د.ك · "
                   f"المحدد: {len(rows)} دفعة · {total:,.3f} د.ك")
            try:
                amt = float(self.amount.value() or 0)
            except Exception:
                amt = 0.0
            if amt > 0:
                diff = total - amt
                txt += f" · قيمة عقد الباطن: {amt:,.3f} د.ك"
                txt += (" · ✓ مطابق" if abs(diff) <= 0.001
                        else f" · ⚠ الفرق: {diff:+,.3f} د.ك")
                _color = (style.OK_GREEN if abs(diff) <= 0.001
                          else style.WARN)
            else:
                _color = None
    elif not getattr(self, "_items", None):
        txt = "لا بنود على عقد العميل"
    elif not rows:
        txt = "لم تُعلّم أي بند — يمكن الحفظ بلا بنود"
    else:
        _all_total = 0.0
        for _it in (getattr(self, "_items", None) or []):
            _q = float(_it.get("qty") or 0)
            _p = float(_it.get("unit_price") or 0)
            _all_total += float(_it.get("total") or _q * _p)
        txt = (f"مجموع بنود عقد العميل: {_all_total:,.3f} د.ك · "
               f"المختار لهذا المقاول: {len(rows)} بند · {total:,.3f} د.ك")
        try:
            amt = float(self.amount.value() or 0)
        except Exception:
            amt = 0.0
        if amt > 0:
            diff = total - amt
            txt += f" · قيمة عقد الباطن: {amt:,.3f} د.ك"
            txt += (" · ✓ مطابق لقيمة عقد الباطن" if abs(diff) <= 0.001
                    else f" · ⚠ الفرق: {diff:+,.3f} د.ك")
            _color = (style.OK_GREEN if abs(diff) <= 0.001
                      else style.WARN)
        else:
            _color = None
    lbl = getattr(self, "items_total_lbl", None)
    if lbl is not None:
        lbl.setText(txt)
        try:
            if _color:
                lbl.setStyleSheet(
                    "background: transparent; border: none; "
                    f"font-weight: 800; color: {_color};")
            else:
                lbl.setStyleSheet("font-weight: 800;")
        except Exception:
            pass
    other = getattr(self, "chosen_total_lbl", None)
    if other is not None and other is not lbl:
        other.setText(txt)


# ============================================================
# 9. من database/database.py — هيكل جدول contract_types
# ============================================================

"""
CREATE TABLE IF NOT EXISTS contract_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    default_amount REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    manual_track INTEGER DEFAULT 0,  -- 1 = يدوي، 0 = تلقائي
    created_at TEXT DEFAULT (datetime('now','localtime')),
    unit_label TEXT DEFAULT '',
    unit_price REAL DEFAULT 0,
    pricing_mode TEXT DEFAULT 'lump',
    is_supervision INTEGER DEFAULT 0
)
"""


# ============================================================
# 10. ملخص السلوك
# ============================================================

"""
============================================================
ملخص سلوك العقود اليدوية — V8.2
============================================================

┌─────────────────┬─────────────────┬─────────────────────┐
│ نوع العقد       │ manual_track    │ السلوك              │
├─────────────────┼─────────────────┼─────────────────────┤
│ يدوي (له قالب)  │ 1               │ يعرض الدفعات/المراحل│
│                 │                 │ في الجدول العلوي    │
│                 │                 │ المستخدم يحدد       │
├─────────────────┼─────────────────┼─────────────────────┤
│ تلقائي          │ 0               │ يُخفى الصندوق       │
│                 │                 │ الدفعات تُضاف      │
│                 │                 │ تلقائيًا            │
├─────────────────┼─────────────────┼─────────────────────┤
│ بدون قالب       │ 0               │ يعرض البنود من      │
│                 │                 │ boq_items           │
└─────────────────┴─────────────────┴─────────────────────┘

الخطوات للعقد اليدوي:
  1. المستخدم يختار العميل
  2. المستخدم يختار العقد (يدوي له قالب)
  3. الجدول العلوي يعرض الدفعات/المراحل
  4. المستخدم يحدد الدفعات المطلوبة
  5. الدفعات المحددة تظهر في جدول الدفعات السفلي
  6. المستخدم يكتب قيم الدفعات أو يستخدم التوزيع التلقائي
  7. الحفظ ينشئ عقد باطن مع الدفعات المحددة ومصادرها

============================================================
"""
