"use client";

/**
 * QuotationsContractsView.tsx — وحدة «العقود وعروض الأسعار» المستقلة (قرار المالك):
 * موديول واحد يجمع دورة العرض حتى العقد — عروض الأسعار (قائمة كاملة بحالاتها،
 * والمقبول يتحول إلى عقد من زر واحد يفتح معالج العقد معبأً ببيانات العرض ويُوسم
 * العرض آليًا «تحويل إلى عقد»)، وتبويب العقود يعرض القائمة القائمة (view contracts)
 * مع «أين وصلنا» و«مجموعات العقود» — كلها بنود هذه الوحدة في الشل.
 * التنقل بين القسمين عبر الشل (ModuleTabsBar في الهاتف) — لا شريط تابات داخلي.
 * ر3 — إصدار عرض من فرصة بيع: حمولة الفرصة تمر عبر الشل إلى معالج العرض نفسه (د4).
 */

import * as React from "react";

import type { OpportunityQuotePreset } from "@/lib/opportunities-core";
import type { QuotationRow } from "@/lib/quotes-core";
import type { User } from "./contrack-types";
import { QuotesSection } from "./sales/QuotesSection";

interface QuotationsContractsViewProps {
  user: User;
  onAuthError: () => void;
  /** تحويل عرض مقبول إلى عقد — يفتح معالج العقد معبأً في تبويب العقود (ConTrackApp) */
  onConvertToContract: (q: QuotationRow) => void;
  /** ر3 — تعبئة معالج العرض من فرصة بيع (إصدار عرض من الفرصة — د4) */
  presetFromOpportunity?: OpportunityQuotePreset | null;
  /** استهلاك الحمولة مرة واحدة كي لا يعاد فتح المعالج في الرسم التالي */
  onConsumeOpportunityPreset?: () => void;
}

export function QuotationsContractsView({
  user,
  onAuthError,
  onConvertToContract,
  presetFromOpportunity,
  onConsumeOpportunityPreset,
}: QuotationsContractsViewProps) {
  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div>
        <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">العقود وعروض الأسعار</h1>
        <p className="text-xs text-muted-foreground">
          عروض الأسعار من الإنشاء حتى القبول ثم التحويل إلى عقد بضغطة · العقود بمعالج الإنشاء الكامل مع الدفعة الأولى عند التعاقد
        </p>
      </div>

      {/* قسم العروض — نافذة الوحدة الأولى */}
      <QuotesSection
        user={user}
        onAuthError={onAuthError}
        onConvertToContract={onConvertToContract}
        presetFromOpportunity={presetFromOpportunity}
        onConsumeOpportunityPreset={onConsumeOpportunityPreset}
      />
    </div>
  );
}
