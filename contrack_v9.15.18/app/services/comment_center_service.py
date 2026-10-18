# -*- coding: utf-8 -*-
"""مركز التعليقات الموحد.

كل التعليقات محفوظة في جدول customer_comments القديم نفسه حفاظًا على البيانات،
مع أعمدة إضافية للفلترة الذكية والمتابعة. لا يوجد حذف فعلي؛ الحذف = soft delete.
"""
from __future__ import annotations

from database.database import get_connection
from services.customer_service import ValidationError
from services.search_utils import normalized_search_clause
from services import comment_service as legacy

STATUSES = ("مفتوح", "تم", "مؤجل", "ملغى")
PRIORITIES = ("عادي", "مهم", "عاجل")
KINDS = ("عام", "مالية", "بلدية", "قانونية", "تنفيذ", "مستندات", "اتصال")


def ensure_schema() -> None:
    legacy._ensure_table()  # يبني الجدول الأساسي لو غير موجود
    with get_connection() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(customer_comments)")}
        additions = {
            "kind": "TEXT DEFAULT 'عام'",
            "priority": "TEXT DEFAULT 'عادي'",
            "status": "TEXT DEFAULT 'مفتوح'",
            "tags": "TEXT DEFAULT ''",
            "followup_date": "TEXT DEFAULT ''",
            "is_deleted": "INTEGER DEFAULT 0",
            "deleted_at": "TEXT DEFAULT ''",
            "delete_reason": "TEXT DEFAULT ''",
            "source": "TEXT DEFAULT ''",
        }
        for col, ddl in additions.items():
            if col not in cols:
                conn.execute(f"ALTER TABLE customer_comments ADD COLUMN {col} {ddl}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_contract ON customer_comments(contract_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_status ON customer_comments(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_followup ON customer_comments(followup_date)")


def _current_user() -> str:
    try:
        from services import auth_service
        return auth_service.display_name() or auth_service.current_username() or ""
    except Exception:
        return ""


def _validate_meta(kind: str, priority: str, status: str) -> tuple[str, str, str]:
    kind = kind if kind in KINDS else "عام"
    priority = priority if priority in PRIORITIES else "عادي"
    status = status if status in STATUSES else "مفتوح"
    return kind, priority, status


def add_comment(customer_id: int, body: str, contract_id: int | None = None,
                kind: str = "عام", priority: str = "عادي",
                tags: str = "", followup_date: str = "",
                status: str = "مفتوح", source: str = "comments_center") -> int:
    ensure_schema()
    body = legacy._validate(body)
    if not customer_id:
        raise ValidationError("اختر العميل أولًا.")
    kind, priority, status = _validate_meta(kind, priority, status)
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO customer_comments (customer_id, contract_id, body, created_by, author, "
            "kind, priority, status, tags, followup_date, source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (customer_id, contract_id or None, body, _current_user(), _current_user(),
             kind, priority, status, tags.strip(), followup_date.strip(), source))
        return int(cur.lastrowid)


def list_comments(search: str = "", customer_id: int | None = None,
                  contract_id: int | None = None, status: str = "",
                  kind: str = "", priority: str = "", tag: str = "",
                  due_only: bool = False, open_only: bool = False,
                  limit: int = 500) -> list[dict]:
    ensure_schema()
    sql = """
        SELECT cm.*, cu.name AS customer_name,
               c.contract_number,
               COALESCE(NULLIF(c.contract_name,''), c.description) AS contract_label
        FROM customer_comments cm
        LEFT JOIN customers cu ON cu.id = cm.customer_id
        LEFT JOIN contracts c ON c.id = cm.contract_id
        WHERE COALESCE(cm.is_deleted,0)=0
    """
    params: list = []
    if customer_id:
        sql += " AND cm.customer_id=?"
        params.append(customer_id)
    if contract_id:
        sql += " AND cm.contract_id=?"
        params.append(contract_id)
    if status:
        sql += " AND cm.status=?"
        params.append(status)
    if open_only:
        sql += " AND cm.status IN ('مفتوح','مؤجل')"
    if kind:
        sql += " AND cm.kind=?"
        params.append(kind)
    if priority:
        sql += " AND cm.priority=?"
        params.append(priority)
    if tag.strip():
        clause, p = normalized_search_clause(["cm.tags"], tag)
        sql += " AND " + clause
        params += p
    if due_only:
        sql += " AND COALESCE(cm.followup_date,'')!='' AND cm.followup_date <= date('now','localtime') AND cm.status!='تم'"
    if search.strip():
        clause, p = normalized_search_clause(
            ["cm.body", "cm.author", "cu.name", "c.contract_number",
             "c.contract_name", "c.description", "cm.tags"], search)
        sql += " AND " + clause
        params += p
    sql += " ORDER BY cm.pinned DESC, CASE cm.priority WHEN 'عاجل' THEN 0 WHEN 'مهم' THEN 1 ELSE 2 END, cm.created_at DESC, cm.id DESC LIMIT ?"
    params.append(max(1, min(int(limit or 500), 2000)))
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def update_meta(comment_id: int, *, status: str | None = None,
                kind: str | None = None, priority: str | None = None,
                tags: str | None = None, followup_date: str | None = None) -> None:
    ensure_schema()
    sets, params = [], []
    if status is not None:
        if status not in STATUSES:
            raise ValidationError("حالة التعليق غير صحيحة.")
        sets.append("status=?"); params.append(status)
    if kind is not None:
        if kind not in KINDS:
            raise ValidationError("نوع التعليق غير صحيح.")
        sets.append("kind=?"); params.append(kind)
    if priority is not None:
        if priority not in PRIORITIES:
            raise ValidationError("أولوية التعليق غير صحيحة.")
        sets.append("priority=?"); params.append(priority)
    if tags is not None:
        sets.append("tags=?"); params.append(tags.strip())
    if followup_date is not None:
        sets.append("followup_date=?"); params.append(followup_date.strip())
    if not sets:
        return
    params.append(comment_id)
    with get_connection() as conn:
        conn.execute(f"UPDATE customer_comments SET {', '.join(sets)} WHERE id=?", params)


def soft_delete(comment_id: int, reason: str = "") -> None:
    ensure_schema()
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM customer_comments WHERE id=?", (comment_id,)).fetchone()
        if not row:
            raise ValidationError("التعليق غير موجود.")
        conn.execute(
            "UPDATE customer_comments SET is_deleted=1, deleted_at=datetime('now','localtime'), "
            "delete_reason=?, status='ملغى' WHERE id=?",
            (reason.strip(), comment_id))


def summary(customer_id: int | None = None, contract_id: int | None = None) -> dict:
    ensure_schema()
    where = "WHERE COALESCE(is_deleted,0)=0"
    params = []
    if customer_id:
        where += " AND customer_id=?"; params.append(customer_id)
    if contract_id:
        where += " AND contract_id=?"; params.append(contract_id)
    with get_connection() as conn:
        row = conn.execute(f"""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status IN ('مفتوح','مؤجل') THEN 1 ELSE 0 END) AS open_count,
                   SUM(CASE WHEN priority='عاجل' THEN 1 ELSE 0 END) AS urgent_count,
                   SUM(CASE WHEN COALESCE(followup_date,'')!='' AND followup_date <= date('now','localtime') AND status!='تم' THEN 1 ELSE 0 END) AS due_count
            FROM customer_comments {where}
        """, params).fetchone()
    return {"total": int(row["total"] or 0), "open": int(row["open_count"] or 0),
            "urgent": int(row["urgent_count"] or 0), "due": int(row["due_count"] or 0)}
