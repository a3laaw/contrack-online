# -*- coding: utf-8 -*-
"""تعليقات ملف العميل · ذاكرة العمل اليومية على العميل.

الفكرة: ما لا يصلح أن يكون مهمة ولا سندًا ولا ملاحظة ثابتة في بطاقة
العميل — «كلّمته اليوم ووعد يسدد الخميس» · «يفضل التواصل مع المهندس
خالد» · «رفض التشطيب الأول». يبقى مسجّلًا باسم كاتبه ووقته، ويظهر لأي
موظف يفتح الملف بعده.

القواعد:
  • التعليق **لا يُحذف بأثر رجعي بلا أثر**: الحذف للمدير أو لصاحبه فقط.
  • التعديل يُسجَّل (وقت التعديل ومن عدّله) فلا يُغيَّر كلام أحد بصمت.
  • التثبيت يرفع التعليق المهم إلى الأعلى دائمًا.
  • يمكن ربط التعليق بعقد معيّن (اختياري) فيظهر في سياقه.
"""
from database.database import get_connection
from services.customer_service import ValidationError
from services.search_utils import normalized_search_clause

MAX_LEN = 2000


_ENSURED_FOR: str | None = None


def _ensure_table() -> None:
    # V2.48: الـDDL مرة واحدة لكل مسار قاعدة بدل كل استدعاء —
    # كان يجري مع كل تحديث للرئيسية (CREATE TABLE/INDEX عبر الشبكة).
    global _ENSURED_FOR
    from database import database as _db
    if _ENSURED_FOR == _db.DB_PATH:
        return
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS customer_comments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL
                            REFERENCES customers(id) ON DELETE CASCADE,
                contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
                body        TEXT NOT NULL,
                created_by  TEXT DEFAULT '',
                author      TEXT DEFAULT '',
                created_at  TEXT NOT NULL
                            DEFAULT (datetime('now','localtime')),
                pinned      INTEGER DEFAULT 0,
                edited_at   TEXT DEFAULT '',
                editor      TEXT DEFAULT ''
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_customer "
                     "ON customer_comments(customer_id)")
        cols = {r[1] for r in conn.execute(
            "PRAGMA table_info(customer_comments)")}
        if "created_by" not in cols:
            conn.execute("ALTER TABLE customer_comments ADD COLUMN "
                         "created_by TEXT DEFAULT ''")
            conn.execute("UPDATE customer_comments SET created_by=author "
                         "WHERE COALESCE(created_by,'')=''")
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
        cols = {r[1] for r in conn.execute("PRAGMA table_info(customer_comments)")}
        for col, ddl in additions.items():
            if col not in cols:
                conn.execute(f"ALTER TABLE customer_comments ADD COLUMN {col} {ddl}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_customer_live "
                     "ON customer_comments(customer_id, is_deleted, pinned, created_at DESC, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_contract_live "
                     "ON customer_comments(contract_id, is_deleted, created_at DESC, id DESC)")
    _ENSURED_FOR = _db.DB_PATH


EDIT_WINDOW_MIN = 10       # نافذة تعديل التعليق بعد كتابته (دقائق)


def _current_username() -> str:
    """اسم الدخول الفعلي (للتدقيق) لا الاسم المعروض."""
    try:
        from services import auth_service
        return auth_service.current_username() or ""
    except Exception:
        return ""


def _current_display() -> str:
    """الاسم المعروض للموظف (يُكتب في الفقاعة)."""
    try:
        from services import auth_service
        return auth_service.display_name() or _current_username()
    except Exception:
        return ""


def _validate(body: str) -> str:
    body = (body or "").strip()
    if not body:
        raise ValidationError("اكتب نص التعليق أولاً.")
    if len(body) > MAX_LEN:
        raise ValidationError(
            f"التعليق طويل جدًا · الحد {MAX_LEN:,} حرف.")
    return body


