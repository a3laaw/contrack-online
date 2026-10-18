"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "./api";
import { isEffectivelyEnabled } from "@/lib/feature-flags";

/**
 * مزوّد المزايا: يحمّل المزايا مرة واحدة ويوفر useFeatureFlags() للشاشات.
 * قبل اكتمال التحميل (أو عند فشله) تُعاب كل المفاتيح مفعّلة —
 * قاعدة «لا تحذف أي ميزة قائمة بلا دليل».
 */

export interface FeatureFlagEntry {
  key: string;
  name: string;
  desc: string;
  group: string;
  requires: string[];
  enabled: boolean;
  effective: boolean;
}

interface FeatureFlagsResponse {
  flags: FeatureFlagEntry[];
}

interface FeatureFlagsCtx {
  /** قيد التحميل الأول */
  loading: boolean;
  /** سجل المزايا كما عاد من الخادم (فارغ قبل التحميل) */
  flags: FeatureFlagEntry[];
  /** هل الميزة مفعّلة فعلًا (مع اعتمادياتها requires)؟ */
  enabled: (key: string) => boolean;
}

const FeatureFlagsContext = React.createContext<FeatureFlagsCtx>({
  loading: true,
  flags: [],
  enabled: () => true,
});

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const query = useQuery<FeatureFlagsResponse>({
    queryKey: ["feature-flags"],
    queryFn: () => apiGet<FeatureFlagsResponse>("/api/feature-flags"),
    staleTime: 60_000,
    retry: false,
  });

  const flags = query.data?.flags ?? [];

  const storedMap = React.useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const f of flags) map[f.key] = f.enabled;
    return map;
  }, [flags]);

  const enabled = React.useCallback(
    (key: string) => {
      if (!query.isSuccess) return true;
      return isEffectivelyEnabled(key, storedMap);
    },
    [query.isSuccess, storedMap]
  );

  const value = React.useMemo<FeatureFlagsCtx>(
    () => ({ loading: query.isPending, flags, enabled }),
    [query.isPending, flags, enabled]
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags() {
  return React.useContext(FeatureFlagsContext);
}
