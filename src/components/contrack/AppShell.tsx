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
  topSectionsFor,
  topSectionIdForChild,
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
                isActive ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                ? "h-12 bg-[#E9ECEF] text-foreground"
                : isActive
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
            items={s.children.map((c) => ({ key: c.id, label: c.label, onSelect: () => pick(c) }))}
          />
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
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
                  "flex w-11 shrink-0 items-center justify-center transition-colors",
                  appsOpen ? "bg-[#E9ECEF] text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                  triggerClassName="flex h-12 items-center gap-1.5 whitespace-nowrap px-2 text-sm text-foreground transition-colors hover:bg-secondary"
                  groups={mobileGroups}
                  itemClassName="min-h-11"
                />
              </div>
            )}

            {/* الأدوات — أقصى اليسار: البحث والإشعارات والحساب */}
            <div className="ms-auto flex shrink-0 items-center gap-0.5">
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
                triggerClassName="flex h-12 items-center gap-2 px-2 transition-colors hover:bg-secondary"
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

      {/* المحتوى — بكامل العرض (لا قائمة جانبية تقتط منه) — حاوية التمرير الوحيدة */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-3 px-3 py-3 sm:px-4 lg:px-6">{children}</div>
      </main>

      {/* التذييل — يثبت أسفل حاوية التمرير دائمًا */}
      <footer className="border-t bg-muted/40">
        <div className="px-4 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground">
          ConTrack V9.15 — إدارة العقود والمحاسبة
        </div>
      </footer>
    </div>
  );
}

/**
 * طبقة التطبيقات (طراز Odoo): أيقونات الوحدات 72px بأسمائها — الوحدة الحالية مميزة،
 * النقر يدخل أول بند مرئي ويغلق الطبقة، Esc يغلق، الأسهم تنقل وEnter يختار،
 * عمودان على الموبايل وأهداف لمس ≥44px.
 */
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
      className="fixed inset-x-0 bottom-0 z-30 bg-background"
      style={{ top: topOffset }}
      role="dialog"
      aria-modal="true"
      aria-label="التطبيقات — كل الوحدات"
      onKeyDown={onKeyDown}
    >
      <div
        ref={gridRef}
        className="mx-auto grid max-w-3xl grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:gap-3 sm:p-6 md:grid-cols-4 lg:grid-cols-6"
      >
        {modules.map(({ module, children }) => {
          const Icon = module.icon;
          const isActive = module.id === activeModuleId;
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
                isActive
                  ? "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary-soft-border"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-[72px] items-center justify-center rounded-2xl border transition-colors",
                  isActive
                    ? "border-primary-soft-border bg-card text-primary-ink"
                    : "border-border bg-card text-muted-foreground group-hover:text-foreground"
                )}
              >
                <Icon className="size-9" aria-hidden />
              </span>
              {module.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
