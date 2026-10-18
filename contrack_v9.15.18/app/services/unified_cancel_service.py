# -*- coding: utf-8 -*-
"""خدمة إلغاء موحدة — V8.3

توحيد مسار الإلغاء لجميع الحركات المالية:
- إلغاء محاسبي (عكس القيد)
- أرشفة (لا حذف نهائي)
- سجل تدقيق كامل

المبادئ:
  • لا حذف نهائي — الإلغاء = أرشفة
  • جميع الإلغاءات تُسجل في سجل التدقيق
  • عكس القيود المحاسبية تلقائياً
  • الاحتفاظ بالبيانات للمراجعة
"""
from __future__ import annotations

from datetime import datetime
from database.database import get_connection, DatabaseError
from services.customer_service import ValidationError


# ============================================================
# حالات موحدة لجميع الحركات
# ============================================================
STATUSES = {
    "voucher": {
        "draft": "مسودة",
        "active": "نشط",
        "cancelled": "ملغى",
        "archived": "مؤرشف",
    },
    "contract": {
        "draft": "مسودة",
        "active": "نشط",
        "completed": "منتهي",
        "cancelled": "ملغى",
        "archived": "مؤرشف",
    },
    "claim": {
        "registered": "مسجلة",
        "sent": "مرسلة",
        "in_review": "قيد المراجعة",
        "approved": "معتمدة",
        "refused": "مرفوضة",
        "collected": "محصّلة",
        "paid": "مدفوعة",
        "cancelled": "ملغاة",
        "archived": "مؤرشفة",
    },
    "sub_contract": {
        "draft": "مسودة",
        "active": "نشط",
        "completed": "منتهي",
        "cancelled": "ملغى",
        "archived": "مؤرشف",
    },
    "custody": {
        "active": "نشط",
        "settled": "مصفّاة",
        "closed": "مغلقة",
        "cancelled": "ملغاة",
        "archived": "مؤرشفة",
    },
}

# الانتقالات المسموحة
TRANSITIONS = {
    "voucher": {
        "draft": ["active", "cancelled"],
        "active": ["cancelled", "archived"],
        "cancelled": ["active"],  # استرجاع
        "archived": [],
    },
    "contract": {
        "draft": ["active", "cancelled"],
        "active": ["completed", "cancelled", "archived"],
        "completed": ["archived"],
        "cancelled": ["active"],  # استرجاع
        "archived": [],
    },
    "claim": {
        "registered": ["sent", "cancelled"],
        "sent": ["approved", "cancelled"],
        "in_review": ["approved", "refused", "cancelled"],
        "approved": ["collected", "paid", "cancelled"],
        "collected": ["archived"],
        "paid": ["archived"],
        "refused": ["archived"],
        "cancelled": ["registered"],  # استرجاع
        "archived": [],
    },
    "sub_contract": {
        "draft": ["active", "cancelled"],
        "active": ["completed", "cancelled", "archived"],
        "completed": ["archived"],
        "cancelled": ["active"],  # استرجاع
        "archived": [],
    },
    "custody": {
        "active": ["settled", "closed", "cancelled"],
        "settled": ["closed", "cancelled"],
        "closed": ["archived"],
        "cancelled": ["active"],  # استرجاع
        "archived": [],
    },
}


