"use client";

/**
 * CustomerPortalLinks — ر5 «بوابة العميل — رابط الكشف المؤقت الآمن»
 * (docs/customer-portal-design.md د8): بطاقة تبويب «الكشف المالي» بملف العميل —
 * إنشاء رابط (30/90/365 — د2) + عرض النص الصريح مرة واحدة (د1) + قائمة بشارات
 * الحالة وآخر استخدام (د3/د7) + إبطال فوري (د3). بلا شاشة جديدة ولا بلاطة للفريق.
 * هوية NOVA · RTL · موبايل 390 — وURL يُبنى محليًا (النواة النقية بخادمية crypto لا تُستورد هنا).
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, ExternalLink, Link2, Plus } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPost } from "./api";

/** طوابع التوقيت الكويتي (UTC+3) بنمط ملف العميل — «YYYY-MM-DD HH:mm» */
function kwStamp(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

const PORTAL_CHOICES = [30, 90, 365] as const;
const PORTAL_DEFAULT_DAYS = 90;

interface PortalLinkRow {
  id: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string;
  status: string; // نشط | منتهي | مبطول — من الخادم (د3)
}

interface CreateLinkResponse {
  id: number;
  token: string;
  expiresAt: string;
}

function statusBadgeClass(status: string): string {
  if (status === "نشط") return "bg-emerald-600 text-white hover:bg-emerald-600";
  if (status === "مبطول") return "bg-rose-600 text-white hover:bg-rose-600";
  return "bg-muted text-muted-foreground hover:bg-muted";
}

export function CustomerPortalLinks({
  customerId,
  customerName,
  onAuthError,
}: {
  customerId: number;
  customerName: string;
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [days, setDays] = React.useState<number>(PORTAL_DEFAULT_DAYS);
  const [createdLink, setCreatedLink] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<PortalLinkRow | null>(null);

  const linksQuery = useQuery<PortalLinkRow[]>({
    queryKey: ["customer-file", customerId, "portal-links"],
    queryFn: () => apiGet<PortalLinkRow[]>(`/api/customers/${customerId}/portal-links`),
    retry: false,
  });

  React.useEffect(() => {
    if (linksQuery.error instanceof ApiError && linksQuery.error.status === 401) onAuthError();
  }, [linksQuery.error, onAuthError]);

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["customer-file", customerId, "portal-links"] });
  }, [qc, customerId]);

  const createLink = useMutation({
    mutationFn: () => apiPost<CreateLinkResponse>(`/api/customers/${customerId}/portal-links`, { days }),
    onSuccess: (data) => {
      setCreateOpen(false);
      // د1 — النص الصريح مرة واحدة: يُبنى محليًا ويُعرض في حوار واحد ثم يُنسى من الذاكرة
      setCreatedLink({
        url: `${window.location.origin}/api/portal/statement/${encodeURIComponent(data.token)}`,
        expiresAt: data.expiresAt,
      });
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      toast({ title: "تعذر إنشاء الرابط", description: e instanceof Error ? e.message : "حاول لاحقًا", variant: "destructive" });
    },
  });

  const revokeLink = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/customers/${customerId}/portal-links/${id}`),
    onSuccess: () => {
      setRevokeTarget(null);
      toast({ title: "أُبطل الرابط فورًا — لن يعمل من الآن" });
      refresh();
    },
    onError: (e) => {
      setRevokeTarget(null);
      if (e instanceof ApiError && e.status === 401) return onAuthError();
      toast({ title: "تعذر الإبطال", description: e instanceof Error ? e.message : "حاول لاحقًا", variant: "destructive" });
    },
  });

  const copyLink = React.useCallback(
    async (url: string) => {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "نُسخ الرابط — شاركه مع العميل" });
      } catch {
        toast({ title: "انسخه يدويًا من الحقل", variant: "destructive" });
      }
    },
    [toast]
  );

  const links = linksQuery.data ?? [];

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Link2 className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">بوابة العميل — روابط كشف مؤقتة</h3>
              <p className="text-xs text-muted-foreground">
                رابط آمن يفتح كشف حساب {customerName || "العميل"} PDF بلا دخول النظام — يُخزَّن هاشًا ويُعرض مرة واحدة، ويمكن إبطاله فورًا.
              </p>
            </div>
          </div>
          <Button size="sm" className="h-9 gap-1.5 shrink-0" onClick={() => { setDays(PORTAL_DEFAULT_DAYS); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            رابط كشف مؤقت
          </Button>
        </div>

        {/* القائمة — شارة الحالة + الإنشاء + الانتهاء + آخر استخدام (د3/د7) */}
        <div className="mt-3">
          {linksQuery.isLoading ? (
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded-lg bg-muted/60" />
              <div className="h-12 animate-pulse rounded-lg bg-muted/60" />
            </div>
          ) : links.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              لا روابط بعد — أنشئ رابطًا وشاركه مع العميل ليفتح كشفه بنفسه.
            </div>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1" aria-label="روابط الكشف المؤقتة">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Badge className={`shrink-0 text-[10px] ${statusBadgeClass(l.status)}`}>{l.status}</Badge>
                    <span className="text-muted-foreground">
                      أُنشئ <span dir="ltr" className="tabular-nums">{kwStamp(l.createdAt)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      ينتهي <span dir="ltr" className="tabular-nums">{kwStamp(l.expiresAt)}</span>
                    </span>
                    {l.lastUsedAt ? (
                      <span className="text-muted-foreground">
                        آخر استخدام <span dir="ltr" className="tabular-nums">{kwStamp(l.lastUsedAt)}</span>
                        {l.lastUsedIp ? ` — ${l.lastUsedIp}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">لم يُستخدم بعد</span>
                    )}
                  </div>
                  {l.status === "نشط" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 shrink-0 text-rose-600 hover:text-rose-700"
                      onClick={() => setRevokeTarget(l)}
                      aria-label="إبطال الرابط فورًا"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      إبطال
                    </Button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">مغلق نهائيًا</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      {/* حوار الإنشاء — المدة (د2) */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إنشاء رابط كشف مؤقت</DialogTitle>
            <DialogDescription>
              يفتح الرابط كشف حساب {customerName || "العميل"} PDF بلا دخول النظام — واختر المدة ثم أكمل.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground">مدة الصلاحية</div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="مدة الصلاحية">
              {PORTAL_CHOICES.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={days === d ? "default" : "outline"}
                  className="h-10"
                  onClick={() => setDays(d)}
                  aria-pressed={days === d}
                >
                  {d} يومًا
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              الحكم على الصلاحية خادمي عند كل طلب — ويمكن إبطال الرابط في أي لحظة من هذه البطاقة.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button>
            <Button onClick={() => createLink.mutate()} disabled={createLink.isPending}>
              {createLink.isPending ? "جارٍ الإنشاء…" : "إنشاء الرابط"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار العرض مرة واحدة — د1: يُنسى من الذاكرة عند الإغلاق ولا يظهر ثانية */}
      <Dialog open={createdLink !== null} onOpenChange={(o) => !o && setCreatedLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>الرابط جاهز — انسخه الآن</DialogTitle>
            <DialogDescription>
              هذا هو نص الرابط كاملًا و<b>لن يظهر مرة أخرى</b> — القاعدة تحفظ هاشه حصرًا. انسخه وشاركه مع العميل (واتساب/SMS).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input readOnly value={createdLink?.url ?? ""} dir="ltr" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="رابط الكشف المؤقت" />
            <p className="text-[11px] text-muted-foreground" dir="ltr">
              ينتهي تلقائيًا: {createdLink ? kwStamp(createdLink.expiresAt) : ""}
            </p>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" onClick={() => createdLink && copyLink(createdLink.url)}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              نسخ الرابط
            </Button>
            <Button variant="outline" asChild>
              <a href={createdLink?.url ?? "#"} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                فتح الكشف للتجربة
              </a>
            </Button>
            <Button onClick={() => setCreatedLink(null)}>حفظتُه — إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الإبطال — د3 */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>إبطال الرابط فورًا؟</AlertDialogTitle>
            <AlertDialogDescription>
              بعد الإبطال يفشل الرابط عند أي محاولة برسالة «الرابط غير صالح أو منتهي» — لا يمكن التراجع، ويمكنك إنشاء رابط جديد في أي وقت.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => revokeTarget && revokeLink.mutate(revokeTarget.id)}
              disabled={revokeLink.isPending}
            >
              {revokeLink.isPending ? "جارٍ الإبطال…" : "إبطال الآن"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
