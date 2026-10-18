-- ============================================
-- ConTrack Database Schema for PostgreSQL
-- Version: V9.7.0
-- Date: 2026-10-12
-- ============================================

-- Enable UUID extension (optional)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. CUSTOMERS (العملاء)
-- ============================================
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================
-- 2. USERS (المستخدمين)
-- ============================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    email VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user',  -- 'admin', 'manager', 'user', 'viewer'
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- 3. USER PERMISSIONS (صلاحيات المستخدمين)
-- ============================================
CREATE TABLE user_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(100) NOT NULL,
    granted BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, permission)
);

CREATE INDEX idx_permissions_user ON user_permissions(user_id);

-- ============================================
-- 4. CONTRACT TYPES (أنواع العقود)
-- ============================================
CREATE TABLE contract_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_bundle BOOLEAN DEFAULT FALSE,
    is_supervision BOOLEAN DEFAULT FALSE,
    is_auto BOOLEAN DEFAULT FALSE,  -- تلقائي
    config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5. WORKFLOW STAGES (مراحل سير العمل)
-- ============================================
CREATE TABLE workflow_stages (
    id SERIAL PRIMARY KEY,
    type_name VARCHAR(100) NOT NULL,  -- اسم نوع العقد
    stage_name VARCHAR(200) NOT NULL,
    parent_id INTEGER REFERENCES workflow_stages(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    stage_type VARCHAR(50),  -- 'main', 'sub', 'payment'
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_type ON workflow_stages(type_name);
CREATE INDEX idx_workflow_parent ON workflow_stages(parent_id);

-- ============================================
-- 6. PAYMENT TEMPLATES (قوالب الدفعات)
-- ============================================
CREATE TABLE type_payment_tpl (
    id SERIAL PRIMARY KEY,
    type_name VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    percentage DECIMAL(5,2),
    amount DECIMAL(15,3),
    sort_order INTEGER DEFAULT 0,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payment_tpl_type ON type_payment_tpl(type_name);

-- ============================================
-- 7. PAYMENT TEMPLATE STAGES (ربط القوالب بالمراحل)
-- ============================================
CREATE TABLE type_payment_stages (
    id SERIAL PRIMARY KEY,
    tpl_id INTEGER REFERENCES type_payment_tpl(id) ON DELETE CASCADE,
    stage_id INTEGER REFERENCES workflow_stages(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. CONTRACTS (العقود)
-- ============================================
CREATE TABLE contracts (
    id SERIAL PRIMARY KEY,
    contract_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    contract_type VARCHAR(50),  -- 'تلقائي', 'يدوي', 'شامل'
    type_name VARCHAR(100) REFERENCES contract_types(name),
    description TEXT,
    amount DECIMAL(15,3) DEFAULT 0,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'جديد',  -- 'جديد', 'نشط', 'مكتمل', 'ملغى'
    
    -- حقول الإشراف
    sup_start_date DATE,
    sup_months INTEGER DEFAULT 0,
    sup_monthly DECIMAL(15,3) DEFAULT 0,
    sup_discount DECIMAL(15,3) DEFAULT 0,
    
    -- معلومات إضافية
    notes TEXT,
    attachments JSONB DEFAULT '[]',
    
    -- التواريخ
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contracts_customer ON contracts(customer_id);
CREATE INDEX idx_contracts_type ON contracts(contract_type);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_number ON contracts(contract_number);
CREATE INDEX idx_contracts_dates ON contracts(start_date, end_date);

-- ============================================
-- 9. CONTRACT STAGES (مراحل العقد)
-- ============================================
CREATE TABLE contract_stages (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    stage_type VARCHAR(50),  -- 'main', 'sub', 'payment'
    parent_id INTEGER REFERENCES contract_stages(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'جديد',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stages_contract ON contract_stages(contract_id);
CREATE INDEX idx_stages_parent ON contract_stages(parent_id);

-- ============================================
-- 10. BOQ ITEMS (بنود العقد)
-- ============================================
CREATE TABLE boq_items (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    stage_id INTEGER REFERENCES contract_stages(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    unit VARCHAR(50),
    quantity DECIMAL(15,3) DEFAULT 0,
    unit_price DECIMAL(15,3) DEFAULT 0,
    total_price DECIMAL(15,3) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    sort_order INTEGER DEFAULT 0,
    deleted_addendum_id INTEGER,  -- soft delete
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_boq_contract ON boq_items(contract_id);
CREATE INDEX idx_boq_stage ON boq_items(stage_id);

-- ============================================
-- 11. PAYMENT PLAN (خطة الدفعات)
-- ============================================
CREATE TABLE payment_plan (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    stage_id INTEGER REFERENCES contract_stages(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    amount DECIMAL(15,3) DEFAULT 0,
    due_date DATE,
    sort_order INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'مستحقة',  -- 'مستحقة', 'مؤجلة', 'مسددة', 'ملغاة'
    paid_amount DECIMAL(15,3) DEFAULT 0,
    paid_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payment_contract ON payment_plan(contract_id);
CREATE INDEX idx_payment_stage ON payment_plan(stage_id);
CREATE INDEX idx_payment_status ON payment_plan(status);
CREATE INDEX idx_payment_due ON payment_plan(due_date);

-- ============================================
-- 12. SUBCONTRACTORS (مقاولي الباطن)
-- ============================================
CREATE TABLE subcontractors (
    id SERIAL PRIMARY KEY,
    sub_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(100),
    activity VARCHAR(200),  -- نوع النشاط
    notes TEXT,
    show_all_contracts BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subcontractors_code ON subcontractors(sub_code);
CREATE INDEX idx_subcontractors_name ON subcontractors(name);

-- ============================================
-- 13. SUB CONTRACTS (عقود مقاولي الباطن)
-- ============================================
CREATE TABLE sub_contracts (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    subcontractor_id INTEGER REFERENCES subcontractors(id) ON DELETE RESTRICT,
    amount DECIMAL(15,3) DEFAULT 0,
    start_date DATE,
    end_date DATE,
    description TEXT,
    status VARCHAR(20) DEFAULT 'جديد',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sub_contracts_main ON sub_contracts(contract_id);
CREATE INDEX idx_sub_contracts_sub ON sub_contracts(subcontractor_id);

-- ============================================
-- 14. SUB CONTRACT ITEMS (بنود مقاولي الباطن)
-- ============================================
CREATE TABLE sub_contract_items (
    id SERIAL PRIMARY KEY,
    sub_contract_id INTEGER REFERENCES sub_contracts(id) ON DELETE CASCADE,
    boq_item_id INTEGER REFERENCES boq_items(id) ON DELETE SET NULL,
    description TEXT,
    quantity DECIMAL(15,3) DEFAULT 0,
    unit_price DECIMAL(15,3) DEFAULT 0,
    total_price DECIMAL(15,3) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sub_items_contract ON sub_contract_items(sub_contract_id);
CREATE INDEX idx_sub_items_boq ON sub_contract_items(boq_item_id);

-- ============================================
-- 15. SUB PAYMENT PLAN (دفعات مقاولي الباطن)
-- ============================================
CREATE TABLE sub_payment_plan (
    id SERIAL PRIMARY KEY,
    sub_contract_id INTEGER REFERENCES sub_contracts(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    amount DECIMAL(15,3) DEFAULT 0,
    due_date DATE,
    sort_order INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'مستحقة',
    paid_amount DECIMAL(15,3) DEFAULT 0,
    paid_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sub_payment_contract ON sub_payment_plan(sub_contract_id);

-- ============================================
-- 16. SUB PAYMENT SOURCES (ربط دفعات المقاول بالدفعات الرئيسية)
-- ============================================
CREATE TABLE sub_payment_sources (
    id SERIAL PRIMARY KEY,
    sub_payment_id INTEGER REFERENCES sub_payment_plan(id) ON DELETE CASCADE,
    client_payment_id INTEGER REFERENCES payment_plan(id) ON DELETE CASCADE,
    amount DECIMAL(15,3) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sub_sources_sub ON sub_payment_sources(sub_payment_id);
CREATE INDEX idx_sub_sources_client ON sub_payment_sources(client_payment_id);

-- ============================================
-- 17. PAYMENT METHODS (طرق الدفع)
-- ============================================
CREATE TABLE payment_methods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default payment methods
INSERT INTO payment_methods (name, sort_order) VALUES
    ('نقدي', 1),
    ('شيك', 2),
    ('تحويل بنكي', 3),
    ('بطاقة ائتمان', 4);

-- ============================================
-- 18. VOUCHERS (السندات)
-- ============================================
CREATE TABLE vouchers (
    id SERIAL PRIMARY KEY,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    voucher_type VARCHAR(20) NOT NULL,  -- 'صرف', 'قبض'
    contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
    sub_contract_id INTEGER REFERENCES sub_contracts(id) ON DELETE SET NULL,
    amount DECIMAL(15,3) NOT NULL,
    payment_method VARCHAR(50),
    payment_method_id INTEGER REFERENCES payment_methods(id),
    reference_number VARCHAR(100),  -- رقم الشيك/التحويل
    bank_name VARCHAR(100),
    description TEXT,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'مرحل',  -- 'مرحل', 'ملغى'
    
    -- معلومات إضافية
    attachments JSONB DEFAULT '[]',
    notes TEXT,
    
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vouchers_number ON vouchers(voucher_number);
CREATE INDEX idx_vouchers_type ON vouchers(voucher_type);
CREATE INDEX idx_vouchers_contract ON vouchers(contract_id);
CREATE INDEX idx_vouchers_date ON vouchers(date);
CREATE INDEX idx_vouchers_status ON vouchers(status);

-- ============================================
-- 19. VOUCHER PAYMENT LINKS (ربط السندات بالدفعات)
-- ============================================
CREATE TABLE voucher_payment_links (
    id SERIAL PRIMARY KEY,
    voucher_id INTEGER REFERENCES vouchers(id) ON DELETE CASCADE,
    payment_id INTEGER REFERENCES payment_plan(id) ON DELETE CASCADE,
    sub_payment_id INTEGER REFERENCES sub_payment_plan(id) ON DELETE CASCADE,
    amount DECIMAL(15,3) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_voucher_links_voucher ON voucher_payment_links(voucher_id);
CREATE INDEX idx_voucher_links_payment ON voucher_payment_links(payment_id);

-- ============================================
-- 20. JOURNAL ENTRIES (القيود المحاسبية)
-- ============================================
CREATE TABLE journal_entries (
    id SERIAL PRIMARY KEY,
    voucher_id INTEGER REFERENCES vouchers(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    account_code VARCHAR(50),
    account_name VARCHAR(200),
    description TEXT,
    debit DECIMAL(15,3) DEFAULT 0,
    credit DECIMAL(15,3) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_journal_voucher ON journal_entries(voucher_id);
CREATE INDEX idx_journal_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_account ON journal_entries(account_code);

-- ============================================
-- 21. EXPENSE ACCOUNTS (حسابات المصروفات)
-- ============================================
CREATE TABLE expense_accounts (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    parent_id INTEGER REFERENCES expense_accounts(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 22. ADDENDUMS (التعديلات)
-- ============================================
CREATE TABLE addendums (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    addendum_number VARCHAR(50),
    description TEXT,
    amount_change DECIMAL(15,3) DEFAULT 0,
    date DATE,
    status VARCHAR(20) DEFAULT 'جديد',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_addendums_contract ON addendums(contract_id);

-- ============================================
-- 23. ADDENDUM ITEMS (بنود التعديلات)
-- ============================================
CREATE TABLE addendum_items (
    id SERIAL PRIMARY KEY,
    addendum_id INTEGER REFERENCES addendums(id) ON DELETE CASCADE,
    boq_item_id INTEGER REFERENCES boq_items(id) ON DELETE SET NULL,
    action VARCHAR(20),  -- 'إضافة', 'تعديل', 'حذف'
    description TEXT,
    quantity DECIMAL(15,3),
    unit_price DECIMAL(15,3),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_addendum_items_addendum ON addendum_items(addendum_id);

-- ============================================
-- 24. CONTRACT EVENTS (أحداث العقد)
-- ============================================
CREATE TABLE contract_events (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    event_type VARCHAR(50),
    description TEXT,
    event_date DATE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_contract ON contract_events(contract_id);

-- ============================================
-- 25. CLAIMS (المطالبات)
-- ============================================
CREATE TABLE claims (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    amount DECIMAL(15,3) DEFAULT 0,
    description TEXT,
    status VARCHAR(20) DEFAULT 'مستحقة',  -- 'مستحقة', 'مؤجلة', 'مسددة', 'ملغاة'
    due_date DATE,
    paid_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_claims_contract ON claims(contract_id);
CREATE INDEX idx_claims_status ON claims(status);

-- ============================================
-- 26. VISITS (المراجععات)
-- ============================================
CREATE TABLE visits (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    visit_date DATE NOT NULL,
    visit_type VARCHAR(50),
    notes TEXT,
    status VARCHAR(20) DEFAULT 'مجدولة',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_visits_contract ON visits(contract_id);
CREATE INDEX idx_visits_date ON visits(visit_date);

-- ============================================
-- 27. VISIT STAFF (طاقم المراجعة)
-- ============================================
CREATE TABLE visit_staff (
    id SERIAL PRIMARY KEY,
    visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    role VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 28. EMPLOYEES (الموظفين)
-- ============================================
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    position VARCHAR(100),
    department VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_employees_code ON employees(employee_code);
CREATE INDEX idx_employees_name ON employees(name);

-- ============================================
-- 29. CUSTODY (العهد)
-- ============================================
CREATE TABLE custody (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE RESTRICT,
    amount DECIMAL(15,3) DEFAULT 0,
    description TEXT,
    status VARCHAR(20) DEFAULT 'مفتوحة',  -- 'مفتوحة', 'مغلقة', 'محسومة'
    open_date DATE,
    close_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_custody_employee ON custody(employee_id);
CREATE INDEX idx_custody_status ON custody(status);

-- ============================================
-- 30. CONTRACT TEMPLATES (قوالب العقود)
-- ============================================
CREATE TABLE contract_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    template_type VARCHAR(50),
    content TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 31. CONTRACT ATTACHMENTS (مرفقات العقود)
-- ============================================
CREATE TABLE contract_attachments (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    file_type VARCHAR(50),
    file_size INTEGER,
    description TEXT,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attachments_contract ON contract_attachments(contract_id);

-- ============================================
-- 32. CONTRACT GROUPS (مجموعات العقود)
-- ============================================
CREATE TABLE contract_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contract_group_items (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES contract_groups(id) ON DELETE CASCADE,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, contract_id)
);

-- ============================================
-- 33. CONTRACT SCOPE (نطاق العقد)
-- ============================================
CREATE TABLE contract_scope (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    stage_id INTEGER REFERENCES contract_stages(id) ON DELETE CASCADE,
    is_included BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scope_contract ON contract_scope(contract_id);

-- ============================================
-- 34. CONTRACT COMPONENTS (مكونات العقد الشامل)
-- ============================================
CREATE TABLE contract_components (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    component_type VARCHAR(50),
    name VARCHAR(200),
    amount DECIMAL(15,3) DEFAULT 0,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_components_contract ON contract_components(contract_id);

-- ============================================
-- 35. TYPE BUNDLE COMPONENTS (مكونات العقد الشامل للأنواع)
-- ============================================
CREATE TABLE type_bundle_components (
    id SERIAL PRIMARY KEY,
    type_id INTEGER REFERENCES contract_types(id) ON DELETE CASCADE,
    component_type VARCHAR(50),
    name VARCHAR(200),
    is_enabled BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bundle_type ON type_bundle_components(type_id);

-- ============================================
-- 36. TASKS (المهام)
-- ============================================
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    assigned_to INTEGER REFERENCES employees(id),
    due_date DATE,
    status VARCHAR(20) DEFAULT 'جديدة',  -- 'جديدة', 'قيد التنفيذ', 'مكتملة', 'ملغاة'
    priority VARCHAR(20) DEFAULT 'متوسطة',  -- 'عالية', 'متوسطة', 'منخفضة'
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_contract ON tasks(contract_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================
-- 37. NOTIFICATIONS (الإشعارات)
-- ============================================
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    notification_type VARCHAR(50),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    link VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);

-- ============================================
-- 38. AUDIT LOG (سجل التدقيق)
-- ============================================
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,  -- 'CREATE', 'UPDATE', 'DELETE'
    table_name VARCHAR(100) NOT NULL,
    record_id INTEGER,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_table ON audit_log(table_name);
CREATE INDEX idx_audit_record ON audit_log(record_id);
CREATE INDEX idx_audit_date ON audit_log(created_at);

-- ============================================
-- 39. SETTINGS (الإعدادات)
-- ============================================
CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(20) DEFAULT 'string',  -- 'string', 'number', 'boolean', 'json'
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES
    ('company_name', '', 'string', 'اسم الشركة'),
    ('company_phone', '', 'string', 'هاتف الشركة'),
    ('company_email', '', 'string', 'بريد الشركة'),
    ('company_address', '', 'string', 'عنوان الشركة'),
    ('currency', 'د.ك', 'string', 'العملة'),
    ('tax_rate', '0', 'number', 'نسبة الضريبة'),
    ('backup_enabled', 'true', 'boolean', 'تفعيل النسخ الاحتياطي التلقائي'),
    ('backup_interval', '24', 'number', 'فترة النسخ الاحتياطي (ساعات)');

-- ============================================
-- 40. NUMBER SEQUENCES (تسلسل الأرقام)
-- ============================================
CREATE TABLE number_sequences (
    id SERIAL PRIMARY KEY,
    sequence_type VARCHAR(50) UNIQUE NOT NULL,  -- 'contract', 'voucher', 'addendum'
    prefix VARCHAR(20),
    current_number INTEGER DEFAULT 0,
    format VARCHAR(50),  -- 'PREFIX-YEAR-NUMBER'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default sequences
INSERT INTO number_sequences (sequence_type, prefix, current_number, format) VALUES
    ('contract', 'CON', 0, 'CON-YEAR-NUMBER'),
    ('voucher_expense', 'EXP', 0, 'EXP-YEAR-NUMBER'),
    ('voucher_income', 'INC', 0, 'INC-YEAR-NUMBER'),
    ('addendum', 'ADD', 0, 'ADD-YEAR-NUMBER'),
    ('sub_contract', 'SUB', 0, 'SUB-YEAR-NUMBER');

-- ============================================
-- 41. FORM CATEGORIES (تصنيفات النماذج)
-- ============================================
CREATE TABLE form_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 42. FORM TEMPLATES (قوالب النماذج)
-- ============================================
CREATE TABLE form_templates (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES form_categories(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    template_type VARCHAR(50),  -- 'word', 'pdf', 'html'
    content TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_form_templates_category ON form_templates(category_id);

-- ============================================
-- 43. FORM FIELDS (حقول النماذج)
-- ============================================
CREATE TABLE form_fields (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES form_templates(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(200),
    field_type VARCHAR(50),  -- 'text', 'number', 'date', 'select'
    is_required BOOLEAN DEFAULT FALSE,
    default_value TEXT,
    options JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_form_fields_template ON form_fields(template_id);

-- ============================================
-- 44. FORM DOCUMENTS (وثائق النماذج)
-- ============================================
CREATE TABLE form_documents (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES form_templates(id) ON DELETE SET NULL,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
    document_number VARCHAR(50),
    file_path VARCHAR(500),
    generated_data JSONB DEFAULT '{}',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_form_docs_template ON form_documents(template_id);
CREATE INDEX idx_form_docs_contract ON form_documents(contract_id);

-- ============================================
-- 45. STAGE NOTES (ملاحظات المراحل)
-- ============================================
CREATE TABLE stage_notes (
    id SERIAL PRIMARY KEY,
    stage_id INTEGER REFERENCES contract_stages(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stage_notes_stage ON stage_notes(stage_id);

-- ============================================
-- 46. TRANSACTION MESSAGES (رسائل المعاملات)
-- ============================================
CREATE TABLE transaction_messages (
    id SERIAL PRIMARY KEY,
    transaction_type VARCHAR(50),
    transaction_id INTEGER,
    message TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tx_messages_tx ON transaction_messages(transaction_type, transaction_id);

-- ============================================
-- 47. TRANSACTION VISIBILITY (رؤية المعاملات)
-- ============================================
CREATE TABLE transaction_visibility (
    id SERIAL PRIMARY KEY,
    transaction_type VARCHAR(50),
    transaction_id INTEGER,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(transaction_type, transaction_id, user_id)
);

-- ============================================
-- 48. PROJECTS (المشاريع)
-- ============================================
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    location TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'جديد',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_projects_customer ON projects(customer_id);

-- ============================================
-- 49. QUOTATIONS (عروض الأسعار)
-- ============================================
CREATE TABLE quotations (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    quotation_number VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    total_amount DECIMAL(15,3) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'جديد',  -- 'جديد', 'مرسل', 'مقبول', 'مرفوض', 'منتهي'
    valid_until DATE,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quotations_customer ON quotations(customer_id);
CREATE INDEX idx_quotations_status ON quotations(status);

-- ============================================
-- 50. QUOTATION ITEMS (بنود عروض الأسعار)
-- ============================================
CREATE TABLE quotation_items (
    id SERIAL PRIMARY KEY,
    quotation_id INTEGER REFERENCES quotations(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    unit VARCHAR(50),
    quantity DECIMAL(15,3) DEFAULT 0,
    unit_price DECIMAL(15,3) DEFAULT 0,
    total_price DECIMAL(15,3) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quotation_items_quotation ON quotation_items(quotation_id);

-- ============================================
-- VIEWS (العروض)
-- ============================================

-- عرض ملخص العقود
CREATE VIEW v_contracts_summary AS
SELECT 
    c.id,
    c.contract_number,
    c.description,
    c.amount,
    c.status,
    c.start_date,
    c.end_date,
    cust.name AS customer_name,
    ct.name AS type_name,
    (SELECT COUNT(*) FROM payment_plan pp WHERE pp.contract_id = c.id) AS payment_count,
    (SELECT COALESCE(SUM(pp.amount), 0) FROM payment_plan pp WHERE pp.contract_id = c.id) AS total_payments,
    (SELECT COALESCE(SUM(pp.paid_amount), 0) FROM payment_plan pp WHERE pp.contract_id = c.id) AS total_paid,
    (SELECT COUNT(*) FROM sub_contracts sc WHERE sc.contract_id = c.id) AS subcontract_count
FROM contracts c
LEFT JOIN customers cust ON c.customer_id = cust.id
LEFT JOIN contract_types ct ON c.type_name = ct.name;

-- عرض ملخص الدفعات
CREATE VIEW v_payments_summary AS
SELECT 
    pp.id,
    pp.contract_id,
    c.contract_number,
    cust.name AS customer_name,
    pp.title,
    pp.amount,
    pp.paid_amount,
    pp.amount - pp.paid_amount AS remaining,
    pp.due_date,
    pp.status
FROM payment_plan pp
JOIN contracts c ON pp.contract_id = c.id
JOIN customers cust ON c.customer_id = cust.id;

-- عرض ملخص السندات
CREATE VIEW v_vouchers_summary AS
SELECT 
    v.id,
    v.voucher_number,
    v.voucher_type,
    v.amount,
    v.date,
    v.status,
    v.payment_method,
    c.contract_number,
    cust.name AS customer_name
FROM vouchers v
LEFT JOIN contracts c ON v.contract_id = c.id
LEFT JOIN customers cust ON c.customer_id = cust.id;

-- ============================================
-- FUNCTIONS (الدوال)
-- ============================================

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- تطبيق trigger على جميع الجداول التي لها updated_at
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subcontractors_updated_at BEFORE UPDATE ON subcontractors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vouchers_updated_at BEFORE UPDATE ON vouchers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INDEXES COMPOSITE (فهارس مركبة)
-- ============================================

CREATE INDEX idx_contracts_customer_status ON contracts(customer_id, status);
CREATE INDEX idx_payment_contract_status ON payment_plan(contract_id, status);
CREATE INDEX idx_vouchers_contract_type ON vouchers(contract_id, voucher_type);
CREATE INDEX idx_audit_table_date ON audit_log(table_name, created_at);

-- ============================================
-- نهاية ملف المخطط
-- ============================================
