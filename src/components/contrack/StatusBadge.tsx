"use client";

import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DONE_STATUSES, statusBadgeClass } from "@/lib/format";

/**
 * الشارة الموحدة للحالات (قيد 4 من التوجيه):
 * لون كل حالة يأتي من جدول الحالات فقط (رمادي/أزرق/كهرماني/أحمر) — الأخضر للأساسي فقط.
 * الحالات المكتملة تُعرض بعلامة ✓ كما في الجدول المعتمد.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  /** نص مختلف عن الحالة نفسها (اختياري) */
  label?: string;
  className?: string;
}) {
  const done = DONE_STATUSES.has(status);
  return (
    <Badge className={cn("border-0 gap-0.5 text-xs", statusBadgeClass(status), className)}>
      {done && <Check className="size-3" aria-hidden />}
      {label ?? status}
    </Badge>
  );
}
