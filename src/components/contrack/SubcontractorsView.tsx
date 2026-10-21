"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Eye,
  HardHat,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiGet } from "./api";
import { errMessage, isManagerRole } from "./contrack-types";
import type { SubContractor, SubContractorsResponse, User } from "./contrack-types";
import { formatKWD, statusBadgeClass } from "@/lib/format";
import { VoucherPage } from "./VoucherPage";
import { SubDeleteDialog } from "./SubDeleteDialog";
import { ContractorEditPage } from "./ContractorEditPage";
import { SubcontractorFilePage } from "./SubcontractorFilePage";

interface SubcontractorsViewProps {
  user: User;
  onAuthError: () => void;
}

export function SubcontractorsView({ user, onAuthError }: SubcontractorsViewProps) {
  const qc = useQueryClient();
  const manager = isManagerRole(user.role);

  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const listQuery = useQuery<SubContractorsResponse>({
    queryKey: ["subcontractors", dq],
    queryFn: () => apiGet<SubContractorsResponse>(`/api/subcontractors?q=${encodeURIComponent(dq)}`),
  });

  React.useEffect(() => {
    const e = listQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [listQuery.error, onAuthError]);

  const contractors: SubContractor[] = (listQuery.data?.subcontractors ?? listQuery.data?.items ?? []);

  // ===== صفحة المقاول الكاملة (كشف بنوده ودفعاته — بدل حوار التفاصيل الصغير) =====
  const [fileId, setFileId] = React.useState<number | null>(null);

  // الصرف على الباطن — صفحة سند كاملة (بلا نوافذ داخلية)
  const [payPage, setPayPage] = React.useState<{ subContractId: number; subLabel?: string } | null>(null);

  // ===== صفحة المقاول (جديد/تعديل) — بلا مسار، استبدال في نفس المستوى =====
  const [contractorPage, setContractorPage] = React.useState<{ editing: SubContractor | null } | null>(null);

  const openForm = (c?: SubContractor) => setContractorPage({ editing: c ?? null });

  const invalidateAll = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["subcontractors"] });
    qc.invalidateQueries({ queryKey: ["subcontractor"] });
    qc.invalidateQueries({ queryKey: ["sub-contracts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  // ===== حذف بيانات المقاول بخيارات (V5.8 — نافذة الخيارات المعتمدة) =====
  const [deleteSubId, setDeleteSubId] = React.useState<number | null>(null);

  // الصفحة تُركّب مكان القائمة عند الفتح (بعد كل الـhooks)
  if (payPage) {
    return (
      <VoucherPage
        user={user}
        onAuthError={onAuthError}
        mode="payment"
        preset={{ vtype: "payment", subMode: true, subContractId: payPage.subContractId }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["sub-contracts"] });
          qc.invalidateQueries({ queryKey: ["subcontractor"] });
          setPayPage(null);
        }}
        onCancel={() => setPayPage(null)}
      />
    );
  }

  if (contractorPage) {
    return (
      <ContractorEditPage
        editing={contractorPage.editing}
        onAuthError={onAuthError}
        onSaved={invalidateAll}
        onClose={() => setContractorPage(null)}
      />
    );
  }

  if (fileId !== null) {
    return (
      <SubcontractorFilePage
        subcontractorId={fileId}
        user={user}
        onAuthError={onAuthError}
        onClose={() => {
          setFileId(null);
          invalidateAll();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* رأس الصفحة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">المقاولون</h1>
          <p className="text-sm text-muted-foreground">مقاولو الباطن وعقودهم وقيمة المنصرف عليهم</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-9" onClick={() => listQuery.refetch()} aria-label="تحديث">
            <RefreshCw className={listQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
          {manager && (
            <Button size="sm" className="h-9 gap-1.5" onClick={() => openForm()}>
              <Plus className="size-4" />
              مقاول جديد
            </Button>
          )}
        </div>
      </div>

      {/* البحث */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 ps-9" placeholder="ابحث بالاسم/الكود/الهاتف/النشاط…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* المحتوى */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="border-status-danger/40">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{errMessage(listQuery.error)}</p>
            <Button variant="outline" size="sm" className="h-9" onClick={() => listQuery.refetch()}>
              <RefreshCw className="size-4" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      ) : contractors.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            لا مقاولين بعد — أضف مقاولًا ثم اربطه بعقود العملاء من داخل تفاصيل العقد.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* سطح المكتب */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <div className="max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead className="w-20">الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead className="w-28">الهاتف</TableHead>
                    <TableHead>النشاط</TableHead>
                    <TableHead className="w-16 text-center">عقود نشطة</TableHead>
                    <TableHead className="w-24 text-start">إجمالي</TableHead>
                    <TableHead className="w-24 text-start">منصرف</TableHead>
                    <TableHead className="w-24 text-start">متبقي</TableHead>
                    <TableHead className="w-16">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contractors.map((c) => {
                    const remaining = Number(c.activeAmount ?? 0) - Number(c.paid ?? 0);
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => setFileId(c.id)}>
                        <TableCell className="tabular-nums" dir="ltr">{c.subCode}</TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="tabular-nums" dir="ltr">{c.phone || "—"}</TableCell>
                        <TableCell className="max-w-32 truncate text-muted-foreground">{c.activity || "—"}</TableCell>
                        <TableCell className="text-center tabular-nums">{c.activeContracts ?? 0}</TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(c.activeAmount)}</TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">{formatKWD(c.paid)}</TableCell>
                        <TableCell>
                          <Badge className={remaining > 0.001 ? "bg-status-warn-bg text-status-warn" : "bg-status-done-bg text-status-done"}>
                            <span className="tabular-nums" dir="ltr">{formatKWD(remaining)}</span>
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => setFileId(c.id)} aria-label="كشف المقاول">
                              <Eye className="size-4" />
                            </Button>
                            {manager && (
                              <>
                                <Button variant="ghost" size="icon" className="size-8" onClick={() => openForm(c)} aria-label="تعديل">
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteSubId(c.id)}
                                  aria-label="حذف"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* موبايل */}
          <div className="space-y-2 md:hidden">
            {contractors.map((c) => {
              const remaining = Number(c.activeAmount ?? 0) - Number(c.paid ?? 0);
              return (
                <Card key={c.id} className="gap-2 p-3" onClick={() => setFileId(c.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <HardHat className="size-4 text-primary/70" />
                      {c.name}
                    </span>
                    <span className="text-xs text-muted-foreground" dir="ltr">{c.subCode}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span dir="ltr">{c.phone || "—"}</span>
                    <span>{c.activity || "—"}</span>
                    <span>عقود نشطة: {c.activeContracts ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      إجمالي <span className="tabular-nums" dir="ltr">{formatKWD(c.activeAmount)}</span> · منصرف{" "}
                      <span className="tabular-nums" dir="ltr">{formatKWD(c.paid)}</span>
                    </span>
                    <Badge className={remaining > 0.001 ? "bg-status-warn-bg text-status-warn" : "bg-status-done-bg text-status-done"}>
                      <span className="tabular-nums" dir="ltr">{formatKWD(remaining)}</span>
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ===== إضافة/تعديل مقاول ⇒ صفحة كاملة ContractorEditPage (تعاد من الحالة أعلاه) ===== */}

      {/* ===== حذف بيانات المقاول بخيارات: عقد · سند · السجل ===== */}
      <SubDeleteDialog
        subcontractorId={deleteSubId}
        open={deleteSubId !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteSubId(null);
        }}
        onAuthError={onAuthError}
        onDone={(info) => {
          if (info.action === "record") setFileId(null);
          invalidateAll();
        }}
      />
    </div>
  );
}
