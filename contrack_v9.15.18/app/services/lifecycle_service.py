# -*- coding: utf-8 -*-
"""خدمة دورة حياة العقد المتكاملة."""
import os
import sqlite3
from datetime import date, datetime

from database.database import get_connection, DatabaseError, atomic
from services.customer_service import ValidationError
from services.search_utils import contains as search_contains, like_param, normalized_search_clause, normalize as normalize_search

CONTRACT_STATUSES = ["مسودة", "تحت المراجعة", "معتمد", "نشط", "متوقف",
                     "منتهي", "مغلق", "ملغى"]
QUOTE_STATUSES = ["مسودة", "مرسل للعميل", "تحت المراجعة", "مقبول", "مرفوض",
                  "منتهي الصلاحية", "تم تحويله إلى عقد"]
ADDENDUM_STATUSES = ["مسودة", "تحت المراجعة", "معتمد", "ملغى"]

class OverpayWarning(ValidationError):
    """تحذير يتجاوز المتبقي · يُسمح بالتجاوز بعد تأكيد المستخدم."""
    pass

# ============================================================
# ترقيم تلقائي موحد
# ============================================================
def _scan_last_number(conn, table: str, column: str, prefix: str) -> int:
    """أعلى رقم مستخدم (مسح كامل) — للتهيئة الأولى فقط."""
    row = conn.execute(
        f"SELECT {column} FROM {table} WHERE {column} LIKE ? "
        f"ORDER BY CAST(SUBSTR({column}, ?) AS INTEGER) DESC LIMIT 1",
        (f"{prefix}-%", len(prefix) + 2)).fetchone()
    if not row:
        return 0
    try:
        return int(row[0].split("-")[-1])
    except (ValueError, IndexError):
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def _next_number(table: str, column: str, prefix: str) -> str:
    # V2.48: عدّاد مفهرس بدل مسح الجدول مع كل حفظ. UPDATE ذري واحد
    # (RETURNING) فلا تضارب بين جهازين على قاعدة الشبكة.
    key = f"{table}.{column}.{prefix}"
    with get_connection() as conn:
        try:
            row = conn.execute(
                "UPDATE number_sequences SET last_no = last_no + 1 "
                "WHERE name=? RETURNING last_no", (key,)).fetchone()
        except sqlite3.Error:
            row = None
        if row:
            return f"{prefix}-{int(row[0]):04d}"
        try:
            seed = _scan_last_number(conn, table, column, prefix)
            conn.execute(
                "INSERT OR IGNORE INTO number_sequences(name, last_no) "
                "VALUES (?, ?)", (key, seed))
            row = conn.execute(
                "UPDATE number_sequences SET last_no = last_no + 1 "
                "WHERE name=? RETURNING last_no", (key,)).fetchone()
            if row:
                return f"{prefix}-{int(row[0]):04d}"
        except sqlite3.Error:
            pass
        # احتياط قصوى (جدول العدّادات غير موجود): السلوك القديم
        num = _scan_last_number(conn, table, column, prefix) + 1
        return f"{prefix}-{num:04d}"

def _sync_counter(table: str, column: str, prefix: str, used_max: int) -> None:
    """رفع العدّاد بعد أرقام صريحة — بلا تصادم لاحق."""
    key = f"{table}.{column}.{prefix}"
    try:
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO number_sequences(name, last_no) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET last_no = MAX(last_no, excluded.last_no)",
                (key, int(used_max)))
    except sqlite3.Error:
        pass


def _peek_number(table: str, column: str, prefix: str) -> str:
    """الرقم التالي للعرض فقط — لا يستهلك من العدّاد (بلا فجوات)."""
    key = f"{table}.{column}.{prefix}"
    with get_connection() as conn:
        scan = _scan_last_number(conn, table, column, prefix)
        try:
            row = conn.execute(
                "SELECT last_no FROM number_sequences WHERE name=?",
                (key,)).fetchone()
            counter = int(row[0]) if row else 0
        except sqlite3.Error:
            counter = 0
    return f"{prefix}-{max(scan, counter) + 1:04d}"


def next_project_code() -> str:   return _next_number("projects", "project_code", "PRJ")
def next_quote_number() -> str:   return _next_number("quotations", "quote_number", "QUO")
def next_sub_code(_consume: bool = True) -> str:
    if _consume:
        return _next_number("subcontractors", "sub_code", "SUB")
    return _peek_number("subcontractors", "sub_code", "SUB")
VOUCHER_TYPE_LABELS = {"receipt": "قبض", "payment": "صرف",
                         "transfer": "تحويل داخلي",
                         "custody_return": "إرجاع عهدة",
                         "salary_deduction": "خصم من راتب"}


def voucher_type_label(vtype: str) -> str:
    """V4.52: الاسم العربي لنوع السند (للتقارير والقوائم)."""
    return VOUCHER_TYPE_LABELS.get(vtype or "", vtype or "")


def next_voucher_number(vtype: str, _consume: bool = True) -> str:
    prefix = ("TV" if vtype == "transfer"
              else ("PV" if vtype == "payment"
                    else ("CV" if vtype == "custody_return"
                          else ("SD" if vtype == "salary_deduction"
                                else "RV"))))
    if _consume:
        return _next_number("vouchers", "voucher_number", prefix)
    return _peek_number("vouchers", "voucher_number", prefix)

# ============================================================
# المشاريع
# ============================================================
def add_project(code: str, name: str, customer_id: int | None,
                description: str = "", status: str = "نشط") -> int:
    if not name.strip():
        raise ValidationError("اسم المشروع مطلوب.")
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO projects (project_code, name, customer_id, description, status) "
                "VALUES (?, ?, ?, ?, ?)",
                (code.strip(), name.strip(), customer_id, description.strip(), status))
            return cur.lastrowid
    except sqlite3.IntegrityError as exc:
        raise ValidationError("رقم المشروع مستخدم من قبل.") from exc

def update_project(pid: int, code: str, name: str, customer_id: int | None,
                   description: str, status: str) -> None:
    if not name.strip():
        raise ValidationError("اسم المشروع مطلوب.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE projects SET project_code=?, name=?, customer_id=?, "
            "description=?, status=? WHERE id=?",
            (code.strip(), name.strip(), customer_id, description.strip(), status, pid))

def list_projects(search: str = "") -> list[dict]:
    sql = ("SELECT p.*, cu.name AS customer_name FROM projects p "
           "LEFT JOIN customers cu ON cu.id = p.customer_id")
    params = ()
    if search.strip():
        clause, p = normalized_search_clause(
            ["p.name", "p.project_code", "cu.name", "cu.phone"], search)
        sql += " WHERE " + clause
        params = tuple(p)
    sql += " ORDER BY p.id DESC"
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]

def get_project(pid: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT p.*, cu.name AS customer_name FROM projects p "
            "LEFT JOIN customers cu ON cu.id = p.customer_id WHERE p.id=?",
            (pid,)).fetchone()
    return dict(row) if row else None

def delete_project(pid: int) -> None:
    with get_connection() as conn:
        linked = conn.execute(
            "SELECT COUNT(*) FROM contracts WHERE project_id=?", (pid,)).fetchone()[0]
        linked += conn.execute(
            "SELECT COUNT(*) FROM vouchers WHERE project_id=?", (pid,)).fetchone()[0]
    if linked:
        raise ValidationError("لا يمكن حذف المشروع لأنه مرتبط بعقود أو سندات.")
    with get_connection() as conn:
        conn.execute("DELETE FROM projects WHERE id=?", (pid,))

# ============================================================
# حقول دورة الحياة في العقد
# ============================================================
def update_contract_lifecycle(contract_id: int, contract_name=None,
                              project_id=None, contract_type=None, sign_date=None,
                              start_date=None, end_date=None,
                              status=None, currency=None) -> None:
    if status is not None and status not in CONTRACT_STATUSES:
        raise ValidationError("حالة العقد غير صحيحة.")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, start_date, end_date FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        new_start = start_date if start_date is not None else (row["start_date"] or "")
        new_end = end_date if end_date is not None else (row["end_date"] or "")
        if new_start and new_end and new_end < new_start:
            raise ValidationError("تاريخ نهاية العقد يجب أن يكون بعد تاريخ البداية.")
        # اسم العقد المعروض ليس حقلاً حراً: يتبع نوع العقد المختار دائمًا.
        if contract_type is not None:
            contract_name = (contract_type or "").strip() or "غير محدد"
        fields = {
            "contract_name": contract_name, "project_id": project_id,
            "contract_type": contract_type, "sign_date": sign_date,
            "start_date": start_date, "end_date": end_date,
            "status": status, "currency": currency,
        }
        sets, values = [], []
        for column, value in fields.items():
            if value is None:
                continue
            sets.append(f"{column}=?")
            values.append(value)
        if sets:
            values.append(contract_id)
            conn.execute(f"UPDATE contracts SET {', '.join(sets)} WHERE id=?", values)
    if contract_name is not None:
        try:
            sync_auto_project(contract_id)
        except Exception:
            pass
    if status is not None and row["status"] != status:
        events = {"معتمد": "اعتماد العقد", "نشط": "تفعيل العقد",
                  "متوقف": "إيقاف العقد", "منتهي": "انتهاء العقد",
                  "مغلق": "إغلاق العقد", "ملغى": "إلغاء العقد"}
        log_event(contract_id, events.get(status, "تغيير الحالة"),
                  f"{row['status']} ← {status}")

def change_contract_status(contract_id: int, new_status: str, reason: str = "", cancel_close_amount: float = 0.0) -> dict:
    if new_status not in CONTRACT_STATUSES:
        raise ValidationError("حالة العقد غير صحيحة.")
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        old_status = row["status"] or "نشط"
        collected = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
            (contract_id,)).fetchone()[0])
        paid = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='payment' AND cancelled=0",
            (contract_id,)).fetchone()[0])
    if old_status == new_status:
        raise ValidationError(f"العقد بالفعل بحالة ({new_status}).")
    value = contract_current_value(contract_id)
    remaining = value["current"] - collected
    cancel_close_amount = round(float(cancel_close_amount or 0), 3)
    if cancel_close_amount < 0:
        raise ValidationError("مبلغ الإغلاق لا يجوز أن يكون سالبًا.")
    reason = (reason or "").strip()
    with get_connection() as conn:
        if new_status == "ملغى":
            conn.execute(
                "UPDATE contracts SET status=?, status_reason=?, cancel_close_amount=?, cancelled_at=datetime('now','localtime') WHERE id=?",
                (new_status, reason, cancel_close_amount, contract_id))
        elif new_status in ("مغلق", "متوقف"):
            conn.execute(
                "UPDATE contracts SET status=?, status_reason=? WHERE id=?",
                (new_status, reason, contract_id))
        else:
            conn.execute("UPDATE contracts SET status=? WHERE id=?", (new_status, contract_id))
    events = {"معتمد": "اعتماد العقد", "نشط": "تفعيل العقد",
              "متوقف": "إيقاف العقد مؤقتًا", "منتهي": "انتهاء العقد",
              "مغلق": "إغلاق العقد", "ملغى": "إلغاء العقد"}
    extra = (f" · السبب: {reason}" if reason else "")
    if new_status == "ملغى":
        extra += f" · مبلغ الإغلاق: {cancel_close_amount:,.3f}"
    log_event(contract_id, events.get(new_status, "تغيير الحالة"),
              f"{old_status} ← {new_status}" + extra)
    return {"old_status": old_status, "new_status": new_status,
            "collected": collected, "paid": paid,
            "remaining": remaining, "value": value["current"],
            "cancel_close_amount": cancel_close_amount}

# ============================================================
# السجل الزمني للعقد
# ============================================================
def log_event(contract_id: int, event_type: str, description: str = "", username: str = "") -> None:
    if not username:
        try:
            from services import auth_service
            username = auth_service.current_username()
        except Exception:
            username = ""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO contract_events (contract_id, event_type, description, username) "
            "VALUES (?, ?, ?, ?)",
            (contract_id, event_type, description, username))



def _add_system_comment(customer_id: int | None, contract_id: int | None,
                        body: str) -> None:
    """تعليق تلقائي آمن في ملف العميل؛ لا يعطل العملية الأصلية لو فشل."""
    if not customer_id or not (body or "").strip():
        return
    try:
        from services import comment_service
        comment_service.add_comment(customer_id, f"🤖 [تعليق تلقائي] {body}",
                                    contract_id=contract_id)
    except Exception:
        pass


def _auto_receipt_comment(voucher_id: int) -> None:
    """إضافة تعليق احترافي عند إصدار سند قبض على عقد."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT v.voucher_number, v.vdate, v.method, v.amount, "
                "v.description, v.contract_id, c.customer_id, "
                "c.contract_number, COALESCE(NULLIF(c.contract_name,''), "
                "c.description, '') AS contract_label "
                "FROM vouchers v JOIN contracts c ON c.id=v.contract_id "
                "WHERE v.id=? AND v.vtype='receipt'",
                (voucher_id,)).fetchone()
        if not row:
            return
        value = contract_current_value(int(row["contract_id"]))
        with get_connection() as conn:
            collected = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                (row["contract_id"],)).fetchone()[0])
        due_value = float(value["current"] or 0)
        try:
            from services.supervision_service import supervision_status
            sup = supervision_status(int(row["contract_id"]))
            if sup:
                due_value = max(due_value, float(sup["total_due"] or 0))
        except Exception:
            pass
        remaining = due_value - collected
        parts = [
            f"تم إصدار سند قبض رقم {row['voucher_number']} بتاريخ {row['vdate']} "
            f"على العقد {row['contract_number']}",
            f"المبلغ: {float(row['amount'] or 0):,.3f} د.ك",
        ]
        if (row["method"] or "").strip():
            parts.append(f"طريقة السداد: {row['method']}")
        if (row["description"] or "").strip():
            parts.append(f"البيان: {row['description']}")
        parts.append(f"إجمالي المحصل بعد السند: {collected:,.3f} د.ك")
        if remaining > 0.001:
            parts.append(f"المتبقي على العقد: {remaining:,.3f} د.ك")
        elif remaining < -0.001:
            parts.append(f"يوجد دفع مقدم/زيادة: {abs(remaining):,.3f} د.ك")
        else:
            parts.append("تم تحصيل كامل المستحق على العقد.")
        _add_system_comment(row["customer_id"], row["contract_id"], " · ".join(parts))
    except Exception:
        pass

def list_events(contract_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM contract_events WHERE contract_id=? "
            "ORDER BY event_time DESC, id DESC", (contract_id,)).fetchall()
    return [dict(r) for r in rows]


def list_events_for_contracts(contract_ids: list[int], limit: int = 50) -> list[dict]:
    """آخر أحداث عدة عقود باستعلام واحد بدل N استعلام داخل ملف العميل."""
    ids = [int(x) for x in (contract_ids or []) if x]
    if not ids:
        return []
    q = ",".join("?" for _ in ids)
    params = ids + [max(1, int(limit or 50))]
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM contract_events WHERE contract_id IN ({q}) "
            "ORDER BY event_time DESC, id DESC LIMIT ?", params).fetchall()
    return [dict(r) for r in rows]

# ============================================================
# مدة العقد والحالة الزمنية
# ============================================================
def contract_timeline(start_date: str, end_date: str) -> dict:
    result = {"duration": 0, "elapsed": 0, "remaining": 0,
              "percent": 0.0, "time_status": "غير محدد", "alerts": []}
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return result
    today = date.today()
    duration = (end - start).days + 1
    if duration <= 0:
        return result
    elapsed = max(0, min(duration, (today - start).days + 1))
    remaining = max(0, (end - today).days)
    result.update({
        "duration": duration,
        "elapsed": elapsed if today >= start else 0,
        "remaining": remaining,
        "percent": round(min(100.0, max(0.0, elapsed / duration * 100)), 1) if today >= start else 0.0,
    })
    if today < start:
        result["time_status"] = "لم يبدأ بعد"
    elif today > end:
        result["time_status"] = "منتهي المدة"
        result["remaining"] = 0
        result["percent"] = 100.0
    else:
        result["time_status"] = "جارٍ"
    return result

def get_expiry_alert_days() -> list[int]:
    with get_connection() as conn:
        row = conn.execute("SELECT expiry_alerts FROM settings WHERE id=1").fetchone()
    raw = (row["expiry_alerts"] if row and row["expiry_alerts"] else "90,60,30,7")
    days = []
    for part in raw.split(","):
        try:
            days.append(int(part.strip()))
        except ValueError:
            pass
    return sorted(set(days), reverse=True) or [90, 60, 30, 7]

def save_expiry_alert_days(days_text: str) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE settings SET expiry_alerts=? WHERE id=1",
                     (days_text.strip() or "90,60,30,7",))

def expiring_contracts() -> list[dict]:
    alert_days = get_expiry_alert_days()
    max_days = max(alert_days)
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_name, c.end_date, "
            "cu.name AS customer_name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE c.end_date != '' AND c.status NOT IN ('مغلق','ملغى','منتهي')"
        ).fetchall()
    result = []
    today = date.today()
    for r in rows:
        try:
            end = datetime.strptime(r["end_date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        remaining = (end - today).days
        if 0 <= remaining <= max_days:
            level = next((d for d in sorted(alert_days) if remaining <= d), max_days)
            result.append({**dict(r), "remaining": remaining, "alert_level": level})
    result.sort(key=lambda x: x["remaining"])
    return result

# ============================================================
# الملحقات · تحديث قيمة العقد تلقائياً
# ============================================================
def next_addendum_number(contract_id: int) -> str:
    with get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM addendums WHERE contract_id=?", (contract_id,)).fetchone()[0]
    return f"ADD-{count + 1:03d}"

ADDENDUM_TYPES = ["عقد إضافي", "أمر تغييري"]

def add_addendum(contract_id: int, adate: str, reason: str, description: str,
                 amount_add: float, amount_deduct: float,
                 start_date: str = "", end_date: str = "",
                 status: str = "معتمد", notes: str = "",
                 addendum_type: str = "أمر تغييري",
                 side: str = "client",
                 sub_contract_id: int | None = None,
                 allow_zero: bool = False) -> int:
    """V5.4 ④: ``side`` = عميل (يؤثر على عقد العميل) أو مقاول (عقد الباطن)."""
    if addendum_type not in ADDENDUM_TYPES:
        raise ValidationError("نوع الملحق غير صحيح.")
    side = (side or "client").strip().lower()
    if side not in ("client", "sub"):
        raise ValidationError("جهة الأمر التغييري غير صحيحة.")
    if side == "sub":
        if not sub_contract_id:
            raise ValidationError("حدد عقد الباطن للأمر التغييري.")
        with get_connection() as conn:
            sc = conn.execute(
                "SELECT contract_id FROM sub_contracts WHERE id=?",
                (int(sub_contract_id),)).fetchone()
        if sc is None:
            raise ValidationError("عقد الباطن غير موجود.")
        if int(sc["contract_id"]) != int(contract_id):
            raise ValidationError("عقد الباطن لا يتبع هذا العقد.")
    if amount_add < 0 or amount_deduct < 0:
        raise ValidationError("قيم الملحق لا يمكن أن تكون سالبة.")
    if amount_add == 0 and amount_deduct == 0 and not allow_zero:
        raise ValidationError("يجب إدخال قيمة مضافة أو مخفضة.")
    if addendum_type == "عقد إضافي" and amount_add <= 0 and not allow_zero:
        raise ValidationError("العقد الإضافي يجب أن يحتوي على قيمة مضافة.")
    if amount_deduct > 0:
        value = contract_current_value(contract_id)
        with get_connection() as conn:
            collected = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                (contract_id,)).fetchone()[0])
        new_value = value["current"] + amount_add - amount_deduct
        if new_value < collected - 0.001:
            raise ValidationError(
                "لا يمكن الخصم · ستصبح قيمة العقد "
                f"({new_value:,.3f}) أقل من المحصّل فعليًا "
                f"({collected:,.3f}).")
    number = next_addendum_number(contract_id)
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO addendums (addendum_number, contract_id, addendum_type, "
            "adate, reason, description, amount_add, amount_deduct, start_date, "
            "end_date, status, notes, approved_date, side, sub_contract_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (number, contract_id, addendum_type, adate, reason, description,
             amount_add, amount_deduct, start_date, end_date, status, notes,
             adate if status == "معتمد" else "", side,
             int(sub_contract_id or 0) or None))
        aid = cur.lastrowid
    net = amount_add - amount_deduct
    log_event(contract_id, f"إضافة {addendum_type}",
              f"{number}: صافي التعديل {net:+,.3f} · {reason}")
    return aid

def approve_addendum(addendum_id: int) -> None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM addendums WHERE id=?", (addendum_id,)).fetchone()
        if not row:
            raise ValidationError("الملحق غير موجود.")
        conn.execute("UPDATE addendums SET status='معتمد', approved_date=? WHERE id=?",
                     (date.today().isoformat(), addendum_id))
    # V5.4 ④: تنفيذ بنود الأمر التغييري (إضافة/حذف) على العقد أو عقد الباطن
    try:
        from services import addendum_service as _adx
        _adx.apply_parts(addendum_id)
    except ValidationError:
        raise
    except Exception:
        pass
    keys = row.keys()
    atype = (row["addendum_type"] if "addendum_type" in keys else "") or "ملحق"
    log_event(row["contract_id"], f"اعتماد {atype}", row["addendum_number"])

def cancel_addendum(addendum_id: int, reason: str = "") -> None:
    """إلغاء ملحق/أمر تغييري مع سبب محفوظ للتدقيق."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM addendums WHERE id=?", (addendum_id,)).fetchone()
        if not row:
            raise ValidationError("الملحق غير موجود.")
        if row["status"] == "ملغى":
            raise ValidationError("الملحق ملغى بالفعل.")
        conn.execute(
            "UPDATE addendums SET status='ملغى', cancel_reason=?, cancelled_at=datetime('now','localtime') WHERE id=?",
            ((reason or "").strip(), addendum_id))
    # V5.4 ④: البند المحذوف يعود كما كان عند إلغاء الأمر التغييري
    try:
        from services import addendum_service as _adx2
        _adx2.restore_parts(addendum_id)
    except Exception:
        pass
    keys = row.keys()
    atype = (row["addendum_type"] if "addendum_type" in keys else "") or "ملحق"
    log_event(row["contract_id"], f"إلغاء {atype}",
              f"{row['addendum_number']}" + (f" · السبب: {reason}" if reason else ""))


def list_addendums(contract_id: int, with_sides: bool = True) -> list[dict]:
    """ملحقات/أوامر العقد. V5.4 ④: تُرفَق عدّادات بنود كل جهة."""
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM addendums WHERE contract_id=? ORDER BY id",
            (contract_id,)).fetchall()]
        counts: dict[int, dict] = {}
        if with_sides and rows:
            for r in conn.execute(
                    "SELECT addendum_id, side, COUNT(*) AS n FROM addendum_items "
                    "WHERE action IN ('add','delete') GROUP BY addendum_id, side"
            ).fetchall():
                counts.setdefault(int(r["addendum_id"]), {})[r["side"]] = int(r["n"])
    for a in rows:
        c = counts.get(int(a["id"]), {})
        a["client_parts"] = c.get("client", 0)
        a["sub_parts"] = c.get("sub", 0)
    return rows

def contract_values_map(contract_ids=None) -> dict:
    """القيمة الحالية لكل العقود دفعة واحدة — بديل مجمّع لـ
    ``contract_current_value`` عند المرور على عدد كبير من العقود.

    يرجع {contract_id: {original, additions, deductions, sup_extension,
    base_current, current}} بنفس مفاتيح الدالة المفردة تمامًا.

    الأداء: الدالة المفردة تنفّذ استعلامين + اتصالًا لكل عقد، فتصبح
    مئات الاستعلامات في التقارير الجدولية — وهي الأغلى على قاعدة
    الشبكة. هذه تنفّذ استعلامين فقط للكل.
    """
    ids = None
    if contract_ids is not None:
        ids = {int(x) for x in contract_ids if x}
        if not ids:
            return {}
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, amount FROM contracts").fetchall()
        adds = {int(r["contract_id"]): (float(r["a"] or 0), float(r["d"] or 0))
                for r in conn.execute(
                    "SELECT contract_id, COALESCE(SUM(amount_add),0) AS a, "
                    "COALESCE(SUM(amount_deduct),0) AS d FROM addendums "
                    "WHERE status='معتمد' GROUP BY contract_id").fetchall()}
    try:
        from services.supervision_service import extensions_map
        ext = extensions_map() or {}
    except Exception:
        ext = {}
    out = {}
    for r in rows:
        cid = int(r["id"])
        if ids is not None and cid not in ids:
            continue
        original = float(r["amount"] or 0)
        a, d = adds.get(cid, (0.0, 0.0))
        sup = float((ext.get(cid) or {}).get("extension_value", 0.0) or 0.0)
        base = original + a - d
        out[cid] = {"original": original, "additions": a, "deductions": d,
                    "sup_extension": sup, "base_current": base,
                    "current": base + sup}
    return out


def contract_current_value(contract_id: int) -> dict:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("contract_current_value", contract_id),
                lambda: _contract_current_value_impl(contract_id))


