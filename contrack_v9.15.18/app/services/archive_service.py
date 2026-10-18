# -*- coding: utf-8 -*-
"""أرشيف العملاء: مجلد ملفات لكل عميل يُنشأ تلقائيًا.

- كل عميل له مجلد باسم رقمه واسمه داخل data/archive/
- يُحفظ فيه كل ما يُصدَّر له (فواتير، كشوف حساب) تلقائيًا
- يمكن إضافة أي ملفات خارجية (عقود موقعة، صور، مستندات...)
"""
import os
import re
import shutil
from datetime import datetime

from database.models import Customer

def _archive_dir() -> str:
    """مجلد الأرشيف — يتبع مجلد البيانات الفعلي (محلي أو شبكي) لحظة
    الاستخدام، لا وقت الاستيراد."""
    from database import database as _db
    return os.path.join(_db.DATA_DIR, "archive")


def _safe_name(text: str) -> str:
    """تنظيف الاسم ليصلح كاسم مجلد."""
    text = re.sub(r'[\\/:*?"<>|]', "_", text).strip()
    return text[:60] or "customer"


def get_customer_folder(customer: Customer) -> str:
    """مجلد أرشيف العميل · يُنشأ إن لم يوجد."""
    folder = os.path.join(
        _archive_dir(), f"{customer.customer_code}_{_safe_name(customer.name)}")
    os.makedirs(folder, exist_ok=True)
    return folder


def list_files(customer: Customer, limit: int | None = None) -> list[dict]:
    """قائمة ملفات أرشيف العميل مع معلوماتها، الأحدث أولاً.

    limit اختياري لحماية الشاشة من التجمّد عند وجود آلاف الملفات بعد
    استعادة نسخة قديمة أو اختيار مجلد أرشيف كبير.
    """
    folder = get_customer_folder(customer)
    items = []
    try:
        names = os.listdir(folder)
        # افحص الملفات الأحدث أولًا قدر الإمكان بدون عمل stat لكل شيء مرتين.
        for name in names:
            if limit is not None and len(items) >= max(1, int(limit)):
                break
            path = os.path.join(folder, name)
            if not os.path.isfile(path):
                continue
            stat = os.stat(path)
            items.append({
                "name": name,
                "path": path,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime),
                "ext": os.path.splitext(name)[1].lower(),
            })
    except OSError:
        return []
    items.sort(key=lambda x: x["modified"], reverse=True)
    return items


def save_to_archive(customer: Customer, src_path: str,
                    new_name: str | None = None,
                    overwrite: bool = False) -> str:
    """نسخ ملف إلى أرشيف العميل. يرجع المسار الجديد.

    overwrite=True: يستبدل الملف بنفس الاسم (للمستندات المولّدة تلقائيًا
    مثل الفواتير · أحدث نسخة تحل محل القديمة بدل التكرار).
    """
    folder = get_customer_folder(customer)
    name = new_name or os.path.basename(src_path)
    name = _safe_name_file(name)
    dest = os.path.join(folder, name)
    if os.path.exists(dest) and not overwrite:
        base, ext = os.path.splitext(name)
        stamp = datetime.now().strftime("%H%M%S")
        dest = os.path.join(folder, f"{base}_{stamp}{ext}")
    shutil.copy2(src_path, dest)
    return dest


def _safe_name_file(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "file"


def delete_file(path: str) -> None:
    """حذف ملف من الأرشيف (يجب أن يكون داخل مجلد الأرشيف)."""
    real = os.path.realpath(path)
    if not real.startswith(os.path.realpath(_archive_dir())):
        raise ValueError("الملف خارج مجلد الأرشيف.")
    os.remove(real)


def format_size(size: int) -> str:
    if size < 1024:
        return f"{size} بايت"
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} ك.ب"
    return f"{size / (1024 * 1024):.1f} م.ب"
