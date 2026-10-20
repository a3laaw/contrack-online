"use client";

/**
 * تبويب «⚙ أدوات المطور» — مرآة _tab_developer المكتبية (settings.py:1020-1242):
 * تحذير «⚠ أدوات المطور فقط.» ثم تابات داخلية خمسة بترتيبها الحرفي:
 * المزايا · الهوية والترخيص · الترحيل والاستيراد · الشبكة والنسخ · ✱ تنظيف البيانات.
 * حالة مفاتيح المزايا (import_old/network_folder/full_backup) تُقرأ من نفس
 * استعلام المزايا (مفتاح react-query نفسه — بلا نداء إضافي) لتطبيق إخفاء
 * المكتبي (V4.5.13 — settings.py:1203-1206/1223-1229).
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "../api";
import { DEV_DEFAULT_TAB, DEV_TABS } from "./tabs-catalog";
import { FeaturesSection, type FeatureFlagDTO } from "./developer/features-section";
import { IdentitySection } from "./developer/identity-section";
import { MigrationSection } from "./developer/migration-section";
import { NetworkSection } from "./developer/network-section";
import { CleanupSection } from "./developer/cleanup-section";

export function DeveloperTab({ onAuthError }: { onAuthError: () => void }) {
  const [devTab, setDevTab] = React.useState(DEV_DEFAULT_TAB);

  // نفس مفتاح استعلام المزايا — react-query يجيبها من الكاش بلا طلب شبكة ثانٍ
  const flagsQuery = useQuery<{ flags: FeatureFlagDTO[] }>({
    queryKey: ["feature-flags"],
    queryFn: () => apiGet<{ flags: FeatureFlagDTO[] }>("/api/feature-flags"),
    retry: false,
  });
  const flagsOn = React.useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const f of flagsQuery.data?.flags ?? []) map[f.key] = f.enabled;
    return map;
  }, [flagsQuery.data]);

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-status-warn/40 bg-status-warn-bg px-3 py-2 text-sm font-bold text-status-warn">
        ⚠ أدوات المطور فقط.
      </p>

      <Tabs value={devTab} onValueChange={setDevTab} className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-auto">
          {DEV_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* المزايا — الحي القائم كما هو بلا أي تغيير */}
        <TabsContent value="features" className="mt-4">
          <FeaturesSection onAuthError={onAuthError} />
        </TabsContent>

        <TabsContent value="identity" className="mt-4">
          <IdentitySection onAuthError={onAuthError} />
        </TabsContent>

        <TabsContent value="migration" className="mt-4">
          <MigrationSection importOldEnabled={Boolean(flagsOn.import_old)} onAuthError={onAuthError} />
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <NetworkSection
            networkFolderEnabled={Boolean(flagsOn.network_folder)}
            fullBackupEnabled={Boolean(flagsOn.full_backup)}
          />
        </TabsContent>

        <TabsContent value="cleanup" className="mt-4">
          <CleanupSection onAuthError={onAuthError} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