def _contract_current_value_impl(contract_id: int) -> dict:
    with get_connection() as conn:
        original = conn.execute("SELECT amount FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if not original:
            raise ValidationError("العقد غير موجود.")
        adds = conn.execute(
            "SELECT COALESCE(SUM(amount_add),0), COALESCE(SUM(amount_deduct),0) "
            "FROM addendums WHERE contract_id=? AND status='معتمد'", (contract_id,)).fetchone()
    original_amount = float(original["amount"])
    additions, deductions = float(adds[0]), float(adds[1])
    sup_extension = 0.0
    try:
        from services.supervision_service import supervision_status
        status = supervision_status(contract_id)
        if status:
            sup_extension = float(status["extension_value"] or 0.0)
    except Exception:
        sup_extension = 0.0
    base_current = original_amount + additions - deductions
    return {
        "original": original_amount, "additions": additions, "deductions": deductions,
        "sup_extension": sup_extension, "base_current": base_current,
        "current": base_current + sup_extension,
    }

# ============================================================
# BOQ · بنود الأعمال
# ============================================================
def add_boq_item(contract_id: int, description: str, qty: float, unit: str,
                 unit_price: float, stage_id: int | None = None) -> int:
    if not description.strip():
        raise ValidationError("وصف البند مطلوب.")
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO boq_items (contract_id, description, qty, unit, "
            "unit_price, stage_id) VALUES (?, ?, ?, ?, ?, ?)",
            (contract_id, description.strip(), qty, unit, unit_price,
             int(stage_id) if stage_id else None))
        return cur.lastrowid

def list_boq(contract_id: int, include_deleted: bool = False) -> list[dict]:
    """بنود عقد العميل.

    V5.4 ④: البند المحذوف بأمر تغييري **لا يُمحى** — يُوسم ويُستثنى من كل
    المجاميع. ``include_deleted=True`` يعرضه مشطوبًا مع وسمه (لعرض فقط).
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT *, qty * unit_price AS total FROM boq_items "
            "WHERE contract_id=? "
            + ("" if include_deleted else
               "AND COALESCE(deleted_addendum_id, 0)=0 ")
            + "ORDER BY id", (contract_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["deleted"] = bool(d.get("deleted_addendum_id"))
        out.append(d)
    return out

def delete_boq_item(item_id: int) -> None:
    with get_connection() as conn:
        linked = conn.execute("SELECT COUNT(*) FROM sub_contract_items WHERE boq_item_id=?", (item_id,)).fetchone()[0]
        linked += conn.execute("SELECT COUNT(*) FROM vouchers WHERE boq_item_id=?", (item_id,)).fetchone()[0]
        if linked:
            raise ValidationError("لا يمكن حذف البند لأنه مرتبط بمقاول باطن أو سندات.")
        conn.execute("DELETE FROM boq_items WHERE id=?", (item_id,))

# ============================================================
# مقاولو الباطن
# ============================================================
def add_subcontractor(code: str, name: str, phone: str = "", email: str = "",
                      activity: str = "", notes: str = "",
                      show_all_contracts: bool = False) -> int:
    if not name.strip():
        raise ValidationError("اسم مقاول الباطن مطلوب.")
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO subcontractors (sub_code, name, phone, email, activity, notes, show_all_contracts) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (code.strip(), name.strip(), phone, email, activity, notes,
                 1 if show_all_contracts else 0))
            return cur.lastrowid
    except sqlite3.IntegrityError as exc:
        raise ValidationError("رقم المقاول مستخدم من قبل.") from exc

def get_subcontractor(sub_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM subcontractors WHERE id=?", (sub_id,)).fetchone()
    return dict(row) if row else None

def update_subcontractor(sub_id: int, code: str | None = None, name: str | None = None,
                         phone: str | None = None, email: str | None = None,
                         activity: str | None = None, notes: str | None = None,
                         show_all_contracts: bool | None = None) -> None:
    fields = {"sub_code": code, "name": name, "phone": phone,
              "email": email, "activity": activity, "notes": notes,
              "show_all_contracts": (None if show_all_contracts is None
                                     else 1 if show_all_contracts else 0)}
    sets, params = [], []
    for col, val in fields.items():
        if val is None:
            continue
        if col == "name" and not str(val).strip():
            raise ValidationError("اسم مقاول الباطن مطلوب.")
        if col == "sub_code" and not str(val).strip():
            raise ValidationError("رقم المقاول مطلوب.")
        sets.append(f"{col}=?")
        params.append(str(val).strip() if col in ("sub_code", "name") else val)
    if not sets:
        return
    params.append(sub_id)
    try:
        with get_connection() as conn:
            conn.execute(f"UPDATE subcontractors SET {', '.join(sets)} WHERE id=?", params)
    except sqlite3.IntegrityError as exc:
        raise ValidationError("رقم المقاول مستخدم من قبل.") from exc

def list_subcontractors(search: str = "") -> list[dict]:
    sql = "SELECT * FROM subcontractors"
    params = ()
    if search.strip():
        clause, p = normalized_search_clause(
            ["name", "sub_code", "phone", "activity"], search)
        sql += " WHERE " + clause
        params = tuple(p)
    sql += " ORDER BY id DESC"
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]

def add_sub_contract(subcontractor_id: int, contract_id: int,
                     project_id: int | None, amount: float,
                     start_date: str = "", end_date: str = "",
                     description: str = "", boq_item_ids: list[int] | None = None,
                     status: str = "نشط") -> int:
    if amount <= 0:
        raise ValidationError("قيمة عقد الباطن يجب أن تكون أكبر من صفر.")
    with get_connection() as conn:
        crow = conn.execute("SELECT project_id FROM contracts WHERE id=?", (contract_id,)).fetchone()
    if not crow:
        raise ValidationError("العقد الرئيسي غير موجود.")
    if project_id and crow["project_id"] and project_id != crow["project_id"]:
        raise ValidationError("المشروع المحدد لا يطابق مشروع العقد الرئيسي.")
    if crow["project_id"]:
        project_id = crow["project_id"]
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO sub_contracts (subcontractor_id, contract_id, project_id, "
            "amount, start_date, end_date, description, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (subcontractor_id, contract_id, project_id, amount,
             start_date, end_date, description, status))
        sid = cur.lastrowid
        for bid in (boq_item_ids or []):
            conn.execute(
                "INSERT INTO sub_contract_items (sub_contract_id, boq_item_id) "
                "VALUES (?, ?)", (sid, bid))
    with get_connection() as conn:
        sub = conn.execute("SELECT name FROM subcontractors WHERE id=?", (subcontractor_id,)).fetchone()
    log_event(contract_id, "إضافة مقاول باطن",
              f"{sub['name'] if sub else ''} · {amount:,.3f}")
    try:
        from services import workflow_service as _wf
        _wf.start_transaction(_wf.TX_SUBCONTRACT, sid)
    except Exception:
        pass
    return sid

def list_sub_contracts(contract_id: int | None = None, project_id: int | None = None) -> list[dict]:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("list_sub_contracts", contract_id, project_id),
                lambda: _list_sub_contracts_impl(contract_id, project_id))


def _list_sub_contracts_impl(contract_id: int | None = None, project_id: int | None = None) -> list[dict]:
    sql = """
    SELECT sc.*, s.name AS sub_name, s.sub_code, c.contract_number,
           p.name AS project_name,
           (SELECT GROUP_CONCAT(b.description, '، ') FROM sub_contract_items si
            JOIN boq_items b ON b.id = si.boq_item_id
            WHERE si.sub_contract_id = sc.id) AS boq_items_text
    FROM sub_contracts sc
    JOIN subcontractors s ON s.id = sc.subcontractor_id
    JOIN contracts c ON c.id = sc.contract_id
    LEFT JOIN projects p ON p.id = sc.project_id
    """
    where, params = [], []
    if contract_id:
        where.append("sc.contract_id=?"); params.append(contract_id)
    if project_id:
        where.append("sc.project_id=?"); params.append(project_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY sc.id DESC"
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]

def subcontractors_tree(search: str = "") -> list[dict]:
    with get_connection() as conn:
        subs = [dict(r) for r in conn.execute(
            "SELECT * FROM subcontractors ORDER BY name").fetchall()]
        rows = conn.execute("""
            SELECT sc.*, c.contract_number, c.contract_name,
                   cu.name AS customer_name, p.name AS project_name,
                   s.name AS sub_name, s.sub_code AS sub_code,
                   COALESCE(v.paid, 0) AS paid
            FROM sub_contracts sc
            JOIN contracts c ON c.id = sc.contract_id
            JOIN customers cu ON cu.id = c.customer_id
            JOIN subcontractors s ON s.id = sc.subcontractor_id
            LEFT JOIN projects p ON p.id = sc.project_id
            LEFT JOIN (SELECT party_id, contract_id, SUM(amount) AS paid
                       FROM vouchers
                       WHERE vtype='payment' AND cancelled=0
                         AND party_type='subcontractor'
                       GROUP BY party_id, contract_id) v
                   ON v.party_id = sc.subcontractor_id
                  AND v.contract_id = sc.contract_id
            ORDER BY sc.id DESC
        """).fetchall()
    by_sub: dict[int, list[dict]] = {}
    for r in rows:
        d = dict(r)
        d["paid"] = float(d["paid"])
        d["remaining"] = float(d["amount"]) - d["paid"]
        by_sub.setdefault(d["subcontractor_id"], []).append(d)
    result = []
    needle = (search or "").strip()
    for s in subs:
        contracts = by_sub.get(s["id"], [])
        if needle:
            hay = " ".join(str(x or "") for x in (
                s["name"], s["sub_code"], s.get("phone"), s.get("activity")))
            hay += " " + " ".join(
                str(c.get(k) or "") for c in contracts
                for k in ("contract_number", "contract_name",
                          "customer_name", "description"))
            if not search_contains(hay, needle):
                continue
        total = sum(float(c["amount"]) for c in contracts if c["status"] != "ملغى")
        seen_contracts = set()
        paid = 0.0
        for c in contracts:
            if c["status"] == "ملغى":
                continue
            if c["contract_id"] not in seen_contracts:
                paid += c["paid"]
                seen_contracts.add(c["contract_id"])
        result.append({**s, "contracts": contracts, "total": total,
                       "paid": paid, "remaining": total - paid})
    return result

def get_sub_contracts(sub_id: int) -> list[dict]:
    """عقود مقاول باطن محدد."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT sc.*, c.contract_number, c.contract_name,
                   cu.name AS customer_name,
                   COALESCE(v.paid, 0) AS paid_amount
            FROM sub_contracts sc
            JOIN contracts c ON c.id = sc.contract_id
            JOIN customers cu ON cu.id = c.customer_id
            LEFT JOIN (SELECT party_id, contract_id, SUM(amount) AS paid
                       FROM vouchers
                       WHERE vtype='payment' AND cancelled=0
                         AND party_type='subcontractor'
                       GROUP BY party_id, contract_id) v
                   ON v.party_id = sc.subcontractor_id
                  AND v.contract_id = sc.contract_id
            WHERE sc.subcontractor_id = ?
            ORDER BY sc.id DESC
        """, (sub_id,)).fetchall()
    return [dict(r) for r in rows]

def get_sub_payments(sub_id: int) -> list[dict]:
    """سندات صرف مقاول باطن محدد."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT v.id, v.voucher_number AS title,
                   v.amount, v.amount AS paid_amount,
                   v.vdate AS due_date,
                   v.description,
                   c.contract_number,
                   cu.name AS customer_name,
                   CASE WHEN v.cancelled = 1 THEN 'ملغاة' ELSE 'مسددة' END AS status
            FROM vouchers v
            JOIN sub_contracts sc ON sc.id = v.sub_contract_id
            JOIN contracts c ON c.id = sc.contract_id
            JOIN customers cu ON cu.id = c.customer_id
            WHERE sc.subcontractor_id = ?
              AND v.vtype = 'payment'
            ORDER BY v.vdate DESC, v.id DESC
        """, (sub_id,)).fetchall()
    return [dict(r) for r in rows]

def update_sub_contract(sub_contract_id: int, amount: float,
                        start_date: str = "", end_date: str = "",
                        description: str = "", status: str = "نشط",
                        cancel_reason: str = "", cancel_close_amount: float = 0.0) -> None:
    if amount <= 0:
        raise ValidationError("قيمة عقد الباطن يجب أن تكون أكبر من صفر.")
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM sub_contracts WHERE id=?", (sub_contract_id,)).fetchone()
        if not row:
            raise ValidationError("عقد الباطن غير موجود.")
        old_status = row["status"] or "نشط"
        cancel_close_amount = round(float(cancel_close_amount or 0), 3)
        if cancel_close_amount < 0:
            raise ValidationError("مبلغ الإغلاق لا يجوز أن يكون سالبًا.")
        # V4.2 (P1-3أ): الإنهاء محظور مع سطور مرحلية مستحقة غير مسددة.
        # (ختامية الباطن في الواجهة «منتهي» — و«مغلق» احتياطًا.)
        if status in ("منتهي", "مغلق") \
                and old_status not in ("منتهي", "مغلق"):
            _unpaid = sub_plan_unpaid_triggered(sub_contract_id)
            if _unpaid:
                _names = "، ".join(
                    (l.get("title") or "دفعة") for l in _unpaid[:5])
                raise ValidationError(
                    "لا يمكن إغلاق عقد الباطن · دفعات مستحقة غير مسددة:\n"
                    + _names)
        if status == "ملغى" and old_status != "ملغى":
            conn.execute(
                "UPDATE sub_contracts SET amount=?, start_date=?, end_date=?, "
                "description=?, status=?, cancel_reason=?, cancel_close_amount=?, cancelled_at=datetime('now','localtime') WHERE id=?",
                (amount, start_date, end_date, description, status,
                 (cancel_reason or "").strip(), cancel_close_amount, sub_contract_id))
        else:
            conn.execute(
                "UPDATE sub_contracts SET amount=?, start_date=?, end_date=?, "
                "description=?, status=? WHERE id=?",
                (amount, start_date, end_date, description, status, sub_contract_id))
    if status == "ملغى" and (row["status"] or "نشط") != "ملغى":
        log_event(row["contract_id"], "إلغاء عقد باطن",
                  f"القيمة: {amount:,.3f} · مبلغ الإغلاق: {cancel_close_amount:,.3f}" + (f" · السبب: {cancel_reason}" if cancel_reason else ""))
    else:
        log_event(row["contract_id"], "تعديل عقد باطن",
                  f"القيمة الجديدة: {amount:,.3f}")

def _rebuild_sub_contract_items_nullable(conn):
    """V8.6: إعادة بناء جدول sub_contract_items للسماح بـ NULL في boq_item_id."""
    import re, logging
    _log = logging.getLogger("lifecycle")
    sci_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='sub_contract_items'"
    ).fetchone()
    _create_sql = (sci_sql[0] or "") if sci_sql else ""
    if not re.search(r'boq_item_id\s+INTEGER\s+NOT\s+NULL', _create_sql, re.IGNORECASE):
        return False  # already nullable
    _log.info("Rebuilding sub_contract_items to allow NULL boq_item_id")
    conn.execute("ALTER TABLE sub_contract_items RENAME TO sub_contract_items_old")
    conn.execute("""
        CREATE TABLE sub_contract_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            sub_contract_id INTEGER NOT NULL REFERENCES sub_contracts(id) ON DELETE CASCADE,
            boq_item_id     INTEGER REFERENCES boq_items(id) ON DELETE CASCADE,
            qty             REAL DEFAULT 0,
            unit_price      REAL DEFAULT 0,
            amount          REAL DEFAULT 0,
            source_kind     TEXT DEFAULT '',
            source_id       INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        INSERT INTO sub_contract_items (id, sub_contract_id, boq_item_id, qty, unit_price, amount, source_kind, source_id)
        SELECT id, sub_contract_id, boq_item_id,
               COALESCE(qty, 0), COALESCE(unit_price, 0), COALESCE(amount, 0),
               COALESCE(source_kind, ''), COALESCE(source_id, 0)
        FROM sub_contract_items_old
    """)
    conn.execute("DROP TABLE sub_contract_items_old")
    _log.info("sub_contract_items rebuilt OK")
    return True

def _ensure_sci_nullable():
    """V8.6: يفحص ويعيد بناء الجدول قبل فتح معاملة (خارج with conn)."""
    try:
        with get_connection() as conn:
            _rebuild_sub_contract_items_nullable(conn)
    except Exception:
        pass  # will be caught by the main INSERT if still broken

def set_sub_contract_items(sub_contract_id: int, boq_item_ids=None,
                          pulled_items: list[dict] | None = None) -> int:
    """V4.5.11: ضبط بنود عقد الباطن (استبدال القائمة) من شاشة التعديل.

    شرطان: البند يتبع عقد العميل الأب، وألا يكون مرتبطًا بمقاول باطن آخر.
    
    V8.3: يدعم الآن pulled_items مع qty/unit_price/amount/source_kind/source_id.
    V8.6: يعيد بناء الجدول تلقائيًا إذا كان boq_item_id NOT NULL.
    """
    ids = [int(x) for x in (boq_item_ids or [])]
    
    # V8.6: التأكد أن boq_item_id يقبل NULL (قبل فتح المعاملة)
    if pulled_items:
        _ensure_sci_nullable()
    
    with get_connection() as conn:
        sc = conn.execute("SELECT contract_id FROM sub_contracts WHERE id=?",
                          (int(sub_contract_id),)).fetchone()
        if not sc:
            raise ValidationError("عقد الباطن غير موجود.")
        cid = int(sc["contract_id"])
        
        # V8.3: التحقق من البنود المُنزَّلة
        if pulled_items:
            allowed = {int(r["id"]) for r in conn.execute(
                "SELECT id FROM boq_items WHERE contract_id=? AND "
                "COALESCE(deleted_addendum_id,0)=0", (cid,)).fetchall()}
            for item in pulled_items:
                bid = item.get("boq_item_id")
                if bid and int(bid) not in allowed:
                    raise ValidationError("بند لا يتبع عقد العميل الأب.")
        else:
            allowed = {int(r["id"]) for r in conn.execute(
                "SELECT id FROM boq_items WHERE contract_id=? AND "
                "COALESCE(deleted_addendum_id,0)=0", (cid,)).fetchall()}
            for bid in ids:
                if bid not in allowed:
                    raise ValidationError("بند لا يتبع عقد العميل الأب.")
        
        if ids or pulled_items:
            # التحقق من عدم ارتباط البنود بمقاول آخر
            check_ids = ids.copy()
            if pulled_items:
                check_ids.extend([int(item.get("boq_item_id", 0)) for item in pulled_items if item.get("boq_item_id")])
            if check_ids:
                marks = ",".join("?" * len(check_ids))
                rows = conn.execute(
                    "SELECT si.boq_item_id, s.name FROM sub_contract_items si "
                    "JOIN sub_contracts sc ON sc.id = si.sub_contract_id "
                    "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                    "WHERE si.sub_contract_id<>? AND si.boq_item_id IN (" + marks
                    + ")", (int(sub_contract_id), *check_ids)).fetchall()
                if rows:
                    names = "، ".join(sorted({(r["name"] or "") for r in rows}))
                    raise ValidationError(
                        "بند مرتبط بمقاول باطن آخر (المقاول: " + names
                        + ") — أزله من عقده أولًا.")
            # V8.9: حصرية ل plan/stage
            if pulled_items:
                _sk_pairs = [(item.get("source_kind", ""),
                              int(item.get("source_id", 0) or 0))
                             for item in pulled_items
                             if item.get("source_kind") and int(item.get("source_id", 0) or 0)]
                for _sk, _sid in _sk_pairs:
                    _conflict = conn.execute(
                        "SELECT s.name FROM sub_contract_items sci "
                        "JOIN sub_contracts sc ON sc.id = sci.sub_contract_id "
                        "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                        "WHERE sci.sub_contract_id<>? AND sci.source_kind=? "
                        "AND sci.source_id=?",
                        (int(sub_contract_id), _sk, _sid)).fetchone()
                    if _conflict:
                        raise ValidationError(
                            f"بند ({_sk}) مرتبط بمقاول باطن آخر "
                            f"(المقاول: {_conflict['name']}) — أزله من عقده أولًا.")
        
        # حذف البنود القديمة
        conn.execute("DELETE FROM sub_contract_items WHERE sub_contract_id=?",
                     (int(sub_contract_id),))
        
        # إضافة البنود المُنزَّلة (V8.3)
        if pulled_items:
            for item in pulled_items:
                bid = item.get("boq_item_id")
                source_kind = item.get("source_kind", "")
                source_id = int(item.get("source_id", 0) or 0)
                conn.execute(
                    "INSERT INTO sub_contract_items "
                    "(sub_contract_id, boq_item_id, qty, unit_price, amount, "
                    "source_kind, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (int(sub_contract_id),
                     int(bid) if bid else None,
                     float(item.get("qty", 0) or 0),
                     float(item.get("unit_price", 0) or 0),
                     float(item.get("amount", 0) or 0),
                     source_kind,
                     source_id))
        else:
            # السلوك القديم: فقط boq_item_id
            for bid in ids:
                conn.execute(
                    "INSERT INTO sub_contract_items (sub_contract_id, boq_item_id) "
                    "VALUES (?, ?)", (int(sub_contract_id), bid))
    
    n_items = len(pulled_items) if pulled_items else len(ids)
    if n_items:
        log_event(cid, "بنود عقد باطن", f"تحديث البنود · {n_items} بند")
    return n_items


def _table_exists_local(conn, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone() is not None


def delete_sub_contract(sub_contract_id: int) -> None:
    with get_connection() as conn:
        row0 = conn.execute(
            "SELECT subcontractor_id, contract_id FROM sub_contracts WHERE id=?", (sub_contract_id,)).fetchone()
        # V5.4: تُحتسب السارية فقط — السندات الملغاة تُفكّ ولا تمنع
        linked = conn.execute(
            "SELECT COUNT(*) FROM vouchers WHERE sub_contract_id=? "
            "AND cancelled=0", (sub_contract_id,)).fetchone()[0]
        if row0:
            # V5.8: السندات **غير المرتبطة** بعقد باطن (قديمة/غامضة) على نفس
            # عقد العميل تمنع الحذف؛ أما سند مرتبط صراحةً بعقد باطن آخر فلا
            # يمنع حذف هذا العقد — كان يمنعه فتتعطّل خيارات الحذف المفردة.
            linked += conn.execute(
                "SELECT COUNT(*) FROM vouchers "
                "WHERE party_type='subcontractor' AND party_id=? "
                "AND contract_id=? AND cancelled=0 "
                "AND COALESCE(sub_contract_id, 0)=0",
                (row0["subcontractor_id"], row0["contract_id"])).fetchone()[0]
        if linked:
            raise ValidationError(
                "لا يمكن حذف عقد الباطن · للمقاول سندات صرف سارية "
                "على هذا العقد.\nألغِ السندات أولًا.")
        if _table_exists_local(conn, "claims"):
            _cl = conn.execute(
                "SELECT COUNT(*) FROM claims WHERE sub_contract_id=?",
                (sub_contract_id,)).fetchone()[0]
            if _cl:
                raise ValidationError(
                    f"لا يمكن حذف عقد الباطن · عليه {_cl} مطالبة مسجّلة.\n"
                    "احذف المطالبات أولًا.")
        # السندات الملغاة تُفكّ عن العقد (تبقى في السجل بلا ارتباط)
        conn.execute("UPDATE vouchers SET sub_contract_id=NULL "
                     "WHERE sub_contract_id=?", (sub_contract_id,))
        row = conn.execute("SELECT contract_id FROM sub_contracts WHERE id=?", (sub_contract_id,)).fetchone()
        # V5.4: تُحذف خطة الدفعات ومصادرها أيضًا (كانت تبقى معلّقة)
        try:
            conn.execute(
                "DELETE FROM sub_payment_sources WHERE sub_line_id IN "
                "(SELECT id FROM sub_payment_plan WHERE sub_contract_id=?)",
                (sub_contract_id,))
        except Exception:
            pass
        conn.execute("DELETE FROM sub_payment_plan WHERE sub_contract_id=?", (sub_contract_id,))
        # V5.5: أوامر التغييري تبقى في سجل العقد لكن بلا ارتباط بعقد باطن
        # محذوف، وتُحذف أسطر بنودها الخاصة بالمقاول (البند نفسه لعميل العميل).
        try:
            conn.execute("DELETE FROM addendum_items WHERE side='sub' "
                         "AND sub_contract_id=?", (sub_contract_id,))
            conn.execute("UPDATE addendums SET sub_contract_id=NULL "
                         "WHERE sub_contract_id=?", (sub_contract_id,))
        except Exception:
            pass
        conn.execute("DELETE FROM sub_contract_items WHERE sub_contract_id=?", (sub_contract_id,))
        conn.execute("DELETE FROM sub_contracts WHERE id=?", (sub_contract_id,))
    if row:
        log_event(row["contract_id"], "حذف عقد باطن", "")

# ============================================================
# V4.2 (P1-4): خطة دفعات عقد الباطن — مرآة payment_plan
#
# القواعد (نفس منطق العميل حرفيا):
#  - سطر مربوط بمرحلة من عقد العميل الاب لا يستحق الا بانهائها.
#  - المرحلة المتخطاة تخرج سطرها من الاستحقاق (P1-1) بلا كسر الاجمالي.
#  - سندات الصرف المرتبطة بعقد الباطن تغطي السطور بالترتيب (FIFO).
# ============================================================

def get_sub_contract(sub_contract_id: int):
    with get_connection() as conn:
        r = conn.execute(
            "SELECT sc.*, s.name AS sub_name, c.contract_number, "
            "c.contract_name FROM sub_contracts sc "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "JOIN contracts c ON c.id = sc.contract_id "
            "WHERE sc.id=?", (sub_contract_id,)).fetchone()
        return dict(r) if r else None


def sub_parent_stages(sub_contract_id: int) -> list[dict]:
    sc = _sub_parent_contract(sub_contract_id)
    if not sc:
        return []
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id, name, COALESCE(is_skipped,0) AS is_skipped, "
            "COALESCE(end_date,'') AS end_date FROM contract_stages "
            "WHERE contract_id=? AND level=1 ORDER BY sort_order, id",
            (sc["contract_id"],)).fetchall()]


def sub_payment_plan(sub_contract_id: int) -> list[dict]:
    from services.qcache import memo
    return memo(("sub_payment_plan", sub_contract_id),
                lambda: _sub_payment_plan_impl(sub_contract_id))


def _sub_payment_plan_impl(sub_contract_id: int,
                           exclude_voucher: int | None = None) -> list[dict]:
    from datetime import date as _date, datetime as _dt
    _ex = int(exclude_voucher or 0)
    with get_connection() as conn:
        items = [dict(r) for r in conn.execute(
            "SELECT sp.*, COALESCE(cs.is_skipped,0) AS linked_stage_skipped, "
            "cs.name AS stage_name, cs.end_date AS stage_end "
            "FROM sub_payment_plan sp "
            "LEFT JOIN contract_stages cs ON cs.id = sp.stage_id "
            "WHERE sp.sub_contract_id=? "
            "ORDER BY sp.sort_order", (sub_contract_id,)).fetchall()]
        paid = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE sub_contract_id=? AND vtype='payment' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation = '')"
            + (" AND id<>?" if _ex else ""),
            (sub_contract_id, _ex) if _ex else (sub_contract_id,)).fetchone()[0])
        # V5.4 (③): سندات صرف قديمة على المقاول بلا ربط بعقد الباطن —
        # تُحتسب إن كان لهذا المقاول **عقد باطن واحد** على نفس عقد العميل
        # (وإلا يبقى رقمها ظاهرًا للمراجعة في _sub_payment_plan_impl).
        _legacy = 0.0
        try:
            sc = conn.execute(
                "SELECT subcontractor_id, contract_id FROM sub_contracts "
                "WHERE id=?", (sub_contract_id,)).fetchone()
            if sc:
                n_same = int(conn.execute(
                    "SELECT COUNT(*) FROM sub_contracts WHERE subcontractor_id=? "
                    "AND contract_id=?",
                    (sc["subcontractor_id"], sc["contract_id"])).fetchone()[0])
                if n_same == 1:
                    _legacy = float(conn.execute(
                        "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                        "WHERE vtype='payment' AND cancelled=0 "
                        "AND party_type='subcontractor' AND party_id=? "
                        "AND contract_id=? "
                        "AND (sub_contract_id IS NULL OR sub_contract_id=0) "
                        "AND (allocation IS NULL OR allocation = '')",
                        (sc["subcontractor_id"], sc["contract_id"])).fetchone()[0])
                    paid += _legacy
        except Exception:
            _legacy = 0.0
    today = _date.today()
    # V5.4 (③): عند تعدد عقود الباطن لنفس المقاول على نفس عقد العميل،
    # تُذكر السندات غير المرتبطة بعددها ومبلغها حتى لا يبقى فرق صامت.
    if items:
        try:
            _sc0 = sub_row = None
            with get_connection() as _c0:
                sub_row = _c0.execute(
                    "SELECT subcontractor_id, contract_id FROM sub_contracts "
                    "WHERE id=?", (sub_contract_id,)).fetchone()
            if sub_row:
                with get_connection() as _c1:
                    _n_same = int(_c1.execute(
                        "SELECT COUNT(*) FROM sub_contracts WHERE "
                        "subcontractor_id=? AND contract_id=?",
                        (sub_row["subcontractor_id"],
                         sub_row["contract_id"])).fetchone()[0])
                    if _n_same > 1:
                        _lrow = _c1.execute(
                            "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s "
                            "FROM vouchers WHERE vtype='payment' AND cancelled=0 "
                            "AND party_type='subcontractor' AND party_id=? "
                            "AND contract_id=? "
                            "AND (sub_contract_id IS NULL OR sub_contract_id=0) "
                            "AND (allocation IS NULL OR allocation = '')",
                            (sub_row["subcontractor_id"],
                             sub_row["contract_id"])).fetchone()
                        if _lrow and int(_lrow["n"] or 0) > 0:
                            items[0]["unlinked_vouchers"] = int(_lrow["n"])
                            items[0]["unlinked_total"] = float(_lrow["s"] or 0)
        except Exception:
            pass
    # V6.2: المبالغ الموجّهة لدفعات المقاول (ربط سند الصرف بخط)
    with get_connection() as _c5:
        _links = {int(r["line_id"]): float(r["amt"] or 0)
                  for r in _c5.execute(
                      "SELECT l.line_id AS line_id, "
                      "COALESCE(SUM(l.amount),0) AS amt "
                      "FROM voucher_payment_links l "
                      "JOIN vouchers v ON v.id=l.voucher_id "
                      "WHERE l.kind='payment' AND COALESCE(v.cancelled,0)=0 "
                      + (" AND v.id<>?" if _ex else "")
                      + " GROUP BY l.line_id",
                      (_ex,) if _ex else ()).fetchall()}
    remaining_pool = max(0.0, paid - sum(_links.values()))
    for item in items:
        covered = min(remaining_pool, item["amount"])
        remaining_pool -= covered
        _lk = min(_links.get(int(item["id"]), 0.0),
                  max(0.0, item["amount"] - covered))
        covered += _lk
        item["covered"] = covered
        item["remaining"] = item["amount"] - covered
        stage_linked = bool(item.get("stage_id"))
        triggered = bool((item.get("triggered_at") or "").strip())
        try:
            due = _dt.strptime(item["due_date"], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            due = today
        if stage_linked and int(item.get("linked_stage_skipped") or 0):
            item["days_diff"] = 999999
            item["status"] = "مرحلة متخطاة"
            if not (item.get("notes") or "").strip():
                item["notes"] = "غير مستحقة لأن المرحلة المرتبطة تم تخطيها"
            continue
        if stage_linked and not triggered and item["remaining"] > 0.001:
            item["days_diff"] = 999999
            item["status"] = "بانتظار إنجاز المرحلة"
            continue
        item["days_diff"] = (due - today).days
        if item["remaining"] <= 0.001:
            item["status"] = "مدفوع"
        elif covered > 0.001:
            item["status"] = "جزئي" if due >= today else "متأخر"
        elif due < today:
            item["status"] = "متأخر"
        elif triggered:
            # V4.5.03: المثارة غير المدفوعة وحلّ أجلها = «مستحقة».
            item["status"] = "مستحقة"
        elif (due - today).days <= 7:
            item["status"] = "مستحق قريبًا"
        else:
            item["status"] = "لم يحل"
    return items


def _sub_parent_contract(sub_contract_id: int):
    with get_connection() as conn:
        r = conn.execute(
            "SELECT sc.*, c.contract_number FROM sub_contracts sc "
            "JOIN contracts c ON c.id = sc.contract_id "
            "WHERE sc.id=?", (sub_contract_id,)).fetchone()
        return dict(r) if r else None


def _validate_sub_plan_stage(sub_contract_id: int, stage_id) -> None:
    if not stage_id:
        return
    sc = _sub_parent_contract(sub_contract_id)
    if not sc:
        raise ValidationError("عقد الباطن غير موجود.")
    with get_connection() as conn:
        st = conn.execute(
            "SELECT id, contract_id, COALESCE(is_skipped,0) AS sk "
            "FROM contract_stages WHERE id=?", (stage_id,)).fetchone()
    if not st or int(st["contract_id"]) != int(sc["contract_id"]):
        raise ValidationError("المرحلة المختارة ليست من عقد العميل الأب.")
    if int(st["sk"]):
        raise ValidationError("لا تربط دفعة بمرحلة متخطاة.")


def add_sub_plan_line(sub_contract_id: int, title: str, due_date: str,
                      amount: float, stage_id=None) -> int:
    from datetime import datetime as _dt
    title = (title or "").strip()
    if not title:
        raise ValidationError("عنوان الدفعة مطلوب.")
    try:
        _dt.strptime((due_date or "")[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValidationError("تاريخ الاستحقاق غير صحيح (سنة-شهر-يوم).")
    if float(amount or 0) <= 0:
        raise ValidationError("مبلغ الدفعة يجب أن يكون أكبر من صفر.")
    _validate_sub_plan_stage(sub_contract_id, stage_id)
    with get_connection() as conn:
        sc = conn.execute("SELECT contract_id FROM sub_contracts WHERE id=?",
                          (sub_contract_id,)).fetchone()
        if not sc:
            raise ValidationError("عقد الباطن غير موجود.")
        nxt = conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 "
                           "FROM sub_payment_plan WHERE sub_contract_id=?",
                           (sub_contract_id,)).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO sub_payment_plan (sub_contract_id, title, due_date, "
            "amount, sort_order, stage_id) VALUES (?,?,?,?,?,?)",
            (sub_contract_id, title, (due_date or "")[:10],
             round(float(amount), 3), nxt, stage_id or None))
        log_event(int(sc["contract_id"]), "دفعة باطن",
                  str(title) + " · " + format(float(amount), ",.3f"))
        return int(cur.lastrowid)


def update_sub_plan_line(line_id: int, title: str, due_date: str,
                         amount: float, stage_id=None) -> None:
    from datetime import datetime as _dt
    title = (title or "").strip()
    if not title:
        raise ValidationError("عنوان الدفعة مطلوب.")
    try:
        _dt.strptime((due_date or "")[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValidationError("تاريخ الاستحقاق غير صحيح (سنة-شهر-يوم).")
    if float(amount or 0) <= 0:
        raise ValidationError("مبلغ الدفعة يجب أن يكون أكبر من صفر.")
    with get_connection() as conn:
        old = conn.execute("SELECT * FROM sub_payment_plan WHERE id=?",
                           (line_id,)).fetchone()
        if not old:
            raise ValidationError("سطر الدفعة غير موجود.")
        if (old["triggered_at"] or "").strip():
            raise ValidationError("الدفعة مفعّلة مرحليًا — لا تعديل عليها.")
    _validate_sub_plan_stage(int(old["sub_contract_id"]), stage_id)
    with get_connection() as conn:
        conn.execute(
            "UPDATE sub_payment_plan SET title=?, due_date=?, amount=?, "
            "stage_id=? WHERE id=?",
            (title, (due_date or "")[:10], round(float(amount), 3),
             stage_id or None, line_id))


def delete_sub_plan_line(line_id: int) -> None:
    with get_connection() as conn:
        old = conn.execute("SELECT * FROM sub_payment_plan WHERE id=?",
                           (line_id,)).fetchone()
        if not old:
            raise ValidationError("سطر الدفعة غير موجود.")
        if (old["triggered_at"] or "").strip():
            raise ValidationError("الدفعة مفعّلة مرحليًا — لا حذف لها.")
        conn.execute("DELETE FROM sub_payment_plan WHERE id=?", (line_id,))


def set_sub_line_sources(sub_line_id: int, cust_line_ids) -> None:
    """V4.6: مصادر دفعة الباطن من دفعات عقد العميل (تستبدل القديم).

    تُستحق الدفعة باكتمال كل مصادرها. المصادر من عقد العميل الأب فقط.

    V4.5.03: القائمة الفارغة مرفوضة — كل دفعة باطن لازم تتربط بدفعة
    عميل واحدة على الأقل (السطور القديمة بلا مصادر تبقى كما هي حتى تُمسّ).
    """
    with get_connection() as conn:
        srow = conn.execute(
            "SELECT sub_contract_id FROM sub_payment_plan WHERE id=?",
            (sub_line_id,)).fetchone()
        if not srow:
            raise ValidationError("سطر دفعة الباطن غير موجود.")
        sc = _sub_parent_contract(int(srow["sub_contract_id"]))
        if not sc:
            raise ValidationError("عقد الباطن غير موجود.")
        want = sorted({int(x) for x in (cust_line_ids or [])})
        if not want:
            raise ValidationError(
                "اختر دفعة عميل واحدة على الأقل — لا يمكن حفظ سطر "
                "الباطن بلا مصدر.")
        if want:
            ph = ",".join("?" for _ in want)
            rows = conn.execute(
                "SELECT id, contract_id FROM payment_plan WHERE id IN ("
                + ph + ")", want).fetchall()
            got = {int(r["id"]): int(r["contract_id"]) for r in rows}
            if len(got) != len(want):
                raise ValidationError("بعض دفعات العميل المختارة غير موجودة.")
            if any(c != int(sc["contract_id"]) for c in got.values()):
                raise ValidationError("مصادر الدفعة من عقد العميل نفسه فقط.")
        conn.execute("DELETE FROM sub_payment_sources WHERE sub_line_id=?",
                     (sub_line_id,))
        for cid in want:
            conn.execute(
                "INSERT INTO sub_payment_sources (sub_line_id, cust_line_id) "
                "VALUES (?,?)", (sub_line_id, cid))


def get_sub_line_sources(sub_line_id: int) -> list[dict]:
    """V4.6: مصادر سطر الباطن مع بياناتها وحالة تحريكها."""
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT pp.id, pp.title, pp.due_date, pp.amount, "
            "COALESCE(pp.triggered_at,'') AS triggered_at "
            "FROM sub_payment_sources sps "
            "JOIN payment_plan pp ON pp.id = sps.cust_line_id "
            "WHERE sps.sub_line_id=? ORDER BY pp.due_date, pp.sort_order",
            (sub_line_id,)).fetchall()]


def sub_sources_map(sub_contract_id: int) -> dict:
    """V4.6: عناوين المصادر لكل سطر خطة (دفعة واحدة للجداول)."""
    with get_connection() as conn:
        out = {}
        for r in conn.execute(
                "SELECT sps.sub_line_id, pp.title "
                "FROM sub_payment_sources sps "
                "JOIN sub_payment_plan sp ON sp.id = sps.sub_line_id "
                "JOIN payment_plan pp ON pp.id = sps.cust_line_id "
                "WHERE sp.sub_contract_id=? "
                "ORDER BY sps.sub_line_id, pp.due_date, pp.sort_order",
                (sub_contract_id,)):
            out.setdefault(int(r["sub_line_id"]), []).append(
                r["title"] or "دفعة")
    return out


def sub_source_ids(sub_contract_id: int) -> dict:
    """V6.2: {sub_line_id: [cust_line_id, ...]} — أرقام دفعات العميل المصدر.

    (``sub_sources_map`` تُرجع العناوين للعرض؛ بوابة المقاول تحتاج الأرقام.)
    """
    out: dict[int, list[int]] = {}
    with get_connection() as conn:
        for r in conn.execute(
                "SELECT sps.sub_line_id, sps.cust_line_id "
                "FROM sub_payment_sources sps "
                "JOIN sub_payment_plan sp ON sp.id = sps.sub_line_id "
                "WHERE sp.sub_contract_id=? "
                "ORDER BY sps.sub_line_id, sps.cust_line_id",
                (sub_contract_id,)):
            out.setdefault(int(r["sub_line_id"]), []).append(
                int(r["cust_line_id"]))
    return out


def sub_sources_status(sub_contract_id: int) -> dict:
    """V4.46: حالة اكتمال المصادر لكل سطر: {total/done/pending/ready}.

    ready = بلا مصادر (تستحق بمرحلتها/تاريخها) أو كل مصادرها محركة.
    """
    out: dict[int, dict] = {}
    with get_connection() as conn:
        for r in conn.execute(
                "SELECT sps.sub_line_id, pp.title, pp.triggered_at "
                "FROM sub_payment_sources sps "
                "JOIN sub_payment_plan sp ON sp.id = sps.sub_line_id "
                "JOIN payment_plan pp ON pp.id = sps.cust_line_id "
                "WHERE sp.sub_contract_id=? "
                "ORDER BY sps.sub_line_id, pp.due_date, pp.sort_order",
                (sub_contract_id,)):
            lid = int(r["sub_line_id"])
            st = out.setdefault(lid, {"total": 0, "done": 0,
                                      "pending": [], "ready": False})
            st["total"] += 1
            if (r["triggered_at"] or "").strip():
                st["done"] += 1
            else:
                st["pending"].append(r["title"] or "دفعة")
        for lid, st in out.items():
            st["ready"] = st["done"] >= st["total"]
    return out


def contract_payment_compare(contract_id: int) -> dict:
    """V4.46: مقارنة دفعات العميل (مستحق/محصّل) × دفعات المقاولين.

    المستحق = مجموع المبالغ المحركة فعليًا · المحصّل/المدفوع = التغطية
    (covered) بنفس منطق خطة السداد · بانتظار المصادر = سطور الباطن
    ذات المصادر غير المكتملة بعد.
    """
    cid = int(contract_id)
    client_lines = contract_payment_plan(cid)
    c_due = sum(float(x.get("amount") or 0) for x in client_lines
                if (x.get("triggered_at") or "").strip())
    c_got = sum(float(x.get("covered") or 0) for x in client_lines)
    subs = []
    for sc in list_sub_contracts(cid):
        scid = int(sc["id"])
        lines = sub_payment_plan(scid)
        due = sum(float(x.get("amount") or 0) for x in lines
                  if (x.get("triggered_at") or "").strip())
        paid = sum(float(x.get("covered") or 0) for x in lines)
        st = sub_sources_status(scid)
        waiting = sum(1 for lid, x in st.items() if not x["ready"])
        subs.append({"sc_id": scid,
                     "sub_name": sc.get("sub_name") or "",
                     "number": f"#{scid}",
                     "due": due, "paid": paid, "remaining": due - paid,
                     "waiting": waiting, "lines": len(lines)})
    s_due = sum(x["due"] for x in subs)
    s_paid = sum(x["paid"] for x in subs)
    return {"client": {"due": c_due, "collected": c_got,
                       "remaining": c_due - c_got,
                       "lines": len(client_lines)},
            "subs": subs,
            "subs_total": {"due": s_due, "paid": s_paid,
                           "remaining": s_due - s_paid}}


def manual_stages_remaining(contract_id: int) -> dict:
    """V4.44: متبقي قيمة العقد بعد دفعات خطته (للمراحل اليدوية)."""
    with get_connection() as conn:
        c = conn.execute("SELECT amount FROM contracts WHERE id=?",
                         (int(contract_id),)).fetchone()
        _planned = conn.execute(
            "SELECT COALESCE(SUM(amount),0) AS s FROM payment_plan "
            "WHERE contract_id=?", (int(contract_id),)).fetchone()
    _amount = round(float((c["amount"] if c else 0) or 0), 3)
    _planned = round(float((_planned["s"] if _planned else 0) or 0), 3)
    return {"amount": _amount, "planned": _planned,
            "remaining": round(_amount - _planned, 3)}


def add_contract_main_stages(contract_id: int,
                             rows: list[dict]) -> list[int]:
    """V4.44: مراحل رئيسية يدوية للعقد الشامل — كل مرحلة بدفعتها.

    rows: [{name, amount, days}] · الشروط: عقد شامل · نوعه بلا قالب
    دفعات (القالب يُزامَن فوق اليدوي) · المجموع ≤ المتبقي من القيمة.
    """
    from services import contract_service as _cs
    if not rows:
        return []
    with get_connection() as conn:
        c = conn.execute("SELECT * FROM contracts WHERE id=?",
                         (int(contract_id),)).fetchone()
        if not c:
            raise ValidationError("العقد غير موجود.")
        c = dict(c)
    if _cs.contract_mode(c) != "bundle":
        raise ValidationError("المراحل الرئيسية اليدوية للعقد الشامل فقط.")
    with get_connection() as conn:
        has_tpl = conn.execute(
            "SELECT 1 FROM type_payment_tpl WHERE contract_type=? LIMIT 1",
            ((c.get("contract_type") or ""),)).fetchone()
    if has_tpl:
        raise ValidationError(
            "نوع العقد له قالب دفعات — المراحل اليدوية للأنواع بلا قالب.")
    clean = []
    for r in rows:
        _name = ((r.get("name") or "").strip())
        _amt = round(float(r.get("amount") or 0), 3)
        _days = int(r.get("days") or 0)
        if not _name and _amt <= 0:
            continue
        if not _name:
            raise ValidationError("اسم المرحلة مطلوب.")
        if _amt <= 0:
            raise ValidationError(
                f"مبلغ المرحلة «{_name}» يجب أن يكون أكبر من صفر.")
        if _days < 0:
            raise ValidationError(f"أيام المرحلة «{_name}» لا تكون سالبة.")
        clean.append({"name": _name, "amount": _amt, "days": _days})
    if not clean:
        return []
    rem = manual_stages_remaining(contract_id)
    total = round(sum(r["amount"] for r in clean), 3)
    if total > rem["remaining"] + 0.001:
        raise ValidationError(
            f"مجموع المراحل ({total:,.3f}) يتجاوز المتبقي من قيمة العقد "
            f"({rem['remaining']:,.3f}) بعد الدفعات القائمة.")
    from datetime import date as _date, timedelta as _td
    try:
        _based = _date.fromisoformat(
            (c.get("contract_date") or "")[:10])
    except ValueError:
        _based = _date.today()
    _amount = rem["amount"]
    ids = []
    with get_connection() as conn:
        _maxs = conn.execute(
            "SELECT COALESCE(MAX(sort_order),0) AS m FROM contract_stages "
            "WHERE contract_id=?", (int(contract_id),)).fetchone()["m"]
        _maxp = conn.execute(
            "SELECT COALESCE(MAX(sort_order),0) AS m FROM payment_plan "
            "WHERE contract_id=?", (int(contract_id),)).fetchone()["m"]
        for i, r in enumerate(clean):
            _pct = round(r["amount"] / _amount * 100, 2) if _amount else 0
            cur = conn.execute(
                "INSERT INTO contract_stages (contract_id, name, level, "
                "parent_name, expected_days, pay_pct, pay_kind, "
                "sort_order, start_date, end_date, closed_by) "
                "VALUES (?,?,1,'',?,?,?,?, '', '', '')",
                (int(contract_id), r["name"], r["days"], _pct, "",
                 int(_maxs) + 1 + i))
            sid = cur.lastrowid
            _due = _based + _td(days=r["days"])
            conn.execute(
                "INSERT INTO payment_plan (contract_id, title, due_date, "
                "amount, sort_order, stage_id, manual_amount) "
                "VALUES (?,?,?,?,?,?,1)",
                (int(contract_id), "دفعة " + r["name"],
                 _due.isoformat(), r["amount"], int(_maxp) + 1 + i, sid))
            ids.append(sid)
        log_event(int(contract_id), "إضافة مراحل رئيسية",
                  f"{len(clean)} مراحل · {total:,.3f}")
    return ids


def sub_plan_autolink_guard(contract_id: int) -> list[str]:
    """V4.5.05: نواقص التوزيع والربط التلقائي لعقد باطن جديد.

    تُرجع قائمة فارغة عندما تكون الشروط مكتملة (مراحل + خطة عميل)،
    وإلا أسماء النواقص مع إرشاد مختصر لكل منها.
    """
    missing = []
    with get_connection() as conn:
        n_stages = conn.execute(
            "SELECT COUNT(*) FROM contract_stages WHERE contract_id=?",
            (contract_id,)).fetchone()[0]
        if not n_stages:
            missing.append("مراحل العقد — أدخل مراحل نوع العقد أولًا")
        n_pay = conn.execute(
            "SELECT COUNT(*) FROM payment_plan WHERE contract_id=?",
            (contract_id,)).fetchone()[0]
        if not n_pay:
            missing.append(
                "خطة دفعات العميل — أدخل مبالغ المراحل أولًا")
    return missing


def distribute_sub_plan(sub_contract_id: int) -> int:
    from datetime import date as _date
    sc = _sub_parent_contract(sub_contract_id)
    if not sc:
        raise ValidationError("عقد الباطن غير موجود.")
    with get_connection() as conn:
        plan = [dict(r) for r in conn.execute(
            "SELECT * FROM sub_payment_plan WHERE sub_contract_id=?",
            (sub_contract_id,)).fetchall()]
        if any((p.get("triggered_at") or "").strip() for p in plan):
            raise ValidationError("توجد دفعات مفعّلة — التوزيع قبل التفعيل فقط.")
        conn.execute("DELETE FROM sub_payment_plan WHERE sub_contract_id=?",
                     (sub_contract_id,))
        total = round(float(sc["amount"] or 0), 3)
        if total <= 0:
            raise ValidationError("قيمة عقد الباطن صفر — لا شيء للتوزيع.")
        due = (sc["end_date"] or "")[:10] or _date.today().isoformat()
        # V6.6: قراءة بنود المقاول لتوزيع الدفعات حسب المراحل
        _boq_ids = [int(r["boq_item_id"]) for r in conn.execute(
            "SELECT boq_item_id FROM sub_contract_items "
            "WHERE sub_contract_id=?", (sub_contract_id,)).fetchall()]
        # V6.1+V6.6: عقد العميل هو الأساس — صف باطن لكل دفعة مرحلة
        # أو لكل دفعة عميل إذا لم تكن البنود مربوطة بمراحل.
        rows = _sub_client_payment_rows(int(sc["contract_id"]), total, due,
                                        boq_item_ids=_boq_ids or None)
        if not rows:
            conn.execute(
                "INSERT INTO sub_payment_plan (sub_contract_id, title, "
                "due_date, amount, sort_order, stage_id) "
                "VALUES (?,?,?,?,?,NULL)",
                (sub_contract_id, "دفعة عقد الباطن", due, total, 1))
            log_event(int(sc["contract_id"]), "توزيع دفعات باطن",
                      "سطر أيام واحد (عقد العميل بلا خطة دفعات) · "
                      + format(total, ",.3f"))
            return 1
        for i, r in enumerate(rows):
            cur = conn.execute(
                "INSERT INTO sub_payment_plan (sub_contract_id, title, "
                "due_date, amount, sort_order, stage_id) "
                "VALUES (?,?,?,?,?,?)",
                (sub_contract_id, r["title"], r["due"], r["amount"],
                 i + 1, r["stage_id"]))
            for p in r["sources"]:
                conn.execute(
                    "INSERT OR IGNORE INTO sub_payment_sources "
                    "(sub_line_id, cust_line_id) VALUES (?, ?)",
                    (cur.lastrowid, p))
        log_event(int(sc["contract_id"]), "توزيع دفعات باطن",
                  str(len(rows)) + " دفعات — واحدة لكل دفعة عميل · "
                  + format(total, ",.3f"))
        return len(rows)


def _sub_client_payment_rows(contract_id: int, total: float,
                             due_fallback: str = "",
                             boq_item_ids: list[int] | None = None) -> list[dict]:
    """V6.1+V6.6: صف باطن لكل دفعة من دفعات عقد العميل.

    V6.6: إذا أُعطيت ``boq_item_ids`` وكانت البنود مربوطة بمراحل:
    - يُنشئ صفًا فقط للدفعات التي فيها بنود المقاول.
    - مبلغ كل صف = مجموع بنود المقاول في مرحلة تلك الدفعة.
    وإلا يبقى السلوك القديم (نسبي على كل الدفعات).
    """
    with get_connection() as conn:
        lines = [dict(r) for r in conn.execute(
            "SELECT pp.id, pp.title, pp.amount, pp.due_date, pp.stage_id, "
            "COALESCE(cs.is_skipped,0) AS stage_skipped "
            "FROM payment_plan pp "
            "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
            "WHERE pp.contract_id=? "
            "ORDER BY pp.due_date, pp.sort_order, pp.id",
            (int(contract_id),)).fetchall()]
    if not lines:
        return []

    # ── V6.6: توزيع حسب البنود ─────────────────────────────────────
    _item_stage_map: dict[int, float] = {}  # stage_id → sum of item totals
    if boq_item_ids:
        with get_connection() as conn:
            for r in conn.execute(
                    "SELECT stage_id, SUM(qty * unit_price) AS stot "
                    "FROM boq_items WHERE id IN ({}) "
                    "AND stage_id IS NOT NULL "
                    "AND COALESCE(deleted_addendum_id,0)=0 "
                    "GROUP BY stage_id".format(
                        ",".join("?" * len(boq_item_ids))),
                    boq_item_ids).fetchall():
                _item_stage_map[int(r["stage_id"])] = float(r["stot"] or 0)

    if _item_stage_map:
        # توزيع حسب البنود: صف لكل مرحلة (وليس لكل دفعة)
        # إذا كان هناك عدة دفعات لنفس المرحلة، نأخذ أقرب استحقاق
        _stage_pay: dict[int, dict] = {}  # stage_id → earliest payment
        for ln in lines:
            sid = ln.get("stage_id")
            if sid is None:
                continue
            sid = int(sid)
            if sid not in _item_stage_map:
                continue
            if sid not in _stage_pay:
                _stage_pay[sid] = ln
        rows = []
        for _idx, (sid, ln) in enumerate(_stage_pay.items(), 1):
            _sid = None if int(ln.get("stage_skipped") or 0) else sid
            # استخدام الدالة الآلية لتوليد العنوان بالعربية
            try:
                from services.workflow_service import _plan_title_for
                _title = _plan_title_for(_idx, {"title": f"دفعة {_idx}"})
            except Exception:
                _title = f"الدفعة {_idx}"
            rows.append({
                "title": _title,
                "stage_id": _sid,
                "due": (ln.get("due_date") or "")[:10] or due_fallback,
                "amount": round(_item_stage_map[sid], 3),
                "sources": [int(ln["id"])],
            })
        if rows:
            return rows
        # لا بنود بمراحل ⇒ fallback للتوزيع القديم

    # ── السلوك القديم (نسبي على كل الدفعات) ────────────────────────
    total = round(float(total or 0), 3)
    wsum = round(sum(float(x["amount"] or 0) for x in lines), 3)
    per = round(total / len(lines), 3) if lines else 0.0
    rows, run = [], 0.0
    for i, ln in enumerate(lines):
        if wsum > 0:
            amt = (round(total * float(ln["amount"] or 0) / wsum, 3)
                   if i < len(lines) - 1 else round(total - run, 3))
        else:
            amt = per if i < len(lines) - 1 else round(total - per * i, 3)
        run = round(run + amt, 3)
        _sid = None if int(ln.get("stage_skipped") or 0) else ln.get("stage_id")
        # استخدام الدالة الآلية لتوليد العنوان بالعربية
        try:
            from services.workflow_service import _plan_title_for
            _title = _plan_title_for(i + 1, {"title": f"دفعة {i + 1}"})
        except Exception:
            _title = f"الدفعة {i + 1}"
        rows.append({
            "title": _title,
            "stage_id": int(_sid) if _sid else None,
            "due": (ln.get("due_date") or "")[:10] or due_fallback,
            "amount": amt,
            "sources": [int(ln["id"])],
        })
    return rows


def sub_plan_preview(contract_id: int, total: float,
                     end_date: str = "",
                     boq_item_ids: list[int] | None = None) -> list[dict]:
    """V4.5.06+V6.6: معاينة توزيع دفعات باطن جديد قبل حفظه.

    تُستخدم في خطوة الدفعات داخل حوار إنشاء عقد المقاول؛ تُرجع صفوفًا
    جاهزة للتعديل في الذاكرة (بلا كتابة قاعدة بيانات) بنفس أرقام
    distribute_sub_plan.
    """
    from datetime import date as _date
    total = round(float(total or 0), 3)
    due = (end_date or "")[:10] or _date.today().isoformat()
    if total <= 0:
        raise ValidationError("قيمة عقد الباطن صفر — لا شيء للتوزيع.")
    # V6.1+V6.6: صف لكل دفعة مرحلة أو لكل دفعة عميل.
    rows = _sub_client_payment_rows(int(contract_id), total, due,
                                    boq_item_ids=boq_item_ids)
    if not rows:
        return [{"title": "دفعة عقد الباطن", "stage_id": None,
                 "due": due, "amount": total, "sources": []}]
    return rows


def sub_plan_unpaid_triggered(sub_contract_id: int) -> list[dict]:
    return [l for l in sub_payment_plan(sub_contract_id)
            if (l.get("triggered_at") or "").strip()
            and float(l.get("remaining") or 0) > 0.001]


def total_sub_contracts(contract_id: int) -> float:
    with get_connection() as conn:
        return float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM sub_contracts "
            "WHERE contract_id=? AND status != 'ملغى'", (contract_id,)).fetchone()[0])

# ============================================================
# السندات (صرف / قبض) + القيد المحاسبي التلقائي
# ============================================================
PARTY_TYPES = ["customer", "subcontractor", "partner"]

def _check_sub_payment_limit(sub_id: int, contract_id: int, amount: float,
                             exclude_voucher_id: int | None = None,
                             allow_overpay: bool = False) -> None:
    with get_connection() as conn:
        total = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM sub_contracts "
            "WHERE subcontractor_id=? AND contract_id=? AND status != 'ملغى'",
            (sub_id, contract_id)).fetchone()[0])
        sql = ("SELECT COALESCE(SUM(amount),0) FROM vouchers "
               "WHERE vtype='payment' AND cancelled=0 AND contract_id=? "
               "AND party_type='subcontractor' AND party_id=?")
        params: list = [contract_id, sub_id]
        if exclude_voucher_id:
            sql += " AND id != ?"
            params.append(exclude_voucher_id)
        paid = float(conn.execute(sql, params).fetchone()[0])
    remaining = total - paid
    if amount > remaining + 1e-9:
        msg = (
            "قيمة السند تتجاوز المتبقي للمقاول على هذا العقد.\n"
            f"قيمة عقود الباطن: {total:,.3f} · المنصرف له: {paid:,.3f}\n"
            f"المتبقي المسموح: {max(remaining, 0):,.3f}\n"
            "سيتم تسجيل الزيادة كـ (دفعة مقدمة) أو سداد زيادة."
        )
        if not allow_overpay:
            raise OverpayWarning(msg)



def _ensure_contract_accepts_financial_actions(contract_id: int | None) -> None:
    """العقد الملغى يتجمد ماليًا: لا سندات جديدة ولا تعديل سندات مرتبطة به."""
    if not contract_id:
        return
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM contracts WHERE id=?",
                           (contract_id,)).fetchone()
    if row and (row["status"] or "") == "ملغى":
        raise ValidationError(
            "العقد ملغى ومجمّد: لا يمكن إضافة أو تعديل سندات مرتبطة به.")


def _ensure_sub_contract_accepts_payments(sub_contract_id: int | None) -> None:
    """V9.15.17 (القرار 6): لا صرف على عقد باطن ملغى."""
    if not sub_contract_id:
        return
    with get_connection() as conn:
        row = conn.execute("SELECT status FROM sub_contracts WHERE id=?",
                           (int(sub_contract_id),)).fetchone()
    if row and (row["status"] or "") == "ملغى":
        raise ValidationError(
            "عقد الباطن ملغى: لا يمكن الصرف عليه ولا ربط سند بدفعاته.")


_CASH_ACCOUNT_NAMES = {"bank": "البنك", "cash": "الصندوق"}


# بنود تصفية العهدة: توزيع داخلي لمبلغ سبق خروجه عند التسليم —
# ليست خروجًا نقديًا جديدًا فتُستبعد من كل حسابات البنك/الصندوق.
# الحديث يُميَّز بالأعمدة · القديم (قبل الأعمدة) بعلامة الملاحظات.
SETTLEMENT_NOTES_MARKS = ("تصفية عهدة من حساب:", "إغلاق عهدة من حساب:")


def is_settlement_voucher(row) -> bool:
    """هل هذا السند بند تصفية عهدة (بلا أثر نقدي)؟"""
    # الاستعلام قد يُرجع العمود باسم gref (مستعار) أو باسمه الأصلي —
    # نقرأ كلًا منهما على حدة حتى لا يفشل أحدهما ويفقد المعرّف الآخر.
    gref = ""
    for _col in ("expense_group_ref", "gref"):
        try:
            gref = (row[_col] or "").strip()
        except Exception:
            gref = ""
        if gref:
            break
    try:
        has_custody = row["custody_account_id"] is not None
    except Exception:
        has_custody = False
    if has_custody and gref:
        return True
    try:
        notes = row["notes"] or ""
    except Exception:
        notes = ""
    return any(m in notes for m in SETTLEMENT_NOTES_MARKS)


_CASH_NAME_HINTS = ("بنك", "البنك", "صندوق", "الصندوق", "نقد",
                    "شيك", "تحويل", "KNET")


def _cash_wallet_of(text: str) -> str:
    """تصنيف الحساب النقدي إلى بنك/صندوق بنفس منطق التقرير المالي."""
    m = (text or "").strip()
    if any(k in m for k in ("تحويل", "شيك", "KNET", "بنك", "البنك")):
        return "bank"
    if any(k in m for k in ("نقد", "نقدًا", "نقدا", "صندوق", "الصندوق")):
        return "cash"
    return "cash"


def cash_account_balances(date_to: str = "", exclude_voucher_id: int | None = None) -> dict:
    """رصيد البنك والصندوق حسب السندات غير الملغاة.

    يستخدمه التحويل الداخلي لمنع تحويل مبلغ أكبر من الرصيد الفعلي للحساب
    المصدر. الرصيد الافتتاحي القديم يُعامل كرصيد صندوق إذا لم تكن هناك
    خانات افتتاحية مفصلة للبنك/الصندوق.
    """
    from services import settings_service
    st = settings_service.get_settings()
    opening = float(getattr(st, "opening_balance", 0) or 0)
    opening_cash_raw = getattr(st, "opening_balance_cash", None)
    opening_cash = float(opening_cash_raw if opening_cash_raw is not None else opening)
    opening_bank = float(getattr(st, "opening_balance_bank", 0) or 0)
    balances = {"bank": opening_bank, "cash": opening_cash}
    where = ["COALESCE(cancelled,0)=0"]
    params: list = []
    if date_to:
        where.append("vdate <= ?")
        params.append(date_to)
    opening_date = (getattr(st, "opening_balance_date", "") or "").strip()
    if opening_date:
        where.append("vdate >= ?")
        params.append(opening_date)
    # V5.9: بداية الاحتساب النقدي — الحركات الأقدم تُستبعد من أرصدة
    # البنك/الصندوق ومن منع التحويل الداخلي (بلا حذف أي سند).
    _cash_start = (getattr(st, "cash_start_date", "") or "").strip()
    if _cash_start:
        where.append("vdate >= ?")
        params.append(_cash_start)
    if exclude_voucher_id:
        where.append("id != ?")
        params.append(int(exclude_voucher_id))
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT vtype, COALESCE(method,'') AS method, COALESCE(account,'') AS account, amount, "
            "custody_account_id, COALESCE(expense_group_ref,'') AS gref, COALESCE(notes,'') AS notes "
            f"FROM vouchers WHERE {' AND '.join(where)} ORDER BY vdate, id",
            params).fetchall()
    for r in rows:
        amt = float(r["amount"] or 0)
        if r["vtype"] == "receipt":
            balances[_cash_wallet_of(r["method"])] += amt
        elif r["vtype"] == "payment":
            if is_settlement_voucher(r):
                # تصفية عهدة: توزيع داخلي — خرجت نقدًا عند التسليم فقط
                continue
            balances[_cash_wallet_of(r["method"])] -= amt
        elif r["vtype"] == "transfer":
            balances[_cash_wallet_of(r["method"])] -= amt
            balances[_cash_wallet_of(r["account"])] += amt
        elif r["vtype"] == "custody_return":
            # V4.52: الإرجاع نقدية عائدة — تزيد محفظة الاستلام.
            balances[_cash_wallet_of(r["method"])] += amt
    balances["total"] = balances["bank"] + balances["cash"]
    return balances


def _ensure_transfer_source_balance(source_account: str, amount: float, vdate: str = "",
                                    exclude_voucher_id: int | None = None) -> None:
    src_wallet = _cash_wallet_of(source_account)
    balances = cash_account_balances(vdate, exclude_voucher_id=exclude_voucher_id)
    available = float(balances.get(src_wallet, 0) or 0)
    src_name = _CASH_ACCOUNT_NAMES.get(src_wallet, source_account or "الحساب المصدر")
    if available <= 0.0005:
        raise ValidationError(
            f"لا يمكن تنفيذ التحويل الداخلي: رصيد {src_name} صفر أو غير كافٍ.\n"
            f"الرصيد الحالي: {available:,.3f} د.ك")
    if float(amount or 0) > available + 0.0005:
        raise ValidationError(
            f"لا يمكن تنفيذ التحويل الداخلي: المبلغ أكبر من رصيد {src_name}.\n"
            f"المبلغ المطلوب: {float(amount or 0):,.3f} د.ك\n"
            f"الرصيد المتاح: {available:,.3f} د.ك")


@atomic
def partner_balance(date_to: str = "") -> float:
    """رصيد جاري الشريك (تمويل − مسحوبات) حتى تاريخ — بلا افتتاحي."""
    q = ("SELECT COALESCE(SUM(CASE WHEN vtype='receipt' THEN amount "
         "WHEN vtype='payment' THEN -amount ELSE 0 END),0) FROM vouchers "
         "WHERE COALESCE(cancelled,0)=0 AND party_type='partner'")
    params: list = []
    if date_to:
        q += " AND vdate <= ?"
        params.append(date_to)
    with get_connection() as conn:
        return float(conn.execute(q, params).fetchone()[0] or 0)


def migrate_owner_to_partner() -> dict:
    """V4.33: ترحيل «جاري المالك» ← «جاري الشريك» (مرة واحدة، آمن للتكرار).

    يعيد عدّادات الصفوف المرحّلة {vouchers, journals} — كلها UPDATEs
    مشروطة بالقيم القديمة فقط فلا تمسّ أي بيانات أخرى.
    """
    out = {"vouchers": 0, "journals": 0}
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE vouchers SET party_type='partner' WHERE party_type='owner'")
        out["vouchers"] += cur.rowcount or 0
        cur = conn.execute(
            "UPDATE vouchers SET party='الشريك' WHERE party='المالك'")
        out["vouchers"] += cur.rowcount or 0
        cur = conn.execute(
            "UPDATE vouchers SET account='جاري الشريك' "
            "WHERE account='جاري المالك'")
        out["vouchers"] += cur.rowcount or 0
        for col in ("description", "notes"):
            try:
                # الصيغتان: «المالك» و«للمالك» (بلا ألف — مثل «مسحوبات للمالك»).
                cur = conn.execute(
                    f"UPDATE vouchers SET {col}=REPLACE(REPLACE("
                    f"{col},'المالك','الشريك'),'للمالك','للشريك') "
                    f"WHERE party_type='partner' AND {col} LIKE '%مالك%'")
                out["vouchers"] += cur.rowcount or 0
            except Exception:
                pass
        for col in ("debit_account", "credit_account"):
            cur = conn.execute(
                f"UPDATE journal_entries SET {col}='جاري الشريك' "
                f"WHERE {col}='جاري المالك'")
            out["journals"] += cur.rowcount or 0
        cur = conn.execute(
            "UPDATE journal_entries SET description=REPLACE(REPLACE("
            "description,'المالك','الشريك'),'للمالك','للشريك') "
            "WHERE description LIKE '%مالك%' AND "
            "(debit_account='جاري الشريك' OR credit_account='جاري الشريك')")
        out["journals"] += cur.rowcount or 0
    return out


@atomic
def _payment_fallback_description(party: str = "",
                                  expense_account_id: int | None = None,
                                  expense_customer_id: int | None = None) -> str:
    """V9.15.2: بيان احتياطي لسند الصرف إذا تُرك فارغًا.

    الشكل: «اسم المصروف — المورد/الجهة — العميل» (ما يتوفر منها فقط).
    """
    acc_name = ""
    try:
        from services import expense_account_service as _ea
        _acc = _ea.get_account(int(expense_account_id)) if expense_account_id else None
        acc_name = ((_acc or {}).get("name") or "").strip()
    except Exception:
        acc_name = ""
    cust_name = ""
    if expense_customer_id:
        try:
            with get_connection() as conn:
                _r = conn.execute("SELECT name FROM customers WHERE id=?",
                                  (int(expense_customer_id),)).fetchone()
            cust_name = ((_r["name"] if _r else "") or "").strip()
        except Exception:
            cust_name = ""
    parts = [acc_name, (party or "").strip(), cust_name]
    return " — ".join(p for p in parts if p)


def add_voucher(vtype: str, vdate: str, party: str, method: str, account: str,
                amount: float, description: str,
                project_id: int | None = None, contract_id: int | None = None,
                boq_item_id: int | None = None, sub_contract_id: int | None = None,
                cost_center: str = "", attachment: str = "",
                notes: str = "", party_type: str = "",
                party_id: int | None = None,
                cheque_due_date: str = "",
                allocation: str = "",
                expense_customer_id: int | None = None,
                _voucher_number: str = "",
                allow_overpay: bool = False,
                suppress_bank_fee: bool = False,
                expense_account_id: int | None = None,
                expense_group_ref: str = "",
                expense_group_line: int | None = None,
                custody_account_id: int | None = None,
                parent_voucher_id: int | None = None,
                advance_employee_id: int | None = None,
                payment_link: dict | None = None) -> int:
    if vtype not in ("payment", "receipt", "transfer", "custody_return",
                     "salary_deduction"):
        raise ValidationError("نوع السند غير صحيح.")
    if custody_account_id and advance_employee_id:
        raise ValidationError("السند لا يجمع بين عهدة وسلفة موظف.")
    if vtype == "custody_return" and not custody_account_id \
            and not advance_employee_id:
        raise ValidationError("الإرجاع يتطلب حساب عهدة أو موظفًا.")
    if vtype == "salary_deduction" and not advance_employee_id:
        raise ValidationError("الخصم من الراتب يتطلب موظفًا.")
    if party_type == "partner" or (account or "").strip() == "جاري الشريك":
        from services import auth_service as _auth
        if not _auth.is_admin():
            raise ValidationError("جاري الشريك للمدير فقط.")
    if amount <= 0:
        raise ValidationError("مبلغ السند يجب أن يكون أكبر من صفر.")
    if not vdate.strip():
        raise ValidationError("تاريخ السند مطلوب.")
    if (vtype == "payment" and not (description or "").strip()
            and party_type != "partner"):
        description = _payment_fallback_description(
            party, expense_account_id, expense_customer_id)
    if vtype == "payment":
        if party_type and party_type not in PARTY_TYPES:
            raise ValidationError("نوع الطرف غير صحيح.")
        if party_type and not party_id and party_type != "partner":
            raise ValidationError("سند الصرف يجب أن يرتبط بعميل أو مقاول باطن.")
    if vtype == "transfer":
        src = (method or "").strip()
        dst = (account or "").strip()
        if not src or not dst:
            raise ValidationError("حدد حساب التحويل: من حساب وإلى حساب.")
        if src == dst:
            raise ValidationError("لا يمكن التحويل بين نفس الحساب.")
        if _cash_wallet_of(src) == _cash_wallet_of(dst):
            raise ValidationError("اختر حسابين مختلفين فعلًا: البنك والصندوق.")
        _ensure_transfer_source_balance(src, amount, vdate)
        party_type = "transfer"
        party_id = None
        party = "تحويل داخلي"
        contract_id = project_id = boq_item_id = sub_contract_id = expense_customer_id = None
    if party_type and party_id:
        with get_connection() as conn:
            if party_type == "customer":
                row = conn.execute("SELECT name FROM customers WHERE id=?", (party_id,)).fetchone()
            else:
                row = conn.execute("SELECT name FROM subcontractors WHERE id=?", (party_id,)).fetchone()
        if not row:
            raise ValidationError("الطرف المحدد غير موجود.")
        party = row["name"]
    elif not party.strip():
        raise ValidationError("يجب تحديد طرف السند.")
    if expense_customer_id:
        with get_connection() as conn:
            if not conn.execute("SELECT 1 FROM customers WHERE id=?", (expense_customer_id,)).fetchone():
                raise ValidationError("العميل التحليلي للمنصرف غير موجود.")
    if vtype == "payment":
        _ensure_sub_contract_accepts_payments(sub_contract_id)
    if payment_link and vtype in ("receipt", "payment"):
        # V9.15.17: التحقق قبل إدراج السند — رفض الربط لا يترك سندًا بلا ربط
        from services import voucher_payment_link_service as _vpl
        _lk_kind = "receipt" if vtype == "receipt" else "payment"
        _lk_sels = [(int(a), float(b))
                    for a, b in (payment_link or {}).get("selections") or []]
        if _lk_sels:
            _lk_cands = _vpl.due_lines(_lk_kind, contract_id=contract_id,
                                       sub_contract_id=sub_contract_id)
            _vpl.validate_selections(_lk_cands, _lk_sels)
    if contract_id:
        _ensure_contract_accepts_financial_actions(contract_id)
        with get_connection() as conn:
            crow = conn.execute(
                "SELECT customer_id, project_id FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if not crow:
            raise ValidationError("العقد غير موجود.")
        if party_type == "customer" and party_id and crow["customer_id"] != party_id:
            raise ValidationError("العقد المحدد لا يخص هذا العميل.\nاختر عقدًا من عقود العميل نفسه.")
        if party_type == "subcontractor" and party_id:
            with get_connection() as conn:
                linked = conn.execute(
                    "SELECT COUNT(*) FROM sub_contracts "
                    "WHERE subcontractor_id=? AND contract_id=? AND status != 'ملغى'",
                    (party_id, contract_id)).fetchone()[0]
            if not linked:
                raise ValidationError("هذا المقاول غير مرتبط بالعقد المحدد.\nاربطه أولًا بعقد باطن من شاشة مقاولي الباطن.")
            if vtype == "payment":
                _check_sub_payment_limit(party_id, contract_id, amount, allow_overpay=allow_overpay)
        if project_id and crow["project_id"] and project_id != crow["project_id"]:
            raise ValidationError("المشروع المحدد لا يطابق مشروع العقد.")
        if crow["project_id"]:
            project_id = crow["project_id"]
    expense_account_snapshot = ""
    custody_account_snapshot = ""
    if vtype == "custody_return" and custody_account_id \
            and not advance_employee_id:
        # V4.52: إرجاع عهدة — حركة أصول (عهدة ← صندوق) لا إيراد ولا مصروف.
        from services import expense_account_service as _ea52
        _cacc52 = _ea52.get_account(custody_account_id)
        if not _cacc52 or (_cacc52.get("account_kind") or "") != "advance":
            raise ValidationError("حساب العهدة غير صحيح.")
        custody_account_snapshot = (_cacc52.get("full_path")
                                    or _cacc52.get("name") or "")
        account = _CASH_ACCOUNT_NAMES.get(_cash_wallet_of(method),
                                          "الصندوق")
        expense_account_id = None
        _avail52 = next((float(b.get("balance") or 0)
                         for b in custody_balances()
                         if int(b.get("account_id") or 0) == int(custody_account_id)),
                        0.0)
        if amount > _avail52 + 0.0005:
            raise ValidationError(
                "مبلغ الإرجاع يتجاوز متبقي العهدة.\n"
                f"المتبقي: {_avail52:,.3f} د.ك")
    if vtype == "custody_return" and advance_employee_id:
        # V4.53: رد سلفة نقدًا — يخفض المصروف (دائن السلف) ويدخل الخزينة.
        _emp53 = get_employee(advance_employee_id)
        if not _emp53 or not _emp53.get("active"):
            raise ValidationError("الموظف غير موجود أو موقوف.")
        _sid53, _spath53 = ensure_employee_advance_account()
        expense_account_id = _sid53
        expense_account_snapshot = _spath53
        account = _CASH_ACCOUNT_NAMES.get(_cash_wallet_of(method),
                                          "الصندوق")
        _avail53 = employee_balance(int(advance_employee_id))
        if amount > _avail53 + 0.0005:
            raise ValidationError(
                "مبلغ الرد يتجاوز متبقي سلفة الموظف.\n"
                f"المتبقي: {_avail53:,.3f} د.ك")
    if vtype == "salary_deduction":
        # V4.53: خصم من راتب — مدين رواتب دائن السلف، بلا نقدية.
        _emp53d = get_employee(advance_employee_id)
        if not _emp53d or not _emp53d.get("active"):
            raise ValidationError("الموظف غير موجود أو موقوف.")
        _rid53, _rpath53 = ensure_salary_account()
        expense_account_id = _rid53
        expense_account_snapshot = _rpath53
        account = _rpath53
        _avail53d = employee_balance(int(advance_employee_id))
        if amount > _avail53d + 0.0005:
            raise ValidationError(
                "مبلغ الخصم يتجاوز متبقي سلفة الموظف.\n"
                f"المتبقي: {_avail53d:,.3f} د.ك")
    if vtype == "payment":
        # «تسليم عهدة»: سُلفة لموظف لا مصروف — يُقيَّد على حساب العهدة
        # نفسه بلا حساب مصروف، فلا يدخل الربحية ولا يُحتسب تكلفة مرتين.
        # يُميَّز بأن custody_account_id محدد و expense_account_id فارغ.
        is_custody_handover = bool(custody_account_id) and not expense_account_id
        try:
            from services import expense_account_service as _ea
            if custody_account_id:
                cust_acc = _ea.get_account(custody_account_id)
                if cust_acc and (cust_acc.get("account_kind") or "") == "advance":
                    custody_account_snapshot = cust_acc.get("full_path") or cust_acc.get("name") or ""
                else:
                    raise ValidationError("حساب العهدة غير صحيح.")
            if is_custody_handover:
                # الحساب المعروض = حساب العهدة · بلا حساب مصروف
                account = custody_account_snapshot
                expense_account_snapshot = ""
                expense_account_id = None
            else:
                expense_account_id, expense_account_snapshot, _include = _ea.account_snapshot(
                    expense_account_id, account or "مصروف / تكلفة المشروع")
                account = expense_account_snapshot
        except ValidationError:
            raise
        except Exception:
            if not is_custody_handover:
                expense_account_snapshot = account or "مصروف / تكلفة المشروع"
    if vtype == "payment" and advance_employee_id:
        # V4.53: سلفة الموظف تُقيَّد على حساب السلف حصرًا.
        _sid53p, _ = ensure_employee_advance_account()
        if int(expense_account_id or 0) != _sid53p:
            raise ValidationError(
                "سلفة الموظف تُقيَّد على حساب «سلف موظفين» فقط.")
    if vtype == "receipt" and contract_id:
        value = contract_current_value(contract_id)
        with get_connection() as conn:
            collected = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                (contract_id,)).fetchone()[0])
        due_value = value["current"]
        from services.supervision_service import supervision_status
        sup = supervision_status(contract_id)
        if sup:
            due_value = max(due_value, sup["total_due"])
        remaining = due_value - collected
        if amount > remaining + 1e-9:
            if not allow_overpay:
                raise OverpayWarning(
                    "قيمة السند تتجاوز المبلغ المتبقي من العقد.\n"
                    f"المتبقي: {remaining:,.3f}\n"
                    "سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.")
    number = _voucher_number or next_voucher_number(vtype)
    vid = None
    # حماية من سباق الترقيم على القاعدة المشتركة: لو جهازان حاولا حفظ نفس
    # رقم السند، يعيد الجهاز الثاني توليد الرقم ويحفظ دون تكرار.
    # داخل معاملة @atomic الخارجية: تنفيذ مباشر بلا with داخلية،
    # حتى لا تسمم إعادة المحاولة المعالَجة (رقم مكرر) المعاملة الخارجية.
    _acon = get_connection()
    for attempt in range(8):
        try:
            cur = _acon.execute(
                    "INSERT INTO vouchers (voucher_number, vtype, vdate, party, party_type, "
                    "party_id, method, account, expense_account_id, expense_account_snapshot, "
                    "expense_group_ref, expense_group_line, custody_account_id, custody_account_snapshot, "
                    "amount, description, project_id, expense_customer_id, contract_id, "
                    "boq_item_id, sub_contract_id, cost_center, attachment, notes, "
                    "cheque_due_date, allocation, parent_voucher_id, "
                    "advance_employee_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (number, vtype, vdate, party, party_type, party_id, method, account,
                     expense_account_id, expense_account_snapshot, expense_group_ref or "", expense_group_line,
                     custody_account_id, custody_account_snapshot,
                     amount, description, project_id, expense_customer_id, contract_id, boq_item_id,
                     sub_contract_id, cost_center, attachment, notes,
                     cheque_due_date if "شيك" in (method or "") else "",
                     allocation or "", parent_voucher_id,
                     advance_employee_id))
            vid = cur.lastrowid
            break
        except sqlite3.IntegrityError as exc:
            if "voucher_number" in str(exc).lower() and not _voucher_number and attempt < 7:
                number = next_voucher_number(vtype)
                continue
            raise ValidationError("رقم السند مستخدم من قبل، حاول مرة أخرى.") from exc
    if vid is None:
        raise ValidationError("تعذر حجز رقم سند غير مكرر، حاول مرة أخرى.")

    if vtype == "transfer":
        debit, credit = account, method
        event = "تحويل داخلي"
    elif vtype == "custody_return":
        debit, credit = account or "الصندوق", custody_account_snapshot or "العهد"
        event = "إرجاع عهدة"
    elif vtype == "salary_deduction":
        debit, credit = account or "رواتب", "سلف الموظفين"
        event = "خصم سلفة من راتب"
    elif vtype == "payment":
        debit, credit = "مصروف / تكلفة المشروع", account or "البنك / الصندوق"
        event = "إنشاء سند صرف"
    else:
        debit, credit = account or "البنك / الصندوق", "العملاء / إيرادات العقد"
        event = "إنشاء سند قبض"
    with get_connection() as conn:
        _insert_voucher_journal(conn, vid, vtype, vdate, number, description,
                                amount, project_id, contract_id, boq_item_id,
                                sub_contract_id, cost_center, account)
    if contract_id:
        log_event(contract_id, event, f"{number} · {amount:,.3f}")
        if vtype == "receipt":
            _auto_receipt_comment(vid)
    if vtype == "receipt" and not suppress_bank_fee \
            and party_type != "partner":
        with get_connection() as conn:
            parent_con = conn.execute(
                "SELECT contract_id FROM vouchers WHERE id=?", (vid,)).fetchone()
        parent_cid = parent_con["contract_id"] if parent_con else None
        _create_fee_voucher(vid, vdate, method, number, amount, parent_contract_id=parent_cid)
    elif vtype == "payment":
        try:
            from services import workflow_service as _wf
            _wf.start_transaction(_wf.TX_PAYMENT, vid)
        except Exception:
            pass
    # V4.48: التسديد التلقائي للمطالبات المعتمدة المغطاة — لا يعطل السند.
    if vtype in ("receipt", "payment") and (contract_id or sub_contract_id):
        try:
            from services import claims_service as _clm48
            _cid48 = contract_id
            if not _cid48 and sub_contract_id:
                with get_connection() as _c48:
                    _r48 = _c48.execute(
                        "SELECT contract_id FROM sub_contracts WHERE id=?",
                        (sub_contract_id,)).fetchone()
                _cid48 = _r48["contract_id"] if _r48 else None
            if _cid48:
                _clm48.auto_settle_contract(_cid48, number)
        except Exception:
            pass
    # V6.2: ربط السند بدفعة مستحقة (قبض ← دفعات العميل · صرف ← دفعات المقاول)
    if payment_link and vtype in ("receipt", "payment"):
        _apply_payment_link(
            vid, "receipt" if vtype == "receipt" else "payment",
            contract_id, sub_contract_id, payment_link)
    return vid



def _journal_text(conn, number: str, description: str, vtype: str,
                  sub_contract_id=None) -> str:
    """نص القيد: رقم السند + البيان، ويُضاف اسم المقاول لسندات الصرف (V9.15.17)."""
    text = f"{number}: {description}"
    if vtype == "payment" and sub_contract_id:
        try:
            row = conn.execute(
                "SELECT s.name AS name FROM sub_contracts sc "
                "JOIN subcontractors s ON s.id = sc.subcontractor_id "
                "WHERE sc.id=?", (int(sub_contract_id),)).fetchone()
        except Exception:
            row = None
        name = (row["name"] if row else "") or ""
        if name.strip():
            text += f" — المقاول: {name.strip()}"
    return text


def _insert_voucher_journal(conn, voucher_id: int, vtype: str, vdate: str,
                            number: str, description: str, amount: float,
                            project_id=None, contract_id=None, boq_item_id=None,
                            sub_contract_id=None, cost_center: str = "",
                            account: str = "") -> None:
    """قيد يومية موحد لكل سند.

    مهم محاسبيًا: أي سند يظهر في الدفاتر يجب أن يكون له قيد مقابل،
    بما في ذلك سند رسوم البنك التلقائي.
    """
    _ptype, _pmethod = "", ""
    try:
        _prow = conn.execute(
            "SELECT party_type, method FROM vouchers WHERE id=?",
            (voucher_id,)).fetchone()
        if _prow:
            _ptype = _prow["party_type"] or ""
            _pmethod = _prow["method"] or ""
    except Exception:
        pass
    if _ptype == "partner" and vtype in ("receipt", "payment"):
        # جاري الشريك: تمويل/مسحوبات — رصيد فقط بلا إيراد/مصروف.
        _w = _CASH_ACCOUNT_NAMES.get(_cash_wallet_of(_pmethod), "البنك")
        if vtype == "receipt":
            debit, credit = _w, "جاري الشريك"
        else:
            debit, credit = "جاري الشريك", _w
    elif vtype == "transfer":
        # تحويل داخلي: ليس مصروفًا. الحساب المستقبل مدين والخارج منه دائن.
        row = conn.execute("SELECT method, account FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
        debit = (row["account"] if row else account) or account or "الصندوق"
        credit = (row["method"] if row else "") or "البنك"
    elif vtype == "payment":
        try:
            srow = conn.execute(
                "SELECT custody_account_id, COALESCE(expense_group_ref,'') AS gref, "
                "COALESCE(custody_account_snapshot,'') AS csnap, COALESCE(notes,'') AS notes, "
                "expense_account_id, COALESCE(expense_account_snapshot,'') AS esnap "
                "FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
        except Exception:
            srow = None
        # V3.14: التصفية أولًا بعلامات السند (لا باسم الحساب) — الدائن
        # حساب العهدة لا البنك/الصندوق (النقد خرج عند التسليم).
        if srow is not None and is_settlement_voucher(srow):
            debit = account or "مصروف / تكلفة المشروع"
            credit = (srow["csnap"] or "").strip() or "العهد"
        elif (srow is not None and srow["custody_account_id"] is not None
              and not (srow["gref"] or "").strip()):
            # تسليم عهدة: سلفة لا مصروف — مدين العهدة دائن الخزينة.
            debit, credit = account or "العهد", "البنك / الصندوق"
        elif srow is not None and srow["expense_account_id"] is not None:
            # V4.52: حساب مصروف صريح مربوط — يقدَّم على تخمين الاسم
            # (أسماء مثل «عمولات بنكية» تحوي «بنك» فكانت تُظَن نقدية).
            debit = ((srow["esnap"] or "").strip()
                     or account or "مصروف / تكلفة المشروع")
            credit = "البنك / الصندوق"
        elif account and not any(h in account for h in _CASH_NAME_HINTS):
            # حساب مصروف صريح — مدين به ودائن الخزينة أيًا كان اسمه.
            debit, credit = account, "البنك / الصندوق"
        else:
            debit, credit = "مصروف / تكلفة المشروع", account or "البنك / الصندوق"
    elif vtype == "custody_return":
        # V4.52: إرجاع عهدة — مدين الخزينة دائن العهدة، بلا إيراد.
        try:
            _rrow = conn.execute(
                "SELECT COALESCE(custody_account_snapshot,'') AS csnap, "
                "advance_employee_id AS emp, "
                "COALESCE(expense_account_snapshot,'') AS esnap "
                "FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
        except Exception:
            _rrow = None
        if _rrow is not None and _rrow["emp"] is not None:
            # V4.53: رد سلفة — مدين الخزينة دائن السلف (يخفض المصروف).
            debit = account or "البنك / الصندوق"
            credit = ((_rrow["esnap"] or "").strip()
                      or ensure_employee_advance_account()[1])
        else:
            debit = account or "البنك / الصندوق"
            credit = ((_rrow["csnap"] or "").strip()
                      if _rrow else "") or "العهد"
    elif vtype == "salary_deduction":
        # V4.53: خصم سلفة من راتب — مدين رواتب دائن السلف، بلا نقدية.
        try:
            _drow = conn.execute(
                "SELECT COALESCE(expense_account_snapshot,'') AS esnap "
                "FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
        except Exception:
            _drow = None
        debit = ((_drow["esnap"] or "").strip()
                 if _drow else "") or ensure_salary_account()[1]
        credit = ensure_employee_advance_account()[1]
    else:
        debit, credit = account or "البنك / الصندوق", "العملاء / إيرادات العقد"
    conn.execute(
        "INSERT INTO journal_entries (entry_date, description, debit_account, "
        "credit_account, amount, project_id, contract_id, boq_item_id, "
        "sub_contract_id, cost_center, source_type, source_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (vdate, _journal_text(conn, number, description, vtype,
                              sub_contract_id),
         debit, credit, amount,
         project_id, contract_id, boq_item_id, sub_contract_id,
         cost_center or "", f"voucher_{vtype}", voucher_id))


def _reverse_voucher_journals(conn, voucher_ids: list[int]) -> None:
    """إلغاء محاسبي بلا حذف: إدخال قيود عكسية بدل حذف قيد اليومية.

    حذف القيود يقطع الأثر المحاسبي. القيد العكسي يحافظ على التاريخ
    ويجعل صافي الأثر صفرًا.
    """
    for vid in voucher_ids:
        old_entries = conn.execute(
            "SELECT * FROM journal_entries WHERE source_type LIKE 'voucher_%' "
            "AND source_type!='voucher_cancel' AND source_id=?",
            (vid,)).fetchall()
        for e in old_entries:
            exists = conn.execute(
                "SELECT 1 FROM journal_entries WHERE source_type='voucher_cancel' "
                "AND source_id=? AND description LIKE ? LIMIT 1",
                (vid, f"%{e['id']}%"),).fetchone()
            if exists:
                continue
            conn.execute(
                "INSERT INTO journal_entries (entry_date, description, debit_account, "
                "credit_account, amount, project_id, contract_id, boq_item_id, "
                "sub_contract_id, cost_center, source_type, source_id) "
                "VALUES (date('now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'voucher_cancel', ?)",
                (f"قيد عكسي لإلغاء سند · أصل القيد #{e['id']} · {e['description']}",
                 e["credit_account"], e["debit_account"], e["amount"],
                 e["project_id"], e["contract_id"], e["boq_item_id"],
                 e["sub_contract_id"], e["cost_center"], vid))

BANK_FEE_MARK = "[رسوم بنك]"
BANK_COMMISSION_PARENT = "مصروفات بنكية"
BANK_COMMISSION_ACCOUNT = "عمولات بنكية"


def ensure_bank_commission_account() -> tuple[int, str]:
    """V4.52: حساب عمولات البنك (يُنشأ مرة واحدة) ← (id, المسار الكامل).

    القواعد القديمة لا تنال شجرة DEFAULT_TREE تلقائيًا (تُزرع للقاعدة
    الفارغة فقط) — لذا نبحث بالاسم ونُنشئ الأب والابن عند غيابهما.
    """
    from services import expense_account_service as _ea
    _accs = _ea.list_accounts()
    _parent = next((int(a["id"]) for a in _accs
                    if (a.get("name") or "").strip() == BANK_COMMISSION_PARENT
                    and not a.get("parent_id")), None)
    if _parent is None:
        _parent = _ea.add_account(BANK_COMMISSION_PARENT, None,
                                  allow_posting=False)
        _ea.clear_cache()
    _hit = next((a for a in _ea.list_accounts()
                 if (a.get("name") or "").strip() == BANK_COMMISSION_ACCOUNT), None)
    if _hit is None:
        _aid = _ea.add_account(BANK_COMMISSION_ACCOUNT, _parent)
        _ea.clear_cache()
        _hit = _ea.get_account(_aid) or {}
    _path = (_hit.get("full_path") or "").strip() or (
        f"{BANK_COMMISSION_PARENT} / {BANK_COMMISSION_ACCOUNT}")
    return int(_hit["id"]), _path


ADVANCE_ACCOUNT_NAME = "سلف موظفين / قرض راتب"
ADVANCE_PARENT_NAME = "مصروفات إدارية"
SALARY_ACCOUNT_NAME = "رواتب"


def _ensure_named_account(name: str, parent: str) -> tuple[int, str]:
    """بحث بالاسم ثم إنشاء (أب/ابن) — يغطي القواعد القديمة."""
    from services import expense_account_service as _ea
    _hit = next((a for a in _ea.list_accounts()
                 if (a.get("name") or "").strip() == name), None)
    if _hit is not None:
        _p = (_hit.get("full_path") or "").strip() or f"{parent} / {name}"
        return int(_hit["id"]), _p
    _par = next((int(a["id"]) for a in _ea.list_accounts()
                 if (a.get("name") or "").strip() == parent
                 and not a.get("parent_id")), None)
    if _par is None:
        _par = _ea.add_account(parent, None, allow_posting=False)
        _ea.clear_cache()
    _aid = _ea.add_account(name, _par)
    _ea.clear_cache()
    _acc = _ea.get_account(_aid) or {}
    return _aid, (_acc.get("full_path") or "").strip() or f"{parent} / {name}"


def ensure_employee_advance_account() -> tuple[int, str]:
    """V4.53: حساب سلف الموظفين ← (id, المسار)."""
    return _ensure_named_account(ADVANCE_ACCOUNT_NAME, ADVANCE_PARENT_NAME)


def ensure_salary_account() -> tuple[int, str]:
    """V4.53: حساب الرواتب ← (id, المسار)."""
    return _ensure_named_account(SALARY_ACCOUNT_NAME, ADVANCE_PARENT_NAME)

def _bank_fee_settings() -> tuple[float, str]:
    try:
        from services import settings_service
        st = settings_service.get_settings()
        fee = float(getattr(st, "bank_fee_amount", 0.150) or 0)
        method = (getattr(st, "bank_fee_method", "تحويل بنكي") or "تحويل بنكي").strip()
        return fee, method
    except Exception:
        return 0.150, "تحويل بنكي"

def _receipt_bank_fee(method: str, receipt_amount: float) -> float:
    """قيمة عمولة البنك لسند/تحويل قبض واحد حسب إعدادات طريقة الدفع."""
    from services import settings_service as _sv
    if not _sv.bank_fee_enabled():
        return 0.0
    method_info = _sv.get_method_info(method)
    if method_info and method_info.get("fee_value", 0) > 0:
        ftype = method_info.get("fee_type") or "amount"
        fval = float(method_info.get("fee_value") or 0)
        return round(float(receipt_amount or 0) * (fval / 100.0), 3) if ftype == "percent" else fval
    fee, fee_method = _bank_fee_settings()
    if not fee or (method or "").strip() != fee_method:
        return 0.0
    return float(fee or 0)


def _create_fee_voucher(parent_id: int, vdate: str, method: str,
                        parent_number: str, receipt_amount: float,
                        parent_contract_id: int | None = None) -> int | None:
    fee = _receipt_bank_fee(method, receipt_amount)
    if fee <= 0:
        return None
    number = next_voucher_number("payment")
    _fee_acc_id, _fee_acc_path = ensure_bank_commission_account()
    if parent_contract_id:
        with get_connection() as conn:
            desc = f"رسوم دفع عن السند {parent_number}"
            cur = conn.execute(
                "INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
                "party_type, method, amount, description, notes, "
                "parent_voucher_id, contract_id, expense_account_id, "
                "expense_account_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)",
                (number, "payment", vdate, "البنك", "", method, fee,
                 desc, BANK_FEE_MARK, parent_id, parent_contract_id,
                 _fee_acc_id, _fee_acc_path))
            vid = int(cur.lastrowid)
            _insert_voucher_journal(conn, vid, "payment", vdate, number,
                                    desc, fee, None, parent_contract_id,
                                    None, None, "", _fee_acc_path)
            return vid

    targets = _active_contracts_for_allocation()
    if not targets:
        with get_connection() as conn:
            desc = f"رسوم دفع عن السند {parent_number}"
            cur = conn.execute(
                "INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
                "party_type, method, amount, description, notes, "
                "parent_voucher_id, expense_account_id, "
                "expense_account_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (number, "payment", vdate, "البنك", "", method, fee,
                 desc, BANK_FEE_MARK, parent_id,
                 _fee_acc_id, _fee_acc_path))
            vid = int(cur.lastrowid)
            _insert_voucher_journal(conn, vid, "payment", vdate, number,
                                    desc, fee, None, None, None, None,
                                    "", _fee_acc_path)
            return vid

    allocations = _allocate_by_value(fee, targets)
    last_id = None
    with get_connection() as conn:
        total_value = sum(t["value"] for t in targets)
        try:
            next_num = int(number.split("-")[-1]) + 1
        except (ValueError, IndexError, TypeError):
            next_num = 1
        first_inserted = False
        for i, (t, part) in enumerate(zip(targets, allocations)):
            if part <= 0:
                continue
            if not first_inserted:
                vnum = number
                first_inserted = True
            else:
                vnum = f"PV-{next_num:04d}"
                next_num += 1
            desc = (f"رسوم دفع عن السند {parent_number} · نصيب عقد "
                    f"{t['contract_number']} ({part:,.3f} من "
                    f"{total_value:,.3f})")
            cur = conn.execute(
                "INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
                "party_type, method, amount, description, notes, "
                "parent_voucher_id, contract_id, expense_account_id, "
                "expense_account_snapshot) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)",
                (vnum, "payment", vdate, "البنك", "", method, part, desc,
                 BANK_FEE_MARK, parent_id, t["id"],
                 _fee_acc_id, _fee_acc_path))
            last_id = int(cur.lastrowid)
            _insert_voucher_journal(conn, last_id, "payment", vdate, vnum,
                                    desc, part, None, t["id"], None, None,
                                    "", _fee_acc_path)
    return last_id


def next_receipt_batch_number() -> str:
    """رقم مرجعي داخلي للسند المجمع؛ لا يُطبع في بيان/ملاحظات العميل."""
    with get_connection() as conn:
        cols = {c[1] for c in conn.execute("PRAGMA table_info(vouchers)")}
        if "receipt_group_ref" in cols:
            rows = conn.execute(
                "SELECT receipt_group_ref AS ref FROM vouchers WHERE receipt_group_ref LIKE 'BT-%'"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT notes AS ref FROM vouchers WHERE notes LIKE ?",
                ("%[تحويل مجمع:%",)).fetchall()
    max_no = 0
    import re
    for r in rows:
        m = re.search(r"BT-(\d+)", r["ref"] or "")
        if m:
            max_no = max(max_no, int(m.group(1)))
    return f"BT-{max_no + 1:04d}"


def _create_fixed_fee_voucher(parent_id: int, vdate: str, method: str,
                              parent_number: str, fee: float,
                              contract_id: int | None = None,
                              group_number: str = "") -> int | None:
    """إنشاء نصيب عمولة محدد مسبقًا لسند داخل تحويل مجمع.

    لا يحسب العمولة من مبلغ السند الفردي؛ لأن العمولة تخص التحويل البنكي
    الكامل ثم تُقسم بالتساوي على السندات كما طلب المستخدم.
    """
    fee = round(float(fee or 0), 3)
    if fee <= 0:
        return None
    number = next_voucher_number("payment")
    desc = f"نصيب عمولة سند مجمع عن السند {parent_number}"
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO vouchers (voucher_number, vtype, vdate, party, "
            "party_type, method, amount, description, notes, "
            "parent_voucher_id, contract_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (number, "payment", vdate, "البنك", "", method, fee,
             desc, BANK_FEE_MARK,
             parent_id, contract_id))
        vid = int(cur.lastrowid)
        if group_number:
            conn.execute(
                "UPDATE vouchers SET receipt_group_ref=? WHERE id=?",
                (group_number, vid))
        _insert_voucher_journal(conn, vid, "payment", vdate, number,
                                desc, fee, None, contract_id,
                                None, None, "", "البنك / الصندوق")
    return vid


def _cancel_fee_children(parent_id: int) -> int:
    """إلغاء سندات الرسوم البنكية التابعة لسند قبض (صامت بلا أحداث).

    يُستخدم عند إعادة احتساب الرسوم بعد التعديل: السندات القديمة
    تُلغى مع قيود عكسية، ثم تُنشأ البديلة الصحيحة.
    """
    with get_connection() as conn:
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM vouchers WHERE parent_voucher_id=? "
            "AND COALESCE(cancelled,0)=0 AND COALESCE(notes,'') LIKE ?",
            (parent_id, "%" + BANK_FEE_MARK + "%")).fetchall()]
        for cid in ids:
            conn.execute(
                "UPDATE vouchers SET cancelled=1, cancel_reason=?, "
                "cancelled_at=datetime('now','localtime') WHERE id=?",
                ("إعادة احتساب تلقائية بعد تعديل سند القبض", int(cid)))
        if ids:
            _reverse_voucher_journals(conn, [int(x) for x in ids])
    return len(ids)


def _reconcile_receipt_fees(voucher_id: int, vdate: str, method: str,
                            amount: float, contract_id: int | None,
                            voucher_number: str) -> None:
    """مزامنة سندات الرسوم مع سند القبض بعد تعديله.

    · مفرد: إلغاء القديمة + إنشاء واحدة جديدة بالمبلغ/الطريقة الجديدين
      (أو لا شيء لو الطريقة الجديدة بلا رسوم).
    · مجمع (BT-): إلغاء كل أطفال المجموعة + إعادة توزيع إجمالي العمولة
      بالتساوي على السطور السارية (بالمجاميع والطريقة الجديدة).
    """
    with get_connection() as conn:
        cols = {c[1] for c in conn.execute("PRAGMA table_info(vouchers)")}
        gref = ""
        if "receipt_group_ref" in cols:
            r = conn.execute(
                "SELECT COALESCE(receipt_group_ref,'') FROM vouchers WHERE id=?",
                (voucher_id,)).fetchone()
            gref = (r[0] or "") if r else ""
    if gref.startswith("BT-"):
        with get_connection() as conn:
            lines = conn.execute(
                "SELECT id, vdate, contract_id FROM vouchers "
                "WHERE receipt_group_ref=? AND vtype='receipt' "
                "AND COALESCE(cancelled,0)=0 ORDER BY id", (gref,)).fetchall()
            total = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                "WHERE receipt_group_ref=? AND vtype='receipt' "
                "AND COALESCE(cancelled,0)=0", (gref,)).fetchone()[0])
        for lid, _lvd, _lcc in lines:
            _cancel_fee_children(int(lid))
        fee_total = round(_receipt_bank_fee(method, total), 3)
        parts = _split_even(fee_total, len(lines))
        for (lid, lvd, lcc), part in zip(lines, parts):
            if part > 0:
                with get_connection() as conn:
                    vr = conn.execute(
                        "SELECT voucher_number FROM vouchers WHERE id=?",
                        (int(lid),)).fetchone()
                _create_fixed_fee_voucher(
                    int(lid), lvd or vdate, method, vr["voucher_number"],
                    part, lcc, gref)
        return
    _cancel_fee_children(voucher_id)
    _create_fee_voucher(voucher_id, vdate, method, voucher_number, amount,
                        parent_contract_id=contract_id)


def _sync_transfer_fee_children(transfer_id: int, vdate: str,
                                method: str) -> int:
    """V4.55: مزامنة سندات عمولة التسوية التابعة مع التحويل بعد تعديله."""
    with get_connection() as conn:
        kids = conn.execute(
            "SELECT id FROM vouchers WHERE parent_voucher_id=? "
            "AND vtype='payment' AND COALESCE(cancelled,0)=0",
            (int(transfer_id),)).fetchall()
        for k in kids:
            conn.execute(
                "UPDATE vouchers SET vdate=?, method=? WHERE id=?",
                (vdate, method, k[0]))
            conn.execute(
                "UPDATE journal_entries SET entry_date=? "
                "WHERE source_type LIKE 'voucher%' AND source_id=?",
                (vdate, k[0]))
    return len(kids)


def _split_even(total: float, count: int) -> list[float]:
    if count <= 0:
        return []
    base = round(float(total or 0) / count, 3)
    parts = [base] * count
    diff = round(float(total or 0) - sum(parts), 3)
    if abs(diff) >= 0.001:
        parts[-1] = round(parts[-1] + diff, 3)
    return parts


def next_expense_group_number() -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT expense_group_ref FROM vouchers WHERE expense_group_ref LIKE 'PAY-GRP-%' "
            "ORDER BY id DESC LIMIT 1").fetchone()
    import datetime as _dt
    prefix = 'PAY-GRP-' + _dt.date.today().strftime('%Y%m%d') + '-'
    seq = 1
    if row and row[0] and str(row[0]).startswith(prefix):
        try:
            seq = int(str(row[0]).split('-')[-1]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{seq:03d}"


@atomic
def add_grouped_payments(vdate: str, method: str, rows: list[dict],
                         group_description: str = "",
                         custody_account: str = "",
                         custody_account_id: int | None = None) -> dict:
    """سند صرف مجمع: ينشئ سند صرف مستقل لكل بند بعد فحص كل البنود أولًا.

    custody_account اختياري لتسجيل تصفية عهدة: سندات مستقلة تحت نفس
    المرجع الداخلي مع ملاحظة مصدر العهدة، دون خلطه بحساب المصروف.
    """
    if not rows:
        raise ValidationError("أضف بند صرف واحد على الأقل.")
    checked = []
    for i, r in enumerate(rows, 1):
        amount = float(r.get("amount") or 0)
        if amount <= 0:
            raise ValidationError(f"بند {i}: المبلغ يجب أن يكون أكبر من صفر.")
        acc_id = r.get("expense_account_id")
        if not acc_id:
            raise ValidationError(f"بند {i}: اختر حساب المصروف.")
        party = (r.get("party") or "").strip()
        party_type = (r.get("party_type") or "").strip()
        if party_type and not r.get("party_id"):
            raise ValidationError(f"بند {i}: اختر {'العميل' if party_type == 'customer' else 'مقاول الباطن'}.")
        if not party:
            raise ValidationError(f"بند {i}: اكتب أو اختر المورد / المستفيد.")
        checked.append({**r, "amount": amount, "party": party, "party_type": party_type})
    group_ref = next_expense_group_number()
    custody = (custody_account or "").strip()
    if custody_account_id:
        try:
            from services import expense_account_service as _ea
            acc = _ea.get_account(custody_account_id)
            if not acc or (acc.get("account_kind") or "") != "advance":
                raise ValidationError("اختر حساب عهدة صحيحًا.")
            custody = acc.get("full_path") or acc.get("name") or custody
        except ValidationError:
            raise
    ids = []
    for i, r in enumerate(checked, 1):
        # V9.15.2: البيان الفارغ للبند = اسم المصروف + المورد + العميل
        desc = ((r.get("description") or "").strip()
                or _payment_fallback_description(
                    r.get("party"), r.get("expense_account_id"),
                    r.get("expense_customer_id"))
                or group_description
                or (f"تصفية عهدة {custody}" if custody else "سند صرف مجمع")).strip()
        notes = (r.get("notes", "") or "").strip()
        if custody:
            notes = (notes + "\n" if notes else "") + f"تصفية عهدة من حساب: {custody}"
        rvdate = (r.get("vdate") or vdate or "").strip() or vdate
        vid = add_voucher(
            "payment", rvdate, r["party"], method, "", r["amount"], desc,
            project_id=r.get("project_id"), contract_id=r.get("contract_id"),
            expense_customer_id=r.get("expense_customer_id"),
            party_type=(r.get("party_type") or ""),
            party_id=r.get("party_id"), notes=notes,
            expense_account_id=r.get("expense_account_id"),
            expense_group_ref=group_ref, expense_group_line=i,
            custody_account_id=custody_account_id)
        ids.append(vid)
    return {"group_number": group_ref, "voucher_ids": ids,
            "count": len(ids), "total": sum(r["amount"] for r in checked),
            "custody_account": custody}


def add_custody_settlement(vdate: str, custody_account_id: int,
                           rows: list[dict],
                           group_description: str = "") -> dict:
    """تصفية عهدة من شاشة العُهد فقط.

    لا تطلب طريقة دفع من المستخدم لأنها ليست خروجًا نقديًا جديدًا؛
    المبلغ مُسلَّم سابقًا للعهدة، وهذه العملية توزّعه على حسابات
    المصروف الفعلية. كل بند مستقل ويمكن أن يخص عميلًا/عقدًا مختلفًا.
    """
    if not custody_account_id:
        raise ValidationError("اختر حساب العهدة.")
    return add_grouped_payments(
        vdate, "تصفية عهدة", rows,
        group_description or "تصفية عهدة",
        custody_account_id=int(custody_account_id))


def add_custody_return(vdate: str, custody_account_id: int, amount: float,
                          party: str = "", method: str = "الصندوق",
                          notes: str = "") -> int:
    """V4.52: إرجاع متبقي عهدة للخزينة — بلا سند قبض وبلا أثر إيرادي.

    نوع السند ``custody_return`` (ترقيم CV): مدين البنك/الصندوق دائن
    العهدة. المبلغ يُرفض إن تجاوز متبقي الحساب.
    """
    if not (vdate or "").strip():
        raise ValidationError("تاريخ الإرجاع مطلوب.")
    amount = round(float(amount or 0), 3)
    if amount <= 0:
        raise ValidationError("مبلغ الإرجاع يجب أن يكون أكبر من صفر.")
    return add_voucher(
        "custody_return", vdate.strip(), (party or "").strip(),
        (method or "").strip() or "الصندوق", "", amount,
        f"إرجاع عهدة للخزينة"
        + (f" — {(party or '').strip()}" if (party or "").strip() else ""),
        notes=(notes or "").strip(),
        custody_account_id=int(custody_account_id))


# ============================================================
# V4.53: سلف الموظفين
# ============================================================
def add_employee(name: str, phone: str = "", notes: str = "") -> int:
    """موظف جديد لسلف الموظفين — الاسم فريد."""
    import sqlite3 as _sq
    _name = (name or "").strip()
    if not _name:
        raise ValidationError("اسم الموظف مطلوب.")
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO employees (name, phone, notes) VALUES (?,?,?)",
                (_name, (phone or "").strip(), (notes or "").strip()))
            return int(cur.lastrowid)
    except _sq.IntegrityError:
        raise ValidationError("موظف بهذا الاسم موجود بالفعل.")


def get_employee(employee_id: int) -> dict | None:
    with get_connection() as conn:
        r = conn.execute("SELECT * FROM employees WHERE id=?",
                         (int(employee_id),)).fetchone()
        return dict(r) if r else None


def list_employees(active_only: bool = True) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM employees "
            + ("WHERE COALESCE(active,1)=1 " if active_only else "")
            + "ORDER BY name").fetchall()
        return [dict(r) for r in rows]


def set_employee_active(employee_id: int, active: bool) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE employees SET active=? WHERE id=?",
                     (1 if active else 0, int(employee_id)))


def update_employee(employee_id: int, name: str, phone: str = "",
                    notes: str = "") -> None:
    """تعديل بيانات موظف — الاسم فريد."""
    import sqlite3 as _sq
    _name = (name or "").strip()
    if not _name:
        raise ValidationError("اسم الموظف مطلوب.")
    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE employees SET name=?, phone=?, notes=? WHERE id=?",
                (_name, (phone or "").strip(), (notes or "").strip(),
                 int(employee_id)))
    except _sq.IntegrityError:
        raise ValidationError("موظف بهذا الاسم موجود بالفعل.")


def delete_employee(employee_id: int) -> dict:
    """حذف موظف — فقط إذا لم يكن له سلف نشطة."""
    with get_connection() as conn:
        emp = conn.execute("SELECT * FROM employees WHERE id=?",
                           (int(employee_id),)).fetchone()
        if not emp:
            raise ValidationError("الموظف غير موجود.")
        # التحقق من عدم وجود سلف مرتبطة
        cnt = conn.execute(
            "SELECT COUNT(*) FROM vouchers "
            "WHERE advance_employee_id=? AND COALESCE(cancelled,0)=0",
            (int(employee_id),)).fetchone()[0]
        if cnt > 0:
            raise ValidationError(
                f"لا يمكن حذف «{emp['name']}» — له {cnt} سند سلفة نشطة. "
                "ألغِ السندات أولاً أو عطّل الموظف.")
        conn.execute("DELETE FROM employees WHERE id=?",
                     (int(employee_id),))
        return {"id": int(employee_id), "name": emp["name"] or ""}


def employee_balances(date_from: str = "", date_to: str = "") -> list[dict]:
    """أرصدة سلف الموظفين: المسلَّم · المسترد · المخصوم · المتبقي."""
    where = ["v.advance_employee_id IS NOT NULL",
             "COALESCE(v.cancelled,0)=0"]
    params: list = []
    if date_from:
        where.append("v.vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate<=?")
        params.append(date_to)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT v.advance_employee_id AS emp_id,
                   MAX(e.name) AS emp_name,
                   MAX(COALESCE(e.phone,'')) AS emp_phone,
                   SUM(CASE WHEN v.vtype='payment'
                            THEN v.amount ELSE 0 END) AS advanced,
                   SUM(CASE WHEN v.vtype='custody_return'
                            THEN v.amount ELSE 0 END) AS recovered,
                   SUM(CASE WHEN v.vtype='salary_deduction'
                            THEN v.amount ELSE 0 END) AS deducted
            FROM vouchers v LEFT JOIN employees e
              ON e.id=v.advance_employee_id
            WHERE {' AND '.join(where)}
            GROUP BY v.advance_employee_id
            ORDER BY MAX(e.name)
        """, tuple(params)).fetchall()
    out = []
    for r in rows:
        _a = float(r["advanced"] or 0)
        _r = float(r["recovered"] or 0)
        _d = float(r["deducted"] or 0)
        out.append({"employee_id": r["emp_id"],
                    "employee": r["emp_name"] or "",
                    "phone": r["emp_phone"] or "",
                    "advanced": _a, "recovered": _r, "deducted": _d,
                    "balance": round(_a - _r - _d, 3)})
    return out


