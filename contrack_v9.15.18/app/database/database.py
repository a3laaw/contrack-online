# ============================================================
# الملف: database/database.py
# طبقة SQLite: schema + connection + migrations + backup/restore
# ============================================================
# -*- coding: utf-8 -*-
"""طبقة الاتصال بقاعدة البيانات SQLite."""
import os
import shutil
import sqlite3
import threading
import sys
import time
from datetime import datetime

if getattr(sys, "frozen", False):
    # عند التشغيل كملف EXE: البيانات بجوار الملف التنفيذي (وليس المجلد المؤقت)
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

# ===== وضع الشبكة المحلية =====
# لو وُجد ملف network_folder.txt بجوار البرنامج وفيه مسار مجلد مشترك
# (مثل: \\SERVER\ContractsData) تُحفظ قاعدة البيانات هناك — فتعمل
# عدة أجهزة على نفس البيانات. الملف يُضبط من: الإعدادات ← النسخ الاحتياطي.
_NET_CONFIG = os.path.join(BASE_DIR, "network_folder.txt")
_PENDING_RESTORE = os.path.join(BASE_DIR, "pending_restore.txt")


def _validate_network_folder(folder: str) -> tuple:
    """التحقق من صحة المجلد الشبكي وإمكانية الكتابة فيه.
    
    ترجع: (صحيح/خطأ, رسالة الخطأ)
    """
    folder = folder.strip()
    
    if not folder:
        return False, "المسار فارغ"
    
    # التحقق من وجود المجلد
    if not os.path.isdir(folder):
        return False, f"المجلد غير موجود: {folder}"
    
    # التحقق من إمكانية القراءة
    if not os.access(folder, os.R_OK):
        return False, f"لا توجد صلاحية قراءة للمجلد: {folder}"
    
    # التحقق من إمكانية الكتابة (مهم جداً)
    if not os.access(folder, os.W_OK):
        return False, f"لا توجد صلاحية كتابة في المجلد: {folder}"
    
    # اختبار إنشاء ملف مؤقت للتأكد من الصلاحيات الفعلية
    test_file = os.path.join(folder, ".test_write_temp")
    try:
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("test")
        os.remove(test_file)
    except OSError as e:
        return False, f"فشل اختبار الكتابة: {e}"
    
    return True, ""


# V5.9: حالة تحديد مجلد البيانات — تمنع «الفشل الصامت» للوضع المحلي.
# لو تعذّر الوصول للشير لحظيًا: لا يُحذف ملف الإعداد أبدًا، ويعمل البرنامج
# على القاعدة المحلية مع تحذير واضح في الواجهة + إمكانية إعادة المحاولة.
RESOLVE_INFO = {
    "mode": "local",          # network | local | local_fallback
    "active": "",             # المجلد المستخدم فعليًا
    "configured": "",         # المسار المحفوظ في network_folder.txt
    "reason": "",             # سبب العودة المحلية (عند local_fallback)
}


def _resolve_data_dir() -> str:
    """تحديد مجلد قاعدة البيانات (محلي أو شبكي) مع التحقق من الصحة.

    V5.9: عند تعذّر الوصول للشير لا يُحذف ملف الإعداد (السلوك القديم كان
    يحذفه فينزل البرنامج محليًا بلا إنذار) — بل يُسجَّل السبب في RESOLVE_INFO
    ليعرضه البرنامج في لافتة واضحة.
    """
    configured = ""
    reason = ""
    try:
        if os.path.exists(_NET_CONFIG):
            with open(_NET_CONFIG, encoding="utf-8-sig") as fh:
                configured = folder = fh.read().strip()
            if folder:
                # التحقق من صحة المجلد قبل استخدامه
                is_valid, error_msg = _validate_network_folder(folder)
                if is_valid:
                    RESOLVE_INFO.update(mode="network", active=folder,
                                        configured=folder, reason="")
                    return folder
                reason = error_msg or "تعذّر الوصول لمجلد الشبكة"
                print(f"⚠️ تحذير: مجلد الشبكة غير متاح ({reason}) - "
                      "سيعمل البرنامج مؤقتًا على قاعدة محلية")
    except OSError as e:
        reason = str(e)
        print(f"⚠️ خطأ في قراءة إعدادات الشبكة: {e}")

    # العودة للمسار المحلي الافتراضي
    local_dir = os.path.join(BASE_DIR, "data")
    os.makedirs(local_dir, exist_ok=True)
    RESOLVE_INFO.update(
        mode=("local_fallback" if configured else "local"),
        active=local_dir, configured=configured, reason=reason)
    return local_dir


DATA_DIR = _resolve_data_dir()
DB_PATH = os.path.join(DATA_DIR, "database.sqlite")


def resolve_status() -> dict:
    """حالة مجلد البيانات الحالية — تستخدمها لافتة الواجهة (V5.9)."""
    return dict(RESOLVE_INFO)


def is_local_fallback() -> bool:
    """هل نزل البرنامج محليًا بسبب تعذّر الوصول للشير؟"""
    return RESOLVE_INFO.get("mode") == "local_fallback"


def recheck_configured_folder() -> tuple:
    """إعادة محاولة الوصول لمسار الشير المحفوظ بلا تبديل الجلسة.

    ترجع: (متاح؟, رسالة) — عند النجاح لا نبدّل القاعدة في منتصف الجلسة؛
    تطلب الواجهة إعادة تشغيل البرنامج ليعمل على قاعدة الشير.
    """
    folder = ""
    try:
        with open(_NET_CONFIG, encoding="utf-8-sig") as fh:
            folder = fh.read().strip()
    except OSError:
        return False, "لا يوجد إعداد شبكة محفوظ."
    if not folder:
        return False, "لا يوجد إعداد شبكة محفوظ."
    ok, err = _validate_network_folder(folder)
    if ok:
        RESOLVE_INFO.update(configured=folder, reason="")
        return True, folder
    RESOLVE_INFO.update(reason=err or "")
    return False, (err or "تعذّر الوصول للشير")


def network_mode() -> bool:
    """هل البرنامج يعمل على مجلد شبكة مشترك؟"""
    return os.path.normpath(DATA_DIR) != os.path.normpath(
        os.path.join(BASE_DIR, "data"))


def set_network_folder(folder: str) -> None:
    """حفظ مسار المجلد المشترك مع التحقق والنقل الآمن.
    
    يرفع خطأ إذا كان المجلد غير صالح.
    """
    global DATA_DIR, DB_PATH
    
    folder = (folder or "").strip()
    
    if folder:
        # أغلق أي اتصال مفتوح قبل تبديل مسار القاعدة؛ وإلا قد تبقى
        # الواجهة تقرأ من قاعدة وتكتب في أخرى داخل نفس الجلسة.
        try:
            close_connections()
        except Exception:
            pass
        # التحقق من صحة المجلد قبل الحفظ
        is_valid, error_msg = _validate_network_folder(folder)
        if not is_valid:
            raise OSError(f"لا يمكن استخدام هذا المجلد: {error_msg}")
        
        # حفظ المسار في ملف الإعدادات
        with open(_NET_CONFIG, "w", encoding="utf-8") as fh:
            fh.write(folder)
        
        # نقل قاعدة البيانات الحالية إلى المجلد الجديد إذا لم تكن موجودة
        local_db = os.path.join(BASE_DIR, "data", "database.sqlite")
        network_db = os.path.join(folder, "database.sqlite")
        
        if os.path.exists(local_db) and not os.path.exists(network_db):
            try:
                # نسخ قاعدة SQLite عبر backup API أكثر أمانًا من copy2، خصوصًا
                # إذا كانت القاعدة المحلية تعمل سابقًا بوضع WAL.
                close_connections()
                os.makedirs(folder, exist_ok=True)
                src = sqlite3.connect(local_db, timeout=30.0)
                try:
                    dst = sqlite3.connect(network_db, timeout=30.0)
                    try:
                        src.backup(dst)
                        dst.commit()
                    finally:
                        dst.close()
                finally:
                    src.close()
                print(f"✅ تم نقل قاعدة البيانات إلى: {network_db}")
            except (OSError, sqlite3.Error) as e:
                # فشل النقل - نحذف ملف الإعداد ونعود للمحلي
                try:
                    os.remove(_NET_CONFIG)
                except OSError:
                    pass
                DATA_DIR = os.path.join(BASE_DIR, "data")
                DB_PATH = os.path.join(DATA_DIR, "database.sqlite")
                raise OSError(f"فشل نقل قاعدة البيانات: {e}")
        # نقل بيانات النظام المشتركة مع القاعدة (قوالب النماذج ومستنداتها
        # + أرشيف العملاء) — بلا كتابة فوق شيء موجود على الشبكة
        for sub in ("forms", "archive"):
            local_sub = os.path.join(BASE_DIR, "data", sub)
            net_sub = os.path.join(folder, sub)
            if os.path.isdir(local_sub) and not os.path.exists(net_sub):
                try:
                    shutil.copytree(local_sub, net_sub)
                    print(f"✅ تم نقل {sub} إلى: {net_sub}")
                except OSError:
                    pass          # بيانات إضافية — فشلها لا يوقف التبديل
        
        # تحديث المتغيرات العامة
        DATA_DIR = folder
        DB_PATH = network_db
        
    elif os.path.exists(_NET_CONFIG):
        # إلغاء وضع الشبكة والعودة للمسار المحلي
        try:
            close_connections()
        except Exception:
            pass
        os.remove(_NET_CONFIG)
        DATA_DIR = os.path.join(BASE_DIR, "data")
        DB_PATH = os.path.join(DATA_DIR, "database.sqlite")
        os.makedirs(DATA_DIR, exist_ok=True)


