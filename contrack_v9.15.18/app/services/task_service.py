# -*- coding: utf-8 -*-
"""قائمة المهام: يدوية أو محوّلة من تنبيهات النظام.

- المهمة: عنوان + تفاصيل + تاريخ ووقت استحقاق + تذكير قبلها بدقائق
- تنبيه قبل الموعد (مرة واحدة) وتنبيه بعد الموعد إذا لم تُتم (مرة واحدة)
- زر إتمام يقفل المهمة
"""
import os
import re
from datetime import datetime

from database.database import get_connection
from services.customer_service import ValidationError

STATUS_OPEN = "مفتوحة"
STATUS_DONE = "منجزة"
_FMT = "%Y-%m-%d %H:%M"


def format_due_at(due_at: str) -> dict:
    """عرض احترافي لتاريخ/وقت المهمة مع بقاء التخزين بصيغة موحدة."""
    try:
        dt = datetime.strptime(due_at or "", _FMT)
    except (ValueError, TypeError):
        return {"date": due_at or "", "time": "", "text": due_at or ""}
    hour = dt.strftime("%I:%M").lstrip("0")
    period = "ص" if dt.hour < 12 else "م"
    date_txt = dt.strftime("%d-%m-%Y")
    return {"date": date_txt, "time": f"{hour} {period}",
            "text": f"{date_txt}  ·  {hour} {period}"}


def _validate_links(customer_id, contract_id):
    """الفلترة الذكية: العقد المرتبط يجب أن يخص العميل المرتبط."""
    if contract_id:
        with get_connection() as conn:
            row = conn.execute("SELECT customer_id FROM contracts WHERE id=?",
                               (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد المحدد غير موجود.")
        if customer_id and row["customer_id"] != customer_id:
            raise ValidationError("العقد المحدد لا يخص هذا العميل.")


def add_task(title: str, due_at: str, details: str = "",
             remind_minutes: int = 30, source: str = "يدوية",
             customer_id: int | None = None,
             contract_id: int | None = None,
             task_type: str = "تذكير") -> int:
    title = (title or "").strip()
    if not title:
        raise ValidationError("عنوان المهمة مطلوب.")
    try:
        datetime.strptime(due_at, _FMT)
    except (ValueError, TypeError):
        raise ValidationError("تاريخ ووقت المهمة غير صحيح.")
    _validate_links(customer_id, contract_id)
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (title, details, due_at, remind_minutes, "
            "source, customer_id, contract_id, task_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (title, (details or "").strip(), due_at,
             max(0, int(remind_minutes)), source, customer_id, contract_id,
             task_type if task_type in ("موعد", "تذكير") else "تذكير"))
        tid = cur.lastrowid
    # أرشفة المهمة في ملف العميل (يُنشأ إن لم يوجد)
    if customer_id:
        try:
            _archive_task(customer_id, tid, title, due_at,
                          (details or "").strip(), contract_id, task_type)
        except Exception:
            pass
    return tid


def _archive_task(customer_id: int, task_id: int, title: str,
                  due_at: str, details: str, contract_id,
                  task_type: str = "تذكير") -> None:
    """حفظ سجل المهمة كملف نصي في أرشيف العميل — كل ما يخصه في ملفه."""
    import io
    from services import customer_service
    from services.archive_service import get_customer_folder
    cust = customer_service.get_customer(customer_id)
    if not cust:
        return
    folder = get_customer_folder(cust)
    safe = re.sub(r'[\\/:*?"<>|]', "_", title).strip()[:40] or "مهمة"
    date_part = (due_at or "")[:10]
    path = os.path.join(folder, f"مهمة_{date_part}_{safe}.txt")
    con = ""
    if contract_id:
        try:
            from services.extras_service import contract_label
            con = contract_label(contract_id)
        except Exception:
            con = ""
    lines = [f"[{task_type or 'تذكير'}] مهمة رقم {task_id}: {title}",
             f"الموعد: {due_at}",
             f"العميل: {cust.name}"]
    if con:
        lines.append(f"العقد: {con}")
    if details:
        lines.append(f"التفاصيل: {details}")
    lines.append(f"أُنشئت: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    with io.open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def update_task(task_id: int, title: str, due_at: str, details: str = "",
                remind_minutes: int = 30,
                customer_id: int | None = None,
                contract_id: int | None = None,
                task_type: str = "تذكير") -> None:
    title = (title or "").strip()
    if not title:
        raise ValidationError("عنوان المهمة مطلوب.")
    try:
        datetime.strptime(due_at, _FMT)
    except (ValueError, TypeError):
        raise ValidationError("تاريخ ووقت المهمة غير صحيح.")
    _validate_links(customer_id, contract_id)
    with get_connection() as conn:
        conn.execute(
            "UPDATE tasks SET title=?, details=?, due_at=?, "
            "remind_minutes=?, customer_id=?, contract_id=?, task_type=?, "
            "notified_before=0, notified_after=0 WHERE id=?",
            (title, (details or "").strip(), due_at,
             max(0, int(remind_minutes)), customer_id, contract_id,
             task_type if task_type in ("موعد", "تذكير") else "تذكير", task_id))


def complete_task(task_id: int) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE tasks SET status=?, done_at=datetime('now', 'localtime') "
            "WHERE id=?", (STATUS_DONE, task_id))


