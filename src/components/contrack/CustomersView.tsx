"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Users as UsersIcon,
  RefreshCw,
  Phone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet } from "./api";
import { CustomerEditPage } from "./CustomerEditPage";
import { ProjectsManagerDialog } from "./ProjectsManagerDialog";
import { QuotesManagerDialog } from "./QuotesManagerDialog";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import type { Customer, CustomersResponse, User } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface CustomersViewProps {
  user: User;
  onAuthError: () => void;
  onNewContract: (customerId: number) => void;
  /** فتح ملف العميل كصفحة داخلية (بدل النافذة — كالمكتبي dealings._open_customer) */
  onOpenCustomerFile: (customerId: number) => void;
}

export function CustomersView({
  user,
  onAuthError,
  onNewContract,
  onOpenCustomerFile,
}: CustomersViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = user.role === "admin" || user.role === "developer";
  const flags = useFeatureFlags();
  // مفتاح المزايا «المشاريع» — كما تتبع بطاقة العداد المكتبية (main_window.py:154)
  const projectsOn = flags.enabled("projects");
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  // عروض الأسعار — بند 12: بلا مفتاح مزايا (لا مفتاح للعروض بالمكتبي ولا بالكتالوج)
  const [quotesOpen, setQuotesOpen] = React.useState(false);

  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");

  // بحث فوري مع debounce 300ms
  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const listQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", q],
    queryFn: () => apiGet<CustomersResponse>(`/api/customers?q=${encodeURIComponent(q)}`),
  });

  // نموذج العميل صفحة كاملة (بدل النافذة) — null = القائمة، وإلا {editing?}
  const [customerPage, setCustomerPage] = React.useState<{ editing?: Customer } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Customer | null>(null);

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || fallback });
    },
    [onAuthError, toast]
  );

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: "تم الحذف", description: "حُذف العميل بنجاح" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      handleError(e, "تعذر حذف العميل");
    },
  });

  const openAdd = () => setCustomerPage({});

  const openEdit = (c: Customer) => setCustomerPage({ editing: c });

  // صفحة نموذج العميل — تُعرض مكان القائمة (بلا مسار جديد)، وبعد الحفظ تعود للقائمة
  // (نفس invalidations النافذة السابقة تُحدث القائمة تلقائيًا)
  if (customerPage) {
    return (
      <CustomerEditPage
        editing={customerPage.editing ?? null}
        onAuthError={onAuthError}
        onClose={() => setCustomerPage(null)}
      />
    );
  }

  const items = listQuery.data?.customers ?? [];
  return (
    <div className="space-y-4">
      {/* الرأس */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">العملاء</h1>
          <p className="text-sm text-muted-foreground">إدارة ملفات العملاء وعقودهم</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-9" onClick={() => listQuery.refetch()} aria-label="تحديث">
            <RefreshCw className={listQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
          {projectsOn && (
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => setProjectsOpen(true)}>
              <span aria-hidden>🏗</span>
              المشاريع
            </Button>
          )}
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => setQuotesOpen(true)}>
            <span aria-hidden>🧾</span>
            عروض الأسعار
          </Button>
          {manager && (
            <Button className="h-9 gap-1.5" onClick={openAdd}>
              <Plus className="size-4" />
              عميل جديد
            </Button>
          )}
        </div>
      </div>

      {/* البحث */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 ps-9"
          placeholder="بحث بالاسم أو الكود أو الهاتف…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {/* الجدول — الحاسوب */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <Card className="border-status-danger/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {errMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <UsersIcon className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {q ? "لا نتائج مطابقة للبحث" : "لا يوجد عملاء بعد — أضف أول عميل"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead className="w-36">الهاتف</TableHead>
                  <TableHead className="w-20 text-center">العقود</TableHead>
                  {manager && <TableHead className="w-24 text-center">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => onOpenCustomerFile(c.id)}
                  >
                    <TableCell className="tabular-nums text-muted-foreground" dir="ltr">
                      {c.customerCode}
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell dir="ltr" className="tabular-nums">
                      {c.phone || "—"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {c._count?.contracts ?? 0}
                    </TableCell>
                    {manager && (
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(c)} aria-label="تعديل">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(c)}
                            aria-label="حذف"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* البطاقات — الموبايل */}
          <div className="grid grid-cols-1 gap-2 md:hidden">
            {items.map((c) => (
              <Card key={c.id} className="cursor-pointer p-4 transition-colors hover:border-primary/40" onClick={() => onOpenCustomerFile(c.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {c.customerCode}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
                      {c._count?.contracts ?? 0} عقد
                    </span>
                    {manager && (
                      <>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(c)} aria-label="تعديل">
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(c)}
                          aria-label="حذف"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {c.phone && (
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Phone className="size-3.5" />
                    <span dir="ltr">{c.phone}</span>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {/* حوار إدارة المشاريع — بند 11 داخل الشاشة الحاضنة (بلا بند شل كالمكتبي) */}
      {projectsOn && (
        <ProjectsManagerDialog
          user={user}
          onAuthError={onAuthError}
          open={projectsOpen}
          onOpenChange={setProjectsOpen}
        />
      )}

      {/* حوار إدارة عروض الأسعار — بند 12 داخل الشاشة الحاضنة (بلا بند شل ولا مفتاح مزايا) */}
      <QuotesManagerDialog
        user={user}
        onAuthError={onAuthError}
        open={quotesOpen}
        onOpenChange={setQuotesOpen}
      />

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف العميل؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف العميل «{deleteTarget?.name}» نهائيًا. إن كان له عقود سيرفض النظام الحذف مع إظهار السبب.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