def employee_balance(employee_id: int) -> float:
    with get_connection() as conn:
        r = conn.execute("""
            SELECT COALESCE(SUM(CASE
                WHEN vtype='payment' THEN amount
                WHEN vtype IN ('custody_return','salary_deduction') THEN -amount
                ELSE 0 END), 0) AS b
            FROM vouchers
            WHERE advance_employee_id=? AND COALESCE(cancelled,0)=0
        """, (int(employee_id),)).fetchone()
        return round(float(r["b"] or 0), 3)


def employee_ledger(employee_id: int, date_from: str = "",
                    date_to: str = "") -> dict:
    """كشف سلفة موظف: سلفة/رد/خصم برصيد جارٍ."""
    where = ["vtype IN ('payment','custody_return','salary_deduction')",
             "advance_employee_id=?", "COALESCE(cancelled,0)=0"]
    params: list = [int(employee_id)]
    if date_from:
        where.append("vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("vdate<=?")
        params.append(date_to)
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(f"""
            SELECT id, voucher_number, vtype, vdate, party, method,
                   amount, description
            FROM vouchers WHERE {' AND '.join(where)}
            ORDER BY vdate, id
        """, tuple(params)).fetchall()]
    _kind = {"payment": ("advance", "💸 سلفة", 1),
             "custody_return": ("recover", "↩ رد نقدي", -1),
             "salary_deduction": ("deduct", "✂ خصم راتب", -1)}
    items = []
    bal = 0.0
    for v in rows:
        _k, _label, _sgn = _kind.get(v["vtype"], ("other", "حركة", 0))
        _amt = float(v["amount"] or 0)
        bal = round(bal + _sgn * _amt, 3)
        items.append({"voucher_id": v["id"], "ref": v["voucher_number"],
                      "kind": _k, "label": _label, "vdate": v["vdate"],
                      "description": v["description"] or "",
                      "in": _amt if _sgn > 0 else 0.0,
                      "out": _amt if _sgn < 0 else 0.0,
                      "balance": bal})
    _emp = get_employee(employee_id) or {}
    return {"employee_id": int(employee_id),
            "employee": _emp.get("name") or "",
            "rows": items, "balance": bal,
            "date_from": date_from, "date_to": date_to}