def add_comment(customer_id: int, body: str,
                contract_id: int | None = None) -> int:
    """إضافة تعليق باسم المستخدم الحالي."""
    _ensure_table()
    body = _validate(body)
    if not customer_id:
        raise ValidationError("التعليق يحتاج عميلًا.")
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO customer_comments (customer_id, contract_id, body, "
            "created_by, author) VALUES (?,?,?,?,?)",
            (customer_id, contract_id or None, body,
             _current_username(), _current_display()))
        return int(cur.lastrowid)


def list_comments(customer_id: int, search: str = "",
                  contract_id: int | None = None,
                  limit: int | None = None) -> list[dict]:
    """تعليقات العميل · المثبّت أولًا ثم الأحدث.

    limit اختياري لحماية الواجهة من التجمّد عند قواعد قديمة بها آلاف
    التعليقات بعد استعادة Backup.
    """
    _ensure_table()
    sql = ("SELECT cm.*, COALESCE(NULLIF(c.contract_name,''), c.description) "
           "AS contract_label, c.contract_number "
           "FROM customer_comments cm "
           "LEFT JOIN contracts c ON c.id = cm.contract_id "
           "WHERE cm.customer_id = ? AND COALESCE(cm.is_deleted,0)=0")
    params: list = [customer_id]
    # contract_id: None = كل العقود، 0 = تعليقات بلا عقد محدد، >0 = عقد بعينه
    if contract_id is not None:
        if int(contract_id or 0) == 0:
            sql += " AND cm.contract_id IS NULL"
        else:
            sql += " AND cm.contract_id = ?"
            params.append(contract_id)
    if (search or "").strip():
        clause, p = normalized_search_clause(
            ["cm.body", "cm.author", "cm.created_by", "c.contract_number", "c.contract_name", "c.description"],
            search)
        sql += " AND " + clause
        params += p
    sql += " ORDER BY cm.pinned DESC, cm.created_at DESC, cm.id DESC"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(max(1, int(limit)))
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def get_comment(comment_id: int) -> dict | None:
    _ensure_table()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM customer_comments WHERE id=?",
                           (comment_id,)).fetchone()
    return dict(row) if row else None


def is_owner(comment: dict) -> bool:
    """هل التعليق لي؟ (المقارنة باسم الدخول لا بالاسم المعروض)."""
    if not comment:
        return False
    return (comment.get("created_by") or "") == _current_username()


def _is_admin() -> bool:
    try:
        from services import auth_service
        return bool(auth_service.is_admin())
    except Exception:
        return False


def can_delete(comment: dict) -> bool:
    """الحذف: لصاحب التعليق · ولغيره يلزم مدير (عملية حساسة)."""
    return bool(comment) and (is_owner(comment) or _is_admin())


def can_pin() -> bool:
    """التثبيت: للمدير فقط (حسب المواصفة)."""
    return _is_admin()


