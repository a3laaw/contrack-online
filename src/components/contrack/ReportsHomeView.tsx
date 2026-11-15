"use client";

/**
 * مركز التقارير — «نظرة عامة» (Task 114: تنظيم التقارير المبعثرة):
 *   شاشة واحدة تعرض كل مخرجات التقارير في النظام مصنفة في 4 مجموعات:
 *     العملاء والتحصيل · العقود والتنفيذ · الخزينة والمصروفات · المحاسبة والدفاتر
 *   • بطاقات «تقرير» تفتح التقرير داخل تبويب التقارير (نفس آلية القائمة الجانبية).
 *   • بطاقات «شاشة» تقفز لشاشات الدفاتر المحاسبية (الأستاذ/القوائم/التسوية/الزكاة/الكشوف)
 *     التي كانت مشتتة بين تبويب المحاسبة والتقارير — مع باب صلاحية الشاشة نفسه.
 *   • بحث فوري بالاسم والوصف يخفي ما لا يطابق.
 *   بلا نداءات API — كل شيء من السجل المحلي المفلتر بالصلاحيات والمزايا (فوري بلا تحميل).
 */

import * as React from "react";
import { BarChart3, ChevronLeft, Search, SearchX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { User } from "./contrack-types";
import { isManagerRole } from "./contrack-types";
import { permAllows, type PermsMap } from "./nav-perms";
import { REPORT_PERM } from "./nav-structure";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import {
  CATEGORY_TONE,
  REPORT_CATEGORIES,
  reportsByCategory,
  screenLinksByCategory,
} from "./reports-list";

interface ReportsHomeViewProps {
  user: User;
  perms: PermsMap;
  /** فتح تقرير من مركز التقارير (تبويب التقارير — بنفس آلية القائمة الجانبية) */
  onOpenReport: (key: string) => void;
  /** فتح شاشة دفاتر محاسبية (الأستاذ/القوائم/التسوية/الزكاة/الكشوف) */
  onOpenView: (view: string) => void;
}

export function ReportsHomeView({ user, perms, onOpenReport, onOpenView }: ReportsHomeViewProps) {
  const manager = isManagerRole(user.role);
  const permOn = React.useCallback((k: string) => permAllows(perms, k, manager), [perms, manager]);
  const { enabled: flagOn } = useFeatureFlags();

  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();

  const matches = React.useCallback(
    (texts: string[]) => !needle || texts.some((t) => t.toLowerCase().includes(needle)),
    [needle]
  );

  // كل البطاقات المرئية (قبل البحث) — لحساب العدادات
  const sections = React.useMemo(
    () =>
      REPORT_CATEGORIES.map((cat) => {
        // باب الصلاحية نفسه الذي يبني به nav-structure بنود القائمة الجانبية (REPORT_PERM)
        const reports = reportsByCategory(cat.id, flagOn).filter(
          (r) => !REPORT_PERM[r.key] || permOn(REPORT_PERM[r.key])
        );
        const links = screenLinksByCategory(cat.id, permOn);
        return { cat, reports, links, total: reports.length + links.length };
      }).filter((s) => s.total > 0),
    [flagOn, permOn]
  );

  const filtered = React.useMemo(
    () =>
      sections.map((s) => ({
        ...s,
        reports: s.reports.filter((r) => matches([r.label, r.desc])),
        links: s.links.filter((l) => matches([l.label, l.desc])),
      })).filter((s) => s.reports.length + s.links.length > 0),
    [sections, matches]
  );

  const visibleTotal = sections.reduce((n, s) => n + s.total, 0);
  const shownTotal = filtered.reduce((n, s) => n + s.reports.length + s.links.length, 0);

  return (
    <div className="space-y-5">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-brand-gold-soft text-brand-orange">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">مركز التقارير</h1>
            <p className="text-xs text-muted-foreground">
              كل تقارير النظام في مكان واحد — مصنفة ومرتبة حسب الوظيفة
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="h-6 px-2 text-xs">
          {needle ? `${shownTotal} نتيجة` : `${visibleTotal} متاح`}
        </Badge>
      </div>

      {/* البحث الفوري */}
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث في التقارير… (اسم التقرير أو وظيفته)"
          className="h-10 ps-9"
          aria-label="البحث في التقارير"
        />
      </div>

      {/* التصنيفات */}
      {filtered.length === 0 ? (
        <Card className="p-0">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <SearchX className="size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">لا تقرير مطابق لبحثك</p>
            <p className="text-xs text-muted-foreground">جرّب كلمة أقصر مثل «العملاء» أو «التدفق»</p>
          </CardContent>
        </Card>
      ) : (
        filtered.map(({ cat, reports, links }) => {
          const CatIcon = cat.icon;
          const tone = CATEGORY_TONE[cat.id];
          return (
            <section key={cat.id} aria-label={cat.label} className="space-y-2.5 pt-1">
              {/* عنوان المجموعة: أيقونة + اسم + عدّاد — ومسافة واضحة عن المجموعة السابقة */}
              <div className="flex items-center gap-2">
                <div className={cn("flex size-7 items-center justify-center rounded-md", tone.tile, tone.icon)}>
                  <CatIcon className="size-4" />
                </div>
                <h2 className="text-sm font-bold">{cat.label}</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-medium tabular-nums">
                  {reports.length + links.length}
                </Badge>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">— {cat.desc}</span>
              </div>

              {/* شبكة الكروت: 3 أعمدة كبيرة · 2 متوسطة · 1 موبايل — منتظمة بلا فراغات صفوف */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((r) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => onOpenReport(r.key)}
                      className={cn(
                        "group flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 text-start transition-all",
                        "hover:border-brand-orange hover:shadow-xs hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone.tile, tone.icon)}>
                          <Icon className="size-[18px]" />
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate text-sm font-bold">{r.label}</span>
                          {/* السهم جنب العنوان بدل أقصى الطرف (الهوية — المرحلة 4) */}
                          <ChevronLeft className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-brand-orange" />
                        </span>
                      </span>
                      <span className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                        {r.desc}
                      </span>
                    </button>
                  );
                })}
                {links.map((l) => {
                  const Icon = l.icon;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => onOpenView(l.view)}
                      className={cn(
                        "group flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 text-start transition-all",
                        "hover:border-brand-orange hover:shadow-xs hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone.tile, tone.icon)}>
                          <Icon className="size-[18px]" />
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate text-sm font-bold">{l.label}</span>
                          {/* بادج «شاشة» بنمط موحد من مكوّن Badge */}
                          <Badge variant="secondary" className="h-4.5 shrink-0 px-1.5 text-[10px] font-medium">
                            شاشة
                          </Badge>
                          <ChevronLeft className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-brand-orange" />
                        </span>
                      </span>
                      <span className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                        {l.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* ملاحظة المصدر */}
      <p className="text-xs text-muted-foreground">
        📝 كل الأرقام تُحسب لحظيًا من الحركات الفعلية — لا أرصدة مخزنة، والبطاقات تظهر حسب صلاحيات حسابك.
      </p>
    </div>
  );
}
