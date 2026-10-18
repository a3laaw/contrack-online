# -*- coding: utf-8 -*-
"""خدمات الإضافات: رسالة واتساب، مرفقات العقد، تنبيه الشيكات،
بيانات الرسم البياني الشهري، سجل مدفوعات المقاول، تصفية العقد، والنص الذكي للسندات."""
import os
import shutil
from datetime import date, datetime

from database.database import get_connection, DATA_DIR
from services.customer_service import ValidationError


def _label_from_row(row) -> str:
    cname = ((row["contract_name"] or row["description"]) or "").strip()
    if cname:
        return cname if cname.startswith("عقد") else f"عقد {cname}"
    return f"العقد المبرم بتاريخ {row['contract_date']}"


def contract_labels(contract_ids) -> dict:
    """أسماء عقود دفعة واحدة {id: label} — بدل استعلام لكل صف."""
    ids = [int(x) for x in dict.fromkeys(contract_ids or []) if x]
    if not ids:
        return {}
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, contract_name, description, contract_date "
            f"FROM contracts WHERE id IN ({','.join('?' * len(ids))})",
            ids).fetchall()
    return {int(r["id"]): _label_from_row(r) for r in rows}


def contract_label(contract_id: int) -> str:
    """اسم عقد مفهوم للعميل · لا يظهر رقم العقد أبدًا.

    الأولوية: اسم العقد ← الوصف ← «العقد المبرم بتاريخ كذا».
    """
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("contract_label", contract_id),
                lambda: _contract_label_impl(contract_id))


def _contract_label_impl(contract_id: int) -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT contract_name, description, contract_date "
            "FROM contracts WHERE id=?", (contract_id,)).fetchone()
    if not row:
        return ""
    return _label_from_row(row)


_DESC_PREFIX_FIELDS = {
    "receipt": "desc_prefix_receipt",
    "supervision": "desc_prefix_supervision",
    "transfer": "desc_prefix_transfer",
    "custody": "desc_prefix_custody",
    "stage_note": "desc_prefix_stage_note",
}


def apply_description_prefix(kind: str, text: str) -> str:
    """بادئة البيان التلقائي من الإعدادات · فارغة = النص كما هو.

    kind: receipt · supervision · transfer · custody · stage_note
    """
    if not text:
        return text
    try:
        field = _DESC_PREFIX_FIELDS.get(kind or "")
        if not field:
            return text
        from services import settings_service as _ss
        prefix = str(getattr(_ss.get_settings(), field, "") or "").strip()
        prefix = prefix.rstrip(":").strip()
        if not prefix:
            return text
        return f"{prefix}: {text}"
    except Exception:
        return text



