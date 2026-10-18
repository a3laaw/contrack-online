# -*- coding: utf-8 -*-
"""V4.47: المطالبات المالية — مطالبتنا على العميل ومطالبات المقاولين علينا.

جدول واحد جديد (claims) بلا مساس بأي جدول قائم. المطالبة مرتبطة
بدفعة (عميل/باطن) للمرجعية والمبلغ، وحالتها آلة انتقالات صارمة.
"""
from datetime import date

from database.database import DatabaseError, get_connection
from services import auth_service
from services.customer_service import ValidationError

DIR_OUT = "out"  # مطالبتنا على العميل
DIR_IN = "in"    # مطالبات المقاولين علينا

STATUS_LABEL = {
    "registered": "🆕 مسجلة",
    "sent": "📤 مرسلة",
    "in_review": "🔍 قيد المراجعة",
    "approved": "✅ معتمدة",
    "refused": "⛔ مرفوضة",
    "collected": "💰 محصّلة",
    "paid": "💸 مدفوعة",
    "postponed": "⏳ مؤجلة",
    "cancelled": "✕ ملغاة",
}

# ملخص الحالة للعرض في الجدول
STATUS_DISPLAY = {
    "registered": "مستحقة",
    "sent": "مستحقة",
    "in_review": "مستحقة",
    "approved": "مستحقة",
    "refused": "مرفوضة",
    "collected": "مسددة",
    "paid": "مسددة",
    "postponed": "مؤجلة",
    "cancelled": "ملغاة",
}

# الانتقالات المسموحة لكل اتجاه
NEXT = {
    DIR_OUT: {
        "registered": ("sent", "postponed", "cancelled"),
        "sent": ("approved", "postponed", "cancelled"),
        "approved": ("collected", "postponed", "cancelled"),
        "postponed": ("registered", "sent", "approved", "cancelled"),
        "collected": (),
        "cancelled": (),
    },
    DIR_IN: {
        "registered": ("in_review", "postponed", "cancelled"),
        "in_review": ("approved", "refused", "postponed", "cancelled"),
        "approved": ("paid", "postponed", "cancelled"),
        "postponed": ("registered", "in_review", "approved", "cancelled"),
        "refused": (),
        "paid": (),
        "cancelled": (),
    },
}

TERMINAL_PAID = {DIR_OUT: "collected", DIR_IN: "paid"}


def next_statuses(direction: str, status: str) -> tuple:
    """الحالات التالية المسموحة من حالة معينة."""
    return NEXT.get(direction, {}).get(status, ())


def _next_number(conn) -> str:
    row = conn.execute(
        "SELECT COALESCE(MAX(CAST(SUBSTR(claim_number, 5) AS INTEGER)), 0)"
        " FROM claims WHERE claim_number LIKE 'CLM-%'").fetchone()
    return f"CLM-{(int(row[0]) + 1):04d}"


