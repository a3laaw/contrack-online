"use client";

/**
 * ملف العميل — صفحة داخلية مطابقة للمكتبي (archive.py CustomerFileWidget):
 * شريط رجوع ثابت + Esc · EntityHeader بالشارات · PageNav (عام / العقود والتفاصيل)
 * · نظرة عامة (ملخص، نماذج ومرفقات، أهم العقود، السجل الزمني، تعليقات العميل)
 * · العقود Master-Detail بتضمين ContractDetailView · شريط إجراءات سفلي.
 * النصوص العربية حرفية من المكتبي إلا حيث يقتضي الويب خلافه (موثق في worklog).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  Download,
  FileText,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { CustomerEditPage } from "./CustomerEditPage";
import { ContractDetailView } from "./ContractDetailView";
import type {
  CustomerAttachment,
  CustomerFileResponse,
  StatementTarget,
  User,
} from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

// ==================== أدوات محلية ====================

/** توحيد رقم هاتف الكويت (كالمصدر normalize_kw_phone) */
function normalizeKwPhone(phone: string): string {
  const p = (phone || "").replace(/\D/g, "");
  if (!p) return "";
  let v = p.startsWith("00") ? p.slice(2) : p;
  if (v.startsWith("965") && v.length === 11) return v;
  if (v.length === 8) return "965" + v;
  if (v.length >= 10 && v.length <= 15) return v;
  return "";
}