def add_employee_advance(vdate: str, employee_id: int, amount: float,
                         method: str = "الصندوق", notes: str = "") -> int:
    """V4.53: صرف سلفة لموظف — مصروف يخفضه الاسترداد لاحقًا."""
    _emp = get_employee(employee_id)
    if not _emp or not _emp.get("active"):
        raise ValidationError("الموظف غير موجود أو موقوف.")
    if not (vdate or "").strip():
        raise ValidationError("تاريخ السلفة مطلوب.")
    amount = round(float(amount or 0), 3)
    if amount <= 0:
        raise ValidationError("مبلغ السلفة يجب أن يكون أكبر من صفر.")
    _sid, _spath = ensure_employee_advance_account()
    return add_voucher(
        "payment", vdate.strip(), _emp["name"],
        (method or "").strip() or "الصندوق", _spath, amount,
        f"سلفة موظف — {_emp['name']}",
        notes=(notes or "").strip(), expense_account_id=_sid,
        advance_employee_id=int(employee_id))


def add_advance_cash_return(vdate: str, employee_id: int, amount: float,
                            method: str = "الصندوق",
                            notes: str = "") -> int:
    """V4.53: رد سلفة نقدًا — يدخل الخزينة ويخفض المصروف، بلا إيراد."""
    _emp = get_employee(employee_id)
    if not _emp or not _emp.get("active"):
        raise ValidationError("الموظف غير موجود أو موقوف.")
    if not (vdate or "").strip():
        raise ValidationError("تاريخ الرد مطلوب.")
    amount = round(float(amount or 0), 3)
    if amount <= 0:
        raise ValidationError("مبلغ الرد يجب أن يكون أكبر من صفر.")
    return add_voucher(
        "custody_return", vdate.strip(), _emp["name"],
        (method or "").strip() or "الصندوق", "", amount,
        f"رد سلفة نقدًا — {_emp['name']}",
        notes=(notes or "").strip(),
        advance_employee_id=int(employee_id))