def add_claim(direction: str, contract_id: int, title: str, amount: float,
              due_date: str = "", cust_line_id: int | None = None,
              sub_contract_id: int | None = None,
              sub_line_id: int | None = None,
              notes: str = "") -> int:
    """تسجيل مطالبة جديدة (بحالة «مسجلة»).

    الضوابط: العقد موجود · المبلغ > صفر · سطر العميل من نفس العقد ·
    عقد/سطر الباطن من نفس العقد الأب · المبلغ لا يتجاوز مبلغ السطر
    المرتبط (المطالبة الجزئية مسموحة).
    """
    direction = (direction or "").strip()
    if direction not in (DIR_OUT, DIR_IN):
        raise ValidationError("اتجاه المطالبة غير صحيح.")
    title = (title or "").strip()
    if not title:
        raise ValidationError("عنوان المطالبة مطلوب.")
    try:
        amount = float(amount or 0)
    except (TypeError, ValueError):
        raise ValidationError("مبلغ المطالبة غير صحيح.")
    if amount <= 0:
        raise ValidationError("مبلغ المطالبة يجب أن يكون أكبر من صفر.")
    due_date = (due_date or "").strip()[:10]
    if due_date:
        try:
            date.fromisoformat(due_date)
        except ValueError:
            raise ValidationError("تاريخ الاستحقاق غير صحيح.")
    who = auth_service.display_name()
    with get_connection() as conn:
        crow = conn.execute("SELECT id FROM contracts WHERE id=?",
                            (contract_id,)).fetchone()
        if crow is None:
            raise ValidationError("العقد غير موجود.")
        if direction == DIR_OUT:
            if cust_line_id:
                lrow = conn.execute(
                    "SELECT contract_id, amount FROM payment_plan "
                    "WHERE id=?", (cust_line_id,)).fetchone()
                if lrow is None or int(lrow["contract_id"]) != int(contract_id):
                    raise ValidationError(
                        "دفعة العميل لا تتبع هذا العقد.")
                if amount - float(lrow["amount"] or 0) > 0.001:
                    raise ValidationError(
                        "مبلغ المطالبة يتجاوز مبلغ الدفعة المرتبطة.")
            sub_contract_id = None
            sub_line_id = None
        else:
            if not sub_contract_id:
                raise ValidationError("عقد الباطن مطلوب لمطالبة المقاول.")
            srow = conn.execute(
                "SELECT contract_id FROM sub_contracts WHERE id=?",
                (sub_contract_id,)).fetchone()
            if srow is None or int(srow["contract_id"]) != int(contract_id):
                raise ValidationError("عقد الباطن لا يتبع هذا العقد.")
            if sub_line_id:
                lrow = conn.execute(
                    "SELECT sub_contract_id, amount FROM sub_payment_plan "
                    "WHERE id=?", (sub_line_id,)).fetchone()
                if (lrow is None
                        or int(lrow["sub_contract_id"]) != int(sub_contract_id)):
                    raise ValidationError(
                        "دفعة الباطن لا تتبع عقد الباطن المحدد.")
                if amount - float(lrow["amount"] or 0) > 0.001:
                    raise ValidationError(
                        "مبلغ المطالبة يتجاوز مبلغ الدفعة المرتبطة.")
            cust_line_id = None
        number = _next_number(conn)
        try:
            cur = conn.execute(
                "INSERT INTO claims (claim_number, direction, contract_id,"
                " sub_contract_id, cust_line_id, sub_line_id, title,"
                " amount, due_date, status, notes, created_by)"
                " VALUES (?,?,?,?,?,?,?,?,?,'registered',?,?)",
                (number, direction, int(contract_id),
                 int(sub_contract_id) if sub_contract_id else None,
                 int(cust_line_id) if cust_line_id else None,
                 int(sub_line_id) if sub_line_id else None,
                 title, amount, due_date, (notes or "").strip(), who))
        except Exception as exc:
            raise DatabaseError(f"تعذر حفظ المطالبة: {exc}") from exc
        return int(cur.lastrowid)


def update_claim(claim_id: int, title: str | None = None,
                 amount: float | None = None, due_date: str | None = None,
                 voucher_ref: str | None = None,
                 notes: str | None = None) -> None:
    """تعديل بيانات المطالبة (الحالة عبر set_status فقط).

    المطالبة النهائية (محصّلة/مدفوعة/مرفوضة/ملغاة) لا تُعدَّل.
    """
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM claims WHERE id=?",
                           (claim_id,)).fetchone()
        if row is None:
            raise ValidationError("المطالبة غير موجودة.")
        if row["status"] in ("collected", "paid", "refused", "cancelled"):
            raise ValidationError(
                "المطالبة النهائية لا تُعدَّل — سجّل مطالبة جديدة.")
        sets: list[str] = []
        vals: list = []
        if title is not None:
            title = title.strip()
            if not title:
                raise ValidationError("عنوان المطالبة مطلوب.")
            sets.append("title=?")
            vals.append(title)
        if amount is not None:
            try:
                amount = float(amount)
            except (TypeError, ValueError):
                raise ValidationError("مبلغ المطالبة غير صحيح.")
            if amount <= 0:
                raise ValidationError(
                    "مبلغ المطالبة يجب أن يكون أكبر من صفر.")
            cap = None
            if row["cust_line_id"]:
                lrow = conn.execute(
                    "SELECT amount FROM payment_plan WHERE id=?",
                    (row["cust_line_id"],)).fetchone()
                cap = float(lrow["amount"]) if lrow else None
            elif row["sub_line_id"]:
                lrow = conn.execute(
                    "SELECT amount FROM sub_payment_plan WHERE id=?",
                    (row["sub_line_id"],)).fetchone()
                cap = float(lrow["amount"]) if lrow else None
            if cap is not None and amount - cap > 0.001:
                raise ValidationError(
                    "مبلغ المطالبة يتجاوز مبلغ الدفعة المرتبطة.")
            sets.append("amount=?")
            vals.append(amount)
        if due_date is not None:
            due_date = (due_date or "").strip()[:10]
            if due_date:
                try:
                    date.fromisoformat(due_date)
                except ValueError:
                    raise ValidationError("تاريخ الاستحقاق غير صحيح.")
            sets.append("due_date=?")
            vals.append(due_date)
        if voucher_ref is not None:
            sets.append("voucher_ref=?")
            vals.append((voucher_ref or "").strip())
        if notes is not None:
            sets.append("notes=?")
            vals.append((notes or "").strip())
        if not sets:
            return
        sets.append("updated_at=date('now','localtime')")
        vals.append(claim_id)
        conn.execute("UPDATE claims SET " + ", ".join(sets) + " WHERE id=?",
                     vals)


