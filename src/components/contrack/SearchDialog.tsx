"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  HandCoins,
  HardHat,
  Receipt,
  ScrollText,
  Search,
  Users as UsersIcon,
} from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiGet } from "./api";
import type { SearchGroup, SearchItem } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: "dashboard" | "customers" | "contracts" | "vouchers" | "subcontractors" | "reports" | "statement" | "followup") => void;
  onOpenContract: (contractId: number) => void;
  /** عميل ⇒ فتح تفاصيله داخل شاشة العملاء */
  onOpenCustomerDetail: (customerId: number) => void;
  /** سند ⇒ شاشة السندات مع فلتر البحث */
  onOpenVouchersWithQ: (q: string) => void;
}

const GROUP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  customer: UsersIcon,
  contract: FileText,
  voucher: Receipt,
  subcontractor: HardHat,
  invoice: ScrollText,
  claim: HandCoins,
};

function itemTarget(
  type: string,
  item: SearchItem,
  q: string,
  act: Pick<SearchDialogProps, "onNavigate" | "onOpenContract" | "onOpenCustomerDetail" | "onOpenVouchersWithQ">
): void {
  switch (type) {
    case "customer":
      act.onOpenCustomerDetail(item.id);
      break;
    case "contract":
      act.onOpenContract(item.contractId ?? item.id);
      break;
    case "voucher":
      act.onOpenVouchersWithQ(q);
      break;
    case "subcontractor":
      act.onNavigate("subcontractors");
      break;
    case "invoice":
      if (item.contractId != null) act.onOpenContract(item.contractId);
      else act.onOpenVouchersWithQ(item.title);
      break;
    case "claim":
      if (item.contractId != null) act.onOpenContract(item.contractId);
      break;
    default:
      act.onNavigate("dashboard");
  }
}

export function SearchDialog(props: SearchDialogProps) {
  const { open, onOpenChange } = props;

  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");

  // بحث فوري مع debounce 250ms
  React.useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // إغلاق النافذة يفرغ البحث
  React.useEffect(() => {
    if (!open) {
      setQ("");
      setDq("");
    }
  }, [open]);

  // اختصار Ctrl+K / ⌘K عالمي
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  const searchQuery = useQuery<{ groups: SearchGroup[] }>({
    queryKey: ["search", dq],
    queryFn: () => apiGet<{ groups: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(dq)}&limit=8`),
    enabled: open && dq.length >= 2,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    const e = searchQuery.error;
    if (e instanceof ApiError && e.status === 401) {
      // الجلسة تنتهي عبر آلية onAuthError المركزية في ConTrackApp — لا شيء هنا
    }
  }, [searchQuery.error]);

  const groups: SearchGroup[] = searchQuery.data?.groups ?? [];
  const firstItem = groups.find((g) => g.items.length > 0);
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && firstItem) {
      itemTarget(firstItem.type, firstItem.items[0], dq, props);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-h-[80vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg [&>button]:hidden">
        <DialogHeader className="border-b px-4 pb-3 pt-4 text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="size-4 text-primary" />
            بحث شامل
          </DialogTitle>
          <DialogDescription className="text-xs">
            عملاء، عقود، سندات، مقاولون، فواتير، مطالبات — حرفان على الأقل
          </DialogDescription>
        </DialogHeader>

        <div className="p-3">
          <Input
            autoFocus
            className="h-10"
            placeholder="ابحث… (مثال: CON-0001 أو اسم عميل أو RV-0012)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-3 pb-4">
          {dq.length < 2 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">اكتب حرفين على الأقل لبدء البحث</p>
          ) : searchQuery.isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : searchQuery.isError ? (
            <p className="py-8 text-center text-xs text-destructive">فشل البحث — {errMessage(searchQuery.error)}</p>
          ) : total === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">لا نتائج مطابقة لـ«{dq}»</p>
          ) : (
            <div className="space-y-3 py-1">
              {groups
                .filter((g) => g.items.length > 0)
                .map((g) => {
                  const Icon = GROUP_ICON[g.type] ?? Search;
                  return (
                    <div key={g.type}>
                      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
                        <Icon className="size-3.5" />
                        {g.label}
                        <span className="text-[10px] font-normal">({g.items.length})</span>
                      </div>
                      <div className="space-y-1">
                        {g.items.map((item) => (
                          <button
                            key={`${g.type}-${item.id}`}
                            type="button"
                            onClick={() => {
                              itemTarget(g.type, item, dq, props);
                              onOpenChange(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 text-start transition-colors hover:border-primary/40 hover:bg-accent/50"
                          >
                            <Icon className="size-4 shrink-0 text-primary/70" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium" dir="auto">
                                {item.title}
                              </div>
                              {item.subtitle && (
                                <div className="truncate text-xs text-muted-foreground" dir="auto">
                                  {item.subtitle}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2 text-[10px] text-muted-foreground">
          <span>Enter يفتح أول نتيجة · Escape للإغلاق</span>
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">Ctrl</kbd>+
            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">K</kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