# ============================================================
# 1) رسالة واتساب لسند القبض/الصرف
# ============================================================
def whatsapp_message(voucher: dict) -> str:
    """نص رسالة جاهزة للصق في واتساب عن السند.

    القالب قابل للتعديل من الإعدادات ← رسائل واتساب ← «قالب الدفع»
    (فارغ = النص الافتراضي المدمج).
    """
    from services import settings_service
    s = settings_service.get_settings()
    cur = s.currency or "د.ك"
    company = s.company_name or "الشركة"
    amount = float(voucher.get("amount") or 0)
    party = voucher.get("party") or ""
    vdate = voucher.get("vdate") or ""
    number = voucher.get("voucher_number") or ""

    # ==== القالب المخصص للدفع (تم دفع كذا...) ====
    tpl = (getattr(s, "wa_payment", "") or "").strip()
    if tpl:
        from services.task_service import arabic_date as _ad
        try:
            from datetime import datetime as _dt
            _d = _dt.strptime(vdate, "%Y-%m-%d")
            date_ar = _ad(_d)
        except (ValueError, TypeError):
            date_ar = vdate
        fields = {
            "{الطرف}": party,
            "{المبلغ}": f"{amount:,.3f}",
            "{العملة}": cur,
            "{التاريخ}": date_ar,
            "{الرقم}": number,
            "{الشركة}": company,
        }
        out = tpl
        for k, v in fields.items():
            out = out.replace(k, str(v or ""))
        out = "\n".join(ln for ln in out.split("\n") if ln.strip())
        return out.strip()

    if voucher.get("vtype") == "receipt":
        lines = [f"عزيزي العميل {party}،",
                 f"نفيدكم باستلام مبلغ {amount:,.3f} {cur} "
                 f"بتاريخ {vdate} (سند قبض رقم {number})."]
        contract_id = voucher.get("contract_id")
        if contract_id:
            with get_connection() as conn:
                row = conn.execute(
                    "SELECT contract_number FROM contracts WHERE id=?",
                    (contract_id,)).fetchone()
                collected = float(conn.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                    "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                    (contract_id,)).fetchone()[0])
            if row:
                from services import lifecycle_service as lc
                value = lc.contract_current_value(contract_id)
                remaining = value["current"] - collected
                label = contract_label(contract_id)
                lines.append(
                    f"وذلك عن {label} · "
                    f"المتبقي: {remaining:,.3f} {cur}.")
        lines.append(f"شاكرين تعاملكم معنا،\n{company}")
    else:
        lines = [f"السيد/ {party}،",
                 f"نفيدكم بصرف مبلغ {amount:,.3f} {cur} "
                 f"بتاريخ {vdate} (سند صرف رقم {number}).",
                 f"مع التحية،\n{company}"]
    return "\n".join(lines)


# ============================================================
# 2) مرفقات العقد
# ============================================================
ATTACH_DIR = os.path.join(DATA_DIR, "attachments")
_ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".bmp",
                ".doc", ".docx", ".xls", ".xlsx"}


def add_attachment(contract_id: int, source_path: str) -> int:
    if not os.path.exists(source_path):
        raise ValidationError("الملف غير موجود.")
    ext = os.path.splitext(source_path)[1].lower()
    if ext not in _ALLOWED_EXT:
        raise ValidationError(
            "نوع الملف غير مدعوم · المسموح: PDF / صور / Word / Excel.")
    os.makedirs(ATTACH_DIR, exist_ok=True)
    base = os.path.basename(source_path)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stored = os.path.join(ATTACH_DIR, f"C{contract_id}_{stamp}_{base}")
    try:
        shutil.copy2(source_path, stored)
    except OSError as exc:
        raise ValidationError(f"تعذر نسخ الملف: {exc}") from exc
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO contract_attachments (contract_id, file_name, "
            "stored_path) VALUES (?, ?, ?)",
            (contract_id, base, stored))
        aid = cur.lastrowid
    from services import lifecycle_service as lc
    lc.log_event(contract_id, "إضافة مرفق", base)
    return aid


def list_attachments(contract_id: int) -> list[dict]:
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM contract_attachments WHERE contract_id=? "
            "ORDER BY id DESC", (contract_id,)).fetchall()]


def delete_attachment(attachment_id: int) -> None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM contract_attachments WHERE id=?",
            (attachment_id,)).fetchone()
        if not row:
            return
        conn.execute("DELETE FROM contract_attachments WHERE id=?",
                     (attachment_id,))
    try:
        if os.path.exists(row["stored_path"]):
            os.remove(row["stored_path"])
    except OSError:
        pass
    from services import lifecycle_service as lc
    lc.log_event(row["contract_id"], "حذف مرفق", row["file_name"])


