# -*- coding: utf-8 -*-
"""تأسيس أنواع العقود ومراحلها ودفعاتها عن طريق Excel.

هذه الوحدة مستقلة تمامًا ولا تلمس قاعدة البيانات في المرحلة الأولى؛
مهمتها هنا توليد قالب Excel الرسمي:

    قالب_تأسيس_أنواع_العقود_والمراحل_والدفعات.xlsx

القالب يحوي ثلاث أوراق بيانات + ورقة تعليمات:
  1) أنواع العقود        : نوع العقد · طريقة التسعير · نشط · عقد إشراف · ملاحظات
  2) مراحل العقود        : نوع العقد · المرحلة الرئيسية · المرحلة الفرعية ·
                           الترتيب · المدة بالأيام · اللون
  3) دفعات أنواع العقود  : نوع العقد · رقم الدفعة · اسم الدفعة · النوع ·
                           النسبة · مبلغ ثابت · المرحلة المحفزة ·
                           أيام بعد المرحلة · كلمة ربط

قاعدة الاستثناء المعتمدة
------------------------
أي دفعة لا تُعرف مرحلتها المحفِّزة تُكتب في عمود «كلمة ربط» بالقيمة
الثابتة ``بدون_مرحلة`` وتُعد دفعة صحيحة ومسموحة، ولا تمنع أي عملية
إصلاح أو استيراد لاحقة.
"""
from __future__ import annotations

import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# ============================================================
# ثوابت متفق عليها — تُستخدم أيضًا في المراحل التالية (2 · 5)
# ============================================================
#: القيمة الثابتة التي تعني «دفعة بلا مرحلة محفِّزة» — لا تُترجم ولا تُغيَّر.
NO_STAGE_TOKEN = "بدون_مرحلة"

#: اسم ملف القالب الرسمي.
TEMPLATE_FILENAME = "قالب_تأسيس_أنواع_العقود_والمراحل_والدفعات.xlsx"

#: أسماء الأوراق — يعتمد عليها قارئ القالب في المرحلة 2.
SHEET_TYPES = "أنواع العقود"
SHEET_STAGES = "مراحل العقود"
SHEET_PAYMENTS = "دفعات أنواع العقود"
SHEET_HELP = "اقرأني أولاً"

#: أنواع الدفعة المسموحة في عمود «النوع».
PAYMENT_KINDS = ["نسبة", "مبلغ ثابت", "مقدمة", "ختامية", "بعد أيام"]

#: قيم عمودي «نشط» و«عقد إشراف».
YES_NO = ["نعم", "لا"]

#: خيارات نمط تسعير نوع العقد المطلوبة في قالب التأسيس.
PRICING_KINDS = ["مقطوع", "بند مقابل سعر", "وحدة * سعر"]

# ------------------------------------------------------------
# مواصفات الأوراق: (العنوان، عرض العمود، إجباري؟)
# ------------------------------------------------------------
SPEC: dict[str, dict] = {
    SHEET_TYPES: {
        "columns": [
            ("نوع العقد *", 34, True),
            ("طريقة التسعير *", 18, True),
            ("نشط", 12, False),
            ("عقد إشراف", 14, False),
            ("ملاحظات", 46, False),
        ],
        "example": ["تصميم معماري", "مقطوع", "نعم", "لا", "مثال توضيحي — احذف هذا الصف أو اتركه فسيُتجاهل"],
    },
    SHEET_STAGES: {
        "columns": [
            ("نوع العقد *", 30, True),
            ("المرحلة الرئيسية *", 30, True),
            ("المرحلة الفرعية", 30, False),
            ("الترتيب *", 12, True),
            ("المدة بالأيام", 16, False),
            ("اللون", 14, False),
        ],
        "example": ["تصميم معماري", "التصميم المبدئي", "رفع المساحة", 1, 7, "#3B82F6"],
    },
    SHEET_PAYMENTS: {
        "columns": [
            ("نوع العقد *", 28, True),
            ("رقم الدفعة *", 13, True),
            ("اسم الدفعة *", 28, True),
            ("النوع *", 14, True),
            ("النسبة", 12, False),
            ("مبلغ ثابت", 14, False),
            ("المرحلة المحفزة", 30, False),
            ("أيام بعد المرحلة", 17, False),
            ("كلمة ربط", 34, False),
        ],
        "example": ["تصميم معماري", 1, "الدفعة المقدمة", "نسبة", 25, 0,
                    "التصميم المبدئي", 0, "مقدمة, دفعة اولى"],
    },
}

INSTRUCTIONS: list[tuple[str, int, bool, str | None]] = [
    ("تعليمات تعبئة قالب تأسيس أنواع العقود والمراحل والدفعات", 16, True, "1E3A5F"),
    ("", 11, False, None),
    ("١. لا تغيّر أسماء الأوراق الثلاث ولا ترتيب الأعمدة ولا تحذف صف العناوين.",
     12, False, None),
    ("٢. الأعمدة المنتهية بنجمة (*) إجبارية · والباقي اختياري.", 12, False, None),
    ("٣. الصف الرمادي في كل ورقة مثال توضيحي وسيُتجاهل تلقائيًا عند الرفع.",
     12, False, None),
    ("", 11, False, None),
    ("ورقة «أنواع العقود»", 13, True, "1E3A5F"),
    ("٤. «نوع العقد» يجب ألا يتكرر · واكتبه بنفس الصيغة تمامًا في بقية الأوراق.",
     12, False, None),
    ("٥. «طريقة التسعير» مطلوبة وأحد: مقطوع · بند مقابل سعر · وحدة * سعر.",
     12, True, "B45309"),
    ("٦. «نشط» و«عقد إشراف»: اكتب نعم أو لا (الفراغ يعني: نشط = نعم، إشراف = لا).",
     12, False, None),
    ("", 11, False, None),
    ("ورقة «مراحل العقود»", 13, True, "1E3A5F"),
    ("٦. «نوع العقد» يجب أن يكون موجودًا في ورقة «أنواع العقود» وإلا رُفض الصف.",
     12, True, "B45309"),
    ("٧. لمرحلة رئيسية بلا فروع: اترك «المرحلة الفرعية» فارغة.", 12, False, None),
    ("٨. لمرحلة فرعية: اكتب اسم أمّها في «المرحلة الرئيسية» واسمها في «المرحلة الفرعية».",
     12, False, None),
    ("٩. «الترتيب» رقم صحيح يبدأ من 1 داخل كل نوع عقد.", 12, False, None),
    ("١٠. «اللون» اختياري بصيغة ست عشرية مثل ‎#3B82F6‎ · الفراغ يأخذ اللون الافتراضي.",
     12, False, None),
    ("", 11, False, None),
    ("ورقة «دفعات أنواع العقود»", 13, True, "1E3A5F"),
    ("١١. «نوع العقد» يجب أن يكون موجودًا في ورقة «أنواع العقود».", 12, True, "B45309"),
    ("١٢. «رقم الدفعة» رقم صحيح لا يتكرر داخل نوع العقد الواحد.", 12, False, None),
    ("١٣. «النوع» أحد: نسبة · مبلغ ثابت · مقدمة · ختامية · بعد أيام.", 12, False, None),
    ("١٤. لو النوع «نسبة» فاملأ «النسبة» بالمئة (25 تعني 25%) واترك «مبلغ ثابت» صفرًا.",
     12, False, None),
    ("١٥. لو النوع «مبلغ ثابت» فاملأ «مبلغ ثابت» واترك «النسبة» صفرًا.", 12, False, None),
    ("١٦. مجموع نسب دفعات النوع الواحد يجب ألا يتجاوز ١٠٠٪.", 12, True, "B45309"),
    ("١٧. «المرحلة المحفزة» اسم مرحلة مكتوبة لنفس النوع في ورقة «مراحل العقود».",
     12, False, None),
    ("", 11, False, None),
    ("قاعدة الاستثناء المهمة — دفعة بلا مرحلة", 14, True, "7C3AED"),
    (f"١٨. إذا كانت الدفعة غير مرتبطة بأي مرحلة: اترك «المرحلة المحفزة» فارغة "
     f"واكتب في عمود «كلمة ربط» القيمة الثابتة: {NO_STAGE_TOKEN}", 12, True, "7C3AED"),
    ("١٩. هذه الدفعة تُعتبر صحيحة ومسموحة تمامًا، ولن تمنع أي عملية إصلاح أو رفع.",
     12, True, "7C3AED"),
    ("", 11, False, None),
    ("عمود «كلمة ربط»", 13, True, "1E3A5F"),
    ("٢٠. كلمات يبحث عنها النظام في بيان سند القبض ليربطه بهذه الدفعة تلقائيًا.",
     12, False, None),
    ("٢١. افصل بين الكلمات بفاصلة · مثال: مقدمة, دفعة اولى, الدفعه الاولى", 12, False, None),
    (f"٢٢. الكلمة {NO_STAGE_TOKEN} محجوزة لقاعدة الاستثناء أعلاه فقط، لا تستخدمها ككلمة بحث.",
     12, True, "B45309"),
    ("", 11, False, None),
    ("٢٣. بعد التعبئة احفظ الملف، ثم ارفعه من زر «رفع أنواع العقود والمراحل والدفعات من Excel».",
     12, True, "1E3A5F"),
    ("٢٤. الرفع لا يحذف شيئًا · ينشئ فقط الأنواع والمراحل والدفعات غير الموجودة.",
     12, True, "15803D"),
]

