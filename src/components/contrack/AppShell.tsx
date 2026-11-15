"use client";

import * as React from "react";
import { ChevronDown, Grip, LogOut, Search, ShieldCheck, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { User } from "./contrack-types";
import { ROLE_LABEL, isManagerRole } from "./contrack-types";
import { useFeatureFlags } from "./FeatureFlagsProvider";
import { NotificationBell } from "./NotificationBell";
import { CompanySwitcher } from "./CompanySwitcher";
import { Dropdown } from "./dropdown";
import type { DropdownGroupDef } from "./dropdown";
import {
  NAV_MODULES,
  findNavChild,
  topSectionIdForChild,
  topSectionItemGroups,
  topSectionsFor,
  type ModuleId,
  type NavChild,
  type NavModule,
} from "./nav-structure";
import { permAllows, visibleChildren } from "./nav-perms";
import { navModulesFor } from "@/lib/modules-catalog";

interface AppShellProps {
  user: User;
  /** معرّف البند النشط (child.id) — يحدد الوحدة والقسم المُبرز */
  activeNav: string;
  onSelectChild: (child: NavChild) => void;
  onLogout: () => void;
  onOpenSearch?: () => void;
  /** خريطة صلاحيات المستخدم (من /api/auth/me) — غير محمّلة = السماح مؤقتًا منعًا للوميض */
  perms?: Record<string, boolean> | null;
  /** G3 — فتح معاملة من إشعار (contract ⇒ تفاصيل العقد) */
  onOpenTransaction?: (transactionType: string, transactionId: number) => void;
  /** لوحة المطور (Task 97) — زر الدرع في الشريط العلوي (مطور فقط) */
  onOpenDevConsole?: () => void;
  /** لوحة المطور (Task 97) — زر «رجوع للوحة» في شريط التمييز عند الدخول لشركة أخرى */
  onReturnToDevConsole?: () => void;
  children?: React.ReactNode;
}

interface ModuleWithChildren {
  module: NavModule;
  children: NavChild[];
}

/**
 * الهيكل المعتمد (الجلسة 15 — التحول الطرازي العلوي «كله علوي» بطراز Odoo، قرار المالك):
 *   شريط علوي 48px أبيض بحد سفلي رفيع بلا أي قائمة جانبية في كل النظام —
 *   RTL: زر التطبيقات ⊞ (طبقة أيقونات الوحدات) ← اسم الوحدة ← أقسامها الظاهرة (≤6؛
 *   بند واحد رابط مباشر وأكثر قائمة منسدلة موحدة) ← أقصى اليسار: البحث والإشعارات والحساب.
 *   شريط تمييز المطور يبقى فوق الشريط أرقّ وأثبت. الموبايل <900px: منسدلة واحدة باسم الوحدة.
 *   مصدر الأقسام config واحد (nav-structure.ts top) — يُمنع تعريف قوائم داخل الصفحات.
 *   بند 5 (المرحلة 2/ب): الفلترة بالصلاحيات visibleChildren نُقلت إلى nav-perms.ts النقي.
 */
export function AppShell({ user, activeNav, onSelectChild, onLogout, onOpenSearch, perms, onOpenTransaction, onOpenDevConsole, onReturnToDevConsole, children }: AppShellProps) {
  const manager = isManagerRole(user.role);
  const isDeveloper = user.role === "developer";
  // Task 100: اللوحة شاشة قائمة بذاتها (بلا قوائم شركة) — كل أدوات التنقل مخفية فيها،
  // والدخول للشركات من أزرار «دخول» في جدولها حصرًا
  const inDevConsole = activeNav === "dev-console";
  // شريط التمييز: المطور داخل شركة (companyId>0) وخرج من اللوحة — المطور بلا شركة أم إطلاقًا
  const insideForeignCompany =
    user.role === "developer" && (user.companyId ?? 0) > 0 && !inDevConsole;
  const { enabled: featureEnabled } = useFeatureFlags();
  const flagOn = React.useCallback((f: string) => featureEnabled(f), [featureEnabled]);
  // بند 5: إخفاء البنود حسب الصلاحيات — مرآة has_permission المكتبي (الدور أولًا ثم الخريطة)
  const permOn = React.useCallback(
    (k: string) => permAllows(perms, k, manager),
    [perms, manager]
  );

  // Task 93: عجلة الماوس (البكرة) لا تغيّر قيمة الخانات الرقمية — أي input رقمي تحت العجلة
  // يفقد التركيز فورًا فلا تتغير قيمته، والصفحة تظل تتمرر طبيعيًا. الأرقام والمبالغ كتابة حرة بالكيبورد فقط.
  React.useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === "number" && document.activeElement === t) {
        t.blur();
      }
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  // خطة الأنشطة: تبويبات الشل تُحصر بأنشطة الشركة الفعّالة أولاً (user.modules —
  // null/غياب = الكل: مطور أو جلسة قديمة) ثم الفلترة المعتادة بالصلاحيات والمزايا
  const allowedNavIds = React.useMemo(() => navModulesFor(user.modules), [user.modules]);
  const modules = React.useMemo<ModuleWithChildren[]>(
    () =>
      NAV_MODULES.filter((m) => !allowedNavIds || allowedNavIds.has(m.id as ModuleId))
        .map((m) => ({ module: m, children: visibleChildren(m, manager, flagOn, permOn, isDeveloper) }))
        .filter((m) => m.children.length > 0),
    [manager, isDeveloper, flagOn, permOn, allowedNavIds]
  );

  const active = findNavChild(activeNav);
  const activeModuleId = active?.module.id ?? modules[0]?.module.id ?? "clients";
  const current = modules.find((m) => m.module.id === activeModuleId) ?? modules[0];

  // أقسام الشريط العلوي — من config التنقل الواحد مفلترة بالبنود المرئية
  const visibleIds = React.useMemo(() => new Set(current?.children.map((c) => c.id) ?? []), [current]);
  const sections = React.useMemo(
    () => (current ? topSectionsFor(current.module, visibleIds) : []),
    [current, visibleIds]
  );
  const activeSectionId = current ? topSectionIdForChild(current.module, activeNav) : undefined;

  const [appsOpen, setAppsOpen] = React.useState(false);
  const [openSection, setOpenSection] = React.useState<string | null>(null);
  const appsBtnRef = React.useRef<HTMLButtonElement>(null);

  // تغيير الشاشة يغلق أي قائمة قسم مفتوحة
  React.useEffect(() => {
    setOpenSection(null);
  }, [activeNav]);

  const pick = React.useCallback(
    (child: NavChild) => {
      onSelectChild(child);
    },
    [onSelectChild]
  );

  const openModule = React.useCallback(
    (child: NavChild) => {
      pick(child);
      setAppsOpen(false);
    },
    [pick]
  );

  // Esc يغلق طبقة التطبيقات ويعيد التركيز لزرها
  React.useEffect(() => {
    if (!appsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAppsOpen(false);
        appsBtnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [appsOpen]);

  // منسدلة الموبايل الواحدة — كل أقسام الوحدة مجموعات بفواصل (بلا ترويسات)
  const mobileGroups = React.useMemo<DropdownGroupDef[]>(
    () =>
      sections.map((s) => ({
        key: s.section.id,
        items: s.children.map((c) => ({
          key: c.id,
          label: c.label,
          icon: c.icon,
          onSelect: () => pick(c),
        })),
      })),
    [sections, pick]
  );

  const sectionNav = current && !inDevConsole && sections.length > 0 && (
    <nav aria-label={`أقسام ${current.module.label}`} className="flex min-w-0 items-stretch">
      {sections.map((s) => {
        const isActive = s.section.id === activeSectionId;
        const isOpen = openSection === s.section.id;
        if (s.children.length === 1) {
          const child = s.children[0];
          return (
            <button
              key={s.section.id}
              type="button"
              onClick={() => pick(child)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center whitespace-nowrap px-2.5 text-[13px] font-medium transition-colors",
                isActive
                  ? "font-semibold text-foreground shadow-[inset_0_-2px_0_0_var(--brand-orange)] bg-primary-soft"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground"
              )}
            >
              {s.section.label ?? child.label}
            </button>
          );
        }
        return (
          <Dropdown
            key={s.section.id}
            align="start"
            open={isOpen}
            onOpenChange={(o) => setOpenSection(o ? s.section.id : null)}
            onTriggerHover={() => {
              // وهو مفتوح قسمٌ ما، التحويم على قسم آخر يبدّله فورًا (طراز Odoo)
              if (openSection !== null && openSection !== s.section.id) setOpenSection(s.section.id);
            }}
            activeKey={activeNav}
            trigger={
              <>
                <ChevronDown className="size-3.5 opacity-70" aria-hidden />
                <span>{s.section.label}</span>
              </>
            }
            triggerClassName={cn(
              "flex items-center whitespace-nowrap rounded-none px-2.5 text-[13px] font-medium transition-colors",
              isOpen
                ? "h-12 bg-hover text-foreground"
                : isActive
                  ? "font-semibold text-foreground bg-primary-soft shadow-[inset_0_-2px_0_0_var(--brand-orange)]"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground"
            )}
            groups={topSectionItemGroups(s.children).map((kids, gi) => ({
              key: `${s.section.id}-${gi}`,
              items: kids.map((c) => ({ key: c.id, label: c.label, onSelect: () => pick(c) })),
            }))}
          />
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-background">
      <div className="sticky top-0 z-40">
        {/* شريط تمييز المطور — فوق الشريط العلوي، أرقّ وأثبت (الجلسة 15) */}
        {insideForeignCompany && (
          <div className="flex h-7 items-center justify-between gap-2 border-b border-primary/20 bg-primary-soft px-3" role="status">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary-soft-foreground">
              <ShieldCheck className="size-3" aria-hidden />
              أنت داخل شركة «{user.companyName}» كمطوّر — البيانات معزولة لنطاقها
            </p>
            {onReturnToDevConsole && (
              <button
                type="button"
                onClick={onReturnToDevConsole}
                className="rounded-md bg-primary-ink px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-ink/90"
              >
                رجوع للوحة المطور
              </button>
            )}
          </div>
        )}

        {/* ===== الشريط العلوي 48px — الوحدة الواحدة بأقسامها (لا تابات وحدات ولا قوائم جانبية) ===== */}
        <header className="h-12 border-b bg-card">
          <div className="flex h-12 items-stretch gap-0.5 px-1.5">
            {/* زر طبقة التطبيقات ⊞ — من اليمين (مخفي في لوحة المطور) */}
            {!inDevConsole && (
              <button
                ref={appsBtnRef}
                type="button"
                onClick={() => setAppsOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={appsOpen}
                aria-label="التطبيقات — كل الوحدات"
                title="التطبيقات"
                className={cn(
                  "flex w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
                  appsOpen && "text-foreground"
                )}
              >
                <Grip className="size-5" aria-hidden />
              </button>
            )}

            {/* اسم الوحدة + أقسامها — الحاسوب ≥900px */}
            {current && !inDevConsole && (
              <div className="hidden min-w-0 items-stretch min-[900px]:flex">
                <span className="flex items-center whitespace-nowrap px-2 text-sm font-bold text-foreground">
                  {current.module.label}
                </span>
                {sectionNav}
              </div>
            )}

            {/* منسدلة الوحدة الواحدة — الموبايل <900px (أهداف لمس ≥44px) */}
            {current && !inDevConsole && (
              <div className="flex min-w-0 items-center min-[900px]:hidden">
                <Dropdown
                  align="start"
                  activeKey={activeNav}
                  triggerLabel={`أقسام ${current.module.label}`}
                  trigger={
                    <>
                      <ChevronDown className="size-3.5 opacity-70" aria-hidden />
                      {React.createElement(current.module.icon, { className: "size-4", "aria-hidden": true })}
                      <span className="font-bold">{current.module.label}</span>
                    </>
                  }
                  triggerClassName="flex h-12 items-center gap-1.5 whitespace-nowrap px-2 text-sm text-foreground transition-colors hover:bg-hover"
                  groups={mobileGroups}
                  itemClassName="min-h-11"
                />
              </div>
            )}

            {/* الأدوات — أقصى اليسار: البحث والإشعارات والحساب — pe-4 يمنع قص الاسم والبادج عند الحافة */}
            <div className="ms-auto flex shrink-0 items-center gap-0.5 pe-4">
              {user.role === "developer" && onOpenDevConsole && !inDevConsole && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-primary-ink hover:text-primary-ink"
                  onClick={onOpenDevConsole}
                  aria-label="لوحة تحكم المطور"
                  title="لوحة تحكم المطور"
                >
                  <ShieldCheck className="size-4" aria-hidden />
                </Button>
              )}
              {!inDevConsole && <CompanySwitcher user={user} />}
              {!inDevConsole && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  onClick={onOpenSearch}
                  aria-label="بحث شامل (Ctrl+K)"
                  title="بحث شامل (Ctrl+K)"
                >
                  <Search className="size-4" aria-hidden />
                </Button>
              )}
              <NotificationBell onOpenTransaction={onOpenTransaction} />
              <Dropdown
                align="end"
                triggerLabel="قائمة الحساب"
                trigger={
                  <>
                    <div className="hidden flex-col items-end leading-tight sm:flex">
                      <span className="text-sm font-medium">{user.fullName || user.username}</span>
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                        {ROLE_LABEL[user.role] || user.role}
                      </Badge>
                    </div>
                    <UserRound className="size-4 sm:hidden" aria-hidden />
                  </>
                }
                triggerClassName="flex h-12 items-center gap-2 px-2 transition-colors hover:bg-hover"
                items={[{ key: "logout", label: "تسجيل الخروج", icon: LogOut, onSelect: onLogout }]}
              />
            </div>
          </div>
        </header>
      </div>

      {/* ===== طبقة التطبيقات ⊞ — تغطية تحت الشريط: كل الوحدات مفلترة بالصلاحيات (الجلسة 15) ===== */}
      {appsOpen && !inDevConsole && (
        <AppsLayer
          modules={modules}
          activeModuleId={activeModuleId}
          onPickChild={openModule}
          onClose={() => {
            setAppsOpen(false);
            appsBtnRef.current?.focus();
          }}
          topOffset={insideForeignCompany ? 76 : 48}
        />
      )}

      {/* المحتوى — بكامل العرض (لا قائمة جانبية تقتط منه).
          قرار المالك: السكرول على مستوى الصفحة نفسها (document scroll) — بلا overflow داخلي
          على حاوية المحتوى فلا شريط تمرير رفيع على الحافة. الحشوة السفلية ≈ ارتفاع التذييل (48px)
          تمنع تغطية آخر صف حين يظل التذييل مثبتًا أسفل الشاشة أثناء التمرير. */}
      <main className="min-w-0 flex-1">
        <div className="w-full space-y-3 px-3 pt-3 pb-[calc(3rem+env(safe-area-inset-bottom))] sm:px-4 lg:px-6">{children}</div>
      </main>

      {/* التذييل — مثبت أسفل الشاشة أثناء تمرير الصفحة (قرار المالك)، ويرتاح في نهاية المحتوى */}
      <footer className="sticky bottom-0 z-20 border-t bg-muted/40">
        <div className="px-4 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
          ConTrack V9.15 — إدارة العقود والمحاسبة
        </div>
      </footer>
    </div>
  );
}

/**
 * طبقة التطبيقات (طراز Odoo): أيقونات الوحدات 80px بأسمائها — كل مجموعة بلون من الباليت
 * (المالية ذهبي/برتقالي · التشغيل أزرق · الموارد البشرية والاستشارات أصفر · التقارير والإعدادات رمادي)؛
 * الوحدة الحالية بحد برتقالي وخلفية برتقالية فاتحة، النقر يدخل أول بند مرئي ويغلق الطبقة،
 * Esc يغلق، الأسهم تنقل وEnter يختار، الشبكة 5 أعمدة بعرض أقصى 860px تبدأ 56px تحت الشريط،
 * أعمدة أقل على الموبايل وأهداف لمس ≥44px.
 */
/**
 * تلوين مجموعات الوحدات في طبقة التطبيقات (الهوية البصرية — المرحلة 3 + تعديل المالك):
 * المالية والتجارة (العقود/المبيعات/المحاسبة) = ذهبي/برتقالي · التشغيل (المشاريع/الباطن/المخازن/الصيانة) = أزرق ·
 * الموارد البشرية والاستشارات = أصفر · التقارير والمرجعية والإعدادات = رمادي غامق.
 * الخلفية بدرجة 18% من لون المجموعة والأيقونة بدرجتها الغامقة (docs/color-audit.md).
 */
const MODULE_TONE: Record<string, { tile: string; icon: string }> = {
  clients: { tile: "bg-brand-gold-tile", icon: "text-brand-orange" },
  sales: { tile: "bg-brand-gold-tile", icon: "text-brand-orange" },
  accounting: { tile: "bg-brand-gold-tile", icon: "text-brand-orange" },
  projects: { tile: "bg-info-tile", icon: "text-info-blue-text" },
  subs: { tile: "bg-info-tile", icon: "text-info-blue-text" },
  warehouses: { tile: "bg-info-tile", icon: "text-info-blue-text" },
  maintenance: { tile: "bg-info-tile", icon: "text-info-blue-text" },
  hr: { tile: "bg-brand-yellow-tile", icon: "text-warn-ink" },
  consulting: { tile: "bg-brand-yellow-tile", icon: "text-warn-ink" },
  reports: { tile: "bg-hover", icon: "text-muted-foreground" },
  refs: { tile: "bg-hover", icon: "text-muted-foreground" },
  settings: { tile: "bg-hover", icon: "text-muted-foreground" },
};

function AppsLayer({
  modules,
  activeModuleId,
  onPickChild,
  onClose,
  topOffset,
}: {
  modules: ModuleWithChildren[];
  activeModuleId: string;
  onPickChild: (child: NavChild) => void;
  onClose: () => void;
  topOffset: number;
}) {
  const gridRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const grid = gridRef.current;
      if (!grid) return;
      const target =
        grid.querySelector<HTMLElement>("[data-apps-active='true']") ??
        grid.querySelector<HTMLElement>("button[data-app-tile]");
      target?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const tiles = Array.from(grid.querySelectorAll<HTMLButtonElement>("button[data-app-tile]"));
    const idx = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length || 1;
    let next = -1;
    // RTL: اليسار = التالي بصريًا
    if (e.key === "ArrowLeft") next = idx + 1;
    else if (e.key === "ArrowRight") next = idx - 1;
    else if (e.key === "ArrowDown") next = idx + cols;
    else if (e.key === "ArrowUp") next = idx - cols;
    if (next >= 0 && next < tiles.length) {
      e.preventDefault();
      tiles[next]?.focus();
    }
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 overflow-y-auto bg-background"
      style={{ top: topOffset }}
      role="dialog"
      aria-modal="true"
      aria-label="التطبيقات — كل الوحدات"
      onKeyDown={onKeyDown}
    >
      {/* الشبكة تبدأ 56px تحت الشريط (pt-14) — بلا توسيط رأسي، موزطة أفقيًا (تعديل المالك).
          قرار المالك: المسافات بين البلاطات قريبة — content-start يمنع تمدد الصفوف على كامل ارتفاع
          الشاشة، وعرض أقصى 660px يجعل الأعمدة محكمة حول مربع 80px بلا فجوات واسعة. */}
      <div className="flex min-h-full justify-center px-4 pb-8 pt-14">
        <div
          ref={gridRef}
          className="grid w-full max-w-[660px] grid-cols-3 content-start gap-x-2 gap-y-8 min-[480px]:grid-cols-4 md:grid-cols-5"
        >
          {modules.map(({ module, children }) => {
            const Icon = module.icon;
            const isActive = module.id === activeModuleId;
            const tone = MODULE_TONE[module.id] ?? { tile: "bg-hover", icon: "text-muted-foreground" };
            return (
              <button
                key={module.id}
                type="button"
                data-app-tile
                data-apps-active={isActive || undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={() => children[0] && onPickChild(children[0])}
                className={cn(
                  "group flex min-h-11 flex-col items-center gap-2 rounded-xl p-2.5 text-sm font-medium transition-colors focus-visible:outline-none sm:p-3",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex size-20 items-center justify-center rounded-2xl border transition-colors",
                    isActive
                      ? "border-brand-orange bg-primary-soft text-brand-orange"
                      : cn("border-transparent", tone.tile, tone.icon, "group-hover:border-primary-soft-border")
                  )}
                >
                  <Icon className="size-[34px]" aria-hidden />
                </span>
                {module.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
