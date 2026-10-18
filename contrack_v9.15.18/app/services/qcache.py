# -*- coding: utf-8 -*-
"""ذاكرة بناء الصفحات: تُفعَّل أثناء بناء صفحة ثقيلة فقط.

الفكرة: صفحات مثل مركز العقد تقرأ نفس البيانات مكررة (العقد 12 مرة،
المجاميع 10 مرات...) لأن كل تبويب يبني نفسه مستقلًا. داخل النطاق نخزّن
نتيجة القراءات المغلّفة ونعيد نسخة عميقة منها — بلا أي رحلة شبكة زائدة.

الأمان:
  • تُفعَّل أثناء البناء فقط (لا كتابة داخل النطاق) ثم تُهمل تلقائيًا.
  • تُعاد نسخة عميقة عند كل إصابة فلا يتشارك المستدعون نفس الكائن.
  • خارج النطاق: تمرير مباشر بلا أي سلوك مختلف.
"""
import copy
from contextlib import contextmanager

_CACHE: dict | None = None


@contextmanager
def build_cache():
    """نطاق بناء صفحة — المتداخل يشارك ذاكرة الخارجي."""
    global _CACHE
    if _CACHE is not None:
        yield _CACHE
        return
    _CACHE = {}
    try:
        yield _CACHE
    finally:
        _CACHE = None


def memo(key, fn):
    """نفّذ fn مرة واحدة لكل مفتاح داخل النطاق."""
    if _CACHE is None:
        return fn()
    if key not in _CACHE:
        _CACHE[key] = fn()
    return copy.deepcopy(_CACHE[key])
