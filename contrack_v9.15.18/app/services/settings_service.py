# -*- coding: utf-8 -*-
"""إعدادات البرنامج وبيانات الشركة."""
import os
import sqlite3
import time
from copy import deepcopy

from database.database import get_connection, DatabaseError
from database.models import Settings

_CACHE_TTL = 30.0
_settings_cache: tuple[float, Settings] | None = None
_methods_cache: dict[bool, tuple[float, list[dict]]] = {}


def clear_cache() -> None:
    """مسح كاش الإعدادات وطرق الدفع بعد أي تعديل.

    هذا يقلل قراءة ملف قاعدة البيانات عبر الشبكة في الاستخدام اليومي،
    مع ضمان أن أي حفظ يمسح الكاش فورًا.
    """
    global _settings_cache
    _settings_cache = None
    _methods_cache.clear()


def _existing_asset_path(path: str) -> str:
    """بعد استعادة Backup من جهاز آخر قد يكون مسار الهيدر/الفوتر مطلقًا قديمًا.
    إن لم يوجد، نبحث بنفس اسم الملف داخل assets/logo بجوار البرنامج.
    """
    path = (path or "").strip()
    if not path:
        return ""
    if os.path.exists(path):
        return path
    try:
        from database.database import BASE_DIR
        candidate = os.path.join(BASE_DIR, "assets", "logo", os.path.basename(path))
        if os.path.exists(candidate):
            return candidate
    except Exception:
        pass
    return ""


def _load_settings() -> Settings:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if not row:
        return Settings()
    logo = _existing_asset_path(row["logo_path"] or "")
    keys = row.keys()
    return Settings(
        company_name=row["company_name"] or "",
        company_address=row["company_address"] or "",
        company_phone=row["company_phone"] or "",
        company_email=row["company_email"] or "",
        logo_path=logo,
        header_title=((row["header_title"] if "header_title" in keys else "")
                      or "نظام إدارة العقود والمحاسبة"),
        currency=row["currency"] or "د.ك",
        invoice_primary=(row["invoice_primary"] if "invoice_primary" in keys
                         else "") or "#1e3a5f",
        invoice_accent=(row["invoice_accent"] if "invoice_accent" in keys
                        else "") or "#2e86ab",
        auto_backup_enabled=bool(row["auto_backup_enabled"]
                                 if "auto_backup_enabled" in keys else 1),
        auto_backup_interval=int(row["auto_backup_interval"] or 24
                                 if "auto_backup_interval" in keys else 24),
        auto_backup_folder=(row["auto_backup_folder"]
                            if "auto_backup_folder" in keys else "") or "",
        last_backup_at=(row["last_backup_at"]
                        if "last_backup_at" in keys else "") or "",
        # ثيم واحد معتمد · القيم القديمة ("dark") تُقرأ فاتحة
        ui_theme="light",
        bank_fee_amount=float((row["bank_fee_amount"]
                               if "bank_fee_amount" in keys else 0.150) or 0),
        bank_fee_method=((row["bank_fee_method"]
                          if "bank_fee_method" in keys else "")
                         or "تحويل بنكي"),
        opening_balance=float((row["opening_balance"]
                               if "opening_balance" in keys else 0) or 0),
        opening_balance_bank=float((row["opening_balance_bank"]
                                    if "opening_balance_bank" in keys else 0) or 0),
        opening_balance_cash=float((row["opening_balance_cash"]
                                    if "opening_balance_cash" in keys else (
                                        row["opening_balance"] if "opening_balance" in keys else 0)) or 0),
        opening_balance_date=((row["opening_balance_date"]
                               if "opening_balance_date" in keys else "")
                              or ""),
        cash_start_date=((row["cash_start_date"]
                          if "cash_start_date" in keys else "") or "").strip(),
        cashflow_enabled=bool(row["cashflow_enabled"]
                              if "cashflow_enabled" in keys else 1),
        bank_fee_enabled=bool(row["bank_fee_enabled"]
                              if "bank_fee_enabled" in keys else 1),
        app_name=((row["app_name"] if "app_name" in keys else "")
                  or "ConTrack"),
        max_users=int((row["max_users"] if "max_users" in keys else 0) or 0),
        header_image=_existing_asset_path((row["header_image"] if "header_image" in keys else "") or ""),
        print_economy=bool(row["print_economy"]
                           if "print_economy" in keys else 0),
        signature_image=_existing_asset_path((row["signature_image"]
                         if "signature_image" in keys else "") or ""),
        stamp_image=_existing_asset_path((row["stamp_image"]
                     if "stamp_image" in keys else "") or ""),
        stamp_x_mm=float((row["stamp_x_mm"]
                          if "stamp_x_mm" in keys else 0) or 0),
        stamp_y_mm=float((row["stamp_y_mm"]
                          if "stamp_y_mm" in keys else 0) or 0),
        stamp_size_mm=float((row["stamp_size_mm"]
                             if "stamp_size_mm" in keys else 0) or 0),
        footer_image=_existing_asset_path((row["footer_image"] if "footer_image" in keys else "") or ""),
        manager_phone=(row["manager_phone"]
                       if "manager_phone" in keys else "") or "",
        license_key=(row["license_key"]
                     if "license_key" in keys else "") or "",
        task_wa_customer=(row["task_wa_customer"]
                          if "task_wa_customer" in keys else "") or "",
        task_wa_manager=(row["task_wa_manager"]
                         if "task_wa_manager" in keys else "") or "",
        wa_appt=(row["wa_appt"] if "wa_appt" in keys else "") or "",
        wa_reminder=(row["wa_reminder"]
                     if "wa_reminder" in keys else "") or "",
        wa_payment=(row["wa_payment"]
                    if "wa_payment" in keys else "") or "",
        desc_prefix_receipt=(row["desc_prefix_receipt"]
                    if "desc_prefix_receipt" in keys else "") or "",
        desc_prefix_supervision=(row["desc_prefix_supervision"]
                    if "desc_prefix_supervision" in keys else "") or "",
        desc_prefix_transfer=(row["desc_prefix_transfer"]
                    if "desc_prefix_transfer" in keys else "") or "",
        desc_prefix_custody=(row["desc_prefix_custody"]
                    if "desc_prefix_custody" in keys else "") or "",
        desc_prefix_stage_note=(row["desc_prefix_stage_note"]
                    if "desc_prefix_stage_note" in keys else "") or "",
    )


