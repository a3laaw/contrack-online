# -*- coding: utf-8 -*-
"""V5.4 ④: بنود الأمر التغييري — إضافة/حذف بنود بجهتين.

الفكرة: أمر تغييري له جهتان:
  * «عميل»  → يمسّ عقد العميل الرئيسي وقيمته مع المالك.
  * «مقاول» → يمسّ عقد الباطن وقيمته.
وفي كل جهة: إضافة جزء (يدوي أو من البنود المتاحة) وحذف جزء
(من بنود العقد/عقد الباطن المعتمدة، بموافقة صريحة).

قواعد ثابتة (قرارات المستخدم):
  * البند المحذوف **لا يُمحى** — يُوسم «محذوف بأمر تغييري»، يُستثنى من
    المجاميع، ويعود كما كان عند إلغاء الأمر التغييري.
  * الماليات تمر عبر جدول addendums نفسه (amount_add/amount_deduct)
    حتى تظل قيمة العقد الحالية والمالية مع المالك كما هي.

لا PySide6 هنا — خدمات فقط.
"""
from __future__ import annotations

from datetime import date

from database.database import get_connection
from services.customer_service import ValidationError
from services.lifecycle_service import log_event

SIDES = {"client": "عميل", "sub": "مقاول"}


def _norm(txt: str) -> str:
    return " ".join((txt or "").split()).strip()


def _round(x) -> float:
    return round(float(x or 0), 3)


def _item_amount(qty, unit_price) -> float:
    return _round(float(qty or 0) * float(unit_price or 0))


def _addendum(aid: int) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM addendums WHERE id=?",
                           (int(aid),)).fetchone()
    if not row:
        raise ValidationError("الأمر التغييري غير موجود.")
    return dict(row)


# ============================================================
# سطور العقد الموحّدة (V8.9: بنود + دفعات + مراحل)
# ============================================================
def contract_basis_info(contract_id: int) -> list[dict]:
    """تُرجع كل سطور العقد بأي بنية: بنود BOQ + دفعات + مراحل.

    الشكل الموحّد:
      {kind, ref_id, description, qty, unit, unit_price, amount,
       source_label, linked_sub, deleted}
    """
    out: list[dict] = []
    with get_connection() as conn:
        has_boq = bool(conn.execute(
            "SELECT 1 FROM boq_items WHERE contract_id=? LIMIT 1",
            (int(contract_id),)).fetchone())
        has_plan = bool(conn.execute(
            "SELECT 1 FROM payment_plan WHERE contract_id=? LIMIT 1",
            (int(contract_id),)).fetchone())
        # 1) بنود BOQ
        for r in conn.execute(
            "SELECT id, description, qty, unit, unit_price, "
            "qty * unit_price AS amount, "
            "COALESCE(deleted_addendum_id, 0) AS del "
            "FROM boq_items WHERE contract_id=? ORDER BY id",
            (int(contract_id),)).fetchall():
            d = dict(r)
            out.append({
                "kind": "boq", "ref_kind": "boq", "ref_id": int(d["id"]),
                "description": d["description"] or "",
                "qty": float(d["qty"] or 0), "unit": d["unit"] or "",
                "unit_price": float(d["unit_price"] or 0),
                "amount": float(d["amount"] or 0),
                "source_label": "بند عقد",
                "linked_sub": None, "deleted": bool(d["del"]),
            })
        # 2) دفعات payment_plan — فقط إذا لم يكن العقد يعتمد على بنود BOQ
        # (الدفعات التلقائية تُنشأ لكل عقد — نستبعدها إذا كان العقد يعتمد على البنود)
        if not has_boq:
            for r in conn.execute(
                "SELECT pp.id, pp.title, pp.amount, pp.due_date, "
                "pp.sort_order, cs.name AS stage_name, "
                "COALESCE(pp.deleted_addendum_id, 0) AS del "
                "FROM payment_plan pp "
                "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
                "WHERE pp.contract_id=? ORDER BY pp.sort_order, pp.id",
                (int(contract_id),)).fetchall():
                d = dict(r)
                out.append({
                    "kind": "plan", "ref_kind": "plan", "ref_id": int(d["id"]),
                    "description": (f"{d['stage_name']} — {d['title']}"
                                    if d.get("stage_name") and d.get("title")
                                    else d.get("stage_name") or d.get("title") or ""),
                    "qty": 1.0, "unit": "",
                    "unit_price": float(d["amount"] or 0),
                    "amount": float(d["amount"] or 0),
                    "source_label": f"دفعة — {d.get('stage_name') or d.get('due_date') or '—'}",
                    "linked_sub": None, "deleted": bool(d["del"]),
                })
        # 3) مراحل contract_stages فقط إذا لم يكن العقد يعتمد على بنود/دفعات
        if not has_boq and not has_plan:
            for r in conn.execute(
                "SELECT id, name, level, pay_pct, expected_days, "
                "COALESCE(deleted_addendum_id, 0) AS del "
                "FROM contract_stages WHERE contract_id=? "
                "AND COALESCE(is_skipped, 0)=0 ORDER BY sort_order, id",
                (int(contract_id),)).fetchall():
                d = dict(r)
                out.append({
                    "kind": "stage", "ref_kind": "stage", "ref_id": int(d["id"]),
                    "description": d["name"] or "",
                    "qty": 1.0, "unit": "",
                    "unit_price": 0.0, "amount": 0.0,
                    "source_label": f"مرحلة — {d['name']}",
                    "linked_sub": None, "deleted": bool(d["del"]),
                })
        # ربط المسنَد لمقاول
        _sub_map = _linked_sub_map(conn, contract_id)
        for item in out:
            key = (item["kind"], item["ref_id"])
            if key in _sub_map:
                item["linked_sub"] = _sub_map[key]
    return out


def _linked_sub_map(conn, contract_id: int) -> dict[tuple, str]:
    """خريطة (kind, ref_id) → اسم المقاول المالك."""
    out = {}
    for r in conn.execute(
        "SELECT sci.boq_item_id, sci.source_kind, sci.source_id, "
        "s.name FROM sub_contract_items sci "
        "JOIN sub_contracts sc ON sc.id = sci.sub_contract_id "
        "JOIN subcontractors s ON s.id = sc.subcontractor_id "
        "WHERE sc.contract_id=? AND COALESCE(sc.status,'') <> 'ملغى'",
        (int(contract_id),)).fetchall():
        name = r["name"] or ""
        bid = int(r["boq_item_id"] or 0)
        sk = (r["source_kind"] or "").strip()
        sid = int(r["source_id"] or 0)
        if bid:
            out[("boq", bid)] = name
        elif sk and sid:
            out[(sk, sid)] = name
    return out


