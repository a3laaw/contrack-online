// ============================================================
// invoice-state-core.ts — نواة ز2 النقية (بلا I/O)
// ------------------------------------------------------------
// docs/boq-state-timeline-design.md §3 — آلة اعتماد مستخلص العميل:
//   مسودة ──تقديم──▶ مقدم ──اعتماد──▶ معتمد ──(السداد القائم)──▶ مدفوع ماليًا
//     │               │                │
//     └───────────────┴────────────────┴──▶ ملغي (status=void القائم — بسبب)
//  • الافتراضي «معتمد» يحفظ كل المسارات القائمة حرفيًا (الإنشاء ينشر قيده فورًا
//    كما اليوم) — والمسودة خيار صريح جديد بلا قيد حتى الاعتماد.
//  • «الاعتماد لحظة الحقيقة»: تعديل الأسطر/الحذف مسودة حصرًا — المعتمد لا يُعدَّل
//    إطلاقًا (السقوط)، وأي تصحيح بمستخلص لاحق.
//  • الروابط المالية (سداد FIFO · إفراج محتجزات) على المعتمد حصرًا.
//  • حالة السداد المالية (unpaid|partial|paid|void) بُعد متعامد يبقى كما هو.
// مرآة حرفية لآلة SubCertificate (phase-a-core SUBCERT_* — نفس الأسماء العربية).
// كل الدوال نقية قابلة للاختبار المباشر (نمط *-core.ts الموحد) — بلا enum
// (قواعد المشروع: String + مفردات مقفلة).
// ============================================================

/** ولاية «مسودة» — قيد الإعداد بلا قيد ولا لقطات مجمدة ولا استهلاك متاح */
export const INV_STATE_DRAFT = "مسودة";

/** ولاية «مقدم» — مقفلة التحرير بانتظار الاعتماد (لحظة الحقيقة) */
export const INV_STATE_SUBMITTED = "مقدم";

/** ولاية «معتمد» — القيد منشور واللقطات مجمدة والروابط المالية متاحة (الافتراضي) */
export const INV_STATE_APPROVED = "معتمد";

/** المفردات المقفلة لآلة ز2 — أي قيمة أخرى رفض صريح (بلا enum — قواعد المشروع) */
export const INVOICE_STATES = [INV_STATE_DRAFT, INV_STATE_SUBMITTED, INV_STATE_APPROVED] as const;

/** فحص المفردات المقفلة — يُستعمل في المسارات لرفض أي قيمة دخيلة على state */
export function isInvoiceState(state: string): boolean {
  return (INVOICE_STATES as readonly string[]).includes(state);
}

/** التعديل: مسودة حصرًا — المقدم مقفل والمعتمد «ساق» لا يُعدَّل إطلاقًا (السقوط §3) */
export function canInvoiceEdit(state: string): boolean {
  return state === INV_STATE_DRAFT;
}

/** التقديم: مسودة ──▶ مقدم — الانتقال الأول الوحيد من المسودة */
export function canInvoiceSubmit(state: string): boolean {
  return state === INV_STATE_DRAFT;
}

/** الاعتماد: مقدم ──▶ معتمد — لحظة الحقيقة: نشر القيد وتجميد اللقطات (§3) */
export function canInvoiceApprove(state: string): boolean {
  return state === INV_STATE_SUBMITTED;
}

/** روابط السداد وتخصيص FIFO: معتمد حصرًا (§3 — «لا روابط سداد إلا على state=معتمد») */
export function canInvoiceLinkPayments(state: string): boolean {
  return state === INV_STATE_APPROVED;
}

/** الإفراج عن المحتجزات: معتمد حصرًا — المحتجز لقطة اعتماد لا لقطة إعداد */
export function canInvoiceReleaseRetention(state: string): boolean {
  return state === INV_STATE_APPROVED;
}

/** الإلغاء من الثلاثة ولايات — المسودة/المقدم بلا قيد يُلغيان بتأشيرة فحسب،
 *  والمعتمد بقيد عكسي (المسار القائم يفحص entryId) */
export function canInvoiceVoidState(state: string): boolean {
  return isInvoiceState(state);
}

/** رسالة الرفض الموحدة لمحاولة تعديل غير-مسودة — تمييز المقدم المقفل عن المعتمد الساق */
export function invoiceEditBlockedReason(state: string): string {
  if (state === INV_STATE_SUBMITTED) {
    return "المستخلص المقدم مقفل — يمكن إلغاؤه أو اعتماده فقط، والتعديل من المسودة حصرًا";
  }
  return "المستخلص المعتمد لا يُعدَّل — «الاعتماد لحظة الحقيقة»: أي تصحيح بمستخلص لاحق (boq-state-timeline-design §3)";
}