_SCHEMA = """

CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    phone         TEXT DEFAULT '',
    address       TEXT DEFAULT '',
    address_governorate TEXT DEFAULT '',
    address_area  TEXT DEFAULT '',
    address_block TEXT DEFAULT '',
    address_plot  TEXT DEFAULT '',
    email         TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS contracts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_number TEXT NOT NULL UNIQUE,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    contract_date   TEXT NOT NULL,
    description     TEXT DEFAULT '',
    amount          REAL NOT NULL CHECK (amount > 0),
    notes           TEXT DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    customer_id    INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    contract_id    INTEGER NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
    invoice_date   TEXT NOT NULL,
    description    TEXT DEFAULT '',
    amount         REAL NOT NULL CHECK (amount > 0),
    notes          TEXT DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    company_name    TEXT DEFAULT '',
    company_address TEXT DEFAULT '',
    company_phone   TEXT DEFAULT '',
    company_email   TEXT DEFAULT '',
    logo_path       TEXT DEFAULT '',
    header_title    TEXT DEFAULT 'نظام إدارة العقود والمحاسبة',
    currency        TEXT DEFAULT 'د.ك',
    invoice_primary TEXT DEFAULT '#1e3a5f',
    invoice_accent  TEXT DEFAULT '#2e86ab',
    auto_backup_enabled  INTEGER DEFAULT 1,
    auto_backup_interval INTEGER DEFAULT 24,
    auto_backup_folder   TEXT DEFAULT '',
    last_backup_at       TEXT DEFAULT '',
    ui_theme             TEXT DEFAULT 'light',
    opening_balance_bank REAL DEFAULT 0,
    opening_balance_cash REAL DEFAULT 0,
    sub_pay_client_gate INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- الصلاحيات الدقيقة لكل مستخدم (Granular Permissions)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id  INTEGER NOT NULL,
    perm_key TEXT NOT NULL,
    allowed  INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, perm_key)
);

-- ============================================================
-- مركز النماذج (Generic Form Engine) — نماذج PDF قابلة للتعبئة
-- النموذج الأصلي يبقى كما هو (overlay فوقه) · إصدارات محفوظة ·
-- حقول يدوية أو مربوطة ببيانات النظام أو تلقائية أو محسوبة.
-- ============================================================
CREATE TABLE IF NOT EXISTS form_categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS form_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    base_name   TEXT NOT NULL,          -- الاسم الموحد عبر الإصدارات
    version     INTEGER NOT NULL DEFAULT 1,
    description TEXT DEFAULT '',
    category_id INTEGER,
    status      TEXT NOT NULL DEFAULT 'مسودة',  -- مسودة/معتمد/معطل/مؤرشف
    pdf_path    TEXT NOT NULL,
    pages_count INTEGER NOT NULL DEFAULT 1,
    -- هوية الطباعة على المستند المولَّد:
    -- none = لا شيء (النموذج كامل الهوية بنفسه)
    -- logo = لوجو الشركة فقط (نماذج الوزارات ذات الترويسة الرسمية)
    -- full = ترويسة الشركة أعلى الصفحة + الفوتر أسفلها
    print_identity TEXT NOT NULL DEFAULT 'none',
    -- مصدر النموذج: pdf = ملف PDF أصلي · word = ملف Word قابل للتعديل
    -- (قوالب Word: المعاينة PDF مولَّد، والناتج النهائي .docx قابل
    -- للتعديل — خانات مرسومة + حقول {{...}} داخل النص)
    source_type   TEXT NOT NULL DEFAULT 'pdf',
    word_path     TEXT DEFAULT '',      -- ملف الوورد الأصلي (للقوالب word)
    created_by  TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    updated_by  TEXT DEFAULT '',
    updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS form_fields (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id   INTEGER NOT NULL,
    name          TEXT NOT NULL,
    field_type    TEXT NOT NULL DEFAULT 'text',  -- text/longtext/number/money/date/choice/bool/table/signature/image
    page          INTEGER NOT NULL DEFAULT 1,
    x             REAL NOT NULL DEFAULT 0,   -- نقاط PDF · أعلى-يسار
    y             REAL NOT NULL DEFAULT 0,
    w             REAL NOT NULL DEFAULT 120,
    h             REAL NOT NULL DEFAULT 18,
    source_type   TEXT NOT NULL DEFAULT 'manual',  -- manual/system/auto/calc
    source_entity TEXT DEFAULT '',   -- customers/contracts/settings/system
    source_key    TEXT DEFAULT '',
    context       TEXT DEFAULT '',   -- customer/contract — يحدد شاشة الاختيار
    default_value TEXT DEFAULT '',
    options       TEXT DEFAULT '',   -- JSON: خيارات القائمة/أعمدة الجدول
    required      INTEGER NOT NULL DEFAULT 0,
    align         TEXT NOT NULL DEFAULT 'right',
    sort          INTEGER NOT NULL DEFAULT 0,
    -- خانة استمرار: هذا الحقل يستقبل النص الزائد من حقل آخر (تدفق
    -- نصي بين خانتين أو أكثر — شائع في نماذج الوزارات)
    continues_field_id INTEGER,
    -- حقل نصي داخل قالب Word: {{placeholder} يُستبدل بالقيمة في مكان
    -- كتابته داخل الوورد نفسه (بلا إحداثيات — ليس خانة مرسومة)
    placeholder   TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS form_documents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id      INTEGER NOT NULL,
    template_version INTEGER NOT NULL DEFAULT 1,
    title            TEXT DEFAULT '',
    values_json      TEXT NOT NULL DEFAULT '{}',
    pdf_path         TEXT DEFAULT '',
    word_path        TEXT DEFAULT '',   -- ملف Word المولَّد (قوالب word)
    customer_id      INTEGER,
    contract_id      INTEGER,
    created_by       TEXT DEFAULT '',
    created_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_form_fields_tpl ON form_fields(template_id);

-- ============================================================
-- جدول الزيارات اليومي: صفوف الساعات × أعمدة المهندسين
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    phone       TEXT DEFAULT '',
    notes       TEXT DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS visit_staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    phone       TEXT DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0
);

-- قالب دفعات نوع العقد: يُسحب جاهزًا عند إنشاء أي عقد من النوع —
-- كل دفعة برقمها ونسبتها ومرحلتها المرتبطة (مرحلة ↔ دفعة واحدة)
-- نسخة العقد من شجرة مراحل نوعه + إعداداتها المالية: تُؤخذ Snapshot
-- عند إنشاء العقد — فتعديل القالب لاحقًا لا يمس العقود القديمة أبدًا
CREATE TABLE IF NOT EXISTS contract_stages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id   INTEGER NOT NULL REFERENCES contracts(id),
    name          TEXT NOT NULL,
    level         INTEGER NOT NULL DEFAULT 1,
    parent_name   TEXT DEFAULT '',
    expected_days INTEGER NOT NULL DEFAULT 0,
    pay_pct       REAL NOT NULL DEFAULT 0,
    pay_kind      TEXT NOT NULL DEFAULT '',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    start_date    TEXT DEFAULT '',
    end_date      TEXT DEFAULT '',
    is_skipped    INTEGER NOT NULL DEFAULT 0,
    closed_by     TEXT DEFAULT '',
    is_supervision INTEGER NOT NULL DEFAULT 0,
    sup_start     TEXT DEFAULT '',
    sup_end       TEXT DEFAULT '',
    sup_actual_end TEXT DEFAULT '',
    sup_monthly   REAL NOT NULL DEFAULT 0,
    sup_waived_months REAL NOT NULL DEFAULT 0,
    sup_waive_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS type_payment_tpl (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_type TEXT NOT NULL,
    pay_no        INTEGER NOT NULL DEFAULT 1,
    title         TEXT NOT NULL DEFAULT '',
    pct           REAL NOT NULL DEFAULT 0,
    -- مبلغ ثابت بدل النسبة (0 = بالنسبة)
    amount_fixed  REAL NOT NULL DEFAULT 0,
    stage_id      INTEGER REFERENCES workflow_stages(id),
    -- المرحلة المُحفِّزة: إنهاؤها فعليًا هو ما يستحق الدفعة (يجب أن
    -- تكون من مراحل الدفعة؛ NULL = دفعة بالأيام تُستحق بعد أيامها)
    trigger_stage_id INTEGER REFERENCES workflow_stages(id),
    days_offset   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(contract_type, pay_no)
);

-- دفعات تجمع أكثر من مرحلة: المرحلة الواحدة تتبع دفعة واحدة فقط
-- (UNIQUE على المرحلة) — والدفعة الواحدة تجمع عدة مراحل معًا
CREATE TABLE IF NOT EXISTS type_payment_stages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id  INTEGER NOT NULL REFERENCES type_payment_tpl(id),
    stage_id    INTEGER NOT NULL REFERENCES workflow_stages(id),
    UNIQUE(stage_id)
);

CREATE TABLE IF NOT EXISTS visits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date  TEXT NOT NULL,
    hour_slot   TEXT NOT NULL,
    staff_id    INTEGER REFERENCES visit_staff(id),
    customer_id INTEGER REFERENCES customers(id),
    note        TEXT DEFAULT '',
    task_id     INTEGER,
    created_by  TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(visit_date, hour_slot, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_form_docs_tpl   ON form_documents(template_id);


INSERT OR IGNORE INTO settings (id, company_name, currency)
VALUES (1, 'اسم الشركة', 'د.ك');

-- ============================================================
-- مديول «متابعة»: دورة حياة المعاملات + شات + تنبيهات
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_stages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type  TEXT NOT NULL,
    stage_name        TEXT NOT NULL,
    stage_order       INTEGER NOT NULL,
    color             TEXT DEFAULT '#3B82F6',
    -- مراحل التنفيذ الشجرية: رئيسية (NULL) وفرعية تتبعها —
    -- المسار الخطي للتنفيذ = الفرعيات + الرئيسيات بلا أبناء
    parent_id         INTEGER REFERENCES workflow_stages(id),
    expected_days     INTEGER NOT NULL DEFAULT 0,
    -- مرحلة «ما قبل التعاقد» للعملاء المحتملين — لا تُحذف
    is_pre_contract   INTEGER NOT NULL DEFAULT 0,
    -- لمراحل العقود: '' = القالب العام لكل الأنواع · وإلا اسم نوع
    -- العقد (يرث مراحله الخاصة من هنا عند إنشائه)
    contract_type     TEXT DEFAULT '',
    -- نسبة دفعة المرحلة من قيمة العقد (%) — يتولد بها بند في خطة
    -- السداد مربوط بهذه المرحلة عند إنشاء العقد (مرحلة ↔ دفعة واحدة)
    payment_pct       REAL DEFAULT 0,
    -- طريقة الدفعة: '' بلا · achieve عند إنجاز المرحلة · advance
    -- دفعة مقدمة عند التوقيع · final ختامية · days بعد أيام من التوقيع
    pay_kind          TEXT DEFAULT '',
    -- V3.23: الطابع الإشرافي في القالب — تُعلَّم مرحلة الإشراف هنا
    -- مرة واحدة في الإعدادات وترثها العقود الجديدة تلقائيًا
    is_supervision    INTEGER NOT NULL DEFAULT 0,
    sup_monthly       REAL NOT NULL DEFAULT 0,
    UNIQUE(transaction_type, contract_type, stage_name)
);

CREATE TABLE IF NOT EXISTS transaction_stage_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type  TEXT NOT NULL,
    transaction_id    INTEGER NOT NULL,
    stage_id          INTEGER REFERENCES workflow_stages(id),
    moved_by          INTEGER REFERENCES users(id),
    moved_at          TEXT DEFAULT (datetime('now','localtime')),
    note              TEXT DEFAULT '',
    -- عداد الأيام: بدء المرحلة وإنهاؤها (فارغ = ما زالت جارية)
    start_date        TEXT DEFAULT '',
    end_date          TEXT DEFAULT '',
    is_skipped        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stage_log_tx
    ON transaction_stage_log(transaction_type, transaction_id);

-- V5.9: ملاحظات المرحلة (سبب التأخير / واقفة فين) — مستقلة عن سجل
-- الحركة كي لا تؤثر على عدّادات المراحل، وتظهر في السجل والتعليقات.
CREATE TABLE IF NOT EXISTS stage_notes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type  TEXT NOT NULL,
    transaction_id    INTEGER NOT NULL,
    contract_id       INTEGER,
    customer_id       INTEGER,
    stage_name        TEXT DEFAULT '',
    note              TEXT NOT NULL,
    created_by        INTEGER REFERENCES users(id),
    author            TEXT DEFAULT '',
    created_at        TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stage_notes_tx
    ON stage_notes(transaction_type, transaction_id, id);
CREATE INDEX IF NOT EXISTS idx_stage_notes_contract
    ON stage_notes(contract_id, id);

CREATE TABLE IF NOT EXISTS transaction_messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type  TEXT NOT NULL,
    transaction_id    INTEGER NOT NULL,
    user_id           INTEGER REFERENCES users(id),
    message           TEXT NOT NULL,
    attachment_path   TEXT DEFAULT '',
    created_at        TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tx_messages
    ON transaction_messages(transaction_type, transaction_id);

CREATE TABLE IF NOT EXISTS notifications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER REFERENCES users(id),
    transaction_type  TEXT NOT NULL,
    transaction_id    INTEGER NOT NULL,
    type              TEXT NOT NULL,
    text              TEXT NOT NULL,
    is_read           INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user
    ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS transaction_visibility (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type  TEXT NOT NULL,
    transaction_id    INTEGER NOT NULL,
    user_id           INTEGER REFERENCES users(id),
    UNIQUE(transaction_type, transaction_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer  ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contract  ON invoices(contract_id);

/* ============ إدارة دورة حياة العقد ============ */

CREATE TABLE IF NOT EXISTS projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_code TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    customer_id  INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    description  TEXT DEFAULT '',
    status       TEXT DEFAULT 'نشط',
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS quotations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number    TEXT NOT NULL UNIQUE,
    qdate           TEXT NOT NULL,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    project_id      INTEGER REFERENCES projects(id),
    validity_days   INTEGER DEFAULT 30,
    execution_period TEXT DEFAULT '',
    currency        TEXT DEFAULT 'د.ك',
    discount        REAL DEFAULT 0,
    tax             REAL DEFAULT 0,
    payment_terms   TEXT DEFAULT '',
    execution_terms TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'مسودة',
    contract_id     INTEGER REFERENCES contracts(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS quotation_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    qty          REAL DEFAULT 1,
    unit         TEXT DEFAULT '',
    unit_price   REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boq_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    qty         REAL DEFAULT 1,
    unit        TEXT DEFAULT '',
    unit_price  REAL DEFAULT 0,
    stage_id    INTEGER REFERENCES contract_stages(id)
);

CREATE TABLE IF NOT EXISTS subcontractors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_code   TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    phone      TEXT DEFAULT '',
    email      TEXT DEFAULT '',
    activity   TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    show_all_contracts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS sub_contracts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE RESTRICT,
    contract_id      INTEGER NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
    project_id       INTEGER REFERENCES projects(id),
    amount           REAL NOT NULL DEFAULT 0,
    start_date       TEXT DEFAULT '',
    end_date         TEXT DEFAULT '',
    status           TEXT DEFAULT 'نشط',
    description      TEXT DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS sub_contract_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_contract_id INTEGER NOT NULL REFERENCES sub_contracts(id) ON DELETE CASCADE,
    boq_item_id     INTEGER REFERENCES boq_items(id) ON DELETE CASCADE,
    qty             REAL DEFAULT 0,
    unit_price      REAL DEFAULT 0,
    amount          REAL DEFAULT 0,
    source_kind     TEXT DEFAULT '',
    source_id       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expense_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id       INTEGER REFERENCES expense_accounts(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    full_path       TEXT DEFAULT '',
    is_active       INTEGER DEFAULT 1,
    allow_posting   INTEGER DEFAULT 1,
    include_in_profitability INTEGER DEFAULT 1,
    account_kind    TEXT DEFAULT 'expense',
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vouchers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_number  TEXT NOT NULL UNIQUE,
    vtype           TEXT NOT NULL CHECK (vtype IN ('payment','receipt','transfer','custody_return','salary_deduction')),
    vdate           TEXT NOT NULL,
    party           TEXT DEFAULT '',
    party_type      TEXT DEFAULT '',
    party_id        INTEGER,
    method          TEXT DEFAULT '',
    account         TEXT DEFAULT '',
    expense_account_id INTEGER REFERENCES expense_accounts(id),
    expense_account_snapshot TEXT DEFAULT '',
    expense_group_ref TEXT DEFAULT '',
    expense_group_line INTEGER,
    custody_account_id INTEGER REFERENCES expense_accounts(id),
    custody_account_snapshot TEXT DEFAULT '',
    advance_employee_id INTEGER REFERENCES employees(id),
    amount          REAL NOT NULL CHECK (amount > 0),
    advance_amount  REAL NOT NULL DEFAULT 0,
    description     TEXT DEFAULT '',
    project_id      INTEGER REFERENCES projects(id),
    expense_customer_id INTEGER REFERENCES customers(id),
    contract_id     INTEGER REFERENCES contracts(id),
    boq_item_id     INTEGER REFERENCES boq_items(id),
    sub_contract_id INTEGER REFERENCES sub_contracts(id),
    cost_center     TEXT DEFAULT '',
    attachment      TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    receipt_group_ref TEXT DEFAULT '',
    receipt_group_line INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS addendums (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    addendum_number TEXT NOT NULL,
    contract_id     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    addendum_type   TEXT DEFAULT 'أمر تغييري',
    adate           TEXT DEFAULT '',
    reason          TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    amount_add      REAL DEFAULT 0,
    amount_deduct   REAL DEFAULT 0,
    start_date      TEXT DEFAULT '',
    end_date        TEXT DEFAULT '',
    status          TEXT DEFAULT 'مسودة',
    approved_date   TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS contract_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    event_time  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    event_type  TEXT NOT NULL,
    description TEXT DEFAULT '',
    username    TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date      TEXT NOT NULL,
    description     TEXT DEFAULT '',
    debit_account   TEXT DEFAULT '',
    credit_account  TEXT DEFAULT '',
    amount          REAL NOT NULL,
    project_id      INTEGER,
    contract_id     INTEGER,
    boq_item_id     INTEGER,
    sub_contract_id INTEGER,
    cost_center     TEXT DEFAULT '',
    source_type     TEXT DEFAULT '',
    source_id       INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS contract_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS payment_plan (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    due_date    TEXT NOT NULL,
    amount      REAL NOT NULL CHECK (amount > 0),
    sort_order  INTEGER DEFAULT 0,
    -- الدفعة مربوطة بمرحلة **نسخة العقد** (contract_stages) —
    -- إنهاؤها فعليًا يستحق الدفعة (كل مرحلة ↔ دفعة واحدة)
    stage_id    INTEGER REFERENCES contract_stages(id),
    -- سبب الاستحقاق: "مستحقة لانتهاء مرحلة «X» بتاريخ Y..."
    notes       TEXT DEFAULT '',
    -- تاريخ الاستحقاق الفعلي بعد إنهاء المرحلة (فارغ = تقديري)
    triggered_at TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_plan_contract ON payment_plan(contract_id);

-- V4.2 (P1-4): خطة دفعات عقد الباطن — مرآة payment_plan.
-- stage_id يشير لمرحلة من عقد العميل الأب: إنهاؤها يستحق الدفعة.
-- بلا stage_id = دفعة بالأيام تُستحق بتاريخها.
CREATE TABLE IF NOT EXISTS sub_payment_plan (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_contract_id INTEGER NOT NULL REFERENCES sub_contracts(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    due_date        TEXT NOT NULL,
    amount          REAL NOT NULL CHECK (amount > 0),
    sort_order      INTEGER DEFAULT 0,
    stage_id        INTEGER REFERENCES contract_stages(id),
    notes           TEXT DEFAULT '',
    triggered_at    TEXT DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_subplan_sub ON sub_payment_plan(sub_contract_id);

-- V4.6: مصادر دفعة الباطن من دفعات عقد العميل (N:M) — تُستحق الدفعة
-- باكتمال كل مصادرها. إضافي بالكامل؛ حذفه تلقائي مع أي طرف.
CREATE TABLE IF NOT EXISTS sub_payment_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_line_id     INTEGER NOT NULL REFERENCES sub_payment_plan(id) ON DELETE CASCADE,
    cust_line_id    INTEGER NOT NULL REFERENCES payment_plan(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (sub_line_id, cust_line_id)
);
CREATE INDEX IF NOT EXISTS idx_subsrc_sub ON sub_payment_sources(sub_line_id);
CREATE INDEX IF NOT EXISTS idx_subsrc_cust ON sub_payment_sources(cust_line_id);

CREATE INDEX IF NOT EXISTS idx_vouchers_contract ON vouchers(contract_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_project  ON vouchers(project_id);

-- V6.2: ربط السند بخط دفعة بعينه (قبض لخطة العميل · صرف لخطة عقد الباطن)
-- العلاقة بمعرّف (id) لا بنص — ويمكن توزيع الزيادة على أكثر من خط.
CREATE TABLE IF NOT EXISTS voucher_payment_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_id  INTEGER NOT NULL REFERENCES vouchers(id),
    kind        TEXT NOT NULL CHECK (kind IN ('receipt','payment')),
    line_id     INTEGER NOT NULL,
    amount      REAL NOT NULL CHECK (amount > 0),
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE (voucher_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_vpl_voucher ON voucher_payment_links(voucher_id);
CREATE INDEX IF NOT EXISTS idx_vpl_line    ON voucher_payment_links(line_id);
CREATE INDEX IF NOT EXISTS idx_events_contract   ON contract_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_boq_contract      ON boq_items(contract_id);
"""


