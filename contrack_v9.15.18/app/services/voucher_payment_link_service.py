# -*- coding: utf-8 -*-
"""V6.2 · منطق مشترك لربط السندات بالدفعات (سند القبض · سند الصرف).

الفكرة: نفس الكود يُستخدم في السندين — الفرق **المصدر** فقط:

    سند القبض  → «دفعاتنا على العميل»  (payment_plan)
    سند الصرف  → «دفعات المقاولين علينا» (sub_payment_plan)

الربط يُخزَّن كعلاقة بمعرّف الخط لا بنص (جدول ``voucher_payment_links``)،
ويسمح بتوزيع الزيادة على أكثر من خط (كل خط بصف مستقل).

هذه الوحدة لا تعتمد على PySide6 ولا تعرف شيئًا عن الواجهة، وتُستدعى من
الواجهة (لعرض المستحق والاختيار والتعبئة التلقائية) ومن
``lifecycle_service`` لحظة حفظ السند (نفس الـtransaction).
"""
from __future__ import annotations

import re

from database.database import get_connection
from services.customer_service import ValidationError

KINDS = ("receipt", "payment")
# الحالات التي تعني «مرحلة الدفعة وصلت وباقي عليها مبلغ»
_REACHED = ("مستحقة", "متأخر", "جزئي", "مستحق قريبًا")


# ============================================================
# مفتاح الإعداد الاختياري (بوابة تحصيل العميل قبل الصرف للمقاول)
# ============================================================
def gate_enabled() -> bool:
    """هل تُشترط «تحصيل العميل» قبل اعتبار دفعة المقاول مستحقة؟"""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COALESCE(sub_pay_client_gate,1) AS g FROM settings "
                "WHERE id=1").fetchone()
        return bool(row["g"]) if row else True
    except Exception:
        return True


def set_gate(enabled: bool) -> None:
    """تفعيل/إيقاف البوابة من شاشة الإعدادات."""
    with get_connection() as conn:
        conn.execute("UPDATE settings SET sub_pay_client_gate=? WHERE id=1",
                     (1 if enabled else 0,))


# ============================================================
# أدوات
# ============================================================
def _ordinal_i(n: int) -> str:
    words = ("الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة",
             "السابعة", "الثامنة", "التاسعة", "العاشرة")
    if 1 <= int(n) <= len(words):
        return words[int(n) - 1]
    return f"رقم {int(n)}"


_ORD_WORDS = {"الأولي": 1, "الأولى": 1, "الثانية": 2, "الثالثة": 3,
              "الرابعة": 4, "الخامسة": 5, "السادسة": 6, "السابعة": 7,
              "الثامنة": 8, "التاسعة": 9, "العاشرة": 10}


def _title_number(title: str):
    """رقم الدفعة من اسمها نفسها («الدفعة الرابعة» ⇒ 4) وإلا None."""
    import re
    t = (title or "").strip()
    m = re.search(r"(?:الدفعة|دفعة)\s*(\d+)", t)
    if m:
        return int(m.group(1))
    for w, n in _ORD_WORDS.items():
        if f"الدفعة {w}" in t or f"دفعة {w}" in t:
            return n
    return None


def _f(x) -> float:
    try:
        return round(float(x or 0), 3)
    except Exception:
        return 0.0


def _reached(item: dict) -> bool:
    """هل وصلت مرحلة الدفعة؟ (بحثت عن البنود غير المرحَّلة والمتخطاة)"""
    status = (item.get("status") or "").strip()
    if status in ("مدفوع", "لم يحل", "بانتظار إنجاز المرحلة",
                  "مرحلة متخطاة"):
        return False
    if status == "مستحق قريبًا":
        return bool((item.get("triggered_at") or "").strip())
    return status in _REACHED


