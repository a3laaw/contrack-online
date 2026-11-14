'use client'

// ============================================================
// ConTrack Online — شاشة الأرشيف (Task 15-b — spec-8-f §4)
// أقسام: العملاء المؤرشفون · العقود المؤرشفة · السندات الملغاة
// الاسترجاع للمدير فقط — أرشفة العقد/العميل لا تمس أي حساب مالي (إخفاء فقط)
// ملاحظة: أزرار «أرشفة» تُضاف للمنسق في قوائم العملاء/العقود (POST /api/archive)
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArchiveRestore, FileText, Receipt, ShieldAlert, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from './api'
import { archiveApi } from '@/lib/productivity-api'
import { formatDate, formatKWD, voucherTypeBadgeClass, voucherTypeLabel } from '@/lib/format'
import type { SessionUser } from '@/lib/contrack-types'

export interface ArchiveViewProps {
  user: SessionUser
}

const isAdmin = (role: string) => role === 'admin' || role === 'developer'

function AdminOnlyNote() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm flex items-start gap-2">
      <ShieldAlert className="size-4 mt-0.5 shrink-0" aria-hidden />
      <span>العرض متاح للجميع — أزرار الاسترجاع والأرشفة للمدير فقط.</span>
    </div>
  )
}

export function ArchiveView({ user }: ArchiveViewProps) {
  const qc = useQueryClient()
  const admin = isAdmin(user.role)

  const { data, isLoading, error } = useQuery({
    queryKey: ['archive'],
    queryFn: () => archiveApi.list(),
  })

  const unarchiveMut = useMutation({
    mutationFn: (input: { type: 'customer' | 'contract'; id: number }) =>
      archiveApi.setArchived('unarchive', input.type, input.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archive'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
      qc.invalidateQueries({ queryKey: ['customer-file'] })
      toast.success('أُعيد العنصر إلى القوائم النشطة')
    },
    onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : e.message),
  })

  const customers = data?.customers ?? []
  const contracts = data?.contracts ?? []
  const vouchers = data?.vouchers ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          الأرشفة إخفاء من القوائم النشطة فقط — لا تمس أي حساب مالي ولا سند (قاعدة الأصل)
        </p>
        {!admin && <AdminOnlyNote />}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm">
          تعذر تحميل الأرشيف: {(error as Error).message}
        </div>
      )}

      <Tabs defaultValue="customers">
        <TabsList className="w-full flex flex-wrap h-auto gap-1">
          <TabsTrigger value="customers">العملاء ({customers.length})</TabsTrigger>
          <TabsTrigger value="contracts">العقود ({contracts.length})</TabsTrigger>
          <TabsTrigger value="vouchers">السندات الملغاة ({vouchers.length})</TabsTrigger>
        </TabsList>

        {/* ---------- العملاء المؤرشفون ---------- */}
        <TabsContent value="customers" className="space-y-3">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : customers.length === 0 ? (
                <div className="py-14 text-center text-sm text-muted-foreground">
                  <Users className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
                  لا عملاء مؤرشفين — أرشفة العميل تتم من قائمة العملاء (مدير)
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto cmd-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-start">الكود</TableHead>
                        <TableHead className="text-start">الاسم</TableHead>
                        <TableHead className="text-start">الهاتف</TableHead>
                        <TableHead className="text-start">العقود</TableHead>
                        <TableHead className="text-start">القيمة الخام</TableHead>
                        <TableHead className="text-start">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-bold numeric">{c.customerCode}</TableCell>
                          <TableCell className="font-semibold">{c.name}</TableCell>
                          <TableCell className="numeric" dir="ltr">{c.phone || '—'}</TableCell>
                          <TableCell className="numeric">{c.contractsCount}</TableCell>
                          <TableCell className="numeric">{formatKWD(c.totalRaw)}</TableCell>
                          <TableCell>
                            {admin ? (
                              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => unarchiveMut.mutate({ type: 'customer', id: c.id })}>
                                <ArchiveRestore className="size-3.5" aria-hidden /> استرجاع
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- العقود المؤرشفة ---------- */}
        <TabsContent value="contracts" className="space-y-3">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : contracts.length === 0 ? (
                <div className="py-14 text-center text-sm text-muted-foreground">
                  <FileText className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
                  لا عقود مؤرشفة — أرشفة العقد تتم من قائمة العقود (مدير)
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto cmd-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-start">العقد</TableHead>
                        <TableHead className="text-start">العميل</TableHead>
                        <TableHead className="text-start">الحالة</TableHead>
                        <TableHead className="text-start">القيمة الحالية</TableHead>
                        <TableHead className="text-start">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contracts.map((k) => (
                        <TableRow key={k.id}>
                          <TableCell>
                            <p className="font-bold numeric" dir="ltr">{k.contractNumber}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-44">{k.contractName || '—'}</p>
                          </TableCell>
                          <TableCell>{k.customerName}</TableCell>
                          <TableCell><Badge variant="secondary">{k.status}</Badge></TableCell>
                          <TableCell className="numeric font-semibold">{formatKWD(k.currentValue)}</TableCell>
                          <TableCell>
                            {admin ? (
                              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => unarchiveMut.mutate({ type: 'contract', id: k.id })}>
                                <ArchiveRestore className="size-3.5" aria-hidden /> استرجاع
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- السندات الملغاة (قسم قراءة) ---------- */}
        <TabsContent value="vouchers" className="space-y-3">
          <div className="rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/40 px-4 py-3 text-xs text-muted-foreground">
            السندات لا تُؤرشف — السند الملغى يخرج من القوائم النشطة بحكم إلغائه ويُعرض هنا للقراءة فقط
            (إلغاء السند يبقى من شاشة السندات بصلاحياته المالية).
          </div>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : vouchers.length === 0 ? (
                <div className="py-14 text-center text-sm text-muted-foreground">
                  <Receipt className="size-8 mx-auto mb-2 opacity-40" aria-hidden />
                  لا سندات ملغاة
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto cmd-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-start">السند</TableHead>
                        <TableHead className="text-start">النوع</TableHead>
                        <TableHead className="text-start">التاريخ</TableHead>
                        <TableHead className="text-start">المبلغ</TableHead>
                        <TableHead className="text-start">الطرف</TableHead>
                        <TableHead className="text-start">سبب الإلغاء</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vouchers.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-bold numeric" dir="ltr">{v.voucherNumber}</TableCell>
                          <TableCell><Badge className={voucherTypeBadgeClass(v.vtype)}>{voucherTypeLabel(v.vtype)}</Badge></TableCell>
                          <TableCell className="numeric" dir="ltr">{formatDate(v.vdate)}</TableCell>
                          <TableCell className="numeric font-semibold">{formatKWD(v.amount)}</TableCell>
                          <TableCell>{v.party || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-48">
                            <span className="truncate block">{v.cancelReason || '—'}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Archive className="size-3.5" aria-hidden />
        المجموع 3 أقسام: {customers.length} عميل · {contracts.length} عقد · {vouchers.length} سند ملغى
      </p>
    </div>
  )
}