class DatabaseError(Exception):
    """خطأ عام في قاعدة البيانات برسالة عربية واضحة."""


class _SharedConnection:
    """اتصال SQLite مُعاد الاستخدام لكل خيط."""

    __slots__ = ("_raw", "_depth", "_failed")
    MAX_RETRIES = 3

    def __init__(self, raw: sqlite3.Connection):
        self._raw = raw
        self._depth = 0
        self._failed = False

    def __getattr__(self, name):
        return getattr(self._raw, name)

    def __enter__(self):
        self._depth += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        self._depth = max(0, self._depth - 1)
        if self._depth == 0:
            # V8.7.11: معالجة انقطاع الاتصال عند commit
            try:
                if exc_type is not None:
                    self._raw.rollback()
                else:
                    # فحص سريع قبل الـ commit
                    self._raw.execute("SELECT 1")
                    self._raw.commit()
            except (sqlite3.OperationalError, sqlite3.DatabaseError):
                # الاتصال مكسور — محاولة reconnect + إعادة commit
                try:
                    self._reconnect()
                    if exc_type is None:
                        self._raw.commit()
                except Exception:
                    pass  # فشل reconnect — الخطأ الأصلي سيظهر عند المستخدم
            finally:
                self._failed = False
        elif exc_type is not None:
            self._failed = True
        return False

    def _reconnect(self):
        """إغلاق الاتصال القديم وإنشاء جديد بنفس الإعدادات."""
        try:
            self._raw.close()
        except Exception:
            pass
        self._raw = _create_raw_connection(DB_PATH)

    def close(self):
        """الإغلاق الفعلي يتم عبر close_connections فقط."""
        return None

    def _real_close(self):
        try:
            self._raw.close()
        except Exception:
            pass


_conn_store = threading.local()


def _create_raw_connection(db_path: str) -> sqlite3.Connection:
    """إنشاء اتصال SQLite جديد بنفس الإعدادات المحسّنة."""
    raw = sqlite3.connect(db_path, timeout=30.0)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON;")
    raw.execute("PRAGMA busy_timeout = 30000;")
    raw.execute("PRAGMA cache_size=-64000;")
    raw.execute("PRAGMA temp_store=MEMORY;")
    try:
        # كشف وضع الشبكة: ملف الإعداد **أو** مسار UNC في db_path نفسه
        # (مهم عند اختبار مجلد شبكة قبل إنشاء ملف الإعداد)
        _path_norm = db_path.replace("\\", "/")
        _on_network = (
            os.path.exists(_NET_CONFIG)
            or _path_norm.startswith("//")
        )
        if _on_network:
            # محاولة تبديل وضع السجل إلى DELETE للشبكة
            # أولاً: محاولة checkpoint لملفات WAL القديمة
            try:
                raw.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            except Exception:
                pass
            # حذف ملفات WAL/SHM العالقة إن وجدت
            for suffix in ("-wal", "-shm"):
                wal_path = db_path + suffix
                try:
                    if os.path.exists(wal_path):
                        os.remove(wal_path)
                except OSError:
                    pass
            # تبديل وضع السجل إلى DELETE (الأنسب للشبكة)
            try:
                raw.execute("PRAGMA journal_mode=DELETE;")
            except Exception:
                # fallback: استخدام TRUNCATE إن فشل DELETE
                try:
                    raw.execute("PRAGMA journal_mode=TRUNCATE;")
                except Exception:
                    pass
            raw.execute("PRAGMA synchronous=NORMAL;")
            raw.execute("PRAGMA locking_mode=NORMAL;")
        else:
            raw.execute("PRAGMA journal_mode=WAL;")
            raw.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        raw.execute("PRAGMA synchronous=NORMAL;")
    return raw


def get_connection():
    """الحصول على اتصال SQLite مع إعدادات محسّنة للشبكات."""
    os.makedirs(DATA_DIR, exist_ok=True)

    shared = getattr(_conn_store, "conn", None)
    path = getattr(_conn_store, "path", None)

    if shared is not None and path == DB_PATH:
        if getattr(shared, "_depth", 0) > 0:
            return shared  # داخل معاملة خارجية — متحقق منه ولا حاجة لرحلة شبكة
        # V2.48: التحقق مرة/ثانية فقط بدل كل استدعاء
        now = time.monotonic()
        if now - getattr(_conn_store, "checked_at", 0.0) < 1.0:
            return shared
        try:
            shared._raw.execute("SELECT 1")
            _conn_store.checked_at = time.monotonic()
            return shared
        except Exception:
            shared._real_close()
            shared = None
    elif shared is not None:
        shared._real_close()
        _conn_store.checked_at = 0.0

    raw = _create_raw_connection(DB_PATH)
    shared = _SharedConnection(raw)
    _conn_store.conn = shared
    _conn_store.path = DB_PATH
    _conn_store.checked_at = time.monotonic()
    return shared


def atomic(fn):
    """معاملة واحدة للعملية كاملة: commit واحد بدل عشرة (تسريع الشبكة).

    يعتمد على عدّاد التداخل في _SharedConnection: كل with داخلية
    متداخلة لا تحفظ حتى خروج الخارجية. الفشل غير الممسوك = rollback
    كامل (أصح من الحفظ الجزئي السابق).
    """
    import functools

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with get_connection():
            return fn(*args, **kwargs)

    return wrapper


def close_connections() -> None:
    """إغلاق الاتصال المخزَّن — قبل استبدال ملف القاعدة (استعادة نسخة)."""
    shared = getattr(_conn_store, "conn", None)
    if shared is not None:
        shared._real_close()
    _conn_store.conn = None
    _conn_store.path = None
    _conn_store.checked_at = 0.0


def db_health_check() -> bool:
    """فحص سريع لصحة الاتصال — يعيد True إذا كان الاتصال يعمل."""
    try:
        shared = getattr(_conn_store, "conn", None)
        if shared is None:
            return False
        shared._raw.execute("SELECT 1")
        return True
    except Exception:
        return False