# ============================================================
# صفوف خطة الدفعات (المصدر بحسب نوع السند)
# ============================================================
def plan_rows(kind: str, contract_id: int | None = None,
              sub_contract_id: int | None = None,
              exclude_voucher_id: int | None = None) -> list[dict]:
    """كل صفوف الخطة مع رقمها وترتيبها وحالتها — بلا فلترة.

    * ``eligible`` = مستحقة الآن (مرحلتها وصلت وباقي عليها مبلغ).
    * ``gated``    = موقوفة مؤقتًا بانتظار تحصيل دفعة العميل المقابلة
                     (سند الصرف فقط · وعند تفعيل المفتاح من الإعدادات).
    """
    from services import lifecycle_service as lc
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        raise ValidationError("نوع الربط غير صحيح.")
    sub_cancelled = False
    if kind == "receipt":
        if not contract_id:
            return []
        items = (lc.contract_payment_plan_excluding(int(contract_id),
                                                    int(exclude_voucher_id))
                 if exclude_voucher_id else
                 lc.contract_payment_plan(int(contract_id)))
        client_map = {}
    else:
        if not sub_contract_id:
            return []
        items = (lc.sub_payment_plan_excluding(int(sub_contract_id),
                                               int(exclude_voucher_id))
                 if exclude_voucher_id else
                 lc.sub_payment_plan(int(sub_contract_id)))
        try:
            src_map = lc.sub_source_ids(int(sub_contract_id))
        except Exception:
            src_map = {}
        sc = {}
        try:
            row = lc.get_sub_contract(int(sub_contract_id))
            sc = dict(row) if row else {}
        except Exception:
            sc = {}
        cid = int(sc.get("contract_id") or 0)
        sub_cancelled = (sc.get("status") or "").strip() == "ملغى"
        client_map = {int(x["id"]): x
                      for x in (lc.contract_payment_plan(cid) if cid else [])}
        gate = gate_enabled()

    out: list[dict] = []
    for i, item in enumerate(items, start=1):
        _title = (item.get("title") or "").strip() or f"دفعة {i}"
        row = {
            "line_id": int(item["id"]),
            "number": _title_number(_title) or i,
            "sort_order": int(item.get("sort_order") or i),
            "title": (item.get("title") or "").strip() or f"دفعة {i}",
            "stage": (item.get("stage_name") or "").strip(),
            "stage_id": item.get("stage_id"),
            "due_date": item.get("due_date") or "",
            "amount": _f(item.get("amount")),
            "paid": _f(item.get("covered")),
            "remaining": _f(item.get("remaining")),
            "status": (item.get("status") or "").strip(),
            "eligible": bool(_reached(item)
                             and _f(item.get("remaining")) > 0.001),
            "gated": False,
            "gate_reason": "",
            "cancelled": False,
        }
        if kind == "payment" and row["eligible"] and gate:
            try:
                srcs = [int(x) for x in (src_map.get(row["line_id"]) or [])]
            except Exception:
                srcs = []
            if srcs:
                uncollected = [client_map.get(s) or {} for s in srcs]
                pending = [x for x in uncollected
                           if _f((x or {}).get("remaining")) > 0.001]
                if pending:
                    row["gated"] = True
                    names = "، ".join((x.get("title") or "") for x in pending)
                    row["gate_reason"] = (
                        "بانتظار تحصيل دفعة العميل"
                        + (f" «{names}»" if names else "")
                        + " — لا يمكن الصرف للمقاول قبل تحصيلها.")
        if kind == "payment" and sub_cancelled:
            # عقد الباطن ملغى: الخط يظهر بحالة «ملغى»، لا يُحدَّد ولا يُصرف عليه
            row["status"] = "ملغى"
            row["eligible"] = False
            row["gated"] = False
            row["cancelled"] = True
        out.append(row)
    return out


def due_lines(kind: str, contract_id: int | None = None,
              sub_contract_id: int | None = None,
              include_gated: bool = True,
              exclude_voucher_id: int | None = None) -> list[dict]:
    """الصفوف المستحقة فقط — ما يُعرض في جدول «ربط بدفعة مستحقة»."""
    rows = plan_rows(kind, contract_id, sub_contract_id,
                     exclude_voucher_id=exclude_voucher_id)
    out = [r for r in rows if r["eligible"] and (include_gated or not r["gated"])]
    return out


def default_line(rows: list[dict]) -> dict | None:
    """الافتراضي = أقدم دفعة مستحقة غير موقوفة (وإلا أقدم مستحقة)."""
    ok = [r for r in (rows or []) if not r.get("gated")]
    if ok:
        return ok[0]
    return (rows or [None])[0]


