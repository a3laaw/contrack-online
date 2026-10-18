# -*- coding: utf-8 -*-
"""مركز التقارير · بطاقات، وكل تقرير يفتح صفحة داخلية فيها:
فلتر فترة احترافي (هذا الشهر/الشهر الماضي/هذه السنة/مخصصة) + جدول معاينة
حي + طباعة PDF + تصدير Excel.
"""
import os
import tempfile
from datetime import datetime

from PySide6.QtCore import Qt, QDate
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (QSizePolicy, 
    QButtonGroup, QFileDialog, QFrame, QGridLayout, QHBoxLayout,
    QHeaderView, QLabel, QPushButton, QScrollArea, QStackedWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from services.search_utils import contains as search_contains
from ui import style
from ui.style import soft_shadow


# ============================================================
# بيانات كل تقرير · دالة واحدة ترجع مواصفات الجدول كاملة
# ============================================================
def _data_customers(date_from="", date_to="", option="all"):
    """تقرير العملاء والأرصدة الموحّد.

    يدمج ثلاثة تقارير في تقرير واحد بكل ميزاتها:
      • «العملاء والأرصدة» (الإجماليات على مستوى العميل).
      • «مستحقات العملاء» (العقود التي عليها مبالغ متبقية).
      • «المستحقات» (الأقساط/الدفعات المجدولة المتأخرة أو المستحقة).

    كل عميل في سطر، تحته:
      ↳ عقد:  العقود التي عليها رصيد متبقٍ.
      ↳ دفعة: الدفعات التي حلّ أجلها فعلًا (المستحق الآن — V4.3 صارم).
    العمود الرئيسي «المستحق الآن»: ما حلّ أجله فعلًا فقط (متأخر/جزئي
    متأخر) — وعقد بلا خطة دفعات: كامل متبقيه. «المتبقي» الكلي يبقى
    عمودًا ثانيًا. تفاصيل الباطن في لوحة مستحقات الباطن فقط (لا تكرار).
    الإجماليات في آخر التقرير.
    option="by_stages" (V4.5): عرض مسطح بالمراحل (عميل × عقد × مرحلة)
    بدل الشجرة — دمج بطاقة «مستحقات المراحل» هنا.
    """
    from services import report_service
    # V4.5: وضع «بالمراحل» مدمج هنا (بطاقة مستحقات المراحل أُلغيت).
    if option == "by_stages":
        return _data_stage_dues("all")
    customers = report_service.customers_balances(date_from, date_to)
    dues = report_service.dues_report(date_from, date_to)
    installments = report_service.overdue_installments(
        date_from, date_to, strict=True)
    due_by_contract = report_service.due_now_by_contract(date_from, date_to)
    due_by_customer = report_service.due_now_by_customer(date_from, date_to)

    # اجمع العقود ذات المتبقي لكل عميل
    by_customer: dict[str, list] = {}
    for r in dues["rows"]:
        by_customer.setdefault(r["customer_name"], []).append(
            ("contract", r))
    # اجمع الأقساط/الدفعات المتأخرة لكل عميل
    for r in installments["rows"]:
        by_customer.setdefault(r["customer_name"], []).append(
            ("installment", r))

    t = customers["totals"]
    rows = []
    kinds: list[tuple[str, int]] = []   # (نوع الصف، عدد الأبناء)
    for c in customers["rows"]:
        children = by_customer.get(c["name"], [])
        # فلتر ذكي: عملاء عليهم رصيد/دفعات مستحقة فقط
        has_balance = (c["remaining"] or 0) > 0.001 or bool(children)
        if option == "with_balance" and not has_balance:
            continue
        # «بلا رصيد»: العملاء المسدّدون بالكامل (ولهم عقود فعلًا)
        if option == "no_balance" and (has_balance
                                       or not (c["contracts_count"] or 0)):
            continue
        due_cust = due_by_customer.get(c["name"], 0.0)
        if option == "due_only" and not due_cust > 0.001:
            continue
        # ---- صف العميل (الأب) ----
        n_pay = sum(1 for k, _ in children if k == "installment")
        bits = []
        if c["contracts_count"]:
            bits.append(f"{c['contracts_count']} عقد")
        if n_pay:
            bits.append(f"{n_pay} دفعة مستحقة")
        summary = " · ".join(bits)
        if due_cust > 0.001:
            cstatus = "مستحق الآن"
        elif (c["remaining"] or 0) > 0.001:
            cstatus = "عليه رصيد"
        elif (c["contracts_value"] or 0) > 0.001:
            cstatus = "مسدّد بالكامل"
        else:
            cstatus = ""
        rows.append([c["name"], summary, c["phone"] or "", "",
                     c["contracts_count"], c["contracts_value"],
                     c["collected"], due_cust, c["remaining"], cstatus])
        kinds.append(("customer", len(children)))

        # ---- صفوف العقود ثم الدفعات (الأبناء) ----
        for kind, d in children:
            if kind == "contract":
                rows.append([
                    "", d["contract_name"] or "عقد", "",
                    d.get("last_receipt", ""), "",
                    d["value"], d["collected"],
                    due_by_contract.get(d["contract_number"], 0.0),
                    d["remaining"], "متبقٍ عقد"])
                kinds.append(("contract", 0))
            else:
                rows.append([
                    "", d["title"] or "دفعة مجدولة", "",
                    d["due_date"], "", "", "",
                    d["remaining"], "", d.get("status", "مستحق")])
                kinds.append(("installment", 0))

    due_total = sum(due_by_customer.get(c["name"], 0.0)
                    for c in customers["rows"])
    return {
        "heads": ["اسم العميل", "البيان", "الهاتف", "الاستحقاق",
                  "العقود", "قيمة العقود", "المحصّل",
                  "المستحق الآن", "المتبقي", "الحالة"],
        "widths": [40, 44, 19, 19, 10, 23, 21, 21, 21, 20],
        "rows": rows,
        "totals": ["الإجمالي العام",
                   f"{len(customers['rows'])} عميل", "", "",
                   sum(c["contracts_count"] for c in customers["rows"]),
                   t["contracts"], t["collected"], due_total,
                   t["remaining"], ""],
        "note": (f"عدد العملاء: {len(customers['rows'])}   |   "
                 f"عقود عليها متبقٍ: {len(dues['rows'])}   |   "
                 f"دفعات مستحقة: {len(installments['rows'])}   |   "
                 f"إجمالي المستحق الآن: {due_total:,.3f}   |   "
                 f"إجمالي المتبقي: {t['remaining']:,.3f}"),
        "color_cols": {6: "green", 7: "auto", 8: "auto"},
        "number_cols": [4, 5, 6, 7, 8],
        # بنية شجرية: لكل صف نوعه وعدد أبنائه — تُستخدم للطي على
        # الشاشة ولإبراز اسم العميل عند الطباعة.
        "row_kinds": kinds,
        "tree": True,
        "name_col": 0,
        "bayan_col": 1,
    }


def _data_dues(date_from="", date_to=""):
    """تقرير المستحقات (محفوظ للتوافق الخلفي — مدموج في العملاء والأرصدة)."""
    return _data_customers(date_from, date_to)


# الدفعات المستحقة مدموجة في «العملاء والأرصدة» (سطر ↳ قسط)
_data_installments = _data_customers


def _data_subcontractors(subcontractor_id=None, customer_id=None):
    from services import report_service
    d = report_service.subcontractors_report(subcontractor_id, customer_id)
    t = d["totals"]
    return {
        "heads": ["رقم المقاول", "اسم المقاول", "الهاتف", "عدد عقود الباطن",
                  "قيمة العقود", "المنصرف له", "المتبقي له"],
        "widths": [24, 52, 28, 26, 34, 34, 34],
        "rows": [[r["code"], r["name"], r["phone"], r["contracts_count"],
                  r["contracts_value"], r["paid"], r["remaining"]]
                 for r in d["rows"]],
        "totals": ["", "الإجمالي", "", "", t["value"], t["paid"],
                   t["remaining"]],
        "note": f"عدد المقاولين: {len(d['rows'])} · "
                f"إجمالي المتبقي لهم: {t['remaining']:,.3f}",
        "color_cols": {5: "red", 6: "auto"},
        "number_cols": [4, 5, 6],
    }


def _data_stage_dues(option="all"):
    """V4.4: مستحقات العملاء بالمراحل — عميل × عقد × مرحلة."""
    from services import report_service
    d = report_service.stage_dues(option or "all")
    t = d["totals"]
    heads = ["العميل", "العقد", "المرحلة", "انتهت بتاريخ", "الدفعات",
             "المستحق الآن", "المتبقي", "الحالة"]
    return {
        "heads": heads,
        "widths": [44, 34, 44, 26, 52, 28, 28, 28],
        "rows": [[r["customer"], r["contract"], r["stage"], r["ended"],
                  r["titles"], r["due"], r["remaining"], r["status"]]
                 for r in d["rows"]],
        "totals": ["", "", "", "", "الإجمالي", t["due_now"],
                   t["remaining"], ""],
        "note": ("السطور: " + str(t["n"]) + " · المستحق الآن: "
                 + format(t["due_now"], ",.3f") + " · المتبقي: "
                 + format(t["remaining"], ",.3f") + " · متأخر: "
                 + str(t["overdue_n"])),
        "color_cols": {5: "auto", 7: "status"},
        "number_cols": [5, 6],
    }


def _data_dues_board(option="all"):
    """V4.3: لوحة مستحقات الباطن — سطور الصرف فقط (العملاء في الأرصدة)."""
    from services import report_service
    d = report_service.dues_board(option or "all")
    t = d["totals"]
    heads = ["العقد", "المقاول", "المرحلة", "الدفعة", "الاستحقاق",
             "المبلغ", "المدفوع", "المتبقي", "الحالة", "المصدر",
             "مصادر التحصيل"]
    return {
        "heads": heads,
        "widths": [34, 44, 44, 44, 30, 32, 32, 32, 30, 22, 52],
        "rows": [[r["contract"], r["party"], r["stage"], r["title"],
                  r["due"], r["amount"], r["paid"], r["remaining"],
                  r["status"], r["source"], r.get("sources") or ""]
                 for r in d["rows"]],
        "totals": ["", "الإجمالي", "", "", "",
                   sum(r["amount"] for r in d["rows"]),
                   sum(r["paid"] for r in d["rows"]),
                   t["sub_remaining"], "", "", ""],
        "note": ("السطور: " + str(t["n"]) + " · متبقي الصرف: "
                 + format(t["sub_remaining"], ",.3f") + " · متأخر: "
                 + str(t["overdue_n"])),
        "color_cols": {7: "auto", 8: "status"},
        "number_cols": [5, 6, 7],
    }


def _data_vouchers_unified(date_from="", date_to="", vtype=None):
    from services import lifecycle_service as _lc
    from services import report_service
    d = report_service.vouchers_period(date_from or "0000-01-01",
                                       date_to or "9999-12-31", vtype)
    if True:
        return {
            "heads": ["رقم السند", "النوع", "التاريخ", "الطرف", "العقد",
                      "طريقة الدفع", "المبلغ", "البيان"],
            "widths": [26, 16, 24, 40, 42, 22, 28, 40],
            "rows": [[r["voucher_number"],
                      _lc.voucher_type_label(r["vtype"]),
                      r["vdate"], r["party"], _contract_label(r),
                      r["method"] or "", r["amount"],
                      r["description"] or ""] for r in d["rows"]],
            "totals": None,
            "note": (f"إجمالي الوارد: {d['total_in']:,.3f}   |   "
                     f"إجمالي المنصرف: {d['total_out']:,.3f}   |   "
                     f"المسترد: {d['recoveries']:,.3f}   |   "
                     f"صافي الحركة: {d['net']:,.3f}"),
            "color_cols": {},
            "number_cols": [6],
        }


def _data_profitability(customer_id=None, contract_id=None):
    from services import report_service
    d = report_service.profitability_report(customer_id, contract_id)
    t = d["totals"]
    return {
        "heads": ["العميل", "العقد", "نوع العقد", "قيمة العقد",
                  "المحصّل", "المنصرف الفعلي", "الربح الفعلي",
                  "تكلفة متوقعة", "ربح متوقع", "الهامش %"],
        "widths": [34, 46, 22, 24, 24, 24, 24, 24, 24, 16],
        "rows": [[r["customer_name"], _contract_label(r), 
                  r.get("contract_type", ""), r["value"], r["collected"],
                  r["actual_cost"], r["actual_profit"],
                  r["expected_cost"], r["expected_profit"],
                  f"{r['margin']:.1f}%"]
                 for r in d["rows"]],
        "totals": ["الإجمالي", "", "", t["value"], t["collected"],
                   t["cost"], t["profit"], t.get("expected_cost", 0),
                   t.get("expected_profit", 0),
                   (f"{t['profit']/t['collected']*100:.1f}%"
                    if t["collected"] > 0.001 else "-")],
        "note": (f"عدد العقود: {len(d['rows'])}   |   "
                 f"الفعلي = إجمالي المحصل - إجمالي المنصرف   |   "
                 f"المتوقع = إجمالي العقد - عقود الباطن - المنصرف الآخر عليه"),
        "color_cols": {4: "green", 5: "red", 6: "profit", 7: "red", 8: "profit"},
        "number_cols": [3, 4, 5, 6, 7, 8],
        "right_align_cols": (0, 1),
    }


def _data_customer_profitability(customer_id=None, contract_id=None):
    """ربحية العميل بكل عقوده: العميل أولًا وتحته تفاصيل العقود.

    ملاحظة: أُزيل هذا التقرير من قائمة التقارير لأنه مكرر مع
    «تقرير العقود ← الربحية» الذي يعرض نفس البيانات. الدالة تُركت
    كما هي للتوافق مع الاختبارات وأي نداء قديم، ويمكن إعادة إظهاره
    بإضافة تعريفه في ``_REPORTS`` عند الحاجة.
    """
    from services import report_service
    d = report_service.profitability_report(customer_id, contract_id)
    grouped: dict[str, list] = {}
    for r in d["rows"]:
        grouped.setdefault(r["customer_name"], []).append(r)
    rows = []
    for customer in sorted(grouped):
        items = grouped[customer]
        cv = sum(float(x["value"] or 0) for x in items)
        cc = sum(float(x["collected"] or 0) for x in items)
        ca = sum(float(x["actual_cost"] or 0) for x in items)
        cap = sum(float(x["actual_profit"] or 0) for x in items)
        ce = sum(float(x["expected_cost"] or 0) for x in items)
        cep = sum(float(x["expected_profit"] or 0) for x in items)
        margin = f"{(cap / cc * 100):.1f}%" if cc > 0.001 else "-"
        rows.append([customer, "إجمالي العميل", "", cv, cc, ca, cap, ce, cep, margin])
        for r in items:
            rows.append([customer, "  ↳ " + _contract_label(r),
                         r.get("contract_type", ""),
                         r["value"], r["collected"], r["actual_cost"],
                         r["actual_profit"], r["expected_cost"],
                         r["expected_profit"], f"{r['margin']:.1f}%"])
    t = d["totals"]
    return {
        "heads": ["العميل", "العقد", "نوع العقد", "قيمة العقود",
                  "المحصّل", "المنصرف الفعلي", "الربح الفعلي",
                  "تكلفة متوقعة", "ربح متوقع", "الهامش %"],
        "widths": [34, 50, 22, 24, 24, 24, 24, 24, 24, 16],
        "rows": rows,
        "totals": ["الإجمالي العام", "", "", t["value"], t["collected"],
                   t["cost"], t["profit"], t.get("expected_cost", 0),
                   t.get("expected_profit", 0),
                   (f"{t['profit']/t['collected']*100:.1f}%" if t["collected"] > 0.001 else "-")],
        "note": f"ربحية العميل بكل عقوده · العملاء: {len(grouped)} · العقود: {len(d['rows'])}",
        "color_cols": {4: "green", 5: "red", 6: "profit", 7: "red", 8: "profit"},
        "number_cols": [3, 4, 5, 6, 7, 8],
        "indent_col": 1,
        "right_align_cols": (0, 1),
    }


def _data_prospects(date_from="", date_to=""):
    from services import report_service
    d = report_service.prospects_report(date_from, date_to)
    return {
        "heads": ["رقم العميل", "الاسم", "الهاتف", "العنوان",
                  "تاريخ التسجيل", "منذ (يوم)", "ملاحظات"],
        "widths": [24, 50, 26, 40, 30, 20, 40],
        "rows": [[r["customer_code"], r["name"], r["phone"] or "",
                  r["address"] or "", r["reg_date"] or "",
                  str(int(r["days_since"] or 0)), r["notes"] or ""]
                 for r in d["rows"]],
        "totals": None,
        "note": (f"عدد الفرص البيعية (عملاء بلا عقود): {d['count']} · "
                 "تواصل معهم لتحويلهم لعقود"),
        "color_cols": {},
        "number_cols": [],
    }


def _data_supervision_delays(option="unpaid"):
    """تقرير الإشراف · الأعمدة كما اعتمدها المستخدم:

    العميل · العنوان · تاريخ بداية الإشراف (تاريخ التعهد) ·
    مدة العقد الأساسي (من عقد الإشراف) ·
    مدة التمديد (المدفوعة بسندات قبض بعد نهاية العقد) ·
    نهاية المدة كاملة (البداية + الأساسية + التمديد) ·
    التأخير شهور (اليوم - نهاية المدة كاملة) · التأخير مبالغ.

    option="unpaid": التي عليها تأخير فعلي فقط (الافتراضي)
    option="all":    كل عقود الإشراف التي تجاوزت مدتها الأساسية
    """
    from services import report_service
    d = report_service.supervision_delays_report(
        only_unpaid=(option != "all"))
    t = d["totals"]
    return {
        "heads": ["العميل", "العنوان", "تاريخ بداية الإشراف",
                  "مدة العقد الأساسي", "التمديد المدفوع", "المدة الملغاة",
                  "سبب الإلغاء", "نهاية المدة كاملة",
                  "التأخير (شهور وأيام)", "التأخير (مبالغ)"],
        "widths": [36, 38, 24, 20, 20, 20, 40, 24, 30, 24],
        "rows": [[r["customer_name"], r["address"], r["sup_start"],
                  f"{r['months']:g} شهر",
                  f"{r['paid_extension_months']:g} شهر",
                  f"{r['waived_months']:g} شهر" if r.get("waived_months") else "—",
                  r.get("waive_reason") or "—",
                  r["full_end"],
                  r["delay_text"],
                  r["delay_value"]]
                 for r in d["rows"]],
        "totals": ["الإجمالي", "", "", f"{t['base_months']:g} شهر",
                   f"{t['paid_extension_months']:g} شهر",
                   f"{t.get('waived_months', 0):g} شهر", "", "",
                   f"{t['delay_months']:g} شهر محتسب", t["delay_value"]],
        "note": (f"عقود إشراف متأخرة: {d['count']} · "
                 f"تمديد مدفوع: {t['paid_extension_months']:g} شهر "
                 f"({t['paid_extension_value']:,.3f} د.ك) · "
                 f"مدة ملغاة: {t.get('waived_months', 0):g} شهر "
                 f"({t.get('waived_value', 0):,.3f} د.ك) · "
                 f"تأخير محتسب: {t['delay_months']:g} شهر "
                 f"بقيمة {t['delay_value']:,.3f} د.ك، "
                 "وأي شهر يبدأ يُحتسب شهرًا كاملًا"
                 # V3.21: تفصيل المراحل الإشرافية المدمجة
                 + (f" · منها مراحل إشرافية: {t['stage_count']} "
                    f"(تأخيرها {t['stage_delay_months']:g} شهر "
                    f"بقيمة {t['stage_delay_value']:,.3f} د.ك)"
                    if t.get("stage_count") else "")
                 if d["count"] else
                 "لا توجد عقود إشراف متأخرة عن نهاية مدتها كاملة."),
        "color_cols": {9: "auto"},
        "number_cols": [9],
    }


def _contract_label(row) -> str:
    """رقم العقد واسمه في خانة واحدة: «CON-0001 · اشراف شهري».

    يتحمّل غياب أحدهما، ويتجاهل الاسم إن كان مساويًا للرقم أو
    «غير محدد» (عمود contract_name مفروض بـ TRIGGER ليساوي نوع العقد).
    """
    if hasattr(row, "get"):
        num = str(row.get("contract_number") or "").strip()
        name = str(row.get("contract_label")
                   or row.get("contract_name") or "").strip()
    else:
        num, name = str(row or "").strip(), ""
    if name in ("غير محدد", num, "-", "—"):
        name = ""
    if num and name:
        return f"{num} · {name}"
    return num or name or "—"


_AR_DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة",
            "السبت", "الأحد"]