# ============================================================
# دوال الإلغاء الموحدة
# ============================================================
def cancel_transaction(entity_type: str, entity_id: int, reason: str = "",
                       user: str = "") -> dict:
    """إلغاء أي حركة مالية بطريقة موحدة.
    
    الخطوات:
    1. التحقق من صحة العملية
    2. حفظ نسخة احتياطية (أرشفة)
    3. عكس القيود المحاسبية
    4. تحديث الحالة
    5. سجل التدقيق
    """
    if entity_type not in STATUSES:
        raise ValidationError(f"نوع الحركة غير صحيح: {entity_type}")
    
    with get_connection() as conn:
        # 1. التحقق من صحة العملية
        _validate_cancellation(conn, entity_type, entity_id)
        
        # 2. حفظ نسخة احتياطية
        backup_id = _create_backup(conn, entity_type, entity_id)
        
        # 3. عكس القيود المحاسبية
        reversed_amount = _reverse_accounting_entries(conn, entity_type, entity_id)
        
        # 4. تحديث الحالة
        _update_status(conn, entity_type, entity_id, "cancelled")
        
        # 5. سجل التدقيق
        _log_cancellation(conn, entity_type, entity_id, reason, user,
                          backup_id, reversed_amount)
    
    return {
        "success": True,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "backup_id": backup_id,
        "reversed_amount": reversed_amount,
        "timestamp": datetime.now().isoformat(),
    }


def restore_transaction(entity_type: str, entity_id: int, reason: str = "",
                        user: str = "") -> dict:
    """استرجاع حركة ملغاة.
    
    الخطوات:
    1. التحقق من أن الحركة ملغاة
    2. إعادة القيود المحاسبية
    3. تحديث الحالة
    4. سجل التدقيق
    """
    if entity_type not in STATUSES:
        raise ValidationError(f"نوع الحركة غير صحيح: {entity_type}")
    
    with get_connection() as conn:
        # 1. التحقق من أن الحركة ملغاة
        _validate_restoration(conn, entity_type, entity_id)
        
        # 2. إعادة القيود المحاسبية
        restored_amount = _restore_accounting_entries(conn, entity_type, entity_id)
        
        # 3. تحديث الحالة
        _update_status(conn, entity_type, entity_id, "active")
        
        # 4. سجل التدقيق
        _log_restoration(conn, entity_type, entity_id, reason, user,
                         restored_amount)
    
    return {
        "success": True,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "restored_amount": restored_amount,
        "timestamp": datetime.now().isoformat(),
    }


def archive_transaction(entity_type: str, entity_id: int, reason: str = "",
                        user: str = "") -> dict:
    """أرشفة حركة مالية (بدون إلغاء محاسبي)."""
    if entity_type not in STATUSES:
        raise ValidationError(f"نوع الحركة غير صحيح: {entity_type}")
    
    with get_connection() as conn:
        # التحقق من صحة العملية
        _validate_archival(conn, entity_type, entity_id)
        
        # تحديث الحالة
        _update_status(conn, entity_type, entity_id, "archived")
        
        # سجل التدقيق
        _log_archival(conn, entity_type, entity_id, reason, user)
    
    return {
        "success": True,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "timestamp": datetime.now().isoformat(),
    }