def set_status(claim_id: int, new_status: str, note: str = "",
               postponed_until: str = "") -> dict:
    """ترحيل الحالة مع إنفاذ آلة الانتقالات + سطر تدقيق في الملاحظات.
    
    V9.5.2: إضافة حالة "مؤجل" مع تاريخ إرجاء يدوي.
    """
    new_status = (new_status or "").strip()
    who = auth_service.display_name()
    today = date.today().isoformat()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM claims WHERE id=?",
                           (claim_id,)).fetchone()
        if row is None:
            raise ValidationError("المطالبة غير موجودة.")
        allowed = next_statuses(row["direction"], row["status"])
        if new_status not in allowed:
            raise ValidationError(
                f"الانتقال من «{STATUS_LABEL.get(row['status'], '')}»"
                f" إلى «{STATUS_LABEL.get(new_status, new_status)}»"
                " غير مسموح.")
        
        # معالجة الإرجاء
        postpone_date = ""
        if new_status == "postponed":
            postpone_date = (postponed_until or "").strip()
            if not postpone_date:
                raise ValidationError("تاريخ الإرجاء مطلوب عند تأجيل المطالبة.")
            try:
                date.fromisoformat(postpone_date)
            except ValueError:
                raise ValidationError("تاريخ الإرجاء غير صحيح.")
        
        entry = (f"[{today} {who}] "
                 f"{STATUS_LABEL.get(row['status'], '')} ← "
                 f"{STATUS_LABEL.get(new_status, '')}"
                 + (f" · {(note or '').strip()}"
                    if (note or "").strip() else "")
                 + (f" · مؤجلة حتى {postpone_date}"
                    if postpone_date else ""))
        notes = ((row["notes"] or "").strip() + "\n" + entry).strip()
        conn.execute("UPDATE claims SET status=?, notes=?,"
                     " postponed_until=?,"
                     " updated_at=date('now','localtime') WHERE id=?",
                     (new_status, notes, postpone_date or None, claim_id))
        # إكمال المهمة المرتبطة تلقائي عند التحصيل/السداد
        if new_status in ("collected", "paid"):
            try:
                _auto_complete_claim_tasks(conn, claim_id, row)
            except Exception:
                pass
    return {"id": claim_id, "status": new_status,
            "label": STATUS_LABEL.get(new_status, "")}


def _auto_complete_claim_tasks(conn, claim_id: int, claim_row) -> None:
    """إكمال المهام المرتبطة بمطالبة عند تحصيلها/سدادها."""
    from datetime import datetime as _dt
    claim_num = (claim_row["claim_number"] or "").strip()
    if not claim_num:
        return
    rows = conn.execute(
        "SELECT id, title FROM tasks WHERE status='pending' "
        "AND title LIKE ?",
        (f"%{claim_num}%",)).fetchall()
    for t in rows:
        conn.execute(
            "UPDATE tasks SET status='done',"
            " completed_at=? WHERE id=?",
            (_dt.now().strftime("%Y-%m-%d %H:%M"), t["id"]))


def delete_claim(claim_id: int) -> None:
    """حذف المطالبة المسجلة فقط (قبل أي ترحيل)."""
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM claims WHERE id=?",
                           (claim_id,)).fetchone()
        if row is None:
            raise ValidationError("المطالبة غير موجودة.")
        if row["status"] != "registered":
            raise ValidationError(
                "لا تُحذف إلا المطالبة المسجلة — ألغِ المرحّلة بدلًا من حذفها.")
        conn.execute("DELETE FROM claims WHERE id=?", (claim_id,))


