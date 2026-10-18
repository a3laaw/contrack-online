# 🌐 دليل تحويل ConTrack إلى نظام أونلاين

## 📋 محتويات هذا الملف

1. [هيكل النظام الحالي](#1-هيكل-النظام-الحالي)
2. [قاعدة البيانات (الجداول والعلاقات)](#2-قاعدة-البيانات)
3. [طبقة الخدمات (Business Logic)](#3-طبقة-الخدمات)
4. [واجهات المستخدم (UI)](#4-واجهات-المستخدم)
5. [التوصيات التقنية للتحويل](#5-التوصيات-التقنية)
6. [خارطة الطريق للتحويل](#6-خارطة-الطريق)

---

## 1. هيكل النظام الحالي

### 📁 المجلدات الرئيسية

```
app/
├── database/          ← قاعدة البيانات (SQLite)
│   ├── database.py    ← مخطط الجداول + عمليات CRUD
│   └── models.py      ← نماذج البيانات
│
├── services/          ← طبقة الأعمال (30+ خدمة)
│   ├── lifecycle_service.py    ← إدارة دورة حياة العقود
│   ├── workflow_service.py     ← سير العمل والمراحل
│   ├── contract_service.py     ← العقود
│   ├── settlement_service.py   ← التسويات
│   ├── report_service.py       ← التقارير
│   ├── auth_service.py         ← المصادقة والصلاحيات
│   └── ... (25+ خدمة أخرى)
│
├── ui/                ← واجهات المستخدم (PySide6/Qt)
│   ├── main_window.py          ← النافذة الرئيسية
│   ├── contracts.py            ← شاشة العقود
│   ├── subcontractors.py       ← شاشة مقاولي الباطن
│   ├── vouchers.py             ← شاشة السندات
│   ├── contract_hub.py         ← مركز العقد
│   ├── reports_page.py         ← التقارير
│   └── ... (20+ شاشة)
│
├── assets/            ← الأصول (خطوط، قوالب)
├── tests/             ← الاختبارات
└── main.py            ← نقطة الدخول
```

### 📊 إحصائيات

| الملف | الحجم | الوصف |
|-------|-------|-------|
| services/ | 1.7 MB | 30+ خدمة |
| ui/ | 2.5 MB | 20+ شاشة |
| database/ | 120 KB | مخطط الجداول |
| إجمالي الأكواد | ~8.8 MB | 318 ملف Python |

---

## 2. قاعدة البيانات

### 📊 الجداول الرئيسية (40+ جدول)

#### 🔵 جداول أساسية

```sql
-- العملاء
CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- العقود
CREATE TABLE contracts (
    id INTEGER PRIMARY KEY,
    contract_number TEXT UNIQUE,
    customer_id INTEGER REFERENCES customers(id),
    contract_type TEXT,  -- 'تلقائي', 'يدوي', 'شامل'
    description TEXT,
    amount REAL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    status TEXT DEFAULT 'جديد',
    -- حقول الإشراف
    sup_start_date DATE,
    sup_months INTEGER DEFAULT 0,
    sup_monthly REAL DEFAULT 0,
    sup_discount REAL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- مقاولي الباطن
CREATE TABLE subcontractors (
    id INTEGER PRIMARY KEY,
    sub_code TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    activity TEXT,
    notes TEXT,
    show_all_contracts BOOLEAN DEFAULT 0
);

-- عقود مقاولي الباطن
CREATE TABLE sub_contracts (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    subcontractor_id INTEGER REFERENCES subcontractors(id),
    amount REAL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    description TEXT,
    status TEXT DEFAULT 'جديد'
);
```

#### 🟢 جداول البنود والمراحل

```sql
-- بنود العقد (BOQ)
CREATE TABLE boq_items (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    stage_id INTEGER REFERENCES contract_stages(id),
    description TEXT,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    unit TEXT,
    deleted_addendum_id INTEGER  -- soft delete
);

-- مراحل العقد
CREATE TABLE contract_stages (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    parent_id INTEGER REFERENCES contract_stages(id),
    status TEXT DEFAULT 'جديد'
);

-- بنود مقاولي الباطن
CREATE TABLE sub_contract_items (
    id INTEGER PRIMARY KEY,
    sub_contract_id INTEGER REFERENCES sub_contracts(id),
    boq_item_id INTEGER REFERENCES boq_items(id),
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    description TEXT
);
```

#### 🟡 جداول الدفعات

```sql
-- خطة الدفعات
CREATE TABLE payment_plan (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    stage_id INTEGER REFERENCES contract_stages(id),
    title TEXT,
    amount REAL DEFAULT 0,
    due_date DATE,
    sort_order INTEGER DEFAULT 0,
    status TEXT DEFAULT 'مستحقة'
);

-- دفعات مقاولي الباطن
CREATE TABLE sub_payment_plan (
    id INTEGER PRIMARY KEY,
    sub_contract_id INTEGER REFERENCES sub_contracts(id),
    title TEXT,
    amount REAL DEFAULT 0,
    due_date DATE,
    sort_order INTEGER DEFAULT 0,
    status TEXT DEFAULT 'مستحقة'
);

-- ربط الدفعات
CREATE TABLE sub_payment_sources (
    id INTEGER PRIMARY KEY,
    sub_payment_id INTEGER REFERENCES sub_payment_plan(id),
    client_payment_id INTEGER REFERENCES payment_plan(id),
    amount REAL DEFAULT 0
);
```

#### 🔴 جداول السندات والماليات

```sql
-- السندات (صرف/قبض)
CREATE TABLE vouchers (
    id INTEGER PRIMARY KEY,
    voucher_number TEXT UNIQUE,
    voucher_type TEXT,  -- 'صرف', 'قبض'
    contract_id INTEGER REFERENCES contracts(id),
    sub_contract_id INTEGER REFERENCES sub_contracts(id),
    amount REAL DEFAULT 0,
    payment_method TEXT,  -- 'نقدي', 'شيك', 'تحويل'
    reference_number TEXT,
    description TEXT,
    date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ربط السندات بالدفعات
CREATE TABLE voucher_payment_links (
    id INTEGER PRIMARY KEY,
    voucher_id INTEGER REFERENCES vouchers(id),
    payment_id INTEGER REFERENCES payment_plan(id),
    amount REAL DEFAULT 0
);

-- القيود المحاسبية
CREATE TABLE journal_entries (
    id INTEGER PRIMARY KEY,
    voucher_id INTEGER REFERENCES vouchers(id),
    account_id INTEGER,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    description TEXT,
    date DATE
);
```

#### 🟣 جداول إضافية

```sql
-- المستخدمين والصلاحيات
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password_hash TEXT,
    full_name TEXT,
    role TEXT DEFAULT 'user',
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE user_permissions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    permission TEXT NOT NULL,
    granted BOOLEAN DEFAULT 1
);

-- الإشعارات
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title TEXT,
    message TEXT,
    is_read BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- سجل التدقيق
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT,
    table_name TEXT,
    record_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- العهد
CREATE TABLE custody (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    amount REAL DEFAULT 0,
    description TEXT,
    status TEXT DEFAULT 'مفتوحة'
);

-- المراجععات
CREATE TABLE visits (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    visit_date DATE,
    notes TEXT,
    status TEXT
);

-- المطالبات
CREATE TABLE claims (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    amount REAL DEFAULT 0,
    description TEXT,
    status TEXT DEFAULT 'مستحقة',
    due_date DATE
);

-- التعديلات (الaddOnums)
CREATE TABLE addendums (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    addendum_number TEXT,
    description TEXT,
    amount_change REAL DEFAULT 0,
    date DATE,
    status TEXT
);

-- أنواع العقود
CREATE TABLE contract_types (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE,
    description TEXT,
    is_bundle BOOLEAN DEFAULT 0,
    is_supervision BOOLEAN DEFAULT 0,
    config TEXT  -- JSON
);

-- مكونات العقد الشامل
CREATE TABLE type_bundle_components (
    id INTEGER PRIMARY KEY,
    type_id INTEGER REFERENCES contract_types(id),
    component_type TEXT,
    name TEXT,
    config TEXT  -- JSON
);

-- قوالب سير العمل
CREATE TABLE workflow_stages (
    id INTEGER PRIMARY KEY,
    type_name TEXT,
    stage_name TEXT,
    parent_id INTEGER REFERENCES workflow_stages(id),
    sort_order INTEGER DEFAULT 0,
    config TEXT  -- JSON
);

-- نماذج الدفعات للأنواع
CREATE TABLE type_payment_tpl (
    id INTEGER PRIMARY KEY,
    type_name TEXT,
    title TEXT,
    percentage REAL,
    sort_order INTEGER DEFAULT 0
);

-- مراحل الدفعات للأنواع
CREATE TABLE type_payment_stages (
    id INTEGER PRIMARY KEY,
    tpl_id INTEGER REFERENCES type_payment_tpl(id),
    stage_id INTEGER REFERENCES workflow_stages(id)
);
```

### 🔗 العلاقات بين الجداول

```
customers
    └── contracts
            ├── contract_stages
            │       └── boq_items
            ├── payment_plan
            │       ├── voucher_payment_links
            │       └── sub_payment_sources
            ├── addendums
            ├── claims
            ├── visits
            ├── contract_events
            └── sub_contracts
                    ├── subcontractors
                    ├── sub_contract_items
                    └── sub_payment_plan

vouchers
    ├── voucher_payment_links
    └── journal_entries

users
    ├── user_permissions
    ├── notifications
    └── audit_log

contract_types
    ├── type_bundle_components
    ├── workflow_stages
    └── type_payment_tpl
            └── type_payment_stages
```

---

## 3. طبقة الخدمات

### 📋 قائمة الخدمات الرئيسية

| الخدمة | الحجم | الوظيفة |
|--------|-------|---------|
| `lifecycle_service.py` | 301 KB | إدارة دورة حياة العقود (CRUD + حالات) |
| `workflow_service.py` | 265 KB | سير العمل والمراحل والدفعات |
| `settlement_service.py` | 105 KB | التسويات المالية |
| `report_service.py` | 79 KB | التقارير المالية والإدارية |
| `addendum_service.py` | 69 KB | التعديلات على العقود |
| `import_service.py` | 61 KB | استيراد البيانات |
| `types_setup_service.py` | 60 KB | إعداد أنواع العقود |
| `purge_service.py` | 48 KB | حذف البيانات |
| `form_service.py` | 48 KB | إدارة النماذج |
| `cleanup_service.py` | 44 KB | تنظيف البيانات |
| `supervision_service.py` | 38 KB | خدمات الإشراف |
| `word_service.py` | 37 KB | تصدير Word |
| `extras_service.py` | 34 KB | خدمات إضافية |
| `auth_service.py` | 34 KB | المصادقة والصلاحيات |
| `gateway_service.py` | 32 KB | بوابة الدفعات |
| `contract_service.py` | 29 KB | خدمات العقود |
| `contract_type_service.py` | 22 KB | أنواع العقود |
| `claims_service.py` | 22 KB | المطالبات |
| `full_backup_service.py` | 21 KB | النسخ الاحتياطي |
| `feature_service.py` | 19 KB | الميزات |

### 🔑 الدوال الرئيسية في كل خدمة

#### lifecycle_service.py (الخدمات الأساسية)

```python
# العقود
def add_contract(data, components=None, scope_stage_ids=None, manual_path=None)
def update_contract(contract_id, data, ...)
def delete_contract(contract_id)
def get_contract(contract_id)
def list_contracts(customer_id=None, status=None, ...)

# مقاولي الباطن
def add_subcontractor(code, name, phone, email, activity, notes, show_all_contracts)
def update_subcontractor(sub_id, ...)
def delete_subcontractor(sub_id)
def get_subcontractor(sub_id)
def list_subcontractors()

# عقود مقاولي الباطن
def add_sub_contract(contract_id, subcontractor_id, amount, ...)
def update_sub_contract(sub_id, ...)
def delete_sub_contract(sub_id)

# العملاء
def add_customer(name, phone, email, address, notes)
def update_customer(customer_id, ...)
def delete_customer(customer_id)
def list_customers()

# السندات
def add_voucher(voucher_type, contract_id, amount, ...)
def update_voucher(voucher_id, ...)
def delete_voucher(voucher_id)
def list_vouchers(contract_id=None, ...)

# البنود
def add_boq_item(contract_id, description, quantity, unit_price, ...)
def update_boq_item(item_id, ...)
def delete_boq_item(item_id)

# الدفعات
def add_payment(contract_id, title, amount, due_date, ...)
def update_payment(payment_id, ...)
def delete_payment(payment_id)
```

#### workflow_service.py (سير العمل)

```python
# المراحل
def get_stages(tx_type, type_name)
def get_stage_children(stage_id)
def get_stage_parent(stage_id)

# الدفعات
def type_payments(type_name)
def get_payment_templates(type_name)
def apply_payment_template(contract_id, type_name)

# الحالات
def advance_stage(record_id, tx_type, new_status)
def get_stage_history(record_id, tx_type)
```

#### auth_service.py (المصادقة)

```python
# المستخدمين
def login(username, password)
def logout()
def get_current_user()
def has_permission(permission)

# الصلاحيات
def grant_permission(user_id, permission)
def revoke_permission(user_id, permission)
def list_permissions(user_id)
```

#### report_service.py (التقارير)

```python
# التقارير المالية
def financial_summary(start_date=None, end_date=None)
def contract_financials(contract_id)
def customer_statement(customer_id, start_date, end_date)

# التقارير الإدارية
def contracts_report(filters)
def subcontracts_report(filters)
def vouchers_report(filters)

# التقارير الخاصة
def daily_report(date)
def monthly_report(year, month)
def claims_report(status=None)
```

---

## 4. واجهات المستخدم

### 📱 الشاشات الرئيسية

| الشاشة | الملف | الوصف |
|--------|-------|-------|
| النافذة الرئيسية | `main_window.py` | التنقل الرئيسي |
| العقود | `contracts.py` | إضافة/تعديل العقود |
| مركز العقد | `contract_hub.py` | تفاصيل العقد الكاملة |
| مقاولي الباطن | `subcontractors.py` | عقود المقاولين |
| السندات | `vouchers.py` | سندات الصرف/القبض |
| التقارير | `reports_page.py` | التقارير المالية |
| الإعدادات | `settings.py` | إعدادات النظام |
| الأرشيف | `archive.py` | الأرشيف |
| المتابعة | `followup.py` | متابعة المهام |
| العهد | `custody_center.py` | إدارة العهد |

### 🎨 مكونات الواجهة

```python
# المكونات المشتركة (widgets.py)
- SearchableComboBox    ← قائمة منسدلة مع بحث
- SafeDoubleSpinBox     ← حقل رقمي آمن
- SafeDateEdit          ← حقل تاريخ
- apply_column_weights  ← توزيع أعمدة الجدول
- sync_header_alignment ← محاذاة رأس الجدول

# الأنماط (style.py)
- setup_dialog()        ← إعداد النافذة
- dialog_buttons()      ← أزرار الحفظ/إلغاء
- toast()               ← رسائل التنبيه
- error()               ← رسائل الخطأ
- info()                ← رسائل المعلومات
```

---

## 5. التوصيات التقنية للتحويل

### 🎯 الخيار 1: Django + React (موصى به)

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ العقود  │  │ السندات │  │التقارير │  │الإعدادات│    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   REST API (Django)                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  /api/contracts/  /api/vouchers/  /api/reports/  │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Django REST Framework + JWT Authentication      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Database (PostgreSQL)                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │customers│  │contracts│  │ vouchers│  │  users  │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
└─────────────────────────────────────────────────────────┘
```

#### هيكل المشروع المقترح

```
contrack_online/
├── backend/                    ← Django
│   ├── contrack/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   ├── apps/
│   │   ├── customers/         ← تطبيق العملاء
│   │   │   ├── models.py
│   │   │   ├── serializers.py
│   │   │   ├── views.py
│   │   │   └── urls.py
│   │   ├── contracts/         ← تطبيق العقود
│   │   ├── subcontractors/    ← تطبيق مقاولي الباطن
│   │   ├── vouchers/          ← تطبيق السندات
│   │   ├── reports/           ← تطبيق التقارير
│   │   ├── auth/              ← تطبيق المصادقة
│   │   └── workflows/         ← تطبيق سير العمل
│   ├── core/                  ← المنطق الأساسي
│   │   ├── services/          ← نقل الخدمات من Python
│   │   └── utils/             ← أدوات مساعدة
│   └── requirements.txt
│
├── frontend/                   ← React
│   ├── src/
│   │   ├── components/        ← مكونات مشتركة
│   │   ├── pages/             ← الصفحات
│   │   ├── services/          ← خدمات API
│   │   ├── hooks/             ← React Hooks
│   │   └── utils/             ← أدوات
│   ├── package.json
│   └── vite.config.js
│
└── docker-compose.yml
```

### 🎯 الخيار 2: FastAPI + Vue.js (أسرع)

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (Vue.js)                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Vue 3 + Pinia + Vue Router + Element Plus      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   API (FastAPI)                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  FastAPI + SQLAlchemy + Pydantic + JWT          │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Database (PostgreSQL)                       │
└─────────────────────────────────────────────────────────┘
```

### 🎯 الخيار 3: Flask + HTMx (أبسط)

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (HTMx)                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │  HTML + HTMx + Alpine.js + Tailwind CSS         │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Server (Flask)                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Flask + SQLAlchemy + Jinja2 + Flask-Login      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 6. خارطة الطريق للتحويل

### 📅 المرحلة 1: التخطيط (أسبوع 1)

- [ ] اختيار التقنيات (.djangoproject/FastAPI/Flask)
- [ ] تصميم قاعدة البيانات الجديدة (PostgreSQL)
- [ ] إنشاء هيكل المشروع
- [ ] إعداد بيئة التطوير

### 📅 المرحلة 2: قاعدة البيانات (أسبوع 2)

- [ ] تحويل الجداول من SQLite إلى PostgreSQL
- [ ] إنشاء العلاقات (Foreign Keys)
- [ ] إنشاء المigrations
- [ ] نقل البيانات (ETL)

### 📅 المرحلة 3: الخدمات (أسابيع 3-4)

- [ ] تحويل `lifecycle_service.py` إلى Django/FastAPI
- [ ] تحويل `workflow_service.py`
- [ ] تحويل `auth_service.py` إلى JWT
- [ ] تحويل `report_service.py`
- [ ] إنشاء REST API endpoints

### 📅 المرحلة 4: الواجهات (أسابيع 5-7)

- [ ] إنشاء مكونات UI مشتركة
- [ ] تحويل شاشة العقود
- [ ] تحويل شاشة السندات
- [ ] تحويل شاشة التقارير
- [ ] تحويل الإعدادات

### 📅 المرحلة 5: الميزات المتقدمة (أسبوع 8)

- [ ] Multi-tenancy (عدة شركات)
- [ ] Real-time notifications
- [ ] File uploads (Word templates)
- [ ] Export/Import
- [ ] Backup/Restore

### 📅 المرحلة 6: الاختبار والنشر (أسبوع 9)

- [ ] اختبارات الوحدة
- [ ] اختبارات التكامل
- [ ] اختبارات الأداء
- [ ] النشر على Cloud

---

## 7. ملاحظات مهمة

### ⚠️ التحديات المتوقعة

1. **PySide6 → Web**: تحويل واجهة سطح المكتب إلى واجهة ويب
2. **SQLite → PostgreSQL**: اختلافات في SQL
3. **Local → Cloud**: إدارة الجلسات والصلاحيات
4. **Performance**: تحسين الأستعلامات للويب
5. **Security**: حماية البيانات وال-API

### ✅ المزايا بعد التحول

1. **Multi-user**: دعم مستخدمين متعددين
2. **Anywhere Access**: الوصول من أي مكان
3. **Scalability**: قابلية التوسع
4. **Updates**: تحديثات مركزية
5. **Backup**: نسخ احتياطي تلقائي
6. **Integration**: تكامل مع أنظمة أخرى

---

## 8. موارد مفيدة

### 📚 Django

- [Django Documentation](https://docs.djangoproject.com/)
- [Django REST Framework](https://www.django-rest-framework.org/)
- [Django Best Practices](https://djangostars.com/blog/django-project-structure/)

### 📚 FastAPI

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy](https://docs.sqlalchemy.org/)
- [Pydantic](https://docs.pydantic.dev/)

### 📚 React

- [React Documentation](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)

### 📚 Vue.js

- [Vue.js Documentation](https://vuejs.org/)
- [Pinia](https://pinia.vuejs.org/)
- [Element Plus](https://element-plus.org/)

---

**تاريخ الإنشاء:** 2026-10-12  
**الإصدار:** V9.7.0  
**المؤلف:** ConTrack Development Team