def _plain_date(value: str) -> str:
    """التاريخ فقط بلا اسم اليوم — الصيغة المعتمدة في كل الجداول."""
    try:
        dt = datetime.strptime(str(value or ""), "%Y-%m-%d")
    except Exception:
        return str(value or "")
    return dt.strftime("%d/%m/%Y")


def _weekday_name(value: str) -> str:
    """اسم اليوم فقط — يُستخدم في عنوان تقرير اليوم الواحد."""
    try:
        dt = datetime.strptime(str(value or ""), "%Y-%m-%d")
    except Exception:
        return ""
    return _AR_DAYS[dt.weekday()]


def _arabic_weekday_date(value: str) -> str:
    """متوافقة مع النداءات القديمة — صارت تُرجع التاريخ بلا اسم اليوم.

    طُلب حذف اسم اليوم من كل الجداول؛ ويبقى اسم اليوم في عنوان تقرير
    اليوم الواحد فقط عبر ``_weekday_name``.
    """
    return _plain_date(value)


def _transfer_buckets(items):
    """V4.33: تقسيم التحويلات حسب الاتجاه ← (بنك→صندوق، صندوق→بنك، نفس المحفظة)."""
    a = b = s = 0.0
    for it in items:
        fw, tw = it.get("from_wallet", "cash"), it.get("to_wallet", "cash")
        if fw == "bank" and tw == "cash":
            a += it["amount"]
        elif fw == "cash" and tw == "bank":
            b += it["amount"]
        else:
            s += it["amount"]
    return a, b, s


def _partner_note(t: dict) -> str:
    """V4.40: ذيل ملاحظة الجاري (للمدير فقط)."""
    return (f" · جاري الشريك {t['partner_balance']:,.3f} د.ك")


