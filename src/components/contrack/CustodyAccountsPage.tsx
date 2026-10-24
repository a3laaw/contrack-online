"use client";

/**
 * صفحة «إدارة حسابات العهدة» — تحويل نافذة الإدارة في CustodyView إلى صفحة كاملة صغيرة.
 * نفس الحقول (حساب أب جديد/اسم الفرعي + مفاتيح التفعيل) ونفس الـmutations
 * (POST /api/custody/accounts وPATCH /api/custody/accounts) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة العُهد عبر حالة داخلية.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch, apiPost } from "./api";
import type { CustodyAccountItem, CustodyAccountsResponse } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

interface CustodyAccountsPageProps {
  onAuthError: () => void;
  /** رجوع لشاشة العُهد */
  onCancel: () => void;
}

export function CustodyAccountsPage({ onAuthError, onCancel }: CustodyAccountsPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس مفتاح الاستعلام في شاشة العُهد — بيانات مخزّنة تُعرض فورًا
  const accountsQuery = useQuery<CustodyAccountsResponse>({
    queryKey: ["custody-accounts"],
    queryFn: () => apiGet<CustodyAccountsResponse>("/api/custody/accounts"),
  });

  // تسطيح شجرة الحسابات (items + children) — كما في الشاشة
  const flatAccounts: CustodyAccountItem[] = [];
  const walk = (list: CustodyAccountItem[]) => {
    for (const a of list) {
      flatAccounts.push(a);
      if (a.children?.length) walk(a.children);
    }
  };
  walk(accountsQuery.data?.items ?? []);

  // ===== الحقول (نفس حالات النافذة حرفيًا) =====
  const [newParentName, setNewParentName] = React.useState("");
  const [childInputs, setChildInputs] = React.useState<Record<number, string>>({});
  const [addChildFor, setAddChildFor] = React.useState<number | null>(null);

  // ===== نفس الـmutations حرفيًا =====
  const accountCreateMutation = useMutation({
    mutationFn: (vars: { name: string; parentId?: number }) =>
      apiPost<{ item?: CustodyAccountItem }>("/api/custody/accounts", {
        name: vars.name,
        parentId: vars.parentId,
      }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
      qc.invalidateQueries({ queryKey: ["custody-overview"] });
      setNewParentName("");
      setChildInputs((prev) => ({ ...prev, [vars.parentId ?? 0]: "" }));
      setAddChildFor(null);
      toast({ title: "أُنشئ حساب العهدة", description: vars.name });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء الحساب", description: errMessage(e) });
    },
  });

  const accountToggleMutation = useMutation({
    mutationFn: (vars: { id: number; isActive: boolean }) =>
      apiPatch("/api/custody/accounts", { id: vars.id, isActive: vars.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
      qc.invalidateQueries({ queryKey: ["custody-overview"] });
      toast({ title: "حُدّثت حالة الحساب" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تحديث الحساب", description: errMessage(e) });
      qc.invalidateQueries({ queryKey: ["custody-accounts"] });
    },
  });

  const submitAddParent = () => {
    const name = newParentName.trim();
    if (!name) {
      toast({ variant: "destructive", title: "أدخل اسم الحساب" });
      return;
    }
    accountCreateMutation.mutate({ name });
  };

  const submitAddChild = (parentId: number) => {
    const name = (childInputs[parentId] ?? "").trim();
    if (!name) {
      toast({ variant: "destructive", title: "أدخل اسم الحساب الفرعي" });
      return;
    }
    accountCreateMutation.mutate({ name, parentId });
  };

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>المحاسبة</span>
          <span aria-hidden="true">←</span>
          <span>العُهد</span>
        </nav>
        <h1 className="mt-1 text-xl font-bold">إدارة حسابات العهدة</h1>
        <p className="text-sm text-muted-foreground">
          العهدة حساب في شجرة المصاريف بنوع advance — أضف حسابًا أب أو فرعيًا أو عطّل حسابًا.
        </p>
      </header>

      {/* ===== المحتوى ===== */}
      <Card>
        <CardContent className="space-y-3 p-4 md:p-6">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ca-parent">حساب عهدة جديد (أب)</Label>
              <Input
                id="ca-parent"
                className="h-9"
                placeholder="مثال: عهدة المشتريات"
                value={newParentName}
                onChange={(e) => setNewParentName(e.target.value)}
              />
            </div>
            <Button
              className="h-9 gap-1"
              disabled={accountCreateMutation.isPending}
              onClick={submitAddParent}
            >
              <Plus className="size-4" />
              إضافة
            </Button>
          </div>

          {accountsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-2">
              {(accountsQuery.data?.items ?? []).map((parent) => {
                const children = parent.children ?? flatAccounts.filter((a) => a.parentId === parent.id);
                return (
                  <div key={parent.id} className="space-y-1.5 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{parent.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          رصيد {formatKWD(parent.balance)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={parent.isActive}
                          disabled={accountToggleMutation.isPending}
                          onCheckedChange={(checked) =>
                            accountToggleMutation.mutate({ id: parent.id, isActive: checked })
                          }
                          aria-label="تفعيل/تعطيل الحساب"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => setAddChildFor(addChildFor === parent.id ? null : parent.id)}
                        >
                          <Plus className="size-3.5" />
                          فرعي
                        </Button>
                      </div>
                    </div>
                    {addChildFor === parent.id && (
                      <div className="flex items-end gap-2 rounded-md bg-muted/40 p-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-[11px]">اسم الحساب الفرعي</Label>
                          <Input
                            className="h-8"
                            value={childInputs[parent.id] ?? ""}
                            onChange={(e) =>
                              setChildInputs((prev) => ({ ...prev, [parent.id]: e.target.value }))
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={accountCreateMutation.isPending}
                          onClick={() => submitAddChild(parent.id)}
                        >
                          حفظ
                        </Button>
                      </div>
                    )}
                    {children.length > 0 && (
                      <div className="space-y-1 border-t pt-1.5">
                        {children.map((child) => (
                          <div key={child.id} className="flex items-center justify-between gap-2 ps-3">
                            <div className="min-w-0 text-xs">
                              <span className="font-semibold">{child.name}</span>
                              <span className="text-muted-foreground"> · رصيد {formatKWD(child.balance)}</span>
                            </div>
                            <Switch
                              checked={child.isActive}
                              disabled={accountToggleMutation.isPending}
                              onCheckedChange={(checked) =>
                                accountToggleMutation.mutate({ id: child.id, isActive: checked })
                              }
                              aria-label="تفعيل/تعطيل الحساب الفرعي"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — لا حفظ موحد (الإجراءات فورية) فالرجوع فقط ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={onCancel}>
              <ArrowRight className="size-4" />
              رجوع للعُهد
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
