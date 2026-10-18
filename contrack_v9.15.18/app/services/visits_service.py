# -*- coding: utf-8 -*-
"""جدول الزيارات اليومي — صفوف الساعات × أعمدة المهندسين.

· الموظفون (المهندسون) وهواتفهم من الإعدادات ← شاشة «جدول
  الزيارات» — الهاتف لرسائل تذكير الواتساب.
· ساعات العمل من الإعدادات (من الساعة/إلى الساعة/مدة الحصة).
· كل خانة (ساعة × موظف) تُحجز لعميل واحد بالبحث — والزيارة قابلة
  للترحيل كمهمة تذكير بالوقت، وإرسال تذكير واتساب للمهندس والعميل،
  وتصدير جدول اليوم PDF.
"""
import os
from datetime import date

from database.database import get_connection, DatabaseError

DEFAULT_START, DEFAULT_END = 8, 17
DEFAULT_SLOT = 60


# ============================================================
# ساعات العمل (من جدول الإعدادات مباشرة)
# ============================================================
def hours_config() -> dict:
    """{start, end, slot} ساعات عمل جدول الزيارات."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT visits_start_hour, visits_end_hour, "
            "visits_slot_minutes FROM settings WHERE id=1").fetchone()
    if row is None:
        return {"start": DEFAULT_START, "end": DEFAULT_END,
                "slot": DEFAULT_SLOT}
    start = int(row["visits_start_hour"] or DEFAULT_START)
    end = int(row["visits_end_hour"] or DEFAULT_END)
    slot = int(row["visits_slot_minutes"] or DEFAULT_SLOT)
    if end <= start:
        end = start + 1
    if slot not in (15, 20, 30, 60, 90, 120):
        slot = DEFAULT_SLOT
    return {"start": start, "end": end, "slot": slot}


def save_hours_config(start: int, end: int, slot: int) -> None:
    if not (0 <= start <= 23 and 1 <= end <= 24):
        raise DatabaseError("ساعات العمل غير صحيحة.")
    if end <= start:
        raise DatabaseError("ساعة النهاية يجب أن تكون بعد البداية.")
    if slot not in (15, 20, 30, 60, 90, 120):
        raise DatabaseError("مدة الحصة: 15 · 20 · 30 · 60 · 90 · 120 دقيقة.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE settings SET visits_start_hour=?, visits_end_hour=?, "
            "visits_slot_minutes=? WHERE id=1", (start, end, slot))


def hour_slots() -> list[str]:
    """فترات اليوم: ["08:00", "09:00", ...] حسب الإعدادات."""
    cfg = hours_config()
    out = []
    t = cfg["start"] * 60
    while t < cfg["end"] * 60:
        out.append(f"{t // 60:02d}:{t % 60:02d}")
        t += cfg["slot"]
    return out


# ============================================================
# الموظفون (أعمدة الجدول)
# ============================================================
def list_staff(active_only: bool = True) -> list[dict]:
    where = "WHERE active=1" if active_only else ""
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM visit_staff {where} "
            "ORDER BY sort, id").fetchall()
    return [dict(r) for r in rows]


def add_staff(name: str, phone: str = "") -> int:
    name = (name or "").strip()
    if not name:
        raise DatabaseError("اسم الموظف مطلوب.")
    phone = (phone or "").strip()
    with get_connection() as conn:
        dup = conn.execute(
            "SELECT 1 FROM visit_staff WHERE name=? AND active=1",
            (name,)).fetchone()
        if dup:
            raise DatabaseError(f"الموظف «{name}» موجود بالفعل.")
        nxt = conn.execute(
            "SELECT COALESCE(MAX(sort),0)+1 FROM visit_staff"
        ).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO visit_staff (name, phone, active, sort) "
            "VALUES (?,?,1,?)", (name, phone, nxt))
        return int(cur.lastrowid)


def update_staff(staff_id: int, name: str | None = None,
                 phone: str | None = None) -> None:
    sets, params = [], []
    if name is not None:
        name = name.strip()
        if not name:
            raise DatabaseError("اسم الموظف مطلوب.")
        sets.append("name=?")
        params.append(name)
    if phone is not None:
        sets.append("phone=?")
        params.append((phone or "").strip())
    if not sets:
        return
    params.append(staff_id)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE visit_staff SET {', '.join(sets)} WHERE id=?", params)


def delete_staff(staff_id: int) -> None:
    """تعطيل الموظف (يحتفظ بسجله في الزيارات القديمة) بلا حذف فعلي."""
    with get_connection() as conn:
        used = conn.execute(
            "SELECT COUNT(*) FROM visits WHERE staff_id=?",
            (staff_id,)).fetchone()[0]
        if used:
            conn.execute(
                "UPDATE visit_staff SET active=0 WHERE id=?", (staff_id,))
        else:
            conn.execute("DELETE FROM visit_staff WHERE id=?", (staff_id,))


def staff_usage(staff_id: int) -> int:
    with get_connection() as conn:
        return int(conn.execute(
            "SELECT COUNT(*) FROM visits WHERE staff_id=?",
            (staff_id,)).fetchone()[0])


# ============================================================
# زيارات اليوم (خانات الجدول)
# ============================================================
def day_visits(visit_date: str) -> list[dict]:
    """زيارات يوم: [{hour_slot, staff_id, customer_name, customer_id,
    note, task_id, id, staff_name, staff_phone, customer_phone}]"""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT v.id, v.hour_slot, v.staff_id, v.customer_id, v.note, "
            "v.task_id, s.name AS staff_name, s.phone AS staff_phone, "
            "cu.name AS customer_name, cu.phone AS customer_phone "
            "FROM visits v "
            "LEFT JOIN visit_staff s ON s.id=v.staff_id "
            "LEFT JOIN customers cu ON cu.id=v.customer_id "
            "WHERE v.visit_date=? ORDER BY v.hour_slot",
            (visit_date,)).fetchall()
    return [dict(r) for r in rows]


def set_visit(visit_date: str, hour_slot: str, staff_id: int,
              customer_id: int | None, note: str = "",
              username: str = "") -> int:
    """حجز/تفريغ خانة (ساعة × موظف) — الخانة الواحدة لعميل واحد."""
    if not hour_slot or not staff_id:
        raise DatabaseError("اختر الساعة والموظف.")
    note = (note or "").strip()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, task_id FROM visits WHERE visit_date=? "
            "AND hour_slot=? AND staff_id=?",
            (visit_date, hour_slot, staff_id)).fetchone()
        if customer_id:
            # عميل محجوز لنفس الموظف في نفس اليوم ساعة أخرى؟ مسموح —
            # لكن ليس في نفس الساعة لعميلين (القيد أعلاه). عميل واحد
            # في خانتين لنفس الموظف في نفس اليوم = تنبيه بسيط لا منع.
            if row:
                cur = conn.execute(
                    "UPDATE visits SET customer_id=?, note=? WHERE id=?",
                    (customer_id, note, row["id"]))
                return int(row["id"])
            cur = conn.execute(
                "INSERT INTO visits (visit_date, hour_slot, staff_id, "
                "customer_id, note, created_by) VALUES (?,?,?,?,?,?)",
                (visit_date, hour_slot, staff_id, customer_id, note,
                 username))
            return int(cur.lastrowid)
        # تفريغ الخانة
        if row:
            conn.execute("DELETE FROM visits WHERE id=?", (row["id"],))
        return 0


def get_visit(visit_date: str, hour_slot: str, staff_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT v.*, s.name AS staff_name, s.phone AS staff_phone, "
            "cu.name AS customer_name, cu.phone AS customer_phone "
            "FROM visits v "
            "LEFT JOIN visit_staff s ON s.id=v.staff_id "
            "LEFT JOIN customers cu ON cu.id=v.customer_id "
            "WHERE v.visit_date=? AND v.hour_slot=? AND v.staff_id=?",
            (visit_date, hour_slot, staff_id)).fetchone()
    return dict(row) if row else None


def set_visit_task(visit_id: int, task_id: int) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE visits SET task_id=? WHERE id=?",
                     (task_id, visit_id))


# ============================================================
# الترحيل كمهمة + رسائل الواتساب
# ============================================================
def visit_to_task(visit_date: str, hour_slot: str, staff_id: int) -> int:
    """ترحيل الزيارة كمهمة تذكير بموعدها (بالوقت) — مثل المهام تمامًا."""
    v = get_visit(visit_date, hour_slot, staff_id)
    if not v or not v.get("customer_id"):
        raise DatabaseError("الخانة فاضية — لا زيارة للترحيل.")
    if v.get("task_id"):
        raise DatabaseError("هذه الزيارة مرحَّلة كمهمة بالفعل.")
    from services import task_service
    hh = (v["hour_slot"] or "00:00")[:5]
    title = f"زيارة: {v['customer_name']}"
    details = (f"المهندس: {v['staff_name']}"
               + (f" · {v['note']}" if v.get("note") else ""))
    task_id = task_service.add_task(
        title, f"{visit_date} {hh}", details=details,
        source="جدول الزيارات", customer_id=v["customer_id"],
        task_type="موعد")
    set_visit_task(v["id"], task_id)
    return task_id


def reminder_message(visit: dict, for_engineer: bool) -> str:
    """نص تذكير واتساب: للمهندس أو للعميل — بنفس روح رسائل المهام."""
    from services import settings_service
    s = settings_service.get_settings()
    company = s.company_name or s.app_name or "الشركة"
    hh = (visit.get("hour_slot") or "")[:5]
    d = visit.get("visit_date") or ""
    cust = visit.get("customer_name") or "العميل"
    eng = visit.get("staff_name") or "المهندس"
    note = f"\n📌 {visit['note']}" if visit.get("note") else ""
    if for_engineer:
        return (f"📌 تذكير زيارة — {company}\n"
                f"👤 العميل: {cust}\n"
                f"🕒 الساعة: {hh}\n"
                f"📅 التاريخ: {d}{note}")
    return (f"📌 تذكير موعد زيارة — {company}\n"
            f"🕒 الساعة: {hh}\n"
            f"📅 التاريخ: {d}\n"
            f"👨‍🔧 المهندس: {eng}{note}")


def send_reminder(visit_date: str, hour_slot: str, staff_id: int,
                  to_engineer: bool) -> bool:
    """فتح واتساب برسالة التذكير (للمهندس أو للعميل)."""
    v = get_visit(visit_date, hour_slot, staff_id)
    if not v:
        raise DatabaseError("لا زيارة في هذه الخانة.")
    phone = ((v.get("staff_phone") or "") if to_engineer
             else (v.get("customer_phone") or "")).strip()
    if not phone:
        if to_engineer:
            hint = "أضف هاتف الموظف من: الإعدادات ← جدول الزيارات"
        else:
            hint = "أضف هاتف العميل من بطاقة العميل"
        raise DatabaseError(f"لا يوجد رقم هاتف — {hint}.")
    from services.extras_service import open_whatsapp
    return open_whatsapp(phone, reminder_message(v, to_engineer))


# ============================================================
# تصدير PDF
# ============================================================
def export_day_pdf(visit_date: str, out_path: str) -> str:
    """جدول اليوم PDF: صفوف الساعات × أعمدة المهندسين بهوية الشركة."""
    from reports.pdf_utils import register_fonts, ar
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (Paragraph, SimpleDocTemplate, Table,
                                    TableStyle)
    from services import settings_service

    register_fonts()
    s = settings_service.get_settings()
    staff = list_staff()
    slots = hour_slots()
    visits = {(v["hour_slot"], v["staff_id"]): v for v in day_visits(visit_date)}

    doc = SimpleDocTemplate(
        out_path, pagesize=landscape(A4), rightMargin=10 * mm,
        leftMargin=10 * mm, topMargin=10 * mm, bottomMargin=10 * mm,
        title=f"جدول الزيارات {visit_date}")
    head_style = ParagraphStyle(
        "h", fontName="Amiri", fontSize=15, alignment=1,
        textColor=colors.HexColor("#1e3a5f"), spaceAfter=4)
    cell_style = ParagraphStyle(
        "c", fontName="Amiri", fontSize=9.5, alignment=1, leading=12)
    cellb_style = ParagraphStyle(
        "cb", fontName="Amiri-Bold", fontSize=9.5, alignment=1, leading=12)
    slot_style = ParagraphStyle(
        "s", fontName="Amiri-Bold", fontSize=10, alignment=1)

    story = [Paragraph(ar(f"جدول الزيارات — {visit_date} · "
                          f"{s.company_name or ''}"), head_style)]

    data = [[Paragraph(ar("الساعة"), cellb_style)] +
            [Paragraph(ar(st["name"]), cellb_style) for st in staff]]
    for slot in slots:
        row = [Paragraph(ar(slot), slot_style)]
        for st in staff:
            v = visits.get((slot, st["id"]))
            if v:
                txt = ar(str(v.get("customer_name") or "—"))
                if v.get("note"):
                    txt += "<br/>" + ar(f"· {v['note']}")[:60]
                row.append(Paragraph(txt, cell_style))
            else:
                row.append(Paragraph("", cell_style))
        data.append(row)

    ncols = len(staff) + 1
    col_w = (landscape(A4)[0] - 20 * mm) / max(1, ncols)
    tbl = Table(data, colWidths=[22 * mm] + [col_w] * len(staff))
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#94A3B8")),
        ("BACKGROUND", (0, 0), (-1, 0),
         colors.HexColor("#EFF6FF")),
        ("BACKGROUND", (0, 1), (0, -1),
         colors.HexColor("#F8FAFC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)
    doc.build(story)
    return out_path
