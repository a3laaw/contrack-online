"use client";

import * as React from "react";
import { Check, ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Dropdown الموحّد (الجلسة 15 — التحول الطرازي العلوي «كله علوي» بطراز Odoo).
 * المكوّن الوحيد لكل قوائم النظام: أقسام الشريط العلوي · مبدّل الشركات · قائمة الحساب ·
 * أزرار لوحة الرئيسية (القياسات/التجميع/الفلاتر) · قوائم إجراءات الجداول.
 * الشكل والسلوك موثق حرفيًا في docs/navigation-map.md §5 — يمنع تعريف قوائم منفردة في الصفحات.
 *
 * الشكل: التصاق أسفل الزر (top:100%) بلا فجوة · محاذاة مبدأ الزر (يمين RTL) مع انقلاب عند الحافة ·
 * القائمة بيضاء بحد 1px رمادي فاتح وradius 3px وظل 0 4px 10px 13% · عرض أدنى 190px وسطور بلا لف ·
 * بند 7px 16px بخط 13px مبدئي المحاذاة · hover/focus حصرًا #E9ECEF · فواصل المجموعات 1px بهامش 6px ·
 * بلا ترويسات مجموعات · ✓ للبند النشط جهة المقابل من النص (يسار RTL) مع تخين ·
 * قوائم فرعية ◂ جانبية بنفس الشكل تنقلب عند ضيق المكان · ظهور fade ≤100ms.
 *
 * السلوك: نقر يفتح/يغلق · التحويم على زر آخر وهو مفتوح يبدّل (onTriggerHover — الشريط العلوي) ·
 * نقر خارجي/Esc/اختيار يغلق (عدا بنود checkbox متعددة الاختيار) · ↑↓ وHome/End تنقل ·
 * Enter يختار · ArrowLeft يفتح الفرعي وArrowRight يرجع (RTL) · Tab يغلق ·
 * ARIA: aria-haspopup/aria-expanded/role=menu/menuitem/menuitemcheckbox.
 */

export interface DropdownItemDef {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** بند checkbox (فلتر متعدد) — لا يغلق القائمة عند الاختيار ويظهر ✓/فارغًا */
  checkbox?: boolean;
  checked?: boolean;
  disabled?: boolean;
  /** بند إتلافي — نصه بلون الخطر (حذف وغيره) */
  danger?: boolean;
  onSelect?: () => void;
  /** قائمة فرعية ◂ — نفس الشكل والسلوك */
  items?: DropdownItemDef[];
}

export interface DropdownGroupDef {
  key: string;
  items: DropdownItemDef[];
}

export interface DropdownProps {
  /** محتوى زر الفتح (نص/أيقونة/شرّيفة) */
  trigger: React.ReactNode;
  /** فئات زر الفتح — شكل الزر قرار الموضع المستخدم */
  triggerClassName?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  /** محاذاة اللوحة لمبدأ الزر (يمين RTL) افتراضيًا — «end» لنهايته؛ تنقلب عند حافة الشاشة */
  align?: "start" | "end";
  /** قائمة مسطحة */
  items?: DropdownItemDef[];
  /** قائمة مقسمة مجموعات بفواصل 1px (بلا ترويسات — قرار المواصفة) */
  groups?: DropdownGroupDef[];
  /** مفتاح البند النشط — يظهر ✓ جهة المقابل من النص مع تخين (البند النشط داخل القائمة) */
  activeKey?: string;
  /** عرض أدنى للوحة (190 افتراضيًا) */
  minWidth?: number;
  /** فئات إضافية للبنود — مثل min-h-11 لأهداف لمس ≥44px في الموبايل */
  itemClassName?: string;
  disabled?: boolean;
  /** تحكم خارجي بحالة الفتح (تبديل الأقسام بالتحويم في الشريط العلوي) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** يُستدعى عند تحويم الزر — الشريط العلوي يستخدمه لتبديل القسم المفتوح فورًا */
  onTriggerHover?: () => void;
}

const ITEM_CLS =
  "flex w-full cursor-pointer items-center gap-2 bg-transparent px-4 py-[7px] text-[13px] leading-5 text-start text-foreground whitespace-nowrap hover:bg-[#E9ECEF] focus:bg-[#E9ECEF] focus:outline-none disabled:pointer-events-none disabled:opacity-50";

const PANEL_CLS =
  "z-50 rounded-[3px] border border-border bg-card py-1 shadow-[0_4px_10px_rgba(0,0,0,0.13)] animate-[ud-fade_80ms_ease-out] outline-none";

interface ItemsListProps {
  items: DropdownItemDef[];
  activeKey?: string;
  itemClassName?: string;
  openSub: string | null;
  onOpenSub: (key: string | null) => void;
  onPick: (item: DropdownItemDef) => void;
}

function ItemRow({ item, activeKey, itemClassName, onPick }: { item: DropdownItemDef; activeKey?: string; itemClassName?: string; onPick: (item: DropdownItemDef) => void }) {
  const Icon = item.icon;
  const isActive = activeKey !== undefined && item.key === activeKey;
  const showCheck = item.checkbox ? !!item.checked : item.checked === true || isActive;
  return (
    <button
      type="button"
      role={item.checkbox ? "menuitemcheckbox" : "menuitem"}
      aria-checked={item.checkbox ? !!item.checked : undefined}
      tabIndex={-1}
      disabled={item.disabled}
      className={cn(ITEM_CLS, showCheck && "font-semibold", item.danger && "text-destructive", itemClassName)}
      onClick={() => onPick(item)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {Icon && <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />}
        <span className="truncate">{item.label}</span>
      </span>
      {/* ✓ جهة المقابل من النص — يسار في RTL */}
      {showCheck && <Check className="size-3.5 shrink-0" aria-hidden />}
    </button>
  );
}

/** لوحة قائمة فرعية ◂ — جانبية بنفس الشكل، تنقلب عند الحافة اليسرى */
function SubPanel({ item, activeKey, itemClassName, openSub, onOpenSub, onPick }: { item: DropdownItemDef } & Omit<ItemsListProps, "items">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [flip, setFlip] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.left < 4) setFlip(true);
    else if (rect.right > document.documentElement.clientWidth - 4) setFlip(false);
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={item.label}
      tabIndex={-1}
      data-sub-root={item.key}
      className={cn(PANEL_CLS, "absolute top-[-1px] min-w-[190px]")}
      style={flip ? { insetInlineEnd: "100%" } : { insetInlineStart: "100%" }}
    >
      <ItemsList items={item.items ?? []} activeKey={activeKey} itemClassName={itemClassName} openSub={openSub} onOpenSub={onOpenSub} onPick={onPick} />
    </div>
  );
}