def reset_claims_for_contract(contract_id: int) -> int:
    """V6.6: تصفير كل المطالبات المسجلة لعقد (للمطور فقط).

    يُحذف فقط المطالبات بحالة «registered» — الباقي يبقى.
    يُرجع عدد المطالبات المحذوفة.
    """
    with get_connection() as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM claims WHERE contract_id=? "
            "AND status='registered'", (contract_id,)).fetchone()[0]
        conn.execute("DELETE FROM claims WHERE contract_id=? "
                     "AND status='registered'", (contract_id,))
    return int(n)


def is_overdue(row: dict, today: str | None = None) -> bool:
    """المتأخر = معتمدة وتجاوزت استحقاقها بلا تحصيل/دفع."""
    if (row.get("status") or "") != "approved":
        return False
    due = (row.get("due_date") or "").strip()
    if not due:
        return False
    return due < (today or date.today().isoformat())


def list_claims(direction: str | None = None, status: str | None = None,
                contract_id: int | None = None,
                overdue_only: bool = False,
                search: str = "") -> list[dict]:
    """سرد المطالبات مع أسماء العقد/العميل/الدفعة المرتبطة + علَم التأخر."""
    q = ("SELECT c.*, ct.contract_number, ct.contract_name,"
         " cu.name AS customer_name, s.name AS sub_name,"
         " pp.title AS cust_line_title, sp.title AS sub_line_title "
         "FROM claims c "
         "JOIN contracts ct ON ct.id = c.contract_id "
         "LEFT JOIN customers cu ON cu.id = ct.customer_id "
         "LEFT JOIN sub_contracts sc ON sc.id = c.sub_contract_id "
         "LEFT JOIN subcontractors s ON s.id = sc.subcontractor_id "
         "LEFT JOIN payment_plan pp ON pp.id = c.cust_line_id "
         "LEFT JOIN sub_payment_plan sp ON sp.id = c.sub_line_id "
         "WHERE 1=1")
    vals: list = []
    if direction in (DIR_OUT, DIR_IN):
        q += " AND c.direction=?"
        vals.append(direction)
    if status:
        q += " AND c.status=?"
        vals.append(status)
    if contract_id:
        q += " AND c.contract_id=?"
        vals.append(int(contract_id))
    if (search or "").strip():
        q += (" AND (c.claim_number LIKE ? OR c.title LIKE ?"
              " OR ct.contract_number LIKE ? OR cu.name LIKE ?"
              " OR s.name LIKE ?)")
        like = f"%{search.strip()}%"
        vals += [like] * 5
    q += " ORDER BY c.id DESC"
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(q, vals).fetchall()]
    today = date.today().isoformat()
    for r in rows:
        r["overdue"] = is_overdue(r, today)
        r["status_label"] = STATUS_LABEL.get(r["status"], r["status"])
    if overdue_only:
        rows = [r for r in rows if r["overdue"]]
    return rows


def get_claim(claim_id: int) -> dict | None:
    """مطالبة واحدة بكل روابطها."""
    rows = [r for r in list_claims() if int(r["id"]) == int(claim_id)]
    return rows[0] if rows else None


def totals(direction: str | None = None) -> dict:
    """إجماليات الرأس: العدد + المبالغ حسب الحالة + المتأخر."""
    rows = list_claims(direction=direction)
    out = {"count": len(rows), "open_amount": 0.0, "done_amount": 0.0,
           "overdue_count": 0, "overdue_amount": 0.0}
    for r in rows:
        a = float(r["amount"] or 0)
        if r["status"] in ("collected", "paid"):
            out["done_amount"] += a
        elif r["status"] not in ("refused", "cancelled"):
            out["open_amount"] += a
        if r["overdue"]:
            out["overdue_count"] += 1
            out["overdue_amount"] += a
    return out
# ==================== V4.48: الأتمتة ====================
def _open_claim_for_line(field: str, line_id: int) -> dict | None:
    """مطالبة قائمة لنفس السطر (تمنع الازدواج) — المرفوضة/الملغاة
    لا تمنع (إعادة تقديم مسموحة)."""
    with get_connection() as conn:
        return conn.execute(
            f"SELECT id, status FROM claims WHERE {field}=? AND status IN "
            "('registered','sent','in_review','approved','collected','paid')"
            " ORDER BY id DESC LIMIT 1",
            (line_id,)).fetchone()