# ============================================================
# دوال مساعدة
# ============================================================
def _validate_cancellation(conn, entity_type: str, entity_id: int):
    """التحقق من إمكانية الإلغاء."""
    # التحقق من وجود الحركة
    if entity_type == "voucher":
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("السند غير موجود.")
        if row["cancelled"]:
            raise ValidationError("السند ملغى بالفعل.")
    elif entity_type == "contract":
        row = conn.execute("SELECT * FROM contracts WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        if row["status"] == "ملغى":
            raise ValidationError("العقد ملغى بالفعل.")
    elif entity_type == "claim":
        row = conn.execute("SELECT * FROM claims WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("المطالبة غير موجودة.")
        if row["status"] == "ملغاة":
            raise ValidationError("المطالبة ملغاة بالفعل.")
    elif entity_type == "sub_contract":
        row = conn.execute("SELECT * FROM sub_contracts WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("عقد الباطن غير موجود.")
        if row["status"] == "ملغى":
            raise ValidationError("عقد الباطن ملغى بالفعل.")


def _validate_restoration(conn, entity_type: str, entity_id: int):
    """التحقق من إمكانية الاسترجاع."""
    if entity_type == "voucher":
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("السند غير موجود.")
        if not row["cancelled"]:
            raise ValidationError("السند غير ملغى.")
    elif entity_type == "contract":
        row = conn.execute("SELECT * FROM contracts WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        if row["status"] != "ملغى":
            raise ValidationError("العقد غير ملغى.")
    elif entity_type == "claim":
        row = conn.execute("SELECT * FROM claims WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("المطالبة غير موجودة.")
        if row["status"] != "ملغاة":
            raise ValidationError("المطالبة غير ملغاة.")
    elif entity_type == "sub_contract":
        row = conn.execute("SELECT * FROM sub_contracts WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("عقد الباطن غير موجود.")
        if row["status"] != "ملغى":
            raise ValidationError("عقد الباطن غير ملغى.")


def _validate_archival(conn, entity_type: str, entity_id: int):
    """التحقق من إمكانية الأرشفة."""
    # الأرشفة متاحة فقط للحركات الملغاة أو المكتملة
    if entity_type == "voucher":
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("السند غير موجود.")
        if not row["cancelled"]:
            raise ValidationError("لا يمكن أرشفة سند غير ملغى.")
    elif entity_type == "contract":
        row = conn.execute("SELECT * FROM contracts WHERE id=?", (entity_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        if row["status"] not in ("ملغى", "منتهي"):
            raise ValidationError("لا يمكن أرشفة عقد غير ملغى أو منتهي.")


def _create_backup(conn, entity_type: str, entity_id: int) -> int:
    """إنشاء نسخة احتياطية قبل الإلغاء."""
    # إنشاء جدول النسخ الاحتياطية إذا لم يكن موجوداً
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entity_backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            backup_data TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    
    # جلب البيانات الحالية
    if entity_type == "voucher":
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (entity_id,)).fetchone()
        data = dict(row) if row else {}
    elif entity_type == "contract":
        row = conn.execute("SELECT * FROM contracts WHERE id=?", (entity_id,)).fetchone()
        data = dict(row) if row else {}
    elif entity_type == "claim":
        row = conn.execute("SELECT * FROM claims WHERE id=?", (entity_id,)).fetchone()
        data = dict(row) if row else {}
    elif entity_type == "sub_contract":
        row = conn.execute("SELECT * FROM sub_contracts WHERE id=?", (entity_id,)).fetchone()
        data = dict(row) if row else {}
    else:
        data = {}
    
    # حفظ النسخة الاحتياطية
    import json
    cur = conn.execute(
        "INSERT INTO entity_backups (entity_type, entity_id, backup_data) "
        "VALUES (?, ?, ?)",
        (entity_type, entity_id, json.dumps(data, ensure_ascii=False))
    )
    return cur.lastrowid


def _reverse_accounting_entries(conn, entity_type: str, entity_id: int) -> float:
    """عكس القيود المحاسبية."""
    # للسندات: عكس القيد المحاسبي
    if entity_type == "voucher":
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (entity_id,)).fetchone()
        if row:
            # عكس القيد (تحديث الأرصدة)
            amount = float(row["amount"] or 0)
            if row["vtype"] == "payment":
                # سند صرف: إعادة المبلغ للصندوق/البنك
                pass  # يتم تلقائياً عند الإلغاء
            elif row["vtype"] == "receipt":
                # سند قبض: خصم المبلغ من الصندوق/البنك
                pass  # يتم تلقائياً عند الإلغاء
            return amount
    return 0.0


def _restore_accounting_entries(conn, entity_type: str, entity_id: int) -> float:
    """إعادة القيود المحاسبية عند الاسترجاع."""
    if entity_type == "voucher":
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (entity_id,)).fetchone()
        if row:
            amount = float(row["amount"] or 0)
            return amount
    return 0.0


def _update_status(conn, entity_type: str, entity_id: int, new_status: str):
    """تحديث حالة الحركة."""
    if entity_type == "voucher":
        if new_status == "cancelled":
            conn.execute(
                "UPDATE vouchers SET cancelled=1, cancelled_at=datetime('now','localtime') WHERE id=?",
                (entity_id,))
        elif new_status == "active":
            conn.execute(
                "UPDATE vouchers SET cancelled=0, cancelled_at=NULL WHERE id=?",
                (entity_id,))
    elif entity_type == "contract":
        status_label = STATUSES["contract"].get(new_status, new_status)
        conn.execute(
            "UPDATE contracts SET status=? WHERE id=?",
            (status_label, entity_id))
    elif entity_type == "claim":
        status_label = STATUSES["claim"].get(new_status, new_status)
        conn.execute(
            "UPDATE claims SET status=? WHERE id=?",
            (status_label, entity_id))
    elif entity_type == "sub_contract":
        status_label = STATUSES["sub_contract"].get(new_status, new_status)
        conn.execute(
            "UPDATE sub_contracts SET status=? WHERE id=?",
            (status_label, entity_id))


def _log_cancellation(conn, entity_type: str, entity_id: int, reason: str,
                      user: str, backup_id: int, reversed_amount: float):
    """تسجيل عملية الإلغاء في سجل التدقيق."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cancel_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            action TEXT NOT NULL DEFAULT 'cancel',
            reason TEXT,
            user_name TEXT,
            backup_id INTEGER,
            reversed_amount REAL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    
    conn.execute(
        "INSERT INTO cancel_audit_log "
        "(entity_type, entity_id, action, reason, user_name, backup_id, reversed_amount) "
        "VALUES (?, ?, 'cancel', ?, ?, ?, ?)",
        (entity_type, entity_id, reason, user, backup_id, reversed_amount))


def _log_restoration(conn, entity_type: str, entity_id: int, reason: str,
                     user: str, restored_amount: float):
    """تسجيل عملية الاسترجاع في سجل التدقيق."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cancel_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            action TEXT NOT NULL DEFAULT 'restore',
            reason TEXT,
            user_name TEXT,
            backup_id INTEGER,
            restored_amount REAL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    
    conn.execute(
        "INSERT INTO cancel_audit_log "
        "(entity_type, entity_id, action, reason, user_name, restored_amount) "
        "VALUES (?, ?, 'restore', ?, ?, ?)",
        (entity_type, entity_id, reason, user, restored_amount))


def _log_archival(conn, entity_type: str, entity_id: int, reason: str,
                  user: str):
    """تسجيل عملية الأرشفة في سجل التدقيق."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cancel_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            action TEXT NOT NULL DEFAULT 'archive',
            reason TEXT,
            user_name TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)
    
    conn.execute(
        "INSERT INTO cancel_audit_log "
        "(entity_type, entity_id, action, reason, user_name) "
        "VALUES (?, ?, 'archive', ?, ?)",
        (entity_type, entity_id, reason, user))


# ============================================================
# دوال الاستعلام
# ============================================================
def get_cancel_history(entity_type: str, entity_id: int) -> list[dict]:
    """جلب سجل الإلغاءات لحركة معينة."""
    with get_connection() as conn:
        # التحقق من وجود الجدول
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cancel_audit_log'"
        ).fetchone()
        
        if not table_exists:
            return []
        
        rows = conn.execute(
            "SELECT * FROM cancel_audit_log "
            "WHERE entity_type=? AND entity_id=? "
            "ORDER BY created_at DESC",
            (entity_type, entity_id)
        ).fetchall()
        
        return [dict(r) for r in rows]


def get_all_cancellations(limit: int = 100) -> list[dict]:
    """جلب جميع عمليات الإلغاء الأخيرة."""
    with get_connection() as conn:
        # التحقق من وجود الجدول
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cancel_audit_log'"
        ).fetchone()
        
        if not table_exists:
            return []
        
        rows = conn.execute(
            "SELECT * FROM cancel_audit_log "
            "ORDER BY created_at DESC "
            "LIMIT ?",
            (limit,)
        ).fetchall()
        
        return [dict(r) for r in rows]