def _data_cash_flow(option="detail", date_from="", date_to=""):

    """التقرير المالي."""
    from services import report_service
    if option == "summary":
        return _cash_flow_summary(date_from, date_to)

    d = report_service.cash_flow_detail(date_from, date_to)
    t = d["totals"]
    SEP = ""
    try:
        from services import auth_service as _auth
        _admin = _auth.is_admin()
    except Exception:
        _admin = True

    def _normal_rows(items):
        return [[n, _arabic_weekday_date(it["date"]), it["party"],
                 it["contract"], it["amount"], it["note"]]
                for n, it in enumerate(items, 1)]

    if option == "receipts_only":
        items = d["receipts"]
        return {
            "heads": ["م", "التاريخ", "العميل", "العقد", "المبلغ", "البيان"],
            "widths": [7, 22, 32, 32, 16, 66],
            "rows": _normal_rows(items),
            "totals": ["الإجمالي", "", "", "", sum(i["amount"] for i in items), ""],
            "note": f"تقرير وارد فقط · إجمالي الوارد: {sum(i['amount'] for i in items):,.3f} د.ك · العدد: {len(items)}",
            "color_cols": {4: "green"},
            "number_cols": [4],
        }

    if option == "payments_only":
        items = d["payments"]
        return {
            "heads": ["م", "التاريخ", "العميل", "العقد", "المبلغ", "البيان"],
            "widths": [7, 22, 32, 32, 16, 66],
            "rows": _normal_rows(items),
            "totals": ["الإجمالي", "", "", "", sum(i["amount"] for i in items), ""],
            "note": f"تقرير منصرف فقط · إجمالي المنصرف: {sum(i['amount'] for i in items):,.3f} د.ك · العدد: {len(items)}",
            "color_cols": {4: "red"},
            "number_cols": [4],
        }

    if option == "recoveries_only":
        items = d.get("recoveries", [])
        return {
            "heads": ["م", "التاريخ", "العميل", "العقد", "المبلغ", "البيان"],
            "widths": [7, 22, 32, 32, 16, 66],
            "rows": _normal_rows(items),
            "totals": ["الإجمالي", "", "", "", sum(i["amount"] for i in items), ""],
            "note": f"تقرير مسترد فقط · إجمالي المسترد: {sum(i['amount'] for i in items):,.3f} د.ك · العدد: {len(items)}",
            "color_cols": {4: "green"},
            "number_cols": [4],
        }

    if option == "transfers_only":
        items = d.get("transfers", [])
        rows = [[n, it["date"], it.get("from_account", ""),
                 it.get("to_account", ""), it["amount"], it["note"]]
                for n, it in enumerate(items, 1)]
        _a, _b, _s = _transfer_buckets(items)
        _net = _a - _b
        _note = (f"تقرير تحويلات داخلية فقط · من البنك إلى الصندوق: {_a:,.3f} · "
                 f"من الصندوق إلى البنك: {_b:,.3f} · الصافي (داخل الصندوق): {_net:,.3f} د.ك · "
                 f"العدد: {len(items)} · هذه الحركات لا تُحسب ضمن المنصرف ولا الوارد")
        if _s:
            _note = _note.replace(" · العدد:", f" · داخل نفس المحفظة: {_s:,.3f} · العدد:")
        return {
            "heads": ["م", "التاريخ", "من حساب", "إلى حساب", "المبلغ", "البيان"],
            "widths": [7, 18, 24, 24, 18, 42],
            "rows": rows,
            "totals": ["الصافي", "", "", "", _net, ""],
            "note": _note,
            "color_cols": {4: "auto"},
            "number_cols": [4],
        }

    rows = []

    def _section(title, items, amount_label, transfer=False):
        rows.append([SEP, f"◀ {title}", SEP, SEP, SEP, SEP])
        for n, it in enumerate(items, 1):
            if transfer:
                acct = f"{it.get('from_account', '')} ← {it.get('to_account', '')}"
                rows.append([n, _arabic_weekday_date(it["date"]), acct,
                             "", it["amount"], it["note"]])
            else:
                rows.append([n, _arabic_weekday_date(it["date"]), it["party"],
                             it["contract"], it["amount"], it["note"]])
        if not items:
            rows.append([SEP, "لا حركة في هذه الفترة", SEP, SEP, SEP, SEP])
        if transfer:
            # V4.33: التحويلات تُعرض اتجاهين + صافي (طرح لا جمع).
            _a, _b, _s = _transfer_buckets(items)
            rows.append([SEP, "تحويلات من البنك إلى الصندوق", SEP, SEP, _a, SEP])
            rows.append([SEP, "تحويلات من الصندوق إلى البنك", SEP, SEP, _b, SEP])
            if _s:
                rows.append([SEP, "تحويلات داخل نفس المحفظة", SEP, SEP, _s, SEP])
            rows.append([SEP, "صافي التحويلات", SEP, SEP, _a - _b, ""])
        else:
            rows.append([SEP, f"الإجمالي · {amount_label}", SEP, SEP,
                         sum(i["amount"] for i in items), SEP])

    _section("الوارد", d["receipts"], "الوارد")
    rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
    _section("المنصرف", d["payments"], "المنصرف")
    rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
    _section("المسترد",
             d.get("recoveries", []), "المسترد")
    if d.get("advance_returned"):
        # تنبيه: سلف مُستردّة (نقدًا أو بخصم الراتب) — لا تُحسب مصروفًا
        rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
        _section("سلف مسترجعة (غير محسوبة مصروفًا)",
                 d["advance_returned"], "السلف المسترجعة")
    if d.get("transfers"):
        rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
        _section("تحويلات داخلية", d["transfers"], "تحويلات", transfer=True)
    if _admin and d.get("partner_moves"):
        rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
        _section("حركات الشريك", d["partner_moves"], "حركات الشريك")
    try:
        from services import report_service as _rpt
        _gw = _rpt.gateway_summary(date_from, date_to)
    except Exception:
        _gw = {"pending": 0.0, "collected": 0.0, "count": 0}
    _bank = t["bank"]
    _actual = _bank - (_gw.get("pending") or 0.0)
    rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
    rows.append([SEP, "الرصيد الدفتري (بنك)", SEP, SEP, _bank,
                 ""])
    rows.append([SEP, "الرصيد الفعلي (بنك − معلّق)", SEP, SEP, _actual,
                 ""])
    rows.append([SEP, SEP, SEP, SEP, SEP, SEP])
    rows.append([SEP, "صافي الحركة", SEP, SEP, t["net"], ""])
    rows.append([SEP, "رصيد البنك", SEP, SEP, t["bank"], ""])
    rows.append([SEP, "رصيد الصندوق", SEP, SEP, t["cash"], ""])
    if _admin:
        rows.append([SEP, "رصيد جاري الشريك", SEP, SEP, t["partner_balance"], ""])

    out = {
        "heads": ["م", "التاريخ", "العميل", "العقد", "المبلغ", "البيان"],
        "widths": [7, 22, 32, 32, 16, 65],
        "rows": rows,
        "totals": None,
        "note": "",
        "color_cols": {4: "auto"},
        "number_cols": [4],
        "accent_rows": {
            "الإجمالي · الوارد": "#DCFCE7",
            "الإجمالي · المنصرف": "#FEE2E2",
            "الإجمالي · المسترد": "#D1FAE5",
            "صافي الحركة": "#DBEAFE",
            "رصيد البنك": "#FEF3C7",
            "رصيد الصندوق": "#EDE9FE",
            "رصيد جاري الشريك": "#E0E7FF",
            "الرصيد الدفتري (بنك)": "#E0E7FF",
            "الرصيد الفعلي (بنك − معلّق)": "#FEF3C7",
        },
    }
    if _admin and d.get("partner_moves"):
        out["accent_rows"]["الإجمالي · حركات الشريك"] = "#F1F5F9"
    if not _admin:
        out["accent_rows"].pop("رصيد جاري الشريك", None)
    if d.get("transfers"):
        # V4.33: مفاتيح الاتجاهين + الصافي — مشروطة بوجود تحويلات.
        out["accent_rows"]["تحويلات من البنك إلى الصندوق"] = "#FFEDD5"
        out["accent_rows"]["تحويلات من الصندوق إلى البنك"] = "#CCFBF1"
        out["accent_rows"]["صافي التحويلات"] = "#FFE4E6"
        _a, _b, _s = _transfer_buckets(d["transfers"])
        if _s:
            out["accent_rows"]["تحويلات داخل نفس المحفظة"] = "#F1F5F9"
    return out


def _cash_periods_note(t: dict, label: str, count: int) -> str:
    """V4.40: ملاحظة ملخص الفترات (الجاري للمدير فقط)."""
    if not count:
        return "لا توجد حركة مالية في هذه الفترة."
    try:
        from services import auth_service as _auth
        _admin = _auth.is_admin()
    except Exception:
        _admin = True
    _pj = (f" · حركات الشريك: {t.get('partner_net', 0):,.3f}"
           if _admin else "")
    return (f"التجميع: {label} · رصيد أول المدة: "
            f"{t['opening']:,.3f} د.ك · الوارد: {t['inflow']:,.3f} · "
            f"المنصرف: {t['outflow']:,.3f} (منها رسوم بنك "
            f"{t['bank_fees']:,.3f}) · المسترد: {t.get('recoveries', 0):,.3f}"
            f"{_pj} · رصيد آخر المدة: "
            f"{t['closing']:,.3f} د.ك")


def _cash_flow_summary(date_from="", date_to=""):
    """التقرير المالي — بالإجمالي."""
    from services import report_service
    d = report_service.cash_flow_detail(date_from, date_to)
    t = d["totals"]
    try:
        _gw = report_service.gateway_summary(date_from, date_to)
    except Exception:
        _gw = {"pending": 0.0, "collected": 0.0, "count": 0}
    _pending = float(_gw.get("pending") or 0)
    _bank = t["bank"]
    _actual = _bank - _pending
    n_all = (len(d["receipts"]) + len(d["payments"])
             + len(d.get("recoveries", [])) + len(d.get("transfers", [])))
    rows = [
        ["إجمالي الوارد", t["in"]],
        ["إجمالي المنصرف", t["out"]],
        ["إجمالي المسترد", t["recoveries"]],
        ["صافي الحركة", t["net"]],
        ["رصيد البنك", _bank],
        ["رصيد الصندوق", t["cash"]],
        ["الرصيد الدفتري (بنك)", _bank],
        ["الرصيد الفعلي (بنك − معلّق)", _actual],
    ]
    accent = {
        "إجمالي الوارد": "#DCFCE7",
        "إجمالي المنصرف": "#FEE2E2",
        "إجمالي المسترد": "#D1FAE5",
        "صافي الحركة": "#DBEAFE",
        "رصيد البنك": "#FEF3C7",
        "رصيد الصندوق": "#EDE9FE",
        "الرصيد الدفتري (بنك)": "#E0E7FF",
        "الرصيد الفعلي (بنك − معلّق)": "#FEF3C7",
    }
    note = ""
    return {
        "heads": ["البيان", "المبلغ"],
        "widths": [55, 45],
        "rows": rows,
        "totals": None,
        "note": note,
        "color_cols": {1: "auto"},
        "number_cols": [1],
        "accent_rows": accent,
        "bayan_col": 0,
    }


def _cash_flow_periods(option="auto", date_from="", date_to=""):
    """الملخص القديم بالفترات (يومي/شهري/سنوي) — يبقى متاحًا كخيار."""
    from services import report_service
    d = report_service.cash_flow_report(date_from, date_to, option)
    t = d["totals"]
    label = {"daily": "يومي", "monthly": "شهري",
             "yearly": "سنوي"}.get(d["group"], d["group"])
    return {
        "heads": ["الفترة", "الوارد", "المنصرف", "المسترد", "منها رسوم بنك",
                  "صافي الفترة", "الرصيد"],
        "widths": [36, 30, 30, 30, 28, 30, 32],
        "rows": [[r["label"], r["inflow"], r["outflow"], r["recoveries"], r["bank_fees"],
                  r["net"], r["balance"]] for r in d["rows"]],
        "totals": ["الإجمالي", t["inflow"], t["outflow"], t["recoveries"], t["bank_fees"],
                   t["net"], t["closing"]],
        "note": _cash_periods_note(t, label, d["count"]),
        "color_cols": {1: "green", 2: "red", 5: "auto", 6: "auto"},
        "number_cols": [1, 2, 3, 4, 5, 6],
    }


def _data_contract_types(option="all", date_from="", date_to=""):
    """محفوظ للتوافق — كل شيء بقي في «تقرير العقود»."""
    return _data_contracts(option, date_from, date_to)


# ============================================================


def _data_contracts(option="all", date_from="", date_to=""):
    """تقرير العقود (دمج «أنواع العقود» و«العقود القاربة على الانتهاء»).

    بثلاثة عروض:
      • all:          كل العقود (الافتراضي).
      • by_type:      ملخص مجمّع حسب نوع العقد (عدد/قيمة/محصّل/متبقي).
      • expiring:     العقود التي تنتهي خلال الفترة المحددة (أو خلال
                      أيام التنبيه المضبوطة لو الفترة فاضية).
    """
    from services import contract_type_service as cts
    from services import report_service

    if option == "by_type":
        d = cts.types_report()
        t = d["totals"]
        rows = [[r["type_name"], r["contracts_count"], r["default_amount"],
                  r["value"], r["average"], r["collected"], r["remaining"]]
                 for r in d["rows"]]
        return {
            "heads": ["نوع العقد", "عدد العقود", "المبلغ المعتمد",
                      "إجمالي القيمة", "متوسط قيمة العقد",
                      "المحصّل", "المتبقي"],
            "widths": [40, 20, 28, 32, 30, 30, 30],
            "rows": rows,
            "totals": ["الإجمالي", t["count"], "", t["value"], "",
                       t["collected"], t["remaining"]],
            "note": (f"عدد الأنواع: {len(rows)} · العقود: {t['count']} · "
                     f"القيمة: {t['value']:,.3f} · "
                     f"المحصّل: {t['collected']:,.3f} · "
                     f"المتبقي: {t['remaining']:,.3f}"),
            "color_cols": {5: "green", 6: "auto"},
            "number_cols": [1, 2, 3, 4, 5, 6],
        }

    if option == "profit_by_type":
        # ربحية مجمّعة حسب نوع العقد — نفس مصدر بيانات الربحية
        # (profitability_report) لضمان تطابق الأرقام مع باقي التقارير.
        d = report_service.profitability_report()
        agg: dict[str, dict] = {}
        for r in d["rows"]:
            k = (r.get("contract_type") or "غير محدد").strip() or "غير محدد"
            a = agg.setdefault(k, {"n": 0, "value": 0.0, "collected": 0.0,
                                   "cost": 0.0, "profit": 0.0})
            a["n"] += 1
            a["value"] += float(r["value"] or 0)
            a["collected"] += float(r["collected"] or 0)
            a["cost"] += float(r["actual_cost"] or 0)
            a["profit"] += float(r["actual_profit"] or 0)
        rows, tv, tc, tk, tp, tn = [], 0.0, 0.0, 0.0, 0.0, 0
        for name in sorted(agg):
            a = agg[name]
            margin = (f"{a['profit'] / a['collected'] * 100:.1f}%"
                      if a["collected"] > 0.001 else "-")
            avg = a["value"] / a["n"] if a["n"] else 0.0
            rows.append([name, a["n"], a["value"], avg, a["collected"],
                         a["cost"], a["profit"], margin])
            tn += a["n"]; tv += a["value"]; tc += a["collected"]
            tk += a["cost"]; tp += a["profit"]
        return {
            "heads": ["نوع العقد", "عدد العقود", "إجمالي القيمة",
                      "متوسط قيمة العقد", "المحصّل", "المنصرف الفعلي",
                      "الربح الفعلي", "الهامش %"],
            "widths": [40, 20, 30, 30, 28, 30, 28, 20],
            "rows": rows,
            "totals": ["الإجمالي", tn, tv, "", tc, tk, tp,
                       (f"{tp / tc * 100:.1f}%" if tc > 0.001 else "-")],
            "note": (f"ربحية حسب نوع العقد · الأنواع: {len(rows)} · "
                     f"العقود: {tn} · القيمة: {tv:,.3f} · "
                     f"المحصّل: {tc:,.3f} · الربح: {tp:,.3f}"),
            "color_cols": {4: "green", 5: "red", 6: "profit"},
            "number_cols": [1, 2, 3, 4, 5, 6],
            "right_align_cols": (0,),
        }

    if option == "profitability":
        d = report_service.profitability_report()
        t = d["totals"]
        return {
            "heads": ["العميل", "العقد", "نوع العقد", "قيمة العقد",
                      "المحصّل", "المنصرف الفعلي", "الربح الفعلي",
                      "تكلفة متوقعة", "ربح متوقع", "الهامش %"],
            "widths": [34, 46, 22, 24, 24, 24, 24, 24, 24, 16],
            "rows": [[r["customer_name"], _contract_label(r),
                      r.get("contract_type", ""), r["value"], r["collected"],
                      r["actual_cost"], r["actual_profit"],
                      r["expected_cost"], r["expected_profit"],
                      f"{r['margin']:.1f}%"] for r in d["rows"]],
            "totals": ["الإجمالي", "", "", t["value"], t["collected"],
                       t["cost"], t["profit"], t.get("expected_cost", 0),
                       t.get("expected_profit", 0),
                       (f"{t['profit']/t['collected']*100:.1f}%"
                        if t["collected"] > 0.001 else "-")],
            "note": (f"عدد العقود: {len(d['rows'])}   |   "
                     "الفعلي = إجمالي المحصل - إجمالي المنصرف   |   "
                     "المتوقع = إجمالي العقد - عقود الباطن - المنصرف الآخر عليه"),
            "color_cols": {4: "green", 5: "red", 6: "profit", 7: "red", 8: "profit"},
            "number_cols": [3, 4, 5, 6, 7, 8],
            "right_align_cols": (0, 1),
        }

    # expiring أو all
    if option == "expiring":
        d = report_service.expiring_contracts(date_from, date_to)
        rows = [[r["customer_name"], _contract_label(r),
                 r["end_date"], r["remaining"]]
                for r in d["rows"]]
        return {
            "heads": ["العميل", "العقد", "تاريخ الانتهاء", "الأيام المتبقية"],
            "widths": [44, 62, 32, 26],
            "rows": rows,
            "totals": None,
            "note": f"العقود القاربة على الانتهاء: {len(rows)}",
            "color_cols": {3: "auto"},
            "number_cols": [3],
            "right_align_cols": (0, 1),
        }

    # العرض الافتراضي: كل العقود بملخص محاسبي من report_service
    # وقيم العقود الحالية تأتي من lifecycle_service.contract_current_value.
    overview = report_service.contracts_overview(date_from, date_to)
    result = overview["rows"]
    totals = overview["totals"]
    return {
        "heads": ["العميل", "العقد",
                  "تاريخ العقد", "تاريخ الانتهاء", "الحالة",
                  "قيمة العقد", "المحصّل", "المتبقي"],
        "widths": [38, 52, 22, 22, 18, 26, 24, 24],
        "rows": result,
        "totals": ["", "الإجمالي", "", "", totals["count"],
                   totals["value"], totals["collected"],
                   totals["remaining"]],
        "note": (f"عدد العقود: {totals['count']} · "
                 f"القيمة: {totals['value']:,.3f} · "
                 f"المحصّل: {totals['collected']:,.3f} · "
                 f"المتبقي: {totals['remaining']:,.3f}"),
        "color_cols": {5: "auto", 6: "green", 7: "auto"},
        "number_cols": [5, 6, 7, 8],
    }