def add_salary_deduction(vdate: str, employee_id: int, amount: float,
                         notes: str = "") -> int:
    """V4.53: خصم سلفة من راتب — مدين رواتب دائن السلف، بلا نقدية."""
    _emp = get_employee(employee_id)
    if not _emp or not _emp.get("active"):
        raise ValidationError("الموظف غير موجود أو موقوف.")
    if not (vdate or "").strip():
        raise ValidationError("تاريخ الخصم مطلوب.")
    amount = round(float(amount or 0), 3)
    if amount <= 0:
        raise ValidationError("مبلغ الخصم يجب أن يكون أكبر من صفر.")
    _rid, _rpath = ensure_salary_account()
    return add_voucher(
        "salary_deduction", vdate.strip(), _emp["name"], "", _rpath, amount,
        f"خصم سلفة من راتب — {_emp['name']}",
        notes=(notes or "").strip(), expense_account_id=_rid,
        advance_employee_id=int(employee_id))


def _extract_custody_account(notes: str) -> str:
    markers = ("تصفية عهدة من حساب:", "إغلاق عهدة من حساب:")
    for line in (notes or "").splitlines():
        for marker in markers:
            if marker in line:
                return line.split(marker, 1)[1].strip()
    return ""


def list_custody_groups(search: str = "") -> list[dict]:
    """تقرير العُهد المجمّعة من سندات الصرف المجمع.

    يعرض كل مرجع عهدة كمجموعة واحدة مع إجمالي البنود السارية وعددها،
    مع إبقاء السندات الملغاة مرئية في التفاصيل فقط.
    """
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute("""
            SELECT expense_group_ref AS group_ref,
                   MIN(vdate) AS vdate,
                   MAX(method) AS method,
                   MAX(custody_account_id) AS custody_account_id,
                   MAX(custody_account_snapshot) AS custody_account_snapshot,
                   COUNT(*) AS lines_count,
                   SUM(CASE WHEN COALESCE(cancelled,0)=0 THEN amount ELSE 0 END) AS total,
                   SUM(CASE WHEN COALESCE(cancelled,0)=1 THEN 1 ELSE 0 END) AS cancelled_count,
                   MIN(description) AS description,
                   GROUP_CONCAT(COALESCE(notes,''), '\n') AS notes_blob
            FROM vouchers
            WHERE vtype='payment'
              AND COALESCE(expense_group_ref,'')<>''
              AND (custody_account_id IS NOT NULL
                   OR COALESCE(notes,'') LIKE '%تصفية عهدة من حساب:%'
                   OR COALESCE(notes,'') LIKE '%إغلاق عهدة من حساب:%')
            GROUP BY expense_group_ref
            ORDER BY MIN(vdate) DESC, MAX(id) DESC
        """).fetchall()]
    out = []
    q = (search or "").strip()
    for r in rows:
        custody = (r.get("custody_account_snapshot") or "").strip() or _extract_custody_account(r.get("notes_blob") or "")
        item = {**r, "custody_account": custody,
                "total": float(r.get("total") or 0),
                "lines_count": int(r.get("lines_count") or 0),
                "cancelled_count": int(r.get("cancelled_count") or 0)}
        hay = " ".join(str(item.get(k) or "") for k in (
            "group_ref", "custody_account", "vdate", "method", "description"))
        if q and not search_contains(hay, q):
            continue
        out.append(item)
    return out


def custody_settlement(group_ref: str) -> dict:
    """كشف تصفية عهدة واحدة كاملًا — للعرض والطباعة.

    يرجع: بيانات العهدة · بنود المصروف · والموازنة المالية
    (المُسلَّم − المُنفَق = المتبقي أو المسترد).

    · المُسلَّم: سندات تسليم العهدة على نفس الحساب (بلا مرجع مجموعة)
      حتى تاريخ التصفية.
    · المُنفَق: بنود هذه التصفية السارية (غير الملغاة).
    """
    ref = (group_ref or "").strip()
    if not ref:
        return {}
    lines = list_custody_group_lines(ref)
    if not lines:
        return {}
    active = [x for x in lines if not x.get("cancelled")]
    spent = sum(float(x.get("amount") or 0) for x in active)
    acc_id = next((x.get("custody_account_id") for x in lines
                   if x.get("custody_account_id")), None)
    acc_name = next((x.get("custody_account_snapshot") for x in lines
                     if (x.get("custody_account_snapshot") or "").strip()),
                    "") or _extract_custody_account(
                        "\n".join(str(x.get("notes") or "") for x in lines))
    vdate = min((x.get("vdate") or "") for x in lines)
    method = next((x.get("method") for x in lines if x.get("method")), "")
    # المُسلَّم: سندات تسليم العهدة (حساب عهدة بلا مرجع مجموعة)
    handed = 0.0
    holder = ""
    if acc_id:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT amount, party, vdate FROM vouchers "
                "WHERE vtype='payment' AND COALESCE(cancelled,0)=0 "
                "AND custody_account_id=? "
                "AND COALESCE(expense_group_ref,'')='' "
                "AND vdate<=?", (int(acc_id), vdate or "9999-12-31")).fetchall()
            handed = sum(float(r["amount"] or 0) for r in rows)
            holder = next((str(r["party"] or "").strip() for r in rows
                           if (r["party"] or "").strip()), "")
    return {
        "group_ref": ref,
        "custody_account": acc_name,
        "custody_account_id": acc_id,
        "holder": holder,
        "vdate": vdate,
        "method": method,
        "lines": lines,
        "active_count": len(active),
        "cancelled_count": len(lines) - len(active),
        "handed": handed,
        "spent": spent,
        # موجب = متبقٍ لدى الموظف · سالب = صُرف أكثر ويُستردّ له
        "balance": handed - spent,
    }


def custody_balances(date_from: str = "", date_to: str = "") -> list[dict]:
    """أرصدة كل حسابات العهد: المُسلَّم (الوارد) · المُنفَق · المتبقي.

    الفترة اختيارية: تحصر الحركة بتاريخ السند.
    """
    where = ["vtype IN ('payment','custody_return')",
             "COALESCE(cancelled,0)=0", "custody_account_id IS NOT NULL"]
    params: list = []
    if date_from:
        where.append("vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("vdate<=?")
        params.append(date_to)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT custody_account_id AS acc_id,
                   MAX(custody_account_snapshot) AS acc_name,
                   SUM(CASE WHEN vtype='payment'
                            AND COALESCE(expense_group_ref,'')=''
                            THEN amount ELSE 0 END) AS handed,
                   SUM(CASE WHEN vtype='payment'
                            AND COALESCE(expense_group_ref,'')<>''
                            THEN amount ELSE 0 END) AS spent,
                   SUM(CASE WHEN vtype='custody_return'
                            THEN amount ELSE 0 END) AS returned,
                   SUM(CASE WHEN vtype='payment'
                            AND COALESCE(expense_group_ref,'')=''
                            THEN 1 ELSE 0 END) AS handed_count,
                   SUM(CASE WHEN vtype='payment'
                            AND COALESCE(expense_group_ref,'')<>''
                            THEN 1 ELSE 0 END) AS spent_count,
                   SUM(CASE WHEN vtype='custody_return'
                            THEN 1 ELSE 0 END) AS returned_count,
                   COUNT(DISTINCT CASE WHEN COALESCE(expense_group_ref,'')<>''
                         THEN expense_group_ref END) AS settlements
            FROM vouchers
            WHERE {' AND '.join(where)}
            GROUP BY custody_account_id
            ORDER BY MAX(custody_account_snapshot)
        """, tuple(params)).fetchall()
    out = []
    for r in rows:
        handed = float(r["handed"] or 0)
        spent = float(r["spent"] or 0)
        returned = float(r["returned"] or 0)
        out.append({"account_id": r["acc_id"],
                    "account": r["acc_name"] or "",
                    "handed": handed, "spent": spent,
                    "returned": returned,
                    "balance": handed - spent - returned,
                    "handed_count": int(r["handed_count"] or 0),
                    "spent_count": int(r["spent_count"] or 0),
                    "returned_count": int(r["returned_count"] or 0),
                    "settlements": int(r["settlements"] or 0)})
    return out


def custody_open_items(as_of: str = "") -> list[dict]:
    """V3.8: العهد المعلقة — أرصدة مفتوحة مع أقدم تسليم وعدد الأيام.

    عهدة «معلقة» = رصيد موجب (مُسلَّم − مُنفَق > 0) أي مبالغ ما زالت
    لدى الموظف بلا تصفية كاملة. تُحسب الأيام من أقدم سند تسليم
    (بلا مرجع مجموعة) حتى ``as_of`` (اليوم إن فُرّغ).
    """
    from datetime import date as _date
    if not (as_of or "").strip():
        as_of = _date.today().isoformat()
    bals = {b["account_id"]: b for b in custody_balances()}
    if not bals:
        return []
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT custody_account_id AS acc_id,
                      MIN(vdate) AS oldest, COUNT(*) AS n
               FROM vouchers
               WHERE vtype='payment' AND COALESCE(cancelled,0)=0
               AND custody_account_id IS NOT NULL
               AND COALESCE(expense_group_ref,'')=''
               GROUP BY custody_account_id""").fetchall()
    out = []
    for r in rows:
        b = bals.get(r["acc_id"])
        if not b or float(b.get("balance") or 0) <= 0.005:
            continue
        oldest = (r["oldest"] or "")[:10]
        try:
            days = (_date.fromisoformat(as_of)
                    - _date.fromisoformat(oldest)).days
        except Exception:
            days = 0
        out.append({"account_id": r["acc_id"],
                    "account": b.get("account") or "",
                    "balance": float(b.get("balance") or 0),
                    "handed": float(b.get("handed") or 0),
                    "spent": float(b.get("spent") or 0),
                    "returned": float(b.get("returned") or 0),
                    "oldest": oldest, "days": max(days, 0),
                    "handovers": int(r["n"] or 0)})
    out.sort(key=lambda x: (-x["days"], x["account"]))
    return out


def custody_accounts() -> list[dict]:
    """حسابات العهد التي لها حركة فعلية، مع بيانات الرصيد الحالية."""
    rows = custody_balances()
    if rows:
        return rows
    try:
        from services import expense_account_service as _ea
        return [{"account_id": aid, "account": name, "handed": 0.0,
                 "spent": 0.0, "returned": 0.0, "balance": 0.0,
                 "handed_count": 0, "spent_count": 0, "returned_count": 0,
                 "settlements": 0}
                for name, aid in _ea.custody_items()]
    except Exception:
        return []


def custody_ledger(account_id: int | None = None, date_from: str = "",
                   date_to: str = "", search: str = "") -> dict:
    """كشف حساب موحّد للعهدة: وارد تسليم + منصرف تصفية مجمّع.

    لا يغيّر أي بيانات؛ قراءة وتجميع فقط من جدول السندات الحالي.
    صف التصفية يظهر مرة واحدة بإجمالي بنوده، والتفاصيل تُرجع في مفتاح
    ``details`` ليعرضها UI عند التوسيع بدون إعادة تحميل.
    """
    accounts = custody_accounts()
    if account_id is None and len(accounts) == 1:
        account_id = accounts[0].get("account_id")
    where = ["v.vtype='payment'", "COALESCE(v.cancelled,0)=0",
             "v.custody_account_id IS NOT NULL"]
    params: list = []
    if account_id:
        where.append("v.custody_account_id=?")
        params.append(int(account_id))
    if date_from:
        where.append("v.vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate<=?")
        params.append(date_to)
    clause = " AND ".join(where)
    with get_connection() as conn:
        handovers = [dict(r) for r in conn.execute(f"""
            SELECT v.id, v.voucher_number AS ref, v.vdate, v.party,
                   v.description, v.amount,
                   v.custody_account_id, v.custody_account_snapshot
            FROM vouchers v
            WHERE {clause} AND COALESCE(v.expense_group_ref,'')=''
            ORDER BY v.vdate, v.id
        """, tuple(params)).fetchall()]
        groups = [dict(r) for r in conn.execute(f"""
            SELECT v.expense_group_ref AS ref, MIN(v.vdate) AS vdate,
                   MAX(v.custody_account_id) AS custody_account_id,
                   MAX(v.custody_account_snapshot) AS custody_account_snapshot,
                   MIN(v.description) AS description,
                   COUNT(*) AS lines_count,
                   SUM(v.amount) AS amount,
                   MAX(v.id) AS sort_id
            FROM vouchers v
            WHERE {clause} AND COALESCE(v.expense_group_ref,'')<>''
            GROUP BY v.expense_group_ref
            ORDER BY MIN(v.vdate), MAX(v.id)
        """, tuple(params)).fetchall()]
        _rclause = clause.replace("v.vtype='payment'",
                                  "v.vtype='custody_return'")
        returns = [dict(r) for r in conn.execute(f"""
            SELECT v.id, v.voucher_number AS ref, v.vdate, v.party,
                   v.description, v.amount,
                   v.custody_account_id, v.custody_account_snapshot
            FROM vouchers v
            WHERE {_rclause}
            ORDER BY v.vdate, v.id
        """, tuple(params)).fetchall()]
    items = []
    for h in handovers:
        desc = (h.get("description") or "تسليم عهدة").strip()
        if h.get("party") and str(h.get("party")) not in desc:
            desc = f"{desc} - {h.get('party')}"
        items.append({"kind": "handover", "ref": h.get("ref") or "",
                      "voucher_id": h.get("id"), "vdate": h.get("vdate") or "",
                      "description": desc, "in": float(h.get("amount") or 0),
                      "out": 0.0, "balance": 0.0, "details": [],
                      "details_count": 0,
                      "custody_account_id": h.get("custody_account_id"),
                      "custody_account": h.get("custody_account_snapshot") or ""})
    # الأداء: كان يُستدعى list_custody_group_lines داخل الحلقة لكل
    # تصفية، وكل نداء يمر على list_vouchers كاملة (استعلام ثقيل +
    # اتصال مستقل) — أي عشرات الاستعلامات على الشبكة. الآن نُنادي
    # list_vouchers **مرة واحدة** ونوزّع بنودها على مراجع التصفيات،
    # فتبقى الحقول والمخرجات مطابقة تمامًا لما كانت عليه.
    _refs = {g.get("ref") or "" for g in groups if (g.get("ref") or "")}
    _details_map: dict[str, list] = {}
    if _refs:
        for v in list_vouchers(vtype="payment"):
            r = (v.get("expense_group_ref") or "")
            if r in _refs:
                _details_map.setdefault(r, []).append(v)
    for t in returns:
        desc = (t.get("description") or "إرجاع عهدة").strip()
        if t.get("party") and str(t.get("party")) not in desc:
            desc = f"{desc} - {t.get('party')}"
        items.append({"kind": "return", "ref": t.get("ref") or "",
                      "voucher_id": t.get("id"), "vdate": t.get("vdate") or "",
                      "description": desc, "in": 0.0,
                      "out": float(t.get("amount") or 0),
                      "balance": 0.0, "details": [],
                      "details_count": 0,
                      "custody_account_id": t.get("custody_account_id"),
                      "custody_account": t.get("custody_account_snapshot") or ""})
    for g in groups:
        ref = g.get("ref") or ""
        details = _details_map.get(ref, [])
        # V9.15.2: بيان التصفية المجمّع = كل بنودها (بدون تكرار) مفصولة بفاصلة
        _seen: list[str] = []
        for _d in sorted(details, key=lambda d: (d.get("vdate") or "",
                                                 d.get("voucher_number") or "")):
            _t = (_d.get("description") or "").strip()
            if _t and _t not in _seen:
                _seen.append(_t)
        desc = "، ".join(_seen) or (g.get("description") or "تصفية عهدة").strip()
        items.append({"kind": "settlement", "ref": ref, "voucher_id": None,
                      "vdate": g.get("vdate") or "", "description": desc,
                      "in": 0.0, "out": float(g.get("amount") or 0),
                      "balance": 0.0, "details": details,
                      "details_count": int(g.get("lines_count") or len(details)),
                      "custody_account_id": g.get("custody_account_id"),
                      "custody_account": g.get("custody_account_snapshot") or ""})
    q = (search or "").strip()
    if q:
        filtered = []
        for item in items:
            hay = " ".join(str(item.get(k) or "") for k in ("ref", "description", "vdate", "custody_account"))
            if search_contains(hay, q):
                filtered.append(item)
                continue
            if any(search_contains(" ".join(str(d.get(k) or "") for k in ("voucher_number", "description", "party", "expense_account_snapshot", "contract_number")), q)
                   for d in item.get("details") or []):
                filtered.append(item)
        items = filtered
    items.sort(key=lambda x: (x.get("vdate") or "", str(x.get("ref") or ""), int(x.get("voucher_id") or 0)))
    bal = 0.0
    total_in = total_out = 0.0
    for item in items:
        total_in += float(item.get("in") or 0)
        total_out += float(item.get("out") or 0)
        bal = round(bal + float(item.get("in") or 0) - float(item.get("out") or 0), 3)
        item["balance"] = bal
    return {"accounts": accounts, "account_id": account_id,
            "rows": items,
            "totals": {"in": total_in, "out": total_out,
                       "balance": total_in - total_out},
            "date_from": date_from, "date_to": date_to, "search": search}


def custody_detailed_report(date_from: str = "", date_to: str = "",
                            account_id: int | None = None) -> dict:
    """V9.15: تقرير تفصيلي للعهد — كل تسليم في سطر، وكل بند تصفية في سطر.

    قراءة فقط فوق ``custody_ledger`` (نفس مصدر الكشف الموحّد)، لكن:
      · كل تصفية تُفكَّك إلى بنودها (تاريخ كل بند ومستلمه وحسابه وعقده)؛
      · الرصيد التراكمي يُحسب **لكل حساب عهدة** على حدة حتى لا تختلط
        الأرصدة عند عرض كل العهد معًا.
    """
    data = custody_ledger(account_id, date_from, date_to)
    rows: list[dict] = []
    for item in data.get("rows") or []:
        base = {"vdate": item.get("vdate") or "",
                "ref": item.get("ref") or "",
                "account": item.get("custody_account") or "",
                "custody_account_id": item.get("custody_account_id"),
                "description": item.get("description") or "",
                "party": "", "expense": "", "customer": ""}
        kind = item.get("kind")
        if kind == "settlement" and item.get("details"):
            group_ref = base["ref"]
            _lines = sorted(item["details"], key=lambda d: (
                d.get("vdate") or "", d.get("voucher_number") or ""))
            for d in _lines:
                rows.append({
                    **base,
                    "vdate": d.get("vdate") or base["vdate"],
                    "ref": d.get("voucher_number") or group_ref,
                    "type": f"تصفية {group_ref}".strip(),
                    "description": (d.get("description") or "").strip()
                                   or base["description"],
                    "party": d.get("party") or "",
                    "expense": d.get("expense_account_snapshot") or "",
                    "customer": d.get("contract_number") or "",
                    "in": 0.0,
                    "out": round(float(d.get("amount") or 0), 3)})
            continue
        if kind == "settlement":
            type_ = "تصفية (مجمّعة)"
        elif kind == "return":
            type_ = "إرجاع عهدة"
        else:
            type_ = "تسليم عهدة"
        rows.append({**base, "type": type_,
                     "in": round(float(item.get("in") or 0), 3),
                     "out": round(float(item.get("out") or 0), 3)})
    # رصيد تراكمي منفصل لكل حساب عهدة
    running: dict = {}
    for r in rows:
        k = r["custody_account_id"] or r["account"]
        running[k] = round(running.get(k, 0.0) + r["in"] - r["out"], 3)
        r["balance"] = running[k]
    return {
        "rows": rows,
        "totals": {
            "in": round(sum(r["in"] for r in rows), 3),
            "out": round(sum(r["out"] for r in rows), 3),
            "balance": round(sum(running.values()), 3),
        },
        "count": len(rows),
        "date_from": date_from, "date_to": date_to,
        "accounts": data.get("accounts") or [],
    }


def custody_monthly_summary(date_from: str = "", date_to: str = "",
                            account_id: int | None = None) -> dict:
    """V9.15: ملخص شهري لكل عهدة: رصيد أول · تسليم · صرف · مرتجع · رصيد آخر.

    قراءة فقط فوق ``custody_ledger``. الرصيد الافتتاحي لكل حساب يُحسب من
    كل ما قبل بداية الفترة، ثم يتتابع شهرًا بشهر. الشهر يظهر إذا وُجدت
    فيه حركة لذلك الحساب.
    """
    data = custody_ledger(account_id, "", date_to or "")
    opening: dict = {}
    months: dict = {}
    names: dict = {}
    for item in data.get("rows") or []:
        vd = item.get("vdate") or ""
        key = item.get("custody_account_id") or item.get("custody_account") or ""
        names.setdefault(key, item.get("custody_account") or "—")
        amt_in = float(item.get("in") or 0)
        amt_out = float(item.get("out") or 0)
        if date_from and vd < date_from:
            opening[key] = round(opening.get(key, 0.0) + amt_in - amt_out, 3)
            continue
        b = months.setdefault((key, vd[:7]),
                              {"handed": 0.0, "spent": 0.0, "returned": 0.0})
        kind = item.get("kind")
        if kind == "handover":
            b["handed"] += amt_in
        elif kind == "return":
            b["returned"] += amt_out
        else:
            b["spent"] += amt_out
    rows: list[dict] = []
    keys = {k for (k, _m) in months} | set(opening)
    for key in sorted(keys, key=lambda k: str(names.get(k, ""))):
        bal = round(opening.get(key, 0.0), 3)
        for m in sorted(mm for (k, mm) in months if k == key):
            b = months[(key, m)]
            close = round(bal + b["handed"] - b["spent"] - b["returned"], 3)
            rows.append({
                "month": m, "account": names.get(key, "—"),
                "opening": bal,
                "handed": round(b["handed"], 3),
                "spent": round(b["spent"], 3),
                "returned": round(b["returned"], 3),
                "closing": close})
            bal = close
    return {
        "rows": rows,
        "totals": {
            "handed": round(sum(r["handed"] for r in rows), 3),
            "spent": round(sum(r["spent"] for r in rows), 3),
            "returned": round(sum(r["returned"] for r in rows), 3),
        },
        "date_from": date_from, "date_to": date_to,
    }


