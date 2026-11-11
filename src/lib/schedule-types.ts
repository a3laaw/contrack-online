/**
 * أنواع البرنامج الزمني (CPM) المشتركة بين الخادم والواجهة — docs/schedule-import-design.md.
 * ب1: معاينة الاستيراد + حالة ما بعد الاستيراد (أحدث دفعة + نوافذ الأقسام).
 */

export interface ScheduleMetaDTO {
  projectStart: string;
  projectFinish: string;
  dataDate: string;
  revision: string;
  totalPages: number;
}

export interface ScheduleWarningDTO {
  line: number;
  message: string;
}

/** قسم في المعاينة/العرض — النافذة الزمنية المشتقة من أنشطة work + قيمة القسم في BOQ */
export interface ScheduleDivisionDTO {
  code: string;
  name: string; // من BOQ إن وجد — وإلا اسم أول band حاوي
  activityCount: number; // أنشطة work المطابقة للقسم
  start: string; // min earlyStart — YYYY-MM-DD
  finish: string; // max earlyFinish — YYYY-MM-DD
  boqItems: number; // بنود BOQ في القسم
  boqTotal: number; // Σ مبالغ بنود القسم
}

/** معاينة الاستيراد (mode=preview) */
export interface ScheduleImportPreviewDTO {
  meta: ScheduleMetaDTO;
  counts: { total: number; work: number; summary: number; withDates: number };
  warnings: ScheduleWarningDTO[];
  divisions: ScheduleDivisionDTO[];
  latest: { id: number; fileName: string; revision: string; createdAt: string } | null;
}

/** نتيجة run */
export interface ScheduleImportRunDTO {
  importId: number;
  created: number;
  work: number;
  summary: number;
  filledDivisions: number;
  meta: ScheduleMetaDTO;
  warnings: ScheduleWarningDTO[];
}

/** حالة البرنامج الزمني للعقد (GET) */
export interface ScheduleStateDTO {
  latest: {
    id: number;
    fileName: string;
    revision: string;
    dataDate: string;
    projectStart: string;
    projectFinish: string;
    activityCount: number;
    workCount: number;
    warnings: string[];
    createdAt: string;
  } | null;
  divisions: ScheduleDivisionDTO[];
  kindCounts: Record<string, number>;
}