def sub_basis_info(contract_id: int, sub_contract_id: int
                   ) -> list[dict]:
    """سطور عقد الباطن (بنود BOQ + دفعات + مراحل) المربوطة بهذا العقد."""
    out: list[dict] = []
    with get_connection() as conn:
        for r in conn.execute(
            "SELECT sci.id AS sci_id, sci.boq_item_id, "
            "sci.source_kind, sci.source_id, "
            "sci.qty, sci.unit_price, sci.amount, "
            "b.description AS boq_desc, b.unit AS boq_unit "
            "FROM sub_contract_items sci "
            "LEFT JOIN boq_items b ON b.id = sci.boq_item_id "
            "WHERE sci.sub_contract_id=? ORDER BY sci.id",
            (int(sub_contract_id),)).fetchall():
            d = dict(r)
            bid = int(d["boq_item_id"] or 0)
            sk = (d["source_kind"] or "").strip()
            sid = int(d["source_id"] or 0)
            if bid:
                out.append({
                    "kind": "boq", "ref_id": bid,
                    "description": d["boq_desc"] or "",
                    "qty": float(d["qty"] or 0),
                    "unit": d["boq_unit"] or "",
                    "unit_price": float(d["unit_price"] or 0),
                    "amount": float(d["amount"] or 0),
                    "source_label": "بند عقد",
                })
            elif sk == "plan" and sid:
                title = ""
                for pr in conn.execute(
                    "SELECT pp.title, pp.due_date, cs.name AS stage_name "
                    "FROM payment_plan pp "
                    "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
                    "WHERE pp.id=?",
                    (sid,)).fetchall():
                    _sn = pr["stage_name"] or ""
                    _pt = pr["title"] or ""
                    if _sn and _pt:
                        title = f"{_sn} — {_pt}"
                    else:
                        title = _sn or _pt or pr["due_date"] or ""
                out.append({
                    "kind": "plan", "ref_id": sid,
                    "description": title,
                    "qty": float(d["qty"] or 1),
                    "unit": "",
                    "unit_price": float(d["unit_price"] or 0),
                    "amount": float(d["amount"] or 0),
                    "source_label": "دفعة",
                })
            elif sk == "stage" and sid:
                name = ""
                for sr in conn.execute(
                    "SELECT name FROM contract_stages WHERE id=?",
                    (sid,)).fetchall():
                    name = sr["name"] or ""
                out.append({
                    "kind": "stage", "ref_id": sid,
                    "description": name,
                    "qty": float(d["qty"] or 1),
                    "unit": "",
                    "unit_price": float(d["unit_price"] or 0),
                    "amount": float(d["amount"] or 0),
                    "source_label": "مرحلة",
                })
    return out


# ============================================================
# البنود المتاحة (المخفية / التي لم تنزل في العقد النهائي)
# ============================================================
def available_items(contract_id: int, side: str = "client",
                    sub_contract_id: int | None = None) -> dict:
    """البنود التي يمكن إضافتها بأمر تغييري.

    V8.9: تستخدم contract_basis_info() لعرض كل أنواع السطور
    (بنود BOQ + دفعات + مراحل) بدل بنود BOQ فقط.

    عميل:  بنود العقد غير المحذوفة + بنود العروض (المقايسة) غير المنزولة.
    مقاول: بنود العقد غير المسنَد لمقاول آخر (حصرية).
    """
    side = (side or "client").strip().lower()
    if side not in SIDES:
        raise ValidationError("جهة الأمر التغييري غير صحيحة.")
    out: dict = {"quotation_items": [], "deleted_items": [],
                 "contract_items": [], "sub_items": []}
    with get_connection() as conn:
        crow = conn.execute(
            "SELECT customer_id FROM contracts WHERE id=?",
            (int(contract_id),)).fetchone()
        if crow is None:
            raise ValidationError("العقد غير موجود.")
        customer_id = crow["customer_id"]

    # V8.9: بنود العقد الموحّدة
    basis = contract_basis_info(contract_id)
    basis_descs = {_norm(b["description"]).casefold()
                   for b in basis if not b["deleted"]}

    if side == "client":
        # 1) بنود العروض غير المنزولة في العقد
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT qi.id, qi.description, qi.qty, qi.unit, "
                "qi.unit_price, q.quote_number, q.qdate, "
                "COALESCE(q.status,'') AS qstatus "
                "FROM quotation_items qi JOIN quotations q "
                "ON q.id = qi.quotation_id "
                "WHERE q.customer_id=? AND COALESCE(q.status,'') <> 'ملغى' "
                "ORDER BY qi.id", (customer_id,)).fetchall()
        for r in rows:
            d = dict(r)
            if _norm(d["description"]).casefold() in basis_descs:
                continue
            d["amount"] = _item_amount(d["qty"], d["unit_price"])
            d["source"] = "عرض سعر %s" % (d.get("quote_number") or "—")
            d["ref_kind"] = ""
            d["ref_id"] = 0
            out["quotation_items"].append(d)

        # 2) بنود العقد الموحّدة المحذوفة (قابلة للإعادة)
        for b in basis:
            if not b["deleted"]:
                continue
            b["source"] = "محذوف بأمر تغييري — يمكن إعادته"
            out["deleted_items"].append(b)

    if side == "sub":
        # حصرية: بنود مسنَد لمقاول آخر
        with get_connection() as conn:
            taken_raw = conn.execute(
                "SELECT sci.boq_item_id, sci.source_kind, sci.source_id "
                "FROM sub_contract_items sci "
                "JOIN sub_contracts sc ON sc.id = sci.sub_contract_id "
                "WHERE sc.contract_id=? AND COALESCE(sc.status,'') <> 'ملغى'",
                (int(contract_id),)).fetchall()
        other_taken: set[tuple[str, int]] = set()
        on_this: set[tuple[str, int]] = set()
        for r in taken_raw:
            bid = int(r["boq_item_id"] or 0)
            sk = (r["source_kind"] or "").strip()
            sid = int(r["source_id"] or 0)
            if bid:
                key = ("boq", bid)
            elif sk and sid:
                key = (sk, sid)
            else:
                continue
            other_taken.add(key)
        if sub_contract_id:
            for r in conn.execute(
                "SELECT boq_item_id, source_kind, source_id "
                "FROM sub_contract_items WHERE sub_contract_id=?",
                (int(sub_contract_id),)).fetchall():
                bid = int(r["boq_item_id"] or 0)
                sk = (r["source_kind"] or "").strip()
                sid = int(r["source_id"] or 0)
                if bid:
                    on_this.add(("boq", bid))
                elif sk and sid:
                    on_this.add((sk, sid))

        for b in basis:
            if b["deleted"]:
                continue
            key = (b["kind"], b["ref_id"])
            b["amount"] = b.get("amount") or _item_amount(
                b.get("qty"), b.get("unit_price"))
            if key in on_this:
                b["source"] = "على عقد الباطن حاليًا"
                out["sub_items"].append(b)
                continue
            if key in other_taken:
                continue  # مسنَد لمقاول آخر
            b["source"] = b.get("source_label") or "غير مسنَد"
            out["contract_items"].append(b)

        # بنود عقد الباطن المحذوفة بأمر تغييري سابق
        if sub_contract_id:
            with get_connection() as conn:
                for r in conn.execute(
                    "SELECT ai.id, ai.boq_item_id, ai.ref_kind, ai.ref_id, "
                    "ai.description, ai.qty, ai.unit, ai.unit_price, "
                    "ai.amount "
                    "FROM addendum_items ai JOIN addendums a "
                    "ON a.id = ai.addendum_id "
                    "WHERE ai.side='sub' AND ai.action='delete' "
                    "AND ai.sub_contract_id=? AND a.status='معتمد' "
                    "AND ai.applied=1 "
                    "ORDER BY ai.id",
                    (int(sub_contract_id),)).fetchall():
                    d = dict(r)
                    # V8.9: تحقق من عدم وجود البند على العقد حالياً
                    _rk = (d.get("ref_kind") or "").strip()
                    _rid = int(d.get("ref_id") or 0)
                    _bid = int(d.get("boq_item_id") or 0)
                    if _bid and not _rk:
                        _rk, _rid = "boq", _bid
                    _still_deleted = True
                    if _rk == "boq" and _bid:
                        with get_connection() as conn2:
                            _check = conn2.execute(
                                "SELECT 1 FROM sub_contract_items "
                                "WHERE sub_contract_id=? AND boq_item_id=?",
                                (int(sub_contract_id), _bid)).fetchone()
                            _still_deleted = _check is None
                    elif _rk and _rid:
                        with get_connection() as conn2:
                            _check = conn2.execute(
                                "SELECT 1 FROM sub_contract_items "
                                "WHERE sub_contract_id=? AND source_kind=? "
                                "AND source_id=?",
                                (int(sub_contract_id), _rk, _rid)).fetchone()
                            _still_deleted = _check is None
                    if _still_deleted:
                        d["source"] = "محذوف من عقد الباطن بأمر تغييري — يمكن إعادته"
                        d["ref_kind"] = _rk
                        d["ref_id"] = _rid
                        out["deleted_items"].append(d)
    return out


