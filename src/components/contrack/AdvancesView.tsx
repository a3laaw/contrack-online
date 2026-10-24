"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  Download,
  HandCoins,
  Pencil,
  Recycle,
  Scissors,
  Undo2,
  UserPlus,
  Users,
} from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPatch, apiPost } from "./api";
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

interface AdvancesViewProps {
  user: User;
  onAuthError: () => void;
}

// ===== أنواع =====

interface EmployeeRow {
  id: number;
  name: string;
  phone: string;
  notes: string;
  active: boolean;
  advanced: number;
  recovered: number;
  deducted: number;
  balance: number;
  movements: number;
}

interface EmployeesResponse {
  employees: EmployeeRow[];
  totals: { advanced: number; recovered: number; deducted: number; balance: number };
}

interface LedgerRow {
  voucherId: number;
  ref: string;
  kind: string;
  label: string;
  vdate: string;
  description: string;
  in: number;
  out: number;
  balance: number;
}

interface LedgerResponse {
  employeeId: number;
  employee: string;
  rows: LedgerRow[];
  balance: number;
  dateFrom: string;
  dateTo: string;
}

interface SummaryEmployee {
  employeeId: number;
  employee: string;
  advanced: number;
  recovered: number;
  deducted: number;
  balance: number;
  asOfBalance: number;
}

interface SummaryVoucher {
  voucherId: number;
  voucherNumber: string;
  vdate: string;
  employeeId: number;
  employee: string;
  amount: number;
  settled: number;
  remaining: number;
}

interface SummaryResponse {
  asOf: string;
  rows: SummaryEmployee[];
  totals: { advanced: number; recovered: number; deducted: number; balance: number; asOfBalance: number };
  outstanding: SummaryVoucher[];
  returned: SummaryVoucher[];
  note: string;
  warning: string;
}