def db_force_reconnect() -> bool:
    """إجبار إعادة الاتصال — يُستخدم من UI عند اكتشاف انقطاع."""
    try:
        close_connections()
        with get_connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False



def _ensure_vouchers_transfer_check(conn) -> None:
    """ترقية قيد نوع السند ليقبل التحويل الداخلي دون فقد بيانات."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='vouchers'"
    ).fetchone()
    sql = (row[0] if row else "") or ""
    if "transfer" in sql or "vtype IN ('payment','receipt')" not in sql:
        return
    desired = [
        ("id", "INTEGER PRIMARY KEY AUTOINCREMENT", "id"),
        ("voucher_number", "TEXT NOT NULL UNIQUE", "voucher_number"),
        ("vtype", "TEXT NOT NULL CHECK (vtype IN ('payment','receipt','transfer'))", "vtype"),
        ("vdate", "TEXT NOT NULL", "vdate"),
        ("party", "TEXT DEFAULT ''", "COALESCE(party, '')"),
        ("party_type", "TEXT DEFAULT ''", "COALESCE(party_type, '')"),
        ("party_id", "INTEGER", "party_id"),
        ("method", "TEXT DEFAULT ''", "COALESCE(method, '')"),
        ("account", "TEXT DEFAULT ''", "COALESCE(account, '')"),
        ("amount", "REAL NOT NULL CHECK (amount > 0)", "amount"),
        ("description", "TEXT DEFAULT ''", "COALESCE(description, '')"),
        ("project_id", "INTEGER REFERENCES projects(id)", "project_id"),
        ("expense_customer_id", "INTEGER REFERENCES customers(id)", "expense_customer_id"),
        ("contract_id", "INTEGER REFERENCES contracts(id)", "contract_id"),
        ("boq_item_id", "INTEGER REFERENCES boq_items(id)", "boq_item_id"),
        ("sub_contract_id", "INTEGER REFERENCES sub_contracts(id)", "sub_contract_id"),
        ("cost_center", "TEXT DEFAULT ''", "COALESCE(cost_center, '')"),
        ("attachment", "TEXT DEFAULT ''", "COALESCE(attachment, '')"),
        ("notes", "TEXT DEFAULT ''", "COALESCE(notes, '')"),
        ("created_at", "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))", "COALESCE(created_at, datetime('now', 'localtime'))"),
        ("parent_voucher_id", "INTEGER", "parent_voucher_id"),
        ("cheque_due_date", "TEXT DEFAULT ''", "COALESCE(cheque_due_date, '')"),
        ("cancelled", "INTEGER DEFAULT 0", "COALESCE(cancelled, 0)"),
        ("cancel_reason", "TEXT DEFAULT ''", "COALESCE(cancel_reason, '')"),
        ("cancelled_at", "TEXT DEFAULT ''", "COALESCE(cancelled_at, '')"),
        ("allocation", "TEXT DEFAULT ''", "COALESCE(allocation, '')"),
    ]
    existing = {r[1] for r in conn.execute("PRAGMA table_info(vouchers);")}
    cols_sql = ",\n        ".join(f"{name} {decl}" for name, decl, _ in desired)
    conn.execute("ALTER TABLE vouchers RENAME TO vouchers_old_transfer_migration")
    conn.execute(f"CREATE TABLE vouchers (\n        {cols_sql}\n    )")
    names = [name for name, _, _ in desired]
    exprs = [expr if name in existing else ("0" if name == "cancelled" else "NULL") for name, _, expr in desired]
    conn.execute(
        f"INSERT INTO vouchers ({', '.join(names)}) "
        f"SELECT {', '.join(exprs)} FROM vouchers_old_transfer_migration"
    )
    conn.execute("DROP TABLE vouchers_old_transfer_migration")


def _ensure_vouchers_custody_return_check(conn) -> None:
    """V4.52: توسيع CHECK النوع ليشمل custody_return — بلا فقدان بيانات.

    جراحة نصية على CREATE TABLE الأصلي (تحفظ كل الأعمدة والقيود كما هي)
    ثم نسخ الصفوف وإعادة الفهارس الخارجية. الصيغ غير المتوقعة تُترك
    بلا مساس.
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' "
        "AND name='vouchers'").fetchone()
    sql = (row[0] if row else "") or ""
    if "custody_return" in sql:
        return
    if "vtype IN ('payment','receipt','transfer')" in sql:
        new_sql = sql.replace(
            "vtype IN ('payment','receipt','transfer')",
            "vtype IN ('payment','receipt','transfer','custody_return')", 1)
    elif "vtype IN ('payment','receipt')" in sql:
        _ensure_vouchers_transfer_check(conn)
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' "
            "AND name='vouchers'").fetchone()
        sql = (row[0] if row else "") or ""
        if ("custody_return" in sql
                or "vtype IN ('payment','receipt','transfer')" not in sql):
            return
        new_sql = sql.replace(
            "vtype IN ('payment','receipt','transfer')",
            "vtype IN ('payment','receipt','transfer','custody_return')", 1)
    else:
        return
    cols = [r[1] for r in conn.execute(
        "PRAGMA table_info(vouchers)").fetchall()]
    names = ", ".join(f'"{c}"' for c in cols)
    conn.execute("ALTER TABLE vouchers RENAME TO vouchers_old_cr_migration")
    conn.execute(new_sql)
    conn.execute(
        f"INSERT INTO vouchers ({names}) "
        f"SELECT {names} FROM vouchers_old_cr_migration")
    conn.execute("DROP TABLE vouchers_old_cr_migration")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_vouchers_contract "
                 "ON vouchers(contract_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_vouchers_project "
                 "ON vouchers(project_id)")