/** حجم الملف (كالمصدر format_size) */
function formatSize(size: number): string {
  if (size < 1024) return `${size} بايت`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

/** أوقات الأحداث/التعليقات — أول 16 محرفًا (كالمصدر) */
function stamp16(s: string): string {
  return (s || "").slice(0, 16).replace("T", " ");
}

const EVENT_ICONS: Record<string, string> = {
  "إنشاء العقد": "🟢",
  "اعتماد العقد": "✅",
  "إضافة ملحق": "📎",
  "إضافة أمر تغييري": "📎",
  "إنشاء سند قبض": "📥",
  "إنشاء سند صرف": "📤",
  "إيقاف العقد": "⏸",
  "تفعيل العقد": "▶",
  "إغلاق العقد": "🔒",
  "إلغاء العقد": "❌",
  "انتهاء العقد": "🏁",
  "إلغاء سند": "🚫",
  "ضبط عقد إشراف": "🏗",
  "إلغاء أشهر تمديد إشراف": "🤝",
  "تغيير الحالة": "🚦",
};

// ==================== الصفحة ====================

export interface CustomerFilePageProps {
  customerId: number;
  user: User;
  onBack: () => void;
  onAuthError: () => void;
  /** «عقد جديد» — يفتح معالج العقود بهذا العميل (كالمصدر) */
  onNewContract: (customerId: number) => void;
  /** «كشف حساب العميل» — شاشة الكشوفات بوضع العميل الشامل */
  onOpenStatement: (target: StatementTarget) => void;
  /** «مركز التعليقات» من قائمة المزيد — اختياري (يُتجاهل بلطف إن لم يوفر) */
  onOpenCommentsCenter?: () => void;
}

type PageKey = "overview" | "contracts";

export function CustomerFilePage({
  customerId,
  user,
  onBack,
  onAuthError,
  onNewContract,
  onOpenStatement,
  onOpenCommentsCenter,
}: CustomerFilePageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = user.role === "admin" || user.role === "developer";

  // ===== البيانات =====
  const fileQuery = useQuery<CustomerFileResponse>({
    queryKey: ["customer-file", customerId],
    queryFn: () => apiGet<CustomerFileResponse>(`/api/customer-file/${customerId}`),
  });

  const attachmentsQuery = useQuery<{ attachments: CustomerAttachment[] }>({
    queryKey: ["customer-file", customerId, "attachments"],
    queryFn: () => apiGet<{ attachments: CustomerAttachment[] }>(`/api/attachments?customerId=${customerId}`),
  });

  const [page, setPage] = React.useState<PageKey>("overview");
  // العقد المختار في Master-Detail — مرفوع للصفحة ليعمل النقر من «أهم العقود» (كالمصدر show_contract_detail)
  const [selectedContractId, setSelectedContractId] = React.useState<number | null>(null);
  // ===== تعديل البيانات (صفحة كاملة مكان الملف — بدل نافذة CustomerFormDialog) =====
  const [editPage, setEditPage] = React.useState(false);

  // التبديل بين التبويبات يعيد التمرير لأعلى — كي لا يبقى محتوى تحت الشريط العلوي الثابت
  const switchPage = React.useCallback((p: PageKey) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // كالمصدر _open_overview_contract → show_contract_detail: التبديل للتبويب مع تحديد العقد
  const openContractInFile = React.useCallback(
    (id: number) => {
      setSelectedContractId(id);
      switchPage("contracts");
    },
    [switchPage]
  );

  // ===== Esc = رجوع (كالمصدر keyPressEvent — مستمع عند فتح الصفحة) =====
  // داخل حوار/قائمة منسدلة يخصّها Esc هي فقط ولا يُرجع للخلف (كالمصدر:
  // Esc لا يُمرَّر للنافذة الأم إلا في الوضع الصفحي).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // صفحة التعديل مفتوحة: Esc يعود للملف (كإغلاق النافذة سابقًا) ولا يخرج من الملف
      if (editPage) {
        setEditPage(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === "function" && t.closest('[role="dialog"],[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]')) {
        return;
      }
      e.stopPropagation();
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, editPage]);

  const handleError = React.useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || fallback });
    },
    [onAuthError, toast]
  );

  const refreshFile = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["customer-file", customerId] });
  }, [qc, customerId]);

  const customer = fileQuery.data?.customer;
  const totals = fileQuery.data?.totals;
  const contracts = fileQuery.data?.contracts ?? [];

  // ===== واتساب (كالمصدر _whatsapp 1814–1828) =====
  const openWhatsapp = () => {
    if (!customer) return;
    const phone = (customer.phone || "").trim();
    if (!phone) {
      toast({ title: "لا يوجد رقم هاتف مسجل لهذا العميل." });
      return;
    }
    const number = normalizeKwPhone(phone);
    if (!number) {
      toast({ variant: "destructive", title: "تعذر فتح واتساب، تأكد من تثبيته أو من صحة رقم الهاتف." });
      return;
    }
    const t = totals ?? { current: 0, collected: 0, remaining: 0 };
    const msg =
      `السادة / ${customer.name} المحترمين\n` +
      `تحية طيبة وبعد،\n` +
      `إجمالي التعاملات: ${formatKWD(t.current)}\n` +
      `المسدد: ${formatKWD(t.collected)}\n` +
      `المتبقي: ${formatKWD(t.remaining)}\n` +
      `وتفضلوا بقبول فائق الاحترام.`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  if (fileQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (fileQuery.isError || !fileQuery.data || !customer || !totals) {
    return (
      <Card className="border-status-danger/40">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{errMessage(fileQuery.error)}</p>
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => fileQuery.refetch()}>
            <RefreshCw className="size-4" /> إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ===== صفحة تعديل بيانات العميل — تُعرض مكان الملف (استبدال في نفس المستوى، بلا نافذة) =====
  if (editPage) {
    return (
      <CustomerEditPage
        editing={customer}
        onAuthError={onAuthError}
        onClose={() => setEditPage(false)}
        invalidateKeys={[["customer-file", customerId]]}
        onSaved={() => refreshFile()}
      />
    );
  }

  const contactLine =
    [customer.phone ? `📞 ${customer.phone}` : "", customer.address ? `📍 ${customer.address}` : "", customer.email ? `✉ ${customer.email}` : ""]
      .filter(Boolean)
      .join("   ") || "لا توجد بيانات اتصال مسجلة";

  return (
    <div className="space-y-3">
      {/* ===== شريط الرجوع الثابت (خارج التمرير — شرط الاعتماد المكتبي) ===== */}
      <div className="sticky top-14 z-30 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onBack} aria-label="العودة للصفحة السابقة (أو اضغط Esc)">
            <ArrowRight className="size-4" />
            رجوع
          </Button>
          <h1 className="truncate text-base font-bold">ملف العميل — {customer.name}</h1>
        </div>
      </div>

      {/* ===== رأس الكيان EntityHeader ===== */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl" aria-hidden>
              <UserIcon className="size-6 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-extrabold">{customer.name}</h2>
                <span className="text-xs text-muted-foreground" dir="ltr" title="كود العميل">
                  {customer.customerCode}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{contactLine}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {totals.count > 0 ? (
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10" title="عدد العقود والنشط منها">
                    {totals.count} عقد · منها {totals.active} نشط
                  </Badge>
                ) : (
                  <Badge variant="secondary">لا توجد عقود</Badge>
                )}
                {totals.remaining > 0.001 ? (
                  <Badge
                    className={
                      totals.overdueCount > 0
                        ? "bg-status-danger-bg text-status-danger hover:bg-status-danger-bg"
                        : "bg-status-warn-bg text-status-warn hover:bg-status-warn-bg"
                    }
                    title={fileQuery.data.meta.overdueTooltip || undefined}
                  >
                    متبقٍ {formatKWD(totals.remaining)}
                  </Badge>
                ) : (
                  <Badge className="bg-status-done-bg text-status-done hover:bg-status-done-bg">
                    لا مديونية
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => setEditPage(true)}>
              <Pencil className="size-4" />
              تعديل البيانات
            </Button>
            <Button variant="outline" className="h-9 gap-1.5" onClick={openWhatsapp} disabled={!(customer.phone || "").trim()} title="إرسال ملخص الحساب واتساب">
              💬 واتساب
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط التنقل (تبويبان فقط كالمصدر) ===== */}
      <Tabs value={page} onValueChange={(v) => switchPage(v as PageKey)}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="overview" className="h-9">
            عام
          </TabsTrigger>
          <TabsTrigger value="contracts" className="h-9">
            العقود والتفاصيل
          </TabsTrigger>
        </TabsList>

        {/* ==================== تبويب «عام» (مقابل _page_overview) ==================== */}
        <TabsContent value="overview" className="mt-3 space-y-4">
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            {/* العمود الرئيسي */}
            <div className="min-w-0 space-y-4">
              {/* ملخص العميل */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 text-sm font-bold">ملخص العميل</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MetricTile
                      label="المتبقي"
                      value={formatKWD(totals.remaining)}
                      tone={totals.remaining <= 0.001 ? "text-status-done" : totals.overdueCount > 0 ? "text-status-danger" : "text-status-warn"}
                      title={fileQuery.data.meta.overdueTooltip || undefined}
                    />
                    <MetricTile label="العقود" value={`${totals.count}  (نشط: ${totals.active})`} />
                    <MetricTile label="شيكات 14 يوم" value={String(fileQuery.data.cheques14)} />
                    <MetricTile
                      label="أقصى تأخر"
                      value={totals.overdueCount > 0 ? `${totals.overdueDays} يومًا` : "0 يومًا"}
                      title={fileQuery.data.meta.overdueTooltip || undefined}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-2 text-center">
                    <div>
                      <div className="text-[11px] text-muted-foreground">القيمة</div>
                      <div className="text-sm font-bold tabular-nums">{formatKWD(totals.current)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">المحصّل</div>
                      <div className="text-sm font-bold tabular-nums text-status-done">{formatKWD(totals.collected)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">المدفوع</div>
                      <div className="text-sm font-bold tabular-nums">{formatKWD(totals.paid)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* نماذج ومرفقات العميل */}
              <DocsCard
                customerId={customerId}
                customer={customer}
                contracts={contracts}
                manager={manager}
                attachmentsQuery={attachmentsQuery}
                onAuthError={onAuthError}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["customer-file", customerId, "attachments"] });
                }}
                onCustomerChanged={refreshFile}
                onError={handleError}
              />

              {/* أهم عقود العميل */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 text-sm font-bold">📌 أهم عقود العميل</h3>
                  {fileQuery.data.topContracts.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد عقود لهذا العميل بعد.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[34%]">العقد</TableHead>
                            <TableHead className="text-center">الحالة</TableHead>
                            <TableHead className="text-center">القيمة</TableHead>
                            <TableHead className="text-center">المحصّل</TableHead>
                            <TableHead className="text-center">المتبقي</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fileQuery.data.topContracts.map((c) => (
                            <TableRow
                              key={c.id}
                              className="cursor-pointer"
                              onClick={() => openContractInFile(c.id)}
                              title="انقر لعرض تفاصيل العقد داخل الملف"
                            >
                              <TableCell className="font-medium">{c.name || c.contractNumber}</TableCell>
                              <TableCell className="text-center text-xs">{c.status || "نشط"}</TableCell>
                              <TableCell className="text-center tabular-nums">{formatKWD(c.current)}</TableCell>
                              <TableCell className="text-center tabular-nums">{formatKWD(c.collected)}</TableCell>
                              <TableCell className="text-center font-bold tabular-nums">{formatKWD(c.remaining)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* السجل الزمني (كالمصدر _fill_customer_timeline) */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold">
                    <CalendarClock className="size-4" />
                    السجل الزمني
                  </h3>
                  {fileQuery.data.timeline.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">لا يوجد سجل زمني بعد.</p>
                  ) : (
                    <ul className="max-h-96 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2 text-sm leading-relaxed">
                      {fileQuery.data.timeline.map((e, i) => {
                        const icon = EVENT_ICONS[e.eventType] || "•";
                        let txt = `${icon} ${stamp16(e.eventTime)} · ${e.contractName}: ${e.eventType}`;
                        if (e.description) txt += ` — ${e.description}`;
                        if (e.username) txt += ` (${e.username})`;
                        return (
                          <li key={`${e.contractId}-${i}`} className={`rounded px-2 py-1.5 ${i % 2 ? "bg-transparent" : "bg-background/60"}`}>
                            {txt}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* لوحة التعليقات الجانبية (مدمجة في «عام» كالمصدر) */}
            <CommentsPanel
              customerId={customerId}
              contracts={contracts.map((c) => ({ id: c.id, name: c.name || c.contractNumber, contractNumber: c.contractNumber }))}
              user={user}
              onAuthError={onAuthError}
              onError={handleError}
            />
          </div>
        </TabsContent>

        {/* ==================== تبويب «العقود والتفاصيل» (مقابل _page_contracts) ==================== */}
        <TabsContent value="contracts" className="mt-3">
          <ContractsMasterDetail
            contracts={contracts}
            user={user}
            onAuthError={onAuthError}
            onOpenStatement={onOpenStatement}
            selectedId={selectedContractId}
            onSelectContract={setSelectedContractId}
            onLeaveDetail={refreshFile}
          />
        </TabsContent>
      </Tabs>

      {/* ===== شريط الإجراءات السفلي (مقابل ActionBar 193–197) ===== */}
      <div className="sticky bottom-16 z-30 md:bottom-2">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button className="h-9 gap-1.5" onClick={() => onNewContract(customerId)}>
                <Plus className="size-4" />
                عقد جديد
              </Button>
              <Button
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => onOpenStatement({ kind: "customer", id: customerId })}
                disabled={contracts.length === 0}
                title={contracts.length === 0 ? "لا توجد عقود لهذا العميل بعد." : undefined}
              >
                <FileText className="size-4" />
                كشف حساب العميل
              </Button>
              <Button variant="outline" className="h-9 gap-1.5" onClick={() => window.open(`/api/customer-file/${customerId}/print`, "_blank")}>
                🖨 طباعة كل المستندات
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-1.5">
                  <MoreHorizontal className="size-4" />
                  المزيد
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* قائمة «المزيد» — كالمصدر _customer_more_menu */}
                <DropdownMenuItem onClick={() => switchPage("contracts")}>عقود العميل</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (onOpenCommentsCenter) onOpenCommentsCenter();
                  }}
                  disabled={!onOpenCommentsCenter}
                >
                  مركز التعليقات
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    switchPage("overview");
                    // تمرير إلى بطاقة الملفات والمستندات (بديل فتح مجلد الأرشيف في الويب)
                    requestAnimationFrame(() => {
                      document.getElementById("customer-docs-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                >
                  الملفات والمستندات
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ==================== لوحة تعريف صغيرة ====================

function MetricTile({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2" title={title}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`truncate text-sm font-black tabular-nums ${tone || ""}`} dir={label === "العقود" ? undefined : "ltr"}>
        {value}
      </div>
    </div>
  );
}

// ==================== بطاقة نماذج ومرفقات العميل ====================

function DocsCard({
  customerId,
  customer,
  contracts,
  manager,
  attachmentsQuery,
  onAuthError,
  onSaved,
  onCustomerChanged,
  onError,
}: {
  customerId: number;
  customer: CustomerFileResponse["customer"];
  contracts: { id: number; contractNumber: string; name: string }[];
  manager: boolean;
  attachmentsQuery: { data?: { attachments: CustomerAttachment[] }; isLoading: boolean };
  onAuthError: () => void;
  onSaved: () => void;
  onCustomerChanged: () => void;
  onError: (e: unknown, fallback: string) => void;
}) {
  const { toast } = useToast();
  const path = (customer.folderPath || "").trim();
  const [shareOpen, setShareOpen] = React.useState(false);
  const [sharePath, setSharePath] = React.useState(path);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);

  React.useEffect(() => {
    if (shareOpen) setSharePath(path);
  }, [shareOpen, path]);

  const saveShare = useMutation({
    mutationFn: () => apiPatch(`/api/customers/${customerId}`, { folderPath: sharePath.trim() }),
    onSuccess: () => {
      toast({ title: "تم حفظ المسار" });
      setShareOpen(false);
      onCustomerChanged();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || "تعذر حفظ المسار" });
    },
  });

  const clearShare = useMutation({
    mutationFn: () => apiPatch(`/api/customers/${customerId}`, { folderPath: "" }),
    onSuccess: () => {
      toast({ title: "تم حذف مسار مجلد الشبكة من العميل" });
      setClearOpen(false);
      onCustomerChanged();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || "تعذر حذف المسار" });
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/attachments?id=${id}`),
    onSuccess: () => {
      toast({ title: "تم الحذف" });
      onSaved();
    },
    onError: (e) => onError(e, "تعذر حذف المرفق"),
  });

  const openShareFolder = async () => {
    // الويب لا يفتح مسارات شبكة من المتصفح — ننسخ المسار ليُلصق في مستكشف الملفات
    try {
      await navigator.clipboard.writeText(path);
      toast({ title: "نُسخ المسار للحافظة", description: "الصقه في شريط عنوان مستكشف الملفات لفتح المجلد." });
    } catch {
      toast({ variant: "destructive", title: "تعذر نسخ المسار" });
    }
  };

  const attachments = attachmentsQuery.data?.attachments ?? [];

  return (
    <Card id="customer-docs-card">
      <CardContent className="p-4">
        <h3 className="text-sm font-bold">نماذج ومرفقات العميل</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">اختيار نموذج أو مرفق ومجلد الشبكة.</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="shrink-0 font-medium">مجلد الشبكة:</span>
          <span className={`min-w-0 flex-1 truncate text-xs ${path ? "text-foreground" : "text-muted-foreground"}`} dir={path ? "ltr" : undefined} title={path || undefined}>
            {path || "غير مضبوط، اضغط «تعيين / تغيير» لربط مجلد المهندس على الشبكة"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!path} onClick={openShareFolder} title="المتصفح لا يفتح مسارات الشبكة — يُنسخ المسار للصقه في مستكشف الملفات">
            <FolderOpen className="size-4" />
            فتح مجلد الشبكة
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShareOpen(true)}>
            <Link2 className="size-4" />
            تعيين / تغيير
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-destructive hover:text-destructive"
            disabled={!path}
            onClick={() => setClearOpen(true)}
            title="يمسح مسار مجلد الشبكة من بطاقة العميل فقط ولا يحذف أي ملفات"
          >
            <Trash2 className="size-4" />
            حذف المسار
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5"
            disabled={contracts.length === 0}
            onClick={() => setAddOpen(true)}
            title={contracts.length === 0 ? "لا توجد عقود — المرفقات في الويب تُربط بعقد العميل" : undefined}
          >
            <Plus className="size-4" />
            إضافة مرفق
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
            <FolderOpen className="size-4" />
            {listOpen ? "إخفاء المرفقات" : "فتح مجلد المرفقات"}
          </Button>
        </div>

        {/* قائمة ملفات العميل (مرفقات عقوده) — بالحجم والحذف */}
        {listOpen && (
          <div className="mt-3 rounded-lg border">
            {attachmentsQuery.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-8 rounded" />
                <Skeleton className="h-8 rounded" />
              </div>
            ) : attachments.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">لا توجد مرفقات على عقود هذا العميل بعد.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border bg-background/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" title={a.fileName}>
                        {a.fileName}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {a.contractNumber}
                        {a.contractName ? ` · ${a.contractName}` : ""} · {formatSize(a.sizeBytes)} · {stamp16(a.addedAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`تنزيل ${a.fileName}`}
                        onClick={() => window.open(`/api/attachments?id=${a.id}&download=1`, "_blank")}
                      >
                        <Download className="size-4" />
                      </Button>
                      {manager && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          aria-label={`حذف ${a.fileName}`}
                          onClick={() => deleteAttachment.mutate(a.id)}
                          disabled={deleteAttachment.isPending}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* حوار تعيين مجلد الشبكة */}
        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>اختر مجلد العميل على الشبكة</DialogTitle>
              <DialogDescription>اكتب مسار مجلد العميل على الشبكة (مثل \\PC\Share\عملاء\...)</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="share-path">مسار مجلد الشبكة</Label>
              <Input id="share-path" dir="ltr" value={sharePath} onChange={(e) => setSharePath(e.target.value)} placeholder="\\PC\Share\Customers" />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setShareOpen(false)} disabled={saveShare.isPending}>
                إلغاء
              </Button>
              <Button className="h-9" onClick={() => saveShare.mutate()} disabled={saveShare.isPending}>
                {saveShare.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* تأكيد حذف مسار الشبكة — نص المكتبي حرفيًا */}
        <Dialog open={clearOpen} onOpenChange={setClearOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>حذف مسار الشبكة</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-1 text-sm">
                  <p>حذف مسار مجلد الشبكة من بطاقة هذا العميل؟</p>
                  <p className="break-all text-xs" dir="ltr">
                    {path}
                  </p>
                  <p>لن يتم حذف أي ملف من الجهاز أو الشبكة؛ سيتم فقط إلغاء الربط.</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setClearOpen(false)} disabled={clearShare.isPending}>
                إلغاء
              </Button>
              <Button
                variant="destructive"
                className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                onClick={() => clearShare.mutate()}
                disabled={clearShare.isPending}
              >
                {clearShare.isPending ? "جارٍ الحذف…" : "حذف المسار"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AddAttachmentDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          customerId={customerId}
          contracts={contracts}
          onAuthError={onAuthError}
          onSaved={onSaved}
        />
      </CardContent>
    </Card>
  );
}

// ==================== حوار إضافة مرفق ====================

function AddAttachmentDialog({
  open,
  onOpenChange,
  customerId,
  contracts,
  onAuthError,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: number;
  contracts: { id: number; contractNumber: string; name: string }[];
  onAuthError: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [contractId, setContractId] = React.useState<string>("");
  const [file, setFile] = React.useState<File | null>(null);

  React.useEffect(() => {
    if (open) {
      setContractId("");
      setFile(null);
    }
  }, [open]);

  const upload = useMutation({
    mutationFn: async () => {
      if (!contractId) throw new ApiError("اختر العقد المرفَق إليه", 400);
      if (!file) throw new ApiError("اختر ملفًا", 400);
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, ""));
        reader.onerror = () => reject(new ApiError("تعذر قراءة الملف", 400));
        reader.readAsDataURL(file);
      });
      return apiPost("/api/attachments", { contractId: Number(contractId), fileName: file.name, dataBase64: b64 });
    },
    onSuccess: () => {
      toast({ title: "تمت إضافة 1 ملف إلى الأرشيف." });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "خطأ", description: errMessage(e) || "تعذر إضافة الملفات." });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة مرفق</DialogTitle>
          <DialogDescription>المرفقات في الويب تُربط بعقد للعميل (الأرشيف المكتبي بمجلد قرص غير متاح على النشر السحابي).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>يُربط بعقد</Label>
            <Select value={contractId} onValueChange={setContractId}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="اختر العقد…" />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.contractNumber} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-file">الملف</Label>
            <Input
              id="att-file"
              type="file"
              className="h-9"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <p className="text-[11px] text-muted-foreground">الأنواع المسموحة: pdf، صور، Word، Excel، txt</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
            إلغاء
          </Button>
          <Button className="h-9" onClick={() => upload.mutate()} disabled={upload.isPending}>
            {upload.isPending ? "جارٍ الرفع…" : "رفع المرفق"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== تعليقات العميل (كالمصدر _page_comments) ====================

interface CommentRowLite {
  id: number;
  customerId: number;
  customerName: string;
  customerCode: string;
  contractId: number | null;
  contractNumber: string;
  contractName: string;
  body: string;
  createdBy: string;
  author: string;
  pinned: boolean;
  editedAt: string;
  editor: string;
  status: string;
  createdAt: string;
}

function CommentsPanel({
  customerId,
  contracts,
  user,
  onAuthError,
  onError,
}: {
  customerId: number;
  contracts: { id: number; name: string; contractNumber: string }[];
  user: User;
  onAuthError: () => void;
  onError: (e: unknown, fallback: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = user.role === "admin" || user.role === "developer";

  // الفلتر: all = كل العقود · none = غير محدد · رقم = عقد (كالمصدر _comments_filter_contract_id)
  const [filter, setFilter] = React.useState<string>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [writeContract, setWriteContract] = React.useState<string>("none");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const qs = new URLSearchParams({ customerId: String(customerId) });
  if (filter !== "all") qs.set("contractId", filter === "none" ? "0" : filter);
  if (q) qs.set("q", q);

  const commentsQuery = useQuery<{ comments: CommentRowLite[]; count: number; customerTotal: number | null }>({
    queryKey: ["customer-file", customerId, "comments", filter, q],
    queryFn: () => apiGet(`/api/comments?${qs.toString()}`),
  });

  const rows = commentsQuery.data?.comments ?? [];
  const refreshComments = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["customer-file", customerId, "comments"] });
  }, [qc, customerId]);

  const addComment = useMutation({
    mutationFn: () =>
      apiPost("/api/comments", {
        customerId,
        contractId: writeContract !== "none" ? Number(writeContract) : undefined,
        body: body.trim(),
      }),
    onSuccess: () => {
      setBody("");
      toast({ title: "تمت إضافة التعليق" });
      refreshComments();
    },
    onError: (e) => onError(e, "تعذر حفظ التعليق"),
  });

  const mutateComment = useMutation({
    mutationFn: ({ id, action, payload }: { id: number; action: string; payload?: Record<string, unknown> }) =>
      apiPatch(`/api/comments/${id}`, { action, ...payload }),
    onSuccess: () => refreshComments(),
    onError: (e) => onError(e, "تعذر تنفيذ الإجراء"),
  });

  const deleteComment = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/comments/${id}`),
    onSuccess: () => {
      toast({ title: "تم حذف التعليق" });
      refreshComments();
    },
    onError: (e) => onError(e, "تعذر حذف التعليق"),
  });

  const [deleteTarget, setDeleteTarget] = React.useState<CommentRowLite | null>(null);
  const [editTarget, setEditTarget] = React.useState<CommentRowLite | null>(null);
  const [editBody, setEditBody] = React.useState("");

  // سطر الملخص (كالمصدر _sec_comments)
  const scopeTxt = filter === "all" ? "كل العقود" : filter === "none" ? "غير محدد" : contracts.find((c) => String(c.id) === filter)?.name || "عقد";
  const total = filter === "all" && !q ? commentsQuery.data?.customerTotal ?? rows.length : rows.length;
  const pinnedCount = rows.filter((r) => r.pinned).length;
  let summaryText = `التعليقات (${total}) · ${scopeTxt}`;
  if (pinnedCount) summaryText += ` · مثبّت: ${pinnedCount}`;
  if (q) summaryText += ` · نتائج البحث: ${rows.length}`;

  return (
    <Card className="min-w-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-bold">تعليقات العميل</h3>

        <p className="text-xs font-semibold text-foreground">{summaryText}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 min-w-0 flex-1" title="فلتر سريع للتعليقات: كل العقود، بلا عقد محدد، أو عقد بعينه">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل العقود</SelectItem>
              <SelectItem value="none">غير محدد</SelectItem>
              {contracts.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input className="h-9 min-w-0 flex-1" placeholder="ابحث في التعليقات..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>

        {/* صندوق الكتابة السريعة */}
        <div className="rounded-lg border bg-muted/20 p-3">
          <Label className="text-xs">يخص العقد:</Label>
          <Select value={writeContract} onValueChange={setWriteContract}>
            <SelectTrigger className="mt-1 h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">غير محدد</SelectItem>
              {contracts.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            className="mt-2 min-h-[76px]"
            placeholder="اكتب ما دار مع العميل اليوم · مثال: كلّمته ووعد بالسداد الخميس..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button size="icon" className="size-9" aria-label="إرسال التعليق" title="إرسال التعليق" onClick={() => addComment.mutate()} disabled={addComment.isPending || !body.trim()}>
              <Send className="size-4" />
            </Button>
          </div>
        </div>

        {/* فقاعات التعليقات */}
        <div className="max-h-96 min-h-[200px] space-y-2 overflow-y-auto" role="list" aria-label="قائمة تعليقات العميل">
          {commentsQuery.isLoading ? (
            <>
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </>
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد تعليقات بعد.</p>
          ) : (
            rows.map((row) => {
              const contractLabel = row.contractId ? row.contractName || row.contractNumber : "";
              const canDelete = manager || row.createdBy === user.username;
              return (
                <div
                  key={row.id}
                  role="listitem"
                  className={`rounded-xl border p-3 ${row.pinned ? "border-status-warn/40 bg-status-warn-bg" : "bg-card"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-[11px] font-bold text-muted-foreground">
                      {row.author || row.createdBy || "غير معروف"} · {stamp16(row.createdAt)}
                      {row.pinned && <span className="ms-1.5 font-extrabold text-status-warn">مثبّت</span>}
                      {row.editedAt && <span className="ms-1.5 font-normal text-muted-foreground/80">عُدّل بواسطة {row.editor || "مدير"}</span>}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="إجراءات التعليق">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!manager}
                          onClick={() => {
                            setEditTarget(row);
                            setEditBody(row.body);
                          }}
                        >
                          {manager ? "تعديل التعليق" : "تعديل التعليق (مدير فقط)"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!manager}
                          onClick={() =>
                            mutateComment.mutate({ id: row.id, action: row.pinned ? "unpin" : "pin" }, { onSuccess: () => toast({ title: row.pinned ? "أُلغي التثبيت" : "تم التثبيت" }) })
                          }
                        >
                          {row.pinned ? "إلغاء التثبيت" : "تثبيت في الأعلى"}
                          {!manager ? " (مدير)" : ""}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!canDelete} className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(row)}>
                          حذف التعليق
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {contractLabel && <div className="text-[11px] font-bold text-primary">{contractLabel}</div>}
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{row.body}</p>
                </div>
              );
            })
          )}
          {rows.length >= 100 && (
            <p className="text-center text-xs text-muted-foreground">تم عرض أحدث 100 تعليق فقط — استخدم البحث للوصول لتعليق أقدم.</p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">الإجراءات من قائمة ⋮ لكل تعليق: تثبيت/حذف · التعديل للمدير فقط</p>

        {/* حوار تعديل نص التعليق */}
        <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>تعديل التعليق</DialogTitle>
              <DialogDescription>نص التعليق:</DialogDescription>
            </DialogHeader>
            <Textarea className="min-h-[120px]" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setEditTarget(null)} disabled={mutateComment.isPending}>
                إلغاء
              </Button>
              <Button
                className="h-9"
                disabled={mutateComment.isPending || !editBody.trim()}
                onClick={() => {
                  if (!editTarget) return;
                  mutateComment.mutate(
                    { id: editTarget.id, action: "body", payload: { body: editBody.trim() } },
                    {
                      onSuccess: () => {
                        toast({ title: "تم تعديل التعليق" });
                        setEditTarget(null);
                      },
                    }
                  );
                }}
              >
                {mutateComment.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* تأكيد حذف التعليق — نص المكتبي حرفيًا */}
        <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>حذف تعليق</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-1 text-sm">
                  <p>حذف التعليق؟</p>
                  <p className="break-words">«{(deleteTarget?.body || "").slice(0, 60)}»</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setDeleteTarget(null)} disabled={deleteComment.isPending}>
                إلغاء
              </Button>
              <Button
                variant="destructive"
                className="h-9 border-0 bg-status-danger-bg text-status-danger hover:bg-status-danger-bg/80"
                disabled={deleteComment.isPending}
                onClick={() => {
                  if (!deleteTarget) return;
                  deleteComment.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
                }}
              >
                {deleteComment.isPending ? "جارٍ الحذف…" : "حذف"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ==================== العقود Master-Detail (مقابل _page_contracts) ====================

function ContractsMasterDetail({
  contracts,
  user,
  onAuthError,
  onOpenStatement,
  selectedId,
  onSelectContract,
  onLeaveDetail,
}: {
  contracts: CustomerFileResponse["contracts"];
  user: User;
  onAuthError: () => void;
  onOpenStatement: (target: StatementTarget) => void;
  selectedId: number | null;
  onSelectContract: (id: number | null) => void;
  /** عند العودة من تفاصيل العقد نحدّث أرقام الملف (بدائل data_changed المكتبية) */
  onLeaveDetail: () => void;
}) {
  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [filterKey, setFilterKey] = React.useState<string>("all");
  // التحديد مُدار من الأب (ليعمل النقر من «أهم عقود العميل»)

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // الفلاتر كالمصدر: النشطة فقط / عليها متبقٍ / المغلقة والمنتهية
  let items = [...contracts];
  if (q) items = items.filter((c) => (c.name || "").includes(q) || (c.contractNumber || "").includes(q));
  if (filterKey === "active") items = items.filter((c) => c.status === "نشط");
  else if (filterKey === "remaining") items = items.filter((c) => c.remaining > 0.001);
  else if (filterKey === "closed") items = items.filter((c) => ["مغلق", "منتهي", "ملغى"].includes(c.status));

  // الملخص: المتبقي المعروض — القيمة والمحصّل لغير الملغى/المسودة (كالمصدر)
  let total = 0;
  let collected = 0;
  for (const c of items) {
    if (c.status !== "ملغى" && c.status !== "مسودة") {
      total += c.current;
      collected += c.collected;
    }
  }

  // اختيار الحالي: يبقى محفوظًا إن كان ضمن المعروض (كالمصدر _keep_id)
  React.useEffect(() => {
    if (selectedId !== null && !items.some((c) => c.id === selectedId)) {
      onSelectContract(items.length > 0 ? items[0].id : null);
    }
  }, [q, filterKey]);

  const selected = items.find((c) => c.id === selectedId) || null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* القائمة الجانبية — عرض 270–390px كالمصدر */}
      <Card className="w-full shrink-0 lg:w-[330px] lg:min-w-[270px] lg:max-w-[390px]">
        <CardContent className="flex h-full flex-col gap-2 p-3">
          <h3 className="text-sm font-bold">عقود العميل</h3>
          <Input className="h-9" placeholder="بحث باسم العقد أو رقمه..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          <Select value={filterKey} onValueChange={setFilterKey}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل العقود</SelectItem>
              <SelectItem value="active">النشطة فقط</SelectItem>
              <SelectItem value="remaining">عليها متبقٍ</SelectItem>
              <SelectItem value="closed">المغلقة والمنتهية</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">المعروض: {items.length} عقد · المتبقي {formatKWD(total - collected)}</p>

          <div className="max-h-[420px] min-h-[160px] space-y-1.5 overflow-y-auto lg:max-h-[560px]">
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد عقود مطابقة.</p>
            ) : (
              items.map((c) => {
                const isSelected = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectContract(c.id)}
                    className={`w-full rounded-lg border p-2.5 text-start transition-colors hover:border-primary/40 ${isSelected ? "border-primary/60 bg-primary/5" : "bg-card"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold" title={`${c.name} — ${c.contractNumber}`}>
                        {c.name || "(بلا اسم)"}
                      </span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${statusBadgeClassLite(c.status)}`}>{c.status || "نشط"}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground" dir="ltr">
                        {c.contractNumber}
                      </span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          c.remaining > 0.001 ? (c.hasOverdue ? "text-status-danger" : "text-status-warn") : "text-status-done"
                        }`}
                        title={c.hasOverdue ? `عليه دفعة متأخرة منذ ${c.overdueDays} يومًا (${c.overdueTitle || "دفعة مجدولة"})` : undefined}
                      >
                        {formatKWD(c.remaining)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* تفاصيل العقد المختار — نفس الصفحة لا شاشة أخرى (جوهر المطابقة) */}
      <div className="min-w-0 flex-1">
        {selected ? (
          <div data-testid="customer-file-contract-detail">
            <ContractDetailView
              contractId={selected.id}
              user={user}
              onBack={() => {
                onSelectContract(null);
                onLeaveDetail();
              }}
              onAuthError={onAuthError}
              onOpenStatement={onOpenStatement}
            />
          </div>
        ) : (
          <Card className="flex h-64 items-center justify-center">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">اختر عقدًا من القائمة لعرض تفاصيله هنا.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/** ألوان حالات العقد (مطابقة STATUS_COLORS المكتبية بنبرة الثيم) */
function statusBadgeClassLite(status: string): string {
  switch (status) {
    case "نشط":
      return "bg-status-done-bg text-status-done";
    case "مسودة":
      return "bg-status-done-bg text-status-done";
    case "تحت المراجعة":
    case "متوقف":
      return "bg-status-warn-bg text-status-warn";
    case "معتمد":
      return "bg-primary/10 text-primary";
    case "منتهي":
      return "bg-status-done-bg text-status-done";
    case "مغلق":
      return "bg-status-done-bg text-status-done";
    case "ملغى":
      return "bg-status-danger-bg text-status-danger";
    default:
      return "bg-status-done-bg text-status-done";
  }
}
