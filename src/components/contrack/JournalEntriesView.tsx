"use client";

/**
 * شاشة «القيود اليومية» — Task 104 (نواة القيد المزدوج الحقيقية).
 * • قائمة القيود المنشورة/الملغاة بفلاتر (الحالة/الفترة/الحساب/بحث) مع أسطر كل قيد
 * • قيد يدوي متعدد الأطراف بمعاينة توازن حية (مدين = دائن إلزاميًا عبر المحرك)
 * • إلغاء قيد (يُستبعد من الأرصدة) وقيد عكسي مرتبط (تصحيح شفاف) — كلٌّ بسبب موثق
 * المصدر الوحيد للأرصدة هو الأستاذ العام — هذه الشاشة عرض ونشر عبر المحرك فقط.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownUp,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

// ==================== الأنواع ====================

interface JournalLineRow {
  id: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
  customerId: number | null;
  contractId: number | null;
  subContractId: number | null;
  projectId: number | null;
  costCenter: string;
}

interface JournalEntryRow {
  id: number;
  entryNo: number;
  entryDate: string;
  description: string;
  status: string;
  sourceType: string;
  sourceId: number | null;
  reversalOfId: number | null;
  cancelReason: string;
  postedBy: string;
  createdBy: string;
  amount: number;
  lines: JournalLineRow[];
}

interface EntriesResponse {
  entries: JournalEntryRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface AccountRow {
  id: number;
  code: string;
  name: string;
  isLeaf: boolean;
  allowPosting: boolean;
  isActive: boolean;
  type: string;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "قيد يدوي",
  voucher: "سند",
  voucher_receipt: "سند قبض",
  voucher_payment: "سند صرف",
  voucher_transfer: "سند تحويل",
  voucher_cancel: "عكس سند",
  voucher_restore: "استعادة سند",
  bank_fee_alloc: "رسوم بنكية",
  custody: "عُهد",
  contract: "عقد",
  invoice: "فاتورة",
  reversal: "قيد عكسي",
  migration: "قيد مرحَّل",
  closing: "إغلاق سنوي",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  posted: { label: "منشور", cls: "bg-status-done-bg text-status-done" },
  draft: { label: "مسودة", cls: "bg-status-warn-bg text-status-warn" },
  cancelled: { label: "ملغى", cls: "bg-status-danger-bg text-status-danger" },
};

/** صف محرر القيد اليدوي */
interface DraftLine {
  accountId: string; // نص لعناصر Select
  debit: string;
  credit: string;
  description: string;
}

const emptyLine = (): DraftLine => ({ accountId: "", debit: "", credit: "", description: "" });