def custody_handover_list(date_from: str = "", date_to: str = "",
                          account_id: int | None = None) -> list[dict]:
    """V9.15: كل سند تسليم عهدة لوحده (قراءة فقط) مرتبًا بالتاريخ."""
    where = ["v.vtype='payment'", "COALESCE(v.cancelled,0)=0",
             "v.custody_account_id IS NOT NULL",
             "COALESCE(v.expense_group_ref,'')=''"]
    params: list = []
    if account_id:
        where.append("v.custody_account_id=?")
        params.append(int(account_id))
    if date_from:
        where.append("v.vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate<=?")
        params.append(date_to)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT v.id, v.voucher_number AS ref, v.vdate, v.party,
                   v.description, v.amount, v.method, v.notes,
                   v.custody_account_id, v.custody_account_snapshot
            FROM vouchers v
            WHERE {' AND '.join(where)}
            ORDER BY v.vdate, v.id
        """, tuple(params)).fetchall()
    return [dict(r) for r in rows]


def custody_overview(date_from: str = "", date_to: str = "",
                     account_id: int | None = None) -> dict:
    """التقرير الشامل للعُهد — كل العهد وكل التصفيات في تقرير واحد.

    يرجع:
      · ``accounts``   : صف لكل حساب عهدة (وارد · منصرف · متبقٍ)
      · ``handovers``  : سندات تسليم العهد (الوارد التفصيلي)
      · ``settlements``: كل التصفيات بإجمالياتها وحساب كل منها
      · ``totals``     : الإجماليات العامة
    """
    accounts = [a for a in custody_balances(date_from, date_to)
                if not account_id or a["account_id"] == account_id]

    where = ["v.vtype='payment'", "COALESCE(v.cancelled,0)=0",
             "v.custody_account_id IS NOT NULL"]
    params: list = []
    if date_from:
        where.append("v.vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate<=?")
        params.append(date_to)
    if account_id:
        where.append("v.custody_account_id=?")
        params.append(int(account_id))
    clause = " AND ".join(where)

    with get_connection() as conn:
        # الوارد: سندات تسليم العهدة (بلا مرجع مجموعة)
        handovers = [dict(r) for r in conn.execute(f"""
            SELECT v.id, v.voucher_number, v.vdate, v.party, v.amount,
                   v.description, v.method,
                   COALESCE(v.custody_account_snapshot,'') AS account
            FROM vouchers v
            WHERE {clause} AND COALESCE(v.expense_group_ref,'')=''
            ORDER BY v.vdate, v.id
        """, tuple(params)).fetchall()]
        # المنصرف: التصفيات مجمّعة بمرجعها
        settlements = [dict(r) for r in conn.execute(f"""
            SELECT v.expense_group_ref AS group_ref,
                   MIN(v.vdate) AS vdate,
                   MAX(v.method) AS method,
                   MAX(COALESCE(v.custody_account_snapshot,'')) AS account,
                   MAX(v.custody_account_id) AS account_id,
                   COUNT(*) AS lines_count,
                   SUM(v.amount) AS total
            FROM vouchers v
            WHERE {clause} AND COALESCE(v.expense_group_ref,'')<>''
            GROUP BY v.expense_group_ref
            ORDER BY MIN(v.vdate), MAX(v.id)
        """, tuple(params)).fetchall()]
        # V9.15.2: بيان كل تصفية = بنودها مجمّعة (بدون تكرار، بترتيب السند)
        if settlements:
            _refs = [st["group_ref"] for st in settlements]
            _marks = ",".join("?" * len(_refs))
            _lines_by_ref: dict[str, list[str]] = {}
            for _r in conn.execute(
                    f"""SELECT expense_group_ref AS ref, description FROM vouchers
                        WHERE expense_group_ref IN ({_marks})
                        AND COALESCE(cancelled,0)=0
                        ORDER BY vdate, voucher_number""", tuple(_refs)).fetchall():
                _t = (_r["description"] or "").strip()
                _bucket = _lines_by_ref.setdefault(_r["ref"], [])
                if _t and _t not in _bucket:
                    _bucket.append(_t)
            for st in settlements:
                st["description"] = "، ".join(
                    _lines_by_ref.get(st["group_ref"], [])) or "تصفية عهدة"

    t_in = sum(float(h.get("amount") or 0) for h in handovers)
    t_out = sum(float(x.get("total") or 0) for x in settlements)
    return {
        "accounts": accounts,
        "handovers": handovers,
        "settlements": settlements,
        "totals": {"handed": t_in, "spent": t_out, "balance": t_in - t_out,
                   "accounts": len(accounts),
                   "settlements": len(settlements),
                   "handovers": len(handovers)},
        "date_from": date_from, "date_to": date_to,
    }


def settlements_summary(date_from: str = "", date_to: str = "",
                          account_id: int | None = None) -> dict:
    """V3.2 (هـ): تصفيات الفترة مجمعة (ترويسة + إجماليات + بنود)."""
    where = ["COALESCE(v.cancelled,0)=0",
             "COALESCE(v.expense_group_ref,'')<>''",
             "v.custody_account_id IS NOT NULL"]
    params: list = []
    if account_id:
        where.append("v.custody_account_id=?")
        params.append(int(account_id))
    if date_from:
        where.append("v.vdate>=?")
        params.append(date_from)
    if date_to:
        where.append("v.vdate<=?")
        params.append(date_to)
    clause = " AND ".join(where)
    with get_connection() as conn:
        groups = [dict(r) for r in conn.execute(
            f"""SELECT v.expense_group_ref AS ref, MIN(v.vdate) AS vdate,
                   COUNT(*) AS lines, SUM(v.amount) AS total,
                   '' AS description,
                   MAX(v.custody_account_snapshot) AS custody_account
                FROM vouchers v WHERE {clause}
                GROUP BY v.expense_group_ref
                ORDER BY MIN(v.vdate), v.expense_group_ref""",
            tuple(params)).fetchall()]
        details: dict[str, list] = {}
        if groups:
            refs = [g["ref"] for g in groups]
            marks = ",".join("?" * len(refs))
            for r in conn.execute(
                    f"""SELECT expense_group_ref AS ref, voucher_number,
                           vdate, party, expense_account_snapshot, amount,
                           description FROM vouchers
                        WHERE expense_group_ref IN ({marks})
                        AND COALESCE(cancelled,0)=0
                        ORDER BY vdate, id""",
                    tuple(refs)).fetchall():
                details.setdefault(r["ref"], []).append(dict(r))
    for g in groups:
        g["details"] = details.get(g["ref"], [])
        _seen: list[str] = []
        for _d in sorted(g["details"], key=lambda d: (d.get("vdate") or "",
                                                      d.get("voucher_number") or "")):
            _t = (_d.get("description") or "").strip()
            if _t and _t not in _seen:
                _seen.append(_t)
        g["description"] = "، ".join(_seen) or "تصفية عهدة"
    total = round(sum(float(g["total"] or 0) for g in groups), 3)
    return {"rows": groups, "count": len(groups), "total": total}


def list_custody_group_lines(group_ref: str) -> list[dict]:
    ref = (group_ref or "").strip()
    if not ref:
        return []
    return [v for v in list_vouchers(vtype="payment")
            if (v.get("expense_group_ref") or "") == ref]


@atomic
def add_grouped_receipts(vdate: str, method: str, account: str,
                         rows: list[dict], group_description: str = "",
                         allow_overpay: bool = False) -> dict:
    """إنشاء تحويل بنكي مجمع: سندات قبض فردية + عمولة واحدة موزعة بالتساوي.

    rows: [{customer_id|party_id, party_type?, contract_id, amount,
            description, notes?, allocation?}]
    party_type: 'customer' (افتراضي) أو 'subcontractor' — حسب تاب السطر.
    السند المجمع نفسه مرجع/طباعة فقط عبر group_number، ولا يضيف إيرادًا جديدًا.
    """
    clean = []
    seen_pairs: dict[tuple[int, int | None], int] = {}
    for idx, r in enumerate(rows or [], 1):
        amount = round(float(r.get("amount") or 0), 3)
        if amount <= 0:
            continue
        ptype = (r.get("party_type") or "customer").strip() or "customer"
        if ptype not in ("customer", "subcontractor"):
            ptype = "customer"
        cid = r.get("customer_id") or r.get("party_id")
        if not cid:
            who = "عميلًا" if ptype == "customer" else "مقاول باطن"
            raise ValidationError(f"كل سطر في السند المجمع يجب أن يحدد {who}.")
        contract_id = r.get("contract_id")
        clean_contract_id = int(contract_id) if contract_id else None
        if clean_contract_id:
            pair = (ptype, int(cid), clean_contract_id)
            if pair in seen_pairs:
                raise ValidationError(
                    f"تكرار نفس العقد لنفس العميل في السطرين {seen_pairs[pair]} و {idx}. اجمعهما في سطر واحد."
                )
            seen_pairs[pair] = idx
        clean.append({**r, "customer_id": int(cid), "party_type": ptype,
                        "contract_id": clean_contract_id, "amount": amount})
    if len(clean) < 2:
        raise ValidationError("السند المجمع يحتاج سطرين على الأقل.")
    # فحص الزيادة قبل إنشاء أي سند، حتى لا تُحفظ بعض سطور السند المجمع ثم يفشل سطر لاحق.
    if not allow_overpay:
        for r in clean:
            if r.get("contract_id"):
                value = contract_current_value(int(r["contract_id"]))
                with get_connection() as conn:
                    collected = float(conn.execute(
                        "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                        "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                        (int(r["contract_id"]),)).fetchone()[0])
                due_value = value["current"]
                from services.supervision_service import supervision_status
                sup = supervision_status(int(r["contract_id"]))
                if sup:
                    due_value = max(due_value, sup["total_due"])
                remaining = due_value - collected
                if float(r["amount"] or 0) > remaining + 1e-9:
                    raise OverpayWarning(
                        "قيمة أحد سطور السند المجمع تتجاوز المبلغ المتبقي من العقد.\n"
                        f"المتبقي: {remaining:,.3f}\n"
                        "سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد إذا اخترت المتابعة.")
    total = round(sum(r["amount"] for r in clean), 3)
    group_no = next_receipt_batch_number()
    fee_total = round(_receipt_bank_fee(method, total), 3)
    fee_parts = _split_even(fee_total, len(clean))
    receipt_ids = []
    fee_ids = []
    # V8.3: جلب بيانات العملاء والعقود مسبقاً لتجنب N+1
    customer_ids = list(set(int(r.get("customer_id", 0)) for r in clean if r.get("customer_id")))
    contract_ids = list(set(int(r.get("contract_id", 0)) for r in clean if r.get("contract_id")))
    
    customer_names = {}
    contract_labels = {}
    
    with get_connection() as conn:
        # جلب أسماء العملاء دفعة واحدة
        if customer_ids:
            marks = ",".join("?" * len(customer_ids))
            rows = conn.execute(
                f"SELECT id, name FROM customers WHERE id IN ({marks})",
                tuple(customer_ids)).fetchall()
            customer_names = {int(r["id"]): r["name"] for r in rows}
        
        # جلب أسماء العقود دفعة واحدة
        if contract_ids:
            marks = ",".join("?" * len(contract_ids))
            rows = conn.execute(
                f"SELECT id, COALESCE(NULLIF(contract_name,''), contract_number) AS label FROM contracts WHERE id IN ({marks})",
                tuple(contract_ids)).fetchall()
            contract_labels = {int(r["id"]): r["label"] for r in rows}
    
    for i, r in enumerate(clean, 1):
        desc = (r.get("description") or "").strip()
        if not desc:
            if r.get("contract_id"):
                try:
                    from services.extras_service import allocated_description, smart_receipt_description
                    alloc = (r.get("allocation") or "").strip()
                    desc = (allocated_description(int(r["contract_id"]), r["amount"], alloc)
                            if alloc else smart_receipt_description(int(r["contract_id"]), r["amount"]))
                except Exception:
                    desc = ""
            if not desc:
                # V8.3: استخدام البيانات المسبقة بدلاً من N+1
                customer_name = customer_names.get(int(r.get("customer_id", 0)), "")
                contract_name = contract_labels.get(int(r.get("contract_id", 0)), "")
                
                if contract_name:
                    desc = f"تحصيل دفعة من {customer_name} عن عقد {contract_name}" if customer_name else f"تحصيل دفعة عن عقد {contract_name}"
                else:
                    desc = f"تحصيل دفعة من {customer_name}" if customer_name else "تحصيل دفعة"
        note = (r.get("notes") or "").strip()
        if not note and r.get("contract_id"):
            try:
                from services.extras_service import smart_receipt_stage_note
                note = smart_receipt_stage_note(int(r["contract_id"]), r["amount"])
            except Exception:
                note = ""
        vid = add_voucher(
            "receipt", vdate, "", method, account, r["amount"], desc,
            contract_id=r.get("contract_id"), notes=note,
            party_type=r.get("party_type") or "customer",
            party_id=r["customer_id"],
            allocation=r.get("allocation") or "",
            allow_overpay=allow_overpay, suppress_bank_fee=True)
        with get_connection() as conn:
            conn.execute(
                "UPDATE vouchers SET receipt_group_ref=?, receipt_group_line=? WHERE id=?",
                (group_no, i, vid))
        receipt_ids.append(vid)
        if fee_parts[i - 1] > 0:
            # V8.3: استخدام البيانات المسبقة
            vr_number = f"REC-{vid:04d}"  # رقم مؤقت
            vr_contract_id = r.get("contract_id")
            
            fid = _create_fixed_fee_voucher(
                vid, vdate, method, vr_number, fee_parts[i - 1],
                vr_contract_id, group_no)
            if fid:
                fee_ids.append(fid)
    return {"group_number": group_no, "receipt_ids": receipt_ids,
            "fee_ids": fee_ids, "total": total, "bank_fee": fee_total,
            "fee_each": fee_parts}


def _active_contracts_for_allocation() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT c.id, c.contract_number, c.contract_name, c.amount,
                   COALESCE(a.net_addendum, 0) AS net_addendum,
                   COALESCE(v.vouchers_count, 0) AS vouchers_count,
                   COALESCE(i.invoices_count, 0) AS invoices_count,
                   COALESCE(sc.subs_count, 0) AS subs_count,
                   COALESCE(ad.addendums_count, 0) AS addendums_count
            FROM contracts c
            LEFT JOIN (
                SELECT contract_id,
                       SUM(amount_add - amount_deduct) AS net_addendum,
                       SUM(CASE WHEN status='معتمد' THEN 1 ELSE 0 END)
                           AS addendums_count
                FROM addendums GROUP BY contract_id
            ) a ON a.contract_id = c.id
            LEFT JOIN (
                SELECT contract_id, COUNT(*) AS vouchers_count
                FROM vouchers WHERE COALESCE(cancelled,0)=0
                GROUP BY contract_id
            ) v ON v.contract_id = c.id
            LEFT JOIN (
                SELECT contract_id, COUNT(*) AS invoices_count
                FROM invoices GROUP BY contract_id
            ) i ON i.contract_id = c.id
            LEFT JOIN (
                SELECT contract_id, COUNT(*) AS subs_count
                FROM sub_contracts WHERE status != 'ملغى'
                GROUP BY contract_id
            ) sc ON sc.contract_id = c.id
            LEFT JOIN (
                SELECT contract_id, COUNT(*) AS addendums_count
                FROM addendums WHERE status='معتمد'
                GROUP BY contract_id
            ) ad ON ad.contract_id = c.id
            WHERE c.status NOT IN ('ملغى','مسودة')
              AND (
                COALESCE(v.vouchers_count,0) > 0 OR
                COALESCE(i.invoices_count,0) > 0 OR
                COALESCE(sc.subs_count,0) > 0 OR
                COALESCE(ad.addendums_count,0) > 0
              )
        """).fetchall()
    result = []
    try:
        from services.supervision_service import extensions_map
        ext_map = extensions_map()
    except Exception:
        ext_map = {}
    for r in rows:
        sup_ext = float(ext_map.get(r["id"], {}).get("extension_value", 0.0))
        value = float(r["amount"]) + float(r["net_addendum"] or 0) + sup_ext
        if value > 0:
            result.append({
                "id": r["id"],
                "contract_number": r["contract_number"],
                "contract_name": r["contract_name"] or "",
                "value": value,
            })
    result.sort(key=lambda x: x["value"], reverse=True)
    return result

def _allocate_by_value(total: float, targets: list[dict]) -> list[float]:
    total_value = sum(t["value"] for t in targets) or 1.0
    if not targets:
        return []
    raw = [total * t["value"] / total_value for t in targets]
    rounded = [round(x, 3) for x in raw]
    diff = round(total - sum(rounded), 3)
    if abs(diff) >= 0.001 and rounded:
        idx = max(range(len(rounded)), key=lambda i: raw[i])
        rounded[idx] = round(rounded[idx] + diff, 3)
    return rounded

_create_bank_fee_voucher = _create_fee_voucher

def bank_fee_of(voucher_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM vouchers WHERE parent_voucher_id=? "
            "AND COALESCE(cancelled,0)=0", (voucher_id,)).fetchone()
    return dict(row) if row else None

def get_voucher(voucher_id: int) -> dict | None:
    rows = list_vouchers(voucher_id=voucher_id)
    return rows[0] if rows else None


def count_vouchers(vtype: str | None = None, contract_id: int | None = None,
                   project_id: int | None = None, search: str = "",
                   voucher_id: int | None = None,
                   exclude_custody_settlement: bool = False) -> int:
    """عدد السندات المطابقة للفلاتر — لحساب عدد الصفحات بلا جلب البيانات.

    يستخدم **نفس** منطق فلترة ``list_vouchers`` حرفيًا عبر تمرير
    limit=None، ثم يعدّ. لضمان عدم اختلاف العدّاد عن القائمة أبدًا
    نستعمل استعلام COUNT على نفس الشروط.
    """
    sql, params = _vouchers_query(
        vtype=vtype, contract_id=contract_id, project_id=project_id,
        search=search, voucher_id=voucher_id,
        exclude_custody_settlement=exclude_custody_settlement,
        count_only=True)
    with get_connection() as conn:
        return int(conn.execute(sql, params).fetchone()[0])


def _vouchers_query(vtype=None, contract_id=None, project_id=None,
                    search="", voucher_id=None,
                    exclude_custody_settlement=False,
                    count_only=False):
    """يبني استعلام السندات وشروطه — مصدر واحد يستخدمه الجلب والعد معًا،
    فلا يمكن أن يختلف العدّاد عن القائمة."""
    sql = """
    SELECT v.*, p.name AS project_name, ec.name AS expense_customer_name,
           c.contract_number,
           COALESCE(NULLIF(c.contract_name,''), c.description) AS contract_label,
           pc.name AS party_customer_name,
           cc.name AS contract_customer_name,
           ps.name AS party_subcontractor_name,
           b.description AS boq_description, s.name AS sub_name
    FROM vouchers v
    LEFT JOIN projects p ON p.id = v.project_id
    LEFT JOIN customers ec ON ec.id = v.expense_customer_id
    LEFT JOIN contracts c ON c.id = v.contract_id
    LEFT JOIN customers cc ON cc.id = c.customer_id
    LEFT JOIN customers pc ON pc.id = v.party_id AND v.party_type='customer'
    LEFT JOIN subcontractors ps ON ps.id = v.party_id AND v.party_type='subcontractor'
    LEFT JOIN boq_items b ON b.id = v.boq_item_id
    LEFT JOIN sub_contracts scs ON scs.id = v.sub_contract_id
    LEFT JOIN subcontractors s ON s.id = scs.subcontractor_id
    """
    where, params = [], []
    if voucher_id:
        where.append("v.id=?"); params.append(int(voucher_id))
    if vtype:
        if vtype == "payment":
            where.append("v.vtype IN ('payment','transfer')")
        else:
            where.append("v.vtype=?"); params.append(vtype)
    if contract_id:
        where.append("v.contract_id=?"); params.append(contract_id)
    if project_id:
        where.append("v.project_id=?"); params.append(project_id)
    if exclude_custody_settlement:
        where.append("NOT (v.custody_account_id IS NOT NULL "
                     "AND COALESCE(v.expense_group_ref,'')<>'')")
    if search.strip():
        clause, p = normalized_search_clause(
            ["v.voucher_number", "v.party", "v.description", "v.account",
             "v.expense_account_snapshot", "v.custody_account_snapshot",
             "c.contract_number", "c.contract_name", "c.description", "p.name", "ec.name",
             "pc.name", "cc.name", "ps.name", "s.name"], search)
        phone_clause, _ = normalized_search_clause(["cx.phone"], search)
        sub_phone_clause, _ = normalized_search_clause(["sx.phone"], search)
        where.append(
            "(" + clause +
            " OR EXISTS (SELECT 1 FROM customers cx WHERE cx.id = v.party_id "
            "           AND v.party_type='customer' AND " + phone_clause + ") "
            "OR EXISTS (SELECT 1 FROM subcontractors sx WHERE sx.id = v.party_id "
            "           AND v.party_type='subcontractor' AND " + sub_phone_clause + "))")
        params += p + [like_param(search), like_param(search)]
    if count_only:
        sql = ("SELECT COUNT(*) FROM vouchers v "
               "LEFT JOIN projects p ON p.id = v.project_id "
               "LEFT JOIN customers ec ON ec.id = v.expense_customer_id "
               "LEFT JOIN contracts c ON c.id = v.contract_id "
               "LEFT JOIN customers cc ON cc.id = c.customer_id "
               "LEFT JOIN customers pc ON pc.id = v.party_id AND v.party_type='customer' "
               "LEFT JOIN subcontractors ps ON ps.id = v.party_id AND v.party_type='subcontractor' "
               "LEFT JOIN boq_items b ON b.id = v.boq_item_id "
               "LEFT JOIN sub_contracts scs ON scs.id = v.sub_contract_id "
               "LEFT JOIN subcontractors s ON s.id = scs.subcontractor_id ")
    if where:
        sql += " WHERE " + " AND ".join(where)
    if not count_only:
        sql += " ORDER BY v.id DESC"
    return sql, params


def list_vouchers(vtype: str | None = None, contract_id: int | None = None,
                  project_id: int | None = None, search: str = "",
                  voucher_id: int | None = None,
                  exclude_custody_settlement: bool = False,
                  limit: int | None = None,
                  offset: int = 0) -> list[dict]:
    """سندات النظام.

    exclude_custody_settlement: إخفاء **بنود تصفية العهدة** من القائمة —
    وهي سندات صرف مجمعة تحمل حساب عهدة (`custody_account_id`) مع مرجع
    مجموعة (`expense_group_ref`). تُعرض في شاشة «العُهد» المستقلة.
    ملاحظة: **سند تسليم العهدة يبقى ظاهرًا** لأنه صرف نقدي فعلي خرج
    من الخزينة (لا مرجع مجموعة له).
    """
    sql = """
    SELECT v.*, p.name AS project_name, ec.name AS expense_customer_name,
           c.contract_number,
           COALESCE(NULLIF(c.contract_name,''), c.description) AS contract_label,
           pc.name AS party_customer_name,
           cc.name AS contract_customer_name,
           ps.name AS party_subcontractor_name,
           b.description AS boq_description, s.name AS sub_name
    FROM vouchers v
    LEFT JOIN projects p ON p.id = v.project_id
    LEFT JOIN customers ec ON ec.id = v.expense_customer_id
    LEFT JOIN contracts c ON c.id = v.contract_id
    LEFT JOIN customers cc ON cc.id = c.customer_id
    LEFT JOIN customers pc ON pc.id = v.party_id AND v.party_type='customer'
    LEFT JOIN subcontractors ps ON ps.id = v.party_id AND v.party_type='subcontractor'
    LEFT JOIN boq_items b ON b.id = v.boq_item_id
    LEFT JOIN sub_contracts scs ON scs.id = v.sub_contract_id
    LEFT JOIN subcontractors s ON s.id = scs.subcontractor_id
    """
    where, params = [], []
    if voucher_id:
        where.append("v.id=?"); params.append(int(voucher_id))
    if vtype:
        if vtype == "payment":
            where.append("v.vtype IN ('payment','transfer')")
        else:
            where.append("v.vtype=?"); params.append(vtype)
    if contract_id:
        where.append("v.contract_id=?"); params.append(contract_id)
    if project_id:
        where.append("v.project_id=?"); params.append(project_id)
    if exclude_custody_settlement:
        where.append("NOT (v.custody_account_id IS NOT NULL "
                     "AND COALESCE(v.expense_group_ref,'')<>'')")
    if search.strip():
        clause, p = normalized_search_clause(
            ["v.voucher_number", "v.party", "v.description", "v.account",
             "v.expense_account_snapshot", "v.custody_account_snapshot",
             "c.contract_number", "c.contract_name", "c.description", "p.name", "ec.name",
             "pc.name", "cc.name", "ps.name", "s.name"], search)
        phone_clause, _ = normalized_search_clause(["cx.phone"], search)
        sub_phone_clause, _ = normalized_search_clause(["sx.phone"], search)
        where.append(
            "(" + clause +
            " OR EXISTS (SELECT 1 FROM customers cx WHERE cx.id = v.party_id "
            "           AND v.party_type='customer' AND " + phone_clause + ") "
            "OR EXISTS (SELECT 1 FROM subcontractors sx WHERE sx.id = v.party_id "
            "           AND v.party_type='subcontractor' AND " + sub_phone_clause + "))")
        params += p + [like_param(search), like_param(search)]
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY v.id DESC"
    # limit/offset اختياريان: الترقيم داخل قاعدة البيانات بدل نقل كل
    # السندات ثم عرض 50 منها (الفارق كبير جدًا على القاعدة المشتركة).
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        params = list(params) + [int(limit), int(offset or 0)]
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    for row in rows:
        row["stored_party"] = row.get("party") or ""
        ptype = (row.get("party_type") or "").strip()
        if ptype == "customer" and (row.get("party_customer_name") or "").strip():
            row["party"] = row["party_customer_name"]
        elif row.get("vtype") == "receipt" and (row.get("contract_customer_name") or "").strip():
            row["party"] = row["contract_customer_name"]
        elif ptype == "subcontractor" and (row.get("party_subcontractor_name") or row.get("sub_name") or "").strip():
            row["party"] = row.get("party_subcontractor_name") or row.get("sub_name")
    return rows

@atomic
def _apply_payment_link(voucher_id: int, kind: str, contract_id,
                        sub_contract_id, link: dict) -> None:
    """V6.2: يخزّن ربط سند جديد بدفعة مستحقة (داخل معاملة حفظ السند)."""
    from services import voucher_payment_link_service as vpl
    selections = [(int(a), float(b)) for a, b in (link or {}).get("selections")
                  or []]
    if not selections:
        return
    cands = vpl.due_lines(kind, contract_id=contract_id,
                          sub_contract_id=sub_contract_id,
                          exclude_voucher_id=int(voucher_id))
    vpl.validate_selections(cands, selections)
    with get_connection() as conn:
        vpl.apply_links(conn, voucher_id, kind, selections, cands,
                        spread=bool((link or {}).get("spread", True)))


def _write_payment_links(voucher_id: int, kind: str, contract_id,
                         sub_contract_id, selections,
                         spread: bool = True) -> None:
    """V6.2: يضبط ربط سند محفوظ (تعديل السند يرجّع الدفعة ثم يعيد الربط).

    يُسمح بإبقاء السطر المرتبط حاليًا بنفس السند حتى لو كان مغطّى — لأن
    إلغاء الربط يُنفَّذ أولًا ثم يُعاد الحساب.
    """
    from services import voucher_payment_link_service as vpl
    sel = [(int(a), float(b)) for a, b in (selections or [])]
    # الاستبعاد يحسب المستحق كأن هذا السند غير موجود (بلا احتساب مزدوج)
    cands = vpl.due_lines(kind, contract_id=contract_id,
                          sub_contract_id=sub_contract_id,
                          exclude_voucher_id=int(voucher_id))
    vpl.validate_selections(cands, sel)
    with get_connection() as conn:
        vpl.reverse_links(conn, voucher_id)
        if sel:
            vpl.apply_links(conn, voucher_id, kind, sel, cands,
                            spread=bool(spread))


@atomic
def update_voucher(voucher_id: int, vdate: str, method: str, amount: float,
                   description: str, notes: str = "",
                   contract_id: int | None = None,
                   party_type: str = "", party_id: int | None = None,
                   cheque_due_date: str = "",
                   allow_overpay: bool = False,
                   account: str | None = None,
                   project_id: int | None = None,
                   party: str | None = None,
                   expense_customer_id: int | None = None,
                   expense_account_id: int | None = None,
                   sub_contract_id: int | None = None,
                   payment_links: list | None = None,
                   payment_spread: bool = True) -> None:
    with get_connection() as conn:
        old = conn.execute("SELECT * FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
    if not old:
        raise ValidationError("السند غير موجود.")
    if old["cancelled"]:
        raise ValidationError("لا يمكن تعديل سند ملغى.")
    if ((old["vtype"] or "") == "payment" and not (description or "").strip()
            and party_type != "partner"):
        description = _payment_fallback_description(
            party if party is not None else (old["party"] or ""),
            expense_account_id, expense_customer_id)
    if (old["vtype"] or "") in ("custody_return", "salary_deduction"):
        # V4.55: المرتجع/الخصم مربوط بسقف المتبقي — التعديل المالي ممنوع.
        raise ValidationError(
            "لا يمكن تعديل المرتجع أو الخصم.\n"
            "ألغِ السند وأنشئ غيره بالمبلغ الصحيح.")
    try:
        _old_partner = (old["party_type"] == "partner"
                        or (old["account"] or "") == "جاري الشريك")
    except Exception:
        _old_partner = False
    if party_type == "partner" or (account or "") == "جاري الشريك" \
            or _old_partner:
        from services import auth_service as _auth
        if not _auth.is_admin():
            raise ValidationError("جاري الشريك للمدير فقط.")
    _ensure_contract_accepts_financial_actions(old["contract_id"])
    vtype = old["vtype"]
    if vtype == "payment":
        _sid = sub_contract_id
        if _sid is None and "sub_contract_id" in old.keys():
            _sid = old["sub_contract_id"]
        _ensure_sub_contract_accepts_payments(_sid)
    if amount <= 0:
        raise ValidationError("مبلغ السند يجب أن يكون أكبر من صفر.")
    if not vdate.strip():
        raise ValidationError("تاريخ السند مطلوب.")
    if vtype == "transfer":
        if not method or not account:
            raise ValidationError("يجب اختيار حساب التحويل المصدر وحساب الوجهة.")
        if method == account:
            raise ValidationError("لا يمكن التحويل بين نفس الحساب.")
        if _cash_wallet_of(method) == _cash_wallet_of(account):
            raise ValidationError("اختر حسابين مختلفين فعلًا: البنك والصندوق.")
        _ensure_transfer_source_balance(method, amount, vdate, exclude_voucher_id=voucher_id)
        party_type = "transfer"
        party_id = None
        contract_id = None
        project_id = None
        expense_customer_id = None
    elif vtype == "payment":
        if party_type and party_type not in PARTY_TYPES:
            raise ValidationError("نوع الطرف غير صحيح.")
        if party_type and not party_id and party_type != "partner":
            raise ValidationError("سند الصرف يجب أن يرتبط بعميل أو مقاول باطن.")
    party_name = old["party"]
    if party_type and party_id:
        with get_connection() as conn:
            if party_type == "customer":
                row = conn.execute("SELECT name FROM customers WHERE id=?", (party_id,)).fetchone()
            else:
                row = conn.execute("SELECT name FROM subcontractors WHERE id=?", (party_id,)).fetchone()
        if not row:
            raise ValidationError("الطرف المحدد غير موجود.")
        party_name = row["name"]
    elif party is not None:
        party_name = (party or "").strip()
    if vtype == "transfer":
        party_name = "تحويل داخلي"
    if vtype == "payment" and not party_type and not party_name:
        raise ValidationError("يجب تحديد جهة الصرف.")
    if expense_customer_id:
        with get_connection() as conn:
            if not conn.execute("SELECT 1 FROM customers WHERE id=?", (expense_customer_id,)).fetchone():
                raise ValidationError("العميل التحليلي للمنصرف غير موجود.")
    if contract_id:
        _ensure_contract_accepts_financial_actions(contract_id)
        with get_connection() as conn:
            crow = conn.execute(
                "SELECT customer_id, project_id FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if not crow:
            raise ValidationError("العقد غير موجود.")
        if party_type == "customer" and party_id and crow["customer_id"] != party_id:
            raise ValidationError("العقد المحدد لا يخص هذا العميل.\nاختر عقدًا من عقود العميل نفسه.")
        if party_type == "subcontractor" and party_id:
            with get_connection() as conn:
                linked = conn.execute(
                    "SELECT COUNT(*) FROM sub_contracts "
                    "WHERE subcontractor_id=? AND contract_id=? AND status != 'ملغى'",
                    (party_id, contract_id)).fetchone()[0]
            if not linked:
                raise ValidationError("هذا المقاول غير مرتبط بالعقد المحدد.\nاربطه أولًا بعقد باطن من شاشة مقاولي الباطن.")
            if vtype == "payment":
                _check_sub_payment_limit(party_id, contract_id, amount,
                                         exclude_voucher_id=voucher_id, allow_overpay=allow_overpay)
        project_id = crow["project_id"]
    if vtype == "receipt" and contract_id:
        value = contract_current_value(contract_id)
        with get_connection() as conn:
            collected_others = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 AND id != ?",
                (contract_id, voucher_id)).fetchone()[0])
        due_value = value["current"]
        from services.supervision_service import supervision_status
        sup = supervision_status(contract_id)
        if sup:
            due_value = max(due_value, sup["total_due"])
        remaining = due_value - collected_others
        if amount > remaining + 1e-9:
            if not allow_overpay:
                raise OverpayWarning(
                    "قيمة السند تتجاوز المبلغ المتبقي من العقد.\n"
                    f"المتبقي (بدون هذا السند): {remaining:,.3f}\n"
                    "سيتم تسجيل الزيادة كـ (دفعة مقدمة) على العقد.")
    account_value = old["account"] if account is None else (account or "")
    _exp_id = old["expense_account_id"]
    _exp_snap = old["expense_account_snapshot"]
    if expense_account_id is not None:
        # V3.1: تغيير حساب المصروف (تعديل بنود التصفية)
        from services import expense_account_service as _ea
        _exp_id, _exp_snap, _inc = _ea.account_snapshot(int(expense_account_id))
        if account is None:
            account_value = _exp_snap
    _eff_party = (party_type or "") or (old["party_type"] or "")
    if vtype in ("receipt", "payment") and (
            _eff_party == "partner"
            or (account_value or "") == "جاري الشريك"):
        # V4.55: الشريك — نفس منطق الإنشاء (الخزينة من الطريقة لا من الحساب).
        _w = _CASH_ACCOUNT_NAMES.get(_cash_wallet_of(method), "البنك")
        if vtype == "receipt":
            debit, credit = _w, "جاري الشريك"
        else:
            debit, credit = "جاري الشريك", _w
    elif vtype == "transfer":
        debit, credit = account_value, method
    elif vtype == "payment":
        if is_settlement_voucher(old):
            # V3.14: تصفية — الدائن العهدة أيًا كان اسم حساب المصروف.
            debit = account_value or "مصروف / تكلفة المشروع"
            credit = ((old["custody_account_snapshot"] or "").strip()
                      or "العهد")
        elif account_value and not any(h in account_value for h in _CASH_NAME_HINTS):
            debit, credit = account_value, "البنك / الصندوق"
        else:
            debit, credit = "مصروف / تكلفة المشروع", account_value or "البنك / الصندوق"
    else:
        debit, credit = account_value or "البنك / الصندوق", "العملاء / إيرادات العقد"
    with get_connection() as conn:
        conn.execute(
            "UPDATE vouchers SET vdate=?, party=?, party_type=?, party_id=?, "
            "method=?, account=?, amount=?, description=?, notes=?, contract_id=?, "
            "project_id=?, expense_customer_id=?, cheque_due_date=?, "
            "expense_account_id=?, expense_account_snapshot=?, sub_contract_id=? "
            "WHERE id=?",
            (vdate, party_name, party_type, party_id, method, account_value,
             amount, description, notes, contract_id, project_id, expense_customer_id,
             cheque_due_date if "شيك" in (method or "") else "",
             _exp_id, _exp_snap,
             int(sub_contract_id) if sub_contract_id else None, voucher_id))
        conn.execute(
            "UPDATE journal_entries SET entry_date=?, amount=?, "
            "description=?, debit_account=?, credit_account=?, contract_id=?, project_id=? "
            "WHERE source_type LIKE 'voucher%' AND source_id=?",
            (vdate, amount,
             _journal_text(conn, old['voucher_number'], description, vtype,
                           int(sub_contract_id) if sub_contract_id
                           else old["sub_contract_id"]),
             debit, credit, contract_id, project_id, voucher_id))
    if contract_id or old["contract_id"]:
        log_event(contract_id or old["contract_id"], "تعديل سند",
                  f"{old['voucher_number']} · {amount:,.3f}")

    if vtype == "receipt":
        # مزامنة سندات الرسوم مع القيم الجديدة (طريقة/مبلغ/تاريخ/عقد)
        _reconcile_receipt_fees(voucher_id, vdate, method, amount,
                                contract_id, old["voucher_number"])
    if vtype == "transfer":
        # V4.55: مزامنة عمولات التسوية التابعة (تاريخ/طريقة فقط —
        # المبلغ من العمليات لا من التحويل).
        _sync_transfer_fee_children(voucher_id, vdate, method)
    # V6.2: إعادة ضبط ربط الدفعات — تعديل السند يرجّع الدفعة لحالتها السابقة
    if payment_links is not None and vtype in ("receipt", "payment"):
        _write_payment_links(
            voucher_id, "receipt" if vtype == "receipt" else "payment",
            contract_id or old["contract_id"],
            sub_contract_id if sub_contract_id is not None
            else old["sub_contract_id"],
            payment_links, spread=payment_spread)


def update_voucher_description(voucher_id: int, description: str) -> None:
    """تعديل بيان السند فقط دون أي أثر مالي أو تغيير طرف/تاريخ/مبلغ/عقد."""
    desc = (description or "").strip()
    if not desc:
        raise ValidationError("بيان السند مطلوب.")
    with get_connection() as conn:
        old = conn.execute("SELECT * FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
        if not old:
            raise ValidationError("السند غير موجود.")
        if old["cancelled"]:
            raise ValidationError("لا يمكن تعديل بيان سند ملغى.")
        conn.execute("UPDATE vouchers SET description=? WHERE id=?", (desc, voucher_id))
        conn.execute(
            "UPDATE journal_entries SET description=? "
            "WHERE source_type LIKE 'voucher%' AND source_id=?",
            (_journal_text(conn, old['voucher_number'], desc, old["vtype"],
                           old["sub_contract_id"]), voucher_id))
    if old["contract_id"]:
        log_event(old["contract_id"], "تعديل بيان سند",
                  f"{old['voucher_number']} · بدون تغيير مالي")


def _comment_receipt_cancel_reopens_plan(voucher_row, reason: str = "") -> None:
    """عند إلغاء سند قبض، قد تعود دفعة مرحلة كمستحقة بعد أن كانت مغطاة."""
    try:
        if (voucher_row["vtype"] or "") != "receipt" or not voucher_row["contract_id"]:
            return
        contract_id = int(voucher_row["contract_id"])
        with get_connection() as conn:
            con = conn.execute(
                "SELECT customer_id, contract_number FROM contracts WHERE id=?",
                (contract_id,)).fetchone()
            if not con:
                return
            collected = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
                "AND (allocation IS NULL OR allocation = '')",
                (contract_id,)).fetchone()[0])
            plan_rows = conn.execute(
                "SELECT id, title, amount, triggered_at FROM payment_plan "
                "WHERE contract_id=? ORDER BY due_date, sort_order",
                (contract_id,)).fetchall()
            pool = collected
            reopened = []
            for pr in plan_rows:
                amount = float(pr["amount"] or 0)
                covered = min(pool, amount)
                pool -= covered
                remaining = max(0.0, amount - covered)
                if (pr["triggered_at"] or "").strip() and remaining > 0.001:
                    reopened.append((int(pr["id"]), pr["title"], remaining))
            if not reopened:
                return
            reason_txt = (f" · السبب: {(reason or '').strip()}"
                          if (reason or "").strip() else "")
            for pid, title, remaining in reopened:
                conn.execute(
                    "UPDATE payment_plan SET notes=? WHERE id=?",
                    (f"عادت مستحقة بعد إلغاء سند قبض "
                     f"{voucher_row['voucher_number']} · المتبقي "
                     f"{remaining:,.3f} د.ك{reason_txt}", pid))
        pays = " و".join(f"«{title}» (المتبقي {remaining:,.3f})"
                         for _, title, remaining in reopened)
        _add_system_comment(
            con["customer_id"], contract_id,
            f"تم إلغاء سند قبض رقم {voucher_row['voucher_number']} "
            f"بمبلغ {float(voucher_row['amount'] or 0):,.3f} د.ك؛ "
            f"لذلك عادت الدفعة {pays} كمستحقة مرة أخرى"
            + (f" · السبب: {reason}" if (reason or "").strip() else ""))
    except Exception:
        pass