def _ensure_vouchers_salary_deduction_check(conn) -> None:
    """V4.53: توسيع CHECK ليشمل salary_deduction — نفس جراحة V4.52."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' "
        "AND name='vouchers'").fetchone()
    sql = (row[0] if row else "") or ""
    if "salary_deduction" in sql:
        return
    _OLD4 = "vtype IN ('payment','receipt','transfer','custody_return')"
    _NEW5 = ("vtype IN ('payment','receipt','transfer','custody_return',"
             "'salary_deduction')")
    if _OLD4 not in sql:
        _ensure_vouchers_custody_return_check(conn)
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' "
            "AND name='vouchers'").fetchone()
        sql = (row[0] if row else "") or ""
        if "salary_deduction" in sql or _OLD4 not in sql:
            return
    new_sql = sql.replace(_OLD4, _NEW5, 1)
    cols = [r[1] for r in conn.execute(
        "PRAGMA table_info(vouchers)").fetchall()]
    names = ", ".join(f'"{c}"' for c in cols)
    conn.execute("ALTER TABLE vouchers RENAME TO vouchers_old_sd_migration")
    conn.execute(new_sql)
    conn.execute(
        f"INSERT INTO vouchers ({names}) "
        f"SELECT {names} FROM vouchers_old_sd_migration")
    conn.execute("DROP TABLE vouchers_old_sd_migration")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_vouchers_contract "
                 "ON vouchers(contract_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_vouchers_project "
                 "ON vouchers(project_id)")


def _repair_missing_employees(conn) -> None:
    """V9.15.3: إعادة إنشاء الموظفين الذين تشير إليهم السلف ولا يوجد لهم سجل.

    الاسم يُؤخذ من طرف السند (الأقدم أولًا، وسند الصرف يُفضَّل). لا يعدّل
    أي موظف موجود، ويعمل عند كل تشغيل بلا أثر إن لم يكن هناك ما يُصلح.
    """
    try:
        rows = conn.execute(
            "SELECT advance_employee_id AS eid, COALESCE(party,'') AS party "
            "FROM vouchers WHERE COALESCE(advance_employee_id,0) <> 0 "
            "AND advance_employee_id NOT IN (SELECT id FROM employees) "
            "ORDER BY (vtype <> 'payment'), vdate, id").fetchall()
    except Exception:
        return
    names: dict = {}
    for r in rows:
        eid = int(r[0])
        name = (r[1] or "").strip()
        if eid not in names or (not names[eid] and name):
            names[eid] = name
    for eid, name in names.items():
        if not name:
            name = f"موظف رقم {eid}"
        if conn.execute("SELECT 1 FROM employees WHERE name=?", (name,)).fetchone():
            name = f"{name} ({eid})"
        conn.execute(
            "INSERT OR IGNORE INTO employees (id, name, phone, notes, active) "
            "VALUES (?, ?, '', '', 1)", (eid, name))


def _apply_schema(conn) -> None:
    """إنشاء الجداول وتطبيق كل الترقيات — تُستدعى فقط عند تغيّر البصمة."""

    conn.executescript(_SCHEMA)
    _ensure_vouchers_transfer_check(conn)
    _ensure_vouchers_custody_return_check(conn)
    _ensure_vouchers_salary_deduction_check(conn)
    # ترقية قواعد البيانات القديمة: إضافة الأعمدة الجديدة إن لم توجد
    # مركز النماذج: عمود هوية الطباعة (none/logo/full) للقوالب القديمة
    _tcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(form_templates);")}
    if "print_identity" not in _tcols:
        conn.execute("ALTER TABLE form_templates ADD COLUMN "
                     "print_identity TEXT NOT NULL DEFAULT 'none'")
    _fcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(form_fields);")}
    if "continues_field_id" not in _fcols:
        conn.execute("ALTER TABLE form_fields ADD COLUMN "
                     "continues_field_id INTEGER")
    # قوالب Word القابلة للتعديل: مصدر القالب + ملف الوورد الأصلي +
    # حقول {{...}} النصية + مسار ملف Word المولَّد لكل مستند
    if "source_type" not in _tcols:
        conn.execute("ALTER TABLE form_templates ADD COLUMN "
                     "source_type TEXT NOT NULL DEFAULT 'pdf'")
    if "word_path" not in _tcols:
        conn.execute("ALTER TABLE form_templates ADD COLUMN "
                     "word_path TEXT DEFAULT ''")
    if "placeholder" not in _fcols:
        conn.execute("ALTER TABLE form_fields ADD COLUMN "
                     "placeholder TEXT DEFAULT ''")
    _dcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(form_documents);")}
    if "word_path" not in _dcols:
        conn.execute("ALTER TABLE form_documents ADD COLUMN "
                     "word_path TEXT DEFAULT ''")
    # مديول المتابعة الجديد: مراحل شجرية (رئيسية/فرعية) + عداد أيام
    _wcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(workflow_stages);")}
    if "parent_id" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "parent_id INTEGER REFERENCES workflow_stages(id)")
    if "expected_days" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "expected_days INTEGER NOT NULL DEFAULT 0")
    if "is_pre_contract" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "is_pre_contract INTEGER NOT NULL DEFAULT 0")
    # V3.20: استثناء مقاول الباطن — إظهار كل العقود في السندات
    _scols = {r[1] for r in conn.execute(
        "PRAGMA table_info(subcontractors);")}
    if "show_all_contracts" not in _scols:
        conn.execute("ALTER TABLE subcontractors ADD COLUMN "
                     "show_all_contracts INTEGER NOT NULL DEFAULT 0")
    # V3.21: الطابع الإشرافي للمراحل — بداية/نهاية/قيمة شهر/تنازل
    _cscols = {r[1] for r in conn.execute(
        "PRAGMA table_info(contract_stages);")}
    for _ccol, _cdef in (
            ("is_supervision", "INTEGER NOT NULL DEFAULT 0"),
            ("sup_start", "TEXT DEFAULT ''"),
            ("sup_end", "TEXT DEFAULT ''"),
            ("sup_actual_end", "TEXT DEFAULT ''"),
            ("sup_monthly", "REAL NOT NULL DEFAULT 0"),
            ("sup_waived_months", "REAL NOT NULL DEFAULT 0"),
            ("sup_waive_reason", "TEXT DEFAULT ''")):
        if _ccol not in _cscols:
            conn.execute(f"ALTER TABLE contract_stages ADD COLUMN "
                         f"{_ccol} {_cdef}")
    _lcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(transaction_stage_log);")}
    if "start_date" not in _lcols:
        conn.execute("ALTER TABLE transaction_stage_log ADD COLUMN "
                     "start_date TEXT DEFAULT ''")
    if "end_date" not in _lcols:
        conn.execute("ALTER TABLE transaction_stage_log ADD COLUMN "
                     "end_date TEXT DEFAULT ''")
    if "is_skipped" not in _lcols:
        conn.execute("ALTER TABLE transaction_stage_log ADD COLUMN "
                     "is_skipped INTEGER NOT NULL DEFAULT 0")
    # مراحل لكل نوع عقد + ربط الدفعات بالمراحل
    if "contract_type" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "contract_type TEXT DEFAULT ''")
    if "payment_pct" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "payment_pct REAL DEFAULT 0")
    if "pay_kind" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "pay_kind TEXT DEFAULT ''")
    _pcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(payment_plan);")}
    if "stage_id" not in _pcols:
        conn.execute("ALTER TABLE payment_plan ADD COLUMN "
                     "stage_id INTEGER")
    if "notes" not in _pcols:
        conn.execute("ALTER TABLE payment_plan ADD COLUMN "
                     "notes TEXT DEFAULT ''")
    if "triggered_at" not in _pcols:
        conn.execute("ALTER TABLE payment_plan ADD COLUMN "
                     "triggered_at TEXT DEFAULT ''")
    if "manual_amount" not in _pcols:
        conn.execute("ALTER TABLE payment_plan ADD COLUMN "
                     "manual_amount INTEGER DEFAULT 0")
    _tcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(type_payment_tpl);")}
    if "trigger_stage_id" not in _tcols:
        conn.execute("ALTER TABLE type_payment_tpl ADD COLUMN "
                     "trigger_stage_id INTEGER")
    if "amount_fixed" not in _tcols:
        conn.execute("ALTER TABLE type_payment_tpl ADD COLUMN "
                     "amount_fixed REAL NOT NULL DEFAULT 0")
    # إعادة بناء workflow_stages بقيد فريد يشمل قالب النوع — الاسم
    # الواحد يجوز للقالب العام ولنوع خاص (مرة واحدة للقواعد القديمة)
    _wsql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND "
        "name='workflow_stages'").fetchone()
    if _wsql and "UNIQUE(transaction_type, contract_type, stage_name)" \
            not in (_wsql[0] or ""):
        conn.executescript(
            "CREATE TABLE workflow_stages_mig ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "transaction_type TEXT NOT NULL, "
            "stage_name TEXT NOT NULL, "
            "stage_order INTEGER NOT NULL, "
            "color TEXT DEFAULT '#3B82F6', "
            "parent_id INTEGER REFERENCES workflow_stages(id), "
            "expected_days INTEGER NOT NULL DEFAULT 0, "
            "is_pre_contract INTEGER NOT NULL DEFAULT 0, "
            "contract_type TEXT DEFAULT '', "
            "payment_pct REAL DEFAULT 0, "
            "UNIQUE(transaction_type, contract_type, stage_name)); "
            "INSERT INTO workflow_stages_mig "
            "(id, transaction_type, stage_name, stage_order, color, "
            " parent_id, expected_days, is_pre_contract, "
            " contract_type, payment_pct) "
            "SELECT id, transaction_type, stage_name, stage_order, color, "
            " parent_id, COALESCE(expected_days, 0), "
            " COALESCE(is_pre_contract, 0), "
            " COALESCE(contract_type, ''), COALESCE(payment_pct, 0) "
            "FROM workflow_stages; "
            "DROP TABLE workflow_stages; "
            "ALTER TABLE workflow_stages_mig RENAME TO workflow_stages;")
    # بعد إعادة بناء workflow_stages للقواعد القديمة قد تختفي أعمدة أضيفت قبلها.
    # نعيد فحصها هنا لضمان فتح شجرة المراحل وعدم ظهور no such column: pay_kind.
    _wcols_after = {r[1] for r in conn.execute("PRAGMA table_info(workflow_stages);")}
    if "pay_kind" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN pay_kind TEXT DEFAULT ''")
    if "payment_pct" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN payment_pct REAL DEFAULT 0")
    if "contract_type" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN contract_type TEXT DEFAULT ''")
    if "parent_id" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN parent_id INTEGER REFERENCES workflow_stages(id)")
    if "expected_days" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN expected_days INTEGER NOT NULL DEFAULT 0")
    if "is_pre_contract" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN is_pre_contract INTEGER NOT NULL DEFAULT 0")
    if "is_supervision" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN is_supervision INTEGER NOT NULL DEFAULT 0")
    if "sup_monthly" not in _wcols_after:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN sup_monthly REAL NOT NULL DEFAULT 0")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(settings);")}
    upgrades = {
        "invoice_primary": "TEXT DEFAULT '#1e3a5f'",
        "invoice_accent": "TEXT DEFAULT '#2e86ab'",
        "auto_backup_enabled": "INTEGER DEFAULT 1",
        "auto_backup_interval": "INTEGER DEFAULT 24",
        "auto_backup_folder": "TEXT DEFAULT ''",
        "last_backup_at": "TEXT DEFAULT ''",
        "ui_theme": "TEXT DEFAULT 'light'",
        "header_title": "TEXT DEFAULT 'نظام إدارة العقود والمحاسبة'",
        "task_wa_customer": "TEXT DEFAULT ''",
        "task_wa_manager": "TEXT DEFAULT ''",
        "wa_appt": "TEXT DEFAULT ''",
        "wa_reminder": "TEXT DEFAULT ''",
        "wa_payment": "TEXT DEFAULT ''",
        "collection_alert_days": "INTEGER DEFAULT 30",
        "ui_prefs": "TEXT DEFAULT '{}'",
        "manager_phone": "TEXT DEFAULT ''",
        "app_name": "TEXT DEFAULT 'ConTrack'",
        "max_users": "INTEGER DEFAULT 0",
        "full_backup_enabled": "INTEGER DEFAULT 1",
        "full_backup_interval_days": "INTEGER DEFAULT 7",
        "full_backup_weekday": "INTEGER DEFAULT 3",
        "visits_start_hour": "INTEGER DEFAULT 8",
        "stages_seeded": "INTEGER DEFAULT 0",
        "visits_end_hour": "INTEGER DEFAULT 17",
        "visits_slot_minutes": "INTEGER DEFAULT 60",
        "full_backup_keep_weekly": "INTEGER DEFAULT 4",
        "full_backup_keep_monthly": "INTEGER DEFAULT 3",
        "full_backup_folder": "TEXT DEFAULT ''",
        "last_full_backup_at": "TEXT DEFAULT ''",
        "desc_prefix_receipt": "TEXT DEFAULT ''",
        "desc_prefix_supervision": "TEXT DEFAULT ''",
        "desc_prefix_transfer": "TEXT DEFAULT ''",
        "desc_prefix_custody": "TEXT DEFAULT ''",
        "desc_prefix_stage_note": "TEXT DEFAULT ''",
        # V5.9: بداية الاحتساب النقدي — الحركات الأقدم تُستبعد من تقارير
        # وأرصدة البنك/الصندوق (زر مؤقت في الإعدادات) بلا حذف أي بيانات.
        "cash_start_date": "TEXT DEFAULT ''",
    }
    for col, decl in upgrades.items():
        if col not in cols:
            conn.execute(f"ALTER TABLE settings ADD COLUMN {col} {decl}")
    # ترقية جدول العقود: أعمدة دورة حياة العقد
    ccols = {r[1] for r in conn.execute("PRAGMA table_info(contracts);")}
    contract_upgrades = {
        "contract_name": "TEXT DEFAULT ''",
        "project_id": "INTEGER REFERENCES projects(id)",
        "contract_type": "TEXT DEFAULT ''",
        "manual_path": "INTEGER DEFAULT 0",  # V4.45: المسار اليدوي
        "sign_date": "TEXT DEFAULT ''",
        "start_date": "TEXT DEFAULT ''",
        "end_date": "TEXT DEFAULT ''",
        "status": "TEXT DEFAULT 'نشط'",
        "currency": "TEXT DEFAULT 'د.ك'",
        "sup_start_date": "TEXT DEFAULT ''",
        "sup_months": "INTEGER DEFAULT 0",
        "sup_monthly": "REAL DEFAULT 0",
        "sup_discount": "REAL DEFAULT 0",
        "sup_waived_months": "REAL DEFAULT 0",
        "sup_waive_reason": "TEXT DEFAULT ''",
        "status_reason": "TEXT DEFAULT ''",
        "cancelled_at": "TEXT DEFAULT ''",
        "cancel_close_amount": "REAL DEFAULT 0",
        "qty": "REAL DEFAULT 1",
        "unit_price": "REAL DEFAULT 0",
    }
    for col, decl in contract_upgrades.items():
        if col not in ccols:
            conn.execute(f"ALTER TABLE contracts ADD COLUMN {col} {decl}")
    # أسباب إلغاء عقود الباطن تحفظ للتدقيق مثل باقي الإلغاءات
    try:
        scols2 = {r[1] for r in conn.execute("PRAGMA table_info(sub_contracts);")}
        if "cancel_reason" not in scols2:
            conn.execute("ALTER TABLE sub_contracts ADD COLUMN cancel_reason TEXT DEFAULT ''")
        if "cancelled_at" not in scols2:
            conn.execute("ALTER TABLE sub_contracts ADD COLUMN cancelled_at TEXT DEFAULT ''")
        if "cancel_close_amount" not in scols2:
            conn.execute("ALTER TABLE sub_contracts ADD COLUMN cancel_close_amount REAL DEFAULT 0")
    except Exception:
        pass
    # اسم العقد المعروض موحّد مع نوع العقد ولا يُحرر يدويًا
    conn.execute(
        "UPDATE contracts SET contract_name = "
        "COALESCE(NULLIF(TRIM(contract_type), ''), 'غير محدد')")
    conn.executescript("""

    CREATE TRIGGER IF NOT EXISTS trg_contract_name_type_insert
    AFTER INSERT ON contracts
    BEGIN
        UPDATE contracts
           SET contract_name = COALESCE(NULLIF(TRIM(NEW.contract_type), ''), 'غير محدد')
         WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_contract_name_type_update
    AFTER UPDATE OF contract_type, contract_name ON contracts
    BEGIN
        UPDATE contracts
           SET contract_name = COALESCE(NULLIF(TRIM(NEW.contract_type), ''), 'غير محدد')
         WHERE id = NEW.id
           AND COALESCE(TRIM(contract_name), '') <> COALESCE(NULLIF(TRIM(NEW.contract_type), ''), 'غير محدد');
    END;
    """)
    # إعدادات تنبيهات انتهاء العقد
    scols = {r[1] for r in conn.execute("PRAGMA table_info(settings);")}
    # التقرير المالي: رسوم التحويل البنكي والرصيد الافتتاحي
    if "bank_fee_amount" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "bank_fee_amount REAL DEFAULT 0.150")
    if "bank_fee_method" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "bank_fee_method TEXT DEFAULT 'تحويل بنكي'")
    if "opening_balance" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "opening_balance REAL DEFAULT 0")
    if "opening_balance_date" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "opening_balance_date TEXT DEFAULT ''")
    if "opening_balance_bank" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "opening_balance_bank REAL DEFAULT 0")
    if "opening_balance_cash" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "opening_balance_cash REAL DEFAULT 0")
        # توافق مع الإعداد القديم: كان الرصيد الافتتاحي كله يُعامل كصندوق.
        conn.execute("UPDATE settings SET opening_balance_cash=COALESCE(opening_balance,0) "
                     "WHERE COALESCE(opening_balance_cash,0)=0 AND COALESCE(opening_balance_bank,0)=0")
    # مفاتيح المديولات الاختيارية (يضبطها المطور لكل عميل)
    if "cashflow_enabled" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "cashflow_enabled INTEGER DEFAULT 1")
    if "bank_fee_enabled" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "bank_fee_enabled INTEGER DEFAULT 1")
    # ربط سند الرسوم بسند القبض الأصلي (إلغاء الأب يلغي الابن)
    vcols2 = {r[1] for r in conn.execute("PRAGMA table_info(vouchers);")}
    if "parent_voucher_id" not in vcols2:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "parent_voucher_id INTEGER")
    if "expiry_alerts" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "expiry_alerts TEXT DEFAULT '90,60,30,7'")
    # صور الهيدر والفوتر للمطبوعات
    if "header_image" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN header_image TEXT DEFAULT ''")
    if "footer_image" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN footer_image TEXT DEFAULT ''")
    if "print_economy" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "print_economy INTEGER DEFAULT 0")
    if "stamp_image" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "stamp_image TEXT DEFAULT ''")
    if "stamp_x_mm" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "stamp_x_mm REAL DEFAULT 0")
    if "stamp_y_mm" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "stamp_y_mm REAL DEFAULT 0")
    if "stamp_size_mm" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "stamp_size_mm REAL DEFAULT 0")
    if "signature_image" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "signature_image TEXT DEFAULT ''")
    # إضافة عمود رمز التفعيل (الترخيص)
    if "license_key" not in scols:
        conn.execute("ALTER TABLE settings ADD COLUMN "
                     "license_key TEXT DEFAULT ''")
    # ===== طرق الدفع المخصصة ورسومها =====
    conn.execute("""
        CREATE TABLE IF NOT EXISTS payment_methods (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL UNIQUE,
            fee_type  TEXT DEFAULT 'amount',
            fee_value REAL DEFAULT 0,
            is_active INTEGER DEFAULT 1
        )""")

    
    # زرع الطرق الافتراضية مرة واحدة
    conn.execute(
        "INSERT OR IGNORE INTO payment_methods (name, fee_type, fee_value) "
        "VALUES ('نقدًا', 'amount', 0)")
    conn.execute(
        "INSERT OR IGNORE INTO payment_methods (name, fee_type, fee_value) "
        "VALUES ('تحويل بنكي', 'amount', 0.150)")
    conn.execute(
        "INSERT OR IGNORE INTO payment_methods (name, fee_type, fee_value) "
        "VALUES ('KNET', 'percent', 1.5)")
    conn.execute(
        "INSERT OR IGNORE INTO payment_methods (name, fee_type, fee_value) "
        "VALUES ('شيك', 'amount', 0)")
    conn.execute(
        "INSERT OR IGNORE INTO payment_methods (name, fee_type, fee_value) "
        "VALUES ('أخرى', 'amount', 0)")
    # تنظيف: إزالة جداول ميزة المواعيد الملغاة إن وُجدت
    conn.execute("DROP TABLE IF EXISTS appointments")
    # V4.53: اسم employees أُعيد إحياؤه لسلف الموظفين — إسقاط نسخة
    # المواعيد القديمة (كانت تُسقط هنا دائمًا) ثم إنشاء الجديدة.
    # V9.15.3: لا يُسقط جدول الموظفين أبدًا — كان الإسقاط هنا يفرغ قائمة
    # الموظفين عند كل ترقية للمخطط، فتختفي أسماء أصحاب السلف.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            phone       TEXT DEFAULT '',
            notes       TEXT DEFAULT '',
            active      INTEGER NOT NULL DEFAULT 1
        )""")
    _emp_cols = {r[1] for r in conn.execute("PRAGMA table_info(employees)")}
    if "phone" not in _emp_cols:
        conn.execute("ALTER TABLE employees ADD COLUMN phone TEXT DEFAULT ''")
    if "notes" not in _emp_cols:
        conn.execute("ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT ''")
    if "active" not in _emp_cols:
        conn.execute("ALTER TABLE employees ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    # ترقية جدول السندات: ربط الطرف بعميل أو مقاول
    vcols = {r[1] for r in conn.execute("PRAGMA table_info(vouchers);")}
    if "party_type" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN party_type TEXT DEFAULT ''")
    if "party_id" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN party_id INTEGER")
    # ترقية جدول الملحقات: نوع الملحق (عقد إضافي / أمر تغييري)
    acols = {r[1] for r in conn.execute("PRAGMA table_info(addendums);")}
    if "addendum_type" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "addendum_type TEXT DEFAULT 'أمر تغييري'")
    if "cancel_reason" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "cancel_reason TEXT DEFAULT ''")
    if "cancelled_at" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "cancelled_at TEXT DEFAULT ''")
    # V5.4 ④: الأمر التغييري بجهتين (عميل/مقاول) وببنود
    if "side" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "side TEXT DEFAULT 'client'")
    if "sub_contract_id" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "sub_contract_id INTEGER REFERENCES sub_contracts(id)")
    if "items_count" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "items_count INTEGER DEFAULT 0")
    if "applied_at" not in acols:
        conn.execute("ALTER TABLE addendums ADD COLUMN "
                     "applied_at TEXT DEFAULT ''")
    # V5.4 ④: وسم البند المحذوف بأمر تغييري (لا يُمحى — يُستثنى من المجاميع)
    bcols = {r[1] for r in conn.execute("PRAGMA table_info(boq_items);")}
    if "deleted_addendum_id" not in bcols:
        conn.execute("ALTER TABLE boq_items ADD COLUMN "
                     "deleted_addendum_id INTEGER")
    if "deleted_at" not in bcols:
        conn.execute("ALTER TABLE boq_items ADD COLUMN "
                     "deleted_at TEXT DEFAULT ''")
    # V6.6: ربط كل بند بالمرحلة التي يقع فيها (لتوزيع دفعات المقاول حسب البنود)
    if "stage_id" not in bcols:
        conn.execute("ALTER TABLE boq_items ADD COLUMN "
                     "stage_id INTEGER REFERENCES contract_stages(id)")
    # V5.4 ④: بنود الأمر التغييري (إضافة يدوية / من المتاح / حذف)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS addendum_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            addendum_id     INTEGER NOT NULL
                            REFERENCES addendums(id) ON DELETE CASCADE,
            side            TEXT NOT NULL DEFAULT 'client',
            action          TEXT NOT NULL DEFAULT 'add',
            parent_part_id  INTEGER DEFAULT 0,
            created_item    INTEGER DEFAULT 0,
            restore_deleted_by INTEGER DEFAULT 0,
            applied         INTEGER DEFAULT 0,
            boq_item_id     INTEGER,
            sub_contract_id INTEGER,
            subcontractor_id INTEGER,
            description     TEXT DEFAULT '',
            qty             REAL DEFAULT 0,
            unit            TEXT DEFAULT '',
            unit_price      REAL DEFAULT 0,
            amount          REAL DEFAULT 0,
            created_at      TEXT NOT NULL
                            DEFAULT (datetime('now','localtime'))
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_addendum_items_addendum "
                 "ON addendum_items(addendum_id)")
    # V6.2: جهة المقاول على سطر الأمر (تتيح ربط نفس البند بأكثر من مقاول)
    _acls = {r[1] for r in conn.execute(
        "PRAGMA table_info(addendum_items);")}
    if "subcontractor_id" not in _acls:
        conn.execute("ALTER TABLE addendum_items ADD COLUMN "
                     "subcontractor_id INTEGER REFERENCES subcontractors(id)")
    # V8.9: أعمدة موحّدة للبنود والدفعات والمراحل
    if "ref_kind" not in _acls:
        conn.execute("ALTER TABLE addendum_items ADD COLUMN "
                     "ref_kind TEXT DEFAULT ''")
    if "ref_id" not in _acls:
        conn.execute("ALTER TABLE addendum_items ADD COLUMN "
                     "ref_id INTEGER DEFAULT 0")
    # V8.9: حذف ناعم للدفعات والمراحل (مثل boq_items.deleted_addendum_id)
    _ppcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(payment_plan);")}
    if "deleted_addendum_id" not in _ppcols:
        conn.execute("ALTER TABLE payment_plan ADD COLUMN "
                     "deleted_addendum_id INTEGER DEFAULT NULL")
    _stgcols = {r[1] for r in conn.execute(
        "PRAGMA table_info(contract_stages);")}
    if "deleted_addendum_id" not in _stgcols:
        conn.execute("ALTER TABLE contract_stages ADD COLUMN "
                     "deleted_addendum_id INTEGER DEFAULT NULL")
    # تاريخ استحقاق الشيك (لسندات طريقة دفعها شيك)
    if "cheque_due_date" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "cheque_due_date TEXT DEFAULT ''")
    # إلغاء السند (بدل الحذف — الرقم محفوظ للتسلسل)
    if "cancelled" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "cancelled INTEGER DEFAULT 0")
    if "cancel_reason" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "cancel_reason TEXT DEFAULT ''")
    if "cancelled_at" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "cancelled_at TEXT DEFAULT ''")
    # تخصيص السند: سداد مقابل بند محدد (أمر تغييري/عقد إضافي)
    if "allocation" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "allocation TEXT DEFAULT ''")
    if "receipt_group_ref" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "receipt_group_ref TEXT DEFAULT ''")
    if "receipt_group_line" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "receipt_group_line INTEGER")
    if "expense_customer_id" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "expense_customer_id INTEGER REFERENCES customers(id)")
    if "expense_account_id" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "expense_account_id INTEGER REFERENCES expense_accounts(id)")
    if "expense_account_snapshot" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "expense_account_snapshot TEXT DEFAULT ''")
    if "expense_group_ref" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "expense_group_ref TEXT DEFAULT ''")
    if "expense_group_line" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "expense_group_line INTEGER")
    if "custody_account_id" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "custody_account_id INTEGER REFERENCES expense_accounts(id)")
    if "custody_account_snapshot" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "custody_account_snapshot TEXT DEFAULT ''")
    if "advance_employee_id" not in vcols:
        conn.execute("ALTER TABLE vouchers ADD COLUMN "
                     "advance_employee_id INTEGER REFERENCES employees(id)")
    # مرفقات العقد (صورة العقد الموقع وغيرها)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_attachments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_id INTEGER NOT NULL,
            file_name   TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            added_at    TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (contract_id) REFERENCES contracts(id)
        )""")
    # مجلد العميل على الشبكة المحلية + آخر اطلاع
    cucols = {r[1] for r in conn.execute("PRAGMA table_info(customers);")}
    if "folder_path" not in cucols:
        conn.execute("ALTER TABLE customers ADD COLUMN "
                     "folder_path TEXT DEFAULT ''")
    if "folder_seen" not in cucols:
        conn.execute("ALTER TABLE customers ADD COLUMN "
                     "folder_seen REAL DEFAULT 0")
    for col in ("address_governorate", "address_area", "address_block", "address_plot"):
        if col not in cucols:
            conn.execute(f"ALTER TABLE customers ADD COLUMN {col} TEXT DEFAULT ''")
    # أنواع العقود المعتمدة + المبلغ الافتراضي لكل نوع
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_types (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            default_amount  REAL DEFAULT 0,
            notes           TEXT DEFAULT '',
            active          INTEGER DEFAULT 1,
            manual_track    INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now','localtime'))
        )""")
    # وحدة القياس وسعر الوحدة لكل نوع (واجهة/شهر/دور/متر…)
    tycols = {r[1] for r in
              conn.execute("PRAGMA table_info(contract_types);")}
    if "unit_label" not in tycols:
        conn.execute("ALTER TABLE contract_types ADD COLUMN "
                     "unit_label TEXT DEFAULT ''")
    if "unit_price" not in tycols:
        conn.execute("ALTER TABLE contract_types ADD COLUMN "
                     "unit_price REAL DEFAULT 0")
    # نمط التسعير: lump مقطوع · unit وحدة × سعر · items بنود
    if "pricing_mode" not in tycols:
        conn.execute("ALTER TABLE contract_types ADD COLUMN "
                     "pricing_mode TEXT DEFAULT ''")
    # نوع إشرافي: تظهر له خانة تاريخ تعهد الإشراف ويُفعَّل التمديد
    if "is_supervision" not in tycols:
        conn.execute("ALTER TABLE contract_types ADD COLUMN "
                     "is_supervision INTEGER DEFAULT 0")
    # V4.56: مسار النوع الافتراضي (يدوي/تلقائي) — ترثه العقود الجديدة.
    if "manual_track" not in tycols:
        conn.execute("ALTER TABLE contract_types ADD COLUMN "
                     "manual_track INTEGER DEFAULT 0")
    # اشتقاق نمط الأنواع القائمة مرة واحدة (سعر وحدة ⟵ unit)
    conn.execute(
        "UPDATE contract_types SET pricing_mode = "
        "CASE WHEN COALESCE(unit_price,0) > 0 THEN 'unit' "
        "ELSE 'lump' END WHERE COALESCE(pricing_mode,'') = ''")
    # V3.30: مكوّنات العقد الشامل (تعريف النوع + لقطة العقد)
    # kind: qty عدد×سعر مرجعي · supervision أشهر×شهري · items بنود
    conn.execute("""
        CREATE TABLE IF NOT EXISTS type_bundle_components (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            type_name       TEXT NOT NULL,
            comp_key        TEXT NOT NULL,
            label           TEXT NOT NULL DEFAULT '',
            kind            TEXT NOT NULL DEFAULT 'qty',
            required        INTEGER NOT NULL DEFAULT 0,
            default_enabled INTEGER NOT NULL DEFAULT 1,
            default_qty     REAL NOT NULL DEFAULT 1,
            unit_label      TEXT NOT NULL DEFAULT '',
            ref_price       REAL NOT NULL DEFAULT 0,
            default_months  INTEGER NOT NULL DEFAULT 0,
            default_monthly REAL NOT NULL DEFAULT 0,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            UNIQUE (type_name, comp_key)
        )""")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_components (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_id INTEGER NOT NULL REFERENCES contracts(id)
                        ON DELETE CASCADE,
            comp_key    TEXT NOT NULL,
            label       TEXT NOT NULL DEFAULT '',
            kind        TEXT NOT NULL DEFAULT 'qty',
            enabled     INTEGER NOT NULL DEFAULT 1,
            qty         REAL NOT NULL DEFAULT 1,
            months      INTEGER NOT NULL DEFAULT 0,
            monthly     REAL NOT NULL DEFAULT 0,
            UNIQUE (contract_id, comp_key)
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_comp "
                 "ON contract_components(contract_id)")
    # V3.30: وسم مرحلة القالب بمكوّن الشامل (فارغ = أساسية دائمًا)
    _wcols = {r[1] for r in
              conn.execute("PRAGMA table_info(workflow_stages);")}
    if "component_key" not in _wcols:
        conn.execute("ALTER TABLE workflow_stages ADD COLUMN "
                     "component_key TEXT DEFAULT ''")

    # قائمة المهام (يدوية أو محولة من التنبيهات)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT NOT NULL,
            details         TEXT DEFAULT '',
            due_at          TEXT NOT NULL,
            remind_minutes  INTEGER DEFAULT 30,
            source          TEXT DEFAULT 'يدوية',
            status          TEXT DEFAULT 'مفتوحة',
            notified_before INTEGER DEFAULT 0,
            notified_after  INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now', 'localtime')),
            done_at         TEXT DEFAULT ''
        )""")
    # دور المستخدم (admin مدير / secretary سكرتير)
    ucols = {r[1] for r in conn.execute("PRAGMA table_info(users);")}
    if "role" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN "
                     "role TEXT DEFAULT 'admin'")
    # اسم الموظف المرتبط بالحساب (يظهر في الواجهة بدل اسم الدخول)
    if "full_name" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN "
                     "full_name TEXT DEFAULT ''")
    if "job_title" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN "
                     "job_title TEXT DEFAULT ''")
    # ربط المهمة بعميل/عقد (اختياري)
    tcols = {r[1] for r in conn.execute("PRAGMA table_info(tasks);")}
    if "task_type" not in tcols:
        conn.execute("ALTER TABLE tasks ADD COLUMN "
                     "task_type TEXT DEFAULT 'تذكير'")
    if "customer_id" not in tcols:
        conn.execute("ALTER TABLE tasks ADD COLUMN customer_id INTEGER")
    if "contract_id" not in tcols:
        conn.execute("ALTER TABLE tasks ADD COLUMN contract_id INTEGER")
    # تدقيق: من أضاف السجل ومتى آخر تحديث (عملاء وعقود)
    cucols = {r[1] for r in conn.execute("PRAGMA table_info(customers);")}
    for col in ("created_by", "updated_by"):
        if col not in cucols:
            conn.execute(f"ALTER TABLE customers ADD COLUMN "
                         f"{col} TEXT DEFAULT ''")
    if "updated_at" not in cucols:
        conn.execute("ALTER TABLE customers ADD COLUMN "
                     "updated_at TEXT DEFAULT ''")
    concols = {r[1] for r in conn.execute("PRAGMA table_info(contracts);")}
    for col in ("created_by", "updated_by"):
        if col not in concols:
            conn.execute(f"ALTER TABLE contracts ADD COLUMN "
                         f"{col} TEXT DEFAULT ''")
    if "updated_at" not in concols:
        conn.execute("ALTER TABLE contracts ADD COLUMN "
                     "updated_at TEXT DEFAULT ''")
    # أي عقد بلا نوع يأخذ «غير محدد»، ويُحدَّد لاحقًا من
    # أداة التحديد الجماعي في الإعدادات.
    conn.execute(
        "INSERT OR IGNORE INTO contract_types (name, default_amount, "
        "notes) VALUES ('غير محدد', 0, 'للعقود القديمة قبل تفعيل "
        "أنواع العقود — حدّدها من زر «تحديد نوع العقود القديمة»')")
    conn.execute(
        "UPDATE contracts SET contract_type='غير محدد' "
        "WHERE COALESCE(contract_type,'') = ''")
    # إخفاء الأنواع الثابتة التجريبية غير المستخدمة؛ الضم الآن يتم بمجموعات عقود
    # مستقلة بدل إنشاء نوع مختلط ثابت. لا نحذف أي نوع مستخدم في عقود فعلية.
    conn.execute("""
        UPDATE contract_types SET active=0
        WHERE name IN ('مختلط بدون إشراف', 'مختلط مع إشراف', 'شامل')
          AND NOT EXISTS (
              SELECT 1 FROM contracts c WHERE c.contract_type = contract_types.name
          )
    """)
    # ضمان نمط لكل نوع (يشمل «غير محدد» المُنشأ للتو)
    conn.execute(
        "UPDATE contract_types SET pricing_mode = "
        "CASE WHEN COALESCE(unit_price,0) > 0 THEN 'unit' "
        "ELSE 'lump' END WHERE COALESCE(pricing_mode,'') = ''")

    # مجموعات/حزم العقود: ضم أكثر من عقد مستقل تحت ملف/اتفاق واحد
    # بدون دمج مالي أو حذف أو تغيير نوع العقد الأصلي.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_groups (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            group_number    TEXT NOT NULL UNIQUE,
            customer_id      INTEGER NOT NULL REFERENCES customers(id),
            group_name      TEXT NOT NULL,
            notes           TEXT DEFAULT '',
            status          TEXT DEFAULT 'نشط',
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            created_by      TEXT DEFAULT ''
        )""")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_group_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id        INTEGER NOT NULL REFERENCES contract_groups(id),
            contract_id     INTEGER NOT NULL REFERENCES contracts(id),
            added_at        TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(group_id, contract_id)
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_groups_customer ON contract_groups(customer_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_group_items_group ON contract_group_items(group_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_contract_group_items_contract ON contract_group_items(contract_id)")
    # V4.47: المطالبات المالية — جدول جديد مستقل (بلا مساس بأي جدول قائم).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            claim_number    TEXT NOT NULL UNIQUE,
            direction       TEXT NOT NULL CHECK (direction IN ('out','in')),
            contract_id     INTEGER NOT NULL REFERENCES contracts(id),
            sub_contract_id INTEGER REFERENCES sub_contracts(id),
            cust_line_id    INTEGER REFERENCES payment_plan(id),
            sub_line_id     INTEGER REFERENCES sub_payment_plan(id),
            title           TEXT NOT NULL,
            amount          REAL NOT NULL CHECK (amount > 0),
            due_date        TEXT DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'registered',
            voucher_ref     TEXT DEFAULT '',
            notes           TEXT DEFAULT '',
            postponed_until TEXT DEFAULT '',
            created_by      TEXT DEFAULT '',
            created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT ''
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_claims_contract ON claims(contract_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_claims_dir_status ON claims(direction, status)")
    # V4.48: نطاق العقد — مراحل القالب المختارة له (فارغ = القالب كاملًا).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_scope (
            contract_id       INTEGER NOT NULL REFERENCES contracts(id),
            template_stage_id INTEGER NOT NULL,
            UNIQUE(contract_id, template_stage_id)
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_scope_contract ON contract_scope(contract_id)")
    # فهارس أداء إضافية مهمة بعد رفع بيانات قديمة كثيرة: العملاء/السندات/التعليقات.
    for sql in (
        "CREATE INDEX IF NOT EXISTS idx_vouchers_type_date ON vouchers(vtype, cancelled, vdate, id)",
        "CREATE INDEX IF NOT EXISTS idx_vouchers_party ON vouchers(party_type, party_id, vtype, cancelled)",
        "CREATE INDEX IF NOT EXISTS idx_vouchers_exp_customer ON vouchers(expense_customer_id, vtype, cancelled)",
        "CREATE INDEX IF NOT EXISTS idx_vouchers_receipt_group ON vouchers(receipt_group_ref)",
        "CREATE INDEX IF NOT EXISTS idx_vouchers_expense_group ON vouchers(expense_group_ref)",
        "CREATE INDEX IF NOT EXISTS idx_vouchers_custody ON vouchers(custody_account_id, expense_group_ref)",
        "CREATE INDEX IF NOT EXISTS idx_contracts_customer_status ON contracts(customer_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_addendums_contract_status ON addendums(contract_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_plan_contract_status ON payment_plan(contract_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_comments_customer_live ON customer_comments(customer_id, is_deleted, pinned, created_at DESC, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_comments_contract_live ON customer_comments(contract_id, is_deleted, created_at DESC, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_customer_contract ON tasks(customer_id, contract_id, status, due_at)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at)",
        "CREATE INDEX IF NOT EXISTS idx_contract_events_many ON contract_events(contract_id, event_time DESC, id DESC)",
    ):
        try:
            conn.execute(sql)
        except Exception:
            pass

    # V2.48: عدّادات الترقيم — رقم السند/المشروع/العرض بقراءة مفهرسة
    # بدل مسح الجدول كاملًا مع كل حفظ (كان يزداد بطئًا مع البيانات).
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS number_sequences ("
            "name TEXT PRIMARY KEY, last_no INTEGER NOT NULL DEFAULT 0)")
    except Exception:
        pass


def _schema_fingerprint() -> int:
    """بصمة المخطط: تتغيّر تلقائيًا كلما تغيّر _SCHEMA أو _apply_schema."""
    import hashlib
    h = hashlib.sha1()
    h.update(_SCHEMA.encode("utf-8"))
    code = _apply_schema.__code__
    h.update(code.co_code)
    h.update(repr(code.co_consts).encode("utf-8", "replace"))
    value = int(h.hexdigest()[:7], 16)
    return value or 1        # الصفر محجوز للقاعدة الجديدة



def _ensure_critical_columns(conn) -> None:
    """أعمدة حرجة يجب ضمانها حتى لو كانت user_version قديمة/مطابقة.

    بعض نسخ Backup القديمة كانت تحتوي جدول workflow_stages بلا pay_kind،
    فتتعطل شاشة شجرة المراحل قبل إكمال الترقية.
    """
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "workflow_stages" in tables:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(workflow_stages)")}
            critical = {
                "pay_kind": "TEXT DEFAULT ''",
                "payment_pct": "REAL DEFAULT 0",
                "contract_type": "TEXT DEFAULT ''",
                "parent_id": "INTEGER REFERENCES workflow_stages(id)",
                "expected_days": "INTEGER NOT NULL DEFAULT 0",
                "is_pre_contract": "INTEGER NOT NULL DEFAULT 0",
            }
            for col, decl in critical.items():
                if col not in cols:
                    conn.execute(f"ALTER TABLE workflow_stages ADD COLUMN {col} {decl}")
        if "payment_plan" in tables:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(payment_plan)")}
            for col, decl in {
                "stage_id": "INTEGER REFERENCES contract_stages(id)",
                "notes": "TEXT DEFAULT ''",
                "triggered_at": "TEXT DEFAULT ''",
                "manual_amount": "INTEGER DEFAULT 0",
            }.items():
                if col not in cols:
                    conn.execute(f"ALTER TABLE payment_plan ADD COLUMN {col} {decl}")
        # أعمدة السندات الحرجة: بدونها يفشل حفظ **أي** سند بخطأ
        # «table vouchers has no column named ...». تُضمن هنا لأن
        # init_db تتخطى الترقية الكاملة عندما تكون بصمة المخطط
        # مطابقة، وقد تصل قاعدة من نسخة أقدم ببصمة مطابقة وأعمدة ناقصة.
        if "vouchers" in tables:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(vouchers)")}
            for col, decl in {
                "custody_account_id":
                    "INTEGER REFERENCES expense_accounts(id)",
                "custody_account_snapshot": "TEXT DEFAULT ''",
                "expense_account_id":
                    "INTEGER REFERENCES expense_accounts(id)",
                "expense_account_snapshot": "TEXT DEFAULT ''",
                "expense_group_ref": "TEXT DEFAULT ''",
                "expense_group_line": "INTEGER",
                "expense_customer_id": "INTEGER REFERENCES customers(id)",
                "receipt_group_ref": "TEXT DEFAULT ''",
                "receipt_group_line": "INTEGER",
                "parent_voucher_id": "INTEGER",
                "cheque_due_date": "TEXT DEFAULT ''",
                "cancelled": "INTEGER DEFAULT 0",
                "cancel_reason": "TEXT DEFAULT ''",
                "cancelled_at": "TEXT DEFAULT ''",
                "allocation": "TEXT DEFAULT ''",
                "advance_amount": "REAL NOT NULL DEFAULT 0",
            }.items():
                if col not in cols:
                    conn.execute(
                        f"ALTER TABLE vouchers ADD COLUMN {col} {decl}")
        # V6.2: جدول ربط السندات بالدفعات + مفتاح بوابة تحصيل العميل
        conn.execute(
            "CREATE TABLE IF NOT EXISTS voucher_payment_links ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "voucher_id INTEGER NOT NULL REFERENCES vouchers(id), "
            "kind TEXT NOT NULL CHECK (kind IN ('receipt','payment')), "
            "line_id INTEGER NOT NULL, "
            "amount REAL NOT NULL CHECK (amount > 0), "
            "created_at TEXT DEFAULT (datetime('now')), "
            "UNIQUE (voucher_id, line_id))")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vpl_voucher "
                     "ON voucher_payment_links(voucher_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vpl_line "
                     "ON voucher_payment_links(line_id)")
        if "settings" in tables:
            scols = {r[1] for r in conn.execute(
                "PRAGMA table_info(settings)")}
            if "sub_pay_client_gate" not in scols:
                conn.execute("ALTER TABLE settings ADD COLUMN "
                             "sub_pay_client_gate INTEGER NOT NULL DEFAULT 1")
        # V9.5.5: عمود تاريخ الإرجاء في المطالبات
        if "claims" in tables:
            ccols = {r[1] for r in conn.execute(
                "PRAGMA table_info(claims)")}
            if "postponed_until" not in ccols:
                conn.execute("ALTER TABLE claims ADD COLUMN "
                             "postponed_until TEXT DEFAULT ''")
        # عمود كلمة الربط في قالب الدفعات (يمنع تعطل توقيع العقود)
        if "type_payment_tpl" in tables:
            cols = {r[1] for r in conn.execute(
                "PRAGMA table_info(type_payment_tpl)")}
            if "link_keyword" not in cols:
                conn.execute("ALTER TABLE type_payment_tpl "
                             "ADD COLUMN link_keyword TEXT DEFAULT ''")
        
        # V8.3: أعمدة جديدة في sub_contract_items لدعم الشجرة
        if "sub_contract_items" in tables:
            cols = {r[1] for r in conn.execute(
                "PRAGMA table_info(sub_contract_items)")}
            for col, decl in {
                "qty": "REAL DEFAULT 0",
                "unit_price": "REAL DEFAULT 0",
                "amount": "REAL DEFAULT 0",
                "source_kind": "TEXT DEFAULT ''",
                "source_id": "INTEGER DEFAULT 0",
            }.items():
                if col not in cols:
                    conn.execute(
                        f"ALTER TABLE sub_contract_items ADD COLUMN {col} {decl}")
            # تعبئة القيم القديمة من boq_items
            try:
                conn.execute("""
                    UPDATE sub_contract_items 
                    SET qty = COALESCE((SELECT b.qty FROM boq_items b WHERE b.id = boq_item_id), 0),
                        unit_price = COALESCE((SELECT b.unit_price FROM boq_items b WHERE b.id = boq_item_id), 0),
                        amount = COALESCE((SELECT b.qty * b.unit_price FROM boq_items b WHERE b.id = boq_item_id), 0),
                        source_kind = 'boq'
                    WHERE source_kind = '' AND boq_item_id IS NOT NULL
                """)
            except Exception:
                pass
            
            # V8.3: إعادة بناء الجدول للسماح بـ NULL في boq_item_id
            # (SQLite لا يدعم ALTER COLUMN، فنعيد الإنشاء)
            try:
                # فحص: هل boq_item_id NOT NULL؟
                _needs_rebuild = False
                sci_sql = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='sub_contract_items'"
                ).fetchone()
                _create_sql = (sci_sql[0] or "") if sci_sql else ""
                # البحث عن NOT NULL بعد boq_item_id
                import re
                _match = re.search(r'boq_item_id\s+INTEGER\s+NOT\s+NULL', _create_sql, re.IGNORECASE)
                if _match:
                    _needs_rebuild = True
                
                if _needs_rebuild:
                    import logging
                    logging.getLogger("db").info("Rebuilding sub_contract_items to allow NULL boq_item_id")
                    # إعادة بناء الجدول مع السماح بـ NULL
                    conn.execute("ALTER TABLE sub_contract_items RENAME TO sub_contract_items_old")
                    conn.execute("""
                        CREATE TABLE sub_contract_items (
                            id              INTEGER PRIMARY KEY AUTOINCREMENT,
                            sub_contract_id INTEGER NOT NULL REFERENCES sub_contracts(id) ON DELETE CASCADE,
                            boq_item_id     INTEGER REFERENCES boq_items(id) ON DELETE CASCADE,
                            qty             REAL DEFAULT 0,
                            unit_price      REAL DEFAULT 0,
                            amount          REAL DEFAULT 0,
                            source_kind     TEXT DEFAULT '',
                            source_id       INTEGER DEFAULT 0
                        )
                    """)
                    conn.execute("""
                        INSERT INTO sub_contract_items (id, sub_contract_id, boq_item_id, qty, unit_price, amount, source_kind, source_id)
                        SELECT id, sub_contract_id, boq_item_id, 
                               COALESCE(qty, 0), COALESCE(unit_price, 0), COALESCE(amount, 0),
                               COALESCE(source_kind, ''), COALESCE(source_id, 0)
                        FROM sub_contract_items_old
                    """)
                    conn.execute("DROP TABLE sub_contract_items_old")
            except Exception as exc:
                import logging
                logging.getLogger("db").warning("sub_contract_items rebuild failed: %s", exc)
        # V8.4: جدول سجل التدقيق
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_log ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')), "
            "username TEXT DEFAULT '', "
            "action TEXT NOT NULL, "
            "entity_type TEXT NOT NULL, "
            "entity_id INTEGER NOT NULL, "
            "entity_name TEXT DEFAULT '', "
            "old_status TEXT DEFAULT '', "
            "new_status TEXT DEFAULT '', "
            "reason TEXT DEFAULT '', "
            "ip_address TEXT DEFAULT '')")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_entity "
                     "ON audit_log(entity_type, entity_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_time "
                     "ON audit_log(timestamp)")
    except Exception:
        # لا نوقف الفتح هنا؛ الترقية الكاملة ستعرض الخطأ إن بقيت مشكلة.
        pass