def auto_claim_for_customer_line(cust_line_id: int) -> int | None:
    """V4.48: مطالبة تلقائية (مسجلة) عند استحقاق دفعة عميل."""
    with get_connection() as conn:
        line = conn.execute(
            "SELECT contract_id, title, amount, due_date, triggered_at "
            "FROM payment_plan WHERE id=?", (cust_line_id,)).fetchone()
    if line is None:
        return None
    if _open_claim_for_line("cust_line_id", cust_line_id) is not None:
        return None
    return add_claim(
        DIR_OUT, int(line["contract_id"]),
        f"مطالبة تلقائية: {line['title'] or 'دفعة'}",
        float(line["amount"] or 0), (line["due_date"] or "")[:10],
        cust_line_id=int(cust_line_id),
        notes=f"تلقائية من استحقاق دفعة بتاريخ "
              f"{(line['triggered_at'] or '')[:10]}")


def auto_claim_for_sub_line(sub_line_id: int) -> int | None:
    """V4.48: مطالبة مقاول تلقائية (مسجلة) عند استحقاق دفعة باطن."""
    with get_connection() as conn:
        line = conn.execute(
            "SELECT sp.sub_contract_id, sp.title, sp.amount, sp.due_date,"
            " sp.triggered_at, sc.contract_id FROM sub_payment_plan sp "
            "JOIN sub_contracts sc ON sc.id = sp.sub_contract_id "
            "WHERE sp.id=?", (sub_line_id,)).fetchone()
    if line is None:
        return None
    if _open_claim_for_line("sub_line_id", sub_line_id) is not None:
        return None
    return add_claim(
        DIR_IN, int(line["contract_id"]),
        f"مطالبة تلقائية: {line['title'] or 'دفعة'}",
        float(line["amount"] or 0), (line["due_date"] or "")[:10],
        sub_contract_id=int(line["sub_contract_id"]),
        sub_line_id=int(sub_line_id),
        notes=f"تلقائية من استحقاق دفعة بتاريخ "
              f"{(line['triggered_at'] or '')[:10]}")


def auto_settle_contract(contract_id: int,
                         voucher_number: str = "") -> list[dict]:
    """V4.48: تعليم المعتمدة «مسددة» تلقائيًا عند تغطية سنداتها.

    تُفحص المطالبات المعتمدة ذات السطور: ما غطت سندات القبض/الصرف
    (بنفس منطق covered في خطط السداد) مبلغَها يُعلَّم محصّل/مدفوع مع
    مرجع السند. تُستدعى بعد حفظ السند — آمنة للتكرار.
    """
    from services import lifecycle_service as _lc
    cid = int(contract_id)
    settled: list[dict] = []
    cov_c = {int(x["id"]): float(x.get("covered") or 0)
             for x in _lc.contract_payment_plan(cid)}
    cov_s: dict[int, float] = {}
    for sc in _lc.list_sub_contracts(cid):
        for x in _lc.sub_payment_plan(int(sc["id"])):
            cov_s[int(x["id"])] = float(x.get("covered") or 0)
    # فحص كل الحالات المفتوحة (مش "approved" بس)
    _open_statuses = ("approved", "sent", "in_review", "registered", "postponed")
    for _st in _open_statuses:
        for r in list_claims(contract_id=cid, status=_st):
            amt = float(r["amount"] or 0)
            if r["direction"] == DIR_OUT and r.get("cust_line_id"):
                ok = cov_c.get(int(r["cust_line_id"]), 0.0) >= amt - 0.001
                final = "collected"
            elif r["direction"] == DIR_IN and r.get("sub_line_id"):
                ok = cov_s.get(int(r["sub_line_id"]), 0.0) >= amt - 0.001
                final = "paid"
            else:
                continue
            if not ok:
                continue
            try:
                if voucher_number:
                    update_claim(int(r["id"]), voucher_ref=voucher_number)
                set_status(int(r["id"]), final, "تسديد تلقائي بتغطية السندات")
                settled.append({"id": int(r["id"]),
                                "number": r["claim_number"], "status": final})
            except Exception:
                continue
    return settled