def subcontractor_choices(contract_id: int) -> list[dict]:
    """مقاولو الباطن المتعاقدين مع العميل فقط + خيار جديد (V8.10).

    يُستبعد المقاولون الذين ليس لديهم عقد باطن على هذا العقد.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT s.id AS subcontractor_id, s.name AS name, "
            "sc.id AS sub_contract_id, COALESCE(sc.amount,0) AS amount "
            "FROM subcontractors s JOIN sub_contracts sc "
            "ON sc.subcontractor_id = s.id AND sc.contract_id=? "
            "AND sc.status != 'ملغى' ORDER BY s.name", (int(contract_id),)
        ).fetchall()
    out, seen = [], set()
    for r in rows:
        d = dict(r)
        if int(d["subcontractor_id"]) in seen:
            continue
        seen.add(int(d["subcontractor_id"]))
        d["is_new"] = False
        out.append(d)
    # خيار "جديد" دائمًا
    out.insert(0, {"subcontractor_id": 0, "name": "مقاول جديد", "sub_contract_id": None,
                   "amount": 0, "is_new": True})
    return out


def all_subcontractors() -> list[dict]:
    """كل المقاولين المسجلين في النظام (لشاشة إنشاء عقد باطن جديد)."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name FROM subcontractors WHERE active != 0 ORDER BY name"
        ).fetchall()
    # fallback: لو ما فيه عمود active
    if not rows:
        try:
            with get_connection() as conn:
                rows = conn.execute(
                    "SELECT id, name FROM subcontractors ORDER BY name"
                ).fetchall()
        except Exception:
            rows = []
    return [dict(r) for r in rows]


def create_sub_contract(contract_id: int, subcontractor_id: int,
                        amount: float, description: str = "") -> int:
    """إنشاء عقد باطن جديد + ربطه بعقد العميل.

    يعيد معرّف sub_contracts.id الجديد.
    """
    from services import lifecycle_service as lc
    if not subcontractor_id:
        raise ValidationError("اختر المقاول أولًا.")
    if amount <= 0:
        raise ValidationError("مبلغ العقد يجب أن يكون أكبر من صفر.")
    with get_connection() as conn:
        # التحقق من عدم وجود عقد باطن نشط لنفس المقاول على نفس العقد
        existing = conn.execute(
            "SELECT id FROM sub_contracts WHERE subcontractor_id=? "
            "AND contract_id=? AND status != 'ملغى'",
            (int(subcontractor_id), int(contract_id))
        ).fetchone()
        if existing:
            raise ValidationError(
                "يوجد عقد باطن نشط لهذا المقاول على هذا العقد بالفعل.")
        cur = conn.execute(
            "INSERT INTO sub_contracts (subcontractor_id, contract_id, "
            "amount, status, description) VALUES (?, ?, ?, 'نشط', ?)",
            (int(subcontractor_id), int(contract_id),
             float(amount), description or "")
        )
        return int(cur.lastrowid)


def sub_contractor_items(contract_id: int, subcontractor_id: int,
                         sub_contract_id: int | None = None,
                         order_addendum_id: int | None = None) -> list[dict]:
    """بنود العقد الموحّدة لعرضها في تاب المقاول (V8.9).

    تُستخدم contract_basis_info() لعرض بنود BOQ + دفعات + مراحل.
    يُستبعد:
    - البنود المحذوفة.
    - السطور المسندة لأي مقاول **آخر** (حصرية).
    - السطور المضافة في نفس الأمر الحالي لنفس المقاول ولم تُحفظ بعد.
    يُوسم المشترك حاليًا بعقد الباطن بـ ``on_contract``.
    """
    basis = contract_basis_info(contract_id)
    taken: set[tuple[str, int]] = set()
    on_this: set[tuple[str, int]] = set()
    pending: set[tuple[str, int]] = set()
    with get_connection() as conn:
        for r in conn.execute(
            "SELECT sci.boq_item_id, sci.source_kind, sci.source_id, "
            "sci.sub_contract_id "
            "FROM sub_contract_items sci "
            "JOIN sub_contracts sc ON sc.id = sci.sub_contract_id "
            "WHERE sc.contract_id=? AND COALESCE(sc.status,'') <> 'ملغى'",
            (int(contract_id),)).fetchall():
            bid = int(r["boq_item_id"] or 0)
            sk = (r["source_kind"] or "").strip()
            sid = int(r["source_id"] or 0)
            if bid:
                key = ("boq", bid)
            elif sk and sid:
                key = (sk, sid)
            else:
                continue
            taken.add(key)
            if sub_contract_id and int(r["sub_contract_id"]) == int(sub_contract_id):
                on_this.add(key)
        if order_addendum_id:
            for r in conn.execute(
                "SELECT boq_item_id, ref_kind, ref_id "
                "FROM addendum_items WHERE addendum_id=? "
                "AND side='sub' AND action='add' "
                "AND COALESCE(subcontractor_id,0)=?",
                (int(order_addendum_id),
                 int(subcontractor_id or 0))).fetchall():
                _bid = int(r["boq_item_id"] or 0)
                _rk = (r["ref_kind"] if "ref_kind" in r.keys() else "").strip()
                _rid = int(r["ref_id"] if "ref_id" in r.keys() else 0)
                if _bid and not _rk:
                    _rk, _rid = "boq", _bid
                if _rk and _rid:
                    pending.add((_rk, _rid))
    out = []
    for b in basis:
        key = (b["kind"], b["ref_id"])
        if key in pending:
            continue
        b["amount"] = b.get("amount") or _item_amount(
            b.get("qty"), b.get("unit_price"))
        if b["deleted"]:
            b["on_contract"] = False
            b["is_deleted"] = True
            out.append(b)
            continue
        b["on_contract"] = key in on_this
        if key in taken and key not in on_this:
            continue  # مسنَد لمقاول آخر
        out.append(b)
    return out