def init_db() -> None:
    """تهيئة القاعدة — تتخطى الترقيات إن كانت القاعدة محدَّثة."""
    try:
        with get_connection() as conn:
            # تعطيل فحص المفاتيح الخارجية أثناء كل مراحل الترقية
            # لمنع فشل عند وجود بيانات قديمة مخالفة في الشبكة
            conn.execute("PRAGMA foreign_keys = OFF;")
            try:
                _ensure_critical_columns(conn)
                _repair_missing_employees(conn)
                wanted = _schema_fingerprint()
                current = conn.execute("PRAGMA user_version").fetchone()[0]
                if current == wanted:
                    return
                _apply_schema(conn)
                conn.execute(f"PRAGMA user_version = {wanted}")
            finally:
                # مهم: يجب عمل commit قبل تغيير foreign_keys لأن
                # SQLite يتجاهل PRAGMA foreign_keys أثناء المعاملة المفتوحة
                try:
                    conn.commit()
                except Exception:
                    pass
                conn.execute("PRAGMA foreign_keys = ON;")
        # مراحل المتابعة الافتراضية (تُزرع مرة واحدة · قابلة للتعديل)
        try:
            from services import workflow_service as _wf
            _wf.ensure_default_stages()
        except Exception:
            pass
        try:
            from services import expense_account_service as _ea
            _ea.ensure_defaults()
        except Exception:
            pass
        try:
            from services import comment_service as _cmt
            _cmt._ensure_table()
        except Exception:
            pass
    except sqlite3.Error as exc:
        raise DatabaseError(f"تعذر تهيئة قاعدة البيانات: {exc}") from exc