def selection_summary(kind: str, line: dict, amount: float,
                      candidates: list[dict] | None = None) -> dict:
    """ملخص الاختيار قبل الحفظ: يوزَّع كم؟ وهل تبقى زيادة؟"""
    amount = _f(amount)
    rem = _f((line or {}).get("remaining"))
    first = min(amount, rem)
    rest = _f(amount - first)
    others = [r for r in (candidates or [])
              if int(r.get("line_id") or 0) != int((line or {}).get("line_id") or 0)
              and not r.get("gated")]
    spread = []
    for r in others:
        if rest <= 0.0005:
            break
        take = min(rest, _f(r["remaining"]))
        if take > 0.0005:
            spread.append({"line_id": r["line_id"], "amount": take,
                           "title": r.get("title")})
            rest = _f(rest - take)
    return {"amount": amount, "first": first, "spread": spread,
            "advance": max(0.0, rest),
            "exceeds": amount > rem + 0.0005, "remaining": rem}


# ============================================================
# البيان التلقائي (نفس الأسلوب في السندين)
# ============================================================
def describe(kind: str, line: dict, contract_number: str = "",
             contract_name: str = "",
             sub_name: str = "", sub_desc: str = "",
             voucher_amount: float = 0.0) -> str:
    """«سداد رسوم الدفعة الرابعة كاملة» أو «سداد جزء من رسوم الدفعة الرابعة ومتبقي منها X».»"""
    if not line:
        return ""
    _num = int(line.get("number") or 1)
    _ord = _ordinal_i(_num)
    _line_amount = float(line.get("amount") or 0)
    _remaining = float(line.get("remaining") or 0)

    # تحديد نوع السداد — المتبقي AFTER هذا السند
    _after_remaining = max(0.0, _remaining - voucher_amount) if voucher_amount > 0 else _remaining
    if _after_remaining <= 0.0005:
        _status = "كاملة"
    elif _remaining > 0.0005:
        _status = f"ومتبقي منها {_after_remaining:,.3f} د.ك"
    else:
        _status = ""

    # نص المرحلة أو العنوان
    stage = (line.get("stage") or "").strip()
    title = (line.get("title") or "").strip()
    _mid = stage
    if not _mid and title and title not in (
            f"الدفعة {_ord}", f"دفعة {_ord}", f"دفعة {_num}",
            f"الدفعة {_num}"):
        _mid = title

    # بناء البيان
    if _status:
        parts = [f"سداد رسوم الدفعة {_ord}"]
        if _mid:
            parts.append(_mid)
        parts.append(_status)
    else:
        word = "قبض" if kind == "receipt" else "صرف"
        parts = [f"{word} الدفعة {_ord}"]
        if _mid:
            parts.append(_mid)

    # إضافة اسم العقد بدلاً من الرقم
    if contract_name:
        parts.append(contract_name)
    elif contract_number:
        parts.append(contract_number)

    if kind == "payment":
        if sub_name:
            parts.append(f"المقاول {sub_name}")
        if sub_desc:
            parts.append(f"عقد باطن {sub_desc}")

    return " – ".join(parts)


# ============================================================
# الربط الفعلي (داخل transaction حفظ السند)
# ============================================================
def _insert(conn, voucher_id: int, kind: str, line_id: int,
            amount: float) -> None:
    conn.execute(
        "INSERT INTO voucher_payment_links (voucher_id, kind, line_id, "
        "amount) VALUES (?,?,?,?)",
        (int(voucher_id), kind, int(line_id), round(float(amount), 3)))


def _linked_other(conn, kind: str, line_id: int,
                  exclude_voucher: int | None = None) -> float:
    sql = ("SELECT COALESCE(SUM(l.amount),0) AS s "
           "FROM voucher_payment_links l JOIN vouchers v ON v.id=l.voucher_id "
           "WHERE l.kind=? AND l.line_id=? AND COALESCE(v.cancelled,0)=0")
    args: list = [kind, int(line_id)]
    if exclude_voucher:
        sql += " AND l.voucher_id<>?"
        args.append(int(exclude_voucher))
    return _f(conn.execute(sql, args).fetchone()["s"])


def _line_amount(conn, kind: str, line_id: int) -> float | None:
    table = "payment_plan" if kind == "receipt" else "sub_payment_plan"
    row = conn.execute(f"SELECT amount FROM {table} WHERE id=?",
                       (int(line_id),)).fetchone()
    return _f(row["amount"]) if row else None