# ============================================================
# أجزاء الأمر التغييري (إضافة / حذف)
# ============================================================
def add_part(addendum_id: int, side: str, description: str, qty, unit: str,
             unit_price, boq_item_id: int | None = None,
             sub_contract_id: int | None = None,
             subcontractor_id: int | None = None,
             ref_kind: str = "", ref_id: int = 0) -> int:
    """يضيف جزءًا (بندًا) إلى الأمر التغييري بجهته.

    V8.9: يدعم ref_kind/ref_id (boq|plan|stage) بجانب boq_item_id.
    """
    side = (side or "client").strip().lower()
    if side not in SIDES:
        raise ValidationError("جهة الأمر التغييري غير صحيحة.")
    row = _addendum(addendum_id)
    if row.get("status") == "ملغى":
        raise ValidationError("الأمر التغييري ملغى — لا يمكن التعديل عليه.")
    if row.get("applied_at"):
        raise ValidationError("تم تنفيذ هذا الأمر التغييري — لا يمكن التعديل.")
    desc = _norm(description)
    if not desc and not boq_item_id and not (ref_kind and ref_id):
        raise ValidationError("وصف البند مطلوب.")
    if float(qty or 0) <= 0:
        raise ValidationError("كمية البند يجب أن تكون أكبر من صفر.")
    if float(unit_price or 0) < 0:
        raise ValidationError("سعر الوحدة لا يمكن أن يكون سالبًا.")
    amount = _item_amount(qty, unit_price)
    if boq_item_id is None and not desc and not (ref_kind and ref_id):
        raise ValidationError("وصف البند مطلوب.")
    if side == "sub":
        if not subcontractor_id:
            raise ValidationError("اختر المقاول أولًا من داخل تاب المقاول.")
    # V8.9: تطبيع ref_kind/ref_id من boq_item_id
    _rk = (ref_kind or "").strip().lower()
    _rid = int(ref_id or 0)
    if boq_item_id and not _rk:
        _rk, _rid = "boq", int(boq_item_id)
    with get_connection() as conn:
        if boq_item_id:
            owner = conn.execute(
                "SELECT contract_id FROM boq_items WHERE id=?",
                (int(boq_item_id),)).fetchone()
            if owner is None:
                raise ValidationError("البند المحدد غير موجود.")
            if int(owner["contract_id"]) != int(row["contract_id"]):
                raise ValidationError("البند المحدد لا يتبع هذا العقد.")
        if _rk and _rid and side == "sub":
            # V8.9: حصرية — السطر مسنَد لمقاول آخر
            _other = _check_exclusivity(
                conn, _rk, _rid, row["contract_id"],
                int(subcontractor_id or 0))
            if _other:
                raise ValidationError(
                    f"هذا البند مسنَد بالفعل للمقاول «{_other}» — "
                    "لا يجوز إسناده لمقاول آخر (حصرية).")
            # يُمنع تكرار نفس السطر لنفس المقاول في نفس الأمر
            dup = _check_pending_dup(
                conn, addendum_id, "sub", _rk, _rid,
                int(subcontractor_id or 0))
            if dup:
                raise ValidationError(
                    "هذا البند مضاف بالفعل لنفس المقاول في هذا الأمر.")
        elif _rk and _rid:
            already = conn.execute(
                "SELECT 1 FROM addendum_items WHERE addendum_id=? AND "
                "side=? AND action='add' AND ref_kind=? AND ref_id=?",
                (int(addendum_id), side, _rk, _rid)).fetchone()
            if already:
                raise ValidationError("هذا البند مضاف بالفعل في هذا الأمر.")
        if subcontractor_id:
            _who = conn.execute("SELECT 1 FROM subcontractors WHERE id=?",
                                (int(subcontractor_id),)).fetchone()
            if not _who:
                raise ValidationError("المقاول المحدد غير موجود.")
        if sub_contract_id:
            _own = conn.execute(
                "SELECT subcontractor_id FROM sub_contracts WHERE id=?",
                (int(sub_contract_id),)).fetchone()
            if not _own:
                raise ValidationError("عقد الباطن المحدد غير موجود.")
            if subcontractor_id and int(_own["subcontractor_id"]) != \
                    int(subcontractor_id):
                raise ValidationError("عقد الباطن لا يخص المقاول المحدد.")
            subcontractor_id = int(_own["subcontractor_id"])
        cur = conn.execute(
            "INSERT INTO addendum_items (addendum_id, side, action, "
            "boq_item_id, sub_contract_id, subcontractor_id, description, "
            "qty, unit, unit_price, amount, ref_kind, ref_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (int(addendum_id), side, "add", int(boq_item_id or 0) or None,
             int(sub_contract_id or 0) or None,
             int(subcontractor_id or 0) or None,
             desc, float(qty or 0), _norm(unit), float(unit_price or 0),
             amount, _rk, _rid))
        new_id = int(cur.lastrowid)
    _refresh_counts(addendum_id)
    return new_id


def _check_exclusivity(conn, ref_kind: str, ref_id: int,
                       contract_id: int, subcontractor_id: int) -> str | None:
    """V8.9: يتحقق من حصرية السطر — يرجع اسم المقاول أو None."""
    if ref_kind == "boq":
        r = conn.execute(
            "SELECT s.name FROM sub_contract_items sci "
            "JOIN sub_contracts sc ON sc.id = sci.sub_contract_id "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "WHERE sci.boq_item_id=? AND sc.contract_id=? "
            "AND COALESCE(sc.subcontractor_id,0)!=?",
            (ref_id, int(contract_id),
             int(subcontractor_id))).fetchone()
    elif ref_kind in ("plan", "stage"):
        r = conn.execute(
            "SELECT s.name FROM sub_contract_items sci "
            "JOIN sub_contracts sc ON sc.id = sci.sub_contract_id "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "WHERE sci.source_kind=? AND sci.source_id=? "
            "AND sc.contract_id=? "
            "AND COALESCE(sc.subcontractor_id,0)!=?",
            (ref_kind, ref_id, int(contract_id),
             int(subcontractor_id))).fetchone()
    else:
        return None
    return r["name"] if r else None


def _check_pending_dup(conn, addendum_id: int, side: str,
                       ref_kind: str, ref_id: int,
                       subcontractor_id: int) -> bool:
    """V8.9: يتحقق من تكرار السطر في نفس الأمر."""
    if ref_kind == "boq":
        dup = conn.execute(
            "SELECT 1 FROM addendum_items WHERE addendum_id=? AND "
            "side=? AND action='add' AND ("
            "(ref_kind='boq' AND ref_id=?) OR "
            "(COALESCE(ref_kind,'')='' AND boq_item_id=?)) "
            "AND COALESCE(subcontractor_id,0)=?",
            (int(addendum_id), side, ref_id, ref_id,
             int(subcontractor_id))).fetchone()
    else:
        dup = conn.execute(
            "SELECT 1 FROM addendum_items WHERE addendum_id=? AND "
            "side=? AND action='add' AND ref_kind=? AND ref_id=? "
            "AND COALESCE(subcontractor_id,0)=?",
            (int(addendum_id), side, ref_kind, ref_id,
             int(subcontractor_id))).fetchone()
    return dup is not None