export function JournalEntriesView({
  onAuthError,
  presetQ,
  onConsumePresetQ,
}: {
  onAuthError: () => void;
  /** بحث مسبق (رقم القيد من شاشة السندات — Task 106) */
  presetQ?: string | null;
  onConsumePresetQ?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ==================== فلاتر القائمة ====================
  const [status, setStatus] = React.useState("posted");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [accountId, setAccountId] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  // بحث مسبق (فتح قيد سند من شاشة السندات) — يُستهلك مرة واحدة
  React.useEffect(() => {
    if (presetQ != null) {
      setStatus("all");
      setQ(presetQ);
      setPage(1);
      onConsumePresetQ?.();
    }
  }, [presetQ]);

  const filtersQs = React.useCallback(() => {
    const p = new URLSearchParams();
    if (status && status !== "all") p.set("status", status);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (accountId && accountId !== "all") p.set("accountId", accountId);
    if (q.trim()) p.set("q", q.trim());
    p.set("page", String(page));
    return p.toString();
  }, [status, from, to, accountId, q, page]);

  const entriesQ = useQuery({
    queryKey: ["journal-entries", filtersQs()],
    queryFn: async () => apiGet<EntriesResponse>(`/api/journal-entries?${filtersQs()}`),
  });

  const accountsQ = useQuery({
    queryKey: ["accounts-for-journal"],
    queryFn: async () => apiGet<{ accounts: AccountRow[] }>("/api/accounts"),
    staleTime: 60_000,
  });

  const postingAccounts = React.useMemo(
    () =>
      (accountsQ.data?.accounts || []).filter((a) => a.isActive && a.allowPosting && a.isLeaf),
    [accountsQ.data]
  );

  const resetPage = () => setPage(1);

  // ==================== إنشاء قيد يدوي ====================
  const [createOpen, setCreateOpen] = React.useState(false);
  const [cDate, setCDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [cDescription, setCDescription] = React.useState("");
  const [cLines, setCLines] = React.useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const cTotals = React.useMemo(() => {
    const debit = cLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = cLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.001 && debit > 0 };
  }, [cLines]);

  const openCreate = () => {
    setCDate(new Date().toISOString().slice(0, 10));
    setCDescription("");
    setCLines([emptyLine(), emptyLine()]);
    setCreateOpen(true);
  };

  const createM = useMutation({
    mutationFn: async () =>
      apiPost<{ entry: { entryNo: number }; message: string }>("/api/journal-entries", {
        entryDate: cDate,
        description: cDescription,
        lines: cLines
          .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({
            accountId: Number(l.accountId),
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description,
          })),
      }),
    onSuccess: (res) => {
      toast({ title: "تم النشر", description: res.message });
      setCreateOpen(false);
      setStatus("posted");
      setPage(1);
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ title: "تعذر النشر", description: errMessage(e), variant: "destructive" });
    },
  });

  // ==================== إلغاء / عكس ====================
  const [action, setAction] = React.useState<{ kind: "cancel" | "reverse"; entry: JournalEntryRow } | null>(null);
  const [actionReason, setActionReason] = React.useState("");

  const actionM = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error("لا إجراء");
      return apiPost<{ message: string }>(`/api/journal-entries/${action.entry.id}`, {
        action: action.kind,
        reason: actionReason,
      });
    },
    onSuccess: (res) => {
      toast({ title: "تم", description: res.message });
      setAction(null);
      setActionReason("");
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ title: "تعذر التنفيذ", description: errMessage(e), variant: "destructive" });
    },
  });

  const entries = entriesQ.data?.entries || [];
  const total = entriesQ.data?.total || 0;
  const pageSize = entriesQ.data?.pageSize || 50;
  const pagesCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              القيود اليومية
              <Badge variant="outline" className="text-xs">
                نواة القيد المزدوج — الأستاذ مصدر الحقيقة
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => entriesQ.refetch()}
                disabled={entriesQ.isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${entriesQ.isFetching ? "animate-spin" : ""}`} />
                تحديث
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                قيد يدوي
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* الفلاتر */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="col-span-2 md:col-span-1">
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  resetPage();
                }}
              >
                <SelectTrigger size="sm" aria-label="حالة القيد">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="posted">المنشورة</SelectItem>
                  <SelectItem value="draft">المسودات</SelectItem>
                  <SelectItem value="cancelled">الملغاة</SelectItem>
                  <SelectItem value="all">الكل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                resetPage();
              }}
              className="h-9"
              aria-label="من تاريخ"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                resetPage();
              }}
              className="h-9"
              aria-label="إلى تاريخ"
            />
            <Select
              value={accountId}
              onValueChange={(v) => {
                setAccountId(v);
                resetPage();
              }}
            >
              <SelectTrigger size="sm" aria-label="تصفية بحساب">
                <SelectValue placeholder="كل الحسابات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحسابات</SelectItem>
                {postingAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative col-span-2 md:col-span-1">
              <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  resetPage();
                }}
                placeholder="بحث بالبيان أو رقم القيد…"
                className="h-9 pr-8"
                aria-label="بحث"
              />
            </div>
          </div>

          {/* الجدول */}
          <div className="mt-3 max-h-[62vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-20">الرقم</TableHead>
                  <TableHead className="w-28">التاريخ</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead className="w-28">المصدر</TableHead>
                  <TableHead className="w-20">الحالة</TableHead>
                  <TableHead className="w-28 text-left">المبلغ</TableHead>
                  <TableHead className="w-36">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entriesQ.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      جارٍ التحميل…
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      لا قيود مطابقة للفلاتر.
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((e) => {
                    const st = STATUS_BADGE[e.status] || { label: e.status, cls: "" };
                    const isOpen = expanded === e.id;
                    return (
                      <React.Fragment key={e.id}>
                        <TableRow className={isOpen ? "bg-muted/40" : ""}>
                          <TableCell>
                            <button
                              onClick={() => setExpanded(isOpen ? null : e.id)}
                              className="rounded p-1 hover:bg-muted"
                              aria-label={isOpen ? "طي الأسطر" : "عرض الأسطر"}
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                              />
                            </button>
                          </TableCell>
                          <TableCell className="font-mono text-xs">#{e.entryNo}</TableCell>
                          <TableCell className="text-xs">{e.entryDate}</TableCell>
                          <TableCell className="max-w-[280px] truncate" title={e.description}>
                            {e.description}
                            {e.reversalOfId ? (
                              <span className="text-xs text-muted-foreground"> · عكسي</span>
                            ) : null}
                            {e.status === "cancelled" && e.cancelReason ? (
                              <div className="text-xs text-status-danger">السبب: {e.cancelReason}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {SOURCE_LABEL[e.sourceType] || e.sourceType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className={`rounded px-1.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                          </TableCell>
                          <TableCell className="text-left font-mono text-xs">
                            {formatKWD(e.amount)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {e.status === "posted" ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      setAction({ kind: "reverse", entry: e });
                                      setActionReason("");
                                    }}
                                  >
                                    <ArrowDownUp className="h-3.5 w-3.5" />
                                    عكسي
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-status-danger hover:text-status-danger"
                                    onClick={() => {
                                      setAction({ kind: "cancel", entry: e });
                                      setActionReason("");
                                    }}
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                    إلغاء
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen ? (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/20 p-0">
                              <div className="px-4 py-3">
                                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                  <span>المنشئ: {e.createdBy || "—"}</span>
                                  {e.postedBy ? <span>الناشر: {e.postedBy}</span> : null}
                                  {e.sourceId ? <span>مصدر رقم: {e.sourceId}</span> : null}
                                </div>
                                <div className="overflow-x-auto rounded border">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="w-24">الكود</TableHead>
                                        <TableHead>الحساب</TableHead>
                                        <TableHead>بيان السطر</TableHead>
                                        <TableHead className="w-28 text-left">مدين</TableHead>
                                        <TableHead className="w-28 text-left">دائن</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {e.lines.map((l) => (
                                        <TableRow key={l.id}>
                                          <TableCell className="font-mono text-xs">{l.accountCode}</TableCell>
                                          <TableCell className="text-xs">{l.accountName}</TableCell>
                                          <TableCell className="text-xs text-muted-foreground">
                                            {l.description || "—"}
                                          </TableCell>
                                          <TableCell className="text-left font-mono text-xs">
                                            {l.debit > 0 ? formatKWD(l.debit) : ""}
                                          </TableCell>
                                          <TableCell className="text-left font-mono text-xs">
                                            {l.credit > 0 ? formatKWD(l.credit) : ""}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                      <TableRow className="bg-muted/40 font-medium">
                                        <TableCell colSpan={3} className="text-xs">
                                          الإجمالي
                                        </TableCell>
                                        <TableCell className="text-left font-mono text-xs">
                                          {formatKWD(e.amount)}
                                        </TableCell>
                                        <TableCell className="text-left font-mono text-xs">
                                          {formatKWD(e.amount)}
                                        </TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* ترقيم الصفحات */}
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total} قيدًا — صفحة {page} من {pagesCount}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={page >= pagesCount}
                onClick={() => setPage((p) => Math.min(pagesCount, p + 1))}
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* حوار إنشاء قيد يدوي */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>قيد يدوي متعدد الأطراف</DialogTitle>
            <DialogDescription>
              يُنشر عبر المحرك بعد توازن إلزامي (مدين = دائن) وفترة مفتوحة — لا يُقبل قيد غير متوازن.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>تاريخ القيد</Label>
                <Input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>البيان</Label>
                <Input
                  value={cDescription}
                  onChange={(e) => setCDescription(e.target.value)}
                  placeholder="وصف القيد…"
                />
              </div>
            </div>

            <div className="max-h-[40vh] overflow-y-auto rounded-md border p-2">
              <div className="flex flex-col gap-2">
                {cLines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 items-center gap-1.5 rounded border p-1.5">
                    <div className="col-span-12 sm:col-span-5">
                      <Select
                        value={l.accountId}
                        onValueChange={(v) =>
                          setCLines((prev) => prev.map((x, i) => (i === idx ? { ...x, accountId: v } : x)))
                        }
                      >
                        <SelectTrigger size="sm" aria-label={`حساب السطر ${idx + 1}`}>
                          <SelectValue placeholder="اختر الحساب" />
                        </SelectTrigger>
                        <SelectContent>
                          {postingAccounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      className="col-span-4 h-8 sm:col-span-2"
                      inputMode="decimal"
                      placeholder="مدين"
                      value={l.debit}
                      onChange={(e) =>
                        setCLines((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x
                          )
                        )
                      }
                      aria-label={`مدين السطر ${idx + 1}`}
                    />
                    <Input
                      className="col-span-4 h-8 sm:col-span-2"
                      inputMode="decimal"
                      placeholder="دائن"
                      value={l.credit}
                      onChange={(e) =>
                        setCLines((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x
                          )
                        )
                      }
                      aria-label={`دائن السطر ${idx + 1}`}
                    />
                    <Input
                      className="col-span-8 h-8 sm:col-span-2"
                      value={l.description}
                      onChange={(e) =>
                        setCLines((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                      }
                      placeholder="بيان السطر"
                      aria-label={`بيان السطر ${idx + 1}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="col-span-4 h-8 text-status-danger sm:col-span-1"
                      disabled={cLines.length <= 2}
                      onClick={() => setCLines((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="حذف السطر"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-8"
                onClick={() => setCLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة سطر
              </Button>
            </div>

            {/* معاينة التوازن الحية */}
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-mono">مدين: {formatKWD(cTotals.debit)}</span>
              <span className="font-mono">دائن: {formatKWD(cTotals.credit)}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  cTotals.balanced ? "bg-status-done-bg text-status-done" : "bg-status-warn-bg text-status-warn"
                }`}
              >
                {cTotals.balanced ? "متوازن ✓" : "غير متوازن"}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              تراجع
            </Button>
            <Button
              disabled={!cTotals.balanced || !cDescription.trim() || createM.isPending}
              onClick={() => createM.mutate()}
            >
              {createM.isPending ? "جارٍ النشر…" : "نشر القيد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار إلغاء/عكس */}
      <Dialog open={action != null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "cancel" ? `إلغاء القيد #${action.entry.entryNo}` : `قيد عكسي للقيد #${action?.entry.entryNo}`}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === "cancel"
                ? "يُستبعد القيد من الأرصدة كليًا — يُستخدم للخطأ الواضح. السبب يُسجل في التدقيق."
                : "ينشر قيدًا معاكسًا مرتبطًا يصفِ أثر الأصل — التصحيح الشفاف المحاسبي. السبب يُسجل."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>سبب الإجراء</Label>
            <Input
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="مثال: خطأ في الحساب المختار…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              تراجع
            </Button>
            <Button
              variant={action?.kind === "cancel" ? "destructive" : "default"}
              disabled={!actionReason.trim() || actionM.isPending}
              onClick={() => actionM.mutate()}
            >
              {actionM.isPending ? "جارٍ التنفيذ…" : action?.kind === "cancel" ? "تأكيد الإلغاء" : "نشر العكسي"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