# تعريف التقارير · الاسم الصريح + الوصف + مصدر البيانات
# ============================================================


def _data_execution(option="current", contract_type=None, stage_name=None):
    """تقرير مراحل التنفيذ: من في كل مرحلة وبقاله كام يوم.

    option="current":  كل العقود الموجودة الآن في مراحلها، وليس المتأخرين فقط
    option="delayed":  المتأخرون فقط
    option="near":     القاربون على نهاية المرحلة
    option="ok":       الموجودون ضمن الوقت
    option="no_stage": عقود بلا مرحلة جارية
    option="all":      كل الحالات
    contract_type/stage_name: فلاتر اختيارية.
    """
    from services import workflow_service as wf
    d = wf.execution_occupancy_report(option, contract_type, stage_name)
    t = d["totals"]
    def _lbl(r):
        num = (r.get("contract_number") or "").strip()
        nm = (r.get("contract_title") or "").strip()
        if nm in ("غير محدد", num, "-", "—"):
            nm = ""
        return f"{num} · {nm}" if (num and nm) else (num or nm or "—")
    def _note_cell(r):
        # V5.9: النوت الصغير — آخر ملاحظة على المعاملة (مع تاريخها).
        n = (r.get("last_note") or "").strip()
        if not n:
            return "—"
        at = (r.get("last_note_at") or "")[:10]
        return f"{n} ({at})" if at else n
    rows = [[r["customer_name"], _lbl(r),
             r["stage"], r.get("next_stage") or "—", r["start_date"] or "—",
             r["days_in"], r["expected"] or "—", r["status_label"],
             r["responsible"], _note_cell(r)]
            for r in d["rows"]]
    labels = {
        "current": "كل العقود الموجودة حاليًا في مراحل التنفيذ",
        "delayed": "العقود المتأخرة فقط",
        "near": "العقود القاربة على نهاية المرحلة",
        "ok": "العقود ضمن الوقت",
        "no_stage": "عقود بلا مرحلة جارية",
        "all": "كل حالات المراحل",
    }
    filters = []
    if contract_type:
        filters.append(f"نوع العقد: {contract_type}")
    if stage_name:
        filters.append(f"المرحلة: {stage_name}")
    filter_note = " · " + " · ".join(filters) if filters else ""
    return {
        "heads": ["العميل", "العقد", "المرحلة الحالية",
                  "المرحلة التالية", "متى بدأت المرحلة الحالية", "بقالها كم يوم",
                  "المتوقع", "الحالة", "المسؤول", "آخر ملاحظة"],
        "widths": [36, 52, 32, 32, 26, 18, 16, 30, 26, 44],
        "rows": rows,
        "totals": ["الإجمالي", d["count"], "", "", "", "", "", "", "", ""],
        "note": (f"{labels.get(option, labels['current'])}{filter_note} · الجاري: {t['current']} · "
                 f"ضمن الوقت: {t['ok']} · قارب: {t['near']} · "
                 f"متأخر: {t['delayed']} · مكتمل: {t['done']} · "
                 f"بلا مرحلة: {t['no_stage']}. نوع العقد أصبح فلترًا وليس عمودًا مكررًا."),
        "color_cols": {7: "auto"},
        "number_cols": [5, 6],
        "indent_col": 2,
        "right_align_cols": (0, 1),
    }



def _data_expenses(option="all", date_from="", date_to=""):
    """إيرادات ومصروفات — سندات القبض والصرف."""
    from services import report_service
    from services import lifecycle_service as _lc

    if option == "income":
        d = report_service.vouchers_period(date_from or "0000-01-01",
                                           date_to or "9999-12-31", "receipt")
        rows = [[n, r["vdate"], r["voucher_number"],
                 r["party"], _contract_label(r),
                 r["method"] or "", r["amount"],
                 r["description"] or ""]
                for n, r in enumerate(d["rows"], 1)]
        total = sum(r["amount"] for r in d["rows"])
        return {
            "heads": ["م", "التاريخ", "السند", "الجهة", "العقد",
                      "الدفع", "المبلغ", "البيان"],
            "widths": [7, 20, 20, 40, 42, 18, 22, 60],
            "rows": rows,
            "totals": ["", "", "", "", "", "الإجمالي", total, ""],
            "note": "",
            "color_cols": {6: "green"},
            "number_cols": [6],
        }

    if option == "all":
        d = report_service.vouchers_period(date_from or "0000-01-01",
                                           date_to or "9999-12-31", None)
        rows = [[n, r["vdate"], r["voucher_number"],
                 _lc.voucher_type_label(r["vtype"]),
                 r["party"], r["method"] or "", r["amount"],
                 r["description"] or ""]
                for n, r in enumerate(d["rows"], 1)]
        return {
            "heads": ["م", "التاريخ", "السند", "النوع", "الجهة",
                      "الدفع", "المبلغ", "البيان"],
            "widths": [7, 20, 20, 16, 40, 18, 22, 60],
            "rows": rows,
            "totals": None,
            "note": "",
            "color_cols": {6: "auto"},
            "number_cols": [6],
        }

    # expenses (default)
    data = report_service.expenses_report(date_from, date_to)
    rows_db = data["rows"]
    rows = []
    by_parent = {}
    for n, r in enumerate(rows_db, 1):
        path = (r["acc_path"] or r["account"] or "غير مصنف").strip()
        parts = [p.strip() for p in path.split("/") if p.strip()]
        parent = parts[0] if parts else path
        child = parts[-1] if len(parts) > 1 else "—"
        amt = float(r["amount"] or 0)
        by_parent[parent] = by_parent.get(parent, 0.0) + amt
        # جدول مبسّط: الحساب = الأب/الفرعي مدمجين · الجهة = المورد/العميل
        account = parent if child in ("—", "") else f"{parent} / {child}"
        party_bits = [x for x in (r["party"], r["expense_customer_name"])
                      if (x or "").strip()]
        party = " / ".join(party_bits) if party_bits else "—"
        # العقد/المشروع يُدمج في البيان حتى لا تضيع المعلومة
        desc = (r["description"] or "").strip()
        con = (r["contract_label"] or "").strip()
        if con and con != "—":
            desc = f"{desc} ({con})" if desc else con
        rows.append([n, _plain_date(r["vdate"]), r["voucher_number"],
                     account, party, r["method"] or "—", amt, desc or "—"])
    note_parts = [f"{k}: {v:,.3f}" for k, v in sorted(by_parent.items())]
    return {
        "heads": ["م", "التاريخ", "السند", "الحساب", "الجهة", "الدفع",
                  "المبلغ", "البيان"],
        "widths": [7, 20, 20, 42, 38, 18, 22, 60],
        "rows": rows,
        "totals": ["", "", "", "", "", "الإجمالي",
                   sum(float(r["amount"] or 0) for r in rows_db), ""],
        "note": "",
        "color_cols": {6: "red"},
        "number_cols": [6],
        "right_align_cols": (3, 4, 7),
    }


def _data_other_company(date_from="", date_to=""):
    """كشف حساب الشركة الأخرى: يوميًا + حالة التحويل + إجمالي."""
    from services import settlement_service as st
    from database.database import get_connection
    try:
        opening = st.get_other_opening()["amount"]
    except Exception:
        opening = 0.0
    try:
        transfers_total = st.other_transfers_total(date_from, date_to)
    except Exception:
        transfers_total = 0.0

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT op_date, gateway, COUNT(*) AS n, "
            "COALESCE(SUM(amount),0) AS gross, "
            "SUM(CASE WHEN COALESCE(paid_transfer_id,0)>0 THEN 1 ELSE 0 END) AS paid_n, "
            "SUM(CASE WHEN COALESCE(paid_transfer_id,0)>0 THEN amount ELSE 0 END) AS paid_amt, "
            "MAX(CASE WHEN COALESCE(paid_transfer_id,0)>0 THEN 1 ELSE 0 END) AS any_paid "
            "FROM gateway_ops "
            "WHERE status='other' AND COALESCE(distributed,0)=1 "
            "AND (gw_paid IS NULL OR gw_paid=1) "
            "AND op_date BETWEEN ? AND ? "
            "GROUP BY op_date, gateway ORDER BY op_date, gateway",
            (date_from, date_to)).fetchall()
        fees = {p["name"]: round(float(p.get("fee_fixed") or 0), 3)
                for p in st.list_profiles(active_only=False)}

    out = []
    cumulative = opening
    gross_total = 0.0
    for r in rows:
        day = r["op_date"] or ""
        gw = r["gateway"] or ""
        n = int(r["n"])
        gross = round(float(r["gross"]), 3)
        fee = round(n * fees.get(gw, 0), 3)
        net = round(gross - fee, 3)
        paid_amt = round(float(r["paid_amt"]), 3)
        status = "✅ محوّل" if paid_amt > 0.001 else "⏳ لم يحوّل"
        cumulative = round(cumulative + net, 3)
        gross_total = round(gross_total + net, 3)
        out.append([day, gw, n, gross, fee, net, status, cumulative])

    balance = round(opening + gross_total - transfers_total, 3)
    out.append(["", "الإجمالي", "", "", "", gross_total, "", ""])
    out.append(["", "الرصيد الافتتاحي", "", "", "", opening, "", ""])
    out.append(["", "المسدّد للشركة", "", "", "", transfers_total, "", ""])
    out.append(["", "المتبقي للشركة", "", "", "", balance, "", ""])

    accent = {
        "الإجمالي": "#DBEAFE",
        "الرصيد الافتتاحي": "#FEF3C7",
        "المسدّد للشركة": "#DCFCE7",
        "المتبقي للشركة": "#FEE2E2" if balance > 0.001 else "#DCFCE7",
    }
    n_days = len(rows)
    note = (f"الأيام: {n_days} · المسدّد: {transfers_total:,.3f} · "
            f"المتبقي: {balance:,.3f} د.ك"
            if n_days else "لا توجد عمليات.")
    return {
        "heads": ["اليوم", "البوابة", "العدد", "الإجمالي", "العمولة",
                  "الصافي", "التحويل", "التراكمي"],
        "widths": [16, 20, 8, 16, 12, 16, 14, 16],
        "rows": out,
        "totals": None,
        "note": note,
        "color_cols": {3: "green", 5: "green", 7: "auto"},
        "number_cols": [2, 3, 4, 5, 7],
        "accent_rows": accent,
    }


