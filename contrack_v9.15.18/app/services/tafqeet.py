# -*- coding: utf-8 -*-
"""التفقيط العربي: تحويل المبالغ إلى حروف · يدعم الدينار الكويتي (3 خانات فلس)."""

_ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة",
         "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر",
         "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر",
         "تسعة عشر"]
_TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون",
         "سبعون", "ثمانون", "تسعون"]
_HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة",
             "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"]


def _below_thousand(n: int) -> str:
    """تفقيط رقم أقل من 1000."""
    parts = []
    h, rem = divmod(n, 100)
    if h:
        parts.append(_HUNDREDS[h])
    if rem:
        if rem < 20:
            parts.append(_ONES[rem])
        else:
            t, u = divmod(rem, 10)
            if u:
                parts.append(f"{_ONES[u]} و{_TENS[t]}")
            else:
                parts.append(_TENS[t])
    return " و".join(parts)


def _scale(n: int, singular: str, dual: str, plural: str) -> str:
    """صيغة الألف/المليون حسب العدد."""
    if n == 1:
        return singular
    if n == 2:
        return dual
    below = _below_thousand(n)
    if 3 <= n <= 10:
        return f"{below} {plural}"
    return f"{below} {singular}"


def number_to_words(n: int) -> str:
    """تفقيط عدد صحيح حتى المليارات."""
    if n == 0:
        return "صفر"
    parts = []
    billions, rem = divmod(n, 1_000_000_000)
    millions, rem = divmod(rem, 1_000_000)
    thousands, below = divmod(rem, 1_000)
    if billions:
        parts.append(_scale(billions, "مليار", "ملياران", "مليارات"))
    if millions:
        parts.append(_scale(millions, "مليون", "مليونان", "ملايين"))
    if thousands:
        parts.append(_scale(thousands, "ألف", "ألفان", "آلاف"))
    if below:
        parts.append(_below_thousand(below))
    return " و".join(parts)


def amount_to_words(value: float, currency: str = "د.ك") -> str:
    """تفقيط مبلغ مالي: «فقط ستمائة دينار كويتي لا غير»."""
    # أسماء العملة
    if "د.ك" in currency or "دينار" in currency:
        main_name, sub_name, sub_per_main = "دينار كويتي", "فلس", 1000
    elif "ر.س" in currency or "ريال" in currency:
        main_name, sub_name, sub_per_main = "ريال سعودي", "هللة", 100
    elif "د.إ" in currency or "درهم" in currency:
        main_name, sub_name, sub_per_main = "درهم إماراتي", "فلس", 100
    elif "ج.م" in currency or "جنيه" in currency:
        main_name, sub_name, sub_per_main = "جنيه مصري", "قرش", 100
    else:
        main_name, sub_name, sub_per_main = currency, "", 1000

    total_subs = round(value * sub_per_main)
    main, sub = divmod(total_subs, sub_per_main)

    parts = []
    if main:
        parts.append(f"{number_to_words(main)} {main_name}")
    if sub and sub_name:
        parts.append(f"{number_to_words(sub)} {sub_name}")
    if not parts:
        return f"صفر {main_name} لا غير"
    return f"فقط {' و'.join(parts)} لا غير"