# ألوان وأنماط موحّدة مع بقية قوالب النظام
_HEADER_FILL = PatternFill("solid", fgColor="1E3A5F")
_HEADER_FONT = Font(bold=True, color="FFFFFF", size=12)
_EXAMPLE_FONT = Font(italic=True, color="9AA7B5", size=11)
_NOTE_FONT = Font(bold=True, color="B45309", size=10)
_THIN = Side(style="thin", color="D9E2EC")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_CENTER = Alignment(horizontal="center", vertical="center")

#: عدد الصفوف الجاهزة للتعبئة في كل ورقة.
_READY_ROWS = 200


def _build_help_sheet(ws) -> None:
    """ورقة التعليمات (اقرأني أولاً)."""
    ws.sheet_view.rightToLeft = True
    ws.column_dimensions["A"].width = 110
    for i, (text, size, bold, color) in enumerate(INSTRUCTIONS, 1):
        cell = ws.cell(row=i, column=1, value=text)
        cell.font = Font(bold=bold, size=size, color=color or "243447")
        cell.alignment = Alignment(horizontal="right", vertical="center",
                                   wrap_text=True)
        ws.row_dimensions[i].height = 24 if size <= 12 else 32


def _build_data_sheet(ws, spec: dict) -> None:
    """ورقة بيانات: عناوين + صف مثال + شبكة صفوف جاهزة."""
    ws.sheet_view.rightToLeft = True
    cols = spec["columns"]
    for col, (head, width, _req) in enumerate(cols, 1):
        cell = ws.cell(row=1, column=col, value=head)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = _CENTER
        cell.border = _BORDER
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.row_dimensions[1].height = 26

    for col, val in enumerate(spec["example"], 1):
        cell = ws.cell(row=2, column=col, value=val)
        cell.font = _EXAMPLE_FONT
        cell.alignment = _CENTER
        cell.border = _BORDER
    ws.cell(row=2, column=len(cols) + 1,
            value="← مثال، سيتم تجاهله").font = _NOTE_FONT

    for r in range(3, _READY_ROWS + 3):
        for col in range(1, len(cols) + 1):
            c = ws.cell(row=r, column=col)
            c.border = _BORDER
            c.alignment = _CENTER
    ws.freeze_panes = "A2"