def reopen_task(task_id: int) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE tasks SET status=?, done_at='', notified_before=0, "
            "notified_after=0 WHERE id=?", (STATUS_OPEN, task_id))


def delete_task(task_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))


def _decorate_tasks(rows: list[dict]) -> list[dict]:
    now = datetime.now()
    for t in rows:
        try:
            due = datetime.strptime(t["due_at"], _FMT)
            t["overdue"] = (t["status"] == STATUS_OPEN and due < now)
            t["minutes_left"] = int((due - now).total_seconds() // 60)
        except (ValueError, TypeError):
            t["overdue"] = False
            t["minutes_left"] = 0
    return rows


def list_tasks(include_done: bool = True, limit: int | None = None) -> list[dict]:
    sql = ("SELECT t.*, cu.name AS customer_name, c.contract_number "
           "FROM tasks t "
           "LEFT JOIN customers cu ON cu.id = t.customer_id "
           "LEFT JOIN contracts c ON c.id = t.contract_id")
    params: list = []
    if not include_done:
        sql += " WHERE t.status = ?"
        params.append(STATUS_OPEN)
    sql += " ORDER BY t.status DESC, t.due_at"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(max(1, int(limit)))
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    return _decorate_tasks(rows)


def list_customer_tasks(customer_id: int, contract_ids: list[int] | None = None,
                        include_done: bool = True,
                        limit: int = 300) -> list[dict]:
    """مهام عميل محدد فقط بدون تحميل كل مهام النظام في الواجهة."""
    contract_ids = [int(x) for x in (contract_ids or []) if x]
    where = ["t.customer_id = ?"]
    params: list = [int(customer_id)]
    if contract_ids:
        q = ",".join("?" for _ in contract_ids)
        where.append(f"t.contract_id IN ({q})")
        params.extend(contract_ids)
    sql = ("SELECT t.*, cu.name AS customer_name, c.contract_number "
           "FROM tasks t "
           "LEFT JOIN customers cu ON cu.id = t.customer_id "
           "LEFT JOIN contracts c ON c.id = t.contract_id "
           "WHERE (" + " OR ".join(where) + ")")
    if not include_done:
        sql += " AND t.status = ?"
        params.append(STATUS_OPEN)
    sql += " ORDER BY t.status DESC, t.due_at LIMIT ?"
    params.append(max(1, int(limit)))
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    return _decorate_tasks(rows)


def open_tasks_count() -> int:
    with get_connection() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE status=?",
            (STATUS_OPEN,)).fetchone()[0]