def get_settings() -> Settings:
    global _settings_cache
    now = time.monotonic()
    if _settings_cache and now - _settings_cache[0] <= _CACHE_TTL:
        return deepcopy(_settings_cache[1])
    s = _load_settings()
    _settings_cache = (now, deepcopy(s))
    return s


def save_settings(s: Settings) -> None:
    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE settings SET company_name=?, company_address=?, company_phone=?, "
                "company_email=?, logo_path=?, header_title=?, currency=?, "
                "invoice_primary=?, invoice_accent=?, "
                "auto_backup_enabled=?, auto_backup_interval=?, auto_backup_folder=?, "
                "ui_theme=?, app_name=?, max_users=?, "
                "header_image=?, footer_image=?, "
                "print_economy=?, signature_image=?, stamp_image=?, "
                "stamp_x_mm=?, stamp_y_mm=?, stamp_size_mm=?, "
                "manager_phone=?, license_key=?, "
                "task_wa_customer=?, task_wa_manager=?, "
                "wa_appt=?, wa_reminder=?, wa_payment=?, "
                "bank_fee_amount=?, bank_fee_method=?, "
                "opening_balance=?, opening_balance_bank=?, opening_balance_cash=?, opening_balance_date=?, "
                "cash_start_date=?, "
                "cashflow_enabled=?, bank_fee_enabled=?, "
                "desc_prefix_receipt=?, desc_prefix_supervision=?, "
                "desc_prefix_transfer=?, desc_prefix_custody=?, "
                "desc_prefix_stage_note=? "
                "WHERE id = 1",
                (s.company_name.strip(), s.company_address.strip(),
                 s.company_phone.strip(), s.company_email.strip(),
                 s.logo_path.strip(),
                 (getattr(s, "header_title", "") or
                  "نظام إدارة العقود والمحاسبة").strip(),
                 s.currency.strip() or "د.ك",
                 s.invoice_primary.strip() or "#1e3a5f",
                 s.invoice_accent.strip() or "#2e86ab",
                 1 if s.auto_backup_enabled else 0,
                 max(1, min(168, int(s.auto_backup_interval or 24))),
                 s.auto_backup_folder.strip(),
                 "light",
                 (s.app_name or "ConTrack").strip() or "ConTrack",
                 int(getattr(s, "max_users", 0) or 0),
                 s.header_image.strip(), s.footer_image.strip(),
                 1 if s.print_economy else 0,
                 s.signature_image.strip(), s.stamp_image.strip(),
                 max(-100.0, min(100.0, float(getattr(s, "stamp_x_mm", 0) or 0))),
                 max(-100.0, min(100.0, float(getattr(s, "stamp_y_mm", 0) or 0))),
                 max(0.0, float(getattr(s, "stamp_size_mm", 0) or 0)),
                 s.manager_phone.strip(),
                 (getattr(s, "license_key", "") or "").strip(),
                 (getattr(s, "task_wa_customer", "") or ""),
                 (getattr(s, "task_wa_manager", "") or ""),
                 (getattr(s, "wa_appt", "") or ""),
                 (getattr(s, "wa_reminder", "") or ""),
                 (getattr(s, "wa_payment", "") or ""),
                 max(0.0, float(getattr(s, "bank_fee_amount", 0.150) or 0)),
                 (getattr(s, "bank_fee_method", "") or "تحويل بنكي").strip(),
                 float((getattr(s, "opening_balance_bank", 0) or 0) +
                       (getattr(s, "opening_balance_cash", 0) or 0)),
                 float(getattr(s, "opening_balance_bank", 0) or 0),
                 float(getattr(s, "opening_balance_cash", 0) or 0),
                 (getattr(s, "opening_balance_date", "") or "").strip(),
                 (getattr(s, "cash_start_date", "") or "").strip(),
                 1 if getattr(s, "cashflow_enabled", True) else 0,
                 1 if getattr(s, "bank_fee_enabled", True) else 0,
                 (getattr(s, "desc_prefix_receipt", "") or "").strip(),
                 (getattr(s, "desc_prefix_supervision", "") or "").strip(),
                 (getattr(s, "desc_prefix_transfer", "") or "").strip(),
                 (getattr(s, "desc_prefix_custody", "") or "").strip(),
                 (getattr(s, "desc_prefix_stage_note", "") or "").strip()),
            )
        clear_cache()
    except sqlite3.Error as exc:
        raise DatabaseError(f"خطأ في حفظ الإعدادات: {exc}") from exc