def backup_db(dest_path: str) -> str:
    """نسخ احتياطي آمن باستخدام sqlite3 backup API."""
    if not os.path.exists(DB_PATH):
        raise DatabaseError("ملف قاعدة البيانات غير موجود.")
    
    # التأكد من وجود مجلد الوجهة
    dest_dir = os.path.dirname(dest_path)
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)
    
    try:
        # استخدام get_connection() بدلاً من اتصال مباشر
        with get_connection() as src:
            dst = sqlite3.connect(dest_path)
            try:
                src._raw.backup(dst)
            finally:
                dst.close()
        return dest_path
    except (sqlite3.Error, OSError) as exc:
        raise DatabaseError(f"فشل إنشاء النسخة الاحتياطية: {exc}") from exc



def _validate_backup_db_file(src_path: str) -> None:
    """فحص ملف SQLite قبل الاستعادة."""
    if not os.path.exists(src_path):
        raise DatabaseError("ملف النسخة الاحتياطية غير موجود.")
    try:
        # فتح Read Only قدر الإمكان حتى لا نعلّق ملف النسخة على قرص/شبكة.
        uri = "file:" + os.path.abspath(src_path).replace("\\", "/") + "?mode=ro"
        check = sqlite3.connect(uri, uri=True, timeout=10.0)
        try:
            result = check.execute("PRAGMA integrity_check;").fetchone()[0]
            if result != "ok":
                raise DatabaseError("ملف النسخة الاحتياطية تالف.")
            tables = {r[0] for r in check.execute(
                "SELECT name FROM sqlite_master WHERE type='table';")}
            required = {"customers", "contracts", "invoices", "settings"}
            if not required.issubset(tables):
                raise DatabaseError("الملف المحدد ليس نسخة احتياطية صالحة لهذا البرنامج.")
        finally:
            check.close()
    except sqlite3.Error as exc:
        raise DatabaseError("الملف المحدد ليس قاعدة بيانات صالحة.") from exc