function ItemsList({ items, activeKey, itemClassName, openSub, onOpenSub, onPick }: ItemsListProps) {
  return (
    <>
      {items.map((item) => {
        if (item.items?.length) {
          const subOpen = openSub === item.key;
          return (
            <div
              key={item.key}
              className="relative"
              onMouseEnter={() => onOpenSub(item.key)}
              onMouseLeave={() => onOpenSub(null)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={subOpen}
                aria-label={item.label}
                data-sub-parent={item.key}
                tabIndex={-1}
                disabled={item.disabled}
                className={cn(ITEM_CLS, itemClassName)}
                onClick={() => onOpenSub(item.key)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {item.icon && <item.icon className="size-3.5 shrink-0 opacity-70" aria-hidden />}
                  <span className="truncate">{item.label}</span>
                </span>
                {/* ◂ جهة نهاية النص — يسار في RTL */}
                <ChevronLeft className="size-3.5 shrink-0 opacity-60" aria-hidden />
              </button>
              {subOpen && (
                <SubPanel item={item} activeKey={activeKey} itemClassName={itemClassName} openSub={openSub} onOpenSub={onOpenSub} onPick={onPick} />
              )}
            </div>
          );
        }
        return <ItemRow key={item.key} item={item} activeKey={activeKey} itemClassName={itemClassName} onPick={onPick} />;
      })}
    </>
  );
}

export function Dropdown({
  trigger,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  align = "start",
  items,
  groups,
  activeKey,
  minWidth = 190,
  itemClassName,
  disabled,
  open,
  onOpenChange,
  onTriggerHover,
}: DropdownProps) {
  const flatItems = groups ? groups.flatMap((g) => g.items) : (items ?? []);
  const hasSub = flatItems.some((i) => !!i.items?.length);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const keyboardOpenRef = React.useRef(false);

  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isOpen = isControlled ? open : uncontrolledOpen;
  const [side, setSide] = React.useState<"start" | "end">(align);
  const [openSub, setOpenSub] = React.useState<string | null>(null);

  const setOpen = React.useCallback(
    (o: boolean, viaKeyboard = false) => {
      if (o) keyboardOpenRef.current = viaKeyboard;
      if (!isControlled) setUncontrolledOpen(o);
      onOpenChange?.(o);
    },
    [isControlled, onOpenChange]
  );

  // نقر خارجي أو Esc يغلقان — والتركيز يعود لزر الفتح
  React.useEffect(() => {
    if (!isOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, setOpen]);

  // عند الفتح: بلوحة المفاتيح يركّز أول بند — وبالفأرة تركيز اللوحة (الأسهم تعمل من الحاوية)
  React.useEffect(() => {
    if (!isOpen) {
      setOpenSub(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (keyboardOpenRef.current) {
        panelRef.current?.querySelector<HTMLButtonElement>("[role='menuitem'],[role='menuitemcheckbox']")?.focus();
      } else {
        panelRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // انقلاب المحاذاة عند حافة الشاشة
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (rect.left < 4) setSide("end");
    else if (rect.right > vw - 4) setSide("start");
  }, [isOpen]);

  const focusables = React.useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem'],[role='menuitemcheckbox']") ?? []
      ).filter((b) => !b.disabled),
    []
  );

  const moveFocus = React.useCallback(
    (dir: 1 | -1 | "first" | "last") => {
      const els = focusables();
      if (!els.length) return;
      const idx = els.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        dir === "first" ? 0 : dir === "last" ? els.length - 1 : idx < 0 ? 0 : (idx + dir + els.length) % els.length;
      els[next]?.focus();
    },
    [focusables]
  );

  const onPick = React.useCallback(
    (item: DropdownItemDef) => {
      if (item.disabled) return;
      item.onSelect?.();
      // بنود الاختيار المتعدد تبقي القائمة مفتوحة — والبقية تغلقها
      if (!item.checkbox) setOpen(false);
    },
    [setOpen]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveFocus("first");
    } else if (e.key === "End") {
      e.preventDefault();
      moveFocus("last");
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowLeft") {
      // RTL: اليسار = التعمق في قائمة فرعية ◂
      const btn = (e.target as HTMLElement).closest("button[data-sub-parent]");
      const key = btn?.getAttribute("data-sub-parent");
      if (key) {
        e.preventDefault();
        setOpenSub(key);
        requestAnimationFrame(() => {
          panelRef.current
            ?.querySelector<HTMLButtonElement>(`[data-sub-root="${CSS.escape(key)}"] [role='menuitem']:not([disabled])`)
            ?.focus();
        });
      }
    } else if (e.key === "ArrowRight") {
      // RTL: اليمين = رجوع من القائمة الفرعية إلى بندها
      const sub = (e.target as HTMLElement).closest("[data-sub-root]");
      const key = sub?.getAttribute("data-sub-root");
      if (key) {
        e.preventDefault();
        setOpenSub(null);
        requestAnimationFrame(() => {
          panelRef.current?.querySelector<HTMLButtonElement>(`button[data-sub-parent="${CSS.escape(key)}"]`)?.focus();
        });
      }
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        title={triggerTitle}
        className={triggerClassName}
        onClick={() => (isOpen ? setOpen(false) : setOpen(true, true))}
        onMouseEnter={() => onTriggerHover?.()}
      >
        {trigger}
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={triggerLabel}
          tabIndex={-1}
          className={cn(
            PANEL_CLS,
            "absolute top-full",
            hasSub ? "overflow-visible" : "max-h-[min(70dvh,480px)] overflow-y-auto"
          )}
          style={{ [side === "start" ? "insetInlineStart" : "insetInlineEnd"]: 0, minWidth }}
        >
          {groups
            ? groups.map((g, gi) => (
                <React.Fragment key={g.key}>
                  {gi > 0 && <div role="separator" className="my-1.5 h-px bg-border" />}
                  <ItemsList
                    items={g.items}
                    activeKey={activeKey}
                    itemClassName={itemClassName}
                    openSub={openSub}
                    onOpenSub={setOpenSub}
                    onPick={onPick}
                  />
                </React.Fragment>
              ))
            : (
                <ItemsList
                  items={items ?? []}
                  activeKey={activeKey}
                  itemClassName={itemClassName}
                  openSub={openSub}
                  onOpenSub={setOpenSub}
                  onPick={onPick}
                />
              )}
        </div>
      )}
    </div>
  );
}