# ============================================================
# 3) تنبيه الشيكات المستحقة
# ============================================================
def due_cheques(days_ahead: int = 7) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT v.id, v.voucher_number, v.vtype, v.vdate, v.party, "
            "v.amount, v.cheque_due_date, c.contract_number "
            "FROM vouchers v LEFT JOIN contracts c ON c.id = v.contract_id "
            "WHERE v.method LIKE '%شيك%' AND v.cheque_due_date != '' "
            "AND v.cancelled=0"
        ).fetchall()
    today = date.today()
    result = []
    for r in rows:
        try:
            due = datetime.strptime(r["cheque_due_date"], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        days_left = (due - today).days
        if days_left <= days_ahead:
            result.append({**dict(r), "days_left": days_left})
    result.sort(key=lambda x: x["days_left"])
    return result


# ============================================================
# 4) بيانات الرسم البياني: وارد/منصرف آخر N شهور
# ============================================================
def monthly_cashflow(months: int = 6) -> list[dict]:
    today = date.today()
    keys = []
    y, m = today.year, today.month
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    keys.reverse()
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT substr(vdate, 1, 7) AS ym, vtype, "
            "COALESCE(SUM(amount),0) AS total FROM vouchers "
            "WHERE substr(vdate, 1, 7) >= ? AND cancelled=0 "
            "GROUP BY ym, vtype",
            (keys[0],)).fetchall()
    data = {k: {"in": 0.0, "out": 0.0} for k in keys}
    for r in rows:
        if r["ym"] in data:
            key = "in" if r["vtype"] == "receipt" else "out"
            data[r["ym"]][key] = float(r["total"])
    months_ar = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
                 "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    result = []
    for k in keys:
        yy, mm = k.split("-")
        result.append({"month": k,
                       "label": f"{months_ar[int(mm)-1]}",
                       "in": data[k]["in"], "out": data[k]["out"]})
    return result


# ============================================================
# 5) سجل مدفوعات مقاول
# ============================================================
def subcontractor_payments(sub_id: int) -> list[dict]:
    with get_connection() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT v.voucher_number, v.vdate, v.amount, v.method, "
            "v.description, c.contract_number, c.contract_name "
            "FROM vouchers v LEFT JOIN contracts c ON c.id = v.contract_id "
            "WHERE v.vtype='payment' AND v.cancelled=0 AND v.party_type='subcontractor' "
            "AND v.party_id=? ORDER BY v.vdate DESC, v.id DESC",
            (sub_id,)).fetchall()]


# ============================================================
# 6) تصفية العقد
# ============================================================
def contract_settlement(contract_id: int) -> dict:
    # V2.48: تغليف بذاكرة البناء (كان يُحسب ~10 مرات لكل فتح مركز عقد)
    from services.qcache import memo
    return memo(("contract_settlement", contract_id),
                lambda: _contract_settlement_impl(contract_id))