/** رؤوس جدول الحركات — حرفيًا من المكتبي (advances_page.HEADS) */
const HEADS = ["التاريخ", "المرجع", "الحركة", "البيان", "سلفة (+)", "استرداد (−)", "المتبقي"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** تنزيل CSV بترميز UTF-8 مع BOM (نمط مسار التصدير الخلفي) */
function downloadCsv(title: string, heads: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [heads.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/\s+/g, "-") || "تقرير"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===================================================================
// الصفحة الرئيسية — المرجع الحرفي: contrack_v9.15.18/app/ui/advances_page.py
// ===================================================================

export function AdvancesView({ user: _user, onAuthError }: AdvancesViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [employeeId, setEmployeeId] = React.useState<string>("");
  const [empDialogOpen, setEmpDialogOpen] = React.useState(false);
  const [editEmployee, setEditEmployee] = React.useState<EmployeeRow | null>(null);
  const [moveKind, setMoveKind] = React.useState<"grant" | "return" | "deduction" | null>(null);
  const [restoreOpen, setRestoreOpen] = React.useState(false);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // الموظفون بأرصدة السلف — محسوبة لحظيًا من الحركات في الخادم
  const employeesQuery = useQuery<EmployeesResponse>({
    queryKey: ["employees-advances"],
    queryFn: () => apiGet<EmployeesResponse>("/api/employees"),
  });
  const employees: EmployeeRow[] = React.useMemo(
    () => (employeesQuery.data?.employees ?? []).filter((e) => e.active),
    [employeesQuery.data]
  );

  // اختيار أول موظف تلقائيًا (كالمكتبي: القائمة لا تُترك فارغة عند وجود موظفين)
  React.useEffect(() => {
    if (!employeeId && employees.length > 0) setEmployeeId(String(employees[0].id));
  }, [employees, employeeId]);

  const current = employees.find((e) => String(e.id) === employeeId) || null;

  // كشف الحركات الكامل للموظف المختار
  const ledgerQuery = useQuery<LedgerResponse>({
    queryKey: ["advances-ledger", employeeId],
    queryFn: () => apiGet<LedgerResponse>(`/api/employees/advances/ledger?employeeId=${employeeId}`),
    enabled: !!employeeId,
  });

  React.useEffect(() => {
    const e = employeesQuery.error || ledgerQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [employeesQuery.error, ledgerQuery.error, onAuthError]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["employees-advances"] });
    qc.invalidateQueries({ queryKey: ["advances-ledger"] });
    qc.invalidateQueries({ queryKey: ["advances-summary"] });
  };

  // ===== فتح نوافذ الحركات =====
  const openMove = (kind: "grant" | "return" | "deduction") => {
    if (kind !== "grant" && !employeeId) {
      toast({ title: "تنبيه", description: "أضف موظفًا أولًا." });
      return;
    }
    setMoveKind(kind);
  };

  // استعادة سلفة ملغاة (V8.4) — تتطلب موظفًا مختارًا
  const openRestore = () => {
    if (!employeeId) {
      toast({ variant: "destructive", title: "تنبيه", description: "أضف موظفًا أولًا." });
      return;
    }
    setRestoreOpen(true);
  };

  const onEmployeeSaved = (id: number) => {
    refreshAll();
    setEmployeeId(String(id));
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* الترويسة — حرفيًا من المكتبي */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">👥 سلف الموظفين</h1>
            <p className="text-xs text-muted-foreground">
              صرف السلف واستردادها (رد نقدي أو خصم راتب) — الاسترداد يخفض المصروف ولا يمس الإيرادات
            </p>
          </div>
        </div>
      </div>

      {/* شريط الأدوات: الموظف + الأزرار */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm">الموظف</Label>
        <SearchableSelect
          value={employeeId || "none"}
          onValueChange={setEmployeeId}
          options={employees.map((e) => ({ value: String(e.id), label: `${e.name}${e.phone ? ` — ${e.phone}` : ""}` }))}
          placeholder="اختر الموظف"
          searchPlaceholder="ابحث باسم/هاتف الموظف…"
          emptyText="لا نتائج مطابقة"
          className="w-full max-w-64 sm:w-64"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => {
            setEditEmployee(null);
            setEmpDialogOpen(true);
          }}
        >
          <UserPlus className="size-4" />
          ➕ موظف
        </Button>
        {current && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              setEditEmployee(current);
              setEmpDialogOpen(true);
            }}
          >
            <Pencil className="size-4" />
            ✎ تعديل البيانات
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={() => openMove("grant")}>
          <HandCoins className="size-4" />
          ＋ سلفة جديدة
        </Button>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => openMove("return")}>
          <Undo2 className="size-4" />
          ↩ رد نقدي
        </Button>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => openMove("deduction")}>
          <Scissors className="size-4" />
          ✂ خصم من راتب
        </Button>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={openRestore}>
          <Recycle className="size-4" />
          ♻️ استعادة سلفة
        </Button>
      </div>

      {/* البطاقات الثلاث — ألوان المكتبي */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard caption="💸 إجمالي المسلَّم" value={current?.advanced ?? 0} bg="bg-status-warn-bg" fg="text-status-warn" loading={employeesQuery.isLoading} />
        <StatCard caption="↩ المسترد + المخصوم" value={current ? current.recovered + current.deducted : 0} bg="bg-status-done-bg" fg="text-status-done" loading={employeesQuery.isLoading} />
        <StatCard caption="💰 المتبقي" value={current?.balance ?? 0} bg="bg-status-info-bg" fg="text-status-info" loading={employeesQuery.isLoading} strong />
      </div>

      {/* التبويبات: الكشف والتقارير */}
      <Tabs defaultValue="ledger" className="gap-3">
        <TabsList className="flex-wrap">
          <TabsTrigger value="ledger">📋 كشف الحركات</TabsTrigger>
          <TabsTrigger value="individual">👤 التقرير الفردي</TabsTrigger>
          <TabsTrigger value="summary">📊 التقرير المجمع</TabsTrigger>
        </TabsList>

        {/* ===== كشف الحركات ===== */}
        <TabsContent value="ledger" className="space-y-3">
          <Card className="p-0">
            <CardContent className="p-2 sm:p-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 text-sm font-bold">
                  <BookOpenText className="size-4 text-primary" />
                  {current ? `📋 كشف سلفة — ${current.name}` : "كشف الحركات"}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  disabled={!ledgerQuery.data || ledgerQuery.data.rows.length === 0}
                  onClick={() => {
                    const d = ledgerQuery.data!;
                    downloadCsv(
                      `كشف-سلفة-${d.employee}`,
                      HEADS,
                      d.rows.map((r) => [r.vdate, r.ref, r.label, r.description, r.in || "—", r.out || "—", formatKWD(r.balance)])
                    );
                    toast({ title: "تم التصدير", description: "نُزّل ملف CSV بنجاح" });
                  }}
                >
                  <Download className="size-4" />
                  📤 تصدير CSV
                </Button>
              </div>
              {ledgerQuery.isLoading ? (
                <div className="space-y-2 p-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : !employeeId ? (
                <p className="py-10 text-center text-sm text-muted-foreground">اختر موظفًا لعرض كشفه.</p>
              ) : !ledgerQuery.data || ledgerQuery.data.rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">لا حركات مسجلة لهذا الموظف بعد.</p>
              ) : (
                <LedgerTable rows={ledgerQuery.data.rows} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== التقرير الفردي ===== */}
        <TabsContent value="individual" className="space-y-3">
          <IndividualReport
            employeeId={employeeId}
            employeeName={current?.name || ""}
            onAuthError={onAuthError}
          />
        </TabsContent>

        {/* ===== التقرير المجمع ===== */}
        <TabsContent value="summary" className="space-y-3">
          <SummaryReport onAuthError={onAuthError} />
        </TabsContent>
      </Tabs>

      {/* نافذة الموظف (إضافة/تعديل) */}
      <EmployeeDialog
        open={empDialogOpen}
        onOpenChange={setEmpDialogOpen}
        employee={editEmployee}
        onSaved={onEmployeeSaved}
        onAuthError={onAuthError}
      />

      {/* نوافذ الحركات الثلاث */}
      <MoveDialog
        kind={moveKind}
        onClose={() => setMoveKind(null)}
        employees={employees}
        presetEmployeeId={employeeId}
        onSaved={refreshAll}
        onAuthError={onAuthError}
      />

      {/* نافذة استعادة سلفة ملغاة (V8.4) */}
      <RestoreDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        employeeId={employeeId}
        employeeName={current?.name || ""}
        onSaved={refreshAll}
        onAuthError={onAuthError}
      />
    </div>
  );
}

