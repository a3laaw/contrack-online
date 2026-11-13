"use client";

/**
 * Task 85 — SaaS: مبدّل الشركات للشريط العلوي (مدير/مطور).
 * يظهر فقط عند وجود أكثر من شركة فعّالة. التبديل يعيد إصدار التوكن
 * ثم تحديثًا كاملًا للصفحة (سياق الخادم يتبدل مع الكوكي الجديد).
 * الجلسة 15 — التحول الطرازي العلوي: مُوحّد على Dropdown النظام الوحيد
 * (docs/navigation-map.md §5) بدل Radix DropdownMenu المنفرد.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronsUpDown } from "lucide-react";

import { Dropdown } from "./dropdown";
import { errMessage } from "./contrack-types";
import { apiGet, apiPost, setStoredToken } from "./api";

interface CompanyRow {
  id: number;
  name: string;
  shortName: string;
  isActive: boolean;
  usersCount: number;
}

interface CompaniesResponse {
  companies: CompanyRow[];
  currentCompanyId: number;
  canSwitch: boolean;
}

export function CompanySwitcher({ user, onAuthError }: { user: { companyId?: number; companyName?: string }; onAuthError?: () => void }) {
  const [switching, setSwitching] = React.useState(false);

  const q = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiGet<CompaniesResponse>("/api/companies"),
    staleTime: 60_000,
    retry: false,
  });

  const data = q.data;
  const others = (data?.companies ?? []).filter((c) => c.isActive && c.id !== data?.currentCompanyId);
  const show = !!data?.canSwitch && others.length > 0;
  if (!show) return null;

  const current = data.companies.find((c) => c.id === data.currentCompanyId);
  const currentName = current?.name || user.companyName || "";

  const switchTo = async (id: number) => {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await apiPost<{ token: string }>("/api/companies/switch", { companyId: id });
      setStoredToken(res.token);
      window.location.reload();
    } catch (e) {
      setSwitching(false);
      if ((e as { status?: number }).status === 401) onAuthError?.();
      alert(errMessage(e));
    }
  };

  return (
    <Dropdown
      align="start"
      triggerLabel="تبديل الشركة"
      triggerTitle="تبديل الشركة"
      disabled={switching}
      trigger={
        <>
          <Building2 className="size-4 text-muted-foreground" aria-hidden />
          <span className="hidden max-w-36 truncate md:inline">{currentName}</span>
          <ChevronsUpDown className="size-3 text-muted-foreground" aria-hidden />
        </>
      }
      triggerClassName="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm transition-colors hover:bg-secondary disabled:opacity-60"
      items={[
        // الشركة الحالية — بند إعلامي بمُشير ✓ (نقره يغلق دون فعل)
        { key: "current", label: currentName, checked: true },
        ...others.map((c) => ({
          key: `co-${c.id}`,
          label: c.name,
          icon: Building2,
          onSelect: () => void switchTo(c.id),
        })),
      ]}
    />
  );
}