def _contract_settlement_impl(contract_id: int) -> dict:
    from services import lifecycle_service as lc
    value = lc.contract_current_value(contract_id)
    with get_connection() as conn:
        collected = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
            (contract_id,)).fetchone()[0])
        status = conn.execute(
            "SELECT status FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
    remaining = value["current"] - collected
    fully_collected = remaining <= 0.001
    stage_required = False
    stages_complete = True
    try:
        from services import workflow_service as wf
        st = wf.stage_status(wf.TX_CONTRACT, contract_id)
        stage_required = bool(st.get("path"))
        stages_complete = (not stage_required) or st.get("current") is None
    except Exception:
        stage_required = False
        stages_complete = True
    return {
        "current_value": value["current"],
        "collected": collected,
        "remaining": remaining,
        "fully_collected": fully_collected,
        "stage_required": stage_required,
        "stages_complete": stages_complete,
        "status": status["status"] if status else "",
        "closable": (fully_collected and stages_complete
                     and status and status["status"] not in ("مغلق", "ملغى")),
    }


def close_contract(contract_id: int) -> None:
    info = contract_settlement(contract_id)
    if not info["fully_collected"]:
        raise ValidationError(
            "لا يمكن إغلاق العقد · ما زال عليه مبلغ متبقٍ: "
            f"{info['remaining']:,.3f}")
    if info.get("stage_required") and not info.get("stages_complete"):
        raise ValidationError(
            "لا يمكن إغلاق العقد · التحصيل مكتمل لكن مسار المراحل لم يكتمل بعد.")
    with get_connection() as conn:
        conn.execute("UPDATE contracts SET status='مغلق' WHERE id=?",
                     (contract_id,))
    from services import lifecycle_service as lc
    lc.log_event(contract_id, "إغلاق العقد", "تصفية كاملة · تم تحصيل كامل القيمة")


def contract_sub_dues(contract_id: int) -> dict:
    # V4.2 (P1-3ب): مستحقات باطن هذا العقد غير المدفوعة — تحذير غير مانع عند التسوية.
    # نفس مجموعة بوابة الإغلاق (سطور مستحقة بالتحريك + متبقٍ) عبر الدالة المعتمدة.
    from services import lifecycle_service as lc
    with get_connection() as conn:
        sc_ids = [r[0] for r in conn.execute(
            "SELECT id FROM sub_contracts "
            "WHERE contract_id=? AND COALESCE(status,'') NOT IN ('ملغى','ملغي')",
            (contract_id,))]
    count = 0
    unpaid = 0.0
    for sid in sc_ids:
        for line in lc.sub_plan_unpaid_triggered(int(sid)):
            count += 1
            unpaid += float(line.get("remaining") or 0)
    return {"count": count, "unpaid": unpaid}


# ============================================================
# فتح واتساب مباشرة
# ============================================================
def normalize_kw_phone(phone: str) -> str:
    p = "".join(ch for ch in (phone or "") if ch.isdigit())
    if not p:
        return ""
    if p.startswith("00"):
        p = p[2:]
    if p.startswith("965") and len(p) == 11:
        return p
    if len(p) == 8:
        return "965" + p
    if 10 <= len(p) <= 15:
        return p
    return ""


def whatsapp_url(phone: str, message: str) -> str:
    from urllib.parse import quote
    number = normalize_kw_phone(phone)
    if not number:
        return ""
    return f"https://wa.me/{number}?text={quote(message)}"


def voucher_party_phone(voucher: dict) -> str:
    party_type = voucher.get("party_type") or ""
    party_id = voucher.get("party_id")
    if not party_id:
        return ""
    table = "customers" if party_type == "customer" else "subcontractors"
    with get_connection() as conn:
        row = conn.execute(f"SELECT phone FROM {table} WHERE id=?",
                           (party_id,)).fetchone()
    return (row["phone"] or "") if row else ""


def open_whatsapp(phone: str, message: str) -> bool:
    url = whatsapp_url(phone, message)
    if not url:
        return False
    import webbrowser
    try:
        return webbrowser.open(url)
    except Exception:
        return False


# ============================================================
# النص الذكي لسند القبض · يقرأ خطة الدفعات والمحصّل ويولد الوصف
# ============================================================
_ORDINALS = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة",
             "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة",
             "الحادية عشرة", "الثانية عشرة"]


def _ordinal(i: int) -> str:
    return _ORDINALS[i] if 0 <= i < len(_ORDINALS) else f"رقم {i + 1}"


def _parts_paid_count(contract_id: int, p_start: float, p_end: float) -> int:
    """كم سندًا ساريًا سابقًا غطى جزءًا من الدفعة الواقعة بين p_start وp_end؟"""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT amount FROM vouchers WHERE contract_id=? "
            "AND vtype='receipt' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation = '') "
            "ORDER BY vdate, id", (contract_id,)).fetchall()
    count = 0
    running = 0.0
    for r in rows:
        v_start, v_end = running, running + float(r["amount"])
        if v_end > p_start + 0.001 and v_start < p_end - 0.001:
            count += 1
        running = v_end
    return count


_PART_ORDINALS = ["", "ثانٍ", "ثالث", "رابع", "خامس", "سادس"]