def room_for(conn, kind: str, line_id: int, remaining: float | None = None,
             exclude_voucher: int | None = None) -> float:
    """المساحة المتاحة للربط على الخط: أصغر من (قيمة الخط − المربوط)
    ومن المتبقي المحسوب من حالة الخطة لحظة العرض (يحترم التوزيع القديم)."""
    total = _line_amount(conn, kind, line_id)
    if total is None:
        raise ValidationError("الدفعة المحددة غير موجودة.")
    linked = _linked_other(conn, kind, line_id, exclude_voucher=exclude_voucher)
    room = max(0.0, _f(total - linked))
    if remaining is not None:
        room = min(room, max(0.0, _f(remaining)))
    return room


def reverse_links(conn, voucher_id: int) -> int:
    """يمسح روابط السند — فيرجع كل خط لحالته السابقة تلقائيًا
    (الحالات محسوبة من البيانات لا مخزَّنة)."""
    cur = conn.execute("DELETE FROM voucher_payment_links WHERE voucher_id=?",
                       (int(voucher_id),))
    return int(cur.rowcount or 0)


def validate_selections(candidates, selections) -> None:
    """يمنع الربط بدفعة غير مستحقة أو مدفوعة بالكامل أو موقوفة بالبوابة."""
    cand = {int(c["line_id"]): c for c in (candidates or [])}
    for sel in (selections or []):
        try:
            line_id = int(sel[0])
        except Exception:
            raise ValidationError("اختيار الدفعة غير صحيح.")
        if _f(sel[1]) <= 0.0005:
            continue
        c = cand.get(line_id)
        if c is None:
            raise ValidationError(
                "الدفعة المحددة غير مستحقة أو مدفوعة بالكامل — اختر دفعة "
                "من جدول «الدفعات المستحقة».")
        if c.get("gated"):
            raise ValidationError(
                c.get("gate_reason")
                or "الدفعة موقوفة بانتظار تحصيل دفعة العميل المقابلة.")
    ids = [int(s[0]) for s in (selections or []) if _f(s[1]) > 0.0005]
    err = check_selection(candidates, ids)
    if err:
        raise ValidationError(err)


def apply_links(conn, voucher_id: int, kind: str, selections,
                candidates: list[dict] | None = None,
                spread: bool = True) -> dict:
    """يخزّن الربط وينفّذه داخل transaction الحفظ (idempotent).

    ``selections``: [(line_id, amount)] — بترتيب اختيار المستخدم.
    الزيادة فوق المتبقي تُوزَّع على **الدفعات المستحقة التالية** بالترتيب،
    وما يبقى بعدها يُسجَّل رصيدًا/سلفة على السند (``advance_amount``).
    """
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        raise ValidationError("نوع الربط غير صحيح.")
    vid = int(voucher_id)
    # إعادة الحفظ لا تُكرّر الربط
    reverse_links(conn, vid)
    cand = {int(c["line_id"]): c for c in (candidates or [])}
    order = [int(c["line_id"]) for c in (candidates or [])]
    applied: list[dict] = []
    leftovers: list[list] = []            # [[position, remaining_amount], ...]
    for sel in (selections or []):
        try:
            line_id, amt = int(sel[0]), _f(sel[1])
        except Exception:
            continue
        if amt <= 0.0005:
            continue
        remaining = cand[line_id].get("remaining") if line_id in cand else None
        room = room_for(conn, kind, line_id, remaining=remaining)
        take = min(amt, room)
        if take > 0.0005:
            _insert(conn, vid, kind, line_id, take)
            applied.append({"line_id": line_id, "amount": take})
        rest = _f(amt - take)
        if rest > 0.0005:
            leftovers.append([order.index(line_id) if line_id in order else -1,
                              rest])
    if spread:
        used = {int(a["line_id"]) for a in applied}
        for lf in leftovers:
            pos, rest = int(lf[0]), _f(lf[1])
            scan = order[pos + 1:] if pos >= 0 else list(order)
            for line_id in scan:
                if rest <= 0.0005:
                    break
                if (cand.get(line_id) or {}).get("gated"):
                    continue  # الموقوفة تُتخطى في توزيع الزيادة
                if line_id in used:
                    continue
                remaining = (cand.get(line_id) or {}).get("remaining")
                room = room_for(conn, kind, line_id, remaining=remaining)
                take = min(rest, room)
                if take > 0.0005:
                    _insert(conn, vid, kind, line_id, take)
                    applied.append({"line_id": line_id, "amount": take})
                    used.add(line_id)
                    rest = _f(rest - take)
            lf[1] = rest
    advance = _f(sum(_f(lf[1]) for lf in leftovers))
    if advance > 0.0005:
        # رصيد/سلفة على السند — يظهر في التقارير ولا يُنسب لأي دفعة أخرى
        conn.execute("UPDATE vouchers SET advance_amount="
                     "COALESCE(advance_amount,0)+? WHERE id=?",
                     (advance, vid))
    return {"applied": applied, "advance": advance,
            "advance_only": bool(advance > 0.0005 and not applied)}