def fmt_money(value: float, currency: str = "") -> str:
    """تنسيق المبالغ بثلاث خانات عشرية (نمط الدينار الكويتي)."""
    text = f"{value:,.3f}"
    return f"{text} {currency}".strip() if currency else text


def app_name() -> str:
    """اسم النظام كما ضبطه المطور (افتراضي ConTrack)."""
    try:
        return (get_settings().app_name or "ConTrack").strip() or "ConTrack"
    except Exception:
        return "ConTrack"


def header_title() -> str:
    """النص الظاهر أعلى واجهات النظام والمشترك مع هوية الشركة."""
    try:
        return ((get_settings().header_title or "").strip()
                or "نظام إدارة العقود والمحاسبة")
    except Exception:
        return "نظام إدارة العقود والمحاسبة"


# ============================================================
# المديولات الاختيارية (يفعّلها المطور لكل عميل)
# ============================================================
def cashflow_enabled() -> bool:
    """هل مديول التقرير المالي مفعّل؟ (يخفي/يظهر التقرير كاملًا)."""
    try:
        return bool(get_settings().cashflow_enabled)
    except Exception:
        return True


def bank_fee_enabled() -> bool:
    """هل تُحتسب رسوم التحويل البنكي؟ تابعة لمديول التقرير المالي."""
    try:
        st = get_settings()
        return bool(st.cashflow_enabled) and bool(st.bank_fee_enabled)
    except Exception:
        return False


