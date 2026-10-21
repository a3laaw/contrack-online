"use client";

import * as React from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiGet, apiPost, ApiError } from "./api";
import { errMessage } from "./contrack-types";
import { cn } from "@/lib/utils";

/**
 * G3 — جرس الإشعارات في الترويسة: قائمة منسدلة (بلا حوار) — عدّاد غير المقروء
 * مع تحديث دوري كل دقيقة وعند عودة التركيز. النقر على إشعار = تعليمه مقروءًا + تنقّل اختياري.
 */

interface NotifItem {
  id: number;
  transactionType: string;
  transactionId: number;
  type: string; // stage_change | new_message
  text: string;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotifItem[];
  count: number;
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  stage_change: { label: "مرحلة", cls: "bg-status-info-bg text-status-info" },
  new_message: { label: "رسالة", cls: "bg-status-warn-bg text-status-warn" },
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  return d.toISOString().slice(0, 10);
}

export function NotificationBell({ onOpenTransaction }: { onOpenTransaction?: (transactionType: string, transactionId: number) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const notifQuery = useQuery<NotificationsResponse>({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const items = notifQuery.data?.items ?? [];
  const count = notifQuery.data?.count ?? 0;

  React.useEffect(() => {
    if (!(notifQuery.error instanceof ApiError)) return;
    if (notifQuery.error.status === 401) return; // الترويسة تتصرف عند انتهاء الجلسة
  }, [notifQuery.error]);

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }, [qc]);

  const markOne = React.useCallback(
    async (n: NotifItem) => {
      try {
        await apiPost("/api/notifications/read", { id: n.id });
        invalidate();
        onOpenTransaction?.(n.transactionType, n.transactionId);
      } catch (e) {
        console.error(errMessage(e));
      }
    },
    [invalidate, onOpenTransaction]
  );

  const markAll = React.useCallback(async () => {
    try {
      await apiPost("/api/notifications/read-all", {});
      invalidate();
    } catch (e) {
      console.error(errMessage(e));
    }
  }, [invalidate]);

  const clearOld = React.useCallback(async () => {
    try {
      await apiPost("/api/notifications/clear-old", {});
      invalidate();
    } catch (e) {
      console.error(errMessage(e));
    }
  }, [invalidate]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-9 text-muted-foreground" aria-label={`الإشعارات${count ? ` (${count} غير مقروء)` : ""}`}>
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -start-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-danger px-1 text-[10px] font-bold text-white tabular-nums">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" dir="rtl">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-bold">الإشعارات</span>
          {count > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {count} غير مقروء
            </Badge>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto" role="list" aria-label="قائمة الإشعارات">
          {notifQuery.isLoading ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">جارٍ التحميل…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">لا إشعارات غير مقروءة</p>
          ) : (
            items.map((n) => {
              const kind = TYPE_BADGE[n.type] ?? TYPE_BADGE.stage_change;
              return (
                <button
                  key={n.id}
                  type="button"
                  role="listitem"
                  onClick={() => markOne(n)}
                  className="flex w-full flex-col gap-1 border-b px-3 py-2.5 text-start transition-colors hover:bg-secondary"
                  title="تعليم كمقروء وفتح المعاملة"
                >
                  <div className="flex items-center gap-2">
                    <Badge className={cn("h-5 border-0 px-1.5 text-[10px]", kind.cls)}>{kind.label}</Badge>
                    <span className="text-[10px] text-muted-foreground">{fmtWhen(n.createdAt)}</span>
                  </div>
                  <span className="line-clamp-3 text-xs leading-5">{n.text}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t p-1.5">
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={markAll} disabled={count === 0}>
            <CheckCheck className="size-3.5" />
            تعليم الكل مقروءًا
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={clearOld}
            disabled={items.length === 0}
            title="مسح المقروءة والأقدم من 30 يومًا"
          >
            <Trash2 className="size-3.5" />
            مسح القديم
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