def due_notifications() -> list[dict]:
    """المهام التي يجب التنبيه لها الآن (قبل الموعد أو بعده).

    ترجع كل مهمة مرة واحدة فقط لكل نوع تنبيه، وتُعلَّم كمُنبَّه عنها.
    """
    now = datetime.now()
    fired = []
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status=?", (STATUS_OPEN,)).fetchall()
        for t in rows:
            try:
                due = datetime.strptime(t["due_at"], _FMT)
            except ValueError:
                continue
            minutes_to = (due - now).total_seconds() / 60.0
            # تنبيه قبل الموعد
            if (not t["notified_before"]
                    and 0 <= minutes_to <= t["remind_minutes"]):
                conn.execute(
                    "UPDATE tasks SET notified_before=1 WHERE id=?",
                    (t["id"],))
                fired.append({**dict(t), "kind": "before",
                              "minutes_to": int(minutes_to)})
            # تنبيه بعد الموعد (لم تُتم)
            elif not t["notified_after"] and minutes_to < 0:
                conn.execute(
                    "UPDATE tasks SET notified_after=1 WHERE id=?",
                    (t["id"],))
                fired.append({**dict(t), "kind": "after",
                              "minutes_to": int(minutes_to)})
    return fired


# ============================================================
# رسالة واتساب عن مهمة · للمدير أو للعميل
# ============================================================
def arabic_time(dt) -> str:
    """صيغة الوقت العربية الصحيحة: «09:34 ص» بدل «09:34 AM»
    التي تظهر مقلوبة (AM 34:09) في سياق RTL."""
    try:
        h = dt.hour
        suffix = "ص" if 5 <= h < 12 else ("م" if h >= 12 or h < 5 else "ص")
        h12 = h % 12 or 12
        return f"{h12:02d}:{dt.minute:02d} {suffix}"
    except Exception:
        return dt.strftime("%H:%M")


def arabic_date(dt) -> str:
    """«30 أغسطس 2026» بدل «2026-08-30»."""
    try:
        months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
                  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
        return f"{dt.day} {months[dt.month - 1]} {dt.year}"
    except Exception:
        return dt.strftime("%Y-%m-%d")


