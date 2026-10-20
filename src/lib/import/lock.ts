/**
 * قفل استيراد واحد منشغل بالذاكرة — لا عمليتَي فحص/تنفيذ متزامنتين
 * (قرار ويب موثق: الملفات تُقرأ بالكامل في الذاكرة فتُمنع التزامن).
 */

let busy = false;

export function acquireImportLock(): boolean {
  if (busy) return false;
  busy = true;
  return true;
}

export function releaseImportLock(): void {
  busy = false;
}

export const IMPORT_LOCK_MESSAGE = "توجد عملية استيراد جارية حاليًا · انتظر انتهائها ثم أعد المحاولة.";

/** الحد الأقصى لحجم ملف الاستيراد: 10MB */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_BYTES_LABEL = "10MB";