@atomic
def cancel_voucher(voucher_id: int, reason: str = "") -> None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
        if not row:
            raise ValidationError("السند غير موجود.")
        if row["cancelled"]:
            raise ValidationError("السند ملغى بالفعل.")
    if (row["vtype"] or "") == "payment" \
            and row["custody_account_id"] is not None \
            and not is_settlement_voucher(row):
        # V4.55: تسليم عهدة — يُمنع إلغاؤه عند وجود تصفية/رد سارٍ.
        with get_connection() as conn:
            _deps = conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE COALESCE(cancelled,0)=0 "
                "AND id != ? AND custody_account_id = ? "
                "AND (vtype='custody_return' "
                "OR COALESCE(expense_group_ref,'') <> '' "
                "OR COALESCE(notes,'') LIKE '%تصفية عهدة من حساب:%' "
                "OR COALESCE(notes,'') LIKE '%إغلاق عهدة من حساب:%')",
                (voucher_id, row["custody_account_id"])).fetchone()[0]
        if _deps:
            raise ValidationError(
                "لا يمكن إلغاء تسليم العهدة: توجد تصفية أو ردود سارية.\n"
                "ألغها أولًا ثم ألغِ التسليم.")
    if (row["vtype"] or "") == "payment" \
            and row["advance_employee_id"] is not None:
        # V4.55: سلفة موظف — يُمنع إلغاؤها عند وجود رد/خصم سارٍ.
        with get_connection() as conn:
            _ed = conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE COALESCE(cancelled,0)=0 "
                "AND id != ? AND advance_employee_id = ? "
                "AND vtype IN ('custody_return','salary_deduction')",
                (voucher_id, row["advance_employee_id"])).fetchone()[0]
        if _ed:
            raise ValidationError(
                "لا يمكن إلغاء السلفة: توجد ردود أو خصومات سارية.\n"
                "ألغها أولًا ثم ألغِ السلفة.")
    _ensure_contract_accepts_financial_actions(row["contract_id"])
    
    # V8.3: التحقق من المطالبات المرتبطة بالسند
    if row["contract_id"]:
        with get_connection() as conn:
            _claims = conn.execute(
                "SELECT COUNT(*) FROM claims WHERE contract_id=? "
                "AND COALESCE(status,'') NOT IN ('ملغاة','مسجلة')",
                (row["contract_id"],)).fetchone()[0]
            if _claims:
                raise ValidationError(
                    f"لا يمكن إلغاء السند: العقد مرتبط بـ {_claims} مطالبة سارية.\n"
                    "ألغِ المطالبات أولًا ثم ألغِ السند.")
    
    with get_connection() as conn:
        conn.execute(
            "UPDATE vouchers SET cancelled=1, cancel_reason=?, cancelled_at=datetime('now','localtime') WHERE id=?",
            ((reason or "").strip(), voucher_id))
        child_ids = [r[0] for r in conn.execute(
            "SELECT id FROM vouchers WHERE parent_voucher_id=?", (voucher_id,)).fetchall()]
        all_cancelled_ids = [int(voucher_id)] + [int(x) for x in child_ids]
        if child_ids:
            conn.execute(
                "UPDATE vouchers SET cancelled=1, cancel_reason=?, cancelled_at=datetime('now','localtime') "
                "WHERE parent_voucher_id=?",
                ("إلغاء تلقائي بسبب إلغاء السند الأب" + (f" · {reason}" if reason else ""), voucher_id))
        _reverse_voucher_journals(conn, all_cancelled_ids)
    if row["contract_id"]:
        log_event(row["contract_id"], "إلغاء سند",
                  f"{row['voucher_number']} · {row['amount']:,.3f}"
                  + (f" · السبب: {reason}" if reason else ""))
        _comment_receipt_cancel_reopens_plan(row, reason)

# ============================================================
# عروض الأسعار
# ============================================================
def add_quotation(qdate: str, customer_id: int, project_id: int | None,
                  validity_days: int, execution_period: str, currency: str,
                  discount: float, tax: float, payment_terms: str,
                  execution_terms: str, notes: str, items: list[dict]) -> int:
    if not customer_id:
        raise ValidationError("يجب اختيار العميل.")
    if not items:
        raise ValidationError("يجب إضافة بند واحد على الأقل لعرض السعر.")
    number = next_quote_number()
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO quotations (quote_number, qdate, customer_id, project_id, "
            "validity_days, execution_period, currency, discount, tax, "
            "payment_terms, execution_terms, notes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (number, qdate, customer_id, project_id, validity_days,
             execution_period, currency, discount, tax,
             payment_terms, execution_terms, notes))
        qid = cur.lastrowid
        for item in items:
            conn.execute(
                "INSERT INTO quotation_items (quotation_id, description, qty, unit, unit_price) "
                "VALUES (?, ?, ?, ?, ?)",
                (qid, item["description"], item.get("qty", 1),
                 item.get("unit", ""), item.get("unit_price", 0)))
    return qid

def list_quotations(search: str = "", status: str = "") -> list[dict]:
    sql = """
    SELECT q.*, cu.name AS customer_name, p.name AS project_name,
           (SELECT COALESCE(SUM(qty * unit_price),0) FROM quotation_items
            WHERE quotation_id = q.id) AS subtotal
    FROM quotations q
    JOIN customers cu ON cu.id = q.customer_id
    LEFT JOIN projects p ON p.id = q.project_id
    """
    where, params = [], []
    if search.strip():
        clause, p = normalized_search_clause(["q.quote_number", "cu.name", "p.name"], search)
        where.append(clause)
        params += p
    if status:
        where.append("q.status=?"); params.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY q.id DESC"
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    for r in rows:
        r["total"] = r["subtotal"] - (r["discount"] or 0) + (r["tax"] or 0)
    return rows

def get_quotation(qid: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT q.*, cu.name AS customer_name, p.name AS project_name "
            "FROM quotations q JOIN customers cu ON cu.id = q.customer_id "
            "LEFT JOIN projects p ON p.id = q.project_id WHERE q.id=?",
            (qid,)).fetchone()
        if not row:
            return None
        items = conn.execute(
            "SELECT *, qty * unit_price AS total FROM quotation_items "
            "WHERE quotation_id=? ORDER BY id", (qid,)).fetchall()
    result = dict(row)
    result["items"] = [dict(i) for i in items]
    result["subtotal"] = sum(i["total"] for i in result["items"])
    result["total"] = result["subtotal"] - (result["discount"] or 0) + (result["tax"] or 0)
    return result

def set_quotation_status(qid: int, status: str) -> None:
    if status not in QUOTE_STATUSES:
        raise ValidationError("حالة عرض السعر غير صحيحة.")
    with get_connection() as conn:
        conn.execute("UPDATE quotations SET status=? WHERE id=?", (status, qid))

def convert_quotation_to_contract(qid: int) -> int:
    quote = get_quotation(qid)
    if not quote:
        raise ValidationError("عرض السعر غير موجود.")
    if quote["contract_id"]:
        raise ValidationError("تم تحويل هذا العرض إلى عقد من قبل.")
    if quote["total"] <= 0:
        raise ValidationError("إجمالي عرض السعر يجب أن يكون أكبر من صفر.")
    from services import contract_service
    from database.models import Contract
    number = contract_service.next_contract_number()
    contract_id = contract_service.add_contract(Contract(
        contract_number=number,
        customer_id=quote["customer_id"],
        contract_date=date.today().isoformat(),
        description=f"عقد محوّل من عرض السعر {quote['quote_number']}",
        amount=quote["total"],
        notes=quote["notes"] or ""))
    with get_connection() as conn:
        conn.execute(
            "UPDATE contracts SET project_id=?, currency=?, status='معتمد', "
            "contract_name=? WHERE id=?",
            (quote["project_id"], quote["currency"],
             f"عقد {quote['customer_name']}", contract_id))
        for item in quote["items"]:
            conn.execute(
                "INSERT INTO boq_items (contract_id, description, qty, unit, unit_price) "
                "VALUES (?, ?, ?, ?, ?)",
                (contract_id, item["description"], item["qty"],
                 item["unit"], item["unit_price"]))
        conn.execute(
            "UPDATE quotations SET status='تم تحويله إلى عقد', contract_id=? WHERE id=?",
            (contract_id, qid))
    log_event(contract_id, "إنشاء العقد",
              f"محوّل من عرض السعر {quote['quote_number']}")
    return contract_id

# ============================================================
# Dashboard العقد + الربحية
# ============================================================
def contract_dashboard(contract_id: int) -> dict:
    # V2.48: تغليف بذاكرة البناء (كان يُحسب 16 مرة لكل فتح مركز عقد)
    from services.qcache import memo
    return memo(("contract_dashboard", contract_id),
                lambda: _contract_dashboard_impl(contract_id))


def _contract_dashboard_impl(contract_id: int) -> dict:
    with get_connection() as conn:
        contract = conn.execute(
            "SELECT c.*, cu.name AS customer_name, p.name AS project_name "
            "FROM contracts c JOIN customers cu ON cu.id = c.customer_id "
            "LEFT JOIN projects p ON p.id = c.project_id WHERE c.id=?",
            (contract_id,)).fetchone()
        if not contract:
            raise ValidationError("العقد غير موجود.")
        invoiced = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM invoices WHERE contract_id=?",
            (contract_id,)).fetchone()[0])
        receipts = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0", (contract_id,)).fetchone()[0])
        payments = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='payment' AND cancelled=0", (contract_id,)).fetchone()[0])
        other_payments = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='payment' AND cancelled=0 "
            "AND COALESCE(party_type,'')!='subcontractor'",
            (contract_id,)).fetchone()[0])

    value = contract_current_value(contract_id)
    subs = total_sub_contracts(contract_id)
    timeline = contract_timeline(contract["start_date"] or "", contract["end_date"] or "")
    total_cost = payments
    expected_cost = subs + other_payments
    expected_profit = value["current"] - expected_cost
    actual_profit = receipts - payments
    sup_ext = value["sup_extension"]
    return {
        "contract": dict(contract),
        "original_value": value["original"],
        "addendums_net": value["additions"] - value["deductions"],
        "current_value": value["current"],
        "sup_extension": sup_ext,
        "total_invoiced": invoiced,
        "total_receipts": receipts,
        "total_payments": payments,
        "other_payments": other_payments,
        "total_subs": subs,
        "total_cost": total_cost,
        "expected_cost": expected_cost,
        "expected_profit": expected_profit,
        "actual_profit": actual_profit,
        "profit": actual_profit,
        "remaining_to_invoice": value["current"] + sup_ext - invoiced,
        "timeline": timeline,
    }

# ============================================================
# كشوف الحساب: المشروع / العميل / العقد
# ============================================================
def project_statement(project_id: int) -> list[dict]:
    with get_connection() as conn:
        invoices = conn.execute(
            "SELECT i.invoice_date AS d, 'فاتورة' AS type, i.description AS descr, "
            "c.contract_number AS ref, i.amount, 'debit' AS side "
            "FROM invoices i JOIN contracts c ON c.id = i.contract_id "
            "WHERE c.project_id=?", (project_id,)).fetchall()
        vouchers = conn.execute(
            "SELECT vdate AS d, CASE vtype WHEN 'receipt' THEN 'سند قبض' "
            "ELSE 'سند صرف' END AS type, description AS descr, "
            "voucher_number AS ref, amount, "
            "CASE vtype WHEN 'receipt' THEN 'credit' ELSE 'debit' END AS side "
            "FROM vouchers WHERE project_id=?", (project_id,)).fetchall()
    rows = sorted([dict(r) for r in invoices] + [dict(r) for r in vouchers],
                  key=lambda x: (x["d"], x["ref"]))
    balance = 0.0
    for r in rows:
        if r["side"] == "debit":
            r["debit"], r["credit"] = r["amount"], 0.0
            balance += r["amount"]
        else:
            r["debit"], r["credit"] = 0.0, r["amount"]
            balance -= r["amount"]
        r["balance"] = balance
    return rows

def customer_statement(customer_id: int, date_from: str = "", date_to: str = "") -> dict:
    with get_connection() as conn:
        contracts = conn.execute(
            "SELECT contract_date AS d, 'عقد' AS type, "
            "COALESCE(NULLIF(contract_name,''), description) AS descr, "
            "contract_number AS ref, amount, 'debit' AS side "
            "FROM contracts WHERE customer_id=? AND status NOT IN ('ملغى')",
            (customer_id,)).fetchall()
        receipts = conn.execute(
            "SELECT v.vdate AS d, 'سند قبض' AS type, v.description AS descr, "
            "v.voucher_number AS ref, v.amount, 'credit' AS side "
            "FROM vouchers v JOIN contracts c ON c.id = v.contract_id "
            "WHERE c.customer_id=? AND v.vtype='receipt' AND cancelled=0 AND v.cancelled=0",
            (customer_id,)).fetchall()
        cust_addendums = conn.execute(
            "SELECT a.adate AS d, a.addendum_type AS type, a.reason AS descr, "
            "a.addendum_number AS ref, (a.amount_add - a.amount_deduct) AS amount "
            "FROM addendums a JOIN contracts c ON c.id = a.contract_id "
            "WHERE c.customer_id=? AND a.status='معتمد' "
            "AND c.status NOT IN ('ملغى')", (customer_id,)).fetchall()
        invoices = conn.execute(
            "SELECT invoice_date AS d, 'فاتورة' AS type, description AS descr, "
            "invoice_number AS ref, amount, 'info' AS side "
            "FROM invoices WHERE customer_id=?", (customer_id,)).fetchall()

    rows = [dict(r) for r in contracts] + [dict(r) for r in receipts]
    for a in cust_addendums:
        d = dict(a)
        amt = float(d["amount"])
        if abs(amt) < 0.001:
            continue
        d["side"] = "debit" if amt > 0 else "credit"
        d["amount"] = abs(amt)
        rows.append(d)
    if date_from:
        rows = [r for r in rows if r["d"] >= date_from]
    if date_to:
        rows = [r for r in rows if r["d"] <= date_to]
    rows.sort(key=lambda x: (x["d"], x["ref"]))

    balance = total_debit = total_credit = 0.0
    for r in rows:
        if r["side"] == "debit":
            r["debit"], r["credit"] = r["amount"], 0.0
            balance += r["amount"]; total_debit += r["amount"]
        else:
            r["debit"], r["credit"] = 0.0, r["amount"]
            balance -= r["amount"]; total_credit += r["amount"]
        r["balance"] = balance
    return {
        "rows": rows, "total_debit": total_debit,
        "total_credit": total_credit, "balance": total_debit - total_credit,
        "invoices_count": len(invoices),
    }

def contract_statement_full(contract_id: int) -> dict:
    dash = contract_dashboard(contract_id)
    with get_connection() as conn:
        addendums = conn.execute(
            "SELECT adate AS d, COALESCE(NULLIF(addendum_type,''), 'أمر تغييري') AS type, "
            "reason || ' (' || addendum_number || ')' AS descr, "
            "addendum_number AS ref, amount_add - amount_deduct AS amount "
            "FROM addendums WHERE contract_id=? AND status='معتمد'",
            (contract_id,)).fetchall()
        invoices = conn.execute(
            "SELECT invoice_date AS d, 'فاتورة' AS type, description AS descr, "
            "invoice_number AS ref, amount FROM invoices WHERE contract_id=?",
            (contract_id,)).fetchall()
        vouchers = conn.execute(
            "SELECT vdate AS d, CASE vtype WHEN 'receipt' THEN 'سند قبض' "
            "ELSE 'سند صرف' END AS type, description AS descr, "
            "voucher_number AS ref, amount, vtype FROM vouchers "
            "WHERE contract_id=? AND cancelled=0", (contract_id,)).fetchall()
        subs = conn.execute(
            "SELECT sc.start_date AS d, 'عقد باطن' AS type, "
            "s.name || COALESCE(' · ' || NULLIF(sc.description,''), '') AS descr, "
            "s.sub_code AS ref, sc.amount FROM sub_contracts sc "
            "JOIN subcontractors s ON s.id = sc.subcontractor_id "
            "WHERE sc.contract_id=? AND sc.status != 'ملغى'",
            (contract_id,)).fetchall()

    contract = dash["contract"]
    rows = [{
        "d": contract["contract_date"], "type": "قيمة العقد",
        "descr": contract.get("contract_name") or contract.get("description") or "",
        "ref": contract["contract_number"],
        "debit": dash["original_value"], "credit": 0.0,
    }]
    for a in addendums:
        amt = float(a["amount"])
        rows.append({"d": a["d"], "type": a["type"], "descr": a["descr"],
                     "ref": a["ref"],
                     "debit": amt if amt > 0 else 0.0,
                     "credit": -amt if amt < 0 else 0.0})
    for i in invoices:
        rows.append({"d": i["d"], "type": i["type"], "descr": i["descr"],
                     "ref": i["ref"], "debit": 0.0, "credit": float(i["amount"])})
    for v in vouchers:
        amt = float(v["amount"])
        if v["vtype"] == "receipt":
            rows.append({"d": v["d"], "type": v["type"], "descr": v["descr"],
                         "ref": v["ref"], "debit": 0.0, "credit": amt})
        else:
            rows.append({"d": v["d"], "type": v["type"], "descr": v["descr"],
                         "ref": v["ref"], "debit": amt, "credit": 0.0})
    for s in subs:
        rows.append({"d": s["d"] or "", "type": s["type"], "descr": s["descr"],
                     "ref": s["ref"], "debit": float(s["amount"]), "credit": 0.0})

    try:
        from services.supervision_service import supervision_status
        _sup = supervision_status(contract_id)
    except Exception:
        _sup = None
    if _sup and _sup["extension_value"] > 0.001:
        m = _sup["billable_extension"]
        m_txt = ("شهر واحد" if m == 1 else "شهران" if m == 2 else f"{m:g} شهر")
        rows.append({
            "d": _sup["base_end"], "type": "تمديد إشراف",
            "descr": f"{m_txt} × {_sup['monthly']:,.3f}"
                     + (f" · بعد إلغاء {_sup['waived_months']:g} شهر" if _sup["waived_months"] else ""),
            "ref": "تمديد",
            "debit": _sup["extension_value"], "credit": 0.0})

    rows.sort(key=lambda x: (x["d"] or "9999", x["ref"]))
    balance = 0.0
    for r in rows:
        balance += r["debit"] - r["credit"]
        r["balance"] = balance
    return {"dashboard": dash, "rows": rows}

# ============================================================
# التقرير التحليلي للمشروع: الإيرادات مقابل المصروفات
# ============================================================
def project_analytics(project_id: int) -> dict:
    project = get_project(project_id)
    if not project:
        raise ValidationError("المشروع غير موجود.")
    with get_connection() as conn:
        contracts = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_name, c.amount, c.status, "
            "cu.name AS customer_name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE c.project_id=?", (project_id,)).fetchall()
        contract_ids = [c["id"] for c in contracts]
        receipts = conn.execute(
            "SELECT COALESCE(SUM(amount),0), COUNT(*) FROM vouchers "
            "WHERE project_id=? AND vtype='receipt' AND cancelled=0", (project_id,)).fetchone()
        total_income, income_count = float(receipts[0]), receipts[1]
        payments = conn.execute(
            "SELECT COALESCE(SUM(amount),0), COUNT(*) FROM vouchers "
            "WHERE project_id=? AND vtype='payment' AND cancelled=0", (project_id,)).fetchone()
        total_expense, expense_count = float(payments[0]), payments[1]
        expense_by_party = [dict(r) for r in conn.execute(
            "SELECT party, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt "
            "FROM vouchers WHERE project_id=? AND vtype='payment' AND cancelled=0 "
            "GROUP BY party ORDER BY total DESC", (project_id,)).fetchall()]
        income_by_party = [dict(r) for r in conn.execute(
            "SELECT party, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt "
            "FROM vouchers WHERE project_id=? AND vtype='receipt' AND cancelled=0 "
            "GROUP BY party ORDER BY total DESC", (project_id,)).fetchall()]
        monthly = [dict(r) for r in conn.execute(
            "SELECT SUBSTR(vdate, 1, 7) AS month, "
            "SUM(CASE WHEN vtype='receipt' AND cancelled=0 THEN amount ELSE 0 END) AS income, "
            "SUM(CASE WHEN vtype='payment' AND cancelled=0 THEN amount ELSE 0 END) AS expense "
            "FROM vouchers WHERE project_id=? "
            "GROUP BY month ORDER BY month", (project_id,)).fetchall()]
        subs_total = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM sub_contracts "
            "WHERE project_id=? AND status != 'ملغى'", (project_id,)).fetchone()[0])

    total_contract_value = 0.0
    contracts_details = []
    for c in contracts:
        value = contract_current_value(c["id"])
        total_contract_value += value["current"]
        contracts_details.append({**dict(c), "current_value": value["current"]})

    total_cost = total_expense + subs_total
    net_profit = total_income - total_expense
    expected_profit = total_contract_value - total_cost
    return {
        "project": project,
        "contracts": contracts_details,
        "total_contract_value": total_contract_value,
        "total_income": total_income, "income_count": income_count,
        "total_expense": total_expense, "expense_count": expense_count,
        "subs_total": subs_total,
        "total_cost": total_cost,
        "net_cash": net_profit,
        "expected_profit": expected_profit,
        "remaining_to_collect": total_contract_value - total_income,
        "expense_by_party": expense_by_party,
        "income_by_party": income_by_party,
        "monthly": monthly,
        "collection_percent": round(total_income / total_contract_value * 100, 1) if total_contract_value else 0.0,
    }

# ============================================================
# مصمم العقود · القوالب والحقول الديناميكية
# ============================================================
DEFAULT_TEMPLATE = """عقد اتفاق

الطرف الأول: {{اسم_الشركة}}
العنوان: {{عنوان_الشركة}}
الهاتف: {{هاتف_الشركة}}

الطرف الثاني: {{اسم_العميل}}

رقم العقد: {{رقم_العقد}}
تاريخ العقد: {{تاريخ_العقد}}
المشروع: {{اسم_المشروع}}
قيمة العقد: {{قيمة_العقد}} {{العملة}}
تاريخ البداية: {{تاريخ_البداية}}
تاريخ النهاية: {{تاريخ_النهاية}}
مدة العقد: {{مدة_العقد}} يوم

نطاق العمل:
{{وصف_العقد}}

شروط الدفع:
- حسب الاتفاق بين الطرفين.

التزامات الطرف الأول:
- تنفيذ الأعمال حسب المواصفات المتفق عليها.

التزامات الطرف الثاني:
- سداد الدفعات في مواعيدها.

التوقيعات:

الطرف الأول: ________________          الطرف الثاني: ________________
"""

def list_templates() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM contract_templates ORDER BY id").fetchall()
    if not rows:
        with get_connection() as conn:
            conn.execute("INSERT INTO contract_templates (name, body) VALUES (?, ?)",
                         ("القالب الافتراضي", DEFAULT_TEMPLATE))
            rows = conn.execute("SELECT * FROM contract_templates ORDER BY id").fetchall()
    return [dict(r) for r in rows]

def save_template(name: str, body: str, template_id: int | None = None) -> int:
    if not name.strip():
        raise ValidationError("اسم القالب مطلوب.")
    with get_connection() as conn:
        if template_id:
            conn.execute("UPDATE contract_templates SET name=?, body=? WHERE id=?",
                         (name.strip(), body, template_id))
            return template_id
        cur = conn.execute("INSERT INTO contract_templates (name, body) VALUES (?, ?)",
                           (name.strip(), body))
        return cur.lastrowid

def render_template(body: str, contract_id: int) -> str:
    from services import settings_service
    dash = contract_dashboard(contract_id)
    contract = dash["contract"]
    settings = settings_service.get_settings()
    tl = dash["timeline"]
    fields = {
        "اسم_الشركة": settings.company_name,
        "عنوان_الشركة": settings.company_address,
        "هاتف_الشركة": settings.company_phone,
        "اسم_العميل": contract["customer_name"],
        "رقم_العقد": contract["contract_number"],
        "اسم_العقد": contract.get("contract_name") or "",
        "تاريخ_العقد": contract["contract_date"],
        "اسم_المشروع": contract.get("project_name") or "",
        "قيمة_العقد": f"{dash['current_value']:,.3f}",
        "القيمة_الأصلية": f"{dash['original_value']:,.3f}",
        "العملة": contract.get("currency") or settings.currency,
        "تاريخ_البداية": contract.get("start_date") or "",
        "تاريخ_النهاية": contract.get("end_date") or "",
        "مدة_العقد": str(tl["duration"]),
        "وصف_العقد": contract.get("description") or "",
    }
    result = body
    for key, value in fields.items():
        result = result.replace("{{" + key + "}}", str(value))
    return result

# ============================================================
# تنبيهات التحصيل المتأخر
# ============================================================
def get_collection_alert_days() -> int:
    with get_connection() as conn:
        try:
            row = conn.execute("SELECT collection_alert_days FROM settings WHERE id=1").fetchone()
            return max(7, int(row[0] or 30)) if row else 30
        except Exception:
            return 30

def save_collection_alert_days(days: int) -> None:
    with get_connection() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(settings);")}
        if "collection_alert_days" not in cols:
            conn.execute("ALTER TABLE settings ADD COLUMN collection_alert_days INTEGER DEFAULT 30")
        conn.execute("UPDATE settings SET collection_alert_days=? WHERE id=1", (max(7, int(days)),))

def overdue_collections() -> list[dict]:
    from datetime import date, datetime
    alert_days = get_collection_alert_days()
    today = date.today()
    result = []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id, c.contract_number, c.contract_name, c.contract_date, "
            "       cu.name AS customer_name, c.amount, "
            "       COALESCE(a.net_addendum, 0) AS net_addendum, "
            "       COALESCE(v.collected, 0) AS collected, "
            "       v.last_receipt "
            "FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id "
            "LEFT JOIN (SELECT contract_id, "
            "                  SUM(amount_add - amount_deduct) AS net_addendum "
            "           FROM addendums WHERE status='معتمد' "
            "           GROUP BY contract_id) a ON a.contract_id = c.id "
            "LEFT JOIN (SELECT contract_id, SUM(amount) AS collected, "
            "                  MAX(vdate) AS last_receipt "
            "           FROM vouchers WHERE vtype='receipt' AND cancelled=0 "
            "           GROUP BY contract_id) v ON v.contract_id = c.id "
            "WHERE c.status NOT IN ('مغلق','ملغى','مسودة')").fetchall()
    for c in rows:
        current_value = float(c["amount"]) + float(c["net_addendum"])
        remaining = current_value - float(c["collected"])
        if remaining <= 0.001:
            continue
        ref_date = c["last_receipt"] or c["contract_date"]
        try:
            ref = datetime.strptime(ref_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        days_since = (today - ref).days
        if days_since >= alert_days:
            result.append({
                "contract_id": c["id"],
                "contract_number": c["contract_number"],
                "customer_name": c["customer_name"],
                "remaining": remaining,
                "last_receipt": c["last_receipt"],
                "days_since": days_since,
            })
    result.sort(key=lambda x: -x["days_since"])
    return result

# ============================================================
# أرشفة العقود المنتهية
# ============================================================
ARCHIVED_STATUSES = ("منتهي", "مغلق", "ملغى")

def auto_archive_expired() -> int:
    from datetime import date
    today = date.today().isoformat()
    try:
        from services import auth_service
        username = auth_service.current_username()
    except Exception:
        username = ""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, contract_number FROM contracts "
            "WHERE end_date != '' AND end_date < ? "
            "AND status IN ('نشط','معتمد')", (today,)).fetchall()
        if not rows:
            return 0
        ids = [(r["id"],) for r in rows]
        conn.executemany("UPDATE contracts SET status='منتهي' WHERE id=?", ids)
        conn.executemany(
            "INSERT INTO contract_events "
            "(contract_id, event_type, description, username) "
            "VALUES (?, 'انتهاء العقد', 'أرشفة تلقائية بانتهاء المدة', ?)",
            [(r["id"], username) for r in rows])
    return len(rows)

# ============================================================
# التقرير الشامل (شهري / سنوي)
# ============================================================
def period_summary(date_from: str, date_to: str) -> dict:
    with get_connection() as conn:
        customers = conn.execute("SELECT * FROM customers ORDER BY id").fetchall()
        rows = []
        totals = {"contracts": 0.0, "collected": 0.0, "paid": 0.0, "remaining": 0.0}
        for cu in customers:
            contracts_val = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM contracts "
                "WHERE customer_id=? AND status NOT IN ('ملغى') "
                "AND contract_date BETWEEN ? AND ?",
                (cu["id"], date_from, date_to)).fetchone()[0])
            contracts_val += float(conn.execute(
                "SELECT COALESCE(SUM(a.amount_add - a.amount_deduct),0) "
                "FROM addendums a JOIN contracts c ON c.id = a.contract_id "
                "WHERE c.customer_id=? AND a.status='معتمد' "
                "AND c.status NOT IN ('ملغى') "
                "AND a.adate BETWEEN ? AND ?",
                (cu["id"], date_from, date_to)).fetchone()[0])
            all_contracts_val = float(conn.execute(
                "SELECT COALESCE(SUM(amount),0) FROM contracts "
                "WHERE customer_id=? AND status NOT IN ('ملغى')",
                (cu["id"],)).fetchone()[0])
            all_contracts_val += float(conn.execute(
                "SELECT COALESCE(SUM(a.amount_add - a.amount_deduct),0) "
                "FROM addendums a JOIN contracts c ON c.id = a.contract_id "
                "WHERE c.customer_id=? AND a.status='معتمد' "
                "AND c.status NOT IN ('ملغى')",
                (cu["id"],)).fetchone()[0])
            collected = float(conn.execute(
                "SELECT COALESCE(SUM(v.amount),0) FROM vouchers v "
                "JOIN contracts c ON c.id = v.contract_id "
                "WHERE c.customer_id=? AND v.vtype='receipt' AND cancelled=0 AND v.cancelled=0 "
                "AND v.vdate BETWEEN ? AND ?",
                (cu["id"], date_from, date_to)).fetchone()[0])
            paid = float(conn.execute(
                "SELECT COALESCE(SUM(v.amount),0) FROM vouchers v "
                "JOIN contracts c ON c.id = v.contract_id "
                "WHERE c.customer_id=? AND v.vtype='payment' AND cancelled=0 AND v.cancelled=0 "
                "AND v.vdate BETWEEN ? AND ?",
                (cu["id"], date_from, date_to)).fetchone()[0])
            total_collected = float(conn.execute(
                "SELECT COALESCE(SUM(v.amount),0) FROM vouchers v "
                "JOIN contracts c ON c.id = v.contract_id "
                "WHERE c.customer_id=? AND v.vtype='receipt' AND cancelled=0 AND v.cancelled=0",
                (cu["id"],)).fetchone()[0])
            remaining = all_contracts_val - total_collected
            if contracts_val == 0 and collected == 0 and paid == 0 and remaining <= 0.001:
                continue
            rows.append({
                "customer_code": cu["customer_code"],
                "customer_name": cu["name"],
                "phone": cu["phone"] or "",
                "contracts_value": contracts_val,
                "collected": collected, "paid": paid, "remaining": remaining,
            })
            totals["contracts"] += contracts_val
            totals["collected"] += collected
            totals["paid"] += paid
            totals["remaining"] += remaining
    return {"rows": rows, "totals": totals, "date_from": date_from, "date_to": date_to}

# ============================================================
# خطة سداد العقد · الحالة تُحسب تلقائيًا من سندات القبض
# ============================================================
def add_plan_item(contract_id: int, title: str, due_date: str, amount: float) -> int:
    title = (title or "").strip()
    if not title:
        raise ValidationError("اسم الدفعة مطلوب (مثال: دفعة التوقيع).")
    if amount <= 0:
        raise ValidationError("قيمة الدفعة يجب أن تكون أكبر من صفر.")
    from datetime import datetime as _dt
    try:
        _dt.strptime(due_date, "%Y-%m-%d")
    except (ValueError, TypeError) as exc:
        raise ValidationError("تاريخ الاستحقاق غير صالح.") from exc
    value = contract_current_value(contract_id)
    with get_connection() as conn:
        planned = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM payment_plan WHERE contract_id=?", (contract_id,)).fetchone()[0])
    if planned + amount > value["current"] + 0.001:
        raise ValidationError(
            "مجموع أقساط الخطة يتجاوز قيمة العقد.\n"
            f"قيمة العقد: {value['current']:,.3f} · المجدول: {planned:,.3f} · "
            f"المتاح: {value['current'] - planned:,.3f}")
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO payment_plan (contract_id, title, due_date, amount, "
            "sort_order) VALUES (?, ?, ?, ?, "
            "(SELECT COALESCE(MAX(sort_order),0)+1 FROM payment_plan WHERE contract_id=?))",
            (contract_id, title, due_date, amount, contract_id))
        pid = cur.lastrowid
    log_event(contract_id, "إضافة دفعة مجدولة",
              f"{title} · {amount:,.3f} تستحق {due_date}")
    return pid


def update_plan_item(item_id: int, title: str, due_date: str, amount: float) -> None:
    """تعديل دفعة مجدولة بمرونة مع منع تجاوز قيمة العقد."""
    title = (title or "").strip()
    if not title:
        raise ValidationError("اسم الدفعة مطلوب.")
    if amount <= 0:
        raise ValidationError("قيمة الدفعة يجب أن تكون أكبر من صفر.")
    from datetime import datetime as _dt
    try:
        _dt.strptime(due_date, "%Y-%m-%d")
    except (ValueError, TypeError) as exc:
        raise ValidationError("تاريخ الاستحقاق غير صالح.") from exc
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM payment_plan WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise ValidationError("الدفعة غير موجودة.")
        value = contract_current_value(row["contract_id"])
        others = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM payment_plan WHERE contract_id=? AND id<>?",
            (row["contract_id"], item_id)).fetchone()[0])
        if others + amount > value["current"] + 0.001:
            raise ValidationError(
                "مجموع أقساط الخطة يتجاوز قيمة العقد.\n"
                f"قيمة العقد: {value['current']:,.3f} · باقي الدفعات: {others:,.3f} · "
                f"المتاح لهذه الدفعة: {value['current'] - others:,.3f}")
        conn.execute("UPDATE payment_plan SET title=?, due_date=?, amount=? WHERE id=?",
                     (title, due_date, amount, item_id))
    log_event(row["contract_id"], "تعديل دفعة مجدولة", f"{title} · {amount:,.3f} تستحق {due_date}")

def delete_plan_item(item_id: int) -> None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM payment_plan WHERE id=?", (item_id,)).fetchone()
        if not row:
            return
        conn.execute("DELETE FROM payment_plan WHERE id=?", (item_id,))
    log_event(row["contract_id"], "حذف دفعة مجدولة", row["title"])



def validate_plan_amount_overrides(contract_id: int, overrides: dict,
                                    against_value: float | None = None) -> float:
    """V3.11: فحص تجاوزات المبالغ بلا كتابة — يرجع المجموع.

    against_value: القيمة المراد الفحص مقابلها (الجديدة في الحقل) —
    تُستخدم قبل حفظ العقد لمنع الحفظ الجزئي. بلا كتابة إطلاقًا.
    """
    clean = {int(k): float(v or 0) for k, v in (overrides or {}).items()}
    clean = {k: v for k, v in clean.items() if v >= 0}
    if not clean:
        return 0.0
    value = (float(against_value) if against_value is not None
             else contract_current_value(contract_id)["current"])
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, title, due_date, amount, sort_order FROM payment_plan "
            "WHERE contract_id=? ORDER BY sort_order, id",
            (contract_id,)).fetchall()
    if not rows:
        return 0.0
    total = 0.0
    for r in rows:
        no = int(r["sort_order"] or 0)
        total += clean.get(no, float(r["amount"] or 0))
    if total > value + 0.001:
        raise ValidationError(
            f"مجموع الدفعات بعد التعديل ({total:,.3f}) أكبر من قيمة العقد ({value:,.3f}).")
    return round(total, 3)


_FALLBACK_PAY_TITLE = "دفعة كاملة عند بداية التعاقد"