def edit_minutes_left(comment: dict) -> float:
    """الدقائق المتبقية لإمكان تعديل التعليق (صفر = انتهت النافذة)."""
    from datetime import datetime
    if not comment:
        return 0.0
    try:
        created = datetime.strptime(comment.get("created_at") or "",
                                    "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return 0.0
    passed = (datetime.now() - created).total_seconds() / 60.0
    return max(0.0, EDIT_WINDOW_MIN - passed)


def can_edit(comment: dict) -> bool:
    """تعديل التعليقات للمدير فقط وبدون مهلة زمنية.

    طلب المستخدم: لا يُسمح بتعديل التعليق إلا للأدمن دائمًا، مع تسجيل
    اسم من قام بالتعديل ليظهر في الواجهة.
    """
    return bool(comment) and _is_admin()


def can_modify(comment: dict) -> bool:      # توافق مع النداءات القديمة
    return can_delete(comment)


def update_comment(comment_id: int, body: str) -> None:
    """تعديل نص التعليق · يُسجَّل وقت التعديل ومن عدّله."""
    _ensure_table()
    body = _validate(body)
    comment = get_comment(comment_id)
    if not comment:
        raise ValidationError("التعليق غير موجود.")
    if not can_edit(comment):
        raise ValidationError("تعديل التعليقات من صلاحيات المدير فقط.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE customer_comments SET body=?, "
            "edited_at=datetime('now','localtime'), editor=? WHERE id=?",
            (body, _current_display() or _current_username(), comment_id))


def delete_comment(comment_id: int) -> None:
    comment = get_comment(comment_id)
    if not comment:
        raise ValidationError("التعليق غير موجود.")
    if not can_delete(comment):
        raise ValidationError("حذف تعليق كتبه مستخدم آخر يحتاج صلاحية "
                              "مدير.")
    with get_connection() as conn:
        conn.execute("UPDATE customer_comments SET is_deleted=1, "
                     "deleted_at=datetime('now','localtime'), status='ملغى' "
                     "WHERE id=?", (comment_id,))


def toggle_pin(comment_id: int) -> bool:
    """تثبيت/إلغاء تثبيت · **للمدير فقط** · يرجع الحالة الجديدة."""
    comment = get_comment(comment_id)
    if not comment:
        raise ValidationError("التعليق غير موجود.")
    if not can_pin():
        raise ValidationError("تثبيت التعليقات من صلاحيات المدير.")
    new_state = 0 if comment.get("pinned") else 1
    with get_connection() as conn:
        conn.execute("UPDATE customer_comments SET pinned=? WHERE id=?",
                     (new_state, comment_id))
    return bool(new_state)


def comments_count(customer_id: int) -> int:
    _ensure_table()
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM customer_comments WHERE customer_id=? AND COALESCE(is_deleted,0)=0",
            (customer_id,)).fetchone()[0])


def last_comment(customer_id: int) -> dict | None:
    """آخر تعليق (المثبّت له الأولوية) · لعرضه في نظرة عامة."""
    rows = list_comments(customer_id)
    return rows[0] if rows else None


def customers_with_comments() -> dict[int, dict]:
    """لكل عميل: عدد تعليقاته وآخر تعليق · لعرض علامة 💬 في شاشة العملاء."""
    _ensure_table()
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT customer_id, COUNT(*) AS n,
                   MAX(pinned) AS has_pinned,
                   (SELECT body FROM customer_comments c2
                     WHERE c2.customer_id = c1.customer_id
                     ORDER BY c2.pinned DESC, c2.created_at DESC, c2.id DESC
                     LIMIT 1) AS last_body,
                   (SELECT author FROM customer_comments c3
                     WHERE c3.customer_id = c1.customer_id
                     ORDER BY c3.pinned DESC, c3.created_at DESC, c3.id DESC
                     LIMIT 1) AS last_author,
                   (SELECT created_at FROM customer_comments c4
                     WHERE c4.customer_id = c1.customer_id
                     ORDER BY c4.pinned DESC, c4.created_at DESC, c4.id DESC
                     LIMIT 1) AS last_at
            FROM customer_comments c1 GROUP BY customer_id
        """).fetchall()
    return {int(r["customer_id"]): dict(r) for r in rows}


def contract_comments(contract_id: int) -> list[dict]:
    """تعليقات مرتبطة بعقد بعينه · لدمجها في سجله الزمني."""
    _ensure_table()
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM customer_comments WHERE contract_id=? "
            "ORDER BY created_at DESC, id DESC", (contract_id,)).fetchall()
    return [dict(r) for r in rows]


STALE_PINNED_DAYS = 14


def stale_pinned(days: int = STALE_PINNED_DAYS) -> list[dict]:
    """تعليقات مثبّتة مضى عليها أكثر من X يوم بلا متابعة (تنبيه الرئيسية)."""
    _ensure_table()
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT cm.*, cu.name AS customer_name,
                   CAST(julianday('now','localtime')
                        - julianday(cm.created_at) AS INTEGER) AS age_days
            FROM customer_comments cm
            JOIN customers cu ON cu.id = cm.customer_id
            WHERE cm.pinned = 1
              AND julianday('now','localtime')
                  - julianday(cm.created_at) >= ?
            ORDER BY cm.created_at
        """, (days,)).fetchall()
    return [dict(r) for r in rows]
