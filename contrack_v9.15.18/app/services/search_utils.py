# -*- coding: utf-8 -*-
"""أدوات البحث العربي الموحد في كل النظام.

الهدف: المستخدم يكتب أي جزء من الاسم/الكود/الهاتف، ومع تطبيع الفروق
العربية الشائعة (أ/إ/آ، ة/ه، ى/ي...) فتظهر النتيجة بدون مطابقة حرفية.
"""
from __future__ import annotations

_AR_REPL = (
    ("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"),
    ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي"),
    ("ـ", ""),
)


def normalize(text: str | None) -> str:
    n = str(text or "").strip().lower()
    # إزالة تشكيل عربي شائع
    for ch in "ًٌٍَُِّْٰـ":
        n = n.replace(ch, "")
    for a, b in _AR_REPL:
        n = n.replace(a, b)
    return " ".join(n.split())


def contains(haystack: str | None, needle: str | None) -> bool:
    q = normalize(needle)
    if not q:
        return True
    return q in normalize(haystack)


def like_param(query: str | None) -> str:
    return f"%{normalize(query)}%"


def sql_norm_expr(column: str) -> str:
    """تعبير SQLite يطبّع عمودًا نصيًا بنفس قواعد normalize بقدر الإمكان."""
    expr = f"LOWER(COALESCE({column},''))"
    for a, b in _AR_REPL:
        expr = f"REPLACE({expr},'{a}','{b}')"
    # بعض التشكيل والمسافات التطويلية
    for ch in "ًٌٍَُِّْٰـ":
        expr = f"REPLACE({expr},'{ch}','')"
    return expr


def sql_like_any(columns: list[str] | tuple[str, ...]) -> tuple[str, list]:
    """يبني شرط OR normalized LIKE لعدة أعمدة؛ المعاملات يملؤها caller."""
    return "(" + " OR ".join(f"{sql_norm_expr(c)} LIKE ?" for c in columns) + ")", []


def normalized_search_clause(columns: list[str] | tuple[str, ...], query: str | None) -> tuple[str, list[str]]:
    clause, _ = sql_like_any(columns)
    like = like_param(query)
    return clause, [like] * len(columns)