def add_delete_part(addendum_id: int, side: str,
                    boq_item_id: int | None = None,
                    sub_contract_id: int | None = None,
                    ref_kind: str = "", ref_id: int = 0) -> int:
    """يعلّم بندًا من بنود العقد (أو عقد الباطن) للحذف بأمر تغييري.

    V8.9: يدعم ref_kind/ref_id.
    """
    side = (side or "client").strip().lower()
    if side not in SIDES:
        raise ValidationError("جهة الأمر التغييري غير صحيحة.")
    row = _addendum(addendum_id)
    if row.get("status") == "ملغى":
        raise ValidationError("الأمر التغييري ملغى — لا يمكن التعديل عليه.")
    if row.get("applied_at"):
        raise ValidationError("تم تنفيذ هذا الأمر التغييري — لا يمكن التعديل.")
    # V8.9: تطبيع
    _rk = (ref_kind or "").strip().lower()
    _rid = int(ref_id or 0)
    if boq_item_id and not _rk:
        _rk, _rid = "boq", int(boq_item_id)
    if not _rk and not boq_item_id:
        raise ValidationError("اختر بندًا من الجدول أولًا.")
    with get_connection() as conn:
        if _rk == "boq" or boq_item_id:
            _bid = int(boq_item_id or _rid)
            item = conn.execute(
                "SELECT contract_id, description, qty, unit, unit_price "
                "FROM boq_items WHERE id=?", (_bid,)).fetchone()
            if item is None:
                raise ValidationError("البند المحدد غير موجود.")
            if int(item["contract_id"]) != int(row["contract_id"]):
                raise ValidationError("البند المحدد لا يتبع هذا العقد.")
            if side == "sub":
                sub_contract_id = sub_contract_id or row.get("sub_contract_id")
                if not sub_contract_id:
                    raise ValidationError("حدد عقد الباطن أولًا.")
                link = conn.execute(
                    "SELECT 1 FROM sub_contract_items WHERE sub_contract_id=? "
                    "AND boq_item_id=?",
                    (int(sub_contract_id), _bid)).fetchone()
                if link is None:
                    raise ValidationError(
                        "هذا البند ليس على عقد الباطن المحدد.")
            dup = {int(r["boq_item_id"] or 0) for r in conn.execute(
                "SELECT boq_item_id FROM addendum_items WHERE addendum_id=? "
                "AND side=? AND action='delete'",
                (int(addendum_id), side)).fetchall()}
            if _bid in dup:
                raise ValidationError("هذا البند مُعلَّم للحذف بالفعل.")
            amount = _item_amount(item["qty"], item["unit_price"])
            cur = conn.execute(
                "INSERT INTO addendum_items (addendum_id, side, action, "
                "boq_item_id, sub_contract_id, description, qty, unit, "
                "unit_price, amount, ref_kind, ref_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (int(addendum_id), side, "delete", _bid,
                 int(sub_contract_id or 0) or None, item["description"],
                 float(item["qty"] or 0), item["unit"] or "",
                 float(item["unit_price"] or 0), amount, _rk, _rid))
        elif _rk in ("plan", "stage"):
            # V8.9: حذف دفعة/مرحلة — نحتاج وصف + مبلغ من جدولها
            desc = ""
            amt = 0.0
            if _rk == "plan":
                pp = conn.execute(
                    "SELECT title, amount FROM payment_plan WHERE id=? "
                    "AND contract_id=?",
                    (_rid, int(row["contract_id"]))).fetchone()
                if not pp:
                    raise ValidationError("الدفعة المحددة غير موجودة.")
                desc = pp["title"] or ""
                amt = float(pp["amount"] or 0)
            else:
                stg = conn.execute(
                    "SELECT name FROM contract_stages WHERE id=? "
                    "AND contract_id=?",
                    (_rid, int(row["contract_id"]))).fetchone()
                if not stg:
                    raise ValidationError("المرحلة المحددة غير موجودة.")
                desc = stg["name"] or ""
            # تحقق من عدم التكرار
            dup = conn.execute(
                "SELECT 1 FROM addendum_items WHERE addendum_id=? AND "
                "side=? AND action='delete' AND ref_kind=? AND ref_id=?",
                (int(addendum_id), side, _rk, _rid)).fetchone()
            if dup:
                raise ValidationError("هذا البند مُعلَّم للحذف بالفعل.")
            cur = conn.execute(
                "INSERT INTO addendum_items (addendum_id, side, action, "
                "sub_contract_id, description, qty, unit, unit_price, "
                "amount, ref_kind, ref_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (int(addendum_id), side, "delete",
                 int(sub_contract_id or 0) or None, desc,
                 1.0, "", amt, amt, _rk, _rid))
        else:
            raise ValidationError("نوع السطر غير معروف.")
        new_id = int(cur.lastrowid)
    _refresh_counts(addendum_id)
    return new_id


def list_parts(addendum_id: int, side: str | None = None) -> list[dict]:
    """أجزاء الأمر التغييري (الإضافة والحذف) بجهة أو بالكل."""
    sql = ("SELECT * FROM addendum_items WHERE addendum_id=? "
           "AND action IN ('add','delete')")
    params: list = [int(addendum_id)]
    if side:
        sql += " AND side=?"
        params.append((side or "").strip().lower())
    sql += " ORDER BY id"
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, tuple(params)).fetchall()]
        sub_names = {int(r["id"]): r["name"] for r in conn.execute(
            "SELECT id, name FROM subcontractors").fetchall()}
    out = []
    for d in rows:
        d["side_ar"] = SIDES.get(d.get("side") or "", d.get("side") or "")
        d["action_ar"] = "إضافة بند" if d["action"] == "add" else "حذف بند"
        d["subcontractor_name"] = sub_names.get(
            int(d.get("subcontractor_id") or 0), "")
        _s = "عميل" if (d.get("side") or "") == "client" else "مقاول"
        _a = "إضافة" if d["action"] == "add" else "حذف"
        d["type_ar"] = f"{_s} / {_a}" + (
            f" — {d['subcontractor_name']}" if d["subcontractor_name"]
            and _s == "مقاول" else "")
        out.append(d)
    return out