def voucher_links(voucher_id: int) -> list[dict]:
    """روابط سند معيّن (لتحميل الحالة عند تعديل سند محفوظ)."""
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT l.id, l.kind, l.line_id, l.amount FROM "
            "voucher_payment_links l WHERE l.voucher_id=? ORDER BY l.id",
            (int(voucher_id),)).fetchall()]
    return rows


# ---------------------------------------------------------------------------
# V9.15.17 — الاختيار المتعدد للدفعات: توزيع المبلغ + قاعدة التتابع + البيان
# ---------------------------------------------------------------------------
_PART_ORD = ["", "الثاني", "الثالث", "الرابع", "الخامس", "السادس",
             "السابع", "الثامن", "التاسع", "العاشر"]
_NUM_PREFIX = re.compile(r"^\s*\d+\s*[.\-–)]\s*")
_GENERIC_NAMES = ("", "غير محدد")


def clean_title(title) -> str:
    """عنوان الدفعة بلا ترقيم بادئ («2. دفعة 2» ← «دفعة 2»)."""
    return _NUM_PREFIX.sub("", (title or "").strip()).strip()


def _prev_link_count(line_id, kind, exclude_voucher_id=None) -> int:
    """كم سندًا ساريًا سابقًا ربط هذه الدفعة (لترتيب «الجزء الثاني»…)."""
    with get_connection() as conn:
        r = conn.execute(
            "SELECT COUNT(DISTINCT l.voucher_id) AS n "
            "FROM voucher_payment_links l "
            "JOIN vouchers v ON v.id = l.voucher_id "
            "WHERE l.line_id=? AND l.kind=? AND COALESCE(v.cancelled,0)=0 "
            "AND (? IS NULL OR l.voucher_id <> ?)",
            (int(line_id), kind, exclude_voucher_id,
             exclude_voucher_id)).fetchone()
    return int((r["n"] if r else 0) or 0)


def check_selection(candidates, selected_ids) -> str | None:
    """قاعدة التتابع: المحدد يجب أن يكون بادئة من الدفعات غير المسدّدة بالترتيب.

    يُرجع رسالة الخطأ، أو None إن كان التحديد صحيحًا.
    """
    ids = [int(x) for x in (selected_ids or [])]
    if not ids:
        return None
    order = [int(c["line_id"]) for c in (candidates or [])]
    cand = {int(c["line_id"]): c for c in (candidates or [])}
    for lid in ids:
        c = cand.get(lid)
        if c is None:
            return ("الدفعة المحددة غير مستحقة أو مدفوعة بالكامل — اختر دفعة "
                    "من جدول «الدفعات المستحقة».")
        if c.get("gated"):
            return (c.get("gate_reason")
                    or "الدفعة موقوفة بانتظار تحصيل دفعة العميل المقابلة.")
    # الموقوفة لا تُحدَّد ولا تمنع ما بعدها: التتابع يُحسب على المفتوحة فقط
    open_order = [int(c["line_id"]) for c in (candidates or [])
                  if not c.get("gated")]
    positions = sorted(open_order.index(x) for x in ids)
    if positions != list(range(len(positions))):
        return ("لا يمكن تحديد دفعة مع تخطي دفعة سابقة غير مسدّدة — حدّد "
                "الدفعات بالترتيب، من الأقدم.")
    return None