// ==================== بطاقة إحصائية ====================

function StatCard({
  caption,
  value,
  bg,
  fg,
  strong,
  loading,
}: {
  caption: string;
  value: number;
  bg: string;
  fg: string;
  strong?: boolean;
  loading?: boolean;
}) {
  return (
    <div className={`rounded-xl px-4 py-3 ${bg}`}>
      <div className={`text-xs font-bold ${fg}`}>{caption}</div>
      {loading ? (
        <Skeleton className={`mt-1 h-6 w-24 ${fg.replace("text-", "bg-")}`} />
      ) : (
        <div className={`mt-0.5 text-lg font-black tabular-nums ${fg} ${strong ? "text-xl" : ""}`}>
          {formatKWD(value)}
        </div>
      )}
    </div>
  );
}

// ==================== جدول الكشف (7 أعمدة حرفية) ====================

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            {HEADS.map((h, i) => (
              <TableHead key={i} className={`whitespace-nowrap ${i >= 4 ? "text-start" : ""}`}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, ri) => (
            <TableRow key={ri}>
              <TableCell className="whitespace-nowrap">{r.vdate}</TableCell>
              <TableCell className="whitespace-nowrap" dir="ltr">{r.ref}</TableCell>
              <TableCell className="whitespace-nowrap">{r.label}</TableCell>
              <TableCell className="whitespace-nowrap">{r.description}</TableCell>
              <TableCell className="whitespace-nowrap text-start tabular-nums">{r.in ? formatKWD(r.in) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-start tabular-nums">{r.out ? formatKWD(r.out) : "—"}</TableCell>
              <TableCell
                className={`whitespace-nowrap text-start tabular-nums font-medium ${
                  r.balance > 0.001 ? "text-status-danger" : r.balance < -0.001 ? "text-status-done" : ""
                }`}
              >
                {formatKWD(r.balance)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ==================== التقرير الفردي (كشف حساب) ====================

function IndividualReport({
  employeeId,
  employeeName,
  onAuthError,
}: {
  employeeId: string;
  employeeName: string;
  onAuthError: () => void;
}) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const query = useQuery<LedgerResponse>({
    queryKey: ["advances-ledger-individual", employeeId, from, to],
    queryFn: () =>
      apiGet<LedgerResponse>(
        `/api/employees/advances/ledger?employeeId=${employeeId}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`
      ),
    enabled: !!employeeId,
  });

  React.useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onAuthError();
  }, [query.error, onAuthError]);

  const rows = query.data?.rows ?? [];
  const balance = query.data?.balance ?? 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">📋 كشف حساب سلف — {employeeName || "—"}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              حركات الموظف داخل الفترة المحددة — الفترة فارغة = كل الحركات
            </p>
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input type="date" dir="ltr" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" dir="ltr" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !employeeId ? (
          <p className="py-8 text-center text-sm text-muted-foreground">اختر موظفًا أولًا.</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">لا حركات في هذه الفترة.</p>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    {["التاريخ", "النوع", "البيان", "المبلغ", "الرصيد"].map((h, i) => (
                      <TableHead key={i} className={`whitespace-nowrap ${i >= 3 ? "text-start" : ""}`}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, ri) => (
                    <TableRow key={ri}>
                      <TableCell className="whitespace-nowrap">{r.vdate}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.label}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.description}</TableCell>
                      <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(r.in || r.out)}</TableCell>
                      <TableCell
                        className={`whitespace-nowrap text-start tabular-nums font-medium ${
                          r.balance > 0.001 ? "text-status-danger" : r.balance < -0.001 ? "text-status-done" : ""
                        }`}
                      >
                        {formatKWD(r.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p
              className={`text-sm font-extrabold ${
                balance > 0.001 ? "text-status-danger" : balance < -0.001 ? "text-status-done" : "text-foreground"
              }`}
            >
              💰 الرصيد الحالي: {formatKWD(balance)} د.ك
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== التقرير المجمع (FIFO) ====================

function SummaryReport({ onAuthError }: { onAuthError: () => void }) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const query = useQuery<SummaryResponse>({
    queryKey: ["advances-summary", from, to],
    queryFn: () =>
      apiGet<SummaryResponse>(`/api/employees/advances/summary?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`),
  });

  React.useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onAuthError();
  }, [query.error, onAuthError]);

  const data = query.data;

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">📊 تقرير مجمع — أرصدة سلف الموظفين</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              الحالة تُقيَّم عند تاريخ نهاية الفترة (FIFO لكل موظف) — أرصدة محسوبة لحظيًا من الحركات
            </p>
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input type="date" dir="ltr" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" dir="ltr" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!data || data.rows.length === 0}
            onClick={() => {
              downloadCsv(
                "تقرير-مجمع-سلف-الموظفين",
                ["#", "الموظف", "المسلَّم", "المسترد+المخصوم", "المتبقي", "المتبقي عند نهاية الفترة (FIFO)"],
                (data?.rows ?? []).map((r, i) => [
                  i + 1,
                  r.employee,
                  formatKWD(r.advanced),
                  formatKWD(r.recovered + r.deducted),
                  formatKWD(r.balance),
                  formatKWD(r.asOfBalance),
                ])
              );
            }}
          >
            <Download className="size-4" />
            📤 تصدير CSV
          </Button>
        </div>

        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="py-8 text-center text-sm text-destructive">تعذر تحميل التقرير — {errMessage(query.error)}</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">لا حركات سلف لعرضها.</p>
        ) : (
          <>
            {/* جدول الأرصدة — أعمدة المكتبي الحرفية */}
            <div className="rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead className="whitespace-nowrap">الموظف</TableHead>
                    <TableHead className="whitespace-nowrap text-start">المسلَّم</TableHead>
                    <TableHead className="whitespace-nowrap text-start">المسترد+المخصوم</TableHead>
                    <TableHead className="whitespace-nowrap text-start">المتبقي</TableHead>
                    <TableHead className="whitespace-nowrap text-start">المتبقي عند نهاية الفترة (FIFO)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r, i) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.employee}</TableCell>
                      <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(r.advanced)}</TableCell>
                      <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(r.recovered + r.deducted)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-start tabular-nums font-medium ${r.balance > 0.001 ? "text-status-danger" : ""}`}>
                        {formatKWD(r.balance)}
                      </TableCell>
                      <TableCell className={`whitespace-nowrap text-start tabular-nums font-medium ${r.asOfBalance > 0.001 ? "text-status-danger" : ""}`}>
                        {formatKWD(r.asOfBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-sm font-extrabold">{data.note}</p>
            {data.warning && (
              <p className="rounded-lg border border-status-warn/40 bg-status-warn-bg px-3 py-2 text-sm font-bold text-status-warn">
                {data.warning}
              </p>
            )}

            {/* السلف القائمة عند نهاية الفترة — حالة FIFO */}
            {data.outstanding.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold">
                  السلف القائمة عند نهاية الفترة{data.asOf ? ` (${data.asOf})` : ""} — FIFO لكل موظف
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted">
                      <TableRow>
                        <TableHead className="whitespace-nowrap">المرجع</TableHead>
                        <TableHead className="whitespace-nowrap">التاريخ</TableHead>
                        <TableHead className="whitespace-nowrap">الموظف</TableHead>
                        <TableHead className="whitespace-nowrap text-start">المبلغ</TableHead>
                        <TableHead className="whitespace-nowrap text-start">المُسترَد</TableHead>
                        <TableHead className="whitespace-nowrap text-start">المتبقي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.outstanding.map((v) => (
                        <TableRow key={v.voucherId}>
                          <TableCell className="whitespace-nowrap" dir="ltr">{v.voucherNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{v.vdate}</TableCell>
                          <TableCell className="whitespace-nowrap">{v.employee}</TableCell>
                          <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(v.amount)}</TableCell>
                          <TableCell className="whitespace-nowrap text-start tabular-nums">{formatKWD(v.settled)}</TableCell>
                          <TableCell className="whitespace-nowrap text-start tabular-nums font-medium">{formatKWD(v.remaining)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== نافذة الموظف — EmployeeDialog ====================

function EmployeeDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
  onAuthError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employee: EmployeeRow | null;
  onSaved: (id: number) => void;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName(employee?.name || "");
      setPhone(employee?.phone || "");
      setNotes(employee?.notes || "");
    }
  }, [open, employee]);

  const saveMutation = useMutation({
    mutationFn: () =>
      employee
        ? apiPatch<{ employee: { id: number } }>(`/api/employees/${employee.id}`, { name, phone, notes })
        : apiPost<{ employee: { id: number } }>("/api/employees", { name, phone, notes }),
    onSuccess: (res) => {
      toast({ title: employee ? "حُفظت التعديلات ✅" : "أُضيف الموظف ✅" });
      onOpenChange(false);
      onSaved(res.employee.id);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errMessage(e) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base">➕ موظف جديد</DialogTitle>
          <DialogDescription>الاسم فريد — يستخدم في سندات السلف وكشوفها.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="emp-name">الاسم:*</Label>
            <Input id="emp-name" className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-phone">الهاتف:</Label>
            <Input id="emp-phone" className="h-9" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-notes">ملاحظات:</Label>
            <Input id="emp-notes" className="h-9" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            إلغاء
          </Button>
          <Button
            className="h-9"
            disabled={saveMutation.isPending || !name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== نوافذ الحركات الثلاث — _MoveDialog ====================

const MOVE_DEFS = {
  grant: { title: "💸 سلفة جديدة", needsMethod: true, methodLabel: "الطريقة:", success: "سُجّلت السلفة ✅" },
  return: { title: "↩ رد سلفة نقدًا", needsMethod: true, methodLabel: "إلى:", success: "سُجّل الرد ✅ (يخفض المصروف)" },
  deduction: { title: "✂ خصم سلفة من راتب", needsMethod: false, methodLabel: "", success: "سُجّل الخصم ✅ (رواتب/تخفيض سلفة)" },
} as const;

function MoveDialog({
  kind,
  onClose,
  employees,
  presetEmployeeId,
  onSaved,
  onAuthError,
}: {
  kind: "grant" | "return" | "deduction" | null;
  onClose: () => void;
  employees: EmployeeRow[];
  presetEmployeeId: string;
  onSaved: () => void;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const def = kind ? MOVE_DEFS[kind] : null;

  const [empId, setEmpId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [vdate, setVdate] = React.useState(todayStr());
  const [method, setMethod] = React.useState("الصندوق");
  const [notes, setNotes] = React.useState("");

  // تهيئة النافذة عند الفتح — الموظف الحالي محدد مسبقًا (كالمكتبي)
  React.useEffect(() => {
    if (kind) {
      setEmpId(presetEmployeeId || (employees[0] ? String(employees[0].id) : ""));
      setAmount("");
      setVdate(todayStr());
      setMethod("الصندوق");
      setNotes("");
    }
  }, [kind, presetEmployeeId, employees]);

  const selected = employees.find((e) => String(e.id) === empId) || null;
  const balance = selected ? selected.balance : 0;

  // سقف المتبقي للرد والخصم — يُملأ تلقائيًا عند تغيير الموظف (كالمكتبي _refresh_max)
  React.useEffect(() => {
    if (kind && kind !== "grant" && selected) {
      setAmount(String(Math.max(balance, 0)));
    }
  }, [kind, empId]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        kind,
        employeeId: Number(empId),
        amount: Number(amount || 0),
        vdate,
        description: notes.trim(),
      };
      if (def?.needsMethod) body.method = method;
      return apiPost<{ voucher: { voucherNumber?: string } }>("/api/employees/advances", body);
    },
    onSuccess: () => {
      toast({ title: def?.success || "تم الحفظ" });
      onSaved();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errMessage(e) });
    },
  });

  const amt = Number(amount || 0);
  const capped = kind !== null && kind !== "grant";
  const invalidAmount = !amt || amt <= 0 || (capped && amt > balance + 0.001);

  return (
    <Dialog open={kind !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base">{def?.title || "حركة"}</DialogTitle>
          <DialogDescription>
            {kind === "grant"
              ? "سلفة موظف — مصروف يخفضه الاسترداد لاحقًا"
              : kind === "return"
                ? "الرد النقدي يدخل الخزينة ويخفض المصروف — بلا إيراد"
                : "خصم من الراتب يُحسب مرتجعًا — بلا حركة نقدية"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>الموظف:</Label>
            <SearchableSelect
              value={empId || "none"}
              onValueChange={setEmpId}
              options={employees.map((e) => ({ value: String(e.id), label: `${e.name}${e.phone ? ` — ${e.phone}` : ""}` }))}
              placeholder="اختر الموظف"
              searchPlaceholder="ابحث باسم/هاتف الموظف…"
              emptyText="لا نتائج مطابقة"
            />
          </div>
          <p className="text-sm font-extrabold text-status-info">
            المتبقي الحالي: {formatKWD(balance)} د.ك
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mv-amount">المبلغ:</Label>
              <Input
                id="mv-amount"
                className="h-9"
                dir="ltr"
                type="number"
                min="0"
                max={capped ? Math.max(balance, 0) : 10000000}
                step="0.001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-date">التاريخ:</Label>
              <Input id="mv-date" className="h-9" dir="ltr" type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
            </div>
          </div>
          {def?.needsMethod && (
            <div className="space-y-1.5">
              <Label>{def.methodLabel}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="الصندوق">الصندوق</SelectItem>
                  <SelectItem value="البنك">البنك</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mv-notes">ملاحظات:</Label>
            <Input
              id="mv-notes"
              className="h-9"
              placeholder="ملاحظات (اختياري)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {capped && amt > balance + 0.001 && (
            <p className="text-xs font-bold text-destructive">
              المبلغ يتجاوز رصيد سلفة الموظف ({formatKWD(balance)} د.ك فقط)
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-9" onClick={onClose} disabled={saveMutation.isPending}>
            إلغاء
          </Button>
          <Button className="h-9" disabled={saveMutation.isPending || invalidAmount || !empId} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== نافذة استعادة سلفة ملغاة (V8.4) ====================

interface VoucherListRow {
  id: number;
  voucherNumber: string;
  vtype: string;
  vtypeLabel: string;
  kind: string;
  kindLabel: string;
  vdate: string;
  amount: number;
  employeeId: number | null;
  employeeName: string;
  description: string;
  cancelled: boolean;
  cancelReason: string;
  cancelledAt: string;
}

interface VouchersListResponse {
  vouchers: VoucherListRow[];
}

function RestoreDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  onSaved,
  onAuthError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onSaved: () => void;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = React.useState<VoucherListRow | null>(null);

  // العودة لوضع القائمة عند كل فتح
  React.useEffect(() => {
    if (open) setTarget(null);
  }, [open]);

  // قائمة سندات الموظف شاملة الملغى — تُرشَّح للملغى محليًا (أحدث 20)
  const query = useQuery<VouchersListResponse>({
    queryKey: ["advances-cancelled", employeeId],
    queryFn: () =>
      apiGet<VouchersListResponse>(`/api/employees/advances?employeeId=${employeeId}&includeCancelled=1`),
    enabled: open && !!employeeId,
  });

  React.useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onAuthError();
  }, [query.error, onAuthError]);

  const cancelled = React.useMemo(
    () => (query.data?.vouchers ?? []).filter((v) => v.cancelled).slice(0, 20),
    [query.data]
  );

  const restoreMutation = useMutation({
    mutationFn: (voucherId: number) =>
      apiPost<{ restored: boolean; voucherNumber: string; amount: number }>(
        "/api/employees/advances/restore",
        { voucherId }
      ),
    onSuccess: () => {
      toast({ title: "تمت استعادة السلفة ✅" });
      onOpenChange(false);
      onSaved();
      qc.invalidateQueries({ queryKey: ["advances-cancelled"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الاستعادة", description: errMessage(e) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        {target ? (
          // ===== خطوة التأكيد داخل النافذة نفسها =====
          <>
            <DialogHeader>
              <DialogTitle className="text-base">♻️ استعادة سلفة ملغاة</DialogTitle>
              <DialogDescription>
                ستُعاد قيود السند الأصلية ويُرفع الإلغاء — وتعود السلفة إلى رصيد الموظف.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2 text-sm">
              <p className="font-bold">هل تريد استعادة السلفة {target.voucherNumber}؟</p>
              <p>
                المبلغ: {formatKWD(target.amount)} د.ك
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                className="h-9"
                onClick={() => setTarget(null)}
                disabled={restoreMutation.isPending}
              >
                رجوع
              </Button>
              <Button
                className="h-9"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(target.id)}
              >
                {restoreMutation.isPending ? "جارٍ الاستعادة…" : "تأكيد الاستعادة"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          // ===== قائمة السلف الملغاة =====
          <>
            <DialogHeader>
              <DialogTitle className="text-base">♻️ استعادة سلفة ملغاة</DialogTitle>
              <DialogDescription>
                سلف {employeeName || "—"} الملغاة (أحدث 20) — الاستعادة تعيد القيود الأصلية وتُحدّث الأرصدة تلقائيًا.
              </DialogDescription>
            </DialogHeader>
            {query.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : cancelled.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد سلف ملغاة لهذا الموظف.</p>
            ) : (
              <div className="max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted">
                    <TableRow>
                      <TableHead className="whitespace-nowrap">المرجع</TableHead>
                      <TableHead className="whitespace-nowrap">التاريخ</TableHead>
                      <TableHead className="whitespace-nowrap text-start">المبلغ</TableHead>
                      <TableHead className="whitespace-nowrap">سبب الإلغاء</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cancelled.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="whitespace-nowrap" dir="ltr">{v.voucherNumber}</TableCell>
                        <TableCell className="whitespace-nowrap">{v.vdate}</TableCell>
                        <TableCell className="whitespace-nowrap text-start tabular-nums">
                          {formatKWD(v.amount)} د.ك
                        </TableCell>
                        <TableCell className="max-w-40 truncate whitespace-nowrap" title={v.cancelReason}>
                          {v.cancelReason || "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={restoreMutation.isPending}
                            onClick={() => setTarget(v)}
                          >
                            استعادة
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
