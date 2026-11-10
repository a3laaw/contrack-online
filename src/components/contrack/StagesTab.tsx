'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleDashed, Loader2, Play, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from './api'
import { formatDate } from '@/lib/format'
import type { ContractStageDTO } from '@/lib/contrack-types'

interface StagesTabProps {
  contractId: number
  stages: ContractStageDTO[]
  isLoading?: boolean
}

const payKindLabel: Record<string, string> = {
  advance: 'دفعة مقدمة',
  achieve: 'عند الإنجاز',
  final: 'دفعة ختامية',
  days: 'بالأيام',
}

export function StagesTab({ contractId, stages, isLoading }: StagesTabProps) {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (payload: { stageId: number; patch: { startDate?: string | null; endDate?: string | null; isSkipped?: boolean } }) =>
      api.updateStage(contractId, payload.stageId, payload.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract', contractId] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
  }
  if (stages.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          هذا العقد يدوي بلا مراحل قالبية
        </CardContent>
      </Card>
    )
  }

  return (
    <ol className="relative space-y-2.5 border-e-2 border-emerald-200 dark:border-emerald-900 me-2.5 pe-4">
      {stages.map((s) => {
        const done = s.endDate != null
        const started = s.startDate != null
        const skipped = s.isSkipped
        return (
          <li key={s.id} className="relative">
            <span
              className={`absolute -end-[25px] top-4 size-3.5 rounded-full ring-4 ring-background ${
                done ? 'bg-emerald-500' : skipped ? 'bg-stone-300 dark:bg-stone-700' : started ? 'bg-teal-500 animate-pulse' : 'bg-stone-300 dark:bg-stone-700'
              }`}
              aria-hidden
            />
            <Card className={skipped ? 'opacity-60' : undefined}>
              <CardContent className="p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm">{s.name}</span>
                  {s.level > 1 && <Badge variant="secondary" className="text-[10px]">فرعية</Badge>}
                  {done && (
                    <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900">
                      <CheckCircle2 className="size-3" aria-hidden /> منجزة
                    </Badge>
                  )}
                  {!done && started && !skipped && (
                    <Badge className="bg-teal-100 text-teal-800 border border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900">
                      <Loader2 className="size-3" aria-hidden /> قيد التنفيذ
                    </Badge>
                  )}
                  {skipped && (
                    <Badge variant="secondary" className="border">
                      <SkipForward className="size-3" aria-hidden /> متخطاة
                    </Badge>
                  )}
                  {s.payPct > 0 && (
                    <Badge variant="outline" className="text-[10px] numeric">
                      {payKindLabel[s.payKind] ?? s.payKind} · {s.payPct}%
                    </Badge>
                  )}
                  {s.expectedDays > 0 && (
                    <span className="text-[11px] text-muted-foreground numeric">{s.expectedDays} يومًا متوقعًا</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                  <span>
                    البداية: <span className="numeric" dir="ltr">{formatDate(s.startDate)}</span>
                  </span>
                  <span>
                    الإنجاز: <span className="numeric" dir="ltr">{formatDate(s.endDate)}</span>
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5"
                    disabled={mutation.isPending || started || done || skipped}
                    onClick={() => mutation.mutate({ stageId: s.id, patch: { startDate: new Date().toISOString().slice(0, 10) } })}
                  >
                    <Play className="size-3.5" aria-hidden />
                    بدء
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                    disabled={mutation.isPending || !started || done || skipped}
                    onClick={() => mutation.mutate({ stageId: s.id, patch: { endDate: new Date().toISOString().slice(0, 10) } })}
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    إنجاز اليوم
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 gap-1.5"
                    disabled={mutation.isPending || done}
                    onClick={() => mutation.mutate({ stageId: s.id, patch: { isSkipped: !skipped } })}
                  >
                    <CircleDashed className="size-3.5" aria-hidden />
                    {skipped ? 'إلغاء التخطي' : 'تخطٍ'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ol>
  )
}
