# -*- coding: utf-8 -*-
"""عقود الإشراف الهندسي.

عقد الإشراف يختلف عن عقد المقاولة العادي:
- لا يبدأ من تاريخ التعاقد بل من «تاريخ تعهد الإشراف» الصادر من بلدية الكويت.
- له مدة أساسية بالأشهر وقيمة شهرية ثابتة (المدة × الشهرية = قيمة العقد).
- بعد انتهاء المدة الأساسية يُحسب كل شهر يبدأ (ولو بيوم واحد) شهرَ
  تمديد بنفس القيمة الشهرية · مديونية إضافية على العميل تلقائيًا.
- تنتهي المديونية بمخالصة: سند قبض يغطيها، أو إلغاء مدة (تنازل) من المدير.
"""
from __future__ import annotations

from datetime import date, datetime

from database.database import get_connection
from services.customer_service import ValidationError


def _parse(d: str) -> date | None:
    try:
        return datetime.strptime((d or "").strip()[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _add_months(d: date, months: int) -> date:
    """إضافة أشهر تقويمية (اليوم يُثبَّت مع تقصير نهاية الشهر عند اللزوم)."""
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    # آخر يوم في الشهر الهدف
    if m == 12:
        last = 31
    else:
        last = (date(y, m + 1, 1) - date(y, m, 1)).days
    return date(y, m, min(d.day, last))


def is_supervision(contract_row) -> bool:
    """عقد إشراف = له تاريخ تعهد ومدة وقيمة شهرية."""
    try:
        return bool((contract_row["sup_start_date"] or "").strip()) \
            and int(contract_row["sup_months"] or 0) > 0 \
            and float(contract_row["sup_monthly"] or 0) > 0
    except (KeyError, IndexError, TypeError):
        return False


def _actual_supervision_end(contract_id: int) -> date | None:
    """تاريخ مرحلة إنهاء الإشراف إن أُغلقت؛ بعده لا تُحسب أيام جديدة."""
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT end_date FROM contract_stages "
                "WHERE contract_id=? AND COALESCE(end_date,'')<>'' "
                "AND COALESCE(is_skipped,0)=0 "
                "AND REPLACE(REPLACE(REPLACE(name,'أ','ا'),'إ','ا'),'آ','ا') LIKE '%انهاء%' "
                "AND REPLACE(REPLACE(REPLACE(name,'أ','ا'),'إ','ا'),'آ','ا') LIKE '%اشراف%' "
                "ORDER BY end_date DESC LIMIT 1", (contract_id,)).fetchone()
        return _parse(row["end_date"]) if row else None
    except Exception:
        return None


def supervision_status(contract_id: int, today: date | None = None) -> dict | None:
    # V2.48: تغليف بذاكرة البناء
    from services.qcache import memo
    return memo(("supervision_status", contract_id, today),
                lambda: _supervision_status_impl(contract_id, today))


def _supervision_status_impl(contract_id: int, today: date | None = None) -> dict | None:
    """الحالة الكاملة لعقد الإشراف · أو None لو العقد ليس إشرافًا.

    كل شهر تمديد «يبدأ» يُحسب كاملًا (ولو مرّ يوم واحد منه) · حسب اتفاق العمل.
    أشهر التمديد الملغاة (تنازل المدير) تُخصم من المستحق.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT c.*, cu.name AS customer_name FROM contracts c "
            "JOIN customers cu ON cu.id = c.customer_id WHERE c.id=?",
            (contract_id,)).fetchone()
        if not row or not is_supervision(row):
            return None
        collected = float(conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM vouchers "
            "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
            (contract_id,)).fetchone()[0])

    real_today = today or date.today()
    actual_end = _actual_supervision_end(contract_id)
    today = actual_end if actual_end and real_today >= actual_end else real_today
    start = _parse(row["sup_start_date"])
    if not start:
        return None
    months = int(row["sup_months"])
    monthly = float(row["sup_monthly"])
    discount = float(row["sup_discount"] if "sup_discount" in row.keys() else 0 or 0)
    waived = float(row["sup_waived_months"] or 0)  # يقبل كسورًا (1.5 شهر)
    waive_reason = (row["sup_waive_reason"] if "sup_waive_reason" in row.keys() else "") or ""
    gross_value = months * monthly
    base_value = max(0.0, gross_value - discount)
    base_end = _add_months(start, months)

    # أشهر التمديد: كل شهر «بدأ» بعد نهاية المدة يُحسب كاملًا
    extension_months = 0
    if today >= base_end:
        while _add_months(base_end, extension_months) <= today:
            extension_months += 1
    billable_ext = max(0.0, extension_months - waived)
    extension_value = billable_ext * monthly

    total_due = base_value + extension_value
    remaining = total_due - collected

    # ===== المدة الباقية من الإشراف بالأشهر والأيام =====
    if today < base_end:
        m_left = 0
        while _add_months(today, m_left + 1) <= base_end:
            m_left += 1
        d_left = (base_end - _add_months(today, m_left)).days
        time_left_text = _months_days_text(m_left, d_left) + " حتى نهاية المدة"
    else:
        m_left = d_left = 0
        over_days = (today - base_end).days
        time_left_text = ("انتهت المدة الأساسية اليوم" if over_days == 0
                          else f"في التمديد منذ {over_days} يوم")

    # ===== التمديد غير المسدد (يتحدث تلقائيًا مع كل دفعة) =====
    # السداد يغطي قيمة العقد الأساسية أولًا ثم أشهر التمديد بالترتيب
    unpaid_ext_value = min(extension_value, max(0.0, total_due - collected))
    unpaid_ext_months = (round(unpaid_ext_value / monthly, 3)
                         if monthly else 0.0)
    # ===== التمديد المدفوع فعلًا (فلوس دخلت بعد تغطية الأساس) =====
    paid_ext_value = max(0.0, min(extension_value, collected - base_value))
    paid_ext_months = (round(paid_ext_value / monthly, 3)
                       if monthly else 0.0)

    # ===== نهاية المدة كاملة والتأخير عنها =====
    # نهاية المدة كاملة = التعهد + الأساسية + التمديد الذي تمت مخالصته
    # بالسداد أو بالتنازل. إلغاء مدة الإشراف يجب أن يقلل التأخير فعليًا.
    settled_ext_months = max(0.0, paid_ext_months + waived)
    full_end = _add_months(start, months + int(settled_ext_months))
    # التأخير: كل شهر يبدأ بعد نهاية المدة كاملة يُحسب شهرًا كاملًا
    delay_months = 0
    if today >= full_end:
        while _add_months(full_end, delay_months) <= today:
            delay_months += 1
    delay_days = max(0, (today - full_end).days)
    delay_value = delay_months * monthly
    # المدة الفعلية للتأخير (شهور وأيام) للعرض · المال يُحتسب بالشهر الكامل
    if today > full_end:
        elapsed_m = 0
        while _add_months(full_end, elapsed_m + 1) <= today:
            elapsed_m += 1
        elapsed_d = (today - _add_months(full_end, elapsed_m)).days
        delay_text = _months_days_text(elapsed_m, elapsed_d)
    else:
        elapsed_m = elapsed_d = 0
        delay_text = "لا تأخير"

    return {
        "customer_name": row["customer_name"],
        "start": start.isoformat(),           # تاريخ تعهد الإشراف
        "base_end": base_end.isoformat(),     # نهاية المدة الأساسية
        "actual_end": actual_end.isoformat() if actual_end else "",
        "calculation_date": today.isoformat(),
        "months": months,
        "monthly": monthly,
        "gross_value": gross_value,
        "discount": discount,
        "base_value": base_value,
        "extension_months": extension_months,  # الأشهر المحسوبة فعليًا
        "waived_months": waived,               # الملغاة بتنازل المدير
        "waive_reason": waive_reason,
        "billable_extension": billable_ext,    # المستحقة = المحسوبة - الملغاة
        "extension_value": extension_value,
        "total_due": total_due,                # الأساس + التمديد المستحق
        "collected": collected,
        "remaining": remaining,
        "in_extension": today >= base_end,
        # المدة الباقية من الإشراف (قبل دخول التمديد)
        "time_left_months": m_left,
        "time_left_days": d_left,
        "time_left_text": time_left_text,
        # التمديد غير المسدد · هذا فقط ما يمكن للمدير إلغاؤه
        "unpaid_extension_value": unpaid_ext_value,
        "unpaid_extension_months": unpaid_ext_months,
        # التمديد المدفوع فعلًا (فلوس) · ومنه تُشتق «مدة التأخير»
        "paid_extension_value": paid_ext_value,
        "paid_extension_months": paid_ext_months,
        # نهاية المدة كاملة = التعهد + الأساسية + التمديد المخالص بالسداد/التنازل
        "settled_extension_months": settled_ext_months,
        "full_end": full_end.isoformat(),
        "delay_months": delay_months,      # الشهور المحتسبة ماليًا
        "delay_days": delay_days,          # إجمالي أيام التأخير
        # المدة الفعلية للعرض: شهور وأيام
        "delay_elapsed_months": elapsed_m,
        "delay_elapsed_days": elapsed_d,
        "delay_text": delay_text,
        "delay_value": delay_value,        # الشهور المحتسبة × قيمة الشهر
    }


def _months_days_text(m: int, d: int) -> str:
    """صياغة عربية: «شهران و15 يومًا» / «3 أشهر» / «20 يومًا»."""
    parts = []
    if m > 0:
        parts.append("شهر واحد" if m == 1 else
                     "شهران" if m == 2 else f"{m} أشهر")
    if d > 0:
        parts.append("يوم واحد" if d == 1 else
                     "يومان" if d == 2 else f"{d} يومًا")
    if not parts:
        return "أقل من يوم"
    return " و".join(parts)


def base_end_date(contract_id: int) -> str:
    """نهاية المدة الأساسية = تعهد الإشراف + عدد الأشهر (فارغ لغير الإشراف).

    تُستخدم لمزامنة «تاريخ نهاية العقد» مع التعهد تلقائيًا.
    """
    status = supervision_status(contract_id)
    return status["base_end"] if status else ""


def setup_supervision(contract_id: int, sup_start_date: str,
                      months: int, monthly: float, discount: float = 0.0,
                      touch_amount: bool = True) -> None:
    """ضبط عقد كعقد إشراف (أو تحديث بياناته).

    V4.0: touch_amount=False للتعهد على عقود غير إشرافية (تصميم/شامل
    بمراحل إشرافية) — تُحفظ المدة والقيمة دون المساس بقيمة العقد.
    """
    sup_start_date = (sup_start_date or "").strip()[:10]
    if sup_start_date and not _parse(sup_start_date):
        raise ValidationError("تاريخ بداية الإشراف غير صحيح (سنة-شهر-يوم).")
    if months <= 0:
        raise ValidationError("مدة الإشراف بالأشهر يجب أن تكون أكبر من صفر.")
    if monthly <= 0:
        raise ValidationError("قيمة الشهر يجب أن تكون أكبر من صفر.")
    discount = round(float(discount or 0), 3)
    gross = round(months * monthly, 3)
    if discount < 0:
        raise ValidationError("خصم الإشراف لا يكون سالبًا.")
    if discount > gross + 0.001:
        raise ValidationError("خصم الإشراف لا يتجاوز إجمالي قيمة الإشراف.")
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM contracts WHERE id=?",
                           (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        if touch_amount:
            conn.execute(
                "UPDATE contracts SET sup_start_date=?, sup_months=?, "
                "sup_monthly=?, sup_discount=?, amount=? WHERE id=?",
                (sup_start_date, months, monthly, discount,
                 max(0.0, gross - discount), contract_id))
        else:
            # V4.0: تعهد على عقد غير إشرافي — قيمة العقد لا تُمس.
            conn.execute(
                "UPDATE contracts SET sup_start_date=?, sup_months=?, "
                "sup_monthly=?, sup_discount=? WHERE id=?",
                (sup_start_date, months, monthly, discount, contract_id))
    from services import lifecycle_service as lc
    lc.log_event(contract_id, "ضبط عقد إشراف",
                 (f"يبدأ {sup_start_date} · " if sup_start_date else "بلا تاريخ بداية بعد · ")
                 + f"{months} شهرًا × {monthly:,.3f}" + (f" · خصم {discount:,.3f}" if discount else ""))


def set_supervision_start_from_stage(contract_id: int, start_date: str) -> None:
    """تحديد بداية تعهد الإشراف عند بدء/اعتماد مرحلة بداية الإشراف."""
    start_date = (start_date or "").strip()[:10]
    if not _parse(start_date):
        raise ValidationError("تاريخ بداية الإشراف غير صحيح (سنة-شهر-يوم).")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT sup_months, sup_monthly FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        if int(row["sup_months"] or 0) <= 0 or float(row["sup_monthly"] or 0) <= 0:
            raise ValidationError("هذا العقد ليس عقد إشراف مضبوط المدة والقيمة.")
        conn.execute("UPDATE contracts SET sup_start_date=? WHERE id=?",
                     (start_date, contract_id))
    from services import lifecycle_service as lc
    lc.update_contract_lifecycle(contract_id, start_date=start_date,
                                 end_date=base_end_date(contract_id))
    lc.log_event(contract_id, "بداية تعهد الإشراف من المرحلة",
                 f"تاريخ البداية: {start_date}")


def set_supervision_end_from_stage(contract_id: int, end_date: str) -> None:
    """تثبيت تاريخ نهاية الإشراف الفعلية من مرحلة إنهاء الإشراف."""
    end_date = (end_date or "").strip()[:10]
    end = _parse(end_date)
    if not end:
        raise ValidationError("تاريخ إنهاء الإشراف غير صحيح (سنة-شهر-يوم).")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT sup_start_date, sup_months, sup_monthly FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
        if not row:
            raise ValidationError("العقد غير موجود.")
        start = _parse(row["sup_start_date"] or "")
        if not start:
            raise ValidationError("ابدأ مرحلة بداية الإشراف أولًا وحدد تاريخ التعهد.")
        if end < start:
            raise ValidationError("تاريخ إنهاء الإشراف لا يمكن أن يسبق تاريخ البداية.")
        conn.execute("UPDATE contracts SET end_date=? WHERE id=?",
                     (end_date, contract_id))
    from services import lifecycle_service as lc
    lc.log_event(contract_id, "إنهاء الإشراف من المرحلة",
                 f"تاريخ نهاية الإشراف: {end_date}")


def waive_extension_months(contract_id: int, months_to_waive: float,
                           reason: str = "") -> dict:
    """إلغاء أشهر تمديد (تنازل) · عملية مدير. يقبل كسور الشهر (1.5).

    الحد الأقصى للإلغاء = أشهر التمديد **غير المسددة** فقط:
    السداد يغطي الأساس أولًا ثم التمديد، فلو دفع العميل 300 من تمديد
    600 (شهر ونصف من ثلاثة) يبقى المتاح للإلغاء 1.5 شهر فقط —
    يتحدث تلقائيًا بعد كل دفعة.
    """
    if months_to_waive <= 0:
        raise ValidationError("عدد الأشهر الملغاة يجب أن يكون أكبر من صفر.")
    st = supervision_status(contract_id)
    if not st:
        raise ValidationError("هذا العقد ليس عقد إشراف.")
    # المتاح = التمديد غير المسدد (بالشهور · يشمل الكسور)
    can_waive = st["unpaid_extension_months"]
    if months_to_waive > can_waive + 1e-9:
        raise ValidationError(
            f"لا يمكن إلغاء {months_to_waive:g} شهرًا · المتاح للإلغاء "
            f"{can_waive:g} فقط (التمديد غير المسدد؛ "
            "ما دفعه العميل لا يُلغى).")
    reason = (reason or "").strip()
    with get_connection() as conn:
        old = conn.execute(
            "SELECT COALESCE(sup_waive_reason,'') AS reason FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
        old_reason = (old["reason"] if old else "") or ""
        entry = f"إلغاء {months_to_waive:g} شهر" + (f" — {reason}" if reason else "")
        joined = (old_reason + "\n" + entry).strip() if old_reason else entry
        conn.execute(
            "UPDATE contracts SET sup_waived_months = sup_waived_months + ?, "
            "sup_waive_reason=? WHERE id=?",
            (months_to_waive, joined, contract_id))
    from services import lifecycle_service as lc
    lc.log_event(contract_id, "إلغاء أشهر تمديد إشراف",
                 f"{months_to_waive:g} شهر"
                 + (f" · {reason}" if reason else ""))
    return supervision_status(contract_id)


def supervision_receipt_description(contract_id: int, amount: float) -> str:
    """بيان سند قبض على عقد إشراف (V9.15.17 — القرار 5، الخيار ب).

    - الأشهر تُذكر فقط إذا كان المبلغ يغطي أشهرًا صحيحة.
    - غير ذلك: «جزء» مع المتبقي منه.
    - لا مبالغ في البيان إلا المتبقي في حالة الجزء.
    """
    from services.extras_service import apply_description_prefix
    from services import voucher_payment_link_service as vpl
    st = supervision_status(contract_id)
    if not st or amount <= 0:
        return ""
    c_name = vpl.contract_display_name(contract_id)
    monthly = st["monthly"]
    collected = st["collected"]
    base = st["base_value"]

    parts = []
    remaining_amt = amount

    def _months(take):
        if not monthly or take <= 0.001:
            return 0
        n = take / monthly
        return int(round(n)) if (abs(n - round(n)) < 0.01 and n >= 1) else 0

    # 1) المدة الأساسية
    if collected < base - 0.001 and remaining_amt > 0.001:
        base_left = base - collected
        take = min(remaining_amt, base_left)
        after = collected + take
        left_after = base - after
        if after >= base - 0.001:
            parts.append("استكمال قيمة عقد الإشراف" if collected > 0.001
                         else "سداد قيمة عقد الإشراف كاملة")
        else:
            m = _months(take)
            if m:
                m_txt = ("شهر واحد" if m == 1 else
                         "شهرين" if m == 2 else f"{m} أشهر")
                parts.append(f"سداد {m_txt} من عقد الإشراف")
            else:
                parts.append("سداد جزء من قيمة عقد الإشراف "
                             f"والمتبقي منها {left_after:,.3f}")
        remaining_amt -= take
        collected += take

    # 2) أشهر التمديد
    if remaining_amt > 0.001 and st["extension_value"] > 0.001:
        ext_covered = max(0.0, collected - base)
        ext_left = st["extension_value"] - ext_covered
        take = min(remaining_amt, ext_left) if ext_left > 0.001 else 0.0
        if take > 0.001:
            m = _months(take)
            if m:
                m_txt = ("شهر تمديد واحد" if m == 1 else
                         "شهري تمديد" if m == 2 else f"{m} أشهر تمديد")
                parts.append(f"سداد {m_txt}")
            else:
                parts.append("سداد جزء من أشهر التمديد "
                             f"والمتبقي منها {max(0.0, ext_left - take):,.3f}")
            remaining_amt -= take

    if not parts:
        head = "سداد على الحساب"
    else:
        head = " و".join(parts)
    if remaining_amt > 0.001 and parts:
        head += " وزيادة مقدمة"
    from services.voucher_payment_link_service import contract_tail
    text = head + contract_tail(c_name)
    return apply_description_prefix("supervision", text)


def contracts_in_extension() -> list[dict]:
    """كل عقود الإشراف التي دخلت التمديد وعليها مديونية · لتنبيهات الرئيسية."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id FROM contracts c "
            "WHERE COALESCE(c.sup_start_date,'') != '' "
            "AND COALESCE(c.sup_months,0) > 0 "
            "AND COALESCE(c.sup_monthly,0) > 0 "
            "AND c.status NOT IN ('مغلق','ملغى')").fetchall()
    result = []
    for r in rows:
        st = supervision_status(r["id"])
        if st and st["in_extension"] and st["remaining"] > 0.001:
            st["contract_id"] = r["id"]
            result.append(st)
    result.sort(key=lambda x: -x["billable_extension"])
    return result