def remove_part(part_id: int) -> None:
    """يحذف سطرًا من مسودة الأمر التغييري (قبل التنفيذ/الاعتماد فقط)."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM addendum_items WHERE id=?",
                           (int(part_id),)).fetchone()
        if row is None:
            raise ValidationError("السطر غير موجود.")
        if int(row["applied"] or 0):
            raise ValidationError("تم تنفيذ السطر — لا يمكن حذفه.")
        aid = int(row["addendum_id"])
        conn.execute("DELETE FROM addendum_items WHERE id=?", (int(part_id),))
    _refresh_counts(aid)


def totals(addendum_id: int) -> dict:
    """مجاميع الأمر: إضافات/خصومات لكل جهة + الصافي."""
    out = {"client": {"add": 0.0, "deduct": 0.0, "add_n": 0, "del_n": 0,
                      "net": 0.0},
           "sub": {"add": 0.0, "deduct": 0.0, "add_n": 0, "del_n": 0,
                   "net": 0.0}}
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT side, action, COALESCE(SUM(amount),0) AS s, COUNT(*) AS n "
            "FROM addendum_items WHERE addendum_id=? AND side IN ('client','sub')"
            " GROUP BY side, action", (int(addendum_id),)).fetchall()
    for r in rows:
        side = r["side"] if r["side"] in out else "client"
        if r["action"] == "add":
            out[side]["add"] = _round(r["s"])
            out[side]["add_n"] = int(r["n"])
        elif r["action"] == "delete":
            out[side]["deduct"] = _round(r["s"])
            out[side]["del_n"] = int(r["n"])
    for side in out:
        out[side]["net"] = _round(out[side]["add"] - out[side]["deduct"])
    out["net_client"] = out["client"]["net"]
    out["net_sub"] = out["sub"]["net"]
    return out


def lc_value(contract_id: int) -> dict:
    """قيمة العقد الحالية (أصلية + ملحقات) بلا استيراد دائري."""
    from services.lifecycle_service import contract_current_value
    return contract_current_value(contract_id)


def _refresh_counts(addendum_id: int) -> None:
    with get_connection() as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM addendum_items WHERE addendum_id=? "
            "AND action IN ('add','delete')",
            (int(addendum_id),)).fetchone()[0]
        conn.execute("UPDATE addendums SET items_count=? WHERE id=?",
                     (int(n), int(addendum_id)))


def sync_header(addendum_id: int, adate: str = "", reason: str = "",
                description: str = "", addendum_type: str = "",
                sub_contract_id: int | None = None) -> None:
    """يثبّت بيانات رأس الأمر التغييري قبل الاعتماد (تاريخ/سبب/نوع/جهة)."""
    aid = int(addendum_id)
    row = _addendum(aid)
    if row.get("applied_at"):
        raise ValidationError("تم تنفيذ الأمر — لا يمكن تعديل رأسه.")
    t = totals(aid)
    has_client = (t["client"]["add_n"] + t["client"]["del_n"]) > 0
    has_sub = (t["sub"]["add_n"] + t["sub"]["del_n"]) > 0
    side = "client" if has_client else ("sub" if has_sub else "client")
    sets = ["adate=?", "reason=?", "description=?", "addendum_type=?",
            "side=?", "sub_contract_id=?"]
    params: list = [adate or row.get("adate") or date.today().isoformat(),
                    reason or row.get("reason") or "",
                    description if description is not None else
                    (row.get("description") or ""),
                    addendum_type or row.get("addendum_type")
                    or "أمر تغييري", side,
                    int(sub_contract_id or row.get("sub_contract_id") or 0)
                    or None]
    with get_connection() as conn:
        conn.execute("UPDATE addendums SET " + ", ".join(sets)
                     + " WHERE id=?", tuple(params) + (aid,))
        if not has_client:
            # كل الأجزاء لجهة المقاول: نثبّت عقد الباطن على الأسطر أيضًا
            conn.execute(
                "UPDATE addendum_items SET sub_contract_id=COALESCE("
                "sub_contract_id, (SELECT sub_contract_id FROM addendums "
                "WHERE id=?)) WHERE addendum_id=? AND side='sub'",
                (aid, aid))


# ============================================================
# التنفيذ على العقد / عقد الباطن
# ============================================================
def apply_parts(addendum_id: int) -> dict:
    """ينفّذ بنود الأمر التغييري (يُنادى عند الاعتماد).

    V8.9: يدعم plan/stage بجانب boq.
    عميل: يضيف بنودًا لعقد العميل، ويوسم المحذوف «محذوف بأمر تغييري»،
           ويثبّت قيم صافي التعديل على الملحق (amount_add/amount_deduct).
    مقاول: يضيف/يزيل روابط بنود عقد الباطن ويعدّل قيمته.
    """
    aid = int(addendum_id)
    row = _addendum(aid)
    if row.get("applied_at"):
        return {"already": True, "items": 0}
    parts = list_parts(aid)
    if not parts:
        return {"already": False, "items": 0}
    t = totals(aid)
    today = date.today().isoformat()
    contract_id = int(row["contract_id"])
    # قيمة عقد الباطن لا تصبح صفرًا أو سالبة بسبب خصم
    _part_nets: dict[int, float] = {}
    for _p in parts:
        if (_p.get("side") or "") != "sub":
            continue
        _sid0 = int(_p.get("sub_contract_id") or 0)
        if not _sid0:
            continue
        _amt0 = _round(_p.get("amount") or 0)
        _part_nets[_sid0] = _round(
            _part_nets.get(_sid0, 0.0)
            + (_amt0 if _p.get("action") == "add" else -_amt0))
    for _sid0, _net0 in _part_nets.items():
        if _net0 >= 0:
            continue
        with get_connection() as conn:
            _cv = conn.execute("SELECT amount FROM sub_contracts WHERE id=?",
                               (_sid0,)).fetchone()
        _cv = _round(_cv["amount"] if _cv else 0)
        if _cv + _net0 <= 0.0005:
            raise ValidationError(
                "خصم المقاول (%.3f) لا يمكن تطبيقه: قيمة عقد الباطن "
                "(%.3f) ستصبح صفرًا أو سالبة — راجع البنود المحذوفة "
                "أو عدّل قيمة عقد الباطن أولًا." % (-_net0, _cv))
    # خصم جهة العميل لا يجعل قيمة العقد أقل من المحصّل فعليًا
    if t["client"]["deduct"] > 0:
        try:
            base = float(lc_value(contract_id)["current"])
        except Exception:
            base = 0.0
        new_value = base + t["client"]["add"] - t["client"]["deduct"]
        with get_connection() as conn:
            collected = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers WHERE "
                "contract_id=? AND vtype='receipt' AND cancelled=0",
                (contract_id,)).fetchone()[0])
        if new_value < collected - 0.001:
            raise ValidationError(
                "لا يمكن تنفيذ الخصم · ستصبح قيمة العقد "
                f"({new_value:,.3f}) أقل من المحصّل فعليًا "
                f"({collected:,.3f}).")
    unlinked: list[tuple] = []
    with get_connection() as conn:
        # V6.2: أجزاء لمقاول بلا عقد باطن ⇒ يُنشأ له عقد بقيمة تعديلات الأمر
        _created: dict[int, int] = {}
        _inserted: set[int] = set()
        for p in parts:
            if (p.get("side") or "") != "sub" or p.get("action") != "add":
                continue
            if int(p.get("sub_contract_id") or 0):
                continue
            _sct = int(p.get("subcontractor_id") or 0)
            if not _sct:
                continue
            if _sct not in _created:
                _exist = conn.execute(
                    "SELECT id FROM sub_contracts WHERE subcontractor_id=? "
                    "AND contract_id=? AND status != 'ملغى' ORDER BY id "
                    "LIMIT 1", (_sct, contract_id)).fetchone()
                if _exist:
                    _created[_sct] = int(_exist["id"])
                else:
                    _net_new = _round(sum(
                        (float(x.get("amount") or 0)
                         if x.get("action") == "add"
                         else -float(x.get("amount") or 0))
                        for x in parts
                        if (x.get("side") or "") == "sub"
                        and int(x.get("subcontractor_id") or 0) == _sct
                        and not int(x.get("sub_contract_id") or 0)))
                    if _net_new <= 0.0005:
                        continue
                    _prj = conn.execute(
                        "SELECT project_id FROM contracts WHERE id=?",
                        (contract_id,)).fetchone()
                    _why = (row.get("reason") or "").strip()
                    _c = conn.execute(
                        "INSERT INTO sub_contracts (subcontractor_id, "
                        "contract_id, project_id, amount, start_date, "
                        "end_date, description, status) "
                        "VALUES (?, ?, ?, ?, '', '', ?, 'نشط')",
                        (_sct, contract_id,
                         _prj["project_id"] if _prj else None, _net_new,
                         ("عقد باطن — من أمر تغييري" +
                          (f": {_why}" if _why else ""))))
                    _created[_sct] = int(_c.lastrowid)
                    _inserted.add(_created[_sct])
                    log_event(contract_id, "عقد باطن من أمر تغييري",
                              f"{_net_new:,.3f}")
            if _sct in _created:
                p["sub_contract_id"] = _created[_sct]
                conn.execute(
                    "UPDATE addendum_items SET sub_contract_id=? WHERE id=?",
                    (int(_created[_sct]), int(p["id"])))
        _new_sids = set(_inserted)
        for p in parts:
            part_id = int(p["id"])
            side = p["side"]
            bid = int(p["boq_item_id"] or 0)
            _rk = (p.get("ref_kind") or "").strip()
            _rid = int(p.get("ref_id") or 0)
            # V8.9: تطبيع — لو ref_kind فاضي و bid موجود
            if bid and not _rk:
                _rk, _rid = "boq", bid
            if side == "client":
                if p["action"] == "add":
                    created = 0
                    if _rk == "boq" and bid:
                        # بند موجود (محذوف بأمر سابق) → يُعاد للخدمة
                        prev = conn.execute(
                            "SELECT COALESCE(deleted_addendum_id,0) AS d "
                            "FROM boq_items WHERE id=?", (bid,)).fetchone()
                        conn.execute(
                            "UPDATE boq_items SET deleted_addendum_id=NULL, "
                            "deleted_at='' WHERE id=?", (bid,))
                        conn.execute(
                            "UPDATE addendum_items SET restore_deleted_by=? "
                            "WHERE id=?",
                            (int(prev["d"] or 0) if prev else 0, part_id))
                    elif _rk == "plan" and _rid:
                        # V8.9: إعادة دفعة محذوفة بأمر سابق
                        prev = conn.execute(
                            "SELECT COALESCE(deleted_addendum_id,0) AS d "
                            "FROM payment_plan WHERE id=?", (_rid,)).fetchone()
                        conn.execute(
                            "UPDATE payment_plan SET deleted_addendum_id=NULL "
                            "WHERE id=?", (_rid,))
                        conn.execute(
                            "UPDATE addendum_items SET restore_deleted_by=? "
                            "WHERE id=?",
                            (int(prev["d"] or 0) if prev else 0, part_id))
                    elif _rk == "stage" and _rid:
                        # V8.9: إعادة مرحلة محذوفة بأمر سابق
                        prev = conn.execute(
                            "SELECT COALESCE(deleted_addendum_id,0) AS d "
                            "FROM contract_stages WHERE id=?", (_rid,)).fetchone()
                        conn.execute(
                            "UPDATE contract_stages SET deleted_addendum_id=NULL "
                            "WHERE id=?", (_rid,))
                        conn.execute(
                            "UPDATE addendum_items SET restore_deleted_by=? "
                            "WHERE id=?",
                            (int(prev["d"] or 0) if prev else 0, part_id))
                    else:
                        # بند يدوي جديد → يُنشأ في boq_items
                        cur = conn.execute(
                            "INSERT INTO boq_items (contract_id, description, "
                            "qty, unit, unit_price) VALUES (?,?,?,?,?)",
                            (contract_id, p["description"], p["qty"],
                             p["unit"] or "", p["unit_price"]))
                        bid = int(cur.lastrowid)
                        created = 1
                        conn.execute(
                            "UPDATE addendum_items SET boq_item_id=?, "
                            "ref_kind='boq', ref_id=?, "
                            "created_item=? WHERE id=?",
                            (bid, bid, created, part_id))
                else:                     # delete
                    if _rk == "boq" and bid:
                        # فك أي ارتباط بعقود باطن أولًا (يُسجّل للإرجاع)
                        for lk in conn.execute(
                                "SELECT sub_contract_id FROM sub_contract_items "
                                "WHERE boq_item_id=?", (bid,)).fetchall():
                            sid = int(lk["sub_contract_id"])
                            um = conn.execute(
                                "SELECT COALESCE(SUM(ai.amount),0) AS s FROM "
                                "addendum_items ai WHERE ai.addendum_id=? AND "
                                "ai.side='sub' AND ai.action='add' AND "
                                "ai.boq_item_id=?",
                                (aid, bid)).fetchone()
                            conn.execute(
                                "INSERT INTO addendum_items (addendum_id, side, "
                                "action, parent_part_id, boq_item_id, "
                                "sub_contract_id, description, qty, unit, "
                                "unit_price, amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                                (aid, "sub", "unlink", part_id, bid, sid,
                                 p["description"], p["qty"], p["unit"] or "",
                                 p["unit_price"],
                                 _round(um["s"] if um else 0)))
                            conn.execute(
                                "DELETE FROM sub_contract_items WHERE "
                                "sub_contract_id=? AND boq_item_id=?", (sid, bid))
                        conn.execute(
                            "UPDATE boq_items SET deleted_addendum_id=?, "
                            "deleted_at=? WHERE id=?", (aid, today, bid))
                    elif _rk == "plan" and _rid:
                        # V8.9: حذف ناعم للدفعة
                        conn.execute(
                            "UPDATE payment_plan SET deleted_addendum_id=? "
                            "WHERE id=?", (aid, _rid))
                        # فك ارتباط مقاول إن وجد
                        for lk in conn.execute(
                                "SELECT sci.sub_contract_id, sci.id AS sci_id "
                                "FROM sub_contract_items sci "
                                "WHERE sci.source_kind='plan' AND sci.source_id=?",
                                (_rid,)).fetchall():
                            sid = int(lk["sub_contract_id"])
                            conn.execute(
                                "INSERT INTO addendum_items (addendum_id, side, "
                                "action, parent_part_id, ref_kind, ref_id, "
                                "sub_contract_id, description, qty, unit, "
                                "unit_price, amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                (aid, "sub", "unlink", part_id, "plan", _rid,
                                 sid, p["description"], p["qty"], p["unit"] or "",
                                 p["unit_price"], 0.0))
                            conn.execute(
                                "DELETE FROM sub_contract_items WHERE id=?",
                                (int(lk["sci_id"]),))
                    elif _rk == "stage" and _rid:
                        # V8.9: حذف ناعم للمرحلة
                        conn.execute(
                            "UPDATE contract_stages SET deleted_addendum_id=? "
                            "WHERE id=?", (aid, _rid))
                        # فك ارتباط مقاول إن وجد
                        for lk in conn.execute(
                                "SELECT sci.sub_contract_id, sci.id AS sci_id "
                                "FROM sub_contract_items sci "
                                "WHERE sci.source_kind='stage' AND sci.source_id=?",
                                (_rid,)).fetchall():
                            sid = int(lk["sub_contract_id"])
                            conn.execute(
                                "INSERT INTO addendum_items (addendum_id, side, "
                                "action, parent_part_id, ref_kind, ref_id, "
                                "sub_contract_id, description, qty, unit, "
                                "unit_price, amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                (aid, "sub", "unlink", part_id, "stage", _rid,
                                 sid, p["description"], p["qty"], p["unit"] or "",
                                 p["unit_price"], 0.0))
                            conn.execute(
                                "DELETE FROM sub_contract_items WHERE id=?",
                                (int(lk["sci_id"]),))
            else:                          # side == "sub"
                sid = int(p["sub_contract_id"] or row.get("sub_contract_id")
                          or 0)
                if not sid:
                    continue
                # V8.8: بند يدوي للمقاول — يُنشأ بند في العقد أولًا
                if not bid and not _rk and p["action"] == "add":
                    cur = conn.execute(
                        "INSERT INTO boq_items (contract_id, description, "
                        "qty, unit, unit_price) VALUES (?,?,?,?,?)",
                        (contract_id, p["description"], p["qty"],
                         p["unit"] or "", p["unit_price"]))
                    bid = int(cur.lastrowid)
                    _rk, _rid = "boq", bid
                    conn.execute(
                        "UPDATE addendum_items SET boq_item_id=?, "
                        "ref_kind='boq', ref_id=?, "
                        "created_item=1 WHERE id=?", (bid, bid, part_id))
                if p["action"] == "add":
                    if _rk == "boq" and bid:
                        exists = conn.execute(
                            "SELECT 1 FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND boq_item_id=?",
                            (sid, bid)).fetchone()
                        if not exists:
                            conn.execute(
                                "INSERT INTO sub_contract_items "
                                "(sub_contract_id, boq_item_id) VALUES (?,?)",
                                (sid, bid))
                    elif _rk in ("plan", "stage") and _rid:
                        # V8.9: إسناد دفعة/مرحلة لمقاول
                        exists = conn.execute(
                            "SELECT 1 FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND source_kind=? AND source_id=?",
                            (sid, _rk, _rid)).fetchone()
                        if not exists:
                            conn.execute(
                                "INSERT INTO sub_contract_items "
                                "(sub_contract_id, boq_item_id, source_kind, "
                                "source_id, qty, unit_price, amount) "
                                "VALUES (?,?,?,?,?,?,?)",
                                (sid, None, _rk, _rid,
                                 float(p.get("qty") or 1.0),
                                 float(p.get("unit_price") or 0.0),
                                 float(p.get("amount") or 0.0)))
                else:  # delete
                    if _rk == "boq" and bid:
                        conn.execute(
                            "DELETE FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND boq_item_id=?", (sid, bid))
                    elif _rk in ("plan", "stage") and _rid:
                        conn.execute(
                            "DELETE FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND source_kind=? AND source_id=?",
                            (sid, _rk, _rid))
        conn.execute("UPDATE addendum_items SET applied=1 WHERE "
                     "addendum_id=? AND action IN ('add','delete','unlink')",
                     (aid,))
        conn.execute(
            "UPDATE addendums SET applied_at=?, items_count=?, "
            "amount_add=?, amount_deduct=? WHERE id=?",
            (today, len(parts), t["client"]["add"], t["client"]["deduct"],
             aid))
        # قيمة كل عقد باطن تتحرك بصافي أجزائه
        _nets: dict[int, float] = {}
        for p in parts:
            if (p.get("side") or "") != "sub":
                continue
            sid = int(p.get("sub_contract_id") or 0)
            if not sid or sid in _new_sids:
                continue
            _amt = float(p.get("amount") or 0)
            _nets[sid] = _round(_nets.get(sid, 0.0)
                                + (_amt if p.get("action") == "add" else -_amt))
        for sid, _net in _nets.items():
            if abs(_net) > 0.0005:
                conn.execute(
                    "UPDATE sub_contracts SET amount=ROUND(amount+?,3) "
                    "WHERE id=?", (_net, sid))
        _head_sid = next((int(p.get("sub_contract_id") or 0) for p in parts
                          if (p.get("side") or "") == "sub"
                          and int(p.get("sub_contract_id") or 0)), 0)
        if _head_sid:
            conn.execute("UPDATE addendums SET sub_contract_id=? WHERE id=?",
                         (_head_sid, aid))
        for p in parts:
            if p["side"] == "sub" and p["sub_contract_id"]:
                unlinked.append((int(p["sub_contract_id"]),))
    log_event(contract_id, "تنفيذ أمر تغييري",
              "%s · عميل: +%s/−%s · مقاول: +%s/−%s"
              % (row.get("addendum_number") or aid,
                 f"{t['client']['add']:,.3f}", f"{t['client']['deduct']:,.3f}",
                 f"{t['sub']['add']:,.3f}", f"{t['sub']['deduct']:,.3f}"))
    return {"already": False, "items": len(parts),
            "client_add": t["client"]["add"],
            "client_deduct": t["client"]["deduct"],
            "sub_net": t["sub"]["net"]}


def restore_parts(addendum_id: int) -> dict:
    """يرجّع أثر الأمر التغييري عند إلغائه (البند المحذوف يعود كما كان).

    V8.9: يدعم plan/stage بجانب boq.
    """
    aid = int(addendum_id)
    row = _addendum(aid)
    if not row.get("applied_at"):
        return {"restored": 0}
    t = totals(aid)
    contract_id = int(row["contract_id"])
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM addendum_items WHERE addendum_id=? ORDER BY id",
            (aid,)).fetchall()]
        n = 0
        for p in rows:
            side, action = p["side"], p["action"]
            bid = int(p["boq_item_id"] or 0)
            _rk = (p.get("ref_kind") or "").strip()
            _rid = int(p.get("ref_id") or 0)
            if bid and not _rk:
                _rk, _rid = "boq", bid
            if side == "client" and action == "add":
                if _rk == "boq" and bid:
                    if p["created_item"]:
                        conn.execute("DELETE FROM boq_items WHERE id=?", (bid,))
                    else:
                        conn.execute(
                            "UPDATE boq_items SET deleted_addendum_id=NULLIF("
                            "?,0), deleted_at='' WHERE id=?",
                            (int(p["restore_deleted_by"] or 0), bid))
                elif _rk == "plan" and _rid:
                    # V8.9: إرجاع دفعة محذوفة
                    conn.execute(
                        "UPDATE payment_plan SET deleted_addendum_id=NULLIF("
                        "?,0) WHERE id=?",
                        (int(p["restore_deleted_by"] or 0), _rid))
                elif _rk == "stage" and _rid:
                    # V8.9: إرجاع مرحلة محذوفة
                    conn.execute(
                        "UPDATE contract_stages SET deleted_addendum_id=NULLIF("
                        "?,0) WHERE id=?",
                        (int(p["restore_deleted_by"] or 0), _rid))
                n += 1
            elif side == "client" and action == "delete":
                if _rk == "boq" and bid:
                    conn.execute(
                        "UPDATE boq_items SET deleted_addendum_id=NULL, "
                        "deleted_at='' WHERE id=?", (bid,))
                elif _rk == "plan" and _rid:
                    conn.execute(
                        "UPDATE payment_plan SET deleted_addendum_id=NULL "
                        "WHERE id=?", (_rid,))
                elif _rk == "stage" and _rid:
                    conn.execute(
                        "UPDATE contract_stages SET deleted_addendum_id=NULL "
                        "WHERE id=?", (_rid,))
                n += 1
            elif side == "sub" and action == "unlink":
                sid = int(p["sub_contract_id"] or 0)
                if sid:
                    if _rk == "boq" and bid:
                        exists = conn.execute(
                            "SELECT 1 FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND boq_item_id=?",
                            (sid, bid)).fetchone()
                        if not exists:
                            conn.execute(
                                "INSERT INTO sub_contract_items "
                                "(sub_contract_id, boq_item_id) VALUES (?,?)",
                                (sid, bid))
                    elif _rk in ("plan", "stage") and _rid:
                        exists = conn.execute(
                            "SELECT 1 FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND source_kind=? AND source_id=?",
                            (sid, _rk, _rid)).fetchone()
                        if not exists:
                            conn.execute(
                                "INSERT INTO sub_contract_items "
                                "(sub_contract_id, source_kind, source_id) "
                                "VALUES (?,?,?)",
                                (sid, _rk, _rid))
                    n += 1
            elif side == "sub" and action in ("add", "delete"):
                sid = int(p["sub_contract_id"] or
                          row.get("sub_contract_id") or 0)
                if not sid:
                    continue
                if action == "add" and p.get("created_item") and bid:
                    conn.execute(
                        "DELETE FROM sub_contract_items WHERE "
                        "sub_contract_id=? AND boq_item_id=?", (sid, bid))
                    conn.execute("DELETE FROM boq_items WHERE id=?", (bid,))
                    n += 1
                    continue
                if action == "add":
                    if _rk == "boq" and bid:
                        conn.execute(
                            "DELETE FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND boq_item_id=?", (sid, bid))
                    elif _rk in ("plan", "stage") and _rid:
                        conn.execute(
                            "DELETE FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND source_kind=? AND source_id=?",
                            (sid, _rk, _rid))
                else:  # delete → إعادة الرابط
                    if _rk == "boq" and bid:
                        exists = conn.execute(
                            "SELECT 1 FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND boq_item_id=?",
                            (sid, bid)).fetchone()
                        if not exists:
                            conn.execute(
                                "INSERT INTO sub_contract_items "
                                "(sub_contract_id, boq_item_id) VALUES (?,?)",
                                (sid, bid))
                    elif _rk in ("plan", "stage") and _rid:
                        exists = conn.execute(
                            "SELECT 1 FROM sub_contract_items WHERE "
                            "sub_contract_id=? AND source_kind=? AND source_id=?",
                            (sid, _rk, _rid)).fetchone()
                        if not exists:
                            conn.execute(
                                "INSERT INTO sub_contract_items "
                                "(sub_contract_id, source_kind, source_id) "
                                "VALUES (?,?,?)",
                                (sid, _rk, _rid))
                n += 1
        sub_id = int(row.get("sub_contract_id") or 0)
        if sub_id and abs(t["sub"]["net"]) > 0.0005:
            conn.execute(
                "UPDATE sub_contracts SET amount=ROUND(amount-?,3) WHERE id=?",
                (t["sub"]["net"], sub_id))
        conn.execute(
            "UPDATE addendums SET applied_at='', amount_add=0, "
            "amount_deduct=0 WHERE id=?", (aid,))
    log_event(contract_id, "إرجاع بنود أمر تغييري ملغى",
              "%s · أُعيد %d بند/رابط" % (row.get("addendum_number") or aid, n))
    return {"restored": n}