def set_modules(cashflow: bool | None = None,
                bank_fee: bool | None = None) -> None:
    """تفعيل/تعطيل المديولات (None = لا تغيّر · قاعدة 15)."""
    s = get_settings()
    if cashflow is not None:
        s.cashflow_enabled = bool(cashflow)
    if bank_fee is not None:
        s.bank_fee_enabled = bool(bank_fee)
    save_settings(s)


# ============================================================
# إدارة طرق الدفع ورسومها
# ============================================================
def list_payment_methods(active_only: bool = True) -> list[dict]:
    """كل طرق الدفع المعرفة مع كاش قصير لتخفيف القراءة عبر الشبكة."""
    now = time.monotonic()
    key = bool(active_only)
    cached = _methods_cache.get(key)
    if cached and now - cached[0] <= _CACHE_TTL:
        return [dict(r) for r in cached[1]]
    where = "WHERE is_active = 1" if active_only else ""
    with get_connection() as conn:
        rows = [dict(r) for r in conn.execute(
            f"SELECT * FROM payment_methods {where} ORDER BY id"
        ).fetchall()]
    _methods_cache[key] = (now, [dict(r) for r in rows])
    return rows


def get_method_info(name: str) -> dict | None:
    """بيانات طريقة الدفع بالاسم (نوع الرسوم وقيمتها)."""
    if not name:
        return None
    target = name.strip()
    for row in list_payment_methods(active_only=False):
        if (row.get("name") or "").strip() == target:
            return row
    return None


def add_payment_method(name: str, fee_type: str, fee_value: float) -> int:
    """إضافة طريقة دفع جديدة (المبلغ مقطوع أو نسبة مئوية)."""
    from services.customer_service import ValidationError
    name = (name or "").strip()
    if not name:
        raise ValidationError("اسم طريقة الدفع مطلوب.")
    if fee_type not in ("amount", "percent"):
        raise ValidationError("نوع الرسوم غير صحيح.")
    try:
        fee_value = float(fee_value)
    except (TypeError, ValueError):
        raise ValidationError("قيمة الرسوم غير صحيحة.")
    if fee_value < 0:
        raise ValidationError("قيمة الرسوم لا يمكن أن تكون سالبة.")
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO payment_methods (name, fee_type, fee_value) "
                "VALUES (?, ?, ?)",
                (name, fee_type, fee_value))
            new_id = cur.lastrowid
        clear_cache()
        return new_id
    except sqlite3.IntegrityError:
        raise ValidationError("طريقة الدفع موجودة مسبقًا.")


def update_payment_method(method_id: int, name: str, fee_type: str,
                          fee_value: float) -> None:
    """تعديل طريقة دفع موجودة."""
    from services.customer_service import ValidationError
    name = (name or "").strip()
    if not name:
        raise ValidationError("اسم طريقة الدفع مطلوب.")
    if fee_type not in ("amount", "percent"):
        raise ValidationError("نوع الرسوم غير صحيح.")
    with get_connection() as conn:
        conn.execute(
            "UPDATE payment_methods SET name=?, fee_type=?, fee_value=? "
            "WHERE id=?",
            (name, fee_type, float(fee_value), method_id))
    clear_cache()


def delete_payment_method(method_id: int) -> None:
    """حذف طريقة دفع (تعطيل فعلي عبر is_active ليبقى السجل القديم سليمًا)."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE payment_methods SET is_active=0 WHERE id=?", (method_id,))
    clear_cache()
