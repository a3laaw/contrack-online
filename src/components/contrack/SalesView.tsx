"use client";

/**
 * SalesView.tsx — شاشة موديول «المبيعات» (docs/sales-design.md §6):
 * قسمان يملكهما تبويب الشل «المبيعات» (nav-structure → section):
 *   عروض الأسعار (بيت مستقل + تحويل إلى فاتورة) · نقاط البيع (بيع سريع بمعاملة واحدة)
 * الفواتير الناتجة تفتح بصلاحية screen_invoices القائمة كما اليوم — لا شاشة فواتير جديدة.
 * الموديول يظهر حصرًا للشركات التي فعّلته (navModules) — والإيقاف يرجع 403 برسالة عربية.
 */

import * as React from "react";
import { Calculator, FileText } from "lucide-react";

import type { User } from "./contrack-types";
import { QuotesSection } from "./sales/QuotesSection";
import { PosSection } from "./sales/PosSection";

// ==================== أنواع مشتركة ====================

export type SalesSection = "quotes" | "pos";

export interface SalesViewProps {
  user: User;
  onAuthError: () => void;
  section: SalesSection;
  onSectionChange: (s: SalesSection) => void;
}

// SECTION_META (مرآة الأقسام) أُزيلت — شريط التابات انتقل للشل ModuleTabsBar (docs/mobile-tabs-design.md)

// ==================== الشاشة الرئيسية ====================

export function SalesView({ user, onAuthError, section, onSectionChange }: SalesViewProps) {
  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div>
        <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">المبيعات</h1>
        <p className="text-xs text-muted-foreground">
          عروض الأسعار وتحويلها لفاتورة بيع · نقاط البيع السريع بفاتورة وسند قبض وإذن صرف مخزني آلي بمعاملة واحدة
        </p>
      </div>

      {/* شريط الأقسام انتقل للشل ModuleTabsBar (الهاتف فقط) — docs/mobile-tabs-design.md */}

      {/* محتوى القسم */}
      {section === "quotes" && (
        <QuotesSection
          user={user}
          onAuthError={onAuthError}
          onOpenPos={() => onSectionChange("pos")}
        />
      )}
      {section === "pos" && (
        <PosSection onAuthError={onAuthError} onOpenQuotes={() => onSectionChange("quotes")} />
      )}
    </div>
  );
}
