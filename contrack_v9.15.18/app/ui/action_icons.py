# -*- coding: utf-8 -*-
"""V3.2 (و): السجل المركزي لأيقونات الأزرار — هوية موحدة لكل الشاشات.

القاعدة: أي زر يحمل فعلًا من الأسفل يجب أن يبدأ بالأيقونة المعتمدة.
يفرضها اختبار ``tests/test_action_icons.py`` (فحص استاتيكي).
"""
from __future__ import annotations

from PySide6.QtWidgets import QPushButton

#: الفعل → الأيقونة المعتمدة
ICONS: dict[str, str] = {
    "export_excel": "📤",    # تصدير Excel (مسمى أو أيقونة فقط)
    "print": "🖨",           # طباعة / معاينة / PDF
    "download": "⬇",         # تنزيل / تحميل قالب أو نموذج
    "save": "💾",            # حفظ
    "add": "＋",             # إضافة / جديد
    "edit": "✎",             # تعديل
    "delete": "🗑",          # حذف
    "cancel": "✕",           # إلغاء / إغلاق
    "refresh": "🔄",         # تحديث / إعادة / مزامنة
    "search": "🔍",          # بحث / عرض
    "import": "📥",          # استيراد
    "open": "📂",            # فتح (مجلد/عقد/معالج)
    "approve": "✔",          # موافقة / تأكيد
    "archive": "📁",         # حفظ في ملف / أرشفة
    "report": "📊",          # تقرير
    "fix": "🔧",             # إصلاح
    "gaps": "⚠️",            # الفروقات
    "reset_password": "🔑",  # إعادة تعيين كلمة المرور
    "reopen": "↩",           # إعادة فتح
}


def icon_for(action: str) -> str:
    """أيقونة الفعل المعتمدة (سلسلة فارغة لفعل غير مسجل)."""
    return ICONS.get(action, "")


def label(action: str, text: str) -> str:
    """نص زر موحد: الأيقونة المعتمدة + النص (إن لم يكن مسبوقًا بها)."""
    icon = icon_for(action)
    if not icon or text.startswith(icon):
        return text
    return f"{icon} {text}"


def action_button(action: str, text: str,
                  kind: str = "flat") -> QPushButton:
    """زر جاهز بالهوية الموحدة.

    kind: primary (إجراء رئيسي) · danger (حذف/خطر) · flat (ثانوي).
    """
    btn = QPushButton(label(action, text))
    if kind == "primary":
        btn.setObjectName("btnPrimary")
    elif kind == "danger":
        btn.setProperty("danger", True)
        btn.setProperty("flat", True)
    else:
        btn.setProperty("flat", True)
    return btn
