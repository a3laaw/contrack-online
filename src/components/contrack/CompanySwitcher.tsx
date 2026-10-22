"use client";

/**
 * Task 85 — SaaS: مبدّل الشركات للشريط العلوي (مدير/مطور).
 * يظهر فقط عند وجود أكثر من شركة فعّالة. التبديل يعيد إصدار التوكن
 * ثم تحديثًا كاملًا للصفحة (سياق الخادم يتبدل مع الكوكي الجديد).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent disabled:opacity-60"
          disabled={switching}
          aria-label="تبديل الشركة"
          title="تبديل الشركة"
        >
          <Building2 className="size-4 text-muted-foreground" />
          <span className="hidden max-w-36 truncate md:inline">{current?.name || user.companyName || ""}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">الشركة الحالية</DropdownMenuLabel>
        <DropdownMenuItem className="pointer-events-none font-medium">
          <Check className="size-4" />
          {current?.name || user.companyName}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">التبديل إلى</DropdownMenuLabel>
        {others.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => void switchTo(c.id)} disabled={switching}>
            <Building2 className="size-4 text-muted-foreground" />
            <span className="truncate">{c.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
