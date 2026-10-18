# -*- coding: utf-8 -*-
"""واجهة خدمات رفيعة للوصول إلى مرافق قاعدة البيانات من الواجهة.

الغرض: منع ملفات ui من استيراد database.database مباشرة، مع إبقاء عمليات
النسخ الاحتياطي/الشبكة وأخطاء قاعدة البيانات خلف services كما تنص البنية.
"""
from database.database import (  # noqa: F401
    BASE_DIR, DATA_DIR, DB_PATH, DatabaseError, _NET_CONFIG,
    backup_db, network_mode, restore_db, schedule_restore_db,
    apply_pending_restore, set_network_folder,
)