def contracts_near_base_end(days_ahead: int = 30) -> list[dict]:
    """عقود إشراف تقترب نهاية مدتها الأساسية خلال الأيام القادمة.

    تنبيه استباقي للسكرتير: كلّم العميل قبل ما يدخل العقد في التمديد.
    """
    from datetime import timedelta
    today = date.today()
    horizon = today + timedelta(days=days_ahead)
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id FROM contracts c "
            "WHERE COALESCE(c.sup_start_date,'') != '' "
            "AND COALESCE(c.sup_months,0) > 0 "
            "AND COALESCE(c.sup_monthly,0) > 0 "
            "AND c.status NOT IN ('مغلق','ملغى')").fetchall()
    result = []
    for r in rows:
        st = supervision_status(r["id"])
        if not st or st["in_extension"]:
            continue  # دخل التمديد بالفعل · له تنبيه آخر
        base_end = _parse(st["base_end"])
        if base_end and today <= base_end <= horizon:
            st["contract_id"] = r["id"]
            st["days_left"] = (base_end - today).days
            result.append(st)
    result.sort(key=lambda x: x["days_left"])
    return result


def extensions_map() -> dict:
    """كل عقود الإشراف الداخلة في التمديد · {contract_id: status}.

    بلا فلتر على المتبقي: تُستخدم لحساب قيمة العقد في العروض
    (شجرة التعاملات وغيرها) حتى بعد المخالصة الكاملة بسداد أو إلغاء —
    القيمة يجب أن تبقى (الأساس + التمديد المستحق) وإلا ظهر المحصّل
    أكبر من القيمة. أما تنبيهات الرئيسية فتستخدم contracts_in_extension
    (المديونية القائمة فقط).
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT c.id FROM contracts c "
            "WHERE COALESCE(c.sup_start_date,'') != '' "
            "AND COALESCE(c.sup_months,0) > 0 "
            "AND COALESCE(c.sup_monthly,0) > 0 "
            "AND c.status NOT IN ('ملغى')").fetchall()
    result = {}
    for r in rows:
        st = supervision_status(r["id"])
        if st and st["extension_value"] > 0.001:
            st["contract_id"] = r["id"]
            result[r["id"]] = st
    return result


# ============================================================
# V3.21: الطابع الإشرافي للمراحل — المرحلة مثل عقد الإشراف
# (بداية/نهاية مخططة + تأخير شهور ومبالغ + تنازل) وتظهر في
# ملف تأخيرات الإشراف. التمديد المدفوع يبقى على مستوى العقد
# فقط لأن السندات مرتبطة بالعقد لا بالمرحلة.
# ============================================================

def is_stage_supervision(stage_row) -> bool:
    """مرحلة إشرافية = موسومة + لها بداية ونهاية وقيمة شهرية."""
    try:
        return bool(int(stage_row["is_supervision"] or 0)) \
            and bool((stage_row["sup_start"] or "").strip()) \
            and bool((stage_row["sup_end"] or "").strip()) \
            and float(stage_row["sup_monthly"] or 0) > 0
    except (KeyError, IndexError, TypeError):
        return False


def _stage_row(stage_id: int):
    with get_connection() as conn:
        return conn.execute(
            "SELECT cs.*, c.contract_number, c.customer_id, cu.name AS customer_name "
            "FROM contract_stages cs "
            "JOIN contracts c ON c.id = cs.contract_id "
            "JOIN customers cu ON cu.id = c.customer_id "
            "WHERE cs.id=?", (stage_id,)).fetchone()


def setup_stage_supervision(stage_id: int, sup_end: str, monthly: float) -> None:
    """وسم مرحلة بالطابع الإشرافي: نهاية مخططة + قيمة شهرية.

    البداية تأتي لاحقًا بزر البداية (كما التعهد في عقد الإشراف).
    """
    sup_end = (sup_end or "").strip()[:10]
    if not _parse(sup_end):
        raise ValidationError("تاريخ النهاية المخططة غير صحيح (سنة-شهر-يوم).")
    if float(monthly or 0) <= 0:
        raise ValidationError("قيمة الشهر يجب أن تكون أكبر من صفر.")
    row = _stage_row(stage_id)
    if not row:
        raise ValidationError("المرحلة غير موجودة.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET is_supervision=1, sup_end=?, "
            "sup_monthly=? WHERE id=?",
            (sup_end, float(monthly), stage_id))
    from services import lifecycle_service as lc
    lc.log_event(row["contract_id"], "طابع إشراف للمرحلة",
                 f"«{row['name']}» · نهاية مخططة {sup_end} · "
                 f"{float(monthly):,.3f}/شهر")


def set_stage_sup_start(stage_id: int, start_date: str) -> None:
    """زر بداية إشراف المرحلة — يثبّت تاريخ البداية (كالتهعد)."""
    start_date = (start_date or "").strip()[:10]
    if not _parse(start_date):
        raise ValidationError("تاريخ بداية الإشراف غير صحيح (سنة-شهر-يوم).")
    row = _stage_row(stage_id)
    if not row:
        raise ValidationError("المرحلة غير موجودة.")
    if not (row["sup_end"] or "").strip() or float(row["sup_monthly"] or 0) <= 0:
        raise ValidationError("حدد النهاية المخططة وقيمة الشهر أولًا.")
    if _parse(row["sup_end"]) < _parse(start_date):
        raise ValidationError("النهاية المخططة لا تسبق تاريخ البداية.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET is_supervision=1, sup_start=? "
            "WHERE id=?", (start_date, stage_id))
    from services import lifecycle_service as lc
    lc.log_event(row["contract_id"], "بداية إشراف المرحلة",
                 f"«{row['name']}» · البداية: {start_date}")


def set_stage_sup_end(stage_id: int, end_date: str) -> None:
    """زر إنهاء إشراف المرحلة — يوقف ساعة التأخير (لا يغلق المرحلة)."""
    end_date = (end_date or "").strip()[:10]
    end = _parse(end_date)
    if not end:
        raise ValidationError("تاريخ إنهاء الإشراف غير صحيح (سنة-شهر-يوم).")
    row = _stage_row(stage_id)
    if not row:
        raise ValidationError("المرحلة غير موجودة.")
    start = _parse(row["sup_start"] or "")
    if not start:
        raise ValidationError("ابدأ إشراف المرحلة أولًا وحدد تاريخ البداية.")
    if end < start:
        raise ValidationError("تاريخ الإنهاء لا يسبق تاريخ البداية.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET sup_actual_end=? WHERE id=?",
            (end_date, stage_id))
    from services import lifecycle_service as lc
    lc.log_event(row["contract_id"], "إنهاء إشراف المرحلة",
                 f"«{row['name']}» · النهاية الفعلية: {end_date}")


def waive_stage_extension_months(stage_id: int, months_to_waive: float,
                                 reason: str = "") -> dict:
    """تنازل مدير عن أشهر تأخير مرحلة إشرافية (يقبل الكسور)."""
    if months_to_waive <= 0:
        raise ValidationError("عدد الأشهر الملغاة يجب أن يكون أكبر من صفر.")
    st = stage_supervision_status(stage_id)
    if not st:
        raise ValidationError("هذه المرحلة ليست إشرافية مكتملة البيانات.")
    can_waive = st["unpaid_extension_months"]
    if months_to_waive > can_waive + 1e-9:
        raise ValidationError(
            f"لا يمكن إلغاء {months_to_waive:g} شهرًا · المتاح للإلغاء "
            f"{can_waive:g} فقط.")
    reason = (reason or "").strip()
    with get_connection() as conn:
        old = conn.execute(
            "SELECT COALESCE(sup_waive_reason,'') AS reason FROM contract_stages "
            "WHERE id=?", (stage_id,)).fetchone()
        old_reason = (old["reason"] if old else "") or ""
        entry = f"إلغاء {months_to_waive:g} شهر" + (f" — {reason}" if reason else "")
        joined = (old_reason + "\n" + entry).strip() if old_reason else entry
        conn.execute(
            "UPDATE contract_stages SET sup_waived_months = sup_waived_months + ?, "
            "sup_waive_reason=? WHERE id=?",
            (months_to_waive, joined, stage_id))
    from services import lifecycle_service as lc
    lc.log_event(st["contract_id"], "تنازل عن تأخير مرحلة إشرافية",
                 f"«{st['stage_name']}» · {months_to_waive:g} شهر"
                 + (f" · {reason}" if reason else ""))
    return stage_supervision_status(stage_id)


def stage_supervision_status(stage_id: int, today: date | None = None) -> dict | None:
    from services.qcache import memo
    return memo(("stage_supervision_status", stage_id, today),
                lambda: _stage_supervision_status_impl(stage_id, today))


def _contract_has_sup_value(contract_id: int) -> bool:
    """V4.0: هل يملك العقد مدة وقيمة إشراف؟ (شرط التعهد نفسه)."""
    try:
        with get_connection() as conn:
            r = conn.execute(
                "SELECT sup_months, sup_monthly FROM contracts WHERE id=?",
                (contract_id,)).fetchone()
        if not r:
            return False
        return int(r["sup_months"] or 0) > 0 and float(r["sup_monthly"] or 0) > 0
    except Exception:
        return False


def _stage_supervision_status_impl(stage_id: int, today: date | None = None) -> dict | None:
    """الحالة الكاملة لمرحلة إشرافية · أو None لو غير مكتملة البيانات.

    نفس قواعد عقد الإشراف: كل شهر يبدأ بعد النهاية المخططة يُحسب
    كاملًا × قيمة الشهر · بلا سندات (التمديد المدفوع عقدي فقط).
    V4.0: التعهد يفوز — عقد بمدة وقيمة تُدار إشرافه عقديًا بالكامل،
    فيقف محرك المراحل (لا حساب ولا تقارير) ولا ازدواج أبدًا.
    """
    row = _stage_row(stage_id)
    if not row or not is_stage_supervision(row):
        return None
    try:
        if _contract_has_sup_value(int(row["contract_id"])):
            return None
    except Exception:
        pass
    real_today = today or date.today()
    start = _parse(row["sup_start"])
    base_end = _parse(row["sup_end"])
    if not start or not base_end:
        return None
    monthly = float(row["sup_monthly"])
    waived = float(row["sup_waived_months"] or 0)
    waive_reason = (row["sup_waive_reason"] or "") or ""
    # النهاية الفعلية: زر الإنهاء أو إغلاق المرحلة — توقف الساعة بعدها.
    actual = _parse(row["sup_actual_end"] or "") or _parse(row["end_date"] or "")
    today_eff = actual if actual and real_today >= actual else real_today
    # المدة الأساسية بالشهور الكاملة (للعرض)
    base_months = 0
    while _add_months(start, base_months + 1) <= base_end:
        base_months += 1
    base_value = round(base_months * monthly, 3)
    # أشهر التمديد: كل شهر بدأ بعد النهاية المخططة يُحسب كاملًا
    extension_months = 0
    if today_eff >= base_end:
        while _add_months(base_end, extension_months) <= today_eff:
            extension_months += 1
    billable_ext = max(0.0, extension_months - waived)
    extension_value = round(billable_ext * monthly, 3)
    total_due = round(base_value + extension_value, 3)
    # بلا سندات على المرحلة: كل التمديد غير مسدد
    unpaid_ext_value = extension_value
    unpaid_ext_months = billable_ext
    # نهاية المدة كاملة = المخططة + الملغى بالتنازل
    full_end = _add_months(base_end, int(max(0.0, waived)))
    delay_months = 0
    if today_eff >= full_end:
        while _add_months(full_end, delay_months) <= today_eff:
            delay_months += 1
    delay_days = max(0, (today_eff - full_end).days)
    delay_value = round(delay_months * monthly, 3)
    if today_eff > full_end:
        elapsed_m = 0
        while _add_months(full_end, elapsed_m + 1) <= today_eff:
            elapsed_m += 1
        elapsed_d = (today_eff - _add_months(full_end, elapsed_m)).days
        delay_text = _months_days_text(elapsed_m, elapsed_d)
    else:
        elapsed_m = elapsed_d = 0
        delay_text = "لا تأخير"
    return {
        "stage_id": stage_id,
        "stage_name": row["name"],
        "contract_id": row["contract_id"],
        "contract_number": row["contract_number"],
        "customer_name": row["customer_name"],
        "start": start.isoformat(),
        "base_end": base_end.isoformat(),
        "actual_end": actual.isoformat() if actual else "",
        "calculation_date": today_eff.isoformat(),
        "months": base_months,
        "monthly": monthly,
        "base_value": base_value,
        "extension_months": extension_months,
        "waived_months": waived,
        "waive_reason": waive_reason,
        "billable_extension": billable_ext,
        "extension_value": extension_value,
        "total_due": total_due,
        "collected": 0.0,
        "remaining": total_due,
        "in_extension": today_eff >= base_end,
        "unpaid_extension_value": unpaid_ext_value,
        "unpaid_extension_months": unpaid_ext_months,
        "paid_extension_value": 0.0,
        "paid_extension_months": 0.0,
        "settled_extension_months": max(0.0, waived),
        "full_end": full_end.isoformat(),
        "delay_months": delay_months,
        "delay_days": delay_days,
        "delay_elapsed_months": elapsed_m,
        "delay_elapsed_days": elapsed_d,
        "delay_text": delay_text,
        "delay_value": delay_value,
    }


def clear_stage_supervision(stage_id: int) -> None:
    """إزالة الطابع الإشرافي عن مرحلة (يمسح بياناته)."""
    row = _stage_row(stage_id)
    if not row:
        raise ValidationError("المرحلة غير موجودة.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE contract_stages SET is_supervision=0, sup_start='', "
            "sup_end='', sup_actual_end='', sup_monthly=0, "
            "sup_waived_months=0, sup_waive_reason='' WHERE id=?",
            (stage_id,))
    from services import lifecycle_service as lc
    lc.log_event(row["contract_id"], "إزالة الطابع الإشرافي",
                 f"«{row['name']}»")