def _data_customers_full(date_from="", date_to="", option="all"):
    """تقرير العملاء الشامل — مسطّح مع سطر إجمالي لكل عميل.

    يدمج: أرصدة العملاء + العقود + الدفعات المستحقة.
    """
    from services import report_service
    customers = report_service.customers_balances(date_from, date_to)
    dues = report_service.dues_report(date_from, date_to)
    installments = report_service.overdue_installments(
        date_from, date_to, strict=True)
    due_by_customer = report_service.due_now_by_customer(date_from, date_to)

    by_cust: dict[str, list] = {}
    for r in dues["rows"]:
        by_cust.setdefault(r["customer_name"], []).append(("contract", r))
    for r in installments["rows"]:
        by_cust.setdefault(r["customer_name"], []).append(("installment", r))

    heads = ["#", "العميل", "البيان", "العقود", "قيمة العقود",
             "المحصّل", "المستحق الآن", "المتبقي", "الحالة"]
    widths = [6, 36, 36, 10, 22, 22, 22, 22, 20]

    rows = []
    accent = {}
    cust_num = 0
    grand_contracts = 0
    grand_value = 0.0
    grand_collected = 0.0
    grand_due = 0.0
    grand_remaining = 0.0

    for c in customers["rows"]:
        children = by_cust.get(c["name"], [])
        has_balance = (c["remaining"] or 0) > 0.001 or bool(children)
        if option == "with_balance" and not has_balance:
            continue
        if option == "no_balance" and (has_balance or not (c["contracts_count"] or 0)):
            continue
        due_cust = due_by_customer.get(c["name"], 0.0)
        if option == "due_only" and not due_cust > 0.001:
            continue

        cust_num += 1
        n_contracts = c["contracts_count"] or 0
        value = c["contracts_value"] or 0.0
        collected = c["collected"] or 0.0
        remaining = c["remaining"] or 0.0

        grand_contracts += n_contracts
        grand_value += value
        grand_collected += collected
        grand_due += due_cust
        grand_remaining += remaining

        if due_cust > 0.001:
            status = "مستحق الآن"
        elif remaining > 0.001:
            status = "عليه رصيد"
        elif value > 0.001:
            status = "مسدّد بالكامل"
        else:
            status = ""

        summary_text = f"━━ {c['name']} ━━"
        rows.append([cust_num, c["name"], f"إجمالي {c['name']}",
                     n_contracts, value, collected,
                     due_cust, remaining, status])
        accent[f"إجمالي {c['name']}"] = "#DBEAFE"

        for kind, d in children:
            if kind == "contract":
                rows.append(["", "", d.get("contract_name") or "عقد",
                             "", d["value"], d["collected"],
                             due_by_customer.get(d["contract_number"], 0.0),
                             d["remaining"], ""])
            else:
                rows.append(["", "", d.get("title") or "دفعة مجدولة",
                             "", "", "",
                             d["remaining"], "",
                             d.get("status", "مستحق")])

    rows.append(["", "الإجمالي العام", "الإجمالي العام",
                 grand_contracts, grand_value, grand_collected,
                 grand_due, grand_remaining, ""])
    accent["الإجمالي العام"] = "#EEF2FF"

    note = (f"العملاء: {cust_num} · العقود: {grand_contracts} · "
            f"القيمة: {grand_value:,.3f} · المحصّل: {grand_collected:,.3f} · "
            f"المستحق: {grand_due:,.3f} · المتبقي: {grand_remaining:,.3f}")

    return {
        "heads": heads, "widths": widths, "rows": rows, "totals": None,
        "note": note,
        "color_cols": {5: "green", 6: "auto", 7: "auto"},
        "number_cols": [0, 3, 4, 5, 6, 7],
        "accent_rows": accent,
    }


def _data_sub_full(date_from="", date_to="", option="all"):
    """تقرير المقاولين الشامل — مسطّح مع سطر إجمالي لكل مقاول.

    يدمج: ملخص المقاولين + مستحقات الباطن التفصيلية.
    """
    from services import report_service
    subs = report_service.subcontractors_report()
    board = report_service.dues_board("all")

    by_sub: dict[str, list] = {}
    for r in board["rows"]:
        party = r.get("party", "")
        if party:
            by_sub.setdefault(party, []).append(r)

    heads = ["#", "المقاول", "العقد/المرحلة", "الدفعة", "الاستحقاق",
             "المبلغ", "المدفوع", "المتبقي", "الحالة"]
    widths = [6, 30, 30, 24, 18, 18, 18, 18, 16]

    rows = []
    accent = {}
    sub_num = 0
    grand_value = 0.0
    grand_paid = 0.0
    grand_remaining = 0.0
    grand_overdue = 0

    for s in subs["rows"]:
        sub_num += 1
        name = s["name"]
        value = float(s["contracts_value"] or 0)
        paid = float(s["paid"] or 0)
        remaining = float(s["remaining"] or 0)

        grand_value += value
        grand_paid += paid
        grand_remaining += remaining

        summary_text = f"إجمالي {name}"
        status = "عليه متبقي" if remaining > 0.001 else "مسدّد"
        rows.append([sub_num, name, summary_text,
                     s["contracts_count"], "",
                     value, paid, remaining, status])
        accent[summary_text] = "#FEF3C7"

        sub_lines = by_sub.get(name, [])
        overdue_in_sub = 0
        for line in sub_lines:
            contract = line.get("contract", "")
            stage = line.get("stage", "—")
            title = line.get("title", "")
            due = line.get("due", "—")
            amt = float(line.get("amount") or 0)
            ln_paid = float(line.get("paid") or 0)
            rem = float(line.get("remaining") or 0)
            ln_status = line.get("status", "")

            if ln_status == "متأخر":
                overdue_in_sub += 1

            contract_stage = f"{contract} — {stage}" if stage != "—" else contract
            rows.append(["", "", contract_stage,
                         title, due,
                         amt, ln_paid, rem, ln_status])

        grand_overdue += overdue_in_sub

        if not sub_lines and value > 0.001:
            rows.append(["", "", f"{s.get('contracts_count', 0)} عقد",
                         "", "", value, paid, remaining,
                         status])

    rows.append(["", "الإجمالي العام", "الإجمالي العام",
                 "", "",
                 grand_value, grand_paid, grand_remaining, ""])
    accent["الإجمالي العام"] = "#EEF2FF"

    note = (f"المقاولين: {sub_num} · القيمة: {grand_value:,.3f} · "
            f"المنصرف: {grand_paid:,.3f} · المتبقي: {grand_remaining:,.3f} · "
            f"المتأخر: {grand_overdue}")

    return {
        "heads": heads, "widths": widths, "rows": rows, "totals": None,
        "note": note,
        "color_cols": {5: "green", 6: "auto", 7: "auto"},
        "number_cols": [0, 3, 5, 6, 7],
        "accent_rows": accent,
    }


_REPORTS = [
    {
        "icon": "👥", "name": "تقرير العملاء والأرصدة", "short": "العملاء والأرصدة",
        "desc": "كل عميل: إجمالي عقوده والمحصّل والمنصرف والمتبقي، مع تفصيل "
                "العقود ذات الرصيد والدفعات المجدولة — مسطّح بدون شجرة",
        "file": "تقرير_العملاء_الشامل", "key": "rep_customers",
        "period": True, "all_time": True, "data": _data_customers_full,
        "options_filter": {
            "label": "العرض:",
            "items": [("الكل", "all"),
                      ("عليهم رصيد فقط", "with_balance"),
                      ("بلا رصيد (مسدّدون)", "no_balance"),
                      ("عندهم دفعة مستحقة", "due_only"),
                      ("بالمراحل (عميل × مرحلة)", "by_stages")],
        },
    },
    {
        "icon": "🧭", "name": "تقرير تأخير الإشراف", "short": "تأخير الإشراف",
        "desc": "بداية تعهد الإشراف والمدة الأساسية والتمديد المدفوع · "
                "نهاية المدة كاملة وشهور التأخير وقيمته",
        "file": "تقرير_تأخير_الإشراف", "key": "rep_supervision_delay", "module": "supervision",
        "period": False, "data": _data_supervision_delays,
        "options_filter": {
            "label": "العرض:",
            "items": [("عليهم متبقٍ فقط", "unpaid"),
                      ("كل العقود في التمديد", "all")],
        },
    },
    {
        "icon": "👷", "name": "تقرير مقاولي الباطن الشامل", "short": "مقاولو الباطن",
        "desc": "كل مقاول: ملخص عقوده والمنصرف والمتبقي، مع تفاصيل "
                "مستحقات الباطن التفصيلية — مسطّح بدون شجرة",
        "file": "تقرير_مقاولي_الباطن_الشامل", "key": "rep_subcontractors",
        "period": False, "data": _data_sub_full,
    },
    # ملاحظة: تقرير "ربحية العقود" دُمج في "تقرير العقود" كخيار
    # عرض من الفلتر العلوي (الوظيفة نفسها والمفاتيح الداخلية
    # ظلت تعمل للتوافق مع أي استدعاء قديم).
    {
        "icon": "💸", "name": "إيرادات ومصروفات", "short": "إيرادات ومصروفات",
        "desc": "السندات: إيرادات (قبض) أو مصروفات (صرف) أو الكل، "
               "مع إجمالي الوارد والمنصرف وصافي الحركة",
        "file": "ايرادات_ومصروفات", "key": "rep_expenses",
        "period": True, "all_time": True, "data": _data_expenses,
        "pass_dates": True,
        "options_filter": {
            "label": "العرض:",
            "items": [("الكل", "all"),
                      ("إيرادات فقط", "income"),
                      ("مصروفات فقط", "expenses")],
        },
    },
    {
        "icon": "🏦", "name": "التقرير المالي",
        "short": "التقرير المالي",
        "desc": "كشف نقدي: بالحركات (سند بسند) أو بالإجمالي (إيرادات/مصروفات/أرصدة)",
        "file": "تقرير_الكاش_فلو", "key": "rep_cashflow", "module": "cashflow",
        "period": True, "all_time": True, "data": _data_cash_flow,
        "pass_dates": True,
        "options_filter": {
            "label": "العرض:",
            "items": [("بالحركات", "detail"),
                      ("بالإجمالي", "summary"),
                      ("وارد فقط", "receipts_only"),
                      ("منصرف فقط", "payments_only"),
                      ("مسترد فقط", "recoveries_only"),
                      ("تحويلات فقط", "transfers_only"),
                      ("ملخص يومي", "daily"),
                      ("ملخص شهري", "monthly"),
                      ("ملخص سنوي", "yearly")],
        },
    },
    {
        "icon": "📋", "name": "تقرير العقود", "short": "العقود",
        "desc": "كل العقود بقيمها والمحصّل والمتبقي والحالة، مع ملخص "
                "حسب نوع العقد، وعرض العقود القاربة على الانتهاء "
                "(دمج تقريري «الأنواع» و«العقود القاربة»)",
        "file": "تقرير_العقود", "key": "rep_contracts",
        "period": True, "all_time": True, "data": _data_contracts,
        "pass_dates": True,
        "options_filter": {
            "label": "العرض:",
            "items": [("كل العقود", "all"),
                      ("ربحية العقود", "profitability"),
                      ("ربحية حسب النوع", "profit_by_type"),
                      ("ملخص حسب النوع", "by_type"),
                      ("عقود تنتهي قريبًا", "expiring")],
        },
    },
    {
        "icon": "🏗", "name": "تقرير مراحل التنفيذ", "short": "مراحل التنفيذ",
        "desc": "يعرض كل العقود الموجودة الآن في كل مرحلة: مين في المرحلة، "
                "وبقاله كام يوم، مع فلتر للمتأخر والقارب وضمن الوقت",
        "file": "تقرير_مراحل_التنفيذ", "key": "rep_execution",
        "module": "followup",
        "period": False, "data": _data_execution,
        "entity_filter": "execution",
        "options_filter": {
            "label": "العرض:",
            "items": [("كل الموجودين في المراحل", "current"),
                      ("المتأخرة فقط", "delayed"),
                      ("قاربت على الانتهاء", "near"),
                      ("ضمن الوقت", "ok"),
                      ("بلا مرحلة جارية", "no_stage"),
                      ("الكل", "all")],
        },
    },
    {
        "icon": "🎯", "name": "تقرير الفرص البيعية", "short": "الفرص البيعية",
        "desc": "العملاء المسجلون بلا أي عقد بعد · فرصك البيعية القادمة "
                "للتواصل والمتابعة",
        "file": "تقرير_الفرص_البيعية", "key": "rep_leads",
        "period": True, "all_time": True, "data": _data_prospects,
    },
]

