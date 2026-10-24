"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, ApiError } from "./api";
import { formatKWD } from "@/lib/format";
import type { FollowupResponse, TaskItem, TasksResponse, User } from "./contrack-types";

interface DueItemsViewProps {
  user: User;
  onAuthError: () => void;
  onOpenContract: (id: number) => void;
}

/**
 * المهام المستحقة (وحدة الرئيسية) — المستحق الآن + المتأخر عن التحصيل + المهام المتأخرة.
 * المقابل المكتبي: لوحة المهام داخل المؤشرات + شاشة التسديد (due_items_page.py: المستحق/المسدد).
 */
export function DueItemsView({ user, onAuthError, onOpenContract }: DueItemsViewProps) {
  const followup = useQuery<FollowupResponse>({
    queryKey: ["followup"],
    queryFn: () => apiGet<FollowupResponse>("/api/followup"),
  });

  const tasksQuery = useQuery<TasksResponse>({
    queryKey: ["tasks"],
    queryFn: () => apiGet<TasksResponse>("/api/tasks"),
  });
  const items: TaskItem[] = tasksQuery.data?.tasks ?? tasksQuery.data?.items ?? [];

  React.useEffect(() => {
    const e = followup.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [followup.error, onAuthError]);
  React.useEffect(() => {
    const e = tasksQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [tasksQuery.error, onAuthError]);

  const dueNow = followup.data?.dueNow ?? [];
  const overdue = followup.data?.overdueCollections ?? [];
  const lateTasks = items.filter(
    (t) => t.status !== "منجزة" && t.dueAt && new Date(t.dueAt.replace(" ", "T")) < new Date()
  );

  return (
    <div className="space-y-4">
      {/* العنوان — سطر واحد مضغوط */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">المهام المستحقة</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">المستحق للتحصيل والمهام المتأخرة</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* المستحق الآن */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-primary" />
              المستحق الآن ({dueNow.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {followup.isLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : dueNow.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">لا يوجد مستحق الآن.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">العقد</TableHead>
                      <TableHead className="text-xs">العميل</TableHead>
                      <TableHead className="text-xs">المتبقي</TableHead>
                      <TableHead className="text-xs">البند</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dueNow.map((r, i) => (
                      <TableRow key={`${r.contractNumber}-${i}`}>
                        <TableCell className="text-sm">
                          {r.contractId ? (
                            <button
                              type="button"
                              className="font-medium text-primary hover:underline"
                              onClick={() => r.contractId && onOpenContract(r.contractId)}
                            >
                              {r.contractNumber}
                            </button>
                          ) : (
                            <span className="font-medium">{r.contractNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{r.customerName}</TableCell>
                        <TableCell className="text-start font-mono text-sm tabular-nums" dir="ltr">
                          {formatKWD(r.remaining)}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-xs text-muted-foreground">{r.title || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* المتأخر عن التحصيل */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-status-warn" />
              متأخر عن التحصيل ({overdue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {followup.isLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : overdue.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">لا توجد متأخرات.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">العقد</TableHead>
                      <TableHead className="text-xs">العميل</TableHead>
                      <TableHead className="text-xs">المتبقي</TableHead>
                      <TableHead className="text-xs">آخر قبض</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overdue.map((r, i) => (
                      <TableRow key={`${r.contractNumber}-${i}`}>
                        <TableCell className="text-sm">
                          {r.contractId ? (
                            <button
                              type="button"
                              className="font-medium text-primary hover:underline"
                              onClick={() => r.contractId && onOpenContract(r.contractId)}
                            >
                              {r.contractNumber}
                            </button>
                          ) : (
                            <span className="font-medium">{r.contractNumber}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{r.customerName}</TableCell>
                        <TableCell className="text-start font-mono text-sm tabular-nums" dir="ltr">
                          {formatKWD(r.remaining)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.lastReceiptDate ? new Date(r.lastReceiptDate).toLocaleDateString("ar") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* المهام المتأخرة */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="size-4 text-primary" />
            المهام المتأخرة ({lateTasks.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tasksQuery.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : lateTasks.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">لا توجد مهام متأخرة.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">المهمة</TableHead>
                    <TableHead className="text-xs">العميل / العقد</TableHead>
                    <TableHead className="text-xs">الاستحقاق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lateTasks.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm font-medium">{t.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.customerName || t.contractNumber || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className="border-0 bg-status-danger-bg text-status-danger text-xs">
                          {t.dueAt ? t.dueAt.slice(0, 10) : "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
