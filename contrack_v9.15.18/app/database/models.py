# -*- coding: utf-8 -*-
"""نماذج البيانات (Dataclasses) — طبقة تمثيل فقط بدون منطق أعمال."""
from dataclasses import dataclass, field


@dataclass
class Customer:
    id: int | None = None
    customer_code: str = ""
    name: str = ""
    phone: str = ""
    address: str = ""
    address_governorate: str = ""
    address_area: str = ""
    address_block: str = ""
    address_plot: str = ""
    email: str = ""
    notes: str = ""
    folder_path: str = ""
    created_at: str = ""
    created_by: str = ""    # المستخدم الذي أضاف العميل
    updated_at: str = ""    # آخر تحديث للبيانات
    updated_by: str = ""    # من قام بآخر تحديث


@dataclass
class Contract:
    id: int | None = None
    contract_number: str = ""
    contract_name: str = ""
    customer_id: int = 0
    contract_date: str = ""
    description: str = ""
    amount: float = 0.0
    contract_type: str = ""      # نوع العقد من القائمة المعتمدة بالإعدادات
    notes: str = ""
    created_at: str = ""
    # عقود الإشراف الهندسي — تبدأ من تاريخ تعهد الإشراف (بلدية الكويت)
    sup_start_date: str = ""     # تاريخ تعهد الإشراف (فارغ = عقد عادي)
    sup_months: int = 0          # مدة العقد الأساسية بالأشهر
    sup_monthly: float = 0.0     # قيمة الشهر الواحد
    sup_discount: float = 0.0     # خصم من قيمة الإشراف الأساسية
    sup_waived_months: float = 0.0  # أشهر تمديد ملغاة (تقبل كسورًا: 1.5)
    # التسعير بالكمية: الكمية × سعر الوحدة = الإجمالي قبل الخصم
    # قيمة العقد `amount` هي دائمًا القيمة الفعلية بعد الخصم
    qty: float = 1.0             # الكمية (واجهات · أدوار · أمتار…)
    unit_price: float = 0.0      # سعر الوحدة الواحدة
    created_by: str = ""         # المستخدم الذي أضاف العقد
    updated_at: str = ""         # آخر تحديث
    updated_by: str = ""         # من قام بآخر تحديث
    # حقول محسوبة (لا تُخزَّن)
    customer_name: str = field(default="", compare=False)
    total_invoiced: float = field(default=0.0, compare=False)
    remaining: float = field(default=0.0, compare=False)


@dataclass
class Invoice:
    id: int | None = None
    invoice_number: str = ""
    customer_id: int = 0
    contract_id: int = 0
    invoice_date: str = ""
    description: str = ""
    amount: float = 0.0
    notes: str = ""
    created_at: str = ""
    # حقول محسوبة
    customer_name: str = field(default="", compare=False)
    contract_number: str = field(default="", compare=False)


@dataclass
class Settings:
    company_name: str = ""
    company_address: str = ""
    company_phone: str = ""
    company_email: str = ""
    logo_path: str = ""
    header_title: str = "نظام إدارة العقود والمحاسبة"
    currency: str = "د.ك"
    invoice_primary: str = "#1e3a5f"   # اللون الرئيسي للفاتورة (الترويسة)
    invoice_accent: str = "#2e86ab"    # اللون الثانوي (الإجمالي والعناوين)
    auto_backup_enabled: bool = True   # تفعيل النسخ الاحتياطي التلقائي
    auto_backup_interval: int = 24     # كل كم ساعة (1-168)
    auto_backup_folder: str = ""       # مجلد النسخ (فارغ = data/backups)
    last_backup_at: str = ""           # آخر نسخة تلقائية
    ui_theme: str = "light"            # ثيم واحد معتمد (أُلغي الليلي)
    app_name: str = "ConTrack"         # اسم النظام (يضبطه المطور)
    max_users: int = 0                 # حد عدد المستخدمين (0 = بلا حد)
    header_image: str = ""             # صورة هيدر المطبوعات (اختياري)
    footer_image: str = ""             # صورة فوتر المطبوعات (اختياري)
    print_economy: bool = False        # وضع طباعة اقتصادي (أبيض وأسود)
    signature_image: str = ""          # صورة توقيع المحاسب على السندات
    stamp_image: str = ""              # ختم الشركة على الفواتير والسندات
    # موضع الختم على المطبوعات بالملليمتر من يسار/أسفل الصفحة
    # القيمة 0 تعني استخدام الموضع الافتراضي القديم لكل مستند
    stamp_x_mm: float = 0.0
    stamp_y_mm: float = 0.0
    stamp_size_mm: float = 0.0
    manager_phone: str = ""            # واتساب المدير — لإرسال ملخصات المهام
    license_key: str = ""
    # قوالب رسائل واتساب للمهام (فارغة = القالب الافتراضي المدمج)
    task_wa_customer: str = ""
    task_wa_manager: str = ""
    wa_appt: str = ""
    wa_reminder: str = ""
    wa_payment: str = ""              # رمز التفعيل (الترخيص) على الجهاز
    # التقرير المالي: رسوم التحويل البنكي والرصيد الافتتاحي
    bank_fee_amount: float = 0.150     # رسوم سند القبض بتحويل بنكي
    bank_fee_method: str = "تحويل بنكي"  # الطريقة الخاضعة للرسوم
    opening_balance: float = 0.0       # رصيد أول المدة الإجمالي (توافق قديم)
    opening_balance_bank: float = 0.0  # رصيد البنك أول المدة
    opening_balance_cash: float = 0.0  # رصيد الصندوق أول المدة
    opening_balance_date: str = ""     # تاريخ الرصيد الافتتاحي
    cashflow_enabled: bool = True      # مديول التقرير المالي (مفتاح المطور)
    bank_fee_enabled: bool = True      # احتساب رسوم التحويل (تابع للمديول)
    # بادئات البيانات التلقائية (فارغة = النص الحالي بلا تغيير)
    desc_prefix_receipt: str = ""
    desc_prefix_supervision: str = ""
    desc_prefix_transfer: str = ""
    desc_prefix_custody: str = ""
    desc_prefix_stage_note: str = ""
    cash_start_date: str = ""      # V5.9: بداية الاحتساب النقدي
