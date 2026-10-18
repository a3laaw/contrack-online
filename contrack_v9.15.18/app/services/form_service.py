# -*- coding: utf-8 -*-
"""محرك النماذج الحالي — Word First فقط.

تم تنظيف مسار PDF بالإحداثيات القديم من الكود الحي. تبقى جداول قاعدة
البيانات وأعمدتها كما هي حفاظًا على بيانات العملاء القديمة، لكن التشغيل
والتنقل يعتمدان على قوالب Word التي تحتوي {{placeholders}} فقط.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import date
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from database.database import get_connection
from services.search_utils import normalized_search_clause
from services.customer_service import ValidationError


def _forms_dir() -> str:
    """مجلد النماذج حسب مجلد البيانات الفعلي: محلي أو شبكة."""
    from database import database as _db
    return os.path.join(_db.DATA_DIR, "forms")


def _tpl_dir() -> str:
    return os.path.join(_forms_dir(), "templates")


def _doc_dir() -> str:
    return os.path.join(_forms_dir(), "docs")


TEMPLATE_STATUSES = ("مسودة", "معتمد", "معطل", "مؤرشف")
FIELD_TYPES = {
    "text": "نص", "longtext": "نص طويل", "number": "رقم",
    "money": "مبلغ مالي", "date": "تاريخ", "choice": "قائمة اختيار",
    "bool": "نعم/لا", "table": "جدول", "signature": "توقيع/صورة",
    "image": "صورة/شعار",
}
SOURCE_TYPES = {
    "manual": "إدخال يدوي", "system": "من بيانات النظام",
    "auto": "قيمة تلقائية", "calc": "قيمة محسوبة",
}


def _customer_of(ctx: dict) -> dict:
    return ctx.get("customer") or {}


def _contract_of(ctx: dict) -> dict:
    return ctx.get("contract") or {}


def _resolve_contract(ctx: dict, key: str) -> str:
    con = _contract_of(ctx)
    if not con:
        return ""
    if key == "customer_name":
        return con.get("customer_name") or ""
    if key == "amount":
        try:
            return f"{float(con.get('amount') or 0):,.3f}"
        except (TypeError, ValueError):
            return str(con.get("amount") or "")
    return str(con.get(key) or "")


def _resolve_financial(ctx: dict, key: str) -> str:
    fin = ctx.get("financial") or {}
    payments = ctx.get("payments") or []

    def _money(v) -> str:
        try:
            return f"{float(v or 0):,.3f}"
        except (TypeError, ValueError):
            return str(v or "")

    def _words(v) -> str:
        try:
            from services.tafqeet import amount_to_words
            from services import settings_service
            currency = settings_service.get_settings().currency
            return amount_to_words(float(v or 0), currency)
        except Exception:
            return str(v or "")

    m = re.match(r"payment_(\d+)_(amount|words|title|pct|date)$", key or "")
    if m:
        idx = int(m.group(1)) - 1
        part = m.group(2)
        if idx < 0 or idx >= len(payments):
            return ""
        row = payments[idx]
        if part == "title":
            return str(row.get("title") or "")
        if part == "date":
            return str(row.get("due_date") or "")
        if part == "pct":
            return str(row.get("pct") or "")
        if part == "words":
            return _words(row.get("amount"))
        return _money(row.get("amount"))

    if key == "payments_table":
        lines = []
        for idx, row in enumerate(payments, 1):
            lines.append(f"{idx}. {row.get('title') or 'دفعة'}: {_money(row.get('amount'))}"
                         + (f" ({row.get('pct')})" if row.get('pct') else ""))
        return "\n".join(lines)

    val = fin.get(key)
    if key.endswith("_words"):
        base_key = key[:-6]
        amount = fin.get(base_key, fin.get("current_value", 0))
        return _words(amount)
    return _money(val)


def _resolve_setting(key: str) -> str:
    try:
        from services import settings_service
        s = settings_service.get_settings()
        return str(getattr(s, key, "") or "")
    except Exception:
        return ""


_AR_WEEKDAYS = ("الاثنين", "الثلاثاء", "الأربعاء", "الخميس",
                "الجمعة", "السبت", "الأحد")


def arabic_weekday(day=None) -> str:
    """اسم اليوم بالعربية لتاريخ معين (اليوم افتراضيًا)."""
    day = day or date.today()
    try:
        return _AR_WEEKDAYS[day.weekday() % 7]
    except Exception:
        return ""


def _resolve_system(key: str) -> str:
    if key == "today":
        return date.today().strftime("%Y-%m-%d")
    if key == "weekday":
        return arabic_weekday(date.today())
    if key == "year":
        return str(date.today().year)
    if key == "user":
        try:
            from services import auth_service
            return auth_service.display_name() or auth_service.current_username()
        except Exception:
            return ""
    return ""


DATA_SOURCES: dict[str, dict] = {
    "customers": {
        "label": "العملاء", "context": "customer",
        "fields": {
            "name": "اسم العميل", "customer_code": "رقم العميل",
            "phone": "هاتف العميل", "address": "عنوان العميل كامل",
            "address_governorate": "محافظة العميل",
            "address_area": "منطقة العميل",
            "address_block": "قطعة العميل",
            "address_plot": "قسيمة العميل",
            "email": "بريد العميل",
        },
        "resolve": lambda ctx, key: (_customer_of(ctx).get(key) or ""),
    },
    "contracts": {
        "label": "العقود", "context": "contract",
        "fields": {
            "contract_number": "رقم العقد", "contract_name": "اسم العقد",
            "contract_type": "نوع العقد", "amount": "قيمة العقد",
            "contract_date": "تاريخ العقد", "duration_days": "مدة التنفيذ (أيام)",
            "customer_name": "اسم عميل العقد", "description": "بيان العقد",
        },
        "resolve": _resolve_contract,
    },
    "financial": {
        "label": "مالية العقد", "context": "contract",
        "fields": {
            "current_value": "قيمة العقد الحالية",
            "current_value_words": "قيمة العقد كتابة",
            "original_value": "قيمة العقد الأصلية",
            "collected": "المحصّل", "collected_words": "المحصّل كتابة",
            "remaining": "المتبقي", "remaining_words": "المتبقي كتابة",
            "payments_table": "جدول الدفعات",
            "payment_1_amount": "قيمة الدفعة 1", "payment_1_words": "الدفعة 1 كتابة",
            "payment_2_amount": "قيمة الدفعة 2", "payment_2_words": "الدفعة 2 كتابة",
            "payment_3_amount": "قيمة الدفعة 3", "payment_3_words": "الدفعة 3 كتابة",
        },
        "resolve": _resolve_financial,
    },
    "settings": {
        "label": "بيانات الشركة", "context": "",
        "fields": {
            "company_name": "اسم الشركة", "company_phone": "هاتف الشركة",
            "company_address": "عنوان الشركة", "currency": "العملة",
        },
        "resolve": lambda ctx, key: _resolve_setting(key),
    },
    "system": {
        "label": "قيم تلقائية", "context": "",
        "fields": {"today": "تاريخ اليوم", "weekday": "اسم اليوم الحالي (السبت…)",
                   "year": "السنة الحالية", "user": "اسم المستخدم الحالي"},
        "resolve": lambda ctx, key: _resolve_system(key),
    },
}


def data_source_tree() -> dict[str, dict]:
    return {k: {"label": v["label"], "context": v["context"],
                "fields": dict(v["fields"])} for k, v in DATA_SOURCES.items()}


def resolve_field(field: dict, ctx: dict) -> str:
    src = DATA_SOURCES.get(field.get("source_entity") or "")
    if src is None:
        return ""
    try:
        return str(src["resolve"](ctx, field.get("source_key") or "") or "")
    except Exception:
        return ""


def _model_to_dict(obj) -> dict:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return dict(obj)
    try:
        import dataclasses
        if dataclasses.is_dataclass(obj):
            return {k: v for k, v in dataclasses.asdict(obj).items()
                    if isinstance(v, (str, int, float, bool, type(None)))}
    except Exception:
        pass
    return {k: getattr(obj, k) for k in dir(obj)
            if not k.startswith("_") and isinstance(getattr(obj, k),
                                                    (str, int, float, bool, type(None)))}


def build_context(customer_id: int | None = None,
                  contract_id: int | None = None) -> dict:
    ctx: dict = {}
    if customer_id:
        from services import customer_service
        ctx["customer"] = _model_to_dict(customer_service.get_customer(customer_id))
    if contract_id:
        from services import contract_service
        con = contract_service.get_contract(contract_id)
        if con is not None:
            d = _model_to_dict(con)
            if d.get("customer_id"):
                from services import customer_service
                cus = customer_service.get_customer(d["customer_id"])
                if cus is not None:
                    cdict = _model_to_dict(cus)
                    d["customer_name"] = cdict.get("name", "")
                    ctx.setdefault("customer", cdict)
            ctx["contract"] = d
            try:
                from services import lifecycle_service as lc
                cur = lc.contract_current_value(contract_id)
                current = float(cur.get("current", 0) if isinstance(cur, dict) else cur)
                with get_connection() as conn:
                    collected = float(conn.execute(
                        "SELECT COALESCE(SUM(amount),0) FROM vouchers "
                        "WHERE contract_id=? AND vtype='receipt' AND cancelled=0",
                        (contract_id,)).fetchone()[0])
                original = float(d.get("amount") or 0)
                ctx["financial"] = {
                    "current_value": current,
                    "original_value": original,
                    "collected": collected,
                    "remaining": current - collected,
                }
                with get_connection() as conn:
                    plan = conn.execute(
                        "SELECT title, due_date, amount, sort_order, notes "
                        "FROM payment_plan WHERE contract_id=? "
                        "ORDER BY sort_order, id",
                        (contract_id,)).fetchall()
                pay_rows = []
                for p in plan:
                    title = re.sub(r"^\s*\d+\.\s*", "", p["title"] or "دفعة")
                    m = re.search(r"نسبة\s+([0-9]+(?:\.[0-9]+)?)%", p["notes"] or "")
                    pay_rows.append({
                        "title": title,
                        "due_date": p["due_date"] or "",
                        "amount": float(p["amount"] or 0),
                        "pct": (m.group(1) + "%") if m else "",
                    })
                if not pay_rows:
                    try:
                        from services import workflow_service as wf
                        preview = wf.type_payment_preview(d.get("contract_type") or "", current)
                        for p in preview.get("rows", []):
                            pay_rows.append({
                                "title": p.get("title") or "دفعة",
                                "due_date": p.get("due_text") or "",
                                "amount": float(p.get("amount") or 0),
                                "pct": (f"{float(p.get('pct') or 0):g}%" if float(p.get("pct") or 0) else ""),
                            })
                    except Exception:
                        pass
                ctx["payments"] = pay_rows
            except Exception:
                ctx["financial"] = {}
    return ctx


def list_templates(search: str = "", category_id: int | None = None,
                   status: str = "", active_first: bool = True) -> list[dict]:
    sql = ("SELECT t.*, c.name AS category_name, "
           "(SELECT COUNT(*) FROM form_fields f WHERE f.template_id=t.id) AS fields_count, "
           "(SELECT COUNT(*) FROM form_documents d WHERE d.template_id=t.id) AS documents_count "
           "FROM form_templates t LEFT JOIN form_categories c ON c.id=t.category_id WHERE 1=1")
    params: list = []
    if search.strip():
        clause, p = normalized_search_clause(["t.base_name", "c.name"], search)
        sql += " AND " + clause
        params += p
    if category_id:
        sql += " AND t.category_id=?"
        params.append(category_id)
    if status:
        sql += " AND t.status=?"
        params.append(status)
    if active_first:
        sql += (" ORDER BY CASE t.status WHEN 'معتمد' THEN 0 WHEN 'مسودة' THEN 1 "
                "WHEN 'معطل' THEN 2 ELSE 3 END, t.base_name, t.version DESC")
    else:
        sql += " ORDER BY t.base_name, t.version DESC"
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_template(template_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM form_templates WHERE id=?", (template_id,)).fetchone()
    return dict(row) if row else None



def update_template_meta(template_id: int, base_name: str, description: str = "",
                         status: str | None = None, updated_by: str = "") -> None:
    """تعديل بيانات النموذج الخارجية فقط: الاسم/الوصف/الحالة.

    لا يغير حقول Word الداخلية ولا ملف القالب نفسه.
    """
    base_name = (base_name or "").strip()
    if not base_name:
        raise ValidationError("اسم النموذج مطلوب.")
    if status is not None and status not in TEMPLATE_STATUSES:
        raise ValidationError("حالة النموذج غير صحيحة.")
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM form_templates WHERE id=?",
                           (template_id,)).fetchone()
        if not row:
            raise ValidationError("النموذج غير موجود.")
        dup = conn.execute(
            "SELECT id FROM form_templates WHERE base_name=? AND id<>? LIMIT 1",
            (base_name, template_id)).fetchone()
        if dup:
            raise ValidationError("يوجد نموذج آخر بنفس الاسم.")
        sets = ["base_name=?", "description=?",
                "updated_by=?", "updated_at=datetime('now','localtime')"]
        params: list = [base_name, description or "", updated_by or ""]
        if status is not None:
            sets.append("status=?")
            params.append(status)
        params.append(template_id)
        conn.execute(f"UPDATE form_templates SET {', '.join(sets)} WHERE id=?",
                     params)


def set_template_status(template_id: int, status: str, updated_by: str = "") -> None:
    if status not in TEMPLATE_STATUSES:
        raise ValidationError("حالة النموذج غير صحيحة.")
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM form_templates WHERE id=?",
                           (template_id,)).fetchone()
        if not row:
            raise ValidationError("النموذج غير موجود.")
        conn.execute(
            "UPDATE form_templates SET status=?, updated_by=?, "
            "updated_at=datetime('now','localtime') WHERE id=?",
            (status, updated_by or "", template_id))


def delete_template(template_id: int) -> None:
    """حذف قالب Word غير مستخدم.

    إذا وُلدت منه مستندات سابقًا لا نحذفه حفاظًا على الأرشيف؛ يُؤرشف بدلًا
    من ذلك.
    """
    with get_connection() as conn:
        tpl = conn.execute("SELECT * FROM form_templates WHERE id=?",
                           (template_id,)).fetchone()
        if not tpl:
            raise ValidationError("النموذج غير موجود.")
        used = int(conn.execute(
            "SELECT COUNT(*) FROM form_documents WHERE template_id=?",
            (template_id,)).fetchone()[0] or 0)
        if used:
            raise ValidationError(
                "لا يمكن حذف النموذج لأنه استُخدم في مستندات محفوظة. "
                "يمكنك أرشفته بدل الحذف.")
        word_path = tpl["word_path"] or ""
        conn.execute("DELETE FROM form_fields WHERE template_id=?", (template_id,))
        conn.execute("DELETE FROM form_templates WHERE id=?", (template_id,))
    try:
        folder = os.path.dirname(word_path) if word_path else ""
        if folder and os.path.abspath(folder).startswith(os.path.abspath(_tpl_dir())):
            shutil.rmtree(folder, ignore_errors=True)
    except Exception:
        pass

def scan_word_placeholders(docx_path: str) -> list[str]:
    """استخراج حقول {{...}} من النص الظاهر في Word لا من XML الخام.

    Word كثيرًا ما يقسّم النص داخل الوسم الواحد إلى عدة runs ويضع بينها
    وسومًا مثل <w:rPr> و <w:proofErr>. القراءة القديمة كانت تطبق regex
    على XML الخام، فكان الحقل اليدوي يظهر في واجهة التعبئة ككود XML طويل.
    هنا نجمع نصوص w:t الظاهرة داخل كل فقرة ثم نبحث فيها فقط.
    """
    if not docx_path or not os.path.exists(docx_path):
        raise ValidationError("ملف Word غير موجود.")
    if not docx_path.lower().endswith(".docx"):
        raise ValidationError("قوالب النماذج يجب أن تكون Word بصيغة .docx")
    try:
        with ZipFile(docx_path) as zf:
            xml_names = [n for n in zf.namelist()
                         if n.startswith("word/") and n.endswith(".xml")]
            chunks: list[str] = []
            ns_p = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"
            ns_t = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
            for name in xml_names:
                try:
                    root = ET.fromstring(zf.read(name))
                except Exception:
                    continue
                for para in root.iter(ns_p):
                    txt = "".join((t.text or "") for t in para.iter(ns_t))
                    if txt:
                        chunks.append(txt)
            text = "\n".join(chunks)
    except Exception as exc:
        raise ValidationError("تعذر قراءة ملف Word. تأكد أنه غير تالف.") from exc
    found = []
    for ph in re.findall(r"\{\{\s*([^{}<>]+?)\s*\}\}", text):
        name = re.sub(r"\s+", " ", ph).strip()
        if name and name not in found:
            found.append(name)
    return found


def list_fields(template_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM form_fields WHERE template_id=? ORDER BY sort, id",
            (template_id,)).fetchall()
    return [dict(r) for r in rows]


def get_field(field_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM form_fields WHERE id=?", (field_id,)).fetchone()
    return dict(row) if row else None


def add_field(template_id: int, name: str, field_type: str = "text",
              page: int = 1, x: float = 0, y: float = 0,
              w: float = 0, h: float = 0, source_type: str = "manual",
              source_entity: str = "", source_key: str = "",
              context: str = "", default_value: str = "",
              options: str = "", required: int = 0,
              align: str = "right", placeholder: str = "") -> int:
    """إضافة حقل Word placeholder. معاملات x/y باقية كتوافق DB ولا تستخدم."""
    name = (name or "").strip()
    if not name:
        raise ValidationError("اسم الحقل مطلوب.")
    if field_type not in FIELD_TYPES:
        field_type = "text"
    if source_type not in SOURCE_TYPES:
        source_type = "manual"
    with get_connection() as conn:
        row = conn.execute("SELECT MAX(sort) AS s FROM form_fields WHERE template_id=?",
                           (template_id,)).fetchone()
        cur = conn.execute(
            "INSERT INTO form_fields (template_id, name, field_type, page, x, y, w, h, "
            "source_type, source_entity, source_key, context, default_value, options, "
            "required, align, sort, placeholder) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (template_id, name, field_type, page, x, y, w, h, source_type,
             source_entity, source_key, context, default_value, options,
             required, align, (row["s"] or 0) + 1, placeholder or name))
        return int(cur.lastrowid)


def update_field(field_id: int, name: str | None = None,
                 field_type: str | None = None, source_type: str | None = None,
                 source_entity: str | None = None, source_key: str | None = None,
                 context: str | None = None, default_value: str | None = None,
                 options: str | None = None, required: int | None = None,
                 align: str | None = None, **_ignored) -> None:
    sets, params = [], []
    mapping = {"name": name, "field_type": field_type,
               "source_type": source_type, "source_entity": source_entity,
               "source_key": source_key, "context": context,
               "default_value": default_value, "options": options,
               "required": required, "align": align}
    for col, val in mapping.items():
        if val is not None:
            sets.append(f"{col}=?")
            params.append(val)
    if not sets:
        return
    params.append(field_id)
    with get_connection() as conn:
        conn.execute(f"UPDATE form_fields SET {', '.join(sets)} WHERE id=?", params)


def _calc_value(expression: str, values: dict) -> str:
    expr = expression or ""

    def _sub(m):
        v = values.get(m.group(1).strip(), "")
        try:
            return str(float(v))
        except (TypeError, ValueError):
            return "0"

    expr = re.sub(r"\{([^{}]+)\}", _sub, expr)
    if not expr.strip() or not re.fullmatch(r"[\d\s\.\+\-\*/\(\)]+", expr):
        return ""
    try:
        return f"{eval(expr, {'__builtins__': {}}, {}):,.3f}"  # noqa: S307
    except Exception:
        return ""


def _norm_calc_name(name: str) -> str:
    text = (name or "").strip().lower()
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    text = text.replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"[\s\-]+", "_", text).strip("_")


_TOTAL_ALIASES = {
    "الاجمالي", "اجمالي", "المجموع", "مجموع", "اجمالي_الدفعات",
    "مجموع_الدفعات", "اجمالي_المدخلات", "مجموع_المبالغ",
}
_TOTAL_WORDS_ALIASES = {
    "الاجمالي_كتابه", "اجمالي_كتابه", "المجموع_كتابه", "مجموع_كتابه",
    "اجمالي_الدفعات_كتابه", "مجموع_الدفعات_كتابه",
    "المبلغ_بالحروف", "المبلغ_كتابه", "التفقيط", "تفقيط_المبلغ",
}
_CONTRACT_VALUE_ALIASES = {
    "قيمه_العقد", "مبلغ_العقد", "اجمالي_العقد", "القيمه_الاجماليه",
}
_CONTRACT_VALUE_WORDS_ALIASES = {
    "قيمه_العقد_كتابه", "مبلغ_العقد_كتابه", "قيمه_العقد_بالحروف",
    "مبلغ_العقد_بالحروف",
}
_REMAINING_ALIASES = {
    "المتبقي", "متبقي", "باقي_العقد", "الباقي", "المتبقي_من_العقد",
}
_REMAINING_WORDS_ALIASES = {
    "المتبقي_كتابه", "باقي_العقد_كتابه", "الباقي_كتابه",
    "المتبقي_بالحروف", "باقي_العقد_بالحروف",
}


def _amount_float(raw) -> float | None:
    if raw is None:
        return None
    txt = str(raw).strip()
    if not txt:
        return None
    txt = txt.replace(",", "")
    txt = re.sub(r"[^0-9.\-]", "", txt)
    try:
        return float(txt)
    except ValueError:
        return None


def _payment_amount_index(name: str) -> int | None:
    key = _norm_calc_name(name)
    m = re.match(r"^(?:ال)?دفعه_(\d+)_(?:قيمه|مبلغ)$", key)
    return int(m.group(1)) if m else None


def _payment_words_index(name: str) -> int | None:
    key = _norm_calc_name(name)
    m = re.match(r"^(?:ال)?دفعه_(\d+)_(?:كتابه|بالحروف|تفقيط)$", key)
    return int(m.group(1)) if m else None


def _is_manual_amount_field(field: dict) -> bool:
    key = _norm_calc_name(field.get("placeholder") or field.get("name") or "")
    if key in (_TOTAL_ALIASES | _TOTAL_WORDS_ALIASES |
               _CONTRACT_VALUE_ALIASES | _CONTRACT_VALUE_WORDS_ALIASES |
               _REMAINING_ALIASES | _REMAINING_WORDS_ALIASES):
        return False
    if _payment_words_index(key):
        return False
    if any(x in key for x in ("نسبه", "هاتف", "تليفون", "تاريخ", "رقم_العقد", "رقم_العميل")):
        return False
    if _payment_amount_index(key):
        return True
    if (field.get("source_type") or "manual") != "manual":
        return False
    if (field.get("field_type") or "") in ("money", "number"):
        return True
    return any(x in key for x in ("مبلغ", "قيمه", "دفعه"))


def _manual_total(fields: list[dict], values: dict) -> float:
    """مجموع مبالغ الإدخال.

    إذا وُجدت خانات دفعات مرقمة نجمعها فقط. وإلا نجمع خانات المبالغ اليدوية
    العامة مع استبعاد قيمة العقد/المتبقي/التفقيط.
    """
    payment_names = []
    for f in fields:
        name = f.get("placeholder") or f.get("name") or ""
        if _payment_amount_index(name):
            payment_names.append(name)
    if payment_names:
        total = 0.0
        for name in payment_names:
            val = _amount_float(values.get(name))
            if val is not None:
                total += val
        return round(total, 3)

    total = 0.0
    used = set()
    for f in fields:
        if not _is_manual_amount_field(f):
            continue
        for key in (f.get("name") or "", f.get("placeholder") or ""):
            if not key or key in used:
                continue
            val = _amount_float(values.get(key))
            if val is not None:
                total += val
                used.add(key)
                break
    return round(total, 3)


def _field_norms(fields: list[dict]) -> set[str]:
    return {_norm_calc_name(f.get("placeholder") or f.get("name") or "")
            for f in fields}


def _value_by_norm(values: dict, aliases: set[str]) -> float | None:
    for k, v in values.items():
        if _norm_calc_name(k) in aliases:
            val = _amount_float(v)
            if val is not None:
                return val
    return None


def _contract_value_from_values(values: dict) -> float | None:
    return _value_by_norm(values, _CONTRACT_VALUE_ALIASES)


def _remaining_from_values(values: dict) -> float | None:
    return _value_by_norm(values, _REMAINING_ALIASES)


def _has_payment_fields(fields: list[dict]) -> bool:
    return any(_payment_amount_index(f.get("placeholder") or f.get("name") or "")
               for f in fields)


def _validate_input_calculations(fields: list[dict], values: dict) -> None:
    """منع توليد نموذج عقد بأرقام غير متزنة من نموذج الإدخال نفسه."""
    contract_value = _contract_value_from_values(values)
    if contract_value is None or not _has_payment_fields(fields):
        return
    total_payments = _manual_total(fields, values)
    remaining_expected = round(contract_value - total_payments, 3)
    if total_payments > contract_value + 0.001:
        raise ValidationError(
            "مجموع الدفعات أكبر من قيمة العقد.\n"
            f"قيمة العقد: {contract_value:,.3f}\n"
            f"مجموع الدفعات: {total_payments:,.3f}")
    # منع تام: نموذج العقد لا يتولد إلا إذا كانت قيمة العقد = مجموع الدفعات.
    # المتبقي معلومة استرشادية داخل شاشة الإدخال فقط، ولا نعتمده كخانة داخل المستند.
    if abs(total_payments - contract_value) > 0.001:
        raise ValidationError(
            "مجموع الدفعات لا يساوي قيمة العقد.\n"
            f"قيمة العقد: {contract_value:,.3f}\n"
            f"مجموع الدفعات: {total_payments:,.3f}\n"
            f"الفرق / المتبقي الاسترشادي: {remaining_expected:,.3f}")


def _payment_amount_from_values(index: int, values: dict) -> float | None:
    candidates = []
    for prefix in ("دفعة", "الدفعة"):
        candidates += [f"{prefix}_{index}_قيمة", f"{prefix}_{index}_مبلغ"]
    # fallback: أي مفتاح بنفس النمط بعد التطبيع
    for k, v in values.items():
        if _payment_amount_index(k) == index:
            candidates.append(k)
    for k in candidates:
        val = _amount_float(values.get(k))
        if val is not None:
            return val
    return None


def _apply_input_calculations(mapping: dict[str, str], fields: list[dict],
                              values: dict, ctx: dict) -> None:
    """حساب إجمالي مبالغ نموذج الإدخال وتفقيطه في مكانه داخل Word.

    المستخدم يحدد المكان بكتابة placeholders مثل {{الإجمالي}} و
    {{الإجمالي_كتابة}} داخل القالب. لا يعتمد ذلك على خطة دفعات العقد.
    """
    try:
        from services import settings_service
        from services.tafqeet import amount_to_words
        currency = settings_service.get_settings().currency
    except Exception:
        currency = "د.ك"
        amount_to_words = None

    total = _manual_total(fields, values)
    names = {f.get("placeholder") or f.get("name") or "" for f in fields}
    if total > 0:
        total_text = f"{total:,.3f} {currency}"
        words = amount_to_words(total, currency) if amount_to_words else str(total)
        for name in names:
            norm = _norm_calc_name(name)
            if norm in _TOTAL_ALIASES:
                mapping[name] = total_text
            elif norm in _TOTAL_WORDS_ALIASES:
                mapping[name] = words
        for alias in _TOTAL_ALIASES:
            if not (mapping.get(alias) or "").strip():
                mapping[alias] = total_text
        for alias in _TOTAL_WORDS_ALIASES:
            if not (mapping.get(alias) or "").strip():
                mapping[alias] = words

    contract_value = _contract_value_from_values(values)
    if contract_value is not None:
        cv_text = f"{contract_value:,.3f} {currency}"
        cv_words = amount_to_words(contract_value, currency) if amount_to_words else str(contract_value)
        for name in names:
            norm = _norm_calc_name(name)
            if norm in _CONTRACT_VALUE_ALIASES:
                mapping[name] = cv_text
            elif norm in _CONTRACT_VALUE_WORDS_ALIASES:
                mapping[name] = cv_words
        # المتبقي لا يُطبع في المستند بناءً على طلب المستخدم؛ يظهر فقط
        # كإرشاد في شاشة الإدخال، والتوليد يُمنع إذا لم تتساوى الدفعات مع قيمة العقد.

    # تفقيط كل دفعة يدوية: {{دفعة_1_كتابة}} من {{دفعة_1_قيمة}}
    for name in list(names):
        idx = _payment_words_index(name)
        if not idx:
            continue
        amount = _payment_amount_from_values(idx, values)
        if amount is None:
            continue
        words = amount_to_words(amount, currency) if amount_to_words else str(amount)
        mapping[name] = words
        # أضف الصيغتين لتسهيل الاستبدال حتى لو اختلفت الألف/التاء المربوطة
        mapping[f"دفعة_{idx}_كتابة"] = words
        mapping[f"الدفعة_{idx}_كتابة"] = words
        mapping[f"دفعة_{idx}_بالحروف"] = words
        mapping[f"الدفعة_{idx}_بالحروف"] = words


def _address_placeholder_key(name: str) -> str:
    key = (name or "").strip().lower()
    key = re.sub(r"[\s\-]+", "_", key)
    key = key.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه")
    key = re.sub(r"_+", "_", key).strip("_")
    return {
        "محافظه_العميل": "address_governorate", "المحافظه": "address_governorate", "محافظه": "address_governorate",
        "منطقه_العميل": "address_area", "المنطقه": "address_area", "منطقه": "address_area",
        "قطعه_العميل": "address_block", "القطعه": "address_block", "قطعه": "address_block",
        "قسيمه_العميل": "address_plot", "القسيمه": "address_plot", "قسيمه": "address_plot",
    }.get(key, "")


def _field_text(field: dict, values: dict, ctx: dict) -> str:
    name = field.get("name") or ""
    placeholder = field.get("placeholder") or name
    source_type = field.get("source_type") or "manual"
    if source_type == "system" or source_type == "auto":
        return resolve_field(field, ctx)
    if source_type == "calc":
        return _calc_value(field.get("default_value") or "", values)
    val = values.get(name, values.get(placeholder, field.get("default_value") or ""))
    if not val:
        addr_key = _address_placeholder_key(placeholder) or _address_placeholder_key(name)
        if addr_key:
            val = (_customer_of(ctx).get(addr_key) or "")
    if (field.get("field_type") or "") == "money":
        try:
            from services import settings_service
            return f"{float(val or 0):,.3f} {settings_service.get_settings().currency}"
        except Exception:
            return str(val or "")
    return str(val or "")


def _replace_in_paragraph(paragraph, mapping: dict[str, str]) -> None:
    # المحاولة الأولى تحافظ على تنسيق الـrun إذا كان الـplaceholder داخل run واحد.
    for run in paragraph.runs:
        txt = run.text
        new = txt
        for ph, val in mapping.items():
            new = new.replace("{{" + ph + "}}", val)
            new = re.sub(r"\{\{\s*" + re.escape(ph) + r"\s*\}\}", val, new)
        if new != txt:
            run.text = new
    # لو كان الـplaceholder مقسومًا على أكثر من run، نستبدل نص الفقرة كاملًا.
    full = paragraph.text
    new_full = full
    for ph, val in mapping.items():
        new_full = re.sub(r"\{\{\s*" + re.escape(ph) + r"\s*\}\}", val, new_full)
    if new_full != full:
        for i, run in enumerate(paragraph.runs):
            run.text = new_full if i == 0 else ""


def _replace_placeholders_everywhere(doc, mapping: dict[str, str]) -> None:
    for p in doc.paragraphs:
        _replace_in_paragraph(p, mapping)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    _replace_in_paragraph(p, mapping)
                for nested in cell.tables:
                    for r in nested.rows:
                        for c in r.cells:
                            for p in c.paragraphs:
                                _replace_in_paragraph(p, mapping)
    for section in doc.sections:
        for part in (section.header, section.footer):
            for p in part.paragraphs:
                _replace_in_paragraph(p, mapping)
            for table in part.tables:
                for row in table.rows:
                    for cell in row.cells:
                        for p in cell.paragraphs:
                            _replace_in_paragraph(p, mapping)


def _clear_document_footer(doc) -> None:
    """تفريغ فوتر كل أقسام المستند المولَّد (نسخة الإخراج فقط).

    لا يمس قالب Word الأصلي إطلاقًا — يُطبَّق على النسخة المفتوحة في
    الذاكرة قبل الحفظ. يُستخدم عند طلب إخفاء الفوتر مؤقتًا (مثلًا عند
    الطباعة على ورق مطبوع مسبقًا بترويسة وتذييل الشركة).
    """
    for section in doc.sections:
        for footer in (section.footer,
                       getattr(section, "first_page_footer", None),
                       getattr(section, "even_page_footer", None)):
            if footer is None:
                continue
            try:
                # افصل الوراثة عن القسم السابق وإلا بقي الفوتر ظاهرًا
                footer.is_linked_to_previous = False
            except Exception:
                pass
            try:
                for p in list(footer.paragraphs):
                    for run in list(p.runs):
                        run.clear()
                        run.text = ""
                    p.text = ""
                for table in list(footer.tables):
                    tbl = table._element
                    tbl.getparent().remove(tbl)
            except Exception:
                pass


def fill_word(template_id: int, values: dict, out_path: str,
              ctx: dict | None = None, warnings: list | None = None,
              hide_footer: bool = False) -> str:
    """توليد Word من {{placeholders}} فقط؛ لا يوجد overlay ولا x/y.

    hide_footer: يفرّغ تذييل المستند المولَّد فقط (القالب الأصلي يبقى
    كما هو) — مفيد عند الطباعة على أوراق تحمل تذييل الشركة مطبوعًا.
    """
    from docx import Document
    tpl = get_template(template_id)
    if not tpl:
        raise ValidationError("النموذج غير موجود.")
    if (tpl.get("source_type") or "pdf") != "word":
        raise ValidationError("هذا النموذج ليس قالب Word.")
    if not tpl.get("word_path") or not os.path.exists(tpl["word_path"]):
        raise ValidationError("ملف Word الأصلي للنموذج مفقود.")
    ctx = ctx or {}
    fields = list_fields(template_id)
    mapping = {}
    for f in fields:
        ph = f.get("placeholder") or f.get("name") or ""
        if ph:
            mapping[ph] = _field_text(f, values, ctx)
    _validate_input_calculations(fields, values)
    _apply_input_calculations(mapping, fields, values, ctx)
    doc = Document(tpl["word_path"])
    _replace_placeholders_everywhere(doc, mapping)
    try:
        from services.word_service import _stamp_document
        _stamp_document(doc)
    except Exception:
        pass
    if hide_footer:
        _clear_document_footer(doc)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    doc.save(out_path)
    return out_path


def _find_libreoffice_exe() -> str:
    """البحث عن LibreOffice حتى لو ثبّته INSTALL ولم يُحدّث PATH بعد."""
    candidates = [
        shutil.which("soffice"),
        shutil.which("libreoffice"),
    ]
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(env) or ""
        if not base:
            continue
        candidates.extend([
            os.path.join(base, "LibreOffice", "program", "soffice.exe"),
            os.path.join(base, "Programs", "LibreOffice", "program", "soffice.exe"),
        ])
    candidates.extend([
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ])
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return ""


def word_to_pdf(docx_path: str, out_pdf: str) -> str:
    """تحويل Word إلى PDF.

    يحاول بالترتيب:
      1) LibreOffice / soffice، مع البحث في مسارات ويندوز القياسية حتى لو لم يكن في PATH.
      2) مكتبة docx2pdf المثبتة من requirements.txt، وتستخدم Microsoft Word
         على أجهزة Windows عند توفره.
    """
    out_dir = os.path.abspath(os.path.dirname(out_pdf) or ".")
    os.makedirs(out_dir, exist_ok=True)
    docx_path = os.path.abspath(docx_path)
    out_pdf = os.path.abspath(out_pdf)
    errors = []

    exe = _find_libreoffice_exe()
    if exe:
        try:
            with tempfile.TemporaryDirectory() as td:
                profile = os.path.join(td, "lo-profile")
                cmd = [
                    exe,
                    "--headless", "--nologo", "--nofirststartwizard", "--nodefault",
                    f"-env:UserInstallation=file:///{profile.replace(os.sep, '/')}",
                    "--convert-to", "pdf:writer_pdf_Export",
                    "--outdir", td,
                    docx_path,
                ]
                proc = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=120)
                produced = os.path.join(
                    td, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
                if proc.returncode != 0:
                    raise RuntimeError((proc.stderr or proc.stdout or f"exit {proc.returncode}").strip())
                if not os.path.exists(produced):
                    pdfs = [os.path.join(td, x) for x in os.listdir(td) if x.lower().endswith(".pdf")]
                    if pdfs:
                        produced = pdfs[0]
                    else:
                        raise RuntimeError((proc.stderr or proc.stdout or "لم ينتج ملف PDF").strip())
                shutil.copy2(produced, out_pdf)
                if os.path.getsize(out_pdf) <= 0:
                    raise RuntimeError("نتج ملف PDF فارغ")
                return out_pdf
        except Exception as exc:
            errors.append(f"LibreOffice ({exe}): {exc}")
    else:
        errors.append("LibreOffice: لم يتم العثور على soffice.exe في PATH أو Program Files")

    try:
        from docx2pdf import convert as _docx2pdf_convert
        _docx2pdf_convert(docx_path, out_pdf)
        if os.path.exists(out_pdf) and os.path.getsize(out_pdf) > 0:
            return out_pdf
        raise RuntimeError("لم ينتج ملف PDF")
    except Exception as exc:
        errors.append(f"docx2pdf/Microsoft Word: {exc}")

    raise RuntimeError(
        "تعذر تحويل Word إلى PDF. ثبّت LibreOffice أو Microsoft Word. التفاصيل: "
        + " | ".join(errors))


def _next_doc_number() -> str:
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM form_documents").fetchone()
    return f"FD-{int(row['n']) + 1:04d}"


def create_document(template_id: int, title: str, values: dict,
                    customer_id: int | None = None,
                    contract_id: int | None = None,
                    by_user: str = "",
                    output_format: str = "word",
                    hide_footer: bool = False) -> dict:
    tpl = get_template(template_id)
    if not tpl:
        raise ValidationError("النموذج غير موجود.")
    if (tpl.get("source_type") or "pdf") != "word":
        raise ValidationError("محرك النماذج الحالي يدعم Word فقط.")
    ctx = build_context(customer_id, contract_id)
    os.makedirs(_doc_dir(), exist_ok=True)
    num = _next_doc_number()
    word_out = os.path.join(_doc_dir(), f"{num}.docx")
    pdf_path = os.path.join(_doc_dir(), f"{num}.pdf")
    output_format = (output_format or "word").strip().lower()
    if output_format not in ("word", "pdf", "both"):
        output_format = "word"
    fill_word(template_id, values, word_out, ctx, hide_footer=hide_footer)
    try:
        word_to_pdf(word_out, pdf_path)
    except Exception as exc:
        if output_format == "pdf":
            raise ValidationError(
                "تم توليد Word لكن تعذر تحويله إلى PDF. "
                "إذا كان LibreOffice مثبتًا بالفعل فسيتم البحث عنه الآن في Program Files أيضًا. "
                f"التفاصيل: {exc}") from exc
        pdf_path = ""
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO form_documents (template_id, template_version, title, values_json, "
            "pdf_path, word_path, customer_id, contract_id, created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (template_id, tpl.get("version") or 1, title,
             json.dumps(values, ensure_ascii=False), pdf_path, word_out,
             customer_id, contract_id, by_user))
        did = int(cur.lastrowid)
    archived = ""
    if customer_id:
        try:
            from services import customer_service as cs
            from services.archive_service import save_to_archive
            cust = cs.get_customer(customer_id)
            if cust:
                safe = re.sub(r'[\\/:*?"<>|]', "_", tpl["base_name"]).strip()[:50] or "نموذج"
                archived = save_to_archive(cust, word_out, f"{safe}_{num}.docx", overwrite=True)
                if pdf_path:
                    try:
                        save_to_archive(cust, pdf_path, f"{safe}_{num}.pdf", overwrite=True)
                    except Exception:
                        pass
        except Exception:
            archived = ""
    selected_path = pdf_path if output_format == "pdf" and pdf_path else word_out
    return {"id": did, "number": num, "pdf_path": pdf_path,
            "word_path": word_out, "output_format": output_format,
            "selected_path": selected_path,
            "template_version": tpl.get("version") or 1,
            "archived_path": archived}


def list_documents(template_id: int | None = None) -> list[dict]:
    sql = ("SELECT d.*, t.base_name, t.version AS tpl_version "
           "FROM form_documents d JOIN form_templates t ON t.id=d.template_id")
    params: list = []
    if template_id:
        sql += " WHERE d.template_id=?"
        params.append(template_id)
    sql += " ORDER BY d.id DESC"
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def document_fields_need(template_id: int) -> dict:
    fields = list_fields(template_id)
    needs = {"customer": False, "contract": False}
    for f in fields:
        src = DATA_SOURCES.get(f.get("source_entity") or "")
        if src and src["context"] == "customer":
            needs["customer"] = True
        if src and src["context"] == "contract":
            needs["contract"] = True
    return needs


def sample_values(template_id: int) -> dict:
    vals = {}
    for f in list_fields(template_id):
        key = f.get("name") or f.get("placeholder") or ""
        if key:
            vals[key] = f"مثال {key}"
    return vals
