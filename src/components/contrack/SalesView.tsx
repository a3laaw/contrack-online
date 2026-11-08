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

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const SECTION_META: { key: SalesSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "quotes", label: "عروض الأسعار", icon: FileText },
  { key: "pos", label: "نقاط البيع", icon: Calculator },
];

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

      {/* تبويبات الأقسام (مرآة الشل للتنقل السريع داخل الشاشة) */}
      <Tabs value={section} onValueChange={(v) => onSectionChange(v as SalesSection)}>
        <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
          {SECTION_META.map((s) => (
            <TabsTrigger key={s.key} value={s.key} className="gap-1.5">
              <s.icon className="size-3.5" />
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