def visible_reports() -> list[dict]:
    """التقارير المتاحة للمستخدم الحالي.

    الحساسة للمدير فقط · وتقارير المديولات المعطّلة تُخفى كليًا.
    """
    from services import auth_service, feature_service, settings_service
    if not feature_service.enabled("reports"):
        return []
    reports = list(_REPORTS)
    # مفتاح مستقل لكل تقرير + مفتاح المديول الذي يعتمد عليه (إن وُجد)
    reports = [r for r in reports
               if feature_service.enabled(r.get("key", ""))
               and feature_service.enabled(r.get("module", ""))]
    if not settings_service.cashflow_enabled():
        reports = [r for r in reports if not r.get("module") == "cashflow"]
    # الصلاحيات الدقيقة: تأشيرة مستقلة لكل تقرير لكل موظف
    # (المدير والمطور يمران دائمًا — has_permission تتصرف بنفسه).
    return [r for r in reports
            if auth_service.has_permission(r.get("key", ""))]


_PERIODS = ["كل الفترات", "اليوم", "هذا الشهر", "الشهر الماضي", "هذه السنة",
            "السنة الماضية", "فترة مخصصة"]


def _period_dates(choice: str) -> tuple[QDate, QDate]:
    today = QDate.currentDate()
    if choice == "كل الفترات":
        return QDate(2000, 1, 1), today
    if choice == "اليوم":
        return today, today
    if choice == "هذا الشهر":
        return QDate(today.year(), today.month(), 1), today
    if choice == "الشهر الماضي":
        prev = today.addMonths(-1)
        return (QDate(prev.year(), prev.month(), 1),
                QDate(prev.year(), prev.month(), prev.daysInMonth()))
    if choice == "هذه السنة":
        return QDate(today.year(), 1, 1), today
    if choice == "السنة الماضية":
        return QDate(today.year() - 1, 1, 1), QDate(today.year() - 1, 12, 31)
    return QDate(today.year(), today.month(), 1), today