def allocation_options(contract_id: int) -> list[dict]:
    if not contract_id:
        return []
    with get_connection() as conn:
        addendums = conn.execute(
            "SELECT addendum_number, addendum_type, reason, "
            "amount_add, amount_deduct "
            "FROM addendums WHERE contract_id=? AND status='معتمد' "
            "ORDER BY id", (contract_id,)).fetchall()
        allocated = {r["allocation"]: float(r["s"]) for r in conn.execute(
            "SELECT allocation, COALESCE(SUM(amount),0) AS s FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
            "AND allocation != '' GROUP BY allocation",
            (contract_id,)).fetchall()}
    result = []
    for a in addendums:
        net = float(a["amount_add"]) - float(a["amount_deduct"])
        if net <= 0.001:
            continue
        paid = allocated.get(a["addendum_number"], 0.0)
        atype = a["addendum_type"] or "أمر تغييري"
        base = ("العقد الإضافي" if atype == "عقد إضافي"
                else "الأمر التغييري")
        reason = (a["reason"] or "").strip()
        label = (f"{base} {a['addendum_number']} ({reason})" if reason
                 else f"{base} {a['addendum_number']}")
        result.append({
            "number": a["addendum_number"],
            "label": label,
            "amount": net, "paid": paid, "remaining": net - paid,
        })
    return result


def allocated_description(contract_id: int, amount: float,
                          allocation_number: str) -> str:
    """بيان سند قبض مخصّص لعقد إضافي/أمر تغييري (V9.15.17) — بيان قصير."""
    from services import voucher_payment_link_service as vpl
    opts = allocation_options(contract_id)
    opt = next((o for o in opts if o["number"] == allocation_number), None)
    c_name = vpl.contract_display_name(contract_id)
    if not opt:
        head = "سداد مقابل بند إضافي"
        return apply_description_prefix(
            "receipt", head + vpl.contract_tail(c_name))
    label = opt["label"]
    paid, total = opt["paid"], opt["amount"]
    after = paid + amount
    if abs(after - total) < 0.001:
        head = (f"استكمال {label}" if paid > 0.001
                else f"سداد {label}")
    else:
        with get_connection() as conn:
            prev = conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE contract_id=? "
                "AND vtype='receipt' AND cancelled=0 AND allocation=?",
                (contract_id, allocation_number)).fetchone()[0]
        if prev == 0:
            head = f"سداد جزء من {label}"
        elif 0 < prev < len(vpl._PART_ORD):
            head = f"سداد الجزء {vpl._PART_ORD[prev]} من {label}"
        else:
            head = f"سداد جزء من {label}"
    return apply_description_prefix(
        "receipt", head + vpl.contract_tail(c_name))


def _customer_payment_label(label: str) -> str:
    """تنظيف اسم الدفعة للبيان المطبوع للعميل: لا يظهر رقم مثل 1."""
    text = (label or "").strip() or "دفعة"
    head, sep, tail = text.partition(". ")
    if sep and head.strip().isdigit() and tail.strip():
        text = tail.strip()
    # عقود الدفعة الواحدة يجب أن تظهر صراحة كدفعة كاملة عند السداد
    # سواء دفع العميل كاملها أو جزءًا منها أو دفع زيادة.
    if "دفعة كاملة" in text or "كامل" in text:
        return "الدفعة الكاملة"
    return text


def _contract_stage_name(contract_id: int, stage_id: int | None) -> str:
    """اسم مرحلة من نسخة العقد، لا من قالب النوع.

    payment_plan.stage_id مرتبط بجدول contract_stages، لذلك ممنوع استخدام
    stage_name_of هنا لأنه يقرأ workflow_stages وقد يرجع مرحلة من نوع آخر
    إذا تشابهت أرقام id.
    """
    if not contract_id or not stage_id:
        return ""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT name FROM contract_stages WHERE id=? AND contract_id=?",
            (int(stage_id), int(contract_id))).fetchone()
    return (row["name"] if row else "") or ""


