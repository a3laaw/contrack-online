"use client";

/**
 * صفحة «عقد باطن جديد» — تحويل مسار النافذتين (نافذة الإنشاء + SubContractDialog) إلى صفحة كاملة بأقسام متتالية:
 * (1) إنشاء العقد الباطن — نفس حقول النافذة السابقة والـmutation حرفيًا.
 * (2) بعد الإنشاء تظهر تفاصيل العقد الباطن كأقسام في نفس الصفحة (بنود/خطة/كتل/سندات)
 *     عبر نفس الهوك والمكونات المشتركة من SubContractDialog — وكل نافذة داخلية سابقة
 *     (إضافة دفعة/توزيع تلقائي/إلغاء العقد الباطن) صارت خطوة موسّعة inline بلا تداخل نوافذ.
 * لا مسار جديد — تُعرض مكان شاشة العقد داخل ContractDetailView. نفس المنطق والـAPIs حرفيًا.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, Plus, Trash2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "./SearchableSelect";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { errMessage } from "./contrack-types";
import type { SubContractDetailResponse, SubContractorsResponse, User } from "./contrack-types";
import {
  AddPlanFields,
  DistributeFields,
  SubBlocksTable,
  SubFinCards,
  SubItemsEditor,
  SubPlanLinesTable,
  SubVouchersList,
  useSubContractDetail,
} from "./SubContractDialog";
import { VoucherPage } from "./VoucherPage";
import { SubDeleteDialog } from "./SubDeleteDialog";
import { StatusBadge } from "./StatusBadge";

interface SubContractNewPageProps {
  contractId: number;
  contractNumber: string;
  user: User;
  onAuthError: () => void;
  /** إلغاء / العودة لشاشة العقد */
  onCancel: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SubContractNewPage({ contractId, contractNumber, user, onAuthError, onCancel }: SubContractNewPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ===== القسم 1: إنشاء العقد الباطن — نفس نافذة «عقد باطن جديد» السابقة حرفيًا =====
  const [createdId, setCreatedId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState({
    subcontractorId: "",
    amount: "",
    startDate: todayStr(),
    endDate: "",
    description: "",
  });

  const contractorsQuery = useQuery<SubContractorsResponse>({
    queryKey: ["subcontractors", ""],
    queryFn: () => apiGet<SubContractorsResponse>("/api/subcontractors"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<SubContractDetailResponse>("/api/sub-contracts", {
        contractId,
        subcontractorId: Number(form.subcontractorId),
        amount: Number(form.amount || 0),
        startDate: form.startDate,
        endDate: form.endDate,
        description: form.description.trim(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["sub-contracts"] });
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "تم إنشاء عقد الباطن", description: "أُنشئ عقد الباطن — أضف البنود والخطة من الأقسام أدناه" });
      setForm({ subcontractorId: "", amount: "", startDate: todayStr(), endDate: "", description: "" });
      const newId = (res as unknown as { item?: { id?: number } }).item?.id;
      if (newId) setCreatedId(newId);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر إنشاء عقد الباطن", description: errMessage(e) });
    },
  });

  // ===== الأقسام التالية: تفاصيل العقد الباطن — نفس منطق SubContractDialog (هوك ومكونات مشتركة) =====
  const s = useSubContractDetail(createdId, user, onAuthError);

  // الصرف على الباطن — صفحة سند كاملة على مستوى الصفحة (بلا نوافذ)
  const [payOpen, setPayOpen] = React.useState(false);
  if (payOpen) {
    return (
      <VoucherPage
        user={user}
        onAuthError={onAuthError}
        mode="payment"
        preset={{
          vtype: "payment",
          subMode: true,
          subContractId: createdId ?? undefined,
          subLabel: s.item ? `${s.item.subcontractor?.name} — ${s.item.contract?.contractNumber}` : undefined,
        }}
        onSaved={() => {
          s.invalidate();
          setPayOpen(false);
        }}
        onCancel={() => setPayOpen(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>العملاء والعقود</span>
          <span aria-hidden="true">←</span>
          <span>العقود</span>
          <span aria-hidden="true">←</span>
          <span className="font-medium text-foreground" dir="ltr">
            {contractNumber}
          </span>
        </nav>
        <h1 className="mt-1 text-xl font-bold">عقد باطن جديد</h1>
        <p className="text-sm text-muted-foreground">
          اختر المقاول وحدد القيمة — البنود والخطة تُضبط من تفاصيل العقد الباطن.
        </p>
      </header>

      {/* ===== القسم 1: إنشاء العقد الباطن ===== */}
      {!createdId && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">بيانات العقد الباطن</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label>المقاول *</Label>
                <SearchableSelect
                  value={form.subcontractorId}
                  onValueChange={(v) => setForm((f) => ({ ...f, subcontractorId: v }))}
                  options={((contractorsQuery.data?.subcontractors ?? contractorsQuery.data?.items ?? [])).map((c) => ({ value: String(c.id), label: `${c.name} (${c.subCode})` }))}
                  placeholder={contractorsQuery.isLoading ? "جارٍ التحميل…" : "اختر المقاول"}
                  loading={contractorsQuery.isLoading}
                  searchPlaceholder="ابحث بالاسم أو الكود…"
                  emptyText="لا نتائج مطابقة"
                />
                {((contractorsQuery.data?.subcontractors ?? contractorsQuery.data?.items ?? [])).length === 0 && contractorsQuery.isSuccess && (
                  <p className="text-xs text-muted-foreground">لا مقاولين — أضف مقاولًا أولًا من شاشة «المقاولون».</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ns-amount">القيمة *</Label>
                <Input
                  id="ns-amount"
                  className="h-9 text-start font-mono tabular-nums"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ns-start">تاريخ البدء</Label>
                <Input
                  id="ns-start"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ns-end">تاريخ الانتهاء</Label>
                <Input
                  id="ns-end"
                  className="h-9"
                  dir="ltr"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                <Label htmlFor="ns-desc">الوصف</Label>
                <Textarea
                  id="ns-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== الأقسام التالية: تفاصيل العقد بعد الإنشاء (بلا نوافذ متداخلة) ===== */}
      {createdId &&
        (s.detailQuery.isLoading ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-64 rounded-lg" />
            </CardContent>
          </Card>
        ) : !s.item ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-destructive">{errMessage(s.detailQuery.error)}</CardContent>
          </Card>
        ) : (
          <>
            <p className="rounded-lg border border-status-done/40 bg-status-done-bg px-3 py-2 text-sm font-bold text-status-done">
              ✅ تم إنشاء عقد الباطن — أكمل البنود وخطة الدفعات من الأقسام التالية.
            </p>

            {/* البطاقات المالية */}
            <SubFinCards item={s.item} />

            {/* الإجراءات + إلغاء العقد الباطن كخطوة inline */}
            {s.manager && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-9 gap-1.5" onClick={() => setPayOpen(true)}>
                      <Banknote className="size-4" />
                      صرف على هذا الباطن
                    </Button>
                    {s.item.status !== "ملغى" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5"
                        onClick={() => {
                          s.setCancelReason("");
                          s.setCancelOpen(!s.cancelOpen);
                        }}
                      >
                        <Ban className="size-4" />
                        إلغاء العقد الباطن
                      </Button>
                    ) : (
                      <StatusBadge status="ملغى" />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => s.setDeleteOpen(true)}
                    >
                      <Trash2 className="size-4" />
                      حذف
                    </Button>
                  </div>

                  {/* خطوة موسّعة inline بدل النافذة الداخلية: إلغاء عقد الباطن */}
                  {s.cancelOpen && s.item.status !== "ملغى" && (
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                      <div>
                        <p className="text-sm font-bold">إلغاء عقد الباطن</p>
                        <p className="text-xs text-muted-foreground">إلغاء ناعم — السندات السارية تُفكّ من هذا العقد.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sc-reason">سبب الإلغاء *</Label>
                        <Textarea id="sc-reason" rows={3} value={s.cancelReason} onChange={(e) => s.setCancelReason(e.target.value)} />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" className="h-9" onClick={() => s.setCancelOpen(false)} disabled={s.cancelMutation.isPending}>
                          تراجع
                        </Button>
                        <Button
                          variant="destructive"
                          className="h-9"
                          disabled={s.cancelMutation.isPending || !s.cancelReason.trim()}
                          onClick={() => s.cancelMutation.mutate()}
                        >
                          {s.cancelMutation.isPending ? "جارٍ الإلغاء…" : "إلغاء"}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* القسم: البنود */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">البنود</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <SubItemsEditor
                  boqItems={s.boqQuery.data?.items ?? []}
                  draftItems={s.draftItems}
                  setDraftItems={s.setDraftItems}
                  dirty={s.itemsDirty}
                  setItemsDirty={s.setItemsDirty}
                  serverItems={s.itemsQuery.data}
                  onAddFromBoq={s.addFromBoq}
                  saving={s.saveItemsMutation.isPending}
                  onSave={() => s.saveItemsMutation.mutate()}
                />
              </CardContent>
            </Card>

            {/* القسم: خطة الدفعات (إضافة دفعة/توزيع تلقائي كخطوتين inline بدل النافذتين الداخليتين) */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>خطة الدفعات</span>
                  <span className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => s.setDistributeOpen(!s.distributeOpen)}>
                      <Wand2 className="size-4" />
                      توزيع تلقائي
                    </Button>
                    <Button
                      size="sm"
                      className="h-9 gap-1.5"
                      onClick={() => {
                        s.setPlanForm({ title: "", amount: "", dueDate: todayStr() });
                        s.setSourceIds([]);
                        s.setAddPlanOpen(!s.addPlanOpen);
                      }}
                    >
                      <Plus className="size-4" />
                      إضافة دفعة
                    </Button>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                {/* خطوة موسّعة inline بدل النافذة الداخلية: إضافة دفعة لخطة الباطن */}
                {s.addPlanOpen && (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    <div>
                      <p className="text-sm font-bold">إضافة دفعة لخطة الباطن</p>
                      <p className="text-xs text-muted-foreground">اربط الدفعة بمصادرها من دفعات العميل — الاستحقاق باكتمال كل المصادر.</p>
                    </div>
                    <AddPlanFields
                      planForm={s.planForm}
                      setPlanForm={s.setPlanForm}
                      clientDueLines={s.clientDueLines}
                      sourceIds={s.sourceIds}
                      setSourceIds={s.setSourceIds}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" className="h-9" onClick={() => s.setAddPlanOpen(false)} disabled={s.addPlanMutation.isPending}>
                        إلغاء
                      </Button>
                      <Button
                        className="h-9"
                        disabled={s.addPlanMutation.isPending || !s.planForm.title.trim() || !(Number(s.planForm.amount) > 0)}
                        onClick={() => s.addPlanMutation.mutate()}
                      >
                        {s.addPlanMutation.isPending ? "جارٍ الحفظ…" : "إضافة"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* خطوة موسّعة inline بدل النافذة الداخلية: توزيع تلقائي */}
                {s.distributeOpen && (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    <div>
                      <p className="text-sm font-bold">توزيع تلقائي لخطة الدفعات</p>
                      <p className="text-xs text-muted-foreground">يوزع المبلغ إما على عدد دفعات متساوية أو على بنود كميات العقد.</p>
                    </div>
                    <DistributeFields
                      distForm={s.distForm}
                      setDistForm={s.setDistForm}
                      boqItems={s.boqQuery.data?.items ?? []}
                      distBoqIds={s.distBoqIds}
                      setDistBoqIds={s.setDistBoqIds}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" className="h-9" onClick={() => s.setDistributeOpen(false)} disabled={s.distributeMutation.isPending}>
                        إلغاء
                      </Button>
                      <Button
                        className="h-9"
                        disabled={s.distributeMutation.isPending || !(Number(s.distForm.total) > 0) || (s.distForm.useBoq && s.distBoqIds.length === 0)}
                        onClick={() => s.distributeMutation.mutate()}
                      >
                        {s.distributeMutation.isPending ? "جارٍ التوزيع…" : "توزيع"}
                      </Button>
                    </div>
                  </div>
                )}

                {s.planLines.length === 0 ? (
                  <p className="p-2 text-center text-sm text-muted-foreground">
                    لا خطوط دفعات — أضف خطوطًا أو وزّع تلقائيًا على بنود الكميات.
                  </p>
                ) : (
                  <SubPlanLinesTable lines={s.planLines} manager={s.manager} onDelete={(lineId) => s.setDeletePlanId(lineId)} />
                )}
              </CardContent>
            </Card>

            {/* القسم: كتل الدفع */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">كتل الدفع</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <SubBlocksTable loading={s.payBlocksQuery.isLoading} rows={s.payBlocksQuery.data?.rows ?? []} />
              </CardContent>
            </Card>

            {/* القسم: السندات */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base">السندات</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <SubVouchersList vouchers={s.vouchersQuery.data?.items ?? []} />
              </CardContent>
            </Card>
          </>
        ))}

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            {createdId ? (
              <Button variant="outline" className="h-9" onClick={onCancel}>
                عودة لشاشة العقد
              </Button>
            ) : (
              <>
                <Button variant="outline" className="h-9" onClick={onCancel} disabled={createMutation.isPending}>
                  إلغاء
                </Button>
                <Button
                  className="h-9"
                  disabled={createMutation.isPending || !form.subcontractorId || !(Number(form.amount) > 0)}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? "جارٍ الإنشاء…" : "إنشاء"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* حذف بيانات المقاول بخيارات (V5.8 — نافذة الخيارات المعتمدة) على مستوى الصفحة */}
      <SubDeleteDialog
        subcontractorId={s.item?.subcontractor?.id ?? null}
        open={s.deleteOpen}
        onOpenChange={s.setDeleteOpen}
        onAuthError={onAuthError}
        onDone={(info) => {
          s.invalidate();
          if (info.action === "contracts" && createdId !== null && info.deletedContractIds.includes(createdId)) {
            s.setDeleteOpen(false);
            onCancel();
          }
        }}
        focus="contracts"
      />

      {/* تأكيد حذف خط خطة — تأكيد بلا حقول (تبقى نافذة) على مستوى الصفحة */}
      <Dialog open={s.deletePlanId !== null} onOpenChange={(o) => !o && s.setDeletePlanId(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>حذف خط الدفعة</DialogTitle>
            <DialogDescription>سيُحذف الخط من خطة الباطن — هل أنت متأكد؟</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => s.setDeletePlanId(null)} disabled={s.deletePlanMutation.isPending}>
              تراجع
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={s.deletePlanMutation.isPending}
              onClick={() => s.deletePlanId && s.deletePlanMutation.mutate(s.deletePlanId)}
            >
              {s.deletePlanMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