# ============================================================
# صفحة عرض تقرير واحد: فلتر + جدول + طباعة/تصدير
# ============================================================
class _ReportView(QWidget):
    def __init__(self, parent_page):
        super().__init__()
        self._page = parent_page
        self._rep = None
        self._spec = None
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)

        # ===== رأس الصفحة: المنزل + اسم التقرير + أزرار =====
        head = QHBoxLayout()
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        self.title_lbl = QLabel("")
        self.title_lbl.setProperty("pageTitle", True)
        self.desc_lbl = QLabel("")
        self.desc_lbl.setProperty("pageDesc", True)
        title_col.addWidget(self.title_lbl)
        title_col.addWidget(self.desc_lbl)
        head.addLayout(title_col, 1)
        self.xls_btn = QPushButton("📤")
        self.xls_btn.setObjectName("iconBtn")
        self.xls_btn.setToolTip("تصدير التقرير إلى Excel")
        self.xls_btn.setCursor(Qt.PointingHandCursor)
        self.xls_btn.clicked.connect(self._export_excel)
        self.pdf_btn = QPushButton("🖨")
        self.pdf_btn.setObjectName("iconBtn")
        self.pdf_btn.setToolTip("طباعة التقرير PDF")
        # ثانوي: «عرض التقرير» هو الإجراء الأساسي في هذه الشاشة (قاعدة 23)
        self.pdf_btn.setCursor(Qt.PointingHandCursor)
        self.pdf_btn.clicked.connect(self._export_pdf)
        head.addWidget(self.xls_btn)
        head.addWidget(self.pdf_btn)
        layout.addLayout(head)

        # ===== شريط فلتر الفترة · قوائم منسدلة مدمجة (سطر واحد) =====
        self.filter_card = QFrame()
        self.filter_card.setProperty("card", True)
        soft_shadow(self.filter_card, radius=20, y=4)
        from ui.widgets import FlowLayout
        fcol = FlowLayout(self.filter_card, margin=0, spacing=7)
        fcol.setContentsMargins(10, 7, 10, 7)

        from PySide6.QtWidgets import QComboBox as _QC
        chips_lbl = QLabel("الفترة:")
        chips_lbl.setStyleSheet("font-weight: 700;")
        self._period_lbl = chips_lbl
        fcol.addWidget(chips_lbl)
        from ui.widgets import make_searchable
        self.period_combo = _QC()
        make_searchable(self.period_combo, "")
        for p in _PERIODS:
            self.period_combo.addItem(p)
        self.period_combo.setFixedWidth(160)
        self.period_combo.currentIndexChanged.connect(self._on_period)
        fcol.addWidget(self.period_combo)

        # من / إلى + زر عرض (تظهر عند «فترة مخصصة»)
        from ui.widgets import SafeDateEdit
        self._from_lbl = QLabel("من")
        fcol.addWidget(self._from_lbl)
        self.dfrom = SafeDateEdit()
        self.dfrom.setCalendarPopup(True)
        self.dfrom.setDisplayFormat("yyyy-MM-dd")
        self.dfrom.setMinimumWidth(140)
        fcol.addWidget(self.dfrom)
        self._to_lbl = QLabel("إلى")
        fcol.addWidget(self._to_lbl)
        self.dto = SafeDateEdit()
        self.dto.setCalendarPopup(True)
        self.dto.setDisplayFormat("yyyy-MM-dd")
        self.dto.setMinimumWidth(140)
        fcol.addWidget(self.dto)
        self.apply_btn = QPushButton("🔍 عرض التقرير")
        self.apply_btn.setToolTip("عرض التقرير بالفترة المحددة")
        self.apply_btn.setObjectName("btnPrimary")
        self.apply_btn.setCursor(Qt.PointingHandCursor)
        # يمنع ضغط الزر أفقيًا في الشريط المزدحم (قاعدة 33)
        from ui.widgets import size_buttons as _sz
        _sz([self.apply_btn])
        self.apply_btn.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Fixed)
        self.apply_btn.clicked.connect(self._apply_custom)
        fcol.addWidget(self.apply_btn)

        # فلتر خيارات خاص بالتقرير (مثل: الكل / عليهم متبقٍ فقط)
        self.opt_lbl = QLabel("العرض:")
        self.opt_lbl.setStyleSheet("font-weight: 700;")
        fcol.addWidget(self.opt_lbl)
        from ui.widgets import make_searchable
        self.opt_combo = _QC()
        make_searchable(self.opt_combo, "")
        self.opt_combo.setMinimumWidth(150)
        self.opt_combo.setMaximumWidth(210)
        self.opt_combo.currentIndexChanged.connect(lambda _: self._reload())
        fcol.addWidget(self.opt_combo)
        self.opt_lbl.setVisible(False)
        self.opt_combo.setVisible(False)

        # بحث داخل نتائج التقرير (كل الأعمدة)
        from PySide6.QtWidgets import QLineEdit as _QLE
        self.search = _QLE()
        self.search.setPlaceholderText("بحث داخل النتائج...")
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumWidth(150)
        self.search.setMaximumWidth(260)
        self.search.textChanged.connect(self._on_search)
        fcol.addWidget(self.search)

        # فلتر نوع السند · قائمة منسدلة (لتقرير حركة السندات فقط)
        self.vtype_lbl = QLabel("النوع:")
        self.vtype_lbl.setStyleSheet("font-weight: 700;")
        fcol.addWidget(self.vtype_lbl)
        from ui.widgets import make_searchable
        self.vtype_combo = _QC()
        make_searchable(self.vtype_combo, "")
        self.vtype_combo.addItem("الكل", None)
        self.vtype_combo.addItem("قبض فقط", "receipt")
        self.vtype_combo.addItem("صرف فقط", "payment")
        self.vtype_combo.addItem("إرجاع عهدة", "custody_return")
        self.vtype_combo.addItem("خصم من راتب", "salary_deduction")
        self.vtype_combo.setFixedWidth(120)
        self.vtype_combo.currentIndexChanged.connect(
            lambda _: self._reload())
        fcol.addWidget(self.vtype_combo)

        layout.addWidget(self.filter_card)

        # ===== شريط فلتر الكيانات (للربحية ومقاولي الباطن) =====
        from ui.widgets import SearchableComboBox
        self.entity_card = QFrame()
        self.entity_card.setProperty("card", True)
        soft_shadow(self.entity_card, radius=20, y=4)
        el = QHBoxLayout(self.entity_card)
        el.setContentsMargins(16, 10, 16, 10)
        el.setSpacing(8)
        self.entity_lbl1 = QLabel("")
        self.entity_lbl1.setStyleSheet("font-weight: 700;")
        el.addWidget(self.entity_lbl1)
        self.entity_combo1 = SearchableComboBox()
        self.entity_combo1.setMinimumWidth(230)
        el.addWidget(self.entity_combo1)
        self.entity_lbl2 = QLabel("")
        self.entity_lbl2.setStyleSheet("font-weight: 700;")
        el.addWidget(self.entity_lbl2)
        self.entity_combo2 = SearchableComboBox()
        self.entity_combo2.setMinimumWidth(230)
        el.addWidget(self.entity_combo2)
        clear_btn = QPushButton("🔍 عرض الكل")
        clear_btn.setProperty("flat", True)
        clear_btn.setCursor(Qt.PointingHandCursor)
        clear_btn.clicked.connect(self._clear_entities)
        el.addWidget(clear_btn)
        el.addStretch()
        self.entity_card.setVisible(False)
        layout.addWidget(self.entity_card)
        self.entity_combo1.selection_changed.connect(self._entity1_changed)
        self.entity_combo2.selection_changed.connect(
            lambda: self._reload() if self._rep else None)

        # ===== الجدول =====
        self.table = QTableWidget()
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.verticalHeader().setVisible(False)
        # خطوط شبكة واضحة + صفوف أعلى قليلاً لقراءة أسهل
        self.table.setShowGrid(True)
        self.table.setGridStyle(Qt.SolidLine)
        self.table.verticalHeader().setDefaultSectionSize(30)
        self.table.setStyleSheet(
            "QTableWidget { gridline-color: #C7D2E0; }"
            "QHeaderView::section { padding: 7px 4px; font-weight: 700; }")
        # الضغط على صف العميل يفتح/يطوي شجرة عقوده (التقارير الشجرية)
        self.table.cellClicked.connect(self._on_row_clicked)
        self._collapsed: set[int] = set()
        layout.addWidget(self.table, 1)

        # شريط ترقيم الصفحات · 50 صفًا في الصفحة (المعاينة الحية فقط؛
        # الطباعة والتصدير يشملان كل الصفوف دائمًا)
        from ui.widgets import PaginationBar
        self.pager = PaginationBar()
        self.pager.page_changed.connect(self._redraw_page)
        pager_row = QHBoxLayout()
        pager_row.addStretch()
        pager_row.addWidget(self.pager)
        pager_row.addStretch()
        layout.addLayout(pager_row)

        # ===== سطر الملخص =====
        self.note_card = QFrame()
        self.note_card.setProperty("card", True)
        nl = QHBoxLayout(self.note_card)
        nl.setContentsMargins(16, 10, 16, 10)
        self.note_lbl = QLabel("")
        self.note_lbl.setStyleSheet("font-weight: 800; font-size: 11.9px;")
        nl.addWidget(self.note_lbl)
        nl.addStretch()
        layout.addWidget(self.note_card)

    # ---------- التحميل ----------
    def load(self, rep: dict):
        self._rep = rep
        self.title_lbl.setText(f"{rep['icon']}  {rep['name']}")
        self.desc_lbl.setText(rep["desc"])
        entity = rep.get("entity_filter")
        self.entity_card.setVisible(bool(entity))
        if entity:
            from ui.widgets import customer_items, subcontractor_items
            self._entity_loading = True
            if entity == "profit":
                self.entity_lbl1.setText("العميل:")
                self.entity_lbl2.setText("العقد / المشروع:")
                self.entity_combo1.set_items(
                    [("— كل العملاء —", None)] + customer_items(),
                    auto_select=False)
                self.entity_combo2.set_items(
                    [("— كل العقود —", None)], auto_select=False)
            elif entity == "execution":
                from services import workflow_service as wf
                self.entity_lbl1.setText("نوع العقد:")
                self.entity_lbl2.setText("المرحلة:")
                self.entity_combo1.set_items(
                    [("— كل الأنواع —", None)] + [(x, x) for x in wf.execution_filter_contract_types()],
                    auto_select=False)
                self.entity_combo2.set_items(
                    [("— كل المراحل —", None)] + [(x, x) for x in wf.execution_filter_stage_names()],
                    auto_select=False)
            else:  # sub
                self.entity_lbl1.setText("المقاول:")
                self.entity_lbl2.setText("العميل:")
                # يبدأ تقرير مقاولي الباطن بخانات فارغة كما طلب المستخدم؛
                # عدم الاختيار يعني عرض الكل، وزر «عرض الكل» يعيدها فارغة.
                self.entity_combo1.set_items(subcontractor_items(),
                                             auto_select=False)
                self.entity_combo2.set_items(customer_items(),
                                             auto_select=False)
            if entity in ("profit", "execution"):
                self.entity_combo1.setCurrentIndex(0)
                self.entity_combo2.setCurrentIndex(0)
            else:
                self.entity_combo1.setCurrentIndex(-1)
                self.entity_combo2.setCurrentIndex(-1)
                self.entity_combo1.lineEdit().setText("")
                self.entity_combo2.lineEdit().setText("")
            self._entity_loading = False
        # شريط الفلاتر يظهر أيضًا للتقارير التي لها فلتر خيارات أو بحث
        opts = rep.get("options_filter")
        # «ربحية العقود» عرض مالي: يظهر لمن يملك تأشيرته فقط
        if opts:
            from services import auth_service as _auth
            if not _auth.has_permission("action_view_financial"):
                items = [(t, v) for t, v in opts.get("items", [])
                         if v != "profitability"]
                if len(items) != len(opts.get("items", [])):
                    opts = {**opts, "items": items}
        self.filter_card.setVisible(True)
        # عناصر الفترة تظهر فقط للتقارير الزمنية
        for w in (self.period_combo, self._from_lbl, self.dfrom,
                  self._to_lbl, self.dto, self.apply_btn):
            w.setVisible(bool(rep["period"]))
        self._period_lbl.setVisible(bool(rep["period"]))
        # فلتر الخيارات الخاص بالتقرير
        self.opt_lbl.setVisible(bool(opts))
        self.opt_combo.setVisible(bool(opts))
        if opts:
            self.opt_combo.blockSignals(True)
            self.opt_combo.clear()
            for text, value in opts["items"]:
                self.opt_combo.addItem(text, value)
            self.opt_lbl.setText(opts.get("label", "العرض:"))
            self.opt_combo.setCurrentIndex(0)
            self.opt_combo.blockSignals(False)
        # البحث يبدأ فارغًا مع كل تقرير
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
        show_vtype = bool(rep.get("vtype_filter"))
        self.vtype_lbl.setVisible(show_vtype)
        self.vtype_combo.setVisible(show_vtype)
        if show_vtype:
            self.vtype_combo.blockSignals(True)
            self.vtype_combo.setCurrentIndex(0)
            self.vtype_combo.blockSignals(False)
        if rep["period"]:
            default_idx = 0 if rep.get("all_time") else (1 if rep.get("key") == "rep_cashflow" else 2)  # كل الفترات / اليوم للمالي / هذا الشهر
            self.period_combo.blockSignals(True)
            self.period_combo.setCurrentIndex(default_idx)
            self.period_combo.blockSignals(False)
            self._on_period(default_idx)
        else:
            self._reload()

    def _on_period(self, idx: int):
        if idx < 0:
            return
        choice = _PERIODS[idx]
        all_time = choice == "كل الفترات"
        custom = choice == "فترة مخصصة"
        # خانات من/إلى وزر العرض تظهر فقط عند الحاجة (توفير مساحة)
        for w in (self._from_lbl, self.dfrom, self._to_lbl, self.dto,
                  self.apply_btn):
            w.setVisible(not all_time)
        if not custom:
            if not all_time:
                d1, d2 = _period_dates(choice)
                self.dfrom.setDate(d1)
                self.dto.setDate(d2)
            self._reload()

    def _apply_custom(self):
        """زر (عرض التقرير): تعديل يدوي للتواريخ = فترة مخصصة."""
        idx = self.period_combo.currentIndex()
        if idx >= 0 and _PERIODS[idx] not in ("فترة مخصصة", "كل الفترات"):
            d1, d2 = _period_dates(_PERIODS[idx])
            if (self.dfrom.date() != d1) or (self.dto.date() != d2):
                self.period_combo.blockSignals(True)
                self.period_combo.setCurrentIndex(
                    _PERIODS.index("فترة مخصصة"))
                self.period_combo.blockSignals(False)
        self._reload()

    def _dates(self):
        if not self._rep or not self._rep["period"]:
            return ()
        idx = self.period_combo.currentIndex()
        if idx >= 0 and _PERIODS[idx] == "كل الفترات":
            return ("", "")
        return (self.dfrom.date().toString("yyyy-MM-dd"),
                self.dto.date().toString("yyyy-MM-dd"))

    def _entity1_changed(self):
        """تغيير الكيان الأول: يفلتر الكيان الثاني حسب التقرير."""
        if not self._rep or getattr(self, "_entity_loading", False):
            return
        if self._rep.get("entity_filter") == "profit":
            from ui.widgets import contract_items
            cid = self.entity_combo1.selected_data()
            self._entity_loading = True
            items = [("— كل العقود —", None)]
            items += contract_items(customer_id=cid) if cid else contract_items()
            self.entity_combo2.set_items(items, auto_select=False)
            self.entity_combo2.setCurrentIndex(0)
            self._entity_loading = False
        elif self._rep.get("entity_filter") == "execution":
            from services import workflow_service as wf
            ctype = self.entity_combo1.selected_data()
            self._entity_loading = True
            self.entity_combo2.set_items(
                [("— كل المراحل —", None)] + [(x, x) for x in wf.execution_filter_stage_names(ctype)],
                auto_select=False)
            self.entity_combo2.setCurrentIndex(0)
            self._entity_loading = False
        self._reload()

    def _clear_entities(self):
        self._entity_loading = True
        if self._rep and self._rep.get("entity_filter") == "profit":
            from ui.widgets import contract_items
            self.entity_combo1.setCurrentIndex(0)
            self.entity_combo2.set_items(
                [("— كل العقود —", None)], auto_select=False)
            self.entity_combo2.setCurrentIndex(0)
        elif self._rep and self._rep.get("entity_filter") == "execution":
            from services import workflow_service as wf
            self.entity_combo1.setCurrentIndex(0)
            self.entity_combo2.set_items(
                [("— كل المراحل —", None)] + [(x, x) for x in wf.execution_filter_stage_names()],
                auto_select=False)
            self.entity_combo2.setCurrentIndex(0)
        else:
            self.entity_combo1.setCurrentIndex(-1)
            self.entity_combo2.setCurrentIndex(-1)
            self.entity_combo1.lineEdit().setText("")
            self.entity_combo2.lineEdit().setText("")
        self._entity_loading = False
        self._reload()

    def _selected_vtype(self):
        if not self._rep or not self._rep.get("vtype_filter"):
            return None
        return self.vtype_combo.currentData()

    def _reload(self):
        if not self._rep:
            return
        if (self._rep.get("options_filter") and self.opt_combo.count()
                and self.opt_combo.currentData() is None):
            self.opt_combo.blockSignals(True)
            self.opt_combo.setCurrentIndex(0)
            self.opt_combo.blockSignals(False)
        try:
            if self._rep.get("entity_filter"):
                if self._rep.get("entity_filter") == "execution":
                    spec = self._rep["data"](
                        option=(self.opt_combo.currentData()
                                if self._rep.get("options_filter") else "current"),
                        contract_type=self.entity_combo1.selected_data(),
                        stage_name=self.entity_combo2.selected_data())
                else:
                    spec = self._rep["data"](
                        self.entity_combo1.selected_data(),
                        self.entity_combo2.selected_data())
            elif self._rep.get("vtype_filter"):
                d = self._dates()
                spec = self._rep["data"](d[0], d[1],
                                         vtype=self._selected_vtype())
            elif self._rep.get("options_filter"):
                if self._rep.get("pass_dates"):
                    d = self._dates()
                    spec = self._rep["data"](
                        option=self.opt_combo.currentData(),
                        date_from=d[0], date_to=d[1])
                else:
                    spec = self._rep["data"](
                        option=self.opt_combo.currentData())
            else:
                spec = self._rep["data"](*self._dates())
        except Exception:
            self._log_error()
            style.error(self, "تعذر تحميل بيانات التقرير.")
            return
        self._full_spec = spec            # النتائج الكاملة قبل البحث
        # التقارير الشجرية تبدأ مطوية: عميل واحد في سطر واحد
        self._collapsed = set(range(len(spec.get("rows") or []))) \
            if spec.get("tree") else set()
        self._spec = self._collapse_spec(self._filtered_spec(spec))
        self.pager.reset()
        self._redraw_page()

    # ---------- البحث داخل النتائج ----------
    def _on_search(self, _text=""):
        if not getattr(self, "_full_spec", None):
            return
        self._spec = self._collapse_spec(
            self._filtered_spec(self._full_spec))
        self.pager.reset()
        self._redraw_page()

    def _filtered_spec(self, spec: dict) -> dict:
        """تصفية صفوف التقرير بنص البحث + إعادة حساب الإجماليات الرقمية."""
        query = (self.search.text() or "").strip()
        if not query:
            return spec
        rows = [r for r in spec["rows"]
                if any(search_contains(str(c), query) for c in r)]
        out = dict(spec)
        out["rows"] = rows
        # الإجماليات تُعاد لتخصّ نتائج البحث فقط (الخانات الرقمية منها)
        totals = spec.get("totals")
        if totals:
            new_totals = list(totals)
            for j, cell in enumerate(totals):
                if isinstance(cell, (int, float)):
                    new_totals[j] = sum(
                        r[j] for r in rows
                        if j < len(r) and isinstance(r[j], (int, float)))
            out["totals"] = new_totals
        out["note"] = (f"نتائج البحث: {len(rows)} من "
                       f"{len(spec['rows'])} · {spec['note']}")
        return out

    # ---------- الشجرة: طي وفتح صف العميل ----------
    def _collapse_spec(self, spec: dict) -> dict:
        """إخفاء أبناء العملاء المطويين (العرض فقط · الطباعة تبقى كاملة)."""
        if not spec.get("tree"):
            return spec
        kinds = spec.get("row_kinds") or []
        rows = spec.get("rows") or []
        if len(kinds) != len(rows):
            return spec
        vis_rows, vis_kinds, src_index = [], [], []
        i = 0
        while i < len(rows):
            kind, n_children = kinds[i]
            vis_rows.append(rows[i])
            vis_kinds.append(kinds[i])
            src_index.append(i)
            if kind == "customer" and i in getattr(self, "_collapsed", set()):
                i += 1 + int(n_children or 0)      # تخطَّ الأبناء
                continue
            i += 1
        out = dict(spec)
        out["rows"] = vis_rows
        out["row_kinds"] = vis_kinds
        out["src_index"] = src_index
        return out

    def _on_row_clicked(self, row: int, _col: int = 0):
        """الضغط على صف عميل يفتح/يطوي شجرة عقوده."""
        spec = self._spec
        if not spec or not spec.get("tree"):
            return
        kinds = spec.get("row_kinds") or []
        src = spec.get("src_index") or []
        page_base = self.pager.page * self.pager.page_size
        idx = page_base + row
        if idx >= len(kinds) or idx >= len(src):
            return
        kind, n_children = kinds[idx]
        if kind != "customer" or not n_children:
            return
        real = src[idx]
        if real in self._collapsed:
            self._collapsed.discard(real)
        else:
            self._collapsed.add(real)
        self._spec = self._collapse_spec(
            self._filtered_spec(self._full_spec))
        self._redraw_page()

    def _redraw_page(self):
        """رسم صفحة الجدول الحالية فقط (50 صفًا) · البيانات في self._spec."""
        spec = self._spec
        if not spec:
            return
        heads = spec["heads"]
        rows = self.pager.slice(spec["rows"])
        self.table.clear()
        self.table.setColumnCount(len(heads))
        self.table.setHorizontalHeaderLabels(heads)
        # صف الإجمالي يظهر دائمًا في نهاية كل صفحة (يشمل كل الصفوف)
        extra = 1 if spec["totals"] else 0
        self.table.setRowCount(len(rows) + extra)
        # دلالة موحدة (المرحلة 4): محصّل أخضر · منصرف أحمر ·
        # المتبقي كهرماني (ليس تحذيرًا) · الخسارة أحمر
        green = QColor(style.MONEY_IN)
        red = QColor(style.MONEY_OUT)
        amber = QColor(style.MONEY_REMAIN)
        kinds = spec.get("row_kinds") or []
        name_col = spec.get("name_col")
        bayan_col = spec.get("bayan_col")
        # خط الجدول أكبر لوضوح أعلى + صف أعلى قليلاً
        base_font = self.table.font()
        base_font.setPointSizeF(max(base_font.pointSizeF(), 10.5))
        self.table.setFont(base_font)
        cust_bg = QColor(227, 236, 247)
        muted = QColor(148, 163, 184)
        accents = spec.get("accent_rows") or {}
        for i, row in enumerate(rows):
            kind = kinds[i][0] if i < len(kinds) else ""
            n_kids = kinds[i][1] if i < len(kinds) else 0
            is_cust = (kind == "customer")
            for j, val in enumerate(row):
                is_num = isinstance(val, (int, float))
                text = f"{val:,.3f}" if is_num and j in spec["number_cols"] \
                    else str(val if val is not None else "")
                # الفراغ يظهر شرطة رمادية بدل خانة فارغة مُربكة
                blank = (text == "")
                if blank and spec.get("tree"):
                    text = "—"
                item = QTableWidgetItem(text)
                # النصوص العربية لليمين · الأرقام في الوسط
                if j in (name_col, bayan_col) and not is_num:
                    item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                else:
                    item.setTextAlignment(Qt.AlignCenter)
                if blank:
                    item.setForeground(muted)
                mode = spec["color_cols"].get(j)
                if is_num and mode:
                    if mode == "green" and val:
                        item.setForeground(green)
                    elif mode == "red" and val:
                        item.setForeground(red)
                    elif mode == "auto":
                        # عمود «المتبقي/المستحق»: كهرماني عند وجود رصيد
                        item.setForeground(amber if val > 0.001 else green)
                    elif mode == "overdue":
                        item.setForeground(red if val > 0.001 else green)
                    elif mode == "profit":
                        item.setForeground(green if val >= -0.001 else red)
                # صف مميز (إجمالي/رصيد): لون خاص وخط أكبر عريض
                if len(row) > 1 and str(row[1]) in accents:
                    item.setBackground(QColor(accents[str(row[1])]))
                    f = QFont(self.table.font())
                    f.setBold(True)
                    f.setPointSizeF(self.table.font().pointSizeF() + 1.5)
                    item.setFont(f)
                # إبراز صف العميل: خلفية مميزة وخط عريض
                if is_cust:
                    item.setBackground(cust_bg)
                    f = QFont(self.table.font())
                    f.setBold(True)
                    item.setFont(f)
                    if j == name_col:
                        real = (spec.get("src_index") or [i])[i] \
                            if i < len(spec.get("src_index") or []) else i
                        if n_kids:
                            arrow = "▶" if real in self._collapsed else "▼"
                            item.setText(f"{arrow}  {text}")
                        else:
                            item.setText(f"     {text}")
                elif spec.get("tree") and j == bayan_col and not blank:
                    # فرع داخل الشجرة: إزاحة بصرية تحت اسم العميل
                    item.setText(f"       └─  {text}")
                self.table.setItem(i, j, item)
        if spec["totals"]:
            r = len(rows)
            bold = self.table.font()
            bold.setBold(True)
            for j, val in enumerate(spec["totals"]):
                is_num = isinstance(val, (int, float))
                text = f"{val:,.3f}" if is_num else str(val)
                item = QTableWidgetItem(text)
                item.setTextAlignment(Qt.AlignCenter)
                item.setFont(bold)
                item.setBackground(QColor(59, 130, 246, 28))
                self.table.setItem(r, j, item)
        # عرض كل عمود بنسبة محتواه (نفس نسب PDF) · بلا تمرير أفقي
        from ui.widgets import apply_column_weights
        weights = list(spec.get("widths") or [])
        if len(weights) != len(heads):
            weights = [10] * len(heads)
        apply_column_weights(self.table, weights,
                             min_widths=[58] * len(heads))
        self.note_lbl.setText(spec["note"])
        self.note_card.setVisible(bool(spec["note"]))

    # ---------- الطباعة والتصدير ----------
    def _title_with_period(self) -> str:
        name = self._rep["name"]
        if self._rep.get("entity_filter"):
            e1 = self.entity_combo1.selected_data()
            e2 = self.entity_combo2.selected_data()
            bits = []
            if e1 is not None:
                bits.append(self.entity_combo1.currentText())
            if e2 is not None:
                bits.append(self.entity_combo2.currentText())
            if bits:
                name += " · " + " / ".join(bits)
            return name
        if self._rep.get("vtype_filter"):
            vt = self._selected_vtype()
            if vt == "receipt":
                name += " (قبض فقط)"
            elif vt == "payment":
                name += " (صرف فقط)"
        if self._rep["period"]:
            d1, d2 = self._dates()
            if not d1:
                return f"{name} · كل الفترات"
            # يوم واحد: عنوان مختصر باسم اليوم وتاريخه بدل «من... إلى...»
            if d1 == d2:
                day = _weekday_name(d1)
                return (f"{name} عن يوم {day} {_plain_date(d1)}" if day
                        else f"{name} عن يوم {_plain_date(d1)}")
            return f"{name} · من {d1} إلى {d2}"
        return name

    def _export_pdf(self):
        if not self._spec:
            return
        # V3.18: طباعة رأسية فقط مباشرة — بلا رسالة سؤال (طلب المستخدم).
        try:
            from reports.tabular_pdf import generate_table_pdf
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.close()
            # الطباعة تشمل كل الصفوف مفتوحة دائمًا (لا تتأثر بالطي)
            s = self._filtered_spec(getattr(self, "_full_spec", None)
                                    or self._spec)
            generate_table_pdf(self._title_with_period(), s["heads"],
                               s["widths"], s["rows"], tmp.name,
                               totals_row=s["totals"],
                               footer_note=s["note"],
                               color_cols=s["color_cols"],
                               orientation="portrait",
                               row_kinds=s.get("row_kinds"),
                               right_align_cols=tuple(
                                   s.get("right_align_cols")
                                   or [x for x in (s.get("name_col"),
                                                   s.get("bayan_col"))
                                       if x is not None]),
                               number_cols=s.get("number_cols"),
                               accent_rows=s.get("accent_rows"),
                               # V3.19: التقرير المالي وحده يحتفظ بتلوين
                               # إجمالياته في الوضع الاقتصادي.
                               keep_accents_in_economy=(
                                   (self._rep or {}).get("key")
                                   == "rep_cashflow"))
            from ui.pdf_preview import PdfPreviewDialog
            PdfPreviewDialog(self, tmp.name, title=self._rep["name"],
                             save_name=f"{self._rep['file']}.pdf").exec()
        except Exception as exc:
            self._log_error()
            msg = str(exc)
            if "reportlab" in msg or "No module named 'reportlab'" in msg:
                style.error(
                    self,
                    "تعذر توليد PDF لأن مكتبة reportlab غير مثبتة.\n"
                    "شغّل INSTALL.bat مرة واحدة لتثبيت المتطلبات، أو نفّذ:\n"
                    "pip install -r requirements.txt"
                )
            else:
                style.error(self, "تعذر توليد التقرير.")

    def _export_excel(self):
        if not self._spec:
            return
        default = os.path.join(os.path.expanduser("~"),
                               f"{self._rep['file']}.xlsx")
        path, _ = QFileDialog.getSaveFileName(
            self, "حفظ التقرير", default, "Excel (*.xlsx)")
        if not path:
            return
        try:
            from reports.tabular_pdf import generate_table_excel
            # التصدير يشمل كل الصفوف مفتوحة دائمًا (لا يتأثر بالطي)
            s = self._filtered_spec(getattr(self, "_full_spec", None)
                                    or self._spec)
            generate_table_excel(self._title_with_period(), s["heads"],
                                 s["rows"], path, totals_row=s["totals"],
                                 number_cols=s["number_cols"],
                                 accent_rows=s.get("accent_rows"))
            style.info(self, f"تم توليد التقرير:\n{path}", "تم")
            from ui.invoices import open_file_externally
            open_file_externally(path)
        except Exception:
            self._log_error()
            style.error(self, "تعذر توليد التقرير.")

    @staticmethod
    def _log_error():
        import traceback
        try:
            log_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "data", "error.log")
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write("\n" + traceback.format_exc())
        except Exception:
            pass