def distribute(candidates, selected_ids, amount, kind: str = "payment",
               exclude_voucher_id=None, spread: bool = True) -> dict:
    """يوزّع المبلغ الإجمالي على الدفعات المحددة بترتيب الخطة.

    - الدفعة المحددة يجب أن تأخذ مبلغًا أكبر من صفر، وإلا خطأ.
    - الزيادة فوق المحددة تذهب للدفعة المستحقة التالية (إن ``spread``)
      حتى تقف عند دفعة موقوفة، وما يبقى يُرجَّع رصيدًا مقدَّمًا.
    """
    order = list(candidates or [])
    ids = [int(x) for x in (selected_ids or [])]
    err = check_selection(order, ids)
    if err:
        return {"allocs": [], "advance": 0.0, "error": err}
    left = _f(amount)
    if left <= 0.0005:
        return {"allocs": [], "advance": 0.0,
                "error": "أدخل مبلغ السند قبل ربطه بالدفعات."}
    allocs: list[dict] = []
    open_lines = [c for c in order if not c.get("gated")]

    def _take(c):
        nonlocal left
        rem = _f(c.get("remaining"))
        take = min(left, rem)
        if take <= 0.0005:
            return None
        left = _f(left - take)
        full = take >= rem - 0.0005
        prev = _prev_link_count(c["line_id"], kind, exclude_voucher_id)
        return {
            "line_id": int(c["line_id"]),
            "number": c.get("number"),
            "stage": (c.get("stage") or "").strip(),
            "title": c.get("title") or "",
            "amount": take,
            "remaining": rem,
            "full": full,
            "continuation": bool(full and prev > 0),
            "part_ordinal": (_PART_ORD[prev] if (not full and 0 < prev < len(_PART_ORD))
                             else None),
        }

    k = len(ids)
    for c in open_lines[:k]:
        a = _take(c)
        if a is None:
            return {"allocs": [], "advance": 0.0,
                    "error": (f"المبلغ لا يكفي لتغطية الدفعة رقم "
                              f"{c.get('number')} — ألغِ تحديدها أو زد المبلغ.")}
        allocs.append(a)
    if spread and left > 0.0005:
        for c in open_lines[k:]:   # الموقوفة تُتخطى، والتوزيع يكمل بعدها
            if left <= 0.0005:
                break
            a = _take(c)
            if a is not None:
                allocs.append(a)
    return {"allocs": allocs, "advance": max(0.0, _f(left)), "error": ""}


def _alloc_core(a: dict) -> str:
    if a.get("core"):
        return a["core"]
    num = a.get("number")
    stage = (a.get("stage") or "").strip()
    if stage:
        core = f"الدفعة رقم {num} وهي عن أعمال {stage}"
    else:
        core = f"الدفعة رقم {num}"
    if not a.get("full", True):
        core = (f"الجزء {a['part_ordinal']} من {core}" if a.get("part_ordinal")
                else f"جزء من {core}")
    return core


def contract_display_name(contract_id) -> str:
    """اسم العقد للبيان فقط (بلا رقم ولا مبلغ)."""
    if not contract_id:
        return ""
    with get_connection() as conn:
        r = conn.execute(
            "SELECT contract_number, contract_name, description "
            "FROM contracts WHERE id=?", (int(contract_id),)).fetchone()
    if not r:
        return ""
    name = (r["contract_name"] or "").strip()
    if name in _GENERIC_NAMES:
        name = (r["description"] or "").strip()
    return name or (r["contract_number"] or "").strip()


def contract_tail(name: str) -> str:
    """ذيل البيان: «— عقد {الاسم}» — وإن بدأ الاسم بكلمة «عقد» فلا تتكرر."""
    name = (name or "").strip()
    if not name:
        return ""
    return f" — {name}" if name.startswith("عقد") else f" — عقد {name}"


def describe_items(allocs, advance: float = 0.0, contract_name: str = "") -> str:
    """بيان قصير: بلا مبلغ ولا اسم مقاول ولا رقم عقد — اسم العقد فقط."""
    allocs = list(allocs or [])
    cores = [_alloc_core(a) for a in allocs]
    if not cores:
        head = "سداد على الحساب"
        if advance and advance > 0.0005:
            head += " وزيادة مقدمة"   # ق7: زيادة بعد تغطية الخطة
    else:
        single_cont = (len(allocs) == 1 and allocs[0].get("continuation")
                       and allocs[0].get("full", True))
        head = ("استكمال " if single_cont else "سداد ") + cores[0]
        head += "".join(" و" + c for c in cores[1:])
        if advance and advance > 0.0005:
            head += " وزيادة مقدمة"
    return head + contract_tail(contract_name)