def task_whatsapp_message(task: dict, for_customer: bool = False) -> str:
    """نص رسالة واتساب جاهز عن المهمة.

    for_customer=True → صيغة موجهة للعميل نفسه (تذكير بموعده).
    for_customer=False → ملخص للمدير.
    بالأسماء فقط · بلا أرقام عملاء/عقود.
    """
    title = (task.get("title") or "").strip()
    details = (task.get("details") or "").strip()
    due_at = (task.get("due_at") or "").strip()
    # الطرف: العميل المرتبط أو صاحب العقد المرتبط تلقائيًا
    customer = task_party_name(task)
    # اسم العقد المرتبط (بالاسم · لا أرقام)
    contract_lbl = ""
    if task.get("contract_id"):
        try:
            from services.extras_service import contract_label
            contract_lbl = contract_label(task["contract_id"])
        except Exception:
            contract_lbl = ""

    date_part, time_part, dt = "", "", None
    try:
        dt = datetime.strptime(due_at, _FMT)
    except (ValueError, TypeError):
        pass

    from services import settings_service
    _cfg = settings_service.get_settings()
    company = _cfg.company_name.strip()

    # ==== النوع: موعد أو تذكير + الوقت/التاريخ بالعربي ====
    task_kind = (task.get("task_type") or "تذكير").strip()
    if task_kind not in ("موعد", "تذكير"):
        task_kind = "تذكير"

    date_part = arabic_date(dt) if due_at else ""
    time_part = arabic_time(dt) if due_at else ""

    fields = {
        "{العميل}": customer or "",
        "{المهمة}": title,
        "{العقد}": contract_lbl,
        "{التاريخ}": date_part,
        "{الوقت}": time_part,
        "{ملاحظات}": details,
        "{الشركة}": company,
        "{النوع}": task_kind,
    }

    def _apply(tpl: str) -> str:
        out = tpl
        for k, v in fields.items():
            out = out.replace(k, str(v or ""))
        out = "\n".join(ln for ln in out.split("\n") if ln.strip())
        return out.strip()

    # القالب يُختار حسب النوع: موعد ← wa_appt · تذكير ← wa_reminder
    # (القوالب القديمة customer/manager ما زالت مدعومة للأولوية)
    if for_customer:
        tpl = ((getattr(_cfg, "wa_appt", "") or "").strip()
               if task_kind == "موعد"
               else (getattr(_cfg, "wa_reminder", "") or "").strip())
        if not tpl:
            tpl = (getattr(_cfg, "task_wa_customer", "") or "").strip()
        if tpl:
            return _apply(tpl)
    else:
        tpl = (getattr(_cfg, "task_wa_manager", "") or "").strip()
        if tpl:
            return _apply(tpl)

    if for_customer:
        lines = ["السلام عليكم ورحمة الله وبركاته،"]
        greet = f"الأخ العزيز / {customer}" if customer else "عميلنا العزيز"
        lines.append(greet)
        lines.append("")
        lines.append(f"نذكّركم بموعدكم معنا: {title}")
        if contract_lbl:
            lines.append(f"بخصوص: {contract_lbl}")
        if date_part:
            when = f"وذلك يوم {date_part}"
            if time_part:
                when += f" الساعة {time_part}"
            lines.append(when)
        if details:
            lines.append(f"ملاحظات: {details}")
        lines.append("")
        lines.append("نتشرف بحضوركم، ولأي استفسار لا تترددوا بالتواصل معنا.")
        if company:
            lines.append(company)
        return "\n".join(lines)

    # ملخص للمدير
    lines = ["📌 ملخص مهمة:", f"المهمة: {title}"]
    if customer:
        lines.append(f"العميل: {customer}")
    if contract_lbl:
        lines.append(f"العقد: {contract_lbl}")
    if date_part:
        when = f"الموعد: {date_part}"
        if time_part:
            when += f" · {time_part}"
        lines.append(when)
    if details:
        lines.append(f"تفاصيل: {details}")
    status = task.get("status") or ""
    if status:
        lines.append(f"الحالة: {status}")
    if company:
        lines.append(f"({company})")
    return "\n".join(lines)


def task_customer_phone(task: dict) -> str:
    """هاتف العميل المرتبط بالمهمة.

    لو المهمة مربوطة بعميل مباشرة → هاتفه.
    لو مربوطة بعقد فقط → هاتف صاحب العقد تلقائيًا.
    """
    cid = task.get("customer_id")
    with get_connection() as conn:
        if not cid and task.get("contract_id"):
            row = conn.execute(
                "SELECT customer_id FROM contracts WHERE id=?",
                (task["contract_id"],)).fetchone()
            cid = row["customer_id"] if row else None
        if not cid:
            return ""
        row = conn.execute("SELECT phone FROM customers WHERE id=?",
                           (cid,)).fetchone()
    return (row["phone"] or "").strip() if row else ""


def task_party_name(task: dict) -> str:
    """اسم الطرف المستهدف بالرسالة: العميل المرتبط أو صاحب العقد."""
    name = (task.get("customer_name") or "").strip()
    if name:
        return name
    if task.get("customer_id"):
        with get_connection() as conn:
            row = conn.execute(
                "SELECT name FROM customers WHERE id=?",
                (task["customer_id"],)).fetchone()
        if row and (row["name"] or "").strip():
            return row["name"].strip()
    if task.get("contract_id"):
        with get_connection() as conn:
            row = conn.execute(
                "SELECT cu.name FROM contracts c "
                "JOIN customers cu ON cu.id = c.customer_id WHERE c.id=?",
                (task["contract_id"],)).fetchone()
        if row:
            return (row["name"] or "").strip()
    return ""
