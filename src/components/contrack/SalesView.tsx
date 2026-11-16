"use client";

/**
 * SalesView.tsx — شاشة موديول «المبيعات» (docs/sales-design.md §6):
 * قرار المالك: عروض الأسعار انتقلت إلى وحدة «العقود وعروض الأسعار» المستقلة (qc) —
 * فبقى لهذا الموديول نقاط البيع السريع (بيع بمعاملة واحدة: فاتورة وسند قبض وإذن صرف مخزني آلي).
 * الفواتير الناتجة تفتح بصلاحية screen_invoices القائمة كما اليوم — لا شاشة فواتير جديدة.
 * الموديول يظهر حصرًا للشركات التي فعّلته (navModules) — والإيقاف يرجع 403 برسالة عربية.
 */

import * as React from "react";

import { PosSection } from "./sales/PosSection";

export interface SalesViewProps {
  onAuthError: () => void;
  /** فتح قائمة عروض الأسعار في وحدة «العقود وعروض الأسعار» — رابط النقطة في الفراغ */
  onOpenQuotes: () => void;
}

// ==================== الشاشة الرئيسية ====================

export function SalesView({ onAuthError, onOpenQuotes }: SalesViewProps) {
  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div>
        <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">المبيعات</h1>
        <p className="text-xs text-muted-foreground">
          نقاط البيع السريع بفاتورة وسند قبض وإذن صرف مخزني آلي بمعاملة واحدة · عروض الأسعار في وحدة العقود وعروض الأسعار
        </p>
      </div>

      {/* شريط الأقسام انتقل للشل ModuleTabsBar (الهاتف فقط) — docs/mobile-tabs-design.md */}

      {/* نقاط البيع */}
      <PosSection onAuthError={onAuthError} onOpenQuotes={onOpenQuotes} />
    </div>
  );
}