# ============================================================
# الصفحة الرئيسية لمركز التقارير
# ============================================================
class ReportsPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("page")
        self._build()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 10, 16, 10)
        layout.setSpacing(10)

        self.stack = QStackedWidget()
        layout.addWidget(self.stack)

        # ===== صفحة 0: بطاقات التقارير =====
        cards_page = QWidget()
        cards_layout = QVBoxLayout(cards_page)
        cards_layout.setContentsMargins(0, 0, 0, 0)
        cards_layout.setSpacing(10)
        title_col = QVBoxLayout()
        title_col.setSpacing(2)
        title = QLabel("التقارير")
        title.setProperty("pageTitle", True)
        desc = QLabel("اختر التقرير ثم اطبعه PDF أو صدّره Excel")
        desc.setProperty("pageDesc", True)
        title_col.addWidget(title)
        title_col.addWidget(desc)
        cards_layout.addLayout(title_col)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        holder = QWidget()
        holder.setObjectName("page")
        vbox = QVBoxLayout(holder)
        vbox.setSpacing(14)
        vbox.setContentsMargins(0, 0, 0, 0)
        self._cards_holder = holder
        self._rebuild_cards()
        scroll.setWidget(holder)
        cards_layout.addWidget(scroll, 1)
        self.stack.addWidget(cards_page)

        # ===== صفحة 1: عرض تقرير =====
        self.view = _ReportView(self)
        self.stack.addWidget(self.view)

    def _rebuild_cards(self):
        """إعادة بناء بطاقات التقارير (تتغير مع تفعيل/تعطيل المديولات).

        مجمعة حسب مديول التقرير من FEATURES (بيانات قائمة لا اختراع) —
        وفهرس البطاقة هو موضعها في self._visible فيبقى open_report(i)
        صالحًا لكل المنادين.
        """
        from services.feature_service import FEATURES
        holder = getattr(self, "_cards_holder", None)
        if holder is None or holder.layout() is None:
            return
        lay = holder.layout()
        # لا setParent(None) — كان يفتح نوافذ شبحية صغيرة تومض فوق الشاشة.
        from ui.widgets import dispose_widget as _dispose, flush_disposed
        while lay.count():
            item = lay.takeAt(0)
            w = item.widget()
            if w is not None:
                _dispose(w, host=self)
        flush_disposed()
        self._visible = visible_reports()
        groups: dict[str, list[tuple[int, dict]]] = {}
        for i, rep in enumerate(self._visible):
            groups.setdefault(rep.get("module") or "", []).append((i, rep))
        for mod in groups:
            title = ("التقارير العامة" if not mod
                     else f"تقارير {FEATURES.get(mod, {}).get('name', mod)}")
            sec = QLabel(title)
            sec.setProperty("sectionTitle", True)
            lay.addWidget(sec)
            grid = QGridLayout()
            grid.setSpacing(14)
            grid.setContentsMargins(0, 0, 0, 0)
            for j, (i, rep) in enumerate(groups[mod]):
                grid.addWidget(self._report_card(i, rep), j // 2, j % 2)
            wrap = QWidget()
            wrap.setObjectName("transparentHost")
            wrap.setLayout(grid)
            lay.addWidget(wrap)
        lay.addStretch()

    def modules_refreshed(self):
        """يُستدعى بعد تغيير المديولات: تُحدَّث القائمة وتُغلق أي تقرير مخفي."""
        current = self._rep_name_of_view()
        self._rebuild_cards()
        if current and all(r["name"] != current for r in self._visible):
            self.show_cards()

    def _rep_name_of_view(self) -> str:
        rep = getattr(self.view, "_rep", None)
        return (rep or {}).get("name", "") if isinstance(rep, dict) else ""

    def _report_card(self, index: int, rep: dict) -> QFrame:
        card = QFrame()
        card.setProperty("card", True)
        card.setCursor(Qt.PointingHandCursor)
        soft_shadow(card, radius=24, y=6)
        col = QVBoxLayout(card)
        col.setContentsMargins(18, 14, 18, 14)
        col.setSpacing(6)
        head = QHBoxLayout()
        icon = QLabel(rep["icon"])
        icon.setStyleSheet("font-size: 22.1px;")
        name = QLabel(rep["name"])
        name.setStyleSheet("font-size: 13.6px; font-weight: 800;")
        head.addWidget(icon)
        head.addWidget(name, 1)
        col.addLayout(head)
        desc = QLabel(rep["desc"])
        desc.setWordWrap(True)
        desc.setProperty("pageDesc", True)
        col.addWidget(desc)
        btns = QHBoxLayout()
        open_btn = QPushButton("🔍 فتح التقرير")
        # ثانوي لا أساسي: 11 بطاقة في الشاشة، ولو كلها زرقاء تختفي الأولوية
        # (القاعدة 23: زر أساسي واحد لكل شاشة)
        open_btn.setToolTip(f"فتح {rep['name']} وعرض بياناته")
        open_btn.setCursor(Qt.PointingHandCursor)
        open_btn.clicked.connect(lambda _, i=index: self.open_report(i))
        btns.addStretch()
        btns.addWidget(open_btn)
        col.addLayout(btns)
        card.mousePressEvent = lambda e, i=index: self.open_report(i)
        return card

    # ---------- تنقل ----------
    def open_report(self, index: int):
        """فتح تقرير محدد في الصفحة الداخلية (يُستدعى أيضًا من القائمة)."""
        reports = getattr(self, "_visible", None) or visible_reports()
        if 0 <= index < len(reports):
            self.view.load(reports[index])
            self.stack.setCurrentIndex(1)

    def show_cards(self):
        self.stack.setCurrentIndex(0)

    def refresh(self):
        """تحديث بيانات التقرير المفتوح حاليًا (إن وجد)."""
        if self.stack.currentIndex() == 1 and self.view._rep:
            self.view._reload()
