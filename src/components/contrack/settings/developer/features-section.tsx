"use client";

/**
 * تاب أدوات المطور «المزايا» — الحي القائم من المراحل السابقة (بلا تغيير
 * في السلوك): مزايا النظام (ما يظهر لهذا العميل) عبر /api/feature-flags
 * مع اعتماديات requires وeffective — نصوص المكتبي الحرفية (settings.py:1039-1098).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPut } from "../../api";
import { errMessage } from "../../contrack-types";

export interface FeatureFlagDTO {
  key: string;
  name: string;
  desc: string;
  group: string;
  requires: string[];
  enabled: boolean;
  effective: boolean;
}

export function FeaturesSection({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const flagsQuery = useQuery<{ flags: FeatureFlagDTO[] }>({
    queryKey: ["feature-flags"],
    queryFn: () => apiGet<{ flags: FeatureFlagDTO[] }>("/api/feature-flags"),
    retry: false,
  });
  const flags: FeatureFlagDTO[] = flagsQuery.data?.flags ?? [];
  const nameByKey = React.useMemo(() => new Map(flags.map((f) => [f.key, f.name])), [flags]);

  // تجميع حسب المجموعة مع حفظ ترتيبها
  const groups = React.useMemo(() => {
    const map = new Map<string, FeatureFlagDTO[]>();
    for (const f of flags) {
      const g = map.get(f.group) || [];
      g.push(f);
      map.set(f.group, g);
    }
    return [...map.entries()];
  }, [flags]);

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiPut("/api/feature-flags", { key, enabled }),
    onSuccess: () => {
      toast({ title: "تم الحفظ" });
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errMessage(e) });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">مزايا النظام (ما يظهر لهذا العميل)</CardTitle>
        <p className="text-xs text-muted-foreground">اختر المزايا الظاهرة للعميل. البيانات لا تُحذف.</p>
      </CardHeader>
      <CardContent>
        {flagsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : flagsQuery.isError ? (
          <div className="py-6 text-center text-sm text-destructive">
            تعذر تحميل المزايا — {errMessage(flagsQuery.error)}
            <div className="mt-2">
              <Button size="sm" variant="outline" className="h-8" onClick={() => flagsQuery.refetch()}>إعادة المحاولة</Button>
            </div>
          </div>
        ) : flags.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا مزايا معرفة.</p>
        ) : (
          <TooltipProvider delayDuration={200}>
            <div className="max-h-[28rem] space-y-4 overflow-y-auto rounded-md border p-3">
              {groups.map(([group, items]) => (
                <div key={group} className="space-y-1.5">
                  <h3 className="text-sm font-extrabold">{group}</h3>
                  {items.map((f) => {
                    const gated = f.enabled && !f.effective;
                    const requiresNames = (f.requires || [])
                      .map((k) => nameByKey.get(k) || k)
                      .join(" · ");
                    return (
                      <div key={f.key} className="flex items-start justify-between gap-3 rounded-lg border p-2.5">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{f.name}</div>
                          {f.desc && <div className="text-xs text-muted-foreground">{f.desc}</div>}
                          {gated && requiresNames && (
                            <div className="mt-0.5 text-xs font-bold text-status-warn">
                              يعتمد على: {requiresNames} (معطل)
                            </div>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex shrink-0 pt-0.5">
                              <Switch
                                checked={f.enabled}
                                disabled={gated}
                                onCheckedChange={(v) => toggleMutation.mutate({ key: f.key, enabled: v })}
                                aria-label={`تبديل ${f.name}`}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {gated
                              ? `معطّل لاعتماده على مفتاح أب معطل${requiresNames ? `: ${requiresNames}` : ""}`
                              : requiresNames
                                ? `يحتاج: ${requiresNames}`
                                : f.key}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