def schedule_restore_db(src_path: str) -> str:
    """جدولة استعادة آمنة عند التشغيل القادم بدل تنفيذها والبرنامج مفتوح.

    هذا يمنع تهنيج الواجهة ومشاكل استبدال ملف قاعدة مفتوح على Windows.
    """
    src_path = os.path.abspath(src_path)
    _validate_backup_db_file(src_path)
    with open(_PENDING_RESTORE, "w", encoding="utf-8") as fh:
        fh.write(src_path)
    return _PENDING_RESTORE


def apply_pending_restore() -> dict:
    """تنفيذ استعادة مؤجلة قبل فتح قاعدة البرنامج."""
    if not os.path.exists(_PENDING_RESTORE):
        return {"applied": False}
    try:
        with open(_PENDING_RESTORE, encoding="utf-8-sig") as fh:
            src = fh.read().strip()
        try:
            os.remove(_PENDING_RESTORE)
        except OSError:
            pass
        if not src:
            return {"applied": False, "error": "empty pending restore"}
        restore_db(src)
        return {"applied": True, "source": src}
    except Exception as exc:
        try:
            with open(_PENDING_RESTORE + ".failed", "w", encoding="utf-8") as fh:
                fh.write(str(exc))
        except OSError:
            pass
        return {"applied": False, "error": str(exc)}


def restore_db(src_path: str) -> None:
    """استعادة نسخة احتياطية مع التحقق من سلامة الملف أولاً."""
    src_path = os.path.abspath(src_path)
    _validate_backup_db_file(src_path)

    # نسخة أمان من الملف الحالي قبل الاستبدال
    close_connections()   # لا يُستبدل الملف واتصال مفتوح عليه
    try:
        if os.path.exists(DB_PATH):
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            shutil.copy2(DB_PATH, DB_PATH + f".before_restore_{stamp}")
        shutil.copy2(src_path, DB_PATH)
    except OSError as exc:
        raise DatabaseError(f"فشل استعادة النسخة الاحتياطية: {exc}") from exc
    # أي نسخة احتياطية قد تحتوي كلمة مرور مطور قديمة/مجهولة. بعد الاستعادة
    # نولّد كلمة مطور جديدة للقاعدة الحالية ونحفظها في data/كلمة_مرور_المطور.txt.
    # لا يمس هذا حسابات المدير/السكرتير ولا أي بيانات مالية.
    try:
        close_connections()
        init_db()
        from services import auth_service as _auth
        _auth.reset_developer_password()
    except Exception:
        pass
