"use client";

import * as React from "react";
import { DirectionProvider as RadixDirectionProvider } from "@radix-ui/react-direction";

/**
 * مزوّد الاتجاه لمكوّنات Radix (القوائم المنبثقة، Select، Popover، Dialog…):
 * مكوّنات Radix لا ترث الاتجاه من <html dir> عبر البوابات (portals) بل من
 * DirectionContext — بدونه تُصيَّر LTR افتراضياً فتظهر القوائم معكوسة وسط صفحة RTL.
 * هذا المزوّد يوحّد الاتجاه RTL على مستوى التطبيق كله.
 */
export function AppDirectionProvider({ children }: { children: React.ReactNode }) {
  return <RadixDirectionProvider dir="rtl">{children}</RadixDirectionProvider>;
}