def _add_list_validation(ws, values: list[str], cell_range: str) -> None:
    """قائمة منسدلة بقيم ثابتة على نطاق خلايا."""
    dv = DataValidation(type="list",
                        formula1='"' + ",".join(values) + '"',
                        allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(cell_range)


def generate_types_template(out_path: str) -> str:
    """ينشئ قالب تأسيس الأنواع والمراحل والدفعات في ``out_path``.

    يرجع المسار الفعلي للملف بعد الحفظ.
    """
    directory = os.path.dirname(os.path.abspath(out_path))
    if directory:
        os.makedirs(directory, exist_ok=True)

    wb = Workbook()

    # ورقة التعليمات أولًا (الورقة الافتراضية)
    _build_help_sheet(wb.active)
    wb.active.title = SHEET_HELP

    # أوراق البيانات الثلاث بالترتيب المتفق عليه
    for sheet_name in (SHEET_TYPES, SHEET_STAGES, SHEET_PAYMENTS):
        _build_data_sheet(wb.create_sheet(sheet_name), SPEC[sheet_name])

    last = _READY_ROWS + 2
    # أنواع العقود: طريقة التسعير + نعم/لا لعمودي «نشط» و«عقد إشراف»
    ws_types = wb[SHEET_TYPES]
    _add_list_validation(ws_types, PRICING_KINDS, f"B3:B{last}")
    _add_list_validation(ws_types, YES_NO, f"C3:C{last}")
    _add_list_validation(ws_types, YES_NO, f"D3:D{last}")
    # الدفعات: نوع الدفعة
    _add_list_validation(wb[SHEET_PAYMENTS], PAYMENT_KINDS, f"D3:D{last}")

    wb.save(out_path)
    return out_path


def default_template_path() -> str:
    """مسار القالب الجاهز داخل مجلد assets/import_templates."""
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(app_dir, "assets", "import_templates", TEMPLATE_FILENAME)


if __name__ == "__main__":  # توليد يدوي سريع للقالب
    print(generate_types_template(default_template_path()))


# ============================================================
# المرحلة 2 — قراءة القالب والتحقق منه ثم تنفيذ الرفع
#
# مبدأ السلامة المعتمد:
#   · القراءة والتحقق لا يكتبان أي شيء في قاعدة البيانات إطلاقًا.
#   · التنفيذ «يضيف فقط» (Add-only): لا يحذف ولا يعدّل أي نوع أو
#     مرحلة أو دفعة موجودة مسبقًا · الموجود يُتخطّى ويُذكر في التقرير.
# ============================================================


class TemplateError(Exception):
    """خطأ عام في قراءة قالب التأسيس."""


def _txt(value) -> str:
    """نص منظّف من خلية إكسل (None ← '')."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _num(value, default: float = 0.0) -> float:
    """رقم من خلية إكسل مع تحمّل الفواصل والنِّسَب المكتوبة نصًا."""
    raw = _txt(value).replace("%", "").replace(",", "").replace("٪", "")
    if not raw:
        return default
    # تحويل الأرقام العربية الهندية إن وُجدت
    raw = raw.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    try:
        return float(raw)
    except ValueError:
        raise TemplateError(f"قيمة رقمية غير صالحة: «{_txt(value)}»")


def _int(value, default: int = 0) -> int:
    return int(round(_num(value, default)))


def _yes(value, default: bool = False) -> bool:
    """قراءة عمود نعم/لا بتسامح."""
    raw = _txt(value).lower()
    if not raw:
        return default
    return raw in ("نعم", "yes", "true", "1", "y", "صح", "✓")


def _pricing_mode(value) -> str:
    """تحويل نص «طريقة التسعير» في القالب إلى كود النظام."""
    from services import contract_type_service as cts
    raw = _norm(_txt(value))
    if not raw:
        raise TemplateError("طريقة التسعير مطلوبة: مقطوع / بند مقابل سعر / وحدة * سعر.")
    if raw in {"مقطوع", "مبلغ مقطوع", "lump", "fixed"} or "مقطوع" in raw:
        return cts.MODE_LUMP
    if raw in {"وحده سعر", "وحده * سعر", "وحده × سعر", "unit"} or ("وحد" in raw and "سعر" in raw):
        return cts.MODE_UNIT
    if raw in {"بند مقابل سعر", "بنود مقابل اسعار", "items"} or "بند" in raw or "بنود" in raw:
        return cts.MODE_ITEMS
    raise TemplateError("طريقة التسعير يجب أن تكون: مقطوع، بند مقابل سعر، أو وحدة * سعر.")


def _norm(text: str) -> str:
    """تطبيع عربي موحّد للمقارنة (يستخدم أداة البحث الرسمية للنظام)."""
    from services.search_utils import normalize
    return normalize(text)


def _is_example_row(sheet_name: str, row_vals: list) -> bool:
    """هل هذا هو صف المثال الرمادي الأصلي للقالب؟ (يُتجاهل دائمًا)

    المقارنة تتم مع صف المثال المعرّف في SPEC نفسه، فلو عدّل المستخدم
    الصف وكتب بيانات حقيقية مكانه فلن يُتجاهل.
    """
    example = SPEC.get(sheet_name, {}).get("example", [])
    if not example:
        return False
    for i, expected in enumerate(example):
        got = _txt(row_vals[i]) if i < len(row_vals) else ""
        if _norm(got) != _norm(_txt(expected)):
            return False
    return True


def _iter_rows(ws, sheet_name: str, n_cols: int):
    """يمرّ على صفوف البيانات ويتخطى الصف الفارغ وصف المثال."""
    for idx, row in enumerate(ws.iter_rows(min_row=2, max_col=n_cols,
                                           values_only=True), start=2):
        vals = list(row) + [None] * (n_cols - len(row))
        if not any(_txt(v) for v in vals):
            continue
        if idx == 2 and _is_example_row(sheet_name, vals):
            continue
        yield idx, vals


def read_template(path: str) -> dict:
    """يقرأ القالب ويتحقق منه بالكامل بدون أي كتابة في قاعدة البيانات.

    يرجع قاموسًا:
        {
          "types":    [ {...}, ... ],
          "stages":   [ {...}, ... ],
          "payments": [ {...}, ... ],
          "errors":   ["..."],
          "warnings": ["..."],
          "counts":   {"types": n, "stages": n, "payments": n},
        }
    """
    from openpyxl import load_workbook

    if not path or not os.path.exists(path):
        raise TemplateError("الملف غير موجود.")
    try:
        wb = load_workbook(path, data_only=True)
    except Exception:
        raise TemplateError("تعذر فتح الملف · تأكد أنه ملف Excel بصيغة xlsx.")

    missing = [s for s in (SHEET_TYPES, SHEET_STAGES, SHEET_PAYMENTS)
               if s not in wb.sheetnames]
    if missing:
        raise TemplateError(
            "الملف ليس بنفس بنية القالب · الأوراق الناقصة: "
            + " · ".join(missing))

    errors: list[str] = []
    warnings: list[str] = []

    # ---------- 1) أنواع العقود ----------
    types: list[dict] = []
    seen_types: dict[str, str] = {}     # مطبّع ← الاسم كما كُتب
    ws = wb[SHEET_TYPES]
    for rno, vals in _iter_rows(ws, SHEET_TYPES, 5):
        name = _txt(vals[0])
        if not name:
            errors.append(f"«{SHEET_TYPES}» صف {rno}: «نوع العقد» مطلوب.")
            continue
        try:
            pricing_mode = _pricing_mode(vals[1])
        except TemplateError as exc:
            errors.append(f"«{SHEET_TYPES}» صف {rno}: {exc}")
            continue
        key = _norm(name)
        if key in seen_types:
            errors.append(f"«{SHEET_TYPES}» صف {rno}: النوع «{name}» مكرر "
                          f"(سبق في «{seen_types[key]}»).")
            continue
        seen_types[key] = name
        types.append({
            "row": rno,
            "name": name,
            "pricing_mode": pricing_mode,
            "active": _yes(vals[2], True),
            "is_supervision": _yes(vals[3], False),
            "notes": _txt(vals[4]),
        })

    # ---------- 2) مراحل العقود ----------
    stages: list[dict] = []
    # لكل نوع: مجموعة أسماء المراحل المطبّعة (رئيسية وفرعية)
    type_stage_names: dict[str, set[str]] = {}
    seen_stage_keys: set[tuple[str, str, str]] = set()
    ws = wb[SHEET_STAGES]
    for rno, vals in _iter_rows(ws, SHEET_STAGES, 6):
        tname = _txt(vals[0])
        main = _txt(vals[1])
        sub = _txt(vals[2])
        if not tname:
            errors.append(f"«{SHEET_STAGES}» صف {rno}: «نوع العقد» مطلوب.")
            continue
        tkey = _norm(tname)
        if tkey not in seen_types:
            errors.append(
                f"«{SHEET_STAGES}» صف {rno}: نوع العقد «{tname}» غير موجود "
                f"في ورقة «{SHEET_TYPES}».")
            continue
        if not main:
            errors.append(
                f"«{SHEET_STAGES}» صف {rno}: «المرحلة الرئيسية» مطلوبة.")
            continue
        dup_key = (tkey, _norm(main), _norm(sub))
        if dup_key in seen_stage_keys:
            errors.append(f"«{SHEET_STAGES}» صف {rno}: المرحلة مكررة "
                          f"({main}{' / ' + sub if sub else ''}).")
            continue
        seen_stage_keys.add(dup_key)
        try:
            order = _int(vals[3], 0)
            days = _int(vals[4], 0)
        except TemplateError as exc:
            errors.append(f"«{SHEET_STAGES}» صف {rno}: {exc}")
            continue
        if order <= 0:
            errors.append(
                f"«{SHEET_STAGES}» صف {rno}: «الترتيب» رقم صحيح يبدأ من 1.")
            continue
        if days < 0:
            errors.append(
                f"«{SHEET_STAGES}» صف {rno}: «المدة بالأيام» لا تكون سالبة.")
            continue
        color = _txt(vals[5])
        if color and not color.startswith("#"):
            color = "#" + color
        if color and (len(color) != 7):
            warnings.append(
                f"«{SHEET_STAGES}» صف {rno}: لون غير مفهوم «{color}» · "
                "سيُستخدم اللون الافتراضي.")
            color = ""
        names = type_stage_names.setdefault(tkey, set())
        names.add(_norm(main))
        if sub:
            names.add(_norm(sub))
        stages.append({
            "row": rno,
            "type_name": seen_types[tkey],
            "type_key": tkey,
            "main": main,
            "sub": sub,
            "order": order,
            "days": days,
            "color": color,
        })

    # تحذير: نوع بلا أي مرحلة
    for tkey, tname in seen_types.items():
        if tkey not in type_stage_names:
            warnings.append(
                f"النوع «{tname}» بلا أي مرحلة في ورقة «{SHEET_STAGES}» · "
                "سيُنشأ النوع فقط بدون شجرة مراحل.")

    # ---------- 3) دفعات أنواع العقود ----------
    payments: list[dict] = []
    seen_pay_no: set[tuple[str, int]] = set()
    pct_totals: dict[str, float] = {}
    ws = wb[SHEET_PAYMENTS]
    for rno, vals in _iter_rows(ws, SHEET_PAYMENTS, 9):
        tname = _txt(vals[0])
        if not tname:
            errors.append(f"«{SHEET_PAYMENTS}» صف {rno}: «نوع العقد» مطلوب.")
            continue
        tkey = _norm(tname)
        if tkey not in seen_types:
            errors.append(
                f"«{SHEET_PAYMENTS}» صف {rno}: نوع العقد «{tname}» غير موجود "
                f"في ورقة «{SHEET_TYPES}».")
            continue
        try:
            pay_no = _int(vals[1], 0)
            pct = _num(vals[4], 0.0)
            amount_fixed = _num(vals[5], 0.0)
            days_offset = _int(vals[7], 0)
        except TemplateError as exc:
            errors.append(f"«{SHEET_PAYMENTS}» صف {rno}: {exc}")
            continue
        if pay_no <= 0:
            errors.append(
                f"«{SHEET_PAYMENTS}» صف {rno}: «رقم الدفعة» رقم صحيح من 1.")
            continue
        if (tkey, pay_no) in seen_pay_no:
            errors.append(f"«{SHEET_PAYMENTS}» صف {rno}: رقم الدفعة {pay_no} "
                          f"مكرر للنوع «{tname}».")
            continue
        seen_pay_no.add((tkey, pay_no))
        title = _txt(vals[2])
        if not title:
            errors.append(f"«{SHEET_PAYMENTS}» صف {rno}: «اسم الدفعة» مطلوب.")
            continue
        kind = _txt(vals[3]) or "نسبة"
        if kind not in PAYMENT_KINDS:
            errors.append(
                f"«{SHEET_PAYMENTS}» صف {rno}: «النوع» = «{kind}» غير معروف · "
                "المسموح: " + " · ".join(PAYMENT_KINDS))
            continue
        trigger = _txt(vals[6])
        link_raw = _txt(vals[8])
        link_words = [w.strip() for w in link_raw.replace("،", ",").split(",")
                      if w.strip()]
        no_stage = any(_norm(w) == _norm(NO_STAGE_TOKEN) for w in link_words)
        # كلمة الاستثناء ليست كلمة بحث — تُزال من قائمة كلمات الربط
        link_words = [w for w in link_words
                      if _norm(w) != _norm(NO_STAGE_TOKEN)]

        if kind == "مبلغ ثابت":
            if amount_fixed <= 0:
                errors.append(f"«{SHEET_PAYMENTS}» صف {rno}: النوع «مبلغ ثابت» "
                              "يتطلب قيمة في عمود «مبلغ ثابت».")
                continue
            pct = 0.0
        else:
            if pct <= 0 and amount_fixed <= 0:
                errors.append(f"«{SHEET_PAYMENTS}» صف {rno}: حدّد «النسبة» "
                              "أو «مبلغ ثابت».")
                continue
            if pct < 0 or pct > 100:
                errors.append(
                    f"«{SHEET_PAYMENTS}» صف {rno}: النسبة بين 0 و100 فقط.")
                continue
            if amount_fixed > 0:
                pct = 0.0

        if days_offset < 0:
            errors.append(
                f"«{SHEET_PAYMENTS}» صف {rno}: «أيام بعد المرحلة» لا تكون سالبة.")
            continue

        # قاعدة الاستثناء المعتمدة
        if not trigger:
            if not no_stage:
                errors.append(
                    f"«{SHEET_PAYMENTS}» صف {rno}: الدفعة «{title}» بلا "
                    f"«المرحلة المحفزة» · إن كانت فعلًا بلا مرحلة فاكتب في "
                    f"عمود «كلمة ربط» القيمة: {NO_STAGE_TOKEN}")
                continue
            warnings.append(
                f"«{SHEET_PAYMENTS}» صف {rno}: الدفعة «{title}» ({tname}) "
                f"مقبولة بلا مرحلة ({NO_STAGE_TOKEN}) · ستُنشأ كدفعة "
                "تُستحق بأيامها.")
        else:
            if no_stage:
                warnings.append(
                    f"«{SHEET_PAYMENTS}» صف {rno}: كُتبت {NO_STAGE_TOKEN} مع "
                    f"وجود مرحلة محفزة «{trigger}» · سيُعتمد ربط المرحلة.")
                no_stage = False
            known = type_stage_names.get(tkey, set())
            if _norm(trigger) not in known:
                errors.append(
                    f"«{SHEET_PAYMENTS}» صف {rno}: «المرحلة المحفزة» "
                    f"«{trigger}» غير مكتوبة للنوع «{tname}» في ورقة "
                    f"«{SHEET_STAGES}».")
                continue

        pct_totals[tkey] = pct_totals.get(tkey, 0.0) + pct
        payments.append({
            "row": rno,
            "type_name": seen_types[tkey],
            "type_key": tkey,
            "pay_no": pay_no,
            "title": title,
            "kind": kind,
            "pct": pct,
            "amount_fixed": amount_fixed,
            "trigger": trigger,
            "days_offset": days_offset,
            "link_words": link_words,
            "no_stage": no_stage,
        })

    # مجموع النسب لكل نوع
    for tkey, total in pct_totals.items():
        total = round(total, 2)
        tname = seen_types.get(tkey, tkey)
        if total > 100.0001:
            errors.append(
                f"مجموع نسب دفعات النوع «{tname}» = {total:g}% وهو أكبر "
                "من 100% · صحّح النسب.")
        elif 0 < total < 99.9999:
            warnings.append(
                f"مجموع نسب دفعات النوع «{tname}» = {total:g}% (أقل من "
                "100%) · تأكد أن هذا مقصود.")

    return {
        "types": types,
        "stages": stages,
        "payments": payments,
        "errors": errors,
        "warnings": warnings,
        "counts": {"types": len(types), "stages": len(stages),
                   "payments": len(payments)},
    }


def _existing_type_names() -> dict[str, str]:
    """أنواع العقود الموجودة فعلًا: مطبّع ← الاسم الفعلي."""
    from services import contract_type_service as cts
    return {_norm(t["name"]): t["name"] for t in cts.list_types(False)}


def execute_template(parsed: dict) -> dict:
    """ينفّذ الرفع «إضافة فقط» بعد نجاح الفحص.

    لا يحذف ولا يعدّل أي نوع أو مرحلة أو دفعة موجودة مسبقًا؛
    الموجود يُتخطّى ويُحسب في تقرير النتيجة.
    """
    from database.database import get_connection
    from services import contract_type_service as cts
    from services import workflow_service as wf

    if parsed.get("errors"):
        raise TemplateError("لا يمكن التنفيذ ومازالت هناك أخطاء في الملف.")

    stats = {
        "types_added": 0, "types_skipped": 0,
        "stages_added": 0, "stages_skipped": 0,
        "payments_added": 0, "payments_skipped": 0,
        "payments_no_stage": 0,
        "problems": [],
    }

    # ---------- 1) الأنواع ----------
    existing = _existing_type_names()
    for t in parsed["types"]:
        key = _norm(t["name"])
        if key in existing:
            stats["types_skipped"] += 1
            continue
        try:
            cts.add_type(t["name"], 0.0, t["notes"],
                         pricing_mode=t.get("pricing_mode", ""),
                         is_supervision=t["is_supervision"])
            stats["types_added"] += 1
            existing[key] = t["name"]
            if not t["active"]:
                for row in cts.list_types(False):
                    if _norm(row["name"]) == key:
                        cts.set_active(row["id"], False)
                        break
        except Exception as exc:
            stats["problems"].append(f"النوع «{t['name']}»: {exc}")
    cts.clear_cache()

    # ---------- 2) المراحل ----------
    # خريطة: (نوع مطبّع، اسم مرحلة مطبّع) ← id
    def _stage_map(type_name: str) -> dict[str, int]:
        out = {}
        with get_connection() as conn:
            for r in conn.execute(
                    "SELECT id, stage_name, parent_id FROM workflow_stages "
                    "WHERE transaction_type=? AND COALESCE(contract_type,'')=?",
                    (wf.TX_CONTRACT, type_name)).fetchall():
                out[_norm(r["stage_name"])] = int(r["id"])
        return out

    # المراحل مرتبة: الرئيسية قبل فرعياتها، وبحسب الترتيب المكتوب
    by_type: dict[str, list[dict]] = {}
    for s in parsed["stages"]:
        by_type.setdefault(s["type_key"], []).append(s)

    for tkey, rows in by_type.items():
        real_type = existing.get(tkey)
        if not real_type:
            stats["problems"].append(
                f"تعذّر إيجاد النوع «{rows[0]['type_name']}» بعد الإنشاء.")
            continue
        rows.sort(key=lambda r: (r["order"], r["row"]))
        smap = _stage_map(real_type)
        # أولًا: المراحل الرئيسية
        for s in rows:
            mkey = _norm(s["main"])
            if mkey in smap:
                continue
            try:
                sid = wf.add_stage(wf.TX_CONTRACT, s["main"],
                                   color=s["color"],
                                   parent_id=None,
                                   expected_days=(0 if s["sub"]
                                                  else s["days"]),
                                   contract_type=real_type)
                smap[mkey] = int(sid)
                stats["stages_added"] += 1
            except Exception as exc:
                stats["problems"].append(
                    f"المرحلة «{s['main']}» ({real_type}): {exc}")
        # ثانيًا: المراحل الفرعية
        for s in rows:
            if not s["sub"]:
                continue
            skey = _norm(s["sub"])
            if skey in smap:
                stats["stages_skipped"] += 1
                continue
            parent_id = smap.get(_norm(s["main"]))
            if not parent_id:
                stats["problems"].append(
                    f"المرحلة الفرعية «{s['sub']}»: لم تُنشأ أمّها "
                    f"«{s['main']}».")
                continue
            try:
                sid = wf.add_stage(wf.TX_CONTRACT, s["sub"],
                                   color=s["color"],
                                   parent_id=parent_id,
                                   expected_days=s["days"],
                                   contract_type=real_type)
                smap[skey] = int(sid)
                stats["stages_added"] += 1
            except Exception as exc:
                stats["problems"].append(
                    f"المرحلة «{s['sub']}» ({real_type}): {exc}")

        # ثالثًا: ضبط ترتيب العرض (stage_order)
        # النظام يرتّب المراحل بـ stage_order وحده، ولأننا أنشأنا كل
        # المراحل الرئيسية أولًا ثم الفرعيات فإن الترتيب الناتج يكون
        # مخلوطًا. هنا نعيد ترقيمه ليطابق ترتيب القالب تمامًا:
        # رئيسية ثم فرعياتها ثم الرئيسية التالية...
        try:
            seq: list[int] = []
            seen_main: list[str] = []
            for s in rows:
                mkey = _norm(s["main"])
                if mkey not in seen_main:
                    seen_main.append(mkey)
            for mkey in seen_main:
                mid = smap.get(mkey)
                if mid and mid not in seq:
                    seq.append(mid)
                for s in rows:
                    if _norm(s["main"]) != mkey or not s["sub"]:
                        continue
                    sid = smap.get(_norm(s["sub"]))
                    if sid and sid not in seq:
                        seq.append(sid)
            if seq:
                with get_connection() as conn:
                    for pos, sid in enumerate(seq, 1):
                        conn.execute(
                            "UPDATE workflow_stages SET stage_order=? "
                            "WHERE id=?", (pos, sid))
        except Exception as exc:
            stats["problems"].append(
                f"ترتيب مراحل «{real_type}»: {exc}")

    # ---------- 3) الدفعات ----------
    for p in parsed["payments"]:
        real_type = existing.get(p["type_key"])
        if not real_type:
            stats["problems"].append(
                f"الدفعة «{p['title']}»: النوع «{p['type_name']}» غير موجود.")
            continue
        # هل رقم الدفعة مستخدم مسبقًا؟ (إضافة فقط — لا نعدّل الموجود)
        try:
            already = any(int(x.get("pay_no") or 0) == p["pay_no"]
                          for x in wf.type_payments(real_type))
        except Exception:
            already = False
        if already:
            stats["payments_skipped"] += 1
            continue
        stage_id = None
        if p["trigger"]:
            smap = _stage_map(real_type)
            stage_id = smap.get(_norm(p["trigger"]))
            if not stage_id:
                stats["problems"].append(
                    f"الدفعة «{p['title']}» ({real_type}): تعذّر إيجاد "
                    f"المرحلة «{p['trigger']}».")
                continue
        try:
            pid = wf.add_type_payment(
                real_type, p["pay_no"], p["title"], p["pct"],
                stage_id=stage_id,
                days_offset=(p["days_offset"] if p["days_offset"] else None),
                amount_fixed=p["amount_fixed"])
            # حفظ كلمات الربط في العمود الرسمي إن كان موجودًا (أضيف بهجرة آمنة).
            link_keyword = "، ".join(p.get("link_words") or [])
            if p.get("no_stage"):
                link_keyword = (link_keyword + "، " if link_keyword else "") + NO_STAGE_TOKEN
            if link_keyword:
                with get_connection() as conn:
                    cols = {r[1] for r in conn.execute("PRAGMA table_info(type_payment_tpl)").fetchall()}
                    if "link_keyword" in cols:
                        conn.execute("UPDATE type_payment_tpl SET link_keyword=? WHERE id=?",
                                     (link_keyword, int(pid)))
            stats["payments_added"] += 1
            if p["no_stage"]:
                stats["payments_no_stage"] += 1
        except Exception as exc:
            stats["problems"].append(
                f"الدفعة «{p['title']}» ({real_type}): {exc}")

    cts.clear_cache()
    return stats


# ============================================================
# المرحلة 3 — تحليل «عقود غير محدد» واقتراح النوع (قراءة فقط)
#
# مبدأ السلامة: كل ما في هذا القسم **قراءة فقط** — لا يكتب حرفًا
# في قاعدة البيانات. الكتابة تتم حصرًا في apply_fixes() بعد
# اختيار المستخدم الصريح لكل عقد على حدة.
# ============================================================

#: قرارات الإصلاح المتاحة لكل عقد (لا يوجد غيرها).
ACT_SKIP = "skip"                 # تخطي — لا شيء إطلاقًا
ACT_TYPE_ONLY = "type_only"       # تحديث النوع فقط (لا تُمس المراحل)
ACT_TYPE_STAGES = "type_stages"   # تحديث النوع + إعادة بناء المراحل

ACTION_LABELS = {
    ACT_SKIP: "تخطي",
    ACT_TYPE_ONLY: "تحديث النوع فقط",
    ACT_TYPE_STAGES: "تحديث النوع وإعادة بناء المراحل",
}

#: مصدر الاقتراح — يُعرض للمستخدم ليعرف لماذا اقترح النظام هذا النوع.
SRC_NAME = "اسم العقد"
SRC_LINK = "كلمة الربط"
SRC_VOUCHER = "سندات القبض"
SRC_NONE = "يدوي"


def _contract_link_words() -> dict[str, list[str]]:
    """كلمات الربط لكل نوع عقد من قالب الدفعات المحفوظ.

    نقرأ عناوين الدفعات المخزّنة لكل نوع كمصدر كلمات ربط ضمني،
    إضافةً إلى اسم النوع نفسه. (كلمات القالب الصريحة تُمرَّر
    اختياريًا من ملف الإكسل عبر ``extra_links``.)
    """
    from services import contract_type_service as cts
    from services import workflow_service as wf

    out: dict[str, list[str]] = {}
    for t in cts.list_types(False):
        name = t["name"]
        if _norm(name) == _norm(UNSPECIFIED):
            continue
        words = [name]
        try:
            for p in wf.type_payments(name):
                title = _txt(p.get("title"))
                if title:
                    words.append(title)
                for w in _txt(p.get("link_keyword")).replace("،", ",").split(","):
                    w = w.strip()
                    if w and _norm(w) != _norm(NO_STAGE_TOKEN):
                        words.append(w)
        except Exception:
            pass
        out[name] = words
    return out


#: اسم النوع الافتراضي غير المحدد (نفس قيمة contract_type_service).
UNSPECIFIED = "غير محدد"


def _receipt_texts(contract_id: int) -> list[str]:
    """بيانات سندات القبض المرتبطة بعقد (للمطابقة بالكلمات)."""
    from database.database import get_connection
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT description, notes FROM vouchers "
            "WHERE vtype='receipt' AND COALESCE(cancelled,0)=0 "
            "AND contract_id=?", (contract_id,)).fetchall()
    out = []
    for r in rows:
        for key in ("description", "notes"):
            val = _txt(r[key])
            if val:
                out.append(val)
    return out


def _best_type_match(text: str, link_map: dict[str, list[str]]
                     ) -> tuple[str, str]:
    """أفضل نوع مطابق لنص · يرجع (اسم النوع أو '' ، الكلمة المطابِقة)."""
    ntext = _norm(text)
    if not ntext:
        return "", ""
    best_type, best_word = "", ""
    for tname, words in link_map.items():
        for w in words:
            nw = _norm(w)
            if len(nw) < 3:
                continue
            if nw in ntext and len(nw) > len(_norm(best_word)):
                best_type, best_word = tname, w
    return best_type, best_word


def analyze_unspecified(extra_links: dict[str, list[str]] | None = None
                        ) -> list[dict]:
    """يحلّل كل عقد نوعه فارغ أو «غير محدد» — **قراءة فقط**.

    يرجع صفًا لكل عقد يحوي: العميل · رقم العقد · اسم/وصف العقد ·
    النوع المقترح ومصدره · حالة المراحل · حالة سندات القبض ·
    وهل العقد آمن لإعادة بناء المراحل تلقائيًا أم يحتاج تحذيرًا.
    """
    from database.database import get_connection
    from services import contract_type_service as cts

    link_map = _contract_link_words()
    for tname, words in (extra_links or {}).items():
        link_map.setdefault(tname, [])
        link_map[tname].extend(words)

    rows = cts.contracts_without_type()
    # الأداء: كانت كل حالة عقد تُقرأ بأربعة استعلامات مستقلة داخل حلقة
    # (سندات · خطة سداد · تعليقات · مراحل) فتصل لآلاف الاستعلامات على
    # القواعد الكبيرة. الآن تُجمَّع كلها دفعة واحدة قبل الحلقة.
    with get_connection() as conn:
        _rec_map = {int(r["contract_id"]): (int(r["n"]), float(r["total"] or 0))
                    for r in conn.execute(
                        "SELECT contract_id, COUNT(*) AS n, "
                        "COALESCE(SUM(amount),0) AS total FROM vouchers "
                        "WHERE vtype='receipt' AND COALESCE(cancelled,0)=0 "
                        "AND contract_id IS NOT NULL "
                        "GROUP BY contract_id").fetchall()}
        _plan_map = {int(r["contract_id"]): int(r["n"]) for r in conn.execute(
            "SELECT contract_id, COUNT(*) AS n FROM payment_plan "
            "GROUP BY contract_id").fetchall()}
        _cmt_map = {}
        if _table_exists(conn, "customer_comments"):
            _cmt_map = {int(r["contract_id"]): int(r["n"]) for r in conn.execute(
                "SELECT contract_id, COUNT(*) AS n FROM customer_comments "
                "WHERE contract_id IS NOT NULL AND COALESCE(is_deleted,0)=0 "
                "GROUP BY contract_id").fetchall()}
        _stage_map: dict[int, list] = {}
        for r in conn.execute(
                "SELECT * FROM contract_stages "
                "ORDER BY contract_id, sort_order, id").fetchall():
            _stage_map.setdefault(int(r["contract_id"]), []).append(dict(r))
        # نصوص سندات القبض (تُستخدم لاقتراح النوع) — دفعة واحدة
        _vtext_map: dict[int, list] = {}
        for r in conn.execute(
                "SELECT contract_id, description, notes FROM vouchers "
                "WHERE vtype='receipt' AND COALESCE(cancelled,0)=0 "
                "AND contract_id IS NOT NULL").fetchall():
            bucket = _vtext_map.setdefault(int(r["contract_id"]), [])
            for key in ("description", "notes"):
                val = _txt(r[key])
                if val:
                    bucket.append(val)
    # ملاحظة مهمة عن بنية البيانات في هذا النظام:
    # عمود contracts.contract_name مفروض بـ TRIGGER في قاعدة البيانات
    # ليساوي دائمًا contract_type (فيصير «غير محدد» لهذه العقود)، ولذلك
    # لا يصلح للمطابقة. النص الوصفي الحقيقي للعقد موجود في description
    # (ويُدعَم notes احتياطًا) — وهو ما نعرضه ونطابق عليه.
    with get_connection() as conn:
        desc_map = {int(r["id"]): (_txt(r["description"]), _txt(r["notes"]))
                    for r in conn.execute(
                        "SELECT id, description, notes FROM contracts"
                    ).fetchall()}

    out: list[dict] = []
    for c in rows:
        cid = int(c["id"])
        desc, notes = desc_map.get(cid, ("", ""))
        # الاسم المعروض: الوصف أولًا ثم الملاحظات ثم اسم العقد المخزّن
        name = desc or notes or _txt(c.get("name"))

        # --- حالة المراحل (نسخة العقد) ---
        stages = _stage_map.get(cid, [])
        steps = [s for s in stages if int(s.get("level") or 0) == 1]
        started = [s for s in steps if _txt(s.get("start_date"))]
        finished = [s for s in steps if _txt(s.get("end_date"))]
        if not stages:
            stages_state = "بلا مراحل"
        elif finished:
            stages_state = f"تقدّم فعلي ({len(finished)} منتهية من {len(steps)})"
        elif started:
            stages_state = f"بدأت ({len(started)} جارية من {len(steps)})"
        else:
            stages_state = f"{len(steps)} مرحلة بلا بدء"

        # --- حالة سندات القبض ---
        n_rec, total_rec = _rec_map.get(cid, (0, 0.0))
        n_plan = _plan_map.get(cid, 0)
        n_comments = _cmt_map.get(cid, 0)
        receipts_state = (f"{n_rec} سند بمبلغ {total_rec:,.3f}"
                          if n_rec else "بلا سندات")

        # --- اقتراح النوع ---
        suggested, source, evidence = "", SRC_NONE, ""
        # 1) اسم/وصف العقد
        t, w = _best_type_match(desc or name, link_map)
        if t:
            suggested, source, evidence = t, SRC_NAME, w
        # 2) كلمة الربط داخل ملاحظات العقد
        if not suggested:
            t, w = _best_type_match(notes, link_map)
            if t:
                suggested, source, evidence = t, SRC_LINK, w
        # 3) بيان سندات القبض
        if not suggested:
            for txt in _vtext_map.get(cid, []):
                t, w = _best_type_match(txt, link_map)
                if t:
                    suggested, source, evidence = t, SRC_VOUCHER, w
                    break

        # --- هل إعادة البناء آمنة؟ ---
        has_progress = bool(started or finished)
        risky = bool(stages or has_progress or n_rec or n_plan or n_comments)
        reasons = []
        if finished:
            reasons.append(f"{len(finished)} مرحلة منتهية")
        elif started:
            reasons.append(f"{len(started)} مرحلة جارية")
        elif stages:
            reasons.append(f"{len(steps)} مرحلة قائمة")
        if n_rec:
            reasons.append(f"{n_rec} سند قبض")
        if n_plan:
            reasons.append(f"{n_plan} دفعة في خطة السداد")
        if n_comments:
            reasons.append(f"{n_comments} تعليق")

        out.append({
            "contract_id": cid,
            "customer_name": _txt(c.get("customer_name")),
            "contract_number": _txt(c.get("contract_number")),
            "contract_name": name,
            "amount": float(c.get("amount") or 0),
            "suggested_type": suggested,
            "source": source if suggested else SRC_NONE,
            "evidence": evidence,
            "stages_state": stages_state,
            "receipts_state": receipts_state,
            "n_receipts": n_rec,
            "n_plan": n_plan,
            "n_comments": n_comments,
            "n_stages": len(stages),
            "has_progress": has_progress,
            "risky": risky,
            "risk_reasons": " · ".join(reasons),
            # الافتراض الآمن: العقد النظيف يُعاد بناؤه · وغيره «النوع فقط»
            "default_action": (ACT_TYPE_STAGES if not risky
                               else ACT_TYPE_ONLY),
        })
    return out


def _table_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,)).fetchone()
    return row is not None


# ============================================================
# المرحلة 4 و5 — تنفيذ الإصلاح وربط سندات القبض
#
# محرّمات مطلقة مطبّقة في الكود أدناه:
#   · لا يُحذف أي عقد أو عميل إطلاقًا.
#   · لا تُعدَّل ولا تُلغى قيمة أي سند قبض إطلاقًا.
#   · لا يُنقل أي سند قبض من عقد لعقد آخر إطلاقًا.
#   · لا تُحذف مرحلة عليها تقدّم فعلي إلا بتصريح مزدوج صريح
#     (اختيار «إعادة بناء المراحل» + allow_destructive=True).
#   · لا تعديل صامت: كل عقد يُنفَّذ بقراره المُرسل من الشاشة فقط.
# ============================================================


def _contract_has_progress(contract_id: int) -> bool:
    """هل على مراحل العقد تقدّم فعلي (بدء أو إنهاء)؟"""
    from services import workflow_service as wf
    for s in wf.get_contract_stages(contract_id):
        if _txt(s.get("start_date")) or _txt(s.get("end_date")):
            return True
    return False


def _rebuild_contract_stages(contract_id: int, type_name: str) -> tuple[int, int]:
    """يحذف نسخة مراحل العقد ويعيد بناءها من قالب النوع الجديد.

    يُستدعى فقط بعد التحقق من الإذن في apply_fixes.
    يرجع (عدد المحذوف، عدد المبني).
    """
    from database.database import get_connection
    from services import workflow_service as wf

    with get_connection() as conn:
        old_ids = [int(r["id"]) for r in conn.execute(
            "SELECT id FROM contract_stages WHERE contract_id=?",
            (contract_id,)).fetchall()]
        # فك ارتباط خطة السداد بالمراحل القديمة قبل حذفها حتى لا
        # تبقى إشارات معلّقة (لا نحذف أي دفعة من خطة السداد).
        if old_ids:
            marks = ",".join("?" * len(old_ids))
            conn.execute(
                f"UPDATE payment_plan SET stage_id=NULL "
                f"WHERE stage_id IN ({marks})", old_ids)
            conn.execute("DELETE FROM contract_stages WHERE contract_id=?",
                         (contract_id,))
        row = conn.execute(
            "SELECT COALESCE(NULLIF(start_date,''), "
            "NULLIF(contract_date,'')) AS d FROM contracts WHERE id=?",
            (contract_id,)).fetchone()
    from datetime import date
    start_day = _txt(row["d"] if row else "") or date.today().isoformat()
    built = wf._build_contract_snapshot(contract_id, type_name, start_day)
    return len(old_ids), int(built or 0)


def link_receipts_for_contract(contract_id: int, type_name: str,
                               extra_links: dict[str, list[str]] | None = None
                               ) -> dict:
    """المرحلة 5 — يربط سندات قبض العقد بمرحلة/دفعة خطة السداد.

    لا يُعدِّل السند نفسه ولا مبلغه ولا عقده؛ يربط فقط بند خطة
    السداد المناسب بالمرحلة الصحيحة. السند الذي لا تُعرف مرحلته
    يُترك «بدون مرحلة» ويُذكر في التقرير — ولا يمنع الإصلاح.
    """
    from database.database import get_connection
    from services import workflow_service as wf

    res = {"linked": 0, "no_stage": 0, "details": []}
    # كلمات ربط الدفعات لهذا النوع
    pay_words: list[tuple[str, str]] = []      # (عنوان الدفعة، كلمة)
    try:
        for p in wf.type_payments(type_name):
            title = _txt(p.get("title"))
            if title:
                pay_words.append((title, title))
            for w in _txt(p.get("link_keyword")).replace("،", ",").split(","):
                w = w.strip()
                if w and _norm(w) != _norm(NO_STAGE_TOKEN):
                    pay_words.append((title or w, w))
    except Exception:
        pass
    for w in (extra_links or {}).get(type_name, []):
        pay_words.append((w, w))

    with get_connection() as conn:
        receipts = conn.execute(
            "SELECT id, voucher_number, description, notes, amount "
            "FROM vouchers WHERE vtype='receipt' "
            "AND COALESCE(cancelled,0)=0 AND contract_id=? ORDER BY id",
            (contract_id,)).fetchall()
        plan = conn.execute(
            "SELECT id, title, stage_id FROM payment_plan "
            "WHERE contract_id=? ORDER BY sort_order, id",
            (contract_id,)).fetchall()
        stages = {_norm(r["name"]): int(r["id"]) for r in conn.execute(
            "SELECT id, name FROM contract_stages WHERE contract_id=?",
            (contract_id,)).fetchall()}

    plan_by_title = {_norm(_txt(p["title"])): dict(p) for p in plan}
    for v in receipts:
        text = " ".join([_txt(v["description"]), _txt(v["notes"])])
        ntext = _norm(text)
        matched_title = ""
        for title, word in pay_words:
            nw = _norm(word)
            if len(nw) >= 3 and nw in ntext:
                matched_title = title
                break
        target = plan_by_title.get(_norm(matched_title)) if matched_title else None
        if target and not target.get("stage_id"):
            sid = stages.get(_norm(matched_title))
            if sid:
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE payment_plan SET stage_id=? WHERE id=?",
                        (sid, int(target["id"])))
                res["linked"] += 1
                res["details"].append(
                    f"سند {_txt(v['voucher_number'])} ← دفعة «{matched_title}»")
                continue
        res["no_stage"] += 1
        res["details"].append(
            f"سند {_txt(v['voucher_number'])} ← بلا مرحلة "
            f"({NO_STAGE_TOKEN}) · يبقى كما هو بلا أي تعديل")
    return res


def apply_fixes(decisions: list[dict], allow_destructive: bool = False,
                link_receipts: bool = True,
                extra_links: dict[str, list[str]] | None = None) -> dict:
    """ينفّذ قرارات الإصلاح عقدًا عقدًا — لا شيء ضمنيًا.

    ``decisions``: [{"contract_id": int, "type_name": str,
                     "action": ACT_*}]
    ``allow_destructive``: إذن صريح ثانٍ لإعادة بناء مراحل عقد عليه
    تقدّم فعلي · بدونه يُحوَّل القرار تلقائيًا إلى «النوع فقط»
    ويُذكر ذلك في التقرير (لا تعديل صامت في الاتجاه الخطر).
    """
    from database.database import get_connection
    from services import contract_type_service as cts

    stats = {
        "type_updated": 0, "stages_rebuilt": 0, "skipped": 0,
        "downgraded": 0, "receipts_linked": 0, "receipts_no_stage": 0,
        "problems": [], "log": [],
    }
    valid_types = {_norm(t["name"]): t["name"] for t in cts.list_types(False)}

    for d in decisions or []:
        cid = int(d.get("contract_id") or 0)
        action = _txt(d.get("action")) or ACT_SKIP
        tname = _txt(d.get("type_name"))
        if not cid or action == ACT_SKIP:
            stats["skipped"] += 1
            continue
        real_type = valid_types.get(_norm(tname))
        if not real_type:
            stats["problems"].append(
                f"عقد #{cid}: النوع «{tname}» غير موجود — لم يُنفَّذ شيء.")
            continue

        # حماية مزدوجة: تقدّم فعلي + إعادة بناء = يتطلب إذنًا صريحًا
        if action == ACT_TYPE_STAGES and _contract_has_progress(cid) \
                and not allow_destructive:
            action = ACT_TYPE_ONLY
            stats["downgraded"] += 1
            stats["log"].append(
                f"عقد #{cid}: عليه تقدّم فعلي — نُفِّذ «تحديث النوع فقط» "
                "ولم تُمس مراحله.")

        try:
            with get_connection() as conn:
                conn.execute("UPDATE contracts SET contract_type=? WHERE id=?",
                             (real_type, cid))
            stats["type_updated"] += 1
        except Exception as exc:
            stats["problems"].append(f"عقد #{cid}: تعذّر تحديث النوع — {exc}")
            continue

        if action == ACT_TYPE_STAGES:
            try:
                removed, built = _rebuild_contract_stages(cid, real_type)
                stats["stages_rebuilt"] += 1
                stats["log"].append(
                    f"عقد #{cid}: أُعيد بناء المراحل ({built} مرحلة) "
                    f"بعد إزالة {removed} قديمة.")
            except Exception as exc:
                stats["problems"].append(
                    f"عقد #{cid}: تعذّرت إعادة بناء المراحل — {exc}")

        if link_receipts:
            try:
                r = link_receipts_for_contract(cid, real_type, extra_links)
                stats["receipts_linked"] += r["linked"]
                stats["receipts_no_stage"] += r["no_stage"]
                stats["log"].extend(f"عقد #{cid}: {x}" for x in r["details"])
            except Exception as exc:
                stats["problems"].append(
                    f"عقد #{cid}: تعذّر ربط سندات القبض — {exc}")

    cts.clear_cache()
    return stats