def smart_receipt_stage_note(contract_id: int, amount: float) -> str:
    """ملاحظات سند القبض التلقائية: مرحلة/مراحل العمل التي يغطيها السداد."""
    from services import lifecycle_service as lc
    if not contract_id or amount <= 0:
        return ""
    with get_connection() as conn:
        collected_before = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation = '')",
            (contract_id,)).fetchone()[0])
    names: list[str] = []
    cursor = collected_before
    remaining_amt = float(amount or 0)
    p_start = 0.0
    for item in sorted(lc.contract_payment_plan(contract_id),
                       key=lambda x: (x["due_date"], x["id"])):
        seg_amt = float(item["amount"] or 0)
        p_end = p_start + seg_amt
        if cursor >= p_end - 0.001 or remaining_amt <= 0.001:
            p_start = p_end
            continue
        cover_from = max(cursor, p_start)
        cover = min(remaining_amt, p_end - cover_from)
        if cover > 0.001:
            sname = _contract_stage_name(contract_id, item.get("stage_id"))
            if sname and sname not in names:
                names.append(sname)
        remaining_amt -= cover
        cursor = cover_from + cover
        p_start = p_end
    if names:
        return apply_description_prefix(
            "stage_note", "مرحلة العمل: " + " + ".join(names))
    try:
        from services import workflow_service as _wf
        cur = _wf.stage_status(_wf.TX_CONTRACT, contract_id).get("current")
        name = (cur or {}).get("stage_name") or ""
        return apply_description_prefix(
            "stage_note", f"مرحلة العمل: {name}") if name else ""
    except Exception:
        return ""


def smart_payment_description(contract_id=None, sub_contract_id=None,
                             amount: float = 0.0) -> str:
    """بيان سند الصرف غير المرتبط بدفعة (V9.15.17).

    «سداد على الحساب — عقد {اسم العقد}» — بلا مبلغ ولا اسم مقاول ولا رقم عقد.
    الربط بالدفعات يُكتب من vpl.describe_items عند اختيار دفعة.
    """
    amount = float(amount or 0)
    if amount <= 0:
        return ""
    from services import voucher_payment_link_service as vpl
    cid = contract_id
    if sub_contract_id:
        from services import lifecycle_service as lc
        try:
            sc = lc.get_sub_contract(int(sub_contract_id)) or {}
        except Exception:
            sc = {}
        cid = sc.get("contract_id") or cid
    if not cid:
        return ""
    return vpl.describe_items([], 0.0, vpl.contract_display_name(cid))