def update_plan_amount_overrides(contract_id: int, overrides: dict[int, float]) -> None:
    """تطبيق مبالغ دفعات مخصصة عند إنشاء العقد.

    المفتاح هو رقم الدفعة/sort_order. يُستخدم عندما يراجع المستخدم
    معاينة الدفعات في شاشة إنشاء العقد ويعدّل قيمة دفعة لهذا العقد فقط.
    لا يغيّر قالب نوع العقد ولا شجرة المراحل.

    V3.11: يعلّم الصفوف المخالفة للقالب (manual_amount) فتحفظها المزامنة.
    V4.5.02: التجاوز لدفعة قالب بلا صف فعلي (المرنة تُتجاهل عند التوليد)
    يُنشئ صفها بدل ضياعه؛ وصف الأمان «الدفعة الكاملة» يُستبدل بالخطة
    الصريحة عندما يكون الصف الوحيد (السندات مربوطة بالعقد لا بالصف).
    """
    clean = {int(k): float(v or 0) for k, v in (overrides or {}).items()}
    clean = {k: v for k, v in clean.items() if v >= 0}
    if not clean:
        return
    with get_connection() as conn:
        crow = conn.execute(
            "SELECT contract_type, amount, COALESCE(NULLIF(start_date,''), "
            "NULLIF(contract_date,'')) AS d FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
        rows = [dict(r) for r in conn.execute(
            "SELECT id, title, amount, sort_order FROM payment_plan "
            "WHERE contract_id=? ORDER BY sort_order, id",
            (contract_id,)).fetchall()]
    if crow is None:
        return
    ctype = (crow["contract_type"] or "").strip()
    value = round(float(crow["amount"] or 0), 3)
    try:
        from services import workflow_service as _wf
        # V4.5.10: مفاتيح القالب تتبع الترقيم المتسلسل بعد النطاق (1..n)
        # كما في المعاينة وخطة العقد — وإلا انزاحت المبالغ المخصصة صفًا.
        _rows = _wf.scoped_plan_rows(contract_id, ctype, value)
        _tpl_full = {int(r["pay_no"]): r for r in _rows}
        _tpl = {no: round(float(r.get("amount") or 0), 3)
                for no, r in _tpl_full.items()}
    except Exception:
        _tpl_full = {}
        _tpl = {}
    _fb_ids = [int(r["id"]) for r in rows
               if (r.get("title") or "") == _FALLBACK_PAY_TITLE]
    _others = [r for r in rows if int(r["id"]) not in _fb_ids]
    _nos = {int(r["sort_order"] or 0) for r in rows}
    _will = {no: amt for no, amt in clean.items()
             if amt > 0 and no in _tpl_full and no not in _nos}
    if _will and _fb_ids and not _others:
        with get_connection() as conn:
            try:
                _linked = conn.execute(
                    "SELECT COUNT(*) FROM claims WHERE cust_line_id IN "
                    f"({','.join('?' * len(_fb_ids))})",
                    tuple(_fb_ids)).fetchone()[0]
            except Exception:
                _linked = 0
            if _linked:
                raise ValidationError(
                    f"لا يمكن استبدال خطة العقد: {_linked} مطالبة مرتبطة "
                    "بصف الدفعة الكاملة — انقلها/احذفها أولًا.")
            conn.execute(
                f"DELETE FROM payment_plan WHERE id IN "
                f"({','.join('?' * len(_fb_ids))})", tuple(_fb_ids))
        rows = []
        _nos = set()
        _will = {no: amt for no, amt in clean.items()
                 if amt > 0 and no in _tpl_full}
    _total = (sum(clean.get(int(r["sort_order"] or 0),
                            float(r["amount"] or 0)) for r in rows)
              + sum(_will.values()))
    if _total > value + 0.001:
        raise ValidationError(
            f"مجموع الدفعات بعد التعديل ({_total:,.3f}) أكبر من قيمة العقد "
            f"({value:,.3f}).")
    with get_connection() as conn:
        for r in rows:
            no = int(r["sort_order"] or 0)
            if no in clean:
                manual = 0 if (no in _tpl
                               and abs(_tpl[no] - clean[no]) < 0.001) else 1
                conn.execute("UPDATE payment_plan SET amount=?, manual_amount=? WHERE id=?",
                             (round(clean[no], 3), manual, r["id"]))
    if _will:
        from datetime import date as _date, timedelta as _td
        try:
            _base = _date.fromisoformat(
                (crow["d"] or _date.today().isoformat())[:10])
        except Exception:
            _base = _date.today()
        try:
            from services.workflow_service import (
                _template_to_contract_stage_map as _smap)
            _stmap = _smap(contract_id, ctype)
        except Exception:
            _stmap = {}
        with get_connection() as conn:
            _closed = {}
            if _stmap:
                _sids = sorted(set(_stmap.values()))
                for _r in conn.execute(
                        "SELECT id, name, COALESCE(end_date,'') AS e "
                        "FROM contract_stages WHERE id IN "
                        f"({','.join('?' * len(_sids))})", tuple(_sids)):
                    if (_r["e"] or "").strip():
                        _closed[int(_r["id"])] = ((_r["name"] or "—"),
                                                  (_r["e"] or "")[:10])
            _backfill_ids = []
            for no in sorted(_will):
                t = _tpl_full[no]
                _tt = t.get("trigger_stage_id")
                _sid = _stmap.get(int(_tt)) if _tt else None
                _due = (_base + _td(
                    days=int(t.get("days_offset") or 0))).isoformat()
                _trig = t.get("trigger_name") or t.get("stage_name") or ""
                _note = (f"مبلغ محدد لهذا العقد فقط "
                         f"({_will[no]:,.3f} د.ك)")
                if _trig:
                    _note += f" · استحقاق عن مرحلة «{_trig}»"
                _trig_at = ""
                if _sid in _closed:
                    # V4.5.03: تحفيز رجعي — الصف وُلد لمرحلة مغلقة أصلًا.
                    _nm, _ed = _closed[_sid]
                    _trig_at = _ed
                    _due = _ed
                    _note += (f" · مستحقة لانتهاء مرحلة «{_nm}» بتاريخ {_ed}")
                # V5.4 ⑦: عنوان الدفعة يتبع الترقيم الجديد (1,2,3) —
                # كان يحمل رقم القالب القديم («2. دفعة 3»).
                try:
                    from services.workflow_service import (
                        _plan_title_for as _ptitle7)
                    _title_new = _ptitle7(no, t)
                except Exception:
                    _title_new = f"{no}. {t['title']}"
                cur = conn.execute(
                    "INSERT INTO payment_plan (contract_id, title, due_date, "
                    "amount, sort_order, stage_id, notes, triggered_at, "
                    "manual_amount) VALUES (?,?,?,?,?,?,?,?,1)",
                    (contract_id, _title_new, _due,
                     round(_will[no], 3), no, _sid, _note, _trig_at))
                if _trig_at:
                    _backfill_ids.append(int(cur.lastrowid))
        if _backfill_ids:
            try:
                from services.workflow_service import _fire_auto_claims
                _fire_auto_claims(_backfill_ids, "cust")
            except Exception:
                pass


def rescale_payment_plan(contract_id: int, target: float) -> int:
    """V3.2 (ج): توزيع نسبي لخطة عقد على مبلغ (الأخيرة تمتص الكسور).

    تحديث مباشر على id (مفاتيح sort_order قد تتصادم في خطط قديمة).
    """
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, amount FROM payment_plan WHERE contract_id=? "
            "ORDER BY due_date, sort_order, id", (contract_id,)).fetchall()]
    total = round(sum(float(x.get("amount") or 0) for x in rows), 3)
    if not rows or total <= 0:
        return 0
    target = round(float(target or 0), 3)
    if target <= 0:
        raise ValidationError("المبلغ المستهدف يجب أن يكون أكبر من صفر.")
    new_amounts: list[float] = []
    acc = 0.0
    for i, x in enumerate(rows):
        if i < len(rows) - 1:
            new = round(float(x.get("amount") or 0) / total * target, 3)
            acc = round(acc + new, 3)
        else:
            new = round(target - acc, 3)
        if new <= 0:
            raise ValidationError("التوزيع النسبي أنتج دفعة صفرية — "
                                  "راجع الخطة يدويًا.")
        new_amounts.append(new)
    with get_connection() as conn:
        for x, new in zip(rows, new_amounts):
            conn.execute("UPDATE payment_plan SET amount=? WHERE id=?",
                         (new, x["id"]))
    log_event(contract_id, "إعادة توزيع الدفعات",
              f"توزيع نسبي على {target:,.3f} ({len(rows)} دفعات)")
    return len(rows)


def contract_payment_plan(contract_id: int) -> list[dict]:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("contract_payment_plan", contract_id),
                lambda: _contract_payment_plan_impl(contract_id))


def _contract_payment_plan_impl(contract_id: int,
                                 exclude_voucher: int | None = None
                                 ) -> list[dict]:
    from datetime import date as _date, datetime as _dt
    _ex = int(exclude_voucher or 0)
    with get_connection() as conn:
        items = [dict(r) for r in conn.execute(
            "SELECT pp.*, COALESCE(cs.is_skipped,0) AS linked_stage_skipped, "
            "cs.name AS stage_name "
            "FROM payment_plan pp "
            "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
            "WHERE pp.contract_id=? "
            "ORDER BY pp.due_date, pp.sort_order", (contract_id,)).fetchall()]
        collected = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation = '')"
            + (" AND id<>?" if _ex else ""),
            (contract_id, _ex) if _ex else (contract_id,)).fetchone()[0])
        # V6.2: المبالغ الموجّهة صراحةً لدفعات بعينها (ربط السند بخط)
        _links = {int(r["line_id"]): float(r["amt"] or 0) for r in conn.execute(
            "SELECT l.line_id AS line_id, COALESCE(SUM(l.amount),0) AS amt "
            "FROM voucher_payment_links l JOIN vouchers v ON v.id=l.voucher_id "
            "JOIN payment_plan pp ON pp.id=l.line_id "
            "WHERE l.kind='receipt' AND COALESCE(v.cancelled,0)=0 "
            "AND COALESCE(v.allocation,'')='' AND pp.contract_id=?"
            + (" AND v.id<>?" if _ex else "")
            + " GROUP BY l.line_id",
            (contract_id, _ex) if _ex else (contract_id,)).fetchall()}
    today = _date.today()
    remaining_pool = max(0.0, collected - sum(_links.values()))
    for item in items:
        covered = min(remaining_pool, item["amount"])
        remaining_pool -= covered
        _lk = min(_links.get(int(item["id"]), 0.0),
                  max(0.0, item["amount"] - covered))
        covered += _lk
        item["covered"] = covered
        item["remaining"] = item["amount"] - covered
        stage_linked = bool(item.get("stage_id"))
        triggered = bool((item.get("triggered_at") or "").strip())
        try:
            due = _dt.strptime(item["due_date"], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            due = today
        if stage_linked and int(item.get("linked_stage_skipped") or 0):
            item["days_diff"] = 999999
            item["status"] = "مرحلة متخطاة"
            if not (item.get("notes") or "").strip():
                item["notes"] = "غير مستحقة لأن المرحلة المرتبطة تم تخطيها"
            continue
        # لو الدفعة مربوطة بمرحلة فهي لا تُعتبر مستحقة في التقارير إلا بعد إنهاء المرحلة.
        if stage_linked and not triggered and item["remaining"] > 0.001:
            item["days_diff"] = 999999
            item["status"] = "بانتظار إنجاز المرحلة"
            continue
        item["days_diff"] = (due - today).days
        if item["remaining"] <= 0.001:
            item["status"] = "مدفوع"
        elif covered > 0.001:
            item["status"] = "جزئي" if due >= today else "متأخر"
        elif due < today:
            item["status"] = "متأخر"
        elif triggered:
            # V4.5.03: المثارة غير المدفوعة وحلّ أجلها = «مستحقة».
            item["status"] = "مستحقة"
        elif (due - today).days <= 7:
            item["status"] = "مستحق قريبًا"
        else:
            item["status"] = "لم يحل"
    return items

def overdue_plan_items(strict: bool = False) -> list[dict]:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("overdue_plan_items", bool(strict)),
                lambda: _overdue_plan_items_impl(strict=bool(strict)))


def contract_payment_plan_excluding(contract_id: int,
                                    exclude_voucher: int) -> list[dict]:
    """V6.2: خطة العميل مع استبعاد سند واحد (لحساب المستحق قبل ربطه)."""
    return _contract_payment_plan_impl(contract_id,
                                        exclude_voucher=exclude_voucher)


def sub_payment_plan_excluding(sub_contract_id: int,
                               exclude_voucher: int) -> list[dict]:
    """V6.2: خطة عقد الباطن مع استبعاد سند واحد."""
    return _sub_payment_plan_impl(sub_contract_id,
                                  exclude_voucher=exclude_voucher)


def _overdue_plan_items_impl(strict: bool = False) -> list[dict]:
    """الدفعات المتأخرة أو المستحقة خلال 7 أيام لكل العقود.

    strict=True (V4.3): «المستحق الآن» فقط — ما حلّ أجله فعلًا
    (الاستحقاق اليوم أو قبله)، بلا نافذة الأيام السبعة.

    الأداء: كانت الدالة تنادي ``contract_payment_plan`` داخل حلقة لكل
    عقد (استعلامان + اتصال لكل عقد) — على 700 عقد كان ذلك ~1400
    استعلام و700 فتح اتصال، وهو أثقل ما في الشاشة الرئيسية على قاعدة
    الشبكة. الآن: ثلاثة استعلامات تجميعية ثم نفس الحسابات في الذاكرة،
    بنفس منطق ``contract_payment_plan`` حرفيًا.
    """
    from datetime import date as _date, datetime as _dt
    with get_connection() as conn:
        contracts = {int(r["contract_id"]): dict(r) for r in conn.execute(
            "SELECT DISTINCT pp.contract_id, c.contract_number, "
            "cu.name AS customer_name FROM payment_plan pp "
            "JOIN contracts c ON c.id = pp.contract_id "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE c.status NOT IN ('مغلق','ملغى')").fetchall()}
        if not contracts:
            return []
        plan_rows = [dict(r) for r in conn.execute(
            "SELECT pp.*, COALESCE(cs.is_skipped,0) AS linked_stage_skipped "
            "FROM payment_plan pp "
            "LEFT JOIN contract_stages cs ON cs.id = pp.stage_id "
            "ORDER BY pp.contract_id, pp.due_date, pp.sort_order").fetchall()]
        collected_map = {int(r["contract_id"]): float(r["amt"] or 0)
                         for r in conn.execute(
                             "SELECT contract_id, COALESCE(SUM(amount),0) AS amt "
                             "FROM vouchers WHERE vtype='receipt' AND cancelled=0 "
                             "AND (allocation IS NULL OR allocation='') "
                             "AND contract_id IS NOT NULL "
                             "GROUP BY contract_id").fetchall()}
        # V6.2: المبالغ الموجّهة لدفعات بعينها — تُخصم من التوزيع التسلسلي
        linked_map = {int(r["contract_id"]): float(r["amt"] or 0)
                      for r in conn.execute(
                          "SELECT pp.contract_id AS contract_id, "
                          "COALESCE(SUM(l.amount),0) AS amt "
                          "FROM voucher_payment_links l "
                          "JOIN vouchers v ON v.id=l.voucher_id "
                          "JOIN payment_plan pp ON pp.id=l.line_id "
                          "WHERE l.kind='receipt' AND "
                          "COALESCE(v.cancelled,0)=0 AND "
                          "COALESCE(v.allocation,'')='' "
                          "GROUP BY pp.contract_id").fetchall()}
        linked_lines = {int(r["line_id"]): float(r["amt"] or 0)
                        for r in conn.execute(
                            "SELECT l.line_id AS line_id, "
                            "COALESCE(SUM(l.amount),0) AS amt "
                            "FROM voucher_payment_links l "
                            "JOIN vouchers v ON v.id=l.voucher_id "
                            "WHERE l.kind='receipt' AND "
                            "COALESCE(v.cancelled,0)=0 AND "
                            "COALESCE(v.allocation,'')='' "
                            "GROUP BY l.line_id").fetchall()}

    by_contract: dict[int, list] = {}
    for r in plan_rows:
        cid = int(r.get("contract_id") or 0)
        if cid in contracts:
            by_contract.setdefault(cid, []).append(r)

    today = _date.today()
    result = []
    for cid, items in by_contract.items():
        con = contracts[cid]
        remaining_pool = max(0.0, collected_map.get(cid, 0.0)
                             - linked_map.get(cid, 0.0))
        for item in items:
            covered = min(remaining_pool, item["amount"])
            remaining_pool -= covered
            covered += min(linked_lines.get(int(item["id"]), 0.0),
                           max(0.0, item["amount"] - covered))
            remaining = item["amount"] - covered
            stage_linked = bool(item.get("stage_id"))
            triggered = bool((item.get("triggered_at") or "").strip())
            # نفس استثناءات contract_payment_plan: المرحلة المتخطاة
            # والدفعة المعلّقة على إنجاز مرحلة لا تُعدّان مستحقتين.
            if stage_linked and int(item.get("linked_stage_skipped") or 0):
                continue
            if stage_linked and not triggered and remaining > 0.001:
                continue
            try:
                due = _dt.strptime(item["due_date"], "%Y-%m-%d").date()
            except (ValueError, TypeError):
                due = today
            days_diff = (due - today).days
            # V4.3 الصارم: ما حلّ أجله فعلًا فقط (اليوم أو قبله).
            if remaining <= 0.001:
                continue
            if strict and days_diff > 0:
                continue
            if not strict and days_diff > 7:
                continue
            if covered > 0.001:
                status = "جزئي" if due >= today else "متأخر"
            elif due < today:
                status = "متأخر"
            else:
                status = "مستحق قريبًا"
            result.append({
                "contract_id": cid,
                "contract_number": con["contract_number"],
                "customer_name": con["customer_name"],
                "title": item["title"],
                "due_date": item["due_date"],
                "remaining": remaining,
                "days_diff": days_diff,
                "status": status,
            })
    result.sort(key=lambda x: x["days_diff"])
    return result

# ============================================================
# الدمج: مشروع تلقائي لكل عقد + تحليل على مستوى العقد
# ============================================================
def ensure_auto_project(contract_id: int) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT project_id, customer_id, contract_number, "
            "contract_name, description FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        if row["project_id"]:
            return row["project_id"]
    name = (row["contract_name"] or row["description"]
            or f"عقد {row['contract_number']}").strip()
    pid = add_project(next_project_code(), name[:60], row["customer_id"],
                      f"مشروع تلقائي للعقد {row['contract_number']}")
    with get_connection() as conn:
        conn.execute("UPDATE contracts SET project_id=? WHERE id=?", (pid, contract_id))
    return pid

def sync_auto_project(contract_id: int) -> None:
    """اسم المشروع التلقائي = اسم العقد (يتبعه بعد أي تعديل)."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT c.project_id, c.contract_number, c.contract_name, "
            "c.description AS cdesc, p.name AS pname, "
            "p.description AS pdesc "
            "FROM contracts c LEFT JOIN projects p ON p.id = c.project_id "
            "WHERE c.id=?", (contract_id,)).fetchone()
        if not row or not row["project_id"]:
            return
        # لا نلمس مشروعًا أنشأه المستخدم يدويًا — التلقائي فقط
        if not (row["pdesc"] or "").startswith("مشروع تلقائي للعقد"):
            return
        name = (row["contract_name"] or row["cdesc"]
                or f"عقد {row['contract_number']}").strip()[:60]
        if name and name != row["pname"]:
            conn.execute("UPDATE projects SET name=? WHERE id=?",
                         (name, row["project_id"]))

def backfill_auto_projects() -> int:
    with get_connection() as conn:
        ids = [int(r[0]) for r in conn.execute(
            "SELECT id FROM contracts WHERE project_id IS NULL")]
    for contract_id in ids:
        try:
            ensure_auto_project(contract_id)
        except Exception:
            continue
    return len(ids)

def contract_analytics(contract_id: int) -> dict:
    with get_connection() as conn:
        expense_by_party = [dict(r) for r in conn.execute(
            "SELECT party, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt "
            "FROM vouchers WHERE contract_id=? AND vtype='payment' AND cancelled=0 "
            "GROUP BY party ORDER BY total DESC", (contract_id,)).fetchall()]
        monthly = [dict(r) for r in conn.execute(
            "SELECT SUBSTR(vdate, 1, 7) AS month, "
            "SUM(CASE WHEN vtype='receipt' AND cancelled=0 THEN amount ELSE 0 END) AS income, "
            "SUM(CASE WHEN vtype='payment' AND cancelled=0 THEN amount ELSE 0 END) AS expense "
            "FROM vouchers WHERE contract_id=? "
            "GROUP BY month ORDER BY month", (contract_id,)).fetchall()]
    return {"expense_by_party": expense_by_party, "monthly": monthly}

def customer_financial_summary(customer_id: int) -> dict:
    with get_connection() as conn:
        contracts_total = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM contracts "
            "WHERE customer_id=? AND status NOT IN ('ملغى')", (customer_id,)).fetchone()[0])
        collected = float(conn.execute(
            "SELECT COALESCE(SUM(v.amount),0) FROM vouchers v "
            "JOIN contracts c ON c.id = v.contract_id "
            "WHERE c.customer_id=? AND v.vtype='receipt' AND cancelled=0 AND v.cancelled=0",
            (customer_id,)).fetchone()[0])
        addendums = float(conn.execute(
            "SELECT COALESCE(SUM(a.amount_add - a.amount_deduct),0) "
            "FROM addendums a JOIN contracts c ON c.id = a.contract_id "
            "WHERE c.customer_id=? AND a.status='معتمد' "
            "AND c.status NOT IN ('ملغى')", (customer_id,)).fetchone()[0])
    total = contracts_total + addendums
    return {"total": total, "collected": collected, "remaining": total - collected}

def customer_contracts_summary(customer_id: int) -> dict:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("customer_contracts_summary", customer_id),
                lambda: _customer_contracts_summary_impl(customer_id))


def _customer_contracts_summary_impl(customer_id: int) -> dict:
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT c.*, p.name AS project_name "
            "FROM contracts c LEFT JOIN projects p ON p.id = c.project_id "
            "WHERE c.customer_id=? ORDER BY c.id DESC", (customer_id,)).fetchall()]
        addendums_map: dict[int, float] = {}
        for r in conn.execute(
                "SELECT a.contract_id AS cid, "
                "COALESCE(SUM(a.amount_add - a.amount_deduct),0) AS net "
                "FROM addendums a JOIN contracts c ON c.id = a.contract_id "
                "WHERE c.customer_id=? AND a.status='معتمد' "
                "GROUP BY a.contract_id", (customer_id,)).fetchall():
            addendums_map[r["cid"]] = float(r["net"])
        collected_map: dict[int, float] = {}
        for r in conn.execute(
                "SELECT v.contract_id AS cid, COALESCE(SUM(v.amount),0) AS s "
                "FROM vouchers v JOIN contracts c ON c.id = v.contract_id "
                "WHERE c.customer_id=? AND v.vtype='receipt' AND v.cancelled=0 "
                "GROUP BY v.contract_id", (customer_id,)).fetchall():
            collected_map[r["cid"]] = float(r["s"])
        paid_map: dict[int, float] = {}
        for r in conn.execute(
                "SELECT v.contract_id AS cid, COALESCE(SUM(v.amount),0) AS s "
                "FROM vouchers v JOIN contracts c ON c.id = v.contract_id "
                "WHERE c.customer_id=? AND v.vtype='payment' AND v.cancelled=0 "
                "GROUP BY v.contract_id", (customer_id,)).fetchall():
            paid_map[r["cid"]] = float(r["s"])

    sup_ext_map: dict[int, dict] = {}
    try:
        from services.supervision_service import extensions_map
        sup_ext_map = extensions_map()
    except Exception:
        sup_ext_map = {}

    overdue_map: dict[int, dict] = {}
    for row in rows:
        if (row.get("status") or "نشط") in ("مغلق", "ملغى"):
            continue
        try:
            for item in contract_payment_plan(row["id"]):
                if item["remaining"] > 0.001 and item["days_diff"] < 0:
                    late = -int(item["days_diff"])
                    current = overdue_map.get(row["id"])
                    if current is None or late > current["days_late"]:
                        overdue_map[row["id"]] = {
                            "days_late": late, "title": item["title"], "amount": item["remaining"],
                        }
        except Exception:
            continue

    contracts = []
    t_current = t_collected = t_paid = 0.0
    for row in rows:
        cid = row["id"]
        original = float(row.get("amount") or 0.0)
        net_add = addendums_map.get(cid, 0.0)
        sup_ext = float(sup_ext_map.get(cid, {}).get("extension_value", 0.0))
        current = original + net_add + sup_ext
        collected = collected_map.get(cid, 0.0)
        paid = paid_map.get(cid, 0.0)
        status = row.get("status") or "نشط"
        contracts.append({
            "id": cid, "contract_number": row.get("contract_number") or "",
            "name": (row.get("contract_name") or row.get("description") or ""),
            "contract_type": row.get("contract_type") or "",
            "project_name": row.get("project_name") or "",
            "status": status, "start_date": row.get("start_date") or "",
            "end_date": row.get("end_date") or "", "original": original,
            "addendums_net": net_add, "sup_extension": sup_ext, "current": current,
            "collected": collected, "remaining": current - collected,
            "paid": paid,
            "percent": (collected / current * 100.0) if current > 0.001 else 0.0,
            "is_supervision": cid in sup_ext_map,
            "has_overdue": cid in overdue_map,
            "overdue_days": overdue_map.get(cid, {}).get("days_late", 0),
            "overdue_title": overdue_map.get(cid, {}).get("title", ""),
        })
        if status != "ملغى":
            t_current += current
            t_collected += collected
            t_paid += paid

    active = sum(1 for c in contracts if c["status"] == "نشط")
    overdue_contracts = [c for c in contracts if c["has_overdue"]]
    return {
        "contracts": contracts,
        "totals": {
            "count": len(contracts), "active": active,
            "overdue_count": len(overdue_contracts),
            "overdue_days": max((c["overdue_days"] for c in overdue_contracts), default=0),
            "current": t_current, "collected": t_collected,
            "remaining": t_current - t_collected, "paid": t_paid,
        },
    }

def customer_movements(customer_id: int) -> list[dict]:
    with get_connection() as conn:
        vouchers = [dict(r) for r in conn.execute(
            "SELECT v.id, v.voucher_number AS ref, v.vtype, v.vdate AS d, "
            "v.amount, v.description AS descr, v.method, v.cancelled, "
            "v.cheque_due_date, c.contract_number, "
            "COALESCE(NULLIF(c.contract_name,''), c.description) AS contract_label "
            "FROM vouchers v LEFT JOIN contracts c ON c.id = v.contract_id "
            "WHERE c.customer_id=? OR (v.party_type='customer' AND v.party_id=?) "
            "ORDER BY v.vdate DESC, v.id DESC", (customer_id, customer_id)).fetchall()]
        invoices = [dict(r) for r in conn.execute(
            "SELECT i.id, i.invoice_number AS ref, i.invoice_date AS d, "
            "i.amount, i.description AS descr, "
            "COALESCE(NULLIF(c.contract_name,''), c.description) AS contract_label "
            "FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id "
            "WHERE i.customer_id=?", (customer_id,)).fetchall()]
    rows = []
    for v in vouchers:
        rows.append({
            "kind": "سند قبض" if v["vtype"] == "receipt" else "سند صرف",
            "vtype": v["vtype"], "ref": v["ref"], "date": v["d"] or "",
            "amount": float(v["amount"] or 0.0), "descr": v["descr"] or "",
            "contract": v["contract_label"] or "",
            "method": v.get("method") or "",
            "cheque_due_date": v.get("cheque_due_date") or "",
            "cancelled": bool(v.get("cancelled")),
        })
    for i in invoices:
        rows.append({
            "kind": "فاتورة", "vtype": "invoice", "ref": i["ref"],
            "date": i["d"] or "", "amount": float(i["amount"] or 0.0),
            "descr": i["descr"] or "", "contract": i["contract_label"] or "",
            "method": "", "cheque_due_date": "", "cancelled": False,
        })
    rows.sort(key=lambda r: (r["date"], r["ref"]), reverse=True)
    return rows

def customer_alerts(customer_id: int) -> list[dict]:
    from datetime import date, datetime
    alerts: list[dict] = []
    summary = customer_contracts_summary(customer_id)
    today = date.today()

    for con in summary["contracts"]:
        if con["status"] in ("ملغى", "مغلق"):
            continue
        try:
            for item in contract_payment_plan(con["id"]):
                if item["status"] == "متأخر" and item["remaining"] > 0.001:
                    alerts.append({
                        "level": "danger", "contract_id": con["id"], "page": "plan",
                        "text": f"دفعة متأخرة على «{con['name']}»: "
                                f"{item['title']} · المتبقي منها "
                                f"{item['remaining']:,.3f} "
                                f"(استحقت {item['due_date']})"})
        except Exception:
            pass
        end = con.get("end_date") or ""
        if end:
            try:
                days = (datetime.strptime(end, "%Y-%m-%d").date() - today).days
                if 0 <= days <= 30:
                    alerts.append({
                        "level": "warn", "contract_id": con["id"], "page": "dashboard",
                        "text": f"عقد «{con['name']}» ينتهي خلال {days} يومًا ({end})"})
                elif days < 0 and con["remaining"] > 0.001:
                    alerts.append({
                        "level": "warn", "contract_id": con["id"], "page": "money",
                        "text": f"عقد «{con['name']}» انتهت مدته ولم يكتمل تحصيله · المتبقي {con['remaining']:,.3f}"})
            except ValueError:
                pass
        if con.get("is_supervision") and con.get("sup_extension", 0) > 0.001:
            alerts.append({
                "level": "warn", "contract_id": con["id"], "page": "dashboard",
                "text": f"عقد الإشراف «{con['name']}» دخل التمديد · قيمة التمديد المستحقة {con['sup_extension']:,.3f}"})

    try:
        from services.extras_service import due_cheques
        numbers = {c["contract_number"] for c in summary["contracts"]}
        for ch in due_cheques(14):
            if ch.get("contract_number") in numbers:
                when = ("حلّ استحقاقه" if ch["days_left"] < 0 else f"خلال {ch['days_left']} يوم")
                alerts.append({
                    "level": "info", "contract_id": None, "page": "money",
                    "text": f"شيك بمبلغ {float(ch['amount']):,.3f} {when} ({ch['cheque_due_date']})"})
    except Exception:
        pass
    return alerts

def recent_activity(limit: int = 12) -> list[dict]:
    limit = max(1, min(50, int(limit)))
    items: list[dict] = []
    with get_connection() as conn:
        events = conn.execute(
            "SELECT e.event_time, e.event_type, e.description, "
            "c.id AS contract_id, c.contract_number, "
            "COALESCE(NULLIF(c.contract_name,''), c.description) AS label, "
            "cu.id AS customer_id, cu.name AS customer_name "
            "FROM contract_events e "
            "JOIN contracts c ON c.id = e.contract_id "
            "LEFT JOIN customers cu ON cu.id = c.customer_id "
            "ORDER BY e.event_time DESC, e.id DESC LIMIT ?", (limit,)).fetchall()
        vouchers = conn.execute(
            "SELECT v.created_at, v.vdate, v.vtype, v.amount, "
            "v.voucher_number, v.description, v.cancelled, "
            "c.id AS contract_id, c.contract_number, "
            "COALESCE(NULLIF(c.contract_name,''), c.description) AS label, "
            "cu.id AS customer_id, cu.name AS customer_name "
            "FROM vouchers v "
            "LEFT JOIN contracts c ON c.id = v.contract_id "
            "LEFT JOIN customers cu ON cu.id = c.customer_id "
            "WHERE v.cancelled = 0 "
            "ORDER BY COALESCE(NULLIF(v.created_at,''), v.vdate) DESC, "
            "v.id DESC LIMIT ?", (limit,)).fetchall()

    for row in events:
        data = dict(row)
        if data["event_type"] in ("إنشاء سند قبض", "إنشاء سند صرف"):
            continue
        items.append({
            "when": data["event_time"] or "", "kind": data["event_type"] or "حدث",
            "text": data["description"] or "", "amount": 0.0, "sign": 0,
            "contract_id": data["contract_id"], "contract_number": data["contract_number"] or "",
            "contract_label": data["label"] or "", "customer_id": data["customer_id"],
            "customer_name": data["customer_name"] or "",
        })
    for row in vouchers:
        data = dict(row)
        is_in = data["vtype"] == "receipt"
        items.append({
            "when": (data["created_at"] or data["vdate"] or ""),
            "kind": "سند قبض" if is_in else "سند صرف",
            "text": data["description"] or "", "amount": float(data["amount"] or 0.0),
            "sign": 1 if is_in else -1, "contract_id": data["contract_id"],
            "contract_number": data["contract_number"] or "", "contract_label": data["label"] or "",
            "customer_id": data["customer_id"], "customer_name": data["customer_name"] or "",
        })
    items.sort(key=lambda x: x["when"], reverse=True)
    return items[:limit]
# ============================================================
# ترحيل V4.32 لمرة واحدة: حذف المصروف الدوري نهائيًا (شامل)
# ============================================================
def recurring_purge_pending() -> bool:
    """هل توجد بقايا مصروف دوري تحتاج الترحيل؟ (لفحص ما قبل النسخة)."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' "
            "AND name='recurring_expenses'").fetchone()
    return row is not None


def purge_recurring_feature() -> dict:
    """حذف شامل لمرة واحدة: التعريفات + السندات المولّدة آليًا فقط.

    تُحذف السندات التي تحمل بصمة التوليد («مصروف دوري» في البيان)
    مع قيودها — أي سند يدوي (حتى لو طرفه نصًا «مصروف دوري») يبقى.
    ثم يُسقط جدول التعريفات. آمنة التكرار: بلا جدول = بلا عمل.
    تُستدعى من بدء التشغيل بعد النسخة الاحتياطية مباشرة.
    """
    with get_connection() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    if "recurring_expenses" not in tables:
        return {"defs": 0, "vouchers": 0, "done": False}
    with get_connection() as conn:
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM vouchers "
            "WHERE COALESCE(description,'') LIKE '%مصروف دوري%'")]
        if "journal_entries" in tables:
            for vid in ids:
                conn.execute(
                    "DELETE FROM journal_entries "
                    "WHERE source_type LIKE 'voucher_%' "
                    "AND source_id=?", (vid,))
        conn.execute(
            "DELETE FROM vouchers "
            "WHERE COALESCE(description,'') LIKE '%مصروف دوري%'")
        defs = conn.execute(
            "SELECT COUNT(*) FROM recurring_expenses").fetchone()[0]
        conn.execute("DROP TABLE recurring_expenses")
    return {"defs": int(defs or 0), "vouchers": len(ids), "done": True}