def smart_receipt_description(contract_id: int, amount: float) -> str:
    """بيان سند القبض (V9.15.17) — نفس صيغ الصرف (ق1–ق12).

    يوزّع المبلغ على الدفعات بالترتيب بعد ما سُدِّد سابقًا، ويكتب
    «سداد / جزء / استكمال / والدفعة رقم» دون مبالغ، ويختم باسم العقد فقط.
    """
    from services import lifecycle_service as lc
    from services import voucher_payment_link_service as vpl
    if not contract_id or amount <= 0:
        return ""

    from services.supervision_service import (supervision_status,
                                              supervision_receipt_description)
    if supervision_status(contract_id):
        return supervision_receipt_description(contract_id, amount)

    with get_connection() as conn:
        crow = conn.execute(
            "SELECT id FROM contracts WHERE id=?", (contract_id,)).fetchone()
        if not crow:
            return ""
        collected_before = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
            "AND (allocation IS NULL OR allocation = '')",
            (contract_id,)).fetchone()[0])
    c_name = vpl.contract_display_name(contract_id)

    plan = sorted(lc.contract_payment_plan(contract_id),
                  key=lambda x: (x["due_date"], x["id"]))
    value = lc.contract_current_value(contract_id)["current"]

    # ===== الشرائح القابلة للسداد بالترتيب: الدفعات ثم أوامر التغيير =====
    segments = []
    for i, item in enumerate(plan):
        segments.append({
            "number": i + 1,
            "stage": (item.get("stage_name") or "").strip(),
            "title": item.get("title") or "",
            "amount": float(item["amount"]),
        })
    plan_total = sum(s["amount"] for s in segments)

    if value > plan_total + 0.001:
        with get_connection() as conn:
            allocated_map = {r["allocation"]: float(r["s"]) for r in conn.execute(
                "SELECT allocation, COALESCE(SUM(amount),0) AS s FROM vouchers "
                "WHERE contract_id=? AND vtype='receipt' AND cancelled=0 "
                "AND allocation != '' GROUP BY allocation",
                (contract_id,)).fetchall()}
            addendums = conn.execute(
                "SELECT addendum_number, addendum_type, reason, "
                "amount_add, amount_deduct "
                "FROM addendums WHERE contract_id=? AND status='معتمد' "
                "ORDER BY id", (contract_id,)).fetchall()
        extra_needed = value - plan_total
        for a in addendums:
            net = float(a["amount_add"]) - float(a["amount_deduct"])
            net -= allocated_map.get(a["addendum_number"], 0.0)
            if net <= 0.001 or extra_needed <= 0.001:
                continue
            take = min(net, extra_needed)
            atype = a["addendum_type"] or "أمر تغييري"
            base = "العقد الإضافي" if atype == "عقد إضافي" else "الأمر التغييري"
            reason = (a["reason"] or "").strip()
            label = (f"{base} {a['addendum_number']} ({reason})" if reason
                     else f"{base} {a['addendum_number']}")   # ق8: الرقم والسبب
            segments.append({"addendum": True, "label": label, "amount": take})
            extra_needed -= take
        # الزيادة على قيمة العقد بعد الأوامر تُعامل كزيادة مقدمة (وصف «وزيادة مقدمة»)

    if not segments:
        # ق9–ق11: عقد بلا خطة
        if abs(collected_before + amount - value) < 0.001:
            head = "سداد كامل قيمة العقد"
        elif collected_before < 0.001:
            head = "سداد دفعة أولى"
        else:
            head = "سداد على الحساب"
        if value > 0.001 and collected_before + amount > value + 0.001:
            head += " وزيادة مقدمة"   # ق7: زيادة تتجاوز قيمة العقد
        return apply_description_prefix(
            "receipt", head + vpl.contract_tail(c_name))

    # ===== توزيع المبلغ الجديد على الشرائح بعد ما سُدِّد =====
    items = []
    remaining_amt = amount
    cursor = collected_before
    p_start = 0.0
    for seg in segments:
        seg_amt = seg["amount"]
        p_end = p_start + seg_amt
        if cursor >= p_end - 0.001 or remaining_amt <= 0.001:
            p_start = p_end
            continue
        cover_from = max(cursor, p_start)
        cover = min(remaining_amt, p_end - cover_from)
        after = cover_from - p_start + cover
        full = after >= seg_amt - 0.001
        cont = bool(full and cover_from > p_start + 0.001)
        if seg.get("addendum"):
            base_txt = seg["label"]
            core = base_txt if full else f"جزء من {base_txt}"
            items.append({"core": core, "full": full,
                          "continuation": cont})
        else:
            prev = 0 if full else _parts_paid_count(contract_id, p_start, p_end)
            ordinal = (vpl._PART_ORD[prev]
                       if (not full and 0 < prev < len(vpl._PART_ORD)) else None)
            items.append({
                "number": seg["number"], "stage": seg["stage"],
                "title": seg["title"], "full": full,
                "continuation": cont, "part_ordinal": ordinal,
            })
        remaining_amt -= cover
        cursor = p_start + after
        p_start = p_end

    advance = remaining_amt if remaining_amt > 0.001 else 0.0
    return apply_description_prefix(
        "receipt", vpl.describe_items(items, advance, c_name))


